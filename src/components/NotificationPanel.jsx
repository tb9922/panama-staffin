import { Link } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationContext.jsx';
import LoadingState from './LoadingState.jsx';
import ErrorState from './ErrorState.jsx';
import EmptyState from './EmptyState.jsx';

const SEVERITY_STYLES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

export default function NotificationPanel({ open, onClose }) {
  const { items, unreadCount, loading, error, refresh, markRead, markAllRead } = useNotifications();

  if (!open) return null;

  return (
    <div className="absolute right-4 top-16 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl print:hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
          <p className="text-xs text-slate-500">{unreadCount} unread</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => void markAllRead()}>
            Mark all read
          </button>
          <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={onClose}>
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
            description="No unread alerts right now. We'll surface new issues here as they happen."
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
                  {!item.isRead && <span className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-500" aria-hidden="true" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
