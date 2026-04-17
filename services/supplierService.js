import { withTransaction } from '../db.js';
import * as supplierRepo from '../repositories/supplierRepo.js';

export function normalizeSupplierName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeVatNumber(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return normalized || null;
}

export function normalizeAliases(aliases = []) {
  const seen = new Set();
  const result = [];
  for (const alias of aliases) {
    const trimmed = String(alias || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

export async function listSuppliers(homeId, filters) {
  return supplierRepo.listByHome(homeId, filters);
}

export async function createSupplier(homeId, data, createdBy) {
  const normalizedName = normalizeSupplierName(data.name);
  if (!normalizedName) {
    throw Object.assign(new Error('Supplier name is required'), { statusCode: 400 });
  }
  const existing = await supplierRepo.findByNormalizedNameOrAlias(homeId, normalizedName);
  if (existing) {
    throw Object.assign(new Error('A supplier with that name or alias already exists'), { statusCode: 409 });
  }
  return supplierRepo.create(homeId, {
    name: String(data.name).trim().replace(/\s+/g, ' '),
    vat_number: normalizeVatNumber(data.vat_number),
    default_category: data.default_category || null,
    aliases: normalizeAliases(data.aliases),
    active: data.active ?? true,
    created_by: createdBy,
  });
}

export async function updateSupplier(id, homeId, data, version) {
  const payload = { ...data };
  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const normalizedName = normalizeSupplierName(payload.name);
    if (!normalizedName) {
      throw Object.assign(new Error('Supplier name is required'), { statusCode: 400 });
    }
    const existing = await supplierRepo.findByNormalizedNameOrAlias(homeId, normalizedName);
    if (existing && existing.id !== id) {
      throw Object.assign(new Error('A supplier with that name or alias already exists'), { statusCode: 409 });
    }
    payload.name = String(payload.name).trim().replace(/\s+/g, ' ');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'vat_number')) {
    payload.vat_number = normalizeVatNumber(payload.vat_number);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'aliases')) {
    payload.aliases = normalizeAliases(payload.aliases);
  }
  return supplierRepo.update(id, homeId, payload, null, version);
}

export async function resolveSupplier(homeId, { supplierId, supplierName, defaultCategory, createdBy }, client) {
  if (supplierId != null) {
    const supplier = await supplierRepo.findById(supplierId, homeId, client);
    if (!supplier) {
      throw Object.assign(new Error('Supplier not found'), { statusCode: 404 });
    }
    return supplier;
  }
  const normalizedName = normalizeSupplierName(supplierName);
  if (!normalizedName) return null;
  const existing = await supplierRepo.findByNormalizedNameOrAlias(homeId, normalizedName, client);
  if (existing) return existing;
  return supplierRepo.create(homeId, {
    name: String(supplierName).trim().replace(/\s+/g, ' '),
    default_category: defaultCategory || null,
    aliases: [],
    active: true,
    created_by: createdBy || null,
  }, client);
}

export async function mergeSuppliers(homeId, sourceId, targetId, username) {
  if (sourceId === targetId) {
    throw Object.assign(new Error('Source and target supplier must be different'), { statusCode: 400 });
  }
  return withTransaction(async (client) => {
    const source = await supplierRepo.findById(sourceId, homeId, client, { forUpdate: true });
    const target = await supplierRepo.findById(targetId, homeId, client, { forUpdate: true });
    if (!source || !target) {
      throw Object.assign(new Error('Supplier not found'), { statusCode: 404 });
    }
    const mergedAliases = normalizeAliases([
      ...target.aliases,
      source.name,
      ...source.aliases,
    ]);
    await supplierRepo.repointFinanceRows(homeId, sourceId, targetId, client);
    const updatedTarget = await supplierRepo.update(targetId, homeId, {
      aliases: mergedAliases,
      default_category: target.default_category || source.default_category || null,
      vat_number: target.vat_number || source.vat_number || null,
    }, client, target.version);
    await supplierRepo.softDelete(sourceId, homeId, client);
    return {
      target: updatedTarget,
      sourceId,
      mergedBy: username,
    };
  });
}
