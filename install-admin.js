const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (!fs.existsSync('server.js') || !fs.existsSync('public')) {
  console.error('XATO: Buyruqni C:\\Users\\axadx\\Downloads\\manzil-app\\manzil-app papkasida ishga tushiring!');
  process.exit(1);
}

// 1. Zaxira nusxa olish
if (!fs.existsSync('server.js.backup')) {
  fs.copyFileSync('server.js', 'server.js.backup');
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

// 4. Admin API va Telegram Webhook endpointlarini qo'shish
const adminBackendCode = `
    // --- TELEGRAM INLINE TUGMALAR VA WEBHOOK YORDAMCHILARI ---
    async function sendTelegramAdminAction(text, replyMarkup = null) {
      const token = process.env.TELEGRAM_BOT_TOKEN || '';
      const chatId = process.env.TELEGRAM_CHAT_ID || '';
      if (!token || !chatId) return { ok: false, skipped: true };
      try {
        const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        const r = await fetch(\`https://api.telegram.org/bot\${token}/sendMessage\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return await r.json();
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    async function syncTelegramWebhook() {
      const token = process.env.TELEGRAM_BOT_TOKEN || '';
      const pubUrl = String(process.env.PUBLIC_URL || '').replace(/\\/+$/, '');
      if (!token || !pubUrl.startsWith('https://')) {
        return { ok: false, error: 'HTTPS PUBLIC_URL yoki TELEGRAM_BOT_TOKEN topilmadi' };
      }
      try {
        const r = await fetch(\`https://api.telegram.org/bot\${token}/setWebhook\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: \`\${pubUrl}/api/telegram/webhook\`,
            allowed_updates: ['callback_query']
          })
        });
        return await r.json();
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // --- TELEGRAM WEBHOOK (1-bosishda tasdiqlash/rad etish) ---
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const body = await parseBody(req);
      const cb = body && body.callback_query;
      if (cb && cb.data) {
        const token = process.env.TELEGRAM_BOT_TOKEN || '';
        const adminChatId = String(process.env.TELEGRAM_CHAT_ID || '');
        const fromId = String(cb.from && cb.from.id ? cb.from.id : '');

        if (adminChatId && fromId !== adminChatId) {
          if (token) {
            await fetch(\`https://api.telegram.org/bot\${token}/answerCallbackQuery\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: cb.id, text: 'Ruxsat yo‘q!', show_alert: true })
            }).catch(() => {});
          }
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

        if (token) {
          await fetch(\`https://api.telegram.org/bot\${token}/answerCallbackQuery\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cb.id, text: toastText })
          }).catch(() => {});

          if (cb.message && cb.message.chat && statusTag) {
            const origText = cb.message.text || '';
            await fetch(\`https://api.telegram.org/bot\${token}/editMessageText\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cb.message.chat.id,
                message_id: cb.message.message_id,
                text: origText + statusTag,
                parse_mode: 'HTML'
              })
            }).catch(() => {});
          }
        }
      }
      return sendJson(res, 200, { ok: true });
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
        publicUrl: process.env.PUBLIC_URL || '',
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
      const next = guides.filter(g => g.id !== guideId);
      writeJson(FILES.guides, next);
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

if (!srv.includes('/api/admin/overview')) {
  srv = srv.replace('// --- GUIDES: APPROVE (Admin) ---', adminBackendCode + '\n    // --- GUIDES: APPROVE (Admin) ---');
}

// 5. Server ishga tushganda Telegram webhookni avtomatik sinxronlash
const autoHookSnippet = `
setTimeout(() => {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const pubUrl = String(process.env.PUBLIC_URL || '').replace(/\\/+$/, '');
  if (token && pubUrl.startsWith('https://')) {
    fetch(\`https://api.telegram.org/bot\${token}/setWebhook\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: \`\${pubUrl}/api/telegram/webhook\`, allowed_updates: ['callback_query'] })
    }).catch(() => {});
  }
}, 3000);
`;

if (!srv.includes('/api/telegram/webhook\`, allowed_updates')) {
  srv = srv + '\n' + autoHookSnippet;
}

fs.writeFileSync('server.js', srv, 'utf8');

// 6. Mukammal public/admin.html interfeysini yaratish
const adminHtml = `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Manzil Admin — Boshqaruv Markazi</title>
  <style>
    :root {
      --bg: #0b1120;
      --surface: #111827;
      --surface-2: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; }
    .container { max-width: 1240px; margin: 0 auto; padding: 20px; }
    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 32px; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .login-card h1 { font-size: 22px; margin-bottom: 8px; }
    .login-card p { color: var(--muted); font-size: 14px; margin-bottom: 20px; }
    input, select, textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 11px 14px; border-radius: 10px; font-size: 14px; outline: none; }
    input:focus, select:focus, textarea:focus { border-color: var(--primary); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; border-radius: 10px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.15s; text-decoration: none; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-success { background: rgba(16,185,129,0.16); color: #34d399; border: 1px solid rgba(16,185,129,0.35); }
    .btn-success:hover { background: rgba(16,185,129,0.28); }
    .btn-warning { background: rgba(245,158,11,0.16); color: #fbbf24; border: 1px solid rgba(245,158,11,0.35); }
    .btn-warning:hover { background: rgba(245,158,11,0.28); }
    .btn-danger { background: rgba(239,68,68,0.16); color: #f87171; border: 1px solid rgba(239,68,68,0.35); }
    .btn-danger:hover { background: rgba(239,68,68,0.28); }
    .btn-ghost { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
    .btn-ghost:hover { border-color: var(--muted); }
    .topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-badge { background: var(--primary); color: #fff; font-weight: 700; padding: 6px 10px; border-radius: 8px; font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .kpi-label { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
    .kpi-val { font-size: 26px; font-weight: 700; }
    .kpi-sub { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .tab { padding: 10px 16px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); cursor: pointer; font-weight: 600; font-size: 14px; }
    .tab.active { background: var(--primary); color: #fff; border-color: var(--primary); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; align-items: center; justify-content: space-between; }
    .filter-group { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill { padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--surface); border: 1px solid var(--border); color: var(--muted); cursor: pointer; }
    .pill.active { background: var(--surface-2); color: #fff; border-color: var(--primary); }
    .card-list { display: grid; gap: 12px; }
    .item-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; }
    .item-card.pending { border-left: 4px solid var(--warning); }
    .item-card.approved { border-left: 4px solid var(--success); }
    .item-card.rejected { border-left: 4px solid var(--danger); opacity: 0.82; }
    .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .b-pending { background: rgba(245,158,11,0.18); color: #fbbf24; }
    .b-approved { background: rgba(16,185,129,0.18); color: #34d399; }
    .b-rejected { background: rgba(239,68,68,0.18); color: #f87171; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.5; }
    .meta a { color: #60a5fa; text-decoration: none; }
    .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
    .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; width: 100%; max-width: 480px; }
    .form-grid { display: grid; gap: 12px; margin-top: 14px; }
    .toast { position: fixed; bottom: 20px; right: 20px; background: var(--surface-2); border: 1px solid var(--primary); color: #fff; padding: 12px 18px; border-radius: 12px; font-size: 13px; font-weight: 600; display: none; z-index: 100; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
    .hidden { display: none !important; }
    pre.log-box { background: var(--bg); border: 1px solid var(--border); padding: 12px; border-radius: 10px; font-size: 12px; color: #cbd5e1; overflow-x: auto; margin-top: 12px; }
  </style>
</head>
<body>

  <!-- LOGIN EKRANI -->
  <div id="loginView" class="login-wrap">
    <div class="login-card">
      <h1>🧭 Manzil Admin</h1>
      <p>Boshqaruv paneliga kirish uchun maxfiy admin kalitini kiriting.</p>
      <div style="display:grid;gap:12px;">
        <input id="keyInput" type="password" placeholder="Admin kaliti (ADMIN_KEY)" onkeydown="if(event.key==='Enter')login()" />
        <button class="btn btn-primary" onclick="login()">Kirish</button>
        <div id="loginErr" style="color:#f87171;font-size:13px;"></div>
      </div>
    </div>
  </div>

  <!-- ASOSIY PANEL -->
  <div id="appView" class="container hidden">
    <div class="topbar">
      <div class="brand">
        <span class="brand-badge">MANZIL ADMIN</span>
        <strong style="font-size:18px;">Boshqaruv Markazi</strong>
      </div>
      <div class="actions">
        <a href="/" target="_blank" class="btn btn-ghost">🌐 Saytni ochish</a>
        <button class="btn btn-primary" onclick="openAddGuide()">➕ Yangi gid qo‘shish</button>
        <button class="btn btn-ghost" onclick="loadData()">🔄 Yangilash</button>
        <button class="btn btn-danger" onclick="logout()">Chiqish</button>
      </div>
    </div>

    <!-- KPI STATISTIKA -->
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Kutilayotgan Gid Arizalari</div>
        <div class="kpi-val" id="kPending" style="color:#fbbf24;">0</div>
        <div class="kpi-sub" id="kGuidesSub">Tasdiqlangan: 0 ta</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Jami Buyurtmalar</div>
        <div class="kpi-val" id="kOrders">0</div>
        <div class="kpi-sub" id="kOrdersSub">To‘langan: 0 ta</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Platforma Daromadi (12%)</div>
        <div class="kpi-val" id="kComm" style="color:#34d399;">$0</div>
        <div class="kpi-sub" id="kGrossSub">Umumiy aylanma: $0</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Murojaatlar & Foydalanuvchilar</div>
        <div class="kpi-val" id="kFb">0</div>
        <div class="kpi-sub" id="kUsersSub">Ro‘yxatdan o‘tganlar: 0 ta</div>
      </div>
    </div>

    <!-- TABLAR -->
    <div class="tabs">
      <button class="tab active" id="tabGuides" onclick="switchTab('guides')">🧭 Gidlar & Arizalar</button>
      <button class="tab" id="tabPayments" onclick="switchTab('payments')">💳 Buyurtmalar</button>
      <button class="tab" id="tabFeedback" onclick="switchTab('feedback')">💬 Murojaatlar</button>
      <button class="tab" id="tabSystem" onclick="switchTab('system')">🤖 Telegram Bot & Tizim</button>
    </div>

    <!-- 1. GIDLAR BO'LIMI -->
    <div id="secGuides">
      <div class="toolbar">
        <div class="filter-group">
          <button class="pill active" onclick="setGuideFilter('all', this)">Barchasi</button>
          <button class="pill" onclick="setGuideFilter('pending', this)">🟡 Kutilmoqda</button>
          <button class="pill" onclick="setGuideFilter('approved', this)">🟢 Tasdiqlangan</button>
          <button class="pill" onclick="setGuideFilter('rejected', this)">🔴 Rad etilgan</button>
        </div>
        <input id="guideSearch" style="max-width:280px;" placeholder="Ism, shahar yoki @telegram qidirish..." oninput="renderGuides()" />
      </div>
      <div id="guidesList" class="card-list"></div>
    </div>

    <!-- 2. BUYURTMALAR BO'LIMI -->
    <div id="secPayments" class="hidden">
      <div id="paymentsList" class="card-list"></div>
    </div>

    <!-- 3. MUROJAATLAR BO'LIMI -->
    <div id="secFeedback" class="hidden">
      <div id="feedbackList" class="card-list"></div>
    </div>

    <!-- 4. TELEGRAM VA TIZIM BO'LIMI -->
    <div id="secSystem" class="hidden">
      <div class="item-card" style="display:block;">
        <h3 style="margin-bottom:8px;">🤖 @Manzilsupport_bot va 1-bosishda tasdiqlash sozlamalari</h3>
        <p class="meta">Yangi gid arizasi tushganida Telegram xabari tagida <b>✅ Tasdiqlash</b> va <b>❌ Rad etish</b> tugmalari ishlashi uchun Webhook manzilini bir marta ulab qo‘ying.</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;">
          <button class="btn btn-primary" onclick="syncWebhook()">🔗 Telegram 1-bosish tugmalarini ulash (Webhook)</button>
          <button class="btn btn-success" onclick="testTelegram()">📨 Botga test xabar yuborish</button>
        </div>
        <pre id="sysLog" class="log-box">Tizim ma'lumotlari yuklanmoqda...</pre>
      </div>
    </div>
  </div>

  <!-- YANGI GID QO'SHISH MODALI -->
  <div id="addModal" class="modal-bg" onclick="if(event.target===this)closeAddGuide()">
    <div class="modal">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3>➕ Yangi gid qo‘shish</h3>
        <button class="btn btn-ghost" onclick="closeAddGuide()">✕</button>
      </div>
      <div class="form-grid">
        <input id="gName" placeholder="Ism yoki kompaniya nomi *" />
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <input id="gCity" placeholder="Shahar (masalan: Samarqand) *" />
          <input id="gCountry" value="O'zbekiston" placeholder="Davlat" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <input id="gTg" placeholder="Telegram username (@siz) *" />
          <input id="gRate" type="number" value="50" placeholder="Kunlik narx ($)" />
        </div>
        <input id="gLangs" value="O'zbek, Rus, Ingliz" placeholder="Tillar" />
        <input id="gSpec" placeholder="Yo‘nalish / mutaxassislik *" />
        <textarea id="gAbout" rows="2" placeholder="Qo‘shimcha ma'lumot yoki guruh turi (ixtiyoriy)"></textarea>
        <button class="btn btn-primary" onclick="createGuide()">Saqlash va saytga chiqarish</button>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    var ADMIN_TOKEN = localStorage.getItem('manzil_admin_key') || '';
    var STATE = { guides: [], feedback: [], payments: [] };
    var GUIDE_FILTER = 'all';

    function toast(msg) {
      var el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window._tTimer);
      window._tTimer = setTimeout(function() { el.style.display = 'none'; }, 3200);
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    async function api(url, method, body) {
      var opts = {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_TOKEN }
      };
      if (body) opts.body = JSON.stringify(body);
      var r = await fetch(url, opts);
      var data = await r.json().catch(function() { return { ok: false, error: 'Server javobi noto‘g‘ri' }; });
      if (!r.ok || !data.ok) throw new Error(data.error || ('HTTP ' + r.status));
      return data;
    }

    async function login() {
      var val = document.getElementById('keyInput').value.trim();
      if (!val) return;
      ADMIN_TOKEN = val;
      try {
        await loadData();
        localStorage.setItem('manzil_admin_key', ADMIN_TOKEN);
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('appView').classList.remove('hidden');
        document.getElementById('loginErr').textContent = '';
      } catch (e) {
        ADMIN_TOKEN = '';
        localStorage.removeItem('manzil_admin_key');
        document.getElementById('loginErr').textContent = '❌ Kalit noto‘g‘ri: ' + e.message;
      }
    }

    function logout() {
      ADMIN_TOKEN = '';
      localStorage.removeItem('manzil_admin_key');
      location.reload();
    }

    async function loadData() {
      var data = await api('/api/admin/overview', 'GET');
      STATE.guides = data.guides || [];
      STATE.feedback = data.feedback || [];
      STATE.payments = data.payments || [];

      var s = data.stats || {};
      document.getElementById('kPending').textContent = s.pendingGuides || 0;
      document.getElementById('kGuidesSub').textContent = 'Tasdiqlangan: ' + (s.approvedGuides || 0) + ' ta | Jami: ' + (s.totalGuides || 0);
      document.getElementById('kOrders').textContent = s.totalPayments || 0;
      document.getElementById('kOrdersSub').textContent = 'To‘langan: ' + (s.paidPayments || 0) + ' ta';
      document.getElementById('kComm').textContent = '$' + (s.commissionRevenue || 0);
      document.getElementById('kGrossSub').textContent = 'Umumiy aylanma: $' + (s.grossRevenue || 0);
      document.getElementById('kFb').textContent = s.totalFeedback || 0;
      document.getElementById('kUsersSub').textContent = 'Ro‘yxatdan o‘tganlar: ' + (s.totalUsers || 0) + ' ta';

      document.getElementById('sysLog').textContent = JSON.stringify({
        publicUrl: data.publicUrl,
        telegramConfigured: data.telegramConfigured,
        commissionRate: data.commissionRate,
        stats: s
      }, null, 2);

      renderGuides();
      renderPayments();
      renderFeedback();
    }

    function switchTab(name) {
      ['Guides', 'Payments', 'Feedback', 'System'].forEach(function(t) {
        var low = t.toLowerCase();
        document.getElementById('sec' + t).classList.toggle('hidden', low !== name);
        document.getElementById('tab' + t).classList.toggle('active', low === name);
      });
    }

    function setGuideFilter(f, btn) {
      GUIDE_FILTER = f;
      document.querySelectorAll('.pill').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      renderGuides();
    }

    function renderGuides() {
      var q = (document.getElementById('guideSearch').value || '').toLowerCase().trim();
      var list = STATE.guides.slice().sort(function(a, b) {
        var pa = (a.approved === false && !a.rejected) ? 0 : 1;
        var pb = (b.approved === false && !b.rejected) ? 0 : 1;
        return pa - pb;
      }).filter(function(g) {
        var status = g.approved === true ? 'approved' : (g.rejected ? 'rejected' : 'pending');
        if (GUIDE_FILTER !== 'all' && status !== GUIDE_FILTER) return false;
        if (!q) return true;
        return (g.name + ' ' + g.city + ' ' + g.country + ' ' + g.tg + ' ' + g.spec).toLowerCase().indexOf(q) !== -1;
      });

      var wrap = document.getElementById('guidesList');
      if (!list.length) {
        wrap.innerHTML = '<div class="item-card"><span class="meta">Ushbu bo‘limda gidlar topilmadi.</span></div>';
        return;
      }

      wrap.innerHTML = list.map(function(g) {
        var isApp = g.approved === true;
        var isRej = g.rejected === true;
        var cls = isApp ? 'approved' : (isRej ? 'rejected' : 'pending');
        var badge = isApp
          ? '<span class="badge b-approved">🟢 Tasdiqlangan</span>'
          : (isRej ? '<span class="badge b-rejected">🔴 Rad etilgan</span>' : '<span class="badge b-pending">🟡 Kutilmoqda</span>');

        var btns = '';
        if (!isApp) btns += '<button class="btn btn-success" onclick="guideAction(\\'' + esc(g.id) + '\\', \\'approve\\')">✅ Tasdiqlash</button>';
        if (!isRej) btns += '<button class="btn btn-warning" onclick="guideAction(\\'' + esc(g.id) + '\\', \\'reject\\')">❌ Rad etish</button>';
        btns += '<button class="btn btn-danger" onclick="deleteGuide(\\'' + esc(g.id) + '\\')">🗑 O‘chirish</button>';

        return '<div class="item-card ' + cls + '">' +
          '<div style="max-width:720px;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<strong style="font-size:16px;">' + esc(g.name) + '</strong>' + badge +
              '<span class="meta" style="margin:0;">• ID: ' + esc(g.id) + '</span>' +
            '</div>' +
            '<div class="meta">' +
              '📍 <b>' + esc(g.city) + ', ' + esc(g.country) + '</b> &nbsp;|&nbsp; ' +
              '💰 <b>$' + esc(g.rate) + '/kun</b> &nbsp;|&nbsp; ' +
              '🗣 ' + esc(g.langs) + ' &nbsp;|&nbsp; ' +
              '✈️ <a href="https://t.me/' + esc(g.tg) + '" target="_blank">@' + esc(g.tg) + '</a><br/>' +
              '🧭 ' + esc(g.spec) + (g.about ? ' — <i>' + esc(g.about) + '</i>' : '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + btns + '</div>' +
        '</div>';
      }).join('');
    }

    async function guideAction(id, act) {
      try {
        await api('/api/guides/' + encodeURIComponent(id) + '/' + act, 'POST', {});
        toast(act === 'approve' ? '✅ Gid tasdiqlandi!' : '❌ Ariza rad etildi');
        await loadData();
      } catch (e) { toast('Xato: ' + e.message); }
    }

    async function deleteGuide(id) {
      if (!confirm('Ushbu gidni bazadan butunlay o‘chirmoqchimisiz?')) return;
      try {
        await api('/api/guides/' + encodeURIComponent(id) + '/delete', 'POST', {});
        toast('🗑 Gid o‘chirildi');
        await loadData();
      } catch (e) { toast('Xato: ' + e.message); }
    }

    function openAddGuide() { document.getElementById('addModal').style.display = 'flex'; }
    function closeAddGuide() { document.getElementById('addModal').style.display = 'none'; }

    async function createGuide() {
      var payload = {
        name: document.getElementById('gName').value.trim(),
        city: document.getElementById('gCity').value.trim(),
        country: document.getElementById('gCountry').value.trim(),
        tg: document.getElementById('gTg').value.trim(),
        rate: Number(document.getElementById('gRate').value) || 50,
        langs: document.getElementById('gLangs').value.trim(),
        spec: document.getElementById('gSpec').value.trim(),
        about: document.getElementById('gAbout').value.trim()
      };
      try {
        await api('/api/guides/admin-create', 'POST', payload);
        closeAddGuide();
        toast('✅ Yangi gid qo‘shildi!');
        await loadData();
      } catch (e) { toast('Xato: ' + e.message); }
    }

    function renderPayments() {
      var wrap = document.getElementById('paymentsList');
      if (!STATE.payments.length) {
        wrap.innerHTML = '<div class="item-card"><span class="meta">Hozircha buyurtmalar mavjud emas.</span></div>';
        return;
      }
      wrap.innerHTML = STATE.payments.map(function(p) {
        var st = p.status || 'pending';
        var bCls = (st === 'paid' || st === 'completed') ? 'b-approved' : (st === 'cancelled' ? 'b-rejected' : 'b-pending');
        return '<div class="item-card">' +
          '<div>' +
            '<strong>' + esc(p.title || p.guideName || p.id) + '</strong> <span class="badge ' + bCls + '">' + esc(st.toUpperCase()) + '</span>' +
            '<div class="meta">ID: ' + esc(p.id) + ' | Mijoz: ' + esc(p.customerName || p.userEmail || 'Mehmon') + ' | Summa: <b>$' + esc(p.amount || p.totalAmount || 0) + '</b> (' + esc(p.provider || 'sandbox') + ')</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button class="btn btn-success" onclick="setPayStatus(\\'' + esc(p.id) + '\\', \\'paid\\')">✅ To‘langan</button>' +
            '<button class="btn btn-ghost" onclick="setPayStatus(\\'' + esc(p.id) + '\\', \\'completed\\')">🏁 Yakunlash</button>' +
            '<button class="btn btn-danger" onclick="setPayStatus(\\'' + esc(p.id) + '\\', \\'cancelled\\')">🚫 Bekor</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function setPayStatus(id, status) {
      try {
        await api('/api/payments/' + encodeURIComponent(id) + '/status', 'POST', { status: status });
        toast('Buyurtma holati yangilandi');
        await loadData();
      } catch (e) { toast('Xato: ' + e.message); }
    }

    function renderFeedback() {
      var wrap = document.getElementById('feedbackList');
      if (!STATE.feedback.length) {
        wrap.innerHTML = '<div class="item-card"><span class="meta">Yangi murojaatlar yo‘q.</span></div>';
        return;
      }
      wrap.innerHTML = STATE.feedback.map(function(f) {
        return '<div class="item-card">' +
          '<div style="max-width:760px;">' +
            '<strong>' + esc(f.name) + '</strong> <span class="badge b-pending">' + esc((f.type || 'taklif').toUpperCase()) + '</span>' +
            '<span class="meta"> • Aloqa: ' + esc(f.contact || 'ko‘rsatilmagan') + '</span>' +
            '<div class="meta" style="color:#e2e8f0;margin-top:6px;">' + esc(f.msg) + '</div>' +
          '</div>' +
          '<button class="btn btn-danger" onclick="delFeedback(\\'' + esc(f.id) + '\\')">✓ Yopish / O‘chirish</button>' +
        '</div>';
      }).join('');
    }

    async function delFeedback(id) {
      try {
        await api('/api/feedback/' + encodeURIComponent(id) + '/delete', 'POST', {});
        toast('Murojaat yopildi');
        await loadData();
      } catch (e) { toast('Xato: ' + e.message); }
    }

    async function syncWebhook() {
      try {
        var r = await api('/api/admin/telegram/sync-webhook', 'POST', {});
        document.getElementById('sysLog').textContent = JSON.stringify(r, null, 2);
        toast('✅ Telegram Webhook muvaffaqiyatli ulandi!');
      } catch (e) { toast('Xato: ' + e.message); }
    }

    async function testTelegram() {
      try {
        var r = await api('/api/admin/telegram/test', 'POST', {});
        document.getElementById('sysLog').textContent = JSON.stringify(r, null, 2);
        toast('📨 Test xabar Telegram’ga yuborildi!');
      } catch (e) { toast('Xato: ' + e.message); }
    }

    if (ADMIN_TOKEN) {
      document.getElementById('keyInput').value = ADMIN_TOKEN;
      login();
    }
  </script>
</body>
</html>`;

fs.writeFileSync(path.join('public', 'admin.html'), adminHtml, 'utf8');

// 7. Sintaksisni tekshirish
execSync('node --check server.js');
console.log('✅ Mukammal Admin Panel (/admin) va Telegram inline tugmalari muvaffaqiyatli o‘rnatildi!');