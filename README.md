# Hisobot tizimi

Hisobotlarni boshqarish, Telegram bot integratsiyasi va admin paneli.

---

## Git clone va sozlash

### 1. Clone

```bash
git clone https://github.com/Unknown0223/WeB.git
cd WeB
```

### 2. Dependencies

```bash
npm install
```

### 3. Environment

`env.example.txt` dan `.env` yarating va kerakli qiymatlarni kiriting:

```bash
# Windows
copy env.example.txt .env

# Linux / Mac
cp env.example.txt .env
```

`.env` da kamida quyidagilarni to'ldiring:

- `SESSION_SECRET` – sessiya kaliti (kamida 32 belgi)
- `DB_TYPE=sqlite` – development uchun (PostgreSQL uchun `POSTGRES_*` yoki `DATABASE_URL`)

Batafsil: `env.example.txt` ichidagi izohlar.

### 4. Migrations

```bash
npx knex migrate:latest --knexfile knexfile.js
```

Development uchun: `--env development` (default). Production: `--env production`.

### 5. Ishga tushirish

```bash
npm run dev
```

Yoki: `npm start`

Brauzerda: `http://localhost:3000`

---

## Skriptlar

| Skript | Vazifasi |
|--------|----------|
| `npm run dev` | Server (development) |
| `npm start` | Server (production rejim) |
| `npm run migrate:latest` | Migratsiyalarni ishga tushirish |
| `npm run pm2:start` | PM2 orqali ishga tushirish |

---

## Qo'shimcha

- **Deploy:** `DEPLOY-CHECKLIST.md`
- **Tezkor sozlash:** `QUICK-SETUP.md`
- **Boshqa kompyuterga ko'chirish:** `CONTINUE-FROM-OTHER-PC.md`

