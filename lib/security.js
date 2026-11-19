'use strict';
/**
 * Manzil — xavfsizlik qatlami: parol xeshlash, sessiyalar (HttpOnly cookie), RBAC, rate limit, TOTP (2FA), audit zanjiri.
 */
const crypto = require('crypto');
const db = require('./db');

// ---------------- Parollar (scrypt, har bir parol uchun alohida tuz) ----------------
const SCRYPT = { N: 32768, r: 8, p: 1, len: 64 };
const scryptAsync = (pw, salt, N, r, p, len) => new Promise((resolve, reject) =>
  crypto.scrypt(String(pw), salt, len, { N, r, p, maxmem: 256 * N * r }, (e, k) => (e ? reject(e) : resolve(k))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const k = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.len);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${k.toString('base64')}`;
}

// Yangi format "scrypt$N$r$p$salt$hash" va eski format "saltHex:hashHex" (avvalgi versiya) qo'llab-quvvatlanadi
async function verifyPassword(password, stored) {
  try {
    const s = String(stored || '');
    let ok = false, legacy = false;
    if (s.startsWith('scrypt$')) {
      const [, N, r, p, salt, hash] = s.split('$');
      const want = Buffer.from(hash, 'base64');
      const got = await scryptAsync(password, Buffer.from(salt, 'base64'), +N, +r, +p, want.length);
      ok = got.length === want.length && crypto.timingSafeEqual(got, want);
    } else if (s.includes(':')) {
      const [salt, key] = s.split(':');
      const want = Buffer.from(key, 'hex');
      const got = await new Promise((res, rej) => crypto.scrypt(String(password), salt, want.length, (e, k) => (e ? rej(e) : res(k))));
      ok = got.length === want.length && crypto.timingSafeEqual(got, want);
      legacy = true;
    }
    return { ok, needsRehash: ok && legacy };
  } catch (_) {
    return { ok: false, needsRehash: false };
  }
}
let _dummy = null;
async function dummyVerify(password) { // foydalanuvchi topilmasa ham vaqt sarflanadi (account enumeration'ga qarshi)
  if (!_dummy) _dummy = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, _dummy);
}

const COMMON = new Set(['password', '12345678', '123456789', 'qwerty123', 'qwertyuiop', 'iloveyou', '11111111', 'password1', 'admin1234', 'manzil123', 'manzil2026', 'parol123']);
function checkPasswordPolicy(pw, { min = 8, email = '' } = {}) {
  pw = String(pw || '');
  if (pw.length < min) return `Parol kamida ${min} belgidan iborat bo'lishi kerak.`;
  if (pw.length > 128) return 'Parol juda uzun (128 belgigacha).';
  if (COMMON.has(pw.toLowerCase())) return 'Bu parol juda oddiy. Boshqasini tanlang.';
  if (email && pw.toLowerCase() === String(email).toLowerCase()) return 'Parol email bilan bir xil bo\'lmasligi kerak.';
  if (/^(.)\1+$/.test(pw)) return 'Parol bir xil belgilardan iborat bo\'lmasligi kerak.';
  return null;
}

// ---------------- Cookie va sessiyalar ----------------
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) {} }
  });
  return out;
}
function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || (req.socket && req.socket.encrypted);
}
function setCookie(req, res, name, value, { maxAgeSec = 0, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAgeSec) parts.push(`Max-Age=${maxAgeSec}`);
  if (value === '') parts.push('Max-Age=0');
  if (isHttps(req) || process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === 'true') parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, parts.join('; ')) : parts.join('; '));
}

const SESSION_RULES = {
  staff: { name: 'mz_staff', absoluteSec: 8 * 3600, idleSec: 2 * 3600, sameSite: 'Strict' },
  user: { name: 'mz_sid', absoluteSec: 14 * 86400, idleSec: 7 * 86400, sameSite: 'Lax' }
};
function clientIp(req) {
  // Mijoz yuborgan X-Forwarded-For ning birinchi qiymati soxtalashtirilishi mumkin (rate limitni aylanib o'tish).
  // Render/Cloudflare chekkasi o'rnatadigan sarlavha ishonchliroq; bo'lmasa XFF ning eng o'ngdagi (proksi qo'shgan) qiymati.
  if (process.env.TRUST_PROXY === 'false') return (req.socket && req.socket.remoteAddress) || 'unknown';
  const edge = String(req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || '').trim();
  if (edge) return edge;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return xff[xff.length - 1] || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function createSession(req, res, actorType, actorId) {
  const rule = SESSION_RULES[actorType];
  const token = crypto.randomBytes(32).toString('base64url');
  const t = Date.now();
  // Bir aktyorning eng ko'pi bilan 10 ta faol sessiyasi
  const old = db.all('SELECT id_hash FROM sessions WHERE actor_type=? AND actor_id=? ORDER BY created_at DESC', actorType, actorId);
  old.slice(9).forEach(s => db.run('DELETE FROM sessions WHERE id_hash=?', s.id_hash));
  db.run('INSERT INTO sessions(id_hash,actor_type,actor_id,created_at,expires_at,last_seen,ip,ua) VALUES(?,?,?,?,?,?,?,?)',
    sha256(token), actorType, actorId, t, t + rule.absoluteSec * 1000, t, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
  setCookie(req, res, rule.name, token, { maxAgeSec: rule.absoluteSec, sameSite: rule.sameSite });
  return token;
}
function getSession(req, actorType) {
  const rule = SESSION_RULES[actorType];
  const token = parseCookies(req)[rule.name];
  if (!token) return null;
  const row = db.get('SELECT * FROM sessions WHERE id_hash=? AND actor_type=?', sha256(token), actorType);
  if (!row) return null;
  const t = Date.now();
  if (row.expires_at < t || t - row.last_seen > rule.idleSec * 1000) { db.run('DELETE FROM sessions WHERE id_hash=?', row.id_hash); return null; }
  if (t - row.last_seen > 60000) db.run('UPDATE sessions SET last_seen=? WHERE id_hash=?', t, row.id_hash);
  return row;
}
function destroySession(req, res, actorType) {
  const rule = SESSION_RULES[actorType];
  const token = parseCookies(req)[rule.name];
  if (token) db.run('DELETE FROM sessions WHERE id_hash=?', sha256(token));
  setCookie(req, res, rule.name, '', { sameSite: rule.sameSite });
}
function revokeAllSessions(actorType, actorId) {
  db.run('DELETE FROM sessions WHERE actor_type=? AND actor_id=?', actorType, actorId);
}
setInterval(() => { try { db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now()); } catch (_) {} }, 10 * 60 * 1000).unref();

// ---------------- RBAC (rol → ruxsatlar) ----------------
const ROLE_LABELS = {
  super_admin: 'Super Admin', admin: 'Administrator', booking_manager: 'Buyurtmalar menejeri', finance_manager: 'Moliya menejeri',
  support_agent: 'Qo\'llab-quvvatlash agenti', content_moderator: 'Kontent moderatori', verification_officer: 'Tasdiqlash mutaxassisi', marketing_manager: 'Marketing menejeri'
};
const ROLE_PERMS = {
  super_admin: ['*'],
  admin: ['dashboard', 'bookings.read', 'bookings.write', 'payments.read', 'refunds.request', 'refunds.approve', 'guides.read', 'guides.write', 'destinations.write',
    'users.read', 'users.write', 'feedback.read', 'feedback.write', 'reports.read', 'staff.read', 'staff.performance', 'audit.read', 'accounting.read'],
  booking_manager: ['dashboard', 'bookings.read', 'bookings.write', 'payments.read', 'refunds.request', 'guides.read', 'feedback.read', 'staff.performance.self'],
  finance_manager: ['dashboard', 'bookings.read', 'payments.read', 'payments.confirm', 'refunds.request', 'refunds.approve', 'accounting.read', 'accounting.write', 'payouts.write', 'reports.read'],
  support_agent: ['dashboard', 'bookings.read', 'bookings.write', 'refunds.request', 'feedback.read', 'feedback.write', 'users.read', 'staff.performance.self'],
  content_moderator: ['dashboard', 'destinations.write', 'guides.read', 'feedback.read', 'feedback.write'],
  verification_officer: ['dashboard', 'guides.read', 'guides.write'],
  marketing_manager: ['dashboard', 'reports.read', 'destinations.write']
};
const can = (staff, perm) => !!staff && staff.active !== 0 && (ROLE_PERMS[staff.role] || []).some(p => p === '*' || p === perm);
const permsOf = staff => ROLE_PERMS[staff.role] || [];

// ---------------- Rate limit (xotirada) ----------------
const buckets = new Map();
function rateLimit(req, name, max, windowMs, extra = '') {
  const key = `${name}:${clientIp(req)}:${extra}`;
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) b = { count: 0, reset: t + windowMs };
  b.count++;
  buckets.set(key, b);
  return b.count <= max ? 0 : Math.max(1, Math.ceil((b.reset - t) / 1000));
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();

// ---------------- Sodda xavfsiz taqqoslash ----------------
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------------- TOTP (RFC 6238) — Google Authenticator / Authy bilan mos ----------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(str) {
  let bits = '';
  for (const c of String(str).replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; bits += i.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }
// Qaytaradi: mos kelgan qadam (step) yoki 0. lastStep bilan qayta ishlatishdan (replay) himoya qilinadi.
function verifyTotp(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return 0;
  const cur = Math.floor(Date.now() / 30000);
  for (const d of [-1, 0, 1]) {
    const step = cur + d;
    if (step > lastStep && safeEqual(totpAt(secret, step), c)) return step;
  }
  return 0;
}
const totpUri = (secret, label) => `otpauth://totp/${encodeURIComponent('Manzil:' + label)}?secret=${secret}&issuer=Manzil&digits=6&period=30`;

// ---------------- Audit (o'zgartirib bo'lmaydigan hash-zanjir) ----------------
const SECRET_KEY_RE = /pass|hash|secret|token|totp|key/i;
function scrub(v, depth = 0) {
  if (v == null || depth > 4) return v ?? null;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = SECRET_KEY_RE.test(k) ? '[yashirin]' : scrub(v[k], depth + 1);
    return o;
  }
  return typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v;
}
function audit(actor, action, entity, entityId, before, after, req) {
  const a = actor || { type: 'system', id: 'system', label: 'tizim' };
  const entry = {
    at: db.now(), actor: { type: a.type, id: a.id, label: a.label }, ip: req ? clientIp(req) : null,
    action, entity: entity || '', entityId: entityId == null ? '' : String(entityId), before: scrub(before), after: scrub(after)
  };
  const payload = JSON.stringify(entry);
  const prev = db.get('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1');
  const prevHash = prev ? prev.hash : '0'.repeat(64);
  const hash = sha256(prevHash + payload);
  db.run('INSERT INTO audit(at,actor_type,actor_id,actor_label,action,entity,entity_id,payload,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?)',
    entry.at, a.type, a.id, a.label, action, entry.entity, entry.entityId, payload, prevHash, hash);
}
function verifyAuditChain() {
  let prev = '0'.repeat(64), n = 0;
  for (const r of db.all('SELECT seq,payload,prev_hash,hash FROM audit ORDER BY seq ASC')) {
    n++;
    if (r.prev_hash !== prev || sha256(prev + r.payload) !== r.hash) return { ok: false, brokenAt: r.seq, checked: n };
    prev = r.hash;
  }
  return { ok: true, checked: n };
}

// ---------------- Kirish ma'lumotlarini tozalash ----------------
const str = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const isEmail = s => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s);

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

module.exports = {
  hashPassword, verifyPassword, dummyVerify, checkPasswordPolicy, parseCookies, setCookie, isHttps, clientIp,
  createSession, getSession, destroySession, revokeAllSessions, SESSION_RULES,
  ROLE_LABELS, ROLE_PERMS, can, permsOf, rateLimit, safeEqual, sha256,
  newTotpSecret, verifyTotp, totpUri, totpAt,
  audit, verifyAuditChain, scrub, str, isEmail, HttpError
};
