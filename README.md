# Manzil v3.3

Node.js 22+ (`node:sqlite`), **npm paketlarsiz**. Ommaviy sayt `/`, xodimlar paneli `/admin`, tasdiqlangan gidlar platformasi `/guide`.

```bash
node server.js          # lokal; baza data/manzil.db
npm test                # 232 ta integratsion tekshiruv (xotiradagi bazada, Telegram va AI mock bilan)
```

## Render'ga deploy
1. Render → **New → Blueprint** → `Axadxon01/manzil-app` repo. `render.yaml` hammasini sozlaydi (Node 22, 1 GB disk `/data`, health check).
2. So'ralgan maxfiy qiymatlarni kiriting: `PUBLIC_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ belgi), kerak bo'lsa Stripe/Telegram/OpenAI. Bank cheklarini AI bilan o'qish uchun `GEMINI_API_KEY` (Google AI Studio'da bepul).
3. Deploy tugagach `https://<domen>/admin` ga kiring → parolni almashtiring → **2FA** ni yoqing → xodimlarni qo'shing.
4. Stripe: Dashboard → Webhooks → `https://<domen>/api/payments/webhook/stripe`, hodisalar `checkout.session.completed`, `checkout.session.expired`; signing secret → `STRIPE_WEBHOOK_SECRET`.

**Muhim:** disk faqat pullik (Starter) rejada ishlaydi. Free rejada baza har deploy/qayta ishga tushishda o'chadi.
Eski Render servisi bo'lsa: Settings'da `NODE_VERSION=22`, Disks → `/data`, env `DB_PATH=/data/manzil.db` qo'shing, start command `node server.js`.
Birinchi ishga tushishda eski `data/*.json` (foydalanuvchilar, gidlar, fikrlar) bazaga bir marta import qilinadi.

## Qisqacha arxitektura
`lib/db.js` (SQLite sxema) · `lib/security.js` (scrypt, sessiya, RBAC, TOTP, audit zanjiri) · `lib/core.js` (buyurtma, to'lov, qaytarish, ledger, hisobotlar) · `lib/guides.js` (gid platformasi: login, Telegram kodi, qurilmalar) · `lib/receipts.js` (bank o'tkazmasi, chekni AI bilan o'qish, qoidalar) · `server.js` (marshrutlar) · `public/index.html`, `public/admin.html`, `public/guide.html`.

## Parollar va "ochiq baza"
Parollar **ochiq matnda saqlanmaydi** (scrypt xesh). Admin → *Ma'lumotlar bazasi* bo'limida (faqat super admin) barcha jadvallar ko'rinadi, xeshlar yashirilgan, har ko'rish auditga yoziladi.

## Pul qoidalari
Summalar sentlarda · ikki yoqlama ledger · sandbox to'lovlar hisobotga kirmaydi · "to'langan" faqat provayder webhooki (imzo tekshiriladi) yoki moliya xodimining asoslangan qo'lda tasdig'i bilan · qaytarish: so'rov → boshqa xodim tasdiqlaydi → bajariladi (ikki kishi nazorati) · gid ulushi tur yakunlanmaguncha ushlab turiladi.

## v3.2: nima qo'shildi
- **107 ta manzil** rasmlari bilan (`data/catalog.json`; rasm muallifi va litsenziyasi har biriga yozilgan). Qidiruv, mintaqa, oy filtri; har bir manzil uchun DIY vs gid kalkulyatori.
- **Namunaviy gid va paketlar** har manzilga biriktirilgan (arab/musulmon davlatlari va O'zbekistonda ayol va erkak gid). Ular aniq "namuna" deb belgilangan: **pul olinmaydi**, mijoz so'rov yuboradi → support murojaati. Haqiqiy hamkorlar yetarli bo'lgach Admin → Gidlar → "namunalarni yashirish".
- **Gid kabineti** (o'z bronlari, daromad, baho, profil) va **tur operator kabineti** (ariza → admin tasdiqlaydi → paket qo'shadi → har paket tekshiruvdan o'tadi → bronlar).
- **Mijoz**: bronni bekor qilish (siyosat bo'yicha qaytarish %), gidga baho, Telegram'ni ulash, support.
- **Telegram bot** (`TELEGRAM_BOT_TOKEN`): bron xabarlari, "Sayohatlarim" (bekor qilish, baho), support (shikoyat/taklif/savol), parolni tiklash kodi, 12 til. Support guruhi: botni guruhga qo'shing → admin paneldagi `/support_here KOD`; xabarga Reply = mijozga javob, `/close` = yopish.
- **Parolni tiklash**: saytda "Parolni unutdingizmi?" → kod faqat hisobga ulangan Telegram'ga keladi.
- **Click va Payme** merchant API (imzo/Basic auth, summa tekshiruvi, idempotent). URL'lar `.env.example` da.
- **SEO**: `/{til}/` sahifalar, `/{til}/destinations/{slug}` (107×12), jurnal maqolalari, huquqiy sahifa, hreflang, canonical, Open Graph, JSON-LD, `sitemap.xml`, `robots.txt`.
- **Huquqiy**: maxfiylik, foydalanish shartlari, bekor qilish/qaytarish (`/{til}/legal`) — yurist ko'rib chiqishi kerak.
- **Xavfsizlik**: birinchi kirishda admin parolini almashtirish majburiy; production'da admin/moliya uchun 2FA majburiy; kunlik zaxira nusxa (Admin → Zaxira nusxalar).

## v3.3: nima qo'shildi
- **Gidlar platformasi `/guide`** (soddalashtirilgan): bosh sahifa (yaqin turlar, daromad), turlar (bronni "qabul qildim" deb belgilash), manzillar — chapda 30% ro'yxat, o'ngda 70% batafsil ko'rinish (telefonda batafsil sahifa to'liq ekranda ochiladi), profil. 3 til: o'zbek, rus, ingliz.
- **Kirish xavfsizligi**: login va parol har bir gidga **alohida, faqat Telegram bot orqali** yuboriladi (admin ham parolni ko'rmaydi), xabar 30 daqiqadan keyin o'chiriladi. Yangi qurilmadan kirishda Telegram'ga 6 xonali kod keladi; xabardagi **"Bu men emasman"** tugmasi barcha sessiyalarni yopadi va parolni almashtiradi. 5 xato paroldan keyin 15 daqiqa blok, rate limit, audit. To'xtatilgan gid darhol platformadan chiqariladi.
- **Gidni ulash**: admin gidni tasdiqlaganda, arizadagi Telegram username botga yozgan bo'lsa, login/parol avtomatik yuboriladi. Aks holda Admin → Gidlar → **Kirish** → bir martalik havola (7 kun) yoki gid botga `/gid` yozadi.
- **Bank o'tkazmasi + chekni AI tekshirishi**: mijoz bron qilganda "Bank o'tkazmasi"ni tanlaydi → rekvizitlar va to'lov maqsadi (bron kodi) → pulni o'tkazib, chek (skrinshot yoki PDF) yuklaydi — saytda yoki Telegram botda. AI (Gemini → Claude → OpenAI zaxira) chekdan faqat **ma'lumotni o'qiydi**; summa, qabul qiluvchi karta/hisob, sana, tranzaksiya raqami takrorlanmasligi, fayl takrorlanishi va tahrir izlarini **server qoidalari** tekshiradi. Natija: "mos" / "tekshirish kerak" / "mos emas". **To'lovni AI hech qachon o'zi tasdiqlamaydi** — moliya xodimi Admin → Cheklar'da pul bank hisobiga tushganini ko'rib, bitta tugma bilan tasdiqlaydi ("mos emas" bo'lsa faqat izoh bilan). Chekdagi matn ko'rsatma sifatida bajarilmaydi (prompt-injection himoyasi).
- **Sozlash**: Admin → Sozlamalar → "Bank o'tkazmasi" kartasiga rekvizitlarni kiriting (hisob raqami, MFO, INN, karta, karta egasi). Ular kiritilmaguncha saytda bu usul ko'rinmaydi.
