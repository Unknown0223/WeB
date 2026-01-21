// utils/groupValidator.js
// Guruh a'zolarini tekshirish - Telegram API orqali

const { getBot } = require('./bot.js');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('GROUP_VALIDATOR');

// Cache - guruh a'zolari
const groupMembersCache = new Map(); // groupId -> { members: Set, timestamp }
const CACHE_TTL = 5 * 60 * 1000; // 5 daqiqa

/**
 * Guruh a'zolarini olish (cache bilan)
 */
async function getGroupMembers(groupId) {
    try {
        // Cache tekshirish
        const cached = groupMembersCache.get(groupId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.members;
        }
        
        // Telegram API orqali olish
        const bot = getBot();
        if (!bot) {
            log.warn('Bot mavjud emas');
            return new Set();
        }
        
        try {
            const chatMember = await bot.getChatMember(groupId, bot.getMe().id);
            // Bot guruhda bo'lishi kerak
            
            // Guruh a'zolarini olish (faqat adminlar va a'zolar)
            const members = new Set();
            
            // Telegram API'da to'g'ridan-to'g'ri barcha a'zolarni olish imkoni yo'q
            // Shuning uchun biz faqat bot guruhda ekanligini tekshiramiz
            // Va database'dan guruh ma'lumotlarini olamiz
            
            // Cache'ga saqlash
            groupMembersCache.set(groupId, {
                members: members,
                timestamp: Date.now()
            });
            
            return members;
        } catch (error) {
            log.error(`Error getting group members for groupId=${groupId}:`, error);
            return new Set();
        }
    } catch (error) {
        log.error('Error in getGroupMembers:', error);
        return new Set();
    }
}

/**
 * Foydalanuvchi guruhda ekanligini tekshirish
 */
async function isUserInGroup(userId, groupType) {
    try {
        // Guruh ma'lumotlarini olish
        const group = await db('debt_groups')
            .where('group_type', groupType)
            .where('is_active', true)
            .first();
        
        if (!group) {
            log.warn(`Group not found: groupType=${groupType}`);
            return false;
        }
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await db('users').where('id', userId).first();
        if (!user || !user.telegram_chat_id) {
            return false;
        }
        
        // Telegram API orqali tekshirish
        const bot = getBot();
        if (!bot) {
            return false;
        }
        
        try {
            const chatMember = await bot.getChatMember(group.telegram_group_id, user.telegram_chat_id);
            
            // Foydalanuvchi guruhda bo'lishi kerak va bot admin bo'lishi kerak
            const validStatuses = ['member', 'administrator', 'creator'];
            return validStatuses.includes(chatMember.status);
        } catch (error) {
            // Agar xatolik bo'lsa, foydalanuvchi guruhda emas
            log.debug(`User not in group: userId=${userId}, groupId=${group.telegram_group_id}, error=${error.message}`);
            return false;
        }
    } catch (error) {
        log.error('Error checking user in group:', error);
        return false;
    }
}

/**
 * Guruh a'zolarini cache'dan tozalash
 */
function clearGroupCache(groupId = null) {
    if (groupId) {
        groupMembersCache.delete(groupId);
    } else {
        groupMembersCache.clear();
    }
}

/**
 * Guruh ma'lumotlarini olish
 */
async function getGroupInfo(groupType) {
    try {
        const group = await db('debt_groups')
            .where('group_type', groupType)
            .where('is_active', true)
            .first();
        
        return group;
    } catch (error) {
        log.error('Error getting group info:', error);
        return null;
    }
}

module.exports = {
    getGroupMembers,
    isUserInGroup,
    clearGroupCache,
    getGroupInfo
};

