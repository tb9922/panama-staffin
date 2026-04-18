import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';
import { BTN, BADGE, MODAL } from '../../lib/design.js';

// Cover plan modal — shown after a manager books AL. Lists proposed cover
// assignments grouped by date and period, pre-checked. Manager can un-check
// any row; Accept Selected writes everything checked via one bulk upsert.
//
// Props:
//   isOpen       — bool
//   plan         — { assignments: [...], totalCost, residualGaps } from generateCoverPlan
//   saving       — disables the accept button while a parent request is in flight
//   onAccept     — (selectedAssignments: []) => void
//   onDismiss    — () => void

const KIND_LABEL = {
  float: 'Float',
  ot: 'OT',
  agency: 'Agency',
};
const KIND_BADGE = {
  float: BADGE.green,
  ot: BADGE.amber,
  agency: BADGE.red,
};

function groupByDate(assignments) {
  const grouped = new Map();
  for (const a of assignments) {
    if (!grouped.has(a.date)) grouped.set(a.date, []);
    grouped.get(a.date).push(a);
  }
  return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function makeKey(a, i) {
  // Agency rows share no staffId semantics; use position index so de-selects are stable.
  return `${a.date}|${a.period}|${a.kind}|${a.staffId || 'agency'}|${i}`;
}

export default function CoverPlanModal({ isOpen, plan, saving, onAccept, onDismiss }) {
  const assignments = useMemo(() => plan?.assignments || [], [plan]);
  const [deselected, setDeselected] = useState(new Set());

  const grouped = useMemo(() => groupByDate(assignments), [assignments]);

  const selected = useMemo(() => {
    return assignments.filter((a, i) => !deselected.has(makeKey(a, i)));
  }, [assignments, deselected]);

  const selectedCost = useMemo(() => selected.reduce((t, a) => t + a.cost, 0), [selected]);

  function toggle(key) {
    setDeselected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(selectAll) {
    if (selectAll) {
      setDeselected(new Set());
    } else {
      setDeselected(new Set(assignments.map((a, i) => makeKey(a, i))));
    }
  }

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onDismiss} title="Cover Plan — review and accept" size="lg">
      <div className="space-y-4">
        {plan?.summary && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
              <div>
                <span className="text-gray-500">Coverage fill:</span>{' '}
                <span className="font-semibold text-blue-800">{Math.round((plan.summary.coverageFillPct || 0) * 100)}%</span>
                <span className="text-gray-400"> ({plan.summary.gapSlotsFilled}/{plan.summary.gapSlotsTotal})</span>
              </div>
              <div>
                <span className="text-gray-500">Total cost:</span>{' '}
                <span className="font-semibold text-blue-800">£{(plan.summary.totalCost || 0).toFixed(0)}</span>
              </div>
              <div>
                <span className="text-gray-500">Float / OT / Agency:</span>{' '}
                <span className="font-semibold text-blue-800">{plan.summary.floatShifts} / {plan.summary.otShifts} / {plan.summary.agencyShifts}</span>
              </div>
              <div>
                <span className="text-gray-500">WTR warnings:</span>{' '}
                <span className={`font-semibold ${plan.summary.wtrWarnings > 0 ? 'text-amber-700' : 'text-blue-800'}`}>{plan.summary.wtrWarnings}</span>
              </div>
            </div>
          </div>
        )}
        {assignments.length === 0 ? (
          plan?.residualGaps > 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {plan.residualGaps} residual gap{plan.residualGaps === 1 ? '' : 's'} remain and no automatic cover could be proposed.
            </div>
          ) : (
            <div className="text-sm text-gray-500">Coverage is intact for this booking — no cover needed.</div>
          )
        ) : (
          <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Proposed {assignments.length} assignment{assignments.length === 1 ? '' : 's'} across {grouped.length} day{grouped.length === 1 ? '' : 's'}.
              Un-check any row you don't want. Everything checked will be saved.
            </p>
            <div className="flex gap-2">
              <button onClick={() => toggleAll(true)} className={`${BTN.ghost} ${BTN.xs}`}>Select all</button>
              <button onClick={() => toggleAll(false)} className={`${BTN.ghost} ${BTN.xs}`}>Deselect all</button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {grouped.map(([date, rows]) => (
              <div key={date} className="border-b border-gray-100 last:border-b-0">
                <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">{date}</div>
                <div className="divide-y divide-gray-100">
                  {rows.map((a) => {
                    const globalIndex = assignments.indexOf(a);
                    const key = makeKey(a, globalIndex);
                    const isChecked = !deselected.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 px-3 py-2 text-xs ${isChecked ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 cursor-pointer`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(key)}
                          className="shrink-0"
                        />
                        <span className={`${KIND_BADGE[a.kind]} shrink-0`}>{KIND_LABEL[a.kind] || a.kind}</span>
                        <span className="font-medium text-gray-800 shrink-0">{a.shift}</span>
                        <span className="text-gray-600 truncate flex-1">
                          {a.staffName}
                          {a.period && <span className="text-gray-400 text-[11px] ml-1">· {a.period}</span>}
                        </span>
                        {a.warn && (
                          <span className="text-[10px] text-amber-600 shrink-0" title="Projected WTR hours approaching 48h/week">WTR warn</span>
                        )}
                        <span className="font-mono text-gray-700 shrink-0">£{a.cost.toFixed(2)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500">
              {selected.length} selected
              {plan?.residualGaps > 0 && (
                <span className="ml-2 text-red-600">· {plan.residualGaps} residual gap{plan.residualGaps === 1 ? '' : 's'} (no cover available)</span>
              )}
            </span>
            <span className="text-sm font-semibold">Total: £{selectedCost.toFixed(2)}</span>
          </div>

          <div className={MODAL.footer}>
            <button onClick={onDismiss} className={BTN.ghost}>Dismiss</button>
            <button
              disabled={saving || selected.length === 0}
              onClick={() => onAccept(selected)}
              className={`${BTN.primary} disabled:opacity-50`}
            >
              {saving ? 'Saving…' : `Accept ${selected.length} assignment${selected.length === 1 ? '' : 's'}`}
            </button>
          </div>
          </>
        )}
      </div>
    </Modal>
  );
}
