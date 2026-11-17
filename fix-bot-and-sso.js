const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (!fs.existsSync('server.js') || !fs.existsSync('public/admin.html')) {
  console.error('XATO: server.js yoki public/admin.html topilmadi!');
  process.exit(1);
}

let srv = fs.readFileSync('server.js', 'utf8');

// 1. Admin SSO endpoint (/api/admin/sso) — Admin paneldan asosiy saytga tayyor JWT token bilan kirish
const ssoEndpoint = `
    // --- ADMIN SSO: ADMIN SIFATIDA ASOSIY SAYTGA KIRISH ---
    if (req.method === 'POST' && pathname === '/api/admin/sso') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) {
        return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      }
      const users = readJson(FILES.users, []);
      let adminUser = users.find(u => u.id === 'admin_master' || u.role === 'admin');
      if (!adminUser) {
        adminUser = {
          id: 'admin_master',
          name: 'Manzil Admin',
          email: 'admin@manzil.uz',
          role: 'admin',
          isAdmin: true,
          plan: [],
          favorites: [],
          createdAt: new Date().toISOString()
        };
        users.unshift(adminUser);
        writeJson(FILES.users, users);
      }
      const token = signToken({ sub: adminUser.id, email: adminUser.email, role: 'admin' });
      return sendJson(res, 200, { ok: true, token, user: adminUser });
    }
`;

if (!srv.includes('/api/admin/sso')) {
  srv = srv.replace('// --- ADMIN: UMUMIY STATISTIKA VA RO\'YXATLAR ---', ssoEndpoint + '\n    // --- ADMIN: UMUMIY STATISTIKA VA RO\'YXATLAR ---');
}

// 2. Xabarlarni qayta ishlashni alohida universal funksiyaga ajratish (ham Webhook, ham Polling uchun)
const universalBotHandler = `
    async function processTelegramUpdate(body) {
      const adminChatId = String(process.env.TELEGRAM_CHAT_ID || '');
      const siteUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\\/+$/, '');

      // A) INLINE TUGMALAR (Tasdiqlash / Rad etish)
      const cb = body && body.callback_query;
      if (cb && cb.data) {
        const fromId = String(cb.from && cb.from.id ? cb.from.id : '');
        if (adminChatId && fromId !== adminChatId) {
          await tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: "Faqat admin uchun ruxsat etilgan!",
            show_alert: true
          });
          return;
        }

        const [action, guideId] = String(cb.data).split(':');
        const guides = readJson(FILES.guides, SEED_GUIDES);
        const guide = guides.find(g => g.id === guideId);
        let toastText = 'Ariza topilmadi';
        let statusTag = '';

        if (guide && (action === 'approve' || action === 'reject')) {
          if (action === 'approve') {
            guide.approved = true;
            guide.rejected = false;
            guide.approvedAt = new Date().toISOString();
            toastText = '✅ Gid tasdiqlandi!';
            statusTag = '\\n\\n✅ <b>HOLAT: TASDIQLANDI</b>';
          } else {
            guide.approved = false;
            guide.rejected = true;
            guide.rejectedAt = new Date().toISOString();
            toastText = '❌ Ariza rad etildi';
            statusTag = '\\n\\n❌ <b>HOLAT: RAD ETILDI</b>';
          }
          writeJson(FILES.guides, guides);
        }

        await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: toastText });
        if (cb.message && cb.message.chat && statusTag) {
          const origText = cb.message.text || '';
          await tgApi('editMessageText', {
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: origText + statusTag,
            parse_mode: 'HTML'
          });
        }
        return;
      }

      // B) XABARLAR VA BUYRUQLAR
      const msg = body && body.message;
      if (msg && msg.chat) {
        const chatId = String(msg.chat.id);
        const text = String(msg.text || '').trim();
        const isOwner = adminChatId && chatId === adminChatId;
        trackBotUser(msg.chat);

        const mainKeyboard = {
          keyboard: [
            [{ text: '🧭 Gidlar katalogi' }, { text: '🛂 Vizasiz davlatlar' }],
            [{ text: "💼 Gid bo‘lish" }, { text: '💬 Operatorga yozish' }]
          ],
          resize_keyboard: true
        };

        if (isOwner && msg.reply_to_message && text && !text.startsWith('/')) {
          const repliedText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
          const idMatch = repliedText.match(/ID:\\s*(\\d+)/);
          if (idMatch && idMatch[1]) {
            const sent = await sendTgTo(idMatch[1], '💬 <b>Manzil Qo‘llab-quvvatlash javobi:</b>\\n\\n' + escHtml(text));
            await sendTgTo(chatId, sent.ok ? '✅ Javobingiz foydalanuvchiga yetkazildi!' : '❌ Xabar yuborilmadi');
            return;
          }
        }

        if (isOwner && text.startsWith('/broadcast ')) {
          const notice = text.slice('/broadcast '.length).trim();
          const subs = readJson(BOT_USERS_FILE, []);
          let sentCount = 0;
          for (const u of subs) {
            if (String(u.id) === adminChatId) continue;
            const r = await sendTgTo(u.id, '📢 <b>Manzil Yangiligi:</b>\\n\\n' + escHtml(notice));
            if (r.ok) sentCount++;
          }
          await sendTgTo(chatId, '📣 E’lon <b>' + sentCount + '</b> ta foydalanuvchiga yuborildi.');
          return;
        }

        if (isOwner && (text === '/admin' || text === '/stats')) {
          const guides = readJson(FILES.guides, SEED_GUIDES);
          const payments = FILES.payments ? readJson(FILES.payments, []) : [];
          const subs = readJson(BOT_USERS_FILE, []);
          const pending = guides.filter(g => g.approved === false && !g.rejected).length;
          const approved = guides.filter(g => g.approved === true).length;
          const paid = payments.filter(p => p.status === 'paid' || p.status === 'completed');
          const gross = paid.reduce((s, p) => s + Number(p.amount || p.totalAmount || 0), 0);
          const comm = Math.round(gross * COMMISSION_RATE * 100) / 100;

          const statMsg = [
            '📊 <b>Manzil Jonli Statistika</b>',
            '',
            '🟡 Kutilayotgan gid arizalari: <b>' + pending + ' ta</b>',
            '🟢 Tasdiqlangan gidlar: <b>' + approved + ' ta</b>',
            '💳 Jami buyurtmalar: <b>' + payments.length + ' ta</b> (To‘langan: ' + paid.length + ')',
            '💰 Umumiy aylanma: <b>$' + gross + '</b>',
            '🏦 Platforma komissiyasi (12%): <b>$' + comm + '</b>',
            '👥 Bot foydalanuvchilari: <b>' + subs.length + ' ta</b>',
            '',
            '⏳ Kutilayotgan arizalarni ko‘rish: /pending'
          ].join('\\n');

          await sendTgTo(chatId, statMsg, {
            reply_markup: {
              inline_keyboard: [[{ text: '🖥 Admin Panelni ochish', url: siteUrl + '/admin' }]]
            }
          });
          return;
        }

        if (isOwner && text === '/pending') {
          const guides = readJson(FILES.guides, SEED_GUIDES);
          const pendingList = guides.filter(g => g.approved === false && !g.rejected);
          if (!pendingList.length) {
            await sendTgTo(chatId, '✅ Hozircha kutilayotgan yangi gid arizalari yo‘q.');
            return;
          }
          for (const g of pendingList) {
            const card = [
              '🟡 <b>Kutilayotgan ariza</b>',
              '🆔 ID: <code>' + escHtml(g.id) + '</code>',
              '👤 Ism: <b>' + escHtml(g.name) + '</b>',
              '📍 Hudud: ' + escHtml(g.city) + ', ' + escHtml(g.country),
              '💰 Stavka: $' + escHtml(g.rate) + '/kun',
              '✈️ Telegram: @' + escHtml(g.tg),
              '📝 Yo‘nalish: ' + escHtml(g.spec)
            ].join('\\n');
            await sendTgTo(chatId, card, {
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Tasdiqlash', callback_data: 'approve:' + g.id },
                  { text: '❌ Rad etish', callback_data: 'reject:' + g.id }
                ]]
              }
            });
          }
          return;
        }

        if (text.startsWith('/start')) {
          const welcome = [
            'Assalomu alaykum, <b>' + escHtml(msg.chat.first_name || 'Sayohatchi') + '</b>! 👋',
            '',
            '<b>Manzil</b> sayohat ekotizimining rasmiy botiga xush kelibsiz.',
            'Pastdagi tugmalardan birini tanlang yoki sayohat bo‘yicha savolingizni yozing:'
          ].join('\\n');
          await sendTgTo(chatId, welcome, {
            reply_markup: { inline_keyboard: [[{ text: '🌐 Manzil Web-ilovasini ochish', url: siteUrl }]] }
          });
          await sendTgTo(chatId, '⬇️ Tezkor menyu faollashtirildi:', { reply_markup: mainKeyboard });
          return;
        }

        if (text === '/guides' || text === '🧭 Gidlar katalogi') {
          const guides = readJson(FILES.guides, SEED_GUIDES).filter(g => g.approved === true);
          const lines = guides.slice(0, 8).map((g, i) =>
            (i + 1) + '. <b>' + escHtml(g.name) + '</b> — ' + escHtml(g.city) + ' ($' + g.rate + '/kun)\\n   🗣 ' + escHtml(g.langs) + ' | ✈️ @' + escHtml(g.tg)
          );
          await sendTgTo(chatId, '🧭 <b>Tasdiqlangan mahalliy gidlar (' + guides.length + ' ta):</b>\\n\\n' + lines.join('\\n\\n'), {
            reply_markup: { inline_keyboard: [[{ text: '🌐 Barcha gidlar va band qilish', url: siteUrl }]] }
          });
          return;
        }

        if (text === '/visa' || text === '🛂 Vizasiz davlatlar') {
          const visaText = [
            '🛂 <b>O‘zbekiston fuqarolari uchun asosiy vizasiz davlatlar:</b>',
            '🇹🇷 Turkiya (90 kun) | 🇬🇪 Gruziya (1 yil) | 🇦🇪 BAA (30 kun)',
            '🇨🇳 Xitoy (30 kun) | 🇹🇭 Tailand (60 kun) | 🇲🇻 Maldiv (30 kun)',
            '🇰🇿 Qozog‘iston (30 kun) | 🇰🇬 Qirg‘iziston (60 kun) | 🇹🇯 Tojikiston (30 kun)'
          ].join('\\n');
          await sendTgTo(chatId, visaText, {
            reply_markup: { inline_keyboard: [[{ text: '🌐 Saytda byudjet hisoblash', url: siteUrl }]] }
          });
          return;
        }

        if (text === '/apply' || text === "💼 Gid bo‘lish") {
          await sendTgTo(chatId, '💼 <b>Gid sifatida qo‘shilish bepul!</b>\\nHar bir buyurtmadan <b>88% daromad</b> sizga qoladi (12% komissiya).', {
            reply_markup: { inline_keyboard: [[{ text: '📝 Gidlikka ariza topshirish', url: siteUrl }]] }
          });
          return;
        }

        if (text === '/support' || text === '💬 Operatorga yozish') {
          await sendTgTo(chatId, '💬 Savolingiz yoki taklifingizni shu yerga yozib yuboring — xabaringiz operatorga yetkaziladi.');
          return;
        }

        if (text) {
          const aiRes = await generateAiReply(text, [], {}, 'auto');
          await sendTgTo(chatId, '🤖 ' + escHtml(aiRes.reply));
          if (!isOwner) {
            const uName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
            const uTag = msg.chat.username ? '@' + msg.chat.username : 'username yo‘q';
            await sendTelegramAdminAction(
              '📩 <b>Botga yangi xabar keldi</b>\\n🆔 ID: <code>' + chatId + '</code>\\n👤 Mijoz: <b>' + escHtml(uName) + '</b> (' + escHtml(uTag) + ')\\n💬 Xabar: ' + escHtml(text) + '\\n\\n<i>↩️ Javob berish uchun shu xabarga Reply qiling.</i>'
            );
          }
        }
      }
    }
`;

// Webhook route ichini universalBotHandler ga ulash
srv = srv.replace(
  /\/\/ --- TELEGRAM WEBHOOK \(BUYRUQLAR, AVTO-JAVOBLAR VA INLINE TUGMALAR\) ---[\s\S]*?return sendJson\(res, 200, \{ ok: true \}\);\n    \}/,
  universalBotHandler + `
    // --- TELEGRAM WEBHOOK ---
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const body = await parseBody(req);
      await processTelegramUpdate(body);
      return sendJson(res, 200, { ok: true });
    }`
);

// 3. Server uyg'onganda Telegram navbatidagi barcha xabarlarni (pending updates) avtomatik o'qish va javob berish
const flushUpdatesSnippet = `
// Render uyqudan uyg'onganda yoki webhook o'chgan bo'lsa, navbatdagi xabarlarni ham o'qib javob qaytarish
let _tgOffset = 0;
async function pollPendingTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return;
  try {
    const whInfo = await fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo').then(r => r.json());
    if (!whInfo.ok) return;
    // Agar webhook ulanmagan bo'lsa yoki navbatda xabar yig'ilib qolgan bo'lsa
    if (!whInfo.result.url || whInfo.result.pending_update_count > 0) {
      if (whInfo.result.url) {
        await fetch('https://api.telegram.org/bot' + token + '/deleteWebhook', { method: 'POST' });
      }
      const res = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?timeout=1&offset=' + _tgOffset).then(r => r.json());
      if (res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          _tgOffset = upd.update_id + 1;
          await processTelegramUpdate(upd);
        }
      }
      const pubUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\\/+$/, '');
      if (pubUrl.startsWith('https://')) {
        await fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: pubUrl + '/api/telegram/webhook', allowed_updates: ['message', 'callback_query'] })
        });
      }
    }
  } catch (e) {}
}
setTimeout(pollPendingTelegram, 4000);
`;

if (!srv.includes('pollPendingTelegram')) {
  srv = srv + '\n' + flushUpdatesSnippet;
}

fs.writeFileSync('server.js', srv, 'utf8');

// 4. public/admin.html ga "Saytga Admin bo'lib kirish" tugmasini qo'shish
let adm = fs.readFileSync('public/admin.html', 'utf8');
adm = adm.replace(
  '<a href="/" target="_blank" class="btn btn-ghost">🌐 Saytni ochish</a>',
  '<button class="btn btn-success" onclick="openSiteAsAdmin()">👑 Saytga Admin bo‘lib kirish</button>'
);

const ssoClientJs = `
    async function openSiteAsAdmin() {
      try {
        var r = await api('/api/admin/sso', 'POST', {});
        localStorage.setItem('manzil_token', r.token);
        localStorage.setItem('token', r.token);
        localStorage.setItem('authToken', r.token);
        localStorage.setItem('manzil_user', JSON.stringify(r.user));
        localStorage.setItem('user', JSON.stringify(r.user));
        localStorage.setItem('manzil_is_admin', 'true');
        window.open('/?admin=1', '_blank');
      } catch (e) {
        toast('Xato: ' + e.message);
      }
    }
`;

if (!adm.includes('openSiteAsAdmin')) {
  adm = adm.replace('async function login() {', ssoClientJs + '\n    async function login() {');
}
fs.writeFileSync('public/admin.html', adm, 'utf8');

// 5. public/index.html da Admin holatini avtomatik tanish va yuqori menyuda ko'rsatish
let idx = fs.readFileSync('public/index.html', 'utf8');
const adminBannerScript = `
<script>
(function() {
  var isAdm = localStorage.getItem('manzil_is_admin') === 'true' || new URLSearchParams(location.search).get('admin') === '1';
  if (isAdm) {
    window.addEventListener('DOMContentLoaded', function() {
      var bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:9999;background:#0f172a;color:#34d399;border:1px solid #10b981;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:10px;box-shadow:0 8px 20px rgba(0,0,0,0.4);';
      bar.innerHTML = '<span>👑 Admin rejimi faol</span><a href="/admin" style="color:#fff;background:#2563eb;padding:4px 10px;border-radius:999px;text-decoration:none;">Admin Panel</a>';
      document.body.appendChild(bar);
    });
  }
})();
</script>
</body>`;

if (!idx.includes('manzil_is_admin')) {
  idx = idx.replace('</body>', adminBannerScript);
  fs.writeFileSync('public/index.html', idx, 'utf8');
}

execSync('node --check server.js');
console.log('✅ Bot avto-qayta tiklash va Admin SSO muvaffaqiyatli o‘rnatildi!');