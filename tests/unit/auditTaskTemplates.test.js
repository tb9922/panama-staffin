import { describe, expect, it } from 'vitest';
import { buildAuditTasksForRange } from '../../lib/auditTaskTemplates.js';

describe('audit task templates', () => {
  it('generates daily, weekly, monthly, quarterly and annual tasks for a range', () => {
    const tasks = buildAuditTasksForRange({ from: '2026-04-01', to: '2026-04-07' });
    const keys = new Set(tasks.map(task => task.template_key));

    expect(keys.has('daily_mar_check')).toBe(true);
    expect(keys.has('weekly_ipc_walkaround')).toBe(true);
    expect(keys.has('monthly_medication_audit')).toBe(true);
    expect(keys.has('quarterly_governance_review')).toBe(true);
    expect(keys.has('annual_fire_safety_review')).toBe(true);

    const dailyMar = tasks.filter(task => task.template_key === 'daily_mar_check');
    expect(dailyMar).toHaveLength(7);
    expect(dailyMar[0]).toMatchObject({
      period_start: '2026-04-01',
      period_end: '2026-04-01',
      due_date: '2026-04-01',
    });
  });

  it('returns no tasks for invalid ranges', () => {
    expect(buildAuditTasksForRange({ from: '2026-04-08', to: '2026-04-07' })).toEqual([]);
    expect(buildAuditTasksForRange({ from: '', to: '2026-04-07' })).toEqual([]);
  });
});
