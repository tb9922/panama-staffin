import { useState, useMemo, useEffect } from 'react';
import {
  ONBOARDING_SECTIONS, ONBOARDING_STATUS, STATUS_DISPLAY,
  buildOnboardingMatrix, getOnboardingStats,
  getStaffOnboardingProgress,
  DBS_DISCLOSURE_LEVELS, DBS_STATUSES, ADULT_FIRST_STATUSES,
  CONTRACT_TYPES, ID_TYPES, ADDRESS_PROOF_TYPES, DOC_TYPES,
  DAY1_ITEMS, POLICY_ITEMS, DBS_RISK_DECISIONS,
} from '../lib/onboarding.js';
import { downloadXLSX } from '../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { getCurrentHome, getLoggedInUser, getOnboardingData, upsertOnboardingSection, clearOnboardingSection } from '../lib/api.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

export default function OnboardingTracker() {
  const homeSlug = getCurrentHome();
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterStatus, setFilterStatus] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalSection, setModalSection] = useState(null);
  const [modalStaffId, setModalStaffId] = useState(null);
  const [modalForm, setModalForm] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  useDirtyGuard(showModal);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getOnboardingData(homeSlug);
        if (!stale) { setState(data); setError(null); }
      } catch (e) { if (!stale) setError(e.message); }
      finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [homeSlug, refreshKey]);

  const activeStaff = useMemo(() => (state?.staff || []).filter(s => s.active !== false), [state]);
  const onboardingData = useMemo(() => state?.onboarding || {}, [state]);

  const matrix = useMemo(() => buildOnboardingMatrix(activeStaff, ONBOARDING_SECTIONS, onboardingData), [activeStaff, onboardingData]);
  const _stats = useMemo(() => getOnboardingStats(matrix), [matrix]);

  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filterStatus === 'incomplete') {
      list = list.filter(s => !getStaffOnboardingProgress(s.id, onboardingData).isComplete);
    } else if (filterStatus === 'complete') {
      list = list.filter(s => getStaffOnboardingProgress(s.id, onboardingData).isComplete);
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, filterStatus, onboardingData]);

  const fullyOnboarded = useMemo(() => {
    return activeStaff.filter(s => getStaffOnboardingProgress(s.id, onboardingData).isComplete).length;
  }, [activeStaff, onboardingData]);

  const preEmploymentPending = useMemo(() => {
    let count = 0;
    for (const s of activeStaff) {
      for (const sec of ONBOARDING_SECTIONS.filter(x => x.category === 'pre-employment')) {
        const r = onboardingData?.[s.id]?.[sec.id];
        if (!r || r.status !== ONBOARDING_STATUS.COMPLETED) count++;
      }
    }
    return count;
  }, [activeStaff, onboardingData]);

  const inductionPending = useMemo(() => {
    let count = 0;
    for (const s of activeStaff) {
      for (const sec of ONBOARDING_SECTIONS.filter(x => x.category === 'induction')) {
        const r = onboardingData?.[s.id]?.[sec.id];
        if (!r || r.status !== ONBOARDING_STATUS.COMPLETED) count++;
      }
    }
    return count;
  }, [activeStaff, onboardingData]);

  // ── Modal ─────────────────────────────────────────────────────────────────

  function openModal(staffId, sectionId) {
    const existing = onboardingData?.[staffId]?.[sectionId] || {};
    setModalStaffId(staffId);
    setModalSection(sectionId);
    setModalForm({ status: ONBOARDING_STATUS.NOT_STARTED, ...existing });
    setShowModal(true);
  }

  function setField(field, value) {
    setModalForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!modalStaffId || !modalSection) return;
    setSaving(true);
    try {
      await upsertOnboardingSection(homeSlug, modalStaffId, modalSection, modalForm);
      setRefreshKey(k => k + 1);
      setShowModal(false);
    } catch (e) {
      setError('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm('Remove this onboarding record?')) return;
    setSaving(true);
    try {
      await clearOnboardingSection(homeSlug, modalStaffId, modalSection);
      setRefreshKey(k => k + 1);
      setShowModal(false);
    } catch (e) {
      setError('Failed to remove: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Excel Export ──────────────────────────────────────────────────────────

  function handleExport() {
    const headers = ['Name', 'Team', 'Role', 'Start Date', ...ONBOARDING_SECTIONS.map(s => s.name), 'Progress'];
    const rows = filteredStaff.map(s => {
      const p = getStaffOnboardingProgress(s.id, onboardingData);
      return [
        s.name, s.team, s.role, s.start_date || '',
        ...ONBOARDING_SECTIONS.map(sec => {
          const r = onboardingData?.[s.id]?.[sec.id];
          return r?.status === ONBOARDING_STATUS.COMPLETED ? 'Completed' :
                 r?.status === ONBOARDING_STATUS.IN_PROGRESS ? 'In Progress' : 'Not Started';
        }),
        `${p.pct}%`,
      ];
    });
    downloadXLSX('onboarding_tracker', [{ name: 'Onboarding', headers, rows }]);
  }

  // ── Modal Field Rendering ─────────────────────────────────────────────────

  function renderModalFields() {
    if (!modalSection) return null;

    switch (modalSection) {
      case 'dbs_check':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>DBS Certificate Number</label>
                <input type="text" value={modalForm.dbs_number || ''} onChange={e => setField('dbs_number', e.target.value)} className={INPUT.base} placeholder="001234567890" />
              </div>
              <div>
                <label className={INPUT.label}>Issue Date</label>
                <input type="date" value={modalForm.issue_date || ''} onChange={e => setField('issue_date', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Disclosure Level</label>
                <select value={modalForm.disclosure_level || 'enhanced'} onChange={e => setField('disclosure_level', e.target.value)} className={INPUT.select}>
                  {DBS_DISCLOSURE_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Full DBS Status</label>
                <select value={modalForm.full_dbs_status || 'pending'} onChange={e => setField('full_dbs_status', e.target.value)} className={INPUT.select}>
                  {DBS_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={modalForm.barred_list_checked || false} onChange={e => setField('barred_list_checked', e.target.checked)} id="barred" />
                <label htmlFor="barred" className="text-sm text-gray-700">Adults' Barred List Checked</label>
              </div>
              <div>
                <label className={INPUT.label}>Adult First Result</label>
                <select value={modalForm.adult_first_result || 'not_used'} onChange={e => setField('adult_first_result', e.target.value)} className={INPUT.select}>
                  {ADULT_FIRST_STATUSES.map(s => <option key={s} value={s}>{s === 'not_used' ? 'Not Used' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={modalForm.update_service || false} onChange={e => setField('update_service', e.target.checked)} id="update_svc" />
                <label htmlFor="update_svc" className="text-sm text-gray-700">DBS Update Service</label>
              </div>
              {modalForm.update_service && (
                <div>
                  <label className={INPUT.label}>Update Service Ref</label>
                  <input type="text" value={modalForm.update_service_ref || ''} onChange={e => setField('update_service_ref', e.target.value)} className={INPUT.base} />
                </div>
              )}
            </div>
            {modalForm.update_service && (
              <div>
                <label className={INPUT.label}>Last Online Check Date</label>
                <input type="date" value={modalForm.last_online_check || ''} onChange={e => setField('last_online_check', e.target.value)} className={INPUT.base} />
              </div>
            )}
            <div>
              <label className={INPUT.label}>Verified By</label>
              <input type="text" value={modalForm.verified_by || ''} onChange={e => setField('verified_by', e.target.value)} className={INPUT.base} placeholder="Manager name" />
            </div>
            {modalForm.full_dbs_status === 'content' && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-3">
                <p className="text-xs font-semibold text-amber-800">DBS has content — risk assessment required (CQC FAQ)</p>
                <div>
                  <label className={INPUT.label}>Nature of Disclosure</label>
                  <textarea value={modalForm.risk_disclosure_nature || ''} onChange={e => setField('risk_disclosure_nature', e.target.value)} className={`${INPUT.base} h-16 resize-none`} placeholder="Summarise the disclosed information" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Risk Assessment Decision</label>
                    <select value={modalForm.risk_decision || ''} onChange={e => setField('risk_decision', e.target.value)} className={INPUT.select}>
                      <option value="">Select...</option>
                      {DBS_RISK_DECISIONS.map(d => <option key={d} value={d}>{d.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Assessment Date</label>
                    <input type="date" value={modalForm.risk_assessment_date || ''} onChange={e => setField('risk_assessment_date', e.target.value)} className={INPUT.base} />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Rationale</label>
                  <textarea value={modalForm.risk_rationale || ''} onChange={e => setField('risk_rationale', e.target.value)} className={`${INPUT.base} h-16 resize-none`} placeholder="Reasons why the decision was made" />
                </div>
                <div>
                  <label className={INPUT.label}>Risk Assessment Completed By</label>
                  <input type="text" value={modalForm.risk_assessed_by || ''} onChange={e => setField('risk_assessed_by', e.target.value)} className={INPUT.base} placeholder="Manager name" />
                </div>
              </div>
            )}
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600">Overseas Criminal Record Check</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={modalForm.overseas_check_applicable || false} onChange={e => setField('overseas_check_applicable', e.target.checked)} id="overseas_applicable" />
                <label htmlFor="overseas_applicable" className="text-sm text-gray-700">Staff lived abroad 6+ months in last 5 years</label>
              </div>
              {modalForm.overseas_check_applicable && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={INPUT.label}>Country</label>
                      <input type="text" value={modalForm.overseas_check_country || ''} onChange={e => setField('overseas_check_country', e.target.value)} className={INPUT.base} />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" checked={modalForm.overseas_check_obtained || false} onChange={e => setField('overseas_check_obtained', e.target.checked)} id="overseas_obtained" />
                      <label htmlFor="overseas_obtained" className="text-sm text-gray-700">Check obtained</label>
                    </div>
                  </div>
                  {modalForm.overseas_check_obtained
                    ? <div>
                        <label className={INPUT.label}>Check Date</label>
                        <input type="date" value={modalForm.overseas_check_date || ''} onChange={e => setField('overseas_check_date', e.target.value)} className={INPUT.base} />
                      </div>
                    : <div>
                        <label className={INPUT.label}>Reason Not Obtained</label>
                        <input type="text" value={modalForm.overseas_check_reason || ''} onChange={e => setField('overseas_check_reason', e.target.value)} className={INPUT.base} placeholder="Document efforts made and reason" />
                      </div>
                  }
                </div>
              )}
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600">Criminal Record Self-Declaration</p>
              <p className="text-[10px] text-gray-400">Pre-DBS self-declaration at shortlisting — care roles are exempt from Rehabilitation of Offenders Act 1974</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={modalForm.self_declaration_obtained || false} onChange={e => setField('self_declaration_obtained', e.target.checked)} id="self_dec" />
                  <label htmlFor="self_dec" className="text-sm text-gray-700">Self-declaration obtained</label>
                </div>
                {modalForm.self_declaration_obtained && (
                  <div>
                    <label className={INPUT.label}>Declaration Date</label>
                    <input type="date" value={modalForm.self_declaration_date || ''} onChange={e => setField('self_declaration_date', e.target.value)} className={INPUT.base} />
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'right_to_work':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Document Type</label>
                <select value={modalForm.document_type || ''} onChange={e => setField('document_type', e.target.value)} className={INPUT.select}>
                  <option value="">Select...</option>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Document Number</label>
                <input type="text" value={modalForm.document_number || ''} onChange={e => setField('document_number', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Expiry Date</label>
                <input type="date" value={modalForm.expiry_date || ''} onChange={e => setField('expiry_date', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Check Date</label>
                <input type="date" value={modalForm.check_date || ''} onChange={e => setField('check_date', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Checker Name</label>
                <input type="text" value={modalForm.checker_name || ''} onChange={e => setField('checker_name', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Follow-up Date (if time-limited)</label>
                <input type="date" value={modalForm.follow_up_date || ''} onChange={e => setField('follow_up_date', e.target.value)} className={INPUT.base} />
              </div>
            </div>
          </div>
        );

      case 'references': {
        const refEntries = modalForm.entries || [];
        const hasHscRef = refEntries.some(r => r.is_health_social_care);
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Schedule 3 para 4 — minimum 2 references; at least one must be from most recent health / social care employer</p>
            {!hasHscRef && refEntries.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700">
                No reference marked as health / social care employer — CQC most common enforcement finding
              </div>
            )}
            {refEntries.map((ref, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Reference {i + 1}</span>
                  <button onClick={() => { const arr = [...refEntries]; arr.splice(i, 1); setField('entries', arr); }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Referee Name</label>
                    <input type="text" value={ref.referee_name || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], referee_name: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Organisation</label>
                    <input type="text" value={ref.organisation || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], organisation: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Role / Relationship</label>
                    <input type="text" value={ref.relationship || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], relationship: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Dates Covered</label>
                    <input type="text" value={ref.dates_covered || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], dates_covered: e.target.value }; setField('entries', arr); }} className={INPUT.base} placeholder="e.g. 2022-2024" />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Reason for Leaving (Schedule 3 para 5)</label>
                  <input type="text" value={ref.reason_for_leaving || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], reason_for_leaving: e.target.value }; setField('entries', arr); }} className={INPUT.base} placeholder="Required where staff previously worked with vulnerable adults / children" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Received Date</label>
                    <input type="date" value={ref.received_date || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], received_date: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <input type="checkbox" checked={ref.satisfactory || false} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], satisfactory: e.target.checked }; setField('entries', arr); }} id={`ref-sat-${i}`} />
                    <label htmlFor={`ref-sat-${i}`} className="text-sm text-gray-700">Satisfactory</label>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={ref.is_health_social_care || false} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], is_health_social_care: e.target.checked }; setField('entries', arr); }} id={`ref-hsc-${i}`} />
                    <label htmlFor={`ref-hsc-${i}`} className="text-sm text-gray-700">Health / Social Care employer</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={ref.is_most_recent_hsc || false} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], is_most_recent_hsc: e.target.checked }; setField('entries', arr); }} id={`ref-recent-${i}`} />
                    <label htmlFor={`ref-recent-${i}`} className="text-sm text-gray-700">Most recent H&SC employer</label>
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Verified By</label>
                  <input type="text" value={ref.verified_by || ''} onChange={e => { const arr = [...refEntries]; arr[i] = { ...arr[i], verified_by: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                </div>
              </div>
            ))}
            <button onClick={() => setField('entries', [...refEntries, {}])} className={`${BTN.secondary} ${BTN.sm}`}>
              + Add Reference
            </button>
          </div>
        );
      }

      case 'identity_check':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Two forms required: one photo ID + one proof of address</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Photo ID Type</label>
                <select value={modalForm.photo_id_type || ''} onChange={e => setField('photo_id_type', e.target.value)} className={INPUT.select}>
                  <option value="">Select...</option>
                  {ID_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Photo ID Number</label>
                <input type="text" value={modalForm.photo_id_number || ''} onChange={e => setField('photo_id_number', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Photo ID Expiry</label>
                <input type="date" value={modalForm.photo_id_expiry || ''} onChange={e => setField('photo_id_expiry', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Address Proof Type</label>
                <select value={modalForm.address_proof_type || ''} onChange={e => setField('address_proof_type', e.target.value)} className={INPUT.select}>
                  <option value="">Select...</option>
                  {ADDRESS_PROOF_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Address Proof Date</label>
                <input type="date" value={modalForm.address_proof_date || ''} onChange={e => setField('address_proof_date', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Verification Date</label>
                <input type="date" value={modalForm.verification_date || ''} onChange={e => setField('verification_date', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div>
              <label className={INPUT.label}>Verified By</label>
              <input type="text" value={modalForm.verified_by || ''} onChange={e => setField('verified_by', e.target.value)} className={INPUT.base} />
            </div>
          </div>
        );

      case 'health_declaration':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Declaration Date</label>
                <input type="date" value={modalForm.declaration_date || ''} onChange={e => setField('declaration_date', e.target.value)} className={INPUT.base} />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={modalForm.conditions_disclosed || false} onChange={e => setField('conditions_disclosed', e.target.checked)} id="conditions" />
                <label htmlFor="conditions" className="text-sm text-gray-700">Conditions Disclosed</label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={modalForm.oh_referral_needed || false} onChange={e => setField('oh_referral_needed', e.target.checked)} id="oh_ref" />
                <label htmlFor="oh_ref" className="text-sm text-gray-700">OH Referral Needed</label>
              </div>
              {modalForm.oh_referral_needed && (
                <div>
                  <label className={INPUT.label}>OH Clearance Date</label>
                  <input type="date" value={modalForm.oh_clearance_date || ''} onChange={e => setField('oh_clearance_date', e.target.value)} className={INPUT.base} />
                </div>
              )}
            </div>
            <div>
              <label className={INPUT.label}>Restrictions / Adjustments</label>
              <input type="text" value={modalForm.restrictions || ''} onChange={e => setField('restrictions', e.target.value)} className={INPUT.base} placeholder="e.g. No manual handling above 20kg" />
            </div>
            <div>
              <label className={INPUT.label}>Review Date</label>
              <input type="date" value={modalForm.review_date || ''} onChange={e => setField('review_date', e.target.value)} className={INPUT.base} />
            </div>
          </div>
        );

      case 'qualifications': {
        const qualEntries = modalForm.entries || [];
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>NMC PIN (nurses only)</label>
                <input type="text" value={modalForm.nmc_pin || ''} onChange={e => setField('nmc_pin', e.target.value)} className={INPUT.base} placeholder="Leave blank if N/A" />
              </div>
              <div>
                <label className={INPUT.label}>NMC Expiry</label>
                <input type="date" value={modalForm.nmc_expiry || ''} onChange={e => setField('nmc_expiry', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={modalForm.care_certificate_from_prev || false} onChange={e => setField('care_certificate_from_prev', e.target.checked)} id="cc_prev" />
              <label htmlFor="cc_prev" className="text-sm text-gray-700">Care Certificate from Previous Employer</label>
            </div>
            <p className="text-xs text-gray-500 font-medium">Qualifications</p>
            {qualEntries.map((q, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Qualification {i + 1}</span>
                  <button onClick={() => { const entries = [...qualEntries]; entries.splice(i, 1); setField('entries', entries); }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Qualification Name</label>
                    <input type="text" value={q.name || ''} onChange={e => { const e2 = [...qualEntries]; e2[i] = { ...e2[i], name: e.target.value }; setField('entries', e2); }} className={INPUT.base} placeholder="e.g. NVQ Level 3" />
                  </div>
                  <div>
                    <label className={INPUT.label}>Level</label>
                    <input type="text" value={q.level || ''} onChange={e => { const e2 = [...qualEntries]; e2[i] = { ...e2[i], level: e.target.value }; setField('entries', e2); }} className={INPUT.base} placeholder="e.g. 3" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Awarding Body</label>
                    <input type="text" value={q.awarding_body || ''} onChange={e => { const e2 = [...qualEntries]; e2[i] = { ...e2[i], awarding_body: e.target.value }; setField('entries', e2); }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Date Achieved</label>
                    <input type="date" value={q.date_achieved || ''} onChange={e => { const e2 = [...qualEntries]; e2[i] = { ...e2[i], date_achieved: e.target.value }; setField('entries', e2); }} className={INPUT.base} />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Certificate Number</label>
                  <input type="text" value={q.certificate_number || ''} onChange={e => { const e2 = [...qualEntries]; e2[i] = { ...e2[i], certificate_number: e.target.value }; setField('entries', e2); }} className={INPUT.base} />
                </div>
              </div>
            ))}
            <button onClick={() => setField('entries', [...qualEntries, {}])} className={`${BTN.secondary} ${BTN.sm}`}>
              + Add Qualification
            </button>
          </div>
        );
      }

      case 'contract':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Contract Type</label>
                <select value={modalForm.contract_type || ''} onChange={e => setField('contract_type', e.target.value)} className={INPUT.select}>
                  <option value="">Select...</option>
                  {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Job Title</label>
                <input type="text" value={modalForm.job_title || ''} onChange={e => setField('job_title', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Start Date</label>
                <input type="date" value={modalForm.start_date || ''} onChange={e => setField('start_date', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Contracted Hours / Week</label>
                <input type="number" step="0.5" value={modalForm.contracted_hours ?? ''} onChange={e => { const v = parseFloat(e.target.value); setField('contracted_hours', isNaN(v) ? '' : v); }} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Hourly Rate</label>
                <input type="number" step="0.01" value={modalForm.hourly_rate ?? ''} onChange={e => { const v = parseFloat(e.target.value); setField('hourly_rate', isNaN(v) ? '' : v); }} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Notice Period</label>
                <input type="text" value={modalForm.notice_period || ''} onChange={e => setField('notice_period', e.target.value)} className={INPUT.base} placeholder="e.g. 4 weeks" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Probation End Date</label>
                <input type="date" value={modalForm.probation_end_date || ''} onChange={e => setField('probation_end_date', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Contract Issued Date</label>
                <input type="date" value={modalForm.contract_issued_date || ''} onChange={e => setField('contract_issued_date', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div>
              <label className={INPUT.label}>Signed Copy Received</label>
              <input type="date" value={modalForm.signed_copy_received || ''} onChange={e => setField('signed_copy_received', e.target.value)} className={INPUT.base} />
            </div>
          </div>
        );

      case 'employment_history': {
        const isVolunteer = onboardingData?.[modalStaffId]?.contract?.contract_type === 'volunteer';
        const empEntries = modalForm.entries || [];
        const gapExplanations = modalForm.gap_explanations || {};

        const sortedEntries = [...empEntries]
          .filter(e => e.start_date && e.end_date)
          .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
        const detectedGaps = [];
        for (let i = 0; i < sortedEntries.length - 1; i++) {
          const endMs = new Date(sortedEntries[i].end_date).getTime();
          const nextMs = new Date(sortedEntries[i + 1].start_date).getTime();
          const diffDays = Math.ceil((nextMs - endMs) / 86400000);
          if (diffDays > 28) {
            detectedGaps.push({ from: sortedEntries[i].end_date, to: sortedEntries[i + 1].start_date, days: diffDays });
          }
        }
        const unexplainedGaps = detectedGaps.filter(g => !gapExplanations[`${g.from}:${g.to}`]?.trim());

        return (
          <div className="space-y-3">
            {isVolunteer
              ? <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
                  Employment history not required for volunteers — SI 2023/1404 (in force 15 Jan 2024). All other Schedule 3 checks still apply.
                </div>
              : <p className="text-xs text-gray-500">Full career history from first employment with written explanation of all gaps &gt;28 days — Schedule 3 para 7. Most common CQC Reg 19 enforcement breach.</p>
            }
            {empEntries.map((entry, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Employment {i + 1}</span>
                  <button onClick={() => { const arr = [...empEntries]; arr.splice(i, 1); setField('entries', arr); }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Employer Name</label>
                    <input type="text" value={entry.employer_name || ''} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], employer_name: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Job Title / Role</label>
                    <input type="text" value={entry.role || ''} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], role: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Start Date</label>
                    <input type="date" value={entry.start_date || ''} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], start_date: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>End Date (blank if current)</label>
                    <input type="date" value={entry.end_date || ''} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], end_date: e.target.value }; setField('entries', arr); }} className={INPUT.base} />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Reason for Leaving</label>
                  <input type="text" value={entry.reason_for_leaving || ''} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], reason_for_leaving: e.target.value }; setField('entries', arr); }} className={INPUT.base} placeholder="e.g. End of contract, relocated, career change" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={entry.is_health_social_care || false} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], is_health_social_care: e.target.checked }; setField('entries', arr); }} id={`emp-hsc-${i}`} />
                    <label htmlFor={`emp-hsc-${i}`} className="text-sm text-gray-700">Health / Social Care</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={entry.reference_obtained || false} onChange={e => { const arr = [...empEntries]; arr[i] = { ...arr[i], reference_obtained: e.target.checked }; setField('entries', arr); }} id={`emp-ref-${i}`} />
                    <label htmlFor={`emp-ref-${i}`} className="text-sm text-gray-700">Reference obtained</label>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => setField('entries', [...empEntries, {}])} className={`${BTN.secondary} ${BTN.sm}`}>
              + Add Employment
            </button>
            {detectedGaps.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-700">Gaps detected — written explanation required (Schedule 3 para 7)</p>
                {detectedGaps.map(gap => {
                  const key = `${gap.from}:${gap.to}`;
                  return (
                    <div key={key} className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                      <div className="text-xs text-amber-700 mb-1">{gap.from} to {gap.to} ({gap.days} days)</div>
                      <input type="text" value={gapExplanations[key] || ''} onChange={e => {
                        setField('gap_explanations', { ...gapExplanations, [key]: e.target.value });
                      }} className={INPUT.base} placeholder="Written explanation of this gap" />
                    </div>
                  );
                })}
                {unexplainedGaps.length > 0 && (
                  <p className="text-xs text-red-600">{unexplainedGaps.length} gap{unexplainedGaps.length > 1 ? 's' : ''} without explanation — add before marking complete</p>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'day1_induction':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">All items must be completed before staff work unsupervised with residents</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Induction Date</label>
                <input type="date" value={modalForm.date || ''} onChange={e => setField('date', e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Trainer / Inductee</label>
                <input type="text" value={modalForm.trainer || ''} onChange={e => setField('trainer', e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg p-3 space-y-2">
              {DAY1_ITEMS.map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={modalForm[item.id] || false} onChange={e => setField(item.id, e.target.checked)} id={`d1-${item.id}`} />
                  <label htmlFor={`d1-${item.id}`} className="text-sm text-gray-700">{item.label}</label>
                </div>
              ))}
            </div>
          </div>
        );

      case 'policy_acknowledgement':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Staff must read and sign acknowledgement of key policies on Day 1</p>
            <div>
              <label className={INPUT.label}>Acknowledgement Date</label>
              <input type="date" value={modalForm.date || ''} onChange={e => setField('date', e.target.value)} className={INPUT.base} />
            </div>
            <div className="border border-gray-200 rounded-lg p-3 space-y-2">
              {POLICY_ITEMS.map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={modalForm[item.id] || false} onChange={e => setField(item.id, e.target.checked)} id={`pol-${item.id}`} />
                  <label htmlFor={`pol-${item.id}`} className="text-sm text-gray-700">{item.label}</label>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className={PAGE.container} role="status"><p className="text-gray-500 mt-8">Loading...</p></div>;
  if (error) return <div className={PAGE.container}><p className="text-red-600 mt-8">{error}</p></div>;

  const sectionName = ONBOARDING_SECTIONS.find(s => s.id === modalSection)?.name || '';
  const staffName = activeStaff.find(s => s.id === modalStaffId)?.name || '';

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Onboarding</h1>
          <p className="text-xs text-gray-500 mt-1">CQC Regulation 19 — Pre-employment checks & Day 1 induction</p>
        </div>
        <button onClick={handleExport} className={BTN.secondary}>Export Excel</button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl p-3 bg-blue-50 border border-blue-200">
          <div className="text-xs font-medium text-blue-600">Total Staff</div>
          <div className="text-2xl font-bold text-blue-700 mt-0.5">{activeStaff.length}</div>
          <div className="text-[10px] text-blue-400">active employees</div>
        </div>
        <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200">
          <div className="text-xs font-medium text-emerald-600">Fully Onboarded</div>
          <div className={`text-2xl font-bold mt-0.5 ${fullyOnboarded === activeStaff.length ? 'text-emerald-700' : 'text-amber-700'}`}>
            {activeStaff.length > 0 ? Math.round((fullyOnboarded / activeStaff.length) * 100) : 100}%
          </div>
          <div className="text-[10px] text-emerald-400">{fullyOnboarded}/{activeStaff.length} staff</div>
        </div>
        <div className="rounded-xl p-3 bg-red-50 border border-red-200">
          <div className="text-xs font-medium text-red-600">Pre-Employment Pending</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{preEmploymentPending}</div>
          <div className="text-[10px] text-red-400">checks outstanding</div>
        </div>
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
          <div className="text-xs font-medium text-amber-600">Induction Pending</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{inductionPending}</div>
          <div className="text-[10px] text-amber-400">items outstanding</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="all">All Staff</option>
          <option value="incomplete">Incomplete Only</option>
          <option value="complete">Complete Only</option>
        </select>
        <span className="text-xs text-gray-400 self-center">{filteredStaff.length} staff shown</span>
      </div>

      {/* Staff List */}
      <div className="space-y-2">
        {filteredStaff.map(s => {
          const progress = getStaffOnboardingProgress(s.id, onboardingData);
          const isExpanded = expanded === s.id;
          return (
            <div key={s.id} className={CARD.padded}>
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-medium text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                    {s.start_date && <span className="text-xs text-gray-400 ml-2">Started: {s.start_date}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${progress.pct === 100 ? 'bg-emerald-500' : progress.pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${progress.pct}%` }} />
                    </div>
                    <span className={`text-sm font-bold ${progress.pct === 100 ? 'text-emerald-600' : progress.pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {progress.completed}/{progress.total}
                    </span>
                  </div>
                  {progress.isComplete
                    ? <span className={BADGE.green}>Complete</span>
                    : <span className={BADGE.amber}>In Progress</span>
                  }
                  <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {/* Pre-employment */}
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Pre-Employment Checks</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {ONBOARDING_SECTIONS.filter(sec => sec.category === 'pre-employment').map(sec => {
                        const r = onboardingData?.[s.id]?.[sec.id];
                        const status = r?.status || ONBOARDING_STATUS.NOT_STARTED;
                        const display = STATUS_DISPLAY[status];
                        return (
                          <div key={sec.id}
                            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 text-xs cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => isAdmin && openModal(s.id, sec.id)}>
                            <div>
                              <div className="font-medium text-gray-800">{sec.name}</div>
                              <div className="text-[10px] text-gray-400 mt-0.5">{sec.legislation}</div>
                            </div>
                            <span className={BADGE[display.badgeKey]}>{display.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Induction */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Day 1 Induction</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {ONBOARDING_SECTIONS.filter(sec => sec.category === 'induction').map(sec => {
                        const r = onboardingData?.[s.id]?.[sec.id];
                        const status = r?.status || ONBOARDING_STATUS.NOT_STARTED;
                        const display = STATUS_DISPLAY[status];
                        return (
                          <div key={sec.id}
                            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 text-xs cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => isAdmin && openModal(s.id, sec.id)}>
                            <div>
                              <div className="font-medium text-gray-800">{sec.name}</div>
                              <div className="text-[10px] text-gray-400 mt-0.5">{sec.legislation}</div>
                            </div>
                            <span className={BADGE[display.badgeKey]}>{display.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No staff match the current filters</div>}
      </div>

      {/* Section Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setError(null); }} title={`${sectionName} — ${staffName}`} size="lg">
            <div className="mb-4">
              <label className={INPUT.label}>Status</label>
              <select value={modalForm.status || ONBOARDING_STATUS.NOT_STARTED} onChange={e => setField('status', e.target.value)} className={`${INPUT.select} w-auto`}>
                <option value={ONBOARDING_STATUS.NOT_STARTED}>Not Started</option>
                <option value={ONBOARDING_STATUS.IN_PROGRESS}>In Progress</option>
                <option value={ONBOARDING_STATUS.COMPLETED}>Completed</option>
              </select>
            </div>
            {renderModalFields()}
            <div>
              <label className={INPUT.label}>Notes</label>
              <input type="text" value={modalForm.notes || ''} onChange={e => setField('notes', e.target.value)} className={INPUT.base} placeholder="Optional notes" />
            </div>
            <div className={MODAL.footer}>
              {isAdmin && onboardingData?.[modalStaffId]?.[modalSection] && (
                <button onClick={handleClear} disabled={saving} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Remove</button>
              )}
              <button onClick={() => { setShowModal(false); setError(null); }} className={BTN.ghost}>Cancel</button>
              {isAdmin && (
                <button onClick={handleSave} disabled={saving} className={BTN.primary}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
      </Modal>
    </div>
  );
}
