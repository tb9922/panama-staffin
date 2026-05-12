import * as auditRepo from '../repositories/auditRepo.js';
import logger from '../logger.js';

export async function log(action, homeSlug, username, details, client) {
  if (client) {
    // Inside a transaction — propagate errors so the caller's transaction rolls back.
    await auditRepo.log(action, homeSlug, username, details, client);
  } else {
    try {
      await auditRepo.log(action, homeSlug, username, details);
    } catch (err) {
      // Audit failures must never block the primary operation outside a transaction.
      logger.error({ action, homeSlug, username, err: err.message }, 'audit write failure');
    }
  }
}

export async function bulkLog(entries, client) {
  if (!entries?.length) return 0;
  if (client) return auditRepo.bulkLog(entries, client);
  try {
    return await auditRepo.bulkLog(entries);
  } catch (err) {
    logger.error({ count: entries.length, err: err.message }, 'audit bulk write failure');
    return 0;
  }
}

export async function getRecent(limit = 100, homeSlug) {
  if (homeSlug) return auditRepo.getByHome(homeSlug, limit);
  return auditRepo.getRecent(limit);
}

export async function getRecentForSlugs(limit = 100, slugs) {
  return auditRepo.getByHomeSlugs(slugs, limit);
}

export async function search(filters) {
  return auditRepo.search(filters);
}

export async function purgeOlderThan(days, homeSlug) {
  return auditRepo.purgeOlderThan(days, homeSlug);
}
