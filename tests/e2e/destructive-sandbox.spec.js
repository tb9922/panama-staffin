import { expect, test } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001';
const HOME = 'e2e-test-home';
const HOME_QUERY = `home=${HOME}`;
const SANDBOX_SOURCE = 'e2e-destructive-flow';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function assertDestructiveTargetIsAllowed() {
  const parsed = new URL(API_BASE);
  const isLocal = LOCAL_HOSTS.has(parsed.hostname);
  if (!isLocal && process.env.ALLOW_DESTRUCTIVE_E2E !== '1') {
    throw new Error('Refusing to run destructive sandbox tests against a non-local API target.');
  }
}

assertDestructiveTargetIsAllowed();

function unique(label) {
  return `E2E destructive ${label} ${Date.now()} ${Math.random().toString(16).slice(2)}`;
}

function parseCookie(setCookieHeaders, name) {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return '';
}

async function login(request, username, password) {
  const response = await request.post(`${API_BASE}/api/login`, {
    data: { username, password },
  });
  expect(response.ok(), `Login failed for ${username}: ${response.status()} ${await response.text()}`).toBeTruthy();

  const body = await response.json();
  const setCookieHeaders = response.headersArray()
    .filter(header => header.name.toLowerCase() === 'set-cookie')
    .map(header => header.value);
  const csrf = parseCookie(setCookieHeaders, 'panama_csrf');
  expect(csrf, `Login for ${username} did not set panama_csrf`).toBeTruthy();

  return {
    username,
    csrf,
    cookie: `panama_token=${body.token}; panama_csrf=${csrf}`,
  };
}

function authHeaders(session, extra = {}) {
  return {
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrf,
    ...extra,
  };
}

async function expectJson(response, label, expectedStatus = null) {
  const text = await response.text();
  if (expectedStatus != null) {
    expect(response.status(), `${label}: ${response.status()} ${text}`).toBe(expectedStatus);
  } else {
    expect(response.ok(), `${label}: ${response.status()} ${text}`).toBeTruthy();
  }
  return text ? JSON.parse(text) : {};
}

async function createAction(request, session, title) {
  return expectJson(
    await request.post(`${API_BASE}/api/action-items?${HOME_QUERY}`, {
      headers: authHeaders(session),
      data: {
        source_type: 'standalone',
        source_id: `${SANDBOX_SOURCE}-action`,
        source_action_key: title,
        title,
        category: 'governance',
        priority: 'medium',
        owner_name: 'E2E Sandbox',
        due_date: '2026-05-20',
        evidence_required: true,
      },
    }),
    'create sandbox action',
    201,
  );
}

test.describe('Seeded destructive-flow sandbox', () => {
  test('creates, saves, and deletes a disposable manager action', async ({ request }) => {
    const admin = await login(request, 'admin', 'admin12345');
    const title = unique('delete action');
    const action = await createAction(request, admin, title);

    const saved = await expectJson(
      await request.put(`${API_BASE}/api/action-items/${action.id}?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: {
          _version: action.version,
          title: `${title} saved`,
          evidence_notes: 'Saved before destructive delete.',
        },
      }),
      'save sandbox action',
    );
    expect(saved.title).toBe(`${title} saved`);
    expect(saved.version).toBeGreaterThan(action.version);

    await expectJson(
      await request.delete(`${API_BASE}/api/action-items/${action.id}?${HOME_QUERY}`, {
        headers: authHeaders(admin),
      }),
      'delete sandbox action',
    );

    await expectJson(
      await request.get(`${API_BASE}/api/action-items/${action.id}?${HOME_QUERY}`, {
        headers: authHeaders(admin),
      }),
      'deleted sandbox action is hidden',
      404,
    );
  });

  test('completes and verifies disposable action and audit-task workflows', async ({ request }) => {
    const admin = await login(request, 'admin', 'admin12345');
    const manager = await login(request, 'manager', 'manager12345');

    const action = await createAction(request, admin, unique('complete action'));
    const completedAction = await expectJson(
      await request.post(`${API_BASE}/api/action-items/${action.id}/complete?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: {
          _version: action.version,
          evidence_notes: 'E2E sandbox evidence for completion.',
        },
      }),
      'complete sandbox action',
    );
    expect(completedAction.status).toBe('completed');

    const verifiedAction = await expectJson(
      await request.post(`${API_BASE}/api/action-items/${action.id}/verify?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: { _version: completedAction.version },
      }),
      'verify sandbox action',
    );
    expect(verifiedAction.status).toBe('verified');

    const auditTitle = unique('audit task');
    const auditTask = await expectJson(
      await request.post(`${API_BASE}/api/audit-tasks?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: {
          template_key: `e2e_destructive_${Date.now()}`,
          title: auditTitle,
          category: 'governance',
          frequency: 'ad_hoc',
          due_date: '2026-05-21',
          evidence_required: true,
          evidence_notes: 'E2E sandbox audit evidence.',
        },
      }),
      'create sandbox audit task',
      201,
    );

    const completedTask = await expectJson(
      await request.post(`${API_BASE}/api/audit-tasks/${auditTask.id}/complete?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: { _version: auditTask.version },
      }),
      'complete sandbox audit task',
    );
    expect(completedTask.status).toBe('completed');

    const verifiedTask = await expectJson(
      await request.post(`${API_BASE}/api/audit-tasks/${auditTask.id}/verify?${HOME_QUERY}`, {
        headers: authHeaders(manager),
        data: { _version: completedTask.version },
      }),
      'verify sandbox audit task',
    );
    expect(verifiedTask.status).toBe('verified');

    await expectJson(
      await request.delete(`${API_BASE}/api/action-items/${action.id}?${HOME_QUERY}`, {
        headers: authHeaders(admin),
      }),
      'cleanup verified sandbox action',
    );
    await expectJson(
      await request.delete(`${API_BASE}/api/audit-tasks/${auditTask.id}?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: { _version: verifiedTask.version },
      }),
      'cleanup verified sandbox audit task',
    );
  });

  test('approves and rejects expenses created by the sandbox user', async ({ request }) => {
    const admin = await login(request, 'admin', 'admin12345');
    const sandbox = await login(request, 'e2e_sandbox', 'sandbox12345');

    async function createExpense(label) {
      return expectJson(
        await request.post(`${API_BASE}/api/finance/expenses?${HOME_QUERY}`, {
          headers: authHeaders(sandbox),
          data: {
            expense_date: '2026-05-22',
            category: 'other',
            description: unique(label),
            supplier: 'E2E Sandbox Supplier',
            invoice_ref: `E2E-DESTRUCTIVE-${label}-${Date.now()}`,
            net_amount: 10,
            vat_amount: 2,
            gross_amount: 12,
            notes: 'Disposable destructive-flow approval test data.',
          },
        }),
        `create sandbox ${label} expense`,
        201,
      );
    }

    const approveExpense = await createExpense('APPROVE');
    const approved = await expectJson(
      await request.put(`${API_BASE}/api/finance/expenses/${approveExpense.id}/approve?${HOME_QUERY}`, {
        headers: authHeaders(admin),
      }),
      'approve sandbox expense',
    );
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe('admin');

    const rejectExpense = await createExpense('REJECT');
    const rejected = await expectJson(
      await request.put(`${API_BASE}/api/finance/expenses/${rejectExpense.id}/reject?${HOME_QUERY}`, {
        headers: authHeaders(admin),
        data: { reason: 'Rejected by E2E destructive sandbox.' },
      }),
      'reject sandbox expense',
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejected_by).toBe('admin');
    expect(rejected.rejection_reason).toBe('Rejected by E2E destructive sandbox.');
  });

  test('revokes only the disposable sandbox user session', async ({ request }) => {
    const admin = await login(request, 'admin', 'admin12345');
    const sandbox = await login(request, 'e2e_sandbox', 'sandbox12345');

    await expectJson(
      await request.get(`${API_BASE}/api/homes`, {
        headers: authHeaders(sandbox),
      }),
      'sandbox token works before revoke',
    );

    await expectJson(
      await request.post(`${API_BASE}/api/login/revoke`, {
        headers: authHeaders(admin),
        data: { username: 'e2e_sandbox' },
      }),
      'revoke sandbox user',
    );

    await expectJson(
      await request.get(`${API_BASE}/api/homes`, {
        headers: authHeaders(sandbox),
      }),
      'sandbox token denied after revoke',
      401,
    );
  });
});
