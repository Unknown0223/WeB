const express = require('express');
const axios = require('axios');
const { db } = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { initializeBot, stopBot } = require('../utils/bot');
const { createLogger } = require('../utils/logger.js');
const { getSettings, clearSettingsCache, getSetting } = require('../utils/settingsCache.js');
const log = createLogger('SETTINGS');

const router = express.Router();

async function setWebhook(botToken) {
    if (!botToken) {
        return;
    }

    const appBaseUrl = process.env.APP_BASE_URL;

    if (!appBaseUrl) {
        log.warn("APP_BASE_URL o'rnatilmagan. Polling rejimida ishga tushiriladi.");
        // Localhost yoki development rejimida polling rejimida ishga tushirish
        if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT) {
            if (!require('../utils/bot').getBot()) {
                await initializeBot(botToken, { polling: true });
            }
        }
        return;
    }

    // HTTPS tekshiruvi - agar HTTPS bo'lmasa, webhook o'rnatmaymiz
    if (!appBaseUrl.startsWith('https://')) {
        log.warn(`APP_BASE_URL (${appBaseUrl}) HTTPS emas. Webhook o'rnatilmaydi.`);
        // Localhost yoki development rejimida polling rejimida ishga tushirish
        if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT) {
            if (!require('../utils/bot').getBot()) {
                await initializeBot(botToken, { polling: true });
            }
        }
        return;
    }

    // HTTPS bo'lsa, webhook o'rnatish
    const webhookUrl = `${appBaseUrl}/telegram-webhook/${botToken}`;
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

    try {
        const response = await axios.post(telegramApiUrl, { 
            url: webhookUrl,
            allowed_updates: ['message', 'callback_query', 'my_chat_member']
        });
        if (response.data.ok) {
            // Bot allaqachon initialize qilingan bo'lishi mumkin, shuning uchun faqat tekshiramiz
            if (!require('../utils/bot').getBot()) {
                await initializeBot(botToken, { polling: false });
            }
            log.info('Telegram webhook muvaffaqiyatli o\'rnatildi');
        } else {
            log.error("Telegram webhookni o'rnatishda xatolik:", response.data.description);
        }
    } catch (error) {
        // Rate limit xatoliklarini tushunish
        if (error.response && error.response.data && error.response.data.error_code === 429) {
            log.warn(`Telegram API rate limit: ${error.response.data.description}. Qayta urinish kerak.`);
        } else {
            log.error("Telegram API'ga ulanishda xatolik:", error.response ? error.response.data : error.message);
        }
    }
}

// GET /api/settings - Cache'dan o'qish
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const settings = await getSettings();
        res.json(settings);
    } catch (error) {
        log.error("/api/settings GET xatoligi:", error.message);
        res.status(500).json({ message: "Sozlamalarni yuklashda xatolik" });
    }
});

// POST /api/settings - Sozlamalarni saqlash
router.post('/', isAuthenticated, async (req, res, next) => {
    const { key } = req.body;
    
    // Key mavjudligini tekshirish
    if (!key) {
        return res.status(400).json({ message: "Sozlama kaliti (key) yuborilishi shart." });
    }
    
    // Key ni string'ga o'tkazish va trim qilish
    const keyStr = String(key).trim();
    
    const userPermissions = req.session.user?.permissions || [];

    let requiredPermission;
    switch (keyStr) {
        case 'app_settings':
            requiredPermission = 'settings:edit_table';
            break;
        case 'telegram_bot_token':
        case 'telegram_group_id':
        case 'telegram_admin_chat_id':
        case 'telegram_bot_username':
        case 'telegram_enabled':
            requiredPermission = 'settings:edit_telegram';
            break;
        case 'pagination_limit':
        case 'branding_settings':
        case 'kpi_settings':
            requiredPermission = 'settings:edit_general';
            break;
        default:
            log.warn(`Noma'lum sozlama kaliti: "${keyStr}" (typeof: ${typeof key}, original: ${JSON.stringify(key)})`);
            return res.status(400).json({ message: `Noma'lum sozlama kaliti: "${keyStr}"` });
    }

    if (userPermissions.includes(requiredPermission)) {
        next();
    } else {
        return res.status(403).json({ message: `"${key}" sozlamasini o'zgartirish uchun sizda yetarli huquq yo'q.` });
    }
}, async (req, res) => {
    const { key, value } = req.body;
    
    // Key va value mavjudligini tekshirish
    if (!key) {
        return res.status(400).json({ message: "Sozlama kaliti (key) yuborilishi shart." });
    }
    
    if (value === undefined) {
        return res.status(400).json({ message: `"${key}" sozlamasi uchun qiymat (value) yuborilishi shart.` });
    }
    
    try {
        // Bo'sh string ham qabul qilinadi (tozalash uchun)
        const valueToSave = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : String(value);
        
        await db('settings')
            .insert({ key: key, value: valueToSave })
            .onConflict('key')
            .merge();
        
        // Cache'ni tozalash
        clearSettingsCache();
        
        // Telegram sozlamalarini boshqarish
        if (key === 'telegram_enabled') {
            const isEnabled = value === 'true' || value === true;
            
            if (isEnabled) {
                // Telegram aktiv qilinganda - botni ishga tushirish
                const botToken = await getSetting('telegram_bot_token', null);
                if (botToken) {
                    await setWebhook(botToken);
                    log.info('Telegram bot aktiv qilindi va ishga tushirildi');
                } else {
                    log.warn('Telegram aktiv qilindi, lekin bot token topilmadi');
                }
            } else {
                // Telegram neaktiv qilinganda - botni to'xtatish
                await stopBot();
                log.info('Telegram bot neaktiv qilindi va to\'xtatildi');
            }
        } else if (key === 'telegram_bot_token') {
            // Bot token yangilangan bo'lsa
            const telegramEnabled = await getSetting('telegram_enabled', 'false');
            if (telegramEnabled === 'true' || telegramEnabled === true) {
                // Agar telegram aktiv bo'lsa, webhook o'rnatish
                await setWebhook(value);
            }
        }
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('settings_updated', {
                key: key,
                value: value,
                updated_by: req.session.user.id,
                updated_by_username: req.session.user.username
            });
        }
        
        res.json({ message: `"${key}" sozlamasi muvaffaqiyatli saqlandi.` });
    } catch (error) {
        log.error("/api/settings POST xatoligi:", error.message);
        res.status(500).json({ message: "Sozlamalarni saqlashda xatolik" });
    }
});

// setWebhook funksiyasini export qilish (server.js uchun)
router.setWebhook = setWebhook;
module.exports = router;
module.exports.setWebhook = setWebhook;
