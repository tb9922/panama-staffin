import { describe, expect, it } from 'vitest';
import {
  assertLocalOnlyTarget,
  buildHomeConfig,
  parseIntegerOption,
  summarizeTimings,
} from '../../scripts/v1-scale-load-check.js';

describe('v1 scale/load harness helpers', () => {
  it('refuses production and non-local database targets', () => {
    expect(() => assertLocalOnlyTarget({
      nodeEnv: 'production',
      dbHost: 'localhost',
      dbName: 'panama_test',
      dbSsl: false,
      allowedOrigin: 'http://localhost:5173',
    })).toThrow(/NODE_ENV=production/);

    expect(() => assertLocalOnlyTarget({
      nodeEnv: 'test',
      dbHost: 'db.example.com',
      dbName: 'panama_test',
      dbSsl: false,
      allowedOrigin: 'http://localhost:5173',
    })).toThrow(/non-local DB host/);

    expect(() => assertLocalOnlyTarget({
      nodeEnv: 'test',
      dbHost: 'localhost',
      dbName: 'panama_production',
      dbSsl: false,
      allowedOrigin: 'http://localhost:5173',
    })).toThrow(/Use a local dev\/test database/);
  });

  it('allows local dev and test databases only', () => {
    expect(() => assertLocalOnlyTarget({
      nodeEnv: 'test',
      dbHost: '127.0.0.1',
      dbName: 'panama_test',
      dbSsl: false,
      databaseUrl: 'postgres://panama:test_password@localhost:5432/panama_test',
      allowedOrigin: 'http://localhost:5173',
    })).not.toThrow();
  });

  it('clamps numeric options to realistic local harness bounds', () => {
    expect(parseIntegerOption('5', 12, { min: 10, max: 20 })).toBe(10);
    expect(parseIntegerOption('25', 12, { min: 10, max: 20 })).toBe(20);
    expect(parseIntegerOption('bad', 12, { min: 10, max: 20 })).toBe(12);
  });

  it('builds a realistic home config with mandatory training and staffing thresholds', () => {
    const config = buildHomeConfig(2, 48);

    expect(config.registered_beds).toBeGreaterThanOrEqual(32);
    expect(config.staff_count_target).toBe(48);
    expect(config.minimum_staffing.early.heads).toBeGreaterThan(0);
    expect(config.training_types.map(type => type.id)).toEqual(expect.arrayContaining([
      'safeguarding',
      'medicines',
      'moving_handling',
      'fire_safety',
      'infection_control',
    ]));
  });

  it('summarizes timing samples without mutating input order', () => {
    const samples = [400, 100, 300, 200];

    expect(summarizeTimings(samples)).toEqual({
      count: 4,
      minMs: 100,
      p50Ms: 200,
      p95Ms: 400,
      maxMs: 400,
      avgMs: 250,
    });
    expect(samples).toEqual([400, 100, 300, 200]);
  });
});
