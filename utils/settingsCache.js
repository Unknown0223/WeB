const { db } = require('../db.js');
const cacheManager = require('./cacheManager.js');
const { createLogger } = require('./logger.js');
const log = createLogger('SETTINGS_CACHE');

const SETTINGS_CACHE_TTL = 10 * 60 * 1000; // 10 daqiqa
const SETTINGS_NAMESPACE = 'settings';

async function getSettings() {
    // Cache tekshirish
    const cached = cacheManager.get(SETTINGS_NAMESPACE, 'all');
    if (cached) {
        return cached;
    }

    // Bazadan o'qish
    const rows = await db('settings').select('key', 'value');
    const settings = {};
    
    rows.forEach(row => {
        try { 
            settings[row.key] = JSON.parse(row.value);
        } catch { 
            settings[row.key] = row.value; 
        }
    });
    
    // Default qiymatlar
    if (!settings.app_settings) {
        settings.app_settings = { columns: [], locations: [] };
    }
    if (!settings.pagination_limit) {
        settings.pagination_limit = 20;
    }
    if (!settings.branding_settings) {
        settings.branding_settings = { 
            logo: { 
                text: 'MANUS', 
                color: '#4CAF50', 
                animation: 'anim-glow-pulse', 
                border: 'border-none', 
                size: 32 
            },
            loader: { 
                type: 'spinner', 
                text: 'Yuklanmoqda...', 
                showProgress: false, 
                blurBackground: true 
            }
        };
    }
    if (!settings.telegram_admin_chat_id) {
        settings.telegram_admin_chat_id = '';
    }
    if (!settings.telegram_bot_username) {
        settings.telegram_bot_username = '';
    }
    
    // Cache'ga saqlash
    cacheManager.set(SETTINGS_NAMESPACE, 'all', settings, SETTINGS_CACHE_TTL);
    
    return settings;
}

async function getSetting(key, defaultValue = null) {
    const settings = await getSettings();
    return settings[key] !== undefined ? settings[key] : defaultValue;
}

function clearSettingsCache() {
    cacheManager.clearNamespace(SETTINGS_NAMESPACE);
}

module.exports = {
    getSettings,
    getSetting,
    clearSettingsCache
};

