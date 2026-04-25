import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../contexts/useNotifications.js';
import LoadingState from './LoadingState.jsx';
import ErrorState from './ErrorState.jsx';
import EmptyState from './EmptyState.jsx';

const SEVERITY_STYLES = {
  error: 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]',
  warning: 'border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--ink)]',
  info: 'border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]',
};

export default function NotificationPanel({ open, onClose }) {
  const { items, unreadCount, loading, error, refresh, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="absolute right-4 top-16 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-2xl print:hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Notifications</h2>
          <p className="text-xs text-[var(--ink-3)]">{unreadCount} unread</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]" onClick={() => void markAllRead()}>
            Mark all read
          </button>
          <button type="button" className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-y-auto p-3">
        {loading && <LoadingState compact message="Loading notifications..." />}
        {!loading && error && <ErrorState title="Could not load notifications" message={error} onRetry={() => void refresh()} />}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            compact
            title="All caught up"
            description="No unread alerts right now. We’ll surface new issues here as they happen."
          />
        )}
        {!loading && !error && items.length > 0 && (
          <div className="space-y-2">
            {items.map(item => (
              <div
                key={item.key}
                className={`rounded-xl border px-3 py-3 text-sm ${SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.info} ${item.isRead ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{item.title}</p>
                    <p className="mt-1 text-sm font-medium">{item.message}</p>
                    <div className="mt-2 flex items-center gap-3">
                      {item.link && (
                        <Link
                          to={item.link}
                          className="text-xs font-semibold underline underline-offset-2"
                          onClick={() => {
                            void markRead(item.key);
                            onClose();
                          }}
                        >
                          Open
                        </Link>
                      )}
                      {!item.isRead && (
                        <button
                          type="button"
                          className="text-xs font-semibold underline underline-offset-2"
                          onClick={() => void markRead(item.key)}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                  {!item.isRead && <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
