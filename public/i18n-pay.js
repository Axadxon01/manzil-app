/* Manzil — bank o'tkazmasi va chek yuklash (v3.3). i18n.js va i18n-ext.js dan keyin yuklanadi. */
(function (W) {
var X = {};
X.en = {
pm_bank:"Bank transfer (with receipt)",pm_soon:"soon",bt_title:"Bank transfer",bt_amount:"Amount to transfer",bt_uzs:"UZS",
bt_note:"Transfer the money to the details below, then upload the payment receipt (a screenshot or PDF). Put the booking code in the payment purpose.",
bt_recipient:"Recipient",bt_bank:"Bank",bt_account:"Account number",bt_mfo:"Bank code (MFO)",bt_inn:"Tax ID (INN)",bt_card:"Card number",bt_holder:"Card holder",bt_purpose:"Payment purpose",
bt_copy:"Copy",bt_copied:"Copied",bt_upload:"Upload receipt",bt_upload_hint:"JPG, PNG, WEBP or PDF, up to 6 MB.",bt_uploading:"Uploading…",bt_checking:"Checking the receipt…",
bt_ok:"The receipt passed the check. Your booking activates once our finance team confirms the money arrived.",bt_review:"Our finance team will check this receipt by hand, usually within an hour.",
bt_bad:"We found a problem with the receipt:",bt_rejected:"The receipt was rejected: {reason}",bt_again:"Upload another receipt",bt_paid:"Payment confirmed.",bt_open:"Payment details and receipt",
bt_tg:"You can also send the receipt to our Telegram bot: My trips → Send receipt.",bt_wait_pay:"Waiting for your transfer",
bt_p_duplicate:"this receipt was already used for another booking",bt_p_type:"the file doesn't look like a payment receipt",bt_p_status:"the receipt shows the payment as failed",bt_p_amount:"the amount is less than the booking total",
bt_p_recipient:"the money went to an account that isn't Manzil's",bt_p_date:"the receipt date doesn't match the booking",bt_p_txn:"this transaction was already used for another booking",
bt_e_type:"Upload a JPG, PNG, WEBP or PDF file.",bt_e_big:"The file is too large (up to 6 MB).",bt_e_off:"Bank transfer isn't available yet. Choose another method.",bt_e_wait:"The previous receipt is still being checked. Wait a minute.",bt_e_many:"Too many receipts for this booking. Contact support.",
gp_link:"Guide platform"
};
X.uz = {
pm_bank:"Bank o‘tkazmasi (chek bilan)",pm_soon:"tez orada",bt_title:"Bank o‘tkazmasi",bt_amount:"O‘tkaziladigan summa",bt_uzs:"so‘m",
bt_note:"Pulni quyidagi rekvizitlarga o‘tkazing, so‘ng to‘lov chekini (skrinshot yoki PDF) shu yerga yuklang. To‘lov maqsadiga bron kodini yozing.",
bt_recipient:"Qabul qiluvchi",bt_bank:"Bank",bt_account:"Hisob raqami",bt_mfo:"MFO",bt_inn:"INN (STIR)",bt_card:"Karta raqami",bt_holder:"Karta egasi",bt_purpose:"To‘lov maqsadi",
bt_copy:"Nusxalash",bt_copied:"Nusxalandi",bt_upload:"Chekni yuklash",bt_upload_hint:"JPG, PNG, WEBP yoki PDF, 6 MB gacha.",bt_uploading:"Yuklanmoqda…",bt_checking:"Chek tekshirilmoqda…",
bt_ok:"Chek tekshiruvdan o‘tdi. Moliya bo‘limi pul tushganini tasdiqlagach, bron faollashadi.",bt_review:"Chekni moliya bo‘limi qo‘lda tekshiradi, odatda 1 soat ichida.",
bt_bad:"Chekda muammo topildi:",bt_rejected:"Chek rad etildi: {reason}",bt_again:"Boshqa chek yuklash",bt_paid:"To‘lov tasdiqlandi.",bt_open:"To‘lov rekvizitlari va chek",
bt_tg:"Chekni Telegram botimizga ham yuborishingiz mumkin: Sayohatlarim → Chek yuborish.",bt_wait_pay:"O‘tkazmangiz kutilmoqda",
bt_p_duplicate:"bu chek boshqa bron uchun ishlatilgan",bt_p_type:"fayl to‘lov chekiga o‘xshamaydi",bt_p_status:"chekda to‘lov muvaffaqiyatsiz deb ko‘rsatilgan",bt_p_amount:"summa bron summasidan kam",
bt_p_recipient:"pul Manzil hisobiga emas, boshqa hisobga o‘tkazilgan",bt_p_date:"chek sanasi bronga mos emas",bt_p_txn:"bu tranzaksiya boshqa bronda ishlatilgan",
bt_e_type:"JPG, PNG, WEBP yoki PDF fayl yuklang.",bt_e_big:"Fayl juda katta (6 MB gacha).",bt_e_off:"Bank o‘tkazmasi hozircha mavjud emas. Boshqa usulni tanlang.",bt_e_wait:"Oldingi chek hali tekshirilmoqda. Bir daqiqa kuting.",bt_e_many:"Bu bron uchun juda ko‘p chek yuklangan. Support bilan bog‘laning.",
gp_link:"Gidlar platformasi"
};
X.ru = {
pm_bank:"Банковский перевод (с чеком)",pm_soon:"скоро",bt_title:"Банковский перевод",bt_amount:"Сумма перевода",bt_uzs:"сум",
bt_note:"Переведите деньги по реквизитам ниже и загрузите чек (скриншот или PDF). В назначении платежа укажите код брони.",
bt_recipient:"Получатель",bt_bank:"Банк",bt_account:"Расчётный счёт",bt_mfo:"МФО",bt_inn:"ИНН",bt_card:"Номер карты",bt_holder:"Владелец карты",bt_purpose:"Назначение платежа",
bt_copy:"Копировать",bt_copied:"Скопировано",bt_upload:"Загрузить чек",bt_upload_hint:"JPG, PNG, WEBP или PDF, до 6 МБ.",bt_uploading:"Загрузка…",bt_checking:"Проверяем чек…",
bt_ok:"Чек прошёл проверку. Бронь активируется, когда финансовый отдел подтвердит поступление денег.",bt_review:"Финансовый отдел проверит чек вручную, обычно в течение часа.",
bt_bad:"В чеке найдена проблема:",bt_rejected:"Чек отклонён: {reason}",bt_again:"Загрузить другой чек",bt_paid:"Оплата подтверждена.",bt_open:"Реквизиты и чек",
bt_tg:"Чек можно отправить и в наш Telegram-бот: Мои поездки → Отправить чек.",bt_wait_pay:"Ожидаем ваш перевод",
bt_p_duplicate:"этот чек уже использован для другой брони",bt_p_type:"файл не похож на платёжный чек",bt_p_status:"в чеке платёж указан как неуспешный",bt_p_amount:"сумма меньше суммы брони",
bt_p_recipient:"деньги переведены не на счёт Manzil",bt_p_date:"дата чека не совпадает с бронью",bt_p_txn:"эта транзакция уже использована для другой брони",
bt_e_type:"Загрузите файл JPG, PNG, WEBP или PDF.",bt_e_big:"Файл слишком большой (до 6 МБ).",bt_e_off:"Банковский перевод пока недоступен. Выберите другой способ.",bt_e_wait:"Предыдущий чек ещё проверяется. Подождите минуту.",bt_e_many:"Для этой брони загружено слишком много чеков. Напишите в поддержку.",
gp_link:"Платформа гидов"
};
X.es = {
pm_bank:"Transferencia bancaria (con comprobante)",pm_soon:"pronto",bt_title:"Transferencia bancaria",bt_amount:"Importe a transferir",bt_uzs:"UZS",
bt_note:"Transfiere el dinero a los datos de abajo y sube el comprobante de pago (captura o PDF). Indica el código de la reserva en el concepto.",
bt_recipient:"Beneficiario",bt_bank:"Banco",bt_account:"Número de cuenta",bt_mfo:"Código del banco (MFO)",bt_inn:"NIF (INN)",bt_card:"Número de tarjeta",bt_holder:"Titular de la tarjeta",bt_purpose:"Concepto",
bt_copy:"Copiar",bt_copied:"Copiado",bt_upload:"Subir comprobante",bt_upload_hint:"JPG, PNG, WEBP o PDF, hasta 6 MB.",bt_uploading:"Subiendo…",bt_checking:"Revisando el comprobante…",
bt_ok:"El comprobante superó la revisión. Tu reserva se activará cuando nuestro equipo financiero confirme que llegó el dinero.",bt_review:"Nuestro equipo financiero revisará el comprobante a mano, normalmente en menos de una hora.",
bt_bad:"Encontramos un problema en el comprobante:",bt_rejected:"Comprobante rechazado: {reason}",bt_again:"Subir otro comprobante",bt_paid:"Pago confirmado.",bt_open:"Datos de pago y comprobante",
bt_tg:"También puedes enviar el comprobante a nuestro bot de Telegram: Mis viajes → Enviar comprobante.",bt_wait_pay:"Esperando tu transferencia",
bt_p_duplicate:"este comprobante ya se usó para otra reserva",bt_p_type:"el archivo no parece un comprobante de pago",bt_p_status:"el comprobante muestra el pago como fallido",bt_p_amount:"el importe es menor que el total de la reserva",
bt_p_recipient:"el dinero fue a una cuenta que no es de Manzil",bt_p_date:"la fecha del comprobante no coincide con la reserva",bt_p_txn:"esta transacción ya se usó para otra reserva",
bt_e_type:"Sube un archivo JPG, PNG, WEBP o PDF.",bt_e_big:"El archivo es demasiado grande (hasta 6 MB).",bt_e_off:"La transferencia bancaria aún no está disponible. Elige otro método.",bt_e_wait:"El comprobante anterior aún se está revisando. Espera un minuto.",bt_e_many:"Hay demasiados comprobantes para esta reserva. Contacta con soporte.",
gp_link:"Plataforma de guías"
};
X.ar = {
pm_bank:"تحويل بنكي (مع إيصال)",pm_soon:"قريبًا",bt_title:"تحويل بنكي",bt_amount:"المبلغ المطلوب تحويله",bt_uzs:"سوم",
bt_note:"حوّل المبلغ إلى البيانات أدناه، ثم ارفع إيصال الدفع (لقطة شاشة أو PDF). اكتب رمز الحجز في الغرض من الدفع.",
bt_recipient:"المستفيد",bt_bank:"البنك",bt_account:"رقم الحساب",bt_mfo:"رمز البنك (MFO)",bt_inn:"الرقم الضريبي (INN)",bt_card:"رقم البطاقة",bt_holder:"صاحب البطاقة",bt_purpose:"الغرض من الدفع",
bt_copy:"نسخ",bt_copied:"تم النسخ",bt_upload:"رفع الإيصال",bt_upload_hint:"JPG أو PNG أو WEBP أو PDF، حتى 6 ميغابايت.",bt_uploading:"جارٍ الرفع…",bt_checking:"جارٍ التحقق من الإيصال…",
bt_ok:"اجتاز الإيصال التحقق. سيتم تفعيل حجزك بعد أن يؤكد القسم المالي وصول المبلغ.",bt_review:"سيتحقق القسم المالي من الإيصال يدويًا، عادة خلال ساعة.",
bt_bad:"وجدنا مشكلة في الإيصال:",bt_rejected:"تم رفض الإيصال: {reason}",bt_again:"رفع إيصال آخر",bt_paid:"تم تأكيد الدفع.",bt_open:"بيانات الدفع والإيصال",
bt_tg:"يمكنك أيضًا إرسال الإيصال إلى بوت تيليجرام: رحلاتي ← إرسال الإيصال.",bt_wait_pay:"بانتظار تحويلك",
bt_p_duplicate:"استُخدم هذا الإيصال لحجز آخر",bt_p_type:"الملف لا يبدو إيصال دفع",bt_p_status:"يُظهر الإيصال أن الدفع فشل",bt_p_amount:"المبلغ أقل من إجمالي الحجز",
bt_p_recipient:"تم تحويل المبلغ إلى حساب لا يخص Manzil",bt_p_date:"تاريخ الإيصال لا يتوافق مع الحجز",bt_p_txn:"استُخدمت هذه المعاملة لحجز آخر",
bt_e_type:"ارفع ملف JPG أو PNG أو WEBP أو PDF.",bt_e_big:"الملف كبير جدًا (حتى 6 ميغابايت).",bt_e_off:"التحويل البنكي غير متاح بعد. اختر طريقة أخرى.",bt_e_wait:"لا يزال الإيصال السابق قيد التحقق. انتظر دقيقة.",bt_e_many:"تم رفع عدد كبير من الإيصالات لهذا الحجز. تواصل مع الدعم.",
gp_link:"منصة المرشدين"
};
X.hi = {
pm_bank:"बैंक ट्रांसफ़र (रसीद के साथ)",pm_soon:"जल्द",bt_title:"बैंक ट्रांसफ़र",bt_amount:"ट्रांसफ़र की जाने वाली राशि",bt_uzs:"UZS",
bt_note:"नीचे दिए विवरण पर पैसे भेजें, फिर भुगतान की रसीद (स्क्रीनशॉट या PDF) यहाँ अपलोड करें। भुगतान के उद्देश्य में बुकिंग कोड लिखें।",
bt_recipient:"प्राप्तकर्ता",bt_bank:"बैंक",bt_account:"खाता संख्या",bt_mfo:"बैंक कोड (MFO)",bt_inn:"कर पहचान (INN)",bt_card:"कार्ड नंबर",bt_holder:"कार्डधारक",bt_purpose:"भुगतान का उद्देश्य",
bt_copy:"कॉपी करें",bt_copied:"कॉपी हो गया",bt_upload:"रसीद अपलोड करें",bt_upload_hint:"JPG, PNG, WEBP या PDF, 6 MB तक।",bt_uploading:"अपलोड हो रहा है…",bt_checking:"रसीद की जाँच हो रही है…",
bt_ok:"रसीद जाँच में पास हो गई। हमारी वित्त टीम पैसे मिलने की पुष्टि करेगी, तब आपकी बुकिंग सक्रिय होगी।",bt_review:"हमारी वित्त टीम रसीद की हाथ से जाँच करेगी, आमतौर पर एक घंटे के भीतर।",
bt_bad:"रसीद में समस्या मिली:",bt_rejected:"रसीद अस्वीकार हुई: {reason}",bt_again:"दूसरी रसीद अपलोड करें",bt_paid:"भुगतान की पुष्टि हो गई।",bt_open:"भुगतान विवरण और रसीद",
bt_tg:"आप रसीद हमारे Telegram बॉट को भी भेज सकते हैं: मेरी यात्राएँ → रसीद भेजें।",bt_wait_pay:"आपके ट्रांसफ़र की प्रतीक्षा है",
bt_p_duplicate:"यह रसीद किसी दूसरी बुकिंग के लिए इस्तेमाल हो चुकी है",bt_p_type:"फ़ाइल भुगतान की रसीद जैसी नहीं लगती",bt_p_status:"रसीद में भुगतान विफल दिखाया गया है",bt_p_amount:"राशि बुकिंग की कुल राशि से कम है",
bt_p_recipient:"पैसे Manzil के खाते में नहीं, किसी दूसरे खाते में गए",bt_p_date:"रसीद की तारीख बुकिंग से मेल नहीं खाती",bt_p_txn:"यह लेनदेन किसी दूसरी बुकिंग में इस्तेमाल हो चुका है",
bt_e_type:"JPG, PNG, WEBP या PDF फ़ाइल अपलोड करें।",bt_e_big:"फ़ाइल बहुत बड़ी है (6 MB तक)।",bt_e_off:"बैंक ट्रांसफ़र अभी उपलब्ध नहीं है। कोई दूसरा तरीका चुनें।",bt_e_wait:"पिछली रसीद की जाँच अभी चल रही है। एक मिनट रुकें।",bt_e_many:"इस बुकिंग के लिए बहुत सारी रसीदें अपलोड हुई हैं। सहायता से संपर्क करें।",
gp_link:"गाइड प्लेटफ़ॉर्म"
};
X.zh = {
pm_bank:"银行转账（需上传凭证）",pm_soon:"即将推出",bt_title:"银行转账",bt_amount:"转账金额",bt_uzs:"苏姆",
bt_note:"请按以下信息转账，然后上传付款凭证（截图或 PDF）。请在付款附言中填写预订编号。",
bt_recipient:"收款人",bt_bank:"银行",bt_account:"账号",bt_mfo:"银行代码（MFO）",bt_inn:"税号（INN）",bt_card:"卡号",bt_holder:"持卡人",bt_purpose:"付款附言",
bt_copy:"复制",bt_copied:"已复制",bt_upload:"上传凭证",bt_upload_hint:"JPG、PNG、WEBP 或 PDF，最大 6 MB。",bt_uploading:"正在上传…",bt_checking:"正在核对凭证…",
bt_ok:"凭证已通过核对。财务团队确认到账后，您的预订即会生效。",bt_review:"财务团队将人工核对此凭证，通常在一小时内完成。",
bt_bad:"凭证有问题：",bt_rejected:"凭证被拒绝：{reason}",bt_again:"上传其他凭证",bt_paid:"付款已确认。",bt_open:"付款信息和凭证",
bt_tg:"您也可以把凭证发送到我们的 Telegram 机器人：我的行程 → 发送凭证。",bt_wait_pay:"等待您的转账",
bt_p_duplicate:"此凭证已用于其他预订",bt_p_type:"该文件看起来不是付款凭证",bt_p_status:"凭证显示付款失败",bt_p_amount:"金额少于预订总额",
bt_p_recipient:"款项转入了非 Manzil 的账户",bt_p_date:"凭证日期与预订不符",bt_p_txn:"此交易已用于其他预订",
bt_e_type:"请上传 JPG、PNG、WEBP 或 PDF 文件。",bt_e_big:"文件太大（最大 6 MB）。",bt_e_off:"暂不支持银行转账，请选择其他方式。",bt_e_wait:"上一张凭证仍在核对中，请稍候一分钟。",bt_e_many:"此预订上传的凭证过多，请联系客服。",
gp_link:"导游平台"
};
X.ja = {
pm_bank:"銀行振込（控えの提出あり）",pm_soon:"近日対応",bt_title:"銀行振込",bt_amount:"振込金額",bt_uzs:"スム",
bt_note:"下記の口座に振り込み、振込控え（スクリーンショットまたはPDF）をアップロードしてください。振込の備考欄に予約番号を入力してください。",
bt_recipient:"受取人",bt_bank:"銀行",bt_account:"口座番号",bt_mfo:"銀行コード（MFO）",bt_inn:"納税者番号（INN）",bt_card:"カード番号",bt_holder:"カード名義",bt_purpose:"備考（振込目的）",
bt_copy:"コピー",bt_copied:"コピーしました",bt_upload:"控えをアップロード",bt_upload_hint:"JPG・PNG・WEBP・PDF、6 MBまで。",bt_uploading:"アップロード中…",bt_checking:"控えを確認しています…",
bt_ok:"控えの確認が完了しました。経理担当が入金を確認すると、予約が有効になります。",bt_review:"経理担当が控えを手動で確認します。通常1時間以内です。",
bt_bad:"控えに問題が見つかりました：",bt_rejected:"控えが却下されました：{reason}",bt_again:"別の控えをアップロード",bt_paid:"支払いが確認されました。",bt_open:"振込先と控え",
bt_tg:"Telegramボットにも控えを送れます：マイ旅行 → 控えを送る。",bt_wait_pay:"お振込をお待ちしています",
bt_p_duplicate:"この控えは別の予約で使用済みです",bt_p_type:"ファイルが振込控えに見えません",bt_p_status:"控えに支払い失敗と表示されています",bt_p_amount:"金額が予約の合計より少ないです",
bt_p_recipient:"Manzil以外の口座に振り込まれています",bt_p_date:"控えの日付が予約と一致しません",bt_p_txn:"この取引は別の予約で使用済みです",
bt_e_type:"JPG・PNG・WEBP・PDFのファイルをアップロードしてください。",bt_e_big:"ファイルが大きすぎます（6 MBまで）。",bt_e_off:"銀行振込はまだご利用いただけません。別の方法を選んでください。",bt_e_wait:"前の控えを確認中です。1分ほどお待ちください。",bt_e_many:"この予約の控えが多すぎます。サポートにご連絡ください。",
gp_link:"ガイド用プラットフォーム"
};
X.ko = {
pm_bank:"계좌 이체 (영수증 제출)",pm_soon:"곧 제공",bt_title:"계좌 이체",bt_amount:"이체 금액",bt_uzs:"숨",
bt_note:"아래 계좌로 송금한 뒤 결제 영수증(스크린샷 또는 PDF)을 업로드하세요. 송금 메모에 예약 코드를 적어 주세요.",
bt_recipient:"받는 분",bt_bank:"은행",bt_account:"계좌번호",bt_mfo:"은행 코드(MFO)",bt_inn:"납세자 번호(INN)",bt_card:"카드 번호",bt_holder:"카드 소유자",bt_purpose:"송금 메모",
bt_copy:"복사",bt_copied:"복사됨",bt_upload:"영수증 업로드",bt_upload_hint:"JPG, PNG, WEBP 또는 PDF, 최대 6MB.",bt_uploading:"업로드 중…",bt_checking:"영수증을 확인하는 중…",
bt_ok:"영수증 확인을 통과했습니다. 재무팀이 입금을 확인하면 예약이 활성화됩니다.",bt_review:"재무팀이 영수증을 직접 확인합니다. 보통 1시간 이내입니다.",
bt_bad:"영수증에서 문제가 발견되었습니다:",bt_rejected:"영수증이 거절되었습니다: {reason}",bt_again:"다른 영수증 업로드",bt_paid:"결제가 확인되었습니다.",bt_open:"결제 정보와 영수증",
bt_tg:"텔레그램 봇으로도 영수증을 보낼 수 있습니다: 내 여행 → 영수증 보내기.",bt_wait_pay:"이체를 기다리고 있습니다",
bt_p_duplicate:"이 영수증은 다른 예약에 이미 사용되었습니다",bt_p_type:"파일이 결제 영수증으로 보이지 않습니다",bt_p_status:"영수증에 결제 실패로 표시되어 있습니다",bt_p_amount:"금액이 예약 총액보다 적습니다",
bt_p_recipient:"Manzil이 아닌 다른 계좌로 송금되었습니다",bt_p_date:"영수증 날짜가 예약과 맞지 않습니다",bt_p_txn:"이 거래는 다른 예약에 이미 사용되었습니다",
bt_e_type:"JPG, PNG, WEBP 또는 PDF 파일을 올려 주세요.",bt_e_big:"파일이 너무 큽니다(최대 6MB).",bt_e_off:"계좌 이체는 아직 이용할 수 없습니다. 다른 방법을 선택하세요.",bt_e_wait:"이전 영수증을 아직 확인 중입니다. 1분만 기다려 주세요.",bt_e_many:"이 예약에 업로드된 영수증이 너무 많습니다. 고객지원에 문의하세요.",
gp_link:"가이드 플랫폼"
};
X.ms = {
pm_bank:"Pindahan bank (dengan resit)",pm_soon:"akan datang",bt_title:"Pindahan bank",bt_amount:"Jumlah untuk dipindahkan",bt_uzs:"UZS",
bt_note:"Pindahkan wang ke butiran di bawah, kemudian muat naik resit pembayaran (tangkapan skrin atau PDF). Tulis kod tempahan dalam tujuan pembayaran.",
bt_recipient:"Penerima",bt_bank:"Bank",bt_account:"Nombor akaun",bt_mfo:"Kod bank (MFO)",bt_inn:"Nombor cukai (INN)",bt_card:"Nombor kad",bt_holder:"Pemegang kad",bt_purpose:"Tujuan pembayaran",
bt_copy:"Salin",bt_copied:"Disalin",bt_upload:"Muat naik resit",bt_upload_hint:"JPG, PNG, WEBP atau PDF, sehingga 6 MB.",bt_uploading:"Sedang memuat naik…",bt_checking:"Sedang menyemak resit…",
bt_ok:"Resit lulus semakan. Tempahan anda aktif sebaik pasukan kewangan kami mengesahkan wang telah diterima.",bt_review:"Pasukan kewangan kami akan menyemak resit secara manual, biasanya dalam masa sejam.",
bt_bad:"Kami menemui masalah pada resit:",bt_rejected:"Resit ditolak: {reason}",bt_again:"Muat naik resit lain",bt_paid:"Pembayaran disahkan.",bt_open:"Butiran pembayaran dan resit",
bt_tg:"Anda juga boleh menghantar resit kepada bot Telegram kami: Perjalanan saya → Hantar resit.",bt_wait_pay:"Menunggu pindahan anda",
bt_p_duplicate:"resit ini sudah digunakan untuk tempahan lain",bt_p_type:"fail ini tidak kelihatan seperti resit pembayaran",bt_p_status:"resit menunjukkan pembayaran gagal",bt_p_amount:"jumlahnya kurang daripada jumlah tempahan",
bt_p_recipient:"wang dipindahkan ke akaun yang bukan milik Manzil",bt_p_date:"tarikh resit tidak sepadan dengan tempahan",bt_p_txn:"transaksi ini sudah digunakan untuk tempahan lain",
bt_e_type:"Muat naik fail JPG, PNG, WEBP atau PDF.",bt_e_big:"Fail terlalu besar (sehingga 6 MB).",bt_e_off:"Pindahan bank belum tersedia. Pilih kaedah lain.",bt_e_wait:"Resit sebelum ini masih disemak. Tunggu seminit.",bt_e_many:"Terlalu banyak resit untuk tempahan ini. Hubungi sokongan.",
gp_link:"Platform pemandu pelancong"
};
X.fr = {
pm_bank:"Virement bancaire (avec reçu)",pm_soon:"bientôt",bt_title:"Virement bancaire",bt_amount:"Montant à virer",bt_uzs:"UZS",
bt_note:"Virez l’argent aux coordonnées ci-dessous, puis téléversez le reçu de paiement (capture d’écran ou PDF). Indiquez le code de réservation dans le motif du virement.",
bt_recipient:"Bénéficiaire",bt_bank:"Banque",bt_account:"Numéro de compte",bt_mfo:"Code banque (MFO)",bt_inn:"N° fiscal (INN)",bt_card:"Numéro de carte",bt_holder:"Titulaire de la carte",bt_purpose:"Motif du virement",
bt_copy:"Copier",bt_copied:"Copié",bt_upload:"Téléverser le reçu",bt_upload_hint:"JPG, PNG, WEBP ou PDF, 6 Mo maximum.",bt_uploading:"Téléversement…",bt_checking:"Vérification du reçu…",
bt_ok:"Le reçu a passé la vérification. Votre réservation sera activée dès que notre service financier aura confirmé la réception des fonds.",bt_review:"Notre service financier vérifiera ce reçu manuellement, en général dans l’heure.",
bt_bad:"Nous avons trouvé un problème sur le reçu :",bt_rejected:"Reçu refusé : {reason}",bt_again:"Téléverser un autre reçu",bt_paid:"Paiement confirmé.",bt_open:"Coordonnées et reçu",
bt_tg:"Vous pouvez aussi envoyer le reçu à notre bot Telegram : Mes voyages → Envoyer le reçu.",bt_wait_pay:"En attente de votre virement",
bt_p_duplicate:"ce reçu a déjà servi pour une autre réservation",bt_p_type:"le fichier ne ressemble pas à un reçu de paiement",bt_p_status:"le reçu indique que le paiement a échoué",bt_p_amount:"le montant est inférieur au total de la réservation",
bt_p_recipient:"l’argent a été envoyé sur un compte qui n’est pas celui de Manzil",bt_p_date:"la date du reçu ne correspond pas à la réservation",bt_p_txn:"cette transaction a déjà servi pour une autre réservation",
bt_e_type:"Téléversez un fichier JPG, PNG, WEBP ou PDF.",bt_e_big:"Le fichier est trop volumineux (6 Mo maximum).",bt_e_off:"Le virement bancaire n’est pas encore disponible. Choisissez un autre moyen.",bt_e_wait:"Le reçu précédent est encore en cours de vérification. Patientez une minute.",bt_e_many:"Trop de reçus pour cette réservation. Contactez l’assistance.",
gp_link:"Plateforme des guides"
};
X.de = {
pm_bank:"Banküberweisung (mit Beleg)",pm_soon:"bald",bt_title:"Banküberweisung",bt_amount:"Zu überweisender Betrag",bt_uzs:"UZS",
bt_note:"Überweisen Sie das Geld an die Angaben unten und laden Sie dann den Zahlungsbeleg hoch (Screenshot oder PDF). Geben Sie den Buchungscode als Verwendungszweck an.",
bt_recipient:"Empfänger",bt_bank:"Bank",bt_account:"Kontonummer",bt_mfo:"Bankleitzahl (MFO)",bt_inn:"Steuernummer (INN)",bt_card:"Kartennummer",bt_holder:"Karteninhaber",bt_purpose:"Verwendungszweck",
bt_copy:"Kopieren",bt_copied:"Kopiert",bt_upload:"Beleg hochladen",bt_upload_hint:"JPG, PNG, WEBP oder PDF, bis 6 MB.",bt_uploading:"Wird hochgeladen…",bt_checking:"Beleg wird geprüft…",
bt_ok:"Der Beleg hat die Prüfung bestanden. Ihre Buchung wird aktiv, sobald unser Finanzteam den Zahlungseingang bestätigt.",bt_review:"Unser Finanzteam prüft den Beleg von Hand, meist innerhalb einer Stunde.",
bt_bad:"Wir haben ein Problem mit dem Beleg gefunden:",bt_rejected:"Beleg abgelehnt: {reason}",bt_again:"Anderen Beleg hochladen",bt_paid:"Zahlung bestätigt.",bt_open:"Zahlungsdaten und Beleg",
bt_tg:"Sie können den Beleg auch an unseren Telegram-Bot senden: Meine Reisen → Beleg senden.",bt_wait_pay:"Wir warten auf Ihre Überweisung",
bt_p_duplicate:"dieser Beleg wurde bereits für eine andere Buchung verwendet",bt_p_type:"die Datei sieht nicht wie ein Zahlungsbeleg aus",bt_p_status:"der Beleg zeigt die Zahlung als fehlgeschlagen",bt_p_amount:"der Betrag ist geringer als der Buchungsbetrag",
bt_p_recipient:"das Geld ging auf ein Konto, das nicht Manzil gehört",bt_p_date:"das Belegdatum passt nicht zur Buchung",bt_p_txn:"diese Transaktion wurde bereits für eine andere Buchung verwendet",
bt_e_type:"Laden Sie eine JPG-, PNG-, WEBP- oder PDF-Datei hoch.",bt_e_big:"Die Datei ist zu groß (bis 6 MB).",bt_e_off:"Banküberweisung ist noch nicht verfügbar. Wählen Sie eine andere Methode.",bt_e_wait:"Der vorherige Beleg wird noch geprüft. Warten Sie eine Minute.",bt_e_many:"Zu viele Belege für diese Buchung. Wenden Sie sich an den Support.",
gp_link:"Plattform für Guides"
};
for (var l in X) { W.I18N[l] = W.I18N[l] || {}; for (var k in X[l]) W.I18N[l][k] = X[l][k]; }
// Server xabarlari (o'zbekcha) → tarjima kalitlari
W.ERRMAP = (W.ERRMAP || []).concat([["Faqat JPG, PNG", "bt_e_type"], ["Fayl juda katta", "bt_e_big"], ["So'rov hajmi katta", "bt_e_big"], ["Bank o'tkazmasi hozircha", "bt_e_off"], ["Oldingi chek hali", "bt_e_wait"], ["Bu bron uchun juda ko'p chek", "bt_e_many"]]);
})(window);
