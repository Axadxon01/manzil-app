# Manzil v3

Node.js 22+ (`node:sqlite`), **npm paketlarsiz**. Ommaviy sayt `/`, xodimlar paneli `/admin`.

```bash
node server.js          # lokal; baza data/manzil.db
npm test                # 48 ta integratsion test (xotiradagi bazada)
```

## Render'ga deploy
1. Render → **New → Blueprint** → `Axadxon01/manzil-app` repo. `render.yaml` hammasini sozlaydi (Node 22, 1 GB disk `/data`, health check).
2. So'ralgan maxfiy qiymatlarni kiriting: `PUBLIC_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ belgi), kerak bo'lsa Stripe/Telegram/OpenAI.
3. Deploy tugagach `https://<domen>/admin` ga kiring → parolni almashtiring → **2FA** ni yoqing → xodimlarni qo'shing.
4. Stripe: Dashboard → Webhooks → `https://<domen>/api/payments/webhook/stripe`, hodisalar `checkout.session.completed`, `checkout.session.expired`; signing secret → `STRIPE_WEBHOOK_SECRET`.

**Muhim:** disk faqat pullik (Starter) rejada ishlaydi. Free rejada baza har deploy/qayta ishga tushishda o'chadi.
Eski Render servisi bo'lsa: Settings'da `NODE_VERSION=22`, Disks → `/data`, env `DB_PATH=/data/manzil.db` qo'shing, start command `node server.js`.
Birinchi ishga tushishda eski `data/*.json` (foydalanuvchilar, gidlar, fikrlar) bazaga bir marta import qilinadi.

## Qisqacha arxitektura
`lib/db.js` (SQLite sxema) · `lib/security.js` (scrypt, sessiya, RBAC, TOTP, audit zanjiri) · `lib/core.js` (buyurtma, to'lov, qaytarish, ledger, hisobotlar) · `server.js` (marshrutlar) · `public/index.html`, `public/admin.html`.

## Parollar va "ochiq baza"
Parollar **ochiq matnda saqlanmaydi** (scrypt xesh). Admin → *Ma'lumotlar bazasi* bo'limida (faqat super admin) barcha jadvallar ko'rinadi, xeshlar yashirilgan, har ko'rish auditga yoziladi.

## Pul qoidalari
Summalar sentlarda · ikki yoqlama ledger · sandbox to'lovlar hisobotga kirmaydi · "to'langan" faqat provayder webhooki (imzo tekshiriladi) yoki moliya xodimining asoslangan qo'lda tasdig'i bilan · qaytarish: so'rov → boshqa xodim tasdiqlaydi → bajariladi (ikki kishi nazorati) · gid ulushi tur yakunlanmaguncha ushlab turiladi.
