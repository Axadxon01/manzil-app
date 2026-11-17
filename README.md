# Manzil — To‘liq Full-Stack Sayohat Ekotizimi (Backend + Frontend)

105+ mahalliy va xalqaro manzil, mustaqil (DIY) va tur-paket taqqoslash, hududiy gidlar katalogi, **Real AI Chat (OpenAI / Grok)**, **Foydalanuvchi Login / Bulutli reja** hamda **To‘lov integratsiyasi (Click, Payme, Stripe)** bilan jihozlangan tayyor web-ilova.

## Loyiha tuzilmasi

```text
manzil-app/
├── server.js          ← Node.js backend (hech qanday npm install kerak emas!)
├── public/index.html  ← Manzil UI + API integratsiyasi + offline localStorage fallback
├── data/              ← guides.json, feedback.json, users.json, payments.json, chats.json
├── .env.example       ← Barcha API kalitlar namunasi
└── README.md          ← To'liq qo'llanma
```

## 1. Ishga tushirish (30 soniya)

Node.js 18+ o‘rnatilgan bo‘lsa kifoya — tashqi kutubxona kerak emas:

```bash
cd manzil-app
cp .env.example .env
node server.js
```

Brauzerda oching: `http://localhost:3000`

Holatni tekshirish:
```bash
curl http://localhost:3000/api/health
```

---

## 2. API Endpointlar ro‘yxati

### Gidlar va Takliflar
| Method | Endpoint | Vazifasi |
| :--- | :--- | :--- |
| `GET` | `/api/guides` | Gidlar bazasi (tasdiqlangan + kutilayotgan) |
| `POST` | `/api/guides/apply` | Gid sifatida qo‘shilish (Yandex uslubi, 12% komissiya) |
| `POST` | `/api/guides/:id/approve` | Admin tasdiqlash (`X-Admin-Key` sarlavhasi bilan) |
| `POST` | `/api/feedback` | Taklif / shikoyat → `data/feedback.json` + Telegram |
| `GET` | `/api/feedback` | Admin uchun murojaatlar ro‘yxati (`X-Admin-Key`) |

### Yangi qo‘shilgan modullar
| Method | Endpoint | Vazifasi |
| :--- | :--- | :--- |
| `POST` | `/api/ai/chat` | Real AI chat (`OpenAI` yoki `Grok xAI` + offline fallback) |
| `POST` | `/api/auth/register` | Yangi foydalanuvchi ro‘yxatdan o‘tishi (`scrypt` + HMAC token) |
| `POST` | `/api/auth/login` | Tizimga kirish va 30 kunlik token olish |
| `GET` | `/api/auth/me` | Profil, bulutdagi reja va to‘lovlar tarixi |
| `POST` | `/api/auth/sync` | Sevimlilar va sayohat rejasini serverga saqlash |
| `POST` | `/api/payments/create` | Click, Payme yoki Stripe/Karta orqali buyurtma yaratish (88% gid / 12% platforma) |
| `POST` | `/api/payments/confirm` | To‘lovni tasdiqlash, chek yaratish va Telegramga xabar yuborish |
| `GET` | `/api/payments` | Foydalanuvchi yoki Admin uchun to‘lovlar ro‘yxati |

---

## 3. Integratsiyalarni sozlash (`.env`)

### A) Telegram Bot (Gid arizasi, Feedback va To‘lov xabarnomalari)
1. Telegramda `@BotFather` orqali bot oching va token oling.
2. `@userinfobot` orqali o‘z `CHAT_ID` ingizni oling.
3. `.env` fayliga yozing:
```env
TELEGRAM_BOT_TOKEN=123456789:AAH...
TELEGRAM_CHAT_ID=987654321
```

### B) Real AI Chat (OpenAI va Grok / xAI)
`.env` fayliga o‘zingizdagi API kalitlardan birini yoki ikkalasini kiriting:
```env
AI_PROVIDER=auto
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

GROK_API_KEY=xai-...
GROK_MODEL=grok-3-mini
```
*Eslatma: Kalit kiritilmasa ham tizim o‘chib qolmaydi — o‘rnatilgan Smart AI fallback rejimi javob beradi.*

### C) To‘lov tizimlari (Click, Payme, Stripe)
```env
COMMISSION_RATE=0.12
CLICK_SERVICE_ID=
CLICK_MERCHANT_ID=
PAYME_MERCHANT_ID=
STRIPE_SECRET_KEY=sk_live_...
```
Merchant kalitlari bo‘sh qoldirilsa, ilovada **Sandbox (sinov) to‘lov rejimi** avtomatik ishlaydi va bir bosishda chek generatsiya qilish imkonini beradi.

---

## 4. Admin buyruqlari

Gid arizasini tasdiqlash:
```bash
curl -X POST http://localhost:3000/api/guides/GUIDE_ID/approve   -H "X-Admin-Key: manzil-admin-2026"
```

Barcha taklif/shikoyatlarni ko‘rish:
```bash
curl http://localhost:3000/api/feedback   -H "X-Admin-Key: manzil-admin-2026"
```

To‘lovlar va 12% komissiya hisobotini ko‘rish:
```bash
curl http://localhost:3000/api/payments   -H "X-Admin-Key: manzil-admin-2026"
```
