'use strict';
// Faqat ko'rish uchun: namunaviy ma'lumot bilan fayl bazasi yaratadi (DB_PATH ni belgilang). Productionda ishlatmang.
const db = require('../lib/db'), sec = require('../lib/security'), core = require('../lib/core');
(async () => {
  db.seedSampleGuides();
  const mk = async (name, email, role, pw = 'Demo-Passw0rd!!') => { const id = db.uid('st_'); db.run('INSERT INTO staff(id,name,email,role,password_hash,created_at) VALUES(?,?,?,?,?,?)', id, name, email, role, await sec.hashPassword(pw), db.now()); return db.get('SELECT * FROM staff WHERE id=?', id); };
  const sa = await mk('Bosh administrator', 'boss@manzil.test', 'super_admin');
  const m1 = await mk('Dilnoza Karimova', 'dilnoza@manzil.test', 'booking_manager'), m2 = await mk('Jasur Orifov', 'jasur@manzil.test', 'support_agent'), f = await mk('Malika Yusupova', 'malika@manzil.test', 'finance_manager');
  const guides = db.all("SELECT * FROM guides WHERE status='approved'");
  const names = ['Ali Valiyev', 'Sevara N.', 'John Smith', 'Aziza R.', 'Bobur T.', 'Madina K.', 'Sardor U.', 'Lola H.'];
  for (let i = 0; i < 26; i++) {
    const g = guides[i % guides.length], u = await sec.hashPassword('Tourist-pass-1');
    const o = core.prepareOrder(null, { provider: 'click', guideId: g.id, days: 1 + i % 3, people: 1 + i % 4, travelDate: new Date(Date.now() + (5 + i) * 864e5).toISOString().slice(0, 10), customerName: names[i % names.length], contact: `+99890${1000000 + i * 137}` });
    const { booking, payment } = core.insertOrder(o, { sandbox: false });
    const back = (25 - i) * 864e5 * 1.1; const t = new Date(Date.now() - back).toISOString();
    db.run('UPDATE bookings SET created_at=? WHERE id=?', t, booking.id);
    if (i % 7 === 6) continue; // to'lanmagan
    core.markPaid(payment.id, 'demo', core.SYSTEM); db.run('UPDATE payments SET paid_at=? WHERE id=?', t, payment.id);
    const st = i % 2 ? m1 : m2; core.assignStaff(booking.id, st.id, core.SYSTEM);
    db.run('UPDATE bookings SET assigned_at=? WHERE id=?', t, booking.id);
    if (i % 4 !== 3) { core.setBookingStatus(booking.id, 'confirmed', st); db.run('UPDATE bookings SET assigned_at=?, confirmed_at=? WHERE id=?', t, new Date(Date.parse(t) + (20 + i * 7) * 60000).toISOString(), booking.id); }
    if (i % 4 === 0) { core.setBookingStatus(booking.id, 'completed', st); const uid = db.uid('usr_'); db.run('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)', uid, names[i % 8], `demo${i}@x.uz`, u, t); db.run('INSERT INTO user_data(user_id) VALUES(?)', uid); db.run('UPDATE bookings SET user_id=? WHERE id=?', uid, booking.id); core.addReview(db.get('SELECT * FROM users WHERE id=?', uid), booking.id, { rating: 4 + (i % 2), serviceRating: 5, comment: ['Juda yaxshi xizmat!', 'Tez javob berishdi', 'Gid a\'lo darajada edi'][i % 3] }); }
  }
  const p = db.get("SELECT * FROM payments WHERE status='paid' LIMIT 1"); core.requestRefund(p.id, Math.round(p.amount_c / 2), 'Mijoz sanani o\'zgartirdi', f);
  core.addExpense({ category: 'marketing', description: 'Instagram reklama', amountC: 12000, spentAt: new Date().toISOString().slice(0, 10) }, f);
  core.addExpense({ category: 'hosting', description: 'Render', amountC: 2500, spentAt: new Date().toISOString().slice(0, 10) }, f);
  db.raw.exec("UPDATE reviews SET created_at=created_at");
  console.log('seed ok');
})();
