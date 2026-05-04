import { describe, expect, it, vi } from 'vitest';
import {
  getAccessibleOperationalReviewHomes,
  getOperationalReviewQueueForUser,
} from '../../services/operationalReviewService.js';

const HOMES = [
  { id: 1, slug: 'amberwood', name: 'Amberwood', role_id: 'home_manager' },
  { id: 2, slug: 'birch-house', name: 'Birch House', role_id: 'viewer' },
];

function reviewRows() {
  return {
    overdue: [
      {
        source_id: 11,
        home_id: 1,
        home_slug: 'amberwood',
        home_name: 'Amberwood',
        source_kind: 'action_item',
        title: 'Safeguarding action overdue',
        priority: 'high',
        status: 'open',
        due_date: '2026-04-28',
        escalation_level: 3,
        source_type: 'incident',
        source_action_key: 'legacy:1',
        owner_display_name: 'Dana Manager',
        _type_total: '1',
      },
    ],
    agency: [
      {
        source_id: 22,
        home_id: 2,
        home_slug: 'birch-house',
        home_name: 'Birch House',
        source_kind: 'agency_approval_attempt',
        gap_date: '2026-05-03',
        shift_code: 'AG-N',
        role_needed: 'Senior Carer',
        reason: 'Night cover exhausted',
        outcome: 'emergency_agency',
        internal_bank_candidate_count: 2,
        viable_internal_candidate_count: 1,
        linked_agency_shift_id: null,
        owner_username: 'rota-lead',
        _type_total: '1',
      },
    ],
    unverified: [
      {
        source_id: 33,
        home_id: 1,
        home_slug: 'amberwood',
        home_name: 'Amberwood',
        source_kind: 'action_item',
        title: 'Completed action awaiting check',
        priority: 'medium',
        status: 'completed',
        due_date: '2026-05-01',
        completed_at: '2026-05-02T09:00:00Z',
        evidence_required: false,
        owner_role: 'Deputy Manager',
        _type_total: '1',
      },
    ],
    evidence: [
      {
        source_id: 44,
        home_id: 1,
        home_slug: 'amberwood',
        home_name: 'Amberwood',
        source_kind: 'audit_task',
        title: 'Monthly medication audit',
        status: 'verified',
        due_date: '2026-04-30',
        completed_at: '2026-05-01T08:00:00Z',
        evidence_required: true,
        owner_display_name: 'Quality Lead',
        _type_total: '1',
      },
    ],
    signOff: [
      {
        source_id: 54,
        home_id: 1,
        home_slug: 'amberwood',
        home_name: 'Amberwood',
        source_kind: 'audit_task',
        title: 'Completed audit needs manager sign-off',
        due_date: '2026-05-01',
        completed_at: '2026-05-02T09:00:00Z',
        review_at: '2026-05-02T09:00:00Z',
        owner_display_name: 'Dana Manager',
        _type_total: '2',
      },
      {
        source_id: 55,
        home_id: 2,
        home_slug: 'birch-house',
        home_name: 'Birch House',
        source_kind: 'assessment_snapshot',
        title: 'CQC assessment snapshot',
        engine: 'cqc',
        band: 'not_ready',
        overall_score: 48,
        computed_by: 'assessor',
        computed_at: '2026-04-29T10:00:00Z',
        review_at: '2026-04-29T10:00:00Z',
        _type_total: '1',
      },
    ],
  };
}

function createQueueClient(rowsByType = reviewRows()) {
  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('FROM user_home_roles')) {
        expect(params).toEqual(['manager']);
        return { rows: HOMES };
      }
      if (sql.includes("ai.due_date < CURRENT_DATE")) return { rows: rowsByType.overdue };
      if (sql.includes('FROM agency_approval_attempts')) return { rows: rowsByType.agency };
      if (sql.includes("ai.status = 'completed'") && sql.includes('at.qa_signed_off_at IS NULL')) {
        return { rows: rowsByType.unverified };
      }
      if (sql.includes('at.evidence_required = true') && sql.includes("at.status IN ('completed', 'verified')")) {
        return { rows: rowsByType.evidence };
      }
      if (sql.includes('assessment_snapshots')) return { rows: rowsByType.signOff };
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

describe('operational review service', () => {
  it('loads all homes for platform admins', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        expect(sql).toContain("'platform_admin' AS role_id");
        return { rows: [{ id: 7, slug: 'platform-home', name: 'Platform Home', role_id: 'platform_admin' }] };
      }),
    };

    const homes = await getAccessibleOperationalReviewHomes({ username: 'admin', isPlatformAdmin: true }, client);

    expect(homes).toEqual([{ id: 7, slug: 'platform-home', name: 'Platform Home', role_id: 'platform_admin' }]);
  });

  it('loads only homes assigned to the user', async () => {
    const client = {
      query: vi.fn(async (sql, params) => {
        expect(sql).toContain('FROM user_home_roles');
        expect(params).toEqual(['manager']);
        return { rows: HOMES };
      }),
    };

    const homes = await getAccessibleOperationalReviewHomes({ username: ' Manager ', isPlatformAdmin: false }, client);

    expect(homes.map(home => home.slug)).toEqual(['amberwood', 'birch-house']);
  });

  it('returns shaped read-only queue items with link metadata scoped by module access', async () => {
    const client = createQueueClient();

    const result = await getOperationalReviewQueueForUser({ username: 'manager', limit: 20 }, client);

    expect(result.homes.map(home => home.slug)).toEqual(['amberwood', 'birch-house']);
    expect(result.summary.total).toBe(4);
    expect(result.summary.by_type).toMatchObject({
      overdue_escalation: 1,
      emergency_agency_override: 0,
      unverified_completed_action: 1,
      evidence_missing: 1,
      manager_sign_off_required: 1,
    });

    const agency = result.items.find(item => item.type === 'emergency_agency_override');
    expect(agency).toBeUndefined();

    const overdue = result.items.find(item => item.type === 'overdue_escalation');
    expect(overdue.link_target).toMatchObject({ path: '/actions', module: 'governance', home_slug: 'amberwood' });
    expect(overdue.meta.escalation_level).toBe(3);

    const managerSignOff = result.items.find(item => item.type === 'manager_sign_off_required');
    expect(managerSignOff).toMatchObject({
      title: 'Completed audit needs manager sign-off',
      actionable_label: 'Manager sign-off required',
      link_target: { path: '/audit-calendar', module: 'governance', home_slug: 'amberwood' },
    });
  });

  it('applies type and severity filters after collecting scoped queues', async () => {
    const client = createQueueClient();

    const result = await getOperationalReviewQueueForUser({
      username: 'manager',
      type: 'evidence_missing',
      severity: 'high',
      limit: 20,
    }, client);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: 'evidence_missing',
      severity: 'high',
      title: 'Monthly medication audit',
      link_target: { path: '/audit-calendar', home_slug: 'amberwood' },
    });
    expect(result._total).toBe(1);
    expect(result.summary.by_type.evidence_missing).toBe(1);
  });
});
