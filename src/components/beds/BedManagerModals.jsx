import Modal from '../Modal.jsx';
import FileAttachments from '../FileAttachments.jsx';
import { getRecordAttachments, uploadRecordAttachment, deleteRecordAttachment, downloadRecordAttachment } from '../../lib/api.js';
import { BADGE, BTN, INPUT, MODAL, TABLE } from '../../lib/design.js';

export default function BedManagerModals({
  showAddModal,
  setShowAddModal,
  addForm,
  setAddForm,
  handleAddBed,
  showEditModal,
  setShowEditModal,
  editBed,
  setEditBed,
  editForm,
  setEditForm,
  handleEditBed,
  showTransitionModal,
  setShowTransitionModal,
  transitionBed,
  transitionTarget,
  transitionMeta,
  setTransitionMeta,
  handleTransition,
  showMoveModal,
  setShowMoveModal,
  moveBed,
  moveTargetId,
  setMoveTargetId,
  handleMove,
  showHistoryModal,
  setShowHistoryModal,
  historyBed,
  history,
  showRevertModal,
  setShowRevertModal,
  revertBed,
  revertReason,
  setRevertReason,
  handleRevert,
  showDeleteModal,
  setShowDeleteModal,
  deleteTarget,
  setDeleteTarget,
  handleDeleteBed,
  submitting,
  residents,
  availableBeds,
  roomTypes,
  vacatingReasons,
  releaseReasons,
  statusBadges,
  statusLabels,
  getTransitionLabel,
}) {
  return (
    <>
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Bed">
        <form onSubmit={handleAddBed}>
          <div className="space-y-4">
            <div>
              <label className={INPUT.label}>Room Number *</label>
              <input className={INPUT.base} required value={addForm.room_number} onChange={e => setAddForm(form => ({ ...form, room_number: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Room Name</label>
              <input className={INPUT.base} value={addForm.room_name} onChange={e => setAddForm(form => ({ ...form, room_name: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Room Type</label>
              <select className={INPUT.select} value={addForm.room_type} onChange={e => setAddForm(form => ({ ...form, room_type: e.target.value }))}>
                {roomTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Floor</label>
              <input className={INPUT.base} value={addForm.floor} onChange={e => setAddForm(form => ({ ...form, floor: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea className={INPUT.base} rows={2} value={addForm.notes} onChange={e => setAddForm(form => ({ ...form, notes: e.target.value }))} />
            </div>
            <div className="border-t pt-4">
              <FileAttachments
                caseType="bed"
                caseId={null}
                title="Bed Evidence"
                saveFirstMessage="Save the bed first, then reopen it here to upload room photos and supporting evidence."
                getFiles={getRecordAttachments}
                uploadFile={uploadRecordAttachment}
                deleteFile={deleteRecordAttachment}
                downloadFile={downloadRecordAttachment}
              />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowAddModal(false)}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting}>{submitting ? 'Adding...' : 'Add Bed'}</button>
          </div>
        </form>
      </Modal>

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
                onChange={e => setEditForm(form => ({ ...form, room_number: e.target.value }))}
              />
              {editBed && editBed.status !== 'available' && (
                <p className="mt-1 text-xs text-gray-500">Room numbers can only be changed when the bed is available.</p>
              )}
            </div>
            <div>
              <label className={INPUT.label}>Room Name</label>
              <input className={INPUT.base} value={editForm.room_name} onChange={e => setEditForm(form => ({ ...form, room_name: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Room Type</label>
              <select className={INPUT.select} value={editForm.room_type} onChange={e => setEditForm(form => ({ ...form, room_type: e.target.value }))}>
                {roomTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Floor</label>
              <input className={INPUT.base} value={editForm.floor} onChange={e => setEditForm(form => ({ ...form, floor: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea className={INPUT.base} rows={2} value={editForm.notes} onChange={e => setEditForm(form => ({ ...form, notes: e.target.value }))} />
            </div>
            {editBed && (
              <div className="border-t pt-4">
                <FileAttachments
                  caseType="bed"
                  caseId={editBed.id}
                  title="Bed Evidence"
                  emptyText="No bed evidence uploaded yet."
                  getFiles={getRecordAttachments}
                  uploadFile={uploadRecordAttachment}
                  deleteFile={deleteRecordAttachment}
                  downloadFile={downloadRecordAttachment}
                />
              </div>
            )}
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => { setShowEditModal(false); setEditBed(null); }}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting}>{submitting ? 'Saving...' : 'Save Changes'}</button>
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
            {transitionTarget === 'occupied' && (
              <div>
                <label className={INPUT.label}>Resident *</label>
                <select className={INPUT.select} required value={transitionMeta.residentId || ''} onChange={e => setTransitionMeta(meta => ({ ...meta, residentId: parseInt(e.target.value, 10) || undefined }))}>
                  <option value="">Select resident...</option>
                  {residents.map(resident => (
                    <option key={resident.id} value={resident.id}>{resident.name || resident.resident_name}</option>
                  ))}
                </select>
              </div>
            )}

            {transitionTarget === 'reserved' && (
              <div>
                <label className={INPUT.label}>Reserved Until</label>
                <input type="date" className={INPUT.base} value={transitionMeta.reservedUntil || ''} onChange={e => setTransitionMeta(meta => ({ ...meta, reservedUntil: e.target.value }))} />
              </div>
            )}

            {transitionTarget === 'hospital_hold' && (
              <div>
                <label className={INPUT.label}>Hold Expires *</label>
                <input type="date" className={INPUT.base} required value={transitionMeta.holdExpires || ''} onChange={e => setTransitionMeta(meta => ({ ...meta, holdExpires: e.target.value }))} />
              </div>
            )}

            {transitionTarget === 'vacating' && (
              <div>
                <label className={INPUT.label}>Reason *</label>
                <select className={INPUT.select} required value={transitionMeta.reason || ''} onChange={e => setTransitionMeta(meta => ({ ...meta, reason: e.target.value }))}>
                  <option value="">Select reason...</option>
                  {vacatingReasons.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                </select>
              </div>
            )}

            {transitionBed?.status === 'reserved' && transitionTarget === 'available' && (
              <div>
                <label className={INPUT.label}>Release Reason *</label>
                <select className={INPUT.select} required value={transitionMeta.releaseReason || ''} onChange={e => setTransitionMeta(meta => ({ ...meta, releaseReason: e.target.value }))}>
                  <option value="">Select reason...</option>
                  {releaseReasons.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea className={INPUT.base} rows={2} value={transitionMeta.notes || ''} onChange={e => setTransitionMeta(meta => ({ ...meta, notes: e.target.value }))} />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowTransitionModal(false)}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting}>{submitting ? 'Processing...' : 'Confirm'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showMoveModal} onClose={() => setShowMoveModal(false)} title={moveBed ? `Move Resident - Room ${moveBed.room_number}` : 'Move Resident'}>
        <form onSubmit={handleMove}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Move {moveBed?.resident_name || 'resident'} to a different available bed.</p>
            <div>
              <label className={INPUT.label}>Target Bed *</label>
              <select className={INPUT.select} required value={moveTargetId} onChange={e => setMoveTargetId(e.target.value)}>
                <option value="">Select available bed...</option>
                {availableBeds.map(bed => (
                  <option key={bed.id} value={bed.id}>Room {bed.room_number}{bed.room_name ? ` - ${bed.room_name}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowMoveModal(false)}>Cancel</button>
            <button type="submit" className={BTN.primary} disabled={submitting || !moveTargetId}>{submitting ? 'Moving...' : 'Move Resident'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} title={historyBed ? `History - Room ${historyBed.room_number}` : 'Bed History'} size="lg">
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
                {history.map((entry, index) => (
                  <tr key={entry.id || index} className={TABLE.tr}>
                    <td className={TABLE.td}>{entry.changed_at?.slice(0, 16).replace('T', ' ') || '--'}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[statusBadges[entry.from_status] || 'gray']}>{statusLabels[entry.from_status] || entry.from_status || '--'}</span>
                    </td>
                    <td className={TABLE.td}>
                      <span className={BADGE[statusBadges[entry.to_status] || 'gray']}>{statusLabels[entry.to_status] || entry.to_status}</span>
                    </td>
                    <td className={TABLE.td}>{entry.changed_by || '--'}</td>
                    <td className={TABLE.td}>{entry.reason || '--'}</td>
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

      <Modal isOpen={showRevertModal} onClose={() => setShowRevertModal(false)} title={revertBed ? `Revert - Room ${revertBed.room_number}` : 'Revert Transition'}>
        <form onSubmit={handleRevert}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Revert the most recent status transition for this bed. This action is audited.</p>
            <div>
              <label className={INPUT.label}>Reason *</label>
              <textarea className={INPUT.base} rows={2} required value={revertReason} onChange={e => setRevertReason(e.target.value)} placeholder="Why is this transition being reverted?" />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button type="button" className={BTN.secondary} onClick={() => setShowRevertModal(false)}>Cancel</button>
            <button type="submit" className={BTN.danger} disabled={submitting || !revertReason.trim()}>{submitting ? 'Reverting...' : 'Revert'}</button>
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
          <p className="text-sm text-gray-600">Delete this bed from the home configuration. This is only allowed for available beds and the action is audited.</p>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <strong>Room {deleteTarget?.room_number}</strong>
            {deleteTarget?.room_name ? ` - ${deleteTarget.room_name}` : ''}
          </div>
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }}>Cancel</button>
          <button type="button" className={BTN.danger} disabled={submitting} onClick={handleDeleteBed}>{submitting ? 'Deleting...' : 'Delete Bed'}</button>
        </div>
      </Modal>
    </>
  );
}
