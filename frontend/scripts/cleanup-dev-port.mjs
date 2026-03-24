import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEV_PORT = 5173;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const pids = run(`lsof -tiTCP:${DEV_PORT} -sTCP:LISTEN`)
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean);

for (const pid of pids) {
  const command = run(`ps -ww -p ${pid} -o command=`);
  const isProjectVite = command.includes(`${PROJECT_ROOT}/node_modules`) && command.includes('/vite/bin/vite.js');

  if (!isProjectVite) {
    continue;
  }

  process.stdout.write(`[dev] Cleaning stale Vite process on port ${DEV_PORT}: PID ${pid}\n`);
  run(`kill ${pid}`);
}
