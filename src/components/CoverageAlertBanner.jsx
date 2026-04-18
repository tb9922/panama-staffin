import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStaffForDay, parseDate } from '../lib/rotation.js';
import { getDayCoverageStatus } from '../lib/escalation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { getCurrentHome, getSchedulingData, isAbortLikeError } from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';

export default function CoverageAlertBanner() {
  const navigate = useNavigate();
  const { activeHome } = useData();
  const today = useLiveDate();
  const homeSlug = activeHome || getCurrentHome();
  const [dataState, setDataState] = useState({ homeSlug: null, value: null });
  const data = dataState.homeSlug === homeSlug ? dataState.value : null;

  useEffect(() => {
    if (!homeSlug) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    getSchedulingData(homeSlug, { signal: controller.signal })
      .then(result => {
        if (!cancelled) setDataState({ homeSlug, value: result });
      })
      .catch((e) => {
        if (cancelled || isAbortLikeError(e, controller.signal)) return;
        setDataState({ homeSlug, value: null });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [today, homeSlug]);

  const todayCoverage = useMemo(() => {
    if (!data) return null;
    const staffForDay = getStaffForDay(data.staff, parseDate(today), data.overrides, data.config);
    return getDayCoverageStatus(staffForDay, data.config);
  }, [data, today]);

  if (!todayCoverage || todayCoverage.overallLevel < 3) return null;

  const isCritical = todayCoverage.overallLevel >= 4;
  return (
    <div className={`px-4 py-2.5 text-sm flex items-center justify-between print:hidden ${
      isCritical ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
    }`}>
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isCritical
            ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z'
            : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
          } />
        </svg>
        <span className="font-semibold">
          {isCritical ? 'CRITICAL' : 'ALERT'}:
        </span>
        <span>Today's coverage is at {
          todayCoverage.overallLevel >= 5 ? 'UNSAFE' :
          todayCoverage.overallLevel >= 4 ? 'SHORT-STAFFED' : 'Agency Required'
        } level</span>
        {['early', 'late', 'night'].map(p => {
          const esc = todayCoverage[p]?.escalation;
          if (!esc || esc.level < 3) return null;
          return (
            <span
              key={p}
              className={`rounded-full px-1.5 py-0.5 text-xs font-medium capitalize ${
                isCritical ? 'bg-white text-red-700' : 'bg-white text-amber-900'
              }`}
            >
              {p}: {esc.label}
            </span>
          );
        })}
      </div>
      <button
        onClick={() => navigate(`/day/${today}`)}
        className="rounded-md px-2 py-1 text-xs font-medium underline hover:bg-white/10 hover:no-underline"
        aria-label="View today's coverage details"
      >
        View Details
      </button>
    </div>
  );
}
