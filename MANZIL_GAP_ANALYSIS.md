# Manzil — MASTER PROMPT bilan solishtirma tahlil

Belgilar: ✅ ishlaydi (sinovdan o'tdi) · ⚠️ qisman / shart bilan · ❌ hali yaratilmagan · 🔧 avval ishlamagan, tuzatildi

## 1. Avvalgi loyihada nima bor edi / ishlamas edi (GitHub repo, v2.x)
| Topilma | Holat |
|---|---|
| Admin login oynasida standart parol `manzil-admin-2026` ko'rsatilgan | 🔧 olib tashlandi; admin alohida `/admin`, shaxsiy hisoblar |
| To'lov xatosida "✅ Demo chek yaratildi" chiqardi | 🔧 xatoda aniq xato; soxta chek yo'q |
| `processPayment` natijani tekshirmasdi, `checkoutUrl` ga o'tmasdi | 🔧 endi provayder sahifasiga yo'naltiradi |
| Token `localStorage`da | 🔧 HttpOnly cookie (admin: SameSite=Strict) |
| Server ishlamasa mahalliy "offline kabinet" sessiyasi | 🔧 olib tashlandi: kirish berilmaydi |
| Ma'lumot JSON fayllarda | 🔧 SQLite (+ eski JSONdan bir martalik import) |
| Admin = bitta umumiy kalit | 🔧 8 rol, individual hisob, RBAC, 2FA (TOTP) |
| To'lov "tasdiqlash" tugmasi hamma uchun | 🔧 faqat provayder webhooki yoki moliya xodimi (izoh majburiy) |
| Click/Payme to'lovi | ❌ merchant API hali yo'q — tanlansa aniq xato (503/501) |

## 2. Bu so'rovdagi talablar
| Talab | Holat |
|---|---|
| Parollar bazada, baza menga ochiq | ✅ Admin → Ma'lumotlar bazasi (super admin). Parol **xesh** sifatida; ochiq matn saqlash xavfli va qaytarib bo'lmaydi — ataylab shunday |
| To'lov tizimi to'liq | ⚠️ Buyurtma→to'lov→chek→ledger→qaytarish zanjiri ✅ ishlaydi. Haqiqiy provayderlardan faqat **Stripe** (webhook imzosi bilan). Click/Payme ❌ |
| Admin Rayds uslubida | ✅ navy sidebar, 4 KPI, tabli buyurtmalar, donut, trend, xizmat turlari, top manzillar |
| Adminlar samaradorligi, turlar soni, feedback | ✅ Xodimlar samaradorligi: biriktirilgan/tasdiqlangan/yakunlangan, sotilgan turlar, savdo, o'rt. javob vaqti, SLA, mijoz bahosi va izohlari, ball |
| Accounting sub-platforma | ✅ foyda-zarar, balans, sinov balansi, bosh kitob, gid to'lovlari, xarajatlar, CSV |
| Qaytarish xavfsizligi | ✅ so'rov→tasdiq→bajarish, o'zi tasdiqlay olmaydi, qoldiqdan oshmaydi, ikki marta bajarilmaydi, Stripe `Idempotency-Key`, ledger teskari yozuvi |
| Anti-hack | ✅ quyida; ⚠️ "hack qilib bo'lmaydi" kafolati yo'q — tashqi pentest tavsiya |

## 3. MASTER PROMPT bo'yicha
| Modul | Holat |
|---|---|
| Ommabop sayt: manzillar, DIY vs Tur, gidlar, AI, fikr | ⚠️ mavjud, frontend asosan avvalgi; to'lov/auth yangi backendga ulandi |
| Manzil kartochkalari: mavsum, byudjet, xavfsizlik, tasdiqlangan joylashuv | ⚠️ admin orqali qo'shiladi; sayt hali o'zining ichki ro'yxatini ishlatadi |
| verified/estimated/unavailable narx belgisi | ⚠️ backend va admin'da bor; saytning barcha kartochkalarida to'liq ko'rsatilmagan |
| Shaxsiy sayohat rejalashtiruvchi (kunma-kun) | ❌ |
| Gid marketplace: ariza, tasdiqlash, to'xtatish, band qilish | ✅ |
| Gid shaxsiy kabineti (o'z buyurtmalari, bandlik) | ❌ |
| Tur operatorlar (hamkor akkaunt, paketlar) | ❌ (buyurtmalarda "hamkor" ulushi hisoblanadi, lekin akkaunt yo'q) |
| Mijoz: buyurtmalar tarixi, bekor qilish, baho | ✅ API; ⚠️ saytda UI hali yo'q (API tayyor: `/api/my/bookings`) |
| Admin: dashboard, buyurtmalar, to'lovlar, qaytarish, foydalanuvchilar, gidlar, manzillar, fikr, sozlamalar, audit | ✅ |
| Admin: Reports (konversiya, cohort) | ⚠️ asosiy ko'rsatkichlar bor; chuqur hisobotlar ❌ |
| AI boshqaruvi (foydalanish/xarajat) | ⚠️ so'rovlar soni va fallback; xarajat hisobi ❌ |
| Audit jurnali (kim/nima/qachon/avval/keyin) | ✅ SHA-256 zanjir, buzilsa aniqlanadi |
| Aviachipta qidiruv, Google Maps, e-pochta xabarlari | ❌ (Phase 5) |
| Telegram: admin bildirishnomalari | ✅ · bot buyruqlari (/guides, /visa…) ❌ **v3 ga ko'chirilmagan** (eski server.js da bor, JSON-bazaga bog'liq edi) |
| PostgreSQL + Prisma, React/TS | ❌ ataylab: SQLite bilan boshlandi (sxema oson ko'chadi). Katta yuk uchun PostgreSQL ga o'tish tavsiya |
| Zaxira nusxa va tiklash | ❌ avtomatik yo'q. Render Disk snapshot yoki `sqlite3 .backup` cron tavsiya |

## 3b. v3.1 (shu bosqich)
| Talab | Holat |
|---|---|
| Admin panel telefonda | ✅ yon menyu → tortma, jadvallar kartochka ko'rinishida, 44px tugmalar |
| Yangi editorial dizayn (1440 / 390) | ✅ `public/index.html`; eski vositalar (DIY kalkulyator, AI, viza) `public/planner.html` da yangi palitrada |
| Haqiqiy suratlar | ✅ Unsplash (Unsplash License) — har biri joyga mosligi tekshirildi |
| 12 til (uz ru en es ar hi zh ja ko ms fr de), arabcha RTL | ✅ interfeys; ⚠️ server xato matnlari va gid ma'lumotlari (shahar, mutaxassislik) hozircha o'zbekcha; tarjimalarni ona tilida so'zlashuvchi tekshirsin |
| Gid jinsini tanlash (diniy afzallik) | ✅ filtr, bronda saqlanadi, mos kelmasa rad |
| Gid kimligi faqat brondan keyin | ✅ ism va Telegram faqat to'lov tasdiqlangan bronda ("Sayohatlarim"); ommaviy API'da yo'q |
| "Watch the film" | ⚠️ video yo'q — suratlardan slayd-film |
| Jurnal maqolalari | ⚠️ faqat sarlavha va qisqa matn; to'liq maqolalar ❌ |
| planner.html | ⚠️ ichki matnlari hali faqat o'zbekcha |

## 4. Xavfsizlik
✅ scrypt xesh, parol siyosati, lockout (5 xato/15 daq), rate limit, server tomonida narx hisoblash, parametrlangan SQL, HttpOnly/SameSite cookie, Origin tekshiruvi (CSRF), CSP va xavfsizlik sarlavhalari, path-traversal himoyasi, RBAC (har so'rovda), TOTP 2FA, sessiya xesh holda saqlanadi, parol almashganda sessiyalar bekor, audit zanjiri, CSV formula-injection himoyasi, XSS: admin panelda barcha qiymatlar escape.
⚠️ Rate limit va sessiyalar bitta jarayon uchun (ko'p serverga ulashda Redis kerak). HTTPS — Render/proksi darajasida. `unsafe-inline` CSP (bitta fayllik HTML tufayli).

## 5. Farazlar (biznes qarori kerak)
- Komissiya 12% (sozlanadi), gid stavkasi — kunlik narx (guruh uchun).
- Bekor qilish siyosati: ≥7 kun 100%, ≥3 kun 50%, aks holda 0% (Sozlamalarda).
- Xodim ball formulasi: 40% tasdiqlash + 30% baho + 30% SLA (taxminiy).
- Gid ulushi tur yakunlangach to'lanadi.
- Mijoz summani o'zi yuborgan (katalogsiz) buyurtma "taxminiy" belgilanadi va xodim narxni tekshirmaguncha tasdiqlab bo'lmaydi.
