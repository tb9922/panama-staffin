import { pool, withTransaction } from '../db.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import * as portfolioService from './portfolioService.js';
import * as portfolioSnapshotRepo from '../repositories/portfolioSnapshotRepo.js';
import * as auditService from './auditService.js';
import { hasModuleAccess } from '../shared/roles.js';

export const PERIOD_GRANULARITIES = ['daily', 'weekly'];

function dateOnly(value = new Date()) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ValidationError('Invalid period date');
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new ValidationError('Invalid period date');
  }
  return raw;
}

function assertGranularity(periodGranularity = 'daily') {
  if (!PERIOD_GRANULARITIES.includes(periodGranularity)) {
    throw new ValidationError('Invalid period granularity');
  }
  return periodGranularity;
}

function startOfIsoWeek(value) {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function normalizePeriod({ periodDate = new Date(), periodGranularity = 'daily' } = {}) {
  const granularity = assertGranularity(periodGranularity);
  const periodDateOnly = dateOnly(periodDate);
  return {
    period_date: granularity === 'weekly' ? startOfIsoWeek(periodDateOnly) : periodDateOnly,
    period_granularity: granularity,
  };
}

function snapshotKpis(home) {
  const { rag, ...kpis } = home || {};
  return {
    rag: rag || {},
    kpis,
  };
}

async function accessiblePortfolioHomes({ username, isPlatformAdmin = false } = {}) {
  if (isPlatformAdmin) {
    const { rows } = await pool.query(
      `SELECT id, slug, name, config, 'platform_admin' AS role_id
         FROM homes
        WHERE deleted_at IS NULL
        ORDER BY name`,
    );
    return rows;
  }

  const normalizedUsername = String(username || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT h.id, h.slug, h.name, h.config, uhr.role_id
       FROM user_home_roles uhr
       JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
       JOIN users u ON u.username = uhr.username AND u.active = true
      WHERE uhr.username = $1
      ORDER BY h.name`,
    [normalizedUsername],
  );
  return rows.filter(row => hasModuleAccess(row.role_id, 'reports', 'read', { includeOwn: false }));
}

function filteredHomeIds(homes, filters = {}) {
  let selected = homes;
  if (filters.home_id != null) {
    selected = selected.filter(home => Number(home.id) === Number(filters.home_id));
  }
  if (filters.home_slug) {
    selected = selected.filter(home => home.slug === filters.home_slug);
  }
  return selected.map(home => Number(home.id));
}

export async function capturePortfolioKpiSnapshotsForUser({
  username,
  isPlatformAdmin = false,
  periodDate = new Date(),
  periodGranularity = 'daily',
} = {}) {
  if (isPlatformAdmin !== true) {
    throw new ForbiddenError('Platform admin access required');
  }
  const period = normalizePeriod({ periodDate, periodGranularity });
  portfolioService.clearPortfolioCache?.();
  const portfolio = await portfolioService.getPortfolioKpisForUser({ username, isPlatformAdmin });
  const homes = Array.isArray(portfolio?.homes) ? portfolio.homes : [];
  const snapshots = await withTransaction(async (client) => {
    const inserted = [];
    for (const home of homes) {
      const payload = snapshotKpis(home);
      inserted.push(await portfolioSnapshotRepo.upsert(home.home_id, {
        ...period,
        ...payload,
      }, client));
    }
    await auditService.log('portfolio_snapshot_capture', null, username, {
      periodDate: period.period_date,
      periodGranularity: period.period_granularity,
      homeCount: inserted.length,
      homeIds: inserted.map(snapshot => snapshot.home_id),
    }, client);
    return inserted;
  });

  return {
    generated_at: new Date().toISOString(),
    period_date: period.period_date,
    period_granularity: period.period_granularity,
    snapshots,
  };
}

export async function listPortfolioKpiSnapshotsForUser({
  username,
  isPlatformAdmin = false,
  filters = {},
} = {}) {
  const homes = await accessiblePortfolioHomes({ username, isPlatformAdmin });
  const homeIds = filteredHomeIds(homes, filters);
  if (homeIds.length === 0) {
    return { snapshots: [], _total: 0 };
  }

  const result = await portfolioSnapshotRepo.listByHomeIds(homeIds, {
    ...filters,
    home_id: filters.home_id == null ? undefined : Number(filters.home_id),
  });
  return {
    snapshots: result.rows,
    _total: result.total,
  };
}
