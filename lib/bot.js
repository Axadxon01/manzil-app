'use strict';
/**
 * Manzil Telegram boti (mijozlar uchun) + qo'llab-quvvatlash jamoasi guruhi.
 *  - Hisobni bog'lash (saytdagi "Telegram'ni ulash" havolasi: /start link_<token>)
 *  - Bron xabarnomalari (yaratildi, to'landi + gid ochildi, tasdiqlandi, bekor, yakunlandi, pul qaytarildi)
 *  - Sayohatlarim: bekor qilish va gidga baho berish tugmalari
 *  - Parolni tiklash kodi (faqat hisobga bog'langan Telegram'ga)
 *  - Shikoyat / taklif / savol → support guruhiga; guruhda javob (reply) → mijozga qaytadi
 * Support guruhini ulash: botni guruhga qo'shing va admin paneldagi kod bilan /support_here KOD yuboring.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const db = require('./db');
const sec = require('./security');
const core = require('./core');
const catalog = require('./catalog');

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const API = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const enabled = () => !!TOKEN();

// ---- Tarjimalar (sayt bilan bir xil public/i18n.js) ----
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['i18n.js', 'i18n-ext.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx);
const I18N = ctx.window.I18N, LANGS = ctx.window.LANGS.map(l => l[0]);
const t = (lang, k, vars) => { let s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k; if (vars) for (const v in vars) s = s.split('{' + v + '}').join(vars[v]); return s; };
const pickLang = c => { const l = String(c || '').slice(0, 2).toLowerCase(); return LANGS.includes(l) ? l : 'uz'; };

async function call(method, payload) {
  if (!enabled()) return null;
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${API()}/bot${TOKEN()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    clearTimeout(tm);
    const d = await r.json().catch(() => ({}));
    if (!d.ok) console.warn('[bot]', method, d.description || r.status);
    return d.ok ? d.result : null;
  } catch (e) { console.warn('[bot]', method, e.message); return null; }
}
const send = (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...extra });

const webhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET || crypto.createHmac('sha256', db.appSecret()).update('telegram-webhook').digest('hex').slice(0, 48);
const supportChat = () => db.getSetting('tg_support_chat') || process.env.TELEGRAM_SUPPORT_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
function supportCode() { let c = db.getSetting('tg_support_code'); if (!c) { c = crypto.randomBytes(5).toString('hex'); db.setSetting('tg_support_code', c); } return c; }
const publicUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

// ---- Foydalanuvchi holati ----
function botUser(chat, from) {
  const id = String(chat.id);
  let u = db.get('SELECT * FROM bot_users WHERE id=?', id);
  if (!u) {
    db.run('INSERT INTO bot_users(id,first_name,username,updated_at,lang) VALUES(?,?,?,?,?)', id, String((from && from.first_name) || '').slice(0, 64), String((from && from.username) || '').slice(0, 64), db.now(), pickLang(from && from.language_code));
    u = db.get('SELECT * FROM bot_users WHERE id=?', id);
  }
  return u;
}
const setState = (id, st) => db.run('UPDATE bot_users SET state=?, updated_at=? WHERE id=?', st ? JSON.stringify(st) : null, db.now(), String(id));
const getState = u => { try { return u.state ? JSON.parse(u.state) : null; } catch (_) { return null; } };
const linkedUser = u => (u.user_id ? db.get("SELECT * FROM users WHERE id=? AND status='active'", u.user_id) : null);

function menu(lang) {
  return { reply_markup: { resize_keyboard: true, keyboard: [
    [{ text: t(lang, 'b_menu_trips') }, { text: t(lang, 'b_menu_support') }],
    [{ text: t(lang, 'b_menu_reset') }, { text: t(lang, 'b_menu_lang') }]
  ] } };
}
const isBtn = (text, key) => LANGS.some(l => t(l, key) === text);

// ---- Sayohatlarim ----
const placeName = (b, lang) => { const d = catalog.get(b.city); return d ? (d.names[lang] || d.names.en) : (b.city || b.title); };
async function showTrips(chatId, user, lang) {
  if (!user) return send(chatId, t(lang, 'b_link_howto', { url: publicUrl() || 'manzil' }), menu(lang));
  const rows = db.all('SELECT id FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 8', user.id).map(r => core.customerBookingView(r.id));
  if (!rows.length) return send(chatId, t(lang, 'tr_empty'), menu(lang));
  for (const b of rows) {
    let text = t(lang, 'b_trip_item', { code: b.code, place: placeName(b, lang), date: b.travelDate || '—', status: t(lang, 'st_' + b.status), amount: b.amountUsd });
    if (b.guide) text += '\n' + (b.guide.revealed ? `${t(lang, 'tr_guide')}: ${b.guide.name}${b.guide.telegram ? ' · @' + b.guide.telegram : ''}` : '🔒 ' + t(lang, 'tr_guide_hidden'));
    const kb = [];
    if (b.canCancel) kb.push({ text: t(lang, 'b_cancel_btn'), callback_data: 'c:' + b.id });
    if (b.canReview) kb.push({ text: t(lang, 'b_rate_btn'), callback_data: 'r:' + b.id });
    kb.push({ text: t(lang, 'b_ask_btn'), callback_data: 'q:' + b.id });
    await send(chatId, text, { reply_markup: { inline_keyboard: [kb] } });
  }
}

// ---- Parolni tiklash ----
function createResetCode(user) {
  db.run('UPDATE password_resets SET used=1 WHERE user_id=? AND used=0', user.id);
  const code = String(crypto.randomInt(100000, 1000000));
  db.run('INSERT INTO password_resets(id,user_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)', db.uid('pr_'), user.id, sec.sha256(user.id + ':' + code), Date.now() + 10 * 60000, db.now());
  return code;
}
/** Saytdan chaqiriladi: hisob Telegram'ga bog'langan bo'lsa kod yuboriladi. Har doim bir xil javob (email borligini oshkor qilmaslik uchun). */
async function sendResetCode(email) {
  const u = db.get("SELECT * FROM users WHERE email=? AND status='active'", String(email || '').toLowerCase());
  if (!u || !u.tg_chat_id || !enabled()) return false;
  const lang = u.lang || 'uz';
  await send(u.tg_chat_id, t(lang, 'b_reset_code', { code: createResetCode(u) }));
  sec.audit({ type: 'user', id: u.id, label: u.email }, 'user.reset_code_sent', 'user', u.id, null, { via: 'telegram' });
  return true;
}

// ---- Murojaatlar (support) ----
function newTicketCode() { return 'T-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
async function createTicket({ userId = null, chatId = null, kind, bookingId = null, lang = 'uz', text, contact = '', from = '' }) {
  const id = db.uid('tk_'), code = newTicketCode();
  db.run('INSERT INTO tickets(id,code,user_id,chat_id,kind,booking_id,status,lang,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, code, userId, chatId ? String(chatId) : null, kind, bookingId, 'open', lang, db.now(), db.now());
  db.run('INSERT INTO ticket_messages(ticket_id,sender,sender_name,text,created_at) VALUES(?,?,?,?,?)', id, 'customer', from, String(text).slice(0, 3000), db.now());
  const b = bookingId ? db.get('SELECT code FROM bookings WHERE id=?', bookingId) : null;
  const head = `🆕 ${code} · ${kind.toUpperCase()}${b ? ' · ' + b.code : ''}\n👤 ${from || '—'}${contact ? ' · ' + contact : ''} · ${lang}${chatId ? '' : ' · (sayt, Telegram yo\'q)'}\n\n`;
  const sc = supportChat();
  if (sc) {
    const m = await send(sc, head + String(text).slice(0, 3000) + '\n\n↩️ Javob berish uchun shu xabarga reply qiling. /close — yopish.');
    if (m) db.run('UPDATE ticket_messages SET support_msg_id=? WHERE ticket_id=? AND sender=?', m.message_id, id, 'customer');
  }
  return { id, code };
}
async function replyToTicket(ticketId, text, staffName) {
  const tk = db.get('SELECT * FROM tickets WHERE id=?', ticketId); if (!tk) return false;
  db.run('INSERT INTO ticket_messages(ticket_id,sender,sender_name,text,created_at) VALUES(?,?,?,?,?)', tk.id, 'staff', staffName, String(text).slice(0, 3000), db.now());
  db.run("UPDATE tickets SET status='answered', updated_at=? WHERE id=?", db.now(), tk.id);
  if (tk.chat_id) { await send(tk.chat_id, t(tk.lang || 'uz', 'b_support_reply', { code: tk.code, text: String(text).slice(0, 3000) })); return true; }
  return false;
}
async function closeTicket(ticketId) {
  const tk = db.get('SELECT * FROM tickets WHERE id=?', ticketId); if (!tk) return;
  db.run("UPDATE tickets SET status='closed', updated_at=? WHERE id=?", db.now(), tk.id);
  if (tk.chat_id) await send(tk.chat_id, t(tk.lang || 'uz', 'b_ticket_closed', { code: tk.code }));
}

// ---- Bron xabarnomalari ----
function bookingUserChat(bookingId) {
  const b = db.get('SELECT b.*, u.tg_chat_id, u.lang AS ulang FROM bookings b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=?', bookingId);
  if (!b || !b.tg_chat_id) return null;
  return { b, chat: b.tg_chat_id, lang: b.ulang || b.lang || 'uz' };
}
function wire() {
  core.events.on('booking.created', id => { const x = bookingUserChat(id); if (x) send(x.chat, t(x.lang, 'b_n_created', { code: x.b.code, amount: core.usd(x.b.amount_c) })); });
  core.events.on('booking.paid', id => {
    const x = bookingUserChat(id);
    const b = db.get('SELECT code, amount_c FROM bookings WHERE id=?', id);
    const sc = supportChat(); if (sc && b) send(sc, `💳 To'lov: ${b.code} · $${core.usd(b.amount_c)}`);
    if (!x) return;
    const v = core.customerBookingView(id);
    const host = v.guide && v.guide.revealed ? `${v.guide.name}${v.guide.telegram ? ' (@' + v.guide.telegram + ')' : ''}` : (v.operator ? `${v.operator.company}${v.operator.phone ? ' · ' + v.operator.phone : ''}` : '');
    send(x.chat, host ? t(x.lang, 'b_n_paid', { code: x.b.code, guide: host }) : t(x.lang, 'b_n_paid_nohost', { code: x.b.code }));
  });
  core.events.on('booking.status', (id, st) => {
    const x = bookingUserChat(id); if (!x) return;
    if (st === 'confirmed') send(x.chat, t(x.lang, 'b_n_confirmed', { code: x.b.code, date: x.b.travel_date || '—' }));
    if (st === 'cancelled') send(x.chat, t(x.lang, 'b_n_cancelled', { code: x.b.code }));
    if (st === 'completed') send(x.chat, t(x.lang, 'b_n_completed', { code: x.b.code }), { reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map(n => ({ text: '★'.repeat(n), callback_data: `s:${id}:${n}` }))] } });
  });
  core.events.on('refund.processed', rid => {
    const r = db.get('SELECT booking_id, amount_c FROM refunds WHERE id=?', rid); if (!r) return;
    const x = bookingUserChat(r.booking_id); if (x) send(x.chat, t(x.lang, 'b_n_refund', { code: x.b.code, amount: core.usd(r.amount_c) }));
  });
}
function notifyStaff(text) { const sc = supportChat(); if (sc) send(sc, text); }

// ---- Webhook ----
const perChat = new Map();
function chatLimited(id) { const now = Date.now(); const a = (perChat.get(id) || []).filter(x => now - x < 60000); a.push(now); perChat.set(id, a); return a.length > 30; }

async function handleUpdate(up) {
  try {
    if (up.callback_query) return await onCallback(up.callback_query);
    const m = up.message; if (!m || !m.chat) return;
    const text = String(m.text || m.caption || '').trim();
    // --- Support guruhi ---
    if (m.chat.type === 'group' || m.chat.type === 'supergroup') {
      const sc = supportChat();
      const cmd = text.split(/\s+/)[0].split('@')[0];
      if (cmd === '/support_here') {
        if (text.split(/\s+/)[1] === supportCode()) { db.setSetting('tg_support_chat', String(m.chat.id)); db.setSetting('tg_support_code', crypto.randomBytes(5).toString('hex')); sec.audit({ type: 'system', id: 'bot', label: 'telegram' }, 'support_chat.set', 'settings', 'tg_support_chat', null, { chat: m.chat.id, title: m.chat.title }); return send(m.chat.id, '✅ Bu guruh Manzil support guruhi sifatida ulandi. Yangi murojaatlar shu yerga keladi.'); }
        return send(m.chat.id, '❌ Kod noto\'g\'ri. Admin panel → Sozlamalar → Telegram bo\'limidagi kodni ishlating.');
      }
      if (String(m.chat.id) !== String(sc) || !m.reply_to_message) return;
      const tm = db.get('SELECT ticket_id FROM ticket_messages WHERE support_msg_id=?', m.reply_to_message.message_id);
      if (!tm) return;
      const staffName = [m.from && m.from.first_name, m.from && m.from.username ? '@' + m.from.username : ''].filter(Boolean).join(' ');
      if (cmd === '/close') { await closeTicket(tm.ticket_id); return send(m.chat.id, '🔒 Yopildi.', { reply_to_message_id: m.message_id }); }
      if (!text) return;
      const ok = await replyToTicket(tm.ticket_id, text, staffName);
      return send(m.chat.id, ok ? '✓ Mijozga yuborildi.' : '⚠️ Mijozda Telegram yo\'q — sayt orqali kelgan. Admin paneldagi kontakt bilan bog\'laning.', { reply_to_message_id: m.message_id });
    }
    if (m.chat.type !== 'private') return;
    const u = botUser(m.chat, m.from);
    const lang = u.lang || 'uz';
    if (chatLimited(u.id)) return send(u.id, t(lang, 'b_rate_limited'));
    const user = linkedUser(u);
    // /start [link_token]
    if (text.startsWith('/start')) {
      const arg = text.split(/\s+/)[1] || '';
      if (arg.startsWith('link_')) {
        const row = db.get('SELECT * FROM tg_links WHERE token_hash=?', sec.sha256(arg.slice(5)));
        if (!row || row.expires_at < Date.now()) return send(u.id, t(lang, 'b_link_expired'), menu(lang));
        db.run('DELETE FROM tg_links WHERE token_hash=?', row.token_hash);
        db.run('UPDATE users SET tg_chat_id=NULL WHERE tg_chat_id=?', u.id);
        db.run('UPDATE users SET tg_chat_id=? WHERE id=?', u.id, row.user_id);
        db.run('UPDATE bot_users SET user_id=? WHERE id=?', row.user_id, u.id);
        const lu = db.get('SELECT * FROM users WHERE id=?', row.user_id);
        const l2 = lu.lang || lang; if (lu.lang) db.run('UPDATE bot_users SET lang=? WHERE id=?', lu.lang, u.id);
        sec.audit({ type: 'user', id: lu.id, label: lu.email }, 'user.telegram_linked', 'user', lu.id, null, { chat: u.id });
        return send(u.id, t(l2, 'b_linked', { email: lu.email }), menu(l2));
      }
      setState(u.id, null);
      return send(u.id, t(lang, 'b_welcome', { url: publicUrl() || 'Manzil' }), menu(lang));
    }
    if (text === '/help') return send(u.id, t(lang, 'b_welcome', { url: publicUrl() || 'Manzil' }), menu(lang));
    if (isBtn(text, 'b_menu_lang') || text === '/lang') {
      const rows = []; for (let i = 0; i < LANGS.length; i += 3) rows.push(LANGS.slice(i, i + 3).map(l => ({ text: ctx.window.LANGS.find(x => x[0] === l)[1], callback_data: 'l:' + l })));
      return send(u.id, t(lang, 'b_lang_choose'), { reply_markup: { inline_keyboard: rows } });
    }
    if (isBtn(text, 'b_menu_trips') || text === '/trips') { setState(u.id, null); return showTrips(u.id, user, lang); }
    if (isBtn(text, 'b_menu_support') || text === '/support') {
      setState(u.id, null);
      return send(u.id, t(lang, 'b_support_choose'), { reply_markup: { inline_keyboard: [[{ text: t(lang, 'b_k_complaint'), callback_data: 'k:complaint' }, { text: t(lang, 'b_k_suggestion'), callback_data: 'k:suggestion' }], [{ text: t(lang, 'b_k_question'), callback_data: 'k:question' }]] } });
    }
    if (isBtn(text, 'b_menu_reset') || text === '/reset') { setState(u.id, { s: 'reset_email' }); return send(u.id, t(lang, 'b_reset_email'), { reply_markup: { force_reply: true } }); }
    const st = getState(u);
    if (st && st.s === 'reset_email') {
      setState(u.id, null);
      const ru = db.get("SELECT * FROM users WHERE email=? AND status='active'", text.toLowerCase());
      if (!ru || String(ru.tg_chat_id) !== String(u.id)) return send(u.id, t(lang, 'b_reset_notlinked'), menu(lang));
      return send(u.id, t(lang, 'b_reset_code', { code: createResetCode(ru) }) + (publicUrl() ? '\n' + publicUrl() + '/?reset=1' : ''), menu(lang));
    }
    if (st && st.s === 'support' && text) {
      setState(u.id, null);
      const tk = await createTicket({ userId: user ? user.id : null, chatId: u.id, kind: st.kind, bookingId: st.booking || null, lang, text, contact: user ? user.email : (m.from && m.from.username ? '@' + m.from.username : ''), from: (m.from && m.from.first_name) || '' });
      return send(u.id, t(lang, 'b_support_sent', { code: tk.code }), menu(lang));
    }
    // Ochiq murojaat bo'lsa — yangi xabar shu murojaatga qo'shiladi
    const open = db.get("SELECT * FROM tickets WHERE chat_id=? AND status IN ('open','answered') AND updated_at > ? ORDER BY updated_at DESC LIMIT 1", u.id, new Date(Date.now() - 3 * 86400000).toISOString());
    if (open && text) {
      db.run('INSERT INTO ticket_messages(ticket_id,sender,sender_name,text,created_at) VALUES(?,?,?,?,?)', open.id, 'customer', (m.from && m.from.first_name) || '', text.slice(0, 3000), db.now());
      db.run("UPDATE tickets SET status='open', updated_at=? WHERE id=?", db.now(), open.id);
      const sc = supportChat();
      if (sc) { const sm = await send(sc, `💬 ${open.code}\n${text.slice(0, 3000)}`); if (sm) db.run('UPDATE ticket_messages SET support_msg_id=? WHERE id=(SELECT MAX(id) FROM ticket_messages WHERE ticket_id=?)', sm.message_id, open.id); }
      return send(u.id, t(lang, 'b_support_sent', { code: open.code }));
    }
    return send(u.id, t(lang, 'b_unknown'), menu(lang));
  } catch (e) { console.error('[bot] update', e); }
}

async function onCallback(cq) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id; if (!chatId) return;
  const u = botUser(cq.message.chat, cq.from); const lang = u.lang || 'uz'; const user = linkedUser(u);
  const [kind, a, b] = String(cq.data || '').split(':');
  const ack = text => call('answerCallbackQuery', { callback_query_id: cq.id, text: text ? String(text).slice(0, 190) : undefined });
  try {
    if (kind === 'l' && LANGS.includes(a)) { db.run('UPDATE bot_users SET lang=? WHERE id=?', a, u.id); if (user) db.run('UPDATE users SET lang=? WHERE id=?', a, user.id); await ack(); return send(chatId, '✓', menu(a)); }
    if (kind === 'k') { setState(u.id, { s: 'support', kind: a }); await ack(); return send(chatId, t(lang, 'b_support_write'), { reply_markup: { force_reply: true } }); }
    if (kind === 'q') { setState(u.id, { s: 'support', kind: 'booking', booking: a }); await ack(); return send(chatId, t(lang, 'b_support_write'), { reply_markup: { force_reply: true } }); }
    if (!user) { await ack(); return send(chatId, t(lang, 'b_link_howto', { url: publicUrl() || 'Manzil' })); }
    const own = db.get('SELECT * FROM bookings WHERE id=? AND user_id=?', a, user.id);
    if (!own) return ack(t(lang, 'err_generic'));
    if (kind === 'c') {
      const v = core.customerBookingView(own.id); await ack();
      return send(chatId, t(lang, 'b_cancel_confirm', { code: own.code, pct: v.cancelRefundPct }), { reply_markup: { inline_keyboard: [[{ text: t(lang, 'b_yes'), callback_data: 'cc:' + own.id }, { text: t(lang, 'b_no'), callback_data: 'x:' + own.id }]] } });
    }
    if (kind === 'cc') {
      const r = core.cancelByCustomer(user, own.id); await ack();
      return send(chatId, t(lang, 'b_cancelled', { code: own.code }) + (r.refund ? '\n' + t(lang, 'b_refund_req', { amount: core.usd(r.refund.amount_c) }) : ''));
    }
    if (kind === 'x') return ack('✓');
    if (kind === 'r') { await ack(); return send(chatId, t(lang, 'b_rate_ask', { code: own.code }), { reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map(n => ({ text: '★'.repeat(n), callback_data: `s:${own.id}:${n}` }))] } }); }
    if (kind === 's') { core.addReview(user, own.id, { rating: Number(b), serviceRating: Number(b) }); await ack(t(lang, 'b_rated')); return send(chatId, t(lang, 'b_rated')); }
    return ack();
  } catch (e) { await ack(e.message || t(lang, 'err_generic')); }
}

async function setup() {
  if (!enabled()) return { enabled: false };
  const me = await call('getMe', {});
  if (me && me.username) db.setSetting('tg_bot_username', me.username);
  const url = publicUrl();
  let webhook = false;
  if (/^https:\/\//.test(url)) {
    webhook = !!await call('setWebhook', { url: url + '/api/telegram/webhook', secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  }
  const cmds = l => [{ command: 'start', description: t(l, 'b_menu_open') }, { command: 'trips', description: t(l, 'b_menu_trips') }, { command: 'support', description: t(l, 'b_menu_support') }, { command: 'reset', description: t(l, 'b_menu_reset') }, { command: 'lang', description: t(l, 'b_menu_lang') }]
    .map(c => ({ command: c.command, description: c.description.replace(/^[^\p{L}]+/u, '').slice(0, 250) }));
  await call('setMyCommands', { commands: cmds('en') });
  for (const l of LANGS) { await call('setMyCommands', { commands: cmds(l), language_code: l }); await call('setMyDescription', { description: t(l, 'b_about').slice(0, 512), language_code: l }); }
  await call('setMyDescription', { description: t('en', 'b_about').slice(0, 512) });
  return { enabled: true, username: me && me.username, webhook };
}

module.exports = { enabled, setup, wire, handleUpdate, webhookSecret, sendResetCode, createTicket, replyToTicket, closeTicket, notifyStaff, supportCode, supportChat, send, t };
