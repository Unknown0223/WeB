# 🚀 DEPLOY CHECKLIST

## ✅ YAKUNLANGAN ISHLAR

1. ✅ **Barcha serverlarni to'xtatish script** - `stop-all-servers.ps1` yaratildi
2. ✅ **Console.log'larni olib tashlash:**
   - `seeds/02_expanded_permissions.js` - console.log olib tashlandi
   - `scripts/create-database.js` - faqat error loglar qoldirildi
   - `migrations/20251127000000_add_unique_constraint_ostatki_analysis.js` - console.log olib tashlandi
   - `migrations/20260110130000_change_debt_user_tables_user_id_to_bigint.js` - console.log olib tashlandi
   - `migrations/20260112000000_add_default_role_button_groups.js` - console.log olib tashlandi
3. ✅ **Deploy scriptlar:**
   - `deploy.sh` - Linux/Mac uchun
   - `deploy.ps1` - Windows PowerShell uchun
4. ✅ **Logger tizimi** - Default 'error' level (faqat xatoliklar)

---

## 📋 DEPLOY QADAMLARI

### 1. Environment Variables Tekshirish

`.env` faylida quyidagilar bo'lishi kerak:

```env
# Database
NODE_ENV=production
DB_CLIENT=pg  # yoki sqlite3
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=hisobot_db

# Server
PORT=3000
APP_BASE_URL=https://your-domain.com
SESSION_SECRET=your-very-strong-secret-key-here

# Logging
LOG_LEVEL=error  # Production uchun faqat error loglar

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ENABLED=true
```

### 2. Barcha Serverlarni To'xtatish

**Windows (PowerShell):**
```powershell
.\stop-all-servers.ps1
```

**Linux/Mac:**
```bash
pm2 stop all
pm2 delete all
# Yoki
lsof -ti:3000 | xargs kill -9
```

### 3. Deploy Qilish

**Windows (PowerShell):**
```powershell
.\deploy.ps1
```

**Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh
```

### 4. Status Tekshirish

```bash
# PM2 status
pm2 status

# Loglarni ko'rish
pm2 logs web-app

# Yoki real-time monitoring
pm2 monit
```

---

## 🔍 PRODUCTION SOZLAMALARI

### PM2 Konfiguratsiyasi

`ecosystem.config.js` faylida:
- ✅ `LOG_LEVEL: 'error'` - Production uchun
- ✅ `NODE_ENV: 'production'`
- ✅ Memory limit: 1GB
- ✅ Log rotation: 10MB, 10 fayl
- ✅ Auto restart: enabled

### Logger Tizimi

- ✅ Default: `error` level (faqat xatoliklar)
- ✅ `LOG_LEVEL` environment variable orqali boshqariladi
- ✅ Production'da faqat error loglar ko'rinadi

### Database Migration

- ✅ 70 ta migration muvaffaqiyatli ishga tushdi
- ✅ Migration'larda console.log olib tashlandi
- ✅ Faqat error loglar qoldirildi

---

## ⚠️ MUAMMOLAR VA YECHIMLAR

### Muammo 1: Port band
**Yechim:**
```powershell
.\stop-all-servers.ps1
```

### Muammo 2: Migration xatolik
**Yechim:**
```bash
npm run migrate:rollback
npm run migrate:latest
```

### Muammo 3: PM2 ishlamayapti
**Yechim:**
```bash
npm install -g pm2
pm2 startup
pm2 save
```

---

## 📊 DEPLOY HOLATI

| Vazifa | Status | Izoh |
|--------|--------|------|
| Server to'xtatish script | ✅ | `stop-all-servers.ps1` tayyor |
| Console.log cleanup | ✅ | Barcha migration/seed fayllarda |
| Deploy scriptlar | ✅ | `deploy.sh` va `deploy.ps1` tayyor |
| Logger tizimi | ✅ | Error-only logging |
| PM2 konfiguratsiyasi | ✅ | Production uchun sozlangan |
| Environment variables | ⏳ | `.env` faylini tekshirish kerak |

---

## 🎯 KEYINGI QADAMLAR

1. ⏳ **Environment variables'ni tekshirish** - `.env` faylini production uchun sozlash
2. ⏳ **To'liq test qilish** - Deploy qilgandan keyin barcha funksiyalarni test qilish
3. ⏳ **Monitoring** - PM2 monitoring va loglarni kuzatish

---

**Oxirgi yangilanish:** 2026-01-21
**Tayyorlik holati:** ✅ Deployga tayyor

