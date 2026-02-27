import { useState, useMemo, useEffect, useRef } from 'react';
import { formatDate } from '../lib/rotation.js';
import {
  getTrainingTypes, ensureTrainingDefaults, buildComplianceMatrix, getComplianceStats,
  calculateExpiry, TRAINING_METHODS, TRAINING_STATUS, STATUS_DISPLAY,
  getRequiredLevel,
  getSupervisionStatus, getSupervisionStats, getSupervisionFrequency, isInProbation,
  getAppraisalStatus, getAppraisalStats,
  getFireDrillStatus,
} from '../lib/training.js';
import { downloadXLSX } from '../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../lib/design.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];
const SECTIONS = [
  { id: 'training', label: 'Training' },
  { id: 'supervisions', label: 'Supervisions' },
  { id: 'appraisals', label: 'Appraisals' },
  { id: 'fire_drills', label: 'Fire Drills' },
];

const CELL_COLORS = {
  compliant:     'bg-emerald-200 text-emerald-800 hover:bg-emerald-300 cursor-pointer hover:shadow-sm',
  expiring_soon: 'bg-amber-200 text-amber-800 hover:bg-amber-300 cursor-pointer hover:shadow-sm',
  urgent:        'bg-red-200 text-red-800 hover:bg-red-300 cursor-pointer hover:shadow-sm',
  expired:       'bg-red-300 text-red-900 hover:bg-red-400 cursor-pointer hover:shadow-sm',
  not_started:   'bg-gray-100 text-gray-400 border border-dashed border-gray-300 hover:bg-gray-200 cursor-pointer hover:shadow-sm',
  not_required:  'bg-white text-gray-300 cursor-default opacity-30',
  wrong_level:   'bg-orange-200 text-orange-800 hover:bg-orange-300 cursor-pointer hover:shadow-sm',
};

const SUP_STATUS_BADGE = {
  up_to_date: { badge: BADGE.green, label: 'Up to Date' },
  due_soon:   { badge: BADGE.amber, label: 'Due Soon' },
  due:        { badge: BADGE.orange, label: 'Overdue' },
  overdue:    { badge: BADGE.red, label: 'Overdue' },
  not_started:{ badge: BADGE.gray, label: 'No Records' },
};

export default function TrainingMatrix({ data, updateData }) {
  const [section, setSection] = useState('training');
  const [view, setView] = useState('matrix');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterCompliance, setFilterCompliance] = useState('all');
  const [search, setSearch] = useState('');
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [modalData, setModalData] = useState({ staffId: '', typeId: '', completed: '', trainer: '', method: 'classroom', certificate_ref: '', evidence_ref: '', notes: '', level: '', existing: false });
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [showManageTypes, setShowManageTypes] = useState(false);
  const [expanded, setExpanded] = useState(null);
  // Supervision modal
  const [showSupModal, setShowSupModal] = useState(false);
  const [supModalData, setSupModalData] = useState({ staffId: '', id: '', date: '', supervisor: '', topics: '', actions: '', next_due: '', notes: '', existing: false });
  // Appraisal modal
  const [showAprModal, setShowAprModal] = useState(false);
  const [aprModalData, setAprModalData] = useState({ staffId: '', id: '', date: '', appraiser: '', objectives: '', training_needs: '', development_plan: '', next_due: '', notes: '', existing: false });
  // Fire drill modal
  const [showDrillModal, setShowDrillModal] = useState(false);
  const [drillModalData, setDrillModalData] = useState({ id: '', date: '', time: '', scenario: '', evacuation_time_seconds: '', staff_present: [], residents_evacuated: '', issues: '', corrective_actions: '', conducted_by: '', notes: '', existing: false });
  // Supervision/appraisal status filter
  const [supFilter, setSupFilter] = useState('all');

  const initRef = useRef(false);

  // Ensure defaults on first load
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const updated = ensureTrainingDefaults(data);
    if (updated) updateData(updated);
  }, [data]);

  const today = new Date();
  const todayStr = formatDate(today);
  const trainingTypes = useMemo(() => getTrainingTypes(data.config).filter(t => t.active), [data.config]);
  const activeStaff = useMemo(() => data.staff.filter(s => s.active !== false), [data.staff]);
  const trainingData = data.training || {};
  const supervisionsData = data.supervisions || {};
  const appraisalsData = data.appraisals || {};
  const fireDrills = data.fire_drills || [];

  const matrix = useMemo(() => buildComplianceMatrix(activeStaff, trainingTypes, trainingData, today), [activeStaff, trainingTypes, trainingData]);
  const stats = useMemo(() => getComplianceStats(matrix), [matrix]);
  const supStats = useMemo(() => getSupervisionStats(activeStaff, data.config, supervisionsData, today), [activeStaff, data.config, supervisionsData]);
  const aprStats = useMemo(() => getAppraisalStats(activeStaff, appraisalsData, today), [activeStaff, appraisalsData]);
  const drillStatus = useMemo(() => getFireDrillStatus(fireDrills, today), [fireDrills]);

  // Filtered types
  const filteredTypes = useMemo(() => {
    if (filterCategory === 'all') return trainingTypes;
    return trainingTypes.filter(t => t.category === filterCategory);
  }, [trainingTypes, filterCategory]);

  // Filtered staff
  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (section === 'training') {
      if (filterCompliance === 'non-compliant') {
        list = list.filter(s => {
          const staffMap = matrix.get(s.id);
          if (!staffMap) return false;
          for (const [, r] of staffMap) {
            if (r.status === TRAINING_STATUS.EXPIRED || r.status === TRAINING_STATUS.URGENT || r.status === TRAINING_STATUS.NOT_STARTED || r.status === TRAINING_STATUS.WRONG_LEVEL) return true;
          }
          return false;
        });
      }
    } else if (section === 'supervisions') {
      if (supFilter !== 'all') {
        list = list.filter(s => {
          const result = getSupervisionStatus(s, data.config, supervisionsData, today);
          if (supFilter === 'overdue') return result.status === 'overdue' || result.status === 'due';
          if (supFilter === 'due_soon') return result.status === 'due_soon';
          if (supFilter === 'up_to_date') return result.status === 'up_to_date';
          return true;
        });
      }
    } else if (section === 'appraisals') {
      if (supFilter !== 'all') {
        list = list.filter(s => {
          const result = getAppraisalStatus(s, appraisalsData, today);
          if (supFilter === 'overdue') return result.status === 'overdue';
          if (supFilter === 'due_soon') return result.status === 'due_soon';
          if (supFilter === 'up_to_date') return result.status === 'up_to_date';
          return true;
        });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, filterCompliance, supFilter, matrix, section, data.config, supervisionsData, appraisalsData]);

  // ── Training Tab Functions ──────────────────────────────────────────────

  function openRecordModal(staffId, typeId) {
    const existing = trainingData[staffId]?.[typeId];
    if (existing) {
      setModalData({ staffId, typeId, completed: existing.completed, trainer: existing.trainer || '', method: existing.method || 'classroom', certificate_ref: existing.certificate_ref || '', evidence_ref: existing.evidence_ref || '', notes: existing.notes || '', level: existing.level || '', existing: true });
    } else {
      setModalData({ staffId, typeId, completed: todayStr, trainer: '', method: 'classroom', certificate_ref: '', evidence_ref: '', notes: '', level: '', existing: false });
    }
    setShowRecordModal(true);
  }

  function handleSaveRecord() {
    const type = trainingTypes.find(t => t.id === modalData.typeId);
    if (!type || !modalData.staffId || !modalData.completed) return;
    const newTraining = JSON.parse(JSON.stringify(trainingData));
    if (!newTraining[modalData.staffId]) newTraining[modalData.staffId] = {};
    const record = {
      completed: modalData.completed,
      expiry: calculateExpiry(modalData.completed, type.refresher_months),
      trainer: modalData.trainer,
      method: modalData.method,
      certificate_ref: modalData.certificate_ref,
      evidence_ref: modalData.evidence_ref,
      notes: modalData.notes,
    };
    if (type.levels && modalData.level) record.level = modalData.level;
    newTraining[modalData.staffId][modalData.typeId] = record;
    updateData({ ...data, training: newTraining });
    setShowRecordModal(false);
  }

  function handleDeleteRecord() {
    if (!confirm('Remove this training record?')) return;
    const newTraining = JSON.parse(JSON.stringify(trainingData));
    if (newTraining[modalData.staffId]) {
      delete newTraining[modalData.staffId][modalData.typeId];
      if (Object.keys(newTraining[modalData.staffId]).length === 0) delete newTraining[modalData.staffId];
    }
    updateData({ ...data, training: newTraining });
    setShowRecordModal(false);
  }

  const modalExpiry = useMemo(() => {
    if (!modalData.completed || !modalData.typeId) return '';
    const type = trainingTypes.find(t => t.id === modalData.typeId);
    if (!type) return '';
    return calculateExpiry(modalData.completed, type.refresher_months);
  }, [modalData.completed, modalData.typeId, trainingTypes]);

  // Get levels for the current modal type
  const modalTypeLevels = useMemo(() => {
    if (!modalData.typeId) return null;
    const type = trainingTypes.find(t => t.id === modalData.typeId);
    return type?.levels || null;
  }, [modalData.typeId, trainingTypes]);

  function staffCompliancePct(staffId) {
    const staffMap = matrix.get(staffId);
    if (!staffMap) return 100;
    let required = 0, compliant = 0;
    for (const [, r] of staffMap) {
      if (r.status === TRAINING_STATUS.NOT_REQUIRED) continue;
      required++;
      if (r.status === TRAINING_STATUS.COMPLIANT || r.status === TRAINING_STATUS.EXPIRING_SOON) compliant++;
    }
    return required > 0 ? Math.round((compliant / required) * 100) : 100;
  }

  function addTrainingType() {
    const id = 'custom-' + Date.now();
    const types = [...getTrainingTypes(data.config), { id, name: 'New Training', category: 'mandatory', refresher_months: 12, roles: null, legislation: '', active: true }];
    updateData({ ...data, config: { ...data.config, training_types: types } });
  }

  function updateTrainingType(id, field, value) {
    const types = getTrainingTypes(data.config).map(t => t.id === id ? { ...t, [field]: value } : t);
    updateData({ ...data, config: { ...data.config, training_types: types } });
  }

  function removeTrainingType(id) {
    if (!confirm('Remove this training type? Existing records will be kept.')) return;
    const types = getTrainingTypes(data.config).filter(t => t.id !== id);
    updateData({ ...data, config: { ...data.config, training_types: types } });
  }

  // ── Supervision Tab Functions ───────────────────────────────────────────

  function openSupModal(staffId, session) {
    if (session) {
      setSupModalData({ staffId, id: session.id, date: session.date, supervisor: session.supervisor || '', topics: session.topics || '', actions: session.actions || '', next_due: session.next_due || '', notes: session.notes || '', existing: true });
    } else {
      const staff = activeStaff.find(s => s.id === staffId);
      const freq = staff ? getSupervisionFrequency(staff, data.config, today) : 49;
      const nextDue = new Date(today);
      nextDue.setUTCDate(nextDue.getUTCDate() + freq);
      setSupModalData({ staffId, id: 'sup-' + Date.now(), date: todayStr, supervisor: '', topics: '', actions: '', next_due: formatDate(nextDue), notes: '', existing: false });
    }
    setShowSupModal(true);
  }

  function handleSaveSup() {
    if (!supModalData.staffId || !supModalData.date) return;
    const newSups = JSON.parse(JSON.stringify(supervisionsData));
    if (!newSups[supModalData.staffId]) newSups[supModalData.staffId] = [];
    const effectiveNextDue = supModalData.existing ? supModalData.next_due : supNextDue;
    const record = {
      id: supModalData.id,
      date: supModalData.date,
      supervisor: supModalData.supervisor,
      topics: supModalData.topics,
      actions: supModalData.actions,
      next_due: effectiveNextDue,
      notes: supModalData.notes,
    };
    const idx = newSups[supModalData.staffId].findIndex(s => s.id === supModalData.id);
    if (idx >= 0) newSups[supModalData.staffId][idx] = record;
    else newSups[supModalData.staffId].push(record);
    updateData({ ...data, supervisions: newSups });
    setShowSupModal(false);
  }

  function handleDeleteSup() {
    if (!confirm('Delete this supervision record?')) return;
    const newSups = JSON.parse(JSON.stringify(supervisionsData));
    if (newSups[supModalData.staffId]) {
      newSups[supModalData.staffId] = newSups[supModalData.staffId].filter(s => s.id !== supModalData.id);
      if (newSups[supModalData.staffId].length === 0) delete newSups[supModalData.staffId];
    }
    updateData({ ...data, supervisions: newSups });
    setShowSupModal(false);
  }

  // Auto-calculate next_due when date changes
  const supNextDue = useMemo(() => {
    if (!supModalData.date || !supModalData.staffId) return supModalData.next_due;
    if (supModalData.existing) return supModalData.next_due;
    const staff = activeStaff.find(s => s.id === supModalData.staffId);
    if (!staff) return supModalData.next_due;
    const freq = getSupervisionFrequency(staff, data.config, today);
    const d = new Date(supModalData.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + freq);
    return formatDate(d);
  }, [supModalData.date, supModalData.staffId, supModalData.existing]);

  // ── Appraisal Tab Functions ─────────────────────────────────────────────

  function openAprModal(staffId, appraisal) {
    if (appraisal) {
      setAprModalData({ staffId, id: appraisal.id, date: appraisal.date, appraiser: appraisal.appraiser || '', objectives: appraisal.objectives || '', training_needs: appraisal.training_needs || '', development_plan: appraisal.development_plan || '', next_due: appraisal.next_due || '', notes: appraisal.notes || '', existing: true });
    } else {
      const nextDue = new Date(today);
      nextDue.setUTCFullYear(nextDue.getUTCFullYear() + 1);
      setAprModalData({ staffId, id: 'apr-' + Date.now(), date: todayStr, appraiser: '', objectives: '', training_needs: '', development_plan: '', next_due: formatDate(nextDue), notes: '', existing: false });
    }
    setShowAprModal(true);
  }

  function handleSaveApr() {
    if (!aprModalData.staffId || !aprModalData.date) return;
    const newAprs = JSON.parse(JSON.stringify(appraisalsData));
    if (!newAprs[aprModalData.staffId]) newAprs[aprModalData.staffId] = [];
    const effectiveNextDue = aprModalData.existing ? aprModalData.next_due : aprNextDue;
    const record = {
      id: aprModalData.id,
      date: aprModalData.date,
      appraiser: aprModalData.appraiser,
      objectives: aprModalData.objectives,
      training_needs: aprModalData.training_needs,
      development_plan: aprModalData.development_plan,
      next_due: effectiveNextDue,
      notes: aprModalData.notes,
    };
    const idx = newAprs[aprModalData.staffId].findIndex(a => a.id === aprModalData.id);
    if (idx >= 0) newAprs[aprModalData.staffId][idx] = record;
    else newAprs[aprModalData.staffId].push(record);
    updateData({ ...data, appraisals: newAprs });
    setShowAprModal(false);
  }

  function handleDeleteApr() {
    if (!confirm('Delete this appraisal record?')) return;
    const newAprs = JSON.parse(JSON.stringify(appraisalsData));
    if (newAprs[aprModalData.staffId]) {
      newAprs[aprModalData.staffId] = newAprs[aprModalData.staffId].filter(a => a.id !== aprModalData.id);
      if (newAprs[aprModalData.staffId].length === 0) delete newAprs[aprModalData.staffId];
    }
    updateData({ ...data, appraisals: newAprs });
    setShowAprModal(false);
  }

  // Auto-calculate appraisal next_due
  const aprNextDue = useMemo(() => {
    if (!aprModalData.date) return aprModalData.next_due;
    if (aprModalData.existing) return aprModalData.next_due;
    const d = new Date(aprModalData.date + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return formatDate(d);
  }, [aprModalData.date, aprModalData.existing]);

  // ── Fire Drill Tab Functions ────────────────────────────────────────────

  function openDrillModal(drill) {
    if (drill) {
      setDrillModalData({ id: drill.id, date: drill.date, time: drill.time || '', scenario: drill.scenario || '', evacuation_time_seconds: drill.evacuation_time_seconds ?? '', staff_present: drill.staff_present || [], residents_evacuated: drill.residents_evacuated ?? '', issues: drill.issues || '', corrective_actions: drill.corrective_actions || '', conducted_by: drill.conducted_by || '', notes: drill.notes || '', existing: true });
    } else {
      setDrillModalData({ id: 'fd-' + Date.now(), date: todayStr, time: '', scenario: '', evacuation_time_seconds: '', staff_present: [], residents_evacuated: '', issues: '', corrective_actions: '', conducted_by: '', notes: '', existing: false });
    }
    setShowDrillModal(true);
  }

  function handleSaveDrill() {
    if (!drillModalData.date) return;
    const newDrills = JSON.parse(JSON.stringify(fireDrills));
    const record = {
      id: drillModalData.id,
      date: drillModalData.date,
      time: drillModalData.time,
      scenario: drillModalData.scenario,
      evacuation_time_seconds: parseInt(drillModalData.evacuation_time_seconds) || 0,
      staff_present: drillModalData.staff_present,
      residents_evacuated: parseInt(drillModalData.residents_evacuated) || 0,
      issues: drillModalData.issues,
      corrective_actions: drillModalData.corrective_actions,
      conducted_by: drillModalData.conducted_by,
      notes: drillModalData.notes,
    };
    const idx = newDrills.findIndex(d => d.id === drillModalData.id);
    if (idx >= 0) newDrills[idx] = record;
    else newDrills.push(record);
    updateData({ ...data, fire_drills: newDrills });
    setShowDrillModal(false);
  }

  function handleDeleteDrill() {
    if (!confirm('Delete this fire drill record?')) return;
    const newDrills = JSON.parse(JSON.stringify(fireDrills)).filter(d => d.id !== drillModalData.id);
    updateData({ ...data, fire_drills: newDrills });
    setShowDrillModal(false);
  }

  function toggleDrillStaff(staffId) {
    const present = [...drillModalData.staff_present];
    const idx = present.indexOf(staffId);
    if (idx >= 0) present.splice(idx, 1);
    else present.push(staffId);
    setDrillModalData({ ...drillModalData, staff_present: present });
  }

  // ── Excel Export ────────────────────────────────────────────────────────

  function handleExport() {
    if (section === 'training') {
      const headers = ['Name', 'Team', 'Role', ...filteredTypes.map(t => t.name)];
      const rows = filteredStaff.map(s => {
        const staffMap = matrix.get(s.id);
        return [s.name, s.team, s.role, ...filteredTypes.map(t => {
          const r = staffMap?.get(t.id);
          if (!r) return '';
          if (r.status === TRAINING_STATUS.NOT_REQUIRED) return 'N/A';
          if (r.status === TRAINING_STATUS.NOT_STARTED) return 'Not Started';
          if (r.status === TRAINING_STATUS.WRONG_LEVEL) return `Wrong Level (has ${r.record?.level || 'none'}, needs ${r.requiredLevel?.id})`;
          return r.record ? `${r.record.completed} (exp: ${r.record.expiry})` : r.status;
        })];
      });
      downloadXLSX('training_matrix', [{ name: 'Training Matrix', headers, rows }]);
    } else if (section === 'supervisions') {
      const headers = ['Name', 'Team', 'Role', 'Status', 'Last Session', 'Next Due', 'Supervisor'];
      const rows = filteredStaff.map(s => {
        const result = getSupervisionStatus(s, data.config, supervisionsData, today);
        return [s.name, s.team, s.role, result.status, result.lastSession?.date || '-', result.nextDue || '-', result.lastSession?.supervisor || '-'];
      });
      downloadXLSX('supervisions', [{ name: 'Supervisions', headers, rows }]);
    } else if (section === 'appraisals') {
      const headers = ['Name', 'Team', 'Role', 'Status', 'Last Appraisal', 'Next Due', 'Appraiser'];
      const rows = filteredStaff.map(s => {
        const result = getAppraisalStatus(s, appraisalsData, today);
        return [s.name, s.team, s.role, result.status, result.lastAppraisal?.date || '-', result.nextDue || '-', result.lastAppraisal?.appraiser || '-'];
      });
      downloadXLSX('appraisals', [{ name: 'Appraisals', headers, rows }]);
    } else if (section === 'fire_drills') {
      const headers = ['Date', 'Time', 'Scenario', 'Evacuation Time (s)', 'Staff Count', 'Residents', 'Issues', 'Conducted By'];
      const sorted = [...fireDrills].sort((a, b) => b.date.localeCompare(a.date));
      const rows = sorted.map(d => [d.date, d.time || '-', d.scenario || '-', d.evacuation_time_seconds || '-', d.staff_present?.length || 0, d.residents_evacuated || '-', d.issues || '-', d.conducted_by || '-']);
      downloadXLSX('fire_drills', [{ name: 'Fire Drills', headers, rows }]);
    }
  }

  // ── CSV Import ─────────────────────────────────────────────────────────

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['File must have a header row and at least one data row'] };

    const parseRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQuotes = !inQuotes; continue; }
        if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
        current += line[i];
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const nameCol = headers.findIndex(h => h.includes('staff') && h.includes('name') || h === 'name');
    const idCol = headers.findIndex(h => h.includes('staff') && h.includes('id') || h === 'id');
    const typeCol = headers.findIndex(h => h.includes('training') || h.includes('course') || h.includes('type'));
    const dateCol = headers.findIndex(h => h.includes('date') || h.includes('completed'));
    const trainerCol = headers.findIndex(h => h.includes('trainer'));
    const methodCol = headers.findIndex(h => h.includes('method'));
    const certCol = headers.findIndex(h => h.includes('cert'));

    if (typeCol === -1 || dateCol === -1) {
      return { rows: [], errors: ['CSV must have columns for training type and completed date'] };
    }

    const rows = [];
    const errors = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const rawName = nameCol >= 0 ? cols[nameCol] : '';
      const rawId = idCol >= 0 ? cols[idCol] : '';
      const rawType = typeCol >= 0 ? cols[typeCol] : '';
      let rawDate = dateCol >= 0 ? cols[dateCol] : '';

      // Parse DD/MM/YYYY or DD-MM-YYYY to YYYY-MM-DD
      const ddmmyyyy = rawDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (ddmmyyyy) rawDate = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;

      // Match staff
      let matchedStaff = null;
      if (rawId) matchedStaff = activeStaff.find(s => s.id === rawId);
      if (!matchedStaff && rawName) matchedStaff = activeStaff.find(s => s.name.toLowerCase() === rawName.toLowerCase());

      // Match training type
      let matchedType = null;
      if (rawType) {
        matchedType = trainingTypes.find(t => t.id === rawType.toLowerCase()) ||
          trainingTypes.find(t => t.name.toLowerCase() === rawType.toLowerCase()) ||
          trainingTypes.find(t => t.name.toLowerCase().includes(rawType.toLowerCase()));
      }

      const row = {
        line: i + 1,
        rawName: rawName || rawId,
        rawType,
        rawDate,
        trainer: trainerCol >= 0 ? cols[trainerCol] || '' : '',
        method: methodCol >= 0 ? cols[methodCol] || '' : '',
        certRef: certCol >= 0 ? cols[certCol] || '' : '',
        matchedStaff,
        matchedType,
        valid: !!matchedStaff && !!matchedType && /^\d{4}-\d{2}-\d{2}$/.test(rawDate),
      };
      if (!matchedStaff) errors.push(`Row ${i + 1}: Staff "${rawName || rawId}" not found`);
      if (!matchedType) errors.push(`Row ${i + 1}: Training type "${rawType}" not matched`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) errors.push(`Row ${i + 1}: Invalid date "${rawDate}"`);
      rows.push(row);
    }
    return { rows, errors };
  }

  function handleCSVFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows, errors } = parseCSV(ev.target.result);
      setCsvRows(rows);
      setCsvErrors(errors);
    };
    reader.readAsText(file);
  }

  function handleImportCSV() {
    const validRows = csvRows.filter(r => r.valid);
    if (validRows.length === 0) return;
    const newTraining = JSON.parse(JSON.stringify(trainingData));
    for (const row of validRows) {
      const staffId = row.matchedStaff.id;
      const typeId = row.matchedType.id;
      if (!newTraining[staffId]) newTraining[staffId] = {};
      const method = TRAINING_METHODS.includes(row.method?.toLowerCase()) ? row.method.toLowerCase() : 'e-learning';
      newTraining[staffId][typeId] = {
        completed: row.rawDate,
        expiry: calculateExpiry(row.rawDate, row.matchedType.refresher_months),
        trainer: row.trainer,
        method,
        certificate_ref: row.certRef,
        evidence_ref: '',
        notes: 'Imported from CSV',
      };
    }
    updateData({ ...data, training: newTraining });
    setShowImportModal(false);
    setCsvRows([]);
    setCsvErrors([]);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Training Matrix</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Matrix</h1>
          <p className="text-xs text-gray-500 mt-1">CQC Regulation 18 — Training, supervision & development</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={BTN.secondary}>Export Excel</button>
          {section === 'training' && <button onClick={() => setShowImportModal(true)} className={BTN.secondary}>Import CSV</button>}
          <button onClick={() => window.print()} className={BTN.secondary}>Print</button>
          {section === 'training' && (
            <button onClick={() => setView(view === 'matrix' ? 'list' : 'matrix')} className={BTN.secondary}>
              {view === 'matrix' ? 'List View' : 'Grid View'}
            </button>
          )}
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 print:hidden">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => { setSection(s.id); setExpanded(null); setSupFilter('all'); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              section === s.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ══════════════ TRAINING TAB ══════════════ */}
      {section === 'training' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200">
              <div className="text-xs font-medium text-emerald-600">Compliance</div>
              <div className={`text-2xl font-bold mt-0.5 ${stats.compliancePct >= 90 ? 'text-emerald-700' : stats.compliancePct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{stats.compliancePct}%</div>
              <div className="text-[10px] text-emerald-500">{stats.compliant}/{stats.totalRequired} items</div>
            </div>
            <div className="rounded-xl p-3 bg-red-50 border border-red-200">
              <div className="text-xs font-medium text-red-600">Expired</div>
              <div className="text-2xl font-bold text-red-700 mt-0.5">{stats.expired}</div>
              <div className="text-[10px] text-red-400">require immediate action</div>
            </div>
            <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
              <div className="text-xs font-medium text-amber-600">Expiring Soon</div>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">{stats.expiringSoon + stats.urgent}</div>
              <div className="text-[10px] text-amber-400">within 60 days</div>
            </div>
            <div className="rounded-xl p-3 bg-orange-50 border border-orange-200">
              <div className="text-xs font-medium text-orange-600">Wrong Level</div>
              <div className="text-2xl font-bold text-orange-700 mt-0.5">{stats.wrongLevel}</div>
              <div className="text-[10px] text-orange-400">level mismatch</div>
            </div>
            <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
              <div className="text-xs font-medium text-gray-500">Not Started</div>
              <div className="text-2xl font-bold text-gray-700 mt-0.5">{stats.notStarted}</div>
              <div className="text-[10px] text-gray-400">no record yet</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap print:hidden">
            <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
            <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="All">All Teams</option>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="all">All Categories</option>
              <option value="statutory">Statutory</option>
              <option value="mandatory">Mandatory</option>
            </select>
            <select value={filterCompliance} onChange={e => setFilterCompliance(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="all">All Staff</option>
              <option value="non-compliant">Non-Compliant Only</option>
            </select>
            <span className="text-xs text-gray-400 self-center">{filteredStaff.length} staff | {filteredTypes.length} training types</span>
          </div>

          {/* Matrix View */}
          {view === 'matrix' && (
            <div className={CARD.flush}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="py-2 px-2 text-left font-semibold text-gray-600 sticky left-0 bg-white z-10 min-w-[140px]">Staff</th>
                      {filteredTypes.map(t => (
                        <th key={t.id} className="py-2 px-0.5 text-center font-medium text-gray-600" style={{ minWidth: '80px', maxWidth: '120px', fontSize: '10px', lineHeight: '1.2' }}>
                          {t.name}
                        </th>
                      ))}
                      <th className="py-2 px-2 text-center font-semibold text-gray-600 min-w-[50px]">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.map(s => {
                      const staffMap = matrix.get(s.id);
                      const pct = staffCompliancePct(s.id);
                      return (
                        <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/30">
                          <td className="py-1 px-2 font-medium text-gray-800 sticky left-0 bg-white z-10">
                            <div>{s.name}</div>
                            <div className="text-[9px] text-gray-400">{s.team} · {s.role}</div>
                          </td>
                          {filteredTypes.map(t => {
                            const r = staffMap?.get(t.id);
                            if (!r) return <td key={t.id} className="py-1 px-0.5 text-center"><div className="w-full h-9" /></td>;
                            const display = STATUS_DISPLAY[r.status];
                            return (
                              <td key={t.id} className="py-1 px-0.5 text-center">
                                <button
                                  onClick={() => r.status !== TRAINING_STATUS.NOT_REQUIRED && openRecordModal(s.id, t.id)}
                                  disabled={r.status === TRAINING_STATUS.NOT_REQUIRED}
                                  className={`w-full h-9 rounded-lg text-[10px] font-bold flex items-center justify-center transition-all ${CELL_COLORS[r.status]}`}
                                  title={`${s.name} — ${t.name}: ${display.label}${r.daysUntilExpiry != null ? ` (${r.daysUntilExpiry}d)` : ''}${r.requiredLevel ? ` [needs ${r.requiredLevel.name}]` : ''}`}
                                >
                                  {display.symbol}
                                </button>
                              </td>
                            );
                          })}
                          <td className="py-1 px-2 text-center">
                            <span className={`text-xs font-bold ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No staff match the current filters</div>}
            </div>
          )}

          {/* List View */}
          {view === 'list' && (
            <div className="space-y-2">
              {filteredStaff.map(s => {
                const staffMap = matrix.get(s.id);
                const pct = staffCompliancePct(s.id);
                const isExpanded = expanded === s.id;
                return (
                  <div key={s.id} className={CARD.padded}>
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                      <div>
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                        <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {filteredTypes.map(t => {
                            const r = staffMap?.get(t.id);
                            if (!r || r.status === TRAINING_STATUS.NOT_REQUIRED) return null;
                            const display = STATUS_DISPLAY[r.status];
                            return (
                              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 text-xs cursor-pointer hover:bg-gray-100 transition-colors"
                                onClick={() => openRecordModal(s.id, t.id)}>
                                <div>
                                  <div className="font-medium text-gray-800">{t.name}</div>
                                  {r.record && <div className="text-gray-400 mt-0.5">Completed: {r.record.completed} · Expires: {r.record.expiry}{r.record.level ? ` · ${r.record.level}` : ''}</div>}
                                  {r.requiredLevel && r.status === TRAINING_STATUS.WRONG_LEVEL && (
                                    <div className="text-orange-500 mt-0.5">Needs: {r.requiredLevel.name}</div>
                                  )}
                                </div>
                                <span className={BADGE[display.badgeKey]}>{display.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Manage Training Types */}
          <div className="mt-6 print:hidden">
            <button onClick={() => setShowManageTypes(!showManageTypes)} className={BTN.ghost}>
              {showManageTypes ? 'Hide' : 'Manage'} Training Types
            </button>
            {showManageTypes && (
              <div className={`mt-3 ${CARD.flush}`}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th className={TABLE.th}>Name</th>
                      <th className={TABLE.th}>Category</th>
                      <th className={TABLE.th}>Refresher</th>
                      <th className={TABLE.th}>Roles</th>
                      <th className={TABLE.th}>Levels</th>
                      <th className={TABLE.th}>Legislation</th>
                      <th className={`${TABLE.th} text-center`}>Active</th>
                      <th className={TABLE.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {getTrainingTypes(data.config).map(t => (
                      <tr key={t.id} className={`${TABLE.tr} ${!t.active ? 'opacity-50' : ''}`}>
                        <td className={`${TABLE.td} font-medium`}>
                          <input type="text" value={t.name} onChange={e => updateTrainingType(t.id, 'name', e.target.value)}
                            className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-full" />
                        </td>
                        <td className={TABLE.td}>
                          <select value={t.category} onChange={e => updateTrainingType(t.id, 'category', e.target.value)}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs">
                            <option value="statutory">Statutory</option>
                            <option value="mandatory">Mandatory</option>
                          </select>
                        </td>
                        <td className={TABLE.td}>
                          <div className="flex items-center gap-1">
                            <input type="number" min="1" max="60" value={t.refresher_months}
                              onChange={e => updateTrainingType(t.id, 'refresher_months', parseInt(e.target.value) || 12)}
                              className="border border-gray-200 rounded px-1 py-0.5 text-xs w-12" />
                            <span className="text-xs text-gray-400">mo</span>
                          </div>
                        </td>
                        <td className={`${TABLE.td} text-xs text-gray-500`}>{t.roles ? t.roles.join(', ') : 'All'}</td>
                        <td className={`${TABLE.td} text-xs text-gray-400`}>
                          {t.levels ? t.levels.map(l => l.name).join(', ') : '-'}
                        </td>
                        <td className={`${TABLE.td} text-xs text-gray-400`}>{t.legislation || '-'}</td>
                        <td className={`${TABLE.td} text-center`}>
                          <input type="checkbox" checked={t.active} onChange={e => updateTrainingType(t.id, 'active', e.target.checked)} />
                        </td>
                        <td className={TABLE.td}>
                          {t.id.startsWith('custom-') && (
                            <button onClick={() => removeTrainingType(t.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-3">
                  <button onClick={addTrainingType} className={`${BTN.secondary} ${BTN.sm}`}>+ Add Custom Type</button>
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex gap-4 text-[10px] text-gray-500 mt-4 print:hidden flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-200" /> Compliant</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200" /> Expiring 30-60d</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200" /> Urgent &lt;30d</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-300" /> Expired</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-200" /> Wrong Level</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-100 border border-dashed border-gray-300" /> Not Started</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50" /> N/A</span>
          </div>
        </>
      )}

      {/* ══════════════ SUPERVISIONS TAB ══════════════ */}
      {section === 'supervisions' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className={`rounded-xl p-3 ${supStats.completionPct >= 90 ? 'bg-emerald-50 border-emerald-200' : supStats.completionPct >= 70 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border`}>
              <div className="text-xs font-medium text-gray-600">Supervision Rate</div>
              <div className={`text-2xl font-bold mt-0.5 ${supStats.completionPct >= 90 ? 'text-emerald-700' : supStats.completionPct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{supStats.completionPct}%</div>
              <div className="text-[10px] text-gray-400">{supStats.upToDate + supStats.dueSoon}/{supStats.total} staff</div>
            </div>
            <div className="rounded-xl p-3 bg-red-50 border border-red-200">
              <div className="text-xs font-medium text-red-600">Overdue</div>
              <div className="text-2xl font-bold text-red-700 mt-0.5">{supStats.overdue}</div>
              <div className="text-[10px] text-red-400">past due date</div>
            </div>
            <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
              <div className="text-xs font-medium text-amber-600">Due Soon</div>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">{supStats.dueSoon}</div>
              <div className="text-[10px] text-amber-400">within 14 days</div>
            </div>
            <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
              <div className="text-xs font-medium text-gray-500">No Records</div>
              <div className="text-2xl font-bold text-gray-700 mt-0.5">{supStats.notStarted}</div>
              <div className="text-[10px] text-gray-400">never supervised</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap print:hidden">
            <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
            <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="All">All Teams</option>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={supFilter} onChange={e => setSupFilter(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="all">All Status</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due Soon</option>
              <option value="up_to_date">Up to Date</option>
            </select>
            <span className="text-xs text-gray-400 self-center">{filteredStaff.length} staff</span>
          </div>

          {/* Staff List */}
          <div className="space-y-2">
            {filteredStaff.map(s => {
              const result = getSupervisionStatus(s, data.config, supervisionsData, today);
              const sb = SUP_STATUS_BADGE[result.status] || SUP_STATUS_BADGE.not_started;
              const isExpanded = expanded === s.id;
              const staffSups = [...(supervisionsData[s.id] || [])].sort((a, b) => b.date.localeCompare(a.date));
              const probation = isInProbation(s, data.config, today);
              const freq = getSupervisionFrequency(s, data.config, today);
              return (
                <div key={s.id} className={CARD.padded}>
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                    <div>
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                      {probation && <span className={`${BADGE.purple} ml-2`}>Probation</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={sb.badge}>{sb.label}</span>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {result.nextDue ? `Due: ${result.nextDue}` : 'No sessions'} · Every {freq}d
                        </div>
                      </div>
                      <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <div className="flex justify-end mb-2">
                        <button onClick={() => openSupModal(s.id, null)} className={`${BTN.primary} ${BTN.sm}`}>Record Supervision</button>
                      </div>
                      {staffSups.length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-4">No supervision records</div>
                      ) : (
                        <table className={TABLE.table}>
                          <thead className={TABLE.thead}>
                            <tr>
                              <th className={TABLE.th}>Date</th>
                              <th className={TABLE.th}>Supervisor</th>
                              <th className={TABLE.th}>Topics</th>
                              <th className={TABLE.th}>Actions</th>
                              <th className={TABLE.th}>Next Due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staffSups.map(sup => (
                              <tr key={sup.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openSupModal(s.id, sup)}>
                                <td className={TABLE.td}>{sup.date}</td>
                                <td className={TABLE.td}>{sup.supervisor || '-'}</td>
                                <td className={`${TABLE.td} max-w-[200px] truncate`}>{sup.topics || '-'}</td>
                                <td className={`${TABLE.td} max-w-[200px] truncate`}>{sup.actions || '-'}</td>
                                <td className={TABLE.td}>{sup.next_due || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No staff match the current filters</div>}
          </div>
        </>
      )}

      {/* ══════════════ APPRAISALS TAB ══════════════ */}
      {section === 'appraisals' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className={`rounded-xl p-3 ${aprStats.completionPct >= 90 ? 'bg-emerald-50 border-emerald-200' : aprStats.completionPct >= 70 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border`}>
              <div className="text-xs font-medium text-gray-600">Up to Date</div>
              <div className={`text-2xl font-bold mt-0.5 ${aprStats.completionPct >= 90 ? 'text-emerald-700' : aprStats.completionPct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{aprStats.completionPct}%</div>
              <div className="text-[10px] text-gray-400">{aprStats.upToDate + aprStats.dueSoon}/{aprStats.total} staff</div>
            </div>
            <div className="rounded-xl p-3 bg-red-50 border border-red-200">
              <div className="text-xs font-medium text-red-600">Overdue</div>
              <div className="text-2xl font-bold text-red-700 mt-0.5">{aprStats.overdue}</div>
              <div className="text-[10px] text-red-400">past 12 months</div>
            </div>
            <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
              <div className="text-xs font-medium text-amber-600">Due Soon</div>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">{aprStats.dueSoon}</div>
              <div className="text-[10px] text-amber-400">within 30 days</div>
            </div>
            <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
              <div className="text-xs font-medium text-gray-500">No Records</div>
              <div className="text-2xl font-bold text-gray-700 mt-0.5">{aprStats.notStarted}</div>
              <div className="text-[10px] text-gray-400">never appraised</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap print:hidden">
            <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
            <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="All">All Teams</option>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={supFilter} onChange={e => setSupFilter(e.target.value)} className={`${INPUT.select} w-auto`}>
              <option value="all">All Status</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due Soon</option>
              <option value="up_to_date">Up to Date</option>
            </select>
            <span className="text-xs text-gray-400 self-center">{filteredStaff.length} staff</span>
          </div>

          {/* Staff List */}
          <div className="space-y-2">
            {filteredStaff.map(s => {
              const result = getAppraisalStatus(s, appraisalsData, today);
              const sb = SUP_STATUS_BADGE[result.status] || SUP_STATUS_BADGE.not_started;
              const isExpanded = expanded === s.id;
              const staffAprs = [...(appraisalsData[s.id] || [])].sort((a, b) => b.date.localeCompare(a.date));
              return (
                <div key={s.id} className={CARD.padded}>
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                    <div>
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={sb.badge}>{sb.label}</span>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {result.nextDue ? `Due: ${result.nextDue}` : 'No appraisals'} · Annual
                        </div>
                      </div>
                      <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <div className="flex justify-end mb-2">
                        <button onClick={() => openAprModal(s.id, null)} className={`${BTN.primary} ${BTN.sm}`}>Record Appraisal</button>
                      </div>
                      {staffAprs.length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-4">No appraisal records</div>
                      ) : (
                        <table className={TABLE.table}>
                          <thead className={TABLE.thead}>
                            <tr>
                              <th className={TABLE.th}>Date</th>
                              <th className={TABLE.th}>Appraiser</th>
                              <th className={TABLE.th}>Objectives</th>
                              <th className={TABLE.th}>Training Needs</th>
                              <th className={TABLE.th}>Next Due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staffAprs.map(apr => (
                              <tr key={apr.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openAprModal(s.id, apr)}>
                                <td className={TABLE.td}>{apr.date}</td>
                                <td className={TABLE.td}>{apr.appraiser || '-'}</td>
                                <td className={`${TABLE.td} max-w-[200px] truncate`}>{apr.objectives || '-'}</td>
                                <td className={`${TABLE.td} max-w-[200px] truncate`}>{apr.training_needs || '-'}</td>
                                <td className={TABLE.td}>{apr.next_due || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No staff match the current filters</div>}
          </div>
        </>
      )}

      {/* ══════════════ FIRE DRILLS TAB ══════════════ */}
      {section === 'fire_drills' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className={`rounded-xl p-3 border ${drillStatus.drillsThisYear >= 4 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="text-xs font-medium text-gray-600">Drills This Year</div>
              <div className={`text-2xl font-bold mt-0.5 ${drillStatus.drillsThisYear >= 4 ? 'text-emerald-700' : 'text-red-700'}`}>{drillStatus.drillsThisYear}/4</div>
              <div className="text-[10px] text-gray-400">minimum 4 per year</div>
            </div>
            <div className="rounded-xl p-3 bg-blue-50 border border-blue-200">
              <div className="text-xs font-medium text-blue-600">Last Drill</div>
              <div className="text-lg font-bold text-blue-700 mt-0.5">{drillStatus.lastDrill?.date || 'Never'}</div>
              <div className="text-[10px] text-blue-400">{drillStatus.lastDrill?.scenario ? drillStatus.lastDrill.scenario.substring(0, 30) : '-'}</div>
            </div>
            <div className={`rounded-xl p-3 border ${drillStatus.status === 'overdue' ? 'bg-red-50 border-red-200' : drillStatus.status === 'due_soon' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="text-xs font-medium text-gray-600">Next Due</div>
              <div className={`text-lg font-bold mt-0.5 ${drillStatus.status === 'overdue' ? 'text-red-700' : drillStatus.status === 'due_soon' ? 'text-amber-700' : 'text-emerald-700'}`}>
                {drillStatus.nextDue || 'N/A'}
              </div>
              <div className="text-[10px] text-gray-400">
                {drillStatus.status === 'overdue' ? 'OVERDUE' : drillStatus.status === 'due_soon' ? `${drillStatus.daysUntilDue}d remaining` : drillStatus.daysUntilDue != null ? `${drillStatus.daysUntilDue}d remaining` : '-'}
              </div>
            </div>
            <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
              <div className="text-xs font-medium text-gray-500">Avg Evacuation</div>
              <div className="text-2xl font-bold text-gray-700 mt-0.5">{drillStatus.avgEvacTime != null ? `${Math.floor(drillStatus.avgEvacTime / 60)}m ${drillStatus.avgEvacTime % 60}s` : '-'}</div>
              <div className="text-[10px] text-gray-400">last 12 months</div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex justify-between items-center mb-4 print:hidden">
            <span className="text-xs text-gray-400">{fireDrills.length} drill{fireDrills.length !== 1 ? 's' : ''} recorded</span>
            <button onClick={() => openDrillModal(null)} className={BTN.primary}>Record Fire Drill</button>
          </div>

          {/* Drills Table */}
          {fireDrills.length === 0 ? (
            <div className={`${CARD.padded} text-center text-sm text-gray-400 py-8`}>
              No fire drills recorded. Click "Record Fire Drill" to add the first one.
            </div>
          ) : (
            <div className={CARD.flush}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Date</th>
                    <th className={TABLE.th}>Time</th>
                    <th className={TABLE.th}>Scenario</th>
                    <th className={TABLE.th}>Evacuation Time</th>
                    <th className={TABLE.th}>Staff</th>
                    <th className={TABLE.th}>Issues</th>
                    <th className={TABLE.th}>Conducted By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...fireDrills].sort((a, b) => b.date.localeCompare(a.date)).map(drill => (
                    <tr key={drill.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openDrillModal(drill)}>
                      <td className={TABLE.td}>{drill.date}</td>
                      <td className={TABLE.td}>{drill.time || '-'}</td>
                      <td className={`${TABLE.td} max-w-[250px] truncate`}>{drill.scenario || '-'}</td>
                      <td className={TABLE.tdMono}>
                        {drill.evacuation_time_seconds > 0
                          ? `${Math.floor(drill.evacuation_time_seconds / 60)}m ${drill.evacuation_time_seconds % 60}s`
                          : '-'}
                      </td>
                      <td className={TABLE.td}>{drill.staff_present?.length || 0}</td>
                      <td className={`${TABLE.td} max-w-[200px] truncate`}>
                        {drill.issues ? <span className="text-amber-600">{drill.issues}</span> : <span className="text-gray-400">None</span>}
                      </td>
                      <td className={TABLE.td}>{drill.conducted_by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ══════════════ MODALS ══════════════ */}

      {/* Record Training Modal */}
      {showRecordModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowRecordModal(false); }}>
          <div className={MODAL.panelLg}>
            <h2 className={MODAL.title}>{modalData.existing ? 'Edit' : 'Record'} Training</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Staff Member</label>
                  <select value={modalData.staffId} onChange={e => setModalData({ ...modalData, staffId: e.target.value })} className={INPUT.select}>
                    {activeStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Training Type</label>
                  <select value={modalData.typeId} onChange={e => setModalData({ ...modalData, typeId: e.target.value, level: '' })} className={INPUT.select}>
                    {trainingTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Completion Date</label>
                  <input type="date" value={modalData.completed} onChange={e => setModalData({ ...modalData, completed: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Expiry Date (auto)</label>
                  <input type="date" value={modalExpiry} disabled className={`${INPUT.base} bg-gray-50 text-gray-500`} />
                  {modalData.typeId && (() => {
                    const t = trainingTypes.find(x => x.id === modalData.typeId);
                    return t ? <p className="text-[10px] text-gray-400 mt-0.5">{t.refresher_months} months from completion</p> : null;
                  })()}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Trainer / Provider</label>
                  <input type="text" value={modalData.trainer} onChange={e => setModalData({ ...modalData, trainer: e.target.value })}
                    className={INPUT.base} placeholder="Name or organisation" />
                </div>
                <div>
                  <label className={INPUT.label}>Method</label>
                  <select value={modalData.method} onChange={e => setModalData({ ...modalData, method: e.target.value })} className={INPUT.select}>
                    {TRAINING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {/* Level dropdown — only shown for types with levels */}
              {modalTypeLevels && (
                <div>
                  <label className={INPUT.label}>Level Achieved</label>
                  <select value={modalData.level} onChange={e => setModalData({ ...modalData, level: e.target.value })} className={INPUT.select}>
                    <option value="">Select level...</option>
                    {modalTypeLevels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  {modalData.staffId && (() => {
                    const staff = activeStaff.find(s => s.id === modalData.staffId);
                    const type = trainingTypes.find(t => t.id === modalData.typeId);
                    if (!staff || !type) return null;
                    const required = getRequiredLevel(type, staff.role);
                    return required ? <p className="text-[10px] text-gray-400 mt-0.5">Required for {staff.role}: {required.name}</p> : null;
                  })()}
                </div>
              )}
              <div>
                <label className={INPUT.label}>Certificate Reference</label>
                <input type="text" value={modalData.certificate_ref} onChange={e => setModalData({ ...modalData, certificate_ref: e.target.value })}
                  className={INPUT.base} placeholder="e.g. FS-2025-042" />
              </div>
              <div>
                <label className={INPUT.label}>Evidence File Reference</label>
                <input type="text" value={modalData.evidence_ref} onChange={e => setModalData({ ...modalData, evidence_ref: e.target.value })}
                  className={INPUT.base} placeholder="e.g. /training/fire-safety/JS-2025.pdf" />
                <p className="text-[10px] text-gray-400 mt-0.5">File path or reference for offline evidence management</p>
              </div>
              <div>
                <label className={INPUT.label}>Notes</label>
                <input type="text" value={modalData.notes} onChange={e => setModalData({ ...modalData, notes: e.target.value })}
                  className={INPUT.base} placeholder="Optional notes" />
              </div>
            </div>
            <div className={MODAL.footer}>
              {modalData.existing && (
                <button onClick={handleDeleteRecord} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Remove</button>
              )}
              <button onClick={() => setShowRecordModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSaveRecord} disabled={!modalData.staffId || !modalData.typeId || !modalData.completed}
                className={`${BTN.primary} disabled:opacity-50`}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Supervision Modal */}
      {showSupModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowSupModal(false); }}>
          <div className={MODAL.panelLg}>
            <h2 className={MODAL.title}>{supModalData.existing ? 'Edit' : 'Record'} Supervision</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Date</label>
                  <input type="date" value={supModalData.date} onChange={e => setSupModalData({ ...supModalData, date: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Supervisor</label>
                  <input type="text" value={supModalData.supervisor} onChange={e => setSupModalData({ ...supModalData, supervisor: e.target.value })}
                    className={INPUT.base} placeholder="Supervisor name" />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Topics Discussed</label>
                <textarea value={supModalData.topics} onChange={e => setSupModalData({ ...supModalData, topics: e.target.value })}
                  className={`${INPUT.base} h-20 resize-none`} placeholder="Key topics covered in the session..." />
              </div>
              <div>
                <label className={INPUT.label}>Actions Agreed</label>
                <textarea value={supModalData.actions} onChange={e => setSupModalData({ ...supModalData, actions: e.target.value })}
                  className={`${INPUT.base} h-20 resize-none`} placeholder="Action items agreed upon..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Next Due (auto)</label>
                  <input type="date" value={supModalData.existing ? supModalData.next_due : supNextDue}
                    onChange={e => setSupModalData({ ...supModalData, next_due: e.target.value })} className={INPUT.base} />
                  {!supModalData.existing && supModalData.staffId && (() => {
                    const staff = activeStaff.find(s => s.id === supModalData.staffId);
                    if (!staff) return null;
                    const freq = getSupervisionFrequency(staff, data.config, today);
                    const probation = isInProbation(staff, data.config, today);
                    return <p className="text-[10px] text-gray-400 mt-0.5">{probation ? 'Probation' : 'Standard'}: every {freq} days</p>;
                  })()}
                </div>
                <div>
                  <label className={INPUT.label}>Notes</label>
                  <input type="text" value={supModalData.notes} onChange={e => setSupModalData({ ...supModalData, notes: e.target.value })}
                    className={INPUT.base} placeholder="Optional notes" />
                </div>
              </div>
            </div>
            <div className={MODAL.footer}>
              {supModalData.existing && (
                <button onClick={handleDeleteSup} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowSupModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSaveSup}
                disabled={!supModalData.staffId || !supModalData.date}
                className={`${BTN.primary} disabled:opacity-50`}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Appraisal Modal */}
      {showAprModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowAprModal(false); }}>
          <div className={MODAL.panelLg}>
            <h2 className={MODAL.title}>{aprModalData.existing ? 'Edit' : 'Record'} Appraisal</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Date</label>
                  <input type="date" value={aprModalData.date} onChange={e => setAprModalData({ ...aprModalData, date: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Appraiser</label>
                  <input type="text" value={aprModalData.appraiser} onChange={e => setAprModalData({ ...aprModalData, appraiser: e.target.value })}
                    className={INPUT.base} placeholder="Appraiser name" />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Objectives</label>
                <textarea value={aprModalData.objectives} onChange={e => setAprModalData({ ...aprModalData, objectives: e.target.value })}
                  className={`${INPUT.base} h-20 resize-none`} placeholder="Performance objectives set..." />
              </div>
              <div>
                <label className={INPUT.label}>Training Needs Identified</label>
                <textarea value={aprModalData.training_needs} onChange={e => setAprModalData({ ...aprModalData, training_needs: e.target.value })}
                  className={`${INPUT.base} h-16 resize-none`} placeholder="Training and development needs..." />
              </div>
              <div>
                <label className={INPUT.label}>Development Plan</label>
                <textarea value={aprModalData.development_plan} onChange={e => setAprModalData({ ...aprModalData, development_plan: e.target.value })}
                  className={`${INPUT.base} h-16 resize-none`} placeholder="Personal development plan..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Next Due (auto +12 months)</label>
                  <input type="date" value={aprModalData.existing ? aprModalData.next_due : aprNextDue}
                    onChange={e => setAprModalData({ ...aprModalData, next_due: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Notes</label>
                  <input type="text" value={aprModalData.notes} onChange={e => setAprModalData({ ...aprModalData, notes: e.target.value })}
                    className={INPUT.base} placeholder="Optional notes" />
                </div>
              </div>
            </div>
            <div className={MODAL.footer}>
              {aprModalData.existing && (
                <button onClick={handleDeleteApr} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowAprModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSaveApr}
                disabled={!aprModalData.staffId || !aprModalData.date}
                className={`${BTN.primary} disabled:opacity-50`}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Fire Drill Modal */}
      {showDrillModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowDrillModal(false); }}>
          <div className={MODAL.panelXl}>
            <h2 className={MODAL.title}>{drillModalData.existing ? 'Edit' : 'Record'} Fire Drill</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={INPUT.label}>Date</label>
                  <input type="date" value={drillModalData.date} onChange={e => setDrillModalData({ ...drillModalData, date: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Time</label>
                  <input type="time" value={drillModalData.time} onChange={e => setDrillModalData({ ...drillModalData, time: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Evacuation Time (seconds)</label>
                  <input type="number" min="0" value={drillModalData.evacuation_time_seconds}
                    onChange={e => setDrillModalData({ ...drillModalData, evacuation_time_seconds: e.target.value })}
                    className={INPUT.base} placeholder="e.g. 240" />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Scenario</label>
                <textarea value={drillModalData.scenario} onChange={e => setDrillModalData({ ...drillModalData, scenario: e.target.value })}
                  className={`${INPUT.base} h-16 resize-none`} placeholder="e.g. Kitchen fire — full evacuation" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Residents Evacuated</label>
                  <input type="number" min="0" value={drillModalData.residents_evacuated}
                    onChange={e => setDrillModalData({ ...drillModalData, residents_evacuated: e.target.value })}
                    className={INPUT.base} placeholder="Number" />
                </div>
                <div>
                  <label className={INPUT.label}>Conducted By</label>
                  <input type="text" value={drillModalData.conducted_by} onChange={e => setDrillModalData({ ...drillModalData, conducted_by: e.target.value })}
                    className={INPUT.base} placeholder="Fire Marshal name" />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Staff Present ({drillModalData.staff_present.length} selected)</label>
                <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {activeStaff.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1.5 py-0.5 rounded">
                      <input type="checkbox" checked={drillModalData.staff_present.includes(s.id)} onChange={() => toggleDrillStaff(s.id)} />
                      <span>{s.name}</span>
                      <span className="text-gray-400">({s.team})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Issues Identified</label>
                <textarea value={drillModalData.issues} onChange={e => setDrillModalData({ ...drillModalData, issues: e.target.value })}
                  className={`${INPUT.base} h-16 resize-none`} placeholder="Any issues observed during the drill..." />
              </div>
              <div>
                <label className={INPUT.label}>Corrective Actions</label>
                <textarea value={drillModalData.corrective_actions} onChange={e => setDrillModalData({ ...drillModalData, corrective_actions: e.target.value })}
                  className={`${INPUT.base} h-16 resize-none`} placeholder="Actions taken to address issues..." />
              </div>
              <div>
                <label className={INPUT.label}>Notes</label>
                <input type="text" value={drillModalData.notes} onChange={e => setDrillModalData({ ...drillModalData, notes: e.target.value })}
                  className={INPUT.base} placeholder="Optional notes" />
              </div>
            </div>
            <div className={MODAL.footer}>
              {drillModalData.existing && (
                <button onClick={handleDeleteDrill} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowDrillModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSaveDrill} disabled={!drillModalData.date}
                className={`${BTN.primary} disabled:opacity-50`}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) { setShowImportModal(false); setCsvRows([]); setCsvErrors([]); } }}>
          <div className={`${MODAL.panelLg} max-h-[85vh] overflow-y-auto`}>
            <h2 className={MODAL.title}>Import Training Records from CSV</h2>

            {csvRows.length === 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Upload a CSV file with training completion records. Expected columns:
                </p>
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 font-mono">
                  staff_name, training_type, completed_date, trainer, method, certificate_ref
                </div>
                <p className="text-xs text-gray-400">
                  Dates can be DD/MM/YYYY or YYYY-MM-DD. Staff and training types are matched by name (case-insensitive).
                </p>
                <div>
                  <label className={INPUT.label}>Select CSV File</label>
                  <input type="file" accept=".csv,.txt" onChange={handleCSVFile}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary */}
                <div className="flex gap-3">
                  <span className={BADGE.blue}>{csvRows.length} rows parsed</span>
                  <span className={BADGE.green}>{csvRows.filter(r => r.valid).length} valid</span>
                  {csvRows.filter(r => !r.valid).length > 0 && (
                    <span className={BADGE.red}>{csvRows.filter(r => !r.valid).length} unmatched</span>
                  )}
                </div>

                {/* Errors */}
                {csvErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-32 overflow-y-auto">
                    <div className="text-xs font-semibold text-red-700 mb-1">Matching Issues:</div>
                    {csvErrors.map((err, i) => (
                      <div key={i} className="text-xs text-red-600">{err}</div>
                    ))}
                  </div>
                )}

                {/* Preview table */}
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className={TABLE.table}>
                    <thead className={TABLE.thead}>
                      <tr>
                        <th className={TABLE.th}>Row</th>
                        <th className={TABLE.th}>Staff</th>
                        <th className={TABLE.th}>Training</th>
                        <th className={TABLE.th}>Date</th>
                        <th className={TABLE.th}>Trainer</th>
                        <th className={TABLE.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((row, i) => (
                        <tr key={i} className={row.valid ? '' : 'bg-red-50'}>
                          <td className={TABLE.tdMono}>{row.line}</td>
                          <td className={TABLE.td}>
                            {row.matchedStaff ? (
                              <span className="text-gray-900">{row.matchedStaff.name}</span>
                            ) : (
                              <span className="text-red-600">{row.rawName || '?'}</span>
                            )}
                          </td>
                          <td className={TABLE.td}>
                            {row.matchedType ? (
                              <span className="text-gray-900">{row.matchedType.name}</span>
                            ) : (
                              <span className="text-red-600">{row.rawType || '?'}</span>
                            )}
                          </td>
                          <td className={TABLE.tdMono}>{row.rawDate || '-'}</td>
                          <td className={TABLE.td}>{row.trainer || '-'}</td>
                          <td className={TABLE.td}>
                            <span className={row.valid ? BADGE.green : BADGE.red}>
                              {row.valid ? 'Ready' : 'Error'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Re-upload */}
                <div>
                  <label className="text-xs text-gray-500 cursor-pointer hover:text-blue-600">
                    Choose a different file
                    <input type="file" accept=".csv,.txt" onChange={handleCSVFile} className="hidden" />
                  </label>
                </div>
              </div>
            )}

            <div className={MODAL.footer}>
              <button onClick={() => { setShowImportModal(false); setCsvRows([]); setCsvErrors([]); }} className={BTN.ghost}>Cancel</button>
              {csvRows.filter(r => r.valid).length > 0 && (
                <button onClick={handleImportCSV} className={BTN.primary}>
                  Import {csvRows.filter(r => r.valid).length} Records
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
