'use strict';
/**
 * Click (SHOP API) va Payme (Merchant API) — mahalliy to'lov provayderlari.
 * Ikkalasida ham provayder BIZNING serverimizga murojaat qiladi; to'lov faqat imzo/avtorizatsiya tekshirilgandan
 * va summa bazadagi summa bilan aynan mos kelgandan keyin "to'langan" bo'ladi.
 *
 * Kerakli muhit o'zgaruvchilari:
 *   CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_SECRET_KEY, (ixtiyoriy) CLICK_MERCHANT_USER_ID
 *   PAYME_MERCHANT_ID, PAYME_KEY  (test kassa uchun PAYME_TEST_KEY ham qabul qilinadi)
 * Provayder kabinetida "account" maydoni nomi: order_id (Payme), merchant_trans_id = to'lov ID (Click).
 */
const crypto = require('crypto');
const db = require('./db');
const sec = require('./security');
const core = require('./core');

const SYS = (p) => ({ type: 'provider', id: p, label: p });
const md5 = s => crypto.createHash('md5').update(String(s)).digest('hex');
const logEvent = (provider, eventId, payload) => {
  try { db.run('INSERT INTO payment_events(provider,event_id,received_at,payload) VALUES(?,?,?,?)', provider, String(eventId), db.now(), JSON.stringify(sec.scrub(payload)).slice(0, 4000)); return true; }
  catch (_) { return false; } // takroriy hodisa
};

// =====================================================================  CLICK
const CLICK = { ok: 0, sign: -1, amount: -2, action: -3, already: -4, notFound: -5, txNotFound: -6, update: -7, request: -8, cancelled: -9 };
function clickConfigured() { return !!(process.env.CLICK_SERVICE_ID && process.env.CLICK_SECRET_KEY); }

/** Click Prepare (action=0) va Complete (action=1). body — application/x-www-form-urlencoded maydonlari. */
function clickHandle(body) {
  const b = Object.fromEntries(Object.entries(body || {}).map(([k, v]) => [k, String(v == null ? '' : v)]));
  const base = { click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id };
  const err = (code, note, extra = {}) => ({ ...base, ...extra, error: code, error_note: note });
  if (!clickConfigured()) return err(CLICK.request, 'Not configured');
  const need = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'];
  if (need.some(k => b[k] === undefined || b[k] === '')) return err(CLICK.request, 'Missing parameters');
  if (b.service_id !== String(process.env.CLICK_SERVICE_ID)) return err(CLICK.request, 'Wrong service');
  const action = b.action;
  const signSrc = b.click_trans_id + b.service_id + process.env.CLICK_SECRET_KEY + b.merchant_trans_id + (action === '1' ? (b.merchant_prepare_id || '') : '') + b.amount + action + b.sign_time;
  if (!sec.safeEqual(md5(signSrc), b.sign_string.toLowerCase())) return err(CLICK.sign, 'SIGN CHECK FAILED');
  if (action !== '0' && action !== '1') return err(CLICK.action, 'Action not found');

  const p = db.get("SELECT * FROM payments WHERE id=? AND provider='click'", b.merchant_trans_id);
  if (!p) return err(CLICK.notFound, 'Order not found');
  if (Math.abs(Number(b.amount) - p.amount_uzs) > 0.01) return err(CLICK.amount, 'Incorrect amount');
  if (p.status === 'cancelled' || p.status === 'failed' || p.status === 'expired') return err(CLICK.cancelled, 'Transaction cancelled');

  if (action === '0') {
    if (p.status !== 'pending') return err(CLICK.already, 'Already paid');
    const tx = db.get("SELECT * FROM provider_txns WHERE provider='click' AND payment_id=? AND state=1", p.id);
    if (tx && tx.id !== 'click_' + b.click_trans_id) return err(CLICK.update, 'Order is being paid by another transaction');
    if (!tx) db.run("INSERT INTO provider_txns(id,provider,payment_id,state,amount,create_time) VALUES(?,?,?,?,?,?)", 'click_' + b.click_trans_id, 'click', p.id, 1, Math.round(Number(b.amount) * 100), Date.now());
    logEvent('click', 'prepare_' + b.click_trans_id, b);
    const prep = db.get("SELECT rowid FROM provider_txns WHERE id=?", 'click_' + b.click_trans_id);
    return { ...base, merchant_prepare_id: prep.rowid, error: 0, error_note: 'Success' };
  }
  // Complete
  const tx = db.get("SELECT rowid, * FROM provider_txns WHERE id=?", 'click_' + b.click_trans_id);
  if (!tx || String(tx.rowid) !== String(b.merchant_prepare_id)) return err(CLICK.txNotFound, 'Transaction does not exist');
  if (tx.state === -1) return err(CLICK.cancelled, 'Transaction cancelled');
  if (Number(b.error) < 0) { // Click to'lovni bekor qilganini xabar qilmoqda
    db.run('UPDATE provider_txns SET state=-1, cancel_time=?, reason=? WHERE id=?', Date.now(), Number(b.error), tx.id);
    core.failPayment(p.id, 'cancelled', 'click error ' + b.error, SYS('click'));
    return err(CLICK.cancelled, 'Transaction cancelled');
  }
  if (tx.state === 2 || ['paid', 'partially_refunded', 'refunded'].includes(p.status)) return { ...base, merchant_confirm_id: tx.rowid, error: CLICK.already, error_note: 'Already paid' };
  db.run('UPDATE provider_txns SET state=2, perform_time=? WHERE id=?', Date.now(), tx.id);
  logEvent('click', 'complete_' + b.click_trans_id, b);
  core.markPaid(p.id, 'click', SYS('click'), { providerTxnId: String(b.click_trans_id) });
  return { ...base, merchant_confirm_id: tx.rowid, error: 0, error_note: 'Success' };
}

// =====================================================================  PAYME
const PE = {
  auth: { code: -32504, message: { uz: 'Avtorizatsiya xatosi', ru: 'Ошибка авторизации', en: 'Authorization error' } },
  method: { code: -32601, message: { uz: 'Metod topilmadi', ru: 'Метод не найден', en: 'Method not found' } },
  parse: { code: -32700, message: { uz: 'JSON xato', ru: 'Ошибка JSON', en: 'Parse error' } },
  amount: { code: -31001, message: { uz: 'Noto‘g‘ri summa', ru: 'Неверная сумма', en: 'Incorrect amount' } },
  order: { code: -31050, message: { uz: 'Buyurtma topilmadi', ru: 'Заказ не найден', en: 'Order not found' }, data: 'order_id' },
  busy: { code: -31051, message: { uz: 'Buyurtma boshqa tranzaksiya bilan to‘lanmoqda', ru: 'Заказ оплачивается другой транзакцией', en: 'Order is busy' }, data: 'order_id' },
  paid: { code: -31052, message: { uz: 'Buyurtma allaqachon to‘langan yoki bekor qilingan', ru: 'Заказ уже оплачен или отменён', en: 'Order already paid or cancelled' }, data: 'order_id' },
  txNotFound: { code: -31003, message: { uz: 'Tranzaksiya topilmadi', ru: 'Транзакция не найдена', en: 'Transaction not found' } },
  cantPerform: { code: -31008, message: { uz: 'Amalni bajarib bo‘lmaydi', ru: 'Невозможно выполнить операцию', en: 'Cannot perform operation' } },
  cantCancel: { code: -31007, message: { uz: 'Buyurtma bajarilgan, bekor qilib bo‘lmaydi', ru: 'Заказ выполнен, отмена невозможна', en: 'Order completed, cannot cancel' } }
};
const TIMEOUT = 12 * 3600 * 1000;
function paymeConfigured() { return !!(process.env.PAYME_MERCHANT_ID && (process.env.PAYME_KEY || process.env.PAYME_TEST_KEY)); }
function paymeAuthOk(header) {
  const m = /^Basic\s+(.+)$/i.exec(String(header || '')); if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':'); if (i < 0) return false;
  const login = decoded.slice(0, i), pass = decoded.slice(i + 1);
  if (login !== 'Paycom') return false;
  return [process.env.PAYME_KEY, process.env.PAYME_TEST_KEY].filter(Boolean).some(k => sec.safeEqual(k, pass));
}
const txView = t => ({ create_time: t.create_time, perform_time: t.perform_time, cancel_time: t.cancel_time, transaction: t.payment_id, state: t.state, reason: t.reason == null ? null : t.reason });

function paymeOrder(params) {
  const orderId = params && params.account && String(params.account.order_id || '');
  const p = orderId && db.get("SELECT * FROM payments WHERE id=? AND provider='payme'", orderId);
  if (!p) throw PE.order;
  if (Number(params.amount) !== p.amount_uzs * 100) throw PE.amount;
  return p;
}
function cancelPaymeTx(t, reason) {
  return db.tx(() => {
    const now = Date.now();
    if (t.state === 1) {
      db.run('UPDATE provider_txns SET state=-1, cancel_time=?, reason=? WHERE id=?', now, reason, t.id);
      core.failPayment(t.payment_id, 'cancelled', 'payme cancel ' + reason, SYS('payme'));
    } else if (t.state === 2) {
      const p = db.get('SELECT * FROM payments WHERE id=?', t.payment_id);
      const b = db.get('SELECT status FROM bookings WHERE id=?', p.booking_id);
      if (b && b.status === 'completed') throw PE.cantCancel;
      db.run('UPDATE provider_txns SET state=-2, cancel_time=?, reason=? WHERE id=?', now, reason, t.id);
      // Payme pulni mijozga qaytardi: qolgan summa uchun bajarilgan qaytarish yoziladi (ledger teskari yozuvi bilan)
      const remaining = p.amount_c - p.refunded_c;
      if (remaining > 0) {
        db.run("UPDATE refunds SET status='rejected', note='Payme orqali to‘liq qaytarildi' WHERE payment_id=? AND status IN ('requested','approved')", p.id);
        const id = db.uid('rf_');
        db.run(`INSERT INTO refunds(id,payment_id,booking_id,amount_c,reason,status,requested_by,requested_by_type,decided_by,decided_at,created_at) VALUES(?,?,?,?,?,'approved','payme','provider','payme',?,?)`,
          id, p.id, p.booking_id, remaining, 'Payme CancelTransaction reason=' + reason, db.now(), db.now());
        core.processRefund(id, SYS('payme'), { providerRef: t.id, method: 'payme' });
      }
    }
    return db.get('SELECT * FROM provider_txns WHERE id=?', t.id);
  });
}

/** JSON-RPC so'rovini qayta ishlaydi. Har doim HTTP 200 va JSON-RPC javobi qaytariladi. */
function paymeHandle(authHeader, rpc) {
  const id = rpc && rpc.id != null ? rpc.id : null;
  const fail = e => ({ jsonrpc: '2.0', id, error: { code: e.code, message: e.message, data: e.data } });
  if (!paymeConfigured() || !paymeAuthOk(authHeader)) return fail(PE.auth);
  if (!rpc || typeof rpc !== 'object' || !rpc.method) return fail(PE.parse);
  const params = rpc.params || {};
  try {
    let result;
    switch (rpc.method) {
      case 'CheckPerformTransaction': {
        const p = paymeOrder(params);
        if (p.status !== 'pending') throw PE.paid;
        result = { allow: true };
        break;
      }
      case 'CreateTransaction': {
        const existing = db.get("SELECT * FROM provider_txns WHERE id=? AND provider='payme'", String(params.id));
        if (existing) {
          if (existing.state !== 1) throw PE.cantPerform;
          if (Date.now() - existing.create_time > TIMEOUT) { cancelPaymeTx(existing, 4); throw PE.cantPerform; }
          result = { create_time: existing.create_time, transaction: existing.payment_id, state: existing.state };
          break;
        }
        const p = paymeOrder(params);
        if (p.status !== 'pending') throw PE.paid;
        const other = db.get("SELECT * FROM provider_txns WHERE provider='payme' AND payment_id=? AND state=1", p.id);
        if (other) throw PE.busy;
        const t = Number(params.time) || Date.now();
        db.run('INSERT INTO provider_txns(id,provider,payment_id,state,amount,create_time) VALUES(?,?,?,?,?,?)', String(params.id), 'payme', p.id, 1, Number(params.amount), t);
        logEvent('payme', 'create_' + params.id, params);
        result = { create_time: t, transaction: p.id, state: 1 };
        break;
      }
      case 'PerformTransaction': {
        const t = db.get("SELECT * FROM provider_txns WHERE id=? AND provider='payme'", String(params.id));
        if (!t) throw PE.txNotFound;
        if (t.state === 2) { result = { transaction: t.payment_id, perform_time: t.perform_time, state: 2 }; break; }
        if (t.state !== 1) throw PE.cantPerform;
        if (Date.now() - t.create_time > TIMEOUT) { cancelPaymeTx(t, 4); throw PE.cantPerform; }
        const now = Date.now();
        db.run('UPDATE provider_txns SET state=2, perform_time=? WHERE id=?', now, t.id);
        logEvent('payme', 'perform_' + t.id, params);
        core.markPaid(t.payment_id, 'payme', SYS('payme'), { providerTxnId: t.id });
        result = { transaction: t.payment_id, perform_time: now, state: 2 };
        break;
      }
      case 'CancelTransaction': {
        const t = db.get("SELECT * FROM provider_txns WHERE id=? AND provider='payme'", String(params.id));
        if (!t) throw PE.txNotFound;
        const after = t.state < 0 ? t : cancelPaymeTx(t, Number(params.reason) || 0);
        result = { transaction: after.payment_id, cancel_time: after.cancel_time, state: after.state };
        break;
      }
      case 'CheckTransaction': {
        const t = db.get("SELECT * FROM provider_txns WHERE id=? AND provider='payme'", String(params.id));
        if (!t) throw PE.txNotFound;
        result = txView(t);
        break;
      }
      case 'GetStatement': {
        const rows = db.all("SELECT * FROM provider_txns WHERE provider='payme' AND create_time BETWEEN ? AND ? ORDER BY create_time", Number(params.from) || 0, Number(params.to) || 0);
        result = { transactions: rows.map(t => ({ id: t.id, time: t.create_time, amount: t.amount, account: { order_id: t.payment_id }, ...txView(t) })) };
        break;
      }
      default: throw PE.method;
    }
    return { jsonrpc: '2.0', id, result };
  } catch (e) {
    if (e && e.code && e.message && typeof e.message === 'object') return fail(e);
    if (e && e.status) return fail({ ...PE.cantPerform, data: e.message });
    console.error('[payme]', e);
    return fail(PE.cantPerform);
  }
}

module.exports = { clickHandle, clickConfigured, paymeHandle, paymeConfigured, md5 };
