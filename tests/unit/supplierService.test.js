import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  withTransaction: vi.fn(),
}));

vi.mock('../../repositories/supplierRepo.js', () => ({
  listByHome: vi.fn(),
  findById: vi.fn(),
  findByNormalizedNameOrAlias: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  repointFinanceRows: vi.fn(),
}));

let normalizeAliases;
let normalizeSupplierName;
let normalizeVatNumber;

beforeAll(async () => {
  const service = await import('../../services/supplierService.js');
  normalizeAliases = service.normalizeAliases;
  normalizeSupplierName = service.normalizeSupplierName;
  normalizeVatNumber = service.normalizeVatNumber;
});

describe('supplierService normalization helpers', () => {
  it('normalizes supplier names for matching', () => {
    expect(normalizeSupplierName('  ACME   Care   Ltd  ')).toBe('acme care ltd');
  });

  it('normalizes VAT numbers by removing spaces and uppercasing', () => {
    expect(normalizeVatNumber(' gb 123 4567 89 ')).toBe('GB123456789');
    expect(normalizeVatNumber('')).toBeNull();
  });

  it('deduplicates aliases case-insensitively while keeping readable values', () => {
    expect(normalizeAliases([' Acme ', 'acme', 'ACME Care', '', ' Acme   Care '])).toEqual([
      'Acme',
      'ACME Care',
    ]);
  });
});
