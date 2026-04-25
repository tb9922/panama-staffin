import { CARD } from '../lib/design.js';

export default function LoadingState({
  message = 'Loading...',
  className = '',
  card = false,
  compact = false,
}) {
  const content = (
    <div className={`flex items-center justify-center gap-3 ${compact ? 'py-6' : 'py-10'} text-sm text-[var(--ink-3)]`} role="status" aria-live="polite">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );

  if (card) {
    return <div className={`${CARD.padded} ${className}`.trim()}>{content}</div>;
  }

  return <div className={className}>{content}</div>;
}
