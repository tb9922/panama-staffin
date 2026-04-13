import { useToast } from '../contexts/ToastContext.jsx';

const TONE_STYLES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

export default function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-full max-w-sm flex-col gap-2 print:hidden">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-lg ${TONE_STYLES[toast.tone] || TONE_STYLES.info}`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.message && <p className="mt-1 text-sm">{toast.message}</p>}
              {toast.actionLabel && toast.onAction && (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold underline underline-offset-2"
                  onClick={() => {
                    toast.onAction();
                    dismissToast(toast.id);
                  }}
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>
            <button
              type="button"
              className="text-xs font-medium opacity-70 transition hover:opacity-100"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss toast"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
