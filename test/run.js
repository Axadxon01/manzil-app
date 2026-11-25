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
  await v33Flow();
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


// ---- v3.3: gid platformasi (login/parol bot orqali, 2 bosqichli kirish), bank o'tkazmasi, chekni AI bilan tekshirish ----
async function v33Flow() {
  const http = require('http');
  console.log('\n[Chek tahlili: summa, niqoblangan karta, sana]');
  const R = require('../lib/receipts')._test;
  ok(R.parseAmount('1 250 000,00') === 1250000 && R.parseAmount('1,250,000.50') === 1250000.5 && R.parseAmount('250.000') === 250000 && R.parseAmount("1'250'000 so'm") === 1250000 && R.parseAmount(99.5) === 99.5 && R.parseAmount('abc') === null, 'summa formatlari to\'g\'ri o\'qiladi');
  ok(R.normCurrency("so'm") === 'UZS' && R.normCurrency('СУМ') === 'UZS' && R.normCurrency('$') === 'USD' && R.normCurrency('UZS') === 'UZS', 'valyuta nomlari');
  ok(R.maskMatches('8600 12** **** 9012', '8600 1234 5678 9012') === true && R.maskMatches('**** 1111', '8600123456789012') === false && R.maskMatches('20208000900123456001', '20208000900123456001') === true && R.maskMatches('AKHADKHON', '8600123456789012') === null, 'niqoblangan karta va hisob raqami solishtiriladi');
  const w = R.parseWhen('25.11.2026 14:32'); ok(w && !w.dateOnly && new Date(w.t).toISOString() === '2026-11-25T09:32:00.000Z', 'chek sanasi Toshkent vaqti bo\'yicha o\'qiladi');
  ok(R.normTxn('TXN-77 88/99') === 'TXN778899' && R.normTxn('12') === null, 'tranzaksiya raqami normallashtiriladi');

  const P4 = PORT + 1300, B4 = `http://localhost:${P4}`, TGP = PORT + 1350, AIP = PORT + 1360;
  const sent = [], deleted = []; let msgId = 500;
  const jpg = tag => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('fake-receipt-' + tag)]);
  const JPEG = jpg('a'), JPEG2 = jpg('b'), JPEG3 = jpg('c'), JPEG4 = jpg('d'), JPEG_TG = jpg('telegram');
  const tg = http.createServer((q, s) => {
    if (q.method === 'GET' && q.url.includes('/file/bot')) { s.setHeader('Content-Type', 'image/jpeg'); return s.end(JPEG_TG); }
    let d = ''; q.on('data', c => d += c); q.on('end', () => {
      const m = q.url.split('/').pop(); let body = {}; try { body = JSON.parse(d); } catch (_) {}
      let result = true;
      if (m === 'getMe') result = { id: 1, username: 'manzil_test_bot' };
      if (m === 'sendMessage') { sent.push({ ...body, message_id: ++msgId }); result = { message_id: msgId }; }
      if (m === 'deleteMessage') deleted.push(body);
      if (m === 'getFile') result = { file_id: body.file_id, file_path: 'photos/receipt.jpg', file_size: JPEG_TG.length };
      s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ ok: true, result }));
    });
  });
  let aiNext = null; const aiReqs = [];
  const ai = http.createServer((q, s) => { let d = ''; q.on('data', c => d += c); q.on('end', () => {
    aiReqs.push({ url: q.url, key: q.headers['x-goog-api-key'], body: d }); s.setHeader('Content-Type', 'application/json');
    if (aiNext === 'ERR') { s.statusCode = 500; return s.end(JSON.stringify({ error: { message: 'boom' } })); }
    s.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(aiNext) + '\n```' }] } }] }));
  }); });
  await new Promise(r => tg.listen(TGP, r)); await new Promise(r => ai.listen(AIP, r));
  const ENV = { TELEGRAM_BOT_TOKEN: '1:TEST', TELEGRAM_API_BASE: `http://localhost:${TGP}`, TELEGRAM_WEBHOOK_SECRET: 'wh33', PUBLIC_URL: B4, GEMINI_API_KEY: 'gem-test', GEMINI_API_BASE: `http://localhost:${AIP}`,
    OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GUIDE_CREDS_TTL_MS: '1200', BOT_AUTODELETE_TICK_MS: '300', BOT_REMINDERS: 'false' };
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: P4, DB_PATH: ':memory:', DEMO_PAYMENTS: 'false', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ...ENV }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 3000));
  let ip = '10.0.0.1';
  const c = async (jar, method, p, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const r = await fetch(B4 + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': isBuf ? 'image/jpeg' : 'application/json' } : {}), ...(jar ? { Cookie: jar.h } : {}), 'True-Client-IP': ip, ...headers }, body: isBuf ? body : body !== undefined ? JSON.stringify(body) : undefined });
    if (jar) jar.set(r); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; } return { s: r.status, ...j, _h: r.headers };
  };
  const W = { 'X-Telegram-Bot-Api-Secret-Token': 'wh33' };
  const say = (chat, text, from = {}, extra = {}) => c(null, 'POST', '/api/telegram/webhook', { update_id: Date.now(), message: { message_id: 1, date: 1, text, chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'X', language_code: 'uz', ...from }, ...extra } }, W);
  const tap = (chat, data) => c(null, 'POST', '/api/telegram/webhook', { update_id: Date.now(), callback_query: { id: 'cq' + Math.random(), data, from: { id: chat }, message: { message_id: 7, chat: { id: chat, type: 'private' } } } }, W);
  const wait = (ms = 400) => new Promise(r => setTimeout(r, ms));
  const lastTo = (chat, re, from = 0) => sent.slice(from).filter(m => String(m.chat_id) === String(chat) && (!re || re.test(m.text))).pop();
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(150); } return null; };
  const credsOf = m => ({ login: ((m && m.text.match(/Login: <code>([^<]+)<\/code>/)) || [])[1], pass: ((m && m.text.match(/Parol: <code>([^<]+)<\/code>/)) || [])[1] });
  const codeOf = m => ((m && m.text.match(/<code>(\d{6})<\/code>/)) || [])[1];
  const dayN = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  try {
    const boss = new Jar(), g1 = new Jar(), g1b = new Jar(), tour = new Jar(), anon = new Jar();
    await c(boss, 'POST', '/api/staff/login', ADMIN);
    await c(boss, 'POST', '/api/staff/password', { current: ADMIN.password, password: ADMIN2 });
    await c(boss, 'POST', '/api/staff/login', { email: ADMIN.email, password: ADMIN2 });

    console.log('\n[Gid platformasi: login va parol faqat bot orqali]');
    let h = await fetch(B4 + '/guide'); ok(h.status === 200 && /text\/html/.test(h.headers.get('content-type')) && (await h.text()).includes('Manzil'), '/guide sahifasi ochiladi');
    await say(801, '/start', { username: 'Dilnoza_Gid' }); await wait();
    let r = await c(anon, 'POST', '/api/guides/apply', { name: 'Dilnoza Karimova', city: 'Samarqand', dest: 'samarkand', tg: 'dilnoza_gid', rate: 45, gender: 'female', langs: 'uz,ru,en' });
    const gid1 = r.id;
    ok(!sent.some(m => String(m.chat_id) === '801' && /Login:/.test(m.text)), 'tasdiqlanmagan gidga kirish ma\'lumotlari yuborilmaydi');
    r = await c(boss, 'POST', `/api/admin/guides/${gid1}/status`, { status: 'approved', verified: true });
    ok(r.s === 200 && r.access && r.access.exists && !!r.access.login, `tasdiqlanganda gid hisobi yaratildi (login: ${r.access && r.access.login})`);
    const cred = await until(() => lastTo(801, /Login: <code>/));
    ok(!!cred && cred.parse_mode === 'HTML', 'login va parol gidning o\'z Telegram chatiga keldi (arizadagi username bo\'yicha)');
    const C1 = credsOf(cred);
    ok(/^[a-z]{3,12}\d{3}$/.test(C1.login || '') && /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(C1.pass || ''), `login o'qishga oson (${C1.login}), parol kuchli (12 belgi)`);
    const adm = await c(boss, 'GET', '/api/admin/guides');
    ok(adm.guides.find(x => x.id === gid1).access.linked && !JSON.stringify(adm).includes(C1.pass), 'admin panelda parol ko\'rinmaydi (faqat holat)');
    const dbv = await c(boss, 'GET', '/api/admin/db/guide_accounts'); ok(dbv.s === 200 && !JSON.stringify(dbv).includes(C1.pass) && JSON.stringify(dbv).includes('scrypt xesh'), 'bazada faqat parol xeshi (yashirin)');
    ok(!!(await until(() => deleted.some(d => String(d.chat_id) === '801' && d.message_id === cred.message_id), 6000)), 'parol xabari belgilangan vaqtdan keyin botdan o\'chirildi');

    console.log('\n[Gid platformasi: 2 bosqichli kirish va "Bu men emasman"]');
    ip = '10.0.1.1';
    r = await c(g1, 'POST', '/api/gp/login', { login: C1.login, password: 'wrong-pass-1' }); ok(r.s === 401, 'noto\'g\'ri parol → 401');
    r = await c(g1, 'POST', '/api/gp/login', { login: C1.login.toUpperCase(), password: C1.pass }); ok(r.s === 200 && r.need2fa && !!r.challenge, 'to\'g\'ri parol → Telegram kodi so\'raladi');
    const codeMsg = await until(() => lastTo(801, /<code>\d{6}<\/code>/));
    ok(!!codeOf(codeMsg) && JSON.stringify(codeMsg.reply_markup).includes('gx:' + r.challenge), 'kod botga keldi ("Bu men emasman" tugmasi bilan)');
    let v = await c(g1, 'POST', '/api/gp/login/verify', { challenge: r.challenge, code: '000000' }); ok(v.s === 400, 'noto\'g\'ri kod → 400');
    v = await c(g1, 'POST', '/api/gp/login/verify', { challenge: r.challenge, code: codeOf(codeMsg), remember: true }); ok(v.s === 200 && !!g1.c.mz_guide && !!g1.c.mz_gdev, 'to\'g\'ri kod → kirildi (sessiya + ishonchli qurilma)');
    ok(/SameSite=Strict/i.test(v._h.getSetCookie().join(';')) && /HttpOnly/i.test(v._h.getSetCookie().join(';')), 'gid cookie HttpOnly, SameSite=Strict');
    v = await c(g1, 'POST', '/api/gp/login/verify', { challenge: r.challenge, code: codeOf(codeMsg) }); ok(v.s === 400, 'kod ikkinchi marta ishlamaydi');
    ok(!!(await until(() => deleted.some(d => d.message_id === codeMsg.message_id))), 'ishlatilgan kod xabari chatdan o\'chirildi');
    ok(!!(await until(() => lastTo(801, /kirildi/))), 'yangi qurilmadan kirish haqida botga xabar keldi');
    let me = await c(g1, 'GET', '/api/gp/me'); ok(me.s === 200 && me.guide.login === C1.login && me.guide.name === 'Dilnoza Karimova', 'gid platformasi: /api/gp/me');
    r = await c(anon, 'GET', '/api/gp/me'); ok(r.s === 401, 'kirishsiz → 401');
    await c(g1, 'POST', '/api/gp/logout', {});
    r = await c(g1, 'POST', '/api/gp/login', { login: C1.login, password: C1.pass }); ok(r.s === 200 && !r.need2fa, 'eslab qolingan qurilmada kod so\'ralmaydi');
    ip = '10.0.1.2';
    r = await c(g1b, 'POST', '/api/gp/login', { login: C1.login, password: C1.pass }); ok(r.s === 200 && r.need2fa, 'boshqa qurilmada yana kod so\'raladi');
    let from = sent.length;
    await tap(801, 'gx:' + r.challenge); await wait(900);
    r = await c(g1, 'GET', '/api/gp/me'); ok(r.s === 401, '"Bu men emasman" → barcha sessiyalar yopildi');
    const cred2 = await until(() => lastTo(801, /Login: <code>/, from));
    const C2 = credsOf(cred2); ok(!!C2.pass && C2.pass !== C1.pass, 'parol avtomatik almashtirildi, yangisi botga keldi');
    ip = '10.0.1.3';
    r = await c(g1b, 'POST', '/api/gp/login', { login: C1.login, password: C1.pass }); ok(r.s === 401, 'eski parol endi ishlamaydi');
    from = sent.length;
    r = await c(g1, 'POST', '/api/gp/login', { login: C1.login, password: C2.pass }); ok(r.s === 200 && r.need2fa, 'yangi parol ishlaydi; ishonchli qurilmalar ham bekor (kod so\'raladi)');
    v = await c(g1, 'POST', '/api/gp/login/verify', { challenge: r.challenge, code: codeOf(await until(() => lastTo(801, /<code>\d{6}<\/code>/, from))) }); ok(v.s === 200, 'yangi parol + kod bilan kirildi');
    ip = '10.0.1.4'; from = sent.length;
    r = await c(anon, 'POST', '/api/gp/forgot', { login: C1.login }); const r2 = await c(anon, 'POST', '/api/gp/forgot', { login: 'nobody000' });
    ok(r.s === 200 && r2.s === 200, '"Parolni unutdim": mavjud va mavjud bo\'lmagan login uchun bir xil javob');
    const fm = await until(() => sent.slice(from).find(m => String(m.chat_id) === '801' && JSON.stringify(m.reply_markup || {}).includes('"gp"')));
    me = await c(g1, 'GET', '/api/gp/me');
    ok(!!fm && !sent.slice(from).some(m => /Login: <code>/.test(m.text)) && me.s === 200, '"Parolni unutdim" parolni darhol almashtirmaydi (botda tasdiqlash tugmasi) — begona odam gidni chiqarib yubora olmaydi');
    await say(801, '/gid'); ok(!!(await until(() => lastTo(801, /gid menyusi/))), 'botda /gid — gid menyusi');
    await say(899, '/gid', { username: 'random_user' }); ok(!!(await until(() => lastTo(899, /ulanmagan/))), 'gid bo\'lmagan foydalanuvchiga /gid hech narsa bermaydi');

    console.log('\n[Gid platformasi: admin havolasi, bloklash, to\'xtatish]');
    r = await c(anon, 'POST', '/api/guides/apply', { name: 'Bobur Aliyev', city: 'Buxoro', dest: 'bukhara', tg: 'bobur_real', rate: 40, gender: 'male' });
    const gid2 = r.id;
    await c(boss, 'POST', `/api/admin/guides/${gid2}/status`, { status: 'approved' });
    r = await c(boss, 'POST', `/api/admin/guides/${gid2}/access/link`, {});
    ok(r.s === 200 && /^https:\/\/t\.me\/manzil_test_bot\?start=g_[A-Za-z0-9_-]{20,}$/.test(r.url || ''), 'admin bir martalik Telegram havolasini oldi');
    const tok = r.url.split('start=')[1];
    await say(802, '/start ' + tok, { username: 'boshqa_nom' });
    const C3 = credsOf(await until(() => lastTo(802, /Login: <code>/))); ok(!!C3.pass, 'havola orqali ulangan gidga login va parol keldi');
    await say(803, '/start ' + tok); ok(!!(await until(() => lastTo(803, /eskirgan/))), 'havola ikkinchi marta ishlamaydi');
    await c(boss, 'POST', `/api/admin/guides/${gid2}/access/block`, { blocked: true });
    ip = '10.0.4.1'; r = await c(anon, 'POST', '/api/gp/login', { login: C3.login, password: C3.pass }); ok(r.s === 403, 'bloklangan gid kira olmaydi');
    await c(boss, 'POST', `/api/admin/guides/${gid2}/access/block`, { blocked: false });
    r = await c(anon, 'POST', '/api/gp/login', { login: C3.login, password: C3.pass }); ok(r.s === 200 && r.need2fa, 'blokdan chiqarilgach kira oladi');
    for (let i = 0; i < 5; i++) { ip = '10.0.5.' + i; await c(anon, 'POST', '/api/gp/login', { login: C3.login, password: 'bad-pass-' + i }); }
    ip = '10.0.5.9'; r = await c(anon, 'POST', '/api/gp/login', { login: C3.login, password: C3.pass }); ok(r.s === 423, '5 marta xato parol → hisob bloklandi (IP almashtirish yordam bermaydi)');
    ok(!!(await until(() => lastTo(802, /5 marta/))), 'gidga bloklash haqida ogohlantirish keldi');
    const sample = (await c(boss, 'GET', '/api/admin/guides')).guides.find(x => x.sample);
    r = await c(boss, 'POST', `/api/admin/guides/${sample.id}/access/link`, {}); ok(r.s === 409, 'namunaviy gidga kirish berilmaydi');

    console.log('\n[Bank o\'tkazmasi va chekni AI bilan tekshirish]');
    ip = '10.0.6.1';
    r = await c(anon, 'GET', '/api/payments/methods'); ok(r.methods && r.methods.bank === false, 'rekvizitlar kiritilmaguncha bank o\'tkazmasi o\'chiq');
    await c(tour, 'POST', '/api/auth/register', { name: 'Ali Valiyev', email: 'ali33@test.uz', password: 'Tourist-pass-33' });
    r = await c(tour, 'POST', '/api/payments/create', { provider: 'bank', guideId: gid1, days: 2, people: 2, travelDate: dayN(30), customerName: 'Ali', contact: '+998901112233' }); ok(r.s === 503, 'rekvizitsiz bank buyurtmasi rad etildi');
    r = await c(boss, 'POST', '/api/admin/settings', { bank_account: '2020800090012345600' }); ok(r.s === 400, '19 xonali hisob raqami rad etildi');
    r = await c(boss, 'POST', '/api/admin/settings', { bank_recipient: 'MANZIL TRAVEL MCHJ', bank_name: 'Kapitalbank', bank_account: '2020 8000 9001 2345 6001', bank_mfo: '01088', bank_inn: '305123456', bank_card: '8600123456789012', bank_card_holder: 'AKHADKHON M' });
    ok(r.s === 200, 'bank rekvizitlari saqlandi');
    r = await c(anon, 'GET', '/api/payments/methods'); ok(r.methods.bank === true, 'bank o\'tkazmasi yoqildi');
    r = await c(tour, 'POST', '/api/me/telegram-link', {}); await say(901, '/start ' + r.url.split('start=')[1]); await wait();
    const bk1 = await c(tour, 'POST', '/api/payments/create', { provider: 'bank', guideId: gid1, days: 2, people: 2, travelDate: dayN(30), customerName: 'Ali Valiyev', contact: '+998901112233' });
    ok(bk1.s === 200 && bk1.bankTransfer && bk1.bankTransfer.amountUzs === bk1.amountUzs && bk1.bankTransfer.purpose.includes(bk1.code) && bk1.bankTransfer.bank.account === '20208000900123456001', 'bron: rekvizitlar, so\'mdagi summa va to\'lov maqsadi (bron kodi)');
    r = await c(tour, 'POST', `/api/my/bookings/${bk1.bookingId}/receipt`, Buffer.from('hello, this is not an image')); ok(r.s === 415, 'rasm/PDF bo\'lmagan fayl rad etildi (turi baytlardan aniqlanadi)');
    r = await c(tour, 'POST', `/api/my/bookings/${bk1.bookingId}/receipt`, Buffer.concat([JPEG, Buffer.alloc(Math.round(6.2 * 1024 * 1024))])); ok(r.s === 413, '6 MB dan katta fayl rad etildi');
    r = await c(anon, 'POST', `/api/my/bookings/${bk1.bookingId}/receipt`, JPEG); ok(r.s === 401, 'kirishsiz chek yuklab bo\'lmaydi');
    const nowTk = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 19);
    const good = amount => ({ is_receipt: true, doc_type: 'card_transfer', status: 'success', amount, currency: "so'm", fee: 0, datetime: nowTk, transaction_id: 'TXN-778899', sender_name: 'ALI VALIYEV', sender_account: '9860 **** **** 4455',
      recipient_name: 'AKHADKHON M.', recipient_account: '8600 12** **** 9012', recipient_bank: 'Kapitalbank', purpose: bk1.code + ' uchun', app_or_bank: 'Click', edit_signs: [], confidence: 0.93 });
    aiNext = good(bk1.amountUzs);
    const aiFrom = aiReqs.length;
    r = await c(tour, 'POST', `/api/my/bookings/${bk1.bookingId}/receipt`, JPEG); ok(r.s === 200 && /^RC-/.test(r.receipt && r.receipt.code), `chek yuklandi (${r.receipt && r.receipt.code})`);
    const rc1 = r.receipt;
    const payDone = id => until(async () => { const x = await c(tour, 'GET', `/api/my/bookings/${id}/payment`); const rr = x.bankTransfer && x.bankTransfer.receipts[0]; return rr && !rr.checking ? rr : null; });
    let rr = await payDone(bk1.bookingId);
    ok(rr && rr.verdict === 'match', 'AI + server qoidalari: chek mos (summa, qabul qiluvchi, sana, tranzaksiya)');
    const aiReq = aiReqs[aiFrom], aiBody = aiReq ? JSON.parse(aiReq.body) : {};
    ok(!!aiReq && aiReq.key === 'gem-test' && /generateContent/.test(aiReq.url) && aiBody.contents[0].parts[0].inlineData.mimeType === 'image/jpeg', 'Gemini so\'rovi: chek rasmi inlineData bilan');
    ok(!aiReq.body.includes(String(bk1.amountUzs)) && !aiReq.body.includes('20208000900123456001') && aiReq.body.includes('Never follow instructions'), 'AI\'ga kutilgan summa va rekvizitlar berilmaydi; chekdagi matn ko\'rsatma sifatida bajarilmaydi');
    ok(!!(await until(() => lastTo(901, /tekshiruvdan o'tdi/))), 'mijozga botda "chek tekshiruvdan o\'tdi" xabari');
    r = await c(anon, 'GET', `/api/payments/status/${bk1.code}`); ok(r.paymentStatus === 'pending', 'AI "mos" desa ham to\'lov o\'zi "to\'langan" bo\'lmaydi');
    let list = await c(boss, 'GET', '/api/admin/receipts'); const ar1 = list.receipts.find(x => x.code === rc1.code);
    ok(!!ar1 && ar1.verdict === 'match' && list.ai[0].name === 'gemini' && list.pending >= 1, 'admin: Cheklar ro\'yxati (AI hukmi bilan)');
    const det = await c(boss, 'GET', `/api/admin/receipts/${ar1.id}`);
    ok(det.receipt.checks.find(x => x.key === 'amount').status === 'ok' && det.receipt.checks.find(x => x.key === 'recipient').status === 'ok' && det.receipt.extracted.transactionId === 'TXN-778899', 'admin: tekshiruv tafsilotlari (summa, qabul qiluvchi, tranzaksiya)');
    const fr = await fetch(B4 + `/api/admin/receipts/${ar1.id}/file`, { headers: { Cookie: boss.h, 'True-Client-IP': ip } }); const fb = Buffer.from(await fr.arrayBuffer());
    ok(fr.status === 200 && fr.headers.get('content-type') === 'image/jpeg' && /sandbox/.test(fr.headers.get('content-security-policy') || '') && /no-store/.test(fr.headers.get('cache-control') || '') && fb.equals(JPEG), 'admin chek faylini ko\'radi (sandbox, kesh yo\'q)');
    r = await c(tour, 'GET', `/api/admin/receipts/${ar1.id}/file`); ok(r.s === 401, 'mijoz admin chek API ga kira olmaydi');
    r = await c(tour, 'POST', `/api/admin/receipts/${ar1.id}/approve`, {}); ok(r.s === 401, 'mijoz chekni tasdiqlay olmaydi');
    from = sent.length;
    r = await c(boss, 'POST', `/api/admin/receipts/${ar1.id}/approve`, { note: 'Kapitalbank ko\'chirmasida ko\'rildi' }); ok(r.s === 200, 'moliya xodimi pul tushganini ko\'rib tasdiqladi');
    r = await c(anon, 'GET', `/api/payments/status/${bk1.code}`); ok(r.paymentStatus === 'paid' && r.bookingStatus === 'pending', 'to\'lov "to\'langan", bron xodim tasdig\'ini kutmoqda');
    r = await c(boss, 'POST', `/api/admin/receipts/${ar1.id}/approve`, {}); ok(r.s === 409, 'chekni ikki marta tasdiqlab bo\'lmaydi');
    const tour1 = await until(() => lastTo(801, /Yangi tur/, from));
    ok(!!tour1 && tour1.text.includes('Ali Valiyev') && JSON.stringify(tour1.reply_markup).includes('ga:' + bk1.bookingId), 'gidga botda yangi tur haqida xabar ("Qabul qilaman" tugmasi bilan)');
    let gb = await c(g1, 'GET', '/api/gp/bookings'); const gbk = gb.bookings.find(x => x.code === bk1.code);
    ok(!!gbk && gbk.customer && gbk.customer.contact === '+998901112233' && gbk.canAck, 'gid platformasida to\'langan bron va mijoz aloqasi');
    await tap(801, 'ga:' + bk1.bookingId); await wait();
    gb = await c(g1, 'GET', '/api/gp/bookings'); const adB = await c(boss, 'GET', '/api/admin/bookings/' + bk1.bookingId);
    ok(gb.bookings.find(x => x.code === bk1.code).acknowledged && !!adB.booking.guideAckAt, 'gid botdagi tugma bilan turni qabul qildi (adminda ko\'rinadi)');
    me = await c(g1, 'GET', '/api/gp/me'); ok(me.earnings && me.earnings.heldUsd > 0 && me.stats.upcoming === 1, 'gid daromadi: tur yakunlanguncha ushlab turiladi');

    const bk2 = await c(tour, 'POST', '/api/payments/create', { provider: 'bank', guideId: gid1, days: 1, people: 1, travelDate: dayN(40), customerName: 'Ali Valiyev', contact: '+998901112233' });
    from = sent.length;
    r = await c(tour, 'POST', `/api/my/bookings/${bk2.bookingId}/receipt`, JPEG); rr = await payDone(bk2.bookingId);
    ok(rr && rr.verdict === 'mismatch' && rr.problems.includes('duplicate') && rr.problems.includes('txn'), 'boshqa bron cheki (fayl va tranzaksiya raqami) qayta ishlatilsa → mos emas');
    ok(!!(await until(() => lastTo(901, /muammo topildi/, from))), 'mijozga muammo sababi bilan xabar');
    list = await c(boss, 'GET', '/api/admin/receipts'); const ar2 = list.receipts.find(x => x.code === rr.code);
    r = await c(boss, 'POST', `/api/admin/receipts/${ar2.id}/approve`, {}); ok(r.s === 409 && r.needOverride, '"mos emas" chekni oddiy tasdiqlab bo\'lmaydi (izohli "baribir tasdiqlash" kerak)');
    r = await c(boss, 'POST', `/api/admin/receipts/${ar2.id}/reject`, { reason: 'Bu chek boshqa bron uchun ishlatilgan' }); ok(r.s === 200, 'chek rad etildi');
    ok(!!(await until(() => lastTo(901, /rad etildi/))), 'mijozga rad etish sababi botda keldi');
    aiNext = { ...good(1000), transaction_id: 'TXN-1001' };
    await c(tour, 'POST', `/api/my/bookings/${bk2.bookingId}/receipt`, JPEG2); rr = await payDone(bk2.bookingId);
    ok(rr && rr.verdict === 'mismatch' && rr.problems.includes('amount'), 'summa kam → mos emas (sabab: summa)');
    aiNext = { ...good(bk2.amountUzs), transaction_id: 'TXN-1002', recipient_account: '8600 **** **** 1111', recipient_name: 'BOSHQA ODAM' };
    await c(tour, 'POST', `/api/my/bookings/${bk2.bookingId}/receipt`, JPEG3); rr = await payDone(bk2.bookingId);
    ok(rr && rr.verdict === 'mismatch' && rr.problems.includes('recipient'), 'pul boshqa kartaga o\'tkazilgan → mos emas (sabab: qabul qiluvchi)');
    aiNext = 'ERR';
    await c(tour, 'POST', `/api/my/bookings/${bk2.bookingId}/receipt`, JPEG4); rr = await payDone(bk2.bookingId);
    list = await c(boss, 'GET', '/api/admin/receipts'); const ar4 = await c(boss, 'GET', '/api/admin/receipts/' + list.receipts.find(x => x.code === rr.code).id);
    ok(rr.verdict === 'review' && ar4.receipt.aiStatus === 'failed' && /gemini 500/.test(ar4.receipt.aiError), 'AI ishlamasa → "qo\'lda tekshirish kerak" (to\'lov o\'zi tasdiqlanmaydi)');

    const bk3 = await c(tour, 'POST', '/api/payments/create', { provider: 'bank', guideId: gid1, days: 1, people: 1, travelDate: dayN(50), customerName: 'Ali Valiyev', contact: '+998901112233' });
    aiNext = { ...good(bk3.amountUzs), transaction_id: 'TXN-3003', recipient_account: '20208000900123456001', recipient_name: 'MANZIL TRAVEL MCHJ', purpose: bk3.code };
    await tap(901, 'rc:' + bk3.bookingId); ok(!!(await until(() => lastTo(901, /chekini yuboring/))), 'botda "Chek yuborish" — fayl so\'raladi');
    await say(901, '', {}, { photo: [{ file_id: 'small', file_size: 10 }, { file_id: 'big', file_size: 40 }] });
    ok(!!(await until(() => lastTo(901, /Chek qabul qilindi/))), 'botga yuborilgan rasm chek sifatida qabul qilindi');
    rr = await payDone(bk3.bookingId); ok(rr && rr.verdict === 'match', 'bot orqali yuborilgan chek ham tekshirildi (hisob raqami bo\'yicha mos)');
    from = sent.length; await say(901, '/trips');
    const tripMsg = await until(() => sent.slice(from).filter(m => String(m.chat_id) === '901' && /Bank o'tkazmasi/.test(m.text)).pop());
    ok(!!tripMsg && tripMsg.text.includes('20208000900123456001') && tripMsg.text.includes(bk2.code), 'botdagi "Sayohatlarim"da rekvizitlar va to\'lov maqsadi');
    r = await c(boss, 'GET', '/api/admin/audit/verify'); ok(r.ok && r.checked > 10, 'audit zanjiri butun');
    await c(boss, 'POST', `/api/admin/guides/${gid1}/status`, { status: 'suspended' });
    r = await c(g1, 'GET', '/api/gp/me'); ok(r.s === 401, 'to\'xtatilgan gid darhol platformadan chiqadi');
  } catch (e) { fail++; console.log('XATO', e); } finally { srv.kill(); tg.close(); ai.close(); }
}
