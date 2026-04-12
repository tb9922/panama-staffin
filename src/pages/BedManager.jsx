import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BADGE, BTN, CARD, PAGE, TABLE } from '../lib/design.js';
import {
  getCurrentHome, getBeds, getBedSummary, getBedHistory,
  createBed, updateBed as updateBedApi, deleteBed as deleteBedApi,
  transitionBedStatus, revertBedTransition, moveBedResident,
  getFinanceResidents,
} from '../lib/api.js';
import { addDaysLocalISO, todayLocalISO } from '../lib/localDates.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import BedManagerModals from '../components/beds/BedManagerModals.jsx';

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
  return addDaysLocalISO(todayLocalISO(), daysAhead);
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

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {requestedResident && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="font-medium">Assign a bed for {requestedResident.resident_name || requestedResident.name}</span>
          <span className="ml-2 text-blue-700">Select an available bed and choose Admit to continue.</span>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase text-gray-500">Occupancy</p>
          <p className={`text-2xl font-bold ${occupancyColor === 'green' ? 'text-emerald-700' : occupancyColor === 'amber' ? 'text-amber-700' : 'text-red-700'}`}>
            {occupancyPct}%
          </p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase text-gray-500">Total Beds</p>
          <p className="text-2xl font-bold text-gray-900">{totalBeds}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase text-gray-500">Occupied</p>
          <p className="text-2xl font-bold text-gray-900">{occupiedCount}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase text-gray-500">Available</p>
          <p className="text-2xl font-bold text-gray-900">
            {availableCount}
            {vacancyCostPerWeek != null && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                Vacancy cost: {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(vacancyCostPerWeek)}/wk
              </span>
            )}
          </p>
        </div>
      </div>

      {beds.length === 0 ? (
        <div className={CARD.padded}>
          <p className="py-8 text-center text-gray-500">
            No beds configured yet.{canEdit ? ' Click "Add Bed" to get started.' : ''}
          </p>
        </div>
      ) : (
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
                    <td className={TABLE.td}>{ROOM_TYPES.find(type => type.value === bed.room_type)?.label || bed.room_type || '--'}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[STATUS_BADGES[bed.status] || 'gray']}>
                        {STATUS_LABELS[bed.status] || bed.status}
                      </span>
                    </td>
                    <td className={TABLE.td}>{bed.resident_name || '--'}</td>
                    <td className={TABLE.td}>{bed.status_since || '--'}</td>
                    <td className={TABLE.td}>
                      <div className="flex flex-wrap gap-1">
                        <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openHistory(bed)}>
                          History
                        </button>
                        {canEdit && (
                          <button
                            className={`${BTN.ghost} ${BTN.xs}`}
                            aria-label={`Edit bed ${bed.room_number}`}
                            onClick={() => openEdit(bed)}
                          >
                            Edit
                          </button>
                        )}
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
                        {canEdit && bed.status === 'available' && (
                          <button
                            className={`${BTN.ghost} ${BTN.xs}`}
                            aria-label={`Delete bed ${bed.room_number}`}
                            onClick={() => openDelete(bed)}
                          >
                            Delete
                          </button>
                        )}
                        {canEdit && (
                          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openRevert(bed)}>
                            Revert
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

      <BedManagerModals
        showAddModal={showAddModal}
        setShowAddModal={setShowAddModal}
        addForm={addForm}
        setAddForm={setAddForm}
        handleAddBed={handleAddBed}
        showEditModal={showEditModal}
        setShowEditModal={setShowEditModal}
        editBed={editBed}
        setEditBed={setEditBed}
        editForm={editForm}
        setEditForm={setEditForm}
        handleEditBed={handleEditBed}
        showTransitionModal={showTransitionModal}
        setShowTransitionModal={setShowTransitionModal}
        transitionBed={transitionBed}
        transitionTarget={transitionTarget}
        transitionMeta={transitionMeta}
        setTransitionMeta={setTransitionMeta}
        handleTransition={handleTransition}
        showMoveModal={showMoveModal}
        setShowMoveModal={setShowMoveModal}
        moveBed={moveBed}
        moveTargetId={moveTargetId}
        setMoveTargetId={setMoveTargetId}
        handleMove={handleMove}
        showHistoryModal={showHistoryModal}
        setShowHistoryModal={setShowHistoryModal}
        historyBed={historyBed}
        history={history}
        showRevertModal={showRevertModal}
        setShowRevertModal={setShowRevertModal}
        revertBed={revertBed}
        revertReason={revertReason}
        setRevertReason={setRevertReason}
        handleRevert={handleRevert}
        showDeleteModal={showDeleteModal}
        setShowDeleteModal={setShowDeleteModal}
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        handleDeleteBed={handleDeleteBed}
        submitting={submitting}
        residents={residents}
        availableBeds={availableBeds}
        roomTypes={ROOM_TYPES}
        vacatingReasons={VACATING_REASONS}
        releaseReasons={RELEASE_REASONS}
        statusBadges={STATUS_BADGES}
        statusLabels={STATUS_LABELS}
        getTransitionLabel={getTransitionLabel}
      />
    </div>
  );
}
