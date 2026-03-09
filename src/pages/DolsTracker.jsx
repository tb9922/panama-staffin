import { useState, useMemo, useEffect, useCallback } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getCurrentHome, getDols, createDols, updateDols, deleteDols,
  createMcaAssessment, updateMcaAssessment, deleteMcaAssessment, getLoggedInUser,
} from '../lib/api.js';
import {
  getDolsStatus, getMcaStatus, getDolsStats,
  APPLICATION_TYPES, DOLS_STATUSES, MCA_STATUSES,
} from '../lib/dols.js';

const EMPTY_DOLS_FORM = {
  resident_name: '', dob: '', room_number: '',
  application_type: 'dols', application_date: '',
  authorised: false, authorisation_date: '', expiry_date: '',
  authorisation_number: '', authorising_authority: '',
  restrictions: [],
  reviewed_date: '', review_status: '', next_review_date: '',
  notes: '',
};

const EMPTY_MCA_FORM = {
  resident_name: '', assessment_date: '', assessor: '',
  decision_area: '', lacks_capacity: false, best_interest_decision: '',
  next_review_date: '', notes: '',
};

export default function DolsTracker() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [dols, setDols] = useState([]);
  const [mcaAssessments, setMcaAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_DOLS_FORM });
  const [viewMode, setViewMode] = useState('dols');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useDirtyGuard(showModal);

  const today = useLiveDate();

  const load = useCallback(async () => {
    try {
      setError(null);
      const home = getCurrentHome();
      const result = await getDols(home);
      setDols(result.dols || []);
      setMcaAssessments(result.mcaAssessments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() =>
    getDolsStats(dols, mcaAssessments, today),
    [dols, mcaAssessments, today]);

  // DoLS/LPS list — sorted by expiry (soonest first), nulls last
  const filteredDols = useMemo(() => {
    let list = [...dols];
    if (filterType) list = list.filter(d => d.application_type === filterType);
    if (filterStatus) {
      list = list.filter(d => getDolsStatus(d, today).status === filterStatus);
    }
    list.sort((a, b) => {
      const ea = a.expiry_date || '9999-12-31';
      const eb = b.expiry_date || '9999-12-31';
      return ea.localeCompare(eb);
    });
    return list;
  }, [dols, filterType, filterStatus, today]);

  // MCA list — sorted by next_review_date (soonest first), nulls last
  const filteredMca = useMemo(() => {
    let list = [...mcaAssessments];
    list.sort((a, b) => {
      const ra = a.next_review_date || '9999-12-31';
      const rb = b.next_review_date || '9999-12-31';
      return ra.localeCompare(rb);
    });
    return list;
  }, [mcaAssessments]);

  // ── DoLS CRUD ──────────────────────────────────────────────────────────────

  function openAddDols() {
    setEditingId(null);
    setForm({ ...EMPTY_DOLS_FORM, application_date: today });
    setShowModal(true);
  }

  function openEditDols(dol) {
    setEditingId(dol.id);
    // Migrate legacy string restrictions to array format
    let restrictions = dol.restrictions || [];
    if (typeof restrictions === 'string') {
      restrictions = restrictions.trim() ? [restrictions] : [];
    }
    setForm({
      resident_name: dol.resident_name || '',
      dob: dol.dob || '',
      room_number: dol.room_number || '',
      application_type: dol.application_type || 'dols',
      application_date: dol.application_date || '',
      authorised: !!dol.authorised,
      authorisation_date: dol.authorisation_date || '',
      expiry_date: dol.expiry_date || '',
      authorisation_number: dol.authorisation_number || '',
      authorising_authority: dol.authorising_authority || '',
      restrictions,
      reviewed_date: dol.reviewed_date || '',
      review_status: dol.review_status || '',
      next_review_date: dol.next_review_date || '',
      notes: dol.notes || '',
    });
    setShowModal(true);
  }

  async function handleSaveDols() {
    if (!form.resident_name || !form.application_date) return;
    const home = getCurrentHome();
    try {
      if (editingId) {
        await updateDols(home, editingId, form);
      } else {
        await createDols(home, form);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  }

  async function handleDeleteDols() {
    if (!editingId || !confirm('Delete this DoLS/LPS record?')) return;
    const home = getCurrentHome();
    try {
      await deleteDols(home, editingId);
      setShowModal(false);
      await load();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  // ── MCA CRUD ───────────────────────────────────────────────────────────────

  function openAddMca() {
    setEditingId(null);
    setForm({ ...EMPTY_MCA_FORM, assessment_date: today });
    setShowModal(true);
  }

  function openEditMca(mca) {
    setEditingId(mca.id);
    setForm({
      resident_name: mca.resident_name || '',
      assessment_date: mca.assessment_date || '',
      assessor: mca.assessor || '',
      decision_area: mca.decision_area || '',
      lacks_capacity: !!mca.lacks_capacity,
      best_interest_decision: mca.best_interest_decision || '',
      next_review_date: mca.next_review_date || '',
      notes: mca.notes || '',
    });
    setShowModal(true);
  }

  async function handleSaveMca() {
    if (!form.resident_name || !form.assessment_date) return;
    const home = getCurrentHome();
    try {
      if (editingId) {
        await updateMcaAssessment(home, editingId, form);
      } else {
        await createMcaAssessment(home, form);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  }

  async function handleDeleteMca() {
    if (!editingId || !confirm('Delete this MCA assessment?')) return;
    const home = getCurrentHome();
    try {
      await deleteMcaAssessment(home, editingId);
      setShowModal(false);
      await load();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  // ── Excel Export ───────────────────────────────────────────────────────────

  function handleExport() {
    const dolsRows = dols.map(dol => {
      const st = getDolsStatus(dol, today);
      const typeDef = APPLICATION_TYPES.find(t => t.id === dol.application_type);
      const statusDef = DOLS_STATUSES.find(s => s.id === st.status);
      return [
        dol.resident_name,
        ...(isAdmin ? [dol.dob || ''] : []),
        dol.room_number || '',
        typeDef?.name || dol.application_type, dol.application_date,
        dol.authorised ? 'Yes' : 'No', dol.authorisation_date || '',
        dol.expiry_date || '', statusDef?.name || st.status,
        dol.authorisation_number || '', dol.authorising_authority || '',
        Array.isArray(dol.restrictions) ? dol.restrictions.join('; ') : (dol.restrictions || ''), dol.reviewed_date || '',
        dol.next_review_date || '', dol.notes || '',
      ];
    });

    const mcaRows = mcaAssessments.map(mca => {
      const st = getMcaStatus(mca, today);
      const statusDef = MCA_STATUSES.find(s => s.id === st.status);
      return [
        mca.resident_name, mca.assessment_date, mca.assessor || '',
        mca.decision_area || '', mca.lacks_capacity ? 'Yes' : 'No',
        mca.best_interest_decision || '', mca.next_review_date || '',
        statusDef?.name || st.status, mca.notes || '',
      ];
    });

    downloadXLSX(`DoLS_MCA_Register_${today}`, [
      {
        name: 'DoLS-LPS',
        headers: ['Resident', ...(isAdmin ? ['DOB'] : []), 'Room', 'Type', 'Applied', 'Authorised',
          'Auth Date', 'Expiry', 'Status', 'Auth Number', 'Authority',
          'Restrictions', 'Reviewed', 'Next Review', 'Notes'],
        rows: dolsRows,
      },
      {
        name: 'MCA Assessments',
        headers: ['Resident', 'Assessment Date', 'Assessor', 'Decision Area',
          'Lacks Capacity', 'Best Interest Decision', 'Next Review', 'Status', 'Notes'],
        rows: mcaRows,
      },
    ]);
  }

  // ── Badge helpers ──────────────────────────────────────────────────────────

  const dolsStatusBadge = (status) => {
    const def = DOLS_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };
  const mcaStatusBadge = (status) => {
    const def = MCA_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };
  const typeBadge = (type) => type === 'lps' ? BADGE.purple : BADGE.blue;

  if (loading) {
    return <div className={PAGE.container}><p className="text-gray-400">Loading...</p></div>;
  }
  if (error) {
    return <div className={PAGE.container}><p className="text-red-500">Error: {error}</p></div>;
  }

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>DoLS/LPS & MCA Tracker</h1>
          <p className={PAGE.subtitle}>CQC Regulation 11/13 — Consent & Deprivation of Liberty</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {isAdmin && <button onClick={viewMode === 'dols' ? openAddDols : openAddMca} className={BTN.primary}>
            + {viewMode === 'dols' ? 'New DoLS/LPS' : 'New MCA'}
          </button>}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={`${CARD.padded} ${stats.activeCount === 0 && dols.length > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className="text-xs font-medium text-gray-500">Active DoLS/LPS</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.activeCount}</div>
          <div className="text-[10px] text-gray-400">Authorised & current</div>
        </div>
        <div className={`${CARD.padded} ${stats.expiringSoon > 0 ? 'border-amber-200 bg-amber-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.expiringSoon > 0 ? 'text-amber-600' : 'text-gray-500'}`}>Expiring &lt;90 days</div>
          <div className={`text-2xl font-bold ${stats.expiringSoon > 0 ? 'text-amber-700' : 'text-gray-900'} mt-0.5`}>{stats.expiringSoon}</div>
          <div className="text-[10px] text-gray-400">Renewal required</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">MCA Assessments</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.mcaTotal}</div>
          <div className="text-[10px] text-gray-400">Total recorded</div>
        </div>
        <div className={`${CARD.padded} ${(stats.mcaOverdue + stats.reviewsOverdue + stats.expired) > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${(stats.mcaOverdue + stats.reviewsOverdue + stats.expired) > 0 ? 'text-red-600' : 'text-gray-500'}`}>Reviews Overdue</div>
          <div className={`text-2xl font-bold ${(stats.mcaOverdue + stats.reviewsOverdue + stats.expired) > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>
            {stats.mcaOverdue + stats.reviewsOverdue + stats.expired}
          </div>
          <div className="text-[10px] text-gray-400">DoLS expired + MCA overdue</div>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-1 mb-4">
        <button onClick={() => { setViewMode('dols'); setShowModal(false); }}
          className={`${viewMode === 'dols' ? BTN.primary : BTN.ghost} ${BTN.sm}`}>
          DoLS / LPS
        </button>
        <button onClick={() => { setViewMode('mca'); setShowModal(false); }}
          className={`${viewMode === 'mca' ? BTN.primary : BTN.ghost} ${BTN.sm}`}>
          MCA Assessments
        </button>
      </div>

      {/* ── DoLS/LPS View ─────────────────────────────────────────────────── */}
      {viewMode === 'dols' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4 print:hidden">
            <select className={`${INPUT.select} w-auto`} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">All Types</option>
              {APPLICATION_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className={`${INPUT.select} w-auto`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {DOLS_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="text-xs text-gray-400 self-center">{filteredDols.length} records</span>
          </div>

          {/* DoLS Table */}
          <div className={CARD.flush}>
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Resident</th>
                    <th scope="col" className={TABLE.th}>Type</th>
                    <th scope="col" className={TABLE.th}>Applied</th>
                    <th scope="col" className={TABLE.th}>Authorised</th>
                    <th scope="col" className={TABLE.th}>Expiry</th>
                    <th scope="col" className={TABLE.th}>Status</th>
                    <th scope="col" className={TABLE.th}>Room</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDols.length === 0 && (
                    <tr><td colSpan={7} className={TABLE.empty}>No DoLS/LPS records</td></tr>
                  )}
                  {filteredDols.map(dol => {
                    const st = getDolsStatus(dol, today);
                    const typeDef = APPLICATION_TYPES.find(t => t.id === dol.application_type);
                    const statusDef = DOLS_STATUSES.find(s => s.id === st.status);
                    return (
                      <tr key={dol.id} className={`${TABLE.tr} ${isAdmin ? 'cursor-pointer' : ''}`} onClick={() => isAdmin && openEditDols(dol)}>
                        <td className={TABLE.td}>{dol.resident_name}</td>
                        <td className={TABLE.td}><span className={typeBadge(dol.application_type)}>{typeDef?.name || dol.application_type}</span></td>
                        <td className={TABLE.td}>{dol.application_date}</td>
                        <td className={TABLE.td}>{dol.authorisation_date || '-'}</td>
                        <td className={TABLE.td}>{dol.expiry_date || '-'}</td>
                        <td className={TABLE.td}><span className={dolsStatusBadge(st.status)}>{statusDef?.name || st.status}</span></td>
                        <td className={TABLE.td}>{dol.room_number || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── MCA View ──────────────────────────────────────────────────────── */}
      {viewMode === 'mca' && (
        <>
          <div className={CARD.flush}>
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Resident</th>
                    <th scope="col" className={TABLE.th}>Assessment Date</th>
                    <th scope="col" className={TABLE.th}>Assessor</th>
                    <th scope="col" className={TABLE.th}>Decision Area</th>
                    <th scope="col" className={TABLE.th}>Capacity</th>
                    <th scope="col" className={TABLE.th}>Next Review</th>
                    <th scope="col" className={TABLE.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMca.length === 0 && (
                    <tr><td colSpan={7} className={TABLE.empty}>No MCA assessments recorded</td></tr>
                  )}
                  {filteredMca.map(mca => {
                    const st = getMcaStatus(mca, today);
                    const statusDef = MCA_STATUSES.find(s => s.id === st.status);
                    return (
                      <tr key={mca.id} className={`${TABLE.tr} ${isAdmin ? 'cursor-pointer' : ''}`} onClick={() => isAdmin && openEditMca(mca)}>
                        <td className={TABLE.td}>{mca.resident_name}</td>
                        <td className={TABLE.td}>{mca.assessment_date}</td>
                        <td className={TABLE.td}>{mca.assessor || '-'}</td>
                        <td className={TABLE.td}>{mca.decision_area || '-'}</td>
                        <td className={TABLE.td}>
                          {mca.lacks_capacity
                            ? <span className={BADGE.red}>Lacks Capacity</span>
                            : <span className={BADGE.green}>Has Capacity</span>}
                        </td>
                        <td className={TABLE.td}>{mca.next_review_date || '-'}</td>
                        <td className={TABLE.td}><span className={mcaStatusBadge(st.status)}>{statusDef?.name || st.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── DoLS/LPS Modal ────────────────────────────────────────────────── */}
      <Modal isOpen={showModal && viewMode === 'dols'} onClose={() => setShowModal(false)} title={editingId ? 'Edit DoLS/LPS' : 'New DoLS/LPS Application'} size="lg">

            <div className="space-y-3">
              {/* Resident Info */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={INPUT.label}>Resident Name *</label>
                  <input type="text" className={INPUT.base} value={form.resident_name}
                    onChange={e => setForm({ ...form, resident_name: e.target.value })} />
                </div>
                {isAdmin && <div>
                  <label className={INPUT.label}>Date of Birth</label>
                  <input type="date" className={INPUT.base} value={form.dob}
                    onChange={e => setForm({ ...form, dob: e.target.value })} />
                </div>}
                <div>
                  <label className={INPUT.label}>Room Number</label>
                  <input type="text" className={INPUT.base} value={form.room_number}
                    onChange={e => setForm({ ...form, room_number: e.target.value })} />
                </div>
              </div>

              {/* Application */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Application Type *</label>
                  <select className={INPUT.select} value={form.application_type}
                    onChange={e => setForm({ ...form, application_type: e.target.value })}>
                    {APPLICATION_TYPES.map(t => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Application Date *</label>
                  <input type="date" className={INPUT.base} value={form.application_date}
                    onChange={e => setForm({ ...form, application_date: e.target.value })} />
                </div>
              </div>

              {/* Authorisation */}
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.authorised}
                  onChange={e => setForm({ ...form, authorised: e.target.checked })} className="accent-blue-600" />
                Authorisation granted
              </label>

              {form.authorised && (
                <div className="ml-6 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Authorisation Date</label>
                      <input type="date" className={INPUT.base} value={form.authorisation_date}
                        onChange={e => setForm({ ...form, authorisation_date: e.target.value })} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Expiry Date</label>
                      <input type="date" className={INPUT.base} value={form.expiry_date}
                        onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Authorisation Number</label>
                      <input type="text" className={INPUT.base} value={form.authorisation_number}
                        onChange={e => setForm({ ...form, authorisation_number: e.target.value })} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Authorising Authority</label>
                      <input type="text" className={INPUT.base} placeholder="e.g. Local Authority"
                        value={form.authorising_authority}
                        onChange={e => setForm({ ...form, authorising_authority: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Restrictions */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={INPUT.label}>Restrictions / Conditions</label>
                  <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                    onClick={() => setForm({ ...form, restrictions: [...form.restrictions, ''] })}>
                    + Add Restriction
                  </button>
                </div>
                {form.restrictions.length === 0 && <p className="text-xs text-gray-400">No restrictions recorded</p>}
                {form.restrictions.map((r, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input type="text" className={`${INPUT.sm} flex-1`} placeholder="Restriction detail..."
                      value={r}
                      onChange={e => { const arr = [...form.restrictions]; arr[i] = e.target.value; setForm({ ...form, restrictions: arr }); }} />
                    <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                      onClick={() => setForm({ ...form, restrictions: form.restrictions.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                ))}
              </div>

              {/* Review */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Last Reviewed</label>
                  <input type="date" className={INPUT.base} value={form.reviewed_date}
                    onChange={e => setForm({ ...form, reviewed_date: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Next Review Date</label>
                  <input type="date" className={INPUT.base} value={form.next_review_date}
                    onChange={e => setForm({ ...form, next_review_date: e.target.value })} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={`${INPUT.base} h-16`} value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            {/* Footer */}
            <div className={MODAL.footer}>
              {editingId && isAdmin && (
                <button onClick={handleDeleteDols} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              {isAdmin && (
                <button onClick={handleSaveDols}
                  disabled={!form.resident_name || !form.application_date}
                  className={BTN.primary}>
                  {editingId ? 'Update' : 'Save'}
                </button>
              )}
            </div>
      </Modal>

      {/* ── MCA Modal ─────────────────────────────────────────────────────── */}
      <Modal isOpen={showModal && viewMode === 'mca'} onClose={() => setShowModal(false)} title={editingId ? 'Edit MCA Assessment' : 'New MCA Assessment'} size="lg">

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Resident Name *</label>
                  <input type="text" className={INPUT.base} value={form.resident_name}
                    onChange={e => setForm({ ...form, resident_name: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Assessment Date *</label>
                  <input type="date" className={INPUT.base} value={form.assessment_date}
                    onChange={e => setForm({ ...form, assessment_date: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Assessor</label>
                  <input type="text" className={INPUT.base} placeholder="Name of assessor"
                    value={form.assessor}
                    onChange={e => setForm({ ...form, assessor: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Decision Area</label>
                  <input type="text" className={INPUT.base} placeholder="e.g. Financial, Medical, Residence"
                    value={form.decision_area}
                    onChange={e => setForm({ ...form, decision_area: e.target.value })} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.lacks_capacity}
                  onChange={e => setForm({ ...form, lacks_capacity: e.target.checked })} className="accent-blue-600" />
                Person lacks capacity for this decision
              </label>

              {form.lacks_capacity && (
                <div>
                  <label className={INPUT.label}>Best Interest Decision</label>
                  <textarea className={`${INPUT.base} h-20`}
                    placeholder="Document the best interest decision made..."
                    value={form.best_interest_decision}
                    onChange={e => setForm({ ...form, best_interest_decision: e.target.value })} />
                </div>
              )}

              <div>
                <label className={INPUT.label}>Next Review Date</label>
                <input type="date" className={INPUT.base} value={form.next_review_date}
                  onChange={e => setForm({ ...form, next_review_date: e.target.value })} />
              </div>

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={`${INPUT.base} h-16`} value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            {/* Footer */}
            <div className={MODAL.footer}>
              {editingId && isAdmin && (
                <button onClick={handleDeleteMca} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              {isAdmin && (
                <button onClick={handleSaveMca}
                  disabled={!form.resident_name || !form.assessment_date}
                  className={BTN.primary}>
                  {editingId ? 'Update' : 'Save'}
                </button>
              )}
            </div>
      </Modal>
    </div>
  );
}
