import { useState, useMemo, useEffect, useRef } from 'react';
import { formatDate } from '../lib/rotation.js';
import {
  ONBOARDING_SECTIONS, ONBOARDING_STATUS, STATUS_DISPLAY,
  ensureOnboardingDefaults, buildOnboardingMatrix, getOnboardingStats,
  getStaffOnboardingProgress,
  DBS_DISCLOSURE_LEVELS, DBS_STATUSES, ADULT_FIRST_STATUSES,
  CONTRACT_TYPES, ID_TYPES, ADDRESS_PROOF_TYPES, DOC_TYPES,
  DAY1_ITEMS, POLICY_ITEMS,
} from '../lib/onboarding.js';
import { downloadXLSX } from '../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../lib/design.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

export default function OnboardingTracker({ data, updateData }) {
  const [search, setSearch] = useState('');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterStatus, setFilterStatus] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalSection, setModalSection] = useState(null);
  const [modalStaffId, setModalStaffId] = useState(null);
  const [modalForm, setModalForm] = useState({});
  const initRef = useRef(false);

  // Ensure defaults
  useEffect(() => {
    if (initRef.current) return;
    const updated = ensureOnboardingDefaults(data);
    if (updated) {
      initRef.current = true;
      updateData(updated);
    }
  }, [data]);

  const activeStaff = useMemo(() => data.staff.filter(s => s.active !== false), [data.staff]);
  const onboardingData = data.onboarding || {};

  const matrix = useMemo(() => buildOnboardingMatrix(activeStaff, ONBOARDING_SECTIONS, onboardingData), [activeStaff, onboardingData]);
  const stats = useMemo(() => getOnboardingStats(matrix), [matrix]);

  // Filtered staff
  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filterStatus === 'incomplete') {
      list = list.filter(s => {
        const p = getStaffOnboardingProgress(s.id, onboardingData);
        return !p.isComplete;
      });
    } else if (filterStatus === 'complete') {
      list = list.filter(s => {
        const p = getStaffOnboardingProgress(s.id, onboardingData);
        return p.isComplete;
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, filterStatus, onboardingData]);

  // Count fully onboarded
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

  // Open modal for a section
  function openModal(staffId, sectionId) {
    const existing = onboardingData?.[staffId]?.[sectionId] || {};
    setModalStaffId(staffId);
    setModalSection(sectionId);
    setModalForm({ status: ONBOARDING_STATUS.NOT_STARTED, ...existing });
    setShowModal(true);
  }

  // Save modal data
  function handleSave() {
    const newOnboarding = JSON.parse(JSON.stringify(onboardingData));
    if (!newOnboarding[modalStaffId]) newOnboarding[modalStaffId] = {};
    newOnboarding[modalStaffId][modalSection] = { ...modalForm };
    updateData({ ...data, onboarding: newOnboarding });
    setShowModal(false);
  }

  // Clear a section record
  function handleClear() {
    if (!confirm('Remove this onboarding record?')) return;
    const newOnboarding = JSON.parse(JSON.stringify(onboardingData));
    if (newOnboarding[modalStaffId]) {
      delete newOnboarding[modalStaffId][modalSection];
      if (Object.keys(newOnboarding[modalStaffId]).length === 0) delete newOnboarding[modalStaffId];
    }
    updateData({ ...data, onboarding: newOnboarding });
    setShowModal(false);
  }

  // Excel export
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

  // Update helper for form
  function setField(field, value) {
    setModalForm(prev => ({ ...prev, [field]: value }));
  }

  // Render section-specific modal content
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

      case 'references':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">CQC Reg 19 Schedule 3 — minimum 2 references covering last 3 years</p>
            {(modalForm.entries || []).map((ref, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Reference {i + 1}</span>
                  <button onClick={() => {
                    const entries = [...(modalForm.entries || [])];
                    entries.splice(i, 1);
                    setField('entries', entries);
                  }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Referee Name</label>
                    <input type="text" value={ref.referee_name || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], referee_name: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Organisation</label>
                    <input type="text" value={ref.organisation || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], organisation: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Role / Relationship</label>
                    <input type="text" value={ref.relationship || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], relationship: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Dates Covered</label>
                    <input type="text" value={ref.dates_covered || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], dates_covered: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} placeholder="e.g. 2022-2024" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Received Date</label>
                    <input type="date" value={ref.received_date || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], received_date: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <input type="checkbox" checked={ref.satisfactory || false} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], satisfactory: e.target.checked };
                      setField('entries', entries);
                    }} id={`ref-sat-${i}`} />
                    <label htmlFor={`ref-sat-${i}`} className="text-sm text-gray-700">Satisfactory</label>
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Verified By</label>
                  <input type="text" value={ref.verified_by || ''} onChange={e => {
                    const entries = [...(modalForm.entries || [])];
                    entries[i] = { ...entries[i], verified_by: e.target.value };
                    setField('entries', entries);
                  }} className={INPUT.base} />
                </div>
              </div>
            ))}
            <button onClick={() => setField('entries', [...(modalForm.entries || []), {}])} className={`${BTN.secondary} ${BTN.sm}`}>
              + Add Reference
            </button>
          </div>
        );

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

      case 'qualifications':
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
            {(modalForm.entries || []).map((q, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Qualification {i + 1}</span>
                  <button onClick={() => {
                    const entries = [...(modalForm.entries || [])];
                    entries.splice(i, 1);
                    setField('entries', entries);
                  }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Qualification Name</label>
                    <input type="text" value={q.name || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], name: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} placeholder="e.g. NVQ Level 3" />
                  </div>
                  <div>
                    <label className={INPUT.label}>Level</label>
                    <input type="text" value={q.level || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], level: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} placeholder="e.g. 3" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={INPUT.label}>Awarding Body</label>
                    <input type="text" value={q.awarding_body || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], awarding_body: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Date Achieved</label>
                    <input type="date" value={q.date_achieved || ''} onChange={e => {
                      const entries = [...(modalForm.entries || [])];
                      entries[i] = { ...entries[i], date_achieved: e.target.value };
                      setField('entries', entries);
                    }} className={INPUT.base} />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Certificate Number</label>
                  <input type="text" value={q.certificate_number || ''} onChange={e => {
                    const entries = [...(modalForm.entries || [])];
                    entries[i] = { ...entries[i], certificate_number: e.target.value };
                    setField('entries', entries);
                  }} className={INPUT.base} />
                </div>
              </div>
            ))}
            <button onClick={() => setField('entries', [...(modalForm.entries || []), {}])} className={`${BTN.secondary} ${BTN.sm}`}>
              + Add Qualification
            </button>
          </div>
        );

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
                <input type="number" step="0.5" value={modalForm.contracted_hours || ''} onChange={e => setField('contracted_hours', parseFloat(e.target.value) || '')} className={INPUT.base} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Hourly Rate</label>
                <input type="number" step="0.01" value={modalForm.hourly_rate || ''} onChange={e => setField('hourly_rate', parseFloat(e.target.value) || '')} className={INPUT.base} />
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
                            onClick={() => openModal(s.id, sec.id)}>
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
                            onClick={() => openModal(s.id, sec.id)}>
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
      {showModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className={`${MODAL.panelLg} max-h-[85vh] overflow-y-auto`}>
            <h2 className={MODAL.title}>{sectionName} — {staffName}</h2>
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
              {onboardingData?.[modalStaffId]?.[modalSection] && (
                <button onClick={handleClear} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Remove</button>
              )}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSave} className={BTN.primary}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
