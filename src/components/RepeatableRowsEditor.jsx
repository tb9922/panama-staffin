import { BTN, INPUT } from '../lib/design.js';
import EmptyState from './EmptyState.jsx';

function createEmptyRow(columns) {
  return Object.fromEntries(columns.map((column) => [column.key, column.defaultValue ?? '']));
}

function rowHasContent(row, columns) {
  return columns.some((column) => {
    const value = row?.[column.key];
    if (typeof value === 'string') return value.trim() !== '';
    return value != null && value !== false;
  });
}

export default function RepeatableRowsEditor({
  title,
  description,
  rows = [],
  onChange,
  columns,
  addLabel = 'Add row',
  emptyTitle = 'No rows added yet',
  emptyDescription = 'Add the first row to capture structured details here.',
}) {
  function updateRow(index, key, value) {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row));
    onChange(next);
  }

  function addRow() {
    onChange([...(rows || []), createEmptyRow(columns)]);
  }

  function removeRow(index) {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          {description ? <p className="mt-1 text-xs text-gray-500">{description}</p> : null}
        </div>
        <button type="button" className={`${BTN.secondary} ${BTN.xs}`} onClick={addRow}>
          {addLabel}
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState compact title={emptyTitle} description={emptyDescription} actionLabel={addLabel} onAction={addRow} />
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={`row-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {title} {index + 1}
                  {!rowHasContent(row, columns) ? ' - draft' : ''}
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-red-500 transition-colors hover:text-red-700"
                  onClick={() => removeRow(index)}
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {columns.map((column) => {
                  const inputId = `${column.key}-${index}`;
                  const value = row?.[column.key] ?? '';
                  const widthClass = column.fullWidth ? 'md:col-span-2' : '';
                  if (column.type === 'textarea') {
                    return (
                      <div key={column.key} className={widthClass}>
                        <label htmlFor={inputId} className={INPUT.label}>{column.label}</label>
                        <textarea
                          id={inputId}
                          rows={column.rows || 3}
                          value={value}
                          onChange={(event) => updateRow(index, column.key, event.target.value)}
                          className={INPUT.base}
                          placeholder={column.placeholder}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={column.key} className={widthClass}>
                      <label htmlFor={inputId} className={INPUT.label}>{column.label}</label>
                      <input
                        id={inputId}
                        type={column.type || 'text'}
                        value={value}
                        onChange={(event) => updateRow(index, column.key, event.target.value)}
                        className={INPUT.base}
                        placeholder={column.placeholder}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
