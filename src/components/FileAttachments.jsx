import { useState, useEffect, useRef, useId } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { getHrAttachments, uploadHrAttachment, deleteHrAttachment, downloadHrAttachment } from '../lib/api.js';
import { BTN, INPUT, TABLE } from '../lib/design.js';
import LoadingState from './LoadingState.jsx';
import EmptyState from './EmptyState.jsx';
import InlineNotice from './InlineNotice.jsx';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function FileAttachments({
  caseType,
  caseId,
  readOnly = false,
  getFiles,
  uploadFile,
  deleteFile,
  downloadFile,
  title = 'Attached Documents',
  emptyText = 'No documents attached.',
  saveFirstMessage = 'Save the case first to attach documents.',
  ensureCaseId,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [description, setDescription] = useState('');
  const [createdCaseId, setCreatedCaseId] = useState(null);
  const fileInputRef = useRef(null);
  const loadRequestRef = useRef(0);
  const fileInputId = useId();
  const descriptionInputId = useId();
  const { confirm, ConfirmDialog } = useConfirm();
  const listFiles = getFiles || getHrAttachments;
  const createFile = uploadFile || uploadHrAttachment;
  const removeFile = deleteFile || deleteHrAttachment;
  const fetchFile = downloadFile || downloadHrAttachment;
  const activeCaseId = caseId || createdCaseId;

  useEffect(() => {
    if (caseId) setCreatedCaseId(null);
  }, [caseId]);

  useEffect(() => {
    if (activeCaseId) loadFiles(activeCaseId);
  }, [caseType, activeCaseId, getFiles]); // eslint-disable-line react-hooks/exhaustive-deps -- callback choice intentionally tracks getFiles only

  async function loadFiles(targetCaseId = activeCaseId) {
    if (!targetCaseId) return;
    const requestId = ++loadRequestRef.current;
    let shouldUpdate = true;
    setLoading(true);
    setError(null);
    try {
      const data = await listFiles(caseType, targetCaseId);
      shouldUpdate = requestId === loadRequestRef.current;
      if (!shouldUpdate) return;
      setFiles(data);
    } catch (err) {
      shouldUpdate = requestId === loadRequestRef.current;
      if (!shouldUpdate) return;
      setError(err.message);
    } finally {
      if (shouldUpdate && requestId === loadRequestRef.current) setLoading(false);
    }
  }

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      let targetCaseId = activeCaseId;
      if (!targetCaseId && ensureCaseId) {
        targetCaseId = await ensureCaseId();
        if (!targetCaseId) throw new Error(saveFirstMessage);
        setCreatedCaseId(targetCaseId);
      }
      if (!targetCaseId) throw new Error(saveFirstMessage);
      await createFile(caseType, targetCaseId, file, description);
      setDescription('');
      fileInputRef.current.value = '';
      await loadFiles(targetCaseId);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(att) {
    if (!await confirm(`Delete "${att.original_name}"?`)) return;
    try {
      await removeFile(att.id);
      await loadFiles();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownload(att) {
    try {
      await fetchFile(att.id, att.original_name);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!activeCaseId && !ensureCaseId) {
    return <p className="text-sm text-gray-400 italic">{saveFirstMessage}</p>;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">{title}</h4>

      {!activeCaseId && ensureCaseId && (
        <p className="text-sm text-gray-500">{saveFirstMessage}</p>
      )}

      {error && <InlineNotice variant="error" role="alert">{error}</InlineNotice>}

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

      {loading && <LoadingState message="Loading attached documents..." compact />}

      {files.length === 0 && !loading && (
        <EmptyState title={emptyText} compact />
      )}

      {!readOnly && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor={fileInputId} className={INPUT.label}>File</label>
            <input id={fileInputId} ref={fileInputRef} type="file" className="text-sm text-gray-600" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt" disabled={uploading} />
          </div>
          <div className="flex-1">
            <label htmlFor={descriptionInputId} className={INPUT.label}>Description (optional)</label>
            <input id={descriptionInputId} className={INPUT.sm} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Witness statement" disabled={uploading} />
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
