'use strict';
/**
 * Manzil — SQLite ma'lumotlar bazasi qatlami (npm paketlarsiz, Node.js >= 22.13 ichidagi node:sqlite).
 *
 *  DB_PATH=:memory:   → butunlay xotirada (test uchun; server o'chsa hammasi yo'qoladi)
 *  DB_PATH=/data/x.db → diskdagi fayl (Render'da "Persistent Disk" ulang, aks holda qayta deploy'da o'chadi)
 *
 * Pul summalari hamma joyda BUTUN SENTLARDA (INTEGER) saqlanadi — suzuvchi nuqta xatolari bo'lmasligi uchun.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('\n[FATAL] Bu server Node.js ichidagi SQLite (node:sqlite) dan foydalanadi.');
  console.error('        Node.js 22.13 yoki yangiroq versiya kerak. Hozirgi versiya: ' + process.version);
  console.error('        Render: Environment > NODE_VERSION = 22 ni qo\'shing.\n');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'manzil.db');
const IN_MEMORY = DB_PATH === ':memory:';
if (!IN_MEMORY) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
  return s;
}
const norm = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const run = (sql, ...p) => stmt(sql).run(...norm(p));
const get = (sql, ...p) => stmt(sql).get(...norm(p));
const all = (sql, ...p) => stmt(sql).all(...norm(p));

let inTx = false;
function tx(fn) {
  if (inTx) return fn();
  raw.exec('BEGIN IMMEDIATE');
  inTx = true;
  try {
    const r = fn();
    raw.exec('COMMIT');
    inTx = false;
    return r;
  } catch (e) {
    try { raw.exec('ROLLBACK'); } catch (_) {}
    inTx = false;
    throw e;
  }
}

const uid = prefix => prefix + crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT,
  role TEXT NOT NULL DEFAULT 'tourist', password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_login TEXT, pw_changed_at TEXT
);
CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  favorites TEXT NOT NULL DEFAULT '[]', route TEXT NOT NULL DEFAULT '[]',
  plan TEXT NOT NULL DEFAULT '[]', checklist TEXT NOT NULL DEFAULT '[]', updated_at TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last INTEGER NOT NULL DEFAULT 0,
  must_change_pw INTEGER NOT NULL DEFAULT 0, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_login TEXT, created_by TEXT, pw_changed_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, ip TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_type, actor_id);

CREATE TABLE IF NOT EXISTS guides (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, country TEXT, langs TEXT, spec TEXT, bio TEXT, about TEXT,
  rate REAL NOT NULL DEFAULT 50, exp INTEGER NOT NULL DEFAULT 3, tg TEXT, grp TEXT,
  status TEXT NOT NULL DEFAULT 'pending', commission_rate REAL, user_id TEXT, verified INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, price_status TEXT NOT NULL DEFAULT 'estimated',
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, user_id TEXT, guide_id TEXT, staff_id TEXT,
  item_type TEXT NOT NULL, title TEXT NOT NULL, city TEXT, travel_date TEXT, days INTEGER NOT NULL DEFAULT 1, people INTEGER NOT NULL DEFAULT 1,
  customer_name TEXT, contact TEXT, amount_c INTEGER NOT NULL, amount_uzs INTEGER NOT NULL, rate_uzs REAL NOT NULL,
  commission_rate REAL NOT NULL, commission_c INTEGER NOT NULL, payout_c INTEGER NOT NULL,
  price_source TEXT NOT NULL DEFAULT 'server', status TEXT NOT NULL DEFAULT 'awaiting_payment',
  created_at TEXT NOT NULL, assigned_at TEXT, confirmed_at TEXT, completed_at TEXT, cancelled_at TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_staff ON bookings(staff_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', amount_c INTEGER NOT NULL, amount_uzs INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
  is_sandbox INTEGER NOT NULL DEFAULT 0, provider_txn_id TEXT, checkout_url TEXT, receipt_id TEXT,
  created_at TEXT NOT NULL, paid_at TEXT, refunded_c INTEGER NOT NULL DEFAULT 0, meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_txn ON payments(provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS provider_txns (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, payment_id TEXT NOT NULL REFERENCES payments(id),
  state INTEGER NOT NULL, amount INTEGER NOT NULL, create_time INTEGER NOT NULL, perform_time INTEGER NOT NULL DEFAULT 0,
  cancel_time INTEGER NOT NULL DEFAULT 0, reason INTEGER, extra TEXT
);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at TEXT NOT NULL, payload TEXT,
  UNIQUE(provider, event_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), booking_id TEXT NOT NULL,
  amount_c INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'requested',
  requested_by TEXT, requested_by_type TEXT, decided_by TEXT, decided_at TEXT, processed_at TEXT, provider_ref TEXT,
  method TEXT, note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, txn_id TEXT NOT NULL, at TEXT NOT NULL, account TEXT NOT NULL,
  debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, party TEXT, ref_type TEXT, ref_id TEXT, memo TEXT, actor TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_txn ON ledger(txn_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account, party);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY, party TEXT NOT NULL, amount_c INTEGER NOT NULL, method TEXT, reference TEXT, note TEXT,
  created_at TEXT NOT NULL, created_by TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT, amount_c INTEGER NOT NULL, spent_at TEXT NOT NULL,
  created_by TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE, user_id TEXT, guide_id TEXT, staff_id TEXT,
  rating INTEGER NOT NULL, service_rating INTEGER, comment TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, name TEXT, contact TEXT, type TEXT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  handled_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, provider TEXT, model TEXT, ip TEXT, user_msg TEXT, reply TEXT
);
CREATE TABLE IF NOT EXISTS bot_users (id TEXT PRIMARY KEY, first_name TEXT, username TEXT, updated_at TEXT);

CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_type TEXT, actor_id TEXT, actor_label TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity, entity_id);
`;
raw.exec(SCHEMA);

// ---- Sozlamalar ----
const DEFAULT_SETTINGS = {
  commission_rate: '0.12',
  usd_uzs_rate: '12850',
  sla_confirm_minutes: '60',
  // Bekor qilish siyosati: sayohatga necha kun qolgan bo'lsa, necha foiz qaytariladi (FARAZ — biznes qarori kerak)
  cancel_policy: JSON.stringify([{ minDays: 7, pct: 100 }, { minDays: 3, pct: 50 }, { minDays: 0, pct: 0 }]),
  refund_self_approve: 'false'
};
function getSetting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  if (r) return r.value;
  return key in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[key] : fallback;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}
// Ilova siri (webhook tokenlari uchun): bir marta tasodifiy yaratiladi va bazada saqlanadi
function appSecret() {
  let s = get('SELECT value FROM settings WHERE key=?', 'app_secret');
  if (!s) { setSetting('app_secret', crypto.randomBytes(32).toString('hex')); s = get('SELECT value FROM settings WHERE key=?', 'app_secret'); }
  return s.value;
}

// ---- Namunaviy gidlar (faqat baza bo'sh bo'lsa) ----
const SAMPLE_GUIDES = [
  ['Azizbek Karimov', 'Samarqand', "O'zbekiston", "O'zbek, Rus, Ingliz", 'Tarixiy obidalar va Registon sirlari', 45, 7, 'azizbek_samarkand_guide', '28-noyabr · Samarqand + Shahrisabz (3 joy qoldi)'],
  ['Nilufar Raximova', 'Buxoro', "O'zbekiston", "O'zbek, Ingliz, Fransuz", "Eski shahar me'morchiligi va gastronomiya", 40, 5, 'nilufar_bukhara', ''],
  ['Temur Jumaniyozov', "Mo'ynoq va Orolbo'yi", "O'zbekiston", "O'zbek, Qoraqalpoq, Rus", "4x4 Ustyurt kanyonlari va Orolbo'yi ekspeditsiyasi", 95, 8, 'aral_expedition_uz', "5-dekabr · Nukus → Ustyurt → Mo'ynoq (2 joy qoldi)"],
  ['Emre Yilmaz', 'Istanbul', 'Turkiya', "O'zbek, Turk, Rus", 'Istanbul sirlari, Bosfor va xarid turlari', 75, 6, 'emre_istanbul_uz', 'Har shanba · Sultonahmet va Osiyo qismi piyoda turi'],
  ['Giorgi Beridze', 'Tbilisi va Qozbegi', 'Gruziya', 'Rus, Ingliz, Gruzin', "Qozbegi tog'lari, Kaxetiya va oilaviy turlar", 70, 6, 'giorgi_georgia_tour', '12-dekabr · Tbilisi → Ananuri → Qozbegi'],
  ['Sardor Toshmatov', 'Dubay', 'BAA', "O'zbek, Rus, Ingliz", "VIP transfer, Cho'l safari va Abu-Dabi turi", 90, 5, 'dubai_uz_guide', ''],
  ['Madina Alimova', 'Parij', 'Fransiya', "O'zbek, Fransuz, Ingliz", 'Luvr, Monmartr va fotosessiya turlari', 110, 5, 'madina_paris_guide', ''],
  ['Bekzod Xolmatov', 'Seul', 'Janubiy Koreya', "O'zbek, Koreys, Rus", 'Seul saroylari, K-pop va tibbiy/xarid turlari', 85, 4, 'bekzod_seoul', '']
];
function seedSampleGuides() {
  if (get('SELECT COUNT(*) c FROM guides').c > 0) return;
  if (process.env.SEED_SAMPLE_GUIDES === 'false') return;
  tx(() => {
    SAMPLE_GUIDES.forEach((g, i) => run(
      `INSERT INTO guides(id,name,city,country,langs,spec,bio,rate,exp,tg,grp,status,is_sample,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'approved',1,?,?)`,
      'guide_seed_' + (i + 1), g[0], g[1], g[2], g[3], g[4], g[4], g[5], g[6], g[7], g[8], now(), now()));
  });
}

// ---- Eski JSON fayllardan (data/*.json) bir martalik import ----
function importLegacyJson() {
  const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch (_) { return []; } };
  if (IN_MEMORY || get('SELECT COUNT(*) c FROM users').c > 0 || get('SELECT value FROM settings WHERE key=?', 'legacy_imported')) return { imported: false };
  const users = rd('users.json').filter(u => u && u.passwordHash && u.id !== 'admin_master');
  const guides = rd('guides.json').filter(g => g && g.id && !String(g.id).startsWith('guide_seed_'));
  const feedback = rd('feedback.json');
  const dests = rd('destinations.json');
  if (!users.length && !guides.length && !feedback.length && !dests.length) return { imported: false };
  tx(() => {
    for (const u of users) {
      const email = String(u.emailOrPhone || u.email || '').trim().toLowerCase();
      if (!email || get('SELECT 1 x FROM users WHERE email=?', email)) continue;
      run('INSERT INTO users(id,name,email,role,password_hash,created_at,pw_changed_at) VALUES(?,?,?,?,?,?,?)',
        u.id, String(u.name || 'Foydalanuvchi').slice(0, 100), email, u.role === 'guide' ? 'guide' : 'tourist', u.passwordHash, u.createdAt || now(), u.createdAt || now());
      const sd = u.savedData || {};
      run('INSERT INTO user_data(user_id,favorites,route,plan,checklist,updated_at) VALUES(?,?,?,?,?,?)', u.id,
        JSON.stringify(u.favorites || sd.favorites || []), JSON.stringify(u.route || sd.route || []), JSON.stringify(sd.plan || []), JSON.stringify(sd.checklist || []), now());
    }
    for (const g of guides) {
      const status = g.rejected ? 'rejected' : g.approved === false ? 'pending' : 'approved';
      run(`INSERT OR IGNORE INTO guides(id,name,city,country,langs,spec,bio,about,rate,exp,tg,grp,status,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, g.id, g.name, g.city, g.country, g.langs, g.spec, g.bio || g.spec, g.about, Number(g.rate || g.price) || 50, Number(g.exp) || 3, g.tg, g.group, status, g.createdAt || now(), now());
    }
    for (const f of feedback) run('INSERT OR IGNORE INTO feedback(id,name,contact,type,message,created_at) VALUES(?,?,?,?,?,?)', f.id || uid('fb_'), f.name, f.contact, f.type, f.message || f.msg || '', f.createdAt || now());
    for (const d of dests) run('INSERT OR IGNORE INTO destinations(id,data,price_status,created_at,updated_at) VALUES(?,?,?,?,?)', String(d.id), JSON.stringify(d), d.priceStatus || 'estimated', d.createdAt || now(), now());
    setSetting('legacy_imported', now());
  });
  return { imported: true, users: users.length, guides: guides.length, feedback: feedback.length, destinations: dests.length };
}

// ---- Admin bazani ko'rish uchun ruxsat etilgan jadvallar va yashirin ustunlar ----
const VIEWABLE_TABLES = ['users', 'staff', 'bookings', 'payments', 'refunds', 'ledger', 'payouts', 'expenses', 'guides', 'destinations', 'reviews', 'feedback', 'audit', 'ai_log', 'settings', 'sessions'];
const MASKED_COLUMNS = new Set(['password_hash', 'totp_secret', 'id_hash', 'payload_secret']);

module.exports = {
  raw, run, get, all, tx, uid, now, DATA_DIR, DB_PATH, IN_MEMORY,
  getSetting, setSetting, appSecret, seedSampleGuides, importLegacyJson, VIEWABLE_TABLES, MASKED_COLUMNS
};
