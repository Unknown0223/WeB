# 🚀 Production Deployment Qo'llanmasi

## 📋 Umumiy Ma'lumot

Bu loyiha **Railway** platformasida deploy qilingan. Yangi o'zgarishlarni **ma'lumotlarni yo'qotmasdan** va **ishlashni to'xtatmasdan** deploy qilish uchun quyidagi qadamlarni bajaring.

---

## 🔄 Yangi O'zgarishlarni Deploy Qilish

### 1️⃣ **Lokal O'zgarishlarni Git'ga Push Qilish**

```bash
# 1. O'zgarishlarni ko'rish
git status

# 2. Barcha o'zgarishlarni qo'shish
git add .

# 3. Commit qilish (ma'no beruvchi xabar bilan)
git commit -m "Yangi funksiyalar qo'shildi: [qisqacha tavsif]"

# 4. Remote repository'ga push qilish
git push origin main
```

### 2️⃣ **Railway Avtomatik Deploy**

Railway **avtomatik ravishda** yangi commit'larni aniqlaydi va deploy qiladi:

- ✅ **Zero-downtime**: Yangi versiya build qilinadi, keyin eski versiya o'chiriladi
- ✅ **Database Migration**: Avtomatik ravishda migration'lar ishga tushadi
- ✅ **Health Check**: `/health` endpoint orqali server holati tekshiriladi

**Deploy jarayoni:**
1. Railway yangi commit'ni aniqlaydi
2. Build jarayoni boshlanadi (`npm install && npm run migrate:latest`)
3. Yangi container yaratiladi
4. Health check o'tkaziladi
5. Traffic yangi versiyaga o'tkaziladi
6. Eski versiya o'chiriladi

---

## 🗄️ Database Migration'lar

### Migration'lar Avtomatik Ishlaydi

`railway.json` faylida migration'lar build jarayonida avtomatik ishga tushadi:

```json
{
  "build": {
    "buildCommand": "npm install && NODE_ENV=production npm run migrate:latest"
  }
}
```

### Migration Xatolarini Oldini Olish

Migration fayllarida **idempotent** (takrorlanuvchi) kod ishlatiladi:

- ✅ Jadval mavjud bo'lsa, xato bermaydi
- ✅ Jadval mavjud emas bo'lsa, yaratadi
- ✅ Ma'lumotlar saqlanadi

**Misol:**
```javascript
const hasTable = await knex.schema.hasTable('role_locations');
if (!hasTable) {
  try {
    await knex.schema.createTable('role_locations', ...);
  } catch (error) {
    // Jadval allaqachon mavjud bo'lsa, xatoni e'tiborsiz qoldirish
    if (!error.message.includes('already exists')) {
      throw error;
    }
  }
}
```

---

## ⚙️ Environment Variables (Sozlamalar)

### Railway Dashboard'da Sozlamalarni O'zgartirish

1. Railway dashboard'ga kiring
2. Project → Variables bo'limiga o'ting
3. Kerakli variable'ni qo'shing yoki o'zgartiring
4. **Deploy qilish shart emas** - o'zgarishlar darhol qo'llanadi

### Muhim Environment Variables

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token

# Application
APP_BASE_URL=https://your-app.railway.app
PORT=3000
NODE_ENV=production

# Database (SQLite - avtomatik)
# database.db fayli Railway'da saqlanadi
```

### Sozlamalarni O'zgartirgandan Keyin

- ✅ **Restart shart emas** - Railway avtomatik restart qiladi
- ✅ **Ma'lumotlar saqlanadi** - Database fayli o'zgarishsiz qoladi
- ⚠️ **WebSocket ulanishlar** qisqa vaqtga uzilishi mumkin (1-2 soniya)

---

## 🔍 Deploy Holatini Tekshirish

### 1. Railway Dashboard

- **Deployments** bo'limida deploy holatini ko'ring
- **Logs** bo'limida real-time loglarni kuzatib boring
- **Metrics** bo'limida server resurslarini ko'ring

### 2. Health Check Endpoint

```bash
curl https://your-app.railway.app/health
```

**Javob:**
```json
{
  "status": "ok",
  "timestamp": "2024-12-09T10:00:00.000Z"
}
```

### 3. Application Logs

Railway dashboard → **Logs** bo'limida:
- ✅ Server ishga tushgan
- ✅ Database ulangan
- ✅ Migration'lar o'tgan
- ✅ WebSocket server ishga tushgan

---

## 🛠️ Muammolarni Hal Qilish

### Migration Xatosi

**Muammo:** `table already exists` xatosi

**Yechim:**
1. Migration faylida `hasTable` tekshiruvi borligini tekshiring
2. Try-catch bloklari mavjudligini tekshiring
3. Migration'ni rollback qilish kerak bo'lsa:

```bash
# Lokalda test qilish
npm run migrate:rollback

# Keyin yangi migration yaratish
npm run migrate:make migration_name
```

### Server Ishga Tushmayapti

**Tekshirish:**
1. **Logs** bo'limida xatolarni ko'ring
2. **Environment Variables** to'g'ri o'rnatilganligini tekshiring
3. **Health Check** endpoint'ni tekshiring

**Yechim:**
- Database fayli mavjudligini tekshiring
- Port to'g'ri o'rnatilganligini tekshiring
- Dependencies o'rnatilganligini tekshiring

### WebSocket Ulanishlar Uzilmoqda

**Sabab:** Deploy paytida qisqa vaqtga server restart bo'ladi

**Yechim:**
- Frontend'da **reconnection logic** mavjud
- Avtomatik qayta ulanish 2-3 soniyada amalga oshadi

---

## 📝 Deploy Checklist

Har bir deploy oldidan quyidagilarni tekshiring:

- [ ] Barcha o'zgarishlar commit qilingan
- [ ] Migration'lar idempotent (takrorlanuvchi)
- [ ] Environment variables to'g'ri
- [ ] Lokalda test qilingan
- [ ] Git push qilingan
- [ ] Railway deploy jarayoni kuzatilmoqda
- [ ] Health check o'tdi
- [ ] Application ishlayapti

---

## 🚨 Muhim Eslatmalar

### ✅ Xavfsiz Amaliyotlar

1. **Migration'lar har doim idempotent bo'lishi kerak**
2. **Backup olish** - muhim ma'lumotlar uchun
3. **Test qilish** - lokalda migration'larni test qiling
4. **Kichik o'zgarishlar** - katta o'zgarishlarni bir necha qismga bo'ling

### ⚠️ Ehtiyotkorlik

1. **Production database'ni to'g'ridan-to'g'ri o'zgartirmang**
2. **Migration rollback** qilishdan oldin backup oling
3. **Environment variables** o'zgartirganda ehtiyot bo'ling

---

## 📞 Qo'llab-quvvatlash

Agar muammo yuzaga kelsa:

1. **Railway Logs** ni tekshiring
2. **Health Check** endpoint'ni tekshiring
3. **Migration'lar** holatini tekshiring
4. **Git History** ni ko'rib chiqing

---

## 🔄 Zero-Downtime Deployment

Railway **avtomatik ravishda** zero-downtime deployment qiladi:

1. **Yangi container** build qilinadi
2. **Health check** o'tkaziladi
3. **Traffic** yangi versiyaga o'tkaziladi
4. **Eski versiya** o'chiriladi

**Natija:** Foydalanuvchilar hech qanday uzilish sezmaydi! 🎉

---

## 📚 Qo'shimcha Ma'lumot

- [Railway Documentation](https://docs.railway.app/)
- [Knex.js Migrations](https://knexjs.org/guide/migrations.html)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

