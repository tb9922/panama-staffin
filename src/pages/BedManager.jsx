import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BTN, CARD, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  getCurrentHome, getBeds, getBedSummary, getBedHistory,
  createBed, updateBed as updateBedApi, deleteBed as deleteBedApi,
  transitionBedStatus, revertBedTransition, moveBedResident,
  getFinanceResidents,
} from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';

const STATUS_BADGES = {
  available: 'green', reserved: 'blue', occupied: 'gray',
  hospital_hold: 'amber', vacating: 'orange', deep_clean: 'purple',
  maintenance: 'red', decommissioned: 'gray',
};

const STATUS_LABELS = {
  available: 'Available', reserved: 'Reserved', occupied: 'Occupied',
  hospital_hold: 'Hospital Hold', vacating: 'Vacating', deep_clean: 'Deep Clean',
  maintenance: 'Maintenance', decommissioned: 'Decommissioned',
};

const VACATING_REASONS = [
  { value: 'discharged', label: 'Discharged' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'transferred', label: 'Transferred' },
];

const RELEASE_REASONS = [
  { value: 'family_declined', label: 'Family declined' },
  { value: 'assessment_failed', label: 'Assessment failed' },
  { value: 'funding_rejected', label: 'Funding rejected' },
  { value: 'resident_deceased', label: 'Resident deceased' },
  { value: 'resident_recovered', label: 'Resident recovered' },
  { value: 'other', label: 'Other' },
];

const ROOM_TYPES = [
  { value: 'single', label: 'Single' },
  { value: 'shared', label: 'Shared' },
  { value: 'en_suite', label: 'En-suite' },
  { value: 'nursing', label: 'Nursing' },
  { value: 'bariatric', label: 'Bariatric' },
];

// Allowed transitions per current status
const TRANSITIONS = {
  available:      ['reserved', 'occupied', 'maintenance', 'decommissioned'],
  reserved:       ['occupied', 'available'],
  occupied:       ['hospital_hold', 'vacating'],
  hospital_hold:  ['occupied', 'vacating'],
  vacating:       ['deep_clean'],
  deep_clean:     ['available', 'maintenance'],
  maintenance:    ['available', 'decommissioned'],
  decommissioned: ['maintenance'],
};

const TRANSITION_LABELS = {
  reserved: 'Reserve', occupied: 'Admit', available: 'Mark Available',
  hospital_hold: 'Hospital Hold', vacating: 'Discharge / Vacate',
  deep_clean: 'Start Deep Clean', maintenance: 'Set Maintenance',
  decommissioned: 'Decommission',
};

// For transitions FROM reserved back to available, we use a special label
function getTransitionLabel(fromStatus, toStatus) {
  if (fromStatus === 'reserved' && toStatus === 'available') return 'Release Reservation';
  if (fromStatus === 'hospital_hold' && toStatus === 'occupied') return 'Return from Hospital';
  if (fromStatus === 'decommissioned' && toStatus === 'maintenance') return 'Recommission';
  return TRANSITION_LABELS[toStatus] || STATUS_LABELS[toStatus];
}

function defaultDate(daysAhead = 0) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysAhead))
    .toISOString().slice(0, 10);
}

const EMPTY_BED_FORM = {
  room_number: '', room_name: '', room_type: 'single', floor: '', notes: '',
};

function toBedForm(bed) {
  return {
    room_number: bed?.room_number || '',
    room_name: bed?.room_name || '',
    room_type: bed?.room_type || 'single',
    floor: bed?.floor || '',
    notes: bed?.notes || '',
  };
}

export default function BedManager() {
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  const [searchParams, setSearchParams] = useSearchParams();
  const [beds, setBeds] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_BED_FORM });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editBed, setEditBed] = useState(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_BED_FORM });
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [transitionBed, setTransitionBed] = useState(null);
  const [transitionTarget, setTransitionTarget] = useState('');
  const [transitionMeta, setTransitionMeta] = useState({});
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveBed, setMoveBed] = useState(null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyBed, setHistoryBed] = useState(null);
  const [history, setHistory] = useState([]);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertBed, setRevertBed] = useState(null);
  const [revertReason, setRevertReason] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Residents for picker
  const [residents, setResidents] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  useDirtyGuard(
    !!showAddModal ||
    !!showEditModal ||
    !!showTransitionModal ||
    !!showMoveModal ||
    !!showRevertModal ||
    !!showDeleteModal
  );

  const requestedResidentId = useMemo(() => {
    const raw = searchParams.get('residentId');
    const id = raw ? parseInt(raw, 10) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  }, [searchParams]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const home = getCurrentHome();
      const [bedsResult, summaryResult] = await Promise.all([
        getBeds(home),
        getBedSummary(home),
      ]);
      setBeds(bedsResult.beds || bedsResult || []);
      setSummary(summaryResult);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load residents when we might need the picker
  const loadResidents = useCallback(async () => {
    try {
      const home = getCurrentHome();
      const result = await getFinanceResidents(home, { status: 'active' });
      setResidents(result.rows || result || []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (requestedResidentId) loadResidents();
  }, [requestedResidentId, loadResidents]);

  const requestedResident = useMemo(
    () => residents.find(r => r.id === requestedResidentId) || null,
    [residents, requestedResidentId],
  );

  // Sorted beds by room number
  const sortedBeds = useMemo(() =>
    [...beds].sort((a, b) => {
      const numA = parseInt(a.room_number, 10);
      const numB = parseInt(b.room_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.room_number).localeCompare(String(b.room_number));
    }),
    [beds],
  );

  const availableBeds = useMemo(() =>
    beds.filter(b => b.status === 'available'),
    [beds],
  );

  // Occupancy stats
  const occupancyPct = summary?.occupancy_rate ?? (beds.length
    ? Math.round((beds.filter(b => b.status === 'occupied' || b.status === 'hospital_hold').length / beds.length) * 100)
    : 0);
  const totalBeds = summary?.total_beds ?? beds.length;
  const occupiedCount = summary?.occupied ?? beds.filter(b => b.status === 'occupied').length;
  const availableCount = summary?.available ?? beds.filter(b => b.status === 'available').length;
  const vacancyCostPerWeek = summary?.vacancy_cost_per_week ?? null;

  const occupancyColor = occupancyPct >= 90 ? 'green' : occupancyPct >= 80 ? 'amber' : 'red';

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddBed(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const home = getCurrentHome();
      await createBed(home, addForm);
      setShowAddModal(false);
      setAddForm({ ...EMPTY_BED_FORM });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(bed) {
    setEditBed(bed);
    setEditForm(toBedForm(bed));
    setShowEditModal(true);
  }

  async function handleEditBed(e) {
    e.preventDefault();
    if (!editBed) return;
    setSubmitting(true);
    try {
      const home = getCurrentHome();
      await updateBedApi(home, editBed.id, {
        ...editForm,
        clientUpdatedAt: editBed.updated_at,
      });
      setShowEditModal(false);
      setEditBed(null);
      setEditForm({ ...EMPTY_BED_FORM });
      await load();
    } catch (err) {
      if (err.message.includes('409') || err.message.toLowerCase().includes('conflict')) {
        setError('Conflict: bed details changed. Please refresh.');
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openTransition(bed, target) {
    setTransitionBed(bed);
    setTransitionTarget(target);
    const meta = {};
    if (target === 'reserved') meta.reservedUntil = defaultDate(7);
    if (target === 'hospital_hold') meta.holdExpires = defaultDate(14);
    if (target === 'vacating') meta.reason = 'discharged';
    // releasing reservation
    if (bed.status === 'reserved' && target === 'available') meta.releaseReason = 'family_declined';
    setTransitionMeta(meta);
    if (target === 'occupied') {
      if (requestedResidentId) meta.residentId = requestedResidentId;
      loadResidents();
    }
    setShowTransitionModal(true);
  }

  async function handleTransition(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const home = getCurrentHome();
      const data = { status: transitionTarget, clientUpdatedAt: transitionBed.updated_at, ...transitionMeta };
      if (transitionBed.status === 'available' && transitionTarget === 'occupied') data.skipReservation = true;
      await transitionBedStatus(home, transitionBed.id, data);
      if (transitionTarget === 'occupied' && requestedResidentId && data.residentId === requestedResidentId) {
        const next = new URLSearchParams(searchParams);
        next.delete('residentId');
        setSearchParams(next, { replace: true });
      }
      setShowTransitionModal(false);
      setTransitionBed(null);
      await load();
    } catch (err) {
      if (err.message.includes('409') || err.message.toLowerCase().includes('conflict')) {
        setError('Conflict: bed state changed. Please refresh.');
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openMove(bed) {
    setMoveBed(bed);
    setMoveTargetId('');
    setShowMoveModal(true);
  }

  async function handleMove(e) {
    e.preventDefault();
    if (!moveTargetId) return;
    setSubmitting(true);
    try {
      const home = getCurrentHome();
      await moveBedResident(home, moveBed.id, moveTargetId);
      setShowMoveModal(false);
      setMoveBed(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function openHistory(bed) {
    setHistoryBed(bed);
    setHistory([]);
    setShowHistoryModal(true);
    try {
      const home = getCurrentHome();
      const result = await getBedHistory(home, bed.id);
      setHistory(result.transitions || result.history || []);
    } catch (err) {
      setError(err.message);
    }
  }

  function openRevert(bed) {
    setRevertBed(bed);
    setRevertReason('');
    setShowRevertModal(true);
  }

  async function handleRevert(e) {
    e.preventDefault();
    if (!revertReason.trim()) return;
    setSubmitting(true);
    try {
      const home = getCurrentHome();
      await revertBedTransition(home, revertBed.id, revertReason);
      setShowRevertModal(false);
      setRevertBed(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openDelete(bed) {
    setDeleteTarget(bed);
    setShowDeleteModal(true);
  }

  async function handleDeleteBed() {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      const home = getCurrentHome();
      await deleteBedApi(home, deleteTarget.id, deleteTarget.updated_at);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      if (err.message.includes('409') || err.message.toLowerCase().includes('conflict')) {
        setError('Conflict: bed state changed. Please refresh.');
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={PAGE.container}>
        <p className="text-gray-500 text-sm">Loading beds...</p>
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>Beds &amp; Occupancy</h1>
        {canEdit && (
          <button className={BTN.primary} onClick={() => setShowAddModal(true)}>
            Add Bed
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {requestedResidentId && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          Assign a bed for <strong>{requestedResident?.resident_name || `resident #${requestedResidentId}`}</strong>. Choose an available bed and click <strong>Admit</strong>.
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase">Occupancy</p>
          <p className={`text-2xl font-bold ${occupancyColor === 'green' ? 'text-emerald-700' : occupancyColor === 'amber' ? 'text-amber-700' : 'text-red-700'}`}>
            {occupancyPct}%
          </p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase">Total Beds</p>
          <p className="text-2xl font-bold text-gray-900">{totalBeds}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase">Occupied</p>
          <p className="text-2xl font-bold text-gray-900">{occupiedCount}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase">Available</p>
          <p className="text-2xl font-bold text-gray-900">
            {availableCount}
            {vacancyCostPerWeek != null && (
              <span className="text-xs font-normal text-gray-500 ml-2">
                Vacancy cost: {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(vacancyCostPerWeek)}/wk
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Empty state */}
      {beds.length === 0 ? (
        <div className={CARD.padded}>
          <p className="text-gray-500 text-center py-8">
            No beds configured yet.{canEdit ? ' Click "Add Bed" to get started.' : ''}
          </p>
        </div>
      ) : (
        /* Beds table */
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Room</th>
                  <th scope="col" className={TABLE.th}>Room Name</th>
                  <th scope="col" className={TABLE.th}>Floor</th>
                  <th scope="col" className={TABLE.th}>Type</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}>Resident</th>
                  <th scope="col" className={TABLE.th}>Since</th>
                  <th scope="col" className={TABLE.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedBeds.map(bed => (
                  <tr key={bed.id} className={TABLE.tr}>
                    <td className={TABLE.tdMono}>{bed.room_number}</td>
                    <td className={TABLE.td}>{bed.room_name || '--'}</td>
                    <td className={TABLE.td}>{bed.floor ?? '--'}</td>
                    <td className={TABLE.td}>{ROOM_TYPES.find(t => t.value === bed.room_type)?.label || bed.room_type || '--'}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[STATUS_BADGES[bed.status] || 'gray']}>
                        {STATUS_LABELS[bed.status] || bed.status}
                      </span>
                    </td>
                    <td className={TABLE.td}>{bed.resident_name || '--'}</td>
                    <td className={TABLE.td}>{bed.status_since || bed.occupied_since || '--'}</td>
                    <td className={TABLE.td}>
                      <div className="flex flex-wrap gap-1">
                        {canEdit && (
                          <button
                            className={`${BTN.secondary} ${BTN.xs}`}
                            aria-label={`Edit bed ${bed.room_number}`}
                            onClick={() => openEdit(bed)}
                          >
                            Edit
                          </button>
                        )}
                        <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openHistory(bed)}>
                          History
                        </button>
                        {canEdit && (TRANSITIONS[bed.status] || []).map(target => (
                          <button
                            key={target}
                            className={`${BTN.secondary} ${BTN.xs}`}
                            onClick={() => openTransition(bed, target)}
                          >
                            {getTransitionLabel(bed.status, target)}
                          </button>
                        ))}
                        {canEdit && bed.status === 'occupied' && (
                          <button className={`${BTN.secondary} ${BTN.xs}`} onClick={() => openMove(bed)}>
                            Move
                          </button>
                        )}
                        {canEdit && (
                          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openRevert(bed)}>
                            Revert
                          </button>
                        )}
                        {canEdit && bed.status === 'available' && !bed.resident_id && (
                          <button
                            className={`${BTN.danger} ${BTN.xs}`}
                            aria-label={`Delete bed ${bed.room_number}`}
                            onClick={() => openDelete(bed)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add Bed Modal ──────────────────────────────────────────────────── */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Bed">
        <form onSubmit={handleAddBed}>
          <div className="space-y-4">
            <div>
              <label className={INPUT.label}>Room Number *</label>
              <input className={INPUT.base} required value={addForm.room_number}
                onChange={e => setAddForm(f => ({ ...f, room_number: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Room Name</label>
              <input className={INPUT.base} value={addForm.room_name}
                onChange={e => setAddForm(f => ({ ...f, room_name: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Room Type</label>
              <select className={INPUT.select} value={addForm.room_type}
                onChange={e => setAddForm(f => ({ ...f, room_type: e.target.value }))}>
                {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Floor</label>
              <input className={INPUT.base} value={addForm.floor}
                onChange={e => setAddForm(f => ({ ...f, floor: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea className={INPUT.base} rows={2} value={addForm.notes}
                onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowAddModal(false)}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Bed'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Transition Modal ───────────────────────────────────────────────── */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditBed(null);
        }}
        title={editBed ? `Edit Bed - Room ${editBed.room_number}` : 'Edit Bed'}
      >
        <form onSubmit={handleEditBed}>
          <div className="space-y-4">
            <div>
              <label className={INPUT.label}>Room Number *</label>
              <input
                className={INPUT.base}
                required
                value={editForm.room_number}
                disabled={!!editBed && (editBed.status !== 'available' || !!editBed.resident_id)}
                onChange={e => setEditForm(f => ({ ...f, room_number: e.target.value }))}
              />
              {editBed && editBed.status !== 'available' && (
                <p className="mt-1 text-xs text-gray-500">
                  Room numbers can only be changed when the bed is available.
                </p>
              )}
            </div>
            <div>
              <label className={INPUT.label}>Room Name</label>
              <input
                className={INPUT.base}
                value={editForm.room_name}
                onChange={e => setEditForm(f => ({ ...f, room_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={INPUT.label}>Room Type</label>
              <select
                className={INPUT.select}
                value={editForm.room_type}
                onChange={e => setEditForm(f => ({ ...f, room_type: e.target.value }))}
              >
                {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Floor</label>
              <input
                className={INPUT.base}
                value={editForm.floor}
                onChange={e => setEditForm(f => ({ ...f, floor: e.target.value }))}
              />
            </div>
            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea
                className={INPUT.base}
                rows={2}
                value={editForm.notes}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button
              type="button"
              className={BTN.secondary}
              onClick={() => {
                setShowEditModal(false);
                setEditBed(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className={BTN.primary} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showTransitionModal}
        onClose={() => setShowTransitionModal(false)}
        title={transitionBed ? `${getTransitionLabel(transitionBed.status, transitionTarget)} - Room ${transitionBed.room_number}` : 'Transition'}
      >
        <form onSubmit={handleTransition}>
          <div className="space-y-4">
            {/* Resident picker for admit */}
            {transitionTarget === 'occupied' && (
              <div>
                <label className={INPUT.label}>Resident *</label>
                <select className={INPUT.select} required value={transitionMeta.residentId || ''}
                  onChange={e => setTransitionMeta(m => ({ ...m, residentId: parseInt(e.target.value) || undefined }))}>
                  <option value="">Select resident...</option>
                  {residents.map(r => (
                    <option key={r.id} value={r.id}>{r.name || r.resident_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Reserved until */}
            {transitionTarget === 'reserved' && (
              <div>
                <label className={INPUT.label}>Reserved Until</label>
                <input type="date" className={INPUT.base} value={transitionMeta.reservedUntil || ''}
                  onChange={e => setTransitionMeta(m => ({ ...m, reservedUntil: e.target.value }))} />
              </div>
            )}

            {/* Hospital hold expires */}
            {transitionTarget === 'hospital_hold' && (
              <div>
                <label className={INPUT.label}>Hold Expires *</label>
                <input type="date" className={INPUT.base} required value={transitionMeta.holdExpires || ''}
                  onChange={e => setTransitionMeta(m => ({ ...m, holdExpires: e.target.value }))} />
              </div>
            )}

            {/* Vacating reason */}
            {transitionTarget === 'vacating' && (
              <div>
                <label className={INPUT.label}>Reason *</label>
                <select className={INPUT.select} required value={transitionMeta.reason || ''}
                  onChange={e => setTransitionMeta(m => ({ ...m, reason: e.target.value }))}>
                  <option value="">Select reason...</option>
                  {VACATING_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            )}

            {/* Release reason (reserved -> available) */}
            {transitionBed?.status === 'reserved' && transitionTarget === 'available' && (
              <div>
                <label className={INPUT.label}>Release Reason *</label>
                <select className={INPUT.select} required value={transitionMeta.releaseReason || ''}
                  onChange={e => setTransitionMeta(m => ({ ...m, releaseReason: e.target.value }))}>
                  <option value="">Select reason...</option>
                  {RELEASE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            )}

            {/* Generic reason/notes */}
            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea className={INPUT.base} rows={2} value={transitionMeta.notes || ''}
                onChange={e => setTransitionMeta(m => ({ ...m, notes: e.target.value }))} />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowTransitionModal(false)}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting}>
              {submitting ? 'Processing...' : 'Confirm'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Move Resident Modal ────────────────────────────────────────────── */}
      <Modal isOpen={showMoveModal} onClose={() => setShowMoveModal(false)}
        title={moveBed ? `Move Resident - Room ${moveBed.room_number}` : 'Move Resident'}>
        <form onSubmit={handleMove}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Move {moveBed?.resident_name || 'resident'} to a different available bed.
            </p>
            <div>
              <label className={INPUT.label}>Target Bed *</label>
              <select className={INPUT.select} required value={moveTargetId}
                onChange={e => setMoveTargetId(e.target.value)}>
                <option value="">Select available bed...</option>
                {availableBeds.map(b => (
                  <option key={b.id} value={b.id}>Room {b.room_number}{b.room_name ? ` - ${b.room_name}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowMoveModal(false)}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting || !moveTargetId}>
              {submitting ? 'Moving...' : 'Move Resident'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── History Modal ──────────────────────────────────────────────────── */}
      <Modal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)}
        title={historyBed ? `History - Room ${historyBed.room_number}` : 'Bed History'} size="lg">
        {history.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No transition history available.</p>
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Date</th>
                  <th scope="col" className={TABLE.th}>From</th>
                  <th scope="col" className={TABLE.th}>To</th>
                  <th scope="col" className={TABLE.th}>By</th>
                  <th scope="col" className={TABLE.th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={h.id || i} className={TABLE.tr}>
                    <td className={TABLE.td}>{h.changed_at?.slice(0, 16).replace('T', ' ') || '--'}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[STATUS_BADGES[h.from_status] || 'gray']}>
                        {STATUS_LABELS[h.from_status] || h.from_status || '--'}
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      <span className={BADGE[STATUS_BADGES[h.to_status] || 'gray']}>
                        {STATUS_LABELS[h.to_status] || h.to_status}
                      </span>
                    </td>
                    <td className={TABLE.td}>{h.changed_by || '--'}</td>
                    <td className={TABLE.td}>{h.reason || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowHistoryModal(false)}>Close</button>
        </div>
      </Modal>

      {/* ── Revert Modal ───────────────────────────────────────────────────── */}
      <Modal isOpen={showRevertModal} onClose={() => setShowRevertModal(false)}
        title={revertBed ? `Revert - Room ${revertBed.room_number}` : 'Revert Transition'}>
        <form onSubmit={handleRevert}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Revert the most recent status transition for this bed. This action is audited.
            </p>
            <div>
              <label className={INPUT.label}>Reason *</label>
              <textarea className={INPUT.base} rows={2} required value={revertReason}
                onChange={e => setRevertReason(e.target.value)}
                placeholder="Why is this transition being reverted?" />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowRevertModal(false)}>Cancel</button>
            <button type="submit" className={BTN.danger} disabled={submitting || !revertReason.trim()}>
              {submitting ? 'Reverting...' : 'Revert'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteTarget(null);
        }}
        title={deleteTarget ? `Delete Bed - Room ${deleteTarget.room_number}` : 'Delete Bed'}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Delete this bed from the home configuration. This is only allowed for available beds and the action is audited.
          </p>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <strong>Room {deleteTarget?.room_number}</strong>
            {deleteTarget?.room_name ? ` - ${deleteTarget.room_name}` : ''}
          </div>
        </div>
        <div className={MODAL.footer}>
          <button
            type="button"
            className={BTN.secondary}
            onClick={() => {
              setShowDeleteModal(false);
              setDeleteTarget(null);
            }}
          >
            Cancel
          </button>
          <button type="button" className={BTN.danger} disabled={submitting} onClick={handleDeleteBed}>
            {submitting ? 'Deleting...' : 'Delete Bed'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
