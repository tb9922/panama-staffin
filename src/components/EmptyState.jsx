import { Link } from 'react-router-dom';
import { BTN } from '../lib/design.js';

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionTo,
  className = '',
  compact = false,
}) {
  return (
    <div className={`${compact ? 'py-6' : 'py-10'} text-center ${className}`.trim()}>
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      {actionLabel && onAction && (
        <div className="mt-4">
          <button type="button" onClick={onAction} className={`${BTN.primary} ${BTN.sm}`}>
            {actionLabel}
          </button>
        </div>
      )}
      {actionLabel && actionTo && (
        <div className="mt-4">
          <Link to={actionTo} className={`${BTN.primary} ${BTN.sm}`}>
            {actionLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
