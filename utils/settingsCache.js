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

    // Bazadan o'qish - retry mexanizmi bilan
    let rows = null;
    let retries = 3;
    let lastError = null;
    
    while (retries > 0) {
        try {
            // Connection test before attempting query
            try {
                await db.raw('SELECT 1');
            } catch (testError) {
                if (retries > 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    retries--;
                    continue;
                }
            }
            
            rows = await db('settings').select('key', 'value');
            break; // Muvaffaqiyatli bo'lsa, loop'ni to'xtatish
        } catch (error) {
            lastError = error;
            retries--;
            
            const isRetryableError = 
                error.message?.includes('Timeout acquiring a connection') ||
                error.message?.includes('pool is probably full') ||
                error.message?.includes('ECONNREFUSED') ||
                error.code === 'ECONNREFUSED';
            
            if (isRetryableError && retries > 0) {
                const delay = Math.min(500 * (4 - retries), 2000); // 500ms, 1000ms, 1500ms
                log.warn(`[SETTINGS_CACHE] Retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${retries} qoldi)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Boshqa xatolik yoki retry'lar tugagan
                log.error('[SETTINGS_CACHE] Settings yuklashda xatolik:', error.message);
                // Default qiymatlarni qaytarish
                rows = [];
                break;
            }
        }
    }
    
    if (!rows) {
        rows = [];
    }
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

