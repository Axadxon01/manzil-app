'use strict';
/**
 * MANZIL v3 — SQLite bazali, noldan-bog'liqliksiz (zero-dependency) Node.js server.
 * Talab: Node.js >= 22.13 (node:sqlite).
 * Ishga tushirish:  node server.js     (DB_PATH=:memory: bo'lsa baza xotirada)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- .env (ixtiyoriy) ----------
(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
})();

const db = require('./lib/db');
const sec = require('./lib/security');
const core = require('./lib/core');
const { HttpError, str } = sec;

const VERSION = '3.0.0';
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DEMO_PAYMENTS = process.env.DEMO_PAYMENTS === 'true' && !IS_PROD;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set([PUBLIC_URL, ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CLICK_SERVICE_ID = process.env.CLICK_SERVICE_ID || '', CLICK_MERCHANT_ID = process.env.CLICK_MERCHANT_ID || '';
const PAYME_MERCHANT_ID = process.env.PAYME_MERCHANT_ID || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '', TG_ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '', OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 500;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ============================================================ Bootstrap
db.importLegacyJson();
db.seedSampleGuides();
async function bootstrapAdmin() {
  if (db.get('SELECT COUNT(*) c FROM staff').c > 0) return;
  const email = str(process.env.ADMIN_EMAIL || 'admin@manzil.local', 120).toLowerCase();
  let pw = process.env.ADMIN_PASSWORD, generated = false;
  if (!pw || sec.checkPasswordPolicy(pw, { min: 12 })) {
    if (pw) console.warn('[bootstrap] ADMIN_PASSWORD siyosatga mos emas (kamida 12 belgi) — tasodifiy parol yaratildi.');
    pw = crypto.randomBytes(12).toString('base64url'); generated = true;
  }
  const id = db.uid('st_');
  db.run('INSERT INTO staff(id,name,email,role,password_hash,must_change_pw,created_at) VALUES(?,?,?,?,?,?,?)', id, 'Bosh administrator', email, 'super_admin', await sec.hashPassword(pw), generated ? 1 : 0, db.now());
  sec.audit(core.SYSTEM, 'staff.bootstrap', 'staff', id, null, { email, role: 'super_admin' });
  if (generated) {
    console.log('\n==================================================================');
    console.log(' BIRINCHI ADMIN YARATILDI (bu parol faqat BIR MARTA ko\'rsatiladi)');
    console.log('   Email : ' + email);
    console.log('   Parol : ' + pw);
    console.log(' Kirgach parolni darhol almashtiring va 2FA ni yoqing.');
    console.log('==================================================================\n');
  } else console.log('[bootstrap] Super admin ADMIN_EMAIL/ADMIN_PASSWORD dan yaratildi: ' + email);
}

// ============================================================ HTTP yordamchilar
function securityHeaders(res, isApi) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (isApi) { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); }
  else res.setHeader('Content-Security-Policy', "default-src 'self' https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readRaw(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > max) { reject(new HttpError(413, 'So\'rov hajmi katta.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const ct = String(req.headers['content-type'] || '');
  const raw = await readRaw(req);
  if (!raw) return {};
  if (!ct.includes('application/json')) throw new HttpError(415, 'Content-Type: application/json kerak.');
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch (_) { throw new HttpError(400, 'JSON noto\'g\'ri.'); }
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true; // brauzersiz mijozlar (curl, webhooklar)
  return ALLOWED_ORIGINS.has(o) || o === `http://${req.headers.host}` || o === `https://${req.headers.host}`;
}

// ============================================================ Marshrutlar
const routes = [];
function route(method, pattern, opts, fn) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts: opts || {}, fn });
}
const rl = (req, name, max, win, extra) => { const s = sec.rateLimit(req, name, max, win, extra); if (s) throw new HttpError(429, `Juda ko'p urinish. ${s} soniyadan keyin qayta urining.`, { retryAfter: s }); };

function currentUser(req) {
  const s = sec.getSession(req, 'user'); if (!s) return null;
  const u = db.get('SELECT * FROM users WHERE id=?', s.actor_id);
  return u && u.status === 'active' ? u : null;
}
function currentStaff(req) {
  const s = sec.getSession(req, 'staff'); if (!s) return null;
  const st = db.get('SELECT * FROM staff WHERE id=?', s.actor_id);
  return st && st.active ? st : null;
}
const userView = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: u.created_at });
const staffView = s => ({ id: s.id, name: s.name, email: s.email, role: s.role, roleLabel: sec.ROLE_LABELS[s.role], active: !!s.active, totpEnabled: !!s.totp_enabled, mustChangePw: !!s.must_change_pw, lastLogin: s.last_login, createdAt: s.created_at });
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;
function lockedMsg(row) { return row.locked_until > Date.now() ? `Hisob vaqtincha bloklangan. ${Math.ceil((row.locked_until - Date.now()) / 60000)} daqiqadan keyin urining.` : null; }
function failLogin(table, row) {
  const n = row.failed_logins + 1;
  if (n >= LOCK_AFTER) db.run(`UPDATE ${table} SET failed_logins=0, locked_until=? WHERE id=?`, Date.now() + LOCK_MS, row.id);
  else db.run(`UPDATE ${table} SET failed_logins=? WHERE id=?`, n, row.id);
}

// ---------- Ommaviy: sog'liq, katalog ----------
route('GET', '/api/health', {}, () => ({ ok: true, version: VERSION, db: db.IN_MEMORY ? 'memory' : 'file', time: db.now(), payments: { stripe: !!STRIPE_SECRET_KEY, click: !!(CLICK_SERVICE_ID && CLICK_MERCHANT_ID), payme: !!PAYME_MERCHANT_ID, demo: DEMO_PAYMENTS } }));
const guideView = g => ({ id: g.id, name: g.name, city: g.city, country: g.country, langs: g.langs, spec: g.spec, bio: g.bio, about: g.about, rate: g.rate, price: g.rate, exp: g.exp, tg: g.tg, group: g.grp, verified: !!g.verified, status: g.status, sample: !!g.is_sample,
  rating: (db.get('SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE guide_id=?', g.id) || {}).a || null });
route('GET', '/api/guides', {}, () => ({ ok: true, guides: db.all("SELECT * FROM guides WHERE status='approved' ORDER BY is_sample, name").map(guideView) }));
route('POST', '/api/guides/apply', {}, ({ req, body }) => {
  rl(req, 'guide-apply', 5, 3600 * 1000);
  const g = { name: str(body.name, 80), city: str(body.city, 80), tg: str(body.tg, 64).replace(/^@/, ''), langs: str(body.langs, 120), spec: str(body.spec, 200), about: str(body.about, 1000) };
  const rate = Number(body.rate);
  if (g.name.length < 2 || g.city.length < 2 || !g.tg || !(rate >= 5 && rate <= 2000)) throw new HttpError(400, 'Ism, shahar, Telegram va kunlik narx (5–2000$) majburiy.');
  const id = db.uid('guide_');
  db.run("INSERT INTO guides(id,name,city,country,langs,spec,bio,about,rate,exp,tg,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)", id, g.name, g.city, str(body.country, 60), g.langs, g.spec, g.spec, g.about, rate, Math.max(0, Math.min(60, parseInt(body.exp, 10) || 0)), g.tg, db.now(), db.now());
  sec.audit({ type: 'guest', id: 'guest', label: g.tg }, 'guide.apply', 'guide', id, null, { name: g.name, city: g.city }, req);
  notifyTg(`🧭 Yangi gid arizasi: ${g.name} (${g.city}) @${g.tg}`);
  return { ok: true, id, status: 'pending' };
});
route('GET', '/api/destinations', {}, () => ({ ok: true, destinations: db.all('SELECT * FROM destinations WHERE archived=0 ORDER BY created_at').map(d => ({ ...JSON.parse(d.data), id: d.id, priceStatus: d.price_status })) }));
route('POST', '/api/feedback', {}, ({ req, body, user }) => {
  rl(req, 'feedback', 5, 3600 * 1000);
  const msg = str(body.message || body.msg, 2000);
  if (msg.length < 3) throw new HttpError(400, 'Xabar matnini yozing.');
  const id = db.uid('fb_');
  db.run('INSERT INTO feedback(id,name,contact,type,message,created_at) VALUES(?,?,?,?,?,?)', id, str(body.name || (user && user.name), 80), str(body.contact || (user && user.email), 120), str(body.type, 30) || 'general', msg, db.now());
  notifyTg(`💬 Yangi fikr-mulohaza: ${msg.slice(0, 200)}`);
  return { ok: true, id };
});

// ---------- AI ----------
const aiDaily = { day: '', n: 0 };
function localAi(message) {
  const t = message.toLowerCase();
  if (/viza/.test(t)) return 'O\'zbekiston fuqarolari uchun vizasiz tartib davlatga qarab farq qiladi va tez-tez o\'zgaradi (masalan Turkiya, Gruziya, BAA, Qozog\'iston, Qirg\'iziston). Safardan oldin davlatning rasmiy manbasida tekshiring.';
  if (/to.?lov|click|payme|karta/.test(t)) return 'To\'lov faqat to\'lov provayderi serverga tasdiqlagandan keyin "to\'langan" bo\'ladi. Qaytarish siyosati buyurtma sahifasida ko\'rsatiladi.';
  if (/gid|operator/.test(t)) return 'Gidlar bo\'limidan tasdiqlangan gidni tanlab, sana belgilab band qilishingiz mumkin. Narx server tomonida hisoblanadi.';
  return 'Qayerga va necha kunga sayohat rejalashtiryapsiz? Manzil, kunlar va sayohatchilar sonini yozing — taxminiy byudjetni hisoblab beraman (narxlar "taxminiy" deb belgilanadi).';
}
route('POST', '/api/ai/chat', {}, async ({ req, body }) => {
  rl(req, 'ai', 20, 60000);
  const message = str(body.message, 2000);
  if (!message) throw new HttpError(400, 'Xabar bo\'sh.');
  const day = new Date().toISOString().slice(0, 10);
  if (aiDaily.day !== day) { aiDaily.day = day; aiDaily.n = 0; }
  let reply = null, provider = 'local-fallback', model = 'rules';
  if (OPENAI_API_KEY && aiDaily.n < AI_DAILY_LIMIT) {
    aiDaily.n++;
    try {
      const hist = (Array.isArray(body.history) ? body.history : []).slice(-8).map(m => ({ role: m && m.role === 'user' ? 'user' : 'assistant', content: str(m && m.content, 1200) }));
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OPENAI_API_KEY },
        body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.6, max_tokens: 600, messages: [{ role: 'system', content: 'Siz Manzil sayohat platformasining AI maslahatchisisiz. O\'zbek tilida qisqa va amaliy javob bering. Tasdiqlanmagan narxni aniq narx sifatida bermang — "taxminan" deb belgilang.' }, ...hist, { role: 'user', content: message }] }) });
      clearTimeout(tm);
      const d = await r.json(); const t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (r.ok && t) { reply = t.trim(); provider = 'openai'; model = OPENAI_MODEL; }
    } catch (_) {}
  }
  if (!reply) reply = localAi(message);
  db.run('INSERT INTO ai_log(at,provider,model,ip,user_msg,reply) VALUES(?,?,?,?,?,?)', db.now(), provider, model, sec.clientIp(req), message.slice(0, 500), reply.slice(0, 1000));
  return { ok: true, reply, providerUsed: provider, model };
});

// ---------- Mijoz auth ----------
route('POST', '/api/auth/register', {}, async ({ req, res, body }) => {
  rl(req, 'register', 5, 3600 * 1000);
  const email = str(body.email || body.emailOrPhone, 120).toLowerCase(), name = str(body.name, 80);
  if (name.length < 2) throw new HttpError(400, 'Ismingizni kiriting.');
  if (!sec.isEmail(email)) throw new HttpError(400, 'Email manzili noto\'g\'ri.');
  const pe = sec.checkPasswordPolicy(body.password, { email }); if (pe) throw new HttpError(400, pe);
  if (db.get('SELECT 1 x FROM users WHERE email=?', email)) { await sec.dummyVerify('x'); throw new HttpError(409, 'Bu email bilan hisob mavjud. Kirishga urining.'); }
  const id = db.uid('usr_'), ph = await sec.hashPassword(body.password);
  db.tx(() => {
    db.run('INSERT INTO users(id,name,email,phone,password_hash,created_at,pw_changed_at) VALUES(?,?,?,?,?,?,?)', id, name, email, str(body.phone, 30) || null, ph, db.now(), db.now());
    db.run('INSERT INTO user_data(user_id,favorites,route,updated_at) VALUES(?,?,?,?)', id, JSON.stringify((Array.isArray(body.favorites) ? body.favorites : []).slice(0, 200)), JSON.stringify((Array.isArray(body.route) ? body.route : []).slice(0, 100)), db.now());
    sec.audit({ type: 'user', id, label: email }, 'user.register', 'user', id, null, { email }, req);
  });
  sec.createSession(req, res, 'user', id);
  return { ok: true, user: userView(db.get('SELECT * FROM users WHERE id=?', id)) };
});
route('POST', '/api/auth/login', {}, async ({ req, res, body }) => {
  const email = str(body.email || body.emailOrPhone, 120).toLowerCase();
  rl(req, 'login', 10, 15 * 60 * 1000); rl(req, 'login-acct', 8, 15 * 60 * 1000, email);
  const u = db.get('SELECT * FROM users WHERE email=?', email);
  if (!u) { await sec.dummyVerify(body.password); throw new HttpError(401, 'Email yoki parol noto\'g\'ri.'); }
  const lk = lockedMsg(u); if (lk) throw new HttpError(423, lk);
  const v = await sec.verifyPassword(body.password, u.password_hash);
  if (!v.ok) { failLogin('users', u); sec.audit({ type: 'user', id: u.id, label: email }, 'user.login_failed', 'user', u.id, null, null, req); throw new HttpError(401, 'Email yoki parol noto\'g\'ri.'); }
  if (u.status !== 'active') throw new HttpError(403, 'Hisob faol emas. Qo\'llab-quvvatlashga murojaat qiling.');
  if (v.needsRehash) db.run('UPDATE users SET password_hash=? WHERE id=?', await sec.hashPassword(body.password), u.id);
  db.run('UPDATE users SET failed_logins=0, locked_until=0, last_login=? WHERE id=?', db.now(), u.id);
  sec.createSession(req, res, 'user', u.id);
  return { ok: true, user: userView(u) };
});
route('POST', '/api/auth/logout', {}, ({ req, res }) => { sec.destroySession(req, res, 'user'); return { ok: true }; });
const dataOf = id => { const d = db.get('SELECT * FROM user_data WHERE user_id=?', id) || {}; const j = (s, f) => { try { return JSON.parse(s); } catch (_) { return f; } }; return { favorites: j(d.favorites, []), route: j(d.route, []), plan: j(d.plan, []), checklist: j(d.checklist, []) }; };
route('GET', '/api/auth/me', { auth: 'user' }, ({ user }) => ({ ok: true, user: userView(user), data: dataOf(user.id) }));
route('POST', '/api/auth/sync', { auth: 'user' }, ({ user, body }) => {
  const arr = (v, n) => JSON.stringify((Array.isArray(v) ? v : []).slice(0, n));
  db.run(`INSERT INTO user_data(user_id,favorites,route,plan,checklist,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET favorites=excluded.favorites, route=excluded.route, plan=excluded.plan, checklist=excluded.checklist, updated_at=excluded.updated_at`,
    user.id, arr(body.favorites, 200), arr(body.route, 100), arr(body.plan, 100), arr(body.checklist, 100), db.now());
  return { ok: true, data: dataOf(user.id) };
});
route('POST', '/api/auth/password', { auth: 'user' }, async ({ req, user, body }) => {
  rl(req, 'pw-change', 5, 3600 * 1000, user.id);
  if (!(await sec.verifyPassword(body.current, user.password_hash)).ok) throw new HttpError(403, 'Joriy parol noto\'g\'ri.');
  const pe = sec.checkPasswordPolicy(body.password, { email: user.email }); if (pe) throw new HttpError(400, pe);
  db.run('UPDATE users SET password_hash=?, pw_changed_at=? WHERE id=?', await sec.hashPassword(body.password), db.now(), user.id);
  sec.revokeAllSessions('user', user.id);
  sec.audit({ type: 'user', id: user.id, label: user.email }, 'user.password_change', 'user', user.id, null, null, req);
  return { ok: true, relogin: true };
});

// ---------- Buyurtma va to'lov ----------
async function makeCheckout(o, body) {
  const base = { sandbox: false, url: null, txnId: null };
  const ret = `${PUBLIC_URL}/?order=${o.code}`;
  if (o.provider === 'click' && CLICK_SERVICE_ID && CLICK_MERCHANT_ID)
    return { ...base, url: `https://my.click.uz/services/pay?service_id=${encodeURIComponent(CLICK_SERVICE_ID)}&merchant_id=${encodeURIComponent(CLICK_MERCHANT_ID)}&amount=${(o.amountUzs).toFixed(2)}&transaction_param=${encodeURIComponent(o.paymentId)}&return_url=${encodeURIComponent(ret)}` };
  if (o.provider === 'payme' && PAYME_MERCHANT_ID)
    return { ...base, url: 'https://checkout.paycom.uz/' + Buffer.from(`m=${PAYME_MERCHANT_ID};ac.order_id=${o.paymentId};a=${o.amountUzs * 100}`).toString('base64') };
  if ((o.provider === 'card' || o.provider === 'stripe') && STRIPE_SECRET_KEY) {
    const p = new URLSearchParams();
    p.append('mode', 'payment'); p.append('success_url', ret + '&status=success'); p.append('cancel_url', ret + '&status=cancel');
    p.append('line_items[0][price_data][currency]', 'usd'); p.append('line_items[0][price_data][product_data][name]', o.title.slice(0, 120));
    p.append('line_items[0][price_data][unit_amount]', String(o.amountC)); p.append('line_items[0][quantity]', '1');
    p.append('metadata[paymentId]', o.paymentId); p.append('client_reference_id', o.code);
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() });
    const d = await r.json();
    if (r.ok && d.url) return { ...base, url: d.url, txnId: null };
    throw new HttpError(502, 'Karta to\'lovi sessiyasini yaratib bo\'lmadi. Keyinroq urining.');
  }
  if (DEMO_PAYMENTS) return { ...base, sandbox: true };
  throw new HttpError(503, 'Bu to\'lov usuli hozircha ulanmagan. Boshqa usulni tanlang yoki operator bilan bog\'laning.', { code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
}
route('POST', '/api/payments/create', {}, async ({ req, body, user }) => {
  rl(req, 'pay-create', 20, 3600 * 1000);
  const o = core.prepareOrder(user, body);
  const checkout = await makeCheckout(o, body);
  const r = core.insertOrder(o, checkout);
  return { ok: true, code: r.booking.code, bookingId: r.booking.id, paymentId: r.payment.id, status: r.payment.status, checkoutUrl: checkout.url, sandbox: !!checkout.sandbox,
    amountUsd: core.usd(r.booking.amount_c), amountUzs: r.booking.amount_uzs, priceStatus: o.priceSource === 'server' ? 'verified' : 'estimated' };
});
route('GET', '/api/payments/status/:code', {}, ({ req, params }) => {
  rl(req, 'pay-status', 60, 60000);
  const b = db.get('SELECT b.code,b.status,(SELECT status FROM payments WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1) pay_status FROM bookings b WHERE code=?', str(params.code, 20));
  if (!b) throw new HttpError(404, 'Buyurtma topilmadi.');
  return { ok: true, code: b.code, bookingStatus: b.status, paymentStatus: b.pay_status };
});
// Faqat DEMO_PAYMENTS=true (production emas) va faqat sandbox to'lov uchun
route('POST', '/api/payments/sandbox-confirm', {}, ({ req, body }) => {
  rl(req, 'sbx', 30, 3600 * 1000);
  if (!DEMO_PAYMENTS) throw new HttpError(404, 'Topilmadi.');
  const p = db.get('SELECT * FROM payments WHERE id=?', str(body.paymentId, 40));
  if (!p || !p.is_sandbox) throw new HttpError(404, 'Sandbox to\'lov topilmadi.');
  core.markPaid(p.id, 'sandbox', core.SYSTEM);
  return { ok: true, sandbox: true, note: 'Bu sinov to\'lovi — hisobotlarga kirmaydi.' };
});
function verifyStripeSig(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').map(s => s.trim());
  const t = (parts.find(s => s.startsWith('t=')) || '').slice(2); const v1 = parts.filter(s => s.startsWith('v1=')).map(s => s.slice(3));
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const exp = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return v1.some(s => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}
route('POST', '/api/payments/webhook/stripe', { raw: true }, ({ req, rawBody }) => {
  if (!STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook sozlanmagan.');
  if (!verifyStripeSig(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) throw new HttpError(400, 'Imzo noto\'g\'ri.');
  const ev = JSON.parse(rawBody);
  try { db.run('INSERT INTO payment_events(provider,event_id,received_at,payload) VALUES(?,?,?,?)', 'stripe', String(ev.id), db.now(), JSON.stringify({ type: ev.type })); }
  catch (_) { return { ok: true, duplicate: true }; }
  const obj = ev.data && ev.data.object || {};
  const pid = obj.metadata && obj.metadata.paymentId;
  const p = pid && db.get('SELECT * FROM payments WHERE id=?', pid);
  if (!p) return { ok: true, ignored: true };
  if (ev.type === 'checkout.session.completed' && obj.payment_status === 'paid') {
    if (obj.amount_total !== p.amount_c || String(obj.currency).toLowerCase() !== 'usd') {
      sec.audit(core.SYSTEM, 'payment.amount_mismatch', 'payment', p.id, { expectedC: p.amount_c }, { gotC: obj.amount_total, currency: obj.currency });
      notifyTg(`⚠️ Stripe summa mos kelmadi: ${p.id}`);
      return { ok: true, mismatch: true };
    }
    core.markPaid(p.id, 'stripe', core.SYSTEM, { providerTxnId: obj.payment_intent || obj.id });
    notifyTg(`✅ To'lov keldi: $${core.usd(p.amount_c)} (${p.id})`);
  } else if (ev.type === 'checkout.session.expired') core.failPayment(p.id, 'expired', 'stripe expired');
  return { ok: true };
});
const notImpl = name => () => { throw new HttpError(501, `${name} merchant API hali ulanmagan (Phase 5). To'lov faqat Stripe orqali tasdiqlanadi.`); };
route('POST', '/api/payments/webhook/click', {}, notImpl('Click'));
route('POST', '/api/payments/webhook/payme', {}, notImpl('Payme'));

route('GET', '/api/my/bookings', { auth: 'user' }, ({ user }) => ({ ok: true, bookings: db.all('SELECT id FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 100', user.id).map(r => { const d = core.bookingDetail(r.id); return { ...d.booking, review: d.review, refunds: d.refunds.map(x => ({ amountUsd: x.amountUsd, status: x.status })) }; }) }));
route('POST', '/api/my/bookings/:id/cancel', { auth: 'user' }, ({ user, params }) => ({ ok: true, ...core.cancelByCustomer(user, params.id) }));
route('POST', '/api/my/bookings/:id/review', { auth: 'user' }, ({ user, params, body }) => ({ ok: true, id: core.addReview(user, params.id, body) }));

// ---------- Xodim auth ----------
route('POST', '/api/staff/login', {}, async ({ req, res, body }) => {
  const email = str(body.email, 120).toLowerCase();
  rl(req, 'staff-login', 10, 15 * 60 * 1000); rl(req, 'staff-acct', 6, 15 * 60 * 1000, email);
  const s = db.get('SELECT * FROM staff WHERE email=?', email);
  if (!s || !s.active) { await sec.dummyVerify(body.password); throw new HttpError(401, 'Email yoki parol noto\'g\'ri.'); }
  const lk = lockedMsg(s); if (lk) throw new HttpError(423, lk);
  const v = await sec.verifyPassword(body.password, s.password_hash);
  if (!v.ok) { failLogin('staff', s); sec.audit({ type: 'staff', id: s.id, label: s.name }, 'staff.login_failed', 'staff', s.id, null, null, req); throw new HttpError(401, 'Email yoki parol noto\'g\'ri.'); }
  if (s.totp_enabled) {
    if (!body.totp) throw new HttpError(401, 'Autentifikator kodi kerak.', { need2fa: true });
    const step = sec.verifyTotp(s.totp_secret, String(body.totp), s.totp_last);
    if (!step) { failLogin('staff', s); throw new HttpError(401, 'Autentifikator kodi noto\'g\'ri.', { need2fa: true }); }
    db.run('UPDATE staff SET totp_last=? WHERE id=?', step, s.id);
  }
  if (v.needsRehash) db.run('UPDATE staff SET password_hash=? WHERE id=?', await sec.hashPassword(body.password), s.id);
  db.run('UPDATE staff SET failed_logins=0, locked_until=0, last_login=? WHERE id=?', db.now(), s.id);
  sec.createSession(req, res, 'staff', s.id);
  sec.audit({ type: 'staff', id: s.id, label: s.name }, 'staff.login', 'staff', s.id, null, null, req);
  return { ok: true, staff: staffView(db.get('SELECT * FROM staff WHERE id=?', s.id)) };
});
route('POST', '/api/staff/logout', {}, ({ req, res }) => { sec.destroySession(req, res, 'staff'); return { ok: true }; });
route('GET', '/api/staff/me', { auth: 'staff' }, ({ staff }) => ({ ok: true, staff: staffView(staff), perms: sec.permsOf(staff), roles: sec.ROLE_LABELS }));
route('POST', '/api/staff/password', { auth: 'staff' }, async ({ req, staff, body }) => {
  rl(req, 'staff-pw', 5, 3600 * 1000, staff.id);
  if (!(await sec.verifyPassword(body.current, staff.password_hash)).ok) throw new HttpError(403, 'Joriy parol noto\'g\'ri.');
  const pe = sec.checkPasswordPolicy(body.password, { min: 12, email: staff.email }); if (pe) throw new HttpError(400, pe);
  db.run('UPDATE staff SET password_hash=?, must_change_pw=0, pw_changed_at=? WHERE id=?', await sec.hashPassword(body.password), db.now(), staff.id);
  sec.revokeAllSessions('staff', staff.id);
  sec.audit(core.staffActor(staff), 'staff.password_change', 'staff', staff.id, null, null, req);
  return { ok: true, relogin: true };
});
route('POST', '/api/staff/2fa/setup', { auth: 'staff' }, ({ staff }) => {
  if (staff.totp_enabled) throw new HttpError(409, '2FA allaqachon yoqilgan.');
  const secret = sec.newTotpSecret(); db.run('UPDATE staff SET totp_secret=? WHERE id=?', secret, staff.id);
  return { ok: true, secret, uri: sec.totpUri(secret, staff.email) };
});
route('POST', '/api/staff/2fa/enable', { auth: 'staff' }, ({ req, staff, body }) => {
  if (!staff.totp_secret || staff.totp_enabled) throw new HttpError(409, 'Avval 2FA sozlashni boshlang.');
  const step = sec.verifyTotp(staff.totp_secret, String(body.code), 0); if (!step) throw new HttpError(400, 'Kod noto\'g\'ri.');
  db.run('UPDATE staff SET totp_enabled=1, totp_last=? WHERE id=?', step, staff.id);
  sec.audit(core.staffActor(staff), 'staff.2fa_enable', 'staff', staff.id, null, null, req);
  return { ok: true };
});

// ============================================================ Admin API
const A = (perm, extra = {}) => ({ auth: 'staff', perm, ...extra });
const q = (query, k) => str(query.get(k), 60);
const num = (v, d, min, max) => Math.max(min, Math.min(max, parseInt(v, 10) || d));
route('GET', '/api/admin/dashboard', A('dashboard'), ({ query }) => ({ ok: true, ...core.dashboard(q(query, 'from'), q(query, 'to'), query.get('sandbox') === '1') }));
route('GET', '/api/admin/bookings', A('bookings.read'), ({ query, staff }) => ({ ok: true, ...core.listBookings({ status: q(query, 'status'), type: q(query, 'type'), q: q(query, 'q'), from: q(query, 'from'), to: q(query, 'to'), staffId: query.get('mine') === '1' ? staff.id : q(query, 'staffId'), limit: num(query.get('limit'), 50, 1, 200), offset: num(query.get('offset'), 0, 0, 100000) }) }));
route('GET', '/api/admin/bookings/:id', A('bookings.read'), ({ params }) => { const d = core.bookingDetail(params.id); if (!d) throw new HttpError(404, 'Topilmadi.'); return { ok: true, ...d }; });
route('POST', '/api/admin/bookings/:id/status', A('bookings.write'), ({ staff, params, body }) => {
  core.setBookingStatus(params.id, str(body.status, 20), staff, { note: str(body.note, 300), priceVerified: !!body.priceVerified, refund: !!body.refund });
  return { ok: true, ...core.bookingDetail(params.id) };
});
route('POST', '/api/admin/bookings/:id/assign', A('bookings.write'), ({ staff, params, body }) => {
  const st = db.get('SELECT id,active FROM staff WHERE id=?', str(body.staffId, 40)); if (!st || !st.active) throw new HttpError(404, 'Xodim topilmadi.');
  if (!db.get('SELECT 1 x FROM bookings WHERE id=?', params.id)) throw new HttpError(404, 'Buyurtma topilmadi.');
  core.assignStaff(params.id, st.id, core.staffActor(staff)); return { ok: true };
});
route('GET', '/api/admin/payments', A('payments.read'), ({ query }) => ({ ok: true, payments: core.listPayments({ status: q(query, 'status'), limit: 200 }) }));
// Bank o'tkazmasi/naqd kabi qo'lda tasdiqlash — faqat moliya, izoh majburiy, audit'ga yoziladi
route('POST', '/api/admin/payments/:id/confirm', A('payments.confirm'), ({ staff, params, body }) => {
  const note = str(body.note, 300); if (note.length < 5) throw new HttpError(400, 'Tasdiqlash asosini (masalan, bank o\'tkazma raqami) yozing.');
  const p = db.get('SELECT * FROM payments WHERE id=?', params.id);
  if (p && ['click', 'payme', 'stripe', 'card'].includes(p.provider) && !p.is_sandbox && !body.override) throw new HttpError(409, 'Provayder orqali to\'lanadigan to\'lovni qo\'lda tasdiqlash uchun "override" belgisi kerak.');
  const r = core.markPaid(params.id, 'manual:' + note, core.staffActor(staff));
  return { ok: true, changed: r.changed };
});
route('GET', '/api/admin/refunds', A('payments.read'), ({ query }) => ({ ok: true, refunds: core.listRefunds(q(query, 'status')) }));
route('POST', '/api/admin/payments/:id/refund', A('refunds.request'), ({ staff, params, body }) => {
  const p = db.get('SELECT amount_c, refunded_c FROM payments WHERE id=?', params.id); if (!p) throw new HttpError(404, 'Topilmadi.');
  const amountC = body.full ? p.amount_c - p.refunded_c : core.toC(body.amountUsd);
  return { ok: true, refund: core.requestRefund(params.id, amountC, body.reason, staff) };
});
route('POST', '/api/admin/refunds/:id/approve', A('refunds.approve'), ({ staff, params }) => ({ ok: true, refund: core.approveRefund(params.id, staff, { selfApprove: db.getSetting('refund_self_approve') === 'true' }) }));
route('POST', '/api/admin/refunds/:id/reject', A('refunds.approve'), ({ staff, params, body }) => ({ ok: true, refund: core.rejectRefund(params.id, staff, body.note) }));
route('POST', '/api/admin/refunds/:id/process', A('refunds.approve'), async ({ staff, params, body }) => {
  const r = db.get('SELECT * FROM refunds WHERE id=?', params.id); if (!r) throw new HttpError(404, 'Topilmadi.');
  const p = db.get('SELECT * FROM payments WHERE id=?', r.payment_id);
  if (r.status !== 'approved') throw new HttpError(409, 'Avval so\'rov tasdiqlanishi kerak.');
  let providerRef = str(body.providerRef, 120), method = 'manual';
  if (p.provider === 'stripe' || p.provider === 'card') {
    if (!p.is_sandbox && STRIPE_SECRET_KEY && p.provider_txn_id && p.provider_txn_id.startsWith('pi_')) {
      const f = new URLSearchParams({ payment_intent: p.provider_txn_id, amount: String(r.amount_c) });
      const resp = await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', headers: { Authorization: 'Bearer ' + STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'refund_' + r.id }, body: f.toString() });
      const d = await resp.json();
      if (!resp.ok) throw new HttpError(502, 'Stripe qaytarishni rad etdi: ' + str(d && d.error && d.error.message, 150));
      providerRef = d.id; method = 'stripe_api';
    } else if (!p.is_sandbox && !providerRef) throw new HttpError(400, 'Pul provayder orqali qaytarilgach, uning ma\'lumot raqamini (providerRef) kiriting.');
  } else if (!p.is_sandbox && !providerRef) throw new HttpError(400, 'Pul mijozga qaytarilgach, o\'tkazma raqamini (providerRef) kiriting.');
  return { ok: true, refund: core.processRefund(params.id, core.staffActor(staff), { providerRef, method }) };
});
// Hisob-kitob
route('GET', '/api/admin/accounting', A('accounting.read'), ({ query }) => ({ ok: true, ...core.accounting(q(query, 'from'), q(query, 'to')), payables: core.payables(), expenses: db.all('SELECT * FROM expenses ORDER BY spent_at DESC, created_at DESC LIMIT 100').map(e => ({ id: e.id, category: e.category, description: e.description, amountUsd: core.usd(e.amount_c), spentAt: e.spent_at })), payouts: db.all('SELECT p.*, g.name gname FROM payouts p LEFT JOIN guides g ON g.id=p.party ORDER BY created_at DESC LIMIT 100').map(p => ({ id: p.id, party: p.party, name: p.gname || p.party, amountUsd: core.usd(p.amount_c), method: p.method, reference: p.reference, at: p.created_at })) }));
route('GET', '/api/admin/ledger', A('accounting.read'), ({ query }) => ({ ok: true, entries: core.listLedger(num(query.get('limit'), 200, 1, 1000)) }));
route('POST', '/api/admin/payouts', A('payouts.write'), ({ staff, body }) => ({ ok: true, payout: core.createPayout(str(body.party, 60), core.toC(body.amountUsd), body, staff) }));
route('POST', '/api/admin/expenses', A('accounting.write'), ({ staff, body }) => ({ ok: true, expense: core.addExpense({ category: str(body.category, 30), description: body.description, amountC: core.toC(body.amountUsd), spentAt: str(body.spentAt, 10) }, staff) }));
route('GET', '/api/admin/export', A('accounting.read', { csv: true }), ({ query, staff }) => {
  const type = q(query, 'type'); let rows, cols;
  if (type === 'ledger') { rows = core.listLedger(1000); cols = ['id', 'txnId', 'at', 'account', 'debitUsd', 'creditUsd', 'party', 'refType', 'refId', 'memo']; }
  else if (type === 'payments') { rows = core.listPayments({ limit: 1000 }); cols = ['id', 'bookingCode', 'customer', 'provider', 'status', 'amountUsd', 'refundedUsd', 'sandbox', 'createdAt', 'paidAt']; }
  else if (type === 'bookings') { rows = core.listBookings({ limit: 200 }).bookings.map(b => ({ code: b.code, title: b.title, customer: b.customer.name, contact: b.customer.contact, amountUsd: b.amountUsd, commissionUsd: b.commissionUsd, status: b.status, payStatus: b.payStatus, staff: b.staff && b.staff.name, createdAt: b.createdAt })); cols = ['code', 'title', 'customer', 'contact', 'amountUsd', 'commissionUsd', 'status', 'payStatus', 'staff', 'createdAt']; }
  else throw new HttpError(400, 'type: ledger | payments | bookings');
  sec.audit(core.staffActor(staff), 'export.csv', 'export', type, null, { rows: rows.length });
  return { csv: core.toCsv(rows, cols), filename: `manzil-${type}-${db.now().slice(0, 10)}.csv` };
});
// Xodimlar
route('GET', '/api/admin/staff', A('staff.read'), () => ({ ok: true, staff: db.all('SELECT * FROM staff ORDER BY created_at').map(staffView), roles: sec.ROLE_LABELS }));
route('POST', '/api/admin/staff', A('staff.manage'), async ({ req, staff, body }) => {
  const email = str(body.email, 120).toLowerCase(), name = str(body.name, 80), role = str(body.role, 30);
  if (!sec.isEmail(email) || name.length < 2) throw new HttpError(400, 'Ism va email to\'g\'ri bo\'lsin.');
  if (!sec.ROLE_PERMS[role]) throw new HttpError(400, 'Rol noto\'g\'ri.');
  if (db.get('SELECT 1 x FROM staff WHERE email=?', email)) throw new HttpError(409, 'Bu email band.');
  const pw = crypto.randomBytes(12).toString('base64url'), id = db.uid('st_');
  db.run('INSERT INTO staff(id,name,email,role,password_hash,must_change_pw,created_at,created_by) VALUES(?,?,?,?,?,1,?,?)', id, name, email, role, await sec.hashPassword(pw), db.now(), staff.id);
  sec.audit(core.staffActor(staff), 'staff.create', 'staff', id, null, { email, role }, req);
  return { ok: true, staff: staffView(db.get('SELECT * FROM staff WHERE id=?', id)), oneTimePassword: pw };
});
route('POST', '/api/admin/staff/:id/update', A('staff.manage'), ({ req, staff, params, body }) => {
  const t = db.get('SELECT * FROM staff WHERE id=?', params.id); if (!t) throw new HttpError(404, 'Topilmadi.');
  const role = body.role ? str(body.role, 30) : t.role; if (!sec.ROLE_PERMS[role]) throw new HttpError(400, 'Rol noto\'g\'ri.');
  const active = body.active === undefined ? t.active : (body.active ? 1 : 0);
  if (t.id === staff.id && (!active || role !== t.role)) throw new HttpError(409, 'O\'z rolingiz yoki holatingizni o\'zgartira olmaysiz.');
  if ((t.role === 'super_admin') && (!active || role !== 'super_admin') && db.get("SELECT COUNT(*) c FROM staff WHERE role='super_admin' AND active=1").c <= 1) throw new HttpError(409, 'Oxirgi super adminni o\'chirib bo\'lmaydi.');
  db.run('UPDATE staff SET role=?, active=? WHERE id=?', role, active, t.id);
  if (!active || role !== t.role) sec.revokeAllSessions('staff', t.id);
  sec.audit(core.staffActor(staff), 'staff.update', 'staff', t.id, { role: t.role, active: !!t.active }, { role, active: !!active }, req);
  return { ok: true };
});
route('POST', '/api/admin/staff/:id/reset-password', A('staff.manage'), async ({ req, staff, params }) => {
  const t = db.get('SELECT * FROM staff WHERE id=?', params.id); if (!t) throw new HttpError(404, 'Topilmadi.');
  const pw = crypto.randomBytes(12).toString('base64url');
  db.run('UPDATE staff SET password_hash=?, must_change_pw=1, failed_logins=0, locked_until=0 WHERE id=?', await sec.hashPassword(pw), t.id);
  sec.revokeAllSessions('staff', t.id);
  sec.audit(core.staffActor(staff), 'staff.reset_password', 'staff', t.id, null, null, req);
  return { ok: true, oneTimePassword: pw };
});
route('GET', '/api/admin/performance', A(null, { anyPerm: ['staff.performance', 'staff.performance.self'] }), ({ query, staff }) => {
  const all = sec.can(staff, 'staff.performance');
  return { ok: true, scope: all ? 'all' : 'self', rows: core.staffPerformance(q(query, 'from'), q(query, 'to'), all ? null : staff.id), slaMinutes: Number(db.getSetting('sla_confirm_minutes')) };
});
route('GET', '/api/admin/performance/:id/feedback', A(null, { anyPerm: ['staff.performance', 'staff.performance.self'] }), ({ staff, params }) => {
  if (!sec.can(staff, 'staff.performance') && params.id !== staff.id) throw new HttpError(403, 'Ruxsat yo\'q.');
  return { ok: true, feedback: core.staffFeedback(params.id) };
});
// Foydalanuvchilar
route('GET', '/api/admin/users', A('users.read'), ({ query }) => {
  const s = q(query, 'q').replace(/[%_]/g, ''); const w = s ? 'WHERE name LIKE ? OR email LIKE ?' : '';
  return { ok: true, users: db.all(`SELECT u.*, (SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id) bookings FROM users u ${w} ORDER BY created_at DESC LIMIT 200`, ...(s ? [`%${s}%`, `%${s}%`] : [])).map(u => ({ ...userView(u), status: u.status, lastLogin: u.last_login, bookings: u.bookings })) };
});
route('POST', '/api/admin/users/:id/status', A('users.write'), ({ req, staff, params, body }) => {
  const st = str(body.status, 12); if (!['active', 'suspended'].includes(st)) throw new HttpError(400, 'Holat noto\'g\'ri.');
  const u = db.get('SELECT * FROM users WHERE id=?', params.id); if (!u) throw new HttpError(404, 'Topilmadi.');
  db.run('UPDATE users SET status=? WHERE id=?', st, u.id); if (st !== 'active') sec.revokeAllSessions('user', u.id);
  sec.audit(core.staffActor(staff), 'user.status', 'user', u.id, { status: u.status }, { status: st }, req); return { ok: true };
});
// Gidlar
route('GET', '/api/admin/guides', A('guides.read'), () => ({ ok: true, guides: db.all('SELECT * FROM guides ORDER BY status, created_at DESC').map(g => ({ ...guideView(g), commissionRate: g.commission_rate, bookings: db.get("SELECT COUNT(*) n FROM bookings WHERE guide_id=? AND status IN ('confirmed','completed')", g.id).n })) }));
route('POST', '/api/admin/guides/:id/status', A('guides.write'), ({ req, staff, params, body }) => {
  const g = db.get('SELECT * FROM guides WHERE id=?', params.id); if (!g) throw new HttpError(404, 'Topilmadi.');
  const st = str(body.status, 12) || g.status; if (!['pending', 'approved', 'rejected', 'suspended'].includes(st)) throw new HttpError(400, 'Holat noto\'g\'ri.');
  let cr = g.commission_rate; if (body.commissionRate !== undefined && body.commissionRate !== null && body.commissionRate !== '') { cr = Number(body.commissionRate); if (!(cr >= 0 && cr <= 0.5)) throw new HttpError(400, 'Komissiya 0–0.5 oralig\'ida.'); }
  db.run('UPDATE guides SET status=?, verified=?, commission_rate=?, updated_at=? WHERE id=?', st, body.verified === undefined ? g.verified : (body.verified ? 1 : 0), cr, db.now(), g.id);
  sec.audit(core.staffActor(staff), 'guide.update', 'guide', g.id, { status: g.status, verified: !!g.verified, commission: g.commission_rate }, { status: st, verified: body.verified, commission: cr }, req); return { ok: true };
});
// Manzillar
const destBody = b => { const d = {}; for (const k of ['name', 'country', 'region', 'category', 'season', 'description', 'transport', 'accommodation', 'safety', 'hours']) if (b[k] !== undefined) d[k] = str(b[k], 600); for (const k of ['dailyBudgetUsd', 'lat', 'lng', 'entranceFeeUsd']) if (b[k] !== undefined && b[k] !== '') d[k] = Number(b[k]) || 0; if (!d.name) throw new HttpError(400, 'Manzil nomi kerak.'); return d; };
route('GET', '/api/admin/destinations', A('destinations.write'), () => ({ ok: true, destinations: db.all('SELECT * FROM destinations ORDER BY created_at DESC').map(d => ({ ...JSON.parse(d.data), id: d.id, priceStatus: d.price_status, archived: !!d.archived })) }));
route('POST', '/api/admin/destinations', A('destinations.write'), ({ req, staff, body }) => {
  const d = destBody(body), id = db.uid('dst_'), ps = ['verified', 'estimated', 'unavailable'].includes(body.priceStatus) ? body.priceStatus : 'estimated';
  db.run('INSERT INTO destinations(id,data,price_status,created_at,updated_at) VALUES(?,?,?,?,?)', id, JSON.stringify(d), ps, db.now(), db.now());
  sec.audit(core.staffActor(staff), 'destination.create', 'destination', id, null, { ...d, priceStatus: ps }, req); return { ok: true, id };
});
route('POST', '/api/admin/destinations/:id/update', A('destinations.write'), ({ req, staff, params, body }) => {
  const o = db.get('SELECT * FROM destinations WHERE id=?', params.id); if (!o) throw new HttpError(404, 'Topilmadi.');
  const d = destBody({ ...JSON.parse(o.data), ...body }), ps = ['verified', 'estimated', 'unavailable'].includes(body.priceStatus) ? body.priceStatus : o.price_status;
  const arch = body.archived === undefined ? o.archived : (body.archived ? 1 : 0);
  db.run('UPDATE destinations SET data=?, price_status=?, archived=?, updated_at=? WHERE id=?', JSON.stringify(d), ps, arch, db.now(), o.id);
  sec.audit(core.staffActor(staff), 'destination.update', 'destination', o.id, { ...JSON.parse(o.data), priceStatus: o.price_status, archived: !!o.archived }, { ...d, priceStatus: ps, archived: !!arch }, req); return { ok: true };
});
// Fikr va sharhlar
route('GET', '/api/admin/feedback', A('feedback.read'), () => ({ ok: true, feedback: db.all('SELECT f.*, s.name handler FROM feedback f LEFT JOIN staff s ON s.id=f.handled_by ORDER BY created_at DESC LIMIT 200').map(f => ({ id: f.id, name: f.name, contact: f.contact, type: f.type, message: f.message, status: f.status, handler: f.handler, at: f.created_at })),
  reviews: db.all('SELECT r.*, b.code, b.customer_name, s.name staff_name, g.name guide_name FROM reviews r JOIN bookings b ON b.id=r.booking_id LEFT JOIN staff s ON s.id=r.staff_id LEFT JOIN guides g ON g.id=r.guide_id ORDER BY r.created_at DESC LIMIT 200').map(r => ({ code: r.code, customer: r.customer_name, rating: r.rating, serviceRating: r.service_rating, comment: r.comment, staff: r.staff_name, guide: r.guide_name, at: r.created_at })) }));
route('POST', '/api/admin/feedback/:id/handle', A('feedback.write'), ({ req, staff, params, body }) => {
  const st = str(body.status, 12) || 'handled'; if (!['new', 'handled', 'spam'].includes(st)) throw new HttpError(400, 'Holat noto\'g\'ri.');
  db.run('UPDATE feedback SET status=?, handled_by=? WHERE id=?', st, staff.id, params.id);
  sec.audit(core.staffActor(staff), 'feedback.handle', 'feedback', params.id, null, { status: st }, req); return { ok: true };
});
// Ochiq ma'lumotlar bazasi ko'rinishi (faqat super admin; parol xeshlari yashirin)
route('GET', '/api/admin/db', A('db.view'), () => ({ ok: true, engine: 'SQLite (node:sqlite)', location: db.IN_MEMORY ? 'xotirada (:memory:)' : db.DB_PATH, note: 'Parollar hech qachon ochiq matnda saqlanmaydi: faqat scrypt xeshi (qaytarib bo\'lmaydi). Bu yerda u yashirilgan.', tables: db.VIEWABLE_TABLES.map(t => ({ name: t, rows: db.get(`SELECT COUNT(*) c FROM ${t}`).c })) }));
route('GET', '/api/admin/db/:table', A('db.view'), ({ req, staff, params, query }) => {
  if (!db.VIEWABLE_TABLES.includes(params.table)) throw new HttpError(404, 'Jadval topilmadi.');
  const limit = num(query.get('limit'), 50, 1, 200), offset = num(query.get('offset'), 0, 0, 1e7);
  const cols = db.all(`PRAGMA table_info(${params.table})`).map(c => c.name);
  const order = cols.includes('created_at') ? 'created_at DESC' : cols.includes('seq') ? 'seq DESC' : cols.includes('id') ? 'id DESC' : 'rowid DESC';
  const rows = db.all(`SELECT * FROM ${params.table} ORDER BY ${order} LIMIT ? OFFSET ?`, limit, offset).map(r => {
    const o = {}; for (const c of cols) { const v = r[c]; o[c] = db.MASKED_COLUMNS.has(c) ? (v ? `[yashirin: ${String(v).startsWith('scrypt$') ? 'scrypt xesh' : 'maxfiy'}]` : null) : (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v); }
    return o;
  });
  sec.audit(core.staffActor(staff), 'db.view', 'table', params.table, null, { limit, offset }, req);
  return { ok: true, table: params.table, columns: cols, masked: cols.filter(c => db.MASKED_COLUMNS.has(c)), total: db.get(`SELECT COUNT(*) c FROM ${params.table}`).c, rows };
});
// Audit
route('GET', '/api/admin/audit', A('audit.read'), ({ query }) => {
  const ent = q(query, 'entity'), lim = num(query.get('limit'), 100, 1, 500);
  const rows = db.all(`SELECT seq,at,actor_type,actor_label,action,entity,entity_id,payload,hash FROM audit ${ent ? 'WHERE entity=?' : ''} ORDER BY seq DESC LIMIT ?`, ...(ent ? [ent] : []), lim);
  return { ok: true, entries: rows.map(r => { const p = JSON.parse(r.payload); return { seq: r.seq, at: r.at, actor: r.actor_label, actorType: r.actor_type, action: r.action, entity: r.entity, entityId: r.entity_id, before: p.before, after: p.after, ip: p.ip, hash: r.hash.slice(0, 12) }; }) };
});
route('GET', '/api/admin/audit/verify', A('audit.read'), () => ({ ok: true, ...sec.verifyAuditChain() }));
// Sozlamalar
const SETTING_KEYS = ['commission_rate', 'usd_uzs_rate', 'sla_confirm_minutes', 'cancel_policy', 'refund_self_approve'];
route('GET', '/api/admin/settings', A('settings.write'), () => ({ ok: true, settings: Object.fromEntries(SETTING_KEYS.map(k => [k, db.getSetting(k)])), integrations: { stripe: !!STRIPE_SECRET_KEY, stripeWebhook: !!STRIPE_WEBHOOK_SECRET, click: !!(CLICK_SERVICE_ID && CLICK_MERCHANT_ID), payme: !!PAYME_MERCHANT_ID, telegram: !!TG_TOKEN, openai: !!OPENAI_API_KEY, demoPayments: DEMO_PAYMENTS, production: IS_PROD }, ai: { today: aiDaily.n, limit: AI_DAILY_LIMIT, total: db.get('SELECT COUNT(*) c FROM ai_log').c, fallback: db.get("SELECT COUNT(*) c FROM ai_log WHERE provider='local-fallback'").c } }));
route('POST', '/api/admin/settings', A('settings.write'), ({ req, staff, body }) => {
  const before = {}, after = {};
  for (const k of SETTING_KEYS) {
    if (body[k] === undefined) continue;
    let v = String(body[k]);
    if (k === 'commission_rate' && !(Number(v) >= 0 && Number(v) <= 0.5)) throw new HttpError(400, 'Komissiya 0–0.5.');
    if (k === 'usd_uzs_rate' && !(Number(v) >= 1000 && Number(v) <= 100000)) throw new HttpError(400, 'Kurs noto\'g\'ri.');
    if (k === 'sla_confirm_minutes' && !(Number(v) >= 1 && Number(v) <= 10080)) throw new HttpError(400, 'SLA noto\'g\'ri.');
    if (k === 'refund_self_approve' && !['true', 'false'].includes(v)) throw new HttpError(400, 'true/false.');
    if (k === 'cancel_policy') { try { const p = JSON.parse(v); if (!Array.isArray(p) || !p.every(r => Number.isFinite(r.minDays) && r.pct >= 0 && r.pct <= 100)) throw 0; v = JSON.stringify(p); } catch (_) { throw new HttpError(400, 'Bekor qilish siyosati JSON noto\'g\'ri.'); } }
    before[k] = db.getSetting(k); after[k] = v; db.setSetting(k, v);
  }
  sec.audit(core.staffActor(staff), 'settings.update', 'settings', 'global', before, after, req); return { ok: true };
});

// ============================================================ Telegram (bildirishnoma; webhook maxfiy URL bilan)
async function notifyTg(text) {
  if (!TG_TOKEN || !TG_ADMIN_CHAT) return;
  try { await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TG_ADMIN_CHAT, text: String(text).slice(0, 3500) }) }); } catch (_) {}
}

// ============================================================ Statik fayllar
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : (pathname === '/admin' || pathname === '/admin/') ? '/admin.html' : pathname;
  try { p = decodeURIComponent(p); } catch (_) { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || p.includes('\0') || path.basename(file).startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// ============================================================ Asosiy handler
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const isApi = url.pathname.startsWith('/api/');
  securityHeaders(res, isApi);
  if (!isApi) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  }
  const origin = req.headers.origin;
  if (origin && originOk(req)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
  if (req.method === 'OPTIONS') { res.writeHead(originOk(req) ? 204 : 403); return res.end(); }
  try {
    const isWebhook = url.pathname.startsWith('/api/payments/webhook/');
    if (req.method !== 'GET' && !isWebhook && !originOk(req)) throw new HttpError(403, 'Origin ruxsat etilmagan.');
    let match = null;
    for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(url.pathname); if (m) { match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; } }
    if (!match) throw new HttpError(404, 'Endpoint topilmadi.');
    const { r, params } = match;
    rl(req, 'api', 300, 60000);
    const ctx = { req, res, params, query: url.searchParams, user: null, staff: null };
    if (r.opts.auth === 'staff') {
      ctx.staff = currentStaff(req);
      if (!ctx.staff) throw new HttpError(401, 'Tizimga kiring.');
      if (ctx.staff.must_change_pw && !['/api/staff/password', '/api/staff/me', '/api/staff/logout'].includes(url.pathname)) throw new HttpError(403, 'Avval parolni almashtiring.', { mustChangePw: true });
      const ok = r.opts.anyPerm ? r.opts.anyPerm.some(p => sec.can(ctx.staff, p)) : sec.can(ctx.staff, r.opts.perm);
      if (!ok) { sec.audit(core.staffActor(ctx.staff), 'access.denied', 'route', url.pathname, null, { perm: r.opts.perm || r.opts.anyPerm }, req); throw new HttpError(403, 'Bu amal uchun ruxsatingiz yo\'q.'); }
    } else {
      ctx.user = currentUser(req);
      if (r.opts.auth === 'user' && !ctx.user) throw new HttpError(401, 'Tizimga kiring.');
    }
    if (r.opts.raw) ctx.rawBody = await readRaw(req); else if (req.method === 'POST') ctx.body = await readJson(req); else ctx.body = {};
    const out = await r.fn(ctx);
    if (out && out.csv) {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"` });
      return res.end(out.csv);
    }
    sendJson(res, 200, out || { ok: true });
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.extra && e.extra.retryAfter) res.setHeader('Retry-After', e.extra.retryAfter);
      return sendJson(res, e.status, { ok: false, error: e.message, ...(e.extra || {}) });
    }
    console.error('[xato]', req.method, req.url, e && e.stack || e);
    sendJson(res, 500, { ok: false, error: 'Ichki server xatosi.' });
  }
}

const server = http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); try { res.writeHead(500); res.end(); } catch (_) {} }); });
server.requestTimeout = 30000; server.headersTimeout = 15000;

if (require.main === module) {
  bootstrapAdmin().then(() => server.listen(PORT, () => console.log(`Manzil v${VERSION} :${PORT} | baza: ${db.IN_MEMORY ? 'xotirada' : db.DB_PATH} | ${IS_PROD ? 'production' : 'development'}`)));
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
}
module.exports = { server, bootstrapAdmin };
