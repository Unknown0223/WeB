const fs = require('fs');
const path = require('path');

// Loglar saqlanadigan papka
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, 'combined.log');

// Log faylini tozalash (oddiy rotatsiya)
const rotateLogs = () => {
    try {
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            const fileSizeInMegabytes = stats.size / (1024 * 1024);
            if (fileSizeInMegabytes > 10) { // 10 MB dan oshsa tozalash
                fs.writeFileSync(logFile, '');
                console.log('--- Log fayli tozalandi ---');
            }
        }
    } catch (err) {
        console.error('Log rotatsiyasida xatolik:', err);
    }
};

// Har 1 soatda rotatsiyani tekshirish
setInterval(rotateLogs, 60 * 60 * 1000);

const writeToFile = (text) => {
    try {
        fs.appendFileSync(logFile, text + '\n');
    } catch (err) {
        // console.errorga yubormaymiz, chunki u ham writeToFile chaqirishi mumkin (infinite loop)
    }
};

/**
 * Logger Utility
 * Production uchun shartli logging tizimi
 */

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4
};

// Default: Production'da 'warn', Development'da 'info'
const getLogLevel = () => {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
        return envLevel;
    }

    // NODE_ENV ga qarab avtomatik log level
    const isProduction = process.env.NODE_ENV === 'production' ||
        process.env.RAILWAY_ENVIRONMENT === 'production' ||
        process.env.RENDER === 'true' ||
        process.env.HEROKU_APP_NAME;

    if (isProduction) {
        return 'warn'; // Production'da faqat warn va error
    }

    return 'info'; // Development'da info, warn, error
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
        debug: (...args) => {
            const prefix = formatPrefix('debug', moduleName);
            if (currentLevel() <= LOG_LEVELS.debug) {
                console.log(prefix, ...args);
            }
            writeToFile(`${prefix} ${args.join(' ')}`);
        },

        info: (...args) => {
            const prefix = formatPrefix('info', moduleName);
            if (currentLevel() <= LOG_LEVELS.info) {
                console.log(prefix, ...args);
            }
            writeToFile(`${prefix} ${args.join(' ')}`);
        },

        success: (...args) => {
            const prefix = formatPrefix('info', moduleName);
            if (currentLevel() <= LOG_LEVELS.info) {
                console.log(`✅ ${prefix}`, ...args);
            }
            writeToFile(`✅ ${prefix} ${args.join(' ')}`);
        },

        warn: (...args) => {
            const prefix = formatPrefix('warn', moduleName);
            if (currentLevel() <= LOG_LEVELS.warn) {
                console.warn(`⚠️ ${prefix}`, ...args);
            }
            writeToFile(`⚠️ ${prefix} ${args.join(' ')}`);
        },

        error: (...args) => {
            const prefix = formatPrefix('error', moduleName);
            if (currentLevel() <= LOG_LEVELS.error) {
                console.error(`❌ ${prefix}`, ...args);
            }
            writeToFile(`❌ ${prefix} ${args.join(' ')}`);
        },

        log: (...args) => {
            const prefix = formatPrefix('debug', moduleName);
            if (currentLevel() <= LOG_LEVELS.debug) {
                console.log(prefix, ...args);
            }
            writeToFile(`${prefix} ${args.join(' ')}`);
        }
    };
};

// Default logger
const logger = createLogger();

// Export
module.exports = {
    createLogger,
    logger,
    LOG_LEVELS,
    debug: logger.debug,
    info: logger.info,
    success: logger.success,
    warn: logger.warn,
    error: logger.error,
    log: logger.log,
    logFile // UI uchun kerak bo'lishi mumkin
};


