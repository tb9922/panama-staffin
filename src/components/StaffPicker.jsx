import { useState, useEffect, useId } from 'react';
import { INPUT } from '../lib/design.js';
import { getCurrentHome, getHrStaffList, isAbortLikeError } from '../lib/api.js';

export default function StaffPicker({ value, onChange, disabled, showAll, showInactive, label, small, required }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const home = getCurrentHome();
  const selectId = useId();

  useEffect(() => {
    if (!home) {
      setStaff([]);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    getHrStaffList(home, { signal: controller.signal }).then(list => {
      if (!cancelled) { setStaff(list); setLoading(false); }
    }).catch((err) => {
      if (cancelled || isAbortLikeError(err, controller.signal)) return;
      setLoading(false);
      console.error('Failed to load staff list', err);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [home]);

  const active = staff.filter(s => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const inactive = staff.filter(s => !s.active).sort((a, b) => a.name.localeCompare(b.name));
  const displayList = showInactive ? [...active, ...inactive] : active;

  return (
    <div>
      {label && <label htmlFor={selectId} className={INPUT.label}>{label}{required && ' *'}</label>}
      <select
        id={selectId}
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
