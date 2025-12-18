/**
 * Logger Utility
 * Production uchun shartli logging tizimi
 * 
 * LOG_LEVEL environment variable orqali boshqariladi:
 * - 'debug' - Barcha loglar (development uchun)
 * - 'info' - info, warn, error
 * - 'warn' - warn, error
 * - 'error' - faqat error
 * - 'silent' - hech narsa
 */

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4
};

// Default: production'da 'warn', development'da 'debug'
const getLogLevel = () => {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
        return envLevel;
    }
    return process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
};

const currentLevel = () => LOG_LEVELS[getLogLevel()];

// Vaqtni formatlash
const timestamp = () => {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
};

// Prefix yaratish
const formatPrefix = (level, module) => {
    const moduleStr = module ? `[${module}]` : '';
    return `${timestamp()} ${level.toUpperCase()} ${moduleStr}`;
};

/**
 * Logger instance yaratish
 * @param {string} moduleName - Modul nomi (masalan: 'BOT', 'AUTH', 'USERS')
 */
const createLogger = (moduleName = '') => {
    return {
        /**
         * Debug level - faqat development'da ko'rinadi
         */
        debug: (...args) => {
            if (currentLevel() <= LOG_LEVELS.debug) {
                console.log(formatPrefix('debug', moduleName), ...args);
            }
        },

        /**
         * Info level - oddiy ma'lumotlar
         */
        info: (...args) => {
            if (currentLevel() <= LOG_LEVELS.info) {
                console.log(formatPrefix('info', moduleName), ...args);
            }
        },

        /**
         * Success - muvaffaqiyatli operatsiyalar (info level)
         */
        success: (...args) => {
            if (currentLevel() <= LOG_LEVELS.info) {
                console.log(`✅ ${formatPrefix('info', moduleName)}`, ...args);
            }
        },

        /**
         * Warn level - ogohlantirishlar
         */
        warn: (...args) => {
            if (currentLevel() <= LOG_LEVELS.warn) {
                console.warn(`⚠️ ${formatPrefix('warn', moduleName)}`, ...args);
            }
        },

        /**
         * Error level - xatolar (har doim ko'rinadi, faqat silent'da yo'q)
         */
        error: (...args) => {
            if (currentLevel() <= LOG_LEVELS.error) {
                console.error(`❌ ${formatPrefix('error', moduleName)}`, ...args);
            }
        },

        /**
         * Log - debug alias
         */
        log: (...args) => {
            if (currentLevel() <= LOG_LEVELS.debug) {
                console.log(formatPrefix('debug', moduleName), ...args);
            }
        }
    };
};

// Default logger (modul nomi yo'q)
const logger = createLogger();

// Export
module.exports = {
    createLogger,
    logger,
    LOG_LEVELS,
    // Tez ishlatish uchun
    debug: logger.debug,
    info: logger.info,
    success: logger.success,
    warn: logger.warn,
    error: logger.error,
    log: logger.log
};

