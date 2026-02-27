import { useState, useEffect } from 'react';
import { INPUT } from '../lib/design.js';
import { getCurrentHome, getHrStaffList } from '../lib/api.js';

const staffCache = new Map();

async function loadStaff(home) {
  if (staffCache.has(home)) return staffCache.get(home);
  const list = await getHrStaffList(home);
  staffCache.set(home, list);
  return list;
}

export function clearStaffCache() { staffCache.clear(); }

export default function StaffPicker({ value, onChange, disabled, showAll, showInactive, label, small, required }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const home = getCurrentHome();
    if (!home) return;
    let cancelled = false;
    setLoading(true);
    loadStaff(home).then(list => {
      if (!cancelled) { setStaff(list); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const active = staff.filter(s => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const inactive = staff.filter(s => !s.active).sort((a, b) => a.name.localeCompare(b.name));
  const displayList = showInactive ? [...active, ...inactive] : active;

  return (
    <div>
      {label && <label className={INPUT.label}>{label}{required && ' *'}</label>}
      <select
        className={small ? INPUT.sm : INPUT.select}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || loading}
      >
        {showAll ? (
          <option value="">All Staff</option>
        ) : (
          <option value="">-- Select staff --</option>
        )}
        {displayList.map(s => (
          <option key={s.id} value={s.id} className={s.active ? '' : 'text-gray-400'}>
            {s.id} — {s.name}{s.active ? ` (${s.role})` : ' (Inactive)'}
          </option>
        ))}
      </select>
    </div>
  );
}
