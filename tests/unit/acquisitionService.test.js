import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  withTransaction: vi.fn(async fn => fn({ tx: true })),
}));

vi.mock('../../repositories/acquisitionRepo.js', () => ({
  ACQUISITION_ITEM_DEFINITIONS: [
    { item_key: 'staff_import', title: 'Staff import', description: 'Staff ready' },
    { item_key: 'resident_import', title: 'Resident import', description: 'Residents ready' },
    { item_key: 'training_import', title: 'Training import', description: 'Training ready' },
    { item_key: 'rota_baseline', title: 'Rota baseline', description: 'Rota ready' },
    { item_key: 'documents', title: 'Documents', description: 'Documents ready' },
    { item_key: 'users', title: 'Users', description: 'Users ready' },
    { item_key: 'audit_templates', title: 'Audit templates', description: 'Audits ready' },
    { item_key: 'go_live_signoff', title: 'Go-live signoff', description: 'Signoff ready' },
  ],
  ACQUISITION_ITEM_KEYS: [
    'staff_import',
    'resident_import',
    'training_import',
    'rota_baseline',
    'documents',
    'users',
    'audit_templates',
    'go_live_signoff',
  ],
  ACQUISITION_STATUSES: ['not_started', 'in_progress', 'blocked', 'ready', 'complete'],
  ensureDefaultItems: vi.fn(),
  findByHome: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  log: vi.fn(),
}));

import * as acquisitionRepo from '../../repositories/acquisitionRepo.js';
import * as auditService from '../../services/auditService.js';
import {
  createChecklistItem,
  deleteChecklistItem,
  initializeChecklist,
  summarizeChecklist,
  updateChecklistItem,
} from '../../services/acquisitionService.js';

const home = { id: 1, slug: 'home-a' };
const actor = { id: 10, username: 'alice' };

describe('acquisitionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes missing default checklist items and audits the mutation', async () => {
    acquisitionRepo.ensureDefaultItems.mockResolvedValue([{ id: 11, item_key: 'staff_import' }]);
    acquisitionRepo.findByHome.mockResolvedValue([{ id: 11, item_key: 'staff_import', status: 'not_started', issue_count: 0 }]);

    const result = await initializeChecklist(home, actor);

    expect(acquisitionRepo.ensureDefaultItems).toHaveBeenCalledWith(1, 10, { tx: true });
    expect(auditService.log).toHaveBeenCalledWith(
      'acquisition_onboarding_initialize',
      'home-a',
      'alice',
      { insertedKeys: ['staff_import'], total: 1 },
      { tx: true }
    );
    expect(result.items).toHaveLength(1);
  });

  it('creates an item with default title/description and writes audit inside the transaction', async () => {
    const created = {
      id: 21,
      home_id: 1,
      item_key: 'staff_import',
      title: 'Staff import',
      description: 'Staff ready',
      status: 'not_started',
    };
    acquisitionRepo.create.mockResolvedValue(created);

    const result = await createChecklistItem(home, { item_key: 'staff_import' }, actor);

    expect(acquisitionRepo.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        item_key: 'staff_import',
        title: 'Staff import',
        description: 'Staff ready',
      }),
      10,
      { tx: true }
    );
    expect(auditService.log).toHaveBeenCalledWith(
      'acquisition_onboarding_create',
      'home-a',
      'alice',
      { id: 21, item_key: 'staff_import', status: 'not_started' },
      { tx: true }
    );
    expect(result).toEqual(created);
  });

  it('turns a version miss into a conflict without writing audit', async () => {
    acquisitionRepo.findById.mockResolvedValue({ id: 31, item_key: 'documents', status: 'in_progress', version: 2 });
    acquisitionRepo.update.mockResolvedValue(null);

    await expect(updateChecklistItem(home, 31, { status: 'ready' }, 1, actor))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });

    expect(acquisitionRepo.update).toHaveBeenCalledWith(31, 1, { status: 'ready' }, 1, 10, { tx: true });
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('requires versions before updating or deleting checklist items', async () => {
    await expect(updateChecklistItem(home, 31, { status: 'ready' }, undefined, actor))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteChecklistItem(home, 41, undefined, actor))
      .rejects.toMatchObject({ statusCode: 400 });

    expect(acquisitionRepo.findById).not.toHaveBeenCalled();
    expect(acquisitionRepo.update).not.toHaveBeenCalled();
    expect(acquisitionRepo.softDelete).not.toHaveBeenCalled();
  });

  it('soft deletes an item through the home-scoped repository and audits it', async () => {
    const existing = { id: 41, item_key: 'users', status: 'ready', version: 3 };
    acquisitionRepo.findById.mockResolvedValue(existing);
    acquisitionRepo.softDelete.mockResolvedValue({ ...existing, deleted_at: '2026-05-04T10:00:00.000Z' });

    await deleteChecklistItem(home, 41, 3, actor);

    expect(acquisitionRepo.softDelete).toHaveBeenCalledWith(41, 1, 10, 3, { tx: true });
    expect(auditService.log).toHaveBeenCalledWith(
      'acquisition_onboarding_delete',
      'home-a',
      'alice',
      { id: 41, item_key: 'users', status: 'ready' },
      { tx: true }
    );
  });

  it('summarizes go-live readiness only when required items are ready and signed off', () => {
    const items = acquisitionRepo.ACQUISITION_ITEM_KEYS.map(item_key => ({
      item_key,
      status: item_key === 'go_live_signoff' ? 'complete' : 'ready',
      issue_count: 0,
    }));

    expect(summarizeChecklist(items)).toMatchObject({
      total: 8,
      ready: 8,
      go_live_signed_off: true,
      can_go_live: true,
    });

    const blocked = items.map(item => item.item_key === 'documents' ? { ...item, status: 'blocked' } : item);
    expect(summarizeChecklist(blocked).can_go_live).toBe(false);
  });
});
