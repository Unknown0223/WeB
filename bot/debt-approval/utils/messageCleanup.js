// bot/debt-approval/utils/messageCleanup.js
// Xabarlarni tozalash utility

const { createLogger } = require('../../../utils/logger.js');
const { getMessagesToCleanup, markAsStatusMessage, untrackMessage } = require('./messageTracker.js');

const log = createLogger('MSG_CLEANUP');

/**
 * Keraksiz xabarlarni tozalash
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {Array<number>} keepMessageIds - Saqlanadigan message ID'lar (status xabarlar)
 * @param {Object} options - Qo'shimcha parametrlar
 * @returns {Promise<{deleted: number, errors: number}>}
 */
async function cleanupUnnecessaryMessages(bot, chatId, keepMessageIds = [], options = {}) {
    const {
        maxMessages = 50,      // Bir safarda maksimal o'chiriladigan xabarlar soni
        delayBetween = 100,    // Xabarlar orasidagi delay (ms)
        silent = true          // Xatoliklarni tashlab ketish
    } = options;
    
    let deletedCount = 0;
    let errorCount = 0;
    
    try {
        if (!bot) {
            log.warn('Bot instance mavjud emas');
            return { deleted: 0, errors: 0 };
        }
        
        // Tozalanadigan xabarlarni olish
        const messagesToDelete = getMessagesToCleanup(chatId, keepMessageIds);
        
        if (messagesToDelete.length === 0) {
            log.debug(`No messages to cleanup: chatId=${chatId}`);
            return { deleted: 0, errors: 0 };
        }
        
        log.debug(`Starting cleanup: chatId=${chatId}, messagesToDelete=${messagesToDelete.length}, keepMessages=${keepMessageIds.length}`);
        
        // Bir safarda maksimal xabar sonini cheklash
        const messagesToDeleteNow = messagesToDelete.slice(0, maxMessages);
        
        // Xabarlarni teskari tartibda o'chirish (eng eski avval)
        messagesToDeleteNow.reverse();
        
        // Xabarlarni o'chirish
        for (const messageId of messagesToDeleteNow) {
            try {
                await bot.deleteMessage(chatId, messageId);
                deletedCount++;
                untrackMessage(chatId, messageId);
                
                // Delay (rate limit'ni oldini olish uchun)
                if (delayBetween > 0 && deletedCount < messagesToDeleteNow.length) {
                    await new Promise(resolve => setTimeout(resolve, delayBetween));
                }
                
                log.debug(`Message deleted: chatId=${chatId}, messageId=${messageId}`);
            } catch (deleteError) {
                errorCount++;
                
                // Agar xabar allaqachon o'chirilgan yoki topilmagan bo'lsa, tracker'dan olib tashlash va e'tiborsiz qoldirish
                const isExpectedError = deleteError.message?.includes('message to delete not found') ||
                                       deleteError.message?.includes('message not found') ||
                                       deleteError.message?.includes('bad request');
                
                if (isExpectedError) {
                    untrackMessage(chatId, messageId);
                }
                if (!silent && !isExpectedError) {
                    log.warn(`Error deleting message: chatId=${chatId}, messageId=${messageId}, error=${deleteError.message}`);
                } else {
                    log.debug(`Message deletion skipped (expected): chatId=${chatId}, messageId=${messageId}, error=${deleteError.message}`);
                }
            }
        }
        
        log.debug(`Cleanup completed: chatId=${chatId}, deleted=${deletedCount}, errors=${errorCount}, total=${messagesToDeleteNow.length}`);
        
        return { deleted: deletedCount, errors: errorCount };
    } catch (error) {
        log.error(`Cleanup error: chatId=${chatId}`, error);
        if (!silent) {
            throw error;
        }
        return { deleted: deletedCount, errors: errorCount + 1 };
    }
}

/**
 * Status xabari yuborilgandan keyin tozalash
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} statusMessageId - Status xabari ID (saqlanadi)
 * @param {Object} options - Qo'shimcha parametrlar
 * @returns {Promise<{deleted: number, errors: number}>}
 */
async function cleanupAfterStatusMessage(bot, chatId, statusMessageId, options = {}) {
    try {
        // Status xabarni saqlashga belgilash
        if (statusMessageId) {
            markAsStatusMessage(chatId, statusMessageId);
        }
        
        // Tozalash
        return await cleanupUnnecessaryMessages(bot, chatId, [statusMessageId].filter(Boolean), options);
    } catch (error) {
        log.error('Error in cleanupAfterStatusMessage:', error);
        if (!options.silent) {
            throw error;
        }
        return { deleted: 0, errors: 1 };
    }
}

module.exports = {
    cleanupUnnecessaryMessages,
    cleanupAfterStatusMessage
};

