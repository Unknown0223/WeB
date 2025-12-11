const express = require('express');
const axios = require('axios');
const { db } = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { initializeBot } = require('../utils/bot');

const router = express.Router();

async function setWebhook(botToken) {
    if (!botToken) {
        console.log("Bot tokeni mavjud emas, webhook o'rnatilmadi.");
        return;
    }

    const appBaseUrl = process.env.APP_BASE_URL;

    if (!appBaseUrl) {
        console.error("DIQQAT: APP_BASE_URL o'rnatilmagan! Webhook o'rnatilmadi.");
        console.error("Railway.com'da RAILWAY_PUBLIC_DOMAIN yoki APP_BASE_URL environment variable'ni sozlang.");
        return;
    }

    // HTTPS tekshiruvi (faqat ogohlantirish, bloklamaymiz)
    if (!appBaseUrl.startsWith('https://')) {
        console.warn(`⚠️  DIQQAT: APP_BASE_URL (${appBaseUrl}) 'https://' bilan boshlanmagan. Telegram webhooklari faqat HTTPS manzillarni qabul qiladi.`);
        console.warn(`⚠️  Railway.com'da bu avtomatik HTTPS bo'ladi. Agar boshqa platformada bo'lsangiz, HTTPS sozlang.`);
    }

    const webhookUrl = `${appBaseUrl}/telegram-webhook/${botToken}`;
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

    try {
        console.log(`🔗 Webhook o'rnatilmoqda: ${webhookUrl}`);
        const response = await axios.post(telegramApiUrl, { url: webhookUrl });
        if (response.data.ok) {
            console.log(`✅ Webhook muvaffaqiyatli ${webhookUrl} manziliga o'rnatildi.`);
            // Bot allaqachon initialize qilingan bo'lishi mumkin, shuning uchun faqat tekshiramiz
            if (!require('../utils/bot').getBot()) {
                await initializeBot(botToken, { polling: false });
            }
        } else {
            console.error("❌ Telegram webhookni o'rnatishda xatolik:", response.data.description);
        }
    } catch (error) {
        console.error("❌ Telegram API'ga ulanishda xatolik:", error.response ? error.response.data : error.message);
        // Xatolik bo'lsa ham, bot polling rejimida ishlashi mumkin (development uchun)
        if (process.env.NODE_ENV !== 'production') {
            console.warn("⚠️  Development rejimida bot polling rejimida ishlashi mumkin.");
        }
    }
}

// GET /api/settings - Barcha sozlamalarni olish
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const rows = await db('settings').select('key', 'value');
        const settings = {};
        rows.forEach(row => {
            try { 
                settings[row.key] = JSON.parse(row.value);
            } catch { 
                settings[row.key] = row.value; 
            }
        });
        
        if (!settings.app_settings) {
            settings.app_settings = { columns: [], locations: [] };
        }
        if (!settings.pagination_limit) {
            settings.pagination_limit = 20;
        }
        if (!settings.branding_settings) {
            settings.branding_settings = { text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' };
        }
        if (!settings.telegram_admin_chat_id) {
            settings.telegram_admin_chat_id = '';
        }
        if (!settings.telegram_bot_username) {
            settings.telegram_bot_username = '';
        }
        
        res.json(settings);
    } catch (error) {
        console.error("/api/settings GET xatoligi:", error);
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
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            console.log(`📡 [SETTINGS] Sozlama yangilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('settings_updated', {
                key: key,
                value: value
            });
            console.log(`✅ [SETTINGS] WebSocket yuborildi: settings_updated`);
        }
        
        if (key === 'telegram_bot_token') {
            await setWebhook(value);
        }
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            console.log(`📡 [SETTINGS] Sozlama yangilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('settings_updated', {
                key: key,
                value: value,
                updated_by: req.session.user.id,
                updated_by_username: req.session.user.username
            });
            console.log(`✅ [SETTINGS] WebSocket yuborildi: settings_updated`);
        }
        
        res.json({ message: `"${key}" sozlamasi muvaffaqiyatli saqlandi.` });
    } catch (error) {
        console.error("/api/settings POST xatoligi:", error);
        res.status(500).json({ message: "Sozlamalarni saqlashda xatolik" });
    }
});

// setWebhook funksiyasini export qilish (server.js uchun)
router.setWebhook = setWebhook;
module.exports = router;
module.exports.setWebhook = setWebhook;
