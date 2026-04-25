import { existsSync } from 'fs';
import { spawn } from 'child_process';

const [, , script, ...args] = process.argv;

if (!script) {
  console.error('Usage: node scripts/run-bash-script.mjs <script> [args...]');
  process.exit(2);
}

const bashCandidates = process.platform === 'win32'
  ? [
      process.env.BASH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'bash',
    ].filter(Boolean)
  : [process.env.BASH, 'bash'].filter(Boolean);

const bash = bashCandidates.find(candidate => candidate === 'bash' || existsSync(candidate));

if (!bash) {
  console.error('Could not find bash. Install Git for Windows or set BASH to the bash executable.');
  process.exit(127);
}

const child = spawn(bash, [script, ...args], {
  stdio: 'inherit',
  shell: false,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Bash script terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(127);
});
