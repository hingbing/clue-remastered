import { spawn } from 'node:child_process';
import process from 'node:process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const procs = [
  spawn(npmCmd, ['run', 'dev', '--prefix', 'server'], { stdio: 'inherit', shell: isWin }),
  spawn(npmCmd, ['run', 'dev', '--prefix', 'client'], { stdio: 'inherit', shell: isWin }),
];

function shutdown() {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
