import { Link, useLocation } from 'react-router-dom';
import { BTN } from '../lib/design.js';
import { buildScanInboxHref } from '../lib/scanRouting.js';

export default function ScanDocumentLink({
  context,
  label = 'Scan document',
  className = '',
  disabled = false,
  disabledReason = 'Save this record first to scan directly into it.',
}) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;

  if (!context?.target) return null;

  if (disabled) {
    return (
      <button type="button" className={`${BTN.secondary} ${BTN.sm} ${className}`.trim()} disabled title={disabledReason}>
        {label}
      </button>
    );
  }

  return (
    <Link to={buildScanInboxHref(context, returnTo)} className={`${BTN.secondary} ${BTN.sm} ${className}`.trim()}>
      {label}
    </Link>
  );
}
