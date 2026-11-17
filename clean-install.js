const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Toza zaxiradan tiklash
if (fs.existsSync('server.js.backup')) {
  fs.copyFileSync('server.js.backup', 'server.js');
}

let srv = fs.readFileSync('server.js', 'utf8');

// 2. /admin yo'lini /admin.html ga ulash
srv = srv.replace(
  "let reqPath = pathname === '/' ? '/index.html' : pathname;",
  "let reqPath = pathname === '/' ? '/index.html' : (pathname === '/admin' || pathname === '/admin/' ? '/admin.html' : pathname);"
);

// 3. Yangi gid arizasiga Telegram inline tugmalarini ulash
srv = srv.replace(
  "const tgRes = await sendTelegram(tgMsg);",
  `const tgRes = await sendTelegramAdminAction(tgMsg, {
          inline_keyboard: [[
            { text: '✅ Tasdiqlash', callback_data: 'approve:' + newGuide.id },
            { text: '❌ Rad etish', callback_data: 'reject:' + newGuide.id }
          ]]
        });`
);

// 4. Barcha Admin, SSO va Telegram Bot (buyruqlar + avto-javob + webhook) kodlari
const fullExtension = `
    // --- TELEGRAM YORDAMCHILARI VA BOT SOZLAMALARI ---
    const BOT_META = {
      description:
        "🧭 Manzil — O'zbekiston va dunyo bo'ylab 105+ sayohat manzillari, tasdiqlangan mahalliy gidlar va AI sayohat yordamchisi.\\n\\n" +
        "✅ Tasdiqlangan gidlar bilan bog'lanish va onlayn band qilish\\n" +
        "✅ O'zbekistonliklar uchun vizasiz davlatlar va byudjet hisobi\\n" +
        "✅ Gid sifatida ro'yxatdan o'tish va 24/7 qo'llab-quvvatlash\\n\\n" +
        "Boshlash uchun /start tugmasini bosing!",
      shortDescription:
        "Manzil rasmiy yordamchi boti — mahalliy gidlar, sayohat rejalari va 24/7 qo'llab-quvvatlash: https://manzil-app-1.onrender.com",
      commands: [
        { command: 'start', description: 'Botni ishga tushirish va asosiy menyu' },
        { command: 'guides', description: "Tasdiqlangan mahalliy gidlar ro'yxati" },
        { command: 'visa', description: "O'zbekistonliklar uchun vizasiz davlatlar" },
        { command: 'apply', description: "Gid sifatida ro'yxatdan o'tish" },
        { command: 'support', description: 'Operatorga savol yoki taklif yozish' },
        { command: 'admin', description: 'Admin statistika va boshqaruv (admin)' }
      ]
    };

    const BOT_USERS_FILE = path.join(__dirname, 'data', 'bot_users.json');

    function trackBotUser(chatObj) {
      if (!chatObj || !chatObj.id) return;
      try {
        const list = readJson(BOT_USERS_FILE, []);
        const idStr = String(chatObj.id);
        const idx = list.findIndex(u => String(u.id) === idStr);
        const entry = {
          id: chatObj.id,
          firstName: chatObj.first_name || '',
          username: chatObj.username || '',
          updatedAt: new Date().toISOString()
        };
        if (idx === -1) list.push(entry);
        else list[idx] = { ...list[idx], ...entry };
        writeJson(BOT_USERS_FILE, list);
      } catch (e) {}
    }

    async function tgApi(method, payload) {
      const token = process.env.TELEGRAM_BOT_TOKEN || '';
      if (!token) return { ok: false, skipped: true };
      try {
        const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return await r.json();
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    async function sendTgTo(chatId, text, extra = {}) {
      return tgApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
      });
    }

    async function sendTelegramAdminAction(text, replyMarkup = null) {
      const chatId = process.env.TELEGRAM_CHAT_ID || '';
      if (!chatId) return { ok: false, skipped: true };
      const extra = replyMarkup ? { reply_markup: replyMarkup } : {};
      return sendTgTo(chatId, text, extra);
    }

    async function syncTelegramWebhook() {
      const token = process.env.TELEGRAM_BOT_TOKEN || '';
      const pubUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\\/+$/, '');
      if (!token || !pubUrl.startsWith('https://')) {
        return { ok: false, error: 'HTTPS PUBLIC_URL yoki TELEGRAM_BOT_TOKEN topilmadi' };
      }
      const webhookRes = await tgApi('setWebhook', {
        url: pubUrl + '/api/telegram/webhook',
        allowed_updates: ['message', 'callback_query']
      });
      const cmdRes = await tgApi('setMyCommands', { commands: BOT_META.commands });
      const descRes = await tgApi('setMyDescription', { description: BOT_META.description });
      const shortRes = await tgApi('setMyShortDescription', { short_description: BOT_META.shortDescription });
      return { ok: Boolean(webhookRes.ok), webhookRes, cmdRes, descRes, shortRes };
    }

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

    // --- TELEGRAM WEBHOOK ---
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const body = await parseBody(req);
      await processTelegramUpdate(body);
      return sendJson(res, 200, { ok: true });
    }

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

    // --- ADMIN: UMUMIY STATISTIKA VA RO'YXATLAR ---
    if (req.method === 'GET' && pathname === '/api/admin/overview') {
      if (!isAdmin(req, urlObj)) {
        return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      }
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const feedback = readJson(FILES.feedback, []);
      const payments = FILES.payments ? readJson(FILES.payments, []) : [];
      const users = FILES.users ? readJson(FILES.users, []) : [];

      const paidList = payments.filter(p => p.status === 'paid' || p.status === 'completed');
      const grossRevenue = paidList.reduce((s, p) => s + Number(p.amount || p.totalAmount || 0), 0);
      const commissionRevenue = paidList.reduce((s, p) => {
        const amt = Number(p.amount || p.totalAmount || 0);
        return s + Number(p.commissionAmount != null ? p.commissionAmount : amt * COMMISSION_RATE);
      }, 0);

      return sendJson(res, 200, {
        ok: true,
        commissionRate: COMMISSION_RATE,
        telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        publicUrl: process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com',
        stats: {
          totalGuides: guides.length,
          approvedGuides: guides.filter(g => g.approved === true).length,
          pendingGuides: guides.filter(g => g.approved === false && !g.rejected).length,
          rejectedGuides: guides.filter(g => g.rejected === true).length,
          totalPayments: payments.length,
          paidPayments: paidList.length,
          grossRevenue: Math.round(grossRevenue * 100) / 100,
          commissionRevenue: Math.round(commissionRevenue * 100) / 100,
          totalFeedback: feedback.length,
          totalUsers: users.length
        },
        guides,
        feedback,
        payments
      });
    }

    // --- ADMIN: TELEGRAM WEBHOOK ULASH VA TEST ---
    if (req.method === 'POST' && pathname === '/api/admin/telegram/sync-webhook') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Ruxsat yo‘q' });
      const result = await syncTelegramWebhook();
      return sendJson(res, 200, { ok: Boolean(result.ok), result });
    }

    if (req.method === 'POST' && pathname === '/api/admin/telegram/test') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Ruxsat yo‘q' });
      const result = await sendTelegramAdminAction('🔔 <b>Manzil Admin Panel:</b> Telegram aloqasi muvaffaqiyatli tekshirildi!');
      return sendJson(res, 200, { ok: Boolean(result.ok), result });
    }

    // --- ADMIN: YANGI GID QO'SHISH ---
    if (req.method === 'POST' && pathname === '/api/guides/admin-create') {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const name = String(body.name || '').trim();
      const city = String(body.city || '').trim();
      const country = String(body.country || "O'zbekiston").trim();
      const langs = String(body.langs || "O'zbek, Rus").trim();
      const spec = String(body.spec || '').trim();
      const tg = String(body.tg || '').trim().replace(/^@/, '');
      const rate = Math.max(5, Math.min(2000, Number(body.rate) || 50));
      if (!name || !city || !tg || !spec) {
        return sendJson(res, 400, { ok: false, error: 'Barcha maydonlarni to‘ldiring' });
      }
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const newGuide = {
        id: 'guide_' + crypto.randomBytes(4).toString('hex'),
        name, city, country, langs, spec, rate, tg,
        group: String(body.group || '').trim(),
        about: String(body.about || '').trim(),
        approved: true,
        approvedAt: new Date().toISOString(),
        commissionRate: COMMISSION_RATE,
        createdAt: new Date().toISOString()
      };
      guides.unshift(newGuide);
      writeJson(FILES.guides, guides);
      return sendJson(res, 201, { ok: true, guide: newGuide });
    }

    // --- GUIDES: REJECT & DELETE (Admin) ---
    const rejectMatch = pathname.match(/^\\/api\\/guides\\/([^/]+)\\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const guideId = decodeURIComponent(rejectMatch[1]);
      const guides = readJson(FILES.guides, SEED_GUIDES);
      const guide = guides.find(g => g.id === guideId);
      if (!guide) return sendJson(res, 404, { ok: false, error: 'Gid topilmadi' });
      guide.approved = false;
      guide.rejected = true;
      guide.rejectedAt = new Date().toISOString();
      writeJson(FILES.guides, guides);
      return sendJson(res, 200, { ok: true, guide });
    }

    const delGuideMatch = pathname.match(/^\\/api\\/guides\\/([^/]+)\\/delete$/);
    if (req.method === 'POST' && delGuideMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const guideId = decodeURIComponent(delGuideMatch[1]);
      const guides = readJson(FILES.guides, SEED_GUIDES);
      writeJson(FILES.guides, guides.filter(g => g.id !== guideId));
      return sendJson(res, 200, { ok: true });
    }

    // --- FEEDBACK: DELETE (Admin) ---
    const delFbMatch = pathname.match(/^\\/api\\/feedback\\/([^/]+)\\/delete$/);
    if (req.method === 'POST' && delFbMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const fbId = decodeURIComponent(delFbMatch[1]);
      const items = readJson(FILES.feedback, []);
      writeJson(FILES.feedback, items.filter(f => f.id !== fbId));
      return sendJson(res, 200, { ok: true });
    }

    // --- PAYMENTS: UPDATE STATUS (Admin) ---
    const payStatusMatch = pathname.match(/^\\/api\\/payments\\/([^/]+)\\/status$/);
    if (req.method === 'POST' && payStatusMatch) {
      const body = await parseBody(req);
      if (!isAdmin(req, urlObj, body)) return sendJson(res, 401, { ok: false, error: 'Admin kaliti noto‘g‘ri' });
      const payId = decodeURIComponent(payStatusMatch[1]);
      const payments = FILES.payments ? readJson(FILES.payments, []) : [];
      const item = payments.find(p => p.id === payId);
      if (!item) return sendJson(res, 404, { ok: false, error: 'Buyurtma topilmadi' });
      item.status = String(body.status || 'paid');
      item.updatedAt = new Date().toISOString();
      if (FILES.payments) writeJson(FILES.payments, payments);
      return sendJson(res, 200, { ok: true, payment: item });
    }
`;

srv = srv.replace('// --- GUIDES: APPROVE (Admin) ---', fullExtension + '\n    // --- GUIDES: APPROVE (Admin) ---');

// 5. Server uyg'onganda Telegram navbatidagi xabarlarni o'qish va webhookni sinxronlash
const bootWorker = `
let _tgOffset = 0;
async function pollPendingTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return;
  try {
    const whInfo = await fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo').then(r => r.json());
    if (whInfo.ok && (!whInfo.result.url || whInfo.result.pending_update_count > 0)) {
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
    }
    const pubUrl = String(process.env.PUBLIC_URL || 'https://manzil-app-1.onrender.com').replace(/\\/+$/, '');
    if (pubUrl.startsWith('https://')) {
      await fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pubUrl + '/api/telegram/webhook', allowed_updates: ['message', 'callback_query'] })
      });
    }
  } catch (e) {}
}
setTimeout(pollPendingTelegram, 3500);
`;

srv = srv + '\n' + bootWorker;
fs.writeFileSync('server.js', srv, 'utf8');

// 6. Sintaksisni tekshirish
execSync('node --check server.js');
console.log('✅ server.js 100% toza va xatosiz tiklandi!');