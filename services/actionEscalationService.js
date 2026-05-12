import { calculateEscalationLevel } from '../lib/actionItems.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';
import * as auditService from './auditService.js';
import logger from '../logger.js';

export async function escalateOverdueActionItems({ today = new Date(), audit = true } = {}) {
  const candidates = await actionItemRepo.findEscalationCandidates(today);
  let escalated = 0;
  const auditEntries = [];

  for (const item of candidates) {
    const nextLevel = calculateEscalationLevel({
      dueDate: item.due_date,
      status: item.status,
      priority: item.priority,
      today,
    });

    if (nextLevel <= (item.escalation_level || 0)) continue;

    await actionItemRepo.setEscalationLevel(item.id, item.home_id, nextLevel);
    escalated += 1;

    if (audit) {
      auditEntries.push({
        action: 'action_item_escalate',
        homeSlug: item.home_slug,
        username: 'system',
        details: {
          id: item.id,
          previousLevel: item.escalation_level || 0,
          nextLevel,
          dueDate: item.due_date,
          priority: item.priority,
        },
      });
    }
  }

  if (auditEntries.length > 0) {
    await auditService.bulkLog(auditEntries);
  }

  if (escalated > 0) {
    logger.info({ escalated }, 'Action item escalation pass complete');
  }

  return { scanned: candidates.length, escalated };
}
