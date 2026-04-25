const VARIANT_STYLES = {
  info: 'border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]',
  success: 'border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)]',
  warning: 'border-[var(--caution)] bg-[var(--caution-soft)] text-[var(--caution)]',
  error: 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]',
};

const DISMISS_STYLES = {
  info: 'text-[var(--info)] hover:brightness-90',
  success: 'text-[var(--ok)] hover:brightness-90',
  warning: 'text-[var(--caution)] hover:brightness-90',
  error: 'text-[var(--alert)] hover:brightness-90',
};

export default function InlineNotice({ variant = 'info', children, onDismiss, className = '', role = 'status' }) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${VARIANT_STYLES[variant] || VARIANT_STYLES.info} ${className}`.trim()} role={role}>
      <div className="min-w-0">{children}</div>
      {onDismiss && (
        <button type="button" className={`shrink-0 text-xs font-medium transition-colors ${DISMISS_STYLES[variant] || DISMISS_STYLES.info}`} onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
