import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EMPLOYEES, EVENTS, RBAC, SECTORS, USERS } from './server/seed.js';

assert.equal(SECTORS.length, 4);
assert.equal(EMPLOYEES.length, 4);
assert.equal(USERS.length, 4);
assert.equal(EVENTS.length, 2);
assert.equal(RBAC.assistant.viewFinancialDeficit, false);
assert.equal(RBAC.assistant.canEditOrHideLogs, false);
assert.ok(SECTORS.every((sector) => sector.id && sector.name && Number.isFinite(sector.budget)));

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jwb-test-'));
const port = 31000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DB_FILE: path.join(tempDir, 'test.db'), TOKEN_SECRET: 'test-secret-fixed' },
  stdio: 'ignore'
});
const base = `http://127.0.0.1:${port}`;
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: async () => JSON.parse(text || '{}') });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`API encerrou durante a inicialização (código ${server.exitCode})`);
    try { const response = await request(`${base}/api/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('API não iniciou dentro do tempo limite');
}
const jsonHeaders = { 'content-type': 'application/json' };
try {
  await waitForServer();
  const health = await (await request(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
  const badLogin = await request(`${base}/api/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'ceo@demo.com', password: 'errada' }) });
  assert.equal(badLogin.status, 401);
  const loginResponse = await request(`${base}/api/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'ceo@demo.com', password: 'trocar-esta-senha' }) });
  assert.equal(loginResponse.status, 200);
  const { token } = await loginResponse.json();
  const authHeaders = { ...jsonHeaders, authorization: `Bearer ${token}` };
  const me = await (await request(`${base}/api/me`, { headers: authHeaders })).json();
  assert.equal(me.role, 'ceo');
  const sectors = await (await request(`${base}/api/sectors`, { headers: authHeaders })).json();
  assert.equal(sectors.length, 4);
  const fileHash = 'a'.repeat(64);
  const auditResponse = await request(`${base}/api/audit`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ fileName: 'teste.csv', fileHash, total: 12.5, market: 10, itemCount: 1 }) });
  assert.equal(auditResponse.status, 201);
  const inserted = await auditResponse.json();
  assert.match(inserted.hash, /^[a-f0-9]{64}$/);
  const auditRows = await (await request(`${base}/api/audit`, { headers: authHeaders })).json();
  assert.ok(auditRows.some((row) => row.log === inserted.log && row.data.fileHash === fileHash));
  const denied = await request(`${base}/api/audit`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ fileName: 'no.csv', fileHash }) });
  assert.equal(denied.status, 401);
  console.log('Testes concluídos: dados, API, login, autorização e persistência da auditoria.');
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}
