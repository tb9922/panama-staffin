import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.claude', 'test_rotation.js']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server.js', 'config.js', 'db.js', 'routes/**/*.js', 'repositories/**/*.js', 'services/**/*.js', 'middleware/**/*.js', 'lib/**/*.js', 'scripts/**/*.js', 'shared/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.es2021 },
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // P0-X1 — backend code MUST NOT import from src/ (the frontend tree).
      // src/ files may use browser APIs (window, document, fetch) which crash on the server.
      // Pure-function helpers needed by the backend belong in shared/.
      // Per-file overrides below allow specific known-safe legacy imports while a proper
      // file-relocation is tracked as P0-X1 in .review/full-main-review/_CODEX_MASTER_ACTION_PLAN.md.
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../src/*', '../src/**', '../../src/*', '../../src/**'],
            message: 'Backend code (services/routes/repositories/lib/shared) must not import from src/. Move pure-function helpers to shared/ or use a server-side equivalent. See P0-X1 in CODEX_MASTER_ACTION_PLAN.',
          },
        ],
      }],
    },
  },
  {
    // P0-X1 KNOWN EXCEPTION — assessmentService imports server-authoritative scoring engines
    // from src/lib/cqc.js, src/lib/cqcReadiness.js, src/lib/gdpr.js. These files (and their
    // transitive imports) are verified browser-API-free as of 2026-04-20 (see grep audit
    // documented in CODEX_MASTER_ACTION_PLAN.md). The full file relocation to shared/
    // is the correct long-term fix but was deferred — it requires moving ~16 files and
    // merging two with existing shared/ siblings, with extensive regression testing.
    // Until that lands, the global rule above prevents any NEW services file from
    // importing src/. This override is intentionally narrow to one filename.
    files: ['services/assessmentService.js'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['tests/**/*.js', 'src/lib/__tests__/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.es2020 },
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['src/**/__tests__/**/*.test.jsx', 'src/test/**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.es2020,
        describe: 'readonly', it: 'readonly', expect: 'readonly',
        vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', test: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
