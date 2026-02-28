import * as auditRepo from '../repositories/auditRepo.js';

export async function log(action, homeSlug, username, details) {
  await auditRepo.log(action, homeSlug, username, details);
}

export async function getRecent(limit = 100, homeSlug) {
  if (homeSlug) return auditRepo.getByHome(homeSlug, limit);
  return auditRepo.getRecent(limit);
}

export async function purgeOlderThan(days, homeSlug) {
  return auditRepo.purgeOlderThan(days, homeSlug);
}
