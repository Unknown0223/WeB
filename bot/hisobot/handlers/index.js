// bot/hisobot/handlers/index.js
// Hisobotlar bo'limi - asosiy handler

const { createLogger } = require('../../../utils/logger.js');
const listHandler = require('./list.js');
const createHandler = require('./create.js');
const statsHandler = require('./stats.js');

const log = createLogger('HISOBOT');

/**
 * Hisobotlar bo'limi message handler
 */
async function handleHisobotMessage(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();
    
    try {
        log.info(`[HISOBOT] Message qabul qilindi. UserId: ${userId}, Text: ${text || '(fayl yoki boshqa)'}`);
        
        // Agar text bo'sh yoki undefined bo'lsa, Excel fayl yoki boshqa fayl bo'lishi mumkin
        if (!text) {
            return false; // Excel fayl handler'ga qoldiramiz
        }
        
        // Hisobotlar ro'yxati
        if (text === "📊 Hisobotlar ro'yxati" || text.includes("Hisobotlar ro'yxati")) {
            return await listHandler.handleListReports(msg, bot);
        }
        
        // Yangi hisobot (oddiy)
        if (text === "➕ Yangi hisobot" || text.includes("Yangi hisobot")) {
            return await createHandler.handleCreateReport(msg, bot, 'NORMAL');
        }
        
        // SET (Muddat uzaytirish)
        if (text === "💾 SET (Muddat uzaytirish)" || text.includes("SET (Muddat uzaytirish)") || text.includes("SET")) {
            return await createHandler.handleCreateReport(msg, bot, 'SET');
        }
        
        // Statistika
        if (text === "📈 Statistika" || text.includes("Statistika")) {
            return await statsHandler.handleStats(msg, bot);
        }
        
        return false;
    } catch (error) {
        log.error('[HISOBOT] Message handler xatolik:', error);
        return false;
    }
}

module.exports = {
    handleHisobotMessage
};

