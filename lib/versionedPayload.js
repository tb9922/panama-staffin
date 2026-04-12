export function splitVersion(payload = {}) {
  const { _version, ...rest } = payload || {};
  return {
    version: Number.isFinite(_version) ? _version : null,
    payload: rest,
  };
}

export function definedWithoutVersion(payload = {}) {
  const { payload: stripped } = splitVersion(payload);
  return Object.fromEntries(
    Object.entries(stripped).filter(([, value]) => value !== undefined)
  );
}
