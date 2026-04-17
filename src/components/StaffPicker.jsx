import { useState, useEffect, useId } from 'react';
import { INPUT } from '../lib/design.js';
import { getCurrentHome, getHrStaffList, isAbortLikeError } from '../lib/api.js';

export default function StaffPicker({ value, onChange, disabled, showAll, showInactive, label, small, required, id }) {
  const [staff, setStaff] = useState([]);
  const [loadedHome, setLoadedHome] = useState(null);
  const home = getCurrentHome();
  const generatedId = useId();
  const selectId = id || generatedId;

  useEffect(() => {
    if (!home) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    getHrStaffList(home, { signal: controller.signal }).then(list => {
      if (!cancelled) {
        setStaff(list);
        setLoadedHome(home);
      }
    }).catch((err) => {
      if (cancelled || isAbortLikeError(err, controller.signal)) return;
      setStaff([]);
      setLoadedHome(home);
      console.error('Failed to load staff list', err);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [home]);

  const visibleStaff = loadedHome === home ? staff : [];
  const loading = Boolean(home && loadedHome !== home);
  const active = visibleStaff.filter(s => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const inactive = visibleStaff.filter(s => !s.active).sort((a, b) => a.name.localeCompare(b.name));
  const displayList = showInactive ? [...active, ...inactive] : active;

  return (
    <div>
      {label && <label htmlFor={selectId} className={INPUT.label}>{label}{required && ' *'}</label>}
      <select
        id={selectId}
        className={small ? INPUT.sm : INPUT.select}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || (!home ? false : loading)}
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
