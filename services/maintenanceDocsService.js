import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
import * as recordAttachmentsRepo from '../repositories/recordAttachments.js';
import { getMaintenanceStatus, DEFAULT_MAINTENANCE_CATEGORIES } from '../shared/maintenance.js';

const PAGE_SIZE = 500;
const ATTACHMENT_PAGE_SIZE = 2000;
const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;
const CONTRACTOR_EVIDENCE_GAP_MIN_CHECKS = 3;

function normalizeContractorName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function attachmentTime(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function loadAllChecks(homeId) {
  const rows = [];
  let offset = 0;
  let total = null;

  while (total == null || rows.length < total) {
    const page = await maintenanceRepo.findByHome(homeId, { limit: PAGE_SIZE, offset });
    rows.push(...page.rows);
    total = page.total;
    if (!page.rows.length) break;
    offset += page.rows.length;
  }

  return rows;
}

async function loadAllAttachments(homeId) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await recordAttachmentsRepo.findByHome(
      homeId,
      { moduleId: 'maintenance', limit: ATTACHMENT_PAGE_SIZE, offset },
    );
    rows.push(...page);
    if (page.length < ATTACHMENT_PAGE_SIZE) break;
    offset += page.length;
  }

  return rows;
}

export async function getMaintenanceDocs(homeId, homeConfig) {
  const [checkRows, attachments] = await Promise.all([
    loadAllChecks(homeId),
    loadAllAttachments(homeId),
  ]);
  const categories = homeConfig?.maintenance_categories?.length
    ? homeConfig.maintenance_categories
    : DEFAULT_MAINTENANCE_CATEGORIES;
  const categoryNames = Object.fromEntries(categories.map((category) => [category.id, category.name]));

  const attachmentCountByRecord = new Map();
  const latestAttachmentByRecord = new Map();
  for (const attachment of attachments) {
    const key = String(attachment.record_id);
    attachmentCountByRecord.set(key, (attachmentCountByRecord.get(key) || 0) + 1);
    const previous = latestAttachmentByRecord.get(key);
    if (!previous || attachmentTime(attachment.created_at) > attachmentTime(previous.created_at)) {
      latestAttachmentByRecord.set(key, attachment);
    }
  }

  const checks = checkRows.map((check) => {
    const status = getMaintenanceStatus(check);
    const attachmentCount = attachmentCountByRecord.get(String(check.id)) || 0;
    const contractor = normalizeContractorName(check.contractor);
    return {
      ...check,
      category_name: categoryNames[check.category] || check.category,
      contractor,
      attachment_count: attachmentCount,
      latest_attachment: latestAttachmentByRecord.get(String(check.id)) || null,
      status,
      missing_evidence: attachmentCount === 0 && ['due_soon', 'overdue'].includes(status.status),
      certificate_expiring: Boolean(
        check.certificate_expiry &&
        new Date(`${check.certificate_expiry}T00:00:00Z`).getTime() <= Date.now() + (CERTIFICATE_EXPIRY_WARNING_DAYS * 86400000)
      ),
    };
  });

  const checksByCategory = new Map();
  for (const check of checks) {
    const bucket = checksByCategory.get(check.category) || [];
    bucket.push(check);
    checksByCategory.set(check.category, bucket);
  }

  const byCategory = categories.map((category) => {
    const items = checksByCategory.get(category.id) || [];
    return {
      id: category.id,
      name: category.name,
      attachment_count: items.reduce((sum, item) => sum + item.attachment_count, 0),
      missing_evidence_count: items.filter((item) => item.missing_evidence).length,
      expiring_count: items.filter((item) => item.certificate_expiring).length,
      checks: items.length,
    };
  });

  const contractorBuckets = new Map();
  for (const check of checks) {
    if (!check.contractor) continue;
    const bucket = contractorBuckets.get(check.contractor) || {
      contractor: check.contractor,
      checks: 0,
      attachment_count: 0,
      evidence_gap: false,
    };
    bucket.checks += 1;
    bucket.attachment_count += check.attachment_count;
    contractorBuckets.set(check.contractor, bucket);
  }
  const byContractor = [...contractorBuckets.values()]
    .map((bucket) => ({
      ...bucket,
      evidence_gap: bucket.checks >= CONTRACTOR_EVIDENCE_GAP_MIN_CHECKS && bucket.attachment_count === 0,
    }))
    .sort((a, b) => a.contractor.localeCompare(b.contractor));

  return {
    summary: {
      total_checks: checks.length,
      missing_evidence_count: checks.filter((check) => check.missing_evidence).length,
      expiring_count: checks.filter((check) => check.certificate_expiring).length,
      overdue_count: checks.filter((check) => check.status.status === 'overdue').length,
    },
    checks,
    byCategory,
    byContractor,
  };
}
