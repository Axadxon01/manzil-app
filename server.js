/**
 * Manzil — Backend Server (Zero npm dependencies, Node.js 18+)
 * Phase 1: xavfsizlik va poydevor (security & foundation)
 *
 * Nima o'zgardi (v2.2.0):
 *  - ADMIN_KEY / JWT_SECRET endi kodda yozilmagan. Productionda .env da bo'lmasa server ishga tushmaydi.
 *  - Admin kaliti faqat header (X-Admin-Key / Bearer) yoki admin-token orqali; URL (?key=) orqali emas.
 *  - To'lov faqat provayder webhooki (Stripe imzosi tekshiriladi) yoki admin orqali "paid" bo'ladi.
 *    /api/payments/confirm endi hech kimga ochiq emas (faqat sandbox/dev rejimida).
 *  - Sandbox to'lovlar daromadga qo'shilmaydi va productionda o'chirilgan.
 *  - Audit log (data/audit.log, append-only): kim, nima, qachon, avvalgi va yangi qiymat.
 *  - Rate limiting (login, register, admin, AI, feedback, ariza, to'lov).
 *  - CORS faqat ruxsat etilgan originlar uchun, xavfsizlik headerlari.
 *  - Telegram webhook maxfiy token bilan himoyalangan; TELEGRAM_CHAT_ID bo'sh bo'lsa hech kim admin emas.
 *  - Parol kamida 8 belgi, login vaqt-xavfsiz, JSON yozish atomik.
 *  - Manzillarga priceStatus: verified | estimated | unavailable.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// 1. Oddiy .env yuklovchi (npm dotenv kerak emas)
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadEnvFile();

// 2. Konfiguratsiya
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

// Eski, ommaviy bo'lib qolgan qiymatlar — hech qachon qabul qilinmaydi
const KNOWN_WEAK_SECRETS = [
  'manzil-admin-2026',
  'manzil-secret-key-change-in-production-2026',
  'manzil-super-secret-jwt-key-2026'
];

function requireSecret(name, minLen) {
  const v = process.env[name] || '';
  if (v.length >= minLen && !KNOWN_WEAK_SECRETS.includes(v)) return v;
  if (IS_PROD) {
    console.error(`\n[FATAL] ${name} sozlanmagan yoki juda zaif (kamida ${minLen} belgi, eski standart qiymat bo'lmasligi kerak).`);
    console.error(`        Render > Environment bo'limida ${name} ni kuchli tasodifiy qiymatga o'rnating.\n`);
    process.exit(1);
  }
  const generated = crypto.randomBytes(24).toString('hex');
  console.warn(`[WARN] ${name} .env da yo'q — vaqtinchalik tasodifiy qiymat ishlatilmoqda (har qayta ishga tushirishda o'zgaradi).`);
  if (name === 'ADMIN_KEY') console.warn(`[WARN] Bu ishga tushirish uchun ADMIN_KEY = ${generated}`);
  return generated;
}

const ADMIN_KEY = requireSecret('ADMIN_KEY', 16);
const JWT_SECRET = requireSecret('JWT_SECRET', 32);
const COMMISSION_RATE = Math.min(0.5, Math.max(0, Number(process.env.COMMISSION_RATE || 0.12)));

// CORS: faqat ruxsat etilgan originlar (vergul bilan ajrating). Standart: PUBLIC_URL
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || PUBLIC_URL)
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

// Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
// Webhook so'rovlari haqiqatan Telegramdan kelganini tekshirish uchun maxfiy token
const TG_WEBHOOK_SECRET = crypto.createHash('sha256')
  .update('tg-webhook:' + TELEGRAM_BOT_TOKEN + ':' + JWT_SECRET).digest('hex').slice(0, 48);

// Real AI (OpenAI & Grok / xAI)
const AI_PROVIDER = (process.env.AI_PROVIDER || 'auto').toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GROK_API_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3-mini';
const AI_DAILY_LIMIT = Math.max(0, Number(process.env.AI_DAILY_LIMIT || 500)); // kuniga umumiy pullik so'rovlar

// To'lov provayderlari
const CLICK_SERVICE_ID = process.env.CLICK_SERVICE_ID || '';
const CLICK_MERCHANT_ID = process.env.CLICK_MERCHANT_ID || '';
const PAYME_MERCHANT_ID = process.env.PAYME_MERCHANT_ID || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Sandbox (demo) to'lov: developmentda yoqilgan, productionda faqat ALLOW_DEMO_PAYMENTS=true bo'lsa
const DEMO_PAYMENTS = !IS_PROD || process.env.ALLOW_DEMO_PAYMENTS === 'true';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const FILES = {
  destinations: path.join(DATA_DIR, 'destinations.json'),
  guides: path.join(DATA_DIR, 'guides.json'),
  feedback: path.join(DATA_DIR, 'feedback.json'),
  users: path.join(DATA_DIR, 'users.json'),
  payments: path.join(DATA_DIR, 'payments.json'),
  chats: path.join(DATA_DIR, 'chats.json'),
  audit: path.join(DATA_DIR, 'audit.log')
};

const SEED_GUIDES = [
  { id: 'guide_seed_1', name: 'Azizbek Karimov', city: 'Samarqand', country: "O'zbekiston", langs: "O'zbek, Rus, Ingliz", spec: 'Tarixiy obidalar va Registon sirlari', rate: 45, exp: 7, tg: 'azizbek_samarkand_guide', group: '28-noyabr · Samarqand + Shahrisabz (3 joy qoldi)', approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_2', name: 'Nilufar Raximova', city: 'Buxoro', country: "O'zbekiston", langs: "O'zbek, Ingliz, Fransuz", spec: "Eski shahar me'morchiligi va gastronomiya", rate: 40, exp: 5, tg: 'nilufar_bukhara', group: '', approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_3', name: 'Temur Jumaniyozov', city: "Mo'ynoq va Orolbo'yi", country: "O'zbekiston", langs: "O'zbek, Qoraqalpoq, Rus", spec: "4x4 Ustyurt kanyonlari va Orolbo'yi ekspeditsiyasi", rate: 95, exp: 8, tg: 'aral_expedition_uz', group: "5-dekabr · Nukus → Ustyurt → Mo'ynoq (2 joy qoldi)", approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_4', name: 'Emre Yilmaz', city: 'Istanbul', country: 'Turkiya', langs: "O'zbek, Turk, Rus", spec: 'Istanbul sirlari, Bosfor va xarid turlari', rate: 75, exp: 6, tg: 'emre_istanbul_uz', group: 'Har shanba · Sultonahmet va Osiyo qismi piyoda turi', approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_5', name: 'Giorgi Beridze', city: 'Tbilisi va Qozbegi', country: 'Gruziya', langs: 'Rus, Ingliz, Gruzin', spec: "Qozbegi tog'lari, Kaxetiya va oilaviy turlar", rate: 70, exp: 6, tg: 'giorgi_georgia_tour', group: '12-dekabr · Tbilisi → Ananuri → Qozbegi', approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_6', name: 'Sardor Toshmatov', city: 'Dubay', country: 'BAA', langs: "O'zbek, Rus, Ingliz", spec: "VIP transfer, Cho'l safari va Abu-Dabi turi", rate: 90, exp: 5, tg: 'dubai_uz_guide', group: '', approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_7', name: 'Madina Alimova', city: 'Parij', country: 'Fransiya', langs: "O'zbek, Fransuz, Ingliz", spec: 'Luvr, Monmartr va fotosessiya turlari', rate: 110, exp: 5, tg: 'madina_paris_guide', group: '', approved: true, commissionRate: COMMISSION_RATE },
  { id: 'guide_seed_8', name: 'Bekzod Xolmatov', city: 'Seul', country: 'Janubiy Koreya', langs: "O'zbek, Koreys, Rus", spec: 'Seul saroylari, K-pop va tibbiy/xarid turlari', rate: 85, exp: 4, tg: 'bekzod_seoul', group: '', approved: true, commissionRate: COMMISSION_RATE }
];

// 3. JSON Ma'lumotlar bazasi yordamchilari
function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES.destinations)) fs.writeFileSync(FILES.destinations, '[]', 'utf8');
  if (!fs.existsSync(FILES.guides)) fs.writeFileSync(FILES.guides, JSON.stringify(SEED_GUIDES, null, 2), 'utf8');
  if (!fs.existsSync(FILES.feedback)) fs.writeFileSync(FILES.feedback, '[]', 'utf8');
  if (!fs.existsSync(FILES.users)) fs.writeFileSync(FILES.users, '[]', 'utf8');
  if (!fs.existsSync(FILES.payments)) fs.writeFileSync(FILES.payments, '[]', 'utf8');
  if (!fs.existsSync(FILES.chats)) fs.writeFileSync(FILES.chats, '[]', 'utf8');
  if (!fs.existsSync(FILES.audit)) fs.writeFileSync(FILES.audit, '', 'utf8');
}
ensureDataStore();

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

// Atomik yozish: avval vaqtinchalik fayl, keyin rename — server o'rtada to'xtasa ham fayl buzilmaydi
function writeJson(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// 3.1 Audit log (append-only, hech qachon qisqartirilmaydi)
function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = JSON.parse(JSON.stringify(obj));
  delete copy.passwordHash;
  return copy;
}

function clientIp(req) {
  // Render kabi proksi orqasida birinchi qiymat mijoz IP si. (Proksisiz holatda soxtalashtirilishi mumkin.)
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function audit(req, action, entity, entityId, before, after, actor) {
  try {
    const entry = {
      id: 'aud_' + crypto.randomBytes(5).toString('hex'),
      at: new Date().toISOString(),
      actor: actor || 'admin',
      ip: req ? clientIp(req) : null,
      action,
      entity,
      entityId: entityId == null ? '' : String(entityId),
      before: stripSecrets(before) ?? null,
      after: stripSecrets(after) ?? null
    };
    fs.appendFileSync(FILES.audit, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[audit] yozib bo‘lmadi:', e.message);
  }
}

function readAudit(limit = 200, entity = '') {
  try {
    const lines = fs.readFileSync(FILES.audit, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (!entity || e.entity === entity) out.push(e);
      } catch (_) {}
    }
    return out;
  } catch (e) {
    return [];
  }
}

// 3.2 Rate limiting (xotirada; bitta server uchun yetarli)
const rateBuckets = new Map();
function rateLimit(req, name, max, windowMs, extraKey = '') {
  const key = `${name}:${clientIp(req)}:${extraKey}`;
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.reset < now) b = { count: 0, reset: now + windowMs };
  b.count++;
  rateBuckets.set(key, b);
  return b.count <= max ? 0 : Math.max(1, Math.ceil((b.reset - now) / 1000));
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.reset < now) rateBuckets.delete(k);
}, 60 * 1000).unref();

// Frontend va Backend gid obyektini birxillashtirish
function normalizeGuideForClient(g) {
  const status = g.rejected ? 'rejected' : (g.approved === false ? 'pending' : 'approved');
  return {
    ...g,
    price: Number(g.price ?? g.rate ?? 50),
    rate: Number(g.rate ?? g.price ?? 50),
    exp: Number(g.exp ?? 3),
    contact: g.contact || (g.tg ? '@' + String(g.tg).replace(/^@/, '') : ''),
    tg: String(g.tg || g.contact || '').replace(/^@/, ''),
    bio: g.bio || g.spec || g.about || '',
    spec: g.spec || g.bio || '',
    status
  };
}

// Ma'lumot ishonchliligi: verified | estimated | unavailable
const PRICE_STATUSES = ['verified', 'estimated', 'unavailable'];
function normalizeDestinationForClient(d) {
  return { ...d, priceStatus: PRICE_STATUSES.includes(d.priceStatus) ? d.priceStatus : 'estimated' };
}

// Admin tahrirlashi mumkin bo'lgan maydonlar (mass-assignment'dan himoya)
function pickDestinationFields(body) {
  const out = {};
  const str = (k, max = 2000) => { if (body[k] !== undefined) out[k] = String(body[k]).trim().slice(0, max); };
  const num = (k) => { if (body[k] !== undefined && Number.isFinite(Number(body[k])) && Number(body[k]) >= 0) out[k] = Number(body[k]); };
  ['name', 'country', 'region', 'desc', 'image', 'bestSeason', 'entranceFee', 'openingHours', 'safetyNotes', 'transportInfo'].forEach(k => str(k));
  ['flightBase', 'hotelNight', 'foodDay', 'transportDay', 'activitiesDay', 'tourBase5d'].forEach(num);
  if (body.lat !== undefined && Math.abs(Number(body.lat)) <= 90) out.lat = Number(body.lat);
  if (body.lng !== undefined && Math.abs(Number(body.lng)) <= 180) out.lng = Number(body.lng);
  if (body.scope !== undefined) out.scope = body.scope === 'world' ? 'world' : 'uz';
  if (Array.isArray(body.bestMonths)) out.bestMonths = body.bestMonths.map(Number).filter(m => m >= 1 && m <= 12);
  if (Array.isArray(body.tags)) out.tags = body.tags.map(t => String(t).slice(0, 40)).slice(0, 20);
  if (body.priceStatus !== undefined && PRICE_STATUSES.includes(body.priceStatus)) {
    out.priceStatus = body.priceStatus;
    if (body.priceStatus === 'verified') out.verifiedAt = new Date().toISOString();
  }
  return out;
}

// 4. Telegram xabarnoma yuboruvchi
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return { sent: false, reason: 'TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const data = await res.json();
    return { sent: Boolean(data.ok), response: data };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

function escHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 5. Parol xeshlash va Token (zero-dependency crypto)
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const hashBuffer = crypto.scryptSync(String(password), salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  if (hashBuffer.length !== keyBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, keyBuffer);
}
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

const USER_TOKEN_TTL = 60 * 60 * 24 * 7;   // 7 kun
const ADMIN_TOKEN_TTL = 60 * 60 * 8;       // 8 soat

function signToken(payloadObj, ttlSec = USER_TOKEN_TTL) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payloadObj, iat: now, exp: now + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function bearerOf(req) {
  const authHeader = req.headers['authorization'] || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function getAuthUser(req) {
  const payload = verifyToken(bearerOf(req));
  if (!payload || !payload.sub) return null;
  const users = readJson(FILES.users, []);
  return users.find(u => u.id === payload.sub) || null;
}

/**
 * Admin tekshiruvi. Qabul qilinadi:
 *  - X-Admin-Key header yoki Bearer <ADMIN_KEY>
 *  - Bearer <admin JWT> (/api/admin/sso dan, 8 soat amal qiladi)
 *  - POST body'dagi adminKey (eski frontend bilan moslik uchun)
 * URL (?key=) endi qabul qilinmaydi — u loglarda va brauzer tarixida qoladi.
 * Noto'g'ri urinishlar IP bo'yicha cheklanadi (15 daqiqada 10 ta).
 */
function isAdmin(req, urlObj, bodyObj = {}) {
  const key = req.headers['x-admin-key'] || bearerOf(req) || (bodyObj && bodyObj.adminKey) || '';
  if (!key) return false;
  if (rateBuckets.get(`adminfail:${clientIp(req)}:`)?.count >= 10 && rateBuckets.get(`adminfail:${clientIp(req)}:`).reset > Date.now()) {
    return false;
  }
  let ok = safeEqual(key, ADMIN_KEY);
  if (!ok) {
    const payload = verifyToken(key);
    ok = Boolean(payload && payload.role === 'admin' && payload.sub === 'admin_master');
  }
  if (!ok) rateLimit(req, 'adminfail', 10, 15 * 60 * 1000);
  return ok;
}

function adminActor(req) {
  const t = verifyToken(req.headers['x-admin-key'] || bearerOf(req));
  return t && t.role === 'admin' ? 'admin-sso' : 'admin-key';
}

// 6. Real AI (OpenAI / Grok) + Fallback
const aiDaily = { day: '', count: 0 };
function aiQuotaAvailable() {
  const day = new Date().toISOString().slice(0, 10);
  if (aiDaily.day !== day) { aiDaily.day = day; aiDaily.count = 0; }
  if (AI_DAILY_LIMIT && aiDaily.count >= AI_DAILY_LIMIT) return false;
  aiDaily.count++;
  return true;
}

function buildLocalAiFallback(message, context = {}) {
  const t = String(message || '').toLowerCase();
  const days = context.days || 5;
  const rate = context.rate || 12850;
  if (/salom|assalom|hello|hi/.test(t)) {
    return 'Assalomu alaykum! Men Manzil AI yordamchisiman. Sizga 105+ sayohat manzili, O‘zbekistonliklar uchun viza tartibi, byudjet hisob-kitobi, mahalliy gid topish yoki tur-paket band qilishda yordam beraman. Qayerga sayohat qilishni rejalashtiryapsiz?';
  }
  if (/viza|vizasiz/.test(t)) {
    return 'O‘zbekiston fuqarolari uchun vizasiz davlatlar: Turkiya (90 kun), Gruziya (1 yil), BAA (30 kun), Qozog‘iston (30 kun), Qirg‘iziston (60 kun), Tojikiston (30 kun), Tailand (60 kun), Maldiv (30 kun), Indoneziya (30 kun VOA), Ummon (14 kun) va Xitoy (30 kun). Qoidalar o‘zgarib turadi — safardan oldin rasmiy manbada tekshiring. Asosiy ekranda «🛂 Vizasiz» tugmasini bosing.';
  }
  if (/byudjet|narx|qancha|pul|so‘m|som/.test(t)) {
    return `Hozirgi tanlangan ${days} kunlik safar va 1$ = ${Number(rate).toLocaleString('ru-RU')} so‘m kursi bo‘yicha mustaqil (DIY) sayohat odatda arzonroq tushadi. Diqqat: kartochkalardagi narxlar taxminiy (estimated) — aniq narxni band qilishdan oldin tekshiring.`;
  }
  if (/gid|qo‘shil|qoshil|operator|komissiya/.test(t)) {
    return '«🧭 Gidlar» bo‘limidan hududiy gidlarni topishingiz, aloqaga chiqishingiz yoki onlayn band qilishingiz mumkin. Gid sifatida qo‘shilish bepul — platforma har bir sotilgan paketdan 12% komissiya oladi, 88% gidga qoladi.';
  }
  if (/to‘lov|tolov|click|payme|karta|stripe/.test(t)) {
    return 'Platformada Click, Payme va xalqaro Visa/Mastercard (Stripe) orqali to‘lov qilish rejalashtirilgan. To‘lov faqat provayder tasdiqlagandan so‘ng «to‘langan» bo‘ladi.';
  }
  return `Savolingiz bo‘yicha tavsiya: ${days} kunlik sayohatingiz uchun manzillarni marshrutga qo‘shing, byudjetni DIY yoki Tur-paket rejimida solishtiring va kerak bo‘lsa hududiy gidni tanlang. Aniq shahar nomini yozsangiz, viza va xarajatlar bo‘yicha batafsil ma’lumot beraman!`;
}

async function generateAiReply(message, history = [], context = {}, requestedProvider = 'auto') {
  const pref = (requestedProvider || AI_PROVIDER || 'auto').toLowerCase();
  let chosen = 'fallback';

  if (pref === 'openai' && OPENAI_API_KEY) chosen = 'openai';
  else if (pref === 'grok' && GROK_API_KEY) chosen = 'grok';
  else if (pref === 'auto') {
    if (AI_PROVIDER === 'grok' && GROK_API_KEY) chosen = 'grok';
    else if (OPENAI_API_KEY) chosen = 'openai';
    else if (GROK_API_KEY) chosen = 'grok';
  }

  if (chosen !== 'fallback' && !aiQuotaAvailable()) chosen = 'fallback';

  if (chosen === 'fallback') {
    return {
      reply: buildLocalAiFallback(message, context),
      providerUsed: 'local-fallback',
      model: 'manzil-rules-v2'
    };
  }

  const isGrok = chosen === 'grok';
  const endpoint = isGrok
    ? 'https://api.x.ai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const apiKey = isGrok ? GROK_API_KEY : OPENAI_API_KEY;
  const model = isGrok ? GROK_MODEL : OPENAI_MODEL;

  context = context && typeof context === 'object' ? context : {};
  const planSummary = Array.isArray(context.plan) && context.plan.length
    ? context.plan.slice(0, 20).map(p => `${String(p.name || '').slice(0, 60)} (${Number(p.days) || 0} kun)`).join(', ')
    : 'Hali tanlanmagan';

  const systemPrompt = [
    "Siz Manzil sayohat ekotizimining (105+ mahalliy va xalqaro manzillar, gidlar katalogi, aviachipta qidiruvi va tur-paketlar platformasi) rasmiy AI sayohat maslahatchisisiz.",
    "Foydalanuvchilarga o'zbek tilida (agar boshqa tilda yozsa, o'sha tilda) aniq, samimiy, lo'nda va amaliy javob bering.",
    "O'zbekiston fuqarolari uchun viza tartiblari, byudjet rejalashtirish, mustaqil (DIY) va tur-paket farqlari, mahalliy gidlar (12% platforma komissiyasi) haqida ma'lumot bering.",
    "Muhim: narxlar, viza qoidalari va ish vaqtlari o'zgarishi mumkin. Tasdiqlanmagan narxni aniq narx sifatida bermang — 'taxminan' deb belgilang va rasmiy manbada tekshirishni tavsiya qiling.",
    `Foydalanuvchi joriy konteksti: Uchish shahri = ${String(context.origin || 'TAS').slice(0, 10)}, Safar kunlari = ${Number(context.days) || 5} kun, Sayohatchilar = ${Number(context.travelers) || 2} kishi, Oy = ${String(context.month || 'Istalgan oy').slice(0, 20)}, Joriy reja: ${planSummary}.`
  ].join('\n');

  const cleanHistory = Array.isArray(history)
    ? history.slice(-8).map(m => ({
        role: m && m.role === 'user' ? 'user' : 'assistant',
        content: String((m && m.content) || '').slice(0, 1200)
      }))
    : [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.65,
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          ...cleanHistory,
          { role: 'user', content: String(message).slice(0, 2000) }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await response.json();
    const replyText = data?.choices?.[0]?.message?.content?.trim();
    if (!response.ok || !replyText) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    }
    return { reply: replyText, providerUsed: chosen, model };
  } catch (err) {
    return {
      reply: buildLocalAiFallback(message, context),
      providerUsed: 'local-fallback',
      model: 'manzil-rules-v2',
      warning: `${chosen.toUpperCase()} API xatosi`
    };
  }
}

// 7. HTTP Yordamchilar
const CORS_METHODS = 'GET,POST,PUT,DELETE,OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization, X-Admin-Key';

function corsFor(req) {
  const h = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': CORS_METHODS, 'Access-Control-Allow-Headers': CORS_HEADERS };
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(res._cors || {})
  });
  res.end(body);
}

function parseBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > maxBytes) {
        req.destroy();
        reject(new Error('Payload juda katta'));
      }
    });
    req.on('end', () => {
      req.rawBody = raw; // webhook imzosini tekshirish uchun
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (e) {
        reject(new Error("Noto'g'ri JSON format"));
      }
    });
    req.on('error', reject);
  });
}

function tooMany(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return sendJson(res, 429, { ok: false, error: `Juda ko‘p urinish. ${retryAfter} soniyadan keyin qayta urinib ko‘ring.` });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res, pathname) {
  let reqPath = pathname === '/' ? '/index.html' : (pathname === '/admin' || pathname === '/admin/' ? '/admin.html' : pathname);
  try { reqPath = decodeURIComponent(reqPath); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (reqPath.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Agar admin.html alohida fayl bo'lmasa index.html ni ochadi
    filePath = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(filePath)) {
      filePath = path.join(__dirname, 'index.html');
    }
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('index.html topilmadi');
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
  if (path.basename(filePath) === 'admin.html') {
    headers['X-Robots-Tag'] = 'noindex, nofollow';
    headers['Cache-Control'] = 'no-store';
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

// 7.1 To'lov yordamchilari
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'refunded'];
// Daromad hisobiga faqat haqiqiy (sandbox bo'lmagan) to'langan buyurtmalar kiradi
const isRealPaid = p => (p.status === 'paid' || p.status === 'completed') && !p.sandbox;

async function markPaid(order, payments, via, req, actor) {
  const before = { status: order.status };
  if (order.status === 'paid') return false;
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  order.paidVia = via;
  order.receiptId = 'RCP-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  writeJson(FILES.payments, payments);
  audit(req, 'payment.paid', 'payment', order.orderId, before, { status: 'paid', via, receiptId: order.receiptId }, actor);

  const label = order.sandbox ? '🧪 <b>SANDBOX to‘lov (haqiqiy pul emas)</b>' : '💳 <b>Yangi to‘lov tasdiqlandi! (Manzil Pay)</b>';
  const tgMsg = [
    label,
    `🧾 Chek: <code>${escHtml(order.receiptId)}</code> | Buyurtma: <code>${escHtml(order.orderId)}</code>`,
    `📦 Xizmat: <b>${escHtml(order.title)}</b>`,
    `👤 Mijoz: ${escHtml(order.customerName)} (${escHtml(order.customerContact || '-')})`,
    `💰 Jami: <b>$${order.amountUsd}</b> (~${order.amountUzs.toLocaleString('ru-RU')} so‘m)`,
    `📊 Platforma komissiyasi (${Math.round(order.commissionRate * 100)}%): <b>$${order.commissionUsd}</b>`,
    `🏦 Usul: ${escHtml(order.provider.toUpperCase())} (${escHtml(via)})`
  ].join('\n');
  await sendTelegram(tgMsg);
  return true;
}

// Stripe imzosini tekshirish: Stripe-Signature: t=...,v1=...
function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map(kv => kv.split('=').map(s => s.trim())));
  const t = parts.t;
  const v1 = String(header).split(',').filter(s => s.trim().startsWith('v1=')).map(s => s.trim().slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 daqiqadan eski bo'lsa rad
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.some(sig => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

// 8. Telegram Bot Yordamchilari va Webhook Mantiqi
const BOT_META = {
  description:
    "🧭 Manzil — O'zbekiston va dunyo bo'ylab 105+ sayohat manzillari, tasdiqlangan mahalliy gidlar va AI sayohat yordamchisi.\n\n" +
    "✅ Tasdiqlangan gidlar bilan bog'lanish va onlayn band qilish\n" +
    "✅ O'zbekistonliklar uchun vizasiz davlatlar va byudjet hisobi\n" +
    "✅ Gid sifatida ro'yxatdan o'tish va 24/7 qo'llab-quvvatlash\n\n" +
    "Boshlash uchun /start tugmasini bosing!",
  shortDescription:
    "Manzil rasmiy yordamchi boti — mahalliy gidlar, sayohat rejalari va 24/7 qo'llab-quvvatlash",
  commands: [
    { command: 'start', description: 'Botni ishga tushirish va asosiy menyu' },
    { command: 'guides', description: "Tasdiqlangan mahalliy gidlar ro'yxati" },
    { command: 'visa', description: "O'zbekistonliklar uchun vizasiz davlatlar" },
    { command: 'apply', description: "Gid sifatida ro'yxatdan o'tish" },
    { command: 'support', description: 'Operatorga savol yoki taklif yozish' },
    { command: 'admin', description: 'Admin statistika va boshqaruv (admin)' }
  ]
};

const BOT_USERS_FILE = path.join(DATA_DIR, 'bot_users.json');

function trackBotUser(chatObj) {
  if (!chatObj || !chatObj.id) return;
  try {
    const list = readJson(BOT_USERS_FILE, []);
    const idStr = String(chatObj.id);
    const idx = list.findIndex(u => String(u.id) === idStr);
    const entry = {
      id: chatObj.id,
      firstName: chatObj.first_name || '',
      username: chatObj.username || '',
      updatedAt: new Date().toISOString()
    };
    if (idx === -1) list.push(entry);
    else list[idx] = { ...list[idx], ...entry };
    writeJson(BOT_USERS_FILE, list);
  } catch (e) {}
}

async function tgApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return { ok: false, skipped: true };
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendTgTo(chatId, text, extra = {}) {
  return tgApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}

async function sendTelegramAdminAction(text, replyMarkup = null) {
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  if (!chatId) return { ok: false, skipped: true };
  const extra = replyMarkup ? { reply_markup: replyMarkup } : {};
  return sendTgTo(chatId, text, extra);
}

const WEBHOOK_PARAMS = { allowed_updates: ['message', 'callback_query'], secret_token: TG_WEBHOOK_SECRET };

async function syncTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const pubUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\/+$/, '');
  if (!token || !pubUrl.startsWith('https://')) {
    return { ok: false, error: 'HTTPS PUBLIC_URL yoki TELEGRAM_BOT_TOKEN topilmadi' };
  }
  const webhookRes = await tgApi('setWebhook', { url: pubUrl + '/api/telegram/webhook', ...WEBHOOK_PARAMS });
  const cmdRes = await tgApi('setMyCommands', { commands: BOT_META.commands });
  const descRes = await tgApi('setMyDescription', { description: BOT_META.description });
  const shortRes = await tgApi('setMyShortDescription', { short_description: BOT_META.shortDescription });
  return { ok: Boolean(webhookRes.ok), webhookRes, cmdRes, descRes, shortRes };
}

async function processTelegramUpdate(body) {
  const adminChatId = String(process.env.TELEGRAM_CHAT_ID || '');
  const siteUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\/+$/, '');

  // A) INLINE TUGMALAR (Tasdiqlash / Rad etish)
  const cb = body && body.callback_query;
  if (cb && cb.data) {
    const fromId = String(cb.from && cb.from.id ? cb.from.id : '');
    // TELEGRAM_CHAT_ID sozlanmagan bo'lsa HECH KIM admin emas (avval hamma tasdiqlay olardi)
    if (!adminChatId || fromId !== adminChatId) {
      await tgApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: "Faqat admin uchun ruxsat etilgan!",
        show_alert: true
      });
      return;
    }

    const [action, guideId] = String(cb.data).split(':');
    const guides = readJson(FILES.guides, SEED_GUIDES);
    const guide = guides.find(g => String(g.id) === String(guideId));
    let toastText = 'Ariza topilmadi';
    let statusTag = '';

    if (guide && (action === 'approve' || action === 'reject')) {
      const before = { approved: guide.approved, rejected: guide.rejected };
      if (action === 'approve') {
        guide.approved = true;
        guide.rejected = false;
        guide.approvedAt = new Date().toISOString();
        toastText = '✅ Gid tasdiqlandi!';
        statusTag = '\n\n✅ <b>HOLAT: TASDIQLANDI</b>';
      } else {
        guide.approved = false;
        guide.rejected = true;
        guide.rejectedAt = new Date().toISOString();
        toastText = '❌ Ariza rad etildi';
        statusTag = '\n\n❌ <b>HOLAT: RAD ETILDI</b>';
      }
      writeJson(FILES.guides, guides);
      audit(null, 'guide.' + action, 'guide', guide.id, before, { approved: guide.approved, rejected: guide.rejected }, 'telegram:' + fromId);
    }

    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: toastText });
    if (cb.message && cb.message.chat && statusTag) {
      const origText = cb.message.text || '';
      await tgApi('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: origText + statusTag,
        parse_mode: 'HTML'
      });
    }
    return;
  }

  // B) XABARLAR VA BUYRUQLAR
  const msg = body && body.message;
  if (msg && msg.chat) {
    const chatId = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    const isOwner = Boolean(adminChatId) && chatId === adminChatId;
    trackBotUser(msg.chat);

    const mainKeyboard = {
      keyboard: [
        [{ text: '🧭 Gidlar katalogi' }, { text: '🛂 Vizasiz davlatlar' }],
        [{ text: "💼 Gid bo‘lish" }, { text: '💬 Operatorga yozish' }]
      ],
      resize_keyboard: true
    };

    if (isOwner && msg.reply_to_message && text && !text.startsWith('/')) {
      const repliedText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
      const idMatch = repliedText.match(/ID:\s*(\d+)/);
      if (idMatch && idMatch[1]) {
        const sent = await sendTgTo(idMatch[1], '💬 <b>Manzil Qo‘llab-quvvatlash javobi:</b>\n\n' + escHtml(text));
        await sendTgTo(chatId, sent.ok ? '✅ Javobingiz foydalanuvchiga yetkazildi!' : '❌ Xabar yuborilmadi');
        return;
      }
    }

    if (isOwner && text.startsWith('/broadcast ')) {
      const notice = text.slice('/broadcast '.length).trim();
      const subs = readJson(BOT_USERS_FILE, []);
      let sentCount = 0;
      for (const u of subs) {
        if (String(u.id) === adminChatId) continue;
        const r = await sendTgTo(u.id, '📢 <b>Manzil Yangiligi:</b>\n\n' + escHtml(notice));
        if (r.ok) sentCount++;
      }
      audit(null, 'broadcast.send', 'telegram', '', null, { sentCount, preview: notice.slice(0, 200) }, 'telegram:' + chatId);
      await sendTgTo(chatId, '📣 E’lon <b>' + sentCount + '</b> ta foydalanuvchiga yuborildi.');
      return;
    }

    if (isOwner && (text === '/admin' || text === '/stats')) {
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const payments = readJson(FILES.payments, []);
      const subs = readJson(BOT_USERS_FILE, []);
      const pending = guides.filter(g => g.approved === false && !g.rejected).length;
      const approved = guides.filter(g => g.approved === true).length;
      const paid = payments.filter(isRealPaid);
      const gross = paid.reduce((s, p) => s + Number(p.amountUsd || p.amount || p.totalAmount || 0), 0);
      const comm = Math.round(gross * COMMISSION_RATE * 100) / 100;

      const statMsg = [
        '📊 <b>Manzil Jonli Statistika</b>',
        '',
        '🟡 Kutilayotgan gid arizalari: <b>' + pending + ' ta</b>',
        '🟢 Tasdiqlangan gidlar: <b>' + approved + ' ta</b>',
        '💳 Jami buyurtmalar: <b>' + payments.length + ' ta</b> (Haqiqiy to‘langan: ' + paid.length + ')',
        '💰 Umumiy aylanma: <b>$' + gross + '</b>',
        '🏦 Platforma komissiyasi (' + Math.round(COMMISSION_RATE * 100) + '%): <b>$' + comm + '</b>',
        '👥 Bot foydalanuvchilari: <b>' + subs.length + ' ta</b>',
        '',
        '⏳ Kutilayotgan arizalarni ko‘rish: /pending'
      ].join('\n');

      await sendTgTo(chatId, statMsg, {
        reply_markup: {
          inline_keyboard: [[{ text: '🖥 Web-saytni ochish', url: siteUrl }]]
        }
      });
      return;
    }

    if (isOwner && text === '/pending') {
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const pendingList = guides.filter(g => g.approved === false && !g.rejected);
      if (!pendingList.length) {
        await sendTgTo(chatId, '✅ Hozircha kutilayotgan yangi gid arizalari yo‘q.');
        return;
      }
      for (const g of pendingList) {
        const card = [
          '🟡 <b>Kutilayotgan ariza</b>',
          '🆔 ID: <code>' + escHtml(g.id) + '</code>',
          '👤 Ism: <b>' + escHtml(g.name) + '</b>',
          '📍 Hudud: ' + escHtml(g.city) + ', ' + escHtml(g.country || ''),
          '💰 Stavka: $' + escHtml(g.rate || g.price) + '/kun',
          '✈️ Telegram: @' + escHtml(g.tg),
          '📝 Yo‘nalish: ' + escHtml(g.spec || g.bio)
        ].join('\n');
        await sendTgTo(chatId, card, {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Tasdiqlash', callback_data: 'approve:' + g.id },
              { text: '❌ Rad etish', callback_data: 'reject:' + g.id }
            ]]
          }
        });
      }
      return;
    }

    if (text.startsWith('/start')) {
      const welcome = [
        'Assalomu alaykum, <b>' + escHtml(msg.chat.first_name || 'Sayohatchi') + '</b>! 👋',
        '',
        '<b>Manzil</b> sayohat ekotizimining rasmiy botiga xush kelibsiz.',
        'Pastdagi tugmalardan birini tanlang yoki sayohat bo‘yicha savolingizni yozing:'
      ].join('\n');
      await sendTgTo(chatId, welcome, {
        reply_markup: { inline_keyboard: [[{ text: '🌐 Manzil Web-ilovasini ochish', url: siteUrl }]] }
      });
      await sendTgTo(chatId, '⬇️ Tezkor menyu faollashtirildi:', { reply_markup: mainKeyboard });
      return;
    }

    if (text === '/guides' || text === '🧭 Gidlar katalogi') {
      const guides = readJson(FILES.guides, SEED_GUIDES).filter(g => g.approved !== false && !g.rejected);
      const lines = guides.slice(0, 8).map((g, i) =>
        (i + 1) + '. <b>' + escHtml(g.name) + '</b> — ' + escHtml(g.city) + ' ($' + (g.rate || g.price) + '/kun)\n   🗣 ' + escHtml(g.langs) + ' | ✈️ @' + escHtml(g.tg)
      );
      await sendTgTo(chatId, '🧭 <b>Tasdiqlangan mahalliy gidlar (' + guides.length + ' ta):</b>\n\n' + lines.join('\n\n'), {
        reply_markup: { inline_keyboard: [[{ text: '🌐 Barcha gidlar va band qilish', url: siteUrl }]] }
      });
      return;
    }

    if (text === '/visa' || text === '🛂 Vizasiz davlatlar') {
      const visaText = [
        '🛂 <b>O‘zbekiston fuqarolari uchun asosiy vizasiz davlatlar:</b>',
        '🇹🇷 Turkiya (90 kun) | 🇬🇪 Gruziya (1 yil) | 🇦🇪 BAA (30 kun)',
        '🇨🇳 Xitoy (30 kun) | 🇹🇭 Tailand (60 kun) | 🇲🇻 Maldiv (30 kun)',
        '🇰🇿 Qozog‘iston (30 kun) | 🇰🇬 Qirg‘iziston (60 kun) | 🇹🇯 Tojikiston (30 kun)',
        '',
        '<i>Qoidalar o‘zgarib turadi — safardan oldin rasmiy manbada tekshiring.</i>'
      ].join('\n');
      await sendTgTo(chatId, visaText, {
        reply_markup: { inline_keyboard: [[{ text: '🌐 Saytda byudjet hisoblash', url: siteUrl }]] }
      });
      return;
    }

    if (text === '/apply' || text === "💼 Gid bo‘lish") {
      await sendTgTo(chatId, '💼 <b>Gid sifatida qo‘shilish bepul!</b>\nHar bir buyurtmadan <b>88% daromad</b> sizga qoladi (12% komissiya).', {
        reply_markup: { inline_keyboard: [[{ text: '📝 Gidlikka ariza topshirish', url: siteUrl }]] }
      });
      return;
    }

    if (text === '/support' || text === '💬 Operatorga yozish') {
      await sendTgTo(chatId, '💬 Savolingiz yoki taklifingizni shu yerga yozib yuboring — xabaringiz operatorga yetkaziladi.');
      return;
    }

    if (text) {
      const aiRes = await generateAiReply(text.slice(0, 1000), [], {}, 'auto');
      await sendTgTo(chatId, '🤖 ' + escHtml(aiRes.reply));
      if (!isOwner) {
        const uName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
        const uTag = msg.chat.username ? '@' + msg.chat.username : 'username yo‘q';
        await sendTelegramAdminAction(
          '📩 <b>Botga yangi xabar keldi</b>\n🆔 ID: <code>' + chatId + '</code>\n👤 Mijoz: <b>' + escHtml(uName) + '</b> (' + escHtml(uTag) + ')\n💬 Xabar: ' + escHtml(text.slice(0, 1000)) + '\n\n<i>↩️ Javob berish uchun shu xabarga Reply qiling.</i>'
        );
      }
    }
  }
}

// 9. Asosiy Server Router
const KNOWN_DEST_KEYS = ['id', 'createdAt', 'updatedAt', 'name', 'country', 'region', 'desc', 'image', 'bestSeason', 'entranceFee', 'openingHours', 'safetyNotes', 'transportInfo', 'flightBase', 'hotelNight', 'foodDay', 'transportDay', 'activitiesDay', 'tourBase5d', 'lat', 'lng', 'scope', 'bestMonths', 'tags', 'priceStatus', 'verifiedAt'];
function omitKeys(obj, keys) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (!keys.includes(k)) out[k] = obj[k];
  return out;
}

const server = http.createServer(async (req, res) => {
  res._cors = corsFor(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (PUBLIC_URL.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, res._cors);
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    // --- HEALTH CHECK (ommaviy qismi minimal; tafsilot faqat adminga) ---
    if (req.method === 'GET' && pathname === '/api/health') {
      const base = { ok: true, service: 'manzil-backend', version: '2.2.0', uptimeSec: Math.round(process.uptime()) };
      if (!isAdmin(req, urlObj)) return sendJson(res, 200, base);
      const guides = readJson(FILES.guides, []);
      return sendJson(res, 200, {
        ...base,
        env: IS_PROD ? 'production' : 'development',
        demoPaymentsEnabled: DEMO_PAYMENTS,
        commissionRate: COMMISSION_RATE,
        integrations: {
          telegram: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
          openai: Boolean(OPENAI_API_KEY),
          grok: Boolean(GROK_API_KEY),
          click: Boolean(CLICK_SERVICE_ID && CLICK_MERCHANT_ID),
          payme: Boolean(PAYME_MERCHANT_ID),
          stripe: Boolean(STRIPE_SECRET_KEY),
          stripeWebhook: Boolean(STRIPE_WEBHOOK_SECRET)
        },
        counts: {
          guides: guides.length,
          approvedGuides: guides.filter(g => g.approved !== false).length,
          feedback: readJson(FILES.feedback, []).length,
          users: readJson(FILES.users, []).length,
          payments: readJson(FILES.payments, []).length
        }
      });
    }

    // --- DESTINATIONS: PUBLIC LIST & ADMIN CRUD ---
    if (req.method === 'GET' && pathname === '/api/destinations') {
      const destinations = readJson(FILES.destinations, []).map(normalizeDestinationForClient);
      return sendJson(res, 200, { ok: true, destinations });
    }

    if (req.method === 'POST' && pathname === '/api/admin/destinations') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) {
        return sendJson(res, 401, { ok: false, error: 'Admin ruxsati talab qilinadi' });
      }
      const list = readJson(FILES.destinations, []);
      const fields = pickDestinationFields(body);
      if (!fields.name) return sendJson(res, 400, { ok: false, error: 'Manzil nomi kiritilmagan' });
      const newDest = {
        id: Number(body.id) || Date.now(),
        country: "O'zbekiston",
        region: "O'zbekiston",
        scope: 'uz',
        lat: 41.3,
        lng: 69.2,
        flightBase: 0,
        hotelNight: 40,
        foodDay: 18,
        transportDay: 12,
        activitiesDay: 10,
        tourBase5d: 240,
        bestMonths: [4, 5, 9, 10],
        tags: ['diy-win'],
        desc: '',
        priceStatus: 'estimated',
        ...fields,
        createdAt: new Date().toISOString()
      };
      if (list.some(d => String(d.id) === String(newDest.id))) {
        return sendJson(res, 409, { ok: false, error: 'Bunday ID li manzil allaqachon mavjud' });
      }
      list.push(newDest);
      writeJson(FILES.destinations, list);
      audit(req, 'destination.create', 'destination', newDest.id, null, newDest, adminActor(req));
      return sendJson(res, 201, { ok: true, destination: newDest });
    }

    const adminDestMatch = pathname.match(/^\/api\/admin\/destinations\/([^/]+)$/);
    if (adminDestMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const body = req.method === 'PUT' ? await parseBody(req) : {};
      if (!isAdmin(req, urlObj, body)) {
        return sendJson(res, 401, { ok: false, error: 'Admin ruxsati talab qilinadi' });
      }
      const destId = decodeURIComponent(adminDestMatch[1]);
      let list = readJson(FILES.destinations, []);
      if (req.method === 'DELETE') {
        const before = list.find(d => String(d.id) === destId) || null;
        list = list.filter(d => String(d.id) !== destId);
        writeJson(FILES.destinations, list);
        audit(req, 'destination.delete', 'destination', destId, before, null, adminActor(req));
        return sendJson(res, 200, { ok: true });
      }
      // Tekshirilgan maydonlar pickDestinationFields orqali, qolgan (frontend) maydonlar o'zgarishsiz saqlanadi
      const picked = pickDestinationFields(body);
      const extras = omitKeys(body, KNOWN_DEST_KEYS);
      const idx = list.findIndex(d => String(d.id) === destId);
      if (idx === -1) {
        // Frontenddagi statik manzillardan biri tahrirlansa, server bazasiga ham saqlaymiz
        const upserted = { ...extras, ...picked, id: Number(destId) || destId, updatedAt: new Date().toISOString() };
        list.push(upserted);
        writeJson(FILES.destinations, list);
        audit(req, 'destination.upsert', 'destination', destId, null, upserted, adminActor(req));
        return sendJson(res, 200, { ok: true, destination: upserted });
      }
      const before = { ...list[idx] };
      list[idx] = { ...list[idx], ...extras, ...picked, id: list[idx].id, updatedAt: new Date().toISOString() };
      writeJson(FILES.destinations, list);
      audit(req, 'destination.update', 'destination', destId, before, list[idx], adminActor(req));
      return sendJson(res, 200, { ok: true, destination: list[idx] });
    }

    // --- GUIDES: LIST ---
    if (req.method === 'GET' && pathname === '/api/guides') {
      const guides = readJson(FILES.guides, SEED_GUIDES).map(normalizeGuideForClient);
      // Kutilayotgan/rad etilgan gidlar (va ularning aloqa ma'lumotlari) faqat adminga ko'rinadi
      const wantAll = urlObj.searchParams.get('approved') === 'false' && isAdmin(req, urlObj);
      const filtered = wantAll ? guides : guides.filter(g => g.status === 'approved');
      return sendJson(res, 200, {
        ok: true,
        commissionRate: COMMISSION_RATE,
        guides: filtered
      });
    }

    // --- GUIDES: APPLY ---
    if (req.method === 'POST' && pathname === '/api/guides/apply') {
      const rl = rateLimit(req, 'guide-apply', 5, 60 * 60 * 1000);
      if (rl) return tooMany(res, rl);
      const body = await parseBody(req);
      const name = String(body.name || '').trim().slice(0, 100);
      const city = String(body.city || '').trim().slice(0, 100);
      const country = String(body.country || "O'zbekiston").trim().slice(0, 80);
      const langs = String(body.langs || "O'zbek, Rus").trim().slice(0, 120);
      const spec = String(body.spec || body.bio || '').trim().slice(0, 600);
      const tg = String(body.tg || body.contact || '').trim().replace(/^@/, '').slice(0, 64);
      const rate = Math.max(5, Math.min(2000, Number(body.rate || body.price) || 50));
      const exp = Math.max(1, Math.min(50, Number(body.exp) || 3));
      const about = String(body.about || body.bio || '').trim().slice(0, 1500);

      if (!name || !city || !tg || !spec) {
        return sendJson(res, 400, { ok: false, error: 'Ism, shahar, aloqa va tavsif majburiy.' });
      }

      const guides = readJson(FILES.guides, SEED_GUIDES);
      const newGuide = {
        id: 'guide_' + crypto.randomBytes(4).toString('hex'),
        name,
        city,
        country,
        langs,
        spec,
        bio: spec,
        rate,
        price: rate,
        exp,
        tg,
        contact: '@' + tg,
        group: String(body.group || '').trim().slice(0, 200),
        about,
        approved: false,
        commissionRate: COMMISSION_RATE,
        createdAt: new Date().toISOString()
      };
      guides.push(newGuide);
      writeJson(FILES.guides, guides);
      audit(req, 'guide.apply', 'guide', newGuide.id, null, { name, city, tg }, 'public');

      const tgMsg = [
        '🧭 <b>Yangi gid arizasi (Manzil)</b>',
        `🆔 ID: <code>${escHtml(newGuide.id)}</code>`,
        `👤 Ism/Kompaniya: <b>${escHtml(name)}</b>`,
        `📍 Hudud: ${escHtml(city)}, ${escHtml(country)}`,
        `🗣 Tillar: ${escHtml(newGuide.langs)}`,
        `💰 Stavka: $${rate}/kun (Komissiya: ${Math.round(COMMISSION_RATE * 100)}%)`,
        `✈️ Aloqa: @${escHtml(tg)}`,
        `📝 Yo'nalish: ${escHtml(spec)}`
      ].join('\n');

      const tgRes = await sendTelegramAdminAction(tgMsg, {
        inline_keyboard: [[
          { text: '✅ Tasdiqlash', callback_data: 'approve:' + newGuide.id },
          { text: '❌ Rad etish', callback_data: 'reject:' + newGuide.id }
        ]]
      });
      return sendJson(res, 201, { ok: true, guide: normalizeGuideForClient(newGuide), telegram: { ok: Boolean(tgRes && tgRes.ok) } });
    }

    // --- TELEGRAM WEBHOOK (maxfiy token bilan himoyalangan) ---
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'] || '', TG_WEBHOOK_SECRET)) {
        return sendJson(res, 401, { ok: false, error: 'Ruxsat yo‘q' });
      }
      const body = await parseBody(req);
      await processTelegramUpdate(body);
      return sendJson(res, 200, { ok: true });
    }

    // --- ADMIN SSO (admin kaliti → 8 soatlik token) ---
    if (req.method === 'POST' && pathname === '/api/admin/sso') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) {
        return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      }
      const users = readJson(FILES.users, []);
      let adminUser = users.find(u => u.id === 'admin_master');
      if (!adminUser) {
        adminUser = {
          id: 'admin_master',
          name: 'Manzil Admin',
          email: 'admin@manzil.uz',
          role: 'admin',
          isAdmin: true,
          plan: [],
          favorites: [],
          createdAt: new Date().toISOString()
        };
        users.unshift(adminUser);
        writeJson(FILES.users, users);
      }
      const token = signToken({ sub: 'admin_master', email: adminUser.email, role: 'admin' }, ADMIN_TOKEN_TTL);
      audit(req, 'admin.login', 'session', 'admin_master', null, { expiresInSec: ADMIN_TOKEN_TTL }, 'admin-key');
      const { passwordHash, ...safeAdmin } = adminUser;
      return sendJson(res, 200, { ok: true, token, expiresInSec: ADMIN_TOKEN_TTL, user: safeAdmin });
    }

    // --- ADMIN: AUDIT LOG ---
    if (req.method === 'GET' && pathname === '/api/admin/audit') {
      if (!isAdmin(req, urlObj)) return sendJson(res, 401, { ok: false, error: 'Admin ruxsati kerak' });
      const limit = Math.min(1000, Math.max(1, Number(urlObj.searchParams.get('limit')) || 200));
      const entity = String(urlObj.searchParams.get('entity') || '');
      return sendJson(res, 200, { ok: true, entries: readAudit(limit, entity) });
    }

    // --- ADMIN: STATS & OVERVIEW ---
    if (req.method === 'GET' && (pathname === '/api/admin/stats' || pathname === '/api/admin/overview')) {
      if (!isAdmin(req, urlObj)) {
        return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      }
      const customDests = readJson(FILES.destinations, []);
      const guides = readJson(FILES.guides, SEED_GUIDES).map(normalizeGuideForClient);
      const feedback = readJson(FILES.feedback, []);
      const payments = readJson(FILES.payments, []);
      const users = readJson(FILES.users, []);

      const paidList = payments.filter(isRealPaid);
      const sandboxPaid = payments.filter(p => p.sandbox && p.status === 'paid').length;
      const grossRevenue = paidList.reduce((s, p) => s + Number(p.amountUsd || p.amount || p.totalAmount || 0), 0);
      const commissionRevenue = paidList.reduce((s, p) => {
        const amt = Number(p.amountUsd || p.amount || p.totalAmount || 0);
        return s + Number(p.commissionUsd != null ? p.commissionUsd : amt * COMMISSION_RATE);
      }, 0);

      const approvedGuidesCount = guides.filter(g => g.status === 'approved').length;
      const pendingGuidesCount = guides.filter(g => g.status === 'pending').length;

      return sendJson(res, 200, {
        ok: true,
        commissionRate: COMMISSION_RATE,
        telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
        publicUrl: PUBLIC_URL,
        destinationsCount: 85 + customDests.length,
        approvedGuidesCount,
        pendingGuidesCount,
        paymentsCount: payments.length,
        feedbackCount: feedback.length,
        usersCount: users.length,
        stats: {
          totalGuides: guides.length,
          approvedGuides: approvedGuidesCount,
          pendingGuides: pendingGuidesCount,
          rejectedGuides: guides.filter(g => g.status === 'rejected').length,
          totalPayments: payments.length,
          paidPayments: paidList.length,
          sandboxPaidPayments: sandboxPaid,
          grossRevenue: Math.round(grossRevenue * 100) / 100,
          commissionRevenue: Math.round(commissionRevenue * 100) / 100,
          totalFeedback: feedback.length,
          totalUsers: users.length
        },
        guides,
        feedback,
        payments
      });
    }

    // --- ADMIN: GUIDES LIST, APPROVE, REJECT, DELETE ---
    if (req.method === 'GET' && pathname === '/api/admin/guides') {
      if (!isAdmin(req, urlObj)) return sendJson(res, 401, { ok: false, error: 'Admin ruxsati kerak' });
      const guides = readJson(FILES.guides, SEED_GUIDES).map(normalizeGuideForClient);
      return sendJson(res, 200, { ok: true, guides });
    }

    const adminApproveMatch = pathname.match(/^\/api\/(?:admin\/)?guides\/([^/]+)\/approve$/);
    if (req.method === 'POST' && adminApproveMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) {
        return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      }
      const guideId = decodeURIComponent(adminApproveMatch[1]);
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const guide = guides.find(g => String(g.id) === guideId);
      if (!guide) {
        return sendJson(res, 404, { ok: false, error: 'Gid topilmadi' });
      }
      const before = { approved: guide.approved, rejected: guide.rejected };
      guide.approved = true;
      guide.rejected = false;
      guide.approvedAt = new Date().toISOString();
      writeJson(FILES.guides, guides);
      audit(req, 'guide.approve', 'guide', guide.id, before, { approved: true, rejected: false }, adminActor(req));

      await sendTelegram(`✅ <b>Gid tasdiqlandi!</b>\n👤 ${escHtml(guide.name)} (${escHtml(guide.city)})\n✈️ @${escHtml(guide.tg || '')}`);
      return sendJson(res, 200, { ok: true, guide: normalizeGuideForClient(guide) });
    }

    const rejectMatch = pathname.match(/^\/api\/(?:admin\/)?guides\/([^/]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const guideId = decodeURIComponent(rejectMatch[1]);
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const guide = guides.find(g => String(g.id) === guideId);
      if (!guide) return sendJson(res, 404, { ok: false, error: 'Gid topilmadi' });
      const before = { approved: guide.approved, rejected: guide.rejected };
      guide.approved = false;
      guide.rejected = true;
      guide.rejectedAt = new Date().toISOString();
      writeJson(FILES.guides, guides);
      audit(req, 'guide.reject', 'guide', guide.id, before, { approved: false, rejected: true }, adminActor(req));
      return sendJson(res, 200, { ok: true, guide: normalizeGuideForClient(guide) });
    }

    const delGuideMatch = pathname.match(/^\/api\/(?:admin\/)?guides\/([^/]+)(?:\/delete)?$/);
    if ((req.method === 'DELETE' || (req.method === 'POST' && pathname.endsWith('/delete'))) && delGuideMatch) {
      const body = req.method === 'POST' ? await parseBody(req) : {};
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const guideId = decodeURIComponent(delGuideMatch[1]);
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const before = guides.find(g => String(g.id) === guideId) || null;
      writeJson(FILES.guides, guides.filter(g => String(g.id) !== guideId));
      audit(req, 'guide.delete', 'guide', guideId, before, null, adminActor(req));
      return sendJson(res, 200, { ok: true });
    }

    // --- ADMIN: TELEGRAM WEBHOOK ULASH VA TEST ---
    if (req.method === 'POST' && pathname === '/api/admin/telegram/sync-webhook') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Ruxsat yo‘q' });
      const result = await syncTelegramWebhook();
      return sendJson(res, 200, { ok: Boolean(result.ok), result: { ok: Boolean(result.ok), error: result.error } });
    }

    if (req.method === 'POST' && pathname === '/api/admin/telegram/test') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Ruxsat yo‘q' });
      const result = await sendTelegramAdminAction('🔔 <b>Manzil Admin Panel:</b> Telegram aloqasi muvaffaqiyatli tekshirildi!');
      return sendJson(res, 200, { ok: Boolean(result.ok), result: { ok: Boolean(result.ok), skipped: result.skipped } });
    }

    // --- FEEDBACK: CREATE, LIST & DELETE ---
    if (req.method === 'POST' && pathname === '/api/feedback') {
      const rl = rateLimit(req, 'feedback', 5, 10 * 60 * 1000);
      if (rl) return tooMany(res, rl);
      const body = await parseBody(req);
      const name = String(body.name || '').trim().slice(0, 100);
      const contact = String(body.contact || '').trim().slice(0, 120);
      const type = String(body.type || 'taklif').trim().slice(0, 30);
      const message = String(body.message || body.msg || '').trim().slice(0, 3000);

      if (!name || !message) {
        return sendJson(res, 400, { ok: false, error: 'Ism va xabar matni kiritilishi shart.' });
      }

      const items = readJson(FILES.feedback, []);
      const entry = {
        id: 'fb_' + crypto.randomBytes(4).toString('hex'),
        name,
        contact,
        type,
        msg: message,
        message,
        createdAt: new Date().toISOString()
      };
      items.unshift(entry);
      writeJson(FILES.feedback, items);

      const tgMsg = [
        `💬 <b>Yangi murojaat (${escHtml(type.toUpperCase())})</b>`,
        `👤 Ism: <b>${escHtml(name)}</b>`,
        `📞 Aloqa: ${escHtml(contact || 'ko‘rsatilmagan')}`,
        `📝 Xabar:\n${escHtml(message)}`
      ].join('\n');
      const tgRes = await sendTelegram(tgMsg);

      return sendJson(res, 201, { ok: true, feedback: entry, telegram: { sent: Boolean(tgRes && tgRes.sent) } });
    }

    if (req.method === 'GET' && (pathname === '/api/feedback' || pathname === '/api/admin/feedback')) {
      if (!isAdmin(req, urlObj)) {
        return sendJson(res, 401, { ok: false, error: 'Admin kaliti talab qilinadi' });
      }
      const items = readJson(FILES.feedback, []).map(f => ({
        ...f,
        message: f.message || f.msg || ''
      }));
      return sendJson(res, 200, { ok: true, total: items.length, feedback: items });
    }

    const delFbMatch = pathname.match(/^\/api\/(?:admin\/)?feedback\/([^/]+)(?:\/delete)?$/);
    if ((req.method === 'DELETE' || (req.method === 'POST' && pathname.endsWith('/delete'))) && delFbMatch) {
      const body = req.method === 'POST' ? await parseBody(req) : {};
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const fbId = decodeURIComponent(delFbMatch[1]);
      const items = readJson(FILES.feedback, []);
      const before = items.find(f => String(f.id) === fbId) || null;
      writeJson(FILES.feedback, items.filter(f => String(f.id) !== fbId));
      audit(req, 'feedback.delete', 'feedback', fbId, before, null, adminActor(req));
      return sendJson(res, 200, { ok: true });
    }

    // --- REAL AI CHAT (OpenAI & Grok) ---
    if (req.method === 'POST' && pathname === '/api/ai/chat') {
      const rl = rateLimit(req, 'ai', 20, 60 * 1000);
      if (rl) return tooMany(res, rl);
      const body = await parseBody(req);
      const message = String(body.message || '').trim();
      if (!message) {
        return sendJson(res, 400, { ok: false, error: 'Xabar matni bo‘sh bo‘lmasligi kerak' });
      }
      const result = await generateAiReply(message, body.history, body.context, body.provider);

      const chats = readJson(FILES.chats, []);
      chats.unshift({
        id: 'chat_' + crypto.randomBytes(4).toString('hex'),
        provider: result.providerUsed,
        model: result.model,
        userMessage: message.slice(0, 500),
        aiReply: result.reply.slice(0, 1000),
        createdAt: new Date().toISOString()
      });
      if (chats.length > 300) chats.length = 300;
      writeJson(FILES.chats, chats);

      return sendJson(res, 200, { ok: true, ...result });
    }

    // --- USER AUTH: REGISTER ---
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const rl = rateLimit(req, 'register', 10, 60 * 60 * 1000);
      if (rl) return tooMany(res, rl);
      const body = await parseBody(req);
      const name = String(body.name || '').trim().slice(0, 100);
      const emailOrPhone = String(body.emailOrPhone || body.email || '').trim().toLowerCase().slice(0, 120);
      const password = String(body.password || '');
      const role = body.role === 'guide' ? 'guide' : 'tourist';

      if (!name || emailOrPhone.length < 3 || password.length < 8 || password.length > 128) {
        return sendJson(res, 400, { ok: false, error: 'Ism, email/telefon va kamida 8 belgili parol kiriting.' });
      }

      const users = readJson(FILES.users, []);
      if (users.some(u => (u.emailOrPhone || u.email) === emailOrPhone)) {
        return sendJson(res, 409, { ok: false, error: 'Bu email yoki telefon raqami allaqachon ro‘yxatdan o‘tgan.' });
      }

      const favs = Array.isArray(body.favorites) ? body.favorites.slice(0, 500) : [];
      const route = Array.isArray(body.route) ? body.route.slice(0, 200) : [];
      const user = {
        id: 'usr_' + crypto.randomBytes(5).toString('hex'),
        name,
        email: emailOrPhone,
        emailOrPhone,
        role,
        passwordHash: hashPassword(password),
        favorites: favs,
        route,
        savedData: { favorites: favs, route, plan: [], checklist: [] },
        createdAt: new Date().toISOString()
      };
      users.push(user);
      writeJson(FILES.users, users);

      const token = signToken({ sub: user.id, emailOrPhone: user.emailOrPhone, role: user.role });
      const { passwordHash, ...safeUser } = user;
      return sendJson(res, 201, { ok: true, token, user: safeUser });
    }

    // --- USER AUTH: LOGIN ---
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const emailOrPhone = String(body.emailOrPhone || body.email || '').trim().toLowerCase().slice(0, 120);
      const password = String(body.password || '').slice(0, 128);

      const rl = rateLimit(req, 'login-ip', 20, 15 * 60 * 1000) || rateLimit(req, 'login-acct', 8, 15 * 60 * 1000, emailOrPhone);
      if (rl) return tooMany(res, rl);

      const users = readJson(FILES.users, []);
      const user = users.find(u => u.id !== 'admin_master' && (u.emailOrPhone || u.email) === emailOrPhone);
      // Foydalanuvchi topilmasa ham xesh hisoblanadi (vaqt orqali foydalanuvchini aniqlashni qiyinlashtiradi)
      const passOk = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !passOk) {
        return sendJson(res, 401, { ok: false, error: 'Login yoki parol noto‘g‘ri.' });
      }

      const token = signToken({ sub: user.id, emailOrPhone: user.emailOrPhone, role: user.role });
      const { passwordHash, ...safeUser } = user;
      return sendJson(res, 200, { ok: true, token, user: safeUser });
    }

    // --- USER AUTH: PROFILE & PAYMENTS ---
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { ok: false, error: 'Avtorizatsiya talab qilinadi' });
      const payments = readJson(FILES.payments, []).filter(p => p.userId === user.id);
      const { passwordHash, ...safeUser } = user;
      return sendJson(res, 200, { ok: true, user: safeUser, payments });
    }

    // --- USER AUTH: SYNC PLAN & FAVORITES ---
    if (req.method === 'POST' && pathname === '/api/auth/sync') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { ok: false, error: 'Avtorizatsiya talab qilinadi' });
      const body = await parseBody(req);
      const users = readJson(FILES.users, []);
      const idx = users.findIndex(u => u.id === user.id);
      if (idx !== -1) {
        const favs = Array.isArray(body.favorites) ? body.favorites.slice(0, 500) : [];
        const route = Array.isArray(body.route) ? body.route.slice(0, 200) : [];
        users[idx].favorites = favs;
        users[idx].route = route;
        users[idx].savedData = {
          favorites: favs,
          route,
          plan: Array.isArray(body.plan) ? body.plan.slice(0, 200) : [],
          checklist: Array.isArray(body.checklist) ? body.checklist.slice(0, 200) : [],
          updatedAt: new Date().toISOString()
        };
        writeJson(FILES.users, users);
        return sendJson(res, 200, { ok: true, savedData: users[idx].savedData });
      }
      return sendJson(res, 404, { ok: false, error: 'Foydalanuvchi topilmadi' });
    }

    // --- PAYMENTS: CREATE ORDER ---
    if (req.method === 'POST' && pathname === '/api/payments/create') {
      const rl = rateLimit(req, 'pay-create', 20, 60 * 60 * 1000);
      if (rl) return tooMany(res, rl);
      const body = await parseBody(req);
      const authUser = getAuthUser(req);
      const days = Math.max(1, Math.min(365, Number(body.days) || 1));
      const people = Math.max(1, Math.min(100, Number(body.people) || 1));
      let amountUsd = Math.min(50000, Math.max(1, Number(body.amountUsd) || 50));

      // Agar gid ID si yuborilsa, narx SERVERda hisoblanadi (mijoz narxni o'zgartira olmaydi)
      let guideRef = null;
      if (body.guideId) {
        const guides = readJson(FILES.guides, SEED_GUIDES).map(normalizeGuideForClient);
        guideRef = guides.find(g => String(g.id) === String(body.guideId) && g.status === 'approved');
        if (!guideRef) return sendJson(res, 404, { ok: false, error: 'Gid topilmadi yoki tasdiqlanmagan' });
        amountUsd = Number((guideRef.rate * days * people).toFixed(2));
      }

      const rateUzs = Math.max(1000, Number(body.rateUzs) || 12850);
      const amountUzs = Math.round(amountUsd * rateUzs);
      const provider = ['click', 'payme', 'uzum', 'card', 'stripe'].includes(String(body.provider).toLowerCase())
        ? String(body.provider).toLowerCase()
        : 'click';

      const commissionUsd = Number((amountUsd * COMMISSION_RATE).toFixed(2));
      const guidePayoutUsd = Number((amountUsd - commissionUsd).toFixed(2));
      const orderId = `MZ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      let checkoutUrl = null;
      let checkoutMode = 'sandbox';

      if (provider === 'click' && CLICK_SERVICE_ID && CLICK_MERCHANT_ID) {
        checkoutMode = 'redirect';
        checkoutUrl = `https://my.click.uz/services/pay?service_id=${encodeURIComponent(CLICK_SERVICE_ID)}&merchant_id=${encodeURIComponent(CLICK_MERCHANT_ID)}&amount=${amountUzs}&transaction_param=${encodeURIComponent(orderId)}&return_url=${encodeURIComponent(`${PUBLIC_URL}/?payment=${orderId}`)}`;
      } else if (provider === 'payme' && PAYME_MERCHANT_ID) {
        checkoutMode = 'redirect';
        const payloadB64 = Buffer.from(`m=${PAYME_MERCHANT_ID};ac.order_id=${orderId};a=${amountUzs * 100}`).toString('base64');
        checkoutUrl = `https://checkout.paycom.uz/${payloadB64}`;
      } else if ((provider === 'card' || provider === 'stripe') && STRIPE_SECRET_KEY) {
        try {
          const params = new URLSearchParams();
          params.append('mode', 'payment');
          params.append('success_url', `${PUBLIC_URL}/?payment=${orderId}&status=success`);
          params.append('cancel_url', `${PUBLIC_URL}/?payment=${orderId}&status=cancel`);
          params.append('line_items[0][price_data][currency]', 'usd');
          params.append('line_items[0][price_data][product_data][name]', String(body.title || 'Manzil Sayohat Broni').slice(0, 120));
          params.append('line_items[0][price_data][unit_amount]', String(Math.round(amountUsd * 100)));
          params.append('line_items[0][quantity]', '1');
          params.append('metadata[orderId]', orderId);

          const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
          });
          const stripeSession = await stripeRes.json();
          if (stripeRes.ok && stripeSession.url) {
            checkoutMode = 'redirect';
            checkoutUrl = stripeSession.url;
          }
        } catch (e) {
          console.error('[stripe] sessiya yaratib bo‘lmadi:', e.message);
        }
      }

      // Provayder ulanmagan bo'lsa productionda "demo to'lov" YARATILMAYDI — mijozga aniq xato qaytariladi
      if (checkoutMode === 'sandbox' && !DEMO_PAYMENTS) {
        return sendJson(res, 503, {
          ok: false,
          code: 'PAYMENT_PROVIDER_UNAVAILABLE',
          error: 'Bu to‘lov usuli hozircha ulanmagan. Iltimos, boshqa usulni tanlang yoki operator bilan bog‘laning.'
        });
      }

      const contactVal = String(body.contact || body.customerContact || (authUser ? authUser.emailOrPhone : '')).trim().slice(0, 120);
      const order = {
        id: orderId,
        orderId,
        userId: authUser ? authUser.id : null,
        itemType: String(body.itemType || 'guide').slice(0, 30),
        title: String(body.title || 'Gid / Tur xizmati').slice(0, 160),
        guideId: guideRef ? guideRef.id : (body.guideId ? String(body.guideId) : ''),
        guideName: String(guideRef ? guideRef.name : (body.guideName || 'Manzil Hamkor')).slice(0, 100),
        guideTg: String(guideRef ? guideRef.tg : (body.guideTg || '')).replace(/^@/, '').slice(0, 64),
        city: String(body.city || '').slice(0, 100),
        days,
        people,
        customerName: String(body.customerName || (authUser ? authUser.name : 'Mehmon')).trim().slice(0, 100),
        contact: contactVal,
        customerContact: contactVal,
        provider,
        checkoutMode,
        checkoutUrl,
        sandbox: checkoutMode === 'sandbox',
        priceSource: guideRef ? 'server' : 'client',
        amountUsd,
        amountUzs,
        commissionRate: COMMISSION_RATE,
        commissionUsd,
        guidePayoutUsd,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      const payments = readJson(FILES.payments, []);
      payments.unshift(order);
      writeJson(FILES.payments, payments);
      audit(req, 'payment.create', 'payment', orderId, null, { amountUsd, provider, sandbox: order.sandbox, priceSource: order.priceSource }, authUser ? 'user:' + authUser.id : 'guest');

      return sendJson(res, 201, { ok: true, payment: order, order });
    }

    // --- PAYMENTS: SANDBOX CONFIRM (faqat dev/demo rejimida, faqat sandbox buyurtmalar uchun) ---
    if (req.method === 'POST' && pathname === '/api/payments/confirm') {
      const rl = rateLimit(req, 'pay-confirm', 30, 60 * 60 * 1000);
      if (rl) return tooMany(res, rl);
      const body = await parseBody(req);
      const orderId = String(body.orderId || '').trim();
      if (!orderId) return sendJson(res, 400, { ok: false, error: 'orderId ko‘rsatilmagan' });
      const payments = readJson(FILES.payments, []);
      const order = payments.find(p => p.orderId === orderId || p.id === orderId);
      if (!order) return sendJson(res, 404, { ok: false, error: 'Buyurtma topilmadi' });
      if (!order.sandbox || !DEMO_PAYMENTS) {
        return sendJson(res, 403, {
          ok: false,
          error: 'To‘lov faqat to‘lov provayderi tasdiqlagandan so‘ng «to‘langan» holatga o‘tadi.'
        });
      }
      await markPaid(order, payments, 'sandbox', req, 'sandbox-demo');
      return sendJson(res, 200, { ok: true, order });
    }

    // --- PAYMENTS: STRIPE WEBHOOK (imzo tekshiriladi) ---
    if (req.method === 'POST' && pathname === '/api/payments/webhook/stripe') {
      const body = await parseBody(req, 256 * 1024);
      if (!STRIPE_WEBHOOK_SECRET) {
        return sendJson(res, 503, { ok: false, error: 'STRIPE_WEBHOOK_SECRET sozlanmagan' });
      }
      if (!verifyStripeSignature(req.rawBody || '', req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
        return sendJson(res, 400, { ok: false, error: 'Imzo noto‘g‘ri' });
      }
      if (body.type === 'checkout.session.completed') {
        const s = (body.data && body.data.object) || {};
        const orderId = s.metadata && s.metadata.orderId;
        const payments = readJson(FILES.payments, []);
        const order = payments.find(p => p.orderId === orderId);
        if (order && !order.sandbox && s.payment_status === 'paid' &&
            s.currency === 'usd' && Number(s.amount_total) === Math.round(order.amountUsd * 100)) {
          await markPaid(order, payments, 'stripe-webhook', req, 'stripe');
        } else {
          audit(req, 'payment.webhook_rejected', 'payment', orderId || '', null, { reason: 'order/amount mismatch yoki to‘lanmagan' }, 'stripe');
        }
      }
      return sendJson(res, 200, { ok: true, received: true });
    }

    // --- PAYMENTS: CLICK / PAYME WEBHOOK (hali ulanmagan — yolg'on tasdiqlashga yo'l qo'yilmaydi) ---
    if (req.method === 'POST' && (pathname === '/api/payments/webhook/click' || pathname === '/api/payments/webhook/payme')) {
      audit(req, 'payment.webhook_unsupported', 'payment', '', null, { path: pathname }, 'public');
      return sendJson(res, 501, {
        ok: false,
        error: 'Click/Payme Merchant API imzo tekshiruvi hali ulanmagan. Buyurtmani admin panelda qo‘lda tasdiqlang.'
      });
    }

    // --- PAYMENTS: UPDATE STATUS (Admin) ---
    const payStatusMatch = pathname.match(/^\/api\/(?:admin\/)?payments\/([^/]+)\/status$/);
    if (req.method === 'POST' && payStatusMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const payId = decodeURIComponent(payStatusMatch[1]);
      const newStatus = String(body.status || 'paid');
      if (!PAYMENT_STATUSES.includes(newStatus)) {
        return sendJson(res, 400, { ok: false, error: 'Noto‘g‘ri holat. Ruxsat etilgan: ' + PAYMENT_STATUSES.join(', ') });
      }
      const payments = readJson(FILES.payments, []);
      const item = payments.find(p => String(p.orderId) === payId || String(p.id) === payId);
      if (!item) return sendJson(res, 404, { ok: false, error: 'Buyurtma topilmadi' });
      const before = { status: item.status };
      if (newStatus === 'paid') {
        await markPaid(item, payments, 'admin-manual', req, adminActor(req));
      } else {
        item.status = newStatus;
        item.updatedAt = new Date().toISOString();
        writeJson(FILES.payments, payments);
        audit(req, 'payment.status', 'payment', item.orderId, before, { status: newStatus, reason: String(body.reason || '').slice(0, 300) }, adminActor(req));
      }
      return sendJson(res, 200, { ok: true, payment: item });
    }

    // --- PAYMENTS: LIST ---
    if (req.method === 'GET' && (pathname === '/api/payments' || pathname === '/api/admin/payments')) {
      const payments = readJson(FILES.payments, []).map(p => ({
        ...p,
        id: p.id || p.orderId,
        contact: p.contact || p.customerContact || ''
      }));
      if (isAdmin(req, urlObj)) {
        const paid = payments.filter(isRealPaid);
        const totalVolumeUsd = Number(paid.reduce((s, p) => s + (p.amountUsd || 0), 0).toFixed(2));
        const totalCommissionUsd = Number(paid.reduce((s, p) => s + (p.commissionUsd || 0), 0).toFixed(2));
        return sendJson(res, 200, {
          ok: true,
          summary: { totalOrders: payments.length, paidOrders: paid.length, totalVolumeUsd, totalCommissionUsd },
          payments
        });
      }
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { ok: false, error: 'Avtorizatsiya yoki Admin kaliti kerak' });
      const mine = payments.filter(p => p.userId === user.id);
      return sendJson(res, 200, { ok: true, payments: mine });
    }

    // Unknown API route
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'API endpoint topilmadi' });
    }

    // --- STATIC FRONTEND ---
    serveStatic(req, res, pathname);
  } catch (err) {
    const clientErr = /JSON|Payload/.test(String(err && err.message));
    console.error('[Manzil Server Error]', err);
    sendJson(res, clientErr ? 400 : 500, { ok: false, error: clientErr ? err.message : 'Server ichki xatoligi' });
  }
});

// 10. Telegram Webhook va Kutilayotgan Xabarlarni Sinxronlash
let _tgOffset = 0;
async function pollPendingTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return;
  try {
    const whInfo = await fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo').then(r => r.json());
    if (whInfo.ok && (!whInfo.result.url || whInfo.result.pending_update_count > 0)) {
      if (whInfo.result.url) {
        await fetch('https://api.telegram.org/bot' + token + '/deleteWebhook', { method: 'POST' });
      }
      const res = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?timeout=1&offset=' + _tgOffset).then(r => r.json());
      if (res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          _tgOffset = upd.update_id + 1;
          await processTelegramUpdate(upd);
        }
      }
    }
    const pubUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\/+$/, '');
    if (pubUrl.startsWith('https://')) {
      await fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pubUrl + '/api/telegram/webhook', ...WEBHOOK_PARAMS })
      });
    }
  } catch (e) {}
}
setTimeout(pollPendingTelegram, 3500);

server.listen(PORT, () => {
  console.log(`\n🚀 Manzil Server ishga tushdi: ${PUBLIC_URL}  [${IS_PROD ? 'production' : 'development'}]`);
  console.log(`   ├─ Health check: ${PUBLIC_URL}/api/health`);
  console.log(`   ├─ Telegram bot: ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? '✅ Ulangan' : '⚠️ Sozlanmagan (.env)'}`);
  console.log(`   ├─ Real AI Chat: ${OPENAI_API_KEY ? '✅ OpenAI' : ''}${GROK_API_KEY ? ' ✅ Grok (xAI)' : ''}${!OPENAI_API_KEY && !GROK_API_KEY ? 'ℹ️ Lokal fallback rejimi' : ''}`);
  console.log(`   ├─ To'lov: ${DEMO_PAYMENTS ? '🧪 Sandbox yoqilgan (daromadga qo‘shilmaydi)' : '🔒 Faqat provayder tasdiqlagan to‘lovlar'}`);
  console.log(`   └─ Komissiya stavkasi: ${Math.round(COMMISSION_RATE * 100)}%\n`);
});
