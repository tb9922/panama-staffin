import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createMockDataContext } from './dataContextMock.js';

// Default DataContext mock for page tests is intentionally read-only viewer.
// Use mockDataContext() or renderWithProviders() when a test needs a writer role.
// Individual test files can also override with vi.mock('../../contexts/DataContext.jsx').
const _defaultDataCtx = createMockDataContext();
const _useData = vi.fn(() => _defaultDataCtx);
vi.mock('../contexts/DataContext.jsx', () => ({
  useData: _useData,
  DataProvider: ({ children }) => children,
}));

export function mockDataContext(overrides = {}) {
  const ctx = createMockDataContext(overrides);
  _useData.mockReturnValue(ctx);
  return ctx;
}

export const mockUseData = _useData;

// Re-apply default before each test (vi.clearAllMocks resets vi.fn implementations)
beforeEach(() => { mockDataContext(); });

// Guard jsdom-only globals for node-environment tests (lib + integration)
beforeEach(() => {
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
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
