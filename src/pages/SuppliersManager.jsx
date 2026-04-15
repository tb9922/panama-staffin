import { useCallback, useEffect, useMemo, useState } from 'react';
import { PAGE, CARD, TABLE, BTN, INPUT, MODAL } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import { getCurrentHome, getSuppliers, createSupplier, updateSupplier, mergeSuppliers } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { useData } from '../contexts/DataContext.jsx';

const EMPTY_FORM = { name: '', vat_number: '', default_category: '', aliasesText: '', active: true };

export default function SuppliersManager() {
  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getSuppliers(home, { q: query, activeOnly: false }));
    } catch (err) {
      setError(err.message || 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }, [home, query]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.active).length,
    inactive: rows.filter((row) => !row.active).length,
  }), [rows]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      name: row.name || '',
      vat_number: row.vat_number || '',
      default_category: row.default_category || '',
      aliasesText: (row.aliases || []).join('\n'),
      active: row.active,
      _version: row.version,
    });
    setShowModal(true);
  }

  async function handleSave() {
    try {
      const payload = {
        name: form.name,
        vat_number: form.vat_number || null,
        default_category: form.default_category || null,
        aliases: form.aliasesText.split('\n').map((value) => value.trim()).filter(Boolean),
        active: form.active,
      };
      if (editing) {
        await updateSupplier(home, editing.id, { ...payload, _version: form._version });
        showToast({ title: 'Supplier updated', message: payload.name });
      } else {
        await createSupplier(home, payload);
        showToast({ title: 'Supplier created', message: payload.name });
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save supplier');
    }
  }

  async function handleMerge() {
    if (!mergeSourceId || !mergeTargetId) return;
    try {
      await mergeSuppliers(home, Number(mergeSourceId), Number(mergeTargetId));
      showToast({ title: 'Suppliers merged' });
      setMergeSourceId('');
      setMergeTargetId('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to merge suppliers');
    }
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading suppliers..." card /></div>;
  if (error && !rows.length) return <div className={PAGE.container}><ErrorState title="Suppliers need attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Suppliers</h1>
          <p className={PAGE.subtitle}>Manage AP supplier names, aliases, VAT numbers, and defaults for OCR-assisted filing.</p>
        </div>
        {canEdit && <button onClick={openCreate} className={BTN.primary}>Add Supplier</button>}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={CARD.padded}><div className="text-xs text-gray-500">Total</div><div className="mt-1 text-2xl font-bold">{totals.total}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Active</div><div className="mt-1 text-2xl font-bold text-emerald-600">{totals.active}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Inactive</div><div className="mt-1 text-2xl font-bold text-gray-500">{totals.inactive}</div></div>
      </div>

      <div className={`${CARD.padded} flex flex-wrap items-end gap-3`}>
        <div className="min-w-56 flex-1">
          <label className={INPUT.label}>Search</label>
          <input className={INPUT.base} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Supplier name or alias" />
        </div>
        <button onClick={() => load()} className={`${BTN.secondary} ${BTN.sm}`}>Refresh</button>
      </div>

      {canEdit && (
        <div className={CARD.padded}>
          <div className="mb-3 text-sm font-semibold text-gray-900">Merge duplicates</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <label className={INPUT.label}>Source supplier</label>
              <select value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)} className={INPUT.select}>
                <option value="">Select source</option>
                {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </div>
            <div className="min-w-56 flex-1">
              <label className={INPUT.label}>Target supplier</label>
              <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)} className={INPUT.select}>
                <option value="">Select target</option>
                {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </div>
            <button onClick={handleMerge} className={`${BTN.primary} ${BTN.sm}`} disabled={!mergeSourceId || !mergeTargetId}>Merge</button>
          </div>
        </div>
      )}

      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr><th className={TABLE.th}>Name</th><th className={TABLE.th}>VAT</th><th className={TABLE.th}>Default Category</th><th className={TABLE.th}>Aliases</th><th className={TABLE.th}>Status</th><th className={TABLE.th}></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{row.name}</td>
                  <td className={TABLE.td}>{row.vat_number || '—'}</td>
                  <td className={TABLE.td}>{row.default_category || '—'}</td>
                  <td className={TABLE.td}>{(row.aliases || []).join(', ') || '—'}</td>
                  <td className={TABLE.td}>{row.active ? 'Active' : 'Inactive'}</td>
                  <td className={TABLE.td}>{canEdit && <button onClick={() => openEdit(row)} className={`${BTN.ghost} ${BTN.xs}`}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Supplier' : 'Add Supplier'}>
        <div className="space-y-3">
          <div><label className={INPUT.label}>Name</label><input className={INPUT.base} value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} /></div>
          <div><label className={INPUT.label}>VAT Number</label><input className={INPUT.base} value={form.vat_number} onChange={(e) => setForm((current) => ({ ...current, vat_number: e.target.value }))} /></div>
          <div><label className={INPUT.label}>Default Category</label><input className={INPUT.base} value={form.default_category} onChange={(e) => setForm((current) => ({ ...current, default_category: e.target.value }))} /></div>
          <div><label className={INPUT.label}>Aliases</label><textarea rows={4} className={INPUT.base} value={form.aliasesText} onChange={(e) => setForm((current) => ({ ...current, aliasesText: e.target.value }))} placeholder="One alias per line" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))} />Active supplier</label>
        </div>
        <div className={MODAL.footer}>
          <button onClick={() => setShowModal(false)} className={BTN.secondary}>Cancel</button>
          <button onClick={handleSave} className={BTN.primary}>{editing ? 'Save Changes' : 'Create Supplier'}</button>
        </div>
      </Modal>
    </div>
  );
}
