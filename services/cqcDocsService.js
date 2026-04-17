import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../repositories/cqcEvidenceFileRepo.js';

export async function getCqcDocs(homeId) {
  const [evidenceResult, files] = await Promise.all([
    cqcEvidenceRepo.findByHome(homeId, { limit: 2000, offset: 0 }),
    cqcEvidenceFileRepo.findByHome(homeId),
  ]);

  const filesByEvidence = new Map();
  for (const file of files) {
    const bucket = filesByEvidence.get(file.evidence_id) || [];
    bucket.push(file);
    filesByEvidence.set(file.evidence_id, bucket);
  }

  const evidence = evidenceResult.rows.map((item) => {
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
