// bot/debt-approval/handlers/blocked.js
// Bloklash funksiyalari - menejer va rahbarlar uchun

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const axios = require('axios');

const log = createLogger('DEBT_BLOCKED');
const API_URL = process.env.API_URL || 'http://localhost:3000';

// FSM states
const STATES = {
    SELECT_BLOCK_TYPE: 'select_block_type',
    SELECT_BLOCK_ITEM: 'select_block_item',
    ENTER_BLOCK_REASON: 'enter_block_reason',
    ENTER_BLOCK_COMMENT: 'enter_block_comment',
    SELECT_UNBLOCK_ITEM: 'select_unblock_item'
};

/**
 * Bloklash bo'limini boshlash (menejer uchun)
 */
async function handleBlockStart(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        // Permission tekshirish
        // debt:block, debt:admin, roles:manage yoki backward compatibility uchun debt:create, debt:approve_leader
        const hasPermission = await userHelper.hasPermission(user.id, 'debt:block') || 
                             await userHelper.hasPermission(user.id, 'debt:admin') ||
                             await userHelper.hasPermission(user.id, 'roles:manage') ||
                             await userHelper.hasPermission(user.id, 'debt:create') || 
                             await userHelper.hasPermission(user.id, 'debt:approve_leader');
        if (!hasPermission) {
            await bot.sendMessage(chatId, '❌ Sizda bloklash huquqi yo\'q.');
            return;
        }
        
        // State'ni boshlash
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.SELECT_BLOCK_TYPE, {
            user_id: user.id
        });
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🚫 Elementni bloklash', callback_data: 'block_item' }],
                [{ text: '🔓 Bloklashni bekor qilish', callback_data: 'unblock_item' }],
                [{ text: '📋 Bloklangan elementlar', callback_data: 'list_blocked' }],
                [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_menu' }]
            ]
        };
        
        await bot.sendMessage(
            chatId,
            '🚫 <b>Bloklash bo\'limi</b>\n\n' +
            'Quyidagi amallardan birini tanlang:',
            {
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
    } catch (error) {
        log.error('Bloklash bo\'limini boshlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Elementni bloklash jarayonini boshlash
 */
async function handleBlockItem(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.SELECT_BLOCK_TYPE, {
            user_id: user.id,
            action: 'block'
        });
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🏢 Brend', callback_data: 'block_type:brand' }],
                [{ text: '📍 Filial', callback_data: 'block_type:branch' }],
                [{ text: '👤 SVR (FISH)', callback_data: 'block_type:svr' }],
                [{ text: '⬅️ Ortga', callback_data: 'block_back' }]
            ]
        };
        
        await bot.editMessageText(
            '🚫 <b>Elementni bloklash</b>\n\n' +
            'Element turini tanlang:',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
    } catch (error) {
        log.error('Elementni bloklash jarayonini boshlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Element turini tanlash
 */
async function handleBlockTypeSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const itemType = query.data.split(':')[1]; // brand, branch, svr
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SELECT_BLOCK_TYPE) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.SELECT_BLOCK_ITEM, {
            ...state.data,
            item_type: itemType
        });
        
        // Elementlar ro'yxatini olish
        let items = [];
        try {
            if (itemType === 'brand') {
                const res = await axios.get(`${API_URL}/api/debt-approval/brands`, {
                    headers: { Cookie: `connect.sid=${query.from.id}` }
                });
                items = res.data || [];
            } else if (itemType === 'branch') {
                // Barcha brendlarni olish va har bir brend uchun filiallarni olish
                const brandsRes = await axios.get(`${API_URL}/api/debt-approval/brands`, {
                    headers: { Cookie: `connect.sid=${query.from.id}` }
                });
                const brands = brandsRes.data || [];
                for (const brand of brands) {
                    try {
                        const branchesRes = await axios.get(`${API_URL}/api/debt-approval/brands/${brand.id}/branches`, {
                            headers: { Cookie: `connect.sid=${query.from.id}` }
                        });
                        const branches = branchesRes.data || [];
                        branches.forEach(b => {
                            items.push({ ...b, brand_name: brand.name });
                        });
                    } catch (e) {
                        log.warn(`Filiallarni olishda xatolik (brandId=${brand.id}):`, e.message);
                    }
                }
            } else if (itemType === 'svr') {
                const res = await axios.get(`${API_URL}/api/debt-approval/brands/svrs`, {
                    headers: { Cookie: `connect.sid=${query.from.id}` }
                });
                items = res.data || [];
            }
        } catch (error) {
            log.error('Elementlar ro\'yxatini olishda xatolik:', error);
            await bot.sendMessage(chatId, '❌ Elementlar ro\'yxatini olishda xatolik yuz berdi.');
            return;
        }
        
        if (items.length === 0) {
            await bot.sendMessage(chatId, '❌ Elementlar topilmadi.');
            return;
        }
        
        // Keyboard yaratish (pagination bilan)
        const keyboardRows = [];
        const itemsPerPage = 10;
        const page = 0;
        const pageItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
        
        for (const item of pageItems) {
            const label = itemType === 'brand' ? item.name :
                         itemType === 'branch' ? `${item.name} (${item.brand_name || ''})` :
                         `${item.name} (${item.branch_name || ''})`;
            keyboardRows.push([{
                text: label,
                callback_data: `block_select_item:${item.id}`
            }]);
        }
        
        keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'block_back' }]);
        
        const keyboard = { inline_keyboard: keyboardRows };
        
        await bot.editMessageText(
            `🚫 <b>Elementni bloklash</b>\n\n` +
            `Element turi: <b>${itemType === 'brand' ? 'Brend' : itemType === 'branch' ? 'Filial' : 'SVR'}</b>\n\n` +
            `Elementni tanlang:`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
    } catch (error) {
        log.error('Element turini tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Elementni tanlash va sabab so'rash
 */
async function handleBlockItemSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const itemId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SELECT_BLOCK_ITEM) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.ENTER_BLOCK_REASON, {
            ...state.data,
            item_id: itemId
        });
        
        await bot.editMessageText(
            '🚫 <b>Elementni bloklash</b>\n\n' +
            'Bloklash sababini kiriting (majburiy):',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Bekor qilish', callback_data: 'block_cancel' }]
                    ]
                }
            }
        );
    } catch (error) {
        log.error('Elementni tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bloklash sababini qabul qilish
 */
async function handleBlockReason(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const reason = msg.text?.trim();
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.ENTER_BLOCK_REASON) {
            return false;
        }
        
        if (!reason || reason.length === 0) {
            await bot.sendMessage(chatId, '❌ Bloklash sababi kiritilishi shart.');
            return true;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.ENTER_BLOCK_COMMENT, {
            ...state.data,
            reason: reason
        });
        
        await bot.sendMessage(
            chatId,
            '📝 <b>Qo\'shimcha izoh</b>\n\n' +
            'Qo\'shimcha izoh kiriting (ixtiyoriy) yoki "O\'tkazib yuborish" tugmasini bosing:',
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ O\'tkazib yuborish', callback_data: 'block_skip_comment' }],
                        [{ text: '✅ Tasdiqlash', callback_data: 'block_confirm' }],
                        [{ text: '❌ Bekor qilish', callback_data: 'block_cancel' }]
                    ]
                }
            }
        );
        
        return true;
    } catch (error) {
        log.error('Bloklash sababini qabul qilishda xatolik:', error);
        return false;
    }
}

/**
 * Comment qabul qilish
 */
async function handleBlockComment(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const comment = msg.text?.trim();
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.ENTER_BLOCK_COMMENT) {
            return false;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.ENTER_BLOCK_COMMENT, {
            ...state.data,
            comment: comment || null
        });
        
        // Bloklashni tasdiqlash
        await handleBlockConfirmInternal(chatId, userId, bot, {
            ...state.data,
            comment: comment || null
        });
        
        return true;
    } catch (error) {
        log.error('Comment qabul qilishda xatolik:', error);
        return false;
    }
}

/**
 * Bloklashni yakunlash (internal)
 */
async function handleBlockConfirmInternal(chatId, userId, bot, stateData) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // API orqali bloklash
        const body = {
            item_type: stateData.item_type,
            reason: stateData.reason,
            comment: stateData.comment || null
        };
        
        if (stateData.item_type === 'brand') {
            body.brand_id = stateData.item_id;
        } else if (stateData.item_type === 'branch') {
            body.branch_id = stateData.item_id;
        } else if (stateData.item_type === 'svr') {
            body.svr_id = stateData.item_id;
        }
        
        try {
            const res = await axios.post(`${API_URL}/api/debt-approval/blocked`, body, {
                headers: { 
                    'Content-Type': 'application/json',
                    Cookie: `connect.sid=${userId}`
                }
            });
            
            if (res.data && res.data.success) {
                await bot.sendMessage(
                    chatId,
                    '✅ <b>Element muvaffaqiyatli bloklandi!</b>',
                    { parse_mode: 'HTML' }
                );
                stateManager.clearUserState(userId);
            } else {
                throw new Error(res.data?.error || 'Bloklashda xatolik');
            }
        } catch (error) {
            log.error('Bloklash API xatolik:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Bloklashda xatolik';
            await bot.sendMessage(chatId, `❌ ${errorMsg}`);
        }
    } catch (error) {
        log.error('Bloklashni yakunlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bloklashni yakunlash (callback)
 */
async function handleBlockConfirm(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Bloklanmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // API orqali bloklash
        const body = {
            item_type: state.data.item_type,
            reason: state.data.reason,
            comment: state.data.comment || null
        };
        
        if (state.data.item_type === 'brand') {
            body.brand_id = state.data.item_id;
        } else if (state.data.item_type === 'branch') {
            body.branch_id = state.data.item_id;
        } else if (state.data.item_type === 'svr') {
            body.svr_id = state.data.item_id;
        }
        
        try {
            const res = await axios.post(`${API_URL}/api/debt-approval/blocked`, body, {
                headers: { 
                    'Content-Type': 'application/json',
                    Cookie: `connect.sid=${userId}`
                }
            });
            
            if (res.data && res.data.success) {
                await bot.sendMessage(
                    chatId,
                    '✅ <b>Element muvaffaqiyatli bloklandi!</b>',
                    { parse_mode: 'HTML' }
                );
                stateManager.clearUserState(userId);
            } else {
                throw new Error(res.data?.error || 'Bloklashda xatolik');
            }
        } catch (error) {
            log.error('Bloklash API xatolik:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Bloklashda xatolik';
            await bot.sendMessage(chatId, `❌ ${errorMsg}`);
        }
    } catch (error) {
        log.error('Bloklashni yakunlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bloklashni bekor qilish (unblock)
 */
async function handleUnblockItem(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Faol bloklangan elementlarni olish
        let blocked = [];
        try {
            const res = await axios.get(`${API_URL}/api/debt-approval/blocked?is_active=true`, {
                headers: { Cookie: `connect.sid=${userId}` }
            });
            blocked = res.data || [];
        } catch (error) {
            log.error('Bloklangan elementlarni olishda xatolik:', error);
            await bot.sendMessage(chatId, '❌ Bloklangan elementlarni olishda xatolik.');
            return;
        }
        
        if (blocked.length === 0) {
            await bot.sendMessage(chatId, '📭 Bloklangan elementlar yo\'q.');
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.SELECT_UNBLOCK_ITEM, {
            user_id: user.id
        });
        
        // Keyboard yaratish
        const keyboardRows = [];
        for (const item of blocked.slice(0, 10)) {
            const itemName = item.brand_name || item.branch_name || item.svr_name || 'Noma\'lum';
            const itemTypeText = item.item_type === 'brand' ? 'Brend' : item.item_type === 'branch' ? 'Filial' : 'SVR';
            keyboardRows.push([{
                text: `${itemName} (${itemTypeText})`,
                callback_data: `unblock_item:${item.id}`
            }]);
        }
        
        keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'block_back' }]);
        
        await bot.editMessageText(
            '🔓 <b>Bloklashni bekor qilish</b>\n\n' +
            'Bloklashni bekor qilmoqchi bo\'lgan elementni tanlang:',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboardRows }
            }
        );
    } catch (error) {
        log.error('Bloklashni bekor qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bloklashni bekor qilishni tasdiqlash
 */
async function handleUnblockConfirm(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const blockedId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Bekor qilinmoqda...' });
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        try {
            const res = await axios.post(`${API_URL}/api/debt-approval/blocked/${blockedId}/unblock`, {}, {
                headers: { Cookie: `connect.sid=${userId}` }
            });
            
            if (res.data && res.data.success) {
                await bot.sendMessage(
                    chatId,
                    '✅ <b>Bloklash muvaffaqiyatli bekor qilindi!</b>',
                    { parse_mode: 'HTML' }
                );
                stateManager.clearUserState(userId);
            } else {
                throw new Error(res.data?.error || 'Bekor qilishda xatolik');
            }
        } catch (error) {
            log.error('Bekor qilish API xatolik:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Bekor qilishda xatolik';
            await bot.sendMessage(chatId, `❌ ${errorMsg}`);
        }
    } catch (error) {
        log.error('Bloklashni bekor qilishni tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bloklangan elementlar ro'yxatini ko'rsatish
 */
async function handleListBlocked(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // Bloklangan elementlarni olish
        let blocked = [];
        try {
            const res = await axios.get(`${API_URL}/api/debt-approval/blocked`, {
                headers: { Cookie: `connect.sid=${userId}` }
            });
            blocked = res.data || [];
        } catch (error) {
            log.error('Bloklangan elementlarni olishda xatolik:', error);
            await bot.sendMessage(chatId, '❌ Bloklangan elementlarni olishda xatolik.');
            return;
        }
        
        if (blocked.length === 0) {
            await bot.sendMessage(chatId, '📭 Bloklangan elementlar yo\'q.');
            return;
        }
        
        // Xabar yaratish
        let message = '📋 <b>Bloklangan elementlar:</b>\n\n';
        for (const item of blocked.slice(0, 20)) {
            const itemName = item.brand_name || item.branch_name || item.svr_name || 'Noma\'lum';
            const itemTypeText = item.item_type === 'brand' ? 'Brend' : item.item_type === 'branch' ? 'Filial' : 'SVR';
            const status = item.is_active ? '🚫 Bloklangan' : '✅ Ochilgan';
            const blockedDate = new Date(item.blocked_at).toLocaleString('uz-UZ');
            
            message += `${status} - <b>${itemName}</b> (${itemTypeText})\n`;
            message += `Sabab: ${item.reason || 'Noma\'lum'}\n`;
            message += `Sana: ${blockedDate}\n\n`;
        }
        
        if (blocked.length > 20) {
            message += `\n... va yana ${blocked.length - 20} ta element`;
        }
        
        await bot.editMessageText(
            message,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ Ortga', callback_data: 'block_back' }]
                    ]
                }
            }
        );
    } catch (error) {
        log.error('Bloklangan elementlar ro\'yxatini ko\'rsatishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Ortga qaytish
 */
async function handleBlockBack(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL) {
            stateManager.clearUserState(userId);
            return;
        }
        
        // State'ga qarab ortga qaytish
        if (state.state === STATES.SELECT_BLOCK_ITEM || state.state === STATES.SELECT_UNBLOCK_ITEM) {
            stateManager.updateUserState(userId, STATES.SELECT_BLOCK_TYPE, {
                user_id: state.data.user_id
            });
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🚫 Elementni bloklash', callback_data: 'block_item' }],
                    [{ text: '🔓 Bloklashni bekor qilish', callback_data: 'unblock_item' }],
                    [{ text: '📋 Bloklangan elementlar', callback_data: 'list_blocked' }],
                    [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_menu' }]
                ]
            };
            
            await bot.editMessageText(
                '🚫 <b>Bloklash bo\'limi</b>\n\n' +
                'Quyidagi amallardan birini tanlang:',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                }
            );
        } else if (state.state === STATES.ENTER_BLOCK_REASON || state.state === STATES.ENTER_BLOCK_COMMENT) {
            stateManager.clearUserState(userId);
            await bot.sendMessage(chatId, '❌ Jarayon bekor qilindi.');
        } else {
            stateManager.clearUserState(userId);
        }
    } catch (error) {
        log.error('Ortga qaytishda xatolik:', error);
    }
}

module.exports = {
    handleBlockStart,
    handleBlockItem,
    handleBlockTypeSelection,
    handleBlockItemSelection,
    handleBlockReason,
    handleBlockComment,
    handleBlockConfirm,
    handleUnblockItem,
    handleUnblockConfirm,
    handleListBlocked,
    handleBlockBack,
    STATES
};

