import { BTN } from '../lib/design.js';

export default function ErrorState({
  title = 'Unable to load this page',
  message,
  onRetry,
  retryLabel = 'Retry',
  className = '',
}) {
  return (
    <div className={`rounded-xl border border-[var(--alert)] bg-[var(--alert-soft)] px-4 py-4 text-[var(--alert)] ${className}`.trim()} role="alert">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--alert)]">{title}</p>
          <p className="mt-1 text-sm break-words">{message || 'Something went wrong.'}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`${BTN.secondary} ${BTN.sm} shrink-0 border-[var(--alert)] bg-[var(--paper)] text-[var(--alert)] hover:bg-[var(--alert-soft)]`}>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
