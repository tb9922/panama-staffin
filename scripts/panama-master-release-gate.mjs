#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(process.cwd(), '.review', 'release-gates');
const logDir = path.join(reportDir, `${stamp}-logs`);
const npmExecPath = process.env.npm_execpath;
const npmBin = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmPrefixArgs = npmExecPath ? [npmExecPath] : [];

const argv = new Set(process.argv.slice(2));
const fast = argv.has('--fast');
const failFast = argv.has('--fail-fast');

fs.mkdirSync(logDir, { recursive: true });

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gate';
}

function commandLine(gate) {
  return [gate.bin, ...(gate.args || [])].join(' ');
}

function tail(value, max = 8_000) {
  const text = String(value || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function gate(name, bin, args = [], options = {}) {
  return {
    name,
    bin,
    args,
    required: options.required !== false,
    timeoutMs: options.timeoutMs || 10 * 60_000,
    category: options.category || 'test',
  };
}

function npmGate(name, script, args = [], options = {}) {
  return gate(name, npmBin, [...npmPrefixArgs, 'run', script, ...args], options);
}

function auditGate(options = {}) {
  return gate('npm audit production dependencies', npmBin, [...npmPrefixArgs, 'audit', '--omit=dev'], {
    timeoutMs: 5 * 60_000,
    ...options,
  });
}

const preflightGates = [
  gate('git branch and status', 'git', ['status', '--short', '--branch'], { required: false, timeoutMs: 30_000, category: 'preflight' }),
  gate('git current commit', 'git', ['rev-parse', 'HEAD'], { required: false, timeoutMs: 30_000, category: 'preflight' }),
  gate('git remote main and v1-os heads', 'git', ['ls-remote', 'origin', 'refs/heads/main', 'refs/heads/v1-os'], { required: false, timeoutMs: 45_000, category: 'preflight' }),
];

const fastGates = [
  npmGate('lint', 'lint', [], { timeoutMs: 5 * 60_000 }),
  npmGate('production build', 'build', [], { timeoutMs: 8 * 60_000 }),
  npmGate('unit and library tests', 'test:ci', [], { timeoutMs: 10 * 60_000 }),
  npmGate('route RBAC audit', 'audit:routes', [], { timeoutMs: 5 * 60_000 }),
  npmGate('golden release journeys', 'test:golden', [], { timeoutMs: 25 * 60_000, category: 'e2e' }),
  auditGate(),
];

const fullGates = [
  npmGate('lint', 'lint', [], { timeoutMs: 5 * 60_000 }),
  npmGate('production build', 'build', [], { timeoutMs: 8 * 60_000 }),
  npmGate('frontend component tests', 'test:frontend', [], { timeoutMs: 12 * 60_000 }),
  npmGate('unit and library tests', 'test:ci', [], { timeoutMs: 10 * 60_000 }),
  npmGate('staff module suite', 'test:staff', [], { timeoutMs: 25 * 60_000 }),
  npmGate('governance module suite', 'test:governance', [], { timeoutMs: 20 * 60_000 }),
  npmGate('HR module suite', 'test:hr', [], { timeoutMs: 30 * 60_000 }),
  npmGate('full integration suite', 'test:integration', [], { timeoutMs: 35 * 60_000, category: 'integration' }),
  npmGate('route RBAC audit', 'audit:routes', [], { timeoutMs: 5 * 60_000 }),
  npmGate('HR EDI encryption verifier', 'verify:hr-edi-encryption', [], { timeoutMs: 5 * 60_000 }),
  npmGate('HR health encryption verifier', 'verify:hr-health-encryption', [], { timeoutMs: 5 * 60_000 }),
  npmGate('action backfill verifier', 'verify:action-backfill', [], { timeoutMs: 8 * 60_000 }),
  npmGate('V1 operational gates', 'verify:v1-operational', ['--', '--strict'], { timeoutMs: 8 * 60_000 }),
  npmGate('V1 scale load check', 'test:v1-scale', [], { timeoutMs: 20 * 60_000, category: 'performance' }),
  npmGate('golden release journeys', 'test:golden', [], { timeoutMs: 25 * 60_000, category: 'e2e' }),
  npmGate('full Playwright E2E suite', 'test:e2e', [], { timeoutMs: 45 * 60_000, category: 'e2e' }),
  npmGate('UI button stress sweep', 'test:ui-stress', [], { timeoutMs: 35 * 60_000, category: 'e2e' }),
  auditGate(),
];

const selectedGates = [...preflightGates, ...(fast ? fastGates : fullGates)];

async function runGate(item) {
  const started = performance.now();
  const logPath = path.join(logDir, `${String(selectedGates.indexOf(item) + 1).padStart(2, '0')}-${slug(item.name)}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  let outputTail = '';
  let timedOut = false;

  console.log(`\n[master-gate] START ${item.name}`);
  console.log(`[master-gate] ${commandLine(item)}`);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(item.bin, item.args, {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
      });
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      const message = error.message || String(error);
      logStream.write(`\n[master-gate] ERROR ${message}\n`);
      logStream.end();
      console.log(`[master-gate] FAIL ${item.name} (${durationMs}ms)`);
      resolve({
        ...item,
        command: commandLine(item),
        ok: false,
        exitCode: 127,
        durationMs,
        timedOut,
        logPath,
        outputTail: tail(`${outputTail}\n${message}`),
      });
      return;
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, item.timeoutMs);

    function capture(chunk, stream) {
      const text = chunk.toString();
      outputTail = tail(outputTail + text);
      logStream.write(text);
      stream.write(text);
    }

    child.stdout.on('data', chunk => capture(chunk, process.stdout));
    child.stderr.on('data', chunk => capture(chunk, process.stderr));

    child.on('error', error => {
      clearTimeout(timeout);
      const durationMs = Math.round(performance.now() - started);
      const message = error.message || String(error);
      logStream.write(`\n[master-gate] ERROR ${message}\n`);
      logStream.end();
      console.log(`[master-gate] FAIL ${item.name} (${durationMs}ms)`);
      resolve({
        ...item,
        command: commandLine(item),
        ok: false,
        exitCode: 127,
        durationMs,
        timedOut,
        logPath,
        outputTail: tail(`${outputTail}\n${message}`),
      });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      const durationMs = Math.round(performance.now() - started);
      const ok = code === 0 && !timedOut;
      logStream.write(`\n[master-gate] exit=${code ?? 'null'} signal=${signal ?? 'none'} timedOut=${timedOut}\n`);
      logStream.end();
      console.log(`[master-gate] ${ok ? 'PASS' : 'FAIL'} ${item.name} (${Math.round(durationMs / 1000)}s)`);
      resolve({
        ...item,
        command: commandLine(item),
        ok,
        exitCode: code,
        signal,
        durationMs,
        timedOut,
        logPath,
        outputTail,
      });
    });
  });
}

function statusEmoji(result) {
  if (result.ok) return 'PASS';
  if (!result.required) return 'WARN';
  return 'FAIL';
}

function writeReports(results) {
  const endedAt = new Date();
  const failedRequired = results.filter(result => result.required && !result.ok);
  const jsonPath = path.join(reportDir, `${stamp}.json`);
  const mdPath = path.join(reportDir, `${stamp}.md`);
  const payload = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    mode: fast ? 'fast' : 'full',
    failFast,
    ok: failedRequired.length === 0,
    failedRequired: failedRequired.map(result => result.name),
    results: results.map(result => ({
      name: result.name,
      category: result.category,
      command: result.command,
      required: result.required,
      ok: result.ok,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      logPath: path.relative(process.cwd(), result.logPath),
      outputTail: result.outputTail,
    })),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  const lines = [
    `# Panama Master Release Gate - ${stamp}`,
    '',
    `Mode: ${payload.mode}`,
    `Started: ${payload.startedAt}`,
    `Ended: ${payload.endedAt}`,
    `Result: ${payload.ok ? 'PASS' : 'FAIL'}`,
    '',
    '## Gates',
    '',
    '| Status | Gate | Command | Duration | Log |',
    '|---|---|---|---:|---|',
  ];

  for (const result of results) {
    const relativeLog = path.relative(reportDir, result.logPath).replaceAll('\\', '/');
    lines.push(`| ${statusEmoji(result)} | ${result.name} | \`${result.command}\` | ${Math.round(result.durationMs / 1000)}s | [log](${relativeLog}) |`);
  }

  if (failedRequired.length > 0) {
    lines.push('', '## Required Failures', '');
    for (const result of failedRequired) {
      lines.push(`### ${result.name}`, '');
      lines.push('```text');
      lines.push(tail(result.outputTail || 'No output captured.', 2_000).trim());
      lines.push('```', '');
    }
  }

  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath, ok: payload.ok, failedRequired };
}

const results = [];

for (const item of selectedGates) {
  const result = await runGate(item);
  results.push(result);
  if (failFast && result.required && !result.ok) break;
}

const report = writeReports(results);
console.log(`\n[master-gate] Report: ${path.relative(process.cwd(), report.mdPath)}`);
console.log(`[master-gate] JSON: ${path.relative(process.cwd(), report.jsonPath)}`);

if (!report.ok) {
  console.error(`[master-gate] ${report.failedRequired.length} required gate(s) failed: ${report.failedRequired.map(result => result.name).join(', ')}`);
  process.exit(1);
}

console.log('[master-gate] All required gates passed.');
