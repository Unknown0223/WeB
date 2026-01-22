# 💻 BOSHQA KOMPYUTERDAN DAVOM ETISH QO'LLANMASI

## 📋 KERAKLI MA'LUMOTLAR

### 1️⃣ **Loyiha Holati**

Hozirgi holat:
- ✅ Database migration - qilingan
- ✅ Backend API routes - qilingan
- ✅ Admin panel - qilingan
- ✅ Excel import - qilingan
- ✅ Bot handlers - qilingan (Manager, Approval, Debt)
- ⚠️ Settings routes - qilinmagan
- ⚠️ Users routes - qilinmagan

### 2️⃣ **Fayllar Ro'yxati**

Yaratilgan/yangilangan fayllar:
```
web_main/
├── migrations/
│   └── 20251224100655_add_debt_approval_tables.js ✅
├── routes/
│   ├── index.js (yangilangan) ✅
│   └── debt-approval/
│       ├── brands.js ✅
│       └── requests.js ✅
├── bot/
│   └── debt-approval/
│       ├── handlers/
│       │   ├── index.js ✅
│       │   ├── manager.js ✅
│       │   ├── approval.js ✅
│       │   └── debt.js ✅
│       └── keyboards.js ✅
├── utils/
│   └── debtReminder.js ✅
├── public/
│   ├── admin.html (yangilangan) ✅
│   ├── admin.css (yangilangan) ✅
│   ├── admin.js (yangilangan) ✅
│   └── modules/
│       ├── debtApproval.js ✅
│       └── navigation.js (yangilangan) ✅
└── TEST-QOLLANMA.md ✅
```

---

## 🚀 BOSHQA KOMPYUTERGA KO'CHIRISH

### Variant 1: Git Repository (TAVSIYA ETILADI)

#### 1. Git Repository Yaratish (Hozirgi kompyuterda)

```bash
cd D:\web_main

# Git init (agar yo'q bo'lsa)
git init

# .gitignore yaratish/yangilash
echo "node_modules/" >> .gitignore
echo ".env" >> .gitignore
echo "*.db" >> .gitignore
echo "*.db-shm" >> .gitignore
echo "*.db-wal" >> .gitignore
echo "uploads/" >> .gitignore
echo ".DS_Store" >> .gitignore

# Barcha o'zgarishlarni qo'shish
git add .

# Commit qilish
git commit -m "Debt-approval system: Bot handlers, Admin panel, Excel import"

# Remote repository yaratish (GitHub, GitLab, yoki boshqa)
# GitHub'da yangi repository yaratib, keyin:
git remote add origin https://github.com/your-username/web_main.git
git branch -M main
git push -u origin main
```

#### 2. Boshqa Kompyuterga Yuklab Olish

```bash
# Yangi kompyuterga clone qilish
git clone https://github.com/your-username/web_main.git
cd web_main

# Dependencies o'rnatish
npm install

# .env faylini yaratish
cp env.example.txt .env
# Yoki qo'lda yaratish (quyida ko'rsatilgan)

# Database migration
npm run migrate:latest
# Yoki
npx knex migrate:latest --knexfile knexfile.js

# Server ishga tushirish
npm start
```

---

### Variant 2: USB/Network Orqali Ko'chirish

#### 1. Hozirgi Kompyuterdan

```bash
cd D:\web_main

# Kerakli fayllarni arxivlash (node_modules va database'siz)
# PowerShell'da:
Compress-Archive -Path . -DestinationPath ..\web_main_backup.zip -Exclude "node_modules","*.db","*.db-shm","*.db-wal","uploads"

# Yoki manual ravishda quyidagi papkalarni ko'chirish:
# - routes/debt-approval/
# - bot/debt-approval/
# - utils/debtReminder.js
# - public/modules/debtApproval.js
# - public/admin.html (yangilangan qismlar)
# - public/admin.css (yangilangan qismlar)
# - public/admin.js (yangilangan qismlar)
# - public/modules/navigation.js (yangilangan qismlar)
# - migrations/20251224100655_add_debt_approval_tables.js
# - routes/index.js (yangilangan qismlar)
```

#### 2. Boshqa Kompyuterga

```bash
# Arxivni ochish
# Yoki fayllarni ko'chirish

# Dependencies o'rnatish
npm install

# .env faylini yaratish
# (quyida ko'rsatilgan)

# Database migration
npm run migrate:latest

# Server ishga tushirish
npm start
```

---

## ⚙️ ENVIRONMENT SOZLAMALARI

### .env Fayl Yaratish

Boshqa kompyuterga `.env` faylini yaratish kerak:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=./database.db

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=your_bcrypt_hash_here
# Yoki oddiy parol (agar bcrypt qilmagan bo'lsangiz)

# Telegram Bot
BOT_TOKEN=your_bot_token_here

# Telegram Guruhlar (ixtiyoriy)
LEADERS_GROUP_ID=-100123456789
OPERATORS_GROUP_ID=-100987654321
FINAL_GROUP_ID=-100555555555

# API URL (bot uchun)
API_URL=http://localhost:3000

# Session Secret
SESSION_SECRET=your-secret-key-here
```

### Bcrypt Hash Yaratish

Agar parol hash qilmagan bo'lsangiz:

```javascript
// Node.js'da:
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash('your_password', 10);
console.log(hash);
```

Yoki online tool: https://bcrypt-generator.com/

---

## 📦 DEPENDENCIES

### package.json'da qo'shilgan dependencies

Quyidagi package'lar kerak bo'lishi mumkin:

```json
{
  "dependencies": {
    "express": "^4.19.2",
    "knex": "^3.1.0",
    "sqlite3": "^5.1.7",
    "node-telegram-bot-api": "^0.66.0",
    "dotenv": "^16.4.5",
    "bcrypt": "^5.1.1",
    "xlsx": "^0.18.5",
    "multer": "^2.0.2",
    "express-session": "^1.18.0",
    "ws": "^8.18.3",
    "uuid": "^10.0.0",
    "axios": "^1.6.0"
  }
}
```

### O'rnatish

```bash
npm install
```

---

## 🗄️ DATABASE MIGRATION

### Migration Fayllari

Quyidagi migration bajarilishi kerak:

```bash
# Migration bajarish
npx knex migrate:latest --knexfile knexfile.js

# Yoki
npm run migrate:latest
```

### Migration Fayli

`migrations/20251224100655_add_debt_approval_tables.js` fayli mavjud bo'lishi kerak.

Agar yo'q bo'lsa, quyidagi jadvallar yaratilishi kerak:
- `debt_brands`
- `debt_branches`
- `debt_svrs`
- `debt_requests`
- `debt_request_logs`
- `debt_user_brands`
- `debt_user_branches`
- `debt_attachments`
- `debt_debt_reports`

---

## ✅ TEKSHIRISH

### 1. Fayllar Mavjudligi

```bash
# Routes
ls routes/debt-approval/
# brands.js, requests.js bo'lishi kerak

# Bot handlers
ls bot/debt-approval/handlers/
# index.js, manager.js, approval.js, debt.js bo'lishi kerak

# Utils
ls utils/
# debtReminder.js bo'lishi kerak

# Public modules
ls public/modules/
# debtApproval.js bo'lishi kerak
```

### 2. Database Tekshirish

```bash
# SQLite database'ni ochish
sqlite3 database.db

# Jadvallarni tekshirish
.tables

# Debt-approval jadvallarini tekshirish
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'debt_%';
```

### 3. Server Test

```bash
# Server ishga tushirish
npm start

# Kutilayotgan natija:
# ✅ Database ishga tushirildi
# ✅ Server running on port 3000
# ✅ Bot ishga tushirildi
```

### 4. Bot Test

1. Telegram bot'ga /start yuborish
2. Bot javob berishi kerak

---

## 🔧 MUAMMOLAR VA YECHIMLAR

### Muammo 1: node_modules yo'q

**Yechim:**
```bash
npm install
```

### Muammo 2: Database migration xatolik

**Yechim:**
```bash
# Migration status tekshirish
npx knex migrate:status --knexfile knexfile.js

# Agar migration bajarilmagan bo'lsa:
npx knex migrate:latest --knexfile knexfile.js
```

### Muammo 3: Bot ishlamayapti

**Yechim:**
- `.env` faylida `BOT_TOKEN` to'g'ri ekanligini tekshiring
- Server loglarini ko'ring

### Muammo 4: Module topilmadi

**Yechim:**
```bash
# Dependencies qayta o'rnatish
rm -rf node_modules
npm install
```

---

## 📝 QOLGAN ISHLAR

Agar boshqa kompyuterga ko'chirgandan keyin davom etmoqchi bo'lsangiz:

### 1. Settings Routes
- `routes/debt-approval/settings.js` yaratish
- Telegram guruhlar sozlamalari
- Reminder sozlamalari

### 2. Users Routes
- `routes/debt-approval/users.js` yaratish
- Pending users ro'yxati
- Rol berish

### 3. Test Qilish
- `TEST-QOLLANMA.md` bo'yicha test qilish

---

## 🎯 KEYINGI QADAMLAR

1. ✅ Boshqa kompyuterga ko'chirish
2. ✅ Dependencies o'rnatish
3. ✅ .env sozlash
4. ✅ Database migration
5. ✅ Server test
6. ⏭️ Qolgan ishlarni davom ettirish

---

## 📞 YORDAM

Agar muammo bo'lsa:
1. Server loglarini ko'ring
2. Database holatini tekshiring
3. Dependencies o'rnatilganligini tekshiring
4. .env fayl to'g'riligini tekshiring

**Muvaffaqiyat!** 🚀

