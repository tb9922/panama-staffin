import { useState, useEffect } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { formatDate, parseDate, addDays } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { getHandoverEntries, createHandoverEntry, updateHandoverEntry, deleteHandoverEntry, acknowledgeHandoverEntry, getCurrentHome, getIncidents } from '../lib/api.js';
import { CARD, INPUT, BTN, BADGE, MODAL, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard';
import { useData } from '../contexts/DataContext.jsx';

const SHIFTS = [
  { id: 'E', label: 'Early Shift' },
  { id: 'L', label: 'Late Shift' },
  { id: 'N', label: 'Night Shift' },
];

const CATEGORIES = [
  { id: 'clinical',    label: 'Clinical',    borderClass: 'border-l-4 border-l-emerald-400', badge: 'green' },
  { id: 'safety',      label: 'Safety',      borderClass: 'border-l-4 border-l-red-400',     badge: 'red' },
  { id: 'operational', label: 'Operational', borderClass: 'border-l-4 border-l-blue-400',    badge: 'blue' },
  { id: 'admin',       label: 'Admin',       borderClass: 'border-l-4 border-l-gray-300',    badge: 'gray' },
];

const PRIORITIES = [
  { id: 'urgent', label: 'Urgent',          badge: 'red' },
  { id: 'action', label: 'Action Required', badge: 'amber' },
  { id: 'info',   label: 'Info',            badge: 'gray' },
];

const EMPTY_FORM = { shift: 'E', category: 'clinical', priority: 'info', content: '', incident_id: '' };

export default function HandoverNotes() {
  const [dateStr, setDateStr]     = useState(formatDate(new Date()));
  const [entries, setEntries]     = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [modal, setModal]         = useState(null);   // null | 'add' | 'edit'
  useDirtyGuard(!!modal);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [editId, setEditId]       = useState(null);
  const [saving, setSaving]       = useState(false);

  const { canWrite } = useData();
  const canEdit = canWrite('scheduling');
  const { confirm, ConfirmDialog } = useConfirm();
  const slug = getCurrentHome();
  const todayStr = useLiveDate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getHandoverEntries(slug, dateStr)
      .then(rows => { if (!cancelled) setEntries(rows); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, dateStr]);

  useEffect(() => {
    const h = getCurrentHome();
    if (!h) return;
    getIncidents(h).then(r => setIncidents(r.incidents || [])).catch(e => console.warn('HandoverNotes incidents fetch failed:', e.message));
  }, [slug]);

  function goDay(delta) {
    setDateStr(formatDate(addDays(parseDate(dateStr), delta)));
  }

  function openAdd(shift) {
    setForm({ ...EMPTY_FORM, shift });
    setEditId(null);
    setModal('add');
  }

  function openEdit(entry) {
    setForm({ shift: entry.shift, category: entry.category, priority: entry.priority, content: entry.content, incident_id: entry.incident_id || '', _version: entry.version });
    setEditId(entry.id);
    setModal('edit');
  }

  function closeModal() {
    setModal(null);
    setForm(EMPTY_FORM);
    setEditId(null);
  }

  async function handleSave() {
    if (!form.content.trim()) return;
    setSaving(true);
    try {
      if (modal === 'add') {
        const body = { entry_date: dateStr, shift: form.shift, category: form.category, priority: form.priority, content: form.content.trim(), incident_id: form.incident_id || null };
        const created = await createHandoverEntry(slug, body);
        setEntries(prev => [...prev, created].sort(sortEntries));
      } else {
        const updated = await updateHandoverEntry(slug, editId, { content: form.content.trim(), priority: form.priority, _version: form._version });
        setEntries(prev => prev.map(e => e.id === editId ? updated : e));
      }
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (saving) return;
    if (!await confirm('Delete this handover entry?')) return;
    setSaving(true);
    try {
      await deleteHandoverEntry(slug, id);
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAcknowledge(id) {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await acknowledgeHandoverEntry(slug, id);
      setEntries(prev => prev.map(e => e.id === id ? updated : e));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    const sheets = SHIFTS.map(s => {
      const shiftEntries = entries.filter(e => e.shift === s.id);
      return {
        name: s.label,
        headers: ['Date', 'Category', 'Priority', 'Content', 'Author', 'Time', 'Acknowledged By', 'Acknowledged At'],
        rows: shiftEntries.map(e => [
          dateStr,
          e.category,
          e.priority,
          e.content,
          e.author,
          e.created_at ? new Date(e.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
          e.acknowledged_by || '',
          e.acknowledged_at ? new Date(e.acknowledged_at).toLocaleString('en-GB') : '',
        ]),
      };
    });
    downloadXLSX(`handover-${dateStr}`, sheets);
  }

  // Display helpers
  const incidentMap = Object.fromEntries(incidents.map(i => [i.id, i]));
  const dateObj = parseDate(dateStr);
  const displayDate = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const todayIncidents = incidents.filter(i => i.date === dateStr);

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className={PAGE.title}>Handover Book</h1>
          <p className="text-sm text-gray-500 mt-0.5">Structured shift handover records — CQC Reg 17 (contemporaneous records)</p>
        </div>
        <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm} shrink-0`}>Export Excel</button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => goDay(-1)} className={`${BTN.ghost} ${BTN.sm}`}>&#8592;</button>
        <span className="text-sm font-semibold text-gray-800 min-w-[200px] text-center">{displayDate}</span>
        <button onClick={() => goDay(1)} className={`${BTN.ghost} ${BTN.sm}`}>&#8594;</button>
        {dateStr !== todayStr && (
          <button onClick={() => setDateStr(todayStr)} className={`${BTN.secondary} ${BTN.sm}`}>Today</button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs font-medium ml-3">Dismiss</button>
        </div>
      )}

      {loading && <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>}

      {/* Shift sections */}
      {!loading && SHIFTS.map(shift => {
        const shiftEntries = entries.filter(e => e.shift === shift.id);
        return (
          <div key={shift.id} className={`${CARD.base} mb-4`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">{shift.label}</span>
                {shiftEntries.length > 0 && (
                  <span className={`${BADGE.blue} text-xs`}>{shiftEntries.length}</span>
                )}
              </div>
              {canEdit && (
                <button onClick={() => openAdd(shift.id)} className={`${BTN.secondary} ${BTN.sm}`}>+ Add Entry</button>
              )}
            </div>

            {shiftEntries.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400 text-center">No handover entries for {shift.label.toLowerCase()}</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {CATEGORIES.map(cat => {
                  const catEntries = shiftEntries.filter(e => e.category === cat.id);
                  if (catEntries.length === 0) return null;
                  return (
                    <div key={cat.id} className="px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className={`${BADGE[cat.badge]} text-xs`}>{cat.label}</span>
                      </div>
                      <div className="space-y-2">
                        {catEntries.map(entry => {
                          const pri = PRIORITIES.find(p => p.id === entry.priority) || PRIORITIES[2];
                          const incident = entry.incident_id ? incidentMap[entry.incident_id] : null;
                          const timeStr = entry.created_at
                            ? new Date(entry.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                            : '';
                          return (
                            <div key={entry.id} className={`rounded-lg bg-gray-50 p-3 ${cat.borderClass}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`${BADGE[pri.badge]} text-xs shrink-0`}>{pri.label}</span>
                                    {incident && (
                                      <span className="text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 shrink-0">
                                        Incident: {incident.type || 'linked'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-800 leading-snug whitespace-pre-wrap">{entry.content}</p>
                                  <p className="text-xs text-gray-400 mt-1">{entry.author} · {timeStr}</p>
                                  {entry.acknowledged_by ? (
                                    <p className="text-xs text-emerald-600 mt-1">
                                      ✓ Acknowledged by {entry.acknowledged_by} · {new Date(entry.acknowledged_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  ) : (
                                    <button onClick={() => handleAcknowledge(entry.id)} disabled={saving} className="mt-1 text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2">
                                      Acknowledge
                                    </button>
                                  )}
                                </div>
                                {canEdit && (
                                  <div className="flex gap-1 shrink-0">
                                    <button onClick={() => openEdit(entry)} className={`${BTN.ghost} ${BTN.sm} text-xs`}>Edit</button>
                                    <button onClick={() => handleDelete(entry.id)} disabled={saving} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">Del</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Add / Edit modal */}
      <Modal isOpen={!!modal} onClose={closeModal} title={modal === 'add' ? 'Add Handover Entry' : 'Edit Handover Entry'} size="sm">
        <div className="space-y-3">
          {modal === 'add' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Shift</label>
                <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))} className={INPUT.select}>
                  {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={INPUT.select}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className={INPUT.label}>Priority</label>
            <div className="flex gap-3">
              {PRIORITIES.map(p => (
                <label key={p.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="priority"
                    value={p.id}
                    checked={form.priority === p.id}
                    onChange={() => setForm(f => ({ ...f, priority: p.id }))}
                  />
                  <span className={`${BADGE[p.badge]} text-xs`}>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Content <span className="text-red-500">*</span></label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              className={`${INPUT.base} h-24 resize-y`}
              placeholder="Describe the situation, actions taken, or information to hand over"
            />
          </div>
          {modal === 'add' && todayIncidents.length > 0 && (
            <div>
              <label className={INPUT.label}>Link to Incident (optional)</label>
              <select value={form.incident_id} onChange={e => setForm(f => ({ ...f, incident_id: e.target.value }))} className={INPUT.select}>
                <option value="">None</option>
                {todayIncidents.map(i => (
                  <option key={i.id} value={i.id}>{i.type} — {i.description?.slice(0, 60) || i.id}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className={MODAL.footer}>
          <button onClick={closeModal} className={BTN.ghost} disabled={saving}>Cancel</button>
          <button onClick={handleSave} className={BTN.primary} disabled={saving || !form.content.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}

function sortEntries(a, b) {
  const shiftOrder = { E: 1, L: 2, N: 3 };
  const catOrder   = { clinical: 1, safety: 2, operational: 3, admin: 4 };
  const sd = (shiftOrder[a.shift] || 9) - (shiftOrder[b.shift] || 9);
  if (sd !== 0) return sd;
  const cd = (catOrder[a.category] || 9) - (catOrder[b.category] || 9);
  if (cd !== 0) return cd;
  return (a.created_at || '').localeCompare(b.created_at || '');
}
