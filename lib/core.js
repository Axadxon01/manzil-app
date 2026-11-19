'use strict';
/**
 * Manzil — biznes mantiq: buyurtmalar, to'lovlar, qaytarishlar, ikki yoqlama hisob (ledger), gid to'lovlari,
 * xarajatlar, hisobotlar va xodimlar samaradorligi.
 * Barcha pul summalari butun SENTLARDA.
 */
const crypto = require('crypto');
const db = require('./db');
const sec = require('./security');
const { HttpError } = sec;
const EventEmitter = require('events');
const events = new EventEmitter(); // bot va bildirishnomalar shu yerdan tinglaydi
const emit = (...a) => setImmediate(() => { try { events.emit(...a); } catch (e) { console.error('[event]', e.message); } });

const toC = usd => Math.round(Number(usd) * 100);
const usd = c => Math.round(Number(c || 0)) / 100;
const PAID_STATES = "('paid','partially_refunded','refunded')";
const OPEN_BOOKING = "('pending','confirmed')";
const ITEM_TYPES = ['guide', 'package', 'other'];
const PROVIDERS = ['click', 'payme', 'uzum', 'stripe', 'card'];
const EXPENSE_CATEGORIES = ['marketing', 'hosting', 'salary', 'tax', 'provider_fees', 'other'];

const SYSTEM = { type: 'system', id: 'system', label: 'tizim' };
const staffActor = s => ({ type: 'staff', id: s.id, label: `${s.name} (${s.role})` });
const userActor = u => ({ type: 'user', id: u.id, label: u.email });

function commissionRateFor(guide) {
  const r = guide && guide.commission_rate != null ? Number(guide.commission_rate) : Number(db.getSetting('commission_rate'));
  return Math.min(0.5, Math.max(0, Number.isFinite(r) ? r : 0.12));
}
const usdUzsRate = () => Math.max(1000, Number(db.getSetting('usd_uzs_rate')) || 12850);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newBookingCode() {
  for (let i = 0; i < 10; i++) {
    const b = crypto.randomBytes(6);
    const code = 'MZ-' + Array.from(b, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
    if (!db.get('SELECT 1 x FROM bookings WHERE code=?', code)) return code;
  }
  throw new Error('Buyurtma kodi yaratib bo\'lmadi');
}

// ============================================================ Buyurtma yaratish
/** Kiritilgan ma'lumotni tekshiradi va narxni SERVERda hisoblaydi (hali bazaga yozmaydi). */
function prepareOrder(user, body) {
  const S = sec.str;
  const provider = S(body.provider, 20).toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'To\'lov usuli noto\'g\'ri.');
  const days = Math.max(1, Math.min(60, parseInt(body.days, 10) || 1));
  const people = Math.max(1, Math.min(50, parseInt(body.people, 10) || 1));
  const customerName = S(body.customerName || body.name || (user && user.name), 100);
  const contact = S(body.contact || body.customerContact || (user && user.email), 120);
  if (customerName.length < 2) throw new HttpError(400, 'Ismingizni kiriting.');
  if (contact.length < 5) throw new HttpError(400, 'Telefon yoki email kiriting (chek va aloqa uchun).');

  let travelDate = S(body.travelDate, 10) || null;
  if (travelDate) {
    const t = Date.parse(travelDate + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate) || !Number.isFinite(t)) throw new HttpError(400, 'Sayohat sanasi noto\'g\'ri.');
    if (t < Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) throw new HttpError(400, 'Sayohat sanasi o\'tib ketgan.');
    if (t > Date.now() + 800 * 86400000) throw new HttpError(400, 'Sayohat sanasi juda uzoq.');
  }

  let itemType = ITEM_TYPES.includes(body.itemType) ? body.itemType : (body.guideId ? 'guide' : 'package');
  let guide = null, pkg = null, amountC, priceSource, title = S(body.title, 160) || 'Manzil xizmati', city = S(body.city, 100);
  if (body.packageId) {
    pkg = db.get("SELECT * FROM packages WHERE id=? AND status='approved'", S(body.packageId, 60));
    if (!pkg) throw new HttpError(404, 'Paket topilmadi yoki tasdiqlanmagan.');
    if (pkg.is_sample) throw new HttpError(409, 'Bu namunaviy taklif. So\'rov yuboring — jamoamiz siz bilan bog\'lanadi.', { code: 'SAMPLE_OFFER' });
    if (pkg.operator_id && !db.get("SELECT 1 x FROM operators WHERE id=? AND status='approved'", pkg.operator_id)) throw new HttpError(409, 'Tur operator faol emas.');
    if (!travelDate) throw new HttpError(400, 'Sayohat sanasini tanlang.');
    if (people > pkg.max_people) throw new HttpError(400, `Bu paket uchun eng ko'pi ${pkg.max_people} kishi.`);
    itemType = 'package';
    amountC = pkg.price_c * people;
    priceSource = 'server';
    title = (pkg.title || 'Tur-paket') + ' — ' + pkg.dest_slug;
    city = pkg.dest_slug;
  } else if (body.guideId) {
    guide = db.get("SELECT * FROM guides WHERE id=? AND status='approved'", S(body.guideId, 60));
    if (!guide) throw new HttpError(404, 'Gid topilmadi yoki tasdiqlanmagan.');
    if (guide.is_sample) throw new HttpError(409, 'Bu namunaviy taklif. So\'rov yuboring — jamoamiz siz bilan bog\'lanadi.', { code: 'SAMPLE_OFFER' });
    if (!travelDate) throw new HttpError(400, 'Gid band qilish uchun sayohat sanasini tanlang.');
    itemType = 'guide';
    amountC = toC(guide.rate) * days; // faraz: gid stavkasi — GURUH uchun kunlik narx
    priceSource = 'server';
    title = `Gid xizmati — ${guide.city}`; // gid ismi to'lovdan oldin oshkor qilinmaydi
    city = guide.dest_slug || guide.city;
  } else {
    const a = Number(body.amountUsd);
    if (!Number.isFinite(a) || a < 1 || a > 20000) throw new HttpError(400, 'Summa noto\'g\'ri (1–20000 USD).');
    amountC = toC(a);
    priceSource = 'client'; // katalog hali serverda emas — xodim narxni tekshirmaguncha tasdiqlay olmaydi
    if (!city) city = title.split(' — ')[0].slice(0, 100);
  }
  const genderPref = ['male', 'female'].includes(body.genderPref) ? body.genderPref : null;
  if (guide && genderPref && guide.gender && guide.gender !== genderPref) throw new HttpError(400, 'Tanlangan gid siz tanlagan afzallikka mos emas.');
  const rate = usdUzsRate();
  const op = pkg && pkg.operator_id ? db.get('SELECT * FROM operators WHERE id=?', pkg.operator_id) : null;
  const commissionRate = commissionRateFor(guide || op);
  const commissionC = Math.round(amountC * commissionRate);
  return {
    id: db.uid('bk_'), code: newBookingCode(), paymentId: db.uid('pay_'), provider, itemType, guide, title, city, travelDate, days, people,
    customerName, contact, amountC, amountUzs: Math.round(usd(amountC) * rate), rateUzs: rate, commissionRate, commissionC, payoutC: amountC - commissionC,
    priceSource, genderPref, pkg, operatorId: op ? op.id : null, lang: S(body.lang, 5) || null, userId: user ? user.id : null
  };
}

function insertOrder(o, checkout) {
  return db.tx(() => {
    const t = db.now();
    db.run(`INSERT INTO bookings(id,code,user_id,guide_id,item_type,title,city,travel_date,days,people,customer_name,contact,amount_c,amount_uzs,rate_uzs,
            commission_rate,commission_c,payout_c,price_source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      o.id, o.code, o.userId, o.guide ? o.guide.id : null, o.itemType, o.title, o.city, o.travelDate, o.days, o.people, o.customerName, o.contact,
      o.amountC, o.amountUzs, o.rateUzs, o.commissionRate, o.commissionC, o.payoutC, o.priceSource, 'awaiting_payment', t);
    db.run('UPDATE bookings SET gender_pref=?, package_id=?, operator_id=?, lang=? WHERE id=?', o.genderPref, o.pkg ? o.pkg.id : null, o.operatorId, o.lang, o.id);
    db.run(`INSERT INTO payments(id,booking_id,provider,status,amount_c,amount_uzs,currency,is_sandbox,provider_txn_id,checkout_url,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`, o.paymentId, o.id, o.provider, 'pending', o.amountC, o.amountUzs,
      (o.provider === 'stripe' || o.provider === 'card') ? 'USD' : 'UZS', checkout.sandbox ? 1 : 0, checkout.txnId || null, checkout.url || null, t);
    sec.audit(o.userId ? { type: 'user', id: o.userId, label: o.contact } : { type: 'guest', id: 'guest', label: o.contact }, 'booking.create', 'booking', o.id, null,
      { code: o.code, amountUsd: usd(o.amountC), provider: o.provider, sandbox: !!checkout.sandbox, priceSource: o.priceSource });
    emit('booking.created', o.id);
    return { booking: db.get('SELECT * FROM bookings WHERE id=?', o.id), payment: db.get('SELECT * FROM payments WHERE id=?', o.paymentId) };
  });
}

// ============================================================ Ledger (ikki yoqlama yozuv)
function postJournal(txnId, entries, meta = {}) {
  const d = entries.reduce((s, e) => s + (e.debit || 0), 0), c = entries.reduce((s, e) => s + (e.credit || 0), 0);
  if (d !== c) throw new Error(`Ledger muvozanati buzilgan (${d} != ${c}) txn=${txnId}`);
  const t = db.now();
  for (const e of entries) {
    if (!e.debit && !e.credit) continue;
    db.run('INSERT INTO ledger(txn_id,at,account,debit,credit,party,ref_type,ref_id,memo,actor) VALUES(?,?,?,?,?,?,?,?,?,?)',
      txnId, t, e.account, e.debit || 0, e.credit || 0, e.party || null, meta.refType || null, meta.refId || null, e.memo || meta.memo || null, meta.actor || null);
  }
}
const partyOf = b => b.guide_id || b.operator_id || 'partner';

// ============================================================ To'lovni "to'langan" qilish
function pickStaff() {
  const rows = db.all(`SELECT s.id, s.name,
      (SELECT COUNT(*) FROM bookings b WHERE b.staff_id=s.id AND b.status IN ${OPEN_BOOKING}) AS open_cnt,
      (SELECT MAX(assigned_at) FROM bookings b WHERE b.staff_id=s.id) AS last_assigned
    FROM staff s WHERE s.active=1 AND s.role IN ('booking_manager','support_agent') ORDER BY open_cnt ASC, last_assigned ASC`);
  return rows[0] || null;
}
function assignStaff(bookingId, staffId, actor) {
  const b = db.get('SELECT staff_id FROM bookings WHERE id=?', bookingId);
  db.run('UPDATE bookings SET staff_id=?, assigned_at=? WHERE id=?', staffId, db.now(), bookingId);
  sec.audit(actor || SYSTEM, 'booking.assign', 'booking', bookingId, { staffId: b && b.staff_id }, { staffId });
}

function markPaid(paymentId, via, actor, opts = {}) {
  return db.tx(() => {
    const p = db.get('SELECT * FROM payments WHERE id=?', paymentId);
    if (!p) throw new HttpError(404, 'To\'lov topilmadi.');
    if (['paid', 'partially_refunded', 'refunded'].includes(p.status)) return { changed: false, payment: p };
    if (p.status !== 'pending') throw new HttpError(409, `Bu to'lov holatida tasdiqlab bo'lmaydi: ${p.status}`);
    const b = db.get('SELECT * FROM bookings WHERE id=?', p.booking_id);
    const other = db.get(`SELECT id FROM payments WHERE booking_id=? AND id<>? AND status IN ${PAID_STATES}`, b.id, p.id);
    const receipt = 'RCP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    db.run("UPDATE payments SET status='paid', paid_at=?, receipt_id=?, provider_txn_id=COALESCE(?,provider_txn_id) WHERE id=?", db.now(), receipt, opts.providerTxnId || null, p.id);
    if (b.status === 'awaiting_payment') db.run("UPDATE bookings SET status='pending' WHERE id=?", b.id);
    if (!p.is_sandbox) {
      postJournal('pay_' + p.id, [
        { account: 'cash', debit: p.amount_c, memo: `To'lov ${b.code} (${p.provider})` },
        { account: 'commission_revenue', credit: b.commission_c, memo: `Komissiya ${b.code}` },
        { account: 'payable', credit: b.payout_c, party: partyOf(b), memo: `Gid/hamkor ulushi ${b.code}` }
      ], { refType: 'payment', refId: p.id, actor: actor ? actor.label : null });
    }
    sec.audit(actor || SYSTEM, 'payment.paid', 'payment', p.id, { status: p.status }, { status: 'paid', via, receipt, sandbox: !!p.is_sandbox, bookingCode: b.code });
    const fresh = db.get('SELECT * FROM bookings WHERE id=?', b.id);
    if (!fresh.staff_id) { const s = pickStaff(); if (s) assignStaff(b.id, s.id, SYSTEM); }
    emit('booking.paid', b.id);
    // Buyurtma allaqachon bekor qilingan yoki ikki marta to'langan bo'lsa — pul qaytarish so'rovi avtomatik yaratiladi
    if (b.status === 'cancelled' || other) {
      db.run(`INSERT INTO refunds(id,payment_id,booking_id,amount_c,reason,status,requested_by,requested_by_type,created_at)
              VALUES(?,?,?,?,?,'requested','system','system',?)`, db.uid('rf_'), p.id, b.id, p.amount_c,
        b.status === 'cancelled' ? 'Bekor qilingan buyurtmaga to\'lov keldi' : 'Ikki marta to\'langan', db.now());
    }
    return { changed: true, payment: db.get('SELECT * FROM payments WHERE id=?', p.id), booking: db.get('SELECT * FROM bookings WHERE id=?', b.id) };
  });
}

function failPayment(paymentId, status, reason, actor) {
  const p = db.get('SELECT * FROM payments WHERE id=?', paymentId);
  if (!p || p.status !== 'pending') return;
  db.run('UPDATE payments SET status=? WHERE id=?', status, paymentId);
  sec.audit(actor || SYSTEM, 'payment.' + status, 'payment', paymentId, { status: p.status }, { status, reason });
}

// ============================================================ Buyurtma holati
const TRANSITIONS = { awaiting_payment: ['cancelled'], pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [] };
function setBookingStatus(bookingId, newStatus, staff, { note, priceVerified, refund } = {}) {
  return db.tx(() => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', bookingId);
    if (!b) throw new HttpError(404, 'Buyurtma topilmadi.');
    if (!(TRANSITIONS[b.status] || []).includes(newStatus)) throw new HttpError(409, `"${b.status}" holatidan "${newStatus}" holatiga o'tib bo'lmaydi.`);
    const paid = db.get(`SELECT * FROM payments WHERE booking_id=? AND status IN ${PAID_STATES} ORDER BY paid_at DESC LIMIT 1`, b.id);
    const t = db.now();
    if (newStatus === 'confirmed') {
      if (!paid) throw new HttpError(409, 'To\'lov tasdiqlanmagan buyurtmani tasdiqlab bo\'lmaydi.');
      if (b.price_source === 'client' && !priceVerified) throw new HttpError(409, 'Bu buyurtma narxi mijoz tomonidan yuborilgan. Narxni tekshirib, "Narx tekshirildi" belgisini qo\'ying.');
      db.run('UPDATE bookings SET status=?, confirmed_at=? WHERE id=?', 'confirmed', t, b.id);
    } else if (newStatus === 'completed') {
      db.run('UPDATE bookings SET status=?, completed_at=? WHERE id=?', 'completed', t, b.id);
    } else if (newStatus === 'cancelled') {
      db.run('UPDATE bookings SET status=?, cancelled_at=? WHERE id=?', 'cancelled', t, b.id);
      db.run("UPDATE payments SET status='cancelled' WHERE booking_id=? AND status='pending'", b.id);
      if (paid && refund) requestRefundInner(paid, paid.amount_c - paid.refunded_c - openRefundsC(paid.id), note || 'Xodim tomonidan bekor qilindi', staffActor(staff));
    }
    if (note) db.run('UPDATE bookings SET notes=? WHERE id=?', ((b.notes ? b.notes + '\n' : '') + `[${t.slice(0, 16)}] ${staff.name}: ${sec.str(note, 300)}`).slice(-2000), b.id);
    sec.audit(staffActor(staff), 'booking.status', 'booking', b.id, { status: b.status }, { status: newStatus, note, priceVerified: !!priceVerified, refundRequested: !!(paid && refund && newStatus === 'cancelled') });
    emit('booking.status', b.id, newStatus);
    return db.get('SELECT * FROM bookings WHERE id=?', b.id);
  });
}

function cancelPolicyPct(b) {
  if (!b.travel_date) return b.status === 'confirmed' ? 50 : 100;
  const days = Math.floor((Date.parse(b.travel_date + 'T00:00:00Z') - Date.now()) / 86400000);
  let policy; try { policy = JSON.parse(db.getSetting('cancel_policy')); } catch (_) { policy = []; }
  policy.sort((a, c) => c.minDays - a.minDays);
  const hit = policy.find(r => days >= r.minDays);
  return hit ? Math.max(0, Math.min(100, hit.pct)) : 0;
}

/** Mijoz o'z buyurtmasini bekor qiladi: siyosat bo'yicha qaytarish SO'ROVI yaratiladi (xodim tasdiqlaydi). */
function cancelByCustomer(user, bookingId) {
  return db.tx(() => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', bookingId);
    if (!b || b.user_id !== user.id) throw new HttpError(404, 'Buyurtma topilmadi.');
    if (!['awaiting_payment', 'pending', 'confirmed'].includes(b.status)) throw new HttpError(409, 'Bu buyurtmani bekor qilib bo\'lmaydi.');
    const pct = cancelPolicyPct(b);
    const paid = db.get(`SELECT * FROM payments WHERE booking_id=? AND status IN ${PAID_STATES} ORDER BY paid_at DESC LIMIT 1`, b.id);
    db.run("UPDATE bookings SET status='cancelled', cancelled_at=? WHERE id=?", db.now(), b.id);
    db.run("UPDATE payments SET status='cancelled' WHERE booking_id=? AND status='pending'", b.id);
    let refund = null;
    if (paid && pct > 0) {
      const amount = Math.round(paid.amount_c * pct / 100);
      refund = requestRefundInner(paid, amount, `Mijoz bekor qildi (siyosat: ${pct}%)`, userActor(user));
    }
    emit('booking.status', b.id, 'cancelled');
    sec.audit(userActor(user), 'booking.cancel_by_customer', 'booking', b.id, { status: b.status }, { status: 'cancelled', policyPct: pct, refundC: refund ? refund.amount_c : 0 });
    return { booking: db.get('SELECT * FROM bookings WHERE id=?', b.id), refundPct: pct, refund };
  });
}

// ============================================================ Qaytarishlar
const openRefundsC = paymentId => db.get("SELECT COALESCE(SUM(amount_c),0) s FROM refunds WHERE payment_id=? AND status IN ('requested','approved')", paymentId).s;
function requestRefundInner(p, amountC, reason, actor) {
  if (!['paid', 'partially_refunded'].includes(p.status)) throw new HttpError(409, 'Faqat to\'langan to\'lov qaytariladi.');
  const remaining = p.amount_c - p.refunded_c - openRefundsC(p.id);
  if (!Number.isInteger(amountC) || amountC <= 0) throw new HttpError(400, 'Qaytarish summasi noto\'g\'ri.');
  if (amountC > remaining) throw new HttpError(409, `Qaytarish summasi qolgan summadan ($${usd(remaining)}) oshib ketdi.`);
  const id = db.uid('rf_');
  db.run(`INSERT INTO refunds(id,payment_id,booking_id,amount_c,reason,status,requested_by,requested_by_type,created_at) VALUES(?,?,?,?,?,'requested',?,?,?)`,
    id, p.id, p.booking_id, amountC, sec.str(reason, 300), actor.id, actor.type, db.now());
  sec.audit(actor, 'refund.request', 'refund', id, null, { paymentId: p.id, amountUsd: usd(amountC), reason });
  return db.get('SELECT * FROM refunds WHERE id=?', id);
}
function requestRefund(paymentId, amountC, reason, staff) {
  return db.tx(() => {
    const p = db.get('SELECT * FROM payments WHERE id=?', paymentId);
    if (!p) throw new HttpError(404, 'To\'lov topilmadi.');
    if (!sec.str(reason, 300)) throw new HttpError(400, 'Sabab ko\'rsating.');
    return requestRefundInner(p, amountC, reason, staffActor(staff));
  });
}
function approveRefund(refundId, staff, { selfApprove } = {}) {
  return db.tx(() => {
    const r = db.get('SELECT * FROM refunds WHERE id=?', refundId);
    if (!r) throw new HttpError(404, 'Qaytarish so\'rovi topilmadi.');
    if (r.status !== 'requested') throw new HttpError(409, `So'rov holati: ${r.status}`);
    if (r.requested_by_type === 'staff' && r.requested_by === staff.id) {
      if (!(staff.role === 'super_admin' && selfApprove)) throw new HttpError(403, 'O\'zingiz yaratgan so\'rovni o\'zingiz tasdiqlay olmaysiz (ikki kishi nazorati). Boshqa xodim tasdiqlashi kerak.');
    }
    db.run("UPDATE refunds SET status='approved', decided_by=?, decided_at=? WHERE id=?", staff.id, db.now(), r.id);
    sec.audit(staffActor(staff), 'refund.approve', 'refund', r.id, { status: 'requested' }, { status: 'approved', selfApprove: !!selfApprove, amountUsd: usd(r.amount_c) });
    return db.get('SELECT * FROM refunds WHERE id=?', r.id);
  });
}
function rejectRefund(refundId, staff, note) {
  return db.tx(() => {
    const r = db.get('SELECT * FROM refunds WHERE id=?', refundId);
    if (!r || r.status !== 'requested') throw new HttpError(409, 'So\'rovni rad etib bo\'lmaydi.');
    db.run("UPDATE refunds SET status='rejected', decided_by=?, decided_at=?, note=? WHERE id=?", staff.id, db.now(), sec.str(note, 300), r.id);
    sec.audit(staffActor(staff), 'refund.reject', 'refund', r.id, { status: 'requested' }, { status: 'rejected', note });
    return db.get('SELECT * FROM refunds WHERE id=?', r.id);
  });
}
/** Qaytarish amalga oshirildi (provayderda pul qaytarilgach). Ledger'ga proporsional yoziladi. */
function processRefund(refundId, actor, { providerRef, method } = {}) {
  return db.tx(() => {
    const r = db.get('SELECT * FROM refunds WHERE id=?', refundId);
    if (!r) throw new HttpError(404, 'Qaytarish so\'rovi topilmadi.');
    if (r.status !== 'approved') throw new HttpError(409, 'Faqat tasdiqlangan so\'rov amalga oshiriladi.');
    const p = db.get('SELECT * FROM payments WHERE id=?', r.payment_id);
    const b = db.get('SELECT * FROM bookings WHERE id=?', r.booking_id);
    if (p.refunded_c + r.amount_c > p.amount_c) throw new HttpError(409, 'Qaytarish summasi to\'lovdan oshib ketdi.');
    const newRefunded = p.refunded_c + r.amount_c;
    db.run('UPDATE payments SET refunded_c=?, status=? WHERE id=?', newRefunded, newRefunded >= p.amount_c ? 'refunded' : 'partially_refunded', p.id);
    db.run("UPDATE refunds SET status='processed', processed_at=?, provider_ref=?, method=? WHERE id=?", db.now(), sec.str(providerRef, 120) || null, method || 'manual', r.id);
    if (!p.is_sandbox) {
      const commPart = Math.round(r.amount_c * b.commission_c / p.amount_c), guidePart = r.amount_c - commPart;
      postJournal('refund_' + r.id, [
        { account: 'commission_revenue', debit: commPart, memo: `Qaytarish ${b.code}` },
        { account: 'payable', debit: guidePart, party: partyOf(b), memo: `Qaytarish (gid ulushi) ${b.code}` },
        { account: 'cash', credit: r.amount_c, memo: `Mijozga qaytarildi ${b.code}` }
      ], { refType: 'refund', refId: r.id, actor: actor.label });
    }
    if (newRefunded >= p.amount_c && !['completed', 'cancelled'].includes(b.status)) {
      db.run("UPDATE bookings SET status='cancelled', cancelled_at=? WHERE id=?", db.now(), b.id);
    }
    emit('refund.processed', r.id);
    sec.audit(actor, 'refund.process', 'refund', r.id, { status: 'approved' }, { status: 'processed', providerRef, method, amountUsd: usd(r.amount_c) });
    return db.get('SELECT * FROM refunds WHERE id=?', r.id);
  });
}

// ============================================================ Gid to'lovlari (payout) va xarajatlar
function payables() {
  const rows = db.all("SELECT party, SUM(credit-debit) AS balance_c FROM ledger WHERE account='payable' GROUP BY party");
  const held = {};
  db.all(`SELECT b.* , p.amount_c AS p_amount, p.refunded_c FROM bookings b JOIN payments p ON p.booking_id=b.id
          WHERE p.is_sandbox=0 AND p.status IN ${PAID_STATES} AND b.status NOT IN ('completed')`).forEach(b => {
    const part = b.payout_c - Math.round(b.refunded_c * b.payout_c / b.p_amount);
    if (b.status === 'cancelled') return;
    held[partyOf(b)] = (held[partyOf(b)] || 0) + part;
  });
  const names = {};
  db.all('SELECT id,name FROM guides').forEach(g => { names[g.id] = g.name; });
  db.all('SELECT id,company FROM operators').forEach(o => { names[o.id] = o.company + ' (tur operator)'; });
  names.partner = 'Hamkor operatorlar / tur-paketlar';
  return rows.map(r => {
    const heldC = Math.min(Math.max(0, r.balance_c), held[r.party] || 0);
    return { party: r.party, name: names[r.party] || r.party, balanceUsd: usd(r.balance_c), heldUsd: usd(heldC), eligibleUsd: usd(Math.max(0, r.balance_c - heldC)) };
  }).filter(r => r.balanceUsd !== 0).sort((a, b) => b.balanceUsd - a.balanceUsd);
}
function createPayout(party, amountC, { method, reference, note }, staff) {
  return db.tx(() => {
    const row = payables().find(p => p.party === party);
    if (!row) throw new HttpError(404, 'Bu tomon uchun to\'lanadigan summa yo\'q.');
    if (!Number.isInteger(amountC) || amountC <= 0) throw new HttpError(400, 'Summa noto\'g\'ri.');
    if (amountC > toC(row.eligibleUsd)) throw new HttpError(409, `To'lash mumkin bo'lgan summa: $${row.eligibleUsd} (yakunlanmagan buyurtmalar ulushi ushlab turiladi).`);
    const id = db.uid('po_');
    db.run('INSERT INTO payouts(id,party,amount_c,method,reference,note,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)', id, party, amountC,
      sec.str(method, 40), sec.str(reference, 120), sec.str(note, 300), db.now(), staff.id);
    postJournal('payout_' + id, [
      { account: 'payable', debit: amountC, party, memo: `To'lov: ${row.name}` },
      { account: 'cash', credit: amountC, memo: `To'lov: ${row.name}` }
    ], { refType: 'payout', refId: id, actor: staff.name });
    sec.audit(staffActor(staff), 'payout.create', 'payout', id, null, { party, amountUsd: usd(amountC), method, reference });
    return db.get('SELECT * FROM payouts WHERE id=?', id);
  });
}
function addExpense({ category, description, amountC, spentAt }, staff) {
  if (!EXPENSE_CATEGORIES.includes(category)) throw new HttpError(400, 'Xarajat turi noto\'g\'ri.');
  if (!Number.isInteger(amountC) || amountC <= 0 || amountC > 100000000) throw new HttpError(400, 'Summa noto\'g\'ri.');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(spentAt || '') ? spentAt : db.now().slice(0, 10);
  return db.tx(() => {
    const id = db.uid('ex_');
    db.run('INSERT INTO expenses(id,category,description,amount_c,spent_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, category, sec.str(description, 200), amountC, d, staff.id, db.now());
    postJournal('exp_' + id, [
      { account: 'expense:' + category, debit: amountC, memo: sec.str(description, 100) },
      { account: 'cash', credit: amountC, memo: sec.str(description, 100) }
    ], { refType: 'expense', refId: id, actor: staff.name });
    sec.audit(staffActor(staff), 'expense.create', 'expense', id, null, { category, amountUsd: usd(amountC), description });
    return db.get('SELECT * FROM expenses WHERE id=?', id);
  });
}

// ============================================================ Hisobotlar
function range(from, to) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : new Date().toISOString().slice(0, 10);
  const fromIso = f + 'T00:00:00.000Z', toIso = t + 'T23:59:59.999Z';
  const span = Date.parse(toIso) - Date.parse(fromIso) + 1;
  return { from: f, to: t, fromIso, toIso, prevFromIso: new Date(Date.parse(fromIso) - span).toISOString(), prevToIso: new Date(Date.parse(fromIso) - 1).toISOString() };
}
const sandboxClause = sandbox => (sandbox ? '' : 'AND p.is_sandbox=0');

function periodStats(fromIso, toIso, sandbox) {
  const paid = db.get(`SELECT COUNT(*) n, COALESCE(SUM(p.amount_c-p.refunded_c),0) gmv,
      COALESCE(SUM(b.commission_c - CAST(ROUND(1.0*p.refunded_c*b.commission_c/p.amount_c) AS INTEGER)),0) comm,
      COALESCE(SUM(p.refunded_c),0) refunded
    FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.status IN ${PAID_STATES} AND p.paid_at BETWEEN ? AND ? ${sandboxClause(sandbox)}`, fromIso, toIso);
  const created = db.get('SELECT COUNT(*) n, COUNT(DISTINCT COALESCE(user_id, contact)) customers FROM bookings WHERE created_at BETWEEN ? AND ?', fromIso, toIso);
  return { bookings: created.n, customers: created.customers, paidCount: paid.n, gmvC: paid.gmv, commC: paid.comm, refundedC: paid.refunded };
}
const delta = (cur, prev) => (prev ? Math.round((cur - prev) / prev * 1000) / 10 : (cur ? 100 : 0));

function dashboard(from, to, sandbox) {
  const r = range(from, to);
  const cur = periodStats(r.fromIso, r.toIso, sandbox), prev = periodStats(r.prevFromIso, r.prevToIso, sandbox);
  const pending = db.get("SELECT COUNT(*) n FROM bookings WHERE status='pending'").n;
  const awaiting = db.get("SELECT COUNT(*) n FROM bookings WHERE status='awaiting_payment'").n;
  const byType = db.all(`SELECT b.item_type type, COUNT(*) n, COALESCE(SUM(p.amount_c-p.refunded_c),0) gmv_c FROM payments p JOIN bookings b ON b.id=p.booking_id
    WHERE p.status IN ${PAID_STATES} AND p.paid_at BETWEEN ? AND ? ${sandboxClause(sandbox)} GROUP BY b.item_type`, r.fromIso, r.toIso);
  const trendRows = db.all(`SELECT substr(p.paid_at,1,10) d, COUNT(*) n, SUM(p.amount_c-p.refunded_c) gmv_c,
      SUM(b.commission_c - CAST(ROUND(1.0*p.refunded_c*b.commission_c/p.amount_c) AS INTEGER)) comm_c
    FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.status IN ${PAID_STATES} AND p.paid_at BETWEEN ? AND ? ${sandboxClause(sandbox)} GROUP BY d`, r.fromIso, r.toIso);
  const map = Object.fromEntries(trendRows.map(x => [x.d, x]));
  const trend = [];
  for (let t = Date.parse(r.fromIso); t <= Date.parse(r.toIso) && trend.length < 400; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    trend.push({ date: d, gmvUsd: usd(map[d] ? map[d].gmv_c : 0), commissionUsd: usd(map[d] ? map[d].comm_c : 0), count: map[d] ? map[d].n : 0 });
  }
  const top = db.all(`SELECT COALESCE(NULLIF(b.city,''), b.title) name, COUNT(*) n, SUM(p.amount_c-p.refunded_c) gmv_c FROM payments p JOIN bookings b ON b.id=p.booking_id
    WHERE p.status IN ${PAID_STATES} AND p.paid_at BETWEEN ? AND ? ${sandboxClause(sandbox)} GROUP BY name ORDER BY gmv_c DESC LIMIT 5`, r.fromIso, r.toIso);
  const tiles = db.all('SELECT item_type type, COUNT(*) n FROM bookings WHERE created_at BETWEEN ? AND ? GROUP BY item_type', r.fromIso, r.toIso);
  const statusCounts = db.all('SELECT status, COUNT(*) n FROM bookings WHERE created_at BETWEEN ? AND ? GROUP BY status', r.fromIso, r.toIso);
  const refundsOpen = db.get("SELECT COUNT(*) n, COALESCE(SUM(amount_c),0) s FROM refunds WHERE status IN ('requested','approved')");
  const sandboxCount = db.get('SELECT COUNT(*) n FROM payments WHERE is_sandbox=1').n;
  return {
    range: { from: r.from, to: r.to },
    kpi: {
      bookings: { value: cur.bookings, deltaPct: delta(cur.bookings, prev.bookings) },
      revenue: { gmvUsd: usd(cur.gmvC), commissionUsd: usd(cur.commC), refundedUsd: usd(cur.refundedC), deltaPct: delta(cur.gmvC, prev.gmvC) },
      pending: { value: pending, awaitingPayment: awaiting },
      customers: { value: cur.customers, deltaPct: delta(cur.customers, prev.customers) }
    },
    byType: byType.map(x => ({ type: x.type, count: x.n, gmvUsd: usd(x.gmv_c) })),
    tiles, statusCounts, trend,
    topDestinations: top.map(x => ({ name: x.name, count: x.n, gmvUsd: usd(x.gmv_c) })),
    refundsOpen: { count: refundsOpen.n, amountUsd: usd(refundsOpen.s) },
    sandboxPayments: sandboxCount, includesSandbox: !!sandbox
  };
}

// ---------- Buyurtmalar ro'yxati / tafsilot ----------
const BOOKING_SELECT = `SELECT b.*, g.name AS guide_name, g.gender AS guide_gender, g.tg AS guide_tg, s.name AS staff_name,
  (SELECT status FROM payments WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1) AS pay_status,
  (SELECT provider FROM payments WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1) AS provider,
  (SELECT is_sandbox FROM payments WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1) AS is_sandbox
  FROM bookings b LEFT JOIN guides g ON g.id=b.guide_id LEFT JOIN staff s ON s.id=b.staff_id`;
function bookingView(b) {
  return {
    id: b.id, code: b.code, type: b.item_type, title: b.title, city: b.city, travelDate: b.travel_date, days: b.days, people: b.people,
    customer: { name: b.customer_name, contact: b.contact, userId: b.user_id }, amountUsd: usd(b.amount_c), amountUzs: b.amount_uzs, commissionUsd: usd(b.commission_c), payoutUsd: usd(b.payout_c),
    priceSource: b.price_source, status: b.status, payStatus: b.pay_status, provider: b.provider, sandbox: !!b.is_sandbox,
    guide: b.guide_id ? { id: b.guide_id, name: b.guide_name, gender: b.guide_gender } : null, genderPref: b.gender_pref || null, staff: b.staff_id ? { id: b.staff_id, name: b.staff_name } : null,
    createdAt: b.created_at, assignedAt: b.assigned_at, confirmedAt: b.confirmed_at, completedAt: b.completed_at, cancelledAt: b.cancelled_at, notes: b.notes
  };
}
function listBookings({ status, type, q, from, to, staffId, limit = 50, offset = 0 }) {
  const where = [], params = [];
  if (status === 'unassigned') where.push("b.staff_id IS NULL AND b.status IN ('pending','confirmed')");
  else if (status) { where.push('b.status=?'); params.push(status); }
  if (type) { where.push('b.item_type=?'); params.push(type); }
  if (staffId) { where.push('b.staff_id=?'); params.push(staffId); }
  if (from) { where.push('b.created_at>=?'); params.push(from + 'T00:00:00.000Z'); }
  if (to) { where.push('b.created_at<=?'); params.push(to + 'T23:59:59.999Z'); }
  if (q) { where.push('(b.code LIKE ? OR b.customer_name LIKE ? OR b.contact LIKE ? OR b.title LIKE ?)'); const l = `%${q.replace(/[%_]/g, '')}%`; params.push(l, l, l, l); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) n FROM bookings b ${w}`, ...params).n;
  const rows = db.all(`${BOOKING_SELECT} ${w} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, ...params, Math.min(200, limit), Math.max(0, offset));
  return { total, bookings: rows.map(bookingView) };
}
/** Mijoz uchun ko'rinish: gid ismi va aloqasi faqat to'lov tasdiqlangach (va bekor qilinmagan bo'lsa) ochiladi. */
function guideAlias(g) { return 'G-' + crypto.createHash('sha256').update(String(g)).digest('hex').slice(0, 4).toUpperCase(); }
function customerBookingView(id) {
  const b = db.get(`${BOOKING_SELECT} WHERE b.id=?`, id);
  if (!b) return null;
  const paid = ['paid', 'partially_refunded'].includes(b.pay_status) && ['pending', 'confirmed', 'completed'].includes(b.status);
  const refunds = db.all('SELECT amount_c, status FROM refunds WHERE booking_id=?', id).map(r => ({ amountUsd: usd(r.amount_c), status: r.status }));
  const review = db.get('SELECT rating, comment FROM reviews WHERE booking_id=?', id) || null;
  let guide = null;
  if (b.guide_id) {
    guide = { alias: guideAlias(b.guide_id), gender: b.guide_gender || null, revealed: paid };
    if (paid) { guide.name = b.guide_name; guide.telegram = b.guide_tg || null; }
  }
  let operator = null;
  if (b.operator_id) { const o = db.get('SELECT company, phone FROM operators WHERE id=?', b.operator_id); operator = o ? { company: o.company, phone: paid ? o.phone : null } : null; }
  const cancellable = ['awaiting_payment', 'pending', 'confirmed'].includes(b.status);
  return { id: b.id, code: b.code, type: b.item_type, title: b.title, city: b.city, packageId: b.package_id || null, travelDate: b.travel_date, days: b.days, people: b.people,
    amountUsd: usd(b.amount_c), status: b.status, payStatus: b.pay_status, provider: b.provider, sandbox: !!b.is_sandbox, genderPref: b.gender_pref || null,
    guide, operator, refunds, review, canCancel: cancellable, cancelRefundPct: cancellable && paid ? cancelPolicyPct(b) : 0,
    canReview: b.status === 'completed' && !review && !!(b.guide_id || b.staff_id || b.operator_id), createdAt: b.created_at };
}
function bookingDetail(id) {
  const b = db.get(`${BOOKING_SELECT} WHERE b.id=?`, id);
  if (!b) return null;
  const payments = db.all('SELECT * FROM payments WHERE booking_id=? ORDER BY created_at', id).map(paymentView);
  const refunds = db.all('SELECT r.*, s.name AS decided_by_name FROM refunds r LEFT JOIN staff s ON s.id=r.decided_by WHERE r.booking_id=? ORDER BY r.created_at', id).map(refundView);
  const review = db.get('SELECT rating, service_rating, comment, created_at FROM reviews WHERE booking_id=?', id) || null;
  const timeline = db.all("SELECT at, actor_label, action, payload FROM audit WHERE (entity='booking' AND entity_id=?) OR (entity='payment' AND entity_id IN (SELECT id FROM payments WHERE booking_id=?)) ORDER BY seq", id, id)
    .map(a => ({ at: a.at, actor: a.actor_label, action: a.action }));
  return { booking: bookingView(b), payments, refunds, review, timeline };
}
function paymentView(p) {
  return { id: p.id, bookingId: p.booking_id, provider: p.provider, status: p.status, amountUsd: usd(p.amount_c), amountUzs: p.amount_uzs, currency: p.currency, sandbox: !!p.is_sandbox,
    receiptId: p.receipt_id, createdAt: p.created_at, paidAt: p.paid_at, refundedUsd: usd(p.refunded_c), providerTxnId: p.provider_txn_id };
}
function refundView(r) {
  return { id: r.id, paymentId: r.payment_id, bookingId: r.booking_id, amountUsd: usd(r.amount_c), reason: r.reason, status: r.status, requestedBy: r.requested_by, requestedByType: r.requested_by_type,
    decidedBy: r.decided_by, decidedByName: r.decided_by_name, decidedAt: r.decided_at, processedAt: r.processed_at, providerRef: r.provider_ref, method: r.method, note: r.note, createdAt: r.created_at, bookingCode: r.code, customer: r.customer_name };
}
function listRefunds(status) {
  const rows = db.all(`SELECT r.*, b.code, b.customer_name, p.provider, p.is_sandbox, s.name decided_by_name FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN payments p ON p.id=r.payment_id
    LEFT JOIN staff s ON s.id=r.decided_by ${status ? 'WHERE r.status=?' : ''} ORDER BY r.created_at DESC LIMIT 300`, ...(status ? [status] : []));
  return rows.map(r => ({ ...refundView(r), provider: r.provider, sandbox: !!r.is_sandbox }));
}
function listPayments({ status, limit = 100 }) {
  const rows = db.all(`SELECT p.*, b.code, b.customer_name, b.title FROM payments p JOIN bookings b ON b.id=p.booking_id ${status ? 'WHERE p.status=?' : ''} ORDER BY p.created_at DESC LIMIT ?`, ...(status ? [status] : []), limit);
  return rows.map(p => ({ ...paymentView(p), bookingCode: p.code, customer: p.customer_name, title: p.title }));
}

// ---------- Hisob-kitob (accounting) ----------
function accounting(from, to) {
  const r = range(from, to);
  const accounts = db.all('SELECT account, SUM(debit) d, SUM(credit) c FROM ledger GROUP BY account ORDER BY account');
  const period = db.all('SELECT account, SUM(debit) d, SUM(credit) c FROM ledger WHERE at BETWEEN ? AND ? GROUP BY account', r.fromIso, r.toIso);
  const get = (rows, acc) => rows.find(x => x.account === acc) || { d: 0, c: 0 };
  const rev = get(period, 'commission_revenue'); const revenueC = rev.c - rev.d;
  const expenses = period.filter(x => x.account.startsWith('expense:')).map(x => ({ category: x.account.slice(8), amountUsd: usd(x.d - x.c) }));
  const expenseC = period.filter(x => x.account.startsWith('expense:')).reduce((s, x) => s + x.d - x.c, 0);
  const cash = get(accounts, 'cash'), pay = get(accounts, 'payable');
  const allRev = get(accounts, 'commission_revenue'), allExp = accounts.filter(x => x.account.startsWith('expense:')).reduce((s, x) => s + x.d - x.c, 0);
  const totalD = accounts.reduce((s, x) => s + x.d, 0), totalC = accounts.reduce((s, x) => s + x.c, 0);
  const inflow = db.get('SELECT COALESCE(SUM(amount_c),0) s FROM payments p WHERE status IN (\'paid\',\'partially_refunded\',\'refunded\') AND is_sandbox=0 AND paid_at BETWEEN ? AND ?', r.fromIso, r.toIso).s;
  const refundsPeriod = db.get("SELECT COALESCE(SUM(amount_c),0) s FROM refunds WHERE status='processed' AND processed_at BETWEEN ? AND ? AND payment_id IN (SELECT id FROM payments WHERE is_sandbox=0)", r.fromIso, r.toIso).s;
  const payoutsPeriod = db.get('SELECT COALESCE(SUM(amount_c),0) s FROM payouts WHERE created_at BETWEEN ? AND ?', r.fromIso, r.toIso).s;
  return {
    range: { from: r.from, to: r.to },
    incomeStatement: { commissionRevenueUsd: usd(revenueC), expensesUsd: usd(expenseC), netProfitUsd: usd(revenueC - expenseC), expensesByCategory: expenses,
      grossReceivedUsd: usd(inflow), refundsUsd: usd(refundsPeriod), payoutsUsd: usd(payoutsPeriod) },
    balanceSheet: { cashUsd: usd(cash.d - cash.c), payableUsd: usd(pay.c - pay.d), retainedEarningsUsd: usd((allRev.c - allRev.d) - allExp),
      check: (cash.d - cash.c) === (pay.c - pay.d) + ((allRev.c - allRev.d) - allExp) },
    trialBalance: { rows: accounts.map(x => ({ account: x.account, debitUsd: usd(x.d), creditUsd: usd(x.c) })), totalDebitUsd: usd(totalD), totalCreditUsd: usd(totalC), balanced: totalD === totalC }
  };
}
function listLedger(limit = 200) {
  return db.all('SELECT * FROM ledger ORDER BY id DESC LIMIT ?', Math.min(1000, limit)).map(l => ({ id: l.id, txnId: l.txn_id, at: l.at, account: l.account, debitUsd: usd(l.debit), creditUsd: usd(l.credit), party: l.party, refType: l.ref_type, refId: l.ref_id, memo: l.memo, actor: l.actor }));
}

// ---------- Xodimlar samaradorligi ----------
function staffPerformance(from, to, onlyStaffId) {
  const r = range(from, to);
  const sla = Math.max(1, Number(db.getSetting('sla_confirm_minutes')) || 60);
  const staff = db.all(`SELECT id,name,email,role,active,last_login FROM staff ${onlyStaffId ? 'WHERE id=?' : ''} ORDER BY name`, ...(onlyStaffId ? [onlyStaffId] : []));
  return staff.map(s => {
    const bks = db.all('SELECT * FROM bookings WHERE staff_id=? AND assigned_at BETWEEN ? AND ?', s.id, r.fromIso, r.toIso);
    const paidRows = db.all(`SELECT p.amount_c, p.refunded_c, b.commission_c FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.staff_id=? AND p.is_sandbox=0 AND p.status IN ${PAID_STATES} AND b.assigned_at BETWEEN ? AND ?`, s.id, r.fromIso, r.toIso);
    const confirmMins = bks.filter(b => b.confirmed_at && b.assigned_at).map(b => (Date.parse(b.confirmed_at) - Date.parse(b.assigned_at)) / 60000);
    const confirmed = bks.filter(b => b.confirmed_at).length, completed = bks.filter(b => b.status === 'completed').length, cancelled = bks.filter(b => b.status === 'cancelled').length;
    const withinSla = confirmMins.filter(m => m <= sla).length;
    const rv = db.get('SELECT COUNT(*) n, AVG(rating) avg, AVG(service_rating) savg FROM reviews WHERE staff_id=? AND created_at BETWEEN ? AND ?', s.id, r.fromIso, r.toIso);
    const actions = db.get("SELECT COUNT(*) n FROM audit WHERE actor_type='staff' AND actor_id=? AND at BETWEEN ? AND ?", s.id, r.fromIso, r.toIso).n;
    const assigned = bks.length;
    const conv = assigned ? (confirmed + completed - bks.filter(b => b.status === 'completed' && b.confirmed_at).length) / assigned : null;
    const handled = assigned ? (confirmed) / assigned : null; // tasdiqlanganlar ulushi (completed ham confirmed_at ga ega)
    const slaRate = confirmMins.length ? withinSla / confirmMins.length : null;
    const ratingN = rv.avg ? rv.avg / 5 : null;
    // Samaradorlik balli (FARAZ, sozlanadi): 40% tasdiqlash ulushi + 30% mijoz bahosi + 30% SLA ga rioya
    let score = null;
    if (assigned) score = Math.round(100 * (0.4 * (handled || 0) + 0.3 * (ratingN == null ? 0.6 : ratingN) + 0.3 * (slaRate == null ? 0.5 : slaRate)));
    return {
      id: s.id, name: s.name, email: s.email, role: s.role, roleLabel: sec.ROLE_LABELS[s.role], active: !!s.active, lastLogin: s.last_login,
      assigned, confirmed, completed, cancelled, open: bks.filter(b => ['pending', 'confirmed'].includes(b.status)).length,
      toursSold: paidRows.length, salesUsd: usd(paidRows.reduce((a, x) => a + x.amount_c - x.refunded_c, 0)), commissionUsd: usd(paidRows.reduce((a, x) => a + x.commission_c, 0)),
      avgConfirmMin: confirmMins.length ? Math.round(confirmMins.reduce((a, b) => a + b, 0) / confirmMins.length) : null, slaRatePct: slaRate == null ? null : Math.round(slaRate * 100),
      feedbackCount: rv.n, avgRating: rv.avg ? Math.round(rv.avg * 10) / 10 : null, avgServiceRating: rv.savg ? Math.round(rv.savg * 10) / 10 : null,
      actions, score, conversionPct: conv == null ? null : Math.round((handled || 0) * 100)
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
function staffFeedback(staffId, limit = 30) {
  return db.all(`SELECT r.rating, r.service_rating, r.comment, r.created_at, b.code, b.customer_name FROM reviews r JOIN bookings b ON b.id=r.booking_id
    WHERE r.staff_id=? ORDER BY r.created_at DESC LIMIT ?`, staffId, limit).map(x => ({ rating: x.rating, serviceRating: x.service_rating, comment: x.comment, at: x.created_at, bookingCode: x.code, customer: x.customer_name }));
}

// ---------- Mijoz sharhi ----------
function addReview(user, bookingId, { rating, serviceRating, comment }) {
  const b = db.get('SELECT * FROM bookings WHERE id=?', bookingId);
  if (!b || b.user_id !== user.id) throw new HttpError(404, 'Buyurtma topilmadi.');
  if (b.status !== 'completed') throw new HttpError(409, 'Faqat yakunlangan buyurtmaga baho berish mumkin.');
  const r = parseInt(rating, 10), sr = parseInt(serviceRating, 10);
  if (!(r >= 1 && r <= 5)) throw new HttpError(400, 'Baho 1 dan 5 gacha bo\'lishi kerak.');
  if (db.get('SELECT 1 x FROM reviews WHERE booking_id=?', b.id)) throw new HttpError(409, 'Siz allaqachon baho bergansiz.');
  const id = db.uid('rv_');
  db.run('INSERT INTO reviews(id,booking_id,user_id,guide_id,staff_id,rating,service_rating,comment,created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, b.id, user.id, b.guide_id, b.staff_id, r, sr >= 1 && sr <= 5 ? sr : null, sec.str(comment, 1000), db.now());
  sec.audit(userActor(user), 'review.create', 'review', id, null, { bookingId: b.id, rating: r });
  return id;
}

function toCsv(rows, cols) {
  const esc = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
}

module.exports = {
  events, emit, partyOf,
  toC, usd, SYSTEM, staffActor, userActor, PROVIDERS, EXPENSE_CATEGORIES, commissionRateFor, usdUzsRate,
  prepareOrder, insertOrder, markPaid, failPayment, assignStaff, pickStaff, setBookingStatus, cancelByCustomer, cancelPolicyPct,
  requestRefund, approveRefund, rejectRefund, processRefund, payables, createPayout, addExpense,
  dashboard, listBookings, bookingDetail, customerBookingView, guideAlias, bookingView, paymentView, listRefunds, listPayments, accounting, listLedger, staffPerformance, staffFeedback, addReview,
  postJournal, toCsv, range
};
