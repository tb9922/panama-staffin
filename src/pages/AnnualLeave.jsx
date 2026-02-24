import { useState, useMemo } from 'react';
import { formatDate, addDays, isCareRole, getCycleDates, getScheduledShift, getCycleDay, parseDate, countALOnDate } from '../lib/rotation.js';

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export default function AnnualLeave({ data, updateData }) {
  const [filterTeam, setFilterTeam] = useState('All');
  const [bookingStaff, setBookingStaff] = useState('');
  const [bookingStart, setBookingStart] = useState('');
  const [bookingEnd, setBookingEnd] = useState('');

  const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];
  const activeStaff = data.staff.filter(s => s.active !== false && isCareRole(s.role));
  const filtered = filterTeam === 'All' ? activeStaff : activeStaff.filter(s => s.team === filterTeam);

  // Calculate AL used per staff (count AL shifts in overrides)
  const alUsed = useMemo(() => {
    const counts = {};
    activeStaff.forEach(s => { counts[s.id] = 0; });
    Object.entries(data.overrides).forEach(([dateKey, dayOverrides]) => {
      Object.entries(dayOverrides).forEach(([staffId, override]) => {
        if (override.shift === 'AL' && counts[staffId] !== undefined) {
          counts[staffId]++;
        }
      });
    });
    // Also count from annual_leave bookings
    if (data.annual_leave) {
      Object.entries(data.annual_leave).forEach(([staffId, bookings]) => {
        if (!Array.isArray(bookings)) return;
        // Don't double-count — overrides already captured
      });
    }
    return counts;
  }, [data.overrides, data.annual_leave, activeStaff]);

  const entitlement = data.config.al_entitlement_days || 28;

  // Book AL — only on scheduled working days
  function bookAL() {
    if (!bookingStaff || !bookingStart || !bookingEnd) return;
    const start = parseDate(bookingStart);
    const end = parseDate(bookingEnd);
    if (end < start) return;

    const staff = data.staff.find(s => s.id === bookingStaff);
    if (!staff) return;

    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
    const issues = [];
    let skippedOff = 0;
    let booked = 0;
    let d = new Date(start);
    while (d <= end) {
      const dateKey = formatDate(d);
      // Check if staff is scheduled to work this day
      const cycleDay = getCycleDay(d, data.config.cycle_start_date);
      const scheduled = getScheduledShift(staff, cycleDay);
      if (scheduled === 'OFF' || scheduled === 'AVL') {
        skippedOff++;
        d = addDays(d, 1);
        continue; // Don't use AL on days they're not working
      }
      const alOnDay = countALOnDate(d, newOverrides);
      if (alOnDay >= data.config.max_al_same_day) {
        issues.push(`${dateKey}: max AL reached (${data.config.max_al_same_day})`);
      } else {
        if (!newOverrides[dateKey]) newOverrides[dateKey] = {};
        newOverrides[dateKey][bookingStaff] = { shift: 'AL', reason: 'Annual leave booked', source: 'al' };
        booked++;
      }
      d = addDays(d, 1);
    }

    const msgs = [];
    if (skippedOff > 0) msgs.push(`${skippedOff} scheduled OFF days skipped (AL not used)`);
    if (issues.length > 0) msgs.push('Max AL days:\n' + issues.join('\n'));
    if (msgs.length > 0) alert(`${booked} AL days booked.\n\n${msgs.join('\n\n')}`);

    updateData({ ...data, overrides: newOverrides });
    setBookingStaff('');
    setBookingStart('');
    setBookingEnd('');
  }

  // Cancel AL for a staff member on a date
  function cancelAL(staffId, dateKey) {
    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
    if (newOverrides[dateKey]) {
      delete newOverrides[dateKey][staffId];
      if (Object.keys(newOverrides[dateKey]).length === 0) delete newOverrides[dateKey];
    }
    updateData({ ...data, overrides: newOverrides });
  }

  // Upcoming AL bookings
  const upcomingAL = useMemo(() => {
    const today = formatDate(new Date());
    const bookings = [];
    Object.entries(data.overrides).forEach(([dateKey, dayOverrides]) => {
      if (dateKey < today) return;
      Object.entries(dayOverrides).forEach(([staffId, override]) => {
        if (override.shift === 'AL') {
          const staff = data.staff.find(s => s.id === staffId);
          if (staff) bookings.push({ date: dateKey, staffId, staffName: staff.name, team: staff.team });
        }
      });
    });
    bookings.sort((a, b) => a.date.localeCompare(b.date));
    return bookings;
  }, [data.overrides, data.staff]);

  return (
    <div className="p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Annual Leave</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <h1 className="text-2xl font-bold text-gray-900">Annual Leave</h1>
        <button onClick={() => window.print()}
          className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded text-sm">Print</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Book AL */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Book Leave</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Staff</label>
              <select value={bookingStaff} onChange={e => setBookingStaff(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select...</option>
                {activeStaff.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.team}) — {entitlement - (alUsed[s.id] || 0)} days left</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">From</label>
                <input type="date" value={bookingStart} onChange={e => setBookingStart(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">To</label>
                <input type="date" value={bookingEnd} onChange={e => setBookingEnd(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="text-xs text-gray-500">Max {data.config.max_al_same_day} staff on AL per day</div>
            <button onClick={bookAL} disabled={!bookingStaff || !bookingStart || !bookingEnd}
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
              Book Annual Leave
            </button>
          </div>
        </div>

        {/* AL Balances */}
        <div className="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">AL Balances</h2>
            <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className="border rounded px-2 py-1 text-xs">
              <option value="All">All Teams</option>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                <tr>
                  <th className="py-1.5 px-2 text-left">Name</th>
                  <th className="py-1.5 px-2 text-left">Team</th>
                  <th className="py-1.5 px-2 text-center">Entitlement</th>
                  <th className="py-1.5 px-2 text-center">Used</th>
                  <th className="py-1.5 px-2 text-center">Remaining</th>
                  <th className="py-1.5 px-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
                  const used = alUsed[s.id] || 0;
                  const remaining = entitlement - used;
                  const pct = entitlement > 0 ? (used / entitlement) * 100 : 0;
                  return (
                    <tr key={s.id} className="border-b hover:bg-gray-50">
                      <td className="py-1.5 px-2 font-medium">{s.name}</td>
                      <td className="py-1.5 px-2 text-xs text-gray-500">{s.team}</td>
                      <td className="py-1.5 px-2 text-center">{entitlement}</td>
                      <td className="py-1.5 px-2 text-center">{used}</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`font-medium ${remaining <= 3 ? 'text-red-600' : remaining <= 7 ? 'text-amber-600' : 'text-green-600'}`}>
                          {remaining}
                        </span>
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="w-full bg-gray-100 rounded h-2">
                          <div className={`h-full rounded ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-amber-400' : 'bg-green-400'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* AL Calendar Heatmap */}
        <div className="bg-white rounded-lg shadow p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">AL Calendar — Next 2 Months</h2>
          {(() => {
            const now = new Date();
            const months = [
              { dates: getMonthDates(now.getFullYear(), now.getMonth()), label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) },
              { dates: getMonthDates(new Date(now.getFullYear(), now.getMonth() + 1, 1).getFullYear(), new Date(now.getFullYear(), now.getMonth() + 1, 1).getMonth()), label: new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) },
            ];
            return months.map(m => (
              <div key={m.label} className="mb-4">
                <h3 className="text-xs font-semibold text-gray-600 mb-1">{m.label}</h3>
                <div className="flex gap-0.5 flex-wrap">
                  {/* Pad to start on correct weekday */}
                  {Array.from({ length: (m.dates[0].getDay() + 6) % 7 }).map((_, i) => (
                    <div key={`pad-${i}`} className="w-8 h-8" />
                  ))}
                  {m.dates.map(d => {
                    const alCount = countALOnDate(d, data.overrides);
                    const max = data.config.max_al_same_day;
                    const isToday = formatDate(d) === formatDate(new Date());
                    return (
                      <div key={formatDate(d)} className={`w-8 h-8 rounded text-[10px] flex flex-col items-center justify-center ${
                        isToday ? 'ring-2 ring-blue-500' : ''
                      } ${
                        alCount >= max ? 'bg-red-200 text-red-800' :
                        alCount >= max - 1 ? 'bg-amber-200 text-amber-800' :
                        alCount > 0 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-50 text-gray-400'
                      }`} title={`${formatDate(d)}: ${alCount}/${max} AL`}>
                        <span className="font-medium leading-none">{d.getDate()}</span>
                        {alCount > 0 && <span className="text-[8px] font-bold leading-none">{alCount}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
          <div className="flex gap-3 text-[10px] text-gray-500 mt-1">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-50 border" /> None</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100" /> Some AL</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200" /> Near max</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200" /> Max reached</span>
          </div>
        </div>

        {/* Upcoming Bookings */}
        <div className="bg-white rounded-lg shadow p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Upcoming AL Bookings</h2>
          {upcomingAL.length === 0 ? (
            <div className="text-sm text-gray-400">No upcoming AL bookings</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {upcomingAL.slice(0, 20).map((b, i) => (
                <div key={i} className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{b.staffName}</div>
                    <div className="text-xs text-gray-500">{parseDate(b.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                  </div>
                  <button onClick={() => cancelAL(b.staffId, b.date)} className="text-red-400 hover:text-red-600 text-xs">Cancel</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
