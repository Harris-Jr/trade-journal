// Run the API and the web dev server together.
//   node scripts/dev.mjs   (or: npm run dev:all)
// The API binds to localhost; Vite proxies /api -> the API port.
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const API_PORT = process.env.PORT ?? '3000';
const DB_PATH = process.env.DB_PATH ?? './data.db';

console.log('> Building backend...');
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: process.cwd() });
if (build.status !== 0) process.exit(build.status ?? 1);

const procs = [];
function run(name, cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
  p.on('exit', (code) => {
    console.log(`\n[${name}] exited (${code}). Shutting down...`);
    shutdown();
  });
  procs.push(p);
  return p;
}
function shutdown() {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* ignore */ } }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`> Starting API on http://localhost:${API_PORT} (db: ${DB_PATH})`);
run('api', 'node', ['dist/server/main.js'], { env: { ...process.env, PORT: API_PORT, DB_PATH } });

console.log('> Starting web dev server (http://localhost:5173)');
// Point Vite's /api proxy at the API port we actually started (honours PORT override).
run('web', 'npm', ['run', 'dev'], {
  cwd: 'web',
  env: { ...process.env, VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
});
