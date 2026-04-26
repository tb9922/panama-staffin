import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { NavLink, Navigate, useLocation } from 'react-router-dom';
import { BTN } from '../lib/design.js';
import { NAV_TOP, NAV_SECTIONS, getDefaultExpandedSections } from '../lib/navigation.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { useNotifications } from '../contexts/useNotifications.js';
import { useToast } from '../contexts/useToast.js';
import { ROLES, getRoleLabel, isOwnDataOnly } from '../../shared/roles.js';
import { canAccessEvidenceHub } from '../../shared/evidenceHub.js';
import { hasDirtyState, subscribeDirtyState } from '../lib/dirtyStateRegistry.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import useAutoFormControlLabels from '../hooks/useAutoFormControlLabels.js';
import CoverageAlertBanner from './CoverageAlertBanner.jsx';
import AppRoutes from './AppRoutes.jsx';
import LoadingState from './LoadingState.jsx';
import ErrorState from './ErrorState.jsx';
import NotificationPanel from './NotificationPanel.jsx';
import ToastViewport from './ToastViewport.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';

function pathMatches(pathname, path) {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

function findActiveNavContext(pathname, topItems, sections) {
  const activeTopItem = topItems.find(item => pathMatches(pathname, item.path));
  if (activeTopItem) return { item: activeTopItem, section: null };

  for (const section of sections) {
    const activeItem = section.visibleItems.find(item => pathMatches(pathname, item.path));
    if (activeItem) return { item: activeItem, section };
  }

  return { item: null, section: null };
}

export default function AppLayout() {
  const { user, isPlatformAdmin, logout } = useAuth();
  const { loading, error, homes, activeHome, switchHome, clearError, canRead, homeRole, staffPortalEnabled } = useData();
  const canManageUsers = isPlatformAdmin || ROLES[homeRole]?.canManageUsers === true;
  const canUseEvidenceHub = isPlatformAdmin || canAccessEvidenceHub(homeRole);
  const location = useLocation();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth >= 1024
  ));
  const [sectionOverrides, setSectionOverrides] = useState({});
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [notificationPath, setNotificationPath] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(() => hasDirtyState());
  const { unreadCount } = useNotifications();

  useAutoFormControlLabels();

  useEffect(() => subscribeDirtyState(setHasUnsavedChanges), []);

  const isNavItemVisible = useCallback((item, sectionModule) => {
    if (item.platformAdminOnly && !isPlatformAdmin) return false;
    if (item.requiresUserManagement && !canManageUsers) return false;
    if (item.requiresEvidenceHub && !canUseEvidenceHub) return false;
    if (item.requiresStaffPortal && !staffPortalEnabled) return false;
    const effectiveModule = item.module || sectionModule;
    if (effectiveModule && !canRead(effectiveModule)) return false;
    if (effectiveModule && isOwnDataOnly(homeRole, effectiveModule)) return item.ownDataSafe === true;
    return true;
  }, [canManageUsers, canRead, canUseEvidenceHub, homeRole, isPlatformAdmin, staffPortalEnabled]);

  const visibleTopItems = useMemo(
    () => NAV_TOP.filter(item => isNavItemVisible(item)),
    [isNavItemVisible],
  );

  const visibleSections = useMemo(
    () => NAV_SECTIONS
      .map(section => ({
        ...section,
        visibleItems: (section.items || []).filter(item => isNavItemVisible(item, section.module)),
      }))
      .filter(section => {
        if (section.platformAdminOnly) return isPlatformAdmin;
        return section.visibleItems.length > 0;
      }),
    [isNavItemVisible, isPlatformAdmin],
  );

  const visibleSectionIds = useMemo(
    () => visibleSections.map(section => section.id),
    [visibleSections],
  );
  const defaultExpandedSections = useMemo(
    () => getDefaultExpandedSections(homeRole, visibleSectionIds, isPlatformAdmin),
    [homeRole, isPlatformAdmin, visibleSectionIds],
  );
  const activeNavContext = useMemo(
    () => findActiveNavContext(location.pathname, visibleTopItems, visibleSections),
    [location.pathname, visibleSections, visibleTopItems],
  );
  const activeSectionId = activeNavContext.section?.id || null;
  const expandedSections = useMemo(() => {
    const next = {};
    const platformRouteActive = isPlatformAdmin && activeSectionId === 'platform';
    visibleSectionIds.forEach((sectionId) => {
      next[sectionId] = sectionOverrides[sectionId] ?? (
        platformRouteActive
          ? sectionId === 'platform'
          : Boolean(defaultExpandedSections[sectionId])
      );
    });
    return next;
  }, [activeSectionId, defaultExpandedSections, isPlatformAdmin, sectionOverrides, visibleSectionIds]);
  const notificationOpen = notificationPath === location.pathname;

  function toggleNotificationPanel() {
    setNotificationPath(current => (current === location.pathname ? null : location.pathname));
  }

  function toggleSection(sectionId) {
    setSectionOverrides(current => ({
      ...current,
      [sectionId]: !(expandedSections[sectionId] ?? false),
    }));
  }

  const handleHomeChange = useCallback(async (nextHomeId) => {
    if (!nextHomeId || nextHomeId === activeHome) return;
    if (hasUnsavedChanges) {
      const shouldSwitch = await confirm({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Switch homes and discard them?',
        confirmLabel: 'Switch home',
        tone: 'ghost',
      });
      if (!shouldSwitch) return;
    }
    switchHome(nextHomeId);
    const nextHomeName = homes.find(home => home.id === nextHomeId)?.name || 'home';
    showToast({
      title: 'Home switched',
      message: `Switched to ${nextHomeName}`,
      tone: 'info',
    });
  }, [activeHome, confirm, hasUnsavedChanges, homes, showToast, switchHome]);

  const activeHomeName = homes.find(h => h.id === activeHome)?.name || 'No home selected';

  if (loading) return <LoadingState message="Loading staffing data..." className="h-screen bg-[var(--paper-2)]" />;

  if (error && homes.length === 0) return (
    <div className="flex h-screen items-center justify-center bg-[var(--paper-2)]">
      <div className="mx-4 max-w-md rounded-2xl border border-[var(--alert)] bg-[var(--paper)] p-6 shadow-lg">
        <ErrorState title="Error loading data" message={error} compact />
        <p className="mt-3 text-xs text-[var(--ink-3)]">Make sure the API server is running (`npm run dev`)</p>
      </div>
    </div>
  );

  if (!activeHome && isPlatformAdmin) {
    if (location.pathname !== '/platform/homes') {
      return <Navigate to="/platform/homes" replace />;
    }

    return (
      <div className="min-h-screen bg-[var(--paper-2)]">
        <main id="main-content" className="max-w-6xl mx-auto px-4 py-8">
          <div className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
                <svg className="h-4 w-4 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h6m-6 4h6m-6 4h3" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Platform Setup</h2>
            </div>
            <p className="text-sm text-[var(--ink-2)]">Your platform admin account is active, but there are no homes configured yet.</p>
            <p className="mt-3 text-xs text-[var(--ink-3)]">Create the first home below, then you can switch into it and use the rest of the app normally.</p>
            <div className="mt-5">
              <button onClick={() => { void logout({ forceLocal: true }); }} className={BTN.secondary}>Logout</button>
            </div>
          </div>
          <Suspense fallback={<LoadingState message="Loading page..." compact className="py-10" />}>
            <AppRoutes />
          </Suspense>
        </main>
      </div>
    );
  }

  if (!activeHome) return (
    <div className="flex h-screen items-center justify-center bg-[var(--paper-2)]">
      <div className="mx-4 max-w-md rounded-2xl border border-[var(--caution)] bg-[var(--paper)] p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--caution-soft)]">
            <svg className="h-4 w-4 text-[var(--caution)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">You don't have access to any homes yet</h2>
        </div>
        <p className="text-sm text-[var(--ink-2)]">Your account is signed in, but it is not assigned to any home yet.</p>
        <p className="mt-3 text-xs text-[var(--ink-3)]">Ask a platform admin to grant home access, or log out and switch accounts.</p>
        <div className="mt-5">
          <button onClick={() => { void logout({ forceLocal: true }); }} className={BTN.primary}>Logout</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app saas theme-a flex h-screen bg-[var(--paper-2)] text-[var(--ink)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-[var(--accent-ink)] focus:shadow-lg">Skip to content</a>
      {/* Mobile top bar */}
      <div className="mobile-topbar hidden items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-[var(--ink)] print:hidden">
        <button onClick={() => setSidebarOpen(true)} className="p-2.5 text-[var(--ink-2)] hover:text-[var(--ink)]" aria-label="Open navigation menu">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="relative rounded-md p-2.5 text-[var(--ink-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            onClick={toggleNotificationPanel}
            aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadCount > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[var(--alert)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{unreadCount}</span>}
          </button>
          <span className="text-xs text-[var(--ink-3)]">{user.username}</span>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="sidebar-mobile-overlay hidden md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside aria-label="Main navigation" className={`${sidebarOpen ? 'w-64' : 'w-16'} sidebar-mobile flex flex-shrink-0 flex-col border-r border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] shadow-[0_16px_48px_-34px_rgba(20,20,40,0.45)] backdrop-blur transition-all duration-200 print:hidden ${!sidebarOpen ? 'sidebar-closed' : ''} md:!relative md:!transform-none`}>
        <div className="border-b border-[var(--line)] bg-[var(--paper)] p-3">
          <div className="flex items-center gap-2.5">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-lg p-2.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)]" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            </button>
            {sidebarOpen && (
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] shadow-sm">
                  <svg className="h-4 w-4 text-[var(--accent-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight text-[var(--ink)]">Panama Staffing</p>
                  <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-3)]">{activeHomeName}</p>
                </div>
              </div>
            )}
            {sidebarOpen && (
              <button
                type="button"
                className="ml-auto rounded-lg p-2.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)] md:hidden"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close"
                title="Close navigation menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {sidebarOpen && (
            <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">Workspace</p>
              <p className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">{activeNavContext.item?.label || activeHomeName}</p>
              <p className="mt-1 truncate text-xs text-[var(--ink-3)]">
                {(activeNavContext.section?.label || 'General')} • {isPlatformAdmin ? 'Platform Admin' : getRoleLabel(homeRole) || user.role}
              </p>
            </div>
          )}
        </div>

        {/* Home Selector */}
        {sidebarOpen && homes.length > 1 && (
          <div className="border-b border-[var(--line)] px-3 py-2.5">
            <select value={activeHome || ''} onChange={e => { void handleHomeChange(e.target.value); }}
              aria-label="Select active home"
              className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--paper)] px-2.5 py-2 text-xs text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none">
              {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {/* Top-level items */}
          {visibleTopItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
              aria-label={!sidebarOpen ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-lg px-3 py-2.5 text-xs transition-colors duration-150 ${
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                    : 'text-[var(--ink-2)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]'
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
          {visibleSections.map(section => {
            const isOpen = expandedSections[section.id];
            const sectionHasActiveItem = section.visibleItems.some(item => pathMatches(location.pathname, item.path));
            return (
              <div key={section.id}>
                <button
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isOpen}
                  aria-label={!sidebarOpen ? section.label : undefined}
                  className={`flex w-full items-center rounded-lg px-3 py-2.5 text-xs transition-colors duration-150 ${
                    sectionHasActiveItem
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : isOpen
                        ? 'bg-[var(--paper-2)] text-[var(--ink)]'
                        : 'text-[var(--ink-3)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]'
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={section.icon} />
                  </svg>
                  {sidebarOpen && (
                    <>
                      <span className="ml-2.5 flex-1 text-left font-semibold">{section.label}</span>
                      <span className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-3)]">
                        {section.visibleItems.length}
                      </span>
                      <svg className={`w-3 h-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>
                {isOpen && sidebarOpen && (
                  <div className="mb-2 ml-3 mt-1 space-y-1 border-l border-[var(--line)] pl-2">
                    {section.visibleItems.map(item => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
                        className={({ isActive }) =>
                          `flex items-center rounded-lg px-2.5 py-2 text-xs transition-colors duration-150 ${
                            isActive
                              ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                              : 'text-[var(--ink-2)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]'
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
          <div className="shrink-0 border-t border-[var(--line)] p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs leading-relaxed text-[var(--ink-3)]">
                <span className="font-medium text-[var(--ink)]">{user.displayName || user.username}</span> ({isPlatformAdmin ? 'Platform Admin' : getRoleLabel(homeRole) || user.role})<br />
                {homes.find(h => h.id === activeHome)?.name}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <button onClick={() => setChangePwOpen(true)}
                  className="text-xs font-medium text-[var(--ink-3)] transition-colors hover:text-[var(--accent)]">Change password</button>
                <button onClick={() => { void logout(); }}
                  className="text-xs font-medium text-[var(--ink-3)] transition-colors hover:text-[var(--alert)]">Logout</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main id="main-content" className="relative flex-1 overflow-auto bg-[var(--paper-2)]">
        <div className="desktop-app-header sticky top-0 z-20 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-3 shadow-sm backdrop-blur print:hidden">
          <div className="min-w-0">
            {activeNavContext.section?.label && (
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                {activeNavContext.section.label}
              </p>
            )}
            <p className="truncate text-base font-semibold text-[var(--ink)]">{activeNavContext.item?.label || activeHomeName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-3)]">
              <span className="rounded-full border border-[var(--line)] bg-[var(--paper-2)] px-2.5 py-1 font-medium text-[var(--ink-2)]">
                {user.displayName || user.username}
              </span>
              <span className="rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 font-medium text-[var(--accent)]">
                {homes.find(h => h.id === activeHome)?.name}
              </span>
              <span className="rounded-full border border-[var(--ok)] bg-[var(--ok-soft)] px-2.5 py-1 font-medium text-[var(--ok)]">
                {isPlatformAdmin ? 'Platform Admin' : getRoleLabel(homeRole) || user.role}
              </span>
            </div>
            <p className="sr-only">{user.displayName || user.username} - {homes.find(h => h.id === activeHome)?.name} - {isPlatformAdmin ? 'Platform Admin' : getRoleLabel(homeRole) || user.role}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={BTN.secondary}
              onClick={() => setChangePwOpen(true)}
            >
              Change password
            </button>
            <button
              type="button"
              className={`${BTN.secondary} relative`}
              onClick={toggleNotificationPanel}
              aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span>Notifications</span>
              {unreadCount > 0 && <span className="rounded-full bg-[var(--alert)] px-2 py-0.5 text-xs font-semibold text-white">{unreadCount}</span>}
            </button>
          </div>
        </div>
        <NotificationPanel open={notificationOpen} onClose={() => setNotificationPath(null)} />
        {homeRole && homeRole !== 'home_manager' && !isPlatformAdmin && (
          <div className="flex items-center gap-2 border-b border-[var(--info)] bg-[var(--info-soft)] px-4 py-2 text-xs text-[var(--info)] print:hidden">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {getRoleLabel(homeRole)} workspace — some tools are read-only or hidden for this role
          </div>
        )}
        <ErrorBanner message={error} onDismiss={clearError} />
        <CoverageAlertBanner />
        <Suspense fallback={<LoadingState message="Loading page..." compact className="py-10" />}>
          <AppRoutes key={activeHome} />
        </Suspense>
      </main>
      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}
      {ConfirmDialog}
      <ToastViewport />
    </div>
  );
}
