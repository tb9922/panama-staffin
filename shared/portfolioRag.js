export const RAG = Object.freeze({
  GREEN: 'green',
  AMBER: 'amber',
  RED: 'red',
  UNKNOWN: 'unknown',
});

export const PORTFOLIO_RAG_THRESHOLDS = Object.freeze({
  trainingCompliancePct: { greenAtLeast: 95, amberAtLeast: 90 },
  occupancyPct: { greenAtLeast: 90, amberAtLeast: 80 },
  managerActionsOverdue: { greenAtMost: 0, amberAtMost: 2 },
  escalatedActionsL3Plus: { greenAtMost: 0, amberAtMost: 0 },
  incidentOpen: { greenAtMost: 0, amberAtMost: 3 },
  complaintOpen: { greenAtMost: 0, amberAtMost: 2 },
  incidentRatePerResidentMonth: { greenAtMost: 0.05, amberAtMost: 0.15 },
  complaintRatePerResidentMonth: { greenAtMost: 0.02, amberAtMost: 0.08 },
  overdueCounts: { greenAtMost: 0, amberAtMost: 2 },
  expiredCertificates: { greenAtMost: 0, amberAtMost: 0 },
  careCertificateGaps: { greenAtMost: 0, amberAtMost: 2 },
  cqcEvidenceGaps: { greenAtMost: 0, amberAtMost: 4 },
  agencyEmergencyOverridePct: { greenAtMost: 10, amberAtMost: 20 },
  agencyShiftsPer100PlannedShifts28d: { greenAtMost: 5, amberAtMost: 15 },
  falls28d: { greenAtMost: 1, amberAtMost: 3 },
  infections28d: { greenAtMost: 1, amberAtMost: 3 },
  pressureSores28d: { greenAtMost: 0, amberAtMost: 1 },
});

export function ragAtLeast(value, { greenAtLeast, amberAtLeast }) {
  if (value == null || Number.isNaN(Number(value))) return RAG.UNKNOWN;
  const n = Number(value);
  if (n >= greenAtLeast) return RAG.GREEN;
  if (n >= amberAtLeast) return RAG.AMBER;
  return RAG.RED;
}

export function ragAtMost(value, { greenAtMost, amberAtMost }) {
  if (value == null || Number.isNaN(Number(value))) return RAG.UNKNOWN;
  const n = Number(value);
  if (n <= greenAtMost) return RAG.GREEN;
  if (n <= amberAtMost) return RAG.AMBER;
  return RAG.RED;
}

export function overallRag(ragMap) {
  const values = Object.values(ragMap || {});
  if (values.length === 0) return RAG.UNKNOWN;
  if (values.includes(RAG.RED)) return RAG.RED;
  if (values.includes(RAG.AMBER)) return RAG.AMBER;
  if (values.includes(RAG.UNKNOWN)) return RAG.UNKNOWN;
  return RAG.GREEN;
}

function agencyVolumeRag(kpis) {
  const shifts28d = Number(kpis?.agency?.shifts_28d || 0);
  const rate = kpis?.agency?.shifts_per_100_planned_shifts_28d;
  if (rate == null) return shifts28d > 0 ? RAG.UNKNOWN : RAG.GREEN;
  return ragAtMost(rate, PORTFOLIO_RAG_THRESHOLDS.agencyShiftsPer100PlannedShifts28d);
}

export function buildPortfolioRag(kpis) {
  const thresholds = PORTFOLIO_RAG_THRESHOLDS;
  const rag = {
    staffing: kpis?.staffing?.gaps_per_100_planned_shifts == null
      ? RAG.UNKNOWN
      : ragAtMost(kpis.staffing.gaps_per_100_planned_shifts, { greenAtMost: 0, amberAtMost: 3 }),
    agency: kpis?.agency
      ? overallRag({
          emergency: ragAtMost(kpis.agency.emergency_override_pct, thresholds.agencyEmergencyOverridePct),
          volume: agencyVolumeRag(kpis),
        })
      : RAG.UNKNOWN,
    training: ragAtLeast(kpis?.training?.compliance_pct, thresholds.trainingCompliancePct),
    care_certificate: ragAtMost(
      (kpis?.care_certificate?.overdue || 0) + (kpis?.care_certificate?.missing || 0),
      thresholds.careCertificateGaps,
    ),
    incidents: overallRag({
      open: ragAtMost(kpis?.incidents?.open, thresholds.incidentOpen),
      rate: ragAtMost(kpis?.incidents?.rate_per_resident_month, thresholds.incidentRatePerResidentMonth),
      overdue: ragAtMost(
        (kpis?.incidents?.cqc_notifiable_overdue || 0)
        + (kpis?.incidents?.riddor_overdue || 0)
        + (kpis?.incidents?.duty_of_candour_overdue || 0),
        thresholds.overdueCounts,
      ),
    }),
    complaints: overallRag({
      open: ragAtMost(kpis?.complaints?.open, thresholds.complaintOpen),
      rate: ragAtMost(kpis?.complaints?.rate_per_resident_month, thresholds.complaintRatePerResidentMonth),
      overdue: ragAtMost(
        (kpis?.complaints?.ack_overdue || 0) + (kpis?.complaints?.response_overdue || 0),
        thresholds.overdueCounts,
      ),
    }),
    audits: ragAtMost(
      (kpis?.audits?.overdue || 0)
      + (kpis?.audits?.evidence_missing || 0)
      + (kpis?.audits?.pending_qa || 0),
      thresholds.overdueCounts,
    ),
    supervisions: ragAtMost(kpis?.supervisions?.overdue, thresholds.overdueCounts),
    cqc_evidence: ragAtMost(kpis?.cqc_evidence?.open_gaps, thresholds.cqcEvidenceGaps),
    maintenance: ragAtMost(
      (kpis?.maintenance?.overdue || 0) + (kpis?.maintenance?.certs_expired || 0),
      thresholds.expiredCertificates,
    ),
    manager_actions: overallRag({
      overdue: ragAtMost(kpis?.manager_actions?.overdue || 0, thresholds.managerActionsOverdue),
      escalated_l3_plus: ragAtMost(
        kpis?.manager_actions?.escalated_l3_plus || 0,
        thresholds.escalatedActionsL3Plus,
      ),
    }),
    occupancy: ragAtLeast(kpis?.occupancy?.pct, thresholds.occupancyPct),
    outcomes: kpis?.outcomes?.rag || RAG.UNKNOWN,
  };
  return {
    ...rag,
    overall: overallRag(rag),
  };
}
