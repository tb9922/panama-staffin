import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  getAgencyProviders, createAgencyProvider, updateAgencyProvider,
  getAgencyShifts, createAgencyShift, updateAgencyShift,
  getAgencyMetrics, getCurrentHome, getLoggedInUser,
} from '../lib/api.js';
import useDirtyGuard from '../hooks/useDirtyGuard';

const SHIFT_OPTIONS = ['E', 'L', 'EL', 'N', 'AG-E', 'AG-L', 'AG-N'];

function fmt(n, prefix = '£') {
  if (n == null) return '—';
  return `${prefix}${parseFloat(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Provider Modal ─────────────────────────────────────────────────────────────

function ProviderModal({ existing, onSave, onClose }) {
  const blank = { name: '', contact: '', rate_day: '', rate_night: '', active: true };
  const [form, setForm] = useState(existing
    ? { ...existing, rate_day: existing.rate_day ?? '', rate_night: existing.rate_night ?? '' }
    : blank);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const homeSlug = getCurrentHome();

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.name.trim()) { setErr('Provider name is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name:       form.name.trim(),
        contact:    form.contact || null,
        rate_day:   form.rate_day !== '' ? parseFloat(form.rate_day) : null,
        rate_night: form.rate_night !== '' ? parseFloat(form.rate_night) : null,
        active:     form.active,
      };
      if (existing) {
        await updateAgencyProvider(homeSlug, existing.id, payload);
      } else {
        await createAgencyProvider(homeSlug, payload);
      }
      onSave();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={existing ? 'Edit Provider' : 'Add Agency Provider'}>
      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}
      <div className="space-y-4">
        <div>
          <label className={INPUT.label}>Provider Name *</label>
          <input className={INPUT.base} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Prestige Nursing" />
        </div>
        <div>
          <label className={INPUT.label}>Contact (optional)</label>
          <input className={INPUT.base} value={form.contact || ''} onChange={e => set('contact', e.target.value)} placeholder="Email or phone" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Day Rate (£/hr)</label>
            <input type="number" step="0.01" className={INPUT.base} value={form.rate_day} onChange={e => set('rate_day', e.target.value)} placeholder="e.g. 18.50" />
          </div>
          <div>
            <label className={INPUT.label}>Night Rate (£/hr)</label>
            <input type="number" step="0.01" className={INPUT.base} value={form.rate_night} onChange={e => set('rate_night', e.target.value)} placeholder="e.g. 22.00" />
          </div>
        </div>
        {existing && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="prov-active" checked={form.active} onChange={e => set('active', e.target.checked)} />
            <label htmlFor="prov-active" className="text-sm text-gray-700">Active</label>
          </div>
        )}
      </div>
      <div className={MODAL.footer}>
        <button className={BTN.secondary} onClick={onClose}>Cancel</button>
        <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// ── Shift Log Modal ────────────────────────────────────────────────────────────

function ShiftModal({ providers, existing, onSave, onClose }) {
  const today  = new Date().toISOString().slice(0, 10);
  const blank  = { agency_id: providers[0]?.id || '', date: today, shift_code: 'E', hours: '', hourly_rate: '', worker_name: '', invoice_ref: '', role_covered: '', reconciled: false };
  const [form, setForm]   = useState(existing || blank);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const homeSlug = getCurrentHome();

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Auto-fill rate from provider
  function handleProviderChange(id) {
    const prov = providers.find(p => p.id === parseInt(id));
    const isNight = form.shift_code === 'N' || form.shift_code === 'AG-N';
    const rate = isNight ? prov?.rate_night : prov?.rate_day;
    setForm(f => ({ ...f, agency_id: parseInt(id), hourly_rate: rate != null ? String(rate) : f.hourly_rate }));
  }

  function handleShiftChange(code) {
    const prov = providers.find(p => p.id === parseInt(form.agency_id));
    const isNight = code === 'N' || code === 'AG-N';
    const rate = isNight ? prov?.rate_night : prov?.rate_day;
    setForm(f => ({ ...f, shift_code: code, hourly_rate: rate != null ? String(rate) : f.hourly_rate }));
  }

  async function handleSave() {
    if (!form.agency_id) { setErr('Select a provider'); return; }
    if (!form.date)       { setErr('Date is required'); return; }
    const hours = parseFloat(form.hours);
    const rate  = parseFloat(form.hourly_rate);
    if (!hours || hours <= 0) { setErr('Enter valid hours'); return; }
    if (!rate  || rate  <= 0) { setErr('Enter valid hourly rate'); return; }

    setSaving(true);
    setErr(null);
    try {
      const payload = {
        agency_id:    parseInt(form.agency_id),
        date:         form.date,
        shift_code:   form.shift_code,
        hours,
        hourly_rate:  rate,
        total_cost:   Math.round(hours * rate * 100) / 100,
        worker_name:  form.worker_name || null,
        invoice_ref:  form.invoice_ref || null,
        role_covered: form.role_covered || null,
        reconciled:   form.reconciled,
      };
      if (existing) {
        await updateAgencyShift(homeSlug, existing.id, payload);
      } else {
        await createAgencyShift(homeSlug, payload);
      }
      onSave();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={existing ? 'Edit Agency Shift' : 'Log Agency Shift'} size="lg">
      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Provider *</label>
            <select className={INPUT.select} value={form.agency_id} onChange={e => handleProviderChange(e.target.value)}>
              {providers.filter(p => p.active).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Date *</label>
            <input type="date" className={INPUT.base} value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={INPUT.label}>Shift Code *</label>
            <select className={INPUT.select} value={form.shift_code} onChange={e => handleShiftChange(e.target.value)}>
              {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Hours *</label>
            <input type="number" step="0.5" className={INPUT.base} value={form.hours} onChange={e => set('hours', e.target.value)} placeholder="e.g. 12" />
          </div>
          <div>
            <label className={INPUT.label}>Rate (£/hr) *</label>
            <input type="number" step="0.01" className={INPUT.base} value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} placeholder="e.g. 20.00" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Worker Name (optional)</label>
            <input className={INPUT.base} value={form.worker_name || ''} onChange={e => set('worker_name', e.target.value)} placeholder="e.g. John Smith" />
          </div>
          <div>
            <label className={INPUT.label}>Role Covered (optional)</label>
            <input className={INPUT.base} value={form.role_covered || ''} onChange={e => set('role_covered', e.target.value)} placeholder="e.g. Senior Carer" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Invoice Ref (optional)</label>
            <input className={INPUT.base} value={form.invoice_ref || ''} onChange={e => set('invoice_ref', e.target.value)} placeholder="e.g. INV-2026-042" />
          </div>
          <div className="flex items-end pb-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="shift-reconciled" checked={!!form.reconciled} onChange={e => set('reconciled', e.target.checked)} />
              <label htmlFor="shift-reconciled" className="text-sm text-gray-700">Reconciled</label>
            </div>
          </div>
        </div>
        {form.hours && form.hourly_rate && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">
            Total cost: <strong>{fmt(parseFloat(form.hours) * parseFloat(form.hourly_rate))}</strong>
          </div>
        )}
      </div>
      <div className={MODAL.footer}>
        <button className={BTN.secondary} onClick={onClose}>Cancel</button>
        <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Shift'}</button>
      </div>
    </Modal>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AgencyTracker() {
  const homeSlug = getCurrentHome();
  const isAdmin  = getLoggedInUser()?.role === 'admin';

  // Default last 12 weeks
  const defaultEnd   = new Date().toISOString().slice(0, 10);
  const defaultStart = (() => {
    const d = new Date(); d.setDate(d.getDate() - 84);
    return d.toISOString().slice(0, 10);
  })();

  const [tab, setTab]             = useState('shifts'); // 'shifts' | 'providers' | 'metrics'
  const [providers, setProviders] = useState([]);
  const [shifts, setShifts]       = useState([]);
  const [metrics, setMetrics]     = useState(null);
  const [dateStart, setDateStart] = useState(defaultStart);
  const [dateEnd, setDateEnd]     = useState(defaultEnd);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [showProvModal, setShowProvModal] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [editProvider, setEditProvider]   = useState(null);
  const [editShift, setEditShift]         = useState(null);
  useDirtyGuard(showProvModal || showShiftModal);

  const loadProviders = useCallback(async () => {
    if (!homeSlug) return;
    const p = await getAgencyProviders(homeSlug);
    setProviders(p);
  }, [homeSlug]);

  const loadShifts = useCallback(async () => {
    if (!homeSlug) return;
    const s = await getAgencyShifts(homeSlug, dateStart, dateEnd);
    setShifts(s);
  }, [homeSlug, dateStart, dateEnd]);

  const loadMetrics = useCallback(async () => {
    if (!homeSlug) return;
    const m = await getAgencyMetrics(homeSlug, 12);
    setMetrics(m);
  }, [homeSlug]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadProviders(), loadShifts(), loadMetrics()]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [loadProviders, loadShifts, loadMetrics]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Reload shifts when date range changes
  useEffect(() => {
    if (!loading) loadShifts().catch(e => setError(e.message));
  }, [dateStart, dateEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  function providerName(id) {
    return providers.find(p => p.id === id)?.name || `Provider ${id}`;
  }

  const totalCost = shifts.reduce((s, sh) => s + parseFloat(sh.total_cost || 0), 0);
  const unreconciled = shifts.filter(s => !s.reconciled).length;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Agency Tracker</h1>
          <p className={PAGE.subtitle}>Log and monitor agency staff costs, provider rates, and spend trends</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button className={BTN.secondary} onClick={() => { setEditProvider(null); setShowProvModal(true); }}>
              + Provider
            </button>
            <button className={BTN.primary} onClick={() => { setEditShift(null); setShowShiftModal(true); }}>
              + Log Shift
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Summary Cards */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">This Week</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(metrics.this_week_cost)}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">This Month</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(metrics.this_month_cost)}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">12-Week Total</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(metrics.total_cost)}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Unreconciled</p>
            <p className={`text-2xl font-bold mt-1 ${unreconciled > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{unreconciled}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {[
          { key: 'shifts',    label: 'Shift Log' },
          { key: 'providers', label: 'Providers' },
          { key: 'metrics',   label: 'Weekly Trend' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Shift Log Tab ── */}
      {tab === 'shifts' && (
        <>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">From</label>
              <input type="date" className={INPUT.sm} value={dateStart} onChange={e => setDateStart(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">To</label>
              <input type="date" className={INPUT.sm} value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
            </div>
            <span className="text-sm text-gray-500 ml-auto">
              {shifts.length} shift{shifts.length !== 1 ? 's' : ''} · {fmt(totalCost)} total
            </span>
          </div>
          <div className={CARD.flush}>
            {loading ? (
              <div className="py-10 text-center text-sm text-gray-400">Loading shifts…</div>
            ) : (
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th className={TABLE.th}>Date</th>
                      <th className={TABLE.th}>Provider</th>
                      <th className={TABLE.th}>Shift</th>
                      <th className={TABLE.th}>Worker</th>
                      <th className={TABLE.th}>Role Covered</th>
                      <th className={TABLE.th + ' text-right'}>Hours</th>
                      <th className={TABLE.th + ' text-right'}>Rate</th>
                      <th className={TABLE.th + ' text-right'}>Cost</th>
                      <th className={TABLE.th}>Invoice</th>
                      <th className={TABLE.th}>Status</th>
                      {isAdmin && <th className={TABLE.th}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.length === 0 ? (
                      <tr><td colSpan={isAdmin ? 11 : 10} className={TABLE.empty}>No agency shifts logged for this period.</td></tr>
                    ) : shifts.map(sh => (
                      <tr key={sh.id} className={TABLE.tr}>
                        <td className={TABLE.td}>{sh.date}</td>
                        <td className={TABLE.td + ' text-sm'}>{providerName(sh.agency_id)}</td>
                        <td className={TABLE.td}>
                          <span className="inline-block bg-gray-100 rounded px-1.5 py-0.5 text-xs font-mono">{sh.shift_code}</span>
                        </td>
                        <td className={TABLE.td + ' text-sm text-gray-500'}>{sh.worker_name || '—'}</td>
                        <td className={TABLE.td + ' text-sm text-gray-500'}>{sh.role_covered || '—'}</td>
                        <td className={TABLE.td + ' text-right font-mono text-sm'}>{parseFloat(sh.hours).toFixed(2)}h</td>
                        <td className={TABLE.td + ' text-right font-mono text-sm'}>{fmt(sh.hourly_rate)}</td>
                        <td className={TABLE.td + ' text-right font-mono text-sm font-semibold'}>{fmt(sh.total_cost)}</td>
                        <td className={TABLE.td + ' text-xs text-gray-500'}>{sh.invoice_ref || '—'}</td>
                        <td className={TABLE.td}>
                          <span className={sh.reconciled ? BADGE.green : BADGE.amber}>
                            {sh.reconciled ? 'Reconciled' : 'Pending'}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className={TABLE.td}>
                            <button className={`${BTN.secondary} ${BTN.sm}`} onClick={() => { setEditShift(sh); setShowShiftModal(true); }}>
                              Edit
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Providers Tab ── */}
      {tab === 'providers' && (
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th className={TABLE.th}>Provider</th>
                  <th className={TABLE.th}>Contact</th>
                  <th className={TABLE.th + ' text-right'}>Day Rate</th>
                  <th className={TABLE.th + ' text-right'}>Night Rate</th>
                  <th className={TABLE.th}>Status</th>
                  {isAdmin && <th className={TABLE.th}></th>}
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 6 : 5} className={TABLE.empty}>No providers added yet.</td></tr>
                ) : providers.map(p => (
                  <tr key={p.id} className={TABLE.tr}>
                    <td className={TABLE.td + ' font-medium'}>{p.name}</td>
                    <td className={TABLE.td + ' text-sm text-gray-500'}>{p.contact || '—'}</td>
                    <td className={TABLE.td + ' text-right font-mono text-sm'}>{fmt(p.rate_day)}</td>
                    <td className={TABLE.td + ' text-right font-mono text-sm'}>{fmt(p.rate_night)}</td>
                    <td className={TABLE.td}>
                      <span className={p.active ? BADGE.green : BADGE.gray}>{p.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    {isAdmin && (
                      <td className={TABLE.td}>
                        <button className={`${BTN.secondary} ${BTN.sm}`} onClick={() => { setEditProvider(p); setShowProvModal(true); }}>
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Weekly Trend Tab ── */}
      {tab === 'metrics' && (
        <div>
          {!metrics || !metrics.weekly?.length ? (
            <div className={`${CARD.padded} text-center text-sm text-gray-500 py-8`}>No weekly trend data yet.</div>
          ) : (
            <>
              <div className={CARD.flush}>
                <div className={TABLE.wrapper}>
                  <table className={TABLE.table}>
                    <thead className={TABLE.thead}>
                      <tr>
                        <th className={TABLE.th}>Week Starting</th>
                        <th className={TABLE.th + ' text-right'}>Shifts</th>
                        <th className={TABLE.th + ' text-right'}>Hours</th>
                        <th className={TABLE.th + ' text-right'}>Cost</th>
                        <th className={TABLE.th}>Providers Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.weekly.map((w, i) => (
                        <tr key={i} className={TABLE.tr}>
                          <td className={TABLE.td}>{w.week_start}</td>
                          <td className={TABLE.td + ' text-right font-mono text-sm'}>{w.shift_count}</td>
                          <td className={TABLE.td + ' text-right font-mono text-sm'}>{parseFloat(w.total_hours || 0).toFixed(1)}h</td>
                          <td className={TABLE.td + ' text-right font-mono text-sm font-semibold'}>{fmt(w.total_cost)}</td>
                          <td className={TABLE.td + ' text-sm text-gray-500'}>{w.provider_count ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Provider Modal */}
      {showProvModal && (
        <ProviderModal
          existing={editProvider}
          onSave={async () => { setShowProvModal(false); setEditProvider(null); await loadProviders(); }}
          onClose={() => { setShowProvModal(false); setEditProvider(null); }}
        />
      )}

      {/* Shift Modal */}
      {showShiftModal && providers.some(p => p.active) && (
        <ShiftModal
          providers={providers}
          existing={editShift}
          onSave={async () => {
            setShowShiftModal(false);
            setEditShift(null);
            await Promise.all([loadShifts(), loadMetrics()]);
          }}
          onClose={() => { setShowShiftModal(false); setEditShift(null); }}
        />
      )}

      <Modal isOpen={showShiftModal && providers.filter(p => p.active).length === 0} onClose={() => setShowShiftModal(false)} title="No Active Providers">
        <p className="text-sm text-gray-600 mb-4">Add at least one active agency provider before logging shifts.</p>
        <div className={MODAL.footer}>
          <button className={BTN.primary} onClick={() => { setShowShiftModal(false); setTab('providers'); setShowProvModal(true); }}>Add Provider</button>
        </div>
      </Modal>
    </div>
  );
}
