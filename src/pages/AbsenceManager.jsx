import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getCurrentHome, getLoggedInUser, getAbsenceSummary, getStaffAbsence,
  getHrRtwInterviews, createHrRtwInterview, updateHrRtwInterview,
  getHrOhReferrals, createHrOhReferral, updateHrOhReferral,
} from '../lib/api.js';
import { BRADFORD_TRIGGERS, getAbsenceTriggerBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { clickableRowProps } from '../lib/a11y.js';

const TABS = [
  { id: 'bradford', label: 'Bradford Scores' },
  { id: 'rtw', label: 'RTW Interviews' },
  { id: 'oh', label: 'OH Referrals' },
];

const emptyRtw = () => ({
  staff_id: '', absence_start_date: '', absence_end_date: '',
  rtw_date: new Date().toISOString().slice(0, 10), conducted_by: '',
  absence_reason: '', fit_for_work: true, adjustments: '',
  referral_needed: false, notes: '',
});

const emptyOh = () => ({
  staff_id: '', referral_date: new Date().toISOString().slice(0, 10),
  reason: '', provider: '', appointment_date: '',
  report_received: false, report_date: '', recommendations: '',
  follow_up_date: '', notes: '',
});

const LIMIT = 50;

export default function AbsenceManager() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [tab, setTab] = useState('bradford');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Bradford
  const [summary, setSummary] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [staffDetail, setStaffDetail] = useState(null);

  // RTW
  const [rtwList, setRtwList] = useState([]);
  const [rtwTotal, setRtwTotal] = useState(0);
  const [rtwOffset, setRtwOffset] = useState(0);
  const [showRtwModal, setShowRtwModal] = useState(false);
  const [editingRtw, setEditingRtw] = useState(null);
  const [rtwForm, setRtwForm] = useState(emptyRtw());

  // OH
  const [ohList, setOhList] = useState([]);
  const [ohTotal, setOhTotal] = useState(0);
  const [ohOffset, setOhOffset] = useState(0);
  const [showOhModal, setShowOhModal] = useState(false);
  const [editingOh, setEditingOh] = useState(null);
  const [ohForm, setOhForm] = useState(emptyOh());

  const home = getCurrentHome();
  useDirtyGuard(showRtwModal || showOhModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const [sum, rtwRes, ohRes] = await Promise.all([
        getAbsenceSummary(home),
        getHrRtwInterviews(home, { limit: LIMIT, offset: rtwOffset }),
        getHrOhReferrals(home, { limit: LIMIT, offset: ohOffset }),
      ]);
      setSummary((sum || []).sort((a, b) => (b.score || 0) - (a.score || 0)));
      setRtwList(rtwRes?.rows || []);
      setRtwTotal(rtwRes?.total || 0);
      setOhList(ohRes?.rows || []);
      setOhTotal(ohRes?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, rtwOffset, ohOffset]);

  useEffect(() => { load(); }, [load]);

  // Escape key handling is provided by the Modal component

  // Bradford detail
  async function handleSelectStaff(staffId) {
    if (selectedStaff === staffId) { setSelectedStaff(null); setStaffDetail(null); return; }
    try {
      setSelectedStaff(staffId);
      setStaffDetail(await getStaffAbsence(home, staffId));
    } catch (e) { setError(e.message); }
  }

  // RTW handlers
  function openNewRtw() { setEditingRtw(null); setRtwForm(emptyRtw()); setFormError(''); setShowRtwModal(true); }
  function openEditRtw(item) {
    setEditingRtw(item);
    setRtwForm({
      staff_id: item.staff_id || '', absence_start_date: item.absence_start_date || '',
      absence_end_date: item.absence_end_date || '', rtw_date: item.rtw_date || '',
      conducted_by: item.conducted_by || '', absence_reason: item.absence_reason || '',
      fit_for_work: item.fit_for_work ?? true, adjustments: item.adjustments || '',
      referral_needed: item.referral_needed ?? false, notes: item.notes || '',
    });
    setFormError('');
    setShowRtwModal(true);
  }
  async function handleSaveRtw() {
    setFormError('');
    setError(null);
    if (!rtwForm.staff_id) { setFormError('Staff member is required'); return; }
    if (!rtwForm.rtw_date) { setFormError('RTW date is required'); return; }
    setSaving(true);
    try {
      if (editingRtw) await updateHrRtwInterview(editingRtw.id, { ...rtwForm, _version: editingRtw.version });
      else await createHrRtwInterview(home, rtwForm);
      setShowRtwModal(false); setEditingRtw(null); setRtwForm(emptyRtw()); load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        load();
      } else { setError(e.message); }
    } finally { setSaving(false); }
  }

  // OH handlers
  function openNewOh() { setEditingOh(null); setOhForm(emptyOh()); setFormError(''); setShowOhModal(true); }
  function openEditOh(item) {
    setEditingOh(item);
    setOhForm({
      staff_id: item.staff_id || '', referral_date: item.referral_date || '',
      reason: item.reason || '', provider: item.provider || '',
      appointment_date: item.appointment_date || '',
      report_received: item.report_received ?? false, report_date: item.report_date || '',
      recommendations: item.recommendations || '', follow_up_date: item.follow_up_date || '',
      notes: item.notes || '',
    });
    setFormError('');
    setShowOhModal(true);
  }
  async function handleSaveOh() {
    setFormError('');
    setError(null);
    if (!ohForm.staff_id) { setFormError('Staff member is required'); return; }
    if (!ohForm.referral_date) { setFormError('Referral date is required'); return; }
    setSaving(true);
    try {
      if (editingOh) await updateHrOhReferral(editingOh.id, { ...ohForm, _version: editingOh.version });
      else await createHrOhReferral(home, ohForm);
      setShowOhModal(false); setEditingOh(null); setOhForm(emptyOh()); load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        load();
      } else { setError(e.message); }
    } finally { setSaving(false); }
  }

  // Export
  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    const sheets = [];
    if (summary.length > 0) {
      sheets.push({
        name: 'Bradford Scores',
        headers: ['Staff ID', 'Spells (12m)', 'Days (12m)', 'Bradford Score', 'Trigger Level'],
        rows: summary.map(s => [
          s.staff_id, s.spells ?? 0, s.days ?? 0, s.score ?? 0,
          getAbsenceTriggerBadge(s.trigger_level)?.name || s.trigger_level || 'Normal',
        ]),
      });
    }
    if (rtwList.length > 0) {
      sheets.push({
        name: 'RTW Interviews',
        headers: ['Staff ID', 'Absence Start', 'RTW Date', 'Conducted By', 'Fit for Work', 'Reason'],
        rows: rtwList.map(r => [
          r.staff_id, r.absence_start_date || '', r.rtw_date || '',
          r.conducted_by || '', r.fit_for_work ? 'Yes' : 'No', r.absence_reason || '',
        ]),
      });
    }
    if (ohList.length > 0) {
      sheets.push({
        name: 'OH Referrals',
        headers: ['Staff ID', 'Referral Date', 'Reason', 'Provider', 'Report Received', 'Follow-up'],
        rows: ohList.map(o => [
          o.staff_id, o.referral_date || '', o.reason || '', o.provider || '',
          o.report_received ? 'Yes' : 'No', o.follow_up_date || '',
        ]),
      });
    }
    if (sheets.length > 0) downloadXLSX('absence_management', sheets);
  }

  const rf = (key, val) => setRtwForm(prev => ({ ...prev, [key]: val }));
  const ohf = (key, val) => setOhForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading absence data...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Absence Management</h1>
          <p className={PAGE.subtitle}>Bradford scores, return-to-work interviews, occupational health referrals</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {isAdmin && tab === 'rtw' && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNewRtw}>New RTW Interview</button>}
          {isAdmin && tab === 'oh' && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNewOh}>New OH Referral</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Tab bar */}
      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} className="mb-6" />

      {tab === 'bradford' && renderBradford()}
      {tab === 'rtw' && renderRtw()}
      {tab === 'oh' && renderOh()}

      {showRtwModal && renderRtwModal()}
      {showOhModal && renderOhModal()}
    </div>
  );

  // ── Bradford Scores ─────────────────────────────────────────────────────

  function renderBradford() {
    return (
      <div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Staff ID</th>
                  <th scope="col" className={TABLE.th}>Spells (12m)</th>
                  <th scope="col" className={TABLE.th}>Days (12m)</th>
                  <th scope="col" className={TABLE.th}>Bradford Score</th>
                  <th scope="col" className={TABLE.th}>Trigger Level</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 && <tr><td colSpan={5} className={TABLE.empty}>No absence data</td></tr>}
                {summary.map(s => {
                  const trigger = getAbsenceTriggerBadge(s.trigger_level);
                  return (
                    <tr key={s.staff_id} className={TABLE.tr + ' cursor-pointer'} {...clickableRowProps(() => handleSelectStaff(s.staff_id))}>
                      <td className={TABLE.td + ' font-medium'}>{s.staff_id}</td>
                      <td className={TABLE.tdMono}>{s.spells ?? 0}</td>
                      <td className={TABLE.tdMono}>{s.days ?? 0}</td>
                      <td className={TABLE.tdMono + ' font-semibold'}>{s.score ?? 0}</td>
                      <td className={TABLE.td}>
                        <span className={BADGE[trigger.badgeKey]}>{trigger.name}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Staff detail panel */}
        {selectedStaff && staffDetail && (
          <div className={CARD.padded + ' mt-4'}>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Absence Spells for {selectedStaff}</h3>
            {Array.isArray(staffDetail.spells) && staffDetail.spells.length > 0 ? (
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th scope="col" className={TABLE.th}>Start</th>
                      <th scope="col" className={TABLE.th}>End</th>
                      <th scope="col" className={TABLE.th}>Days</th>
                      <th scope="col" className={TABLE.th}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffDetail.spells.map((sp, i) => (
                      <tr key={i} className={TABLE.tr}>
                        <td className={TABLE.td}>{sp.start_date || '—'}</td>
                        <td className={TABLE.td}>{sp.end_date || 'Ongoing'}</td>
                        <td className={TABLE.tdMono}>{sp.days ?? '—'}</td>
                        <td className={TABLE.td}>{sp.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No spell records available.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── RTW Interviews ──────────────────────────────────────────────────────

  function renderRtw() {
    return (
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Absence Start</th>
                <th scope="col" className={TABLE.th}>RTW Date</th>
                <th scope="col" className={TABLE.th}>Conducted By</th>
                <th scope="col" className={TABLE.th}>Fit for Work</th>
                <th scope="col" className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rtwList.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No RTW interviews</td></tr>}
              {rtwList.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td + ' font-medium'}>{item.staff_id}</td>
                  <td className={TABLE.td}>{item.absence_start_date || '—'}</td>
                  <td className={TABLE.td}>{item.rtw_date || '—'}</td>
                  <td className={TABLE.td}>{item.conducted_by || '—'}</td>
                  <td className={TABLE.td}>
                    <span className={BADGE[item.fit_for_work ? 'green' : 'red']}>{item.fit_for_work ? 'Yes' : 'No'}</span>
                  </td>
                  {isAdmin && (
                    <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEditRtw(item)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={rtwTotal} limit={LIMIT} offset={rtwOffset} onChange={setRtwOffset} />
      </div>
    );
  }

  // ── OH Referrals ────────────────────────────────────────────────────────

  function renderOh() {
    return (
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Referral Date</th>
                <th scope="col" className={TABLE.th}>Reason</th>
                <th scope="col" className={TABLE.th}>Provider</th>
                <th scope="col" className={TABLE.th}>Report Received</th>
                <th scope="col" className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ohList.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No OH referrals</td></tr>}
              {ohList.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td + ' font-medium'}>{item.staff_id}</td>
                  <td className={TABLE.td}>{item.referral_date || '—'}</td>
                  <td className={TABLE.td}>{item.reason || '—'}</td>
                  <td className={TABLE.td}>{item.provider || '—'}</td>
                  <td className={TABLE.td}>
                    <span className={BADGE[item.report_received ? 'green' : 'amber']}>{item.report_received ? 'Yes' : 'No'}</span>
                  </td>
                  {isAdmin && (
                    <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEditOh(item)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={ohTotal} limit={LIMIT} offset={ohOffset} onChange={setOhOffset} />
      </div>
    );
  }

  // ── RTW Modal ───────────────────────────────────────────────────────────

  function renderRtwModal() {
    return (
      <Modal isOpen={true} onClose={() => { setShowRtwModal(false); setEditingRtw(null); setRtwForm(emptyRtw()); }} title={editingRtw ? 'Edit RTW Interview' : 'New RTW Interview'} size="xl">
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <StaffPicker value={rtwForm.staff_id || ''} onChange={val => rf('staff_id', val)} label="Staff Member" />
            <div>
              <label className={INPUT.label}>RTW Date</label>
              <input type="date" className={INPUT.base} value={rtwForm.rtw_date} onChange={e => rf('rtw_date', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Absence Start Date</label>
              <input type="date" className={INPUT.base} value={rtwForm.absence_start_date} onChange={e => rf('absence_start_date', e.target.value)} />
            </div>
            <div>
              <label className={INPUT.label}>Absence End Date</label>
              <input type="date" className={INPUT.base} value={rtwForm.absence_end_date} onChange={e => rf('absence_end_date', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Conducted By</label>
              <input className={INPUT.base} value={rtwForm.conducted_by} onChange={e => rf('conducted_by', e.target.value)} />
            </div>
            <div>
              <label className={INPUT.label}>Absence Reason</label>
              <input className={INPUT.base} value={rtwForm.absence_reason} onChange={e => rf('absence_reason', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rtwForm.fit_for_work} onChange={e => rf('fit_for_work', e.target.checked)} />
              Fit for Work
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rtwForm.referral_needed} onChange={e => rf('referral_needed', e.target.checked)} />
              OH Referral Needed
            </label>
          </div>
          <div>
            <label className={INPUT.label}>Adjustments</label>
            <textarea className={INPUT.base} rows={3} value={rtwForm.adjustments} onChange={e => rf('adjustments', e.target.value)} placeholder="Adjustments required on return..." />
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={rtwForm.notes} onChange={e => rf('notes', e.target.value)} />
          </div>
        </div>
        <FileAttachments caseType="rtw_interview" caseId={editingRtw?.id} />
        {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
        <div className={MODAL.footer}>
          <button className={BTN.secondary} disabled={saving} onClick={() => setShowRtwModal(false)}>Cancel</button>
          <button className={BTN.primary} disabled={saving} onClick={handleSaveRtw}>{saving ? 'Saving...' : editingRtw ? 'Update' : 'Create'}</button>
        </div>
      </Modal>
    );
  }

  // ── OH Modal ────────────────────────────────────────────────────────────

  function renderOhModal() {
    return (
      <Modal isOpen={true} onClose={() => { setShowOhModal(false); setEditingOh(null); setOhForm(emptyOh()); }} title={editingOh ? 'Edit OH Referral' : 'New OH Referral'} size="xl">
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <StaffPicker value={ohForm.staff_id || ''} onChange={val => ohf('staff_id', val)} label="Staff Member" />
            <div>
              <label className={INPUT.label}>Referral Date</label>
              <input type="date" className={INPUT.base} value={ohForm.referral_date} onChange={e => ohf('referral_date', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Reason</label>
              <input className={INPUT.base} value={ohForm.reason} onChange={e => ohf('reason', e.target.value)} />
            </div>
            <div>
              <label className={INPUT.label}>Provider</label>
              <input className={INPUT.base} value={ohForm.provider} onChange={e => ohf('provider', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Appointment Date</label>
            <input type="date" className={INPUT.base} value={ohForm.appointment_date} onChange={e => ohf('appointment_date', e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="oh_report" checked={ohForm.report_received} onChange={e => ohf('report_received', e.target.checked)} />
            <label htmlFor="oh_report" className="text-sm">Report Received</label>
          </div>
          {ohForm.report_received && (
            <div>
              <label className={INPUT.label}>Report Date</label>
              <input type="date" className={INPUT.base} value={ohForm.report_date} onChange={e => ohf('report_date', e.target.value)} />
            </div>
          )}
          <div>
            <label className={INPUT.label}>Recommendations</label>
            <textarea className={INPUT.base} rows={3} value={ohForm.recommendations} onChange={e => ohf('recommendations', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Follow-up Date</label>
            <input type="date" className={INPUT.base} value={ohForm.follow_up_date} onChange={e => ohf('follow_up_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={ohForm.notes} onChange={e => ohf('notes', e.target.value)} />
          </div>
        </div>
        <FileAttachments caseType="oh_referral" caseId={editingOh?.id} />
        {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
        <div className={MODAL.footer}>
          <button className={BTN.secondary} disabled={saving} onClick={() => setShowOhModal(false)}>Cancel</button>
          <button className={BTN.primary} disabled={saving} onClick={handleSaveOh}>{saving ? 'Saving...' : editingOh ? 'Update' : 'Create'}</button>
        </div>
      </Modal>
    );
  }
}
