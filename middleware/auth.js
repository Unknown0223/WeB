const { db } = require('../db.js');
const { createLogger } = require('../utils/logger.js');
const { getSetting } = require('../utils/settingsCache.js');
const log = createLogger('AUTH');

/**
 * Foydalanuvchi tizimga kirganligini, sessiyasi aktiv ekanligini va
 * (agar admin bo'lmasa) Telegramga ulanganligini tekshiradi.
 */
const isAuthenticated = async (req, res, next) => {
    const _path = req.path || req.url || '/';
    const _sid = (req.sessionID || '').slice(0, 12);
    log.debug(`[AUTH] isAuthenticated start path=${_path} sid=${_sid}...`);

    try {
        // 1. Sessiya va foydalanuvchi mavjudligini tekshirish
        if (!req.session || !req.session.user) {
            return res.status(401).json({ 
                message: "Avtorizatsiyadan o'tmagansiz. Iltimos, tizimga kiring.",
                action: 'logout' 
            });
        }

        const userSessionData = req.session.user;
        const userId = userSessionData.id;

        // 2. Sessiya bazada mavjudligini tekshirish
        log.debug(`[AUTH] DB: sessions tekshiruvi sid=${_sid}...`);
        const sessionExists = await db('sessions').where({ sid: req.sessionID }).first();
        if (!sessionExists) {
            req.session.destroy((err) => {
                if (err) log.error("Sessiyani tugatishda xatolik:", err);
                return res.status(401).json({ 
                    message: "Sessiyangiz tugatildi. Iltimos, qayta kiring.",
                    action: 'logout'
                });
            });
            return;
        }

        // 3. Foydalanuvchining joriy ma'lumotlarini bazadan olish
        log.debug(`[AUTH] DB: users userId=${userId}`);
        const user = await db('users').where({ id: userId }).select('id', 'status', 'telegram_chat_id', 'is_telegram_connected').first();

        // Agar foydalanuvchi bazadan o'chirilgan bo'lsa
        if (!user) {
             req.session.destroy((err) => {
                if (err) log.error("Sessiyani tugatishda xatolik:", err);
                return res.status(401).json({ 
                    message: "Foydalanuvchi topilmadi. Sessiya tugatildi.",
                    action: 'logout'
                });
            });
            return;
        }

        // === YANGI MANTIQ: MAJBURIY TELEGRAM OBUNASINI TEKSHIRISH ===
        // Superadmin (role='superadmin' yoki 'super_admin') uchun bu tekshiruv o'tkazib yuboriladi.
        // Telegram aktiv bo'lsa va foydalanuvchi superadmin bo'lmasa, telegram obunasi majburiy
        const userRole = userSessionData.role;
        const userStatus = user.status;

        // Telegram aktiv holatini tekshirish (settingsCache orqali - DB yukini kamaytiradi)
        const telegramEnabledRaw = await getSetting('telegram_enabled', 'false');
        const telegramEnabled = telegramEnabledRaw === 'true' || telegramEnabledRaw === true;

        // Superadmin uchun telegram tekshiruvi o'tkazib yuboriladi
        // Telegram neaktiv bo'lsa, bot obunasi shartdan shart emasga o'tadi
        if (telegramEnabled && userRole !== 'superadmin' && userRole !== 'super_admin') {
            const isTelegramConnected = user.is_telegram_connected === 1 || user.is_telegram_connected === true;
            const hasTelegramChatId = !!user.telegram_chat_id;

            // Agar telegram obunasi bekor qilingan bo'lsa (telegram_chat_id null), foydalanuvchini tizimdan chiqarish
            if (!isTelegramConnected || !hasTelegramChatId) {
                const botUsername = (await getSetting('telegram_bot_username', '')) || null;

                // Sessiyani tugatish
                req.session.destroy((err) => {
                    if (err) log.error("Majburiy obuna tufayli sessiyani tugatishda xatolik:", err);

                    // Foydalanuvchiga maxsus javob yuborish
                    return res.status(403).json({
                        message: "Tizimdan foydalanish uchun Telegram botga obuna bo'lishingiz shart. Iltimos, qayta obuna bo'lib, tizimga qayta kiring.",
                        action: 'force_telegram_subscription',
                        subscription_link: botUsername ? `https://t.me/${botUsername}` : null
                    } );
                });
                return; // Keyingi middleware'ga o'tishni to'xtatish
            }
        }
        // ==========================================================

        // Sessiyani yangilash va keyingi qadamga o'tish
        req.session.touch(); 
        next();

    } catch (error) {
        const isPoolTimeout = 
            error.name === 'KnexTimeoutError' ||
            (error.message && (
                String(error.message).includes('Timeout acquiring a connection') ||
                String(error.message).includes('pool is probably full')
            ));

        if (isPoolTimeout) {
            log.error(`[AUTH] POOL TIMEOUT path=${_path} sid=${_sid} - Knex ulanish ololmayapti. Tekshiring: 1) DB max_connections (Postgres), 2) Session store pool (server.js max:5), 3) Uzoq so'rovlar.`, error.message);
        } else {
            log.error("[AUTH] isAuthenticated middleware xatoligi:", error.message || error);
        }
        res.status(500).json({ message: "Sessiyani tekshirishda ichki xatolik." });
    }
};

/**
 * Kerakli huquq(lar)dan kamida bittasi borligini tekshiruvchi middleware generatori.
 * @param {string|string[]} requiredPermissions - Talab qilinadigan huquq(lar).
 * @returns {function} Express middleware funksiyasi.
 */
const hasPermission = (requiredPermissions) => {
    return (req, res, next) => {
        const userRole = req.session.user?.role;
        const userPermissions = req.session.user?.permissions || [];
        
        // Superadmin barcha cheklovlardan ozod
        if (userRole === 'superadmin' || userRole === 'super_admin') {
            return next();
        }
        
        const permissionsToCheck = Array.isArray(requiredPermissions) 
            ? requiredPermissions 
            : [requiredPermissions];

        const hasAnyRequiredPermission = permissionsToCheck.some(p => userPermissions.includes(p));

        if (hasAnyRequiredPermission) {
            next();
        } else {
            res.status(403).json({ message: "Bu amalni bajarish uchun sizda yetarli huquq yo'q." });
        }
    };
};

const isAdmin = hasPermission('roles:manage');
const isManagerOrAdmin = hasPermission('dashboard:view');

module.exports = {
    isAuthenticated,
    hasPermission,
    isAdmin,
    isManagerOrAdmin
};
