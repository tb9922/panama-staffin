import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import useIsAdmin from '../useIsAdmin.js';

describe('useIsAdmin', () => {
  it('returns true for admin role', () => {
    const { result } = renderHook(() => useIsAdmin({ username: 'admin', role: 'admin' }));
    expect(result.current).toBe(true);
  });

  it('returns false for viewer role', () => {
    const { result } = renderHook(() => useIsAdmin({ username: 'viewer', role: 'viewer' }));
    expect(result.current).toBe(false);
  });

  it('returns false when no user', () => {
    const { result } = renderHook(() => useIsAdmin(null));
    expect(result.current).toBe(false);
  });
});
