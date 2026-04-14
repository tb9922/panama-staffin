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
    case 'maintenance':
      return normaliseRecordedAt(record.last_completed || record.next_due || record.updated_at);
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
    module: 'maintenance',
    condition: () => true,
    links: [
      { statement: 'S5', category: 'processes', rationale: 'Maintenance record supports safe environments evidence' },
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

export async function autoLinkRecord(homeId, module, record, username = 'system', client = null) {
  const links = buildAutoLinksForRecord(homeId, module, record, username);
  if (links.length === 0) return [];
  return cqcEvidenceLinksRepo.createBulkLinks(homeId, links, client || undefined);
}
