/* Manzil — tur-paketni bron qilish so'rovi va "Sayohatlarim"dan to'lash (v3.4). i18n-pay.js dan keyin yuklanadi; bot ham o'qiydi. */
(function (W) {
var X = {};
X.en = {
pk_price_line:"from {price} per person",
pq_how:"How it works: you send a booking request → our team confirms the date and final price, usually within 24 hours → you pay in My trips. Nothing is charged now.",
pq_estimate:"Estimated price",pq_note:"Notes (optional)",pq_note_ph:"Hotel level, language, children, food…",pq_submit:"Send booking request",pq_min_date:"At least 2 days from today",
pq_sent:"Request received: {code}. Once our team confirms the date and price, payment opens in My trips. If Telegram is connected, you'll get a message there too.",
pq_open_trips:"Open My trips",st_requested:"Awaiting confirmation",tr_offer_note:"Note from our team",tr_decline_note:"Reason",tr_price_ok:"Price confirmed",
tr_pay:"Pay",tr_pay_how:"Choose how to pay",tr_pay_go:"Continue",tr_pay_none:"No payment method is available right now. Contact support.",
pq_e_date:"Pick a date at least 2 days from today: our team needs time to confirm it.",pq_e_dup:"You already have a request for this package and date. Open My trips.",
pq_e_many:"You have several unconfirmed requests. Please wait for our reply first.",pq_e_wait:"The date and price aren't confirmed yet. Please wait for our team's reply."
};
X.uz = {
pk_price_line:"{price} dan, bir kishi uchun",
pq_how:"Qanday ishlaydi: bron so‘rovini yuborasiz → jamoamiz sana va yakuniy narxni odatda 24 soat ichida tasdiqlaydi → «Sayohatlarim»da to‘laysiz. Hozir pul olinmaydi.",
pq_estimate:"Taxminiy narx",pq_note:"Izoh (ixtiyoriy)",pq_note_ph:"Mehmonxona darajasi, til, bolalar, ovqatlanish…",pq_submit:"Bron so‘rovini yuborish",pq_min_date:"Bugundan kamida 2 kun keyin",
pq_sent:"So‘rov qabul qilindi: {code}. Jamoamiz sana va narxni tasdiqlagach, «Sayohatlarim»da to‘lov ochiladi. Telegram ulangan bo‘lsa, xabar u yerga ham keladi.",
pq_open_trips:"Sayohatlarimni ochish",st_requested:"Tasdiqlash kutilmoqda",tr_offer_note:"Jamoamiz izohi",tr_decline_note:"Sabab",tr_price_ok:"Narx tasdiqlandi",
tr_pay:"To‘lash",tr_pay_how:"To‘lov usulini tanlang",tr_pay_go:"Davom etish",tr_pay_none:"Hozir to‘lov usuli mavjud emas. Support bilan bog‘laning.",
pq_e_date:"Bugundan kamida 2 kun keyingi sanani tanlang: jamoamiz uni tasdiqlashi kerak.",pq_e_dup:"Bu paket va sana uchun so‘rovingiz allaqachon bor. «Sayohatlarim»ni oching.",
pq_e_many:"Tasdiqlanmagan so‘rovlaringiz ko‘p. Avval javobimizni kuting.",pq_e_wait:"Sana va narx hali tasdiqlanmagan. Jamoamiz javobini kuting."
};
X.ru = {
pk_price_line:"от {price} за человека",
pq_how:"Как это работает: вы отправляете запрос на бронирование → команда подтверждает дату и итоговую цену, обычно в течение 24 часов → вы оплачиваете в разделе «Мои поездки». Сейчас деньги не списываются.",
pq_estimate:"Ориентировочная цена",pq_note:"Комментарий (необязательно)",pq_note_ph:"Уровень отеля, язык, дети, питание…",pq_submit:"Отправить запрос",pq_min_date:"Не раньше чем через 2 дня",
pq_sent:"Запрос принят: {code}. Когда команда подтвердит дату и цену, оплата откроется в разделе «Мои поездки». Если подключён Telegram, сообщение придёт и туда.",
pq_open_trips:"Открыть «Мои поездки»",st_requested:"Ожидает подтверждения",tr_offer_note:"Комментарий команды",tr_decline_note:"Причина",tr_price_ok:"Цена подтверждена",
tr_pay:"Оплатить",tr_pay_how:"Выберите способ оплаты",tr_pay_go:"Продолжить",tr_pay_none:"Сейчас нет доступного способа оплаты. Напишите в поддержку.",
pq_e_date:"Выберите дату не раньше чем через 2 дня: команде нужно время на подтверждение.",pq_e_dup:"У вас уже есть запрос на этот тур и дату. Откройте «Мои поездки».",
pq_e_many:"У вас несколько неподтверждённых запросов. Сначала дождитесь ответа.",pq_e_wait:"Дата и цена ещё не подтверждены. Дождитесь ответа команды."
};
X.es = {
pk_price_line:"desde {price} por persona",
pq_how:"Cómo funciona: envías una solicitud de reserva → nuestro equipo confirma la fecha y el precio final, normalmente en 24 horas → pagas en Mis viajes. Ahora no se cobra nada.",
pq_estimate:"Precio estimado",pq_note:"Notas (opcional)",pq_note_ph:"Categoría de hotel, idioma, niños, comidas…",pq_submit:"Enviar solicitud de reserva",pq_min_date:"Al menos 2 días desde hoy",
pq_sent:"Solicitud recibida: {code}. Cuando nuestro equipo confirme la fecha y el precio, el pago se abrirá en Mis viajes. Si tienes Telegram conectado, también recibirás un mensaje allí.",
pq_open_trips:"Abrir Mis viajes",st_requested:"Pendiente de confirmación",tr_offer_note:"Nota de nuestro equipo",tr_decline_note:"Motivo",tr_price_ok:"Precio confirmado",
tr_pay:"Pagar",tr_pay_how:"Elige cómo pagar",tr_pay_go:"Continuar",tr_pay_none:"Ahora no hay ningún método de pago disponible. Contacta con soporte.",
pq_e_date:"Elige una fecha al menos 2 días desde hoy: nuestro equipo necesita confirmarla.",pq_e_dup:"Ya tienes una solicitud para este paquete y fecha. Abre Mis viajes.",
pq_e_many:"Tienes varias solicitudes sin confirmar. Espera primero nuestra respuesta.",pq_e_wait:"La fecha y el precio aún no están confirmados. Espera la respuesta de nuestro equipo."
};
X.ar = {
pk_price_line:"من {price} للشخص",
pq_how:"كيف يعمل: ترسل طلب حجز ← يؤكد فريقنا التاريخ والسعر النهائي عادةً خلال 24 ساعة ← تدفع من «رحلاتي». لا يُخصم أي مبلغ الآن.",
pq_estimate:"السعر التقديري",pq_note:"ملاحظات (اختياري)",pq_note_ph:"مستوى الفندق، اللغة، الأطفال، الطعام…",pq_submit:"إرسال طلب الحجز",pq_min_date:"بعد يومين على الأقل من اليوم",
pq_sent:"تم استلام الطلب: {code}. بعد أن يؤكد فريقنا التاريخ والسعر، يُفتح الدفع في «رحلاتي». إذا كان تيليجرام مربوطًا فستصلك رسالة هناك أيضًا.",
pq_open_trips:"فتح «رحلاتي»",st_requested:"بانتظار التأكيد",tr_offer_note:"ملاحظة من فريقنا",tr_decline_note:"السبب",tr_price_ok:"تم تأكيد السعر",
tr_pay:"ادفع",tr_pay_how:"اختر طريقة الدفع",tr_pay_go:"متابعة",tr_pay_none:"لا تتوفر طريقة دفع الآن. تواصل مع الدعم.",
pq_e_date:"اختر تاريخًا بعد يومين على الأقل من اليوم: يحتاج فريقنا إلى تأكيده.",pq_e_dup:"لديك طلب بالفعل لهذه الباقة وهذا التاريخ. افتح «رحلاتي».",
pq_e_many:"لديك عدة طلبات غير مؤكدة. انتظر ردنا أولًا.",pq_e_wait:"لم يتم تأكيد التاريخ والسعر بعد. انتظر رد فريقنا."
};
X.hi = {
pk_price_line:"{price} से, प्रति व्यक्ति",
pq_how:"यह कैसे काम करता है: आप बुकिंग अनुरोध भेजते हैं → हमारी टीम आमतौर पर 24 घंटे में तारीख और अंतिम कीमत की पुष्टि करती है → आप «मेरी यात्राएँ» में भुगतान करते हैं। अभी कोई पैसा नहीं लिया जाता।",
pq_estimate:"अनुमानित कीमत",pq_note:"टिप्पणी (वैकल्पिक)",pq_note_ph:"होटल का स्तर, भाषा, बच्चे, भोजन…",pq_submit:"बुकिंग अनुरोध भेजें",pq_min_date:"आज से कम से कम 2 दिन बाद",
pq_sent:"अनुरोध मिल गया: {code}। हमारी टीम तारीख और कीमत की पुष्टि करेगी, फिर «मेरी यात्राएँ» में भुगतान खुलेगा। Telegram जुड़ा है तो वहाँ भी संदेश आएगा।",
pq_open_trips:"«मेरी यात्राएँ» खोलें",st_requested:"पुष्टि की प्रतीक्षा",tr_offer_note:"हमारी टीम की टिप्पणी",tr_decline_note:"कारण",tr_price_ok:"कीमत की पुष्टि हुई",
tr_pay:"भुगतान करें",tr_pay_how:"भुगतान का तरीका चुनें",tr_pay_go:"आगे बढ़ें",tr_pay_none:"अभी कोई भुगतान तरीका उपलब्ध नहीं है। सहायता से संपर्क करें।",
pq_e_date:"आज से कम से कम 2 दिन बाद की तारीख चुनें: हमारी टीम को इसकी पुष्टि करनी है।",pq_e_dup:"इस पैकेज और तारीख के लिए आपका अनुरोध पहले से है। «मेरी यात्राएँ» खोलें।",
pq_e_many:"आपके कई अनुरोध अभी पुष्टि के बिना हैं। पहले हमारे जवाब का इंतज़ार करें।",pq_e_wait:"तारीख और कीमत की अभी पुष्टि नहीं हुई है। हमारी टीम के जवाब का इंतज़ार करें।"
};
X.zh = {
pk_price_line:"每人 {price} 起",
pq_how:"流程：您提交预订申请 → 我们的团队通常在 24 小时内确认日期和最终价格 → 您在「我的行程」中付款。现在不会扣款。",
pq_estimate:"预估价格",pq_note:"备注（可选）",pq_note_ph:"酒店档次、语言、儿童、餐饮……",pq_submit:"提交预订申请",pq_min_date:"至少在 2 天后",
pq_sent:"已收到申请：{code}。团队确认日期和价格后，可在「我的行程」中付款。如已绑定 Telegram，也会在那里收到消息。",
pq_open_trips:"打开「我的行程」",st_requested:"等待确认",tr_offer_note:"团队备注",tr_decline_note:"原因",tr_price_ok:"价格已确认",
tr_pay:"付款",tr_pay_how:"选择付款方式",tr_pay_go:"继续",tr_pay_none:"目前没有可用的付款方式，请联系客服。",
pq_e_date:"请选择至少 2 天后的日期：团队需要时间确认。",pq_e_dup:"您已为该套餐和日期提交过申请。请打开「我的行程」。",
pq_e_many:"您有多个未确认的申请，请先等待我们的回复。",pq_e_wait:"日期和价格尚未确认，请等待团队回复。"
};
X.ja = {
pk_price_line:"1名 {price}〜",
pq_how:"流れ：予約リクエストを送信 → 通常24時間以内にチームが日程と最終料金を確定 → 「マイトリップ」でお支払い。現時点では料金は発生しません。",
pq_estimate:"概算料金",pq_note:"メモ（任意）",pq_note_ph:"ホテルのランク、言語、お子さま、食事など",pq_submit:"予約リクエストを送信",pq_min_date:"本日から2日以上先",
pq_sent:"リクエストを受け付けました：{code}。チームが日程と料金を確定すると、「マイトリップ」でお支払いいただけます。Telegram 連携済みの場合はそちらにも通知します。",
pq_open_trips:"マイトリップを開く",st_requested:"確認待ち",tr_offer_note:"チームからのメモ",tr_decline_note:"理由",tr_price_ok:"料金確定済み",
tr_pay:"支払う",tr_pay_how:"支払い方法を選択",tr_pay_go:"次へ",tr_pay_none:"現在ご利用いただける支払い方法がありません。サポートへご連絡ください。",
pq_e_date:"本日から2日以上先の日付を選んでください。チームの確認が必要です。",pq_e_dup:"このパッケージと日付のリクエストはすでにあります。マイトリップをご確認ください。",
pq_e_many:"未確認のリクエストが複数あります。まずは返信をお待ちください。",pq_e_wait:"日程と料金はまだ確定していません。チームからの返信をお待ちください。"
};
X.ko = {
pk_price_line:"1인 {price}부터",
pq_how:"진행 방식: 예약 요청을 보내면 → 보통 24시간 안에 팀이 날짜와 최종 가격을 확정하고 → 「내 여행」에서 결제합니다. 지금은 결제되지 않습니다.",
pq_estimate:"예상 가격",pq_note:"메모(선택)",pq_note_ph:"호텔 등급, 언어, 아이 동반, 식사…",pq_submit:"예약 요청 보내기",pq_min_date:"오늘부터 최소 2일 후",
pq_sent:"요청이 접수되었습니다: {code}. 팀이 날짜와 가격을 확정하면 「내 여행」에서 결제할 수 있습니다. 텔레그램이 연결되어 있으면 그곳으로도 알림이 갑니다.",
pq_open_trips:"내 여행 열기",st_requested:"확인 대기 중",tr_offer_note:"팀 메모",tr_decline_note:"사유",tr_price_ok:"가격 확정",
tr_pay:"결제하기",tr_pay_how:"결제 방법 선택",tr_pay_go:"계속",tr_pay_none:"지금 사용할 수 있는 결제 방법이 없습니다. 고객지원에 문의하세요.",
pq_e_date:"오늘부터 최소 2일 후 날짜를 선택하세요. 팀의 확인이 필요합니다.",pq_e_dup:"이 패키지와 날짜에 대한 요청이 이미 있습니다. 「내 여행」을 확인하세요.",
pq_e_many:"확인되지 않은 요청이 여러 개 있습니다. 먼저 답변을 기다려 주세요.",pq_e_wait:"날짜와 가격이 아직 확정되지 않았습니다. 팀의 답변을 기다려 주세요."
};
X.ms = {
pk_price_line:"dari {price} seorang",
pq_how:"Cara ia berfungsi: anda hantar permintaan tempahan → pasukan kami mengesahkan tarikh dan harga akhir, biasanya dalam 24 jam → anda bayar di Perjalanan saya. Tiada caj sekarang.",
pq_estimate:"Anggaran harga",pq_note:"Catatan (pilihan)",pq_note_ph:"Taraf hotel, bahasa, kanak-kanak, makanan…",pq_submit:"Hantar permintaan tempahan",pq_min_date:"Sekurang-kurangnya 2 hari dari hari ini",
pq_sent:"Permintaan diterima: {code}. Selepas pasukan kami mengesahkan tarikh dan harga, pembayaran dibuka di Perjalanan saya. Jika Telegram disambungkan, mesej juga dihantar ke sana.",
pq_open_trips:"Buka Perjalanan saya",st_requested:"Menunggu pengesahan",tr_offer_note:"Catatan pasukan kami",tr_decline_note:"Sebab",tr_price_ok:"Harga disahkan",
tr_pay:"Bayar",tr_pay_how:"Pilih cara bayar",tr_pay_go:"Teruskan",tr_pay_none:"Tiada kaedah pembayaran tersedia sekarang. Hubungi sokongan.",
pq_e_date:"Pilih tarikh sekurang-kurangnya 2 hari dari hari ini: pasukan kami perlu mengesahkannya.",pq_e_dup:"Anda sudah ada permintaan untuk pakej dan tarikh ini. Buka Perjalanan saya.",
pq_e_many:"Anda ada beberapa permintaan yang belum disahkan. Tunggu jawapan kami dahulu.",pq_e_wait:"Tarikh dan harga belum disahkan. Tunggu jawapan pasukan kami."
};
X.fr = {
pk_price_line:"à partir de {price} par personne",
pq_how:"Comment ça marche : vous envoyez une demande de réservation → notre équipe confirme la date et le prix final, généralement sous 24 heures → vous payez dans Mes voyages. Rien n’est débité maintenant.",
pq_estimate:"Prix estimé",pq_note:"Remarques (facultatif)",pq_note_ph:"Catégorie d’hôtel, langue, enfants, repas…",pq_submit:"Envoyer la demande",pq_min_date:"Au moins 2 jours à partir d’aujourd’hui",
pq_sent:"Demande reçue : {code}. Dès que notre équipe confirme la date et le prix, le paiement s’ouvre dans Mes voyages. Si Telegram est connecté, vous y recevrez aussi un message.",
pq_open_trips:"Ouvrir Mes voyages",st_requested:"En attente de confirmation",tr_offer_note:"Note de notre équipe",tr_decline_note:"Motif",tr_price_ok:"Prix confirmé",
tr_pay:"Payer",tr_pay_how:"Choisissez le mode de paiement",tr_pay_go:"Continuer",tr_pay_none:"Aucun mode de paiement n’est disponible pour le moment. Contactez le support.",
pq_e_date:"Choisissez une date au moins 2 jours après aujourd’hui : notre équipe doit la confirmer.",pq_e_dup:"Vous avez déjà une demande pour ce circuit et cette date. Ouvrez Mes voyages.",
pq_e_many:"Vous avez plusieurs demandes non confirmées. Attendez d’abord notre réponse.",pq_e_wait:"La date et le prix ne sont pas encore confirmés. Attendez la réponse de notre équipe."
};
X.de = {
pk_price_line:"ab {price} pro Person",
pq_how:"So funktioniert es: Sie senden eine Buchungsanfrage → unser Team bestätigt Datum und Endpreis, meist innerhalb von 24 Stunden → Sie bezahlen unter Meine Reisen. Jetzt wird nichts abgebucht.",
pq_estimate:"Geschätzter Preis",pq_note:"Anmerkungen (optional)",pq_note_ph:"Hotelkategorie, Sprache, Kinder, Verpflegung…",pq_submit:"Buchungsanfrage senden",pq_min_date:"Frühestens in 2 Tagen",
pq_sent:"Anfrage erhalten: {code}. Sobald unser Team Datum und Preis bestätigt, wird die Zahlung unter Meine Reisen freigeschaltet. Ist Telegram verbunden, erhalten Sie dort auch eine Nachricht.",
pq_open_trips:"Meine Reisen öffnen",st_requested:"Wartet auf Bestätigung",tr_offer_note:"Hinweis unseres Teams",tr_decline_note:"Grund",tr_price_ok:"Preis bestätigt",
tr_pay:"Bezahlen",tr_pay_how:"Zahlungsart wählen",tr_pay_go:"Weiter",tr_pay_none:"Derzeit ist keine Zahlungsart verfügbar. Wenden Sie sich an den Support.",
pq_e_date:"Wählen Sie ein Datum frühestens in 2 Tagen: unser Team muss es bestätigen.",pq_e_dup:"Sie haben für dieses Paket und Datum bereits eine Anfrage. Öffnen Sie Meine Reisen.",
pq_e_many:"Sie haben mehrere unbestätigte Anfragen. Bitte warten Sie zuerst auf unsere Antwort.",pq_e_wait:"Datum und Preis sind noch nicht bestätigt. Bitte warten Sie auf die Antwort unseres Teams."
};
for (var l in X) { W.I18N[l] = W.I18N[l] || {}; for (var k in X[l]) W.I18N[l][k] = X[l][k]; }
// Server xabarlari (o'zbekcha) → tarjima kalitlari
W.ERRMAP = (W.ERRMAP || []).concat([["Sayohat sanasi kamida 2 kundan", "pq_e_date"], ["Bu paket va sana uchun so'rovingiz bor", "pq_e_dup"], ["Tasdiqlanmagan so'rovlaringiz ko'p", "pq_e_many"], ["Narx va sana hali tasdiqlanmagan", "pq_e_wait"]]);
})(window);
