const VARIANT_STYLES = {
  info: 'bg-blue-50 border-blue-200 text-blue-700',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  error: 'bg-red-50 border-red-200 text-red-700',
};

const DISMISS_STYLES = {
  info: 'text-blue-500 hover:text-blue-700',
  success: 'text-emerald-500 hover:text-emerald-700',
  warning: 'text-amber-500 hover:text-amber-700',
  error: 'text-red-500 hover:text-red-700',
};

export default function InlineNotice({ variant = 'info', children, onDismiss, className = '', role = 'status' }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${VARIANT_STYLES[variant] || VARIANT_STYLES.info} ${className}`.trim()} role={role}>
      <div className="min-w-0">{children}</div>
      {onDismiss && (
        <button type="button" className={`shrink-0 text-xs font-medium transition-colors ${DISMISS_STYLES[variant] || DISMISS_STYLES.info}`} onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
