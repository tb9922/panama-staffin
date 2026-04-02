/**
 * Unit tests for HR field mapping functions and diffFields helper.
 *
 * These functions translate frontend field aliases to DB column names,
 * and strip ghost fields that have no backing DB column.
 *
 * Imported from lib/hrFieldMappers.js — a zero-dependency module,
 * so no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
  mapDisciplinaryFields, mapGrievanceFields, mapPerformanceFields,
  mapRtwFields, mapOhFields, mapContractFields, mapFamilyLeaveFields,
  mapFlexFields, mapEdiFields, mapTupeFields, mapRenewalFields, normalizeRtwDocumentType,
  diffFields,
} from '../../lib/hrFieldMappers.js';

// ── mapDisciplinaryFields ────────────────────────────────────────────────────

describe('mapDisciplinaryFields', () => {
  it('renames outcome_notes to outcome_reason', () => {
    const result = mapDisciplinaryFields({ outcome_notes: 'Bad conduct', status: 'open' });
    expect(result.outcome_reason).toBe('Bad conduct');
    expect(result.outcome_notes).toBeUndefined();
    expect(result.status).toBe('open');
  });

  it('renames appeal_date to appeal_received_date', () => {
    const result = mapDisciplinaryFields({ appeal_date: '2026-01-15' });
    expect(result.appeal_received_date).toBe('2026-01-15');
    expect(result.appeal_date).toBeUndefined();
  });

  it('does not overwrite existing outcome_reason', () => {
    const result = mapDisciplinaryFields({ outcome_notes: 'alias', outcome_reason: 'canonical' });
    expect(result.outcome_reason).toBe('canonical');
    expect(result.outcome_notes).toBe('alias');
  });

  it('passes through unknown fields unchanged', () => {
    const result = mapDisciplinaryFields({ category: 'misconduct', custom: 'value' });
    expect(result.category).toBe('misconduct');
    expect(result.custom).toBe('value');
  });

  it('returns new object (no mutation)', () => {
    const input = { outcome_notes: 'test' };
    const result = mapDisciplinaryFields(input);
    expect(input.outcome_notes).toBe('test');
    expect(result).not.toBe(input);
  });
});

// ── mapGrievanceFields ───────────────────────────────────────────────────────

describe('mapGrievanceFields', () => {
  it('renames description to subject_summary', () => {
    const result = mapGrievanceFields({ description: 'Unfair treatment' });
    expect(result.subject_summary).toBe('Unfair treatment');
    expect(result.description).toBeUndefined();
  });

  it('does not overwrite existing subject_summary', () => {
    const result = mapGrievanceFields({ description: 'alias', subject_summary: 'canonical' });
    expect(result.subject_summary).toBe('canonical');
    expect(result.description).toBe('alias');
  });

  it('passes through fields without aliases', () => {
    const result = mapGrievanceFields({ status: 'open', staff_id: 5 });
    expect(result.status).toBe('open');
    expect(result.staff_id).toBe(5);
  });
});

// ── mapPerformanceFields ─────────────────────────────────────────────────────

describe('mapPerformanceFields', () => {
  it('renames description to concern_summary', () => {
    const result = mapPerformanceFields({ description: 'Poor timekeeping' });
    expect(result.concern_summary).toBe('Poor timekeeping');
    expect(result.description).toBeUndefined();
  });

  it('renames informal_notes to informal_discussion_notes', () => {
    const result = mapPerformanceFields({ informal_notes: 'Discussed verbally' });
    expect(result.informal_discussion_notes).toBe('Discussed verbally');
    expect(result.informal_notes).toBeUndefined();
  });

  it('renames appeal_date to appeal_received_date', () => {
    const result = mapPerformanceFields({ appeal_date: '2026-03-01' });
    expect(result.appeal_received_date).toBe('2026-03-01');
  });

  it('strips ghost fields: manager and pip_review_dates', () => {
    const result = mapPerformanceFields({ manager: 'Jane', pip_review_dates: ['2026-01-01'], status: 'open' });
    expect(result.manager).toBeUndefined();
    expect(result.pip_review_dates).toBeUndefined();
    expect(result.status).toBe('open');
  });
});

// ── mapRtwFields ─────────────────────────────────────────────────────────────

describe('mapRtwFields', () => {
  it('renames conducted_by to rtw_conducted_by', () => {
    const result = mapRtwFields({ conducted_by: 'Manager A' });
    expect(result.rtw_conducted_by).toBe('Manager A');
    expect(result.conducted_by).toBeUndefined();
  });

  it('renames fit_for_work to fit_to_return', () => {
    const result = mapRtwFields({ fit_for_work: true });
    expect(result.fit_to_return).toBe(true);
  });

  it('splits adjustments into adjustments_needed (bool) and adjustments_detail (string)', () => {
    const result = mapRtwFields({ adjustments: 'Reduced hours for 2 weeks' });
    expect(result.adjustments_needed).toBe(true);
    expect(result.adjustments_detail).toBe('Reduced hours for 2 weeks');
    expect(result.adjustments).toBeUndefined();
  });

  it('adjustments_needed is false for empty/falsy adjustments', () => {
    const result = mapRtwFields({ adjustments: '' });
    expect(result.adjustments_needed).toBe(false);
    expect(result.adjustments_detail).toBe('');
  });

  it('renames referral_needed to oh_referral_recommended', () => {
    const result = mapRtwFields({ referral_needed: true });
    expect(result.oh_referral_recommended).toBe(true);
  });
});

// ── mapOhFields ──────────────────────────────────────────────────────────────

describe('mapOhFields', () => {
  it('renames provider to oh_provider', () => {
    const result = mapOhFields({ provider: 'Medigold' });
    expect(result.oh_provider).toBe('Medigold');
    expect(result.provider).toBeUndefined();
  });

  it('renames report_date to report_received_date', () => {
    const result = mapOhFields({ report_date: '2026-02-20' });
    expect(result.report_received_date).toBe('2026-02-20');
  });

  it('renames recommendations to adjustments_recommended', () => {
    const result = mapOhFields({ recommendations: 'Light duties' });
    expect(result.adjustments_recommended).toBe('Light duties');
  });

  it('strips ghost field: report_received', () => {
    const result = mapOhFields({ report_received: true, status: 'pending' });
    expect(result.report_received).toBeUndefined();
    expect(result.status).toBe('pending');
  });
});

// ── mapContractFields ────────────────────────────────────────────────────────

describe('mapContractFields', () => {
  it('renames start_date to contract_start_date', () => {
    const result = mapContractFields({ start_date: '2026-01-01' });
    expect(result.contract_start_date).toBe('2026-01-01');
    expect(result.start_date).toBeUndefined();
  });

  it('renames end_date to contract_end_date', () => {
    const result = mapContractFields({ end_date: '2027-01-01' });
    expect(result.contract_end_date).toBe('2027-01-01');
  });

  it('strips ghost fields: salary, notice_period_weeks, signed_date', () => {
    const result = mapContractFields({ salary: 30000, notice_period_weeks: 4, signed_date: '2026-01-01', contract_type: 'permanent' });
    expect(result.salary).toBeUndefined();
    expect(result.notice_period_weeks).toBeUndefined();
    expect(result.signed_date).toBeUndefined();
    expect(result.contract_type).toBe('permanent');
  });
});

// ── mapFamilyLeaveFields ─────────────────────────────────────────────────────

describe('mapFamilyLeaveFields', () => {
  it('renames leave_type to type', () => {
    const result = mapFamilyLeaveFields({ leave_type: 'maternity' });
    expect(result.type).toBe('maternity');
    expect(result.leave_type).toBeUndefined();
  });

  it('renames all date fields', () => {
    const result = mapFamilyLeaveFields({
      start_date: '2026-06-01',
      end_date: '2027-06-01',
      expected_return: '2027-06-02',
      actual_return: '2027-05-15',
    });
    expect(result.leave_start_date).toBe('2026-06-01');
    expect(result.leave_end_date).toBe('2027-06-01');
    expect(result.expected_return_date).toBe('2027-06-02');
    expect(result.actual_return_date).toBe('2027-05-15');
  });

  it('renames kit_days_used to kit_days', () => {
    const result = mapFamilyLeaveFields({ kit_days_used: 5 });
    expect(result.kit_days).toBe(5);
  });

  it('renames pay_type to statutory_pay_type', () => {
    const result = mapFamilyLeaveFields({ pay_type: 'SMP' });
    expect(result.statutory_pay_type).toBe('SMP');
  });
});

// ── mapFlexFields ────────────────────────────────────────────────────────────

describe('mapFlexFields', () => {
  it('maps statutory refusal decision_reason to refusal_reason', () => {
    const result = mapFlexFields({ decision: 'refused', decision_reason: 'detrimental_to_quality' });
    expect(result.refusal_reason).toBe('detrimental_to_quality');
    expect(result.decision_reason).toBeUndefined();
  });

  it('maps free-text reasons to refusal_explanation and syncs withdrawn status', () => {
    const result = mapFlexFields({ decision: 'withdrawn', decision_reason: 'Employee withdrew request' });
    expect(result.refusal_explanation).toBe('Employee withdrew request');
    expect(result.refusal_reason).toBeUndefined();
    expect(result.status).toBe('withdrawn');
    expect(result.decision_reason).toBeUndefined();
  });

  it('strips ghost field: proposed_pattern', () => {
    const result = mapFlexFields({ proposed_pattern: '3 days', status: 'pending' });
    expect(result.proposed_pattern).toBeUndefined();
    expect(result.status).toBe('pending');
  });
});

// ── mapEdiFields ─────────────────────────────────────────────────────────────

describe('mapEdiFields', () => {
  it('renames date_recorded to complaint_date', () => {
    const result = mapEdiFields({ date_recorded: '2026-01-10' });
    expect(result.complaint_date).toBe('2026-01-10');
    expect(result.date_recorded).toBeUndefined();
  });

  it('renames harassment category to harassment_category', () => {
    const result = mapEdiFields({ record_type: 'harassment_complaint', category: 'racial' });
    expect(result.harassment_category).toBe('racial');
  });

  it('maps reasonable adjustment category into description instead of harassment_category', () => {
    const result = mapEdiFields({ record_type: 'reasonable_adjustment', category: 'Physical' });
    expect(result.description).toBe('Physical');
    expect(result.harassment_category).toBeUndefined();
  });

  it('renames respondent_role to respondent_type', () => {
    const result = mapEdiFields({ respondent_role: 'colleague' });
    expect(result.respondent_type).toBe('colleague');
  });

  it('strips catch-all data field', () => {
    const result = mapEdiFields({ data: { foo: 'bar' }, status: 'open' });
    expect(result.data).toBeUndefined();
    expect(result.status).toBe('open');
  });
});

// ── mapTupeFields ────────────────────────────────────────────────────────────

describe('mapTupeFields', () => {
  it('converts staff_affected to employees object with count', () => {
    const result = mapTupeFields({ staff_affected: 12 });
    expect(result.employees).toEqual({ count: 12 });
    expect(result.staff_affected).toBeUndefined();
  });

  it('sets employees to null when staff_affected is null', () => {
    const result = mapTupeFields({ staff_affected: null });
    expect(result.employees).toBeNull();
  });

  it('renames consultation dates', () => {
    const result = mapTupeFields({
      consultation_start: '2026-01-01',
      consultation_end: '2026-02-01',
    });
    expect(result.consultation_start_date).toBe('2026-01-01');
    expect(result.consultation_end_date).toBe('2026-02-01');
  });

  it('renames eli_sent_date to eli_received_date', () => {
    const result = mapTupeFields({ eli_sent_date: '2026-01-15' });
    expect(result.eli_received_date).toBe('2026-01-15');
  });

  it('renames measures_proposed to measures_description', () => {
    const result = mapTupeFields({ measures_proposed: 'No redundancies' });
    expect(result.measures_description).toBe('No redundancies');
  });
});

// ── mapRenewalFields ─────────────────────────────────────────────────────────

describe('mapRenewalFields', () => {
  it('maps DBS fields correctly when check_type=dbs', () => {
    const result = mapRenewalFields({
      check_type: 'dbs',
      last_checked: '2026-01-01',
      expiry_date: '2029-01-01',
      reference: 'DBS-123456',
    });
    expect(result.dbs_check_date).toBe('2026-01-01');
    expect(result.dbs_next_renewal_due).toBe('2029-01-01');
    expect(result.dbs_certificate_number).toBe('DBS-123456');
    expect(result.last_checked).toBeUndefined();
    expect(result.expiry_date).toBeUndefined();
    expect(result.reference).toBeUndefined();
  });

  it('maps RTW fields correctly when check_type=rtw', () => {
    const result = mapRenewalFields({
      check_type: 'rtw',
      last_checked: '2026-01-01',
      expiry_date: '2027-01-01',
      document_type: 'BRP',
    });
    expect(result.rtw_check_date).toBe('2026-01-01');
    expect(result.rtw_document_expiry).toBe('2027-01-01');
    expect(result.rtw_document_type).toBe('brp');
  });

  it('normalizes RTW document labels into stored enum values', () => {
    expect(normalizeRtwDocumentType('Share Code')).toBe('share_code');
    expect(normalizeRtwDocumentType('Pre-Settled')).toBe('pre_settled');
  });

  it('maps certificate_number to dbs_certificate_number for DBS', () => {
    const result = mapRenewalFields({ check_type: 'dbs', certificate_number: 'DBS-789' });
    expect(result.dbs_certificate_number).toBe('DBS-789');
    expect(result.certificate_number).toBeUndefined();
  });

  it('does NOT map certificate_number for RTW records', () => {
    const result = mapRenewalFields({ check_type: 'rtw', certificate_number: 'X-999' });
    expect(result.dbs_certificate_number).toBeUndefined();
    expect(result.certificate_number).toBe('X-999');
  });

  it('does not overwrite canonical dbs_check_date with last_checked', () => {
    const result = mapRenewalFields({
      check_type: 'dbs', last_checked: '2025-01-01', dbs_check_date: '2026-06-01',
    });
    expect(result.dbs_check_date).toBe('2026-06-01');
    expect(result.last_checked).toBeUndefined();
  });

  it('does not overwrite canonical dbs_next_renewal_due with expiry_date', () => {
    const result = mapRenewalFields({
      check_type: 'dbs', expiry_date: '2025-12-01', dbs_next_renewal_due: '2029-01-01',
    });
    expect(result.dbs_next_renewal_due).toBe('2029-01-01');
    expect(result.expiry_date).toBeUndefined();
  });

  it('does not overwrite canonical dbs_certificate_number with reference', () => {
    const result = mapRenewalFields({
      check_type: 'dbs', reference: 'old-ref', dbs_certificate_number: 'CANONICAL-123',
    });
    expect(result.dbs_certificate_number).toBe('CANONICAL-123');
    expect(result.reference).toBeUndefined();
  });
});

// ── diffFields ───────────────────────────────────────────────────────────────

describe('diffFields', () => {
  it('detects changed string fields', () => {
    const before = { status: 'open', category: 'misconduct' };
    const after = { status: 'closed', category: 'misconduct' };
    const changes = diffFields(before, after);
    expect(changes).toEqual([{ field: 'status', old: 'open', new: 'closed' }]);
  });

  it('detects added fields (null → value)', () => {
    const before = { status: 'open', outcome: null };
    const after = { status: 'open', outcome: 'warning_given' };
    const changes = diffFields(before, after);
    expect(changes).toEqual([{ field: 'outcome', old: null, new: 'warning_given' }]);
  });

  it('skips system fields: updated_at, version, created_at, created_by, home_id', () => {
    const before = { version: 1, updated_at: 'old', status: 'open' };
    const after = { version: 2, updated_at: 'new', created_at: 'x', created_by: 'y', home_id: 1, status: 'closed' };
    const changes = diffFields(before, after);
    expect(changes).toEqual([{ field: 'status', old: 'open', new: 'closed' }]);
  });

  it('handles nested objects via JSON comparison', () => {
    const before = { employees: { count: 5 } };
    const after = { employees: { count: 10 } };
    const changes = diffFields(before, after);
    expect(changes).toEqual([{ field: 'employees', old: { count: 5 }, new: { count: 10 } }]);
  });

  it('returns empty array when nothing changed', () => {
    const obj = { status: 'open', category: 'misconduct' };
    expect(diffFields(obj, obj)).toEqual([]);
  });

  it('handles null before (new record scenario)', () => {
    const changes = diffFields(null, { status: 'open' });
    expect(changes).toEqual([{ field: 'status', old: undefined, new: 'open' }]);
  });

  it('detects removed fields (present in before, absent in after)', () => {
    const before = { status: 'open', outcome: 'warning_given', notes: 'old notes' };
    const after = { status: 'open' };
    const changes = diffFields(before, after);
    expect(changes).toEqual([
      { field: 'outcome', old: 'warning_given', new: undefined },
      { field: 'notes', old: 'old notes', new: undefined },
    ]);
  });

  it('does not report removed system fields', () => {
    const before = { status: 'open', version: 1, updated_at: 'old' };
    const after = { status: 'open' };
    const changes = diffFields(before, after);
    expect(changes).toEqual([]);
  });
});
