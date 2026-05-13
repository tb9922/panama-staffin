import { calculateEscalationLevel } from '../lib/actionItems.js';
import { todayLocalISO } from '../lib/dateOnly.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';
import * as auditService from './auditService.js';
import logger from '../logger.js';

export async function escalateOverdueActionItems({ today = todayLocalISO(), audit = true } = {}) {
  const todayIso = typeof today === 'string' ? today.slice(0, 10) : todayLocalISO(today);
  const candidates = await actionItemRepo.findEscalationCandidates(todayIso);
  let escalated = 0;
  const auditEntries = [];
  const levelChanges = [];

  for (const item of candidates) {
    const nextLevel = calculateEscalationLevel({
      dueDate: item.due_date,
      status: item.status,
      priority: item.priority,
      today: todayIso,
    });

    if (nextLevel <= (item.escalation_level || 0)) continue;

    levelChanges.push({ id: item.id, homeId: item.home_id, level: nextLevel });
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

  if (levelChanges.length > 0) {
    await actionItemRepo.setEscalationLevels(levelChanges);
  }

  if (auditEntries.length > 0) {
    await auditService.bulkLog(auditEntries);
  }

  if (escalated > 0) {
    logger.info({ escalated }, 'Action item escalation pass complete');
  }

  return { scanned: candidates.length, escalated };
}
