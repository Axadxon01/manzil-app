const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (!fs.existsSync('server.js')) {
  console.error('XATO: server.js topilmadi!');
  process.exit(1);
}

let srv = fs.readFileSync('server.js', 'utf8');

const startMarker = '// --- TELEGRAM INLINE TUGMALAR VA WEBHOOK YORDAMCHILARI ---';
const endMarker = "// --- ADMIN: UMUMIY STATISTIKA VA RO'YXATLAR ---";

const sIdx = srv.indexOf(startMarker);
const eIdx = srv.indexOf(endMarker);

if (sIdx === -1 || eIdx === -1) {
  console.error('XATO: Avvalgi webhook bloki topilmadi. install-admin.js o‘rnatilganligini tekshiring.');
  process.exit(1);
}

const upgradedBotBlock = `// --- TELEGRAM INLINE TUGMALAR, AVTO-JAVOBLAR VA WEBHOOK ---
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
      const pubUrl = String(process.env.PUBLIC_URL || '').replace(/\\/+$/, '');
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

    // --- TELEGRAM WEBHOOK (BUYRUQLAR, AVTO-JAVOBLAR VA INLINE TUGMALAR) ---
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const body = await parseBody(req);
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
          return sendJson(res, 200, { ok: true });
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
        return sendJson(res, 200, { ok: true });
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

        // 1. ADMIN REPLY BRIDGE (Mijoz xabariga Reply qilinsa, javobni mijozga yuborish)
        if (isOwner && msg.reply_to_message && text && !text.startsWith('/')) {
          const repliedText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
          const idMatch = repliedText.match(/ID:\\s*(\\d+)/);
          if (idMatch && idMatch[1]) {
            const targetUserId = idMatch[1];
            const sent = await sendTgTo(
              targetUserId,
              '💬 <b>Manzil Qo‘llab-quvvatlash javobi:</b>\\n\\n' + escHtml(text)
            );
            await sendTgTo(
              chatId,
              sent.ok ? '✅ Javobingiz foydalanuvchiga yetkazildi!' : '❌ Xabar yuborilmadi: ' + escHtml(sent.description || 'xato')
            );
            return sendJson(res, 200, { ok: true });
          }
        }

        // 2. ADMIN BROADCAST (/broadcast xabar)
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
          return sendJson(res, 200, { ok: true });
        }

        // 3. ADMIN STATISTIKA (/admin yoki /stats)
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
          return sendJson(res, 200, { ok: true });
        }

        // 4. ADMIN KUTILAYOTGAN ARIZALAR (/pending)
        if (isOwner && text === '/pending') {
          const guides = readJson(FILES.guides, SEED_GUIDES);
          const pendingList = guides.filter(g => g.approved === false && !g.rejected);
          if (!pendingList.length) {
            await sendTgTo(chatId, '✅ Hozircha kutilayotgan yangi gid arizalari yo‘q.');
            return sendJson(res, 200, { ok: true });
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
          return sendJson(res, 200, { ok: true });
        }

        // 5. /start BUYRUQ
        if (text.startsWith('/start')) {
          const welcome = [
            'Assalomu alaykum, <b>' + escHtml(msg.chat.first_name || 'Sayohatchi') + '</b>! 👋',
            '',
            '<b>Manzil</b> sayohat ekotizimining rasmiy botiga xush kelibsiz.',
            'Bu yerda siz:',
            '• 🧭 Tasdiqlangan mahalliy gidlarni topishingiz',
            '• 🛂 O‘zbekistonliklar uchun vizasiz davlatlarni ko‘rishingiz',
            '• 💼 Gid sifatida ro‘yxatdan o‘tishingiz',
            '• 🤖 Sayohat bo‘yicha savol yozib tezkor javob olishingiz mumkin.',
            '',
            'Pastdagi tugmalardan birini tanlang yoki savolingizni yozing:'
          ].join('\\n');

          await sendTgTo(chatId, welcome, {
            reply_markup: {
              inline_keyboard: [[{ text: '🌐 Manzil Web-ilovasini ochish', url: siteUrl }]]
            }
          });
          await sendTgTo(chatId, '⬇️ Tezkor menyu faollashtirildi:', { reply_markup: mainKeyboard });
          return sendJson(res, 200, { ok: true });
        }

        // 6. /guides YOKI "🧭 Gidlar katalogi"
        if (text === '/guides' || text === '🧭 Gidlar katalogi') {
          const guides = readJson(FILES.guides, SEED_GUIDES).filter(g => g.approved === true);
          const top = guides.slice(0, 8);
          const lines = top.map((g, i) =>
            (i + 1) + '. <b>' + escHtml(g.name) + '</b> — ' + escHtml(g.city) + ' ($' + g.rate + '/kun)\\n' +
            '   🗣 ' + escHtml(g.langs) + ' | ✈️ @' + escHtml(g.tg)
          );
          const out = [
            '🧭 <b>Tasdiqlangan mahalliy gidlar (' + guides.length + ' ta):</b>',
            '',
            lines.join('\\n\\n'),
            '',
            'Barcha gidlarni ko‘rish va onlayn band qilish uchun saytga o‘ting:'
          ].join('\\n');
          await sendTgTo(chatId, out, {
            reply_markup: {
              inline_keyboard: [[{ text: '🌐 Barcha gidlar va band qilish', url: siteUrl }]]
            }
          });
          return sendJson(res, 200, { ok: true });
        }

        // 7. /visa YOKI "🛂 Vizasiz davlatlar"
        if (text === '/visa' || text === '🛂 Vizasiz davlatlar') {
          const visaText = [
            '🛂 <b>O‘zbekiston fuqarolari uchun asosiy vizasiz davlatlar:</b>',
            '',
            '🇹🇷 Turkiya — 90 kungacha',
            '🇬🇪 Gruziya — 1 yilgacha',
            '🇦🇪 BAA (Dubay) — 30 kungacha',
            '🇨🇳 Xitoy — 30 kungacha',
            '🇹🇭 Tailand — 60 kungacha',
            '🇲🇻 Maldiv orollari — 30 kungacha',
            '🇰🇿 Qozog‘iston — 30 kungacha',
            '🇰🇬 Qirg‘iziston — 60 kungacha',
            '🇹🇯 Tojikiston — 30 kungacha',
            '🇴🇲 Ummon — 14 kungacha',
            '',
            '105+ manzil bo‘yicha to‘liq viza va byudjet hisob-kitobi saytda:'
          ].join('\\n');
          await sendTgTo(chatId, visaText, {
            reply_markup: {
              inline_keyboard: [[{ text: '🌐 Saytda byudjet hisoblash', url: siteUrl }]]
            }
          });
          return sendJson(res, 200, { ok: true });
        }

        // 8. /apply YOKI "💼 Gid bo‘lish"
        if (text === '/apply' || text === "💼 Gid bo‘lish") {
          const applyText = [
            '💼 <b>Manzil platformasida gid bo‘lib ishlang!</b>',
            '',
            '✅ Ro‘yxatdan o‘tish va katalogga chiqish — <b>mutlaqo bepul</b>',
            '✅ Har bir buyurtmadan <b>88% daromad</b> sizga qoladi (12% platforma komissiyasi)',
            '✅ Sayyohlar siz bilan to‘g‘ridan-to‘g‘ri Telegram yoki onlayn to‘lov orqali bog‘lanadi',
            '',
            'Ariza topshirish uchun saytga kirib «Gid bo‘lish» formasini to‘ldiring:'
          ].join('\\n');
          await sendTgTo(chatId, applyText, {
            reply_markup: {
              inline_keyboard: [[{ text: '📝 Gidlikka ariza topshirish', url: siteUrl }]]
            }
          });
          return sendJson(res, 200, { ok: true });
        }

        // 9. /support YOKI "💬 Operatorga yozish"
        if (text === '/support' || text === '💬 Operatorga yozish') {
          await sendTgTo(
            chatId,
            '💬 <b>Qo‘llab-quvvatlash xizmati</b>\\n\\nSavolingiz, taklifingiz yoki muammoingizni shu yerga yozib yuboring — xabaringiz to‘g‘ridan-to‘g‘ri Manzil operatoriga yetkaziladi.'
          );
          return sendJson(res, 200, { ok: true });
        }

        // 10. UMUMIY SAVOLLARGA AQLLI AVTO-JAVOB + OPERATORGA YO'NALTIRISH
        if (text) {
          const aiRes = await generateAiReply(text, [], {}, 'auto');
          await sendTgTo(chatId, '🤖 ' + escHtml(aiRes.reply));

          if (!isOwner) {
            const uName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
            const uTag = msg.chat.username ? '@' + msg.chat.username : 'username yo‘q';
            const fwdMsg = [
              '📩 <b>Botga yangi xabar keldi</b>',
              '🆔 ID: <code>' + chatId + '</code>',
              '👤 Mijoz: <b>' + escHtml(uName) + '</b> (' + escHtml(uTag) + ')',
              '💬 Xabar: ' + escHtml(text),
              '',
              '<i>↩️ Mijozga javob yozish uchun Telegram’da shu xabarga Reply qiling.</i>'
            ].join('\\n');
            await sendTelegramAdminAction(fwdMsg);
          }
        }
      }

      return sendJson(res, 200, { ok: true });
    }

    `;

srv = srv.slice(0, sIdx) + upgradedBotBlock + srv.slice(eIdx);

// Eski setTimeout webhook qismini yangilash (commands + description + message updates bilan)
srv = srv.replace(/setTimeout\(\(\) => \{[\s\S]*?allowed_updates: \['callback_query'\][\s\S]*?\}, 3000\);/, '');

const newBootSync = `
setTimeout(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const pubUrl = String(process.env.PUBLIC_URL || '').replace(/\\/+$/, '');
  if (token && pubUrl.startsWith('https://')) {
    const callTg = (m, b) => fetch('https://api.telegram.org/bot' + token + '/' + m, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b)
    }).catch(() => {});
    await callTg('setWebhook', { url: pubUrl + '/api/telegram/webhook', allowed_updates: ['message', 'callback_query'] });
    await callTg('setMyCommands', {
      commands: [
        { command: 'start', description: 'Botni ishga tushirish va asosiy menyu' },
        { command: 'guides', description: "Tasdiqlangan mahalliy gidlar ro'yxati" },
        { command: 'visa', description: "O'zbekistonliklar uchun vizasiz davlatlar" },
        { command: 'apply', description: "Gid sifatida ro'yxatdan o'tish" },
        { command: 'support', description: 'Operatorga savol yoki taklif yozish' },
        { command: 'admin', description: 'Admin statistika va boshqaruv (admin)' }
      ]
    });
    await callTg('setMyDescription', {
      description:
        "🧭 Manzil — O'zbekiston va dunyo bo'ylab 105+ sayohat manzillari, tasdiqlangan mahalliy gidlar va AI sayohat yordamchisi.\\n\\n" +
        "✅ Tasdiqlangan gidlar bilan bog'lanish va onlayn band qilish\\n" +
        "✅ O'zbekistonliklar uchun vizasiz davlatlar va byudjet hisobi\\n" +
        "✅ Gid sifatida ro'yxatdan o'tish va 24/7 qo'llab-quvvatlash\\n\\n" +
        "Boshlash uchun /start tugmasini bosing!"
    });
    await callTg('setMyShortDescription', {
      short_description: "Manzil rasmiy yordamchi boti — mahalliy gidlar, sayohat rejalari va 24/7 qo'llab-quvvatlash: https://manzil-app-1.onrender.com"
    });
  }
}, 3000);
`;

srv = srv + '\n' + newBootSync;
fs.writeFileSync('server.js', srv, 'utf8');
execSync('node --check server.js');
console.log('✅ @Manzilsupport_bot yangi tavsif, buyruqlar menyusi va avto-javoblar bilan yangilandi!');