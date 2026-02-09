// bot/debt-approval/utils/messageTracker.js
// Xabarlarni kuzatish va saqlash uchun utility

const { createLogger } = require('../../../utils/logger.js');

const log = createLogger('MSG_TRACKER');

// Xabarlarni saqlash (memory-based, session davomida)
// Format: { chatId: { messageId: { type, timestamp, shouldCleanup, requestId, isApproved } } }
const trackedMessages = new Map();

// Xabar turlari
const MESSAGE_TYPES = {
    BUTTON_PRESS: 'button_press',        // Knopka bosish xabarlari
    COMMAND: 'command',                   // Buyruq xabarlari
    FORWARDED_FILE: 'forwarded_file',    // Qayta yuborilgan fayllar
    STATUS: 'status',                     // Status/jarayon xabarlari (saqlanadi)
    USER_MESSAGE: 'user_message'         // Oddiy foydalanuvchi xabarlari
};

/**
 * Xabarni kuzatishga qo'shish
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID
 * @param {string} type - Xabar turi (MESSAGE_TYPES)
 * @param {boolean} shouldCleanup - Tozalash kerakmi (default: true, STATUS uchun: false)
 * @param {number} requestId - So'rov ID (ixtiyoriy)
 * @param {boolean} isApproved - Tasdiqlangan xabar (default: false)
 */
function trackMessage(chatId, messageId, type, shouldCleanup = true, requestId = null, isApproved = false) {
    try {
        if (!trackedMessages.has(chatId)) {
            trackedMessages.set(chatId, new Map());
        }
        
        const chatMessages = trackedMessages.get(chatId);
        chatMessages.set(messageId, {
            type,
            timestamp: Date.now(),
            shouldCleanup: type === MESSAGE_TYPES.STATUS ? false : shouldCleanup,
            requestId: requestId || null,
            isApproved: isApproved || false
        });
        
        log.debug(`Message tracked: chatId=${chatId}, messageId=${messageId}, type=${type}, shouldCleanup=${shouldCleanup}, requestId=${requestId}, isApproved=${isApproved}`);
    } catch (error) {
        log.error('Error tracking message:', error);
    }
}

/**
 * Xabarlarni olish (tozalanadigan)
 * @param {number} chatId - Chat ID
 * @param {Array<number>} keepMessageIds - Saqlanadigan message ID'lar
 * @returns {Array<number>} - Tozalanadigan message ID'lar
 */
function getMessagesToCleanup(chatId, keepMessageIds = []) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (!chatMessages) {
            return [];
        }
        
        const messagesToCleanup = [];
        const keepSet = new Set(keepMessageIds);
        
        for (const [messageId, data] of chatMessages.entries()) {
            // Agar saqlanadigan xabarlar ro'yxatida bo'lsa, o'tkazib yuborish
            if (keepSet.has(messageId)) {
                continue;
            }
            
            // Agar tozalash kerak bo'lsa, qo'shish
            if (data.shouldCleanup) {
                messagesToCleanup.push(messageId);
            }
        }
        
        log.debug(`Messages to cleanup: chatId=${chatId}, count=${messagesToCleanup.length}, keepCount=${keepMessageIds.length}`);
        return messagesToCleanup;
    } catch (error) {
        log.error('Error getting messages to cleanup:', error);
        return [];
    }
}

/**
 * So'rov xabarlarini olish (navbatli ko'rsatish uchun)
 * Faqat jarayon tugallanmagan (pending) USER_MESSAGE type xabarlarni qaytaradi
 * Tasdiqlangan xabarlar saqlanib qoladi
 * @param {number} chatId - Chat ID
 * @param {Array<number>} keepMessageIds - Saqlanadigan message ID'lar
 * @returns {Array<number>} - O'chiriladigan so'rov xabarlari (pending USER_MESSAGE type)
 */
function getRequestMessagesToCleanup(chatId, keepMessageIds = []) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (!chatMessages) {
            log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Chat messages topilmadi: chatId=${chatId}`);
            return [];
        }
        
        const messagesToCleanup = [];
        const keepSet = new Set(keepMessageIds);
        
        log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Chat messages tekshirilmoqda: chatId=${chatId}, totalMessages=${chatMessages.size}`);
        
        for (const [messageId, data] of chatMessages.entries()) {
            // Agar saqlanadigan xabarlar ro'yxatida bo'lsa, o'tkazib yuborish
            if (keepSet.has(messageId)) {
                log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Xabar saqlanadi: chatId=${chatId}, messageId=${messageId}`);
                continue;
            }
            
            // Faqat jarayon tugallanmagan (pending) so'rov xabarlarini o'chirish
            // Tasdiqlangan xabarlar (isApproved=true) saqlanib qoladi
            if (data.type === MESSAGE_TYPES.USER_MESSAGE && !data.isApproved) {
                messagesToCleanup.push(messageId);
                log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Pending so'rov xabari topildi: chatId=${chatId}, messageId=${messageId}, requestId=${data.requestId}, isApproved=${data.isApproved}`);
            } else if (data.type === MESSAGE_TYPES.USER_MESSAGE && data.isApproved) {
                log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Tasdiqlangan xabar saqlanadi: chatId=${chatId}, messageId=${messageId}, requestId=${data.requestId}`);
            } else {
                log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Xabar o'tkazib yuborildi (USER_MESSAGE emas yoki STATUS): chatId=${chatId}, messageId=${messageId}, type=${data.type}`);
            }
        }
        
        log.debug(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Pending so'rov xabarlari topildi: chatId=${chatId}, count=${messagesToCleanup.length}, keepCount=${keepMessageIds.length}`);
        return messagesToCleanup;
    } catch (error) {
        log.error(`[MSG_TRACKER] [GET_REQUEST_MESSAGES] Xatolik: chatId=${chatId}, error=${error.message}`, error);
        return [];
    }
}

/**
 * Joriy so'rovning faol xabari bor-yo'qligini tekshirish
 * @param {number} chatId - Chat ID
 * @param {number} requestId - So'rov ID
 * @returns {boolean} - Faol xabar mavjudmi
 */
function hasActiveRequestMessage(chatId, requestId) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (!chatMessages) {
            return false;
        }
        
        for (const [messageId, data] of chatMessages.entries()) {
            if (data.requestId === requestId && !data.isApproved && data.type === MESSAGE_TYPES.USER_MESSAGE) {
                log.debug(`[MSG_TRACKER] [HAS_ACTIVE] Faol xabar topildi: chatId=${chatId}, requestId=${requestId}, messageId=${messageId}`);
                return true;
            }
        }
        
        return false;
    } catch (error) {
        log.error(`[MSG_TRACKER] [HAS_ACTIVE] Xatolik: chatId=${chatId}, requestId=${requestId}, error=${error.message}`);
        return false;
    }
}

/**
 * Xabarni kuzatishdan olib tashlash
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID
 */
function untrackMessage(chatId, messageId) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (chatMessages) {
            chatMessages.delete(messageId);
            log.debug(`Message untracked: chatId=${chatId}, messageId=${messageId}`);
        }
    } catch (error) {
        log.error('Error untracking message:', error);
    }
}

/**
 * Chat'dagi barcha xabarlarni kuzatishdan olib tashlash
 * @param {number} chatId - Chat ID
 */
function clearChatMessages(chatId) {
    try {
        trackedMessages.delete(chatId);
        log.debug(`Chat messages cleared: chatId=${chatId}`);
    } catch (error) {
        log.error('Error clearing chat messages:', error);
    }
}

/**
 * Xabarni status xabar sifatida belgilash (saqlanadi)
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID
 */
function markAsStatusMessage(chatId, messageId) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (chatMessages && chatMessages.has(messageId)) {
            const data = chatMessages.get(messageId);
            data.shouldCleanup = false;
            data.type = MESSAGE_TYPES.STATUS;
            log.debug(`Message marked as status: chatId=${chatId}, messageId=${messageId}`);
        } else {
            // Agar kuzatishda yo'q bo'lsa, qo'shish
            trackMessage(chatId, messageId, MESSAGE_TYPES.STATUS, false);
        }
    } catch (error) {
        log.error('Error marking message as status:', error);
    }
}

/**
 * Xabarni tasdiqlangan sifatida belgilash (saqlanadi)
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID
 * @param {number} requestId - So'rov ID (ixtiyoriy)
 */
function markAsApproved(chatId, messageId, requestId = null) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (chatMessages && chatMessages.has(messageId)) {
            const data = chatMessages.get(messageId);
            data.isApproved = true;
            data.shouldCleanup = false;
            if (requestId) {
                data.requestId = requestId;
            }
            log.debug(`Message marked as approved: chatId=${chatId}, messageId=${messageId}, requestId=${requestId}`);
        } else {
            log.warn(`Message not found for marking as approved: chatId=${chatId}, messageId=${messageId}`);
        }
    } catch (error) {
        log.error('Error marking message as approved:', error);
    }
}

/**
 * Xabar turini aniqlash (matn asosida)
 * @param {Object} msg - Telegram message object
 * @returns {string|null} - Xabar turi yoki null
 */
function detectMessageType(msg) {
    try {
        // Forwarded file
        if (msg.document && (msg.forward_from || msg.forward_from_chat)) {
            return MESSAGE_TYPES.FORWARDED_FILE;
        }
        
        // Forwarded message
        if (msg.forward_from || msg.forward_from_chat) {
            return MESSAGE_TYPES.FORWARDED_FILE;
        }
        
        // Text messages
        if (msg.text) {
            const text = msg.text;
            
            // Button press messages
            if (text.includes('SET (Muddat uzaytirish)') || 
                text.includes('💾 SET') || 
                (text.includes('SET') && text.includes('uzaytirish'))) {
                return MESSAGE_TYPES.BUTTON_PRESS;
            }
            
            // Command messages
            if (text.includes('➕ Yangi so\'rov') || 
                text.includes('Yangi so\'rov') ||
                text.includes('📥 Yangi so\'rovlar') ||
                text.includes('📋 Mening so\'rovlarim') ||
                text.includes('⏳ Jarayondagi so\'rovlar') ||
                text.includes('✅ Tasdiqlangan so\'rovlar') ||
                text.includes('📊 Brend va Filiallar statistikasi') ||
                text.includes('⏰ Kutayotgan so\'rovlar') ||
                text.includes('SET so\'rovlari')) {
                return MESSAGE_TYPES.COMMAND;
            }
            
            // Status message
            if (text.includes('Tasdiqlash jarayoni:') || 
                text.includes('📋 <b>Tasdiqlash jarayoni:</b>')) {
                return MESSAGE_TYPES.STATUS;
            }
        }
        
        // File/document (not forwarded)
        if (msg.document || msg.photo) {
            return MESSAGE_TYPES.USER_MESSAGE;
        }
        
        return MESSAGE_TYPES.USER_MESSAGE;
    } catch (error) {
        log.error('Error detecting message type:', error);
        return null;
    }
}

/**
 * Chat'dagi barcha tracked xabarlarni olish (internal use)
 * @param {number} chatId - Chat ID
 * @returns {Map|null} - Tracked messages Map yoki null
 */
function getTrackedMessages(chatId) {
    try {
        return trackedMessages.get(chatId) || null;
    } catch (error) {
        log.error('Error getting tracked messages:', error);
        return null;
    }
}

/**
 * Berilgan so'rov (requestId) uchun chat'dagi xabar ID'larini olish
 * Kassir so'rov kartochkasi (Tasdiqlash / Qarzi bor) ni edit qilish uchun ishlatiladi
 * @param {number} chatId - Chat ID
 * @param {number} requestId - So'rov ID
 * @returns {Array<number>} - Message ID'lar (message_id bo'yicha o'sish tartibida – eng eski birinchi)
 */
function getMessageIdsForRequest(chatId, requestId) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (!chatMessages) {
            return [];
        }
        const ids = [];
        for (const [messageId, data] of chatMessages.entries()) {
            if (data.requestId === requestId) {
                ids.push(messageId);
            }
        }
        ids.sort((a, b) => a - b);
        log.debug(`[MSG_TRACKER] getMessageIdsForRequest: chatId=${chatId}, requestId=${requestId}, count=${ids.length}`);
        return ids;
    } catch (error) {
        log.error(`[MSG_TRACKER] getMessageIdsForRequest xatolik: chatId=${chatId}, requestId=${requestId}, error=${error.message}`);
        return [];
    }
}

/**
 * Belirli turdagi xabarlarni olish
 * @param {number} chatId - Chat ID
 * @param {string} type - Xabar turi
 * @returns {Array<number>} - Message ID'lar ro'yxati
 */
function getMessagesByType(chatId, type) {
    try {
        const chatMessages = trackedMessages.get(chatId);
        if (!chatMessages) {
            return [];
        }
        
        const messageIds = [];
        for (const [messageId, data] of chatMessages.entries()) {
            if (data.type === type) {
                messageIds.push(messageId);
            }
        }
        
        return messageIds;
    } catch (error) {
        log.error('Error getting messages by type:', error);
        return [];
    }
}

module.exports = {
    trackMessage,
    getMessagesToCleanup,
    getRequestMessagesToCleanup,
    getMessageIdsForRequest,
    untrackMessage,
    clearChatMessages,
    markAsStatusMessage,
    markAsApproved,
    detectMessageType,
    hasActiveRequestMessage,
    getTrackedMessages,
    getMessagesByType,
    MESSAGE_TYPES
};

