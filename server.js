require('dotenv').config(); // .env faylini o'qish uchun eng yuqorida chaqiriladi
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createLogger } = require('./utils/logger.js');

const log = createLogger('SERVER');
const wsLog = createLogger('WEBSOCKET');
const botLog = createLogger('BOT');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const PORT = process.env.PORT || 3000;

// Railway.com va boshqa reverse proxy'lar uchun trust proxy sozlash
// Bu X-Forwarded-* header'larni to'g'ri ishlatish uchun kerak
app.set('trust proxy', 1);

// Railway yoki boshqa platformalar uchun APP_BASE_URL ni avtomatik aniqlash
if (!process.env.APP_BASE_URL) {
    // Railway uchun - bir nechta variantni tekshirish
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        process.env.APP_BASE_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
    // Railway'da boshqa variant
    else if (process.env.RAILWAY_STATIC_URL) {
        process.env.APP_BASE_URL = process.env.RAILWAY_STATIC_URL;
    }
    // Railway'da PORT va PUBLIC_DOMAIN kombinatsiyasi
    else if (process.env.RAILWAY_ENVIRONMENT) {
        process.env.APP_BASE_URL = `http://localhost:${PORT}`;
    }
    // Render.com uchun
    else if (process.env.RENDER_EXTERNAL_URL) {
        process.env.APP_BASE_URL = process.env.RENDER_EXTERNAL_URL;
    }
    // Heroku uchun
    else if (process.env.HEROKU_APP_NAME) {
        process.env.APP_BASE_URL = `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
    }
    // Boshqa holatda localhost (development)
    else {
        process.env.APP_BASE_URL = `http://localhost:${PORT}`;
    }
}

// Middlewares - Avatar uchun katta hajmli JSON qabul qilish (10MB gacha)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Yordamchi funksiyalar va DB ni import qilish (webhook uchun kerak)
const { db, initializeDB } = require('./db.js');
const { isAuthenticated, hasPermission } = require('./middleware/auth.js');
const { initializeBot, getBot } = require('./utils/bot.js');
const { startCleanupInterval } = require('./utils/cleanup.js');
const axios = require('axios');

// --- WEBHOOK UCHUN ENDPOINT (MIDDLEWARE'DAN OLDIN) ---
app.post('/telegram-webhook/:token', async (req, res) => {
    try {
        const secretToken = req.params.token;
        
        const bot = getBot();

        // Bot token'ni bazadan tekshirish
        const { getSetting } = require('./utils/settingsCache.js');
        const botToken = await getSetting('telegram_bot_token', null);

        if (!bot || !botToken) {
            log.error('[WEBHOOK] Bot yoki token mavjud emas!', { bot: !!bot, token: !!botToken });
            return res.status(503).json({ error: 'Bot ishga tushirilmagan' });
        }

        if (secretToken !== botToken) {
            return res.status(403).json({ error: 'Token mos kelmaydi' });
        }

        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: 'Empty request body' });
        }
        
        try {
            bot.processUpdate(req.body);
        } catch (error) {
            log.error('[WEBHOOK] bot.processUpdate() xatolik:', error.message);
            return res.status(500).json({ error: 'Update processing failed' });
        }
        
        res.status(200).json({ ok: true });
    } catch (error) {
        log.error('[WEBHOOK] Endpoint xatoligi:', error.message);
        
        // Xatolik bo'lsa ham 200 qaytaramiz, chunki Telegram qayta yuboradi
        res.status(200).json({ ok: false, error: error.message });
    }
});

// Static files va session middleware (webhook'dan keyin)
app.use(express.static(path.join(__dirname, 'public')));

// Production yoki development rejimini aniqlash (session store'dan oldin)
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';

// Sessiyani sozlash
const session = require('express-session');
const { isPostgres, isSqlite, getDbConnectionString } = require('./db.js');

// Session store sozlash (SQLite yoki PostgreSQL)
let sessionStore;
if (isPostgres) {
    // PostgreSQL session store
    const PostgreSQLStore = require('connect-pg-simple')(session);
    
    // db.js dan connection string olish (Railway.com uchun to'g'ri config)
    let pgConnection = getDbConnectionString();
    
    // Agar db.js dan connection string topilmasa, fallback: DATABASE_URL, DATABASE_PUBLIC_URL yoki knexfile
    if (!pgConnection) {
        if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) {
            pgConnection = process.env.DATABASE_URL;
        } else if (process.env.DATABASE_PUBLIC_URL && String(process.env.DATABASE_PUBLIC_URL).trim()) {
            pgConnection = process.env.DATABASE_PUBLIC_URL;
        } else {
            // Boshqa holatda knexfile.js dan config olish
            const config = require('./knexfile.js');
            const env = process.env.NODE_ENV || 'development';
            const dbConfig = config[env] || config.development;
            
            // PostgreSQL connection string yoki object
            if (typeof dbConfig.connection === 'string') {
                pgConnection = dbConfig.connection;
            } else if (dbConfig.connection && typeof dbConfig.connection === 'object') {
                const conn = dbConfig.connection;
                pgConnection = `postgresql://${conn.user}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;
            }
        }
    }
    
    // Railway.com'da SSL sozlamalarini qo'shish (self-signed certificate uchun)
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID || !!process.env.RAILWAY_SERVICE_NAME;
    
    // connect-pg-simple uchun config
    let pgConnectionConfig = {
        conString: pgConnection,
        tableName: 'sessions',
        createTableIfMissing: true
    };
    
    // Railway.com'da self-signed certificate uchun SSL sozlamalarini qo'shish
    if (isRailway && typeof pgConnection === 'string' && pgConnection.startsWith('postgresql://')) {
        // Connection string'ni parse qilib, pg client uchun SSL sozlamalarini qo'shish
        try {
            const { Pool } = require('pg');
            const url = require('url');
            const parsedUrl = new URL(pgConnection);
            
            // pg Pool: max:2 (Knex bilan jami ulanishlar ~7), keepAlive (ECONNRESET kamayadi), connectionTimeoutMillis
            const pool = new Pool({
                host: parsedUrl.hostname,
                port: parseInt(parsedUrl.port) || 5432,
                database: (parsedUrl.pathname || '').replace(/^\//, '') || 'postgres',
                user: parsedUrl.username,
                password: parsedUrl.password,
                ssl: { rejectUnauthorized: false },
                max: 2,
                idleTimeoutMillis: 10000,
                connectionTimeoutMillis: 10000,
                keepAlive: true
            });
            
            // connect-pg-simple'ga pool'ni berish
            pgConnectionConfig = {
                pool: pool,
                tableName: 'sessions',
                createTableIfMissing: true
            };
        } catch (parseError) {
            // Parse xatolik bo'lsa, connection string'ni ishlatish
            log.warn('[SESSION] Connection string parse qilishda xatolik, connection string ishlatilmoqda:', parseError.message);
            // Connection string'ga SSL parametrlarini qo'shish
            if (!pgConnection.includes('?ssl=') && !pgConnection.includes('?sslmode=')) {
                pgConnection = pgConnection + (pgConnection.includes('?') ? '&' : '?') + 'sslmode=require';
            }
            pgConnectionConfig = {
                conString: pgConnection,
                tableName: 'sessions',
                createTableIfMissing: true
            };
        }
    }
    
    sessionStore = new PostgreSQLStore(pgConnectionConfig);
} else {
    // SQLite session store (faqat development uchun)
    // Production'da (Railway, Render, Heroku) PostgreSQL ishlatiladi
    if (isProduction) {
        log.error('[SESSION] Production rejimida SQLite ishlatilmoqda! PostgreSQL sozlang.');
        log.error('[SESSION] Railway.com uchun PostgreSQL service qo\'shing va DATABASE_URL ni sozlang.');
        throw new Error('Production rejimida SQLite ishlatilmaydi. PostgreSQL sozlang.');
    }
    
    const SQLiteStore = require('connect-sqlite3')(session);
    sessionStore = new SQLiteStore({
        db: 'database.db',
        dir: path.join(__dirname),
        table: 'sessions'
    });
}
// Railway.com yoki boshqa cloud platformalar uchun HTTPS tekshiruvi
const isSecure = isProduction || 
                 process.env.RAILWAY_PUBLIC_DOMAIN || 
                 process.env.APP_BASE_URL?.startsWith('https://') ||
                 process.env.HTTPS === 'true';

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'a-very-strong-and-long-secret-key-for-session',
    resave: false,
    saveUninitialized: false,
    name: 'sessionId', // Default 'connect.sid' o'rniga
    cookie: { 
        secure: isSecure, // Production'da HTTPS uchun true
        maxAge: 1000 * 60 * 60 * 24, // 1 kun
        sameSite: isSecure ? 'none' : 'lax', // HTTPS uchun cross-site cookie
        httpOnly: true, // XSS hujumlaridan himoya qilish
        // Domain ni o'rnatmaymiz - bu cookie'ni barcha subdomain'larda ishlashiga imkon beradi
    },
    proxy: true, // Railway.com kabi reverse proxy orqali ishlaganda
    rolling: true // Har bir request'da cookie'ni yangilash
}));

// Markaziy routerni ulash
app.use('/api', require('./routes'));

// Server initialization holati
let serverInitialized = false;
let serverInitError = null;

// Health check endpoint (Railway va boshqa platformalar uchun)
app.get('/health', (req, res) => {
    if (!serverInitialized) {
        // Agar server hali initialization jarayonida bo'lsa, 503 qaytarish
        // Lekin Railway healthcheck uchun 200 qaytarish kerak
        res.status(200).json({ 
            status: 'starting', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            message: 'Server initialization in progress...'
        });
    } else if (serverInitError) {
        // Agar initialization xatolik bilan tugagan bo'lsa
        res.status(503).json({ 
            status: 'error', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            error: serverInitError.message
        });
    } else {
        // Server to'liq tayyor
        res.status(200).json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    }
});

// --- Sahifalarni ko'rsatish (HTML Routing) ---
app.get('/login', (req, res) => {
    const loginPageStartTime = Date.now();
    log.info('[ROUTE] ═══════════════════════════════════════════════════════════');
    log.info('[ROUTE] 📄 LOGIN PAGE REQUEST');
    log.info(`[ROUTE] 📅 Vaqt: ${new Date().toISOString()}`);
    log.info(`[ROUTE] 🌐 IP: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
    log.info(`[ROUTE] 👤 User Agent: ${req.headers['user-agent']}`);
    log.info(`[ROUTE] 🔐 Session mavjud: ${!!req.session.user}`);
    
    if (req.session.user) {
        log.info(`[ROUTE] ✅ User allaqachon login qilgan, redirect: /`);
        log.info(`[ROUTE] 👤 User ID: ${req.session.user.id}, Username: ${req.session.user.username}`);
        res.redirect('/');
    } else {
        log.info('[ROUTE] Login sahifasi yuborilmoqda...');
        const sendStartTime = Date.now();
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
        const sendDuration = Date.now() - sendStartTime;
        const totalDuration = Date.now() - loginPageStartTime;
        log.info(`[ROUTE] ✅ Login sahifasi yuborildi (${sendDuration}ms)`);
        log.info(`[ROUTE] ⏱️  Jami vaqt: ${totalDuration}ms`);
        log.info('[ROUTE] ═══════════════════════════════════════════════════════════');
    }
});

app.get('/bot-connect.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bot-connect.html'));
});

app.get('/register.html', (req, res) => {
    if (req.session.user) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'register.html'));
    }
});

// Admin paneliga kirish huquqini tekshirish
// Super admin yoki admin role'ga ega foydalanuvchilar yoki kerakli permissions'ga ega foydalanuvchilar kirishi mumkin
const canAccessAdminPanel = (req, res, next) => {
    // Agar session yoki user mavjud bo'lmasa, isAuthenticated middleware xatolik qaytaradi
    if (!req.session || !req.session.user) {
        return res.status(401).json({ message: "Avtorizatsiyadan o'tmagansiz." });
    }
    
    const userRole = req.session.user?.role;
    const userPermissions = req.session.user?.permissions || [];
    
    // Super admin yoki admin barcha cheklovlardan ozod
    if (userRole === 'superadmin' || userRole === 'super_admin' || userRole === 'admin') {
        return next();
    }
    
    // Boshqa foydalanuvchilar uchun kerakli permissions'ga ega bo'lishi kerak
    const requiredPermissions = ['dashboard:view', 'users:view', 'settings:view', 'roles:manage', 'audit:view'];
    const hasAnyRequiredPermission = requiredPermissions.some(p => userPermissions.includes(p));
    
    if (hasAnyRequiredPermission) {
        next();
    } else {
        res.status(403).json({ message: "Admin paneliga kirish uchun sizda yetarli huquq yo'q." });
    }
};

app.get('/admin', isAuthenticated, canAccessAdminPanel, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', isAuthenticated, (req, res) => {
    // Barcha foydalanuvchilar asosiy sahifani ko'radi
    // Admin huquqiga ega bo'lganlar uchun tepada "Boshqaruv Paneli" tugmasi ko'rinadi
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Boshqa barcha so'rovlar uchun
app.get('*', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/');
    } else {
        res.redirect('/login');
    }
});

// WebSocket ulanishlarini boshqarish
wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Xabarni barcha ulanishga yuborish (broadcast)
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (error) {
            wsLog.error('Xabarni qayta ishlashda xato:', error.message);
        }
    });
    
    ws.on('close', (code, reason) => {
        // Connection closed (log removed for production)
    });
    
    ws.on('error', (error) => {
        wsLog.error(`WebSocket xatolik. IP: ${clientIp}`, error.message);
    });
    
    // Ping/Pong uchun
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// WebSocket upgrade xatoliklarini boshqarish
wss.on('error', (error) => {
    wsLog.error('Server xatosi:', error.message);
});

// Har 30 soniyada ping yuborish (ulanish holatini tekshirish)
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// Broadcast funksiyasi (boshqa routerlar uchun)
global.broadcastWebSocket = (type, payload) => {
    const message = JSON.stringify({ type, payload });
    
    wss.clients.forEach((client) => {
        try {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        } catch (error) {
            wsLog.error('WebSocket yuborishda xatolik:', error.message);
        }
    });
};

// Serverni ishga tushirish
(async () => {
    const serverStartTime = Date.now();
    log.info('═══════════════════════════════════════════════════════════');
    log.info('🚀 SERVER INITIALIZATION BOSHLANDI');
    log.info(`📅 Vaqt: ${new Date().toISOString()}`);
    log.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info(`🔧 Railway Environment: ${process.env.RAILWAY_ENVIRONMENT || 'NO'}`);
    log.info(`🔌 Port: ${PORT}`);
    log.info(`🌐 APP_BASE_URL: ${process.env.APP_BASE_URL || 'NOT SET'}`);
    log.info('═══════════════════════════════════════════════════════════');
    
    try {
        // Server'ni darhol listen qilish (healthcheck uchun)
        // Initialization background'da davom etadi
        server.listen(PORT, '0.0.0.0', () => {
            const listenDuration = Date.now() - serverStartTime;
            log.info(`✅ Server ${PORT} portida ishga tushdi (${listenDuration}ms)`);
            log.info(`🌐 Healthcheck: http://0.0.0.0:${PORT}/health`);
            
            // PM2 uchun ready signal
            if (process.send) {
                process.send('ready');
            }
        });
        
        // Database initialization (background'da)
        log.info('[INIT] Database initialization boshlandi...');
        const dbInitStartTime = Date.now();
        try {
            await initializeDB();
            const dbInitDuration = Date.now() - dbInitStartTime;
            log.info(`[INIT] ✅ Database initialization muvaffaqiyatli tugadi (${dbInitDuration}ms)`);
            
            // Startup operatsiyalarini ketma-ket qilish (connection pool to'lib qolmasligi uchun)
            // Delay qo'shish connection'lar orasida
            log.info('[INIT] Startup operatsiyalari boshlandi...');
            await new Promise(resolve => setTimeout(resolve, 500));
        
            // Buzilgan session'larni tozalash (server ishga tushganda)
            log.info("[INIT] Buzilgan session'larni tozalash boshlandi...");
            const sessionCleanupStartTime = Date.now();
            try {
                const sessions = await db('sessions').select('sid', 'sess').limit(1000); // Limit qo'shish
                let corruptedCount = 0;
                
                for (const session of sessions) {
                    try {
                        if (!session.sess || session.sess.trim() === '') {
                            await db('sessions').where({ sid: session.sid }).del();
                            corruptedCount++;
                            continue;
                        }
                        
                        const sessionData = JSON.parse(session.sess);
                        if (!sessionData || typeof sessionData !== 'object') {
                            await db('sessions').where({ sid: session.sid }).del();
                            corruptedCount++;
                        }
                    } catch (e) {
                        // Buzilgan session'ni o'chirish
                        await db('sessions').where({ sid: session.sid }).del();
                        corruptedCount++;
                    }
                }
                
                const sessionCleanupDuration = Date.now() - sessionCleanupStartTime;
                if (corruptedCount > 0) {
                    log.info(`[INIT] ✅ ${corruptedCount} ta buzilgan sessiya tozalandi (${sessionCleanupDuration}ms)`);
                } else {
                    log.info(`[INIT] ✅ Session cleanup tugadi, buzilgan sessiya topilmadi (${sessionCleanupDuration}ms)`);
                }
            } catch (cleanupError) {
                log.warn('[INIT] ⚠️ Buzilgan sessionlarni tozalashda xatolik:', cleanupError.message);
            }
            
            // Delay qo'shish
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Vaqtinchalik fayllarni tozalash mexanizmini ishga tushirish
            log.info('[INIT] Vaqtinchalik fayllarni tozalash mexanizmi ishga tushirilmoqda...');
            // Har 1 soatda bir marta, 1 soatdan eski fayllarni o'chirish
            startCleanupInterval(1, 1);
            log.info('[INIT] ✅ Vaqtinchalik fayllarni tozalash mexanizmi ishga tushirildi');
            
            // Delay qo'shish
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Orphaned yozuvlarni tozalash (server ishga tushganda) - background'da
            log.info('[INIT] Orphaned yozuvlarni tozalash background\'da boshlandi...');
            // Bu operatsiyani background'ga o'tkazish, server bloklamasligi uchun
            setImmediate(async () => {
                const orphanCleanupStartTime = Date.now();
                try {
                    const existingUserIds = new Set();
                    const users = await db('users').select('id');
                    users.forEach(user => existingUserIds.add(user.id));
                    log.info(`[INIT] [CLEANUP] ${existingUserIds.size} ta foydalanuvchi topildi`);
                    
                    const tablesToClean = [
                        { table: 'user_permissions', fkColumn: 'user_id' },
                        { table: 'user_locations', fkColumn: 'user_id' },
                        { table: 'user_brands', fkColumn: 'user_id' },
                        { table: 'reports', fkColumn: 'created_by' },
                        { table: 'report_history', fkColumn: 'changed_by' },
                        { table: 'audit_logs', fkColumn: 'user_id' },
                        { table: 'password_change_requests', fkColumn: 'user_id' },
                        { table: 'pivot_templates', fkColumn: 'created_by' },
                        { table: 'magic_links', fkColumn: 'user_id' },
                        { table: 'notifications', fkColumn: 'user_id' }
                    ];
                    
                    let totalDeleted = 0;
                    for (const { table, fkColumn } of tablesToClean) {
                        try {
                            const hasTable = await db.schema.hasTable(table);
                            if (hasTable) {
                                const deleted = await db(table)
                                    .whereNotNull(fkColumn)
                                    .whereNotIn(fkColumn, Array.from(existingUserIds))
                                    .del();
                                if (deleted > 0) {
                                    totalDeleted += deleted;
                                    log.info(`[INIT] [CLEANUP] ${table} jadvalidan ${deleted} ta orphaned yozuv o'chirildi`);
                                }
                            }
                            // Har bir jadvaldan keyin kichik delay
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (err) {
                            // Jadval mavjud emas yoki xatolik - e'tiborsiz qoldirish
                        }
                    }
                    
                    const orphanCleanupDuration = Date.now() - orphanCleanupStartTime;
                    if (totalDeleted > 0) {
                        log.info(`[INIT] [CLEANUP] ✅ Jami ${totalDeleted} ta orphaned yozuv o'chirildi (${orphanCleanupDuration}ms)`);
                    } else {
                        log.info(`[INIT] [CLEANUP] ✅ Orphaned yozuvlar topilmadi (${orphanCleanupDuration}ms)`);
                    }
                } catch (cleanupError) {
                    log.error('[INIT] [CLEANUP] ❌ Orphaned yozuvlarni tozalashda xatolik:', cleanupError.message);
                }
            });
            
            // Delay qo'shish
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Bot initialization
            log.info('[INIT] Bot initialization boshlandi...');
            const botInitStartTime = Date.now();
            const { getSetting } = require('./utils/settingsCache.js');
            // Bot token: faqat telegram_bot_token ishlatiladi (bot bitta)
            const botToken = await getSetting('telegram_bot_token', null);
            const telegramEnabled = await getSetting('telegram_enabled', 'false');
            
            log.info(`[INIT] Bot token mavjud: ${!!botToken}, Telegram enabled: ${telegramEnabled}`);

            // Bot token mavjud bo'lsa, bot'ni ishga tushirish
            // telegram_enabled sozlamasiga bog'liq emas, chunki debt_bot_token alohida bot uchun
            if (botToken && botToken.trim() !== '') {
                (async () => {
                    // Deploy uchun webhook rejimida ishga tushirish
                    const appBaseUrl = process.env.APP_BASE_URL;
                    
                    if (appBaseUrl && appBaseUrl.startsWith('https://')) {
                        // Webhook avtomatik o'rnatish
                        const webhookUrl = `${appBaseUrl}/telegram-webhook/${botToken}`;
                        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
                        
                        log.info(`[INIT] [BOT] Webhook URL: ${webhookUrl}`);
                        
                        try {
                            // Avval eski webhookni o'chirish (agar mavjud bo'lsa)
                            try {
                                await axios.post(`${telegramApiUrl}`, { url: '' });
                                log.info("[INIT] [BOT] Eski webhook o'chirildi");
                            } catch (deleteError) {
                                // Xatolik bo'lsa ham davom etamiz
                                log.debug("[INIT] [BOT] Eski webhook o'chirishda xatolik (e'tiborsiz qoldirildi)");
                            }
                            
                            // Yangi webhookni o'rnatish
                            log.info("[INIT] [BOT] Yangi webhook o'rnatilmoqda...");
                            const response = await axios.post(telegramApiUrl, { 
                                url: webhookUrl,
                                allowed_updates: ['message', 'callback_query', 'my_chat_member']
                            });
                            
                            if (response.data.ok) {
                                log.info("[INIT] [BOT] ✅ Webhook muvaffaqiyatli o'rnatildi");
                                // Webhook rejimida botni ishga tushirish
                                await initializeBot(botToken, { polling: false });
                                const botInitDuration = Date.now() - botInitStartTime;
                                log.info(`[INIT] [BOT] ✅ Bot webhook rejimida ishga tushirildi (${botInitDuration}ms)`);
                            } else {
                                botLog.error('[INIT] [BOT] ❌ Telegram webhookni o\'rnatishda xatolik:', response.data.description);
                                
                                // Fallback: polling rejimi (faqat development uchun)
                                if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT) {
                                    log.info('[INIT] [BOT] Fallback: polling rejimi ishga tushirilmoqda...');
                                    await initializeBot(botToken, { polling: true });
                                    const botInitDuration = Date.now() - botInitStartTime;
                                    log.info(`[INIT] [BOT] ✅ Bot polling rejimida ishga tushirildi (${botInitDuration}ms)`);
                                }
                            }
                        } catch (error) {
                            botLog.error('[INIT] [BOT] ❌ Telegram API\'ga ulanishda xatolik:', error.message);
                            
                            // Fallback: polling rejimi (faqat development uchun)
                            if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT) {
                                log.info('[INIT] [BOT] Fallback: polling rejimi ishga tushirilmoqda...');
                                await initializeBot(botToken, { polling: true });
                                const botInitDuration = Date.now() - botInitStartTime;
                                log.info(`[INIT] [BOT] ✅ Bot polling rejimida ishga tushirildi (${botInitDuration}ms)`);
                            }
                        }
                    } else {
                        // Lokal yoki webhook sozlanmagan - polling rejimi (faqat development uchun)
                        log.info('[INIT] [BOT] Lokal environment - polling rejimi ishga tushirilmoqda...');
                        await initializeBot(botToken, { polling: true });
                        const botInitDuration = Date.now() - botInitStartTime;
                        log.info(`[INIT] [BOT] ✅ Bot polling rejimida ishga tushirildi (${botInitDuration}ms)`);
                    }
                })(); // Async IIFE - bot initialization server bloklamaydi
            } else {
                log.info('[INIT] [BOT] Bot token topilmadi, bot ishga tushirilmadi');
            }
            
            // Server initialization muvaffaqiyatli tugadi
            serverInitialized = true;
            const totalInitDuration = Date.now() - serverStartTime;
            log.info('═══════════════════════════════════════════════════════════');
            log.info(`✅ SERVER INITIALIZATION MUVAFFAQIYATLI TUGADI`);
            log.info(`⏱️  Jami vaqt: ${totalInitDuration}ms`);
            log.info('═══════════════════════════════════════════════════════════');
        } catch (initError) {
            serverInitError = initError;
            const totalInitDuration = Date.now() - serverStartTime;
            log.error('═══════════════════════════════════════════════════════════');
            log.error('❌ SERVER INITIALIZATION XATOLIK');
            log.error(`⏱️  Vaqt: ${totalInitDuration}ms`);
            log.error(`📝 Xatolik: ${initError.message}`);
            log.error(`📚 Stack: ${initError.stack}`);
            log.error('═══════════════════════════════════════════════════════════');
            // Xatolik bo'lsa ham server ishlaydi, lekin ba'zi funksiyalar ishlamasligi mumkin
        }
    } catch (err) {
        serverInitError = err;
        const totalInitDuration = Date.now() - serverStartTime;
        log.error('═══════════════════════════════════════════════════════════');
        log.error('❌ SERVER STARTUP XATOLIK');
        log.error(`⏱️  Vaqt: ${totalInitDuration}ms`);
        log.error(`📝 Xatolik: ${err.message}`);
        log.error(`📚 Stack: ${err.stack}`);
        log.error('═══════════════════════════════════════════════════════════');
        // Xatolik bo'lsa ham server ishlaydi, lekin ba'zi funksiyalar ishlamasligi mumkin
    }
})();

// Graceful shutdown funksiyasi
async function gracefulShutdown(signal) {
    let shutdownTimeout;
    
    // Timeout - agar 10 soniyada to'xtatilmasa, majburiy to'xtatish
    shutdownTimeout = setTimeout(() => {
        log.error('Graceful shutdown vaqti tugadi. Majburiy to\'xtatish...');
        process.exit(1);
    }, 10000);
    
    try {
        // 1. Bot polling'ni to'xtatish
        const { getBot } = require('./utils/bot.js');
        const bot = getBot();
        if (bot && bot.isPolling && bot.isPolling()) {
            try {
                await bot.stopPolling();
            } catch (botError) {
                log.error('Bot polling to\'xtatishda xatolik:', botError.message);
            }
        }
        
        // 2. WebSocket server'ni yopish
        if (wss && wss.clients) {
            
            // Barcha clientlarni yopish
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.close();
                }
            });
            
            await new Promise((resolve) => {
                wss.close(() => {
                    resolve();
                });
            });
        }
        
        // 3. HTTP server'ni yopish
        if (server && server.listening) {
            await new Promise((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        }
        
        // 4. Database connection'ni yopish (agar kerak bo'lsa)
        const { db } = require('./db.js');
        if (db && db.destroy) {
            try {
                await db.destroy();
            } catch (dbError) {
                log.error('Database yopishda xatolik:', dbError.message);
            }
        }
        
        clearTimeout(shutdownTimeout);
        process.exit(0);
        
    } catch (error) {
        log.error('Graceful shutdown xatolik:', error.message);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}

// Graceful shutdown - Ctrl+C yoki process termination
process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
});

// Unhandled promise rejection
process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection:', reason);
});

// Uncaught exception
process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error.message);
    process.exit(1);
});
