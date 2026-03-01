/**
 * Integration tests for Homes module.
 *
 * Validates: upsert, findById, findBySlug, listAll, listAllWithIds,
 * updateConfig, slug-based upsert on conflict.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as homeRepo from '../../repositories/homeRepo.js';

const slugs = ['home-test-alpha', 'home-test-beta'];
const homeIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM homes WHERE slug IN ('home-test-alpha', 'home-test-beta')`);
});

afterAll(async () => {
  for (const slug of slugs) {
    await pool.query('DELETE FROM homes WHERE slug = $1', [slug]).catch(() => {});
  }
});

// ── Upsert & Read ───────────────────────────────────────────────────────────

describe('Homes: upsert and read', () => {
  it('creates a home via upsert', async () => {
    const result = await homeRepo.upsert('home-test-alpha', 'Alpha Care Home', {
      home_name: 'Alpha Care Home',
      registered_beds: 40,
      care_type: 'residential',
    });

    expect(result).not.toBeNull();
    expect(result.id).toBeTruthy();
    homeIds.push(result.id);
    expect(result.slug).toBe('home-test-alpha');
    expect(result.config.home_name).toBe('Alpha Care Home');
    expect(result.config.registered_beds).toBe(40);
  });

  it('creates a second home', async () => {
    const result = await homeRepo.upsert('home-test-beta', 'Beta Nursing Home', {
      home_name: 'Beta Nursing Home',
      registered_beds: 60,
      care_type: 'nursing',
    });

    expect(result).not.toBeNull();
    homeIds.push(result.id);
  });

  it('finds by id', async () => {
    const found = await homeRepo.findById(homeIds[0]);
    expect(found).not.toBeNull();
    expect(found.slug).toBe('home-test-alpha');
  });

  it('finds by slug', async () => {
    const found = await homeRepo.findBySlug('home-test-beta');
    expect(found).not.toBeNull();
    expect(found.config.care_type).toBe('nursing');
  });

  it('returns null for non-existent slug', async () => {
    const found = await homeRepo.findBySlug('home-test-nonexistent');
    expect(found).toBeNull();
  });
});

// ── List ─────────────────────────────────────────────────────────────────────

describe('Homes: list', () => {
  it('listAll includes test homes with config metadata', async () => {
    const list = await homeRepo.listAll();
    const alpha = list.find(h => h.id === 'home-test-alpha');
    expect(alpha).toBeDefined();
    expect(alpha.name).toBe('Alpha Care Home');
    expect(alpha.beds).toBe(40);
    expect(alpha.type).toBe('residential');
  });

  it('listAllWithIds returns integer ids', async () => {
    const list = await homeRepo.listAllWithIds();
    const beta = list.find(h => h.slug === 'home-test-beta');
    expect(beta).toBeDefined();
    expect(typeof beta.id).toBe('number');
    expect(beta.name).toBe('Beta Nursing Home');
  });
});

// ── Config Update ────────────────────────────────────────────────────────────

describe('Homes: config update', () => {
  it('updates config JSONB', async () => {
    await homeRepo.updateConfig(homeIds[0], {
      home_name: 'Alpha Care Home (Updated)',
      registered_beds: 45,
      care_type: 'residential',
    });

    const found = await homeRepo.findById(homeIds[0]);
    expect(found.config.home_name).toBe('Alpha Care Home (Updated)');
    expect(found.config.registered_beds).toBe(45);
  });

  it('upsert on conflict updates existing home', async () => {
    const result = await homeRepo.upsert('home-test-alpha', 'Alpha Care Home', {
      home_name: 'Alpha Conflict Update',
      registered_beds: 50,
      care_type: 'residential',
    });

    expect(result.config.home_name).toBe('Alpha Conflict Update');
    expect(result.config.registered_beds).toBe(50);
  });
});
