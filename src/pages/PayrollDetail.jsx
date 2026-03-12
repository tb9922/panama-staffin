import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BTN, CARD, TABLE, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  getPayrollRun, calculatePayrollRun, approvePayrollRun,
  getPayrollExportUrl, getPayrollSummaryPdfUrl, getPayslips, getCurrentHome,
  getSchedulingData, } from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';

const STATUS_BADGE = {
  draft:      BADGE.gray,
  calculated: BADGE.blue,
  approved:   BADGE.green,
  exported:   BADGE.purple,
  locked:     BADGE.gray,
};

const STATUS_LABEL = {
  draft:      'Draft',
  calculated: 'Calculated',
  approved:   'Approved',
  exported:   'Exported',
  locked:     'Locked',
};

function fmt(n, prefix = '£') {
  if (n == null) return '—';
  return `${prefix}${parseFloat(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtHrs(n) {
  if (n == null || parseFloat(n) === 0) return '—';
  return `${parseFloat(n).toFixed(2)}h`;
}

// Fetch blob with cookie auth, trigger download
async function downloadWithAuth(url, filename) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Invalid response' }));
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

export default function PayrollDetail() {
  const { runId } = useParams();
  const homeSlug  = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');
  const navigate  = useNavigate();

  const [schedData, setSchedData]         = useState(null);
  const [run, setRun]                     = useState(null);
  const [lines, setLines]                 = useState([]);
  const [payslips, setPayslips]           = useState([]);   // keyed by staff_id after load
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [action, setAction]               = useState(null); // 'calculating' | 'approving' | 'exporting'
  const [expanded, setExpanded]           = useState({});   // staffId → bool
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  useEffect(() => {
    const h = getCurrentHome();
    if (!h) return;
    getSchedulingData(h).then(setSchedData).catch(e => setError(e.message || 'Failed to load'));
  }, []);

  // staffMap from scheduling API for name/role lookup
  const staffMap = useMemo(() => {
    const map = {};
    (schedData?.staff || []).forEach(s => { map[s.id] = s; });
    return map;
  }, [schedData]);

  const load = useCallback(async () => {
    if (!homeSlug || !runId) return;
    try {
      setLoading(true);
      setError(null);
      const result = await getPayrollRun(homeSlug, runId);
      setRun(result.run);
      setLines(result.lines || []);
      // Load shift breakdowns if calculated or beyond
      if (['calculated', 'approved', 'exported', 'locked'].includes(result.run?.status)) {
        const slips = await getPayslips(homeSlug, runId);
        const slipMap = {};
        (slips || []).forEach(s => { slipMap[s.staff_id] = s; });
        setPayslips(slipMap);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, runId]);

  // Sort lines by staff name in render phase (after schedData loads)
  const sortedLines = useMemo(() => {
    if (!lines.length) return lines;
    return [...lines].sort((a, b) => {
      const na = staffMap[a.staff_id]?.name || a.staff_id;
      const nb = staffMap[b.staff_id]?.name || b.staff_id;
      return na.localeCompare(nb);
    });
  }, [lines, staffMap]);

  useEffect(() => { load(); }, [load]);

  async function handleCalculate() {
    setAction('calculating');
    setError(null);
    try {
      const result = await calculatePayrollRun(homeSlug, runId);
      setRun(result.run);
      setLines(result.lines || []);
      const slips = await getPayslips(homeSlug, runId);
      const slipMap = {};
      (slips || []).forEach(s => { slipMap[s.staff_id] = s; });
      setPayslips(slipMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setAction(null);
    }
  }

  async function handleApprove() {
    setAction('approving');
    setError(null);
    try {
      const updated = await approvePayrollRun(homeSlug, runId);
      setRun(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setAction(null);
    }
  }

  async function handleExport(format) {
    setAction('exporting');
    setError(null);
    try {
      const url = getPayrollExportUrl(homeSlug, runId, format);
      const period = run ? `${run.period_start}_${run.period_end}` : runId;
      await downloadWithAuth(url, `payroll_${format}_${period}.csv`);
      // Reload to pick up exported_at timestamp update
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAction(null);
    }
  }

  function toggleExpand(staffId) {
    setExpanded(prev => ({ ...prev, [staffId]: !prev[staffId] }));
  }

  if (loading) {
    return (
      <div className={PAGE.container}>
        <div className="py-10 text-center text-sm text-gray-400">Loading payroll run…</div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className={PAGE.container}>
        <div className="py-10 text-center text-sm text-gray-500">Payroll run not found.</div>
      </div>
    );
  }

  const nmwViolations = lines.filter(l => !l.nmw_compliant);
  const canCalculate  = canEdit && ['draft', 'calculated'].includes(run.status);
  const canApprove    = canEdit && run.status === 'calculated' && nmwViolations.length === 0;
  const canExport     = canEdit && ['approved', 'exported', 'locked'].includes(run.status);
  const isBusy        = action !== null;

  // Grand totals
  const totals = lines.reduce((acc, l) => ({
    base_hours:              acc.base_hours              + parseFloat(l.base_hours || 0),
    base_pay:                acc.base_pay                + parseFloat(l.base_pay || 0),
    night_enhancement:       acc.night_enhancement       + parseFloat(l.night_enhancement || 0),
    weekend_enhancement:     acc.weekend_enhancement     + parseFloat(l.weekend_enhancement || 0),
    bank_holiday_enhancement: acc.bank_holiday_enhancement + parseFloat(l.bank_holiday_enhancement || 0),
    overtime_enhancement:    acc.overtime_enhancement    + parseFloat(l.overtime_enhancement || 0),
    sleep_in_pay:            acc.sleep_in_pay            + parseFloat(l.sleep_in_pay || 0),
    on_call_enhancement:     acc.on_call_enhancement     + parseFloat(l.on_call_enhancement || 0),
    total_hours:             acc.total_hours             + parseFloat(l.total_hours || 0),
    gross_pay:               acc.gross_pay               + parseFloat(l.gross_pay || 0),
    holiday_pay:             acc.holiday_pay             + parseFloat(l.holiday_pay || 0),
    ssp_amount:              acc.ssp_amount              + parseFloat(l.ssp_amount || 0),
    tax_deducted:            acc.tax_deducted            + parseFloat(l.tax_deducted || 0),
    employee_ni:             acc.employee_ni             + parseFloat(l.employee_ni || 0),
    employer_ni:             acc.employer_ni             + parseFloat(l.employer_ni || 0),
    pension_employee:        acc.pension_employee        + parseFloat(l.pension_employee || 0),
    student_loan:            acc.student_loan            + parseFloat(l.student_loan || 0),
    net_pay:                 acc.net_pay                 + parseFloat(l.net_pay || 0),
  }), {
    base_hours: 0, base_pay: 0, night_enhancement: 0, weekend_enhancement: 0,
    bank_holiday_enhancement: 0, overtime_enhancement: 0, sleep_in_pay: 0,
    on_call_enhancement: 0, total_hours: 0, gross_pay: 0,
    holiday_pay: 0, ssp_amount: 0, tax_deducted: 0, employee_ni: 0,
    employer_ni: 0, pension_employee: 0, student_loan: 0, net_pay: 0,
  });

  const hasDeductions = totals.net_pay > 0;

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div className="flex items-center gap-3">
          <button className={BTN.secondary} onClick={() => navigate('/payroll')}>← Back</button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className={PAGE.title}>Payroll Run #{run.id}</h1>
              <span className={STATUS_BADGE[run.status] || BADGE.gray}>{STATUS_LABEL[run.status] || run.status}</span>
            </div>
            <p className={PAGE.subtitle}>
              {run.period_start} to {run.period_end}
              {run.approved_by && ` · Approved by ${run.approved_by}`}
              {run.exported_at && ` · Exported ${run.exported_at.slice(0, 10)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canCalculate && (
            <button className={BTN.primary} onClick={handleCalculate} disabled={isBusy}>
              {action === 'calculating' ? 'Calculating…' : run.status === 'calculated' ? 'Recalculate' : 'Calculate'}
            </button>
          )}
          {canApprove && (
            <button className={BTN.success} onClick={() => setShowApproveConfirm(true)} disabled={isBusy}>
              {action === 'approving' ? 'Approving…' : 'Approve'}
            </button>
          )}
          {canExport && (
            <>
              <button className={BTN.secondary} onClick={() => handleExport('sage')} disabled={isBusy}>
                {action === 'exporting' ? 'Exporting…' : 'Sage CSV'}
              </button>
              <button className={BTN.secondary} onClick={() => handleExport('xero')} disabled={isBusy}>
                Xero CSV
              </button>
              <button className={BTN.secondary} onClick={() => handleExport('generic')} disabled={isBusy}>
                Generic CSV
              </button>
              <button
                className={BTN.secondary}
                onClick={() => downloadWithAuth(
                  getPayrollSummaryPdfUrl(homeSlug, runId),
                  `payroll_summary_${run.period_start}_${run.period_end}.pdf`,
                )}
                disabled={isBusy}
              >
                Summary PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>
      )}

      {/* NMW Alert Banner */}
      {nmwViolations.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">
            NMW Violation — {nmwViolations.length} staff member{nmwViolations.length !== 1 ? 's' : ''} below National Minimum Wage
          </p>
          <p className="text-xs text-red-600 mt-1">
            Approval is blocked until all violations are resolved. Check base pay rates and hours for:{' '}
            {nmwViolations.map(l => staffMap[l.staff_id]?.name || l.staff_id).join(', ')}.
          </p>
          {run.status === 'calculated' && (
            <p className="text-xs text-red-600 mt-1">
              Tip: update pay rate rules then recalculate to resolve.
            </p>
          )}
        </div>
      )}

      {/* Summary Cards */}
      {run.status !== 'draft' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Staff</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{run.staff_count ?? lines.length}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Hours</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{totals.total_hours.toFixed(1)}h</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Gross</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(run.total_gross ?? totals.gross_pay)}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Enhancements</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{fmt(run.total_enhancements ?? totals.night_enhancement + totals.weekend_enhancement + totals.bank_holiday_enhancement)}</p>
          </div>
          {hasDeductions && (
            <div className={CARD.padded}>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Est. Net Pay</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{fmt(totals.net_pay)}</p>
            </div>
          )}
        </div>
      )}

      {/* Draft state — no lines yet */}
      {run.status === 'draft' && lines.length === 0 && (
        <div className={`${CARD.padded} text-center py-10`}>
          <p className="text-sm text-gray-500 mb-3">This run has not been calculated yet.</p>
          {canEdit && (
            <button className={BTN.primary} onClick={handleCalculate} disabled={isBusy}>
              {action === 'calculating' ? 'Calculating…' : 'Calculate Now'}
            </button>
          )}
        </div>
      )}

      {/* Lines Table */}
      {lines.length > 0 && (
        <div className={CARD.flush}>
          <div className={TABLE.wrapper} style={{ overflowX: 'auto' }}>
            <table className={TABLE.table} style={{ minWidth: '1100px' }}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Staff</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>Hours</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>Base Pay</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>Night</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>W/E</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>BH</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>OT</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>Sleep-in</th>
                  <th scope="col" className={TABLE.th + ' text-right'}>On-call</th>
                  <th scope="col" className={TABLE.th + ' text-right font-bold'}>GROSS</th>
                  <th scope="col" className={TABLE.th + ' text-right font-bold'}>EST. NET PAY</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {sortedLines.map(line => {
                  const staff  = staffMap[line.staff_id];
                  const name   = staff?.name || line.staff_id;
                  const role   = staff?.role || '';
                  const isExp  = !!expanded[line.staff_id];
                  const slip   = payslips[line.staff_id];
                  const shifts = slip?.shifts || [];
                  const nmwOk  = line.nmw_compliant;

                  return [
                    <tr key={`row-${line.staff_id}`} className={TABLE.tr}>
                      <td className={TABLE.td}>
                        <div className="flex items-center gap-2">
                          {!nmwOk && (
                            <span className={`${BADGE.red} text-xs`} title="NMW violation">NMW</span>
                          )}
                          <div>
                            <p className="font-medium text-sm">{name}</p>
                            <p className="text-xs text-gray-400">{role}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmtHrs(line.total_hours)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(line.base_pay)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm text-blue-700`}>{fmt(line.night_enhancement)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm text-purple-700`}>{fmt(line.weekend_enhancement)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm text-orange-700`}>{fmt(line.bank_holiday_enhancement)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(line.overtime_enhancement)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(line.sleep_in_pay)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(line.on_call_enhancement)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm font-bold`}>{fmt(line.gross_pay)}</td>
                      <td className={`${TABLE.td} text-right font-mono text-sm font-bold ${line.net_pay > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                        {line.net_pay > 0 ? fmt(line.net_pay) : '—'}
                      </td>
                      <td className={TABLE.td}>
                        <div className="flex items-center gap-1">
                          {(shifts.length > 0 || line.net_pay > 0) && (
                            <button
                              className={`${BTN.ghost} ${BTN.xs} text-xs`}
                              onClick={() => toggleExpand(line.staff_id)}
                            >
                              {isExp ? 'Hide' : 'Detail'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,

                    // Expanded detail: deductions summary + shift breakdown
                    isExp && (
                      <tr key={`exp-${line.staff_id}`}>
                        <td colSpan={12} className="bg-gray-50 px-4 py-3">
                          {/* Deductions summary */}
                          {line.net_pay > 0 && (
                            <div className="mb-3 flex flex-wrap gap-4 text-xs text-gray-600 bg-white rounded border border-gray-200 px-3 py-2">
                              <span><span className="text-gray-400">Gross:</span> <span className="font-mono font-semibold">{fmt(line.gross_pay)}</span></span>
                              {line.holiday_pay > 0 && <span><span className="text-gray-400">Holiday Pay:</span> <span className="font-mono">{fmt(line.holiday_pay)}</span></span>}
                              {line.ssp_amount > 0 && <span><span className="text-gray-400">SSP:</span> <span className="font-mono">{fmt(line.ssp_amount)}</span></span>}
                              {line.tax_deducted > 0 && <span><span className="text-gray-400">PAYE:</span> <span className="font-mono text-red-600">({fmt(line.tax_deducted)})</span></span>}
                              {line.employee_ni > 0 && <span><span className="text-gray-400">NI (EE):</span> <span className="font-mono text-red-600">({fmt(line.employee_ni)})</span></span>}
                              {line.pension_employee > 0 && <span><span className="text-gray-400">Pension:</span> <span className="font-mono text-red-600">({fmt(line.pension_employee)})</span></span>}
                              {line.student_loan > 0 && <span><span className="text-gray-400">Student Loan:</span> <span className="font-mono text-red-600">({fmt(line.student_loan)})</span></span>}
                              <span className="ml-auto font-semibold text-green-700">Est. Net Pay: {fmt(line.net_pay)}</span>
                            </div>
                          )}

                          {/* Shift breakdown */}
                          {shifts.length > 0 && (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 uppercase text-left border-b border-gray-200">
                                  <th scope="col" className="pb-1 pr-3">Date</th>
                                  <th scope="col" className="pb-1 pr-3">Shift</th>
                                  <th scope="col" className="pb-1 pr-3 text-right">Hours</th>
                                  <th scope="col" className="pb-1 pr-3 text-right">Base Rate</th>
                                  <th scope="col" className="pb-1 pr-3 text-right">Base</th>
                                  <th scope="col" className="pb-1 pr-3">Enhancements</th>
                                  <th scope="col" className="pb-1 pr-3 text-right">Total</th>
                                  <th scope="col" className="pb-1 text-right">Eff. Rate</th>
                                </tr>
                              </thead>
                              <tbody>
                                {shifts.map((sh, i) => (
                                  <tr key={i} className="border-b border-gray-100 last:border-0">
                                    <td className="py-1 pr-3 text-gray-600">{sh.date}</td>
                                    <td className="py-1 pr-3">
                                      <span className="inline-block bg-gray-100 rounded px-1 font-mono">{sh.shift_code}</span>
                                    </td>
                                    <td className="py-1 pr-3 text-right font-mono">{parseFloat(sh.hours).toFixed(2)}h</td>
                                    <td className="py-1 pr-3 text-right font-mono">{fmt(sh.base_rate)}</td>
                                    <td className="py-1 pr-3 text-right font-mono">{fmt(sh.base_amount)}</td>
                                    <td className="py-1 pr-3 text-gray-500">
                                      {(sh.enhancements_json || []).map((e, j) => (
                                        <span key={j} className="inline-block bg-blue-50 text-blue-700 rounded px-1 mr-1">
                                          {e.type} {fmt(e.amount)}
                                        </span>
                                      ))}
                                    </td>
                                    <td className="py-1 pr-3 text-right font-mono font-semibold">{fmt(sh.total_amount)}</td>
                                    <td className="py-1 text-right font-mono text-gray-500">{fmt(sh.effective_hourly_rate)}/h</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          {line.notes && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">{line.notes}</p>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}

                {/* Totals row */}
                <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                  <td className={`${TABLE.td} text-sm`}>TOTALS ({lines.length} staff)</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm`}>{totals.total_hours.toFixed(2)}h</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(totals.base_pay)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm text-blue-700`}>{fmt(totals.night_enhancement)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm text-purple-700`}>{fmt(totals.weekend_enhancement)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm text-orange-700`}>{fmt(totals.bank_holiday_enhancement)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(totals.overtime_enhancement)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(totals.sleep_in_pay)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm`}>{fmt(totals.on_call_enhancement)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm font-bold`}>{fmt(totals.gross_pay)}</td>
                  <td className={`${TABLE.td} text-right font-mono text-sm font-bold text-green-700`}>
                    {hasDeductions ? fmt(totals.net_pay) : '—'}
                  </td>
                  <td className={TABLE.td}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Run notes */}
      {run.notes && (
        <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600">
          <span className="font-medium">Notes: </span>{run.notes}
        </div>
      )}

      {/* Approve confirmation modal */}
      <Modal isOpen={showApproveConfirm} onClose={() => setShowApproveConfirm(false)} title="Approve Pay Run" size="sm">
        <div className="space-y-3 mb-6">
          <p className="text-sm text-gray-600">
            This will lock the pay run and mark it ready for export to your accountant.
            <strong className="text-red-600"> This cannot be undone.</strong>
          </p>
          <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Period</span>
              <span className="font-medium">{run?.period_start} &rarr; {run?.period_end}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Staff count</span>
              <span className="font-medium">{run?.staff_count ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total gross pay</span>
              <span className="font-medium">
                {run?.total_gross != null
                  ? `£${parseFloat(run.total_gross).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
        <div className={MODAL.footer}>
          <button
            className={BTN.secondary}
            onClick={() => setShowApproveConfirm(false)}
            disabled={action === 'approving'}
          >
            Cancel
          </button>
          <button
            className={BTN.danger}
            onClick={async () => {
              setShowApproveConfirm(false);
              await handleApprove();
            }}
            disabled={action === 'approving'}
          >
            {action === 'approving' ? 'Approving…' : 'Confirm Approve'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
