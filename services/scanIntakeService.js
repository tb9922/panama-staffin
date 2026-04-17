import crypto, { randomUUID } from 'crypto';
import path from 'path';
import { mkdirSync } from 'fs';
import { readFile, rename } from 'fs/promises';
import { withTransaction } from '../db.js';
import { config } from '../config.js';
import * as documentIntakeRepo from '../repositories/documentIntakeRepo.js';
import * as recordAttachmentsRepo from '../repositories/recordAttachments.js';
import * as onboardingAttachmentsRepo from '../repositories/onboardingAttachments.js';
import * as cqcEvidenceFileRepo from '../repositories/cqcEvidenceFileRepo.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
import * as financeRepo from '../repositories/financeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as hrRepo from '../repositories/hrRepo.js';
import * as trainingAttachmentsRepo from '../repositories/trainingAttachments.js';
import * as handoverRepo from '../repositories/handoverRepo.js';
import * as supplierService from './supplierService.js';
import { extractDocument } from './ocrService.js';
import { encrypt, decrypt } from './encryptionService.js';

function extnameSafe(name) {
  return path.extname(name || '').replace(/[^a-zA-Z0-9.]/g, '');
}

function buildIntakePath(homeId, storedName) {
  return path.join(config.upload.dir, String(homeId), 'scan_intake', storedName);
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function prepareEncryptedExtraction(extraction) {
  const payload = JSON.stringify(extraction || {});
  const result = encrypt(payload);
  return {
    ocr_extraction_encrypted: result.encrypted,
    ocr_extraction_iv: result.iv,
    ocr_extraction_tag: result.tag,
  };
}

function summaryFieldsFromExtraction(extraction) {
  return {
    rawText: extraction.rawText || '',
    fields: extraction.fields || {},
    confidences: extraction.confidences || {},
    classification: extraction.classification || {},
    metadata: extraction.metadata || {},
  };
}

export async function createScanIntake(homeId, { file, createdBy }) {
  const fileBuffer = await readFile(file.path);
  const fileSha = sha256(fileBuffer);
  const duplicate = await documentIntakeRepo.findBySha(homeId, fileSha);
  if (duplicate) {
    throw Object.assign(new Error('This document has already been scanned for this home'), {
      statusCode: 409,
      existing: duplicate,
    });
  }

  const extraction = await extractDocument(file.path, {
    originalName: file.originalname,
    mimeType: file.mimetype,
  });
  const encrypted = prepareEncryptedExtraction(extraction);
  return documentIntakeRepo.create(homeId, {
    status: 'ready_for_review',
    source_file_sha256: fileSha,
    stored_name: file.filename,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    ocr_engine: 'paddleocr',
    classification_target: extraction.classification?.target || null,
    classification_confidence: extraction.classification?.confidence || null,
    ...encrypted,
    summary_fields: summaryFieldsFromExtraction(extraction),
    created_by: createdBy,
  });
}

export function decryptExtraction(intakeItem) {
  if (!intakeItem?.ocr_extraction_encrypted || !intakeItem?.ocr_extraction_iv || !intakeItem?.ocr_extraction_tag) {
    return null;
  }
  try {
    return JSON.parse(
      decrypt(
        intakeItem.ocr_extraction_encrypted,
        intakeItem.ocr_extraction_iv,
        intakeItem.ocr_extraction_tag
      )
    );
  } catch {
    return null;
  }
}

function moveIntoRecordAttachmentStore({ homeId, intakeItem, moduleId, recordId }) {
  const ext = extnameSafe(intakeItem.original_name);
  const storedName = `${randomUUID()}${ext}`;
  const destinationDir = path.join(config.upload.dir, String(homeId), moduleId, String(recordId));
  ensureDir(destinationDir);
  const sourcePath = buildIntakePath(homeId, intakeItem.stored_name);
  const destinationPath = path.join(destinationDir, storedName);
  return rename(sourcePath, destinationPath).then(() => ({ stored_name: storedName }));
}

function moveIntoOnboardingStore({ homeId, intakeItem, staffId, section }) {
  const ext = extnameSafe(intakeItem.original_name);
  const storedName = `${randomUUID()}${ext}`;
  const destinationDir = path.join(config.upload.dir, String(homeId), 'onboarding', String(staffId), String(section));
  ensureDir(destinationDir);
  const sourcePath = buildIntakePath(homeId, intakeItem.stored_name);
  const destinationPath = path.join(destinationDir, storedName);
  return rename(sourcePath, destinationPath).then(() => ({ stored_name: storedName }));
}

function moveIntoCqcStore({ homeId, intakeItem, evidenceId }) {
  const ext = extnameSafe(intakeItem.original_name);
  const storedName = `${randomUUID()}${ext}`;
  const destinationDir = path.join(config.upload.dir, String(homeId), 'cqc_evidence', String(evidenceId));
  ensureDir(destinationDir);
  const sourcePath = buildIntakePath(homeId, intakeItem.stored_name);
  const destinationPath = path.join(destinationDir, storedName);
  return rename(sourcePath, destinationPath).then(() => ({ stored_name: storedName }));
}

function moveIntoHrStore({ homeId, intakeItem, caseType, caseId }) {
  const ext = extnameSafe(intakeItem.original_name);
  const storedName = `${randomUUID()}${ext}`;
  const destinationDir = path.join(config.upload.dir, String(homeId), String(caseType), String(caseId));
  ensureDir(destinationDir);
  const sourcePath = buildIntakePath(homeId, intakeItem.stored_name);
  const destinationPath = path.join(destinationDir, storedName);
  return rename(sourcePath, destinationPath).then(() => ({ stored_name: storedName }));
}

function moveIntoTrainingStore({ homeId, intakeItem, staffId, typeId }) {
  const ext = extnameSafe(intakeItem.original_name);
  const storedName = `${randomUUID()}${ext}`;
  const destinationDir = path.join(config.upload.dir, String(homeId), 'training', String(staffId), String(typeId));
  ensureDir(destinationDir);
  const sourcePath = buildIntakePath(homeId, intakeItem.stored_name);
  const destinationPath = path.join(destinationDir, storedName);
  return rename(sourcePath, destinationPath).then(() => ({ stored_name: storedName }));
}

async function confirmMaintenance(client, homeId, intakeItem, body, username) {
  let check = null;
  if (body.target_type === 'create_check') {
    check = await maintenanceRepo.upsert(homeId, body.create_check || {}, client);
  } else {
    check = await maintenanceRepo.findById(body.record_id, homeId, client);
  }
  if (!check) throw Object.assign(new Error('Maintenance check not found'), { statusCode: 404 });
  const moved = await moveIntoRecordAttachmentStore({ homeId, intakeItem, moduleId: 'maintenance', recordId: check.id });
  const attachment = await recordAttachmentsRepo.create(homeId, 'maintenance', String(check.id), {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  const result = {
    routed_module: 'maintenance',
    routed_record_id: String(check.id),
    routed_attachment_id: String(attachment.id),
    attachment,
  };
  if (body.target_type === 'create_check') result.created_check = check;
  return result;
}

async function confirmFinance(client, homeId, intakeItem, body, username) {
  if (body.target_type === 'expense') {
    const expense = await financeRepo.findExpenseById(body.record_id, homeId, client);
    if (!expense) throw Object.assign(new Error('Expense not found'), { statusCode: 404 });
    const moved = await moveIntoRecordAttachmentStore({ homeId, intakeItem, moduleId: 'finance_expense', recordId: body.record_id });
    const attachment = await recordAttachmentsRepo.create(homeId, 'finance_expense', String(body.record_id), {
      original_name: intakeItem.original_name,
      stored_name: moved.stored_name,
      mime_type: intakeItem.mime_type,
      size_bytes: intakeItem.size_bytes,
      description: body.description || null,
      uploaded_by: username,
    }, client);
    return {
      routed_module: 'finance_expense',
      routed_record_id: String(body.record_id),
      routed_attachment_id: String(attachment.id),
      attachment,
    };
  }

  if (body.target_type === 'payment_schedule') {
    const schedule = await financeRepo.findPaymentScheduleById(body.record_id, homeId, client);
    if (!schedule) throw Object.assign(new Error('Payment schedule not found'), { statusCode: 404 });
    const moved = await moveIntoRecordAttachmentStore({ homeId, intakeItem, moduleId: 'finance_payment_schedule', recordId: body.record_id });
    const attachment = await recordAttachmentsRepo.create(homeId, 'finance_payment_schedule', String(body.record_id), {
      original_name: intakeItem.original_name,
      stored_name: moved.stored_name,
      mime_type: intakeItem.mime_type,
      size_bytes: intakeItem.size_bytes,
      description: body.description || null,
      uploaded_by: username,
    }, client);
    return {
      routed_module: 'finance_payment_schedule',
      routed_record_id: String(body.record_id),
      routed_attachment_id: String(attachment.id),
      attachment,
    };
  }

  const supplier = await supplierService.resolveSupplier(homeId, {
    supplierId: body.expense?.supplier_id || null,
    supplierName: body.expense?.supplier || null,
    defaultCategory: body.expense?.category || null,
    createdBy: username,
  }, client);

  const expense = await financeRepo.createExpense(homeId, {
    expense_date: body.expense?.expense_date,
    category: body.expense?.category,
    subcategory: body.expense?.subcategory || null,
    description: body.expense?.description,
    supplier: supplier?.name || body.expense?.supplier || null,
    supplier_id: supplier?.id || null,
    invoice_ref: body.expense?.invoice_ref || null,
    net_amount: body.expense?.net_amount,
    vat_amount: body.expense?.vat_amount ?? 0,
    gross_amount: body.expense?.gross_amount,
    status: 'pending',
    notes: body.expense?.notes || null,
    created_by: username,
  }, client);
  const moved = await moveIntoRecordAttachmentStore({ homeId, intakeItem, moduleId: 'finance_expense', recordId: expense.id });
  const attachment = await recordAttachmentsRepo.create(homeId, 'finance_expense', String(expense.id), {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: 'finance_expense',
    routed_record_id: String(expense.id),
    routed_attachment_id: String(attachment.id),
    attachment,
    created_expense: expense,
  };
}

async function confirmOnboarding(client, homeId, intakeItem, body, username) {
  const staff = await staffRepo.findById(homeId, body.staff_id);
  if (!staff) throw Object.assign(new Error('Staff member not found'), { statusCode: 404 });
  const moved = await moveIntoOnboardingStore({ homeId, intakeItem, staffId: body.staff_id, section: body.section });
  const attachment = await onboardingAttachmentsRepo.create(homeId, body.staff_id, body.section, {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: 'onboarding',
    routed_record_id: `${body.staff_id}:${body.section}`,
    routed_attachment_id: String(attachment.id),
    attachment,
  };
}

async function confirmCqc(client, homeId, intakeItem, body, username) {
  let evidenceId = body.evidence_id;
  if (!evidenceId) {
    const created = await cqcEvidenceRepo.upsert(homeId, {
      quality_statement: body.create_evidence.quality_statement,
      type: body.create_evidence.type,
      title: body.create_evidence.title,
      description: body.create_evidence.description || null,
      date_from: body.create_evidence.date_from || null,
      date_to: body.create_evidence.date_to || null,
      evidence_category: body.create_evidence.evidence_category || null,
      evidence_owner: body.create_evidence.evidence_owner || null,
      review_due: body.create_evidence.review_due || null,
      added_by: username,
    });
    evidenceId = created.id;
  } else {
    const existing = await cqcEvidenceRepo.findById(evidenceId, homeId);
    if (!existing) throw Object.assign(new Error('CQC evidence item not found'), { statusCode: 404 });
  }
  const moved = await moveIntoCqcStore({ homeId, intakeItem, evidenceId });
  const attachment = await cqcEvidenceFileRepo.create(homeId, evidenceId, {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: 'cqc',
    routed_record_id: String(evidenceId),
    routed_attachment_id: String(attachment.id),
    attachment,
  };
}

async function confirmRecordAttachment(client, homeId, intakeItem, body, username) {
  const moved = await moveIntoRecordAttachmentStore({
    homeId,
    intakeItem,
    moduleId: body.module,
    recordId: body.record_id,
  });
  const attachment = await recordAttachmentsRepo.create(homeId, body.module, String(body.record_id), {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: body.module,
    routed_record_id: String(body.record_id),
    routed_attachment_id: String(attachment.id),
    attachment,
  };
}

async function confirmHrAttachment(client, homeId, intakeItem, body, username) {
  const moved = await moveIntoHrStore({
    homeId,
    intakeItem,
    caseType: body.case_type,
    caseId: body.case_id,
  });
  const attachment = await hrRepo.createAttachment(homeId, body.case_type, body.case_id, {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: 'hr_attachment',
    routed_record_id: `${body.case_type}:${body.case_id}`,
    routed_attachment_id: String(attachment.id),
    attachment,
  };
}

async function confirmTraining(client, homeId, intakeItem, body, username) {
  const moved = await moveIntoTrainingStore({
    homeId,
    intakeItem,
    staffId: body.staff_id,
    typeId: body.type_id,
  });
  const attachment = await trainingAttachmentsRepo.create(homeId, body.staff_id, body.type_id, {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: 'training',
    routed_record_id: `${body.staff_id}:${body.type_id}`,
    routed_attachment_id: String(attachment.id),
    attachment,
  };
}

async function confirmHandover(client, homeId, intakeItem, body, username) {
  const entry = await handoverRepo.createEntry(homeId, {
    entry_date: body.entry_date,
    shift: body.shift,
    category: body.category,
    priority: body.priority,
    content: body.content,
    incident_id: body.incident_id || null,
  }, username, client);
  const moved = await moveIntoRecordAttachmentStore({
    homeId,
    intakeItem,
    moduleId: 'handover_entry',
    recordId: entry.id,
  });
  const attachment = await recordAttachmentsRepo.create(homeId, 'handover_entry', String(entry.id), {
    original_name: intakeItem.original_name,
    stored_name: moved.stored_name,
    mime_type: intakeItem.mime_type,
    size_bytes: intakeItem.size_bytes,
    description: body.description || null,
    uploaded_by: username,
  }, client);
  return {
    routed_module: 'handover_entry',
    routed_record_id: String(entry.id),
    routed_attachment_id: String(attachment.id),
    attachment,
    created_entry: entry,
  };
}

export async function confirmScanIntake(homeId, intakeId, body, username) {
  return withTransaction(async (client) => {
    const intakeItem = await documentIntakeRepo.findById(intakeId, homeId, client, { forUpdate: true });
    if (!intakeItem) throw Object.assign(new Error('Scan item not found'), { statusCode: 404 });
    if (intakeItem.status === 'confirmed') {
      throw Object.assign(new Error('This scan has already been filed'), { statusCode: 409 });
    }

    let result;
    if (body.target === 'record_attachment') {
      result = await confirmRecordAttachment(client, homeId, intakeItem, body.record_attachment, username);
    } else if (body.target === 'maintenance') {
      result = await confirmMaintenance(client, homeId, intakeItem, body.maintenance, username);
    } else if (body.target === 'finance_ap') {
      result = await confirmFinance(client, homeId, intakeItem, body.finance_ap, username);
    } else if (body.target === 'hr_attachment') {
      result = await confirmHrAttachment(client, homeId, intakeItem, body.hr_attachment, username);
    } else if (body.target === 'onboarding') {
      result = await confirmOnboarding(client, homeId, intakeItem, body.onboarding, username);
    } else if (body.target === 'training') {
      result = await confirmTraining(client, homeId, intakeItem, body.training, username);
    } else if (body.target === 'cqc') {
      result = await confirmCqc(client, homeId, intakeItem, body.cqc, username);
    } else if (body.target === 'handover') {
      result = await confirmHandover(client, homeId, intakeItem, body.handover, username);
    } else {
      throw Object.assign(new Error('Unsupported target'), { statusCode: 400 });
    }

    const saved = await documentIntakeRepo.update(intakeId, homeId, {
      status: 'confirmed',
      classification_target: body.target,
      reviewed_by: username,
      reviewed_at: new Date().toISOString(),
      routed_module: result.routed_module,
      routed_record_id: result.routed_record_id,
      routed_attachment_id: result.routed_attachment_id,
    }, client);
    return { intake: saved, ...result };
  });
}
