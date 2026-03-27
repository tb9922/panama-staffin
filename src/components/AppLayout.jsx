import { useState, Suspense } from 'react';
import { NavLink } from 'react-router-dom';
import { changeOwnPassword } from '../lib/api.js';
import { BTN, INPUT, MODAL } from '../lib/design.js';
import { NAV_TOP, NAV_SECTIONS } from '../lib/navigation.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { ROLES, getRoleLabel } from '../../shared/roles.js';
import Modal from './Modal.jsx';
import CoverageAlertBanner from './CoverageAlertBanner.jsx';
import AppRoutes from './AppRoutes.jsx';

export default function AppLayout() {
  const { user, isPlatformAdmin, logout } = useAuth();
  const { loading, error, homes, activeHome, switchHome, clearError, canRead, homeRole } = useData();
  const canManageUsers = isPlatformAdmin || ROLES[homeRole]?.canManageUsers === true;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState({ scheduling: true, staff: true });
  const [changePwOpen, setChangePwOpen] = useState(false);

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50" role="status">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        <span className="text-gray-500 text-sm font-medium">Loading staffing data...</span>
      </div>
    </div>
  );

  if (error && homes.length === 0) return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50">
      <div className="bg-white border border-red-200 rounded-2xl shadow-lg p-6 max-w-md mx-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

  if (!activeHome) return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50">
      <div className="bg-white border border-amber-200 rounded-2xl shadow-lg p-6 max-w-md mx-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-amber-900 font-semibold text-lg">No Home Access</h2>
        </div>
        <p className="text-amber-800 text-sm">Your account is signed in, but it is not assigned to any home yet.</p>
        <p className="text-gray-500 text-xs mt-3">Ask a platform admin to grant home access, or log out and switch accounts.</p>
        <div className="mt-5">
          <button onClick={() => { void logout({ forceLocal: true }); }} className={BTN.primary}>Logout</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:shadow-lg">Skip to content</a>
      {/* Mobile top bar */}
      <div className="mobile-topbar hidden bg-gray-900 text-white items-center justify-between px-3 py-2.5 print:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-gray-400 hover:text-white p-1" aria-label="Open navigation menu">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
      <aside aria-label="Main navigation" className={`${sidebarOpen ? 'w-56' : 'w-14'} bg-gray-900 text-white flex flex-col transition-all duration-200 flex-shrink-0 print:hidden sidebar-mobile ${!sidebarOpen ? 'sidebar-closed' : ''} md:!relative md:!transform-none`}>
        <div className="p-3 border-b border-gray-800 flex items-center gap-2.5">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-white transition-colors" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
          {/* Top-level items */}
          {NAV_TOP.filter(item => {
            if (item.requiresUserManagement && !canManageUsers) return false;
            return !item.module || canRead(item.module);
          }).map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
              aria-label={!sidebarOpen ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center px-2.5 py-2 text-xs rounded-lg transition-colors duration-150 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`
              }
            >
              {item.icon && (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
              )}
              {sidebarOpen && <span className={item.icon ? 'ml-2.5 font-medium' : 'font-medium'}>{item.label}</span>}
            </NavLink>
          ))}

          {/* Grouped sections */}
          {NAV_SECTIONS.filter(s => {
            if (s.platformAdminOnly) return isPlatformAdmin;
            if (s.module) return canRead(s.module);
            // System section: show if any child item's module is accessible
            if (s.items) return s.items.some(item => !item.module || canRead(item.module));
            return true;
          }).map(section => {
            const isOpen = expandedSections[section.id];
            return (
              <div key={section.id}>
                <button
                  onClick={() => setExpandedSections(prev => ({ ...prev, [section.id]: !prev[section.id] }))}
                  aria-expanded={isOpen}
                  aria-label={!sidebarOpen ? section.label : undefined}
                  className={`w-full flex items-center px-2.5 py-2 text-xs rounded-lg transition-colors duration-150 ${
                    isOpen ? 'text-gray-200 bg-gray-800/50' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={section.icon} />
                  </svg>
                  {sidebarOpen && (
                    <>
                      <span className="ml-2.5 font-semibold flex-1 text-left">{section.label}</span>
                      <svg className={`w-3 h-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>
                {isOpen && sidebarOpen && (
                  <div className="ml-3 border-l border-gray-800 pl-1.5 mt-0.5 mb-1 space-y-0.5">
                    {section.items.filter(item => {
                      if (item.platformAdminOnly) return isPlatformAdmin;
                      if (item.requiresUserManagement && !canManageUsers) return false;
                      if (item.module) return canRead(item.module);
                      if (section.id === 'scheduling' && homeRole === 'staff_member') return item.ownDataSafe === true;
                      return true;
                    }).map(item => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
                        className={({ isActive }) =>
                          `flex items-center px-2 py-1.5 text-[11px] rounded-md transition-colors duration-150 ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                          }`
                        }
                      >
                        {item.icon && (
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                          </svg>
                        )}
                        <span className={item.icon ? 'ml-2 font-medium' : 'font-medium'}>{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {sidebarOpen && (
          <div className="p-3 border-t border-gray-800">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-gray-500 leading-relaxed">
                <span className="text-gray-300 font-medium">{user.displayName || user.username}</span> ({isPlatformAdmin ? 'Platform Admin' : getRoleLabel(homeRole) || user.role})<br />
                {homes.find(h => h.id === activeHome)?.name}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <button onClick={() => setChangePwOpen(true)}
                  className="text-[10px] text-gray-500 hover:text-blue-400 transition-colors font-medium">Password</button>
                <button onClick={() => { void logout(); }}
                  className="text-[10px] text-gray-500 hover:text-red-400 transition-colors font-medium">Logout</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main id="main-content" className="flex-1 overflow-auto">
        {homeRole && homeRole !== 'home_manager' && !isPlatformAdmin && (
          <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-xs text-blue-700 flex items-center gap-2 print:hidden">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {getRoleLabel(homeRole)} — some features may be read-only or hidden
          </div>
        )}
        {error && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-700 flex items-center justify-between" role="alert">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
            <button onClick={clearError} className="text-amber-600 hover:text-amber-800 text-xs font-medium">Dismiss</button>
          </div>
        )}
        <CoverageAlertBanner />
        <Suspense fallback={<div className="flex items-center justify-center py-20 text-gray-400 text-sm" role="status">Loading...</div>}>
          <AppRoutes key={activeHome} />
        </Suspense>
      </main>
      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPw !== confirm) { setError('Passwords do not match'); return; }
    if (newPw.length < 10) { setError('Password must be at least 10 characters'); return; }
    setSaving(true);
    try {
      await changeOwnPassword(current, newPw);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Change Password" size="sm">
      <form onSubmit={handleSubmit}>
        {error && <div id="pw-error" className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4" role="alert">{error}</div>}
        {done ? (
          <div className="text-center py-4">
            <p className="text-emerald-600 text-sm font-medium mb-3">Password changed successfully</p>
            <button type="button" className={BTN.primary} onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className={INPUT.label}>Current Password</label>
                <input className={INPUT.base} type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus aria-describedby={error ? 'pw-error' : undefined} aria-invalid={!!error} />
              </div>
              <div>
                <label className={INPUT.label}>New Password</label>
                <input className={INPUT.base} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={10} maxLength={200} aria-describedby={error ? 'pw-error' : undefined} aria-invalid={!!error} />
                <p className="text-xs text-gray-400 mt-1">Minimum 10 characters</p>
              </div>
              <div>
                <label className={INPUT.label}>Confirm New Password</label>
                <input className={INPUT.base} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required aria-describedby={error ? 'pw-error' : undefined} aria-invalid={!!error} />
              </div>
            </div>
            <div className={MODAL.footer}>
              <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
              <button type="submit" className={BTN.primary} disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
