import { describe, expect, it } from 'vitest';
import {
  validateComplaintStatusChange,
  validateDpiaStatusChange,
  validateDolsReviewStatusChange,
  validateGdprBreachStatusChange,
  validateGdprComplaintStatusChange,
  validateGdprRequestStatusChange,
  validateIncidentStatusChange,
  validateIpcOutbreakStatusChange,
  validatePolicyStatusChange,
  validateRiskStatusChange,
  validateRopaStatusChange,
  validateWhistleblowingStatusChange,
} from '../../lib/statusTransitions.js';

describe('status transition guards', () => {
  it('blocks complaints from jumping straight to closed', () => {
    expect(validateComplaintStatusChange({ status: 'open' }, { status: 'closed' }))
      .toBe('Complaint status cannot move from open to closed');
  });

  it('requires complaint resolution details before resolving', () => {
    expect(validateComplaintStatusChange({ status: 'investigating' }, { status: 'resolved' }))
      .toBe('Resolution details are required before marking a complaint resolved');
    expect(validateComplaintStatusChange(
      { status: 'investigating' },
      { status: 'resolved', resolution: 'Apology issued and action plan agreed' }
    )).toBeNull();
  });

  it('blocks whistleblowing closure before resolution', () => {
    expect(validateWhistleblowingStatusChange({ status: 'registered' }, { status: 'closed' }))
      .toBe('Concern status cannot move from registered to closed');
  });

  it('requires outcome details before resolving a whistleblowing concern', () => {
    expect(validateWhistleblowingStatusChange({ status: 'investigating' }, { status: 'resolved' }))
      .toBe('Outcome details are required before marking a concern resolved');
    expect(validateWhistleblowingStatusChange(
      { status: 'investigating' },
      { status: 'resolved', outcome: 'Substantiated' }
    )).toBeNull();
  });

  it('requires incidents to move through under_review before closing', () => {
    expect(validateIncidentStatusChange({ investigation_status: 'open' }, { investigation_status: 'closed' }))
      .toBe('Investigation status cannot move from open to closed');
    expect(validateIncidentStatusChange(
      { investigation_status: 'under_review' },
      { investigation_status: 'closed', investigation_closed_date: '2026-04-10' }
    )).toBeNull();
  });

  it('requires a closed date when closing an incident', () => {
    expect(validateIncidentStatusChange(
      { investigation_status: 'under_review' },
      { investigation_status: 'closed' }
    )).toBe('Closed incidents must include an investigation closed date');
  });

  it('locks GDPR request transitions to the workflow path', () => {
    expect(validateGdprRequestStatusChange({ status: 'received' }, { status: 'completed' }))
      .toBe('Request status cannot move from received to completed');
    expect(validateGdprRequestStatusChange({ status: 'in_progress' }, { status: 'completed' }))
      .toBeNull();
  });

  it('locks GDPR breach transitions to the workflow path', () => {
    expect(validateGdprBreachStatusChange({ status: 'open' }, { status: 'closed' }))
      .toBe('Breach status cannot move from open to closed');
    expect(validateGdprBreachStatusChange({ status: 'contained' }, { status: 'resolved' }))
      .toBeNull();
  });

  it('requires GDPR complaint resolution details before resolving', () => {
    expect(validateGdprComplaintStatusChange({ status: 'investigating' }, { status: 'resolved' }))
      .toBe('Resolution details are required before marking a complaint resolved');
    expect(validateGdprComplaintStatusChange(
      { status: 'investigating' },
      { status: 'resolved', resolution_date: '2026-04-10' }
    )).toBeNull();
  });

  it('prevents risks from jumping straight to closed', () => {
    expect(validateRiskStatusChange({ status: 'open' }, { status: 'closed' }))
      .toBe('Risk status cannot move from open to closed');
    expect(validateRiskStatusChange({ status: 'mitigated' }, { status: 'closed' }))
      .toBeNull();
  });

  it('requires policies to move through a reviewed state and keep a reviewed date when current', () => {
    expect(validatePolicyStatusChange({ status: 'current' }, { status: 'not_reviewed' }))
      .toBe('Policy status cannot move from current to not_reviewed');
    expect(validatePolicyStatusChange({ status: 'under_review' }, { status: 'current' }))
      .toBe('Last reviewed date is required before marking a policy current');
    expect(validatePolicyStatusChange(
      { status: 'under_review' },
      { status: 'current', last_reviewed: '2026-04-13' }
    )).toBeNull();
  });

  it('keeps DPIAs on the explicit lifecycle path', () => {
    expect(validateDpiaStatusChange({ status: 'screening' }, { status: 'approved' }))
      .toBe('DPIA status cannot move from screening to approved');
    expect(validateDpiaStatusChange({ status: 'completed' }, { status: 'approved' }))
      .toBeNull();
  });

  it('prevents archived ROPA activities from being reopened', () => {
    expect(validateRopaStatusChange({ status: 'archived' }, { status: 'active' }))
      .toBe('ROPA status cannot move from archived to active');
    expect(validateRopaStatusChange({ status: 'active' }, { status: 'under_review' }))
      .toBeNull();
  });

  it('prevents outbreak status from moving backwards and requires an end date to resolve', () => {
    expect(validateIpcOutbreakStatusChange(
      { outbreak: { status: 'resolved', end_date: '2026-04-12' } },
      { outbreak: { status: 'confirmed' } }
    )).toBe('Outbreak status cannot move from resolved to confirmed');

    expect(validateIpcOutbreakStatusChange(
      { outbreak: { status: 'contained' } },
      { outbreak: { status: 'resolved' } }
    )).toBe('Resolved outbreaks must include an end date');

    expect(validateIpcOutbreakStatusChange(
      { outbreak: { status: 'contained' } },
      { outbreak: { status: 'resolved', end_date: '2026-04-12' } }
    )).toBeNull();
  });

  it('prevents DoLS review status from moving backwards and requires reviewed date on completion', () => {
    expect(validateDolsReviewStatusChange(
      { review_status: 'completed', reviewed_date: '2026-04-12' },
      { review_status: 'in_progress' }
    )).toBe('DoLS review status cannot move from completed to in_progress');

    expect(validateDolsReviewStatusChange(
      { review_status: 'in_progress' },
      { review_status: 'completed' }
    )).toBe('Completed DoLS reviews must include a reviewed date');

    expect(validateDolsReviewStatusChange(
      { review_status: 'in_progress' },
      { review_status: 'completed', reviewed_date: '2026-04-12' }
    )).toBeNull();
  });
});
