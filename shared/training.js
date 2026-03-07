// Shared training defaults — used by both server routes and frontend
import { CARE_ROLES } from './rotation.js';

// ── Default Training Types ─────────────────────────────────────────────────

export const DEFAULT_TRAINING_TYPES = [
  // ── Statutory (explicit legislative duty) ────────────────────────────────
  { id: 'fire-safety',         name: 'Fire Safety',                                  category: 'statutory', refresher_months: 12, roles: null,            legislation: 'Regulatory Reform (Fire Safety) Order 2005, Art 21',                    active: true  },
  { id: 'moving-handling',     name: 'Moving & Handling',                            category: 'statutory', refresher_months: 12, roles: null,            legislation: 'Manual Handling Operations Regs 1992 / HSWA 1974 s.2(2)(c)',            active: true  },
  { id: 'health-safety',       name: 'Health & Safety Awareness',                    category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Health & Safety at Work Act 1974 s.2 / MHSWR 1999 Reg 13',            active: true  },
  { id: 'coshh',               name: 'COSHH',                                        category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Control of Substances Hazardous to Health Regs 2002, Reg 12',         active: true  },
  { id: 'food-hygiene',        name: 'Food Hygiene',                                 category: 'statutory', refresher_months: 36, roles: null,            legislation: 'EU Reg 852/2004 Annex II / Food Safety & Hygiene (England) Regs 2013', active: true  },
  { id: 'basic-life-support',  name: 'Basic Life Support',                           category: 'statutory', refresher_months: 12, roles: null,            legislation: 'Health & Safety (First-Aid) Regs 1981',                               active: true  },
  { id: 'first-aid-work',      name: 'First Aid at Work',                            category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Health & Safety (First-Aid) Regs 1981, Reg 3',                        active: true  },
  { id: 'ppe-awareness',       name: 'PPE Awareness',                                category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Personal Protective Equipment at Work Regs 1992, Reg 9',              active: false },
  // ── Mandatory (CQC Fundamental Standards / Skills for Care Part 1 & 2) ──
  { id: 'safeguarding-adults', name: 'Safeguarding Adults',                          category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'Care Act 2014 ss.42-46 / CQC Regulation 13',                          active: true  },
  { id: 'safeguarding-children', name: 'Safeguarding Children',                      category: 'mandatory', refresher_months: 36, roles: null,            legislation: 'Working Together to Safeguard Children 2023 / CQC Regulation 13',    active: true  },
  { id: 'infection-control',   name: 'Infection Prevention & Control',               category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'CQC Regulation 12 / Code of Practice on IPC 2022',                    active: true  },
  { id: 'oliver-mcgowan',      name: 'Learning Disability & Autism (Oliver McGowan)', category: 'mandatory', refresher_months: 36, roles: null,           legislation: 'Health and Care Act 2022 s.181 / Oliver McGowan Code of Practice 2025', active: true },
  { id: 'mca-dols',            name: 'Mental Capacity Act & DoLS',                   category: 'mandatory', refresher_months: 24, roles: null,            legislation: 'Mental Capacity Act 2005 / Mental Capacity (Amendment) Act 2019',    active: true  },
  { id: 'equality-diversity',  name: 'Equality, Diversity & Human Rights',           category: 'mandatory', refresher_months: 36, roles: null,            legislation: 'Equality Act 2010 / CQC Regulations 10 & 13',                         active: true  },
  { id: 'data-protection',     name: 'Data Protection / GDPR',                       category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'UK GDPR / Data Protection Act 2018',                                  active: true  },
  { id: 'duty-of-candour',     name: 'Duty of Candour',                              category: 'mandatory', refresher_months: 24, roles: null,            legislation: 'CQC Regulation 20 / Health & Social Care Act 2008',                   active: true  },
  { id: 'medication-awareness', name: 'Medication Awareness',                        category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES].filter(r => r !== 'Team Lead'), legislation: 'CQC Regulation 12 / NICE SC1 (Managing Medicines in Care Homes)', active: true },
  { id: 'positive-behaviour',  name: 'Positive Behaviour Support',                   category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'CQC Regulation 13(4) / Restraint Reduction Network Standards 2021',  active: true  },
  // ── High-priority mandatory (CQC inspection priorities 2025) ────────────
  { id: 'dementia-awareness',  name: 'Dementia Awareness',                           category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'CQC Regulation 18 / Dementia Training Standards Framework 2018',    active: true  },
  { id: 'dysphagia-iddsi',     name: 'Dysphagia & IDDSI',                            category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES], legislation: 'CQC Regulation 12 / IDDSI Framework 2018',                            active: true  },
  { id: 'end-of-life-care',    name: 'End of Life Care',                             category: 'mandatory', refresher_months: 24, roles: [...CARE_ROLES], legislation: 'CQC Regulation 18 / Ambitions for Palliative and End of Life Care 2021', active: true },
  { id: 'falls-prevention',    name: 'Falls Prevention',                             category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES], legislation: 'CQC Regulation 12 / NICE NG249 (2025)',                                active: true  },
  { id: 'nutrition-hydration', name: 'Nutrition & Hydration',                        category: 'mandatory', refresher_months: 36, roles: [...CARE_ROLES], legislation: 'CQC Regulation 14',                                                   active: true  },
  { id: 'pressure-ulcer',      name: 'Pressure Ulcer Prevention',                   category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES], legislation: 'CQC Regulation 12 / NICE NG7',                                         active: true  },
  { id: 'oral-health',         name: 'Oral Health Care',                             category: 'mandatory', refresher_months: 36, roles: [...CARE_ROLES], legislation: 'CQC Regulation 14 / NICE NG48',                                        active: true  },
];

// ── Training Levels ──────────────────────────────────────────────────────

export const DEFAULT_TRAINING_LEVELS = {
  'safeguarding-adults': [
    { id: 'L1', name: 'Level 1 — Awareness', roles: ['Carer', 'Night Carer', 'Float Carer'] },
    { id: 'L2', name: 'Level 2 — Response', roles: ['Senior Carer', 'Night Senior', 'Float Senior'] },
    { id: 'L3', name: 'Level 3 — Lead', roles: ['Team Lead'] },
  ],
  'mca-dols': [
    { id: 'basic', name: 'Basic Awareness', roles: ['Carer', 'Night Carer', 'Float Carer'] },
    { id: 'advanced', name: 'Advanced (Assessments)', roles: ['Senior Carer', 'Night Senior', 'Float Senior', 'Team Lead'] },
  ],
  'oliver-mcgowan': [
    { id: 'tier1', name: 'Tier 1 — Awareness (e-learning + 1hr live)', roles: [] },
    { id: 'tier2', name: 'Tier 2 — Direct Care (full day, co-delivered)', roles: [...CARE_ROLES] },
  ],
  'dementia-awareness': [
    { id: 'tier1', name: 'Tier 1 — Awareness', roles: ['Carer', 'Night Carer', 'Float Carer'] },
    { id: 'tier2', name: 'Tier 2 — Core Skills (direct care)', roles: ['Senior Carer', 'Night Senior', 'Float Senior'] },
    { id: 'tier3', name: 'Tier 3 — Enhanced (leadership/specialist)', roles: ['Team Lead'] },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function getTrainingTypes(config) {
  return (config?.training_types && config.training_types.length > 0)
    ? config.training_types
    : DEFAULT_TRAINING_TYPES;
}
