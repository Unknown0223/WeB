# "Qarzi bor" tugmasi – terminal loglari

Bot ishlaganda **"Qarzi bor"** tugmasi bosilgandan keyingi barcha jarayonlar terminalda `[QARZI_BOR]` va tekshirish uchun `[REJA]` prefiksi bilan chiqadi.

## Terminalda ko‘rish

- Botni ishga tushiring (masalan `node bot.js` yoki `npm start`).
- Telegramda Kassir, Operator yoki Nazoratchi (Supervisor) **"⚠️ Qarzi bor"** tugmasini bosing.
- Terminalda quyidagiga o‘xshash satrlar paydo bo‘ladi:

```
[QARZI_BOR] ═══ KASSIR "Qarzi bor" tugmasi bosildi. callback=cashier_debt_123, userId=..., chatId=..., requestId=123
[QARZI_BOR] [KASSIR] 1. Tugma bosildi → State: AUTO_DETECT_DEBT_INPUT. So'rov: REQ-..., brend: ..., filial: .... Keyingi: Kassir umumiy summa / agent bo'yicha / Excel yuboradi.
```

Operator uchun:

```
[QARZI_BOR] ═══ OPERATOR "Qarzi bor" tugmasi bosildi. callback=operator_debt_123_456, ...
[QARZI_BOR] [OPERATOR] 1. Tugma bosildi → State: UPLOAD_DEBT_EXCEL. ... Keyingi: Operator Excel fayl yuboradi.
```

Nazoratchi (Supervisor) uchun:

```
[QARZI_BOR] ═══ SUPERVISOR "Qarzi bor" tugmasi bosildi. callback=supervisor_debt_123_cashier, ...
[QARZI_BOR] [SUPERVISOR] Tugma bosildi → State: UPLOAD_DEBT_EXCEL. requestId=123, approvalStage=cashier. Keyingi: Excel yuboriladi.
```

## Jarayon bo‘yicha loglar

| Qadam | Log prefiksi | Nima yoziladi |
|-------|--------------|----------------|
| 1. Tugma bosildi | `[QARZI_BOR] ═══` | Kim (Kassir/Operator/Supervisor), requestId, userId, chatId |
| 2. State | `[KASSIR] 1.` / `[OPERATOR] 1.` / `[SUPERVISOR]` | Qaysi state, keyingi qadam |
| 3. Kirish (Kassir) | `[KASSIR] Umumiy summa...` / `Agent bo'yicha...` | Summa yoki agentlar kiritildi → sendDebtResponse |
| 4. Excel | `[DEBT_EXCEL]` | Excel qabul qilindi, preview, tasdiqlash (bir xil / farq) |
| 5. sendDebtResponse | `[KASSIR] 2.` / `[OPERATOR] 2.` | Ma’lumotlar (excel qatorlar, totalAmount) |
| 6. Teskari jarayon (SET, farq) | `[KASSIR] 3.` / `[OPERATOR] 3.` | Xabarlar: Menejer, Rahbarlar, Final; Status → REVERSED_BY_* |
| 7. [REJA] | `[REJA] [KASSIR]` / `[REJA] [OPERATOR]` | Link1/Link2 mavjudligi, logApproval reversed (telegraph_url, differences_telegraph_url) |
| 8. Telegraph | `Telegraph sahifa yaratildi` | Yaratilgan link (qarzdorlik ro'yxati, farqlar sahifasi) |
| 9. Xabar yuborildi | `Xabar yuborildi →` | Kimga: Menejer (shaxsiy), Rahbarlar guruhi, Final guruh |
| 10. Status | `5. Status yangilandi →` | DEBT_FOUND_* yoki REVERSED_BY_* |

## Ikki alohida link (reja)

- **Link 1 – So‘rov ro‘yxati:** Menejer yuborgan so‘rovdagi qarzdorlik ro‘yxati (Telegraph – createDebtDataPage).
- **Link 2 – Qaytarilgan farqlar:** Kassir/Operator yuborgan ma’lumotlar bilan farq (Telegraph – createDifferencesPage). Teskari jarayon xabarlarida ikkala link ham ko‘rsatiladi; shablon ichida Link 2 qo‘shiladi.

## DB da saqlash

Teskari jarayonda `logApproval(..., 'reversed', note)` chaqirilganda `note` da quyidagilar yoziladi (audit/DB uchun):

- `telegraph_url` – Link 1 (so‘rov ro‘yxati)
- `differences_telegraph_url` – Link 2 (qaytarilgan farqlar)
- `total_difference`, `differences_count`, `comparison_result` va boshqa maydonlar

## Chat toza

Kassir “Qarzi bor” bosganda: namuna xabarlari va xatolik xabarlari (first_example_message_id, last_error_message_id) sendDebtResponse dan oldin o‘chiriladi – chatda faqat kerakli xabarlar qoladi.

## Rol bo‘yicha qisqa oqim

| Rol | Qarzi bor bosganda | Keyingi qadam | Teskari (SET, farq) |
|-----|--------------------|---------------|----------------------|
| **Kassir** | State: AUTO_DETECT_DEBT_INPUT → umumiy summa / agent / Excel | Excel yoki summa kiritiladi → preview → Tasdiqlash | Menejer (edit), Rahbarlar, Final (yangi xabar); REVERSED_BY_CASHIER |
| **Operator** | State: UPLOAD_DEBT_EXCEL → Excel yuborish | Excel → preview → Tasdiqlash (bir xil / farq) | Menejer (edit), Rahbarlar, Final; REVERSED_BY_OPERATOR |
| **Nazoratchi (Supervisor)** | State: UPLOAD_DEBT_EXCEL → Excel yuborish | Operator bilan bir xil (Excel → preview → Tasdiqlash) | Operator.sendDebtResponse (bir xil mantiq); teskari xabarlar Menejer, Rahbarlar, Final |
| **Menejer** | – | Teskari xabar: bitta xabar **edit** orqali yangilanadi (preview xabari) |
| **Rahbarlar** | – | Teskari xabar: **yangi** xabar (to‘liq matn + Link 1 + Link 2) |
| **Final guruh** | – | Teskari xabar: **yangi** xabar (to‘liq matn + Link 1 + Link 2) |

## Kimga qanday xabar boradi

- **Oddiy "Qarzi bor" (farq yo‘q yoki NORMAL):** Menejer (shaxsiy chat). SET + farq bo‘lsa: Menejer + Rahbarlar guruhi.
- **Teskari jarayon (SET, farq bor):** Menejer (preview xabari **edit**), Rahbarlar guruhi va Final guruh (**yangi** xabar). Status: REVERSED_BY_CASHIER / REVERSED_BY_OPERATOR.
- **Linklar:** Xabarlarda Link 1 (So‘rov ro‘yxati) va Link 2 (Qaytarilgan farqlar) ishlatiladi; ikkalasi ham shablon orqali qo‘shiladi.

## Reja 2: NORMAL da "Yuborish" – menejer edit, final guruhga xabar

**Maqsad:** NORMAL so‘rovda kassir "Yuborish" tugmasini bosganda menejer preview xabari teskari jarayon + link bilan edit qilinsin, final guruhga linkli xabar yuborilsin (rahbarlarga NORMAL da yuborilmaydi).

**Tekshirish uchun loglar (terminalda `[REJA_2]` qidiring):**

| Qadam | Log prefiksi | Nima ko‘rinadi |
|-------|--------------|----------------|
| 1. Yuborish bosildi | `[CONFIRM_REVERSE] [REJA_2]` | `Yuborish bosildi: requestId=..., type=NORMAL, NORMAL – menejer edit, final guruhga xabar. completeCashierReverseProcess chaqiriladi.` |
| 2. Teskari jarayon | `[COMPLETE_REVERSE] [REJA_2]` | `Teskari jarayon boshlandi: requestId=..., type=NORMAL, NORMAL=true. Menejer edit + final (rahbarlarga yo'q).` |
| 3. Menejer edit | `[COMPLETE_REVERSE] [REJA_2]` | `Menejer preview xabari edit qilindi (teskari jarayon + link): requestId=...` |
| 4. Final yuborildi | `[COMPLETE_REVERSE] [REJA_2]` | `Final guruhga linkli xabar yuborildi: requestId=..., type=NORMAL` |
| 5. Yakunlandi | `[COMPLETE_REVERSE] [REJA_2]` | `Teskari jarayon yakunlandi: requestId=..., menejer_edit=ha, final_yuborildi=true` |

**Test:** NORMAL so‘rov → "Qarzi bor" → qiymat kiritish → "Yuborish" bosish → menejer xabari teskari jarayon bilan yangilanadi, final guruhda yangi xabar chiqadi. Rahbarlar guruhida NORMAL uchun xabar bo‘lmasligi kerak.

---

## Faqat [QARZI_BOR] va [REJA] loglarini filtrlash

Windows (PowerShell):

```powershell
node bot.js 2>&1 | Select-String "QARZI_BOR|REJA"
```

Linux/Mac:

```bash
node bot.js 2>&1 | grep -E "QARZI_BOR|REJA"
```

**Reja 2 loglarini ko‘rish:** `REJA_2` qidiring yoki `CONFIRM_REVERSE|COMPLETE_REVERSE` bilan birga.

---

## Reja 3: NORMAL da "Qaytadan kiritish" + chat toza

**Maqsad:** "Qaytadan kiritish" bosilganda oraliq xabarlar (namuna, xatolik, foydalanuvchi) o‘chirilsin, keyin asosiy xabar edit + yangi namuna.

**Tekshirish uchun loglar:** Terminalda `[REENTER_DEBT] [REJA_3]` qidiring – "Chat toza: oraliq xabar o‘chirildi: messageId=..." yoki "Xabar o‘chirishda xatolik (ignored)".

---

## Keyingi rejalar

### NORMAL: "Qaytadan kiritish" da chat toza (qadamlar)

**Maqsad:** Kassir NORMAL so‘rovda "Qaytadan kiritish" tugmasini bosganda chat toza bo‘lsin: oraliq xabarlar o‘chirilsin, asosiy xabar edit qilinsin va yangi namuna yuborilsin. (Reja 3 – amalga oshirildi.)

**Qadamlar:**

1. **handleCashierReenterDebt** (yoki "Qaytadan kiritish" callback) ichida:
   - State dan `first_example_message_id`, `last_error_message_id`, foydalanuvchi yozgan xabar ID lari (`user_message_id` va b.) olish.
   - Shu ID larga ega xabarlarni o‘chirish (bot.deleteMessage).
   - So‘ng asosiy kassir xabarini (requestId ga bog‘langan) **edit** qilish: "Yuborish / Qaytadan kiritish" o‘rniga faqat so‘rov matni yoki qisqa yo‘riqnoma + yangi namuna (umumiy summa / agent bo‘yicha format).
   - State ni `auto_detect_debt_input` ga qaytarish va yangi namuna xabarini yuborish (keyin foydalanuvchi qayta qiymat kiritadi).

2. **Kutiladigan natija:** "Qaytadan kiritish" dan keyin chatda faqat: so‘rov xabari (edit qilingan) + yangi namuna xabari; oraliq xatolik va foydalanuvchi yozuvlari yo‘q.

---

### Reja 4: SET da "Qaytadan kiritish" – chat toza ✅ (amalga oshirildi)

**Maqsad:** SET so‘rovda ham "Qaytadan kiritish" bosilganda xuddi NORMAL dagi kabi chat toza qoidasi ishlashi: oraliq xabarlar (namuna, xatolik, foydalanuvchi yozganlari) o‘chirilsin, keyin asosiy xabar edit + yangi namuna.

**Qadamlar:**

1. **handleCashierReenterDebt** da so‘rov turi tekshiruvi: `request.type === 'SET'` bo‘lsa ham NORMAL dagi kabi cleanup logikasini qo‘llash.
   - State dan o‘chiriladigan xabar ID larini yig‘ish (first_example_message_id, last_error_message_id, user_message_id va b.).
   - Ularni o‘chirish.
   - Asosiy kassir xabarini edit (SET uchun mos matn + "Excel yuboring" yoki tegishli namuna).
   - State ni SET uchun qayta kiritish holatiga o‘rnatish va yangi namuna yuborish.

2. **Kutiladigan natija:** SET da "Qaytadan kiritish" dan keyin chat toza; faqat bitta asosiy xabar (edit qilingan) va yangi namuna qoladi.

**Tekshirish:** `handleCashierReenterDebt` bitta handler – cleanup `state && state.data` bo‘lganda bajariladi (NORMAL/SET farqi yo‘q). Asosiy xabar `request.type === 'SET'` bo‘yicha `formatSetRequestMessage` yoki `formatNormalRequestMessage` bilan edit qilinadi; yangi namuna `buildFullExampleMessage` orqali yuboriladi. Reja 4 talablari qondirilgan.

---

### Reja 5: NORMAL uchun link va to‘liq ma’lumot ✅ (amalga oshirildi)

**Maqsad:** NORMAL so‘rovda ham asosiy xabarda va menejer/final xabarlarida to‘liq ma’lumot (So‘rov ID, Brend, Filial, SVR, summa) va bitta link bo‘lsin.

**Qadamlar:**

1. **formatNormalRequestMessage** (utils/messageTemplates.js): ixtiyoriy `telegraph_url` va `total_amount` qabul qiladi. Berilsa: "Qarzdorlik umumiy summasi: X so'm" va bitta link xabar ichiga qo‘shiladi.
2. **formatRequestMessageWithApprovals** NORMAL tarmog‘i: teskari jarayon (REVERSED_BY_CASHIER/REVERSED_BY_OPERATOR) va menejer/final uchun `formatNormalRequestMessage` ga `debtData.telegraph_url` va `debtData.total_amount` (yoki `total_difference`) uzatiladi – natijada menejer va final xabarlarida to‘liq ma’lumot + bitta link.

**Tekshirish:** Kassir asosiy xabari (Reja 1) allaqachon to‘liq ma’lumot + link bilan yangilanadi. Menejer va final uchun xabar endi shablon orqali to‘liq ma’lumot va linkni o‘z ichiga oladi.
