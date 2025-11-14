require('dotenv').config(); // .env faylini o'qish uchun eng yuqorida chaqiriladi
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessiyani sozlash
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

app.use(session({
    store: new SQLiteStore({ db: 'database.db', dir: './' }),
    secret: process.env.SESSION_SECRET || 'a-very-strong-and-long-secret-key-for-session',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 1 kun
}));

// Yordamchi funksiyalar va DB ni import qilish
const { db, initializeDB } = require('./db.js');
const { isAuthenticated, hasPermission } = require('./middleware/auth.js');
const { initializeBot, getBot } = require('./utils/bot.js');

// --- WEBHOOK UCHUN ENDPOINT ---
app.post('/telegram-webhook/:token', (req, res) => {
    const bot = getBot();
    const secretToken = req.params.token;

    if (bot && bot.token === secretToken) {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    } else {
        res.sendStatus(403);
    }
});

// Markaziy routerni ulash
app.use('/api', require('./routes'));

// --- Sahifalarni ko'rsatish (HTML Routing) ---
app.get('/login', (req, res) => {
    if (req.session.user) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.get('/register.html', (req, res) => {
    if (req.session.user) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'register.html'));
    }
});

// Admin paneliga kirish huquqini tekshirish
const canAccessAdminPanel = hasPermission(['dashboard:view', 'users:view', 'settings:view', 'roles:manage', 'audit:view']);

app.get('/admin', isAuthenticated, canAccessAdminPanel, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', isAuthenticated, (req, res) => {
    // Foydalanuvchining admin paneliga kirish huquqi bor-yo'qligini tekshiramiz
    const userPermissions = req.session.user.permissions || [];
    const adminPanelPermissions = ['dashboard:view', 'users:view', 'settings:view', 'roles:manage', 'audit:view'];
    const hasAdminAccess = adminPanelPermissions.some(p => userPermissions.includes(p));

    if (hasAdminAccess) {
        res.redirect('/admin');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Boshqa barcha so'rovlar uchun
app.get('*', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/');
    } else {
        res.redirect('/login');
    }
});

// Serverni ishga tushirish
(async () => {
    try {
        await initializeDB();
        
        const tokenSetting = await db('settings').where({ key: 'telegram_bot_token' }).first();
        const botToken = tokenSetting ? tokenSetting.value : null;

        if (botToken) {
            await initializeBot(botToken, { polling: false });
        } else {
            console.warn("Ma'lumotlar bazasida bot tokeni topilmadi. Bot ishga tushirilmadi. Iltimos, admin panel orqali tokenni kiriting.");
        }

        app.listen(PORT, () => {
            console.log(`Server http://localhost:${PORT} manzilida ishga tushdi`  );
        });
    } catch (err) {
        console.error("Serverni ishga tushirishda DB yoki Bot bilan bog'liq xatolik:", err);
        process.exit(1);
    }
})();
