import { useToast } from '../contexts/useToast.js';

const TONE_STYLES = {
  success: 'border-emerald-200 bg-white/95 text-emerald-900 shadow-emerald-100',
  info: 'border-blue-200 bg-white/95 text-blue-900 shadow-blue-100',
  warning: 'border-amber-200 bg-white/95 text-amber-900 shadow-amber-100',
  error: 'border-red-200 bg-white/95 text-red-900 shadow-red-100',
};

const TONE_ACCENTS = {
  success: 'bg-emerald-500',
  info: 'bg-blue-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

const TONE_ICONS = {
  success: 'M5 13l4 4L19 7',
  info: 'M13 16h-1v-4h-1m1-4h.01',
  warning: 'M12 9v2m0 4h.01',
  error: 'M6 18L18 6M6 6l12 12',
};

export default function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-full max-w-md flex-col gap-3 print:hidden">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`pointer-events-auto overflow-hidden rounded-2xl border shadow-xl backdrop-blur transition-all ${TONE_STYLES[toast.tone] || TONE_STYLES.info}`}
          role="status"
          aria-live="polite"
        >
          <div className={`h-1.5 w-full ${TONE_ACCENTS[toast.tone] || TONE_ACCENTS.info}`} />
          <div className="flex items-start gap-3 px-4 py-3">
            <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${TONE_STYLES[toast.tone] || TONE_STYLES.info}`}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TONE_ICONS[toast.tone] || TONE_ICONS.info} />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.message && <p className="mt-1 text-sm text-slate-600">{toast.message}</p>}
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
              className="text-xs font-medium text-slate-400 transition hover:text-slate-700"
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
