// bot/debt-approval/handlers/manager.js

const { db, isPostgres } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const { getBot } = require('../../../utils/bot.js');
const { mainMenuKeyboard, previewKeyboard } = require('../keyboards.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { getAllowedDebtBrandsList, getAllowedDebtBranchesList, getAllowedDebtSVRsList } = require('../../../utils/debtAccessFilter.js');
const axios = require('axios');

const log = createLogger('DEBT_MANAGER');
const API_URL = process.env.API_URL || 'http://localhost:3000';

// Settings'dan o'qish helper funksiyasi
async function getDebtSetting(key, defaultValue = null) {
    try {
        const setting = await db('settings').where('key', key).first();
        return setting ? setting.value : defaultValue;
    } catch (error) {
        log.error(`Setting o'qishda xatolik (${key}):`, error);
        return defaultValue;
    }
}

/**
 * Element bloklanganligini tekshirish
 * @param {string} itemType - 'brand', 'branch', yoki 'svr'
 * @param {number} itemId - brand_id, branch_id yoki svr_id
 * @returns {Promise<{is_blocked: boolean, blocked?: object}>}
 */
async function checkIfBlocked(itemType, itemId) {
    try {
        const blocked = await db('debt_blocked_items')
            .where('is_active', true)
            .where('item_type', itemType)
            .where(function() {
                if (itemType === 'brand') {
                    this.where('brand_id', itemId);
                } else if (itemType === 'branch') {
                    this.where('branch_id', itemId);
                } else if (itemType === 'svr') {
                    this.where('svr_id', itemId);
                }
            })
            .first();
        
        return {
            is_blocked: !!blocked,
            blocked: blocked || null
        };
    } catch (error) {
        log.error(`Bloklashni tekshirishda xatolik (${itemType}, ${itemId}):`, error);
        return { is_blocked: false, blocked: null };
    }
}

// FSM states
const STATES = {
    IDLE: 'idle',
    SELECT_BRAND: 'select_brand',
    SELECT_BRANCH: 'select_branch',
    SELECT_SVR: 'select_svr',
    SELECT_TYPE: 'select_type',
    SET_EXTRA_INFO: 'set_extra_info',
    PREVIEW: 'preview'
};

/**
 * Xabarni xavfsiz yangilash (xabar o'zgarmagan xatolikni e'tiborsiz qoldirish)
 */
async function safeEditMessageText(bot, text, options) {
    try {
        await bot.editMessageText(text, options);
    } catch (error) {
        // Agar xabar o'zgarmagan bo'lsa, e'tiborsiz qoldirish
        if (error.code === 'ETELEGRAM' && error.response?.body?.description?.includes('message is not modified')) {
            log.debug('Xabar o\'zgarmagan, e\'tiborsiz qoldirilmoqda');
            return; // Xatolikni e'tiborsiz qoldirish
        }
        // Boshqa xatoliklar uchun qayta tashlash
        throw error;
    }
}

/**
 * Xabar yuborish va message_id ni state'ga qo'shish
 */
async function sendMessageAndTrack(bot, chatId, text, options, userId) {
    const sentMessage = await bot.sendMessage(chatId, text, options);
    
    // Message ID ni state'ga qo'shish
    if (sentMessage && sentMessage.message_id && userId) {
        const state = stateManager.getUserState(userId);
        if (state && state.data) {
            if (!state.data.message_ids) {
                state.data.message_ids = [];
            }
            state.data.message_ids.push(sentMessage.message_id);
            // State'ni yangilash
            stateManager.updateUserState(userId, state.state, state.data);
            log.debug(`[SEND_MESSAGE_TRACK] Message ID state'ga qo'shildi: userId=${userId}, messageId=${sentMessage.message_id}, total=${state.data.message_ids.length}`);
        }
        
        // Yangi messageTracker ga ham qo'shish (tozalash uchun)
        try {
            const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
            trackMessage(chatId, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true);
        } catch (error) {
            log.debug(`[SEND_MESSAGE_TRACK] MessageTracker ga qo'shishda xatolik (ignored): ${error.message}`);
        }
    }
    
    return sentMessage;
}

// So'rov yaratish jarayonini boshlash
async function handleNewRequest(msg, bot, requestType = 'NORMAL') {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        // Foydalanuvchi rolini tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz. Iltimos, avval ro\'yxatdan o\'ting.');
            return;
        }
        
        // Permission tekshirish
        const hasCreatePermission = await userHelper.hasPermission(user.id, 'debt:create');
        if (!hasCreatePermission) {
            log.warn(`[NEW_REQUEST] Foydalanuvchida debt:create permission yo'q. UserId: ${userId}, Role: ${user.role}`);
            await bot.sendMessage(chatId, '❌ Sizda yangi so\'rov yaratish huquqi yo\'q.\n\n' +
                'Bu funksiyadan foydalanish uchun "Qarzdorlik Tasdiqlash" bo\'limida "Yangi qarzdorlik so\'rovi yaratish" huquqiga ega bo\'lishingiz kerak.\n\n' +
                'Iltimos, admin panel orqali huquqlarni tekshiring.');
            return;
        }
        
        // State'ni boshlash
        const initialState = {
            user_id: user.id,
            brand_id: null,
            branch_id: null,
            svr_id: null,
            type: requestType,
            extra_info: null,
            message_ids: [] // Xabarlarni saqlash uchun array
        };
        
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.SELECT_BRAND, initialState);
        
        // Brendlar ro'yxatini olish (filtrlash bilan)
        let brands = await getAllowedDebtBrandsList(user);
        
        // Bloklangan brendlarni filtrlash va batafsil ma'lumot to'plash
        const brandsToRemove = [];
        const blockedBrandsInfo = [];
        for (const brand of brands) {
            const { is_blocked, blocked } = await checkIfBlocked('brand', brand.id);
            if (is_blocked) {
                brandsToRemove.push(brand.id);
                blockedBrandsInfo.push({
                    name: brand.name,
                    reason: blocked?.reason || 'Noma\'lum sabab',
                    comment: blocked?.comment || null,
                    blocked_at: blocked?.blocked_at || null,
                    blocked_by: blocked?.blocked_by || null
                });
                log.info(`[NEW_REQUEST] Bloklangan brend o'tkazib yuborildi: brandId=${brand.id}, reason=${blocked?.reason || 'Noma\'lum'}`);
            }
        }
        
        // Jarayondagi so'rovlarni tekshirish va brendlarni filtrlash
        const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
        
        // Har bir brend uchun jarayondagi so'rovlarni tekshirish
        for (const brand of brands) {
            // Brenddagi barcha SVR'larni olish
            const brandSvrs = await db('debt_svrs')
                .where('brand_id', brand.id)
                .select('id');
            
            if (brandSvrs.length === 0) {
                continue; // SVR'lar yo'q, brendni saqlash
            }
            
            const svrIds = brandSvrs.map(s => s.id);
            
            // Bu brenddagi barcha SVR'lar uchun jarayondagi so'rovlarni tekshirish
            const inProcessRequests = await db('debt_requests')
                .whereIn('svr_id', svrIds)
                .whereNotIn('status', inProcessStatuses)
                .select('svr_id')
                .distinct('svr_id');
            
            const svrsWithRequests = new Set(inProcessRequests.map(r => r.svr_id));
            
            // Agar brenddagi barcha SVR'lar jarayondagi so'rovga ega bo'lsa, brendni olib tashlash
            const allSvrsInProcess = svrIds.every(svrId => svrsWithRequests.has(svrId));
            
            if (allSvrsInProcess && svrIds.length > 0) {
                brandsToRemove.push(brand.id);
            }
        }
        
        brands = brands.filter(b => !brandsToRemove.includes(b.id));
        
        // Agar barcha brendlar bloklangan bo'lsa, batafsil xabar ko'rsatish
        if (brands.length === 0 && blockedBrandsInfo.length > 0) {
            log.warn(`[NEW_REQUEST] Barcha brendlar bloklangan: ${blockedBrandsInfo.length} ta`);
            let message = '🚫 <b>Barcha brendlar bloklangan</b>\n\n';
            message += 'Quyidagi brendlar bloklangan va so\'rov yaratib bo\'lmaydi:\n\n';
            
            for (const blocked of blockedBrandsInfo) {
                message += `❌ <b>${blocked.name}</b>\n`;
                message += `📝 Sabab: ${blocked.reason}\n`;
                if (blocked.comment) {
                    message += `💬 Izoh: ${blocked.comment}\n`;
                }
                if (blocked.blocked_at) {
                    const blockedDate = new Date(blocked.blocked_at).toLocaleString('uz-UZ');
                    message += `📅 Bloklangan: ${blockedDate}\n`;
                }
                message += '\n';
            }
            
            message += '\n⚠️ <b>Eslatma:</b> Bloklashni bekor qilish uchun admin yoki rahbarlar bilan bog\'laning.';
            
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            stateManager.clearUserState(userId);
            return;
        }
        
        if (brands.length === 0) {
            log.warn(`[NEW_REQUEST] Ruxsat berilgan brendlar topilmadi yoki barcha brendlar jarayonda`);
            await bot.sendMessage(chatId, 
                '❌ Sizga ruxsat berilgan brendlar topilmadi yoki barcha brendlar jarayondagi so\'rovlarga ega.\n\n' +
                'Iltimos, admin panel orqali "Qarzdorlik Tasdiqlash" → "Bog\'lanishlar" bo\'limida ' +
                'brendlarni biriktiring yoki admin bilan bog\'laning.'
            );
            stateManager.clearUserState(userId);
            return;
        }
        
        // Agar ba'zi brendlar bloklangan bo'lsa, eslatma ko'rsatish
        if (blockedBrandsInfo.length > 0) {
            let warningMessage = '⚠️ <b>Eslatma:</b> Quyidagi brendlar bloklangan va ro\'yxatda ko\'rsatilmaydi:\n\n';
            for (const blocked of blockedBrandsInfo) {
                warningMessage += `🚫 <b>${blocked.name}</b> - ${blocked.reason}\n`;
            }
            warningMessage += '\nBloklashni bekor qilish uchun admin yoki rahbarlar bilan bog\'laning.';
            await bot.sendMessage(chatId, warningMessage, { parse_mode: 'HTML' });
        }
        
        // Agar faqat bitta brend bo'lsa, avtomatik tanlash va keyingi bosqichga o'tish
        if (brands.length === 1) {
            const selectedBrand = brands[0];
            
            // State'ni yangilash - brend tanlangan, filial tanlashga o'tish
            stateManager.updateUserState(userId, STATES.SELECT_BRANCH, { brand_id: selectedBrand.id });
            
            // Filiallar ro'yxatini olish va ko'rsatish
            let branches = await getAllowedDebtBranchesList(user, selectedBrand.id);
            
            // Bloklangan filiallarni filtrlash va batafsil ma'lumot to'plash
            const branchesToRemoveBlocked = [];
            const blockedBranchesInfo = [];
            for (const branch of branches) {
                const { is_blocked, blocked } = await checkIfBlocked('branch', branch.id);
                if (is_blocked) {
                    branchesToRemoveBlocked.push(branch.id);
                    blockedBranchesInfo.push({
                        name: branch.name,
                        reason: blocked?.reason || 'Noma\'lum sabab',
                        comment: blocked?.comment || null,
                        blocked_at: blocked?.blocked_at || null
                    });
                    log.info(`[NEW_REQUEST] Bloklangan filial o'tkazib yuborildi: branchId=${branch.id}, reason=${blocked?.reason || 'Noma\'lum'}`);
                }
            }
            branches = branches.filter(b => !branchesToRemoveBlocked.includes(b.id));
            
            // Agar barcha filiallar bloklangan bo'lsa, batafsil xabar ko'rsatish
            if (branches.length === 0 && blockedBranchesInfo.length > 0) {
                let message = '🚫 <b>Barcha filiallar bloklangan</b>\n\n';
                message += 'Quyidagi filiallar bloklangan va so\'rov yaratib bo\'lmaydi:\n\n';
                
                for (const blocked of blockedBranchesInfo) {
                    message += `❌ <b>${blocked.name}</b>\n`;
                    message += `📝 Sabab: ${blocked.reason}\n`;
                    if (blocked.comment) {
                        message += `💬 Izoh: ${blocked.comment}\n`;
                    }
                    message += '\n';
                }
                
                message += '\n⚠️ <b>Eslatma:</b> Bloklashni bekor qilish uchun admin yoki rahbarlar bilan bog\'laning.';
                
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
                stateManager.clearUserState(userId);
                return;
            }
            
            // Agar ba'zi filiallar bloklangan bo'lsa, eslatma ko'rsatish
            if (blockedBranchesInfo.length > 0) {
                let warningMessage = '⚠️ <b>Eslatma:</b> Quyidagi filiallar bloklangan va ro\'yxatda ko\'rsatilmaydi:\n\n';
                for (const blocked of blockedBranchesInfo) {
                    warningMessage += `🚫 <b>${blocked.name}</b> - ${blocked.reason}\n`;
                }
                warningMessage += '\nBloklashni bekor qilish uchun admin yoki rahbarlar bilan bog\'laning.';
                await bot.sendMessage(chatId, warningMessage, { parse_mode: 'HTML' });
            }
            
            // Jarayondagi so'rovlarni tekshirish va filiallarni filtrlash
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            
            // Har bir filial uchun jarayondagi so'rovlarni tekshirish
            const branchesToRemove = [];
            for (const branch of branches) {
                // Filialdagi barcha SVR'larni olish
                const branchSvrs = await db('debt_svrs')
                    .where('branch_id', branch.id)
                    .select('id');
                
                if (branchSvrs.length === 0) {
                    continue; // SVR'lar yo'q, filialni saqlash
                }
                
                const svrIds = branchSvrs.map(s => s.id);
                
                // Bu filialdagi barcha SVR'lar uchun jarayondagi so'rovlarni tekshirish
                const inProcessRequests = await db('debt_requests')
                    .whereIn('svr_id', svrIds)
                    .whereNotIn('status', inProcessStatuses)
                    .select('svr_id')
                    .distinct('svr_id');
                
                const svrsWithRequests = new Set(inProcessRequests.map(r => r.svr_id));
                
                // Agar filialdagi barcha SVR'lar jarayondagi so'rovga ega bo'lsa, filialni olib tashlash
                const allSvrsInProcess = svrIds.every(svrId => svrsWithRequests.has(svrId));
                
                if (allSvrsInProcess && svrIds.length > 0) {
                    branchesToRemove.push(branch.id);
                }
            }
            
            branches = branches.filter(b => !branchesToRemove.includes(b.id));
            
            
            // Agar barcha filiallar bloklangan bo'lsa, batafsil xabar ko'rsatish
            if (branches.length === 0 && blockedBranchesInfo.length > 0) {
                let message = '🚫 <b>Barcha filiallar bloklangan</b>\n\n';
                message += `Brend: <b>${selectedBrand.name}</b>\n\n`;
                message += 'Quyidagi filiallar bloklangan va so\'rov yaratib bo\'lmaydi:\n\n';
                
                for (const blocked of blockedBranchesInfo) {
                    message += `❌ <b>${blocked.name}</b>\n`;
                    message += `📝 Sabab: ${blocked.reason}\n`;
                    if (blocked.comment) {
                        message += `💬 Izoh: ${blocked.comment}\n`;
                    }
                    message += '\n';
                }
                
                message += '\n⚠️ <b>Eslatma:</b> Bloklashni bekor qilish uchun admin yoki rahbarlar bilan bog\'laning.';
                
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
                stateManager.clearUserState(userId);
                return;
            }
            
            if (branches.length === 0) {
                await bot.sendMessage(chatId, 
                    '❌ Bu brend uchun ruxsat berilgan filiallar topilmadi yoki barcha filiallar jarayondagi so\'rovlarga ega.\n\n' +
                    'Iltimos, admin panel orqali filiallarni biriktiring.'
                );
                stateManager.clearUserState(userId);
                return;
            }
            
            // Filiallar keyboard yaratish
            const columns = branches.length > 10 ? 3 : branches.length > 5 ? 2 : 1;
            const keyboardRows = [];
            
            for (let i = 0; i < branches.length; i += columns) {
                const row = branches.slice(i, i + columns).map(branch => ({
                    text: branch.name,
                    callback_data: `debt_select_branch:${branch.id}`
                }));
                keyboardRows.push(row);
            }
            
            // Ortga tugmasi qo'shish
            keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'debt_back_to_menu' }]);
            
            const keyboard = {
                inline_keyboard: keyboardRows
            };
            
            await bot.sendMessage(
                chatId,
                `✅ Brend: ${selectedBrand.name}\n\n📋 Filialni tanlang:`,
                { reply_markup: keyboard }
            );
            
        } else {
            // Agar bir nechta brend bo'lsa, grid formatda tanlash knopkasini ko'rsatish
            const columns = brands.length > 10 ? 3 : brands.length > 5 ? 2 : 1;
            const keyboardRows = [];
            
            for (let i = 0; i < brands.length; i += columns) {
                const row = brands.slice(i, i + columns).map(brand => ({
                        text: brand.name,
                        callback_data: `debt_select_brand:${brand.id}`
                }));
                keyboardRows.push(row);
            }
            
            // Ortga tugmasi qo'shish
            keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'debt_back_to_menu' }]);
            
            const keyboard = {
                inline_keyboard: keyboardRows
            };
            
            const sentMessage = await bot.sendMessage(
                chatId,
                '📋 Brendni tanlang:',
                { reply_markup: keyboard }
            );
            // Message ID ni state'ga qo'shish
            if (sentMessage && sentMessage.message_id) {
                const currentState = stateManager.getUserState(userId);
                if (currentState && currentState.data) {
                    if (!currentState.data.message_ids) {
                        currentState.data.message_ids = [];
                    }
                    currentState.data.message_ids.push(sentMessage.message_id);
                }
            }
        }
        
    } catch (error) {
        log.error(`[NEW_REQUEST] ❌ Xatolik yuz berdi:`, error);
        log.error(`[NEW_REQUEST] Stack trace:`, error.stack);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
        stateManager.clearUserState(userId);
    }
}

// Brend tanlash
async function handleBrandSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const brandId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SELECT_BRAND) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        // Brend ma'lumotlarini olish
        const brand = await db('debt_brands').where('id', brandId).first();
        if (!brand) {
            await bot.sendMessage(chatId, '❌ Brend topilmadi.');
            return;
        }
        
        // Bloklanganligini tekshirish
        const { is_blocked, blocked } = await checkIfBlocked('brand', brandId);
        if (is_blocked) {
            const reason = blocked?.reason || 'Noma\'lum sabab';
            const comment = blocked?.comment ? `\n\n📝 Izoh: ${blocked.comment}` : '';
            await bot.sendMessage(chatId, 
                `🚫 <b>Bu brend bloklangan</b>\n\n` +
                `❌ Sabab: ${reason}${comment}\n\n` +
                `Bu brend bo'yicha so'rov yaratib bo'lmaydi. Iltimos, admin yoki rahbarlar bilan bog'laning.`,
                { parse_mode: 'HTML' }
            );
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.SELECT_BRANCH, { brand_id: brandId });
        
        // Foydalanuvchi ma'lumotlarini olish (filtrlash uchun)
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            stateManager.clearUserState(userId);
            return;
        }
        
        // Filiallar ro'yxatini olish (filtrlash bilan)
        let branches = await getAllowedDebtBranchesList(user, brandId);
        
        // Bloklangan filiallarni filtrlash
        const branchesToRemoveBlocked = [];
        for (const branch of branches) {
            const { is_blocked: branchBlocked } = await checkIfBlocked('branch', branch.id);
            if (branchBlocked) {
                branchesToRemoveBlocked.push(branch.id);
            }
        }
        branches = branches.filter(b => !branchesToRemoveBlocked.includes(b.id));
        
        
        // Jarayondagi so'rovlarni tekshirish va filiallarni filtrlash
        const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
        
        // Har bir filial uchun jarayondagi so'rovlarni tekshirish
        const branchesToRemove = [];
        for (const branch of branches) {
            // Filialdagi barcha SVR'larni olish
            const branchSvrs = await db('debt_svrs')
                .where('branch_id', branch.id)
                .select('id');
            
            if (branchSvrs.length === 0) {
                continue; // SVR'lar yo'q, filialni saqlash
            }
            
            const svrIds = branchSvrs.map(s => s.id);
            
            // Bu filialdagi barcha SVR'lar uchun jarayondagi so'rovlarni tekshirish
            const inProcessRequests = await db('debt_requests')
                .whereIn('svr_id', svrIds)
                .whereNotIn('status', inProcessStatuses)
                .select('svr_id')
                .distinct('svr_id');
            
            const svrsWithRequests = new Set(inProcessRequests.map(r => r.svr_id));
            
            // Agar filialdagi barcha SVR'lar jarayondagi so'rovga ega bo'lsa, filialni olib tashlash
            const allSvrsInProcess = svrIds.every(svrId => svrsWithRequests.has(svrId));
            
            if (allSvrsInProcess && svrIds.length > 0) {
                branchesToRemove.push(branch.id);
            }
        }
        
        branches = branches.filter(b => !branchesToRemove.includes(b.id));
        
        
        if (branches.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ Bu brend uchun ruxsat berilgan filiallar topilmadi yoki barcha filiallar jarayondagi so\'rovlarga ega.\n\n' +
                'Iltimos, admin panel orqali filiallarni biriktiring.'
            );
            stateManager.clearUserState(userId);
            return;
        }
        
        // Agar faqat bitta filial bo'lsa, avtomatik tanlash va keyingi bosqichga o'tish
        if (branches.length === 1) {
            const selectedBranch = branches[0];
            
            // State'ni yangilash - filial tanlangan, SVR tanlashga o'tish
            stateManager.updateUserState(userId, STATES.SELECT_SVR, { branch_id: selectedBranch.id });
            
            // SVR ro'yxatini olish va ko'rsatish
            const svrs = await getAllowedDebtSVRsList(user, brandId, selectedBranch.id);
            
            if (svrs.length === 0) {
                await bot.sendMessage(chatId, 
                    '❌ Bu filial uchun ruxsat berilgan SVR (FISH) topilmadi.\n\n' +
                    'Iltimos, admin panel orqali SVR\'larni biriktiring.'
                );
                stateManager.clearUserState(userId);
                return;
            }
            
            // Jarayondagi so'rovlarni tekshirish va SVR'larni filtrlash
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const inProcessRequests = await db('debt_requests')
                .where('branch_id', selectedBranch.id)
                .whereNotIn('status', inProcessStatuses)
                .select('svr_id', 'request_uid', 'status', 'created_at')
                .orderBy('created_at', 'desc');
            
            if (inProcessRequests.length > 0) {
                const usedSvrIds = new Set(inProcessRequests.map(r => r.svr_id));
                const filteredSvrs = svrs.filter(svr => !usedSvrIds.has(svr.id));
                
                if (filteredSvrs.length === 0) {
                    await bot.sendMessage(chatId, 
                        '❌ Bu filial uchun barcha SVR\'lar jarayondagi so\'rovlarga ega.\n\n' +
                        'Iltimos, kutib turing yoki boshqa filialni tanlang.'
                    );
                    stateManager.clearUserState(userId);
                    return;
                }
                
                // Agar faqat bitta SVR qolsa, avtomatik tanlash
                if (filteredSvrs.length === 1) {
                    const selectedSvr = filteredSvrs[0];
                    log.info(`[BRAND_SELECT] Faqat bitta SVR mavjud, avtomatik tanlandi: ${selectedSvr.name} (ID: ${selectedSvr.id})`);
                    
                    // Type allaqachon tanlangan bo'lsa, to'g'ridan-to'g'ri keyingi bosqichga o'tish
                    const currentState = stateManager.getUserState(userId);
                    if (currentState?.data?.type) {
                        log.info(`[BRAND_SELECT] ✅ Type allaqachon tanlangan: ${currentState.data.type}. Keyingi bosqichga o'tilmoqda...`);
                        
                        // handleSVRSelection logikasini ishlatish
                        const branch = await db('debt_branches').where('id', selectedBranch.id).first();
                        const brandForMsg = await db('debt_brands').where('id', brandId).first();
                        
                        if (currentState.data.type === 'SET') {
                            stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, { 
                                ...currentState.data,
                                branch_id: selectedBranch.id,
                                svr_id: selectedSvr.id
                            });
                            await sendMessageAndTrack(bot, chatId,
                                `✅ Brend: ${brandForMsg.name}\n✅ Filial: ${branch.name}\n✅ SVR: ${selectedSvr.name}\n\n📊 <b>SET so'rov uchun Excel fayl yuborilishi shart!</b>\n\nExcel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz).\n\n📝 Qo'shimcha izoh (ixtiyoriy):`,
                                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                                    [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }],
                                    [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                                ] } },
                                userId
                            );
                        } else {
                            stateManager.updateUserState(userId, STATES.PREVIEW, { 
                                ...currentState.data,
                                branch_id: selectedBranch.id,
                                svr_id: selectedSvr.id
                            });
                            // Preview ko'rsatish
                            await showPreview(chatId, userId, null, bot);
                        }
                        return;
                    }
                    
                    // Type tanlanmagan, so'rov turini tanlashga o'tish
                    stateManager.updateUserState(userId, STATES.SELECT_TYPE, { 
                        branch_id: selectedBranch.id,
                        svr_id: selectedSvr.id 
                    });
                    
                    // So'rov turini tanlash knopkasi
                    const typeKeyboard = {
                        inline_keyboard: [
                            [{ text: '📋 Oddiy so\'rov', callback_data: 'debt_select_type:NORMAL' }],
                            [{ text: '💾 SET (Muddat uzaytirish)', callback_data: 'debt_select_type:SET' }]
                        ]
                    };
                    
                    await bot.sendMessage(
                        chatId,
                        `✅ Brend: ${brand.name}\n✅ Filial: ${selectedBranch.name}\n✅ SVR: ${selectedSvr.name}\n\n📋 So'rov turini tanlang:`,
                        { reply_markup: typeKeyboard }
                    );
                    
                    return;
                }
                
                // Bir nechta SVR bo'lsa, tanlash knopkasini ko'rsatish
                const svrKeyboard = {
                    inline_keyboard: [
                        ...filteredSvrs.map(svr => [{
                            text: svr.name,
                            callback_data: `debt_select_svr:${svr.id}`
                        }]),
                        [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                    ]
                };
                
                await bot.sendMessage(
                    chatId,
                    `✅ Brend: ${brand.name}\n✅ Filial: ${selectedBranch.name}\n\n📋 SVR (FISH) ni tanlang:`,
                    { reply_markup: svrKeyboard }
                );
            } else {
                // Jarayondagi so'rovlar yo'q, barcha SVR'lar ko'rsatiladi
                // Agar faqat bitta SVR bo'lsa, avtomatik tanlash
                if (svrs.length === 1) {
                    const selectedSvr = svrs[0];
                    log.info(`[BRAND_SELECT] Faqat bitta SVR mavjud, avtomatik tanlandi: ${selectedSvr.name} (ID: ${selectedSvr.id})`);
                    
                    // Type allaqachon tanlangan bo'lsa, to'g'ridan-to'g'ri keyingi bosqichga o'tish
                    const currentState = stateManager.getUserState(userId);
                    if (currentState?.data?.type) {
                        log.info(`[BRAND_SELECT] ✅ Type allaqachon tanlangan: ${currentState.data.type}. Keyingi bosqichga o'tilmoqda...`);
                        
                        const branch = await db('debt_branches').where('id', selectedBranch.id).first();
                        const brandForMsg = await db('debt_brands').where('id', brandId).first();
                        
                        if (currentState.data.type === 'SET') {
                            stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, { 
                                ...currentState.data,
                                branch_id: selectedBranch.id,
                                svr_id: selectedSvr.id
                            });
                            await sendMessageAndTrack(bot, chatId,
                                `✅ Brend: ${brandForMsg.name}\n✅ Filial: ${branch.name}\n✅ SVR: ${selectedSvr.name}\n\n📊 <b>SET so'rov uchun Excel fayl yuborilishi shart!</b>\n\nExcel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz).\n\n📝 Qo'shimcha izoh (ixtiyoriy):`,
                                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
                                    [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }],
                                    [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                                ] } },
                                userId
                            );
                        } else {
                            stateManager.updateUserState(userId, STATES.PREVIEW, { 
                                ...currentState.data,
                                branch_id: selectedBranch.id,
                                svr_id: selectedSvr.id
                            });
                            await showPreview(chatId, userId, null, bot);
                        }
                        return;
                    }
                    
                    // Type tanlanmagan, so'rov turini tanlashga o'tish
                    stateManager.updateUserState(userId, STATES.SELECT_TYPE, { 
                        branch_id: selectedBranch.id,
                        svr_id: selectedSvr.id 
                    });
                    
                    // So'rov turini tanlash knopkasi
                    const typeKeyboard = {
                        inline_keyboard: [
                            [{ text: '📋 Oddiy so\'rov', callback_data: 'debt_select_type:NORMAL' }],
                            [{ text: '💾 SET (Muddat uzaytirish)', callback_data: 'debt_select_type:SET' }]
                        ]
                    };
                    
                    await bot.sendMessage(
                        chatId,
                        `✅ Brend: ${brand.name}\n✅ Filial: ${selectedBranch.name}\n✅ SVR: ${selectedSvr.name}\n\n📋 So'rov turini tanlang:`,
                        { reply_markup: typeKeyboard }
                    );
                    
                    return;
                }
                
                // Bir nechta SVR bo'lsa, tanlash knopkasini ko'rsatish
                const svrKeyboard = {
                    inline_keyboard: svrs.map(svr => [{
                        text: svr.name,
                        callback_data: `debt_select_svr:${svr.id}`
                    }])
                };
                
                await bot.sendMessage(
                    chatId,
                    `✅ Brend: ${brand.name}\n✅ Filial: ${selectedBranch.name}\n\n📋 SVR (FISH) ni tanlang:`,
                    { reply_markup: svrKeyboard }
                );
            }
            
            // Xabarni yangilash (agar query.message mavjud bo'lsa)
            if (query && query.message) {
                await safeEditMessageText(bot,
                    `✅ Brend: ${brand.name}\n✅ Filial: ${selectedBranch.name}`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                );
            }
        } else {
            // Bir nechta filial bo'lsa, tanlash knopkasini ko'rsatish
            const columns = branches.length > 10 ? 3 : branches.length > 5 ? 2 : 1;
            const keyboardRows = [];
            
            for (let i = 0; i < branches.length; i += columns) {
                const row = branches.slice(i, i + columns).map(branch => ({
                    text: branch.name,
                    callback_data: `debt_select_branch:${branch.id}`
                }));
                keyboardRows.push(row);
            }
            
            // Ortga tugmasi qo'shish
            keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'debt_back_to_brand' }]);
            
            const keyboard = {
                inline_keyboard: keyboardRows
            };
            
            await safeEditMessageText(bot,
                `✅ Brend: ${brand.name}\n\n📋 Filialni tanlang:`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: keyboard
                }
            );
        }
        
    } catch (error) {
        // Agar xabar o'zgarmagan xatolik bo'lsa, e'tiborsiz qoldirish
        if (error.code === 'ETELEGRAM' && error.response?.body?.description?.includes('message is not modified')) {
            log.debug('Xabar o\'zgarmagan, e\'tiborsiz qoldirilmoqda');
        } else {
            log.error('Brend tanlashda xatolik:', error);
            await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        }
    }
}

// Filial tanlash
async function handleBranchSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const branchId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SELECT_BRANCH) {
            // State noto'g'ri bo'lsa, state'ni tozalash va xabarni editMessageText orqali yangilash
            stateManager.clearUserState(userId);
            try {
                await safeEditMessageText(bot,
                    '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                );
            } catch (error) {
                // Agar editMessageText ishlamasa, yangi xabar yuborish
                await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            }
            return;
        }
        
        // Filial ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', branchId).first();
        if (!branch) {
            await bot.sendMessage(chatId, '❌ Filial topilmadi.');
            return;
        }
        
        // Bloklanganligini tekshirish
        const { is_blocked, blocked } = await checkIfBlocked('branch', branchId);
        if (is_blocked) {
            const reason = blocked?.reason || 'Noma\'lum sabab';
            const comment = blocked?.comment ? `\n\n📝 Izoh: ${blocked.comment}` : '';
            await bot.sendMessage(chatId, 
                `🚫 <b>Bu filial bloklangan</b>\n\n` +
                `❌ Sabab: ${reason}${comment}\n\n` +
                `Bu filial bo'yicha so'rov yaratib bo'lmaydi. Iltimos, admin yoki rahbarlar bilan bog'laning.`,
                { parse_mode: 'HTML' }
            );
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.SELECT_SVR, { branch_id: branchId });
        
        // Foydalanuvchi ma'lumotlarini olish (filtrlash uchun)
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            stateManager.clearUserState(userId);
            return;
        }
        
        const brandId = state.data ? state.data.brand_id : null;
        
        // SVR ro'yxatini olish (filtrlash bilan)
        let svrs = await getAllowedDebtSVRsList(user, brandId, branchId);
        
        if (svrs.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ Bu filial uchun ruxsat berilgan SVR (FISH) topilmadi.\n\n' +
                'Iltimos, admin panel orqali SVR\'larni biriktiring.'
            );
            stateManager.clearUserState(userId);
            return;
        }
        
        // Faqat jarayondagi so'rovlarni tekshirish (vaqt cheklovi yo'q)
        // Jarayondagi so'rovlarni topish (FINAL_APPROVED, CANCELLED, REJECTED dan tashqari)
        const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
        const inProcessRequests = await db('debt_requests')
            .where('branch_id', branchId)
            .whereNotIn('status', inProcessStatuses)
            .select('svr_id', 'request_uid', 'status', 'created_at')
            .orderBy('created_at', 'desc');
        
        if (inProcessRequests.length > 0) {
            // Jarayondagi so'rovlardagi SVR ID'larni olib tashlash
            const usedSvrIds = new Set(inProcessRequests.map(r => r.svr_id));
            const beforeCount = svrs.length;
            
            svrs = svrs.filter(svr => !usedSvrIds.has(svr.id));
        }
        
        if (svrs.length === 0) {
            // State'ni avval tozalash (takroriy xabarlarni oldini olish uchun)
            stateManager.clearUserState(userId);
            
            // Xabarni editMessageText orqali yangilash (yangi xabar yubormaslik uchun)
            try {
                await safeEditMessageText(bot,
                    '❌ Bu filial uchun barcha SVR\'lar uchun joriy oy so\'rovlari tasdiqlangan.\n\n' +
                    'Yangi oy boshlanganda qayta urinib ko\'ring.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                );
            } catch (error) {
                // Agar editMessageText ishlamasa (masalan, xabar allaqachon o'zgargan bo'lsa), 
                // yangi xabar yuborish
                await bot.sendMessage(chatId, 
                    '❌ Bu filial uchun barcha SVR\'lar uchun joriy oy so\'rovlari tasdiqlangan.\n\n' +
                    'Yangi oy boshlanganda qayta urinib ko\'ring.'
                );
            }
            return;
        }
        
        // Brend nomini olish
        const brand = await db('debt_brands').where('id', state.data.brand_id).first();
        
        // Agar faqat bitta SVR bo'lsa, avtomatik tanlash va keyingi bosqichga o'tish
        if (svrs.length === 1) {
            const selectedSvr = svrs[0];
            // Type allaqachon tanlangan bo'lsa, to'g'ridan-to'g'ri keyingi bosqichga o'tish
            if (state.data.type) {
                
                if (state.data.type === 'SET') {
                    stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, { 
                        ...state.data,
                        svr_id: selectedSvr.id
                    });
                    
                    // Xabarni kuzatishga qo'shish (tozalanadigan)
                    const { trackMessage: trackMsg, MESSAGE_TYPES: MSG_TYPES } = require('../utils/messageTracker.js');
                    trackMsg(chatId, query.message.message_id, MSG_TYPES.USER_MESSAGE, true);
                    
                    await safeEditMessageText(bot,
                        `✅ Brend: ${brand.name}\n✅ Filial: ${branch.name}\n✅ SVR: ${selectedSvr.name}\n\n📊 <b>SET so'rov uchun Excel fayl yuborilishi shart!</b>\n\nExcel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz).\n\n📝 Qo'shimcha izoh (ixtiyoriy):`,
                        {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: [
                                [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }],
                                [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                            ] }
                        }
                    );
                } else {
                    stateManager.updateUserState(userId, STATES.PREVIEW, { 
                        ...state.data,
                        svr_id: selectedSvr.id
                    });
                    await showPreview(chatId, userId, query.message.message_id, bot);
                }
            } else {
                // Type tanlanmagan, so'rov turini tanlashga o'tish
                stateManager.updateUserState(userId, STATES.SELECT_TYPE, { svr_id: selectedSvr.id });
                
                // So'rov turini tanlash knopkasi
                const typeKeyboard = {
                    inline_keyboard: [
                        [{ text: '📋 Oddiy so\'rov', callback_data: 'debt_select_type:NORMAL' }],
                        [{ text: '💾 SET (Muddat uzaytirish)', callback_data: 'debt_select_type:SET' }],
                        [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_svr' }]
                    ]
                };
                
                await safeEditMessageText(bot,
                    `✅ Brend: ${brand.name}\n✅ Filial: ${branch.name}\n✅ SVR: ${selectedSvr.name}\n\n📋 So'rov turini tanlang:`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: typeKeyboard
                    }
                );
            }
        } else {
            // Bir nechta SVR bo'lsa, tanlash knopkasini ko'rsatish
            const keyboard = {
                inline_keyboard: [
                    ...svrs.map(svr => [{
                        text: svr.name,
                        callback_data: `debt_select_svr:${svr.id}`
                    }]),
                    [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                ]
            };
            
            await safeEditMessageText(bot,
                `✅ Brend: ${brand.name}\n✅ Filial: ${branch.name}\n\n📋 SVR (FISH) ni tanlang:`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: keyboard
                }
            );
        }
        
    } catch (error) {
        log.error('Filial tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// SVR tanlash
async function handleSVRSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const svrId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SELECT_SVR) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        // SVR ma'lumotlarini olish
        const svr = await db('debt_svrs').where('id', svrId).first();
        if (!svr) {
            await bot.sendMessage(chatId, '❌ SVR topilmadi.');
            return;
        }
        
        // Bloklanganligini tekshirish
        const { is_blocked, blocked } = await checkIfBlocked('svr', svrId);
        if (is_blocked) {
            const reason = blocked?.reason || 'Noma\'lum sabab';
            const comment = blocked?.comment ? `\n\n📝 Izoh: ${blocked.comment}` : '';
            await bot.sendMessage(chatId, 
                `🚫 <b>Bu SVR bloklangan</b>\n\n` +
                `❌ Sabab: ${reason}${comment}\n\n` +
                `Bu SVR bo'yicha so'rov yaratib bo'lmaydi. Iltimos, admin yoki rahbarlar bilan bog'laning.`,
                { parse_mode: 'HTML' }
            );
            return;
        }
        
        // ✅ MUHIM: Jarayondagi so'rovlarni tekshirish (dublikat so'rovni oldini olish)
        const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
        const existingRequest = await db('debt_requests')
            .where('svr_id', svrId)
            .whereNotIn('status', inProcessStatuses)
            .first();
        
        if (existingRequest) {
            log.warn(`[SVR_SELECT] Dublikat so'rov topildi: SVR ID=${svrId}, Existing Request ID=${existingRequest.id}, RequestUID=${existingRequest.request_uid}, Status=${existingRequest.status}`);
            
            // Foydalanuvchi ma'lumotlarini olish (SVR ro'yxatini qayta ko'rsatish uchun)
            const user = await userHelper.getUserByTelegram(chatId, userId);
            
            if (user && state.data.branch_id) {
                // SVR ro'yxatini qayta ko'rsatish (bu SVR'siz)
                const allSvrs = await getAllowedDebtSVRsList(user, state.data.brand_id, state.data.branch_id);
                
                // Jarayondagi so'rovlardagi barcha SVR'larni olib tashlash
                const inProcessRequests = await db('debt_requests')
                    .where('branch_id', state.data.branch_id)
                    .whereNotIn('status', inProcessStatuses)
                    .select('svr_id')
                    .distinct('svr_id');
                
                const usedSvrIds = new Set(inProcessRequests.map(r => r.svr_id));
                const filteredSvrs = allSvrs.filter(svr => !usedSvrIds.has(svr.id));
                
                if (filteredSvrs.length === 0) {
                    await safeEditMessageText(bot,
                        `⚠️ <b>Bu SVR uchun jarayondagi so'rov mavjud</b>\n\n` +
                        `So'rov ID: ${existingRequest.request_uid}\n` +
                        `Holat: ${existingRequest.status}\n\n` +
                        `Bu filialda boshqa mavjud SVR'lar yo'q.`,
                        {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                                ]
                            }
                        }
                    );
                    return;
                }
                
                // SVR ro'yxatini qayta ko'rsatish (jarayondagi so'rovga ega SVR'siz)
                const svrKeyboard = {
                    inline_keyboard: [
                        ...filteredSvrs.map(svr => [{
                            text: svr.name,
                            callback_data: `debt_select_svr:${svr.id}`
                        }]),
                        [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                    ]
                };
                
                const branch = await db('debt_branches').where('id', state.data.branch_id).first();
                const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
                
                await safeEditMessageText(bot,
                    `⚠️ <b>Bu SVR uchun jarayondagi so'rov mavjud</b>\n\n` +
                    `So'rov ID: ${existingRequest.request_uid}\n` +
                    `Holat: ${existingRequest.status}\n\n` +
                    `Boshqa SVR ni tanlang:`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: svrKeyboard
                    }
                );
                return;
            } else {
                // Agar user yoki branch_id topilmasa, oddiy xabar yuborish
                await safeEditMessageText(bot,
                    `⚠️ <b>Bu SVR uchun jarayondagi so'rov mavjud</b>\n\n` +
                    `So'rov ID: ${existingRequest.request_uid}\n` +
                    `Holat: ${existingRequest.status}\n\n` +
                    `Yangi so'rov yaratish uchun avval mavjud so'rovni yakunlang.`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                            ]
                        }
                    }
                );
                return;
            }
        }
        
        // Brend va filial ma'lumotlarini olish (xabar uchun)
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
        
        
        // Agar type allaqachon tanlangan bo'lsa (NORMAL yoki SET), to'g'ridan-to'g'ri keyingi bosqichga o'tish
        // Agar type null bo'lsa, so'rov turini tanlashga o'tish
        if (state.data.type) {
            // Type allaqachon tanlangan (NORMAL yoki SET)
            if (state.data.type === 'SET') {
                // SET so'rov uchun qo'shimcha ma'lumot kerak
                stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, { 
                    ...state.data, // Barcha mavjud ma'lumotlarni saqlash
                    svr_id: svrId
                });
                
                // Xabarni kuzatishga qo'shish (tozalanadigan)
                const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                trackMessage(chatId, query.message.message_id, MESSAGE_TYPES.USER_MESSAGE, true);
                
                await safeEditMessageText(bot,
                    `✅ Brend: ${brand ? brand.name : ''}\n✅ Filial: ${branch.name}\n✅ SVR: ${svr.name}\n\n📊 <b>SET so'rov uchun Excel fayl yuborilishi shart!</b>\n\nExcel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz).\n\n📝 Qo'shimcha izoh (ixtiyoriy):`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: { 
                            inline_keyboard: [
                                [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }],
                                [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                            ] 
                        }
                    }
                );
            } else {
                // NORMAL so'rov uchun to'g'ridan-to'g'ri preview
                stateManager.updateUserState(userId, STATES.PREVIEW, { 
                    ...state.data, // Barcha mavjud ma'lumotlarni saqlash
                    svr_id: svrId
                });
                
                
                await showPreview(chatId, userId, query.message.message_id, bot);
            }
        } else {
            // Type tanlanmagan, so'rov turini tanlashga o'tish
            log.warn(`[SVR_SELECT] ⚠️ Type tanlanmagan! So'rov turini tanlashga o'tilmoqda...`);
            log.warn(`[SVR_SELECT] ⚠️ State data:`, JSON.stringify(state.data, null, 2));
            
            stateManager.updateUserState(userId, STATES.SELECT_TYPE, { svr_id: svrId });
            
            // So'rov turini tanlash knopkasi
            const typeKeyboard = {
                inline_keyboard: [
                    [{ text: '📋 Oddiy so\'rov', callback_data: 'debt_select_type:NORMAL' }],
                    [{ text: '💾 SET (Muddat uzaytirish)', callback_data: 'debt_select_type:SET' }]
                ]
            };
            
            await safeEditMessageText(bot,
                `✅ Brend: ${brand ? brand.name : ''}\n✅ Filial: ${branch.name}\n✅ SVR: ${svr.name}\n\n📋 So'rov turini tanlang:`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: typeKeyboard
                }
            );
        }
        
    } catch (error) {
        log.error('SVR tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// So'rov turi tanlash
async function handleTypeSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const type = query.data.split(':')[1];
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SELECT_TYPE) {
            log.warn(`[TYPE_SELECT] ⚠️ State noto'g'ri yoki jarayon to'xtatilgan:`, {
                hasState: !!state,
                context: state?.context,
                state: state?.state,
                expectedContext: stateManager.CONTEXTS.DEBT_APPROVAL,
                expectedState: STATES.SELECT_TYPE
            });
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        log.info(`[TYPE_SELECT] ✅ State to'g'ri. State data:`, {
            userId: userId,
            currentType: state.data.type,
            selectedType: type,
            stateData: state.data
        });
        
        // State'ni yangilash
        if (type === 'SET') {
            log.info(`[TYPE_SELECT] 🔄 SET so'rov tanlandi - qo'shimcha ma'lumot so'ralmoqda...`);
            // SET so'rov uchun qo'shimcha ma'lumot kerak
            stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, { 
                ...state.data, // Barcha mavjud ma'lumotlarni saqlash
                type: type 
            });
            // Brend, filial va SVR ma'lumotlarini olish
            const branch = state.data.branch_id ? await db('debt_branches').where('id', state.data.branch_id).first() : null;
            const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
            const svr = state.data.svr_id ? await db('debt_svrs').where('id', state.data.svr_id).first() : null;
            
            let messageText = `✅ So'rov turi: SET\n`;
            if (brand) messageText += `✅ Brend: ${brand.name}\n`;
            if (branch) messageText += `✅ Filial: ${branch.name}\n`;
            if (svr) messageText += `✅ SVR: ${svr.name}\n`;
            messageText += `\n📊 <b>SET so'rov uchun Excel fayl yuborilishi shart!</b>\n\nExcel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz).\n\n📝 Qo'shimcha izoh (ixtiyoriy):`;
            
            // Ortga tugmasi - agar SVR tanlangan bo'lsa, SVR tanlashga qaytish, aks holda type tanlashga
            const backButton = svr ? 
                [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }] :
                [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_previous' }];
            
            // Xabarni kuzatishga qo'shish (tozalanadigan)
            const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
            trackMessage(chatId, query.message.message_id, MESSAGE_TYPES.USER_MESSAGE, true);
            
            await safeEditMessageText(bot,
                messageText,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: { 
                        inline_keyboard: [
                            backButton,
                            [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                        ] 
                    }
                }
            );
        } else {
            // NORMAL so'rov uchun to'g'ridan-to'g'ri preview
            stateManager.updateUserState(userId, STATES.PREVIEW, { 
                ...state.data, // Barcha mavjud ma'lumotlarni saqlash
                type: type 
            });
            await showPreview(chatId, userId, query.message.message_id, bot);
        }
        
    } catch (error) {
        log.error('So\'rov turi tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// SET so'rov uchun qo'shimcha ma'lumot va Excel fayl
async function handleExtraInfo(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.SET_EXTRA_INFO) {
            return false;
        }
        
        // Excel fayl yuborilgan bo'lsa
        if (msg.document && msg.document.file_name && 
            (msg.document.file_name.endsWith('.xlsx') || msg.document.file_name.endsWith('.xls'))) {
            log.info(`[SET_EXTRA_INFO] Excel fayl yuborildi: fileName=${msg.document.file_name}, userId=${userId}`);
            
            // SVR tanlanganligini tekshirish
            if (!state.data.svr_id) {
                log.warn(`[SET_EXTRA_INFO] ❌ Excel fayl yuborilgan, lekin SVR tanlanmagan: userId=${userId}`);
                
                // Brend va filial ma'lumotlarini olish
                const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
                const branch = state.data.branch_id ? await db('debt_branches').where('id', state.data.branch_id).first() : null;
                
                // SVR'lar ro'yxatini olish
                const svrs = await db('debt_svrs')
                    .where('branch_id', state.data.branch_id)
                    .orderBy('name', 'asc');
                
                if (svrs.length === 0) {
                    await bot.sendMessage(chatId, '❌ Bu filial uchun SVR topilmadi.');
                    return true;
                }
                
                // SVR tanlash keyboard yaratish
                const columns = svrs.length > 10 ? 2 : svrs.length > 5 ? 2 : 1;
                const keyboardRows = [];
                
                for (let i = 0; i < svrs.length; i += columns) {
                    const row = svrs.slice(i, i + columns).map(svr => ({
                        text: svr.name,
                        callback_data: `debt_select_svr:${svr.id}`
                    }));
                    keyboardRows.push(row);
                }
                
                keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]);
                keyboardRows.push([{ text: '❌ Bekor', callback_data: 'debt_cancel_request' }]);
                
                const keyboard = {
                    inline_keyboard: keyboardRows
                };
                
                let messageText = '';
                if (brand) messageText += `✅ Brend: ${brand.name}\n`;
                if (branch) messageText += `✅ Filial: ${branch.name}\n`;
                messageText += `\n❌ <b>SVR tanlanmagan!</b>\n\nSET so'rov yaratish uchun avval SVR tanlash shart.\n\n📋 SVR (FISH) ni tanlang:`;
                
                await bot.sendMessage(chatId, messageText, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                
                // State'ni SVR tanlashga qaytarish
                stateManager.updateUserState(userId, STATES.SELECT_SVR, {
                    ...state.data
                });
                
                return true;
            }
            
            // Excel fayl qabul qilish funksiyasini chaqirish
            const { handleExcelFile } = require('./debt-excel.js');
            const handled = await handleExcelFile(msg, bot);
            
            if (handled) {
                // Excel fayl qabul qilingan, state'ni yangilash
                // handleExcelFile o'zi preview ko'rsatadi, shuning uchun bu yerdan ko'rsatishni olib tashlaymiz
                // (handleExcelFile da SET so'rov uchun showPreview ko'rsatiladi)
                return true;
            }
        }
        
        // Matn yuborilgan bo'lsa (extra_info)
        if (msg.text) {
            
            // State'ni yangilash
            stateManager.updateUserState(userId, STATES.PREVIEW, { 
                ...state.data, // Barcha mavjud ma'lumotlarni saqlash
                extra_info: msg.text 
            });
            
            // Preview ko'rsatish
            await showPreview(chatId, userId, null, bot);
            
            return true;
        }
        
        return false;
        
    } catch (error) {
        log.error('[SET_EXTRA_INFO] Qo\'shimcha ma\'lumot qabul qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
        return false;
    }
}

// Preview ko'rsatish
async function showPreview(chatId, userId, messageId, bot) {
    try {
        const state = stateManager.getUserState(userId);
        if (!state) return;
        
        // Type'ni tekshirish va o'rnatish (agar bo'lmasa)
        if (!state.data.type) {
            state.data.type = 'NORMAL'; // Default oddiy so'rov
        }
        
        // Ma'lumotlarni olish

        const brand = await db('debt_brands').where('id', state.data.brand_id).first();
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        
        // SVR ma'lumotlarini olish (agar svr_id mavjud bo'lsa)
        let svr = null;
        if (state.data.svr_id) {
            try {
                svr = await db('debt_svrs').where('id', state.data.svr_id).first();
            } catch (svrError) {
                log.error(`[PREVIEW] SVR ma'lumotlarini olishda xatolik: svr_id=${state.data.svr_id}, error=${svrError.message}`);
                // SVR topilmasa, xatolikni e'tiborsiz qoldirish va davom etish
            }
        }
        
        // Preview matni
        let previewText = `🧾 SO'ROV PREVIEW\n\n`;
        previewText += `📌 Brend: ${brand?.name || 'Noma\'lum'}\n`;
        previewText += `📍 Filial: ${branch?.name || 'Noma\'lum'}\n`;
        previewText += `👤 SVR (FISH): ${svr?.name || state.data.svr_name || 'Noma\'lum'}\n`;
        previewText += `📋 Turi: ${state.data.type === 'SET' ? 'SET' : 'ODDIY'}\n`;
        
        if (state.data.type === 'SET' && state.data.extra_info) {
            previewText += `📝 Izoh: ${state.data.extra_info}\n`;
        }
        
        // Excel ma'lumotlarini ko'rsatish (agar mavjud bo'lsa)
        let telegraphUrl = null;
        if (state.data.type === 'SET' && state.data.excel_data && Array.isArray(state.data.excel_data)) {
            previewText += `\n📊 Excel ma'lumotlari: ${state.data.excel_data.length} qator\n`;
            if (state.data.excel_total) {
                previewText += `💰 Jami summa: ${state.data.excel_total.toLocaleString('ru-RU')} so'm\n`;
            }
            
            // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
            try {
                const { createDebtDataPage } = require('../../../utils/telegraph.js');
                const { getPreviousMonthName } = require('../../../utils/dateHelper.js');
                telegraphUrl = await createDebtDataPage({
                    request_uid: `PREVIEW-${userId}-${Date.now()}`,
                    brand_name: brand?.name || 'Noma\'lum',
                    filial_name: branch?.name || 'Noma\'lum',
                    svr_name: svr?.name || state.data.svr_name || 'Noma\'lum',
                    month_name: getPreviousMonthName(),
                    extra_info: state.data.extra_info || null,
                    excel_data: state.data.excel_data,
                    excel_headers: state.data.excel_headers || null,
                    excel_columns: state.data.excel_columns || null,
                    total_amount: state.data.excel_total
                });
            } catch (telegraphError) {
                // Telegraph xatolari silent qilinadi (ixtiyoriy xizmat)
                log.debug(`[PREVIEW] Telegraph xatolik (ixtiyoriy xizmat): userId=${userId}`);
            }
            
            // Telegraph link ko'rsatish (agar mavjud bo'lsa)
            if (telegraphUrl) {
                previewText += `\n🔗 <a href="${telegraphUrl}">📊 Qarzdorlik klientlar:</a>\n`;
            }
        }
        
        previewText += `\n✅ Ma'lumotlar to'g'rimi?`;
        
        // Temporary request ID (keyinroq yaratiladi)
        const tempRequestId = `temp_${userId}_${Date.now()}`;
        stateManager.updateUserState(userId, STATES.PREVIEW, { 
            ...state.data,
            temp_request_id: tempRequestId 
        });
        
        const keyboard = previewKeyboard(tempRequestId);
        
        if (messageId) {
            await safeEditMessageText(bot, previewText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        } else {
            await sendMessageAndTrack(bot, chatId, previewText, { 
                reply_markup: keyboard,
                parse_mode: 'HTML'
            }, userId);
        }
        
    } catch (error) {
        log.error('Preview ko\'rsatishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Preview ko\'rsatishda xatolik.');
    }
}

// So'rovni yuborish
async function handleSendRequest(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    log.info(`[SEND_REQUEST] So'rov yuborish boshlanmoqda. UserId: ${userId}, ChatId: ${chatId}`);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Yuborilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        log.debug(`[SEND_REQUEST] State holati:`, { 
            hasState: !!state, 
            context: state?.context, 
            state: state?.state,
            data: state?.data 
        });
        
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.PREVIEW) {
            log.warn(`[SEND_REQUEST] State noto'g'ri yoki jarayon to'xtatilgan`);
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        // Bloklanganligini tekshirish (brand, branch, svr)
        if (state.data.brand_id) {
            const { is_blocked, blocked } = await checkIfBlocked('brand', state.data.brand_id);
            if (is_blocked) {
                const reason = blocked?.reason || 'Noma\'lum sabab';
                await bot.sendMessage(chatId, 
                    `🚫 <b>Bu brend bloklangan</b>\n\n` +
                    `❌ Sabab: ${reason}\n\n` +
                    `Bu brend bo'yicha so'rov yaratib bo'lmaydi.`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
        }
        
        if (state.data.branch_id) {
            const { is_blocked, blocked } = await checkIfBlocked('branch', state.data.branch_id);
            if (is_blocked) {
                const reason = blocked?.reason || 'Noma\'lum sabab';
                await bot.sendMessage(chatId, 
                    `🚫 <b>Bu filial bloklangan</b>\n\n` +
                    `❌ Sabab: ${reason}\n\n` +
                    `Bu filial bo'yicha so'rov yaratib bo'lmaydi.`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
        }
        
        if (state.data.svr_id) {
            const { is_blocked, blocked } = await checkIfBlocked('svr', state.data.svr_id);
            if (is_blocked) {
                const reason = blocked?.reason || 'Noma\'lum sabab';
                await bot.sendMessage(chatId, 
                    `🚫 <b>Bu SVR bloklangan</b>\n\n` +
                    `❌ Sabab: ${reason}\n\n` +
                    `Bu SVR bo'yicha so'rov yaratib bo'lmaydi.`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
        }
        
        // SET Type so'rov uchun fayl va qiymat tekshiruvi
        if (state.data.type === 'SET') {
            log.info(`[SEND_REQUEST] 🔍 SET so'rov tekshiruvi boshlanmoqda: userId=${userId}`);
            log.info(`[SEND_REQUEST] 📊 State ma'lumotlari: type=${state.data.type}, excel_data=${!!state.data.excel_data}, excel_data_type=${typeof state.data.excel_data}, excel_total=${state.data.excel_total}, excel_headers=${!!state.data.excel_headers}, excel_columns=${!!state.data.excel_columns}`);
            
            // Fayl yuborilganligini tekshirish
            const hasExcelData = state.data.excel_data && 
                (typeof state.data.excel_data === 'string' ? state.data.excel_data.trim() !== '' : 
                 Array.isArray(state.data.excel_data) ? state.data.excel_data.length > 0 : 
                 Object.keys(state.data.excel_data || {}).length > 0);
            
            log.info(`[SEND_REQUEST] 📋 Excel fayl tekshiruvi: hasExcelData=${hasExcelData}`);
            
            if (!hasExcelData) {
                log.warn(`[SEND_REQUEST] ❌ SET so'rov uchun Excel fayl yuborilmagan: userId=${userId}, excel_data=${state.data.excel_data}, excel_data_type=${typeof state.data.excel_data}`);
                await bot.sendMessage(chatId,
                    `❌ <b>SET so'rov yaratish uchun Excel fayl yuborilishi shart</b>\n\n` +
                    `SET (Muddat uzaytirish) so'rovi yaratish uchun Excel fayl yuborilgan bo'lishi kerak.\n\n` +
                    `Iltimos, Excel fayl yuboring va qaytadan yuborish tugmasini bosing.`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
            
            // Fayldagi qiymat 0 bo'lmasligini tekshirish (manfiy bo'lishi mumkin)
            const excelTotal = state.data.excel_total;
            const isValidTotal = excelTotal !== null && excelTotal !== undefined && excelTotal !== 0 && !isNaN(excelTotal) && Math.abs(excelTotal) > 0;
            
            log.info(`[SEND_REQUEST] 💰 Qiymat tekshiruvi: excelTotal=${excelTotal}, isValidTotal=${isValidTotal}`);
            
            if (!isValidTotal) {
                log.warn(`[SEND_REQUEST] ❌ SET so'rov uchun fayldagi qiymat 0 yoki noto'g'ri: userId=${userId}, excelTotal=${excelTotal}, type=${typeof excelTotal}`);
                await bot.sendMessage(chatId,
                    `❌ <b>SET so'rov yaratish uchun fayldagi qiymat 0 bo'lmasligi kerak</b>\n\n` +
                    `SET (Muddat uzaytirish) so'rovi yaratish uchun Excel fayldagi jami qiymat 0 dan farq qilishi kerak.\n\n` +
                    `Hozirgi qiymat: ${excelTotal || 0}\n\n` +
                    `Iltimos, to'g'ri ma'lumotlar bilan Excel fayl yuboring va qaytadan yuborish tugmasini bosing.`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
            
            log.info(`[SEND_REQUEST] ✅ SET so'rov tekshiruvi muvaffaqiyatli o'tdi: userId=${userId}, excelTotal=${excelTotal}`);
        }
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Filial ma'lumotlarini olish
        const branch = state.data.branch_id ? await db('debt_branches').where('id', state.data.branch_id).first() : null;
        
        // Dublikat so'rovni tekshirish (SVR_ID bo'yicha)
        if (state.data.svr_id) {
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const existingRequest = await db('debt_requests')
                .where('svr_id', state.data.svr_id)
                .whereNotIn('status', inProcessStatuses)
                .first();
            
            if (existingRequest) {
                log.warn(`[SEND_REQUEST] Dublikat so'rov topildi: SVR ID=${state.data.svr_id}, Existing Request ID=${existingRequest.id}, RequestUID=${existingRequest.request_uid}, Status=${existingRequest.status}`);
                await bot.sendMessage(chatId,
                    `⚠️ <b>Bu SVR uchun jarayondagi so'rov mavjud</b>\n\n` +
                    `So'rov ID: ${existingRequest.request_uid}\n` +
                    `Holat: ${existingRequest.status}\n\n` +
                    `Yangi so'rov yaratish uchun avval mavjud so'rovni yakunlang.`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
        }
        
        // So'rov turini aniqlash
        const requestType = state.data.type || 'NORMAL';
        
        // Helper funksiyalarni import qilish
        const { generateRequestUID } = require('../../../utils/requestIdGenerator.js');
        const { logRequestAction } = require('../../../utils/auditLogger.js');
        const { scheduleReminder } = require('../../../utils/debtReminder.js');
        
        const requestUID = generateRequestUID();
        const status = requestType === 'SET' ? 'SET_PENDING' : 'PENDING_APPROVAL';
        
        // Excel ma'lumotlarini JSON formatiga o'tkazish (agar mavjud bo'lsa)
        const excelHeaders = state.data.excel_headers 
            ? (Array.isArray(state.data.excel_headers) ? JSON.stringify(state.data.excel_headers) : state.data.excel_headers)
            : null;
        const excelColumns = state.data.excel_columns 
            ? (typeof state.data.excel_columns === 'object' ? JSON.stringify(state.data.excel_columns) : state.data.excel_columns)
            : null;
        const excelData = state.data.excel_data 
            ? (Array.isArray(state.data.excel_data) ? JSON.stringify(state.data.excel_data) : state.data.excel_data)
            : null;
        
        // Database'ga so'rov yozish
        let requestId;
        if (isPostgres) {
            const [result] = await db('debt_requests').insert({
                request_uid: requestUID,
                type: requestType,
                brand_id: state.data.brand_id,
                branch_id: state.data.branch_id,
                svr_id: state.data.svr_id,
                status: status,
                created_by: user.id,
                extra_info: state.data.extra_info || null,
                excel_file_path: null, // Excel fayl saqlanmaydi, faqat ma'lumotlar database'ga saqlanadi
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: state.data.excel_total || null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).returning('id');
            requestId = result.id;
        } else {
            [requestId] = await db('debt_requests').insert({
                request_uid: requestUID,
                type: requestType,
                brand_id: state.data.brand_id,
                branch_id: state.data.branch_id,
                svr_id: state.data.svr_id,
                status: status,
                created_by: user.id,
                extra_info: state.data.extra_info || null,
                excel_file_path: null, // Excel fayl saqlanmaydi, faqat ma'lumotlar database'ga saqlanadi
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: state.data.excel_total || null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }
        
        log.info(`[SEND_REQUEST] ✅ So'rov muvaffaqiyatli yaratildi. Request ID: ${requestId}, Request UID: ${requestUID}`);
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'create_request',
            new_status: status,
            performed_by: user.id,
            note: `So'rov yaratildi: ${requestUID}`,
            created_at: new Date().toISOString()
        });
        
        // Audit log
        await logRequestAction(requestId, 'request_created', user.id, {
            new_status: status,
            type: requestType
        });
        
        // Eslatma boshlash
        await scheduleReminder(requestId);
        
        try {
            // So'rov turiga qarab keyingi bosqichlarni bajarish
            let cashierAssigned = false;
            let cashierWarning = '';
                
                // SET so'rov uchun rahbarlar guruhiga yuborish
                if (requestType === 'SET') {
                    log.info(`[SEND_REQUEST] 🔍 SET so'rov uchun rahbarlar guruhini topish boshlanmoqda. RequestId: ${requestId}, RequestUID: ${requestUID}`);
                    
                    log.debug(`[SEND_REQUEST] SET.1. Rahbarlar guruhini qidirish...`);
                    const leadersGroup = await db('debt_groups')
                        .where('group_type', 'leaders')
                        .where('is_active', true)
                        .first();
                    
                    if (leadersGroup) {
                        log.info(`[SEND_REQUEST] SET.1.1. ✅ Rahbarlar guruhi topildi: GroupId=${leadersGroup.telegram_group_id}, GroupName=${leadersGroup.name}`);
                        
                        log.debug(`[SEND_REQUEST] SET.2. So'rov ma'lumotlarini olish: requestId=${requestId}`);
                        const fullRequest = await db('debt_requests')
                            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                            .select(
                                'debt_requests.*',
                                'debt_brands.name as brand_name',
                                'debt_branches.name as filial_name',
                                'debt_svrs.name as svr_name'
                            )
                            .where('debt_requests.id', requestId)
                            .first();
                        
                        if (fullRequest) {
                            log.info(`[SEND_REQUEST] SET.2.1. ✅ So'rov ma'lumotlari topildi: RequestUID=${fullRequest.request_uid}, Brand=${fullRequest.brand_name}, Branch=${fullRequest.filial_name}, SVR=${fullRequest.svr_name}`);
                            
                            log.info(`[SEND_REQUEST] SET.3. Rahbarlar guruhiga xabar yuborilmoqda: groupId=${leadersGroup.telegram_group_id}, requestId=${requestId}`);
                            const { showSetRequestToLeaders } = require('./leader.js');
                            await showSetRequestToLeaders(fullRequest, leadersGroup.telegram_group_id);
                            log.info(`[SEND_REQUEST] SET.4. ✅ SET so'rov rahbarlar guruhiga muvaffaqiyatli yuborildi: GroupId=${leadersGroup.telegram_group_id}, RequestId=${requestId}, RequestUID=${requestUID}`);
                        } else {
                            log.error(`[SEND_REQUEST] SET.2.1. ❌ SET so'rov topilmadi: RequestId=${requestId}`);
                        }
                    } else {
                        log.warn(`[SEND_REQUEST] SET.1.1. ⚠️ Rahbarlar guruhi topilmadi. SET so'rov yuborilmadi. RequestId=${requestId}`);
                        cashierWarning = `\n\n⚠️ <b>Diqqat:</b> Rahbarlar guruhi topilmadi. So'rov admin tomonidan guruh sozlanguncha kutmoqda.`;
                    }
                }
                
                // NORMAL so'rov uchun kassir tayinlash
                if (requestType === 'NORMAL' && state.data.branch_id) {
                    log.info(`[SEND_REQUEST] 🔍 Oddiy so'rov uchun kassirlarni topish boshlanmoqda. BranchId: ${state.data.branch_id}, BrandId: ${state.data.brand_id}`);
                    
                    // 0. Barcha kassirlarga qaysi filiallar bog'langanini ko'rsatish
                    log.debug(`[SEND_REQUEST] 0. Barcha kassirlarga bog'langan filiallarni tekshirish...`);
                    const allCashiersWithBranches = await db('users')
                        .whereIn('role', ['kassir', 'cashier'])
                        .where('status', 'active')
                        .select('id', 'fullname', 'username', 'telegram_chat_id', 'role');
                    
                    for (const cashier of allCashiersWithBranches) {
                        // debt_cashiers jadvalidan
                        const cashierBranchesFromTable = await db('debt_cashiers')
                            .where('user_id', cashier.id)
                            .where('is_active', true)
                            .join('debt_branches', 'debt_cashiers.branch_id', 'debt_branches.id')
                            .select('debt_branches.id', 'debt_branches.name')
                            .orderBy('debt_branches.name');
                        
                        // debt_user_branches jadvalidan
                        const cashierBranchesFromBindings = await db('debt_user_branches')
                            .where('user_id', cashier.id)
                            .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                            .select('debt_branches.id', 'debt_branches.name')
                            .orderBy('debt_branches.name');
                        
                        // Birlashtirish
                        const allBranchesMap = new Map();
                        [...cashierBranchesFromTable, ...cashierBranchesFromBindings].forEach(b => {
                            if (!allBranchesMap.has(b.id)) {
                                allBranchesMap.set(b.id, b.name);
                            }
                        });
                        const allBranches = Array.from(allBranchesMap.entries()).map(([id, name]) => ({ id, name }));
                        
                        log.info(`[SEND_REQUEST] 0.1. Kassir: ${cashier.fullname} (ID: ${cashier.id}), Role: ${cashier.role}, TelegramChatId: ${cashier.telegram_chat_id ? 'mavjud' : 'yo\'q'}, Bog'langan filiallar: ${allBranches.length} ta`, 
                            allBranches.map(b => ({ id: b.id, name: b.name }))
                        );
                        
                        // Agar shu filialga bog'langan bo'lsa, alohida log
                        const hasThisBranch = allBranches.some(b => b.id === state.data.branch_id);
                        if (hasThisBranch) {
                            log.info(`[SEND_REQUEST] 0.2. ✅ Kassir ${cashier.fullname} (ID: ${cashier.id}) shu filialga (BranchId: ${state.data.branch_id}) bog'langan!`);
                        }
                    }
                    
                    // 0.5. Filial nomini olish (bir xil nomdagi filiallar uchun)
                    const currentBranchInfo = await db('debt_branches')
                        .where('id', state.data.branch_id)
                        .select('id', 'name')
                        .first();
                    
                    log.info(`[SEND_REQUEST] 0.5. Joriy filial ma'lumotlari: BranchId=${state.data.branch_id}, BranchName=${currentBranchInfo?.name || 'topilmadi'}`);
                    
                    // 1. Filialga biriktirilgan kassirlarni topish
                    // 1.1. debt_cashiers jadvalidan (eski usul) - avval ID bo'yicha
                    log.debug(`[SEND_REQUEST] 1.1. debt_cashiers jadvalidan qidirilmoqda: branchId=${state.data.branch_id}`);
                    let branchCashiersFromTable = await db('debt_cashiers')
                        .join('users', 'debt_cashiers.user_id', 'users.id')
                        .where('debt_cashiers.branch_id', state.data.branch_id)
                        .where('debt_cashiers.is_active', true)
                        .where('users.status', 'active')
                        .select(
                            'debt_cashiers.user_id',
                            'users.telegram_chat_id',
                            'users.fullname',
                            'users.username',
                            'users.role'
                        );
                    
                    // 1.1.1. Agar ID bo'yicha topilmasa, filial nomi bo'yicha qidirish
                    if (branchCashiersFromTable.length === 0 && currentBranchInfo) {
                        log.debug(`[SEND_REQUEST] 1.1.1. ID bo'yicha topilmadi, filial nomi bo'yicha qidirilmoqda: branchName=${currentBranchInfo.name}`);
                        const branchesWithSameName = await db('debt_branches')
                            .where('name', currentBranchInfo.name)
                            .select('id');
                        const branchIdsWithSameName = branchesWithSameName.map(b => b.id);
                        
                        log.debug(`[SEND_REQUEST] 1.1.1. Bir xil nomdagi filiallar: ${branchIdsWithSameName.length} ta`, branchIdsWithSameName);
                        
                        if (branchIdsWithSameName.length > 0) {
                            branchCashiersFromTable = await db('debt_cashiers')
                                .join('users', 'debt_cashiers.user_id', 'users.id')
                                .whereIn('debt_cashiers.branch_id', branchIdsWithSameName)
                                .where('debt_cashiers.is_active', true)
                                .where('users.status', 'active')
                                .select(
                                    'debt_cashiers.user_id',
                                    'users.telegram_chat_id',
                                    'users.fullname',
                                    'users.username',
                                    'users.role'
                                );
                            
                            log.info(`[SEND_REQUEST] 1.1.1. Filial nomi bo'yicha debt_cashiers jadvalidan topildi: ${branchCashiersFromTable.length} ta`, 
                                branchCashiersFromTable.map(c => ({ 
                                    user_id: c.user_id, 
                                    fullname: c.fullname, 
                                    role: c.role,
                                    telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                                }))
                            );
                        }
                    }
                    
                    log.info(`[SEND_REQUEST] 1.1. debt_cashiers jadvalidan topildi: ${branchCashiersFromTable.length} ta`, 
                        branchCashiersFromTable.map(c => ({ 
                            user_id: c.user_id, 
                            fullname: c.fullname, 
                            role: c.role,
                            telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                        }))
                    );
                    
                    // 1.2. debt_user_branches jadvalidan (yangi usul - foydalanuvchi biriktirishlari)
                    log.debug(`[SEND_REQUEST] 1.2. debt_user_branches jadvalidan qidirilmoqda: branchId=${state.data.branch_id}`);
                    // Avval shu filialga biriktirilgan barcha foydalanuvchilarni topish
                    let allBranchBindings = await db('debt_user_branches')
                        .where('branch_id', state.data.branch_id)
                        .select('user_id');
                    
                    // 1.2.1. Agar ID bo'yicha topilmasa, filial nomi bo'yicha qidirish
                    if (allBranchBindings.length === 0 && currentBranchInfo) {
                        log.debug(`[SEND_REQUEST] 1.2.1. ID bo'yicha topilmadi, filial nomi bo'yicha qidirilmoqda: branchName=${currentBranchInfo.name}`);
                        const branchesWithSameName = await db('debt_branches')
                            .where('name', currentBranchInfo.name)
                            .select('id');
                        const branchIdsWithSameName = branchesWithSameName.map(b => b.id);
                        
                        if (branchIdsWithSameName.length > 0) {
                            allBranchBindings = await db('debt_user_branches')
                                .whereIn('branch_id', branchIdsWithSameName)
                                .select('user_id');
                            
                            log.debug(`[SEND_REQUEST] 1.2.1. Filial nomi bo'yicha debt_user_branches jadvalidan topildi: ${allBranchBindings.length} ta`);
                        }
                    }
                    
                    log.debug(`[SEND_REQUEST] 1.2.1. Barcha filialga biriktirilgan foydalanuvchilar (role tekshiruvsiz): ${allBranchBindings.length} ta`, 
                        allBranchBindings.map(b => ({ user_id: b.user_id }))
                    );
                    
                    let branchCashiersFromBindings = await db('debt_user_branches')
                        .join('users', 'debt_user_branches.user_id', 'users.id')
                        .where('debt_user_branches.branch_id', state.data.branch_id)
                        .whereIn('users.role', ['kassir', 'cashier'])
                        .where('users.status', 'active')
                        .select(
                            'debt_user_branches.user_id',
                            'users.telegram_chat_id',
                            'users.fullname',
                            'users.username',
                            'users.role'
                        )
                        .groupBy('debt_user_branches.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
                    
                    // 1.2.2. Agar ID bo'yicha topilmasa, filial nomi bo'yicha qidirish
                    if (branchCashiersFromBindings.length === 0 && currentBranchInfo) {
                        log.debug(`[SEND_REQUEST] 1.2.2. ID bo'yicha topilmadi, filial nomi bo'yicha qidirilmoqda: branchName=${currentBranchInfo.name}`);
                        const branchesWithSameName = await db('debt_branches')
                            .where('name', currentBranchInfo.name)
                            .select('id');
                        const branchIdsWithSameName = branchesWithSameName.map(b => b.id);
                        
                        if (branchIdsWithSameName.length > 0) {
                            branchCashiersFromBindings = await db('debt_user_branches')
                                .join('users', 'debt_user_branches.user_id', 'users.id')
                                .whereIn('debt_user_branches.branch_id', branchIdsWithSameName)
                                .whereIn('users.role', ['kassir', 'cashier'])
                                .where('users.status', 'active')
                                .select(
                                    'debt_user_branches.user_id',
                                    'users.telegram_chat_id',
                                    'users.fullname',
                                    'users.username',
                                    'users.role'
                                )
                                .groupBy('debt_user_branches.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
                            
                            log.info(`[SEND_REQUEST] 1.2.2. Filial nomi bo'yicha debt_user_branches jadvalidan topildi: ${branchCashiersFromBindings.length} ta`, 
                                branchCashiersFromBindings.map(c => ({ 
                                    user_id: c.user_id, 
                                    fullname: c.fullname, 
                                    role: c.role,
                                    telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                                }))
                            );
                        }
                    }
                    
                    log.info(`[SEND_REQUEST] 1.2. debt_user_branches jadvalidan topildi: ${branchCashiersFromBindings.length} ta`, 
                        branchCashiersFromBindings.map(c => ({ 
                            user_id: c.user_id, 
                            fullname: c.fullname, 
                            role: c.role,
                            telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                        }))
                    );
                    
                    // Birlashtirish (dublikatlarni olib tashlash)
                    const branchCashiersMap = new Map();
                    [...branchCashiersFromTable, ...branchCashiersFromBindings].forEach(c => {
                        if (!branchCashiersMap.has(c.user_id)) {
                            branchCashiersMap.set(c.user_id, c);
                        }
                    });
                    const branchCashiers = Array.from(branchCashiersMap.values());
                    
                    log.info(`[SEND_REQUEST] 1.3. Filialga biriktirilgan kassirlar (birlashtirilgan): ${branchCashiers.length} ta`, 
                        branchCashiers.map(c => ({ 
                            user_id: c.user_id, 
                            fullname: c.fullname, 
                            role: c.role,
                            telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                        }))
                    );
                    
                    // 2. Filialning barcha brendlarini topish
                    // Avval filial nomini olish
                    const branchInfo = await db('debt_branches')
                        .where('id', state.data.branch_id)
                        .select('id', 'name', 'brand_id')
                        .first();
                    
                    if (!branchInfo) {
                        log.error(`[SEND_REQUEST] ❌ Filial topilmadi: BranchId=${state.data.branch_id}`);
                        cashierWarning = `\n\n⚠️ <b>Diqqat:</b> Filial topilmadi.`;
                    } else {
                        // Filialning barcha brendlarini topish (bir xil nomdagi barcha filiallarning brendlari)
                        const allBrandsInBranch = await db('debt_branches')
                            .where('name', branchInfo.name)
                            .whereNotNull('brand_id')
                            .select('brand_id')
                            .distinct();
                        
                        const branchBrandIds = [...new Set(allBrandsInBranch.map(b => b.brand_id).filter(Boolean))];
                        
                        // 3. Shu brendlarga biriktirilgan kassirlarni topish (debt_user_brands orqali)
                        let brandBoundCashiers = [];
                        if (branchBrandIds.length > 0) {
                            
                            // Brendlarga biriktirilgan kassirlarni to'g'ridan-to'g'ri topish
                            // Avval shu brendlarga biriktirilgan barcha kassirlarni topish (brand_id ni groupBy dan olib tashlash)
                            const brandBoundCashiersRaw = await db('debt_user_brands')
                                .join('users', 'debt_user_brands.user_id', 'users.id')
                                .whereIn('debt_user_brands.brand_id', branchBrandIds)
                                .whereIn('users.role', ['kassir', 'cashier'])
                                .where('users.status', 'active')
                                .select(
                                    'debt_user_brands.user_id',
                                    'users.telegram_chat_id',
                                    'users.fullname',
                                    'users.username',
                                    'users.role'
                                )
                                .groupBy('debt_user_brands.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
                            
                            // Dublikatlarni olib tashlash (groupBy allaqachon qilgan, lekin yana tekshirish)
                            const brandBoundCashiersMap = new Map();
                            brandBoundCashiersRaw.forEach(c => {
                                if (!brandBoundCashiersMap.has(c.user_id)) {
                                    brandBoundCashiersMap.set(c.user_id, {
                                        user_id: c.user_id,
                                        telegram_chat_id: c.telegram_chat_id,
                                        fullname: c.fullname,
                                        username: c.username,
                                        reason: 'brend'
                                    });
                                }
                            });
                            brandBoundCashiers = Array.from(brandBoundCashiersMap.values());
                        }
                        
                        // 4. Barcha kassirlarni birlashtirish (dublikatlarni olib tashlash)
                        const allCashiersMap = new Map();
                        
                        // Filialga biriktirilgan kassirlar
                        branchCashiers.forEach(c => {
                            allCashiersMap.set(c.user_id, {
                                user_id: c.user_id,
                                telegram_chat_id: c.telegram_chat_id,
                                fullname: c.fullname,
                                username: c.username,
                                reason: 'filial_binding'
                            });
                        });
                        
                        // Brendlarga biriktirilgan kassirlar
                        brandBoundCashiers.forEach(c => {
                            if (!allCashiersMap.has(c.user_id)) {
                                allCashiersMap.set(c.user_id, c);
                            } else {
                                // Agar allaqachon mavjud bo'lsa, reason'ni yangilash
                                const existing = allCashiersMap.get(c.user_id);
                                existing.reason = existing.reason === 'filial_binding' ? 'filial_va_brend' : c.reason;
                            }
                        });
                        
                        const allCashiers = Array.from(allCashiersMap.values());
                        log.info(`[SEND_REQUEST] 4.1. ✅ Jami kassirlar (dublikatsiz): ${allCashiers.length} ta`, allCashiers.map(c => ({ 
                            id: c.user_id, 
                            name: c.fullname, 
                            reason: c.reason,
                            telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                        })));
                        
                        // 5. So'rovga birinchi kassirni tayinlash (round-robin uchun)
                        log.debug(`[SEND_REQUEST] 5. So'rovga kassir tayinlash boshlanmoqda: branchId=${state.data.branch_id}, requestId=${requestId}`);
                        const { assignCashierToRequest } = require('../../../utils/cashierAssignment.js');
                        const assignedCashier = await assignCashierToRequest(state.data.branch_id, requestId);
                        
                        if (assignedCashier) {
                            log.info(`[SEND_REQUEST] 5.1. ✅ So'rovga tayinlangan kassir: CashierId=${assignedCashier.user_id}, Name=${assignedCashier.fullname}, TelegramChatId=${assignedCashier.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
                        } else {
                            log.warn(`[SEND_REQUEST] 5.1. ❌ So'rovga kassir tayinlanmadi: branchId=${state.data.branch_id}`);
                        }
                        
                        // 6. Faqat tayinlangan kassirga xabar yuborish (yoki agar tayinlanmagan bo'lsa, hech kimga yubormaslik)
                        log.debug(`[SEND_REQUEST] 6. Kassirga xabar yuborish boshlanmoqda...`);
                        let notifiedCashiersCount = 0;
                        
                        if (!assignedCashier) {
                            log.warn(`[SEND_REQUEST] 6.1. ⚠️ Kassir tayinlanmagan, xabar yuborilmadi.`);
                        } else if (!assignedCashier.telegram_chat_id) {
                            log.warn(`[SEND_REQUEST] 6.1. ⚠️ Kassir tayinlangan (ID: ${assignedCashier.user_id}, Name: ${assignedCashier.fullname}), lekin telegram_chat_id yo'q. Xabar yuborilmadi.`);
                        } else {
                            log.info(`[SEND_REQUEST] 6.1. Kassir tayinlangan va telegram_chat_id mavjud. Xabar yuborishga tayyorlanmoqda...`);
                            log.info(`[SEND_REQUEST] 6.2. Kassir ma'lumotlari: CashierId=${assignedCashier.user_id}, Name=${assignedCashier.fullname}, TelegramChatId=${assignedCashier.telegram_chat_id}`);
                            
                            const cashierHandlers = require('./cashier.js');
                            const fullRequest = await db('debt_requests')
                                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                                .select(
                                    'debt_requests.*',
                                    'debt_brands.name as brand_name',
                                    'debt_branches.name as filial_name',
                                    'debt_svrs.name as svr_name'
                                )
                                .where('debt_requests.id', requestId)
                                .first();
                            
                            if (!fullRequest) {
                                log.error(`[SEND_REQUEST] 6.3. ❌ So'rov topilmadi: requestId=${requestId}`);
                            } else {
                                log.info(`[SEND_REQUEST] 6.3. So'rov topildi: RequestId=${requestId}, RequestUID=${fullRequest.request_uid}, BranchName=${fullRequest.filial_name}`);
                                
                                try {
                                    const cashierUser = await db('users').where('id', assignedCashier.user_id).first();
                                    if (!cashierUser) {
                                        log.error(`[SEND_REQUEST] 6.4. ❌ Kassir foydalanuvchi topilmadi: CashierId=${assignedCashier.user_id}`);
                                    } else {
                                        log.info(`[SEND_REQUEST] 6.4. Kassir foydalanuvchi topildi: CashierId=${cashierUser.id}, Fullname=${cashierUser.fullname}, Status=${cashierUser.status}, TelegramChatId=${cashierUser.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
                                        
                                        // Kassirning boshqa faol so'rovlarini tekshirish (pendingCount hisoblash uchun)
                                        // MUHIM: Joriy so'rovni (requestId) istisno qilish kerak
                                        const activeRequestsCount = await db('debt_requests')
                                            .where('current_approver_id', assignedCashier.user_id)
                                            .where('current_approver_type', 'cashier')
                                            .whereIn('status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
                                            .where('locked', false)
                                            .where('id', '!=', requestId) // Joriy so'rovni istisno qilish
                                            .count('* as count')
                                            .first();
                                        
                                        const pendingCount = activeRequestsCount ? parseInt(activeRequestsCount.count) : 0;
                                        
                                        // HAR DOIM so'rovni yuborish (navbatli ko'rsatish uchun)
                                        // pendingCount = boshqa pending so'rovlar soni (joriy so'rovni istisno qilgan holda)
                                        log.info(`[SEND_REQUEST] 6.5. showRequestToCashier funksiyasini chaqirish boshlanmoqda... (pendingCount=${pendingCount})`);
                                        await cashierHandlers.showRequestToCashier(fullRequest, assignedCashier.telegram_chat_id, cashierUser, pendingCount);
                                        notifiedCashiersCount++;
                                        log.info(`[SEND_REQUEST] 6.6. ✅ Kassirga xabar muvaffaqiyatli yuborildi: CashierId=${assignedCashier.user_id}, Name=${assignedCashier.fullname}, ChatId=${assignedCashier.telegram_chat_id}, RequestUID=${fullRequest.request_uid}, pendingCount=${pendingCount}`);
                                    }
                                } catch (notifyError) {
                                    log.error(`[SEND_REQUEST] 6.7. ❌ Kassirga xabar yuborishda xatolik: CashierId=${assignedCashier.user_id}, Name=${assignedCashier.fullname}, ChatId=${assignedCashier.telegram_chat_id}, Error=${notifyError.message}`, notifyError);
                                    log.error(`[SEND_REQUEST] 6.7. Xatolik stack trace:`, notifyError.stack);
                                }
                            }
                        }
                        
                        log.info(`[SEND_REQUEST] 6.8. 📊 Xabar yuborish natijasi: Jami kassirlar=${allCashiers.length} ta, Tayinlangan=${assignedCashier ? 1 : 0} ta, Yuborildi=${notifiedCashiersCount} ta`);
                        
                        if (assignedCashier) {
                            cashierAssigned = true;
                        } else {
                            cashierWarning = `\n\n⚠️ <b>Diqqat:</b> Bu filial uchun kassir biriktirilmagan. So'rov admin tomonidan kassir biriktirilguncha kutmoqda.`;
                        }
                    }
                }
                
                // So'rov turiga qarab tasdiqlash jarayonini ko'rsatish
                // Filial va SVR nomlarini olish
                const branch = state.data.branch_id ? await db('debt_branches').where('id', state.data.branch_id).select('name').first() : null;
                const svr = state.data.svr_id ? await db('debt_svrs').where('id', state.data.svr_id).select('name').first() : null;
                
                let approvalFlow = '';
                
                if (requestType === 'SET') {
                    // SET so'rov uchun jarayon - har bir bosqich yonida status
                    approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
                        `1️⃣ <b>Rahbarlar guruhi</b> - <code>jarayonda</code>\n` +
                        `2️⃣ <b>Kassir</b> - <code>kutilyabdi</code>\n` +
                        `3️⃣ <b>Operator</b> - <code>kutilyabdi</code>\n` +
                        `4️⃣ <b>Final guruh</b> - <code>kutilyabdi</code>`;
                } else {
                    // NORMAL so'rov uchun jarayon - har bir bosqich yonida status
                    const kassirStatus = cashierAssigned ? '<code>jarayonda</code>' : '<code>kassir topilmadi</code>';
                    approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
                        `1️⃣ <b>Kassir</b> - ${kassirStatus}\n` +
                        `2️⃣ <b>Operator</b> - <code>kutilyabdi</code>\n` +
                        `3️⃣ <b>Final guruh</b> - <code>kutilyabdi</code>`;
                }
                
                // Xabarni yangilash va message_id ni saqlash
                await safeEditMessageText(bot,
                    `✅ <b>So'rov muvaffaqiyatli yaratildi!</b>\n\n` +
                    `📋 <b>ID:</b> ${requestUID}\n` +
                    `📋 <b>Turi:</b> ${requestType === 'SET' ? 'SET (Muddat uzaytirish)' : 'ODDIY'}\n` +
                    (branch ? `📍 <b>Filial:</b> ${branch.name}\n` : '') +
                    (svr ? `👤 <b>SVR:</b> ${svr.name}\n` : '') +
                    approvalFlow +
                    cashierWarning,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML'
                    }
                );
                
                // Status xabarni kuzatishga qo'shish (saqlanadi)
                const { markAsStatusMessage } = require('../utils/messageTracker.js');
                const { cleanupAfterStatusMessage } = require('../utils/messageCleanup.js');
                markAsStatusMessage(chatId, query.message.message_id);
                
                // preview_message_id ni saqlash (keyinroq real-time yangilash uchun) - API orqali
                try {
                    await axios.patch(`${API_URL}/api/debt-approval/requests/${requestId}/preview-message`, {
                        preview_message_id: query.message.message_id,
                        preview_chat_id: chatId
                    }, {
                        timeout: 5000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    log.debug(`[SEND_REQUEST] preview_message_id saqlandi: ${query.message.message_id}`);
                } catch (error) {
                    log.warn(`[SEND_REQUEST] preview_message_id saqlashda xatolik:`, error.message);
                }
                
                // Status xabari yuborilgandan keyin tozalash
                try {
                    log.info(`[SEND_REQUEST] [CLEANUP] Cleanup boshlanmoqda: chatId=${chatId}, userId=${userId}, statusMessageId=${query.message.message_id}`);
                    
                    // Kichik kutish - so'rov rahborga/kassirga yuborilishini kutish
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Tozalashni amalga oshirish
                    const cleanupResult = await cleanupAfterStatusMessage(
                        bot,
                        chatId,
                        query.message.message_id,
                        { maxMessages: 50, delayBetween: 100, silent: true }
                    );
                    
                    log.info(`[SEND_REQUEST] [CLEANUP] ✅ Tozalash yakunlandi: deleted=${cleanupResult.deleted}, errors=${cleanupResult.errors}`);
                } catch (cleanupError) {
                    // Silent fail - cleanup ixtiyoriy
                    log.warn(`[SEND_REQUEST] [CLEANUP] Cleanup xatolik (ixtiyoriy):`, cleanupError.message);
                }
                
            // State'ni tozalash
            stateManager.clearUserState(userId);
            log.info(`[SEND_REQUEST] ✅ State tozalandi`);
        } catch (error) {
            log.error(`[SEND_REQUEST] ❌ So'rov yaratishda xatolik:`, error);
            throw error;
        }
        
    } catch (error) {
        log.error(`[SEND_REQUEST] ❌ So'rov yuborishda xatolik:`, error);
        log.error(`[SEND_REQUEST] Stack trace:`, error.stack);
        
        let errorMessage = '❌ So\'rov yuborishda xatolik yuz berdi.';
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            errorMessage += '\n\n⚠️ Serverga ulanib bo\'lmadi. Iltimos, internet aloqasini tekshiring.';
        } else if (error.response) {
            errorMessage += `\n\nXatolik: ${error.response.data?.error || error.message}`;
        }
        
        await bot.sendMessage(chatId, errorMessage);
    }
}

// So'rovni bekor qilish
async function handleCancelRequest(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        stateManager.clearUserState(userId);
        
        await safeEditMessageText(bot,
            '❌ So\'rov bekor qilindi.',
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
    } catch (error) {
        log.error('So\'rovni bekor qilishda xatolik:', error);
    }
}

// Ortga qaytish funksiyasi
async function handleBack(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    // backType ni aniqroq olish
    let backType = null;
    if (query.data === 'debt_back_to_menu') {
        backType = 'menu';
    } else if (query.data === 'debt_back_to_brand') {
        backType = 'brand';
    } else if (query.data === 'debt_back_to_branch') {
        backType = 'branch';
    } else if (query.data === 'debt_back_to_svr') {
        backType = 'svr';
    } else if (query.data === 'debt_back_to_previous') {
        backType = 'previous';
    } else {
        // Fallback - eski usul
        backType = query.data.split('_').pop();
    }
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL) {
            log.warn(`[BACK] State topilmadi yoki noto'g'ri context: userId=${userId}, state=${state ? state.state : 'null'}, context=${state?.context || 'null'}`);
            await safeEditMessageText(bot,
                '❌ Jarayon to\'xtatilgan.\n\nYangi so\'rov yaratish uchun "➕ Yangi so\'rov" tugmasini bosing.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            ).catch(() => {
                return bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.\n\nYangi so\'rov yaratish uchun "➕ Yangi so\'rov" tugmasini bosing.');
            });
            return;
        }
        
        log.info(`[BACK] Ortga qaytish: userId=${userId}, backType=${backType}, currentState=${state.state}, data=${JSON.stringify(state.data)}`);
        
        if (backType === 'menu') {
            // Asosiy menyuga qaytish
            stateManager.clearUserState(userId);
            log.info(`[BACK] State tozalandi: userId=${userId}`);
            await safeEditMessageText(bot,
                '✅ Jarayon bekor qilindi.\n\nYangi so\'rov yaratish uchun "➕ Yangi so\'rov" tugmasini bosing.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            ).catch(async (error) => {
                log.warn(`[BACK] Xabarni yangilashda xatolik, yangi xabar yuborilmoqda: ${error.message}`);
                await bot.sendMessage(chatId, '✅ Jarayon bekor qilindi.\n\nYangi so\'rov yaratish uchun "➕ Yangi so\'rov" tugmasini bosing.');
            });
        } else if (backType === 'brand') {
            // Brend tanlashga qaytish
            log.info(`[BACK] Brend tanlashga qaytish: userId=${userId}`);
            stateManager.updateUserState(userId, STATES.SELECT_BRAND, {
                user_id: state.data?.user_id || null,
                type: state.data?.type || 'NORMAL',
                brand_id: null,
                branch_id: null,
                svr_id: null
            });
            
            const user = await userHelper.getUserByTelegram(chatId, userId);
            if (!user) {
                log.error(`[BACK] Foydalanuvchi topilmadi: userId=${userId}`);
                await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
                return;
            }
            
            const brands = await getAllowedDebtBrandsList(user);
            
            if (brands.length === 0) {
                log.warn(`[BACK] Brendlar topilmadi: userId=${userId}`);
                await safeEditMessageText(bot,
                    '❌ Sizga ruxsat berilgan brendlar topilmadi.\n\nIltimos, admin bilan bog\'laning.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                ).catch(() => bot.sendMessage(chatId, '❌ Sizga ruxsat berilgan brendlar topilmadi.'));
                return;
            }
            
            if (brands.length === 1) {
                // Faqat bitta brend bo'lsa, avtomatik tanlash
                log.info(`[BACK] Faqat bitta brend, avtomatik tanlash: brandId=${brands[0].id}`);
                await handleBrandSelection({ ...query, data: `debt_select_brand:${brands[0].id}` }, bot);
            } else {
                // Grid formatda brendlar ro'yxatini ko'rsatish
                const columns = brands.length > 10 ? 3 : brands.length > 5 ? 2 : 1;
                const keyboardRows = [];
                
                for (let i = 0; i < brands.length; i += columns) {
                    const row = brands.slice(i, i + columns).map(brand => ({
                            text: brand.name,
                            callback_data: `debt_select_brand:${brand.id}`
                    }));
                    keyboardRows.push(row);
                }
                
                // Ortga tugmasi qo'shish
                keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'debt_back_to_menu' }]);
                
                const keyboard = {
                    inline_keyboard: keyboardRows
                };
                
                await safeEditMessageText(bot,
                    '📋 Brendni tanlang:',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: keyboard
                    }
                ).catch(async (error) => {
                    log.warn(`[BACK] Xabarni yangilashda xatolik: ${error.message}`);
                    await bot.sendMessage(chatId, '📋 Brendni tanlang:', { reply_markup: keyboard });
                });
            }
        } else if (backType === 'branch') {
            // Filial tanlashga qaytish
            log.info(`[BACK] Filial tanlashga qaytish: userId=${userId}, brandId=${state.data?.brand_id}`);
            
            if (!state.data?.brand_id) {
                log.warn(`[BACK] Brend tanlanmagan: userId=${userId}`);
                await safeEditMessageText(bot,
                    '❌ Brend tanlanmagan. Brend tanlashga qaytamiz...',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                ).catch(() => bot.sendMessage(chatId, '❌ Brend tanlanmagan.'));
                // Brend tanlashga qaytish
                await handleBack({ ...query, data: 'debt_back_to_brand' }, bot);
                return;
            }
            
            stateManager.updateUserState(userId, STATES.SELECT_BRANCH, {
                ...state.data,
                branch_id: null,
                svr_id: null,
                extra_info: null,
                excel_data: null,
                excel_headers: null,
                excel_columns: null,
                excel_total: null,
                excel_file_path: null
            });
            
            const brand = await db('debt_brands').where('id', state.data.brand_id).first();
            const user = await userHelper.getUserByTelegram(chatId, userId);
            const branches = await getAllowedDebtBranchesList(user, state.data.brand_id);
            
            // Jarayondagi so'rovlarni tekshirish va filiallarni filtrlash
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const branchesToRemove = [];
            
            for (const branch of branches) {
                const branchSvrs = await db('debt_svrs')
                    .where('branch_id', branch.id)
                    .select('id');
                
                if (branchSvrs.length === 0) continue;
                
                const svrIds = branchSvrs.map(s => s.id);
                const inProcessRequests = await db('debt_requests')
                    .whereIn('svr_id', svrIds)
                    .whereNotIn('status', inProcessStatuses)
                    .select('svr_id')
                    .distinct('svr_id');
                
                const svrsWithRequests = new Set(inProcessRequests.map(r => r.svr_id));
                const allSvrsInProcess = branchSvrs.every(svr => svrsWithRequests.has(svr.id));
                
                if (allSvrsInProcess && svrIds.length > 0) {
                    branchesToRemove.push(branch.id);
                }
            }
            
            const filteredBranches = branches.filter(b => !branchesToRemove.includes(b.id));
            
            if (filteredBranches.length === 0) {
                log.warn(`[BACK] Filiallar topilmadi: userId=${userId}, brandId=${state.data.brand_id}`);
                await safeEditMessageText(bot,
                    `❌ Bu brend uchun ruxsat berilgan filiallar topilmadi yoki barcha filiallarda jarayondagi so'rovlar mavjud.\n\nBoshqa brendni tanlang:`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_brand' }]
                            ]
                        }
                    }
                ).catch(() => bot.sendMessage(chatId, '❌ Bu brend uchun filiallar topilmadi.'));
                return;
            }
            
            const columns = filteredBranches.length > 10 ? 3 : filteredBranches.length > 5 ? 2 : 1;
            const keyboardRows = [];
            
            for (let i = 0; i < filteredBranches.length; i += columns) {
                const row = filteredBranches.slice(i, i + columns).map(branch => ({
                    text: branch.name,
                    callback_data: `debt_select_branch:${branch.id}`
                }));
                keyboardRows.push(row);
            }
            
            keyboardRows.push([{ text: '⬅️ Ortga', callback_data: 'debt_back_to_brand' }]);
            
            await safeEditMessageText(bot,
                `✅ Brend: ${brand.name}\n\n📋 Filialni tanlang:`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: { inline_keyboard: keyboardRows }
                }
            ).catch(async (error) => {
                log.warn(`[BACK] Xabarni yangilashda xatolik: ${error.message}`);
                await bot.sendMessage(chatId, `✅ Brend: ${brand.name}\n\n📋 Filialni tanlang:`, {
                    reply_markup: { inline_keyboard: keyboardRows }
                });
            });
        } else if (backType === 'svr') {
            // SVR tanlashga qaytish
            log.info(`[BACK] SVR tanlashga qaytish: userId=${userId}, branchId=${state.data?.branch_id}`);
            
            if (!state.data?.branch_id) {
                log.warn(`[BACK] Filial tanlanmagan: userId=${userId}`);
                await safeEditMessageText(bot,
                    '❌ Filial tanlanmagan. Filial tanlashga qaytamiz...',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                ).catch(() => bot.sendMessage(chatId, '❌ Filial tanlanmagan.'));
                // Filial tanlashga qaytish
                await handleBack({ ...query, data: 'debt_back_to_branch' }, bot);
                return;
            }
            
            stateManager.updateUserState(userId, STATES.SELECT_SVR, {
                ...state.data,
                svr_id: null,
                extra_info: null,
                excel_data: null,
                excel_headers: null,
                excel_columns: null,
                excel_total: null,
                excel_file_path: null
            });
            
            const branch = await db('debt_branches').where('id', state.data.branch_id).first();
            const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
            
            // SVR'larni olish va filtrlash
            const allSvrs = await db('debt_svrs')
                .where('branch_id', state.data.branch_id)
                .select('id', 'name')
                .orderBy('name');
            
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const inProcessRequests = await db('debt_requests')
                .where('branch_id', state.data.branch_id)
                .whereNotIn('status', inProcessStatuses)
                .select('svr_id')
                .distinct('svr_id');
            
            const svrsWithRequests = new Set(inProcessRequests.map(r => r.svr_id));
            const filteredSvrs = allSvrs.filter(svr => !svrsWithRequests.has(svr.id));
            
            if (filteredSvrs.length === 0) {
                log.warn(`[BACK] SVR'lar topilmadi: userId=${userId}, branchId=${state.data.branch_id}`);
                await safeEditMessageText(bot,
                    `❌ Bu filialda barcha SVR'lar jarayondagi so'rovlarga ega.\n\nBoshqa filialni tanlang:`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                            ]
                        }
                    }
                ).catch(() => bot.sendMessage(chatId, '❌ Bu filialda SVR\'lar topilmadi.'));
                return;
            }
            
            const keyboard = {
                inline_keyboard: [
                    ...filteredSvrs.map(svr => [{
                        text: svr.name,
                        callback_data: `debt_select_svr:${svr.id}`
                    }]),
                    [{ text: '⬅️ Ortga', callback_data: 'debt_back_to_branch' }]
                ]
            };
            
            await safeEditMessageText(bot,
                `✅ Brend: ${brand?.name || ''}\n✅ Filial: ${branch.name}\n\n📋 SVR (FISH) ni tanlang:`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: keyboard
                }
            ).catch(async (error) => {
                log.warn(`[BACK] Xabarni yangilashda xatolik: ${error.message}`);
                await bot.sendMessage(chatId, `✅ Brend: ${brand?.name || ''}\n✅ Filial: ${branch.name}\n\n📋 SVR (FISH) ni tanlang:`, {
                    reply_markup: keyboard
                });
            });
        } else if (backType === 'previous') {
            // Oldingi bosqichga qaytish (Preview'dan)
            log.info(`[BACK] Preview'dan oldingi bosqichga qaytish: userId=${userId}, type=${state.data?.type}`);
            
            if (!state.data?.svr_id) {
                log.warn(`[BACK] SVR tanlanmagan, SVR tanlashga qaytish: userId=${userId}`);
                await handleBack({ ...query, data: 'debt_back_to_svr' }, bot);
                return;
            }
            
            const previousState = state.data.type === 'SET' ? STATES.SET_EXTRA_INFO : STATES.SELECT_SVR;
            
            if (previousState === STATES.SET_EXTRA_INFO) {
                log.info(`[BACK] SET_EXTRA_INFO ga qaytish: userId=${userId}`);
                
                if (!state.data.branch_id) {
                    log.error(`[BACK] Branch ID topilmadi: userId=${userId}`);
                    await bot.sendMessage(chatId, '❌ Xatolik: Filial ma\'lumotlari topilmadi.');
                    return;
                }
                
                stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, {
                    ...state.data,
                    // Type'ni saqlash (agar NORMAL ga o'zgarganda ham)
                    type: state.data?.type || 'SET',
                    excel_data: null,
                    excel_headers: null,
                    excel_columns: null,
                    excel_total: null,
                    excel_file_path: null
                });
                
                const branch = await db('debt_branches').where('id', state.data.branch_id).first();
                const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
                const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
                
                if (!branch || !svr) {
                    log.error(`[BACK] Branch yoki SVR topilmadi: branchId=${state.data.branch_id}, svrId=${state.data.svr_id}`);
                    await bot.sendMessage(chatId, '❌ Xatolik: Filial yoki SVR ma\'lumotlari topilmadi.');
                    return;
                }
                
                await safeEditMessageText(bot,
                    `✅ Brend: ${brand?.name || ''}\n✅ Filial: ${branch.name}\n✅ SVR: ${svr.name}\n\n📝 Izoh kiriting (masalan: "5 kun muddat uzaytirish"):\n\n📊 Yoki Excel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz):`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }],
                                [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                            ]
                        }
                    }
                ).catch(async (error) => {
                    log.warn(`[BACK] Xabarni yangilashda xatolik: ${error.message}`);
                    await bot.sendMessage(chatId, `✅ Brend: ${brand?.name || ''}\n✅ Filial: ${branch.name}\n✅ SVR: ${svr.name}\n\n📊 <b>SET so'rov uchun Excel fayl yuborilishi shart!</b>\n\nExcel fayl yuboring (ustunlar avtomatik aniqlanadi yoki siz tanlaysiz).\n\n📝 Qo'shimcha izoh (ixtiyoriy):`, { parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "⬅️ Ortga", callback_data: 'debt_back_to_svr' }],
                                [{ text: "❌ Bekor", callback_data: 'debt_cancel_request' }]
                            ]
                        }
                    });
                });
            } else {
                // SVR tanlashga qaytish
                log.info(`[BACK] SVR tanlashga qaytish (NORMAL so'rov): userId=${userId}`);
                await handleBack({ ...query, data: 'debt_back_to_svr' }, bot);
            }
        } else {
            log.warn(`[BACK] Noma'lum backType: ${backType}, userId=${userId}`);
            await bot.sendMessage(chatId, '❌ Noma\'lum amal.');
        }
        
    } catch (error) {
        log.error(`[BACK] Ortga qaytishda xatolik: userId=${userId}, backType=${backType}, error=${error.message}`, error);
        try {
            await safeEditMessageText(bot,
                '❌ Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            ).catch(() => {
                return bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
            });
        } catch (sendError) {
            log.error(`[BACK] Xabar yuborishda ham xatolik: ${sendError.message}`);
        }
    }
}

/**
 * Menejerning yangi so'rovlarini ko'rsatish (PENDING_APPROVAL va SET_PENDING)
 * Har bir so'rov alohida xabar holatida yuboriladi
 */
async function showMyRequests(userId, chatId) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            log.warn(`[MANAGER] User not found: userId=${userId}, chatId=${chatId}`);
            return;
        }
        
        log.info(`[MANAGER] Showing my requests: userId=${userId}, chatId=${chatId}`);
        
        // Yangi so'rovlar (PENDING_APPROVAL - NORMAL so'rovlar, SET_PENDING - SET so'rovlar)
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.created_by', user.id)
            .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'SET_PENDING'])
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'desc')
            .limit(20);
        
        if (requests.length === 0) {
            await bot.sendMessage(chatId, '📋 Hozircha yangi so\'rovlar yo\'q.');
            log.info(`[MANAGER] No new requests found: userId=${userId}`);
            return;
        }
        
        log.info(`[MANAGER] Found ${requests.length} new requests: userId=${userId}`);
        
        // Har bir so'rov uchun alohida xabar yuborish
        for (const request of requests) {
            const typeText = request.type === 'SET' ? 'SET (Muddat uzaytirish)' : 'ODDIY';
            const statusText = request.status === 'SET_PENDING' ? 'Rahbarlar kutilyabdi' : 'Kassir kutilyabdi';
            const createdDate = new Date(request.created_at).toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            const message = `📋 <b>${request.request_uid}</b>\n` +
                `Brend: ${request.brand_name}\n` +
                `Filial: ${request.filial_name}\n` +
                `SVR: ${request.svr_name}\n` +
                `Turi: ${typeText}\n` +
                `Status: ${statusText}\n` +
                `Sana: ${createdDate}`;
            
            try {
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
                log.debug(`[MANAGER] Sent request: requestUID=${request.request_uid}, userId=${userId}`);
            } catch (error) {
                log.error(`[MANAGER] Error sending request message: requestUID=${request.request_uid}, error=${error.message}`);
            }
        }
        
        log.info(`[MANAGER] ✅ Successfully sent ${requests.length} requests: userId=${userId}`);
    } catch (error) {
        log.error(`[MANAGER] Error showing my requests: userId=${userId}, error=${error.message}`);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Menejerning jarayondagi so'rovlarini ko'rsatish
 * Har bir so'rov alohida xabar holatida yuboriladi
 */
async function showInProgressRequests(userId, chatId) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            log.warn(`[MANAGER] User not found: userId=${userId}, chatId=${chatId}`);
            return;
        }
        
        // Jarayondagi so'rovlar (tasdiqlash jarayonida)
        const inProgressStatuses = [
            'APPROVED_BY_CASHIER',
            'APPROVED_BY_OPERATOR',
            'APPROVED_BY_SUPERVISOR',
            'APPROVED_BY_LEADER',
            'SET_PENDING'
        ];
        
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.created_by', user.id)
            .whereIn('debt_requests.status', inProgressStatuses)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'desc')
            .limit(20);
        
        if (requests.length === 0) {
            await bot.sendMessage(chatId, '⏳ Hozircha jarayondagi so\'rovlar yo\'q.');
            return;
        }
        
        // Har bir so'rov uchun alohida xabar yuborish
        for (const request of requests) {
            const typeText = request.type === 'SET' ? 'SET (Muddat uzaytirish)' : 'ODDIY';
            const createdDate = new Date(request.created_at).toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            // Jarayon kimda ekanligini aniqlash
            let processInfo = '';
            if (request.current_approver_id && request.current_approver_type) {
                const approver = await db('users').where('id', request.current_approver_id).first();
                if (approver) {
                    const approverTypeMap = {
                        'cashier': 'Kassir',
                        'operator': 'Operator',
                        'supervisor': 'Supervisor',
                        'leader': 'Rahbar'
                    };
                    processInfo = `\n⏳ Jarayon: ${approverTypeMap[request.current_approver_type] || request.current_approver_type} - ${approver.fullname || approver.username || 'Noma\'lum'}`;
                }
            } else {
                // Agar current_approver_id yo'q bo'lsa, status bo'yicha aniqlash
                const statusMap = {
                    'APPROVED_BY_CASHIER': 'Kassir tasdiqladi',
                    'APPROVED_BY_OPERATOR': 'Operator tasdiqladi',
                    'APPROVED_BY_SUPERVISOR': 'Supervisor tasdiqladi',
                    'APPROVED_BY_LEADER': 'Rahbar tasdiqladi',
                    'SET_PENDING': 'Rahbarlar kutilyabdi'
                };
                processInfo = `\n⏳ Jarayon: ${statusMap[request.status] || 'Jarayonda'}`;
            }
            
            const message = `📋 <b>${request.request_uid}</b>\n` +
                `Brend: ${request.brand_name}\n` +
                `Filial: ${request.filial_name} ⏳\n` +
                `SVR: ${request.svr_name} ⏳\n` +
                `Turi: ${typeText}\n` +
                `Sana: ${createdDate}${processInfo}`;
            
            try {
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                log.error(`[MANAGER] Error sending in progress request: ${error.message}`);
            }
        }
        
    } catch (error) {
        log.error(`[MANAGER] Error showing in progress requests: ${error.message}`);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Menejerning tasdiqlangan so'rovlarini ko'rsatish
 * Har bir so'rov alohida xabar holatida yuboriladi
 */
async function showApprovedRequests(userId, chatId) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            log.warn(`[MANAGER] User not found: userId=${userId}, chatId=${chatId}`);
            return;
        }
        
        // Tasdiqlangan so'rovlar (yakuniy tasdiqlangan)
        const approvedStatuses = [
            'APPROVED',
            'FINAL_APPROVED',
            'COMPLETED',
            'APPROVED_BY_OPERATOR'
        ];
        
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.created_by', user.id)
            .whereIn('debt_requests.status', approvedStatuses)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'desc')
            .limit(20);
        
        if (requests.length === 0) {
            await bot.sendMessage(chatId, '✅ Hozircha tasdiqlangan so\'rovlar yo\'q.');
            return;
        }
        
        // Har bir so'rov uchun alohida xabar yuborish
        for (const request of requests) {
            const typeText = request.type === 'SET' ? 'SET (Muddat uzaytirish)' : 'ODDIY';
            const createdDate = new Date(request.created_at).toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const message = `📋 <b>${request.request_uid}</b>\n` +
                `Brend: ${request.brand_name}\n` +
                `Filial: ${request.filial_name} ✅\n` +
                `SVR: ${request.svr_name} ✅\n` +
                `Turi: ${typeText}\n` +
                `Sana: ${createdDate}`;
            
            try {
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                log.error(`[MANAGER] Error sending approved request: ${error.message}`);
            }
        }
        
    } catch (error) {
        log.error(`[MANAGER] Error showing approved requests: ${error.message}`);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Statusni formatlash
 */
function formatRequestStatus(status) {
    const statusMap = {
        'PENDING_APPROVAL': 'Kutilyabdi',
        'APPROVED_BY_CASHIER': 'Kassir tasdiqladi',
        'APPROVED_BY_OPERATOR': 'Operator tasdiqladi',
        'APPROVED_BY_SUPERVISOR': 'Supervisor tasdiqladi',
        'APPROVED_BY_LEADER': 'Rahbar tasdiqladi',
        'SET_PENDING': 'Rahbarlar kutilyabdi',
        'APPROVED': 'Tasdiqlangan',
        'FINAL_APPROVED': 'Yakuniy tasdiqlangan',
        'COMPLETED': 'Yakunlangan',
        'DEBT_MARKED_BY_CASHIER': 'Qarzi bor (Kassir)',
        'DEBT_MARKED_BY_OPERATOR': 'Qarzi bor (Operator)',
        'REJECTED': 'Rad etilgan'
    };
    return statusMap[status] || status;
}

/**
 * Menejerga brend bo'yicha filiallar statistikasini ko'rsatish
 * - To'liq tasdiqlangan filiallar
 * - Jarayondagi filiallar
 * - So'rov yaratilmagan filiallar
 */
async function showBrandBranchStats(userId, chatId, brandId = null) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            log.warn(`[BRAND_STATS] User not found: userId=${userId}, chatId=${chatId}`);
            return;
        }
        
        log.info(`[BRAND_STATS] Showing brand branch stats: userId=${userId}, brandId=${brandId}`);
        
        // Ruxsat berilgan brendlarni olish
        let brands = await getAllowedDebtBrandsList(user);
        
        if (brandId) {
            brands = brands.filter(b => b.id === brandId);
        }
        
        if (brands.length === 0) {
            await bot.sendMessage(chatId, '❌ Sizga ruxsat berilgan brendlar topilmadi.');
            return;
        }
        
        const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
        
        // Har bir brend uchun statistikani tayyorlash
        let statsMessage = '📊 <b>Brend va Filiallar statistikasi:</b>\n\n';
        
        for (const brand of brands) {
            statsMessage += `🏷️ <b>${brand.name}</b>\n`;
            
            // Brenddagi barcha filiallarni olish
            const allBranches = await getAllowedDebtBranchesList(user, brand.id);
            
            if (allBranches.length === 0) {
                statsMessage += `   ❌ Filiallar topilmadi\n\n`;
                continue;
            }
            
            // Har bir filial uchun statistikani hisoblash
            const fullyApprovedBranches = [];
            const inProcessBranches = [];
            const noRequestBranches = [];
            
            for (const branch of allBranches) {
                // Filialdagi barcha SVR'larni olish
                const branchSvrs = await db('debt_svrs')
                    .where('branch_id', branch.id)
                    .select('id');
                
                if (branchSvrs.length === 0) {
                    noRequestBranches.push(branch);
                    continue;
                }
                
                const svrIds = branchSvrs.map(s => s.id);
                
                // Bu filialdagi barcha SVR'lar uchun jarayondagi so'rovlarni tekshirish
                const inProcessRequests = await db('debt_requests')
                    .whereIn('svr_id', svrIds)
                    .whereNotIn('status', inProcessStatuses)
                    .select('svr_id')
                    .distinct('svr_id');
                
                const svrsWithRequests = new Set(inProcessRequests.map(r => r.svr_id));
                
                // Agar filialdagi barcha SVR'lar jarayondagi so'rovga ega bo'lsa
                const allSvrsInProcess = svrIds.every(svrId => svrsWithRequests.has(svrId));
                
                // Agar filialdagi barcha SVR'lar to'liq tasdiqlangan bo'lsa (FINAL_APPROVED)
                // Har bir SVR uchun eng so'nggi FINAL_APPROVED so'rovni tekshirish
                let allSvrsFullyApproved = true;
                for (const svrId of svrIds) {
                    const latestApprovedRequest = await db('debt_requests')
                        .where('svr_id', svrId)
                        .where('status', 'FINAL_APPROVED')
                        .orderBy('created_at', 'desc')
                        .first();
                    
                    if (!latestApprovedRequest) {
                        allSvrsFullyApproved = false;
                        break;
                    }
                }
                
                if (allSvrsFullyApproved && svrIds.length > 0) {
                    fullyApprovedBranches.push(branch);
                } else if (allSvrsInProcess && svrIds.length > 0) {
                    inProcessBranches.push(branch);
                } else {
                    noRequestBranches.push(branch);
                }
            }
            
            // Statistikani ko'rsatish
            if (fullyApprovedBranches.length > 0) {
                statsMessage += `\n✅ <b>To'liq tasdiqlangan filiallar (${fullyApprovedBranches.length}):</b>\n`;
                fullyApprovedBranches.forEach(branch => {
                    statsMessage += `   • ${branch.name}\n`;
                });
            }
            
            if (inProcessBranches.length > 0) {
                statsMessage += `\n⏳ <b>Jarayondagi filiallar (${inProcessBranches.length}):</b>\n`;
                inProcessBranches.forEach(branch => {
                    statsMessage += `   • ${branch.name}\n`;
                });
            }
            
            if (noRequestBranches.length > 0) {
                statsMessage += `\n📋 <b>So'rov yaratilmagan filiallar (${noRequestBranches.length}):</b>\n`;
                noRequestBranches.forEach(branch => {
                    statsMessage += `   • ${branch.name}\n`;
                });
            }
            
            statsMessage += `\n`;
        }
        
        await bot.sendMessage(chatId, statsMessage, { parse_mode: 'HTML' });
        
        log.info(`[BRAND_STATS] ✅ Statistics sent: userId=${userId}`);
    } catch (error) {
        log.error(`[BRAND_STATS] Error showing brand branch stats: userId=${userId}, error=${error.message}`);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

module.exports = {
    handleNewRequest,
    handleBrandSelection,
    handleBranchSelection,
    handleSVRSelection,
    handleTypeSelection,
    handleExtraInfo,
    handleSendRequest,
    handleCancelRequest,
    handleBack,
    showMyRequests,
    showInProgressRequests,
    showApprovedRequests,
    showBrandBranchStats,
    showPreview,
    STATES
};

