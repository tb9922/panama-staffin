import { BTN } from '../lib/design.js';

/**
 * Pagination controls for HR case lists.
 * Hidden when all rows fit in a single page.
 *
 * @param {number} total    - Total number of rows from the API
 * @param {number} limit    - Rows per page
 * @param {number} offset   - Current offset
 * @param {function} onChange - Called with new offset value
 */
export default function Pagination({ total, limit, offset, onChange }) {
  if (total <= limit) return null;

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const showEnd = Math.min(offset + limit, total);

  return (
    <div className="flex items-center justify-between px-3 py-3 border-t border-gray-100">
      <span className="text-xs text-gray-500">
        {offset + 1}&ndash;{showEnd} of {total}
      </span>
      <div className="flex gap-1">
        <button
          className={`${BTN.ghost} ${BTN.xs}`}
          onClick={() => onChange(0)}
          disabled={page === 1}
        >
          First
        </button>
        <button
          className={`${BTN.ghost} ${BTN.xs}`}
          onClick={() => onChange(Math.max(0, offset - limit))}
          disabled={page === 1}
        >
          Prev
        </button>
        <span className="px-2 py-1 text-xs text-gray-600">
          {page} / {totalPages}
        </span>
        <button
          className={`${BTN.ghost} ${BTN.xs}`}
          onClick={() => onChange(offset + limit)}
          disabled={page === totalPages}
        >
          Next
        </button>
        <button
          className={`${BTN.ghost} ${BTN.xs}`}
          onClick={() => onChange((totalPages - 1) * limit)}
          disabled={page === totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}
