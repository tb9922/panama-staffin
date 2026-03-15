import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Default DataContext mock for page tests — provides canRead/canWrite/homeRole.
// Override per-test via: useData.mockReturnValue({ canWrite: () => false, ... })
// Individual test files can also override with vi.mock('../../contexts/DataContext.jsx').
const _defaultDataCtx = {
  canRead: () => true,
  canWrite: () => true,
  homeRole: 'home_manager',
  staffId: null,
};
const _useData = vi.fn(() => _defaultDataCtx);
vi.mock('../contexts/DataContext.jsx', () => ({
  useData: _useData,
  DataProvider: ({ children }) => children,
}));
// Re-apply default before each test (vi.clearAllMocks resets vi.fn implementations)
beforeEach(() => { _useData.mockReturnValue(_defaultDataCtx); });

// Guard jsdom-only globals for node-environment tests (lib + integration)
beforeEach(() => { if (typeof sessionStorage !== 'undefined') sessionStorage.clear(); });
beforeEach(() => {
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { vi.clearAllMocks(); });

// Polyfills jsdom doesn't provide
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
}
