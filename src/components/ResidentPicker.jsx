import { useState, useEffect } from 'react';
import { INPUT } from '../lib/design.js';
import { getCurrentHome, getFinanceResidents } from '../lib/api.js';

/**
 * Resident dropdown picker — mirrors StaffPicker pattern.
 * Loads active residents from finance_residents, selects by PK (integer id).
 * Displays: "resident_name (Room 12)" or "resident_name" if no room.
 *
 * Props:
 *   value      - selected resident id (integer or string)
 *   onChange   - (id, resident) => void — called with id + full resident object
 *   disabled   - disable the select
 *   label      - label text (default: 'Resident')
 *   small      - use INPUT.sm instead of INPUT.select
 *   required   - show asterisk
 *   showAll    - show "All Residents" as first option (for filters)
 *   placeholder - custom placeholder text
 */
export default function ResidentPicker({ value, onChange, disabled, label, small, required, showAll, placeholder }) {
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const home = getCurrentHome();

  useEffect(() => {
    if (!home) return;
    let cancelled = false;
    setLoading(true);
    getFinanceResidents(home, { status: 'active', limit: 500 })
      .then(result => {
        if (!cancelled) {
          const list = result?.rows || result || [];
          setResidents(list.sort((a, b) => (a.resident_name || '').localeCompare(b.resident_name || '')));
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) { setResidents([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [home]);

  function handleChange(e) {
    const id = e.target.value;
    const resident = residents.find(r => String(r.id) === id) || null;
    onChange(id ? Number(id) : null, resident);
  }

  // Fall back to text input if resident list couldn't be loaded (e.g. no finance:read access)
  if (!loading && residents.length === 0) {
    return (
      <div>
        {label && <label className={INPUT.label}>{label}{required && ' *'}</label>}
        <input className={small ? INPUT.sm : INPUT.base} value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(null, { resident_name: e.target.value })}
          disabled={disabled} placeholder={placeholder || 'Type resident name'} />
      </div>
    );
  }

  return (
    <div>
      {label && <label className={INPUT.label}>{label}{required && ' *'}</label>}
      <select className={small ? INPUT.sm : INPUT.select} value={value || ''} onChange={handleChange} disabled={disabled || loading}>
        {showAll
          ? <option value="">All Residents</option>
          : <option value="">{placeholder || '-- Select resident --'}</option>
        }
        {residents.map(r => (
          <option key={r.id} value={r.id}>
            {r.resident_name}{r.room_number ? ` (Room ${r.room_number})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
