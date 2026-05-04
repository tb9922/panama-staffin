import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { withTransaction } from '../db.js';
import { diffFields } from '../lib/audit.js';
import * as auditService from './auditService.js';
import * as acquisitionRepo from '../repositories/acquisitionRepo.js';

const SENSITIVE_AUDIT_FIELDS = ['description', 'evidence_ref', 'notes', 'blockers'];
const READY_STATUSES = new Set(['ready', 'complete']);

function actorId(actor) {
  return actor?.id ?? null;
}

function actorName(actor) {
  return actor?.username || 'system';
}

function definitionFor(itemKey) {
  return acquisitionRepo.ACQUISITION_ITEM_DEFINITIONS.find(item => item.item_key === itemKey);
}

function emptyToNull(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalisePayload(data = {}) {
  const copy = { ...data };
  for (const field of ['description', 'owner_name', 'due_date', 'evidence_ref', 'notes', 'blockers']) {
    if (field in copy) copy[field] = emptyToNull(copy[field]);
  }
  if ('title' in copy && typeof copy.title === 'string') copy.title = copy.title.trim();
  return copy;
}

function createPayloadWithDefaults(data = {}) {
  const payload = normalisePayload(data);
  const definition = definitionFor(payload.item_key);
  if (!definition) throw new ValidationError('Unknown acquisition onboarding item');
  return {
    ...payload,
    title: payload.title || definition.title,
    description: payload.description ?? definition.description,
  };
}

function handleUniqueConflict(err) {
  if (err?.code === '23505') {
    throw new ConflictError('Checklist item already exists for this home', 'ACQUISITION_ITEM_EXISTS');
  }
  throw err;
}

export function summarizeChecklist(items = []) {
  const total = items.length;
  const blocked = items.filter(item => item.status === 'blocked').length;
  const ready = items.filter(item => READY_STATUSES.has(item.status)).length;
  const complete = items.filter(item => item.status === 'complete').length;
  const inProgress = items.filter(item => item.status === 'in_progress').length;
  const issueCount = items.reduce((sum, item) => sum + (item.issue_count || 0), 0);
  const goLive = items.find(item => item.item_key === 'go_live_signoff');
  const requiredKeys = new Set(acquisitionRepo.ACQUISITION_ITEM_KEYS);
  const allRequiredPresent = acquisitionRepo.ACQUISITION_ITEM_KEYS.every(key => items.some(item => item.item_key === key));
  const operationalItemsReady = items
    .filter(item => requiredKeys.has(item.item_key) && item.item_key !== 'go_live_signoff')
    .every(item => READY_STATUSES.has(item.status));

  return {
    total,
    ready,
    complete,
    blocked,
    in_progress: inProgress,
    not_started: items.filter(item => item.status === 'not_started').length,
    issue_count: issueCount,
    readiness_percent: total > 0 ? Math.round((ready / total) * 100) : 0,
    go_live_signed_off: goLive?.status === 'complete',
    can_go_live: allRequiredPresent
      && operationalItemsReady
      && goLive?.status === 'complete'
      && blocked === 0
      && issueCount === 0,
  };
}

export async function listChecklist(home, filters = {}) {
  const items = await acquisitionRepo.findByHome(home.id, filters);
  return {
    items,
    summary: summarizeChecklist(items),
  };
}

export async function getChecklistItem(home, id) {
  const item = await acquisitionRepo.findById(id, home.id);
  if (!item) throw new NotFoundError('Acquisition onboarding item not found');
  return item;
}

export async function initializeChecklist(home, actor) {
  return withTransaction(async (client) => {
    const inserted = await acquisitionRepo.ensureDefaultItems(home.id, actorId(actor), client);
    const items = await acquisitionRepo.findByHome(home.id, {}, client);
    if (inserted.length > 0) {
      await auditService.log('acquisition_onboarding_initialize', home.slug, actorName(actor), {
        insertedKeys: inserted.map(item => item.item_key),
        total: items.length,
      }, client);
    }
    return {
      items,
      inserted,
      summary: summarizeChecklist(items),
    };
  });
}

export async function createChecklistItem(home, data, actor) {
  try {
    return await withTransaction(async (client) => {
      const payload = createPayloadWithDefaults(data);
      const item = await acquisitionRepo.create(home.id, payload, actorId(actor), client);
      await auditService.log('acquisition_onboarding_create', home.slug, actorName(actor), {
        id: item.id,
        item_key: item.item_key,
        status: item.status,
      }, client);
      return item;
    });
  } catch (err) {
    handleUniqueConflict(err);
  }
}

export async function updateChecklistItem(home, id, data, version, actor) {
  if (version == null) {
    throw new ValidationError('Version is required. Refresh and try again.');
  }
  return withTransaction(async (client) => {
    const existing = await acquisitionRepo.findById(id, home.id, client);
    if (!existing) throw new NotFoundError('Acquisition onboarding item not found');

    const updates = normalisePayload(data);
    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No fields to update');
    }

    const item = await acquisitionRepo.update(id, home.id, updates, version, actorId(actor), client);
    if (item === null) {
      throw new ConflictError('Record was modified by another user. Please refresh and try again.', 'VERSION_CONFLICT');
    }
    if (!item) throw new NotFoundError('Acquisition onboarding item not found');

    const changes = diffFields(existing, item, { extraSensitive: SENSITIVE_AUDIT_FIELDS });
    await auditService.log('acquisition_onboarding_update', home.slug, actorName(actor), {
      id: item.id,
      item_key: item.item_key,
      changes,
    }, client);
    return item;
  });
}

export async function deleteChecklistItem(home, id, version, actor) {
  if (version == null) {
    throw new ValidationError('Version is required. Refresh and try again.');
  }
  return withTransaction(async (client) => {
    const existing = await acquisitionRepo.findById(id, home.id, client);
    if (!existing) throw new NotFoundError('Acquisition onboarding item not found');

    const deleted = await acquisitionRepo.softDelete(id, home.id, actorId(actor), version, client);
    if (deleted === null) {
      throw new ConflictError('Record was modified by another user. Please refresh and try again.', 'VERSION_CONFLICT');
    }
    if (!deleted) throw new NotFoundError('Acquisition onboarding item not found');

    await auditService.log('acquisition_onboarding_delete', home.slug, actorName(actor), {
      id: existing.id,
      item_key: existing.item_key,
      status: existing.status,
    }, client);
    return deleted;
  });
}

export {
  ACQUISITION_ITEM_KEYS,
  ACQUISITION_STATUSES,
} from '../repositories/acquisitionRepo.js';
