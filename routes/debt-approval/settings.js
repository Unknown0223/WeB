// routes/debt-approval/settings.js

const express = require('express');
const router = express.Router();
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');
const { clearSettingsCache } = require('../../utils/settingsCache.js');

const log = createLogger('DEBT_SETTINGS');

// GET /api/debt-approval/settings - Sozlamalarni olish
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        // Avval debt_settings jadvalidan o'qish
        const debtSettings = await db('debt_settings')
            .whereIn('key', [
                'max_file_size_mb',
                'debt_reminder_interval',
                'debt_reminder_max_count',
                'excel_column_brand',
                'excel_column_branch',
                'excel_column_svr'
            ])
            .select('key', 'value');
        
        const settingsObj = {};
        debtSettings.forEach(s => {
            settingsObj[s.key] = s.value || '';
        });
        
        // Guruhlar ma'lumotlarini olish
        const groups = await db('debt_groups')
            .where('is_active', true)
            .select('group_type', 'telegram_group_id', 'name');
        
        const groupsObj = {};
        groups.forEach(g => {
            groupsObj[g.group_type] = {
                id: g.telegram_group_id,
                name: g.name
            };
        });
        
        // Default qiymatlar
        const defaultSettings = {
            max_file_size_mb: settingsObj.max_file_size_mb ? parseInt(settingsObj.max_file_size_mb) : 20,
            debt_reminder_interval: settingsObj.debt_reminder_interval ? parseInt(settingsObj.debt_reminder_interval) : 30,
            debt_reminder_max_count: settingsObj.debt_reminder_max_count ? parseInt(settingsObj.debt_reminder_max_count) : 3,
            excel_column_brand: settingsObj.excel_column_brand || 'Brend',
            excel_column_branch: settingsObj.excel_column_branch || 'Filial',
            excel_column_svr: settingsObj.excel_column_svr || 'SVR FISH',
            leaders_group_id: groupsObj.leaders?.id || '',
            leaders_group_name: groupsObj.leaders?.name || '',
            operators_group_id: groupsObj.operators?.id || '',
            operators_group_name: groupsObj.operators?.name || '',
            final_group_id: groupsObj.final?.id || '',
            final_group_name: groupsObj.final?.name || ''
        };
        
        res.json(defaultSettings);
    } catch (error) {
        log.error('Sozlamalarni olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// POST /api/debt-approval/settings - Sozlamalarni saqlash
router.post('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const userId = req.session.user.id;
        const {
            max_file_size_mb,
            debt_reminder_interval,
            debt_reminder_max_count,
            excel_column_brand,
            excel_column_branch,
            excel_column_svr,
            leaders_group_id,
            leaders_group_name,
            operators_group_id,
            operators_group_name,
            final_group_id,
            final_group_name
        } = req.body;
        
        // Debt settings saqlash
        const settingsToSave = [
            { key: 'max_file_size_mb', value: String(max_file_size_mb || 20), description: 'Maksimal fayl hajmi (MB)' },
            { key: 'debt_reminder_interval', value: String(debt_reminder_interval || 30), description: 'Eslatma intervali (daqiqa)' },
            { key: 'debt_reminder_max_count', value: String(debt_reminder_max_count || 3), description: 'Eslatma maksimal soni' },
            { key: 'excel_column_brand', value: String(excel_column_brand || 'Brend'), description: 'Excel faylda Brend ustuni nomi' },
            { key: 'excel_column_branch', value: String(excel_column_branch || 'Filial'), description: 'Excel faylda Filial ustuni nomi' },
            { key: 'excel_column_svr', value: String(excel_column_svr || 'SVR FISH'), description: 'Excel faylda SVR FISH ustuni nomi' }
        ];
        
        for (const setting of settingsToSave) {
            await db('debt_settings')
                .insert({
                    key: setting.key,
                    value: setting.value,
                    description: setting.description,
                    updated_by: userId
                })
                .onConflict('key')
                .merge({
                    value: setting.value,
                    description: setting.description,
                    updated_by: userId,
                    updated_at: db.fn.now()
                });
        }
        
        // Guruhlar saqlash
        if (leaders_group_id && String(leaders_group_id).trim() !== '') {
            const leadersId = parseInt(String(leaders_group_id).trim());
            if (!isNaN(leadersId)) {
                await saveGroup('leaders', leadersId, leaders_group_name || 'Rahbarlar guruhi', userId);
            }
        }
        if (operators_group_id && String(operators_group_id).trim() !== '') {
            const operatorsId = parseInt(String(operators_group_id).trim());
            if (!isNaN(operatorsId)) {
                await saveGroup('operators', operatorsId, operators_group_name || 'Operatorlar guruhi', userId);
            }
        }
        if (final_group_id && String(final_group_id).trim() !== '') {
            const finalId = parseInt(String(final_group_id).trim());
            if (!isNaN(finalId)) {
                await saveGroup('final', finalId, final_group_name || 'Final guruh', userId);
            }
        }
        
        // Cache'ni tozalash
        clearSettingsCache();
        
        // Reminder system'ni yangilash
        if (debt_reminder_interval || debt_reminder_max_count) {
            try {
                const { updateReminderSettings } = require('../../utils/debtReminder.js');
                updateReminderSettings(
                    parseInt(debt_reminder_interval || 30),
                    parseInt(debt_reminder_max_count || 3)
                );
            } catch (reminderError) {
                log.warn('Reminder settings yangilashda xatolik:', reminderError);
            }
        }
        
        log.info('Debt-approval sozlamalari saqlandi', { userId });
        res.json({ success: true, message: 'Sozlamalar saqlandi' });
    } catch (error) {
        log.error('Sozlamalarni saqlashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

/**
 * Guruhni saqlash
 */
async function saveGroup(groupType, telegramGroupId, name, userId) {
    const existing = await db('debt_groups')
        .where('group_type', groupType)
        .where('is_active', true)
        .first();
    
    if (existing) {
        await db('debt_groups')
            .where('id', existing.id)
            .update({
                telegram_group_id: telegramGroupId,
                name: name,
                updated_at: db.fn.now()
            });
    } else {
        await db('debt_groups').insert({
            group_type: groupType,
            telegram_group_id: telegramGroupId,
            name: name,
            is_active: true
        });
    }
}

module.exports = router;

