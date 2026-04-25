import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  withTransaction: vi.fn(async (fn) => fn({ tx: true })),
}));

vi.mock('../../config.js', () => ({
  config: {
    upload: {
      dir: 'C:/uploads',
    },
  },
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../repositories/documentIntakeRepo.js', () => ({
  findBySha: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../repositories/recordAttachments.js', () => ({
  parentExists: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../../repositories/maintenanceRepo.js', () => ({
  findById: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../../repositories/financeRepo.js', () => ({
  findExpenseById: vi.fn(),
  findPaymentScheduleById: vi.fn(),
  createExpense: vi.fn(),
}));

vi.mock('../../repositories/staffRepo.js', () => ({
  findById: vi.fn(),
}));

vi.mock('../../repositories/cqcEvidenceRepo.js', () => ({
  findById: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../../repositories/cqcEvidenceFileRepo.js', () => ({
  create: vi.fn(),
}));

vi.mock('../../repositories/onboardingAttachments.js', () => ({
  create: vi.fn(),
}));

vi.mock('../../repositories/hrRepo.js', () => ({
  createAttachment: vi.fn(),
}));

vi.mock('../../repositories/trainingAttachments.js', () => ({
  create: vi.fn(),
}));

vi.mock('../../repositories/handoverRepo.js', () => ({
  createEntry: vi.fn(),
}));

vi.mock('../../services/supplierService.js', () => ({
  resolveSupplier: vi.fn(),
}));

vi.mock('../../services/ocrService.js', () => ({
  extractDocument: vi.fn(),
}));

import * as documentIntakeRepo from '../../repositories/documentIntakeRepo.js';
import * as recordAttachmentsRepo from '../../repositories/recordAttachments.js';
import * as maintenanceRepo from '../../repositories/maintenanceRepo.js';
import * as ocrService from '../../services/ocrService.js';
import { createScanIntake, confirmScanIntake } from '../../services/scanIntakeService.js';
import { readFile } from 'fs/promises';

describe('scanIntakeService maintenance and record filing', () => {
  const intakeItem = {
    id: 7,
    status: 'ready_for_review',
    stored_name: 'scan.pdf',
    original_name: 'scan.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1234,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockResolvedValue(Buffer.from('scan-bytes'));
    documentIntakeRepo.findBySha.mockResolvedValue(null);
    documentIntakeRepo.findById.mockResolvedValue(intakeItem);
    documentIntakeRepo.update.mockResolvedValue({ id: 7, status: 'confirmed' });
    recordAttachmentsRepo.parentExists.mockResolvedValue(true);
    recordAttachmentsRepo.create.mockResolvedValue({ id: 55 });
  });

  it('checks for duplicate scans before calling OCR extraction', async () => {
    documentIntakeRepo.findBySha.mockResolvedValue({ id: 99, source_file_sha256: 'dup' });

    await expect(createScanIntake(12, {
      file: {
        path: 'C:/uploads/dup.pdf',
        originalname: 'dup.pdf',
        mimetype: 'application/pdf',
        filename: 'dup.pdf',
        size: 42,
      },
      createdBy: 'alice',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(documentIntakeRepo.findBySha).toHaveBeenCalledOnce();
    expect(ocrService.extractDocument).not.toHaveBeenCalled();
    expect(documentIntakeRepo.create).not.toHaveBeenCalled();
  });

  it('creates a maintenance check from scan intake before attaching the file', async () => {
    maintenanceRepo.upsert.mockResolvedValue({ id: 'mnt-new-1' });

    const result = await confirmScanIntake(12, 7, {
      target: 'maintenance',
      maintenance: {
        target_type: 'create_check',
        create_check: {
          category: 'pat',
          description: 'Annual PAT certificate',
          frequency: 'annual',
        },
        description: 'PAT certificate scan',
      },
    }, 'alice');

    expect(maintenanceRepo.upsert).toHaveBeenCalledWith(12, {
      category: 'pat',
      description: 'Annual PAT certificate',
      frequency: 'annual',
    }, { tx: true });
    expect(recordAttachmentsRepo.create).toHaveBeenCalledWith(12, 'maintenance', 'mnt-new-1', expect.objectContaining({
      original_name: 'scan.pdf',
      description: 'PAT certificate scan',
      uploaded_by: 'alice',
    }), { tx: true });
    expect(documentIntakeRepo.update).toHaveBeenCalledWith(7, 12, expect.objectContaining({
      routed_module: 'maintenance',
      routed_record_id: 'mnt-new-1',
      routed_attachment_id: '55',
    }), { tx: true });
    expect(result.created_check).toEqual({ id: 'mnt-new-1' });
  });

  it('files contextual record-attachment scans into the requested module and record', async () => {
    const result = await confirmScanIntake(12, 7, {
      target: 'record_attachment',
      record_attachment: {
        module: 'maintenance',
        record_id: 'mnt-existing-2',
        description: 'Existing certificate',
      },
    }, 'alice');

    expect(recordAttachmentsRepo.parentExists).toHaveBeenCalledWith(12, 'maintenance', 'mnt-existing-2', { tx: true });
    expect(recordAttachmentsRepo.create).toHaveBeenCalledWith(12, 'maintenance', 'mnt-existing-2', expect.objectContaining({
      original_name: 'scan.pdf',
      description: 'Existing certificate',
      uploaded_by: 'alice',
    }), { tx: true });
    expect(documentIntakeRepo.update).toHaveBeenCalledWith(7, 12, expect.objectContaining({
      routed_module: 'maintenance',
      routed_record_id: 'mnt-existing-2',
      routed_attachment_id: '55',
    }), { tx: true });
    expect(result.routed_module).toBe('maintenance');
    expect(result.routed_record_id).toBe('mnt-existing-2');
  });

  it('rejects contextual record-attachment scans when the parent record is missing', async () => {
    recordAttachmentsRepo.parentExists.mockResolvedValue(false);

    await expect(confirmScanIntake(12, 7, {
      target: 'record_attachment',
      record_attachment: {
        module: 'maintenance',
        record_id: 'missing-record',
        description: 'Missing certificate',
      },
    }, 'alice')).rejects.toMatchObject({ statusCode: 404 });

    expect(recordAttachmentsRepo.create).not.toHaveBeenCalled();
  });
});
