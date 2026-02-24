import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { loadData, saveData, loadHomes, setCurrentHome, login, getLoggedInUser, logout, loadAuditLog } from './lib/api.js';
import { getStaffForDay, formatDate } from './lib/rotation.js';
import { getDayCoverageStatus } from './lib/escalation.js';
import Dashboard from './pages/Dashboard.jsx';
import DailyStatus from './pages/DailyStatus.jsx';
import RotationGrid from './pages/RotationGrid.jsx';
import StaffRegister from './pages/StaffRegister.jsx';
import CostTracker from './pages/CostTracker.jsx';
import AnnualLeave from './pages/AnnualLeave.jsx';
import ScenarioModel from './pages/ScenarioModel.jsx';
import FatigueTracker from './pages/FatigueTracker.jsx';
import SickTrends from './pages/SickTrends.jsx';
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
  { path: '/audit', label: 'Audit Log', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { path: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

const MAX_UNDO = 20;

// Audit Log page component
function AuditLog() {
  const [log, setLog] = useState([]);
  useEffect(() => { loadAuditLog().then(setLog); }, []);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Audit Log</h1>
      <p className="text-sm text-gray-500 mb-4">Last 100 actions — who changed what and when</p>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
            <tr>
              <th className="py-2 px-3 text-left">Time</th>
              <th className="py-2 px-3 text-left">Action</th>
              <th className="py-2 px-3 text-left">Home</th>
              <th className="py-2 px-3 text-left">User</th>
              <th className="py-2 px-3 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            {log.length === 0 ? (
              <tr><td colSpan={5} className="py-4 px-3 text-center text-gray-400">No audit entries yet</td></tr>
            ) : log.map((entry, i) => (
              <tr key={i} className="border-b hover:bg-gray-50">
                <td className="py-1.5 px-3 text-xs font-mono text-gray-500">{new Date(entry.ts).toLocaleString('en-GB')}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    entry.action === 'login' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                  }`}>{entry.action}</span>
                </td>
                <td className="py-1.5 px-3 text-xs">{entry.home}</td>
                <td className="py-1.5 px-3 text-xs font-medium">{entry.user}</td>
                <td className="py-1.5 px-3 text-xs text-gray-500">{entry.details}</td>
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
  return (
    <div className={`px-4 py-2 text-sm flex items-center justify-between print:hidden ${
      todayCoverage.overallLevel >= 4 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
    }`}>
      <div className="flex items-center gap-2">
        <span className="font-bold">
          {todayCoverage.overallLevel >= 4 ? 'CRITICAL' : 'ALERT'}:
        </span>
        <span>Today's coverage is at {
          todayCoverage.overallLevel >= 5 ? 'UNSAFE' :
          todayCoverage.overallLevel >= 4 ? 'SHORT-STAFFED' : 'Agency Required'
        } level</span>
        {['early', 'late', 'night'].map(p => {
          const esc = todayCoverage[p]?.escalation;
          if (!esc || esc.level < 3) return null;
          return <span key={p} className="px-1.5 py-0.5 rounded bg-white/20 text-xs capitalize">{p}: {esc.label}</span>;
        })}
      </div>
      <button onClick={() => navigate(`/day/${todayStr}`)} className="text-xs underline hover:no-underline">View Details</button>
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
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <form onSubmit={handleLogin} className="bg-white rounded-lg shadow-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Panama Staffing</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to continue</p>
        {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm font-medium">Sign In</button>
        </div>
        <div className="mt-4 text-xs text-gray-400 text-center">
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
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="text-gray-500 text-lg">Loading staffing data...</div>
    </div>
  );

  if (error && !data) return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
        <h2 className="text-red-800 font-semibold text-lg mb-2">Error Loading Data</h2>
        <p className="text-red-600 text-sm">{error}</p>
        <p className="text-red-500 text-xs mt-2">Make sure the API server is running (npm run dev)</p>
      </div>
    </div>
  );

  // Viewer can't edit
  const safeUpdateData = isViewer ? async () => { setError('Read-only mode — viewers cannot make changes'); } : updateData;

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Mobile top bar */}
      <div className="mobile-topbar hidden bg-gray-900 text-white items-center justify-between px-3 py-2 print:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-gray-400 hover:text-white p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-sm font-bold text-blue-400">PANAMA STAFFING</span>
        <span className="text-[10px] text-gray-400">{user.username}</span>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="sidebar-mobile-overlay hidden md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-52' : 'w-14'} bg-gray-900 text-white flex flex-col transition-all duration-200 flex-shrink-0 print:hidden sidebar-mobile ${!sidebarOpen ? 'sidebar-closed' : ''} md:!relative md:!transform-none`}>
        <div className="p-3 border-b border-gray-700 flex items-center gap-2">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {sidebarOpen && <span className="text-xs font-bold text-blue-400 tracking-wider">PANAMA STAFFING</span>}
        </div>

        {/* Home Selector */}
        {sidebarOpen && homes.length > 1 && (
          <div className="px-3 py-2 border-b border-gray-700">
            <select value={activeHome || ''} onChange={e => switchHome(e.target.value)}
              className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-600">
              {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}

        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
              className={({ isActive }) =>
                `flex items-center px-3 py-2.5 text-xs transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              {sidebarOpen && <span className="ml-2.5">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        {sidebarOpen && (
          <div className="p-3 border-t border-gray-700">
            {!isViewer && (
              <div className="flex items-center gap-1 mb-2">
                <button onClick={undo} disabled={undoCount === 0}
                  className="flex-1 text-[10px] py-1 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)">Undo ({undoCount})</button>
                <button onClick={redo} disabled={redoCount === 0}
                  className="flex-1 text-[10px] py-1 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Y)">Redo ({redoCount})</button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-gray-500">
                {user.username} ({user.role})<br />
                {data?.config?.home_name}
              </div>
              <button onClick={() => { logout(); setUser(null); setData(null); }}
                className="text-[10px] text-gray-500 hover:text-red-400">Logout</button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {isViewer && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs text-blue-700 print:hidden">
            Read-only mode — log in as admin to make changes
          </div>
        )}
        {error && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-700">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
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
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Config data={data} updateData={safeUpdateData} />} />
        </Routes>
      </main>
    </div>
  );
}
