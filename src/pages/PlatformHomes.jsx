import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  listPlatformHomes, createPlatformHome, updatePlatformHome, deletePlatformHome,
} from '../lib/api.js';

const SCAN_TARGET_OPTIONS = [
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'finance_ap', label: 'Finance AP' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'cqc', label: 'CQC' },
];

const DEFAULT_SCAN_TARGETS = SCAN_TARGET_OPTIONS.map((option) => option.id);

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function targetLabels(targets) {
  if (!targets?.length) return 'No scan targets';
  return targets
    .map((targetId) => SCAN_TARGET_OPTIONS.find((option) => option.id === targetId)?.label || targetId)
    .join(', ');
}

export default function PlatformHomes() {
  const { refreshHomes, switchHome } = useData();
  const navigate = useNavigate();

  const [homes, setHomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editHome, setEditHome] = useState(null);
  const [deleteHome, setDeleteHome] = useState(null);
  useDirtyGuard(addOpen || !!editHome || !!deleteHome);

  const refresh = useCallback(async () => {
    try {
      const data = await listPlatformHomes();
      setHomes(data.homes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading homes..." /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>Manage Homes</h1>
        <button className={BTN.primary} onClick={() => setAddOpen(true)}>Add Home</button>
      </div>

      {error && <ErrorState title="Home management needs attention" message={error} onRetry={refresh} className="mb-4" />}
      {success && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{success}</div>}

      <div className={CARD.base}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Name</th>
              <th scope="col" className={TABLE.th}>Slug</th>
              <th scope="col" className={TABLE.th}>Beds</th>
              <th scope="col" className={TABLE.th}>Care Type</th>
              <th scope="col" className={TABLE.th}>Scan Intake</th>
              <th scope="col" className={TABLE.th}>Staff</th>
              <th scope="col" className={TABLE.th}>Users</th>
              <th scope="col" className={TABLE.th}>Updated</th>
              <th scope="col" className={TABLE.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {homes.length === 0 && (
              <tr>
                <td colSpan={9} className={TABLE.empty}>
                  <EmptyState compact title="No homes configured" description="Add the first home here to start assigning staff, residents, and users." />
                </td>
              </tr>
            )}
            {homes.map((home) => (
              <tr key={home.id} className={TABLE.tr}>
                <td className={TABLE.td}>{home.name}</td>
                <td className={`${TABLE.tdMono} text-xs`}>{home.slug}</td>
                <td className={TABLE.td}>{home.beds ?? '—'}</td>
                <td className={TABLE.td}>{home.careType || '—'}</td>
                <td className={TABLE.td}>
                  <div className="space-y-1">
                    <span className={home.scanIntakeEnabled ? BADGE.green : BADGE.gray}>
                      {home.scanIntakeEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <div className="text-xs text-gray-500">{targetLabels(home.scanIntakeTargets)}</div>
                  </div>
                </td>
                <td className={TABLE.td}>{home.staffCount}</td>
                <td className={TABLE.td}>{home.userCount}</td>
                <td className={TABLE.td}>{formatDate(home.updatedAt)}</td>
                <td className={TABLE.td}>
                  <div className="flex gap-1.5">
                    <button className={`${BTN.primary} ${BTN.xs}`} onClick={() => { switchHome(home.slug); navigate('/'); }}>View</button>
                    <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setEditHome(home)}>Edit</button>
                    <button className={`${BTN.danger} ${BTN.xs}`} onClick={() => setDeleteHome(home)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addOpen && <CreateHomeModal onClose={() => setAddOpen(false)} onSuccess={(msg) => { setSuccess(msg); refresh(); refreshHomes(); }} />}
      {editHome && <EditHomeModal home={editHome} onClose={() => setEditHome(null)} onSuccess={(msg) => { setSuccess(msg); refresh(); refreshHomes(); }} />}
      {deleteHome && <DeleteHomeModal home={deleteHome} onClose={() => setDeleteHome(null)} onSuccess={(msg) => { setSuccess(msg); refresh(); refreshHomes(); }} />}
    </div>
  );
}

function CreateHomeModal({ onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [beds, setBeds] = useState(30);
  const [careType, setCareType] = useState('residential');
  const [cycleStartDate, setCycleStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const slug = generateSlug(name);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !cycleStartDate) return;
    setSaving(true);
    setErr(null);
    try {
      await createPlatformHome({ name: name.trim(), registered_beds: beds, care_type: careType, cycle_start_date: cycleStartDate });
      onSuccess(`Home "${name.trim()}" created`);
      onClose();
    } catch (error) {
      setErr(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Create Home">
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && <div className="text-sm text-red-600" role="alert">{err}</div>}

        <div>
          <label className={INPUT.label}>Home Name *</label>
          <input className={INPUT.base} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oakwood Care Home" required />
        </div>

        <div>
          <label className={INPUT.label}>Slug (auto-generated)</label>
          <input className={`${INPUT.base} bg-gray-50`} value={slug} readOnly tabIndex={-1} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Registered Beds</label>
            <input className={INPUT.base} type="number" min={1} max={200} value={beds} onChange={(e) => setBeds(parseInt(e.target.value, 10) || 30)} />
          </div>
          <div>
            <label className={INPUT.label}>Care Type</label>
            <select className={INPUT.select} value={careType} onChange={(e) => setCareType(e.target.value)}>
              <option value="residential">Residential</option>
              <option value="nursing">Nursing</option>
              <option value="dementia">Dementia</option>
              <option value="respite">Respite</option>
              <option value="supported_living">Supported Living</option>
            </select>
          </div>
        </div>

        <div>
          <label className={INPUT.label}>Cycle Start Date *</label>
          <input className={INPUT.base} type="date" value={cycleStartDate} onChange={(e) => setCycleStartDate(e.target.value)} required />
          <p className="mt-1 text-xs text-gray-400">The anchor date for the Panama 2-2-3 rotation pattern</p>
        </div>

        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={saving || !name.trim() || !cycleStartDate}>
            {saving ? 'Creating...' : 'Create Home'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditHomeModal({ home, onClose, onSuccess }) {
  const [name, setName] = useState(home.name || '');
  const [beds, setBeds] = useState(home.beds || 30);
  const [careType, setCareType] = useState(home.careType || 'residential');
  const [scanIntakeEnabled, setScanIntakeEnabled] = useState(Boolean(home.scanIntakeEnabled));
  const [scanTargets, setScanTargets] = useState(
    Array.isArray(home.scanIntakeTargets) && home.scanIntakeTargets.length
      ? home.scanIntakeTargets
      : DEFAULT_SCAN_TARGETS
  );
  const [scanOcrEngine, setScanOcrEngine] = useState(home.scanOcrEngine || 'paddleocr');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function toggleScanTarget(targetId) {
    setScanTargets((current) => (
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId]
    ));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await updatePlatformHome(home.id, {
        name: name.trim(),
        registered_beds: beds,
        care_type: careType,
        scan_intake_enabled: scanIntakeEnabled,
        scan_intake_targets: scanTargets,
        scan_ocr_engine: scanOcrEngine,
      });
      onSuccess(`Home "${name.trim()}" updated`);
      onClose();
    } catch (error) {
      setErr(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Edit Home">
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && <div className="text-sm text-red-600" role="alert">{err}</div>}

        <div>
          <label className={INPUT.label}>Slug</label>
          <input className={`${INPUT.base} bg-gray-50`} value={home.slug} readOnly tabIndex={-1} />
        </div>

        <div>
          <label className={INPUT.label}>Home Name *</label>
          <input className={INPUT.base} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Registered Beds</label>
            <input className={INPUT.base} type="number" min={1} max={200} value={beds} onChange={(e) => setBeds(parseInt(e.target.value, 10) || 30)} />
          </div>
          <div>
            <label className={INPUT.label}>Care Type</label>
            <select className={INPUT.select} value={careType} onChange={(e) => setCareType(e.target.value)}>
              <option value="residential">Residential</option>
              <option value="nursing">Nursing</option>
              <option value="dementia">Dementia</option>
              <option value="respite">Respite</option>
              <option value="supported_living">Supported Living</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Scan Intake</h3>
            <p className="mt-1 text-xs text-gray-500">Control OCR review and document routing for this home.</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={scanIntakeEnabled}
              onChange={(e) => setScanIntakeEnabled(e.target.checked)}
            />
            Enable scan intake for this home
          </label>

          <div className="mt-4">
            <label className={INPUT.label}>OCR engine</label>
            <select className={INPUT.select} value={scanOcrEngine} onChange={(e) => setScanOcrEngine(e.target.value)} disabled={!scanIntakeEnabled}>
              <option value="paddleocr">PaddleOCR</option>
            </select>
          </div>

          <div className="mt-4">
            <label className={INPUT.label}>Allowed targets</label>
            <div className="grid grid-cols-2 gap-2">
              {SCAN_TARGET_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={scanTargets.includes(option.id)}
                    onChange={() => toggleScanTarget(option.id)}
                    disabled={!scanIntakeEnabled}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">Reviewers can only file scans into the enabled targets for this home.</p>
          </div>
        </div>

        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={saving || !name.trim() || (scanIntakeEnabled && scanTargets.length === 0)}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteHomeModal({ home, onClose, onSuccess }) {
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState(null);

  const nameMatches = confirmName.trim().toLowerCase() === (home.name || '').toLowerCase();

  async function handleDelete() {
    if (!nameMatches) return;
    setDeleting(true);
    setErr(null);
    try {
      await deletePlatformHome(home.id);
      onSuccess(`Home "${home.name}" deleted`);
      onClose();
    } catch (error) {
      setErr(error.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Delete Home">
      <div className="space-y-4">
        {err && <div className="text-sm text-red-600" role="alert">{err}</div>}

        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">This will soft-delete the home and revoke access for all users.</p>
          <p className="mt-1 text-xs text-red-700">Staff, scheduling, and financial data will be preserved for audit purposes but the home will no longer be accessible.</p>
        </div>

        <div>
          <p className="mb-2 text-sm text-gray-600">Type <strong>{home.name}</strong> to confirm:</p>
          <input className={INPUT.base} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={home.name} />
        </div>

        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button className={BTN.danger} onClick={handleDelete} disabled={deleting || !nameMatches}>
            {deleting ? 'Deleting...' : 'Delete Home'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
