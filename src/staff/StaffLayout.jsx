import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { BTN } from '../lib/design.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/schedule', label: 'My Schedule' },
  { to: '/leave', label: 'My Leave' },
  { to: '/payslips', label: 'My Payslips' },
  { to: '/training', label: 'My Training' },
  { to: '/report-sick', label: 'Report Sick' },
  { to: '/profile', label: 'My Profile' },
];

export default function StaffLayout() {
  const { user, logout } = useAuth();
  const { loading, error, activeHomeObj, staffId } = useData();

  let content = null;
  if (loading) {
    content = <LoadingState message="Loading your staff portal..." className="p-6" />;
  } else if (error) {
    content = <ErrorState title="Unable to load your staff portal" message={error} onRetry={() => window.location.reload()} className="p-6" />;
  } else if (!activeHomeObj || !staffId) {
    content = (
      <ErrorState
        title="Unable to find your staff profile"
        message="Your portal account is signed in, but it is not linked to an active staff profile for this home."
        className="p-6"
      />
    );
  } else {
    content = <Outlet />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Staff portal</p>
              <h1 className="mt-1 text-xl font-bold text-slate-900">Panama Staffing</h1>
              <p className="mt-1 text-sm text-slate-600">
                {activeHomeObj?.name || 'Your home'} | {user?.displayName || user?.username}
              </p>
            </div>
            <button type="button" className={BTN.secondary} onClick={() => { void logout(); }}>
              Logout
            </button>
          </div>
          <nav className="mt-4 flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `${isActive ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'} inline-flex rounded-full border border-slate-200 px-3 py-2 text-sm font-medium transition-colors`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {content}
        </div>
      </main>
    </div>
  );
}
