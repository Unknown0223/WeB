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
    buttons: 'special_requests_buttons',
    filialButtons: 'special_requests_filial_buttons',
    sumFilterType: 'special_requests_sum_filter_type',
    sumFilterValue: 'special_requests_sum_filter_value'
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
        let filialButtons = [];
        try {
            const raw = await getSetting(SETTING_KEYS.buttons, null);
            if (typeof raw === 'string') buttons = JSON.parse(raw || '[]');
            else if (Array.isArray(raw)) buttons = raw;
        } catch (_) {}
        try {
            const raw = await getSetting(SETTING_KEYS.filialButtons, null);
            if (typeof raw === 'string') filialButtons = JSON.parse(raw || '[]');
            else if (Array.isArray(raw)) filialButtons = raw;
        } catch (_) {}
        const sumFilterType = await getSetting(SETTING_KEYS.sumFilterType, '');
        const sumFilterValue = await getSetting(SETTING_KEYS.sumFilterValue, '');
        const tokenSet = !!token && String(token).trim().length > 0;
        log.info(`[SR] GET config: tokenSet=${tokenSet}, tokenUzunlik=${token ? String(token).trim().length : 0}, groupId=${groupId ? 'mavjud' : 'bo\'sh'}, enabled=${enabled}`);
        res.json({
            enabled: String(enabled).toLowerCase() === 'true',
            token: token ? String(token).replace(/(.{4}).*(.{4})/, '$1...$2') : '',
            tokenSet,
            groupId: groupId || '',
            buttons: Array.isArray(buttons) ? buttons : [],
            filialButtons: Array.isArray(filialButtons) ? filialButtons : [],
            sumFilterType: String(sumFilterType || '').trim(),
            sumFilterValue: String(sumFilterValue || '').trim()
        });
    } catch (e) {
        log.error('GET config:', e);
        res.status(500).json({ message: 'Sozlamalarni yuklashda xatolik' });
    }
});

// POST /api/special-requests/config — to'liq config (token, enabled, groupId, buttons) yuboriladi
router.post('/config', isAuthenticated, hasPermission('settings:edit_telegram'), async (req, res) => {
    try {
        const { enabled, token, groupId, buttons, filialButtons, sumFilterType, sumFilterValue } = req.body;
        const tokenYuborildi = token != null && typeof token === 'string' && token.trim().length >= 20 && !token.includes('...') && token.trim() !== '••••••••';

        await upsertSetting(SETTING_KEYS.enabled, enabled === true || enabled === 'true' ? 'true' : 'false');
        if (tokenYuborildi) {
            await upsertSetting(SETTING_KEYS.token, String(token).trim());
            log.info(`[SR] POST config: token yangi kiritildi va saqlandi (uzunlik=${String(token).trim().length})`);
        } else {
            log.info(`[SR] POST config: token yuborilmadi yoki placeholder (saqlanmadi), eski token saqlanadi`);
        }
        await upsertSetting(SETTING_KEYS.groupId, groupId != null ? String(groupId).trim() : '');
        const btnList = Array.isArray(buttons) ? buttons : [];
        await upsertSetting(SETTING_KEYS.buttons, btnList);
        const filialBtnList = Array.isArray(filialButtons) ? filialButtons : [];
        await upsertSetting(SETTING_KEYS.filialButtons, filialBtnList);
        await upsertSetting(SETTING_KEYS.sumFilterType, sumFilterType != null ? String(sumFilterType).trim() : '');
        await upsertSetting(SETTING_KEYS.sumFilterValue, sumFilterValue != null ? String(sumFilterValue).trim() : '');

        clearSettingsCache();

        const isEnabled = enabled === true || enabled === 'true';
        const savedToken = await getSetting(SETTING_KEYS.token, null);
        const savedTokenMavjud = !!(savedToken && String(savedToken).trim());
        log.info(`[SR] POST config: saqlashdan keyin savedTokenMavjud=${savedTokenMavjud}, enabled=${isEnabled}`);
        if (isEnabled && savedTokenMavjud) {
            await initializeSpecialRequestsBot();
            log.info('[SR] Maxsus so\'rovlar boti ishga tushirildi');
        } else {
            await stopSpecialRequestsBot();
            log.info('[SR] Maxsus so\'rovlar boti to\'xtatildi');
        }

        res.json({ success: true, message: 'Saqlandi' });
    } catch (e) {
        log.error('POST config:', e);
        res.status(500).json({ message: 'Sozlamalarni saqlashda xatolik' });
    }
});

module.exports = router;
