import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../repositories/cqcEvidenceFileRepo.js';

const PAGE_SIZE = 500;
const FILE_PAGE_SIZE = 2000;

async function loadAllEvidence(homeId) {
  const rows = [];
  let offset = 0;
  let total = null;

  while (total == null || rows.length < total) {
    const page = await cqcEvidenceRepo.findByHome(homeId, { limit: PAGE_SIZE, offset });
    rows.push(...page.rows);
    total = page.total;
    if (!page.rows.length) break;
    offset += page.rows.length;
  }

  return rows;
}

async function loadAllEvidenceFiles(homeId) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await cqcEvidenceFileRepo.findByHome(homeId, { limit: FILE_PAGE_SIZE, offset });
    rows.push(...page);
    if (page.length < FILE_PAGE_SIZE) break;
    offset += page.length;
  }

  return rows;
}

export async function getCqcDocs(homeId) {
  const [evidenceRows, files] = await Promise.all([
    loadAllEvidence(homeId),
    loadAllEvidenceFiles(homeId),
  ]);

  const filesByEvidence = new Map();
  for (const file of files) {
    const bucket = filesByEvidence.get(file.evidence_id) || [];
    bucket.push(file);
    filesByEvidence.set(file.evidence_id, bucket);
  }

  const evidence = evidenceRows.map((item) => {
    const docs = filesByEvidence.get(item.id) || [];
    return {
      ...item,
      attachment_count: docs.length,
      latest_attachment: docs[0] || null,
      overdue_review: Boolean(item.review_due && new Date(`${item.review_due}T00:00:00Z`).getTime() < Date.now()),
      missing_attachment: docs.length === 0,
      missing_owner: !item.evidence_owner,
    };
  });

  const countBy = (items, keyFn) => {
    const buckets = new Map();
    for (const item of items) {
      const key = keyFn(item);
      const bucket = buckets.get(key) || { key, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  };

  return {
    summary: {
      total_documents: files.length,
      missing_owner_count: evidence.filter((item) => item.missing_owner).length,
      overdue_review_count: evidence.filter((item) => item.overdue_review).length,
      missing_attachment_count: evidence.filter((item) => item.missing_attachment).length,
    },
    evidence,
    byStatement: countBy(evidence, (item) => item.quality_statement),
    byCategory: countBy(evidence, (item) => item.evidence_category || 'uncategorised'),
    byOwner: countBy(evidence, (item) => item.evidence_owner || 'unassigned'),
  };
}
