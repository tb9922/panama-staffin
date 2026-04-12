import { pool } from '../db.js';
import * as evidenceHubRepo from '../repositories/evidenceHubRepo.js';
import { normalizeEvidenceCategory } from '../src/lib/cqcEvidenceCategories.js';
import {
  canDeleteEvidenceSource,
  getEvidenceSourceLabel,
  getReadableEvidenceSources,
} from '../shared/evidenceHub.js';
import {
  canReadRecordAttachmentModule,
  getReadableRecordAttachmentModules,
  getRecordAttachmentModule,
} from '../shared/recordAttachmentModules.js';
import { getTrainingTypes } from '../shared/training.js';

const SAFE_IDENTIFIER_RE = /^[a-z_]+$/;

const HR_PARENT_META = {
  disciplinary: {
    table: 'hr_disciplinary_cases',
    titleCol: 'allegation_summary',
    staffCol: 'staff_id',
    pagePath: '/hr/disciplinary',
  },
  grievance: {
    table: 'hr_grievance_cases',
    titleCol: 'subject_summary',
    staffCol: 'staff_id',
    pagePath: '/hr/grievance',
  },
  performance: {
    table: 'hr_performance_cases',
    titleCol: 'concern_summary',
    staffCol: 'staff_id',
    pagePath: '/hr/performance',
  },
  rtw_interview: {
    table: 'hr_rtw_interviews',
    titleCol: 'absence_reason',
    staffCol: 'staff_id',
    pagePath: '/hr/absence',
  },
  oh_referral: {
    table: 'hr_oh_referrals',
    titleCol: 'reason',
    staffCol: 'staff_id',
    pagePath: '/hr/absence',
  },
  contract: {
    table: 'hr_contracts',
    titleCol: 'job_title',
    staffCol: 'staff_id',
    pagePath: '/hr/contracts',
  },
  family_leave: {
    table: 'hr_family_leave',
    titleCol: 'type',
    staffCol: 'staff_id',
    pagePath: '/hr/family-leave',
  },
  flexible_working: {
    table: 'hr_flexible_working',
    titleCol: 'requested_change',
    staffCol: 'staff_id',
    pagePath: '/hr/flex-working',
  },
  edi: {
    table: 'hr_edi_records',
    titleCol: 'description',
    staffCol: 'staff_id',
    pagePath: '/hr/edi',
  },
  tupe: {
    table: 'hr_tupe_transfers',
    titleCol: 'transferor_name',
    staffCol: null,
    pagePath: '/hr/tupe',
  },
  renewal: {
    table: 'hr_rtw_dbs_renewals',
    titleCol: 'check_type',
    staffCol: 'staff_id',
    pagePath: '/hr/renewals',
  },
};

const ONBOARDING_SECTION_LABELS = {
  dbs_check: 'Enhanced DBS Check',
  right_to_work: 'Right to Work',
  references: 'References',
  identity_check: 'Identity Check',
  health_declaration: 'Health Declaration',
  qualifications: 'Qualifications',
  contract: 'Contract',
  employment_history: 'Employment History',
  day1_induction: 'Day 1 Induction',
  policy_acknowledgement: 'Policy Acknowledgement',
};

function assertSafeIdentifier(value, label) {
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new Error(`Unsafe ${label}`);
  }
  return value;
}

function formatCaseType(caseType) {
  return String(caseType || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function classifyFreshness(reviewDueAt, createdAt) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (reviewDueAt) {
    const dueIso = String(reviewDueAt).slice(0, 10);
    const diffDays = Math.round((new Date(`${dueIso}T00:00:00Z`) - new Date(`${todayIso}T00:00:00Z`)) / 86400000);
    if (diffDays < 0) return 'overdue';
    if (diffDays <= 30) return 'due_soon';
    return 'fresh';
  }
  const createdIso = String(createdAt || '').slice(0, 10);
  if (createdIso) {
    const ageDays = Math.round((new Date(`${todayIso}T00:00:00Z`) - new Date(`${createdIso}T00:00:00Z`)) / 86400000);
    if (ageDays > 365) return 'stale';
  }
  return 'fresh';
}

async function loadStaffNames(homeId, staffIds, client) {
  const uniqueIds = [...new Set(staffIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { rows } = await client.query(
    `SELECT id, name
       FROM staff
      WHERE home_id = $1
        AND id = ANY($2::text[])
        AND deleted_at IS NULL`,
    [homeId, uniqueIds]
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

async function resolveHrRows(home, rows, client) {
  const grouped = {};
  for (const row of rows) {
    (grouped[row.sourceSubType] ||= []).push(row);
  }

  for (const [caseType, caseRows] of Object.entries(grouped)) {
    const meta = HR_PARENT_META[caseType];
    if (!meta) {
      for (const row of caseRows) {
        row.parentLabel = formatCaseType(caseType) || 'HR Case';
        row.staffName = null;
        row.ownerPagePath = '/hr';
      }
      continue;
    }

    const ids = caseRows
      .map((row) => Number.parseInt(row.sourceRecordId, 10))
      .filter((value) => Number.isInteger(value) && !Number.isNaN(value));
    if (ids.length === 0) {
      for (const row of caseRows) {
        row.parentLabel = `${formatCaseType(caseType)} - ${row.sourceRecordId}`;
        row.staffName = null;
        row.ownerPagePath = meta.pagePath;
      }
      continue;
    }

    const table = assertSafeIdentifier(meta.table, 'HR parent table');
    const titleCol = assertSafeIdentifier(meta.titleCol, 'HR title column');
    const staffCol = meta.staffCol ? assertSafeIdentifier(meta.staffCol, 'HR staff column') : null;
    const cols = ['id', titleCol, staffCol].filter(Boolean).join(', ');
    const { rows: parents } = await client.query(
      `SELECT ${cols}
         FROM ${table}
        WHERE home_id = $1
          AND id = ANY($2::int[])
          AND deleted_at IS NULL`,
      [home.id, ids]
    );
    const parentById = Object.fromEntries(parents.map((parent) => [String(parent.id), parent]));
    const staffNames = staffCol
      ? await loadStaffNames(home.id, parents.map((parent) => parent[staffCol]), client)
      : {};

    for (const row of caseRows) {
      const parent = parentById[row.sourceRecordId];
      const title = parent?.[titleCol] || `#${row.sourceRecordId}`;
      row.parentLabel = `${formatCaseType(caseType)} - ${title}`;
      row.staffName = parent && staffCol ? (staffNames[parent[staffCol]] || null) : null;
      row.ownerPagePath = meta.pagePath;
    }
  }
}

async function resolveCqcRows(home, rows, client) {
  const ids = [...new Set(rows.map((row) => row.sourceRecordId))];
  const { rows: evidenceRows } = await client.query(
    `SELECT id, quality_statement, title
       FROM cqc_evidence
      WHERE home_id = $1
        AND id = ANY($2::text[])
        AND deleted_at IS NULL`,
    [home.id, ids]
  );
  const byId = Object.fromEntries(evidenceRows.map((row) => [String(row.id), row]));
  for (const row of rows) {
    const evidence = byId[row.sourceRecordId];
    row.parentLabel = evidence
      ? `${evidence.quality_statement} - ${evidence.title || row.sourceRecordId}`
      : `CQC Evidence - ${row.sourceRecordId}`;
    row.staffName = null;
    row.ownerPagePath = '/cqc';
    row.qualityStatementId = evidence?.quality_statement || row.qualityStatementId || null;
    row.evidenceCategory = normalizeEvidenceCategory(row.evidenceCategory);
    row.evidenceOwner = row.evidenceOwner || null;
    row.reviewDueAt = row.reviewDueAt || null;
    row.freshness = classifyFreshness(row.reviewDueAt, row.createdAt);
  }
}

async function resolveOnboardingRows(home, rows, client) {
  const staffNames = await loadStaffNames(home.id, rows.map((row) => row.sourceRecordId), client);
  for (const row of rows) {
    row.parentLabel = `Onboarding - ${ONBOARDING_SECTION_LABELS[row.sourceSubType] || row.sourceSubType}`;
    row.staffName = staffNames[row.sourceRecordId] || null;
    row.ownerPagePath = '/onboarding';
  }
}

async function resolveTrainingRows(home, rows, client) {
  const staffNames = await loadStaffNames(home.id, rows.map((row) => row.sourceRecordId), client);
  const trainingTypeMap = Object.fromEntries(
    getTrainingTypes(home.config).map((type) => [type.id, type.name])
  );
  for (const row of rows) {
    row.parentLabel = `Training - ${trainingTypeMap[row.sourceSubType] || row.sourceSubType}`;
    row.staffName = staffNames[row.sourceRecordId] || null;
    row.ownerPagePath = '/training';
  }
}

function resolveRecordRows(rows) {
  for (const row of rows) {
    const meta = getRecordAttachmentModule(row.sourceSubType);
    row.parentLabel = meta ? `${meta.label} - ${row.sourceRecordId}` : `Record - ${row.sourceRecordId}`;
    row.staffName = null;
    row.ownerPagePath = meta?.pagePath || null;
  }
}

function buildSearchFilters(roleId, filters = {}) {
  const readableSources = getReadableEvidenceSources(roleId).map((source) => source.id);
  if (readableSources.length === 0) return null;

  const requestedSources = Array.isArray(filters.sourceModules) && filters.sourceModules.length > 0
    ? filters.sourceModules.filter((sourceId) => readableSources.includes(sourceId))
    : readableSources;
  if (requestedSources.length === 0) return null;

  const readableRecordModules = getReadableRecordAttachmentModules(roleId).map((entry) => entry.id);

  return {
    ...filters,
    sourceModules: requestedSources,
    recordModules: readableRecordModules.length > 0 ? readableRecordModules : null,
  };
}

export async function search(home, roleId, filters = {}) {
  const searchFilters = buildSearchFilters(roleId, filters);
  if (!searchFilters) return { rows: [], total: 0 };

  const client = await pool.connect();
  try {
    const result = await evidenceHubRepo.search(home.id, searchFilters, client);

    const grouped = {};
    for (const row of result.rows) {
      if (row.sourceModule === 'record' && !canReadRecordAttachmentModule(roleId, row.sourceSubType)) {
        continue;
      }
      (grouped[row.sourceModule] ||= []).push(row);
    }

    if (grouped.hr) await resolveHrRows(home, grouped.hr, client);
    if (grouped.cqc_evidence) await resolveCqcRows(home, grouped.cqc_evidence, client);
    if (grouped.onboarding) await resolveOnboardingRows(home, grouped.onboarding, client);
    if (grouped.training) await resolveTrainingRows(home, grouped.training, client);
    if (grouped.record) resolveRecordRows(grouped.record);

    const rows = Object.values(grouped).flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    for (const row of rows) {
      row.sourceLabel = getEvidenceSourceLabel(row.sourceModule);
      row.canDelete = canDeleteEvidenceSource(roleId, row.sourceModule, row.sourceSubType);
      if (row.sourceModule !== 'cqc_evidence') {
        row.qualityStatementId = row.qualityStatementId || null;
        row.evidenceCategory = row.evidenceCategory || null;
        row.evidenceOwner = row.evidenceOwner || null;
        row.reviewDueAt = row.reviewDueAt || null;
        row.freshness = row.freshness || null;
      }
    }

    return { rows, total: result.total };
  } finally {
    client.release();
  }
}

export async function listUploaders(homeId, roleId) {
  const searchFilters = buildSearchFilters(roleId, {});
  if (!searchFilters) return [];
  return evidenceHubRepo.listUploaders(homeId, searchFilters);
}
