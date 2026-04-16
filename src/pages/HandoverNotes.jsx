import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { addDays, formatDate, parseDate } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import FileAttachments from '../components/FileAttachments.jsx';
import ScanDocumentLink from '../components/ScanDocumentLink.jsx';
import {
  acknowledgeHandoverEntry, createHandoverEntry, deleteHandoverEntry, downloadRecordAttachment,
  getCurrentHome, getHandoverEntries, getHandoverEntriesByRange, getIncidents, getRecordAttachments,
  isAbortLikeError, updateHandoverEntry, uploadRecordAttachment, deleteRecordAttachment,
} from '../lib/api.js';
import { BADGE, BTN, CARD, INPUT, MODAL, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const SHIFTS = [{ id: 'E', label: 'Early Shift' }, { id: 'L', label: 'Late Shift' }, { id: 'N', label: 'Night Shift' }];
const CATEGORIES = [
  { id: 'clinical', label: 'Clinical', border: 'border-l-emerald-400', badge: 'green' },
  { id: 'safety', label: 'Safety', border: 'border-l-red-400', badge: 'red' },
  { id: 'operational', label: 'Operational', border: 'border-l-blue-400', badge: 'blue' },
  { id: 'admin', label: 'Admin', border: 'border-l-gray-300', badge: 'gray' },
];
const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', badge: 'red' },
  { id: 'action', label: 'Action Required', badge: 'amber' },
  { id: 'info', label: 'Info', badge: 'gray' },
];
const EMPTY_FORM = { shift: 'E', category: 'clinical', priority: 'info', content: '', incident_id: '' };

const shiftLabel = (id) => SHIFTS.find((s) => s.id === id)?.label || id;
const dayLabel = (dateStr) => parseDate(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const sortEntries = (a, b) => ({ E: 1, L: 2, N: 3 }[a.shift] - { E: 1, L: 2, N: 3 }[b.shift]
  || ({ clinical: 1, safety: 2, operational: 3, admin: 4 }[a.category] - { clinical: 1, safety: 2, operational: 3, admin: 4 }[b.category])
  || (a.created_at || '').localeCompare(b.created_at || ''));

function nextTarget(entry, selectedDate) {
  if (entry.entry_date && entry.entry_date !== selectedDate) return { entry_date: selectedDate, shift: entry.shift };
  if (entry.shift === 'E') return { entry_date: selectedDate, shift: 'L' };
  if (entry.shift === 'L') return { entry_date: selectedDate, shift: 'N' };
  return { entry_date: formatDate(addDays(parseDate(selectedDate), 1)), shift: 'E' };
}

export default function HandoverNotes() {
  const [dateStr, setDateStr] = useState(formatDate(new Date()));
  const [entries, setEntries] = useState([]);
  const [recentEntries, setRecentEntries] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [ackFilter, setAckFilter] = useState('all');
  useDirtyGuard(!!modal);
  const { canWrite, isScanTargetEnabled } = useData();
  const canEdit = canWrite('scheduling');
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();
  const slug = getCurrentHome();
  const todayStr = useLiveDate();

  useEffect(() => { let cancel = false; setLoading(true); setError(null); getHandoverEntries(slug, dateStr).then((rows) => !cancel && setEntries(rows)).catch((e) => !cancel && setError(e.message)).finally(() => !cancel && setLoading(false)); return () => { cancel = true; }; }, [slug, dateStr]);
  useEffect(() => { let cancel = false; const fromDate = formatDate(addDays(parseDate(dateStr), -3)); getHandoverEntriesByRange(slug, { fromDate, toDate: dateStr, limit: 250 }).then((res) => !cancel && setRecentEntries(res.rows || [])).catch(() => !cancel && setRecentEntries([])); return () => { cancel = true; }; }, [slug, dateStr]);
  useEffect(() => {
    const controller = new AbortController(); let cancel = false;
    getIncidents(slug, { signal: controller.signal }).then((res) => !cancel && setIncidents(res.incidents || [])).catch((e) => { if (!cancel && !isAbortLikeError(e, controller.signal)) setIncidents([]); });
    return () => { cancel = true; controller.abort(); };
  }, [slug]);

  const incidentMap = useMemo(() => Object.fromEntries(incidents.map((i) => [i.id, i])), [incidents]);
  const todayIncidents = useMemo(() => incidents.filter((i) => i.date === dateStr), [incidents, dateStr]);
  const filteredEntries = useMemo(() => entries.filter((e) => {
    if (shiftFilter !== 'all' && e.shift !== shiftFilter) return false;
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (priorityFilter !== 'all' && e.priority !== priorityFilter) return false;
    if (ackFilter === 'open' && e.acknowledged_by) return false;
    if (ackFilter === 'acknowledged' && !e.acknowledged_by) return false;
    if (!search.trim()) return true;
    const text = [e.content, e.author, incidentMap[e.incident_id]?.type, incidentMap[e.incident_id]?.description, shiftLabel(e.shift)].filter(Boolean).join(' ').toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }).sort(sortEntries), [entries, shiftFilter, categoryFilter, priorityFilter, ackFilter, search, incidentMap]);
  const summary = useMemo(() => ({ total: entries.length, open: entries.filter((e) => !e.acknowledged_by).length, action: entries.filter((e) => !e.acknowledged_by && e.priority !== 'info').length, linked: entries.filter((e) => e.incident_id).length }), [entries]);
  const carryQueue = useMemo(() => recentEntries.filter((e) => e.entry_date !== dateStr && !e.acknowledged_by && e.priority !== 'info').sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || '')).slice(0, 6), [recentEntries, dateStr]);

  const goDay = (delta) => setDateStr(formatDate(addDays(parseDate(dateStr), delta)));
  const closeModal = () => { setModal(null); setForm(EMPTY_FORM); setEditId(null); };
  const openAdd = (shift) => { setForm({ ...EMPTY_FORM, shift }); setEditId(null); setModal('add'); };
  const openEdit = (entry) => { setForm({ shift: entry.shift, category: entry.category, priority: entry.priority, content: entry.content, incident_id: entry.incident_id || '', _version: entry.version }); setEditId(entry.id); setModal('edit'); };

  async function saveEntry() {
    if (saving || !form.content.trim()) return;
    setSaving(true);
    try {
      if (modal === 'add') {
        const created = await createHandoverEntry(slug, { entry_date: dateStr, shift: form.shift, category: form.category, priority: form.priority, content: form.content.trim(), incident_id: form.incident_id || null });
        setEntries((prev) => [...prev, created].sort(sortEntries));
        showToast({ title: 'Handover entry added', message: shiftLabel(form.shift) });
      } else {
        const updated = await updateHandoverEntry(slug, editId, { content: form.content.trim(), priority: form.priority, _version: form._version });
        setEntries((prev) => prev.map((e) => e.id === editId ? updated : e));
        setRecentEntries((prev) => prev.map((e) => e.id === editId ? updated : e));
        showToast({ title: 'Handover entry updated' });
      }
      closeModal();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function carryForward(entry) {
    if (saving || !canEdit) return;
    const target = nextTarget(entry, dateStr);
    if (!await confirm(`Carry this item into ${shiftLabel(target.shift)} on ${dayLabel(target.entry_date)}? The original record will stay in place.`)) return;
    setSaving(true);
    try {
      const created = await createHandoverEntry(slug, { entry_date: target.entry_date, shift: target.shift, category: entry.category, priority: entry.priority, content: entry.content, incident_id: entry.incident_id || null });
      if (target.entry_date === dateStr) setEntries((prev) => [...prev, created].sort(sortEntries));
      showToast({ title: 'Handover carried forward', message: `${shiftLabel(target.shift)} on ${parseDate(target.entry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` });
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function acknowledge(id) {
    if (saving) return; setSaving(true);
    try {
      const updated = await acknowledgeHandoverEntry(slug, id);
      setEntries((prev) => prev.map((e) => e.id === id ? updated : e));
      setRecentEntries((prev) => prev.map((e) => e.id === id ? updated : e));
      showToast({ title: 'Handover entry acknowledged', message: updated.acknowledged_by || 'Acknowledged' });
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function remove(entry) {
    if (saving || !await confirm('Delete this handover entry?')) return;
    setSaving(true);
    try { await deleteHandoverEntry(slug, entry.id, entry.version); setEntries((prev) => prev.filter((e) => e.id !== entry.id)); setRecentEntries((prev) => prev.filter((e) => e.id !== entry.id)); showToast({ title: 'Handover entry deleted' }); } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function exportCurrent() {
    const { downloadXLSX } = await import('../lib/excel.js');
    await downloadXLSX(`handover-${dateStr}`, SHIFTS.map((shift) => ({ name: shift.label, headers: ['Date', 'Category', 'Priority', 'Content', 'Author', 'Time', 'Acknowledged By', 'Acknowledged At'], rows: filteredEntries.filter((e) => e.shift === shift.id).map((e) => [dateStr, e.category, e.priority, e.content, e.author, e.created_at ? new Date(e.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '', e.acknowledged_by || '', e.acknowledged_at ? new Date(e.acknowledged_at).toLocaleString('en-GB') : '']) })));
    showToast({ title: 'Handover export downloaded' });
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading handover notes..." /></div>;
  if (error && entries.length === 0) return <div className={PAGE.container}><ErrorState title="Handover entry needs attention" message={error} onRetry={() => setDateStr((v) => `${v}`)} /></div>;

  return (
    <div className={PAGE.container}>
      <div className="flex flex-col gap-4 mb-5 lg:flex-row lg:items-start lg:justify-between"><div><h1 className={PAGE.title}>Handover Book</h1><p className="text-sm text-gray-500 mt-0.5">Structured shift handover records for live operations and safe continuity.</p></div><div className="flex flex-wrap gap-2">{canEdit && isScanTargetEnabled('handover') && <ScanDocumentLink context={{ target: 'handover', entryDate: dateStr }} label="Scan handover evidence" /> }<button type="button" onClick={exportCurrent} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button></div></div>
      <div className={`${CARD.padded} mb-5`}><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => goDay(-1)} className={`${BTN.ghost} ${BTN.sm}`} aria-label="Previous handover day">&#8592;</button><div><div className="text-sm font-semibold text-gray-800">{dayLabel(dateStr)}</div><div className="text-xs text-gray-500">Review open items, acknowledgements, and what needs carrying forward.</div></div><button type="button" onClick={() => goDay(1)} className={`${BTN.ghost} ${BTN.sm}`} aria-label="Next handover day">&#8594;</button></div><div className="flex flex-wrap items-end gap-3"><label className="text-sm text-gray-600">Jump to date<input type="date" value={dateStr} onChange={(e) => e.target.value && setDateStr(e.target.value)} className={`${INPUT.sm} mt-1 min-w-[11rem]`} /></label><button type="button" onClick={() => setDateStr(todayStr)} disabled={dateStr === todayStr} className={`${dateStr === todayStr ? BTN.secondary : BTN.ghost} ${BTN.sm} ${dateStr === todayStr ? 'cursor-default opacity-70' : ''}`}>Today</button></div></div></div>
      <div className="grid grid-cols-1 gap-3 mb-5 md:grid-cols-2 xl:grid-cols-4">{[['Entries today', summary.total], ['Awaiting acknowledgement', summary.open], ['Open actions', summary.action], ['Linked incidents', summary.linked]].map(([label, value]) => <div key={label} className={CARD.padded}><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div></div>)}</div>
      <div className={`${CARD.padded} mb-5`}><div className="flex flex-wrap items-end gap-3"><label className="min-w-[16rem] flex-1"><span className={INPUT.label}>Search handover content</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={INPUT.base} placeholder="Search content, author, incident, or shift" /></label><label><span className={INPUT.label}>Shift</span><select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} className={INPUT.select}><option value="all">All shifts</option>{SHIFTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label><span className={INPUT.label}>Category</span><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={INPUT.select}><option value="all">All categories</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label><span className={INPUT.label}>Priority</span><select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={INPUT.select}><option value="all">All priorities</option>{PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label><span className={INPUT.label}>Acknowledgement</span><select value={ackFilter} onChange={(e) => setAckFilter(e.target.value)} className={INPUT.select}><option value="all">All entries</option><option value="open">Awaiting acknowledgement</option><option value="acknowledged">Acknowledged</option></select></label>{(search || shiftFilter !== 'all' || categoryFilter !== 'all' || priorityFilter !== 'all' || ackFilter !== 'all') && <button type="button" onClick={() => { setSearch(''); setShiftFilter('all'); setCategoryFilter('all'); setPriorityFilter('all'); setAckFilter('all'); }} className={`${BTN.ghost} ${BTN.sm}`}>Clear filters</button>}</div></div>
      {carryQueue.length > 0 && <div className={`${CARD.padded} mb-5`}><div className="flex items-center justify-between gap-2 mb-2"><div><h2 className="text-sm font-semibold text-gray-900">Recent open items</h2><p className="text-xs text-gray-500">Bring unresolved items from the last 4 days into the day you are reviewing now.</p></div><span className={BADGE.blue}>{carryQueue.length} queued</span></div><div className="space-y-2">{carryQueue.map((entry) => <div key={`queue-${entry.id}`} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 mb-1"><span className={`${BADGE[(PRIORITIES.find((p) => p.id === entry.priority) || PRIORITIES[2]).badge]} text-xs`}>{(PRIORITIES.find((p) => p.id === entry.priority) || PRIORITIES[2]).label}</span><span className="text-xs text-gray-500">{parseDate(entry.entry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · {shiftLabel(entry.shift)}</span></div><p className="text-sm text-gray-800 whitespace-pre-wrap">{entry.content}</p></div>{canEdit && <button type="button" onClick={() => carryForward(entry)} className={`${BTN.secondary} ${BTN.xs}`} disabled={saving}>Bring into this day</button>}</div>)}</div></div>}
      {!filteredEntries.length ? <div className={`${CARD.padded} mb-5`}><EmptyState title={search || shiftFilter !== 'all' || categoryFilter !== 'all' || priorityFilter !== 'all' || ackFilter !== 'all' ? 'No entries match these filters' : 'No handover entries recorded yet'} description={search || shiftFilter !== 'all' || categoryFilter !== 'all' || priorityFilter !== 'all' || ackFilter !== 'all' ? 'Try broadening the filters or clearing the search.' : canEdit ? 'Start the handover with a note, risk, or update for the next shift.' : 'No notes have been handed over for this day yet.'} actionLabel={!search && shiftFilter === 'all' && categoryFilter === 'all' && priorityFilter === 'all' && ackFilter === 'all' && canEdit ? 'Add Entry' : null} onAction={!search && shiftFilter === 'all' && categoryFilter === 'all' && priorityFilter === 'all' && ackFilter === 'all' && canEdit ? () => openAdd('E') : null} compact /></div> : SHIFTS.map((shift) => {
        const shiftEntries = filteredEntries.filter((entry) => entry.shift === shift.id);
        return <div key={shift.id} className={`${CARD.base} mb-4`}><div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100"><div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-800">{shift.label}</span><span className={`${BADGE.blue} text-xs`}>{shiftEntries.length}</span></div>{canEdit && <button type="button" onClick={() => openAdd(shift.id)} className={`${BTN.secondary} ${BTN.sm}`}>+ Add Entry</button>}</div>{!shiftEntries.length ? <div className="px-4 py-6"><EmptyState title={`No ${shift.label.toLowerCase()} entries in this view`} description="This shift has no entries that match the current filters." compact /></div> : <div className="divide-y divide-gray-50">{CATEGORIES.map((category) => { const categoryEntries = shiftEntries.filter((entry) => entry.category === category.id); if (!categoryEntries.length) return null; return <div key={category.id} className="px-4 py-3"><div className="flex items-center gap-1.5 mb-2"><span className={`${BADGE[category.badge]} text-xs`}>{category.label}</span></div><div className="space-y-2">{categoryEntries.map((entry) => { const priority = PRIORITIES.find((item) => item.id === entry.priority) || PRIORITIES[2]; const incident = entry.incident_id ? incidentMap[entry.incident_id] : null; const timeStr = entry.created_at ? new Date(entry.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; return <div key={entry.id} className={`rounded-lg bg-gray-50 p-3 border-l-4 ${category.border}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 mb-1"><span className={`${BADGE[priority.badge]} text-xs`}>{priority.label}</span>{incident && <span className="text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">Incident: {incident.type || 'linked'}</span>}</div><p className="text-sm text-gray-800 leading-snug whitespace-pre-wrap">{entry.content}</p><p className="text-xs text-gray-400 mt-1">{entry.author} · {timeStr}</p>{entry.acknowledged_by ? <p className="text-xs text-emerald-600 mt-1">✓ Acknowledged by {entry.acknowledged_by} · {new Date(entry.acknowledged_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p> : <button type="button" onClick={() => acknowledge(entry.id)} disabled={saving} className="mt-1 text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2">Acknowledge</button>}</div>{canEdit && <div className="flex flex-col gap-1 shrink-0"><button type="button" onClick={() => openEdit(entry)} className={`${BTN.ghost} ${BTN.sm} text-xs`}>Edit</button>{entry.priority !== 'info' && <button type="button" onClick={() => carryForward(entry)} className={`${BTN.secondary} ${BTN.xs}`} disabled={saving}>Carry</button>}<button type="button" onClick={() => remove(entry)} disabled={saving} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">Delete</button></div>}</div></div>; })}</div></div>; })}</div>}</div>;
      })}
      <Modal isOpen={!!modal} onClose={closeModal} title={modal === 'add' ? 'Add Handover Entry' : 'Edit Handover Entry'} size="sm"><div className="space-y-3">{modal === 'add' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className={INPUT.label}>Shift <span className="text-red-500">*</span></label><select value={form.shift} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))} className={INPUT.select}>{SHIFTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div><div><label className={INPUT.label}>Category <span className="text-red-500">*</span></label><select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={INPUT.select}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div></div>}<div><label className={INPUT.label}>Priority <span className="text-red-500">*</span></label><div className="flex flex-wrap gap-3">{PRIORITIES.map((p) => <label key={p.id} className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="priority" value={p.id} checked={form.priority === p.id} onChange={() => setForm((f) => ({ ...f, priority: p.id }))} /><span className={`${BADGE[p.badge]} text-xs`}>{p.label}</span></label>)}</div></div><div><label className={INPUT.label}>Content <span className="text-red-500">*</span></label><textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} className={`${INPUT.base} h-28 resize-y`} placeholder="Describe the situation, actions taken, or information to hand over" /></div>{modal === 'add' && todayIncidents.length > 0 && <div><label className={INPUT.label}>Link to Incident (optional)</label><select value={form.incident_id} onChange={(e) => setForm((f) => ({ ...f, incident_id: e.target.value }))} className={INPUT.select}><option value="">None</option>{todayIncidents.map((i) => <option key={i.id} value={i.id}>{i.type} — {i.description?.slice(0, 60) || i.id}</option>)}</select></div>}<div className="border-t pt-3"><FileAttachments caseType="handover_entry" caseId={modal === 'edit' ? editId : null} readOnly={!canEdit} title="Handover Evidence" emptyText="No handover evidence uploaded yet." saveFirstMessage="Scan now to create a handover entry from the inbox, or save this entry first to upload directly here." scanContextOverride={modal === 'add' ? { target: 'handover', entryDate: dateStr, shift: form.shift, category: form.category, priority: form.priority } : undefined} getFiles={getRecordAttachments} uploadFile={uploadRecordAttachment} deleteFile={deleteRecordAttachment} downloadFile={downloadRecordAttachment} /></div></div><div className={MODAL.footer}><button type="button" onClick={closeModal} className={BTN.ghost} disabled={saving}>Cancel</button><button type="button" onClick={saveEntry} className={BTN.primary} disabled={saving || !form.content.trim()}>{saving ? 'Saving...' : 'Save'}</button></div></Modal>
      {ConfirmDialog}
    </div>
  );
}
