export default function ErrorBanner({ message, onDismiss, className = '' }) {
  if (!message) return null;
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 ${className}`} role="alert">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span>{message}</span>
      </div>
      {onDismiss && <button type="button" onClick={onDismiss} className="text-xs font-medium text-amber-700 hover:text-amber-900">Dismiss</button>}
    </div>
  );
}
