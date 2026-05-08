import { describe, expect, it } from 'vitest';
import { createMockDataContext, DEFAULT_TEST_HOME_ROLE } from '../../src/test/dataContextMock.js';

describe('DataContext test mock helpers', () => {
  it('defaults to a read-only viewer instead of a writer role', () => {
    const ctx = createMockDataContext();

    expect(ctx.homeRole).toBe(DEFAULT_TEST_HOME_ROLE);
    expect(ctx.canRead('scheduling')).toBe(true);
    expect(ctx.canRead('compliance')).toBe(false);
    expect(ctx.canWrite('scheduling')).toBe(false);
  });

  it('derives permissions from the requested role', () => {
    const manager = createMockDataContext({ homeRole: 'home_manager' });
    const coordinator = createMockDataContext({ homeRole: 'shift_coordinator' });

    expect(manager.canWrite('gdpr')).toBe(true);
    expect(coordinator.canWrite('scheduling')).toBe(true);
    expect(coordinator.canWrite('staff')).toBe(false);
  });

  it('allows explicit per-test permission overrides', () => {
    const ctx = createMockDataContext({
      homeRole: 'viewer',
      canRead: (moduleId) => moduleId === 'compliance',
      canWrite: false,
    });

    expect(ctx.canRead('compliance')).toBe(true);
    expect(ctx.canRead('scheduling')).toBe(false);
    expect(ctx.canWrite('compliance')).toBe(false);
  });
});
