const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const LEGACY_ACTION_FREEZE_ENV = 'V1_LEGACY_ACTION_FREEZE';

export function isLegacyActionFreezeEnabled() {
  return TRUE_VALUES.has(String(process.env[LEGACY_ACTION_FREEZE_ENV] || '').trim().toLowerCase());
}

function hasContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function legacyActionFieldsWithContent(payload = {}, fields = []) {
  return fields.filter(field => Object.prototype.hasOwnProperty.call(payload, field) && hasContent(payload[field]));
}

export function rejectLegacyActionWriteIfFrozen(res, payload, fields, sourceLabel) {
  if (!isLegacyActionFreezeEnabled()) return false;
  const blockedFields = legacyActionFieldsWithContent(payload, fields);
  if (blockedFields.length === 0) return false;

  res.status(409).json({
    error: 'Legacy action fields are read-only after the V1 action_items freeze. Use Manager Actions instead.',
    source: sourceLabel,
    fields: blockedFields,
  });
  return true;
}
