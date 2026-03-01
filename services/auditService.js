import * as auditRepo from '../repositories/auditRepo.js';

export async function log(action, homeSlug, username, details) {
  try {
    await auditRepo.log(action, homeSlug, username, details);
  } catch (err) {
    // Audit failures must never block the primary operation.
    // Log to stderr so ops can detect persistent audit outages.
    console.error('[AUDIT FAILURE]', { action, homeSlug, username, error: err.message });
  }
}

export async function getRecent(limit = 100, homeSlug) {
  if (homeSlug) return auditRepo.getByHome(homeSlug, limit);
  return auditRepo.getRecent(limit);
}

export async function getRecentForSlugs(limit = 100, slugs) {
  return auditRepo.getByHomeSlugs(slugs, limit);
}

export async function purgeOlderThan(days, homeSlug) {
  return auditRepo.purgeOlderThan(days, homeSlug);
}
