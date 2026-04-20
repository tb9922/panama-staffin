import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCAN_INTAKE_TARGET_IDS } from '../../shared/scanIntake.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

async function loadService(options = {}) {
  vi.resetModules();

  const paddleUrl = Object.prototype.hasOwnProperty.call(options, 'paddleUrl')
    ? options.paddleUrl
    : 'http://paddle.local/extract';
  const timeoutMs = options.timeoutMs ?? 30000;
  const readFileResult = options.readFileResult ?? Buffer.from('PDF-fake');
  const readFileMock = options.readFileMock ?? null;

  const readFile = readFileMock || vi.fn().mockResolvedValue(readFileResult);
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  };

  vi.doMock('fs/promises', () => ({ readFile }));
  vi.doMock('../../config.js', () => ({
    config: {
      ocr: { paddleUrl, timeoutMs },
    },
  }));
  vi.doMock('../../logger.js', () => ({ default: logger }));

  const service = await import('../../services/ocrService.js');
  return { ...service, readFile, logger };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('ocrService.extractDocument', () => {
  it.each([
    { paddleUrl: null, desc: 'null' },
    { paddleUrl: '', desc: 'empty string' },
    { paddleUrl: undefined, desc: 'undefined' },
  ])('throws 503 when paddleUrl is $desc', async ({ paddleUrl }) => {
    const { extractDocument } = await loadService({ paddleUrl });
    await expect(
      extractDocument('/tmp/x', { originalName: 'x.pdf', mimeType: 'application/pdf' })
    ).rejects.toMatchObject({ statusCode: 503, message: expect.stringMatching(/not configured/i) });
  });

  it('returns the normalized shape for a valid Paddle response', async () => {
    const { extractDocument } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      rawText: 'INVOICE\n£123.45',
      fields: { total: '123.45', date: '2026-04-19', vendor: 'Acme' },
      confidences: { total: 0.98, date: 0.95 },
      classification: { target: 'finance_ap', confidence: 0.87 },
      metadata: { pages: 1, engine: 'paddle-v3' },
    })));

    const result = await extractDocument('/tmp/in.pdf', {
      originalName: 'invoice.pdf',
      mimeType: 'application/pdf',
    });

    expect(result).toEqual({
      rawText: 'INVOICE\n£123.45',
      fields: { total: '123.45', date: '2026-04-19', vendor: 'Acme' },
      confidences: { total: 0.98, date: 0.95 },
      classification: { target: 'finance_ap', confidence: 0.87 },
      metadata: { pages: 1, engine: 'paddle-v3' },
    });
  });

  it('defaults null bodies and optional fields safely instead of crashing', async () => {
    const { extractDocument } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)));

    await expect(
      extractDocument('/tmp/in.pdf', { originalName: 'in.pdf', mimeType: 'application/pdf' })
    ).resolves.toEqual({
      rawText: '',
      fields: {},
      confidences: {},
      classification: { target: null, confidence: 0 },
      metadata: {},
    });
  });

  it.each(SCAN_INTAKE_TARGET_IDS)('preserves valid OCR classification target %s', async (target) => {
    const { extractDocument } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      classification: { target, confidence: 0.5 },
    })));

    const result = await extractDocument('/tmp/in.pdf', {
      originalName: 'in.pdf',
      mimeType: 'application/pdf',
    });

    expect(result.classification.target).toBe(target);
  });

  it.each([
    { input: 'high', expected: 0 },
    { input: null, expected: 0 },
    { input: Infinity, expected: 0 },
    { input: -0.5, expected: 0 },
    { input: 1.5, expected: 1 },
    { input: '0.85', expected: 0.85 },
  ])('normalizes confidence $input -> $expected', async ({ input, expected }) => {
    const { extractDocument } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      classification: { target: 'maintenance', confidence: input },
    })));

    const result = await extractDocument('/tmp/in.pdf', {
      originalName: 'in.pdf',
      mimeType: 'application/pdf',
    });

    expect(result.classification.confidence).toBe(expected);
  });

  it('maps non-2xx upstream responses to a 502 and keeps the upstream status', async () => {
    const { extractDocument, logger } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 503 })));

    await expect(
      extractDocument('/tmp/in.pdf', { originalName: 'in.pdf', mimeType: 'application/pdf' })
    ).rejects.toMatchObject({ statusCode: 502, upstreamStatus: 503 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503, durationMs: expect.any(Number) }),
      expect.stringMatching(/non-2xx/i)
    );
  });

  it('maps invalid upstream JSON bodies to a 502 instead of leaking a parse error', async () => {
    const { extractDocument, logger } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Gateway Timeout</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(
      extractDocument('/tmp/in.pdf', { originalName: 'in.pdf', mimeType: 'application/pdf' })
    ).rejects.toMatchObject({ statusCode: 502, message: 'OCR service returned an invalid response' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: expect.any(Number), err: expect.any(String) }),
      expect.stringMatching(/invalid response body/i)
    );
  });

  it('maps network TypeError failures to a 502', async () => {
    const { extractDocument, logger } = await loadService();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(
      extractDocument('/tmp/in.pdf', { originalName: 'in.pdf', mimeType: 'application/pdf' })
    ).rejects.toMatchObject({ statusCode: 502, message: 'OCR service unreachable' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: expect.any(Number), err: 'TypeError' }),
      expect.stringMatching(/unreachable/i)
    );
  });

  it('uses multipart FormData with redirect protection', async () => {
    const { extractDocument } = await loadService();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await extractDocument('/tmp/in.pdf', {
      originalName: 'invoice-2026.pdf',
      mimeType: 'application/pdf',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://paddle.local/extract');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const file = init.body.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('application/pdf');
    expect(file.name).toBe('invoice-2026.pdf');
  });

  it('aborts hung requests at the configured timeout', async () => {
    vi.useFakeTimers();
    const { extractDocument } = await loadService({ timeoutMs: 1000 });
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    })));

    const pending = extractDocument('/tmp/in.pdf', {
      originalName: 'in.pdf',
      mimeType: 'application/pdf',
    });
    const settled = pending.catch((err) => err);

    await vi.advanceTimersByTimeAsync(1000);
    await expect(settled).resolves.toMatchObject({ statusCode: 504, message: 'OCR service timed out' });
  });
});
