import { describe, expect, it } from 'vitest';
import {
  calculateEscalationLevel,
  daysPastDue,
  normalizeLegacyStatus,
} from '../../lib/actionItems.js';

const TODAY = new Date('2026-04-26T12:00:00Z');

describe('action item helpers', () => {
  it('normalizes legacy action statuses into the V1 workflow', () => {
    expect(normalizeLegacyStatus('pending')).toBe('open');
    expect(normalizeLegacyStatus('open')).toBe('open');
    expect(normalizeLegacyStatus('overdue')).toBe('open');
    expect(normalizeLegacyStatus('in_progress')).toBe('in_progress');
    expect(normalizeLegacyStatus('completed')).toBe('completed');
    expect(normalizeLegacyStatus('cancelled')).toBe('cancelled');
  });

  it('calculates whole days past due using date-only semantics', () => {
    expect(daysPastDue('2026-04-26', TODAY)).toBe(0);
    expect(daysPastDue('2026-04-25', TODAY)).toBe(1);
    expect(daysPastDue('2026-04-20', TODAY)).toBe(6);
    expect(daysPastDue('2026-04-27', TODAY)).toBe(-1);
  });

  it('applies the V1 escalation cadence', () => {
    expect(calculateEscalationLevel({ dueDate: '2026-04-27', today: TODAY })).toBe(0);
    expect(calculateEscalationLevel({ dueDate: '2026-04-26', today: TODAY })).toBe(1);
    expect(calculateEscalationLevel({ dueDate: '2026-04-24', today: TODAY })).toBe(2);
    expect(calculateEscalationLevel({ dueDate: '2026-04-21', today: TODAY })).toBe(3);
    expect(calculateEscalationLevel({ dueDate: '2026-04-17', today: TODAY })).toBe(4);
  });

  it('escalates critical priority one level faster and caps at L4', () => {
    expect(calculateEscalationLevel({ dueDate: '2026-04-26', priority: 'critical', today: TODAY })).toBe(2);
    expect(calculateEscalationLevel({ dueDate: '2026-04-24', priority: 'critical', today: TODAY })).toBe(3);
    expect(calculateEscalationLevel({ dueDate: '2026-04-17', priority: 'critical', today: TODAY })).toBe(4);
  });

  it('does not escalate closed actions', () => {
    expect(calculateEscalationLevel({ dueDate: '2026-04-17', status: 'completed', today: TODAY })).toBe(0);
    expect(calculateEscalationLevel({ dueDate: '2026-04-17', status: 'verified', today: TODAY })).toBe(0);
    expect(calculateEscalationLevel({ dueDate: '2026-04-17', status: 'cancelled', today: TODAY })).toBe(0);
  });
});
