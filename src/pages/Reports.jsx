import { useState, useEffect } from 'react';
import { formatDate, parseDate } from '../lib/rotation.js';
import { CARD, INPUT, BTN } from '../lib/design.js';
import { getCurrentHome, getSchedulingData, getLoggedInUser } from '../lib/api.js';

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

export default function Reports() {
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const homeSlug = getCurrentHome();
    if (!homeSlug) return;
    // Cost report may need a full month of overrides; default ±90 day window is sufficient
    getSchedulingData(homeSlug)
      .then(setSchedData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading report data...</div>;
  if (!schedData) return <div className="p-6 text-red-600">Failed to load scheduling data</div>;

  return <ReportsInner data={schedData} />;
}

function ReportsInner({ data }) {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [generating, setGenerating] = useState(null);
  const [weekDate, setWeekDate] = useState(formatDate(getMonday(new Date())));
  const [costMonth, setCostMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  async function generate(type) {
    setGenerating(type);
    try {
      const { generateRosterPDF, generateCostPDF, generateCoveragePDF, generateStaffPDF } = await import('../lib/pdfReports.js');

      if (type === 'roster') {
        generateRosterPDF(data, parseDate(weekDate));
      } else if (type === 'cost') {
        const [y, m] = costMonth.split('-').map(Number);
        generateCostPDF(data, y, m - 1);
      } else if (type === 'coverage') {
        generateCoveragePDF(data, parseDate(weekDate));
      } else if (type === 'staff') {
        generateStaffPDF(data);
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setGenerating(null);
    }
  }

  const reports = [
    {
      id: 'roster',
      title: 'Weekly Roster',
      description: 'Staff roster with all shifts, colour-coded by type. Includes coverage summary and daily cost.',
      icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
      color: 'blue',
      dateInput: (
        <div>
          <label className={INPUT.label}>Week starting (Monday)</label>
          <input type="date" value={weekDate} onChange={e => setWeekDate(e.target.value)}
            className={INPUT.sm} />
        </div>
      ),
    },
    ...(isAdmin ? [{
      id: 'cost',
      title: 'Monthly Cost Report',
      description: 'Full P&L breakdown by day. Base pay, OT premium, agency, bank holiday costs. Budget comparison if set.',
      icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      color: 'green',
      dateInput: (
        <div>
          <label className={INPUT.label}>Month</label>
          <input type="month" value={costMonth} onChange={e => setCostMonth(e.target.value)}
            className={INPUT.sm} />
        </div>
      ),
    }] : []),
    {
      id: 'coverage',
      title: 'Coverage & Escalation',
      description: 'Daily coverage levels for early, late, and night shifts. Shows gaps, skill points, and escalation status.',
      icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      color: 'amber',
      dateInput: (
        <div>
          <label className={INPUT.label}>Week starting (Monday)</label>
          <input type="date" value={weekDate} onChange={e => setWeekDate(e.target.value)}
            className={INPUT.sm} />
        </div>
      ),
    },
    ...(isAdmin ? [{
      id: 'staff',
      title: 'Staff Register',
      description: 'Complete staff list with roles, teams, skill points, hourly rates, and contract details.',
      icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
      color: 'purple',
      dateInput: null,
    }] : []),
  ];

  const colorClasses = {
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', btn: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800' },
    green: { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', btn: 'bg-green-600 hover:bg-green-700 active:bg-green-800' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800' },
    purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', btn: 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800' },
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">PDF Reports</h1>
        <p className="text-sm text-gray-500">Generate downloadable PDF reports for CQC inspections, management, and compliance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map(report => {
          const c = colorClasses[report.color];
          const isGenerating = generating === report.id;
          return (
            <div key={report.id} className={`${c.bg} border ${c.border} rounded-xl p-5`}>
              <div className="flex items-start gap-3 mb-3">
                <div className={`p-2 rounded-xl bg-white ${c.icon} transition-colors`}>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={report.icon} />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{report.title}</h3>
                  <p className="text-xs text-gray-600 mt-0.5">{report.description}</p>
                </div>
              </div>

              {report.dateInput && (
                <div className="mb-3">{report.dateInput}</div>
              )}

              <button onClick={() => generate(report.id)} disabled={isGenerating}
                className={`w-full text-white py-2 rounded-lg text-sm font-medium shadow-sm transition-colors duration-150 ${c.btn} disabled:opacity-50`}>
                {isGenerating ? 'Generating...' : 'Download PDF'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Quick info */}
      <div className={`${CARD.padded} mt-6 !bg-gray-50`}>
        <p className="font-medium text-gray-700 text-xs mb-1">Report Notes</p>
        <ul className="space-y-0.5 list-disc pl-4 text-xs text-gray-500">
          <li>Roster reports include shift colour coding matching the app</li>
          <li>Cost reports include budget comparison if monthly budget is set (Budget vs Actual page)</li>
          <li>Coverage reports show minimum staffing requirements and escalation levels</li>
          <li>All reports include the home name, date range, and generation timestamp</li>
        </ul>
      </div>
    </div>
  );
}
