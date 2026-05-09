import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { withTransaction } from '../../db.js';
import * as supplierRepo from '../../repositories/supplierRepo.js';

let createSupplier;
let mergeSuppliers;
let normalizeAliases;
let normalizeSupplierName;
let normalizeVatNumber;
let updateSupplier;

beforeAll(async () => {
  const service = await import('../../services/supplierService.js');
  createSupplier = service.createSupplier;
  mergeSuppliers = service.mergeSuppliers;
  normalizeAliases = service.normalizeAliases;
  normalizeSupplierName = service.normalizeSupplierName;
  normalizeVatNumber = service.normalizeVatNumber;
  updateSupplier = service.updateSupplier;
});

beforeEach(() => {
  vi.clearAllMocks();
  withTransaction.mockImplementation(async (fn) => fn({ tx: true }));
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

describe('supplierService conflict handling', () => {
  it('checks create aliases against existing supplier names and aliases', async () => {
    supplierRepo.findByNormalizedNameOrAlias
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 12, name: 'Existing Supplies' });

    await expect(createSupplier(1, {
      name: 'New Supplier',
      aliases: ['Existing Supplies'],
    }, 'admin')).rejects.toMatchObject({ statusCode: 409 });

    expect(supplierRepo.create).not.toHaveBeenCalled();
  });

  it('checks updated aliases against other suppliers', async () => {
    supplierRepo.findById.mockResolvedValue({ id: 7, name: 'Current Supplier' });
    supplierRepo.findByNormalizedNameOrAlias.mockResolvedValue({ id: 9, name: 'Other Supplier' });

    await expect(updateSupplier(7, 1, { aliases: ['Other Supplier'] }, 1))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(supplierRepo.update).not.toHaveBeenCalled();
  });
});

describe('supplierService mergeSuppliers', () => {
  it('deactivates the source before copying a source VAT number to the target', async () => {
    supplierRepo.findById
      .mockResolvedValueOnce({
        id: 10,
        name: 'Source Ltd',
        aliases: ['Source Trading'],
        default_category: 'maintenance',
        vat_number: 'GB111',
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 11,
        name: 'Target Ltd',
        aliases: [],
        default_category: null,
        vat_number: null,
        version: 4,
      });
    supplierRepo.update.mockResolvedValue({ id: 11, name: 'Target Ltd', vat_number: 'GB111' });

    await mergeSuppliers(1, 10, 11, 'admin');

    const softDeleteOrder = supplierRepo.softDelete.mock.invocationCallOrder[0];
    const updateOrder = supplierRepo.update.mock.invocationCallOrder[0];
    expect(softDeleteOrder).toBeLessThan(updateOrder);
    expect(supplierRepo.update).toHaveBeenCalledWith(11, 1, expect.objectContaining({
      vat_number: 'GB111',
      aliases: ['Source Ltd', 'Source Trading'],
    }), { tx: true }, 4);
  });
});
