import { readFile } from 'fs/promises';
import { config } from '../config.js';
import logger from '../logger.js';
import { SCAN_INTAKE_TARGET_IDS } from '../shared/scanIntake.js';

function normalizeClassificationTarget(target) {
  return SCAN_INTAKE_TARGET_IDS.includes(target) ? target : null;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

export async function extractDocument(filePath, { originalName, mimeType }) {
  if (!config.ocr.paddleUrl) {
    throw Object.assign(new Error('OCR service is not configured'), { statusCode: 503 });
  }

  const fileBuffer = await readFile(filePath);
  const formData = new FormData();
  formData.set('file', new Blob([fileBuffer], { type: mimeType }), originalName);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ocr.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(config.ocr.paddleUrl, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status, durationMs: Date.now() - startedAt },
        'ocr upstream responded with non-2xx'
      );
      throw Object.assign(new Error(`OCR service failed (${response.status})`), {
        statusCode: 502,
        upstreamStatus: response.status,
      });
    }
    let body;
    try {
      body = (await response.json()) ?? {};
    } catch (err) {
      logger.warn(
        { durationMs: Date.now() - startedAt, err: err?.name || 'UnknownError' },
        'ocr upstream returned an invalid response body'
      );
      throw Object.assign(new Error('OCR service returned an invalid response'), {
        statusCode: 502,
        cause: err,
      });
    }
    const normalizedBody = normalizeObject(body);
    const classification = normalizeObject(normalizedBody.classification);
    return {
      rawText: typeof normalizedBody.rawText === 'string' ? normalizedBody.rawText : '',
      fields: normalizeObject(normalizedBody.fields),
      confidences: normalizeObject(normalizedBody.confidences),
      classification: {
        target: normalizeClassificationTarget(classification.target),
        confidence: normalizeConfidence(classification.confidence),
      },
      metadata: normalizeObject(normalizedBody.metadata),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn({ durationMs: Date.now() - startedAt }, 'ocr request timed out');
      throw Object.assign(new Error('OCR service timed out'), { statusCode: 504 });
    }
    if (err.statusCode) throw err;
    if (err.name === 'TypeError' || err?.cause?.code) {
      logger.warn(
        { durationMs: Date.now() - startedAt, err: err.name || 'TypeError', code: err?.cause?.code || err?.code || null },
        'ocr service unreachable'
      );
      throw Object.assign(new Error('OCR service unreachable'), { statusCode: 502, cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
