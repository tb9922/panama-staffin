import { readFile } from 'fs/promises';
import { Blob } from 'buffer';
import { config } from '../config.js';
import { SCAN_INTAKE_TARGET_IDS } from '../shared/scanIntake.js';

function normalizeClassificationTarget(target) {
  return SCAN_INTAKE_TARGET_IDS.includes(target) ? target : null;
}

export async function extractDocument(filePath, { originalName, mimeType }) {
  if (!config.ocr.paddleUrl) {
    throw Object.assign(new Error('OCR service is not configured'), { statusCode: 503 });
  }

  const fileBuffer = await readFile(filePath);
  const formData = new FormData();
  formData.set('file', new Blob([fileBuffer], { type: mimeType }), originalName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ocr.timeoutMs);
  try {
    const response = await fetch(config.ocr.paddleUrl, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`OCR service failed (${response.status})`), { statusCode: 502 });
    }
    const body = await response.json();
    return {
      rawText: body.rawText || '',
      fields: body.fields || {},
      confidences: body.confidences || {},
      classification: {
        target: normalizeClassificationTarget(body.classification?.target),
        confidence: Number(body.classification?.confidence || 0),
      },
      metadata: body.metadata || {},
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('OCR service timed out'), { statusCode: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
