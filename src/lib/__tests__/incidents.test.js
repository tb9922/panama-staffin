import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isCqcNotificationOverdue,
  isRiddorOverdue,
  isDutyOfCandourOverdue,
  getCqcNotificationDeadline,
} from '../incidents.js';

// ── Time helpers ──────────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

function setNow(isoString) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoString));
}

// ── isCqcNotificationOverdue ──────────────────────────────────────────────────

describe('isCqcNotificationOverdue', () => {
  it('returns false when cqc_notifiable is false', () => {
    const incident = { cqc_notifiable: false, date: '2025-01-01', cqc_notification_deadline: 'immediate' };
    expect(isCqcNotificationOverdue(incident)).toBe(false);
  });

  it('returns false when already notified', () => {
    const incident = {
      cqc_notifiable: true,
      cqc_notified: true,
      cqc_notified_date: '2025-01-01',
      date: '2025-01-01',
      cqc_notification_deadline: 'immediate',
    };
    expect(isCqcNotificationOverdue(incident)).toBe(false);
  });

  it('returns false when no date provided', () => {
    const incident = { cqc_notifiable: true, cqc_notification_deadline: 'immediate' };
    expect(isCqcNotificationOverdue(incident)).toBe(false);
  });

  it('returns true for "immediate" (24h) deadline when 25 hours have passed', () => {
    // Incident at 2025-06-01 09:00, now 25 hours later
    setNow('2025-06-02T10:00:00Z');
    const incident = {
      cqc_notifiable: true,
      cqc_notified: false,
      date: '2025-06-01',
      time: '09:00',
      cqc_notification_deadline: 'immediate',
    };
    expect(isCqcNotificationOverdue(incident)).toBe(true);
  });

  it('returns false for "immediate" (24h) deadline when 23 hours have passed', () => {
    setNow('2025-06-02T08:00:00Z');
    const incident = {
      cqc_notifiable: true,
      cqc_notified: false,
      date: '2025-06-01',
      time: '09:00',
      cqc_notification_deadline: 'immediate',
    };
    expect(isCqcNotificationOverdue(incident)).toBe(false);
  });

  it('returns true for 72h deadline when 73 hours have passed', () => {
    setNow('2025-06-04T10:00:00Z'); // 73 hours after 2025-06-01 09:00
    const incident = {
      cqc_notifiable: true,
      cqc_notified: false,
      date: '2025-06-01',
      time: '09:00',
      cqc_notification_deadline: '72h',
    };
    expect(isCqcNotificationOverdue(incident)).toBe(true);
  });

  it('returns false for 72h deadline when 71 hours have passed', () => {
    setNow('2025-06-04T08:00:00Z'); // 71 hours after 2025-06-01 09:00
    const incident = {
      cqc_notifiable: true,
      cqc_notified: false,
      date: '2025-06-01',
      time: '09:00',
      cqc_notification_deadline: '72h',
    };
    expect(isCqcNotificationOverdue(incident)).toBe(false);
  });

  it('defaults to time 00:00 when no time provided', () => {
    setNow('2025-06-02T01:00:00Z'); // 25 hours after midnight 2025-06-01
    const incident = {
      cqc_notifiable: true,
      cqc_notified: false,
      date: '2025-06-01',
      // no time
      cqc_notification_deadline: 'immediate',
    };
    expect(isCqcNotificationOverdue(incident)).toBe(true);
  });
});

// ── getCqcNotificationDeadline ────────────────────────────────────────────────

describe('getCqcNotificationDeadline', () => {
  it('returns hoursAllowed=24 for immediate deadline', () => {
    const incident = {
      cqc_notifiable: true,
      date: '2025-06-01',
      time: '09:00',
      cqc_notification_deadline: 'immediate',
    };
    const { hoursAllowed } = getCqcNotificationDeadline(incident);
    expect(hoursAllowed).toBe(24);
  });

  it('returns hoursAllowed=72 for 72h deadline', () => {
    const incident = {
      cqc_notifiable: true,
      date: '2025-06-01',
      time: '09:00',
      cqc_notification_deadline: '72h',
    };
    const { hoursAllowed } = getCqcNotificationDeadline(incident);
    expect(hoursAllowed).toBe(72);
  });

  it('returns null deadline when not CQC notifiable', () => {
    const incident = { cqc_notifiable: false };
    const result = getCqcNotificationDeadline(incident);
    expect(result.deadline).toBeNull();
  });
});

// ── isRiddorOverdue ───────────────────────────────────────────────────────────

describe('isRiddorOverdue', () => {
  it('returns false when not RIDDOR reportable', () => {
    const inc = { riddor_reportable: false, date: '2025-01-01', riddor_category: 'death' };
    expect(isRiddorOverdue(inc)).toBe(false);
  });

  it('returns false when already reported', () => {
    const inc = { riddor_reportable: true, riddor_reported: true, date: '2020-01-01', riddor_category: 'death' };
    expect(isRiddorOverdue(inc)).toBe(false);
  });

  it('returns false when no date provided', () => {
    const inc = { riddor_reportable: true, riddor_category: 'death' };
    expect(isRiddorOverdue(inc)).toBe(false);
  });

  it('returns false when riddor_category is unknown', () => {
    const inc = { riddor_reportable: true, date: '2020-01-01', riddor_category: 'unknown_category' };
    expect(isRiddorOverdue(inc)).toBe(false);
  });

  it('returns true for death (immediate) when 2 days have passed', () => {
    // death deadline = day + 1 (immediate = end of next day)
    setNow('2025-06-03T12:00:00Z'); // 2 days after incident
    const inc = {
      riddor_reportable: true,
      riddor_reported: false,
      date: '2025-06-01',
      riddor_category: 'death',
    };
    expect(isRiddorOverdue(inc)).toBe(true);
  });

  it('returns false for death (immediate) when only 12 hours have passed', () => {
    setNow('2025-06-01T12:00:00Z'); // same day
    const inc = {
      riddor_reportable: true,
      riddor_reported: false,
      date: '2025-06-01',
      riddor_category: 'death',
    };
    expect(isRiddorOverdue(inc)).toBe(false);
  });

  it('returns true for over_7_day when 16 calendar days have passed', () => {
    // over_7_day deadlineDays = 15 — deadline is exactly day 15
    setNow('2025-06-17T12:00:00Z'); // 16 days after June 1
    const inc = {
      riddor_reportable: true,
      riddor_reported: false,
      date: '2025-06-01',
      riddor_category: 'over_7_day',
    };
    expect(isRiddorOverdue(inc)).toBe(true);
  });

  it('returns false for over_7_day when 14 calendar days have passed', () => {
    setNow('2025-06-15T12:00:00Z'); // 14 days after June 1
    const inc = {
      riddor_reportable: true,
      riddor_reported: false,
      date: '2025-06-01',
      riddor_category: 'over_7_day',
    };
    expect(isRiddorOverdue(inc)).toBe(false);
  });
});

// ── isDutyOfCandourOverdue ────────────────────────────────────────────────────

describe('isDutyOfCandourOverdue', () => {
  it('returns false when duty_of_candour_applies is false', () => {
    const inc = { duty_of_candour_applies: false, date: '2020-01-01' };
    expect(isDutyOfCandourOverdue(inc)).toBe(false);
  });

  it('returns false when candour_notification_date is set', () => {
    const inc = {
      duty_of_candour_applies: true,
      candour_notification_date: '2025-01-05',
      date: '2025-01-01',
    };
    expect(isDutyOfCandourOverdue(inc)).toBe(false);
  });

  it('returns false when no date provided', () => {
    const inc = { duty_of_candour_applies: true };
    expect(isDutyOfCandourOverdue(inc)).toBe(false);
  });

  it('returns true when 15 calendar days have passed without notification', () => {
    // DoC deadline = 14 calendar days (10 working days approximation)
    setNow('2025-06-16T12:00:00Z'); // 15 days after June 1
    const inc = {
      duty_of_candour_applies: true,
      date: '2025-06-01',
      candour_notification_date: null,
    };
    expect(isDutyOfCandourOverdue(inc)).toBe(true);
  });

  it('returns false when 13 calendar days have passed', () => {
    setNow('2025-06-14T12:00:00Z'); // 13 days after June 1
    const inc = {
      duty_of_candour_applies: true,
      date: '2025-06-01',
      candour_notification_date: null,
    };
    expect(isDutyOfCandourOverdue(inc)).toBe(false);
  });
});
