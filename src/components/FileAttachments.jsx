import { useState, useEffect, useRef } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { getHrAttachments, uploadHrAttachment, deleteHrAttachment, downloadHrAttachment } from '../lib/api.js';
import { BTN, INPUT, TABLE } from '../lib/design.js';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function FileAttachments({ caseType, caseId, readOnly = false }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [description, setDescription] = useState('');
  const fileInputRef = useRef(null);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    if (caseId) loadFiles();
  }, [caseType, caseId]); // eslint-disable-line react-hooks/exhaustive-deps -- loadFiles is stable given caseType+caseId

  async function loadFiles() {
    setLoading(true);
    setError(null);
    try {
      const data = await getHrAttachments(caseType, caseId);
      setFiles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadHrAttachment(caseType, caseId, file, description);
      setDescription('');
      fileInputRef.current.value = '';
      await loadFiles();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(att) {
    if (!await confirm(`Delete "${att.original_name}"?`)) return;
    try {
      await deleteHrAttachment(att.id);
      await loadFiles();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownload(att) {
    try {
      await downloadHrAttachment(att.id, att.original_name);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!caseId) {
    return <p className="text-sm text-gray-400 italic">Save the case first to attach documents.</p>;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">Attached Documents</h4>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {files.length > 0 && (
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>File</th>
                <th scope="col" className={TABLE.th}>Size</th>
                <th scope="col" className={TABLE.th}>Description</th>
                <th scope="col" className={TABLE.th}>Uploaded</th>
                <th scope="col" className={TABLE.th}></th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f.id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <button onClick={() => handleDownload(f)} className="text-blue-600 hover:underline text-sm">
                      {f.original_name}
                    </button>
                  </td>
                  <td className={TABLE.td + ' text-gray-500 text-xs'}>{formatBytes(f.size_bytes)}</td>
                  <td className={TABLE.td + ' text-gray-500 text-xs'}>{f.description || '\u2014'}</td>
                  <td className={TABLE.td + ' text-gray-400 text-xs'}>
                    {f.uploaded_by} {'\u2014'} {f.created_at ? new Date(f.created_at).toLocaleDateString('en-GB') : ''}
                  </td>
                  <td className={TABLE.td}>
                    {!readOnly && (
                      <button onClick={() => handleDelete(f)} className={BTN.ghost + ' ' + BTN.xs + ' text-red-500'}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {files.length === 0 && !loading && (
        <p className="text-sm text-gray-400">No documents attached.</p>
      )}

      {!readOnly && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className={INPUT.label}>File</label>
            <input ref={fileInputRef} type="file" className="text-sm text-gray-600" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt" />
          </div>
          <div className="flex-1">
            <label className={INPUT.label}>Description (optional)</label>
            <input className={INPUT.sm} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Witness statement" />
          </div>
          <button onClick={handleUpload} disabled={uploading} className={BTN.primary + ' ' + BTN.sm}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
