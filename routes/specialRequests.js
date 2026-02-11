const express = require('express');
const router = express.Router();
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { getSetting, clearSettingsCache } = require('../utils/settingsCache.js');
const { initializeSpecialRequestsBot, stopSpecialRequestsBot } = require('../utils/specialRequestsBot.js');
const { createLogger } = require('../utils/logger.js');

const log = createLogger('SPECIAL_REQUESTS');

const SETTING_KEYS = {
    token: 'special_requests_bot_token',
    enabled: 'special_requests_bot_enabled',
    groupId: 'special_requests_group_id',
    buttons: 'special_requests_buttons'
};

async function upsertSetting(key, value) {
    const val = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    await db('settings').insert({ key, value: val }).onConflict('key').merge(['value']);
}

// GET /api/special-requests/config
router.get('/config', isAuthenticated, hasPermission('settings:edit_telegram'), async (req, res) => {
    try {
        const token = await getSetting(SETTING_KEYS.token, '');
        const enabled = await getSetting(SETTING_KEYS.enabled, 'false');
        const groupId = await getSetting(SETTING_KEYS.groupId, '');
        let buttons = [];
        try {
            const raw = await getSetting(SETTING_KEYS.buttons, null);
            if (typeof raw === 'string') buttons = JSON.parse(raw || '[]');
            else if (Array.isArray(raw)) buttons = raw;
        } catch (_) {}
        res.json({
            enabled: String(enabled).toLowerCase() === 'true',
            token: token ? String(token).replace(/(.{4}).*(.{4})/, '$1...$2') : '',
            tokenSet: !!token && String(token).trim().length > 0,
            groupId: groupId || '',
            buttons: Array.isArray(buttons) ? buttons : []
        });
    } catch (e) {
        log.error('GET config:', e);
        res.status(500).json({ message: 'Sozlamalarni yuklashda xatolik' });
    }
});

// POST /api/special-requests/config — to'liq config (token, enabled, groupId, buttons) yuboriladi
router.post('/config', isAuthenticated, hasPermission('settings:edit_telegram'), async (req, res) => {
    try {
        const { enabled, token, groupId, buttons } = req.body;

        await upsertSetting(SETTING_KEYS.enabled, enabled === true || enabled === 'true' ? 'true' : 'false');
        if (token !== undefined) {
            const t = String(token).trim();
            if (t && t.length > 20 && !t.includes('...')) await upsertSetting(SETTING_KEYS.token, t);
        }
        await upsertSetting(SETTING_KEYS.groupId, groupId != null ? String(groupId).trim() : '');
        const btnList = Array.isArray(buttons) ? buttons : [];
        await upsertSetting(SETTING_KEYS.buttons, btnList);

        clearSettingsCache();

        const isEnabled = enabled === true || enabled === 'true';
        const savedToken = await getSetting(SETTING_KEYS.token, null);
        if (isEnabled && savedToken && String(savedToken).trim()) {
            await initializeSpecialRequestsBot();
            log.info('Maxsus so\'rovlar boti sozlamalari saqlandi va bot ishga tushirildi');
        } else {
            await stopSpecialRequestsBot();
            log.info('Maxsus so\'rovlar boti to\'xtatildi yoki sozlamalar saqlandi');
        }

        res.json({ success: true, message: 'Saqlandi' });
    } catch (e) {
        log.error('POST config:', e);
        res.status(500).json({ message: 'Sozlamalarni saqlashda xatolik' });
    }
});

module.exports = router;
