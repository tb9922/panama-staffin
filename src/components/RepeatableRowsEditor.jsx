import { BTN, INPUT } from '../lib/design.js';

function buildBlankRow(fields) {
  return Object.fromEntries(fields.map(field => [field.key, field.defaultValue ?? '']));
}

export default function RepeatableRowsEditor({
  label,
  hint,
  items = [],
  onChange,
  fields,
  addLabel = 'Add item',
  emptyText = 'No items added yet.',
}) {
  function updateItem(index, key, value) {
    const next = items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item));
    onChange(next);
  }

  function removeItem(index) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  function addItem() {
    onChange([...items, buildBlankRow(fields)]);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={INPUT.label}>{label}</label>
        {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-500">
          {emptyText}
        </div>
      )}

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={`${label}-${index}`} className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label} {index + 1}</span>
              <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => removeItem(index)}>
                Remove
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fields.map(field => (
                <div key={field.key} className={field.span === 2 ? 'md:col-span-2' : ''}>
                  <label className={INPUT.label}>{field.label}</label>
                  {field.type === 'textarea' ? (
                    <textarea
                      className={INPUT.base}
                      rows={field.rows || 3}
                      value={item[field.key] || ''}
                      onChange={event => updateItem(index, field.key, event.target.value)}
                      placeholder={field.placeholder}
                    />
                  ) : field.type === 'date' ? (
                    <input
                      type="date"
                      className={INPUT.base}
                      value={item[field.key] || ''}
                      onChange={event => updateItem(index, field.key, event.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      className={INPUT.base}
                      value={item[field.key] || ''}
                      onChange={event => updateItem(index, field.key, event.target.value)}
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={addItem}>
        + {addLabel}
      </button>
    </div>
  );
}
