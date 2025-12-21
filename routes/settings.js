const express = require('express');
const axios = require('axios');
const { db } = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { initializeBot } = require('../utils/bot');
const { createLogger } = require('../utils/logger.js');
const { getSettings, clearSettingsCache } = require('../utils/settingsCache.js');
const log = createLogger('SETTINGS');

const router = express.Router();

async function setWebhook(botToken) {
    if (!botToken) {
        return;
    }

    const appBaseUrl = process.env.APP_BASE_URL;

    if (!appBaseUrl) {
        log.error("DIQQAT: APP_BASE_URL o'rnatilmagan! Webhook o'rnatilmadi.");
        log.error("Railway.com'da RAILWAY_PUBLIC_DOMAIN yoki APP_BASE_URL environment variable'ni sozlang.");
        return;
    }

    // HTTPS tekshiruvi (faqat ogohlantirish, bloklamaymiz)
    if (!appBaseUrl.startsWith('https://')) {
        log.error(`DIQQAT: APP_BASE_URL (${appBaseUrl}) 'https://' bilan boshlanmagan. Telegram webhooklari faqat HTTPS manzillarni qabul qiladi.`);
    }

    const webhookUrl = `${appBaseUrl}/telegram-webhook/${botToken}`;
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

    try {
        const response = await axios.post(telegramApiUrl, { url: webhookUrl });
        if (response.data.ok) {
            // Bot allaqachon initialize qilingan bo'lishi mumkin, shuning uchun faqat tekshiramiz
            if (!require('../utils/bot').getBot()) {
                await initializeBot(botToken, { polling: false });
            }
        } else {
            log.error("Telegram webhookni o'rnatishda xatolik:", response.data.description);
        }
    } catch (error) {
        log.error("Telegram API'ga ulanishda xatolik:", error.response ? error.response.data : error.message);
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
    const userPermissions = req.session.user.permissions;

    let requiredPermission;
    switch (key) {
        case 'app_settings':
            requiredPermission = 'settings:edit_table';
            break;
        case 'telegram_bot_token':
        case 'telegram_group_id':
        case 'telegram_admin_chat_id':
        case 'telegram_bot_username':
            requiredPermission = 'settings:edit_telegram';
            break;
        case 'pagination_limit':
        case 'branding_settings':
        case 'kpi_settings':
            requiredPermission = 'settings:edit_general';
            break;
        default:
            return res.status(400).json({ message: `Noma'lum sozlama kaliti: "${key}"` });
    }

    if (userPermissions.includes(requiredPermission)) {
        next();
    } else {
        return res.status(403).json({ message: `"${key}" sozlamasini o'zgartirish uchun sizda yetarli huquq yo'q.` });
    }
}, async (req, res) => {
    const { key, value } = req.body;
    if (value === undefined) {
        return res.status(400).json({ message: "Qiymat (value) yuborilishi shart." });
    }
    
    try {
        const valueToSave = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : String(value);
        
        await db('settings')
            .insert({ key: key, value: valueToSave })
            .onConflict('key')
            .merge();
        
        // Cache'ni tozalash
        clearSettingsCache();
        
        // Telegram bot token yangilangan bo'lsa, webhook o'rnatish
        if (key === 'telegram_bot_token') {
            await setWebhook(value);
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
