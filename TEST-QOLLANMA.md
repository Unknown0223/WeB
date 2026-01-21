# 🧪 TEST QO'LLANMASI - Qarzdorlik Tasdiqlash Tizimi

## 📋 TEST REJASI

### ✅ YAKUNLANGAN FUNKSIYALAR

1. ✅ **Database Migration** - Barcha jadvallar yaratilgan
2. ✅ **Backend API Routes** - Brands, Requests endpoints
3. ✅ **Admin Panel** - Excel import, monitoring
4. ✅ **Excel Import** - 3 ustun (Brend, Filial, SVR)
5. ✅ **Bot Handlers**:
   - ✅ Manager Handler - So'rov yaratish
   - ✅ Approval Handler - Tasdiqlash
   - ✅ Debt Handler - Qarzdorlik topilgan

---

## 🧪 TEST BOSQICHLARI

### 1️⃣ **Database va Server Test**

```bash
# Server ishga tushirish
cd D:\web_main
npm start

# Database tekshirish
# SQLite database.db faylida quyidagi jadvallar bo'lishi kerak:
# - debt_brands
# - debt_branches
# - debt_svrs
# - debt_requests
# - debt_request_logs
# - debt_attachments
# - debt_debt_reports
```

**Kutilayotgan natija:**
- ✅ Server ishga tushadi
- ✅ Database jadvallari mavjud
- ✅ Bot ishga tushadi

---

### 2️⃣ **Admin Panel Test**

1. Browser'da oching: `http://localhost:3000/admin.html`
2. Login qiling (admin credentials)
3. "Qarzdorlik Tasdiqlash" bo'limiga o'ting

**Test qilish:**
- ✅ Sahifa yuklanadi
- ✅ Statistikalar ko'rinadi
- ✅ "Excel Import" knopkasi ishlaydi
- ✅ Shablon yuklab olish ishlaydi
- ✅ Excel import ishlaydi
- ✅ Import qilingan ma'lumotlar ro'yxatida ko'rinadi

---

### 3️⃣ **Excel Import Test**

1. Admin panelda "Excel Import" tugmasini bosing
2. Shablon yuklab oling
3. Excel faylni to'ldiring (3 ustun: Brend, Filial, SVR)
4. Import qiling

**Kutilayotgan natija:**
- ✅ Excel fayl qabul qilinadi
- ✅ Ma'lumotlar bazaga saqlanadi
- ✅ Import natijasi ko'rsatiladi
- ✅ Ro'yxat bo'limida ko'rinadi

**Excel shablon format:**
```
Brend        | Filial    | SVR (FISH)
Coca-Cola    | Toshkent  | Aliyev Ali
Coca-Cola    | Toshkent  | Karimov Karim
Pepsi        | Samarqand | Bekzod
```

---

### 4️⃣ **Bot - Manager So'rov Yaratish Test**

1. Telegram bot'ga /start yuboring
2. Admin panel orqali foydalanuvchiga "manager" rolini bering
3. Bot'da "➕ Yangi so'rov" tugmasini bosing

**Test jarayoni:**
1. ✅ Brendlar ro'yxati ko'rinadi
2. ✅ Brend tanlang
3. ✅ Filiallar ro'yxati ko'rinadi
4. ✅ Filial tanlang
5. ✅ SVR (FISH) ro'yxati ko'rinadi
6. ✅ SVR tanlang
7. ✅ So'rov turi tanlang (SET yoki ODDIY)
8. ✅ SET bo'lsa, izoh kiriting
9. ✅ Preview ko'rinadi
10. ✅ "📤 Yuborish" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov yaratiladi
- ✅ Status: SET bo'lsa "SET_PENDING", ODDIY bo'lsa "PENDING_APPROVAL"
- ✅ Leader'ga (SET) yoki Cashier'ga (ODDIY) yuboriladi

---

### 5️⃣ **Bot - Leader Tasdiqlash Test (SET so'rovlar)**

1. Admin panel orqali foydalanuvchiga "leader" rolini bering
2. SET so'rov yaratilganda Leader'ga xabar keladi
3. "✅ Tasdiqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov tasdiqlanadi
- ✅ Status: "APPROVED_BY_LEADER"
- ✅ Cashier'ga yuboriladi
- ✅ Lock: true

---

### 6️⃣ **Bot - Cashier Tasdiqlash Test**

1. Admin panel orqali foydalanuvchiga "cashier" rolini bering
2. So'rov kelganda (ODDIY yoki Leader tasdiqlagandan keyin)
3. "✅ Tasdiqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov tasdiqlanadi
- ✅ Status: "APPROVED_BY_CASHIER"
- ✅ Operator'ga yuboriladi
- ✅ Lock: true

---

### 7️⃣ **Bot - Operator Tasdiqlash Test**

1. Admin panel orqali foydalanuvchiga "operator" rolini bering
2. So'rov kelganda (Cashier tasdiqlagandan keyin)
3. "✅ Tasdiqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov tasdiqlanadi
- ✅ Status: "APPROVED_BY_OPERATOR"
- ✅ Final group'ga yuboriladi (agar sozlangan bo'lsa)
- ✅ Lock: true

---

### 8️⃣ **Bot - Qarzdorlik Topilgan Test**

1. Cashier yoki Operator "⚠️ Qarzi bor" tugmasini bosing
2. Quyidagilardan birini tanlang:
   - 📎 Excel yuklash
   - 🖼 Rasm yuklash
   - ✍️ Summa yozma

**Test variantlari:**

**A. Excel yuklash:**
1. "📎 Excel yuklash" tugmasini bosing
2. Excel faylni yuboring (client_id, client_name, debt_amount ustunlari bilan)
3. Preview ko'rinadi
4. "📤 Yuborish" tugmasini bosing

**B. Rasm yuklash:**
1. "🖼 Rasm yuklash" tugmasini bosing
2. Rasm yuboring
3. Preview ko'rinadi
4. "📤 Yuborish" tugmasini bosing

**C. Summa yozma:**
1. "✍️ Summa yozma" tugmasini bosing
2. Summa kiriting (masalan: "-500000" yoki "Aliyev A → -150000")
3. Preview ko'rinadi
4. "📤 Yuborish" tugmasini bosing

**Kutilayotgan natija:**
- ✅ Qarzdorlik ma'lumotlari saqlanadi
- ✅ Status: "DEBT_FOUND"
- ✅ Manager'ga xabar yuboriladi
- ✅ Attachment saqlanadi (agar Excel yoki rasm bo'lsa)

---

### 9️⃣ **Admin Panel - So'rovlar Monitoring Test**

1. Admin panelda "So'rovlar" bo'limiga o'ting
2. Barcha so'rovlar ro'yxatini ko'ring
3. Status filter bilan filtrlashni tekshiring

**Kutilayotgan natija:**
- ✅ Barcha so'rovlar ko'rinadi
- ✅ Status filter ishlaydi
- ✅ Har bir so'rovning ma'lumotlari to'g'ri

---

### 🔟 **Admin Panel - Sozlamalar Test**

1. Admin panelda "Sozlamalar" bo'limiga o'ting
2. Quyidagi sozlamalarni to'ldiring:
   - **Telegram Bot Token** - Debt-approval bot token (yoki asosiy bot token)
   - **Leaders Group ID** - Leader'lar guruhi ID
   - **Operators Group ID** - Operator'lar guruhi ID
   - **Final Group ID** - Yakuniy guruh ID
   - **Reminder Interval** - Eslatma intervali (daqiqa)
   - **Reminder Max Count** - Maksimal eslatma soni
   - **Excel Column Mappings** - Excel ustun nomlari
   - **File Size Limit** - Fayl hajmi limiti (MB)

3. "💾 Sozlamalarni Saqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ Sozlamalar saqlanadi
- ✅ Database'ga yoziladi
- ✅ Bot handlerlar yangi sozlamalarni ishlatadi
- ✅ Reminder sozlamalari yangilanadi

**Muhim:** Agar `debt_bot_token` bo'sh bo'lsa, asosiy `telegram_bot_token` ishlatiladi.

---

## 🐛 MUAMMOLAR VA YECHIMLAR

### Muammo 1: Bot ishlamayapti
**Yechim:**
- `.env` faylida `BOT_TOKEN` to'g'ri ekanligini tekshiring
- Server loglarini ko'ring
- Bot token to'g'riligini tekshiring

### Muammo 2: Excel import ishlamayapti
**Yechim:**
- Excel fayl formatini tekshiring (3 ustun bo'lishi kerak)
- Server loglarini ko'ring
- `uploads/debt-approval/` papkasi mavjudligini tekshiring

### Muammo 3: Bot callback'lar ishlamayapti
**Yechim:**
- `bot.js` faylida debt-approval handlerlar qo'shilganligini tekshiring
- Server loglarini ko'ring
- Callback data formatini tekshiring

### Muammo 4: So'rov yaratilmayapti
**Yechim:**
- Database'da brendlar, filiallar, SVRlar mavjudligini tekshiring
- API endpoint'ni tekshiring
- Server loglarini ko'ring

---

## ✅ TEST CHECKLIST

- [ ] Server ishga tushdi
- [ ] Database jadvallari mavjud (debt_* jadvallar)
- [ ] Admin panelga kirildi
- [ ] "Qarzdorlik Tasdiqlash" bo'limi ko'rinadi
- [ ] Excel import ishladi (Brands, Branches, SVRs)
- [ ] Sozlamalar bo'limi ishlaydi
- [ ] Bot /start javob berdi
- [ ] Manager so'rov yaratdi
- [ ] Leader tasdiqladi (SET so'rovlar)
- [ ] Cashier tasdiqladi
- [ ] Operator tasdiqladi
- [ ] Qarzdorlik topilgan holat ishladi (Excel, rasm, summa)
- [ ] So'rovlar ro'yxati ko'rinadi
- [ ] Reminder system ishlaydi
- [ ] Barcha workflow'lar ishlaydi

---

## 📝 ESLATMALAR

1. **Rol berish:** Admin panel orqali foydalanuvchilarga rol berish kerak
2. **Telegram guruhlar:** Settings'da final group ID sozlash kerak
3. **Reminder:** Settings'da reminder sozlamalari sozlash kerak
4. **Test ma'lumotlari:** Avval Excel orqali brendlar, filiallar, SVRlarni import qiling

---

## 🎯 KEYINGI BOSQICHLAR

1. ✅ Settings Routes - Telegram guruhlar va reminder sozlamalari (Yakunlandi)
2. ⏳ Users Routes - Pending users approval (Qolgan)
3. 🔄 To'liq integration test (Jarayonda)
4. ⏳ Production deploy

---

**Test qiling va natijalarni yuboring!** 🚀

