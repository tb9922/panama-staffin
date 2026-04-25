import { test as setup, expect } from '@playwright/test';
import fs from 'fs';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001';
const UI_BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';

const USERS = [
  { username: 'admin', password: 'admin12345', stateFile: '.playwright/admin-state.json' },
  { username: 'viewer', password: 'viewer12345', stateFile: '.playwright/viewer-state.json' },
];

/**
 * Build a Playwright storageState object from login response data.
 * Constructs cookies + localStorage explicitly — avoids relying on
 * browser cookie capture through the Vite proxy, which is unreliable in CI.
 */
function buildState(loginResponse, setCookieHeaders) {
  let csrfValue = '';
  for (const header of setCookieHeaders) {
    const match = header.match(/panama_csrf=([^;]+)/);
    if (match) csrfValue = match[1];
  }

  return {
    cookies: [
      {
        name: 'panama_token',
        value: loginResponse.token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: -1,
      },
      ...(csrfValue ? [{
        name: 'panama_csrf',
        value: csrfValue,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Strict',
        expires: -1,
      }] : []),
    ],
    origins: [{
      origin: UI_BASE,
      localStorage: [
        {
          name: 'user',
          value: JSON.stringify({
            username: loginResponse.username,
            role: loginResponse.role,
            displayName: loginResponse.displayName || '',
            isPlatformAdmin: loginResponse.isPlatformAdmin || false,
          }),
        },
        // Ensure E2E tests use the seeded home, not the first alphabetical home.
        { name: 'currentHome', value: 'e2e-test-home' },
      ],
    }],
  };
}

for (const { username, password, stateFile } of USERS) {
  setup(`authenticate as ${username}`, async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/login`, {
      data: { username, password },
    });
    expect(res.ok(), `Login failed for ${username}: ${res.status()}`).toBeTruthy();

    const body = await res.json();
    const setCookieHeaders = res.headersArray()
      .filter(h => h.name.toLowerCase() === 'set-cookie')
      .map(h => h.value);

    const state = buildState(body, setCookieHeaders);
    fs.mkdirSync('.playwright', { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  });
}
