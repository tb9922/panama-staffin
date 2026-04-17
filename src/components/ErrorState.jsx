import { BTN } from '../lib/design.js';

export default function ErrorState({
  title = 'Unable to load this page',
  message,
  onRetry,
  retryLabel = 'Retry',
  className = '',
}) {
  return (
    <div className={`rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-red-700 ${className}`.trim()} role="alert">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-800">{title}</p>
          <p className="mt-1 text-sm break-words">{message || 'Something went wrong.'}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`${BTN.secondary} ${BTN.sm} shrink-0 border-red-200 bg-white text-red-700 hover:bg-red-100`}>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
