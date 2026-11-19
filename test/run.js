'use strict';
// Integratsion test: serverni xotiradagi bazada ishga tushiradi va butun biznes oqimini tekshiradi.
const { spawn } = require('child_process');
const path = require('path');
const PORT = 3200 + Math.floor(Math.random() * 500), B = `http://localhost:${PORT}`;
const ADMIN = { email: 'boss@manzil.test', password: 'Str0ng-Admin-Pass!' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
class Jar { constructor() { this.c = {}; } set(r) { for (const s of r.headers.getSetCookie()) { const [kv] = s.split(';'); const i = kv.indexOf('='); this.c[kv.slice(0, i)] = kv.slice(i + 1); } } get h() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); } }
async function call(jar, method, p, body, headers = {}) {
  const r = await fetch(B + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(jar ? { Cookie: jar.h } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (jar) jar.set(r);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; }
  return { s: r.status, ...j, _h: r.headers };
}
(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DB_PATH: ':memory:', DEMO_PAYMENTS: 'true', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, SEED_SAMPLE_GUIDES: 'true' }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2500));
  try {
    const boss = new Jar(), tourist = new Jar(), anon = new Jar();
    console.log('\n[Auth va xavfsizlik]');
    let r = await call(anon, 'POST', '/api/staff/login', { email: ADMIN.email, password: 'wrong-password-123' }); ok(r.s === 401, 'noto\'g\'ri parol → 401');
    r = await call(boss, 'POST', '/api/staff/login', ADMIN); ok(r.s === 200 && r.staff.role === 'super_admin', 'super admin kirdi');
    ok(/HttpOnly/i.test((await fetch(B + '/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) })).headers.getSetCookie().join(';')), 'sessiya cookie HttpOnly');
    r = await call(anon, 'GET', '/api/admin/dashboard'); ok(r.s === 401, 'adminga kirishsiz → 401');
    r = await call(anon, 'GET', '/api/admin/dashboard?key=manzil-admin-2026', undefined, { 'X-Admin-Key': 'manzil-admin-2026' }); ok(r.s === 401, 'eski standart parol/kalit ishlamaydi');
    r = await call(anon, 'POST', '/api/auth/logout', {}, { Origin: 'https://evil.example' }); ok(r.s === 403, 'begona Origin → 403 (CSRF)');
    r = await call(anon, 'POST', '/api/auth/register', { name: 'X', email: 'x@x.uz', password: '12345678' }); ok(r.s === 400, 'oddiy parol rad etildi');
    r = await call(tourist, 'POST', '/api/auth/register', { name: 'Ali Valiyev', email: 'ali@test.uz', password: 'Tourist-pass-1' }); ok(r.s === 200, 'mijoz ro\'yxatdan o\'tdi');
    r = await call(anon, 'POST', '/api/auth/register', { name: 'Ali2', email: 'ALI@test.uz', password: 'Tourist-pass-1' }); ok(r.s === 409, 'takroriy email (katta harf) rad etildi');
    r = await call(tourist, 'GET', '/api/admin/dashboard'); ok(r.s === 401, 'mijoz sessiyasi admin API ga kira olmaydi');
    r = await call(tourist, 'GET', '/api/auth/me'); ok(r.s === 200 && r.user.email === 'ali@test.uz' && !JSON.stringify(r).includes('password'), '/me parol xeshini qaytarmaydi');
    let lockR; for (let i = 0; i < 6; i++) lockR = await call(anon, 'POST', '/api/auth/login', { email: 'ali@test.uz', password: 'bad-pass-' + i }); ok([423, 429].includes(lockR.s), 'qayta-qayta noto\'g\'ri parol → bloklash/limit');
    r = await call(anon, 'GET', '/api/../server.js'); ok(r.s !== 200 || !String(r.raw || '').includes('require('), 'path traversal yopiq');
    const st = await fetch(B + '/..%2f..%2fserver.js'); ok(st.status === 404, 'statik fayl traversal %2f → 404');
    r = await call(anon, 'POST', '/api/payments/create', { provider: 'click', amountUsd: 50, title: "x'); DROP TABLE users;--", customerName: 'Hacker', contact: 'h@h.uz' }); ok(r.s === 201 || r.s === 200, 'SQL-injection matni oddiy matn sifatida saqlandi');
    r = await call(boss, 'GET', '/api/admin/db/users'); ok(r.s === 200 && r.total >= 1, 'users jadvali SQL-injectiondan keyin ham bor');

    console.log('\n[Buyurtma va to\'lov]');
    const guides = (await call(anon, 'GET', '/api/guides')).guides; const g = guides[0];
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', guideId: g.id, days: 2, people: 2, travelDate: new Date(Date.now()+30*864e5).toISOString().slice(0,10), customerName: 'Ali', contact: '+998901112233', amountUsd: 1 });
    ok(r.s === 200 && r.amountUsd === g.rate * 2, `narx serverda hisoblandi (mijoz $1 yuborgan, server $${r.amountUsd})`);
    const real = r;
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', guideId: g.id, days: 1, travelDate: '2020-01-01', customerName: 'Ali', contact: '+998901112233' }); ok(r.s === 400, 'o\'tgan sana rad etildi');
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', amountUsd: -5, title: 'X', customerName: 'Ali', contact: '+998901112233' }); ok(r.s === 400, 'manfiy summa rad etildi');
    r = await call(anon, 'GET', `/api/payments/status/${real.code}`); ok(r.paymentStatus === 'pending', 'to\'lov tasdiqlanmaguncha "pending"');
    let d0 = await call(boss, 'GET', '/api/admin/dashboard'); ok(d0.kpi.revenue.gmvUsd === 0, 'to\'lanmagan buyurtma daromadga kirmadi');
    r = await call(anon, 'POST', '/api/payments/webhook/stripe', { id: 'evt_1' }, { 'Stripe-Signature': 't=1,v1=bad' }); ok([400, 503].includes(r.s), 'soxta Stripe webhook rad etildi');
    r = await call(anon, 'POST', '/api/payments/webhook/click', {}); ok(r.s === 501, 'Click webhook halol 501 (ulanmagan)');
    // Moliya xodimi (haqiqiy to'lovni qo'lda tasdiqlash uchun is_sandbox=0 bo'lishi kerak — DEMO rejimda sandbox, shuning uchun sandbox ni ham tekshiramiz)
    r = await call(anon, 'POST', '/api/payments/sandbox-confirm', { paymentId: real.paymentId }); ok(r.s === 200 && r.sandbox, 'sandbox to\'lov tasdiqlandi');
    d0 = await call(boss, 'GET', '/api/admin/dashboard'); ok(d0.kpi.revenue.gmvUsd === 0, 'sandbox to\'lov daromadga KIRMADI');
    d0 = await call(boss, 'GET', '/api/admin/dashboard?sandbox=1'); ok(d0.kpi.revenue.gmvUsd > 0, 'sandbox belgisi bilan ko\'rinadi');

    // Haqiqiy (non-sandbox) oqim uchun: DEMO o'chirilgan ikkinchi server
    srv.kill();
  } catch (e) { fail++; console.log('XATO', e); }
  finally { srv.kill(); }

  await realFlow();
  console.log(`\nNatija: ${pass} o'tdi, ${fail} muvaffaqiyatsiz`);
  process.exit(fail ? 1 : 0);
})();

// ---- Haqiqiy (sandbox emas) pul oqimi: Stripe webhook imzosi bilan to'lov, ledger, qaytarish, accounting ----
async function realFlow() {
  const crypto = require('crypto');
  const P2 = PORT + 600, B2 = `http://localhost:${P2}`, WHS = 'whsec_test_secret_123';
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: P2, DB_PATH: ':memory:', DEMO_PAYMENTS: 'false', STRIPE_WEBHOOK_SECRET: WHS, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2500));
  const c = async (jar, method, p, body, headers = {}) => {
    const r = await fetch(B2 + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(jar ? { Cookie: jar.h } : {}), ...headers }, body: typeof body === 'string' ? body : (body !== undefined ? JSON.stringify(body) : undefined) });
    if (jar) jar.set(r); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; } return { s: r.status, ...j };
  };
  try {
    console.log('\n[Haqiqiy pul oqimi: ledger, qaytarish, accounting]');
    const boss = new Jar(), fin = new Jar(), fin2 = new Jar(), mgr = new Jar(), user = new Jar(), anon = new Jar();
    await c(boss, 'POST', '/api/staff/login', ADMIN);
    let r = await c(user, 'POST', '/api/payments/create', { provider: 'stripe', amountUsd: 200, title: 'Samarqand turi', city: 'Samarqand', customerName: 'Vali', contact: 'v@v.uz' });
    ok(r.s === 503 && r.code === 'PAYMENT_PROVIDER_UNAVAILABLE', 'provayder ulanmagan va DEMO o\'chiq → aniq xato, soxta chek YO\'Q');
    // Stripe kaliti bo'lmagani uchun buyurtmani to'g'ridan-to'g'ri DB orqali emas, bank o'tkazmasi usulida yaratamiz: 'card' ham 503. Shuning uchun core API orqali tekshiramiz.
    srv.kill();
    await coreLedgerTest();
  } catch (e) { fail++; console.log('XATO', e); } finally { srv.kill(); }
}

// Ledger/qaytarish mantig'ini to'g'ridan-to'g'ri core modulida (xotiradagi bazada) tekshirish
async function coreLedgerTest() {
  console.log('\n[Core: ledger, qaytarish, ikki kishi nazorati]');
  process.env.DB_PATH = ':memory:'; process.env.SEED_SAMPLE_GUIDES = 'true';
  const db = require('../lib/db'), sec = require('../lib/security'), core = require('../lib/core');
  db.seedSampleGuides();
  const mk = async (name, role) => { const id = db.uid('st_'); db.run('INSERT INTO staff(id,name,email,role,password_hash,created_at) VALUES(?,?,?,?,?,?)', id, name, name + '@t.uz', role, 'x', db.now()); return db.get('SELECT * FROM staff WHERE id=?', id); };
  const mgr = await mk('mgr', 'booking_manager'), f1 = await mk('fin1', 'finance_manager'), f2 = await mk('fin2', 'finance_manager'), sa = await mk('sa', 'super_admin');
  const g = db.get("SELECT * FROM guides WHERE status='approved' LIMIT 1");
  const o = core.prepareOrder(null, { provider: 'click', guideId: g.id, days: 2, people: 1, travelDate: new Date(Date.now()+60*864e5).toISOString().slice(0,10), customerName: 'Vali', contact: 'v@v.uz' });
  const { booking, payment } = core.insertOrder(o, { sandbox: false });
  const total = core.usd(booking.amount_c);
  ok(booking.status === 'awaiting_payment' && payment.status === 'pending', 'buyurtma "to\'lov kutilmoqda"');
  try { core.setBookingStatus(booking.id, 'confirmed', mgr); ok(false, 'to\'lovsiz tasdiqlash rad etilishi kerak'); } catch (e) { ok(e.status === 409, 'to\'lovsiz buyurtmani tasdiqlab bo\'lmaydi'); }
  core.markPaid(payment.id, 'test', core.SYSTEM);
  core.markPaid(payment.id, 'test', core.SYSTEM); // takroriy webhook
  let acc = core.accounting();
  ok(acc.trialBalance.balanced && acc.balanceSheet.check, 'ledger muvozanatda (debet=kredit)');
  ok(acc.incomeStatement.commissionRevenueUsd === core.usd(booking.commission_c), `komissiya daromadi to'g'ri ($${acc.incomeStatement.commissionRevenueUsd})`);
  ok(db.get("SELECT COUNT(*) c FROM ledger WHERE ref_id=? AND account='cash'", payment.id).c === 1, 'takroriy webhook ledger\'ga ikki marta yozmadi (idempotent)');
  const b2 = db.get('SELECT * FROM bookings WHERE id=?', booking.id); ok(!!b2.staff_id === !!db.get("SELECT 1 x FROM staff WHERE role IN ('booking_manager','support_agent') AND active=1"), 'buyurtma xodimga avtomatik biriktirildi');
  db.run('UPDATE bookings SET staff_id=? WHERE id=?', mgr.id, booking.id);
  core.setBookingStatus(booking.id, 'confirmed', mgr);
  // Qaytarish
  const half = Math.round(payment.amount_c / 2);
  const rf = core.requestRefund(payment.id, half, 'Mijoz so\'radi', f1);
  try { core.approveRefund(rf.id, f1); ok(false, 'o\'zi tasdiqlash rad etilishi kerak'); } catch (e) { ok(e.status === 403, 'so\'rovchi o\'zi tasdiqlay olmaydi (maker-checker)'); }
  try { core.requestRefund(payment.id, payment.amount_c, 'ortiqcha', f1); ok(false, 'ortiqcha qaytarish rad etilishi kerak'); } catch (e) { ok(e.status === 409, 'qolgan summadan ortiq qaytarib bo\'lmaydi (ochiq so\'rovlar hisobga olinadi)'); }
  try { core.processRefund(rf.id, core.staffActor(f2)); ok(false, 'tasdiqsiz bajarish rad etilishi kerak'); } catch (e) { ok(e.status === 409, 'tasdiqlanmagan qaytarishni bajarib bo\'lmaydi'); }
  core.approveRefund(rf.id, f2);
  core.processRefund(rf.id, core.staffActor(f2), { providerRef: 'TX123' });
  try { core.processRefund(rf.id, core.staffActor(f2)); ok(false, 'ikki marta bajarish rad etilishi kerak'); } catch (e) { ok(e.status === 409, 'qaytarishni ikki marta bajarib bo\'lmaydi'); }
  acc = core.accounting();
  ok(acc.trialBalance.balanced && acc.balanceSheet.check, 'qaytarishdan keyin ham ledger muvozanatda');
  ok(core.accounting().incomeStatement.refundsUsd === core.usd(half), 'qaytarilgan summa hisobotda');
  const pay2 = db.get('SELECT * FROM payments WHERE id=?', payment.id); ok(pay2.status === 'partially_refunded' && pay2.refunded_c === half, 'to\'lov "qisman qaytarilgan"');
  ok(sec.verifyAuditChain().ok, 'audit zanjiri butun');
  // Super admin o'zi tasdiqlash: sozlama o'chiq bo'lsa rad
  const rf2 = core.requestRefund(payment.id, payment.amount_c - half, 'qolgani', sa);
  try { core.approveRefund(rf2.id, sa, { selfApprove: false }); ok(false, 'super admin ham o\'zi tasdiqlamasin'); } catch (e) { ok(e.status === 403, 'super admin ham (sozlamasiz) o\'zi tasdiqlay olmaydi'); }
  core.rejectRefund(rf2.id, f2, 'kerak emas');
  // Gid to'lovi
  const pb = core.payables().find(p => p.party === g.id);
  ok(pb && pb.balanceUsd > 0, `gid ulushi majburiyat sifatida ko'rinadi ($${pb && pb.balanceUsd})`);
  try { core.createPayout(g.id, core.toC(pb.balanceUsd), {}, f1); ok(false, 'yakunlanmagan tur ulushi to\'lanmasin'); } catch (e) { ok(e.status === 409, 'tur yakunlanmaguncha gid ulushi ushlab turiladi'); }
  core.setBookingStatus(booking.id, 'completed', mgr);
  const pb2 = core.payables().find(p => p.party === g.id); ok(pb2.eligibleUsd > 0, 'tur yakunlangach gidga to\'lash mumkin');
  core.createPayout(g.id, core.toC(pb2.eligibleUsd), { method: 'bank', reference: 'PO-1' }, f1);
  core.addExpense({ category: 'marketing', description: 'Reklama', amountC: 1000, spentAt: '2030-01-01' }, f1);
  acc = core.accounting();
  ok(acc.trialBalance.balanced && acc.balanceSheet.check, 'to\'lov va xarajatdan keyin ham muvozanatda');
  // Mijoz bekor qilishi
  const o2 = core.prepareOrder(null, { provider: 'click', guideId: g.id, days: 1, travelDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), customerName: 'Vali', contact: 'v@v.uz' });
  const r2 = core.insertOrder(o2, { sandbox: false }); core.markPaid(r2.payment.id, 't', core.SYSTEM);
  const uid = db.uid('usr_'); db.run('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)', uid, 'V', 'v@x.uz', 'x', db.now()); db.run('UPDATE bookings SET user_id=? WHERE id=?', uid, r2.booking.id);
  const cr = core.cancelByCustomer(db.get('SELECT * FROM users WHERE id=?', uid), r2.booking.id);
  ok(cr.refundPct === 100 && cr.refund && cr.refund.amount_c === r2.payment.amount_c, '10 kun oldin bekor → 100% qaytarish so\'rovi (xodim tasdiqlaydi)');
  const perf = core.staffPerformance().find(x => x.id === mgr.id); ok(perf && perf.assigned >= 1 && perf.confirmed >= 1, 'xodim samaradorligi hisoblanadi (biriktirilgan/tasdiqlangan)');
}
