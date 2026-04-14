import logger from '../logger.js';
import * as cqcEvidenceLinksRepo from '../repositories/cqcEvidenceLinksRepo.js';

function normaliseRecordedAt(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  return value;
}

function getSourceRecordedAt(module, record) {
  switch (module) {
    case 'incident':
    case 'complaint':
    case 'fire_drill':
    case 'supervision':
      return normaliseRecordedAt(record.date);
    case 'training_record':
      return normaliseRecordedAt(record.completed || record.updated_at || record.expiry);
    case 'maintenance':
      return normaliseRecordedAt(record.last_completed || record.next_due || record.updated_at);
    case 'ipc_audit':
      return normaliseRecordedAt(record.audit_date || record.reported_at || record.updated_at);
    case 'policy_review':
      return normaliseRecordedAt(record.last_reviewed || record.next_review_due || record.updated_at);
    case 'whistleblowing':
      return normaliseRecordedAt(record.resolution_date || record.date_raised || record.reported_at || record.updated_at);
    case 'cqc_evidence':
      return normaliseRecordedAt(record.date_to || record.date_from || record.added_at || record.created_at);
    case 'cqc_partner_feedback':
      return normaliseRecordedAt(record.feedback_date || record.added_at || record.created_at);
    case 'cqc_observation':
      return normaliseRecordedAt(record.observed_at || record.added_at || record.created_at);
    default:
      return normaliseRecordedAt(record.updated_at || record.created_at || record.date || null);
  }
}

export const AUTO_LINK_RULES = [
  {
    module: 'incident',
    condition: () => true,
    links: [
      { statement: 'S1', category: 'processes', rationale: 'Incident reporting demonstrates learning culture evidence' },
    ],
  },
  {
    module: 'incident',
    condition: (record) => record.type === 'fall' || record.type === 'slip_trip_fall',
    links: [
      { statement: 'S4', category: 'processes', rationale: 'Fall incident supports involving people to manage risks' },
      { statement: 'S5', category: 'processes', rationale: 'Fall incident supports safe environments evidence' },
    ],
  },
  {
    module: 'incident',
    condition: (record) => record.safeguarding_referral === true,
    links: [
      { statement: 'S3', category: 'processes', rationale: 'Safeguarding referral demonstrates safeguarding practice' },
    ],
  },
  {
    module: 'complaint',
    condition: (record) => record.status === 'resolved' || record.status === 'closed',
    links: [
      { statement: 'R4', category: 'peoples_experience', rationale: 'Resolved complaint demonstrates listening to and involving people' },
    ],
  },
  {
    module: 'fire_drill',
    condition: () => true,
    links: [
      { statement: 'S5', category: 'processes', rationale: 'Fire drill demonstrates safe environments and preparedness' },
    ],
  },
  {
    module: 'supervision',
    condition: () => true,
    links: [
      { statement: 'WL5', category: 'processes', rationale: 'Supervision demonstrates governance and management oversight' },
      { statement: 'E3', category: 'staff_leader_feedback', rationale: 'Supervision supports evidence of staff teams working together' },
    ],
  },
  {
    module: 'training_record',
    condition: (record) => record.training_type === 'safeguarding-adults' || record.training_type === 'safeguarding_adults',
    links: [
      { statement: 'S3', category: 'processes', rationale: 'Safeguarding training demonstrates safeguarding practice' },
    ],
  },
  {
    module: 'maintenance',
    condition: () => true,
    links: [
      { statement: 'S5', category: 'processes', rationale: 'Maintenance record supports safe environments evidence' },
    ],
  },
  {
    module: 'ipc_audit',
    condition: () => true,
    links: [
      { statement: 'S7', category: 'processes', rationale: 'IPC audit demonstrates infection prevention and control evidence' },
    ],
  },
  {
    module: 'policy_review',
    condition: () => true,
    links: [
      { statement: 'WL5', category: 'processes', rationale: 'Policy review demonstrates governance and management evidence' },
    ],
  },
  {
    module: 'whistleblowing',
    condition: () => true,
    links: [
      { statement: 'WL3', category: 'staff_leader_feedback', rationale: 'Whistleblowing concern demonstrates freedom to speak up evidence' },
    ],
  },
  {
    module: 'cqc_evidence',
    condition: (record) => Boolean(record.quality_statement && record.evidence_category),
    links: (record) => [
      {
        statement: record.quality_statement,
        category: record.evidence_category,
        rationale: record.title || 'Manual CQC evidence',
      },
    ],
  },
  {
    module: 'cqc_partner_feedback',
    condition: (record) => Boolean(record.quality_statement),
    links: (record) => [
      {
        statement: record.quality_statement,
        category: 'partner_feedback',
        rationale: record.summary || record.title || 'Partner feedback',
      },
    ],
  },
  {
    module: 'cqc_observation',
    condition: (record) => Boolean(record.quality_statement),
    links: (record) => [
      {
        statement: record.quality_statement,
        category: 'observation',
        rationale: record.notes || record.title || 'Observation',
      },
    ],
  },
];

export function buildAutoLinksForRecord(homeId, module, record, username = 'system') {
  if (!homeId || !module || !record?.id) return [];

  const sourceRecordedAt = getSourceRecordedAt(module, record);
  const matches = AUTO_LINK_RULES.filter((rule) => rule.module === module && rule.condition(record));

  return matches.flatMap((rule) => {
    const links = typeof rule.links === 'function' ? rule.links(record) : rule.links;
    return links.map((link) => ({
      source_module: module,
      source_id: String(record.id),
      quality_statement: link.statement,
      evidence_category: link.category,
      rationale: link.rationale || null,
      auto_linked: true,
      requires_review: true,
      linked_by: username || 'system',
      source_recorded_at: sourceRecordedAt,
    }));
  });
}

function linkKeyFromSource(qualityStatement, evidenceCategory) {
  return `${qualityStatement}::${evidenceCategory}`;
}

function linkKey(link) {
  return linkKeyFromSource(link.quality_statement, link.evidence_category);
}

function existingLinkKey(link) {
  return linkKeyFromSource(link.qualityStatement, link.evidenceCategory);
}

export async function syncAutoLinksForRecord(homeId, module, record, username = 'system', client = null) {
  if (!homeId || !module || !record?.id) return [];

  const conn = client || undefined;
  const desiredLinks = buildAutoLinksForRecord(homeId, module, record, username);
  const desiredByKey = new Map(desiredLinks.map((link) => [linkKey(link), link]));
  const existingLinks = await cqcEvidenceLinksRepo.findBySource(homeId, module, String(record.id), conn);

  for (const existing of existingLinks) {
    if (!existing.autoLinked) continue;
    if (desiredByKey.has(existingLinkKey(existing))) continue;
    await cqcEvidenceLinksRepo.softDelete(existing.id, homeId, conn);
  }

  const linksToCreate = [];
  for (const desired of desiredLinks) {
    const existing = existingLinks.find((link) => existingLinkKey(link) === linkKey(desired));
    if (!existing) {
      linksToCreate.push(desired);
      continue;
    }
    if (!existing.autoLinked) continue;

    const needsUpdate =
      (existing.rationale || null) !== (desired.rationale || null) ||
      (existing.sourceRecordedAt || null) !== (desired.source_recorded_at || null) ||
      existing.requiresReview !== true ||
      existing.linkedBy !== (username || 'system');

    if (!needsUpdate) continue;

    await cqcEvidenceLinksRepo.updateLink(existing.id, homeId, {
      rationale: desired.rationale || null,
      requires_review: true,
      source_recorded_at: desired.source_recorded_at || null,
    }, null, conn);
  }

  if (linksToCreate.length === 0) {
    return cqcEvidenceLinksRepo.findBySource(homeId, module, String(record.id), conn);
  }

  await cqcEvidenceLinksRepo.createBulkLinks(homeId, linksToCreate, conn);
  return cqcEvidenceLinksRepo.findBySource(homeId, module, String(record.id), conn);
}

export async function autoLinkRecord(homeId, module, record, username = 'system', client = null) {
  return syncAutoLinksForRecord(homeId, module, record, username, client);
}

export function queueAutoLinkSync(homeId, module, record, username = 'system') {
  void syncAutoLinksForRecord(homeId, module, record, username).catch((err) => {
    logger.warn({ err, homeId, module, sourceId: record?.id }, 'CQC auto-link sync failed');
  });
}
