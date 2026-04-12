import { useState, useEffect, useRef, useId } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { getHrAttachments, uploadHrAttachment, deleteHrAttachment, downloadHrAttachment } from '../lib/api.js';
import { BTN, INPUT, TABLE } from '../lib/design.js';

const ACCEPTED_UPLOAD_EXTENSIONS = '.pdf,.doc,.docx,.rtf,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.txt';
const ACCEPTED_UPLOAD_HELP = 'Accepted: PDF, Word, RTF, Excel, CSV, JPG, PNG, GIF, WebP, HEIC/HEIF, TXT (max 20MB).';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function FileAttachments({
  caseType,
  caseId,
  readOnly = false,
  getFiles = getHrAttachments,
  uploadFile = uploadHrAttachment,
  deleteFile = deleteHrAttachment,
  downloadFile = downloadHrAttachment,
  title = 'Attached Documents',
  emptyText = 'No documents attached.',
  saveFirstMessage = 'Save the case first to attach documents.',
  saveFirstText,
  ensureCaseId,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [description, setDescription] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const fileInputRef = useRef(null);
  const fileInputId = useId();
  const [createdCaseId, setCreatedCaseId] = useState(null);
  const descriptionInputId = useId();
  const { confirm, ConfirmDialog } = useConfirm();
  const listFiles = getFiles || getHrAttachments;
  const createFile = uploadFile || uploadHrAttachment;
  const removeFile = deleteFile || deleteHrAttachment;
  const fetchFile = downloadFile || downloadHrAttachment;
  const activeCaseId = caseId || createdCaseId;
  const saveMessage = saveFirstText || saveFirstMessage;

  useEffect(() => {
    if (caseId) setCreatedCaseId(null);
  }, [caseId]);

  useEffect(() => {
    if (activeCaseId) loadFiles(activeCaseId);
  }, [caseType, activeCaseId, getFiles]); // eslint-disable-line react-hooks/exhaustive-deps -- callback choice intentionally tracks getFiles only

  async function loadFiles(targetCaseId = activeCaseId) {
    if (!targetCaseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listFiles(caseType, targetCaseId);
      setFiles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
        if (!targetCaseId) throw new Error(saveMessage);
        setCreatedCaseId(targetCaseId);
      }
      if (!targetCaseId) throw new Error(saveMessage);
      await createFile(caseType, targetCaseId, file, description);
      setDescription('');
      setSelectedFileName('');
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
    return <p className="text-sm text-gray-400 italic">{saveMessage}</p>;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">{title}</h4>

      {!activeCaseId && ensureCaseId && (
        <p className="text-sm text-gray-500">{saveMessage}</p>
      )}

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
        <p className="text-sm text-gray-400">{emptyText}</p>
      )}

      {!readOnly && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className={INPUT.label} htmlFor={fileInputId}>File</label>
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept={ACCEPTED_UPLOAD_EXTENSIONS}
              onChange={(e) => {
                setSelectedFileName(e.target.files?.[0]?.name || '');
                setError(null);
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  fileInputRef.current?.click();
                }}
                disabled={uploading}
                className={BTN.secondary + ' ' + BTN.sm}
              >
                Choose file
              </button>
              <span className="min-w-0 truncate text-sm text-gray-500">
                {selectedFileName || 'No file selected'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">{ACCEPTED_UPLOAD_HELP}</p>
            {selectedFileName && <p className="mt-1 text-[11px] text-emerald-700">Selected: {selectedFileName}</p>}
          </div>
          <div className="flex-1">
            <label htmlFor={descriptionInputId} className={INPUT.label}>Description (optional)</label>
            <input id={descriptionInputId} className={INPUT.sm} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Witness statement" />
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
