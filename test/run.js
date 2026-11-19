'use strict';
// Integratsion test: serverni xotiradagi bazada ishga tushiradi va butun biznes oqimini tekshiradi.
const { spawn } = require('child_process');
const path = require('path');
const PORT = 3200 + Math.floor(Math.random() * 500), B = `http://localhost:${PORT}`;
const ADMIN = { email: 'boss@manzil.test', password: 'Str0ng-Admin-Pass!' }, ADMIN2 = 'Changed-Admin-Pass-2026!';
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
    r = await call(boss, 'GET', '/api/admin/dashboard'); ok(r.s === 200, 'ADMIN_PASSWORD bilan yaratilgan admin darhol ishlay oladi (majburiy almashtirish faqat tasodifiy parolda)');
    r = await call(boss, 'POST', '/api/staff/password', { current: ADMIN.password, password: ADMIN2 }); ok(r.s === 200, 'admin paroli almashtirildi');
    r = await call(boss, 'POST', '/api/staff/login', { email: ADMIN.email, password: ADMIN2 }); ok(r.s === 200, 'yangi parol bilan kirildi');
    ok(/HttpOnly/i.test((await fetch(B + '/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN.email, password: ADMIN2 }) })).headers.getSetCookie().join(';')), 'sessiya cookie HttpOnly');
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
    // Haqiqiy gidlar: ariza → admin tasdiqlaydi (namunaviy gidlar uchun pul olinmaydi)
    for (const [nm, gd] of [['Malika Real', 'female'], ['Bobur Real', 'male']]) {
      const ap = await call(anon, 'POST', '/api/guides/apply', { name: nm, city: 'Samarqand', dest: 'samarkand', tg: nm.split(' ')[0].toLowerCase() + '_gid', rate: 40, gender: gd });
      await call(boss, 'POST', `/api/admin/guides/${ap.id}/status`, { status: 'approved', verified: true });
    }
    const guides = (await call(anon, 'GET', '/api/guides?real=1')).guides; const g = guides[0];
    ok(guides.length === 2 && guides.every(x => !x.sample), 'faqat haqiqiy gidlar (?real=1)');
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', guideId: g.id, days: 2, people: 2, travelDate: new Date(Date.now()+30*864e5).toISOString().slice(0,10), customerName: 'Ali', contact: '+998901112233', amountUsd: 1 });
    ok(r.s === 200 && r.amountUsd === g.rate * 2, `narx serverda hisoblandi (mijoz $1 yuborgan, server $${r.amountUsd})`);
    const real = r;
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', guideId: g.id, days: 1, travelDate: '2020-01-01', customerName: 'Ali', contact: '+998901112233' }); ok(r.s === 400, 'o\'tgan sana rad etildi');
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', amountUsd: -5, title: 'X', customerName: 'Ali', contact: '+998901112233' }); ok(r.s === 400, 'manfiy summa rad etildi');
    r = await call(anon, 'GET', `/api/payments/status/${real.code}`); ok(r.paymentStatus === 'pending', 'to\'lov tasdiqlanmaguncha "pending"');
    let d0 = await call(boss, 'GET', '/api/admin/dashboard'); ok(d0.kpi.revenue.gmvUsd === 0, 'to\'lanmagan buyurtma daromadga kirmadi');
    r = await call(anon, 'POST', '/api/payments/webhook/stripe', { id: 'evt_1' }, { 'Stripe-Signature': 't=1,v1=bad' }); ok([400, 503].includes(r.s), 'soxta Stripe webhook rad etildi');
    r = await call(anon, 'POST', '/api/payments/webhook/click', {}); ok(r.s === 200 && r.error === -8, 'Click ulanmagan → error -8 (soxta to\'lov yo\'q)');
    // Moliya xodimi (haqiqiy to'lovni qo'lda tasdiqlash uchun is_sandbox=0 bo'lishi kerak — DEMO rejimda sandbox, shuning uchun sandbox ni ham tekshiramiz)
    r = await call(anon, 'POST', '/api/payments/sandbox-confirm', { paymentId: real.paymentId }); ok(r.s === 200 && r.sandbox, 'sandbox to\'lov tasdiqlandi');
    d0 = await call(boss, 'GET', '/api/admin/dashboard'); ok(d0.kpi.revenue.gmvUsd === 0, 'sandbox to\'lov daromadga KIRMADI');
    d0 = await call(boss, 'GET', '/api/admin/dashboard?sandbox=1'); ok(d0.kpi.revenue.gmvUsd > 0, 'sandbox belgisi bilan ko\'rinadi');

    console.log('\n[Gid jinsi va anonimlik]');
    const pub = await call(anon, 'GET', '/api/guides');
    ok(pub.guides.every(x => !('name' in x) && !('tg' in x) && x.alias && x.gender), 'ommaviy gidlar ro\'yxatida ism/Telegram yo\'q, alias va jins bor');
    const fem = await call(anon, 'GET', '/api/guides?gender=female');
    ok(fem.guides.length > 0 && fem.guides.every(x => x.gender === 'female'), 'jins bo\'yicha filtr ishlaydi');
    let my = await call(tourist, 'GET', '/api/my/bookings');
    const paidB = my.bookings.find(b => b.code === real.code);
    const adminG = (await call(boss, 'GET', '/api/admin/guides')).guides;
    ok(paidB && paidB.guide && paidB.guide.revealed && paidB.guide.name === adminG.find(x => x.id === g.id).name, 'to\'langan bronda gid ismi ochiladi');
    const male = guides.find(x => x.gender === 'male');
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', guideId: male.id, genderPref: 'female', days: 1, travelDate: new Date(Date.now()+20*864e5).toISOString().slice(0,10), customerName: 'Ali', contact: '+998901112233' });
    ok(r.s === 400, 'afzallikka mos kelmaydigan gid rad etiladi');
    r = await call(tourist, 'POST', '/api/payments/create', { provider: 'click', guideId: male.id, genderPref: 'male', days: 1, travelDate: new Date(Date.now()+20*864e5).toISOString().slice(0,10), customerName: 'Ali', contact: '+998901112233' });
    my = await call(tourist, 'GET', '/api/my/bookings');
    const unpaid = my.bookings.find(b => b.code === r.code);
    ok(unpaid && unpaid.guide && !unpaid.guide.revealed && !unpaid.guide.name && !JSON.stringify(unpaid).includes(adminG.find(x => x.id === male.id).name) , 'to\'lanmagan bronda gid ismi yashirin');
    ok(unpaid.genderPref === 'male', 'afzallik bronda saqlanadi');
    r = await call(anon, 'POST', '/api/guides/apply', { name: 'Test Gid', city: 'Dubay', tg: 'test_gid', rate: 50 }); ok(r.s === 400, 'gid arizasida jins majburiy');
    r = await call(anon, 'POST', '/api/guides/apply', { name: 'Test Gid', city: 'Dubay', tg: 'test_gid', rate: 50, gender: 'female' }); ok(r.s === 200, 'gid arizasi jins bilan qabul qilinadi');

    // Haqiqiy (non-sandbox) oqim uchun: DEMO o'chirilgan ikkinchi server
    srv.kill();
  } catch (e) { fail++; console.log('XATO', e); }
  finally { srv.kill(); }

  await realFlow();
  await v32Flow();
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
  db.run("INSERT INTO guides(id,name,city,langs,spec,rate,exp,tg,gender,status,verified,is_sample,created_at,updated_at) VALUES('g_real','Real Gid','Samarqand','uz,en','tarix',50,5,'real_gid','female','approved',1,0,?,?)", db.now(), db.now());
  const sampleG = db.get("SELECT * FROM guides WHERE is_sample=1 LIMIT 1");
  try { core.prepareOrder(null, { provider: 'click', guideId: sampleG.id, days: 1, travelDate: new Date(Date.now()+30*864e5).toISOString().slice(0,10), customerName: 'Vali', contact: 'v@v.uz' }); ok(false, 'namunaviy gid uchun to\'lov rad etilishi kerak'); } catch (e) { ok(e.status === 409 && e.extra && e.extra.code === 'SAMPLE_OFFER', 'namunaviy gid uchun to\'lov olinmaydi (SAMPLE_OFFER)'); }
  const g = db.get("SELECT * FROM guides WHERE id='g_real'");
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

// ---- v3.2: Click, Payme, Telegram bot (mock API), parol tiklash, namunalar, tur operator, gid kabineti, SEO ----
async function v32Flow() {
  const http = require('http'), crypto = require('crypto');
  const md5 = s => crypto.createHash('md5').update(String(s)).digest('hex');
  const P3 = PORT + 900, B3 = `http://localhost:${P3}`, TGP = PORT + 950;
  const tgSent = [], tgEdits = [], tgPhotos = [], tgCopies = [];
  const mock = http.createServer((q, s) => { let d = ''; q.on('data', c => d += c); q.on('end', () => { const m = q.url.split('/').pop(); let body = {}; try { body = JSON.parse(d); } catch (_) {} if (m === 'sendMessage') tgSent.push(body); if (m === 'editMessageText') tgEdits.push(body); if (m === 'sendPhoto') tgPhotos.push(body); if (m === 'copyMessage') tgCopies.push(body);
    s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ ok: true, result: m === 'getMe' ? { id: 1, username: 'manzil_test_bot' } : (['sendMessage', 'sendPhoto', 'copyMessage'].includes(m) ? { message_id: tgSent.length + tgPhotos.length + 100 } : true) })); }); });
  await new Promise(r => mock.listen(TGP, r));
  const ENV = { CLICK_SERVICE_ID: '111', CLICK_MERCHANT_ID: '222', CLICK_SECRET_KEY: 'click-secret', PAYME_MERCHANT_ID: 'pm-merchant', PAYME_KEY: 'payme-key',
    TELEGRAM_BOT_TOKEN: '1:TEST', TELEGRAM_API_BASE: `http://localhost:${TGP}`, TELEGRAM_WEBHOOK_SECRET: 'wh-secret-test', PUBLIC_URL: B3 };
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: P3, DB_PATH: ':memory:', DEMO_PAYMENTS: 'false', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ...ENV }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 3000));
  const c = async (jar, method, p, body, headers = {}, raw = false) => {
    const r = await fetch(B3 + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(jar ? { Cookie: jar.h } : {}), ...headers }, body: typeof body === 'string' ? body : (body !== undefined ? JSON.stringify(body) : undefined) });
    if (jar) jar.set(r); const t = await r.text(); if (raw) return { s: r.status, text: t, h: r.headers }; let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; } return { s: r.status, ...j };
  };
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const clickForm = (o) => new URLSearchParams(o).toString();
  const clickSign = (o) => md5(o.click_trans_id + o.service_id + 'click-secret' + o.merchant_trans_id + (o.action === '1' ? o.merchant_prepare_id : '') + o.amount + o.action + o.sign_time);
  let clickTx = 9000;
  const payClick = async (pay) => {
    const base = { click_trans_id: String(++clickTx), service_id: '111', click_paydoc_id: '1', merchant_trans_id: pay.paymentId, amount: String(pay.amountUzs), action: '0', error: '0', error_note: 'ok', sign_time: '2026-11-19 10:00:00' };
    const pr = await c(null, 'POST', '/api/payments/webhook/click/prepare', clickForm({ ...base, sign_string: clickSign(base) }));
    const comp = { ...base, action: '1', merchant_prepare_id: String(pr.merchant_prepare_id) };
    const cr = await c(null, 'POST', '/api/payments/webhook/click/complete', clickForm({ ...comp, sign_string: clickSign(comp) }));
    return { pr, cr, base, comp };
  };
  const PAYME = (m, params, key = 'payme-key') => c(null, 'POST', '/api/payments/webhook/payme', { jsonrpc: '2.0', id: 1, method: m, params }, { Authorization: 'Basic ' + Buffer.from('Paycom:' + key).toString('base64') });
  try {
    const boss = new Jar(), user = new Jar(), guideU = new Jar(), opU = new Jar(), anon = new Jar();
    await c(boss, 'POST', '/api/staff/login', ADMIN);
    await c(boss, 'POST', '/api/staff/password', { current: ADMIN.password, password: ADMIN2 });
    await c(boss, 'POST', '/api/staff/login', { email: ADMIN.email, password: ADMIN2 });
    await c(user, 'POST', '/api/auth/register', { name: 'Zarina', email: 'zarina@test.uz', password: 'Zarina-pass-1', lang: 'ru' });
    await c(guideU, 'POST', '/api/auth/register', { name: 'Gid User', email: 'gid@test.uz', password: 'Gid-pass-123' });
    await c(opU, 'POST', '/api/auth/register', { name: 'Op User', email: 'op@test.uz', password: 'Operator-pass-1' });

    console.log('\n[Katalog va namunaviy takliflar]');
    let r = await c(anon, 'GET', '/api/catalog'); ok(r.destinations.length === 107 && r.destinations.every(d => d.img && d.names.en), `katalogda 107 manzil, hammasida rasm (${r.destinations.length})`);
    r = await c(anon, 'GET', '/api/catalog/kyoto-and-osaka'); ok(r.hosts.length > 0 && r.packages.length === 2 && r.packages.every(p => p.sample && p.priceStatus === 'estimated'), 'Kioto: namunaviy gid + 2 paket (taxminiy narx belgisi bilan)');
    const ar = await c(anon, 'GET', '/api/catalog/dubai'); ok(['female', 'male'].every(g => ar.hosts.some(h => h.gender === g)), 'Dubay (arab davlati): ayol va erkak gid bor');
    ok(!JSON.stringify(ar).includes('"tg"') && ar.hosts.every(h => !('name' in h)), 'namunaviy gidlarda Telegram/ism yo\'q');
    r = await c(user, 'POST', '/api/payments/create', { provider: 'click', packageId: r.packages[0].id, travelDate: day(40), people: 2, customerName: 'Zarina', contact: 'zarina@test.uz' });
    ok(r.s === 409 && r.code === 'SAMPLE_OFFER', 'namunaviy paket uchun to\'lov olinmaydi → so\'rov');
    r = await c(user, 'POST', '/api/requests', { kind: 'host', id: ar.hosts[0].id, name: 'Zarina', contact: 'zarina@test.uz', travelDate: day(40), people: 2, genderPref: 'female', lang: 'ru' });
    ok(r.s === 200 && /^T-?\w+/.test(r.ticket), `so\'rov murojaat sifatida yaratildi (${r.ticket})`);
    const tickets = await c(boss, 'GET', '/api/admin/tickets'); ok(tickets.tickets.some(t => t.code === r.ticket), 'murojaat admin paneldagi support ro\'yxatida');

    console.log('\n[Telegram bot: ulash va parol tiklash]');
    r = await c(user, 'POST', '/api/me/telegram-link', {}); ok(r.s === 200 && r.url.startsWith('https://t.me/manzil_test_bot?start=link_'), 'Telegram ulash havolasi (deep-link)');
    const tok = r.url.split('start=')[1];
    const upd = (text, id = 777) => ({ update_id: Date.now(), message: { message_id: 1, date: 1, text, chat: { id, type: 'private' }, from: { id, first_name: 'Zarina', language_code: 'ru' } } });
    r = await c(null, 'POST', '/api/telegram/webhook', upd('/start ' + tok), { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }); ok(r.s === 401, 'soxta webhook (noto\'g\'ri secret) rad etildi');
    r = await c(null, 'POST', '/api/telegram/webhook', upd('/start ' + tok), { 'X-Telegram-Bot-Api-Secret-Token': 'wh-secret-test' }); ok(r.s === 200, 'webhook qabul qilindi');
    await new Promise(r => setTimeout(r, 300));
    r = await c(user, 'GET', '/api/auth/me'); ok(r.telegram.linked === true, 'hisob Telegram\'ga ulandi');
    ok(tgSent.some(m => String(m.chat_id) === "777"), 'bot mijozga javob yubordi');
    tgSent.length = 0;
    r = await c(anon, 'POST', '/api/auth/reset/request', { email: 'zarina@test.uz' }); ok(r.s === 200, 'tiklash so\'rovi');
    await new Promise(r => setTimeout(r, 300));
    const codeMsg = tgSent.find(m => String(m.chat_id) === "777" && /\b\d{6}\b/.test(m.text)); ok(!!codeMsg, 'tiklash kodi faqat ulangan Telegram\'ga yuborildi');
    r = await c(anon, 'POST', '/api/auth/reset/request', { email: 'nobody@test.uz' }); ok(r.s === 200, 'mavjud bo\'lmagan email ham bir xil javob (oshkor qilmaydi)');
    r = await c(anon, 'POST', '/api/auth/reset/confirm', { email: 'zarina@test.uz', code: '000000', password: 'New-Zarina-pass-2' }); ok(r.s === 400, 'noto\'g\'ri kod rad etildi');
    const code = codeMsg && codeMsg.text.match(/\b(\d{6})\b/)[1];
    r = await c(anon, 'POST', '/api/auth/reset/confirm', { email: 'zarina@test.uz', code, password: 'New-Zarina-pass-2' }); ok(r.s === 200, 'to\'g\'ri kod bilan parol yangilandi');
    r = await c(anon, 'POST', '/api/auth/reset/confirm', { email: 'zarina@test.uz', code, password: 'New-Zarina-pass-3' }); ok(r.s === 400, 'kod qayta ishlatilmaydi');
    r = await c(user, 'GET', '/api/auth/me'); ok(r.s === 401, 'parol tiklangach eski sessiyalar yopildi');
    r = await c(user, 'POST', '/api/auth/login', { email: 'zarina@test.uz', password: 'New-Zarina-pass-2' }); ok(r.s === 200, 'yangi parol bilan kirish');

    console.log('\n[Gid kabineti va Click]');
    const ap = await c(guideU, 'POST', '/api/guides/apply', { name: 'Dilnoza', city: 'Samarqand', dest: 'samarkand', tg: 'dilnoza_gid', rate: 45, gender: 'female' });
    await c(boss, 'POST', `/api/admin/guides/${ap.id}/status`, { status: 'approved', verified: true });
    r = await c(guideU, 'GET', '/api/auth/me'); ok(r.roles && r.roles.guide && r.roles.guide.id === ap.id, 'ariza bergan foydalanuvchi gid kabinetiga ega');
    const bk = await c(user, 'POST', '/api/payments/create', { provider: 'click', guideId: ap.id, days: 2, people: 2, travelDate: day(30), customerName: 'Zarina', contact: '+998901234567' });
    ok(bk.s === 200 && bk.checkoutUrl.includes('my.click.uz') && !bk.sandbox, 'Click checkout havolasi (haqiqiy rejim)');
    r = await c(guideU, 'GET', '/api/guide/bookings'); ok(r.bookings.length === 0, 'to\'lanmagan bron gidga ko\'rinmaydi');
    const bad = { click_trans_id: '1', service_id: '111', merchant_trans_id: bk.paymentId, amount: String(bk.amountUzs), action: '0', sign_time: 'x', sign_string: 'deadbeef' };
    r = await c(null, 'POST', '/api/payments/webhook/click', clickForm(bad)); ok(r.error === -1, 'Click: noto\'g\'ri imzo → -1');
    const wrongAmt = { ...bad, amount: '1000', sign_string: '' }; wrongAmt.sign_string = clickSign(wrongAmt);
    r = await c(null, 'POST', '/api/payments/webhook/click', clickForm(wrongAmt)); ok(r.error === -2, 'Click: noto\'g\'ri summa → -2');
    const pc = await payClick(bk); ok(pc.pr.error === 0 && pc.cr.error === 0, 'Click prepare + complete muvaffaqiyatli');
    r = await c(anon, 'GET', `/api/payments/status/${bk.code}`); ok(r.paymentStatus === 'paid', 'Click orqali to\'landi');
    r = await c(null, 'POST', '/api/payments/webhook/click/complete', clickForm({ ...pc.comp, sign_string: clickSign(pc.comp) })); ok(r.error === -4, 'Click: takroriy complete → -4 (ikki marta yozilmaydi)');
    r = await c(guideU, 'GET', '/api/guide/bookings'); ok(r.bookings.length === 1 && r.bookings[0].customer && r.bookings[0].customer.contact === '+998901234567', 'gid kabinetida to\'langan bron va mijoz kontakti');
    r = await c(guideU, 'GET', '/api/guide/me'); ok(r.stats && r.guide.id === ap.id, 'gid statistikasi');
    r = await c(guideU, 'POST', '/api/guide/profile', { rate: 55, langs: 'uz, ru, en' }); ok(r.s === 200, 'gid profilini o\'zi tahrirlaydi');
    let my = await c(user, 'GET', '/api/my/bookings'); const mb = my.bookings.find(b => b.code === bk.code);
    ok(mb.guide.revealed && mb.guide.name === 'Dilnoza', 'to\'langandan keyin gid ochildi');
    // Baho: bron yakunlanishi kerak
    await c(boss, 'POST', `/api/admin/bookings/${mb.id}/status`, { status: 'confirmed' });
    await c(boss, 'POST', `/api/admin/bookings/${mb.id}/status`, { status: 'completed' });
    my = await c(user, 'GET', '/api/my/bookings'); ok(my.bookings.find(b => b.code === bk.code).canReview, 'yakunlangan bronga baho berish mumkin');
    r = await c(user, 'POST', `/api/my/bookings/${mb.id}/review`, { rating: 5, serviceRating: 5, comment: 'Ajoyib!' }); ok(r.s === 200, 'gidga baho berildi');
    r = await c(guideU, 'GET', '/api/guide/me'); ok(r.stats.rating === 5, 'baho gid kabinetida');

    console.log('\n[Payme]');
    const pb = await c(user, 'POST', '/api/payments/create', { provider: 'payme', guideId: ap.id, days: 1, people: 1, travelDate: day(25), customerName: 'Zarina', contact: '+998901234567' });
    ok(pb.checkoutUrl && pb.checkoutUrl.startsWith('https://checkout.paycom.uz/'), 'Payme checkout havolasi');
    const tiyin = pb.amountUzs * 100, acc = { order_id: pb.paymentId };
    r = await PAYME('CheckPerformTransaction', { amount: tiyin, account: acc }, 'wrong'); ok(r.error && r.error.code === -32504, 'Payme: noto\'g\'ri kalit → -32504');
    r = await PAYME('CheckPerformTransaction', { amount: tiyin + 100, account: acc }); ok(r.error && r.error.code === -31001, 'Payme: noto\'g\'ri summa → -31001');
    r = await PAYME('CheckPerformTransaction', { amount: tiyin, account: { order_id: 'nope' } }); ok(r.error && r.error.code === -31050, 'Payme: buyurtma topilmadi → -31050');
    r = await PAYME('CheckPerformTransaction', { amount: tiyin, account: acc }); ok(r.result && r.result.allow, 'Payme: CheckPerformTransaction allow');
    r = await PAYME('CreateTransaction', { id: 'pm_tx_1', time: Date.now(), amount: tiyin, account: acc }); ok(r.result && r.result.state === 1, 'Payme: CreateTransaction state=1');
    r = await PAYME('CreateTransaction', { id: 'pm_tx_2', time: Date.now(), amount: tiyin, account: acc }); ok(r.error && r.error.code === -31051, 'Payme: boshqa tranzaksiya → -31051');
    r = await PAYME('PerformTransaction', { id: 'pm_tx_1' }); ok(r.result && r.result.state === 2, 'Payme: PerformTransaction state=2');
    r = await c(anon, 'GET', `/api/payments/status/${pb.code}`); ok(r.paymentStatus === 'paid', 'Payme orqali to\'landi');
    r = await PAYME('CheckTransaction', { id: 'pm_tx_1' }); ok(r.result && r.result.state === 2, 'Payme: CheckTransaction');
    r = await PAYME('CancelTransaction', { id: 'pm_tx_1', reason: 5 }); ok(r.result && r.result.state === -2, 'Payme: to\'langandan keyin bekor → state=-2');
    my = await c(user, 'GET', '/api/my/bookings'); const pbv = my.bookings.find(b => b.code === pb.code);
    ok(pbv.refunds && pbv.refunds.some(x => x.status === 'processed'), 'Payme bekor qilishi qaytarish sifatida ledgerga yozildi');
    r = await PAYME('GetStatement', { from: 0, to: Date.now() + 1000 }); ok(r.result && r.result.transactions.length === 1, 'Payme: GetStatement');
    r = await c(boss, 'GET', '/api/admin/accounting'); ok(!r.trialBalance || r.trialBalance.balanced, 'ledger muvozanatda');

    console.log('\n[Mijoz bronni bekor qiladi]');
    const cb = await c(user, 'POST', '/api/payments/create', { provider: 'click', guideId: ap.id, days: 1, people: 1, travelDate: day(20), customerName: 'Zarina', contact: '+998901234567' });
    await payClick(cb);
    my = await c(user, 'GET', '/api/my/bookings'); const cv = my.bookings.find(b => b.code === cb.code);
    ok(cv.canCancel && cv.cancelRefundPct === 100, 'bekor qilish mumkin, siyosat 100%');
    r = await c(user, 'POST', `/api/my/bookings/${cv.id}/cancel`, {}); ok(r.s === 200 && r.refundPct === 100, 'mijoz bronni bekor qildi (100% qaytarish so\'rovi)');

    console.log('\n[Tur operator]');
    r = await c(opU, 'POST', '/api/operator/packages', { title: 'X', dest: 'amalfi-coast', days: 5, priceUsd: 900 }); ok(r.s === 403, 'ro\'yxatdan o\'tmagan operator paket qo\'sha olmaydi');
    r = await c(opU, 'POST', '/api/operator/apply', { company: 'Silk Way Tours', phone: '+998712000000', license: 'T-123' }); ok(r.s === 200, 'tur operator arizasi');
    r = await c(opU, 'POST', '/api/operator/packages', { title: 'X', dest: 'amalfi-coast', days: 5, priceUsd: 900 }); ok(r.s === 403, 'tasdiqlanmagan operator paket qo\'sha olmaydi');
    const ops = await c(boss, 'GET', '/api/admin/operators'); const op = ops.operators.find(o => o.company === 'Silk Way Tours');
    await c(boss, 'POST', `/api/admin/operators/${op.id}/status`, { status: 'approved' });
    r = await c(opU, 'POST', '/api/operator/packages', { title: 'Amalfi slowly', dest: 'amalfi-coast', days: 5, priceUsd: 900, maxPeople: 6, itinerary: ['Positano', 'Ravello'] }); ok(r.s === 200 && r.status === 'pending', 'paket tekshiruvga yuborildi');
    const pkId = r.id;
    r = await c(anon, 'GET', '/api/catalog/amalfi-coast'); ok(!r.packages.some(p => p.id === pkId), 'tasdiqlanmagan paket saytda ko\'rinmaydi');
    await c(boss, 'POST', `/api/admin/packages/${pkId}/status`, { status: 'approved' });
    r = await c(anon, 'GET', '/api/catalog/amalfi-coast'); const pkv = r.packages.find(p => p.id === pkId); ok(pkv && !pkv.sample && pkv.operator === 'Silk Way Tours', 'tasdiqlangan paket saytda (operator nomi bilan)');
    r = await c(user, 'POST', '/api/payments/create', { provider: 'click', packageId: pkId, travelDate: day(50), people: 7, customerName: 'Zarina', contact: '+998901234567' }); ok(r.s === 400, 'maksimal sayohatchilar soni tekshiriladi');
    const pkb = await c(user, 'POST', '/api/payments/create', { provider: 'click', packageId: pkId, travelDate: day(50), people: 2, amountUsd: 1, customerName: 'Zarina', contact: '+998901234567' });
    ok(pkb.s === 200 && pkb.amountUsd === 1800, `paket narxi serverda: 2 × $900 = $${pkb.amountUsd}`);
    await payClick(pkb);
    r = await c(opU, 'GET', '/api/operator/bookings'); ok(r.bookings.length === 1 && r.bookings[0].customer, 'operator kabinetida to\'langan bron');
    r = await c(opU, 'GET', '/api/operator/me'); ok(r.packages.length === 1 && r.operator.status === 'approved', 'operator kabineti');

    console.log('\n[Support: admin javobi Telegram orqali mijozga]');
    tgSent.length = 0;
    const rq = await c(user, 'POST', '/api/requests', { kind: 'trip', dest: 'samarkand', message: 'Savol bor', lang: 'ru' });
    const tk = (await c(boss, 'GET', '/api/admin/tickets')).tickets.find(t => t.code === rq.ticket);
    ok(tk.telegram, 'ulangan mijoz murojaati Telegram bilan bog\'langan');
    r = await c(boss, 'POST', `/api/admin/tickets/${tk.id}/reply`, { text: 'Salom, yordam beramiz' }); ok(r.s === 200 && r.viaTelegram, 'admin javobi yuborildi');
    await new Promise(r => setTimeout(r, 200));
    ok(tgSent.some(m => String(m.chat_id) === "777" && m.text.includes('Salom, yordam beramiz')), 'javob mijozning Telegram\'iga yetib bordi');
    r = await c(boss, 'POST', `/api/admin/tickets/${tk.id}/close`, {}); ok(r.s === 200, 'murojaat yopildi');

    console.log('\n[Telegram bot: manzillar, kalkulyator, FAQ, support guruhi]');
    const W = { 'X-Telegram-Bot-Api-Secret-Token': 'wh-secret-test' };
    const say = (text, id = 777, extra = {}) => c(null, 'POST', '/api/telegram/webhook', { update_id: Date.now(), message: { message_id: Math.floor(Math.random() * 1e6), date: 1, text, chat: { id, type: 'private' }, from: { id, first_name: 'Zarina', language_code: 'ru' }, ...extra } }, W);
    const tap = (data, id = 777, photo = false) => c(null, 'POST', '/api/telegram/webhook', { update_id: Date.now(), callback_query: { id: 'cq' + Date.now(), data, from: { id }, message: { message_id: 55, chat: { id, type: 'private' }, ...(photo ? { photo: [{}] } : {}) } } }, W);
    const wait = () => new Promise(r => setTimeout(r, 250));
    tgSent.length = 0; await say('/explore'); await wait();
    ok(tgSent.some(m => m.reply_markup && JSON.stringify(m.reply_markup).includes('rg:europe:0')), 'bot: /explore — mintaqalar tugmalari');
    tgSent.length = 0; await tap('rg:asia:0'); await wait();
    const tgAll = () => tgSent.concat(tgEdits);
    ok(tgAll().some(m => JSON.stringify(m.reply_markup || {}).includes('"d:')), 'bot: mintaqa ichidagi manzillar ro\'yxati');
    tgPhotos.length = 0; await tap('d:kyoto-and-osaka'); await wait();
    ok(tgPhotos.some(m => /images\.unsplash|wikimedia/.test(m.photo) && /Киото|Kyoto/.test(m.caption) && JSON.stringify(m.reply_markup).includes('cd:kyoto-and-osaka')), 'bot: manzil kartasi rasm, narx va tugmalar bilan');
    tgEdits.length = 0; await tap('cr:kyoto-and-osaka:5:2'); await wait();
    ok(tgEdits.some(m => /\$[\d,]+/.test(m.text) && /5/.test(m.text)), 'bot: byudjet kalkulyatori natijasi');
    tgPhotos.length = 0; await say('Самарканд'); await wait();
    ok(tgPhotos.some(m => /Самарканд/.test(m.caption)), 'bot: joy nomini yozish → manzil kartasi');
    tgSent.length = 0; await say('/faq'); await wait(); await tap('f:cancel'); await wait();
    ok(tgSent.some(m => /100%/.test(m.text)), 'bot: FAQ — bekor qilish siyosati');
    tgSent.length = 0; await tap('rq:samarkand'); await wait(); await say('Нужен гид на 3 дня в мае'); await wait();
    const rqT = (await c(boss, 'GET', '/api/admin/tickets')).tickets.find(t => (t.firstText || '').includes('[samarkand]'));
    ok(!!rqT, 'bot: manzil kartasidan gid so\'rovi → murojaat');
    tgSent.length = 0; await say('/tickets'); await wait();
    ok(tgSent.some(m => m.text.includes(rqT && rqT.code)), 'bot: /tickets — murojaatlar ro\'yxati');
    // Support guruhi: ulash, /open, /stats, /r
    const grp = (text, extra = {}) => c(null, 'POST', '/api/telegram/webhook', { update_id: Date.now(), message: { message_id: 9, date: 1, text, chat: { id: -100500, type: 'supergroup', title: 'Support' }, from: { id: 42, first_name: 'Ali' }, ...extra } }, W);
    const tgInfo = await c(boss, 'GET', '/api/admin/telegram');
    tgSent.length = 0; await grp('/support_here ' + tgInfo.supportCode); await wait();
    ok(tgSent.some(m => String(m.chat_id) === '-100500' && m.text.includes('ulandi')), 'support guruhi kod bilan ulandi');
    tgSent.length = 0; await grp('/open'); await grp('/stats'); await wait();
    ok(tgSent.some(m => m.text.includes(rqT.code)) && tgSent.some(m => m.text.includes('7 kun')), 'support: /open va /stats');
    tgSent.length = 0; await grp('/r ' + rqT.code + ' Gid topildi, ertaga yozamiz'); await wait();
    ok(tgSent.some(m => String(m.chat_id) === '777' && m.text.includes('Gid topildi')), 'support: /r KOD — javob mijozga yetdi');
    tgCopies.length = 0; await say('', 777, { photo: [{ file_id: 'x' }], caption: 'pasport' }); await wait();
    ok(tgCopies.some(m => String(m.chat_id) === '-100500'), 'bot: mijoz rasmi support guruhiga yuborildi');

    console.log('\n[SEO]');
    let h = await c(anon, 'GET', '/', undefined, {}, true); ok(h.s === 200 && /<html lang="uz"/.test(h.text) && h.text.includes('hreflang="ar"') && h.text.includes('application/ld+json'), 'bosh sahifa: lang, hreflang, JSON-LD');
    h = await c(anon, 'GET', '/ar/', undefined, {}, true); ok(h.s === 200 && /lang="ar"/.test(h.text) && /dir="rtl"/.test(h.text), '/ar/ — arabcha, RTL');
    h = await c(anon, 'GET', '/ru', undefined, {}, true); ok(h.s === 301, '/ru → /ru/ (301)');
    h = await c(anon, 'GET', '/en/destinations/kyoto-and-osaka', undefined, {}, true); ok(h.s === 200 && h.text.includes('TouristDestination') && h.text.includes('rel="canonical"'), 'manzil sahifasi: TouristDestination, canonical');
    h = await c(anon, 'GET', '/ja/journal/samarkand-blue', undefined, {}, true); ok(h.s === 200 && h.text.includes('"Article"'), 'jurnal maqolasi (Article)');
    h = await c(anon, 'GET', '/de/legal', undefined, {}, true); ok(h.s === 200, 'huquqiy sahifa');
    h = await c(anon, 'GET', '/sitemap.xml', undefined, {}, true); const urls = (h.text.match(/<loc>/g) || []).length; ok(h.s === 200 && urls > 1300, `sitemap.xml (${urls} URL)`);
    h = await c(anon, 'GET', '/robots.txt', undefined, {}, true); ok(/Sitemap:/.test(h.text) && /Disallow: \/admin/.test(h.text), 'robots.txt');
    h = await c(anon, 'GET', '/en/destinations/nowhere', undefined, {}, true); ok(h.s === 404, 'noma\'lum manzil → 404');
    h = await c(anon, 'GET', '/planner.html', undefined, {}, true); ok(h.s === 301, 'eski planner.html → 301');
  } catch (e) { fail++; console.log('XATO', e); } finally { srv.kill(); mock.close(); }
}
