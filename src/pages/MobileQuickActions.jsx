import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { BADGE, BTN, CARD, PAGE } from '../lib/design.js';
import { getMobileQuickActions } from '../lib/mobileQuickActionsApi.js';

const toneClasses = {
  red: 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]',
  amber: 'border-[var(--caution)] bg-[var(--caution-soft)] text-[var(--caution)]',
  blue: 'border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]',
  green: 'border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)]',
  purple: 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]',
  gray: 'border-[var(--line-2)] bg-[var(--paper-2)] text-[var(--ink-2)]',
};

function QuickActionCard({ action, index }) {
  return (
    <Link
      to={action.href}
      className={`${CARD.base} block min-h-[8.75rem] touch-manipulation p-4 transition hover:border-[var(--accent)] hover:bg-[var(--paper-2)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--paper)] active:scale-[0.99]`}
      aria-label={`${action.label}: ${action.summary}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold ${toneClasses[action.tone] || toneClasses.gray}`}
        >
          {action.initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold leading-6 text-[var(--ink)]">{action.label}</span>
            <span className={BADGE.gray}>{action.badge}</span>
          </span>
          <span className="mt-2 block text-sm leading-5 text-[var(--ink-3)]">{action.summary}</span>
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-[var(--ink-3)]">CQC: {action.cqcDomain}</span>
        <span className={`${BTN.secondary} ${BTN.sm} pointer-events-none min-h-11 px-3`}>{index === 0 ? 'Start' : 'Open'}</span>
      </div>
    </Link>
  );
}

export default function MobileQuickActions() {
  const {
    canRead,
    canWrite,
    scanIntakeEnabled = false,
    scanIntakeTargets = [],
    homeRole,
  } = useData();

  const actions = getMobileQuickActions({
    canRead,
    canWrite,
    scanIntakeEnabled,
    scanIntakeTargets,
  });

  return (
    <main className={`${PAGE.container} max-w-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]`}>
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">Mobile quick flows</p>
        <h1 className={PAGE.title}>Quick Actions</h1>
        <p className={PAGE.subtitle}>Fast links for frontline records, actions, audits, and evidence. Access follows the current home role.</p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-3" aria-label="Available quick flow summary">
        <div className={CARD.padded}>
          <p className="text-sm text-[var(--ink-3)]">Available</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{actions.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-sm text-[var(--ink-3)]">Role</p>
          <p className="mt-2 truncate text-sm font-semibold text-[var(--ink)]">{homeRole || 'Current home'}</p>
        </div>
      </section>

      {actions.length > 0 ? (
        <section className="grid gap-3" aria-label="Mobile quick action links">
          {actions.map((action, index) => (
            <QuickActionCard key={action.id} action={action} index={index} />
          ))}
        </section>
      ) : (
        <div className={CARD.padded}>
          <EmptyState
            title="No quick actions available"
            description="Your current role does not have access to the frontline quick flows for this home."
            compact
          />
        </div>
      )}

      <footer className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--paper-2)] p-3 text-xs leading-5 text-[var(--ink-3)]">
        Use the destination page to record details. This page does not store notes, names, or clinical decisions.
      </footer>
    </main>
  );
}
