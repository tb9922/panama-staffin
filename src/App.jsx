import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { loadData, saveData, loadHomes, setCurrentHome, login, getLoggedInUser, logout, loadAuditLog } from './lib/api.js';
import { getStaffForDay, formatDate } from './lib/rotation.js';
import { getDayCoverageStatus } from './lib/escalation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from './lib/design.js';
import Dashboard from './pages/Dashboard.jsx';
import DailyStatus from './pages/DailyStatus.jsx';
import RotationGrid from './pages/RotationGrid.jsx';
import StaffRegister from './pages/StaffRegister.jsx';
import CostTracker from './pages/CostTracker.jsx';
import AnnualLeave from './pages/AnnualLeave.jsx';
import ScenarioModel from './pages/ScenarioModel.jsx';
import FatigueTracker from './pages/FatigueTracker.jsx';
import SickTrends from './pages/SickTrends.jsx';
import BudgetTracker from './pages/BudgetTracker.jsx';
import TrainingMatrix from './pages/TrainingMatrix.jsx';
import Reports from './pages/Reports.jsx';
import Config from './pages/Config.jsx';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
  { path: '/day', label: 'Daily Status', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { path: '/rotation', label: 'Roster', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
  { path: '/staff', label: 'Staff DB', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { path: '/costs', label: 'Costs', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { path: '/leave', label: 'Annual Leave', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zM9 15l2 2 4-4' },
  { path: '/scenarios', label: 'Scenarios', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m6 0h6m-6 0V9a2 2 0 012-2h2a2 2 0 012 2v10m6 0v-4a2 2 0 00-2-2h-2a2 2 0 00-2 2v4' },
  { path: '/fatigue', label: 'Fatigue', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z' },
  { path: '/sick-trends', label: 'Sick Trends', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { path: '/training', label: 'Training', icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222' },
  { path: '/budget', label: 'Budget', icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { path: '/reports', label: 'Reports', icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { path: '/audit', label: 'Audit Log', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { path: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

const MAX_UNDO = 20;

// Audit Log page component
function AuditLog() {
  const [log, setLog] = useState([]);
  useEffect(() => { loadAuditLog().then(setLog); }, []);
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Audit Log</h1>
      <p className="text-sm text-gray-500 mb-5">Last 100 actions — who changed what and when</p>
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th className={TABLE.th}>Time</th>
              <th className={TABLE.th}>Action</th>
              <th className={TABLE.th}>Home</th>
              <th className={TABLE.th}>User</th>
              <th className={TABLE.th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {log.length === 0 ? (
              <tr><td colSpan={5} className={TABLE.empty}>No audit entries yet</td></tr>
            ) : log.map((entry, i) => (
              <tr key={i} className={TABLE.tr}>
                <td className={`${TABLE.td} text-xs font-mono text-gray-500`}>{new Date(entry.ts).toLocaleString('en-GB')}</td>
                <td className={TABLE.td}>
                  <span className={entry.action === 'login' ? BADGE.blue : BADGE.green}>{entry.action}</span>
                </td>
                <td className={`${TABLE.td} text-xs`}>{entry.home}</td>
                <td className={`${TABLE.td} text-xs font-medium`}>{entry.user}</td>
                <td className={`${TABLE.td} text-xs text-gray-500`}>{entry.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoverageAlertBanner({ data }) {
  const navigate = useNavigate();
  const todayCoverage = useMemo(() => {
    if (!data) return null;
    const today = new Date();
    const staffForDay = getStaffForDay(data.staff, today, data.overrides, data.config);
    return getDayCoverageStatus(staffForDay, data.config);
  }, [data]);

  if (!todayCoverage || todayCoverage.overallLevel < 3) return null;

  const todayStr = formatDate(new Date());
  const isCritical = todayCoverage.overallLevel >= 4;
  return (
    <div className={`px-4 py-2.5 text-sm flex items-center justify-between print:hidden ${
      isCritical ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
    }`}>
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          return <span key={p} className="px-1.5 py-0.5 rounded-full bg-white/20 text-xs font-medium capitalize">{p}: {esc.label}</span>;
        })}
      </div>
      <button onClick={() => navigate(`/day/${todayStr}`)} className="text-xs font-medium underline hover:no-underline">View Details</button>
    </div>
  );
}

// Login screen
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    try {
      const user = await login(username, password);
      onLogin(user);
    } catch {
      setError('Invalid username or password');
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50">
      <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 w-full max-w-sm mx-4">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Panama Staffing</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">Sign in to manage your roster</p>
        {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              className={INPUT.base} placeholder="Enter username" autoFocus />
          </div>
          <div>
            <label className={INPUT.label}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className={INPUT.base} placeholder="Enter password" />
          </div>
          <button type="submit" className={`${BTN.primary} w-full`}>Sign In</button>
        </div>
        <div className="mt-5 text-xs text-gray-400 text-center">
          Default: admin/admin123 (edit) or viewer/view123 (read-only)
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(getLoggedInUser);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [homes, setHomes] = useState([]);
  const [activeHome, setActiveHome] = useState(null);

  // Undo/Redo stacks
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const isViewer = user?.role === 'viewer';

  // Load homes list then load first home's data
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadHomes()
      .then(h => {
        setHomes(h);
        const firstHome = h[0]?.id || 'default';
        setActiveHome(firstHome);
        setCurrentHome(firstHome);
        return loadData(firstHome);
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  function switchHome(homeId) {
    setLoading(true);
    setActiveHome(homeId);
    setCurrentHome(homeId);
    undoStack.current = [];
    redoStack.current = [];
    setUndoCount(0);
    setRedoCount(0);
    loadData(homeId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  const updateData = useCallback(async (newData) => {
    setData(prev => {
      if (prev) {
        undoStack.current.push(JSON.stringify(prev));
        if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
        setUndoCount(undoStack.current.length);
      }
      redoStack.current = [];
      setRedoCount(0);
      return newData;
    });
    try {
      await saveData(newData);
    } catch (e) {
      setError('Failed to save: ' + e.message);
    }
  }, []);

  const undo = useCallback(async () => {
    if (undoStack.current.length === 0) return;
    const prevState = JSON.parse(undoStack.current.pop());
    setUndoCount(undoStack.current.length);
    setData(current => {
      redoStack.current.push(JSON.stringify(current));
      setRedoCount(redoStack.current.length);
      return prevState;
    });
    try {
      await saveData(prevState);
    } catch (e) {
      setError('Failed to save undo: ' + e.message);
    }
  }, []);

  const redo = useCallback(async () => {
    if (redoStack.current.length === 0) return;
    const nextState = JSON.parse(redoStack.current.pop());
    setRedoCount(redoStack.current.length);
    setData(current => {
      undoStack.current.push(JSON.stringify(current));
      setUndoCount(undoStack.current.length);
      return nextState;
    });
    try {
      await saveData(nextState);
    } catch (e) {
      setError('Failed to save redo: ' + e.message);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo]);

  // Login screen
  if (!user) return <LoginScreen onLogin={setUser} />;

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-500 text-sm font-medium">Loading staffing data...</span>
      </div>
    </div>
  );

  if (error && !data) return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50">
      <div className="bg-white border border-red-200 rounded-2xl shadow-lg p-6 max-w-md mx-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-red-800 font-semibold text-lg">Error Loading Data</h2>
        </div>
        <p className="text-red-600 text-sm">{error}</p>
        <p className="text-gray-400 text-xs mt-3">Make sure the API server is running (npm run dev)</p>
      </div>
    </div>
  );

  // Viewer can't edit
  const safeUpdateData = isViewer ? async () => { setError('Read-only mode — viewers cannot make changes'); } : updateData;

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Mobile top bar */}
      <div className="mobile-topbar hidden bg-gray-900 text-white items-center justify-between px-3 py-2.5 print:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-gray-400 hover:text-white p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-sm font-semibold">Panama Staffing</span>
        </div>
        <span className="text-[10px] text-gray-400">{user.username}</span>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="sidebar-mobile-overlay hidden md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-14'} bg-gray-900 text-white flex flex-col transition-all duration-200 flex-shrink-0 print:hidden sidebar-mobile ${!sidebarOpen ? 'sidebar-closed' : ''} md:!relative md:!transform-none`}>
        <div className="p-3 border-b border-gray-800 flex items-center gap-2.5">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm font-semibold tracking-tight">Panama Staffing</span>
            </div>
          )}
        </div>

        {/* Home Selector */}
        {sidebarOpen && homes.length > 1 && (
          <div className="px-3 py-2.5 border-b border-gray-800">
            <select value={activeHome || ''} onChange={e => switchHome(e.target.value)}
              className="w-full bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none">
              {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}

        <nav className="flex-1 py-1.5 px-2 overflow-y-auto space-y-0.5">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
              className={({ isActive }) =>
                `flex items-center px-2.5 py-2 text-xs rounded-lg transition-colors duration-150 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`
              }
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
              </svg>
              {sidebarOpen && <span className="ml-2.5 font-medium">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        {sidebarOpen && (
          <div className="p-3 border-t border-gray-800">
            {!isViewer && (
              <div className="flex items-center gap-1.5 mb-2.5">
                <button onClick={undo} disabled={undoCount === 0}
                  className="flex-1 text-[10px] py-1.5 rounded-md bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Undo (Ctrl+Z)">Undo ({undoCount})</button>
                <button onClick={redo} disabled={redoCount === 0}
                  className="flex-1 text-[10px] py-1.5 rounded-md bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Redo (Ctrl+Y)">Redo ({redoCount})</button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-gray-500 leading-relaxed">
                <span className="text-gray-300 font-medium">{user.username}</span> ({user.role})<br />
                {data?.config?.home_name}
              </div>
              <button onClick={() => { logout(); setUser(null); setData(null); }}
                className="text-[10px] text-gray-500 hover:text-red-400 transition-colors font-medium">Logout</button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {isViewer && (
          <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-xs text-blue-700 flex items-center gap-2 print:hidden">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Read-only mode — log in as admin to make changes
          </div>
        )}
        {error && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
            <button onClick={() => setError(null)} className="text-amber-600 hover:text-amber-800 text-xs font-medium">Dismiss</button>
          </div>
        )}
        <CoverageAlertBanner data={data} />
        <Routes>
          <Route path="/" element={<Dashboard data={data} updateData={safeUpdateData} />} />
          <Route path="/day" element={<DailyStatus data={data} updateData={safeUpdateData} />} />
          <Route path="/day/:date" element={<DailyStatus data={data} updateData={safeUpdateData} />} />
          <Route path="/rotation" element={<RotationGrid data={data} updateData={safeUpdateData} />} />
          <Route path="/staff" element={<StaffRegister data={data} updateData={safeUpdateData} />} />
          <Route path="/costs" element={<CostTracker data={data} updateData={safeUpdateData} />} />
          <Route path="/leave" element={<AnnualLeave data={data} updateData={safeUpdateData} />} />
          <Route path="/scenarios" element={<ScenarioModel data={data} />} />
          <Route path="/fatigue" element={<FatigueTracker data={data} />} />
          <Route path="/sick-trends" element={<SickTrends data={data} />} />
          <Route path="/training" element={<TrainingMatrix data={data} updateData={safeUpdateData} />} />
          <Route path="/budget" element={<BudgetTracker data={data} updateData={safeUpdateData} />} />
          <Route path="/reports" element={<Reports data={data} />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Config data={data} updateData={safeUpdateData} />} />
        </Routes>
      </main>
    </div>
  );
}
