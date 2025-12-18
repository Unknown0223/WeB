const { db } = require('../db.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('AUTH');

/**
 * Foydalanuvchi tizimga kirganligini, sessiyasi aktiv ekanligini va
 * (agar admin bo'lmasa) Telegramga ulanganligini tekshiradi.
 */
const isAuthenticated = async (req, res, next) => {
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
        // Barcha boshqa foydalanuvchilar uchun telegram obunasi majburiy
        const userRole = userSessionData.role;
        const userStatus = user.status;

        // Superadmin uchun telegram tekshiruvi o'tkazib yuboriladi
        if (userRole !== 'superadmin' && userRole !== 'super_admin') {
            const isTelegramConnected = user.is_telegram_connected === 1 || user.is_telegram_connected === true;
            const hasTelegramChatId = !!user.telegram_chat_id;

            // Agar telegram obunasi bekor qilingan bo'lsa (telegram_chat_id null), foydalanuvchini tizimdan chiqarish
            if (!isTelegramConnected || !hasTelegramChatId) {
                const botUsernameSetting = await db('settings').where({ key: 'telegram_bot_username' }).first();
                const botUsername = botUsernameSetting ? botUsernameSetting.value : null;

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
        log.error("isAuthenticated middleware xatoligi:", error);
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
