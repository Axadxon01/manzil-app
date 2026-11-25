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
const guides = require('./guides');
const receipts = require('./receipts');

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const API = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const enabled = () => !!TOKEN();

// ---- Tarjimalar (sayt bilan bir xil public/i18n.js) ----
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['i18n.js', 'i18n-ext.js', 'articles.js', 'legal.js', 'i18n-pkg.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx);
const I18N = ctx.window.I18N, LANGS = ctx.window.LANGS.map(l => l[0]);
const BOT_I18N = require('./bot-i18n');
for (const l in BOT_I18N) { I18N[l] = I18N[l] || {}; Object.assign(I18N[l], BOT_I18N[l]); }
const ARTICLES = ctx.window.ARTICLES || [], LEGAL = ctx.window.LEGAL || {};
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
const botName = () => db.getSetting('tg_bot_username') || null;

// ---- Maxfiy xabarlarni (parol, kirish kodi) avtomatik o'chirish — navbat bazada, server qayta ishga tushsa ham davom etadi ----
function scheduleDelete(chatId, messageId, ms) {
  if (!messageId) return;
  db.run('INSERT OR REPLACE INTO tg_autodelete(chat_id,message_id,delete_at) VALUES(?,?,?)', String(chatId), messageId, Date.now() + ms);
}
async function runAutoDelete() {
  if (!enabled()) return 0;
  const now = Date.now(), rows = db.all('SELECT * FROM tg_autodelete WHERE delete_at<=? ORDER BY delete_at LIMIT 50', now);
  for (const r of rows) {
    db.run('DELETE FROM tg_autodelete WHERE chat_id=? AND message_id=?', r.chat_id, r.message_id);
    if (now - r.delete_at < 47 * 3600e3) await call('deleteMessage', { chat_id: r.chat_id, message_id: r.message_id }); // Telegram 48 soatdan keyin o'chirishga ruxsat bermaydi
  }
  return rows.length;
}
// Telegram'dagi faylni yuklab olish (chek rasmi yoki PDF)
async function downloadFile(fileId, maxBytes) {
  const f = await call('getFile', { file_id: fileId });
  if (!f || !f.file_path) return null;
  if (f.file_size && f.file_size > maxBytes) return { tooBig: true };
  const ctrl = new AbortController(), tm = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`${API()}/file/bot${TOKEN()}/${f.file_path}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > maxBytes ? { tooBig: true } : { buf };
  } catch (_) { return null; } finally { clearTimeout(tm); }
}
const som = n => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');

const webhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET || crypto.createHmac('sha256', db.appSecret()).update('telegram-webhook').digest('hex').slice(0, 48);
const supportChat = () => db.getSetting('tg_support_chat') || process.env.TELEGRAM_SUPPORT_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
// Kod bot tokenidan hosil qilinadi — vaqtinchalik bazada ham server qayta ishga tushganda o'zgarmaydi
function supportCode() { return db.getSetting('tg_support_code') || crypto.createHmac('sha256', TOKEN() || db.appSecret()).update('manzil-support-code').digest('hex').slice(0, 10); }
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
    [{ text: t(lang, 'b_menu_explore') }, { text: t(lang, 'b_menu_trips') }],
    [{ text: t(lang, 'b_menu_support') }, { text: t(lang, 'b_menu_faq') }],
    [{ text: t(lang, 'b_menu_reset') }, { text: t(lang, 'b_menu_lang') }]
  ] } };
}
const isBtn = (text, key) => LANGS.some(l => t(l, key) === text);

// ---- Sayohatlarim ----
const placeName = (b, lang) => { const d = catalog.get(b.city); return d ? (d.names[lang] || d.names.en) : (b.city || b.title); };
const siteUrl = () => /^https:\/\//.test(publicUrl()) ? publicUrl() : '';
function bankBlock(lang, bt) {
  const bk = bt.bank;
  let text = t(lang, 'rc_req', { amount: som(bt.amountUzs), usd: bt.amountUsd, to: [bk.recipient || bk.cardHolder, bk.bankName].filter(Boolean).join(' · '),
    acc: [bk.account ? `${t(lang, 'rc_acc')}: ${bk.account}${bk.mfo ? ' · MFO ' + bk.mfo : ''}${bk.inn ? ' · INN ' + bk.inn : ''}` : '', bk.card ? `${t(lang, 'rc_card')}: ${bk.card}` : ''].filter(Boolean).join('\n'), purpose: bt.purpose });
  const last = bt.receipts[0];
  if (last) text += '\n' + t(lang, last.status === 'rejected' ? 'rc_st_rejected' : last.checking ? 'rc_st_checking' : 'rc_st_pending', { rc: last.code });
  return text;
}
/** Narxi tasdiqlangan, to'lanmagan bron uchun to'lov tugmalari: bank (botning o'zida) va karta (saytda) */
function payButtons(lang, b) {
  const row = [];
  if (receipts.bankInfo().configured) row.push({ text: t(lang, 'b_pay_bank_btn'), callback_data: 'bp:' + b.id });
  if (siteUrl()) row.push({ text: t(lang, 'b_pay_site_btn'), url: `${siteUrl()}/${lang}/?order=${encodeURIComponent(b.code)}` });
  return row;
}
async function showTrips(chatId, user, lang) {
  if (!user) return send(chatId, t(lang, 'b_link_howto', { url: publicUrl() || 'manzil' }), menu(lang));
  const rows = db.all('SELECT id FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 8', user.id).map(r => core.customerBookingView(r.id));
  if (!rows.length) return send(chatId, t(lang, 'tr_empty'), menu(lang));
  for (const b of rows) {
    let text = t(lang, 'b_trip_item', { code: b.code, place: placeName(b, lang), date: b.travelDate || '—', status: t(lang, 'st_' + b.status), amount: b.amountUsd });
    if (b.guide) text += '\n' + (b.guide.revealed ? `${t(lang, 'tr_guide')}: ${b.guide.name}${b.guide.telegram ? ' · @' + b.guide.telegram : ''}` : '🔒 ' + t(lang, 'tr_guide_hidden'));
    if (b.offerNote) text += '\n' + (b.status === 'cancelled' ? t(lang, 'b_decline_line', { reason: b.offerNote }) : t(lang, 'b_offer_line', { note: b.offerNote }));
    let pay = [];
    const kb = [];
    const bt = b.status === 'awaiting_payment' ? receipts.forBooking(b.id) : null;
    if (bt && bt.paymentStatus === 'pending') {
      text += '\n\n' + bankBlock(lang, bt);
      if (bt.canUpload) pay.push({ text: t(lang, 'rc_btn'), callback_data: 'rc:' + b.id });
    } else if (b.canPay) pay = payButtons(lang, b);
    if (b.canCancel) kb.push({ text: t(lang, 'b_cancel_btn'), callback_data: 'c:' + b.id });
    if (b.canReview) kb.push({ text: t(lang, 'b_rate_btn'), callback_data: 'r:' + b.id });
    kb.push({ text: t(lang, 'b_ask_btn'), callback_data: 'q:' + b.id });
    await send(chatId, text, { reply_markup: { inline_keyboard: [pay, kb].filter(r => r.length) } });
  }
}

// ---- Manzillar (katalog), qidiruv, byudjet kalkulyatori ----
const REGIONS = ['uzbekistan', 'central_asia', 'middle_east', 'europe', 'asia', 'americas', 'africa_oceania'];
const PAGE = 8;
const dName = (d, lang) => d.names[lang] || d.names.en;
const country = (iso, lang) => { try { return iso ? new Intl.DisplayNames([lang], { type: 'region' }).of(iso) : ''; } catch (_) { return iso || ''; } };
const monthName = (m, lang) => { try { return new Intl.DateTimeFormat(lang, { month: 'long' }).format(new Date(Date.UTC(2026, m - 1, 15))); } catch (_) { return String(m); } };
const dailyBudget = d => Math.round(d.cost.hotel / 2 + d.cost.food + d.cost.transport + d.cost.activities);
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f'‘’ʻʼ`"«»“”.,!?()-]/g, '').replace(/\s+/g, ' ').trim();
const sitePage = (lang, d) => publicUrl() ? `${publicUrl()}/${lang}/destinations/${d.slug}` : '';
function searchDest(q) {
  const n = norm(q); if (n.length < 3) return [];
  const exact = catalog.CATALOG.filter(d => Object.values(d.names).some(x => norm(x) === n) || d.slug === n.replace(/ /g, '-'));
  if (exact.length) return exact;
  return catalog.CATALOG.filter(d => Object.values(d.names).some(x => norm(x).includes(n)) || d.slug.includes(n.replace(/ /g, '-'))).slice(0, 8);
}
function exploreMenu(chatId, lang, editMsg) {
  const rows = [];
  for (let i = 0; i < REGIONS.length; i += 2) rows.push(REGIONS.slice(i, i + 2).map(r => ({ text: t(lang, 'r_' + r), callback_data: `rg:${r}:0` })));
  const payload = { text: t(lang, 'b_explore_pick'), reply_markup: { inline_keyboard: rows } };
  return editMsg ? call('editMessageText', { chat_id: chatId, message_id: editMsg, ...payload }) : send(chatId, payload.text, { reply_markup: payload.reply_markup });
}
function regionList(chatId, lang, region, page, editMsg) {
  const list = catalog.CATALOG.filter(d => d.region === region).sort((a, b) => dName(a, lang).localeCompare(dName(b, lang), lang));
  const slice = list.slice(page * PAGE, page * PAGE + PAGE);
  const rows = []; for (let i = 0; i < slice.length; i += 2) rows.push(slice.slice(i, i + 2).map(d => ({ text: dName(d, lang).slice(0, 40), callback_data: 'd:' + d.slug })));
  const nav = [{ text: t(lang, 'b_back'), callback_data: 'rg0' }];
  if (list.length > (page + 1) * PAGE) nav.push({ text: t(lang, 'b_more'), callback_data: `rg:${region}:${page + 1}` });
  rows.push(nav);
  const payload = { text: t(lang, 'b_explore_list', { region: t(lang, 'r_' + region), n: list.length }), reply_markup: { inline_keyboard: rows } };
  return editMsg ? call('editMessageText', { chat_id: chatId, message_id: editMsg, ...payload }) : send(chatId, payload.text, { reply_markup: payload.reply_markup });
}
function pkgTitle(p, lang, d) { return p.title || t(lang, 'pk_k_' + p.kind, { place: dName(d, lang) }); }
async function destCard(chatId, lang, slug) {
  const d = catalog.get(slug); if (!d) return;
  const pk = db.all("SELECT p.*, o.status AS op_status FROM packages p LEFT JOIN operators o ON o.id=p.operator_id WHERE p.dest_slug=? AND p.status='approved' AND (p.operator_id IS NULL OR o.status='approved') ORDER BY p.is_sample, p.price_c LIMIT 3", slug);
  const lines = [`<b>${esc(dName(d, lang))}</b> · ${esc(country(d.country, lang))}`, '',
    `🗓 ${esc(t(lang, 'b_dest_best'))}: ${esc((d.months || []).map(m => monthName(m, lang)).join(', '))}`,
    `💵 ${esc(t(lang, 'b_dest_budget', { n: dailyBudget(d) }))}`];
  if (pk.length) { lines.push('', `🧭 ${esc(t(lang, 'b_dest_pk'))}:`); for (const p of pk) lines.push(esc(t(lang, 'b_pk_line', { title: pkgTitle(p, lang, d), days: p.days, price: core.usd(p.price_c) }))); }
  if (d.credit && d.credit.artist) lines.push('', `<i>📷 ${esc(String(d.credit.artist).slice(0, 60))} · ${esc(d.credit.license || '')}</i>`);
  const kb = siteUrl() ? pk.map(p => [{ text: t(lang, 'b_pk_btn', { title: pkgTitle(p, lang, d), days: p.days }).slice(0, 60), url: `${siteUrl()}/${lang}/?pk=${encodeURIComponent(p.id)}` }]) : [];
  kb.push([{ text: t(lang, 'b_btn_calc'), callback_data: 'cd:' + slug }, { text: t(lang, 'b_btn_request'), callback_data: 'rq:' + slug }]);
  if (sitePage(lang, d)) kb.push([{ text: t(lang, 'b_btn_site'), url: sitePage(lang, d) }]);
  kb.push([{ text: t(lang, 'b_back'), callback_data: `rg:${d.region}:0` }]);
  const extra = { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } };
  const caption = lines.join('\n').slice(0, 1020);
  const ph = await call('sendPhoto', { chat_id: chatId, photo: catalog.imgUrl(d, 960), caption, ...extra });
  if (!ph) return send(chatId, caption, extra);
  return ph;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function calcResult(lang, slug, days, people) {
  const d = catalog.get(slug); if (!d) return '';
  const hostRate = catalog.hostRate(d), fl = (d.cost.flight || 0) * people, diy = fl + dailyBudget(d) * days * people, host = diy + hostRate * days;
  return t(lang, 'b_calc_result', { name: dName(d, lang), days, people, diy: diy.toLocaleString('en-US'), host: host.toLocaleString('en-US'), fl: fl ? fl.toLocaleString('en-US') : '—' });
}
async function showDestResults(chatId, lang, found, q) {
  if (!found.length) return send(chatId, t(lang, 'b_search_none', { q: String(q).slice(0, 60) }), menu(lang));
  if (found.length === 1) return destCard(chatId, lang, found[0].slug);
  const rows = found.map(d => [{ text: `${dName(d, lang)} · ${country(d.country, lang)}`.slice(0, 60), callback_data: 'd:' + d.slug }]);
  return send(chatId, t(lang, 'b_search_many', { n: found.length }), { reply_markup: { inline_keyboard: rows } });
}

// ---- Savollar (FAQ), jurnal, murojaatlar ro'yxati ----
function faqMenu(chatId, lang) {
  return send(chatId, t(lang, 'b_faq_title'), { reply_markup: { inline_keyboard: [
    [{ text: t(lang, 'b_faq_cancel'), callback_data: 'f:cancel' }, { text: t(lang, 'b_faq_pay'), callback_data: 'f:pay' }],
    [{ text: t(lang, 'b_faq_guide'), callback_data: 'f:guide' }, { text: t(lang, 'b_faq_articles'), callback_data: 'f:articles' }]] } });
}
function faqAnswer(chatId, lang, k) {
  if (k === 'cancel') { const sec = (LEGAL[lang] || LEGAL.en || [])[2]; return send(chatId, sec ? `<b>${esc(sec[0])}</b>\n\n${sec[1].map(x => '• ' + esc(x)).join('\n')}` + (publicUrl() ? `\n\n${publicUrl()}/${lang}/legal` : '') : '—', { parse_mode: 'HTML' }); }
  if (k === 'pay') return send(chatId, t(lang, 'b_faq_pay_a'));
  if (k === 'guide') return send(chatId, t(lang, 'b_faq_guide_a'));
  if (k === 'articles') {
    const lines = ARTICLES.map(a => { const x = a.t[lang] || a.t.en; return `• <b>${esc(x[0])}</b>${publicUrl() ? `\n${publicUrl()}/${lang}/journal/${a.slug}` : ''}`; });
    return send(chatId, `${esc(t(lang, 'b_articles_title'))}\n\n${lines.join('\n\n')}`, { parse_mode: 'HTML' });
  }
}
function myTickets(chatId, lang) {
  const rows = db.all('SELECT * FROM tickets WHERE chat_id=? ORDER BY updated_at DESC LIMIT 10', String(chatId));
  if (!rows.length) return send(chatId, t(lang, 'b_tickets_none'), menu(lang));
  const st = s => t(lang, s === 'closed' ? 'b_tk_closed' : s === 'answered' ? 'b_tk_answered' : 'b_tk_open');
  return send(chatId, t(lang, 'b_tickets_title') + '\n\n' + rows.map(r => `${r.code} · ${st(r.status)} · ${String(r.updated_at).slice(0, 10)}`).join('\n'), menu(lang));
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
// Gidga yangi (to'langan) tur haqida xabar — "Qabul qilaman" tugmasi bilan
function notifyGuideNewTour(bookingId) {
  const b = db.get('SELECT * FROM bookings WHERE id=?', bookingId); if (!b || !b.guide_id) return;
  const acc = guides.accountById(b.guide_id); if (!acc || !acc.tg_chat_id) return;
  const lang = acc.lang || 'uz';
  const kb = [[{ text: t(lang, 'g_btn_accept'), callback_data: 'ga:' + b.id }]];
  if (/^https:\/\//.test(guides.portalUrl())) kb.push([{ text: t(lang, 'g_btn_open'), url: guides.portalUrl() }]);
  send(acc.tg_chat_id, t(lang, 'g_new_tour', { code: b.code, place: placeName(b, lang), date: b.travel_date || '—', days: b.days, people: b.people, customer: b.customer_name || '—', contact: b.contact || '—', payout: core.usd(b.payout_c) }), { reply_markup: { inline_keyboard: kb } });
}
let autoDelTimer = null;
function wire() {
  if (!remindTimer && process.env.BOT_REMINDERS !== 'false') { remindTimer = setInterval(() => runReminders().catch(e => console.warn('[bot] remind', e.message)), 3600e3); remindTimer.unref(); setTimeout(() => runReminders().catch(() => {}), 60e3).unref(); }
  if (!autoDelTimer) { autoDelTimer = setInterval(() => runAutoDelete().catch(e => console.warn('[bot] autodelete', e.message)), Number(process.env.BOT_AUTODELETE_TICK_MS) || 30e3); autoDelTimer.unref(); }
  core.events.on('receipt.checked', rid => {
    const r = db.get('SELECT * FROM receipts WHERE id=?', rid); if (!r) return;
    const b = db.get('SELECT code FROM bookings WHERE id=?', r.booking_id), p = db.get('SELECT amount_uzs FROM payments WHERE id=?', r.payment_id);
    const sc = supportChat(); if (sc && b) send(sc, `🧾 Yangi chek ${r.code} · ${b.code} · ${som(p.amount_uzs)} so'm\nAI: ${{ match: '✅ mos', review: '🔎 tekshirish kerak', mismatch: '❌ mos emas' }[r.verdict] || r.verdict}\n→ Admin panel: Cheklar`);
    const x = bookingUserChat(r.booking_id); if (!x) return;
    let fails = []; try { fails = JSON.parse(r.checks || '[]').filter(c => c.status === 'fail').map(c => c.key); } catch (_) {}
    if (r.verdict === 'mismatch') send(x.chat, t(x.lang, 'rc_bad', { rc: r.code, reasons: [...new Set(fails)].map(k => '• ' + t(x.lang, 'rc_p_' + k)).join('\n') }), { reply_markup: { inline_keyboard: [[{ text: t(x.lang, 'rc_btn'), callback_data: 'rc:' + r.booking_id }]] } });
    else send(x.chat, t(x.lang, r.verdict === 'match' ? 'rc_ok' : 'rc_review', { rc: r.code }));
  });
  core.events.on('receipt.rejected', rid => {
    const r = db.get('SELECT * FROM receipts WHERE id=?', rid); if (!r) return;
    const x = bookingUserChat(r.booking_id); if (!x) return;
    send(x.chat, t(x.lang, 'rc_rejected', { rc: r.code, reason: r.decision_note || '—' }), { reply_markup: { inline_keyboard: [[{ text: t(x.lang, 'rc_btn'), callback_data: 'rc:' + r.booking_id }]] } });
  });
  core.events.on('booking.created', id => { const x = bookingUserChat(id); if (x) send(x.chat, t(x.lang, 'b_n_created', { code: x.b.code, amount: core.usd(x.b.amount_c) })); });
  // Tur-paket so'rovi: xodimlarga va (Telegram ulangan bo'lsa) mijozga
  core.events.on('booking.requested', id => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', id); if (!b) return;
    const sc = supportChat();
    if (sc) send(sc, `🧭 Yangi paket so'rovi: ${b.code}\n${b.title}\nSana: ${b.travel_date} · ${b.people} kishi · taxminan $${core.usd(b.amount_c)}\nMijoz: ${b.customer_name} · ${b.contact}${b.request_note ? '\nIzoh: ' + b.request_note : ''}\n→ Admin panel: Buyurtmalar → Yangi so'rovlar`);
    const x = bookingUserChat(id); if (!x) return;
    send(x.chat, t(x.lang, 'b_n_requested', { code: b.code, place: placeName(b, x.lang), date: b.travel_date || '—', people: b.people, amount: core.usd(b.amount_c) }));
  });
  core.events.on('booking.offer', id => {
    const x = bookingUserChat(id); if (!x) return;
    const b = x.b, v = core.customerBookingView(id), row = payButtons(x.lang, v);
    send(x.chat, t(x.lang, 'b_n_offer', { code: b.code, place: placeName(b, x.lang), date: b.travel_date || '—', people: b.people, amount: core.usd(b.amount_c), uzs: som(b.amount_uzs),
      note: b.offer_note ? t(x.lang, 'b_n_offer_note', { note: b.offer_note }) : '' }), row.length ? { reply_markup: { inline_keyboard: [row] } } : {});
  });
  core.events.on('booking.paid', id => {
    try { notifyGuideNewTour(id); } catch (e) { console.warn('[bot] guide notify', e.message); }
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
    if (st === 'cancelled') send(x.chat, x.b.price_source === 'estimate' && x.b.offer_note ? t(x.lang, 'b_n_declined', { code: x.b.code, reason: x.b.offer_note }) : t(x.lang, 'b_n_cancelled', { code: x.b.code }));
    if (st === 'completed') send(x.chat, t(x.lang, 'b_n_completed', { code: x.b.code }), { reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map(n => ({ text: '★'.repeat(n), callback_data: `s:${id}:${n}` }))] } });
  });
  core.events.on('refund.processed', rid => {
    const r = db.get('SELECT booking_id, amount_c FROM refunds WHERE id=?', rid); if (!r) return;
    const x = bookingUserChat(r.booking_id); if (x) send(x.chat, t(x.lang, 'b_n_refund', { code: x.b.code, amount: core.usd(r.amount_c) }));
  });
}
function notifyStaff(text) { const sc = supportChat(); if (sc) send(sc, text); }

// ---- Gidlar uchun menyu (/gid) ----
async function guideMenu(chatId, lang, from) {
  let acc = guides.accountByChat(chatId);
  if (!acc) {
    const g = guides.guideByUsername(from && from.username, chatId);
    if (!g) return send(chatId, t(lang, 'g_not_guide'));
    acc = guides.linkChat(g.id, chatId, lang, 'username');
    await send(chatId, t(lang, 'g_linked_hello', { name: g.name }));
    try { await guides.deliverCredentials(g.id, { reason: 'username' }); } catch (e) { await send(chatId, e.message); }
    return;
  }
  const g = db.get('SELECT * FROM guides WHERE id=?', acc.id);
  if (!g || g.status !== 'approved' || acc.status !== 'active') return send(chatId, t(lang, 'g_blocked'));
  const upcoming = guides.bookingRows(acc.id).map(guides.bookingView).filter(b => ['pending', 'confirmed'].includes(b.status) && b.customer);
  const lines = upcoming.slice(0, 5).map(b => `• ${b.code} · ${b.travelDate || '—'} · ${placeName({ city: b.place, title: b.title }, lang)} · ${b.people}${b.acknowledged ? ' ✓' : ''}`);
  const kb = [];
  if (/^https:\/\//.test(guides.portalUrl())) kb.push([{ text: t(lang, 'g_btn_open'), url: guides.portalUrl() }]);
  kb.push([{ text: t(lang, 'g_btn_newpw'), callback_data: 'gp' }]);
  return send(chatId, t(lang, 'g_menu', { name: esc(g.name), login: esc(acc.login), n: upcoming.length }) + (lines.length ? '\n\n' + esc(lines.join('\n')) : ''), { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

// ---- Support guruhi uchun buyruqlar ----
function staffHelp() {
  return ['Buyruqlar:', '/open — ochiq murojaatlar', '/stats — bugungi va 7 kunlik ko\'rsatkichlar', '/r T-XXXXXX matn — murojaatga javob', '/close T-XXXXXX — murojaatni yopish', 'Yoki mijoz xabariga Reply qiling; Reply + /close — yopish.'].join('\n');
}
function staffStats() {
  const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // Toshkent
  const since = d => new Date(Date.parse(d + 'T00:00:00+05:00')).toISOString();
  const wk = new Date(Date.parse(day + 'T00:00:00+05:00') - 6 * 86400e3).toISOString();
  const q = from => ({
    bookings: db.get('SELECT COUNT(*) c FROM bookings WHERE created_at>=?', from).c,
    paid: db.get("SELECT COUNT(*) c, COALESCE(SUM(amount_c),0) s FROM payments WHERE status='paid' AND is_sandbox=0 AND created_at>=?", from)
  });
  const a = q(since(day)), w = q(wk);
  const open = db.get("SELECT COUNT(*) c FROM tickets WHERE status IN ('open','answered')").c;
  const pend = db.get("SELECT COUNT(*) c FROM bookings WHERE status='pending'").c;
  return `📊 Bugun (${day}): ${a.bookings} bron · ${a.paid.c} to'lov · $${core.usd(a.paid.s)}\n📅 7 kun: ${w.bookings} bron · ${w.paid.c} to'lov · $${core.usd(w.paid.s)}\n⏳ Tasdiq kutayotgan bronlar: ${pend}\n💬 Ochiq murojaatlar: ${open}`;
}
function staffOpenList() {
  const rows = db.all("SELECT t.*, (SELECT text FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) last FROM tickets t WHERE t.status IN ('open','answered') ORDER BY t.updated_at DESC LIMIT 15");
  if (!rows.length) return '✅ Ochiq murojaat yo\'q.';
  return rows.map(r => `${r.status === 'open' ? '🟠' : '🟢'} ${r.code} · ${r.kind} · ${String(r.updated_at).slice(5, 16).replace('T', ' ')}\n   ${String(r.last || '').replace(/\s+/g, ' ').slice(0, 90)}`).join('\n') + '\n\nJavob: /r KOD matn';
}
async function forwardMedia(m, code) {
  const sc = supportChat(); if (!sc) return;
  const sent = await call('copyMessage', { chat_id: sc, from_chat_id: m.chat.id, message_id: m.message_id, caption: `📎 ${code}${m.caption ? '\n' + String(m.caption).slice(0, 900) : ''}` });
  const tk = db.get('SELECT id FROM tickets WHERE code=?', code);
  if (tk) {
    db.run('INSERT INTO ticket_messages(ticket_id,sender,sender_name,text,support_msg_id,created_at) VALUES(?,?,?,?,?,?)', tk.id, 'customer', (m.from && m.from.first_name) || '', '📎 ' + (m.photo ? 'rasm' : m.document ? 'fayl: ' + (m.document.file_name || '') : m.voice ? 'ovozli xabar' : 'media') + (m.caption ? ' — ' + m.caption : ''), sent ? sent.message_id : null, db.now());
  }
}

// ---- Sayohat eslatmalari (3 kun va 1 kun oldin) ----
let remindTimer = null;
async function runReminders() {
  if (!enabled()) return 0;
  db.raw.exec('CREATE TABLE IF NOT EXISTS bot_reminders(booking_id TEXT NOT NULL, kind TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY(booking_id, kind))');
  const today = Date.parse(new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10));
  const plus = n => new Date(today + n * 86400e3).toISOString().slice(0, 10);
  let n = 0;
  for (const [kind, date] of [['d3', plus(3)], ['d1', plus(1)]]) {
    const rows = db.all(`SELECT b.id FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.travel_date=? AND b.status IN ('pending','confirmed') AND u.tg_chat_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.status='paid') AND NOT EXISTS (SELECT 1 FROM bot_reminders r WHERE r.booking_id=b.id AND r.kind=?)`, date, kind);
    for (const r of rows) {
      const x = bookingUserChat(r.id); if (!x) continue;
      const v = core.customerBookingView(r.id);
      const host = v.guide && v.guide.revealed ? `${v.guide.name}${v.guide.telegram ? ' (@' + v.guide.telegram + ')' : ''}` : (v.operator ? `${v.operator.company}${v.operator.phone ? ' · ' + v.operator.phone : ''}` : '');
      await send(x.chat, t(x.lang, kind === 'd3' ? 'b_remind_3' : 'b_remind_1', { code: x.b.code, place: placeName(v, x.lang), date, host: host ? t(x.lang, 'b_host_line', { host }) : '' }));
      db.run('INSERT OR IGNORE INTO bot_reminders(booking_id,kind,sent_at) VALUES(?,?,?)', r.id, kind, db.now()); n++;
    }
  }
  return n;
}

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
        if (text.split(/\s+/)[1] === supportCode()) { db.setSetting('tg_support_chat', String(m.chat.id)); sec.audit({ type: 'system', id: 'bot', label: 'telegram' }, 'support_chat.set', 'settings', 'tg_support_chat', null, { chat: m.chat.id, title: m.chat.title }); console.log('[bot] support guruhi ulandi, chat_id=' + m.chat.id); return send(m.chat.id, `✅ Bu guruh Manzil support guruhi sifatida ulandi. Yangi murojaatlar shu yerga keladi.\n\n${staffHelp()}\n\nchat_id: ${m.chat.id} — server qayta ishga tushganda ham ulanish saqlanishi uchun Render'da TELEGRAM_SUPPORT_CHAT_ID=${m.chat.id} qo'ying.`); }
        return send(m.chat.id, '❌ Kod noto\'g\'ri. Admin panel → Sozlamalar → Telegram bo\'limidagi kodni ishlating.');
      }
      if (cmd === '/chatid') return send(m.chat.id, `chat_id: ${m.chat.id}`);
      if (String(m.chat.id) !== String(sc)) return;
      if (cmd === '/help') return send(m.chat.id, staffHelp());
      if (cmd === '/stats') return send(m.chat.id, staffStats());
      if (cmd === '/open') return send(m.chat.id, staffOpenList());
      if ((cmd === '/r' || cmd === '/close') && !m.reply_to_message) {
        const parts = text.split(/\s+/), code = String(parts[1] || '').toUpperCase(), tk = db.get('SELECT * FROM tickets WHERE code=?', code);
        if (!tk) return send(m.chat.id, '❓ Murojaat topilmadi. Masalan: /r T-1A2B3C Javob matni');
        if (cmd === '/close') { await closeTicket(tk.id); return send(m.chat.id, `🔒 ${tk.code} yopildi.`); }
        const body = text.replace(/^\S+\s+\S+\s*/, ''); if (!body) return send(m.chat.id, 'Javob matnini yozing: /r ' + tk.code + ' matn');
        const staffName0 = [m.from && m.from.first_name, m.from && m.from.username ? '@' + m.from.username : ''].filter(Boolean).join(' ');
        const ok0 = await replyToTicket(tk.id, body, staffName0);
        return send(m.chat.id, ok0 ? `✓ ${tk.code}: mijozga yuborildi.` : `⚠️ ${tk.code}: mijozda Telegram yo'q — admin paneldagi kontakt bilan bog'laning.`);
      }
      if (!m.reply_to_message) return;
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
      // Gid platformasi: admin bergan bir martalik havola → login va parol shu chatga
      if (arg.startsWith('g_')) {
        const res = guides.consumeLink(arg.slice(2), u.id, lang);
        if (!res.ok) return send(u.id, t(lang, 'g_link_expired'), menu(lang));
        await send(u.id, t(lang, 'g_linked_hello', { name: res.guide.name }));
        try { await guides.deliverCredentials(res.guide.id, { reason: 'admin_link' }); } catch (e) { await send(u.id, e.message); }
        return;
      }
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
      await send(u.id, t(lang, 'b_welcome', { url: publicUrl() || 'Manzil' }), menu(lang));
      // Ariza'dagi Telegram username tasdiqlangan gidga tegishli bo'lsa — kirish ma'lumotlarini olishni taklif qilamiz
      if (!guides.accountByChat(u.id) && guides.guideByUsername(m.from && m.from.username, u.id)) await send(u.id, t(lang, 'g_offer'), { reply_markup: { inline_keyboard: [[{ text: t(lang, 'g_btn_iam'), callback_data: 'gl' }]] } });
      return;
    }
    if (text === '/help') return send(u.id, t(lang, 'b_welcome', { url: publicUrl() || 'Manzil' }), menu(lang));
    if (/^\/(gid|guide)(@\S+)?$/.test(text)) return guideMenu(u.id, lang, m.from);
    if (/^\/(parol|password)(@\S+)?$/.test(text)) {
      const acc = guides.accountByChat(u.id);
      if (!acc) return send(u.id, t(lang, 'g_not_guide'));
      try { await guides.deliverCredentials(acc.id, { reason: 'bot_command' }); } catch (e) { await send(u.id, e.message); }
      return;
    }
    if (isBtn(text, 'b_menu_lang') || text === '/lang') {
      const rows = []; for (let i = 0; i < LANGS.length; i += 3) rows.push(LANGS.slice(i, i + 3).map(l => ({ text: ctx.window.LANGS.find(x => x[0] === l)[1], callback_data: 'l:' + l })));
      return send(u.id, t(lang, 'b_lang_choose'), { reply_markup: { inline_keyboard: rows } });
    }
    if (isBtn(text, 'b_menu_trips') || text === '/trips') { setState(u.id, null); return showTrips(u.id, user, lang); }
    if (isBtn(text, 'b_menu_explore') || text === '/explore') { setState(u.id, null); return exploreMenu(u.id, lang); }
    if (isBtn(text, 'b_menu_faq') || text === '/faq') { setState(u.id, null); return faqMenu(u.id, lang); }
    if (text === '/articles') return faqAnswer(u.id, lang, 'articles');
    if (text === '/tickets') { setState(u.id, null); return myTickets(u.id, lang); }
    if (text.startsWith('/find')) { const q = text.replace(/^\/find(@\S+)?\s*/, ''); if (!q) return exploreMenu(u.id, lang); return showDestResults(u.id, lang, searchDest(q), q); }
    if (isBtn(text, 'b_menu_support') || text === '/support') {
      setState(u.id, null);
      return send(u.id, t(lang, 'b_support_choose'), { reply_markup: { inline_keyboard: [[{ text: t(lang, 'b_k_complaint'), callback_data: 'k:complaint' }, { text: t(lang, 'b_k_suggestion'), callback_data: 'k:suggestion' }], [{ text: t(lang, 'b_k_question'), callback_data: 'k:question' }, { text: t(lang, 'b_my_tickets'), callback_data: 'tk' }]] } });
    }
    if (isBtn(text, 'b_menu_reset') || text === '/reset') { setState(u.id, { s: 'reset_email' }); return send(u.id, t(lang, 'b_reset_email'), { reply_markup: { force_reply: true } }); }
    const st = getState(u);
    if (st && st.s === 'reset_email') {
      setState(u.id, null);
      const ru = db.get("SELECT * FROM users WHERE email=? AND status='active'", text.toLowerCase());
      if (!ru || String(ru.tg_chat_id) !== String(u.id)) return send(u.id, t(lang, 'b_reset_notlinked'), menu(lang));
      return send(u.id, t(lang, 'b_reset_code', { code: createResetCode(ru) }) + (publicUrl() ? '\n' + publicUrl() + '/?reset=1' : ''), menu(lang));
    }
    const hasMedia = !!(m.photo || m.document || m.voice || m.video || m.audio);
    // Bank o'tkazmasi cheki (rasm yoki PDF) — "🧾 Chek yuborish" bosilgandan keyin
    if (st && st.s === 'receipt' && (text || hasMedia)) {
      const fileId = m.photo && m.photo.length ? m.photo[m.photo.length - 1].file_id : (m.document ? m.document.file_id : null);
      if (!fileId) return send(u.id, t(lang, 'rc_need_file'));
      setState(u.id, null);
      const own = user && db.get('SELECT * FROM bookings WHERE id=? AND user_id=?', st.booking, user.id);
      const info = own && receipts.forBooking(own.id);
      if (!info || !info.canUpload) return send(u.id, t(lang, 'rc_not_needed'), menu(lang));
      if (m.document && m.document.file_size > 6 * 1024 * 1024) return send(u.id, t(lang, 'rc_bad_file'));
      const dl = await downloadFile(fileId, 6 * 1024 * 1024);
      if (!dl || dl.tooBig) return send(u.id, t(lang, dl && dl.tooBig ? 'rc_bad_file' : 'err_generic'));
      try {
        const rc = receipts.createReceipt({ paymentId: info.paymentId, userId: user.id, source: 'telegram', buffer: dl.buf });
        return send(u.id, t(lang, 'rc_got', { rc: rc.code }), menu(lang));
      } catch (e) { return send(u.id, e.status === 415 || e.status === 413 ? t(lang, 'rc_bad_file') : e.message, menu(lang)); }
    }
    if (st && st.s === 'support' && (text || hasMedia)) {
      setState(u.id, null);
      const d = st.dest ? catalog.get(st.dest) : null;
      const body = (d ? t('uz', 'b_req_text', { place: d.names.uz || d.names.en }) + ` [${d.slug}]\n` : '') + (text || '📎');
      const tk = await createTicket({ userId: user ? user.id : null, chatId: u.id, kind: st.kind, bookingId: st.booking || null, lang, text: body, contact: user ? user.email : (m.from && m.from.username ? '@' + m.from.username : ''), from: (m.from && m.from.first_name) || '' });
      if (hasMedia) await forwardMedia(m, tk.code);
      return send(u.id, t(lang, 'b_support_sent', { code: tk.code }), menu(lang));
    }
    // Aniq manzil nomi yozilsa — manzil kartasi (masalan "Kyoto", "Samarqand")
    if (text && !text.startsWith('/')) { const ex = searchDest(text); if (ex.length === 1 && Object.values(ex[0].names).some(x => norm(x) === norm(text))) return destCard(u.id, lang, ex[0].slug); }
    // Ochiq murojaat bo'lsa — yangi xabar shu murojaatga qo'shiladi
    const open = db.get("SELECT * FROM tickets WHERE chat_id=? AND status IN ('open','answered') AND updated_at > ? ORDER BY updated_at DESC LIMIT 1", u.id, new Date(Date.now() - 3 * 86400000).toISOString());
    if (open && hasMedia) { await forwardMedia(m, open.code); db.run("UPDATE tickets SET status='open', updated_at=? WHERE id=?", db.now(), open.id); return send(u.id, t(lang, 'b_media_sent', { code: open.code })); }
    if (open && text) {
      db.run('INSERT INTO ticket_messages(ticket_id,sender,sender_name,text,created_at) VALUES(?,?,?,?,?)', open.id, 'customer', (m.from && m.from.first_name) || '', text.slice(0, 3000), db.now());
      db.run("UPDATE tickets SET status='open', updated_at=? WHERE id=?", db.now(), open.id);
      const sc = supportChat();
      if (sc) { const sm = await send(sc, `💬 ${open.code}\n${text.slice(0, 3000)}`); if (sm) db.run('UPDATE ticket_messages SET support_msg_id=? WHERE id=(SELECT MAX(id) FROM ticket_messages WHERE ticket_id=?)', sm.message_id, open.id); }
      return send(u.id, t(lang, 'b_support_sent', { code: open.code }));
    }
    if (text && !text.startsWith('/')) { const found = searchDest(text); if (found.length) return showDestResults(u.id, lang, found, text); }
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
    const msgId = cq.message.message_id;
    if (kind === 'rg0') { await ack(); return exploreMenu(chatId, lang, cq.message.photo ? null : msgId); }
    if (kind === 'rg' && REGIONS.includes(a)) { await ack(); return regionList(chatId, lang, a, Math.max(0, parseInt(b, 10) || 0), cq.message.photo ? null : msgId); }
    if (kind === 'd') { await ack(); return destCard(chatId, lang, a); }
    if (kind === 'cd' && catalog.get(a)) { await ack(); return send(chatId, t(lang, 'b_calc_days'), { reply_markup: { inline_keyboard: [[3, 5, 7, 10, 14].map(n => ({ text: String(n), callback_data: `cp:${a}:${n}` }))] } }); }
    if (kind === 'cp' && catalog.get(a)) { await ack(); return call('editMessageText', { chat_id: chatId, message_id: msgId, text: t(lang, 'b_calc_people'), reply_markup: { inline_keyboard: [[1, 2, 3, 4, 6].map(n => ({ text: String(n), callback_data: `cr:${a}:${b}:${n}` }))] } }); }
    if (kind === 'cr' && catalog.get(a)) {
      const c = String(cq.data).split(':'); await ack();
      const res = calcResult(lang, a, Math.min(30, Math.max(1, +c[2] || 5)), Math.min(20, Math.max(1, +c[3] || 2)));
      const kb = [[{ text: t(lang, 'b_btn_request'), callback_data: 'rq:' + a }]]; const d = catalog.get(a); if (sitePage(lang, d)) kb.push([{ text: t(lang, 'b_btn_site'), url: sitePage(lang, d) }]);
      return call('editMessageText', { chat_id: chatId, message_id: msgId, text: res, reply_markup: { inline_keyboard: kb } });
    }
    if (kind === 'rq' && catalog.get(a)) { setState(u.id, { s: 'support', kind: 'request', dest: a }); await ack(); return send(chatId, t(lang, 'rq_msg') + ' — ' + dName(catalog.get(a), lang) + '\n' + t(lang, 'b_support_write'), { reply_markup: { force_reply: true } }); }
    if (kind === 'f') { await ack(); return faqAnswer(chatId, lang, a); }
    if (kind === 'tk') { await ack(); return myTickets(chatId, lang); }
    // ---- Gid platformasi ----
    if (kind === 'gl') { await ack(); return guideMenu(chatId, lang, cq.from); }
    if (kind === 'gp') {
      const acc = guides.accountByChat(chatId); if (!acc) { await ack(); return send(chatId, t(lang, 'g_not_guide')); }
      try { await guides.deliverCredentials(acc.id, { reason: 'bot_button' }); return ack('✓'); } catch (e) { return ack(e.message); }
    }
    if (kind === 'gx' || kind === 'gk') {
      const acc = guides.accountByChat(chatId); await ack();
      if (!acc) return;
      if (kind === 'gx' && !db.get('SELECT 1 x FROM guide_challenges WHERE id=? AND guide_id=?', a, acc.id)) return;
      await send(chatId, t(lang, 'g_notme_done'));
      return guides.notMe(acc, kind === 'gx' ? 'login_code' : 'login_alert');
    }
    if (kind === 'ga') {
      const acc = guides.accountByChat(chatId); if (!acc) return ack(t(lang, 'g_not_guide'));
      try { const r = guides.ackBooking(acc.id, a); await ack('✓'); return send(chatId, t(lang, 'g_accepted', { code: r.code })); } catch (e) { return ack(e.message); }
    }
    if (!user) { await ack(); return send(chatId, t(lang, 'b_link_howto', { url: publicUrl() || 'Manzil' })); }
    const own = db.get('SELECT * FROM bookings WHERE id=? AND user_id=?', a, user.id);
    if (!own) return ack(t(lang, 'err_generic'));
    if (kind === 'rc') {
      const info = receipts.forBooking(own.id); await ack();
      if (!info || !info.canUpload) return send(chatId, t(lang, 'rc_not_needed'));
      setState(u.id, { s: 'receipt', booking: own.id });
      return send(chatId, t(lang, 'rc_ask', { code: own.code, amount: som(info.amountUzs) }), { reply_markup: { force_reply: true } });
    }
    if (kind === 'bp') {
      await ack();
      if (!receipts.bankInfo().configured) return send(chatId, t(lang, 'b_pay_bank_off'));
      const prep = core.preparePayment(user, own.id, 'bank');
      if (!prep.reused) core.insertPayment(user, prep.o, prep.booking, { sandbox: false });
      const bt = receipts.forBooking(own.id);
      return send(chatId, `${own.code}\n\n${bankBlock(lang, bt)}`, { reply_markup: { inline_keyboard: bt.canUpload ? [[{ text: t(lang, 'rc_btn'), callback_data: 'rc:' + own.id }]] : [] } });
    }
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
  const cmds = l => [{ command: 'start', description: t(l, 'b_menu_open') }, { command: 'explore', description: t(l, 'b_menu_explore') }, { command: 'trips', description: t(l, 'b_menu_trips') }, { command: 'support', description: t(l, 'b_menu_support') }, { command: 'tickets', description: t(l, 'b_my_tickets') }, { command: 'faq', description: t(l, 'b_menu_faq') }, { command: 'reset', description: t(l, 'b_menu_reset') }, { command: 'lang', description: t(l, 'b_menu_lang') }]
    .map(c => ({ command: c.command, description: c.description.replace(/^[^\p{L}]+/u, '').slice(0, 250) }));
  await call('setMyCommands', { commands: cmds('en') });
  for (const l of LANGS) { await call('setMyCommands', { commands: cmds(l), language_code: l }); await call('setMyDescription', { description: t(l, 'b_about').slice(0, 512), language_code: l }); }
  await call('setMyDescription', { description: t('en', 'b_about').slice(0, 512) });
  return { enabled: true, username: me && me.username, webhook };
}

module.exports = { runReminders, runAutoDelete, scheduleDelete, searchDest, enabled, setup, wire, handleUpdate, webhookSecret, sendResetCode, createTicket, replyToTicket, closeTicket, notifyStaff, supportCode, supportChat, send, call, t, botName };
