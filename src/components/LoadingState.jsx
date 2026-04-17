import { CARD } from '../lib/design.js';

export default function LoadingState({
  message = 'Loading...',
  className = '',
  card = false,
  compact = false,
}) {
  const content = (
    <div className={`flex items-center justify-center gap-3 ${compact ? 'py-6' : 'py-10'} text-sm text-gray-500`} role="status" aria-live="polite">
      <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );

  if (card) {
    return <div className={`${CARD.padded} ${className}`.trim()}>{content}</div>;
  }

  return <div className={className}>{content}</div>;
}
