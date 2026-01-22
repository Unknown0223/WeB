# 🚀 TEST QILISH - BOSHLASH QO'LLANMASI

## 📋 TEZKOR TEST REJASI

### 1️⃣ **Server Ishga Tushirish**

```bash
cd D:\web_main
npm start
```

**Kutilayotgan natija:**
```
✅ Database ishga tushirildi
✅ Server running on port 3000
✅ Bot ishga tushirildi (agar token sozlangan bo'lsa)
```

---

### 2️⃣ **Database Tekshirish**

Database'da quyidagi jadvallar bo'lishi kerak:

```sql
-- SQLite database'ni tekshirish
sqlite3 database.db

-- Jadvallarni ko'rish
.tables

-- Debt-approval jadvallarini tekshirish
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'debt_%';
```

**Kutilayotgan jadvallar:**
- ✅ `debt_brands`
- ✅ `debt_branches`
- ✅ `debt_svrs`
- ✅ `debt_requests`
- ✅ `debt_request_logs`
- ✅ `debt_user_brands`
- ✅ `debt_user_branches`
- ✅ `debt_attachments`
- ✅ `debt_reports`

---

### 3️⃣ **Admin Panel Test**

1. Browser'da oching: `http://localhost:3000/admin.html`
2. Login qiling (admin credentials)
3. "Qarzdorlik Tasdiqlash" bo'limiga o'ting

**Test qilish:**
- ✅ Sahifa yuklanadi
- ✅ Dashboard statistika ko'rinadi
- ✅ "Excel Import" knopkasi ishlaydi
- ✅ "Sozlamalar" bo'limi ko'rinadi

---

### 4️⃣ **Excel Import Test**

1. Admin panelda "Excel Import" tugmasini bosing
2. Shablon yuklab oling (agar mavjud bo'lsa)
3. Excel faylni to'ldiring:
   ```
   Brend        | Filial    | SVR (FISH)
   Coca-Cola    | Toshkent  | Aliyev Ali
   Coca-Cola    | Toshkent  | Karimov Karim
   Pepsi        | Samarqand | Bekzod
   ```
4. Import qiling

**Kutilayotgan natija:**
- ✅ Excel fayl qabul qilinadi
- ✅ Ma'lumotlar bazaga saqlanadi
- ✅ Import natijasi ko'rsatiladi
- ✅ "Import qilingan ma'lumotlar" bo'limida ko'rinadi

---

### 5️⃣ **Sozlamalar Test**

1. Admin panelda "Sozlamalar" bo'limiga o'ting
2. Quyidagi sozlamalarni to'ldiring:
   - **Telegram Bot Token** - Bot token (yoki bo'sh qoldiring, asosiy token ishlatiladi)
   - **Leaders Group ID** - Leader'lar guruhi ID (masalan: `-1001234567890`)
   - **Operators Group ID** - Operator'lar guruhi ID
   - **Final Group ID** - Yakuniy guruh ID
   - **Reminder Interval** - 15 (daqiqa)
   - **Reminder Max Count** - 3
   - **Excel Column Mappings** - Default qiymatlar
   - **File Size Limit** - 10 (MB)

3. "💾 Sozlamalarni Saqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ Sozlamalar saqlanadi
- ✅ "Sozlamalar saqlandi!" xabari ko'rinadi

---

### 6️⃣ **Bot Test - Asosiy**

1. Telegram bot'ga `/start` yuboring
2. Bot javob berishi kerak

**Agar bot ishlamasa:**
- `.env` faylida `TELEGRAM_BOT_TOKEN` to'g'ri ekanligini tekshiring
- Server loglarini ko'ring
- Bot token to'g'riligini tekshiring

---

### 7️⃣ **Bot Test - Manager So'rov Yaratish**

**Tayyorgarlik:**
1. Admin panel orqali foydalanuvchiga "manager" rolini bering
2. Foydalanuvchi bot'ga ulangan bo'lishi kerak (telegram_chat_id mavjud)

**Test jarayoni:**
1. Bot'da "➕ Yangi so'rov" tugmasini bosing
2. Brendlar ro'yxatidan birini tanlang
3. Filiallar ro'yxatidan birini tanlang
4. SVR (FISH) ro'yxatidan birini tanlang
5. So'rov turi tanlang (SET yoki ODDIY)
6. SET bo'lsa, izoh kiriting
7. Preview ko'rinadi
8. "📤 Yuborish" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov yaratiladi
- ✅ Status: SET bo'lsa "SET_PENDING", ODDIY bo'lsa "PENDING_APPROVAL"
- ✅ Leader'ga (SET) yoki Cashier'ga (ODDIY) xabar yuboriladi

---

### 8️⃣ **Bot Test - Leader Tasdiqlash (SET so'rovlar)**

**Tayyorgarlik:**
1. Admin panel orqali foydalanuvchiga "leader" rolini bering
2. SET so'rov yaratilishi kerak

**Test jarayoni:**
1. SET so'rov yaratilganda Leader'ga xabar keladi
2. "✅ Tasdiqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov tasdiqlanadi
- ✅ Status: "APPROVED_BY_LEADER"
- ✅ Cashier'ga yuboriladi
- ✅ Lock: true

---

### 9️⃣ **Bot Test - Cashier Tasdiqlash**

**Tayyorgarlik:**
1. Admin panel orqali foydalanuvchiga "cashier" rolini bering
2. So'rov kelishi kerak (ODDIY yoki Leader tasdiqlagandan keyin)

**Test jarayoni:**
1. So'rov kelganda "✅ Tasdiqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov tasdiqlanadi
- ✅ Status: "APPROVED_BY_CASHIER"
- ✅ Operator'ga yuboriladi
- ✅ Lock: true

---

### 🔟 **Bot Test - Operator Tasdiqlash**

**Tayyorgarlik:**
1. Admin panel orqali foydalanuvchiga "operator" rolini bering
2. So'rov kelishi kerak (Cashier tasdiqlagandan keyin)

**Test jarayoni:**
1. So'rov kelganda "✅ Tasdiqlash" tugmasini bosing

**Kutilayotgan natija:**
- ✅ So'rov tasdiqlanadi
- ✅ Status: "APPROVED_BY_OPERATOR"
- ✅ Final group'ga yuboriladi (agar sozlangan bo'lsa)
- ✅ Lock: true

---

### 1️⃣1️⃣ **Bot Test - Qarzdorlik Topilgan**

**Tayyorgarlik:**
1. Cashier yoki Operator rolida bo'lish kerak
2. So'rov kelishi kerak

**Test jarayoni:**
1. "⚠️ Qarzi bor" tugmasini bosing
2. Quyidagilardan birini tanlang:
   - 📎 Excel yuklash
   - 🖼 Rasm yuklash
   - ✍️ Summa yozma

**A. Excel yuklash:**
- "📎 Excel yuklash" tugmasini bosing
- Excel faylni yuboring (client_id, client_name, debt_amount ustunlari bilan)
- Preview ko'rinadi
- "📤 Yuborish" tugmasini bosing

**B. Rasm yuklash:**
- "🖼 Rasm yuklash" tugmasini bosing
- Rasm yuboring
- Preview ko'rinadi
- "📤 Yuborish" tugmasini bosing

**C. Summa yozma:**
- "✍️ Summa yozma" tugmasini bosing
- Summa kiriting (masalan: "-500000" yoki "Aliyev A → -150000")
- Preview ko'rinadi
- "📤 Yuborish" tugmasini bosing

**Kutilayotgan natija:**
- ✅ Qarzdorlik ma'lumotlari saqlanadi
- ✅ Status: "DEBT_FOUND"
- ✅ Manager'ga xabar yuboriladi
- ✅ Attachment saqlanadi (agar Excel yoki rasm bo'lsa)

---

### 1️⃣2️⃣ **Admin Panel - So'rovlar Monitoring**

1. Admin panelda "So'rovlar" bo'limiga o'ting
2. Barcha so'rovlar ro'yxatini ko'ring
3. Status filter bilan filtrlashni tekshiring

**Kutilayotgan natija:**
- ✅ Barcha so'rovlar ko'rinadi
- ✅ Status filter ishlaydi
- ✅ Har bir so'rovning ma'lumotlari to'g'ri

---

## 🐛 MUAMMOLAR VA YECHIMLAR

### Muammo 1: Server ishga tushmayapti

**Yechim:**
```bash
# Port band bo'lishi mumkin
netstat -ano | findstr :3000

# Yoki boshqa port ishlatish
PORT=3001 npm start
```

### Muammo 2: Bot ishlamayapti

**Yechim:**
- `.env` faylida `TELEGRAM_BOT_TOKEN` to'g'ri ekanligini tekshiring
- Server loglarini ko'ring
- Bot token to'g'riligini tekshiring (@BotFather orqali)

### Muammo 3: Excel import ishlamayapti

**Yechim:**
- Excel fayl formatini tekshiring (3 ustun bo'lishi kerak)
- Server loglarini ko'ring
- `uploads/debt-approval/` papkasi mavjudligini tekshiring

### Muammo 4: Bot callback'lar ishlamayapti

**Yechim:**
- `utils/bot.js` faylida debt-approval handlerlar qo'shilganligini tekshiring
- Server loglarini ko'ring
- Callback data formatini tekshiring

### Muammo 5: So'rov yaratilmayapti

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
2. **Telegram guruhlar:** Settings'da group ID'larni sozlash kerak
3. **Reminder:** Settings'da reminder sozlamalari sozlash kerak
4. **Test ma'lumotlari:** Avval Excel orqali brendlar, filiallar, SVRlarni import qiling

---

**Test qiling va natijalarni yuboring!** 🚀

