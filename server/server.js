import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SECTORS, EMPLOYEES, USERS, RBAC, EVENTS } from './seed.js';

const PORT = Number(process.env.PORT) || 3001;
const DEMO = process.env.DEMO !== '0';
const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const db = new DatabaseSync(process.env.DB_FILE || 'jwb.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, pass TEXT, active INTEGER DEFAULT 1, sector_ids TEXT);
CREATE TABLE IF NOT EXISTS sectors(id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS rbac(role TEXT NOT NULL, permission TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY(role, permission));
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, log_id TEXT, kind TEXT NOT NULL, actor TEXT NOT NULL, data TEXT NOT NULL, ts TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
`);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`; };
const checkPw = (pw, stored) => {
  if (typeof pw !== 'string' || typeof stored !== 'string') return false;
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  const actual = crypto.scryptSync(pw, salt, 32);
  const expected = Buffer.from(h, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const mac = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
const issue = (user) => {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 12 * 3600e3 })).toString('base64url');
  return `${payload}.${mac(payload)}`;
};
const lastEvent = db.prepare('SELECT hash FROM events ORDER BY seq DESC LIMIT 1');
function appendEvent(logId, kind, actor, data, ts = new Date().toISOString()) {
  const prevHash = lastEvent.get()?.hash || 'GENESIS';
  const hash = sha(JSON.stringify({ logId, kind, actor, data, ts, prevHash }));
  db.prepare('INSERT INTO events(log_id, kind, actor, data, ts, prev_hash, hash) VALUES (?,?,?,?,?,?,?)')
    .run(logId, kind, actor, JSON.stringify(data), ts, prevHash, hash);
  return hash;
}

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const insertUser = db.prepare('INSERT INTO users(id, name, email, role, pass, sector_ids) VALUES (?,?,?,?,?,?)');
  const insertPermission = db.prepare('INSERT OR IGNORE INTO rbac(role, permission, enabled) VALUES (?,?,?)');
  const insertSector = db.prepare('INSERT OR IGNORE INTO sectors(id, data) VALUES (?,?)');
  db.exec('BEGIN');
  try {
    for (const user of USERS) insertUser.run(user.id, user.name, user.email, user.role, hashPw('trocar-esta-senha'), user.sectors.join(','));
    for (const [role, permissions] of Object.entries(RBAC)) for (const [key, enabled] of Object.entries(permissions)) insertPermission.run(role, key, enabled ? 1 : 0);
    for (const sector of SECTORS) insertSector.run(sector.id, JSON.stringify(sector));
    for (const event of EVENTS) appendEvent(event.log, event.kind, event.actor, event.data, new Date(Date.now() - event.h * 3600e3).toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const json = (res, status, value) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Corpo da requisição excede 2 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('JSON inválido'); }
}
function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload)); const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(claims.exp) || claims.exp < Date.now()) return null;
    return db.prepare('SELECT id, name, email, role, sector_ids FROM users WHERE id = ? AND active = 1').get(claims.id) || null;
  } catch { return null; }
}
function scopedSectorIds(user) { return user.role === 'ceo' ? SECTORS.map((s) => s.id) : String(user.sector_ids || '').split(',').filter(Boolean); }

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://localhost');
  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); }
    catch (error) { return json(res, error.message.includes('2 MB') ? 413 : 400, { error: error.message }); }
  }
  if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, demo: DEMO });
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(body.email || '').trim().toLowerCase());
    if (!user || !checkPw(body.password, user.pass)) return json(res, 401, { error: 'E-mail ou senha inválidos' });
    return json(res, 200, { token: issue(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Sessão inválida ou expirada. Entre novamente.' });
  if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role });
  if (url.pathname === '/api/sectors' && req.method === 'GET') {
    const allowed = scopedSectorIds(user);
    const sectors = SECTORS.filter((sector) => allowed.includes(sector.id));
    return json(res, 200, sectors.map((sector) => user.role === 'assistant' ? { ...sector, budget: undefined, baseSpent: undefined } : sector));
  }
  if (url.pathname === '/api/employees' && req.method === 'GET') {
    if (user.role === 'assistant') return json(res, 403, { error: 'Seu perfil não tem permissão para consultar indicadores de colaboradores.' });
    const allowed = scopedSectorIds(user);
    return json(res, 200, EMPLOYEES.filter((employee) => allowed.includes(employee.sectorId)));
  }
  if (url.pathname === '/api/audit' && req.method === 'GET') {
    const allowed = scopedSectorIds(user);
    const records = db.prepare('SELECT seq, log_id AS log, kind, actor, data, ts, prev_hash AS prevHash, hash FROM events ORDER BY seq').all()
      .map((row) => ({ ...row, data: JSON.parse(row.data) }))
      .filter((row) => user.role === 'ceo' || !row.data.sectorId || allowed.includes(row.data.sectorId));
    return json(res, 200, records);
  }
  if (url.pathname === '/api/audit' && req.method === 'POST') {
    if (!body || typeof body.fileName !== 'string' || typeof body.fileHash !== 'string' || !/^[a-f0-9]{64}$/i.test(body.fileHash))
      return json(res, 400, { error: 'Nome do arquivo e hash SHA-256 válido são obrigatórios.' });
    if (!DEMO && user.role === 'assistant') return json(res, 403, { error: 'Este perfil não pode registrar auditorias em produção.' });
    const logId = `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const data = { fileName: body.fileName.slice(0, 200), fileHash: body.fileHash.toLowerCase(), total: Number(body.total) || 0, market: Number(body.market) || 0, itemCount: Math.max(0, Number(body.itemCount) || 0), sectorId: String(body.sectorId || scopedSectorIds(user)[0] || '') };
    const hash = appendEvent(logId, 'document_audited', user.name, data);
    return json(res, 201, { log: logId, hash, ts: new Date().toISOString() });
  }
  return json(res, 404, { error: 'Não encontrado' });
});
server.listen(PORT, '0.0.0.0', () => console.log(`JWB Backend rodando em http://localhost:${PORT} (${DEMO ? 'demo' : 'produção'})`));
