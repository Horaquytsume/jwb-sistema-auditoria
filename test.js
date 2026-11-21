import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import crypto from 'node:crypto';
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
    const req = http.request({ hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
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
  const document = Buffer.from('Teste R$ 12,50');
  const expectedHash = crypto.createHash('sha256').update(document).digest('hex');
  const extracted = await request(`${base}/api/documents/extract`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'teste.txt', base64: document.toString('base64') }) });
  assert.equal(extracted.status, 200, 'API deve executar o extrator Python');
  const extractedBody = await extracted.json();
  assert.equal(extractedBody.text, 'Teste R$ 12,50');
  assert.equal(extractedBody.fileHash, expectedHash);
  const postAudit = (data, headers = authHeaders) => request(`${base}/api/audit`, { method: 'POST', headers, body: JSON.stringify(data) });
  assert.equal((await postAudit({ fileName: 'teste.csv', fileHash, total: 999, itemCount: 1, sectorId: 'operacoes' })).status, 400, 'Rejeitar contrato antigo falsificável');
  assert.equal((await postAudit({ name: 'teste.txt', base64: document.toString('base64'), total: 999, sectorId: 'operacoes' })).status, 400, 'Rejeitar resultados do cliente');
  assert.equal((await postAudit({ name: 'teste.txt', base64: '!!!', sectorId: 'operacoes' })).status, 400);
  assert.equal((await postAudit({ text: '   ', sectorId: 'operacoes' })).status, 422);
  assert.equal((await postAudit({ text: 'x'.repeat(200001), sectorId: 'operacoes' })).status, 400);
  const auditResponse = await postAudit({ name: 'teste.txt', base64: document.toString('base64'), sectorId: 'operacoes' });
  assert.equal(auditResponse.status, 201);
  const insertedResult = await auditResponse.json();
  const inserted = insertedResult.event;
  assert.match(inserted.hash, /^[a-f0-9]{64}$/);
  assert.equal(inserted.data.fileHash, expectedHash);
  assert.equal(inserted.data.total, 12.5);
  assert.equal(inserted.data.itemCount, 1);
  assert.equal(inserted.data.source, 'file');
  assert.equal(insertedResult.report.total, 12.5);
  const auditPage = await (await request(`${base}/api/audit?limit=1`, { headers: authHeaders })).json();
  const auditRows = auditPage.records;
  assert.equal(auditRows.length, 1);
  assert.ok(auditPage.nextBefore);
  const secondPage = await (await request(`${base}/api/audit?limit=1&before=${auditPage.nextBefore}`, { headers: authHeaders })).json();
  assert.equal(secondPage.records.length, 1);
  assert.notEqual(auditRows[0].seq, secondPage.records[0].seq);
  const invalidPage = await request(`${base}/api/audit?limit=101`, { headers: authHeaders });
  assert.equal(invalidPage.status, 400);
  assert.ok(auditRows.some((row) => row.log === inserted.log && row.data.fileHash === expectedHash));
  const pasted = 'ação R$ 1.234,50\r\nOutra 12.25';
  const textResponse = await postAudit({ text: pasted, sectorId: 'operacoes' });
  assert.equal(textResponse.status, 201);
  const textResult = await textResponse.json();
  assert.equal(textResult.event.data.fileHash, crypto.createHash('sha256').update(Buffer.from(pasted, 'utf8')).digest('hex'));
  assert.equal(textResult.event.data.total, 1246.75);
  assert.equal(textResult.event.data.source, 'text');
  assert.equal(textResult.text, pasted);
  const truncated = await postAudit({ name: 'longo.txt', base64: Buffer.from('a'.repeat(200001)).toString('base64'), sectorId: 'operacoes' });
  assert.equal(truncated.status, 201);
  assert.ok((await truncated.json()).event.data.notes.some((note) => note.includes('truncado')));
  const managerLogin = await request(`${base}/api/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'carlos@demo.com', password: 'trocar-esta-senha' }) });
  assert.equal(managerLogin.status, 200);
  const managerToken = (await managerLogin.json()).token;
  assert.equal((await postAudit({ text: 'Teste 1,00', sectorId: 'financeiro' }, { ...jsonHeaders, authorization: `Bearer ${managerToken}` })).status, 403);
  const badDocument = await postAudit({ name: 'teste.xyz', base64: document.toString('base64'), sectorId: 'operacoes' });
  assert.equal(badDocument.status, 422);
  const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) => postAudit({ text: `Paralelo ${index},00`, sectorId: 'operacoes' })));
  assert.ok(concurrent.every((response) => response.status === 201));
  const managerRows = (await (await request(`${base}/api/audit`, { headers: { authorization: `Bearer ${managerToken}` } })).json()).records;
  assert.ok(managerRows.length >= 1);
  assert.ok(managerRows.every((row) => row.data.sectorId === 'operacoes' || row.log === 'LOG-904'));
  const managerVerify = await request(`${base}/api/audit/verify`, { headers: { authorization: `Bearer ${managerToken}` } });
  assert.equal(managerVerify.status, 403);
  const verificationResponse = await request(`${base}/api/audit/verify`, { headers: authHeaders });
  assert.equal(verificationResponse.status, 200);
  assert.equal((await verificationResponse.json()).ok, true);
  const changed = await request(`${base}/api/account/password`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ currentPassword: 'trocar-esta-senha', newPassword: 'nova-senha-forte-123' }) });
  assert.equal(changed.status, 200, 'A troca de senha deve funcionar');
  const staleSession = await request(`${base}/api/me`, { headers: authHeaders });
  assert.equal(staleSession.status, 401, 'Troca de senha deve revogar sessões existentes');
  const relogin = await request(`${base}/api/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'ceo@demo.com', password: 'nova-senha-forte-123' }) });
  assert.equal(relogin.status, 200, 'A nova senha deve permitir novo login');
  const denied = await request(`${base}/api/audit`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ fileName: 'no.csv', fileHash }) });
  assert.equal(denied.status, 401);
  for (let i = 0; i < 8; i++) {
    const failed = await request(`${base}/api/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'ceo@demo.com', password: 'errada' }) });
    assert.equal(failed.status, 401);
  }
  const blocked = await request(`${base}/api/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'ceo@demo.com', password: 'nova-senha-forte-123' }) });
  assert.equal(blocked.status, 429, 'Bloqueio deve persistir na base SQLite');
  console.log('Testes concluídos: dados, API, login, autorização e persistência da auditoria.');
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}
