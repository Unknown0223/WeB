# ⚡ TEZKOR SOZLASH QO'LLANMASI

## 🚀 5 DAQIQADA SOZLASH

### 1. Fayllarni Ko'chirish

```bash
# Boshqa kompyuterga quyidagi papkalarni ko'chiring:
- routes/debt-approval/
- bot/debt-approval/
- utils/debtReminder.js
- public/modules/debtApproval.js
- migrations/20251224100655_add_debt_approval_tables.js
```

### 2. Dependencies O'rnatish

```bash
npm install
```

### 3. .env Fayl Yaratish

```env
PORT=3000
BOT_TOKEN=your_bot_token
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=your_hash
```

### 4. Database Migration

```bash
npx knex migrate:latest --knexfile knexfile.js
```

### 5. Server Ishga Tushirish

```bash
npm start
```

**Tayyor!** ✅

---

## 📋 KERAKLI FAYLLAR RO'YXATI

### Routes
- `routes/index.js` (yangilangan - debt-approval routes qo'shilgan)
- `routes/debt-approval/brands.js`
- `routes/debt-approval/requests.js`

### Bot
- `bot/debt-approval/handlers/index.js`
- `bot/debt-approval/handlers/manager.js`
- `bot/debt-approval/handlers/approval.js`
- `bot/debt-approval/handlers/debt.js`
- `bot/debt-approval/keyboards.js`

### Utils
- `utils/debtReminder.js`

### Public
- `public/admin.html` (yangilangan)
- `public/admin.css` (yangilangan)
- `public/admin.js` (yangilangan)
- `public/modules/debtApproval.js`
- `public/modules/navigation.js` (yangilangan)

### Migrations
- `migrations/20251224100655_add_debt_approval_tables.js`

---

## 🔍 TEKSHIRISH

```bash
# 1. Fayllar mavjudligi
ls routes/debt-approval/
ls bot/debt-approval/handlers/

# 2. Dependencies
npm list

# 3. Database
sqlite3 database.db ".tables" | grep debt

# 4. Server
npm start
```

---

**Agar muammo bo'lsa, `CONTINUE-FROM-OTHER-PC.md` ni ko'ring!**

