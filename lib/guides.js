'use strict';
/**
 * Manzil gid platformasi (/guide) — tasdiqlangan gidlar uchun alohida kirish.
 *  - Har bir gidga alohida login va parol. Ular FAQAT Telegram bot orqali gidning o'z chatiga yuboriladi;
 *    bazada parolning faqat scrypt xeshi saqlanadi. Parol xabari botdan 30 daqiqadan keyin o'chiriladi.
 *  - Gid botga ikki yo'l bilan ulanadi: admin bergan bir martalik havola (/start g_<token>, 7 kun)
 *    yoki gid arizasidagi Telegram username bilan botga yozsa (Telegram username'ni soxtalashtirib bo'lmaydi).
 *  - Kirish: login + parol. Yangi qurilmada botga 6 xonali kod keladi (5 daqiqa, 5 urinish).
 *    "Bu men emasman" → kirish to'xtatiladi, hamma qurilmalardan chiqariladi, parol almashtiriladi, adminlar ogohlantiriladi.
 *  - 5 marta noto'g'ri parol → 15 daqiqa blok. Har bir amal audit jurnaliga yoziladi.
 */
const crypto = require('crypto');
const db = require('./db');
const sec = require('./security');
const { HttpError } = sec;

// bot.js bilan aylana bog'liqlik bo'lmasligi uchun Telegram funksiyalari server.js dan ulanadi
let TG = null;
function useTelegram(api) { TG = api; }
const tgOn = () => !!(TG && TG.enabled());

const SYSTEM = { type: 'system', id: 'system', label: 'tizim' };
const CREDS_TTL_MS = () => Number(process.env.GUIDE_CREDS_TTL_MS) || 30 * 60e3;
const CODE_TTL_MS = 5 * 60e3;
const DEVICE_TTL_MS = 30 * 86400e3;
const DEVICE_COOKIE = 'mz_gdev';
const publicUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const portalUrl = () => (publicUrl() || '') + '/guide';
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const actorOf = acc => ({ type: 'guide', id: acc.id, label: acc.login });

// ---------------- Login va parol ----------------
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O va 1/l/I yo'q — o'qishda adashmaslik uchun
function genPassword() {
  const pick = n => Array.from({ length: n }, () => PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)]).join('');
  return `${pick(4)}-${pick(4)}-${pick(4)}`; // 12 belgi ≈ 69 bit
}
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
const ascii = s => String(s || '').toLowerCase().split('').map(c => (c in CYR ? CYR[c] : c)).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
function makeLogin(guide) {
  const first = ascii(String(guide.name || '').split(/\s+/)[0]).slice(0, 12) || 'gid';
  for (let i = 0; i < 40; i++) {
    const login = (first.length >= 3 ? first : 'gid' + first) + crypto.randomInt(100, 1000);
    if (!db.get('SELECT 1 x FROM guide_accounts WHERE login=?', login)) return login;
  }
  return 'gid' + crypto.randomBytes(4).toString('hex');
}

function eligibleGuide(guideId) {
  const g = db.get('SELECT * FROM guides WHERE id=?', guideId);
  if (!g) throw new HttpError(404, 'Gid topilmadi.');
  if (g.is_sample) throw new HttpError(409, 'Namunaviy gid profiliga kirish berilmaydi.');
  if (g.status !== 'approved') throw new HttpError(409, 'Kirish faqat tasdiqlangan gidlarga beriladi.');
  return g;
}
function ensureAccount(guideId) {
  const a = db.get('SELECT * FROM guide_accounts WHERE id=?', guideId);
  if (a) return a;
  const g = db.get('SELECT * FROM guides WHERE id=?', guideId);
  if (!g) throw new HttpError(404, 'Gid topilmadi.');
  db.run('INSERT INTO guide_accounts(id,login,created_at) VALUES(?,?,?)', g.id, makeLogin(g), db.now());
  return db.get('SELECT * FROM guide_accounts WHERE id=?', g.id);
}
const accountById = id => db.get('SELECT * FROM guide_accounts WHERE id=?', id);
const accountByLogin = login => db.get('SELECT * FROM guide_accounts WHERE login=?', String(login || '').trim().toLowerCase());
const accountByChat = chatId => db.get('SELECT * FROM guide_accounts WHERE tg_chat_id=?', String(chatId));

/** Admin paneli uchun holat (parol hech qachon ko'rsatilmaydi) */
function accessView(guideId) {
  const a = accountById(guideId);
  if (!a) return { exists: false, linked: false };
  return { exists: true, login: a.login, linked: !!a.tg_chat_id, status: a.status, pwSentAt: a.pw_sent_at, lastLogin: a.last_login,
    locked: a.locked_until > Date.now(), devices: db.get('SELECT COUNT(*) c FROM guide_devices WHERE guide_id=? AND expires_at>?', guideId, Date.now()).c };
}

// ---------------- Telegram'ga ulash ----------------
function issueLink(guideId, staff) {
  const g = eligibleGuide(guideId);
  const a = ensureAccount(g.id);
  const token = crypto.randomBytes(18).toString('base64url');
  db.run('DELETE FROM guide_links WHERE guide_id=? OR expires_at<?', g.id, Date.now());
  db.run('INSERT INTO guide_links(token_hash,guide_id,expires_at,created_by) VALUES(?,?,?,?)', sec.sha256(token), g.id, Date.now() + 7 * 86400e3, staff ? staff.id : null);
  const bot = TG && TG.botName && TG.botName();
  return { url: bot ? `https://t.me/${bot}?start=g_${token}` : null, login: a.login, expiresAt: new Date(Date.now() + 7 * 86400e3).toISOString() };
}
function linkChat(guideId, chatId, lang, via) {
  const prev = ensureAccount(guideId);
  const chat = String(chatId);
  db.run('UPDATE guide_accounts SET tg_chat_id=NULL WHERE tg_chat_id=? AND id<>?', chat, guideId); // bitta chat — bitta gid
  db.run('UPDATE guide_accounts SET tg_chat_id=?, lang=COALESCE(?, lang) WHERE id=?', chat, lang || null, guideId);
  // Chat boshqasiga almashsa (masalan yangi Telegram hisob) — eski sessiyalar bekor qilinadi
  if (prev.tg_chat_id && prev.tg_chat_id !== chat) revokeAll(guideId);
  sec.audit({ type: 'system', id: 'bot', label: 'telegram' }, 'guide.telegram_linked', 'guide', guideId, { linked: !!prev.tg_chat_id }, { via });
  return accountById(guideId);
}
function consumeLink(token, chatId, lang) {
  const row = db.get('SELECT * FROM guide_links WHERE token_hash=?', sec.sha256(String(token || '')));
  if (!row || row.expires_at < Date.now()) return { ok: false };
  const g = db.get("SELECT * FROM guides WHERE id=? AND status='approved' AND is_sample=0", row.guide_id);
  db.run('DELETE FROM guide_links WHERE token_hash=?', row.token_hash);
  if (!g) return { ok: false };
  return { ok: true, guide: g, account: linkChat(g.id, chatId, lang, 'admin_link') };
}
/** Ariza'dagi Telegram username bo'yicha (faqat tasdiqlangan, haqiqiy gid; boshqa chatga ulanmagan bo'lsa) */
function guideByUsername(username, chatId) {
  const u = String(username || '').replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{4,32}$/.test(u)) return null;
  const g = db.get("SELECT * FROM guides WHERE lower(tg)=? AND status='approved' AND is_sample=0 ORDER BY created_at LIMIT 1", u);
  if (!g) return null;
  const a = accountById(g.id);
  if (a && a.tg_chat_id && a.tg_chat_id !== String(chatId)) return null; // boshqa chatga ulangan — faqat admin havolasi bilan
  return g;
}

// ---------------- Kirish ma'lumotlarini bot orqali yuborish ----------------
const deliverHits = new Map();
async function deliverCredentials(guideId, { reason = 'issue', actor = null } = {}) {
  const g = eligibleGuide(guideId);
  const a = ensureAccount(g.id);
  if (!a.tg_chat_id) throw new HttpError(409, 'Gid Telegram botga hali ulanmagan. Unga ulanish havolasini yuboring.');
  if (!tgOn()) throw new HttpError(503, 'Telegram bot ulanmagan.');
  const t0 = Date.now(), hits = (deliverHits.get(g.id) || []).filter(x => t0 - x < 3600e3);
  if (hits.length >= 6) throw new HttpError(429, 'Juda ko\'p so\'rov. Bir soatdan keyin qayta urining.');
  hits.push(t0); deliverHits.set(g.id, hits);
  const pw = genPassword(), hash = await sec.hashPassword(pw), lang = a.lang || 'uz';
  const kb = [[{ text: TG.t(lang, 'g_btn_newpw'), callback_data: 'gp' }]];
  if (/^https:\/\//.test(portalUrl())) kb.unshift([{ text: TG.t(lang, 'g_btn_open'), url: portalUrl() }]);
  // Avval xabar yuboriladi; yetib borsagina yangi parol kuchga kiradi (aks holda gid eski parolsiz qolmaydi)
  const msg = await TG.send(a.tg_chat_id, TG.t(lang, 'g_creds', { name: esc(g.name), login: esc(a.login), password: esc(pw), url: esc(portalUrl()), min: Math.round(CREDS_TTL_MS() / 60000) }), { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
  if (!msg) throw new HttpError(502, 'Telegram xabarini yuborib bo\'lmadi. Gid botni bloklamaganini tekshiring.');
  db.run('UPDATE guide_accounts SET password_hash=?, pw_sent_at=?, failed_logins=0, locked_until=0 WHERE id=?', hash, db.now(), a.id);
  revokeAll(a.id); // yangi parol — barcha eski sessiya va ishonchli qurilmalar bekor
  if (TG.scheduleDelete) TG.scheduleDelete(a.tg_chat_id, msg.message_id, CREDS_TTL_MS());
  sec.audit(actor || SYSTEM, 'guide.credentials_sent', 'guide', a.id, null, { reason, login: a.login, via: 'telegram' });
  return { sent: true, login: a.login };
}

// ---------------- Sessiyalar, qurilmalar ----------------
function revokeAll(guideId) {
  sec.revokeAllSessions('guide', guideId);
  db.run('DELETE FROM guide_devices WHERE guide_id=?', guideId);
  db.run('UPDATE guide_challenges SET used=1 WHERE guide_id=? AND used=0', guideId);
}
function trustedDevice(req, guideId) {
  const tok = sec.parseCookies(req)[DEVICE_COOKIE];
  if (!tok) return false;
  const d = db.get('SELECT * FROM guide_devices WHERE token_hash=? AND guide_id=?', sec.sha256(tok), guideId);
  if (!d || d.expires_at < Date.now()) return false;
  db.run('UPDATE guide_devices SET last_used=? WHERE token_hash=?', Date.now(), d.token_hash);
  return true;
}
function rememberDevice(req, res, guideId) {
  const tok = crypto.randomBytes(32).toString('base64url'), t = Date.now();
  const old = db.all('SELECT token_hash FROM guide_devices WHERE guide_id=? ORDER BY created_at DESC', guideId);
  old.slice(4).forEach(d => db.run('DELETE FROM guide_devices WHERE token_hash=?', d.token_hash)); // eng ko'pi 5 ta qurilma
  db.run('INSERT INTO guide_devices(token_hash,guide_id,created_at,expires_at,last_used,ua,ip) VALUES(?,?,?,?,?,?,?)', sec.sha256(tok), guideId, t, t + DEVICE_TTL_MS, t, String(req.headers['user-agent'] || '').slice(0, 200), sec.clientIp(req));
  sec.setCookie(req, res, DEVICE_COOKIE, tok, { maxAgeSec: DEVICE_TTL_MS / 1000, sameSite: 'Strict' });
}
function deviceLabel(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Yandex' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Brauzer';
  return os ? `${br} · ${os}` : br;
}
const tashkent = (ms = Date.now()) => { const d = new Date(ms + 5 * 3600e3).toISOString(); return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)} ${d.slice(11, 16)}`; };

// ---------------- Kirish: 1-bosqich (parol) ----------------
async function passwordStep(req, login, password) {
  const a = accountByLogin(login);
  if (!a || !a.password_hash) { await sec.dummyVerify(password); throw new HttpError(401, 'Login yoki parol noto\'g\'ri.'); }
  if (a.locked_until > Date.now()) throw new HttpError(423, `Hisob vaqtincha bloklangan. ${Math.ceil((a.locked_until - Date.now()) / 60000)} daqiqadan keyin urining.`);
  const v = await sec.verifyPassword(password, a.password_hash);
  if (!v.ok) {
    const n = a.failed_logins + 1;
    if (n >= 5) db.run('UPDATE guide_accounts SET failed_logins=0, locked_until=? WHERE id=?', Date.now() + 15 * 60e3, a.id);
    else db.run('UPDATE guide_accounts SET failed_logins=? WHERE id=?', n, a.id);
    sec.audit(actorOf(a), 'guide.login_failed', 'guide', a.id, null, null, req);
    if (n >= 5 && a.tg_chat_id && tgOn()) TG.send(a.tg_chat_id, TG.t(a.lang || 'uz', 'g_locked_alert', { time: tashkent() }));
    throw new HttpError(401, 'Login yoki parol noto\'g\'ri.');
  }
  const g = db.get('SELECT * FROM guides WHERE id=?', a.id);
  if (!g || g.status !== 'approved' || a.status !== 'active') throw new HttpError(403, 'Hisobingiz faol emas. Manzil jamoasi bilan bog\'laning.');
  db.run('UPDATE guide_accounts SET failed_logins=0 WHERE id=?', a.id);
  return a;
}

// ---------------- Kirish: 2-bosqich (Telegram kodi) ----------------
async function createChallenge(req, a) {
  if (!a.tg_chat_id) throw new HttpError(409, 'Telegram ulanmagan. Manzil jamoasidan ulanish havolasini so\'rang.');
  if (!tgOn()) throw new HttpError(503, 'Telegram bot hozir ishlamayapti. Birozdan keyin urining.');
  db.run('UPDATE guide_challenges SET used=1 WHERE guide_id=? AND used=0', a.id); // oldingi kodlar bekor
  const id = db.uid('gc_'), code = String(crypto.randomInt(100000, 1000000)), lang = a.lang || 'uz', ua = String(req.headers['user-agent'] || '');
  db.run('INSERT INTO guide_challenges(id,guide_id,code_hash,expires_at,ip,ua,created_at) VALUES(?,?,?,?,?,?,?)', id, a.id, sec.sha256(id + ':' + code), Date.now() + CODE_TTL_MS, sec.clientIp(req), ua.slice(0, 200), db.now());
  const msg = await TG.send(a.tg_chat_id, TG.t(lang, 'g_code', { code, device: esc(deviceLabel(ua)), time: tashkent(), ip: esc(sec.clientIp(req)) }), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: TG.t(lang, 'g_btn_notme'), callback_data: 'gx:' + id }]] } });
  if (!msg) { db.run('UPDATE guide_challenges SET used=1 WHERE id=?', id); throw new HttpError(502, 'Kodni Telegram\'ga yuborib bo\'lmadi. Botni bloklamaganingizni tekshiring.'); }
  db.run('UPDATE guide_challenges SET tg_msg_id=? WHERE id=?', msg.message_id, id);
  if (TG.scheduleDelete) TG.scheduleDelete(a.tg_chat_id, msg.message_id, CODE_TTL_MS);
  sec.audit(actorOf(a), 'guide.login_code_sent', 'guide', a.id, null, null, req);
  return id;
}
function verifyChallenge(req, challengeId, code) {
  const bad = () => new HttpError(400, 'Kod noto\'g\'ri yoki muddati o\'tgan.');
  const ch = db.get('SELECT * FROM guide_challenges WHERE id=?', String(challengeId || ''));
  if (!ch || ch.used || ch.expires_at < Date.now() || ch.attempts >= 5) throw bad();
  if (!sec.safeEqual(ch.code_hash, sec.sha256(ch.id + ':' + String(code || '').replace(/\s/g, '')))) {
    db.run('UPDATE guide_challenges SET attempts=attempts+1 WHERE id=?', ch.id);
    const a0 = accountById(ch.guide_id); if (a0) sec.audit(actorOf(a0), 'guide.login_code_failed', 'guide', a0.id, null, null, req);
    throw bad();
  }
  db.run('UPDATE guide_challenges SET used=1 WHERE id=?', ch.id);
  const a = accountById(ch.guide_id);
  const g = a && db.get('SELECT * FROM guides WHERE id=?', a.id);
  if (!a || a.status !== 'active' || !g || g.status !== 'approved') throw new HttpError(403, 'Hisobingiz faol emas.');
  if (a.tg_chat_id && ch.tg_msg_id && TG && TG.call) TG.call('deleteMessage', { chat_id: a.tg_chat_id, message_id: ch.tg_msg_id }); // ishlatilgan kod chatda qolmasin
  return a;
}
function finishLogin(req, res, a, { remember, viaDevice }) {
  sec.createSession(req, res, 'guide', a.id);
  if (remember && !viaDevice) rememberDevice(req, res, a.id);
  db.run('UPDATE guide_accounts SET last_login=?, locked_until=0, failed_logins=0 WHERE id=?', db.now(), a.id);
  sec.audit(actorOf(a), 'guide.login', 'guide', a.id, null, { trustedDevice: !!viaDevice, remember: !!remember }, req);
  // Yangi qurilmadan kirilsa — Telegram'ga xabar va "Bu men emasman" tugmasi
  if (!viaDevice && a.tg_chat_id && tgOn()) {
    const lang = a.lang || 'uz';
    TG.send(a.tg_chat_id, TG.t(lang, 'g_login_ok', { device: deviceLabel(req.headers['user-agent']), time: tashkent() }), { reply_markup: { inline_keyboard: [[{ text: TG.t(lang, 'g_btn_notme'), callback_data: 'gk' }]] } });
  }
}

/** "Bu men emasman": kirish to'xtatiladi, hamma joydan chiqariladi, yangi parol yuboriladi, adminlar ogohlantiriladi. */
async function notMe(a, source) {
  revokeAll(a.id); // eski parol bilan kirgan begona odam darhol chiqadi; parol quyida almashtiriladi
  sec.audit(actorOf(a), 'guide.not_me', 'guide', a.id, null, { source });
  const g = db.get('SELECT name FROM guides WHERE id=?', a.id);
  if (TG && TG.notifyStaff) TG.notifyStaff(`🛡 Gid ${g ? g.name : a.login} (${a.login}): "Bu men emasman" bosildi — sessiyalar yopildi, parol almashtirildi.`);
  try { await deliverCredentials(a.id, { reason: 'not_me' }); }
  catch (e) { db.run('UPDATE guide_accounts SET password_hash=NULL WHERE id=?', a.id); console.warn('[guides] not_me rotate', e.message); } // yangi parol yetib bormasa ham eski parol ishlamaydi
}

// ---------------- Gid uchun ma'lumotlar ----------------
const PAID = "('paid','partially_refunded')";
function bookingRows(guideId) {
  return db.all(`SELECT b.*, (SELECT status FROM payments WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1) pay_status FROM bookings b
    WHERE b.guide_id=? AND b.status<>'awaiting_payment' ORDER BY COALESCE(b.travel_date,'9999') ASC, b.created_at DESC LIMIT 300`, guideId);
}
function bookingView(b) {
  const paid = ['paid', 'partially_refunded'].includes(b.pay_status) && ['pending', 'confirmed', 'completed'].includes(b.status);
  return { id: b.id, code: b.code, place: b.city, title: b.title, travelDate: b.travel_date, days: b.days, people: b.people, status: b.status, payStatus: b.pay_status,
    payoutUsd: Math.round(b.payout_c) / 100, genderPref: b.gender_pref || null, lang: b.lang || null, acknowledged: !!b.guide_ack_at, ackAt: b.guide_ack_at,
    canAck: paid && !b.guide_ack_at && ['pending', 'confirmed'].includes(b.status), customer: paid ? { name: b.customer_name, contact: b.contact } : null };
}
function ackBooking(guideId, bookingId) {
  const b = db.get(`SELECT b.*, (SELECT status FROM payments WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1) pay_status FROM bookings b WHERE b.id=? AND b.guide_id=?`, bookingId, guideId);
  if (!b) throw new HttpError(404, 'Bron topilmadi.');
  const v = bookingView(b);
  if (v.acknowledged) return { already: true, code: b.code };
  if (!v.canAck) throw new HttpError(409, 'Bu bronni hozir qabul qilib bo\'lmaydi.');
  db.run('UPDATE bookings SET guide_ack_at=? WHERE id=?', db.now(), b.id);
  const a = accountById(guideId);
  sec.audit(a ? actorOf(a) : SYSTEM, 'booking.guide_ack', 'booking', b.id, null, { code: b.code });
  return { already: false, code: b.code };
}
function earnings(guideId) {
  const sum = sql => db.get(sql, guideId).s || 0;
  const earned = sum("SELECT COALESCE(SUM(payout_c),0) s FROM bookings WHERE guide_id=? AND status IN ('confirmed','completed')");
  const held = sum(`SELECT COALESCE(SUM(b.payout_c),0) s FROM bookings b WHERE b.guide_id=? AND b.status IN ('pending','confirmed') AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.status IN ${PAID} AND p.is_sandbox=0)`);
  const paidOut = sum('SELECT COALESCE(SUM(amount_c),0) s FROM payouts WHERE party=?');
  const payouts = db.all('SELECT id, amount_c, method, reference, created_at FROM payouts WHERE party=? ORDER BY created_at DESC LIMIT 50', guideId)
    .map(p => ({ id: p.id, amountUsd: p.amount_c / 100, method: p.method, reference: p.reference, at: p.created_at }));
  return { earnedUsd: earned / 100, heldUsd: held / 100, paidOutUsd: paidOut / 100, payouts };
}

module.exports = {
  useTelegram, genPassword, makeLogin, ensureAccount, accountById, accountByLogin, accountByChat, accessView, eligibleGuide,
  issueLink, linkChat, consumeLink, guideByUsername, deliverCredentials, revokeAll, trustedDevice, rememberDevice, deviceLabel, tashkent,
  passwordStep, createChallenge, verifyChallenge, finishLogin, notMe, bookingRows, bookingView, ackBooking, earnings, portalUrl, DEVICE_COOKIE
};
