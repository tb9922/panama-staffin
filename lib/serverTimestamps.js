export function toIsoOrNull(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
