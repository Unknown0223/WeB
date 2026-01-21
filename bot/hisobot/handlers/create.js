// bot/hisobot/handlers/create.js
// Yangi hisobot yaratish handler

const { createLogger } = require('../../../utils/logger.js');
const userHelper = require('../../unified/userHelper.js');
const stateManager = require('../../unified/stateManager.js');
const { db } = require('../../../db.js');
const { getAllowedDebtBranchesList, getAllowedDebtSVRsList } = require('../../../utils/debtAccessFilter.js');
const { getPreviousMonthName } = require('../../../utils/dateHelper.js');
const { parseExcelFile } = require('../../../utils/excelParser.js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const log = createLogger('HISOBOT_CREATE');

// FSM states
const STATES = {
    SELECT_BRAND: 'select_brand',
    SELECT_BRANCH: 'select_branch',
    SELECT_SVR: 'select_svr',
    ENTER_REPORT_DATA: 'enter_report_data',
    SET_EXTRA_INFO: 'set_extra_info',
    SET_PREVIEW: 'set_preview',
    UPLOAD_EXCEL: 'upload_excel',
    SELECT_COLUMNS: 'select_columns',
    EXCEL_PREVIEW: 'excel_preview'
};

/**
 * Yangi hisobot yaratish
 * @param {Object} msg - Telegram message object
 * @param {Object} bot - Telegram bot instance
 * @param {String} requestType - 'NORMAL' yoki 'SET'
 */
async function handleCreateReport(msg, bot, requestType = 'NORMAL') {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        log.info(`[CREATE] ${requestType === 'SET' ? 'SET' : 'Oddiy'} hisobot yaratish so'ralmoqda. UserId: ${userId}`);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, `❌ Siz ro'yxatdan o'tmagansiz. Iltimos, avval ro'yxatdan o'ting.`);
            return true;
        }
        
        // Permissions tekshirish
        const permissions = await userHelper.getUserPermissions(user.id);
        log.debug(`[CREATE] User permissions:`, permissions);
        log.debug(`[CREATE] User role: ${user.role}, User ID: ${user.id}`);
        
        if (!permissions.includes('reports:create')) {
            log.warn(`[CREATE] Permission denied. User ID: ${user.id}, Role: ${user.role}, Has reports:create: ${permissions.includes('reports:create')}`);
            await bot.sendMessage(chatId, 
                `❌ Sizda yangi hisobot yaratish huquqi yo'q.\n\n` +
                `Bu funksiyadan foydalanish uchun "Hisobotlar" bo'limida "Yangi hisobot yaratish" huquqiga ega bo'lishingiz kerak.\n\n` +
                `Iltimos, admin panel orqali huquqlarni tekshiring:\n` +
                `• "Rollar va Huquqlar" bo'limiga o'ting\n` +
                `• "${user.role}" rolini tanlang\n` +
                `• "Hisobotlar" bo'limida "Yangi hisobot yaratish" huquqini tanlang`,
                { parse_mode: 'HTML' }
            );
            return true;
        }
        
        log.info(`[CREATE] ✅ Permission mavjud. Brendlar va filiallar ro'yxatini tekshirish...`);
        
        // Foydalanuvchiga ruxsat berilgan brendlarni olish
        const { getAllowedDebtBrandsList } = require('../../../utils/debtAccessFilter.js');
        const allowedBrands = await getAllowedDebtBrandsList(user);
        
        log.info(`[CREATE] 📊 Ruxsat berilgan brendlar: ${allowedBrands === null ? 'Barcha brendlar' : allowedBrands.length + ' ta'}`);
        
        // Agar faqat bitta brend bo'lsa, to'g'ridan-to'g'ri filiallar ro'yxatini ko'rsatish
        if (allowedBrands !== null && allowedBrands.length === 1) {
            const singleBrand = allowedBrands[0];
            log.info(`[CREATE] ✅ Faqat bitta brend topildi: ${singleBrand.name} (ID: ${singleBrand.id}), to'g'ridan-to'g'ri filiallar ro'yxatini ko'rsatamiz`);
            
            // State'ni boshlash (brend allaqachon tanlangan)
            stateManager.setUserState(userId, stateManager.CONTEXTS.HISOBOT, STATES.SELECT_BRANCH, {
                user_id: user.id,
                brand_id: singleBrand.id,
                branch_id: null,
                svr_id: null,
                report_data: null,
                request_type: requestType,
                extra_info: null
            });
            
            // Filiallar ro'yxatini olish (faqat shu brend uchun)
            const branchesRaw = await getAllowedDebtBranchesList(user, singleBrand.id);
            
            // Dublikatlarni olib tashlash (ID bo'yicha unique)
            const branchesMap = new Map();
            branchesRaw.forEach(branch => {
                if (!branchesMap.has(branch.id)) {
                    branchesMap.set(branch.id, branch);
                }
            });
            const branches = Array.from(branchesMap.values());
            
            if (branches.length === 0) {
                await bot.sendMessage(chatId, 
                    '❌ Sizga ruxsat berilgan filiallar topilmadi.\n\n' +
                    'Iltimos, admin panel orqali "Qarzdorlik Tasdiqlash" → "Bog\'lanishlar" bo\'limida ' +
                    'filiallarni biriktiring yoki admin bilan bog\'laning.'
                );
                stateManager.clearUserState(userId);
                return true;
            }
            
            // Filiallar keyboard yaratish (ko'p ustunli, brend nomini qo'shmasdan)
            const columns = branches.length > 10 ? 3 : branches.length > 5 ? 2 : 1;
            const keyboardRows = [];
            
            for (let i = 0; i < branches.length; i += columns) {
                const row = branches.slice(i, i + columns).map(branch => ({
                    text: branch.name,
                    callback_data: `report_select_branch:${branch.id}`
                }));
                keyboardRows.push(row);
            }
            
            const keyboard = {
                inline_keyboard: keyboardRows
            };
            
            await bot.sendMessage(
                chatId,
                `📋 <b>Yangi hisobot yaratish</b>\n\n📍 Brend: ${singleBrand.name}\n\nFilialni tanlang:`,
                { 
                    parse_mode: 'HTML',
                    reply_markup: keyboard 
                }
            );
            
            log.info(`[CREATE] ✅ Filiallar ro'yxati yuborildi (bitta brend)`);
            return true;
        }
        
        // Agar ikki yoki ko'proq brendlar bo'lsa, avval brend tanlash
        if (allowedBrands !== null && allowedBrands.length > 1) {
            log.info(`[CREATE] ✅ ${allowedBrands.length} ta brend topildi, avval brend tanlash`);
            
            // State'ni boshlash (brend tanlash bosqichi)
            stateManager.setUserState(userId, stateManager.CONTEXTS.HISOBOT, STATES.SELECT_BRAND, {
                user_id: user.id,
                brand_id: null,
                branch_id: null,
                svr_id: null,
                report_data: null,
                request_type: requestType,
                extra_info: null
            });
            
            // Brendlar keyboard yaratish (ko'p ustunli)
            const brandColumns = allowedBrands.length > 10 ? 3 : allowedBrands.length > 5 ? 2 : 1;
            const brandKeyboardRows = [];
            
            for (let i = 0; i < allowedBrands.length; i += brandColumns) {
                const row = allowedBrands.slice(i, i + brandColumns).map(brand => ({
                    text: brand.name,
                    callback_data: `report_select_brand:${brand.id}`
                }));
                brandKeyboardRows.push(row);
            }
            
            const brandKeyboard = {
                inline_keyboard: brandKeyboardRows
            };
            
            await bot.sendMessage(
                chatId,
                '📋 <b>Yangi hisobot yaratish</b>\n\nBrendni tanlang:',
                { 
                    parse_mode: 'HTML',
                    reply_markup: brandKeyboard 
                }
            );
            
            log.info(`[CREATE] ✅ Brendlar ro'yxati yuborildi`);
            return true;
        }
        
        // Agar hech qanday brend cheklovi yo'q bo'lsa (barcha brendlar ruxsat berilgan)
        log.info(`[CREATE] ✅ Hech qanday brend cheklovi yo'q, barcha filiallarni ko'rsatamiz`);
        
        // State'ni boshlash
        stateManager.setUserState(userId, stateManager.CONTEXTS.HISOBOT, STATES.SELECT_BRANCH, {
            user_id: user.id,
            brand_id: null,
            branch_id: null,
            svr_id: null,
            report_data: null,
            request_type: requestType,
            extra_info: null
        });
        
        // Filiallar ro'yxatini olish (barcha ruxsat berilgan filiallar)
        const branchesRaw = await getAllowedDebtBranchesList(user);
        
    } catch (error) {
        log.error('[CREATE] Xatolik:', error);
        await bot.sendMessage(chatId, `❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.`);
        stateManager.clearUserState(userId);
        return true;
    }
}

/**
 * Brend tanlash
 */
async function handleBrandSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const brandId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_BRAND) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        // Brend ma'lumotlarini olish
        const brand = await db('debt_brands').where('id', brandId).first();
        if (!brand) {
            await bot.sendMessage(chatId, '❌ Brend topilmadi.');
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
        
        // Filiallar ro'yxatini olish (faqat shu brend uchun)
        const branchesRaw = await getAllowedDebtBranchesList(user, brandId);
        
        if (branchesRaw.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ Bu brend uchun ruxsat berilgan filiallar topilmadi.\n\n' +
                'Iltimos, admin panel orqali filiallarni biriktiring.'
            );
            stateManager.clearUserState(userId);
            return;
        }
        
        // Dublikatlarni olib tashlash (ID bo'yicha unique)
        const branchesMap = new Map();
        branchesRaw.forEach(branch => {
            if (!branchesMap.has(branch.id)) {
                branchesMap.set(branch.id, branch);
            }
        });
        const branches = Array.from(branchesMap.values());
        
        // Filiallar keyboard yaratish (ko'p ustunli)
        const columns = branches.length > 10 ? 3 : branches.length > 5 ? 2 : 1;
        const keyboardRows = [];
        
        for (let i = 0; i < branches.length; i += columns) {
            const row = branches.slice(i, i + columns).map(branch => ({
                text: branch.name,
                callback_data: `report_select_branch:${branch.id}`
            }));
            keyboardRows.push(row);
        }
        
        const keyboard = {
            inline_keyboard: keyboardRows
        };
        
        await bot.editMessageText(
            `✅ Brend: ${brand.name}\n\n📋 Filialni tanlang:`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: keyboard,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('Brend tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Filial tanlash
 */
async function handleBranchSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const branchId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_BRANCH) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        // Filial ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', branchId).first();
        if (!branch) {
            await bot.sendMessage(chatId, '❌ Filial topilmadi.');
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
        
        // SVR ro'yxatini olish (filtrlash bilan)
        let svrs = await getAllowedDebtSVRsList(user, null, branchId);
        
        if (svrs.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ Bu filial uchun ruxsat berilgan SVR (FISH) topilmadi.\n\n' +
                'Iltimos, admin panel orqali SVR\'larni biriktiring.'
            );
            stateManager.clearUserState(userId);
            return;
        }
        
        // Faqat jarayondagi so'rovlarni tekshirish (vaqt cheklovi yo'q)
        // Jarayondagi so'rovlar: FINAL_APPROVED, CANCELLED, REJECTED dan tashqari barcha so'rovlar
        log.info(`[HISOBOT_CREATE] [SVR_FILTER] BranchId=${branchId}, Jami SVR'lar soni: ${svrs.length}, SVR IDs: [${svrs.map(s => s.id).join(', ')}]`);
        
        // Jarayondagi so'rovlarni topish (FINAL_APPROVED, CANCELLED, REJECTED dan tashqari)
        const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
        const inProcessRequests = await db('debt_requests')
            .where('branch_id', branchId)
            .whereNotIn('status', inProcessStatuses)
            .select('svr_id', 'request_uid', 'status', 'created_at')
            .orderBy('created_at', 'desc');
        
        log.info(`[HISOBOT_CREATE] [SVR_FILTER] Jarayondagi so'rovlar (FINAL_APPROVED/CANCELLED/REJECTED dan tashqari): ${inProcessRequests.length} ta`);
        inProcessRequests.forEach(req => {
            log.info(`[HISOBOT_CREATE] [SVR_FILTER]   - Request: ${req.request_uid}, SVR ID: ${req.svr_id}, Status: ${req.status}, Created: ${req.created_at}`);
        });
        
        if (inProcessRequests.length > 0) {
            // Jarayondagi so'rovlardagi SVR ID'larni olib tashlash
            const usedSvrIds = new Set(inProcessRequests.map(r => r.svr_id));
            const beforeCount = svrs.length;
            
            log.info(`[HISOBOT_CREATE] [SVR_FILTER] [DETAIL] Filtrlashdan oldin SVR'lar:`);
            svrs.forEach(svr => {
                const hasRequest = usedSvrIds.has(svr.id);
                const requestsForSvr = inProcessRequests.filter(r => r.svr_id === svr.id);
                log.info(`[HISOBOT_CREATE] [SVR_FILTER] [DETAIL]   - SVR ID: ${svr.id}, Name: ${svr.name}, HasRequest: ${hasRequest}, RequestsCount: ${requestsForSvr.length}`);
                if (requestsForSvr.length > 0) {
                    requestsForSvr.forEach(req => {
                        log.info(`[HISOBOT_CREATE] [SVR_FILTER] [DETAIL]     * Request: ${req.request_uid}, Status: ${req.status}, Created: ${req.created_at}`);
                    });
                }
            });
            
            svrs = svrs.filter(svr => !usedSvrIds.has(svr.id));
            const afterCount = svrs.length;
            
            log.info(`[HISOBOT_CREATE] [SVR_FILTER] Jarayondagi so'rovlarga tegishli SVR IDs: [${Array.from(usedSvrIds).join(', ')}]`);
            log.info(`[HISOBOT_CREATE] [SVR_FILTER] Filtrlashdan oldin: ${beforeCount} ta, Filtrlashdan keyin: ${afterCount} ta`);
            log.info(`[HISOBOT_CREATE] [SVR_FILTER] Qolgan SVR IDs (jarayondagi so'rov yo'q): [${svrs.map(s => s.id).join(', ')}]`);
        } else {
            log.info(`[HISOBOT_CREATE] [SVR_FILTER] Jarayondagi so'rovlar topilmadi, barcha SVR'lar ko'rsatiladi`);
        }
        
        if (svrs.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ Bu filial uchun barcha SVR\'lar uchun joriy oy so\'rovlari tasdiqlangan.\n\n' +
                'Yangi oy boshlanganda qayta urinib ko\'ring.'
            );
            stateManager.clearUserState(userId);
            return;
        }
        
        // Agar faqat bitta SVR bo'lsa, avtomatik tanlab o'tkazib yuborish
        if (svrs.length === 1) {
            const svr = svrs[0];
            log.info(`[CREATE] Faqat bitta SVR topildi, avtomatik tanlandi: ${svr.name} (ID: ${svr.id})`);
            
            // State'ni yangilash
            stateManager.updateUserState(userId, STATES.ENTER_REPORT_DATA, { 
                branch_id: branchId,
                svr_id: svr.id 
            });
            
            // SVR ma'lumotlarini olish
            const svrData = await db('debt_svrs').where('id', svr.id).first();
            
            await bot.editMessageText(
                `✅ Filial: ${branch.name}\n✅ SVR: ${svrData.name}\n\n📝 Hisobot ma'lumotlarini kiriting:`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML'
                }
            );
            return;
        }
        
        // SVR keyboard yaratish (ko'p ustunli)
        const svrColumns = svrs.length > 10 ? 3 : svrs.length > 5 ? 2 : 1;
        const svrKeyboardRows = [];
        
        for (let i = 0; i < svrs.length; i += svrColumns) {
            const row = svrs.slice(i, i + svrColumns).map(svr => ({
                text: svr.name,
                callback_data: `report_select_svr:${svr.id}`
            }));
            svrKeyboardRows.push(row);
        }
        
        const keyboard = {
            inline_keyboard: svrKeyboardRows
        };
        
        await bot.editMessageText(
            `✅ Filial: ${branch.name}\n\n📋 SVR (FISH) ni tanlang:`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: keyboard,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('Filial tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * SVR tanlash
 */
async function handleSVRSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const svrId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_SVR) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan. Qaytadan boshlang.');
            return;
        }
        
        // SVR ma'lumotlarini olish
        const svr = await db('debt_svrs').where('id', svrId).first();
        if (!svr) {
            await bot.sendMessage(chatId, '❌ SVR topilmadi.');
            return;
        }
        
        // Filial nomini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.ENTER_REPORT_DATA, { svr_id: svrId });
        
        await bot.editMessageText(
            `✅ Filial: ${branch.name}\n✅ SVR: ${svr.name}\n\n📝 Hisobot ma'lumotlarini kiriting:`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('SVR tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Hisobot ma'lumotlarini qabul qilish
 */
async function handleReportData(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const reportData = msg.text;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.ENTER_REPORT_DATA) {
            return false;
        }
        
        // State'ni yangilash (eski ma'lumotlarni saqlab qolish)
        stateManager.updateUserState(userId, STATES.ENTER_REPORT_DATA, { 
            ...state.data,
            report_data: reportData 
        });
        
        // Filial va SVR ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        
        // Brend nomini olish (agar mavjud bo'lsa)
        let brandName = '';
        if (state.data.brand_id) {
            const brand = await db('debt_brands').where('id', state.data.brand_id).first();
            if (brand) {
                brandName = `\n🏢 Brend: ${brand.name}`;
            }
        }
        
        // Request type'ni olish
        const requestType = state.data.request_type || 'NORMAL';
        
        // Agar SET bo'lsa, qo'shimcha ma'lumot so'rash
        if (requestType === 'SET') {
            // State'ni SET_EXTRA_INFO ga o'zgartirish
            stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, {
                ...state.data,
                report_data: reportData
            });
            
            await bot.sendMessage(
                chatId,
                `📋 <b>SET (Muddat uzaytirish) hisoboti</b>\n\n` +
                (brandName ? brandName : '') +
                `📍 Filial: ${branch.name}\n` +
                `👤 SVR: ${svr.name}\n` +
                `📝 Hisobot: ${reportData}\n\n` +
                `💬 Qo'shimcha ma'lumot kiriting (muddat uzaytirish sababi, muddat va boshqalar):`,
                {
                    parse_mode: 'HTML'
                }
            );
            
            return true;
        }
        
        // Oddiy hisobot uchun preview keyboard
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Yuborish', callback_data: 'report_send' }
                ],
                [
                    { text: '⚠️ Qarzi bor', callback_data: 'report_debt_exists' }
                ],
                [
                    { text: '❌ Bekor qilish', callback_data: 'report_cancel' }
                ]
            ]
        };
        
        await bot.sendMessage(
            chatId,
            `📋 <b>Hisobot ma'lumotlari:</b>\n\n` +
            (brandName ? brandName : '') +
            `📍 Filial: ${branch.name}\n` +
            `👤 SVR: ${svr.name}\n` +
            `📝 Ma'lumot: ${reportData}\n\n` +
            `Hisobotni yuborishni tasdiqlang:`,
            {
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
        return true;
        
    } catch (error) {
        log.error('Hisobot ma\'lumotlarini qabul qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
    }
}

/**
 * Hisobotni yuborish (oddiy so'rov)
 */
async function handleSendReport(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Yuborilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || !state.data) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Filial, SVR va brend ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
        
        // O'tgan oy nomini olish
        const oldMonthName = getPreviousMonthName();
        
        // Standartlashtirilgan xabar formati
        let messageText = 'Assalomu aleykum\n\n';
        
        if (brand) {
            messageText += `Brend: ${brand.name}\n\n`;
        }
        
        messageText += `${branch.name} filial supervayzeri ${svr.name} ${oldMonthName} oyi qarzlarini yopdi.\n`;
        messageText += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz`;
        
        // Excel ma'lumotlari mavjud bo'lsa, qo'shish
        if (state.data.excel_data && state.data.excel_data.length > 0) {
            const { formatExcelData, calculateTotalFromExcel } = require('../../../utils/excelParser.js');
            // Headers va columns ni to'g'ri olish (agar JSON string bo'lsa, parse qilish)
            let headers = state.data.excel_headers || [];
            let columns = state.data.excel_columns || {};
            
            // Agar headers string bo'lsa, parse qilish
            if (typeof headers === 'string') {
                try {
                    headers = JSON.parse(headers);
                } catch (e) {
                    log.warn('[CREATE] Headers parse qilishda xatolik:', e);
                    headers = [];
                }
            }
            
            // Agar columns string bo'lsa, parse qilish
            if (typeof columns === 'string') {
                try {
                    columns = JSON.parse(columns);
                } catch (e) {
                    log.warn('[CREATE] Columns parse qilishda xatolik:', e);
                    columns = {};
                }
            }
            
            const formattedData = formatExcelData(state.data.excel_data, columns, headers);
            
            // Excel total ni tekshirish va qo'shish
            let excelTotal = state.data.excel_total;
            if (excelTotal === null || excelTotal === undefined || excelTotal === 0) {
                // Agar excel_total bo'sh bo'lsa, qayta hisoblash
                excelTotal = calculateTotalFromExcel(state.data.excel_data, columns, headers);
            }
            
            // Formatlangan ma'lumotlarni qo'shish, lekin TOTAL ni yangilash
            const formattedLines = formattedData.split('\n');
            const totalLineIndex = formattedLines.findIndex(line => line.startsWith('TOTAL:'));
            if (totalLineIndex !== -1) {
                formattedLines[totalLineIndex] = `TOTAL: ${excelTotal.toLocaleString('ru-RU')}`;
            } else {
                // Agar TOTAL qatori topilmasa, qo'shish
                formattedLines.push(`TOTAL: ${excelTotal.toLocaleString('ru-RU')}`);
            }
            messageText += `\n\n${formattedLines.join('\n')}`;
        }
        
        // Kassirga yuborish uchun keyboard
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash', callback_data: 'cashier_approve' }],
                [{ text: '⚠️ Qarzi bor', callback_data: 'cashier_debt_exists' }]
            ]
        };
        
        // So'rovni database'ga yozish
        const { generateRequestUID } = require('../../../utils/requestIdGenerator.js');
        const { assignCashierToRequest } = require('../../../utils/cashierAssignment.js');
        const { logRequestAction } = require('../../../utils/auditLogger.js');
        const { scheduleReminder } = require('../../../utils/debtReminder.js');
        const { formatNormalRequestMessage } = require('../../../utils/messageTemplates.js');
        const { showRequestToCashier } = require('../../debt-approval/handlers/cashier.js');
        
        const requestUID = generateRequestUID();
        
        // Excel ma'lumotlarini JSON formatiga o'tkazish (agar array/object bo'lsa)
        const excelHeaders = state.data.excel_headers 
            ? (Array.isArray(state.data.excel_headers) ? JSON.stringify(state.data.excel_headers) : state.data.excel_headers)
            : null;
        const excelColumns = state.data.excel_columns 
            ? (typeof state.data.excel_columns === 'object' ? JSON.stringify(state.data.excel_columns) : state.data.excel_columns)
            : null;
        const excelData = state.data.excel_data 
            ? (Array.isArray(state.data.excel_data) ? JSON.stringify(state.data.excel_data) : state.data.excel_data)
            : null;
        
        const [requestId] = await db('debt_requests').insert({
            request_uid: requestUID,
            type: 'NORMAL',
            brand_id: state.data.brand_id || branch.brand_id,
            branch_id: state.data.branch_id,
            svr_id: state.data.svr_id,
            status: 'PENDING_APPROVAL',
            created_by: user.id,
            excel_file_path: state.data.excel_file_path || null,
            excel_data: excelData,
            excel_headers: excelHeaders,
            excel_columns: excelColumns,
            excel_total: state.data.excel_total || null
        });
        
        // Kassir tayinlash va barcha tegishli kassirlarga xabar yuborish
        const requestBrandId = state.data.brand_id || branch?.brand_id;
        log.info(`[CREATE] 🔍 Oddiy so'rov uchun kassirlarni topish boshlanmoqda. BranchId: ${state.data.branch_id}, BrandId: ${requestBrandId}`);
        
        // 1. Filialga biriktirilgan kassirlarni topish
        // 1.1. debt_cashiers jadvalidan (eski usul)
        const branchCashiersFromTable = await db('debt_cashiers')
            .join('users', 'debt_cashiers.user_id', 'users.id')
            .where('debt_cashiers.branch_id', state.data.branch_id)
            .where('debt_cashiers.is_active', true)
            .where('users.status', 'active')
            .select(
                'debt_cashiers.user_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username'
            );
        
        log.info(`[CREATE] 📍 debt_cashiers jadvalidan filialga biriktirilgan kassirlar: ${branchCashiersFromTable.length} ta`, branchCashiersFromTable.map(c => ({ id: c.user_id, name: c.fullname })));
        
        // 1.2. debt_user_branches jadvalidan (yangi usul - foydalanuvchi biriktirishlari)
        const branchCashiersFromBindings = await db('debt_user_branches')
            .join('users', 'debt_user_branches.user_id', 'users.id')
            .where('debt_user_branches.branch_id', state.data.branch_id)
            .whereIn('users.role', ['kassir', 'cashier'])
            .where('users.status', 'active')
            .select(
                'debt_user_branches.user_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username'
            )
            .groupBy('debt_user_branches.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username');
        
        log.info(`[CREATE] 📍 debt_user_branches jadvalidan filialga biriktirilgan kassirlar: ${branchCashiersFromBindings.length} ta`, branchCashiersFromBindings.map(c => ({ id: c.user_id, name: c.fullname })));
        
        // Birlashtirish (dublikatlarni olib tashlash)
        const branchCashiersMap = new Map();
        [...branchCashiersFromTable, ...branchCashiersFromBindings].forEach(c => {
            if (!branchCashiersMap.has(c.user_id)) {
                branchCashiersMap.set(c.user_id, c);
            }
        });
        const branchCashiers = Array.from(branchCashiersMap.values());
        
        log.info(`[CREATE] 📍 Filialga biriktirilgan kassirlar (birlashtirilgan): ${branchCashiers.length} ta`, branchCashiers.map(c => ({ id: c.user_id, name: c.fullname })));
        
        // 2. Filialning barcha brendlarini topish
        const branchInfo = await db('debt_branches')
            .where('id', state.data.branch_id)
            .select('id', 'name', 'brand_id')
            .first();
        
        let allCashiers = [...branchCashiers];
        
        if (branchInfo) {
            log.info(`[CREATE] 📍 Filial ma'lumotlari: ID=${branchInfo.id}, Name=${branchInfo.name}, BrandId=${branchInfo.brand_id}`);
            
            // Filialning barcha brendlarini topish (bir xil nomdagi barcha filiallarning brendlari)
            const allBrandsInBranch = await db('debt_branches')
                .where('name', branchInfo.name)
                .whereNotNull('brand_id')
                .select('brand_id')
                .distinct();
            
            const branchBrandIds = [...new Set(allBrandsInBranch.map(b => b.brand_id).filter(Boolean))];
            log.info(`[CREATE] 🏷️ Filialning brendlari (${branchInfo.name}): ${branchBrandIds.length} ta`, branchBrandIds);
            
            // 3. Shu brendlarga biriktirilgan kassirlarni topish (debt_user_brands orqali)
            let brandBoundCashiers = [];
            if (branchBrandIds.length > 0) {
                // Brendlarga biriktirilgan kassirlarni to'g'ridan-to'g'ri topish
                const brandBoundCashiersRaw = await db('debt_user_brands')
                    .join('users', 'debt_user_brands.user_id', 'users.id')
                    .whereIn('debt_user_brands.brand_id', branchBrandIds)
                    .whereIn('users.role', ['kassir', 'cashier'])
                    .where('users.status', 'active')
                    .select(
                        'debt_user_brands.user_id',
                        'debt_user_brands.brand_id',
                        'users.telegram_chat_id',
                        'users.fullname',
                        'users.username'
                    )
                    .groupBy('debt_user_brands.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username');
                
                // Dublikatlarni olib tashlash
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
                
                log.info(`[CREATE] 🎯 Brendlarga biriktirilgan kassirlar: ${brandBoundCashiers.length} ta`, brandBoundCashiers.map(c => ({ id: c.user_id, name: c.fullname, reason: c.reason })));
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
            
            allCashiers = Array.from(allCashiersMap.values());
            log.info(`[CREATE] ✅ Jami kassirlar (dublikatsiz): ${allCashiers.length} ta`, allCashiers.map(c => ({ id: c.user_id, name: c.fullname, reason: c.reason })));
        }
        
        // 5. So'rovga birinchi kassirni tayinlash (round-robin uchun)
        const cashier = await assignCashierToRequest(state.data.branch_id, requestId);
        log.info(`[CREATE] 🎯 So'rovga tayinlangan kassir: ${cashier ? `CashierId=${cashier.user_id}` : 'Topilmadi'}`);
        
        // 6. Barcha kassirlarga xabar yuborish
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
        
        let notifiedCashiersCount = 0;
        for (const cashierItem of allCashiers) {
            if (cashierItem.telegram_chat_id) {
                try {
                    const cashierUser = await db('users').where('id', cashierItem.user_id).first();
                    if (cashierUser && fullRequest) {
                        await showRequestToCashier(fullRequest, cashierItem.telegram_chat_id, cashierUser);
                        notifiedCashiersCount++;
                        log.info(`[CREATE] ✅ Kassirga xabar yuborildi: CashierId=${cashierItem.user_id}, Name=${cashierItem.fullname}, Reason=${cashierItem.reason}, ChatId=${cashierItem.telegram_chat_id}`);
                    }
                } catch (notifyError) {
                    log.error(`[CREATE] ❌ Kassirga xabar yuborishda xatolik: CashierId=${cashierItem.user_id}, Error=${notifyError.message}`);
                }
            } else {
                log.warn(`[CREATE] ⚠️ Kassirning telegram_chat_id yo'q: CashierId=${cashierItem.user_id}, Name=${cashierItem.fullname}`);
            }
        }
        
        log.info(`[CREATE] 📊 Xabar yuborish natijasi: Jami=${allCashiers.length} ta, Yuborildi=${notifiedCashiersCount} ta`);
        
        if (allCashiers.length === 0) {
            log.warn(`[CREATE] Filial ${state.data.branch_id} uchun kassir topilmadi. So'rov PENDING_APPROVAL holatida saqlandi.`);
        }
        
        // Audit log
        await logRequestAction(requestId, 'request_created', user.id, {
            new_status: 'PENDING_APPROVAL',
            type: 'NORMAL'
        });
        
        // Eslatma boshlash
        await scheduleReminder(requestId);
        
        log.info(`[CREATE] Oddiy so'rov yaratildi va kassirga yuborildi:`, {
            requestId: requestId,
            requestUID: requestUID,
            type: 'NORMAL',
            brand_id: state.data.brand_id || branch.brand_id,
            branch_id: state.data.branch_id,
            svr_id: state.data.svr_id,
            created_by: user.id,
            cashier_id: cashier ? cashier.user_id : null
        });
        
        await bot.editMessageText(
            `✅ <b>So'rov yuborildi!</b>\n\n` +
            `📝 So'rov ID: ${requestUID}\n` +
            `Xabar kassirga yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
        // State'ni tozalash
        stateManager.clearUserState(userId);
        
    } catch (error) {
        log.error('Hisobotni yuborishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Hisobotni Set (muddat uzaytirish) qilish
 */
async function handleSetReport(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || !state.data) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // State'ni SET_EXTRA_INFO ga o'zgartirish (qo'shimcha ma'lumot kiritish uchun)
        stateManager.updateUserState(userId, STATES.SET_EXTRA_INFO, { 
            ...state.data,
            request_type: 'SET'
        });
        
        await bot.editMessageText(
            `💾 <b>SET (Muddat uzaytirish)</b>\n\n` +
            `📝 Qo'shimcha ma'lumot kiriting:\n` +
            `(masalan: "5 kun muddat uzaytirish", "10 kun kechiktirish" va hokazo)`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'report_cancel' }]]
                },
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('SET bosqichini boshlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * SET so'rov uchun qo'shimcha ma'lumot qabul qilish
 */
async function handleSetExtraInfo(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const extraInfo = msg.text;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SET_EXTRA_INFO) {
            return false;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.SET_PREVIEW, { 
            ...state.data,
            extra_info: extraInfo
        });
        
        // Filial, SVR va brend ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        let brandName = '';
        if (state.data.brand_id) {
            const brand = await db('debt_brands').where('id', state.data.brand_id).first();
            if (brand) {
                brandName = `\n🏢 Brend: ${brand.name}`;
            }
        }
        
        // Preview keyboard
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Yuborish', callback_data: 'report_send_set' },
                    { text: '✏️ Tahrirlash', callback_data: 'report_edit_set' }
                ],
                [
                    { text: '⚠️ Qarzi bor', callback_data: 'report_set_debt_exists' }
                ],
                [
                    { text: '❌ Bekor qilish', callback_data: 'report_cancel' }
                ]
            ]
        };
        
        await bot.sendMessage(
            chatId,
            `📋 <b>SET So'rov - Preview:</b>\n\n` +
            (brandName ? brandName : '') +
            `📍 Filial: ${branch.name}\n` +
            `👤 SVR: ${svr.name}\n` +
            `📝 Asosiy ma'lumot: ${state.data.report_data}\n` +
            `💾 Qo'shimcha ma'lumot: ${extraInfo}\n\n` +
            `Yuborishni tasdiqlang:`,
            {
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
        return true;
        
    } catch (error) {
        log.error('SET qo\'shimcha ma\'lumotni qabul qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
    }
}

/**
 * SET so'rovni yuborish
 */
async function handleSendSetReport(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Yuborilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SET_PREVIEW) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Filial, SVR va brend ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
        
        // O'tgan oy nomini olish
        const oldMonthName = getPreviousMonthName();
        
        // Standartlashtirilgan SET xabar formati
        let messageText = 'Assalomu aleykum\n\n';
        
        if (brand) {
            messageText += `Brend: ${brand.name}\n\n`;
        }
        
        messageText += `${branch.name} filial supervayzeri ${svr.name} ${oldMonthName} oyi qarzlarini yopdi.\n`;
        messageText += `Tekshirib chiqib tugri bulsa, konsignatsiyasini ochtirib bersangiz.\n\n`;
        
        // Excel ma'lumotlari mavjud bo'lsa, qo'shish
        if (state.data.excel_data && state.data.excel_data.length > 0) {
            const { formatExcelData, calculateTotalFromExcel } = require('../../../utils/excelParser.js');
            // Headers va columns ni to'g'ri olish (agar JSON string bo'lsa, parse qilish)
            let headers = state.data.excel_headers || [];
            let columns = state.data.excel_columns || {};
            
            // Agar headers string bo'lsa, parse qilish
            if (typeof headers === 'string') {
                try {
                    headers = JSON.parse(headers);
                } catch (e) {
                    log.warn('[CREATE] Headers parse qilishda xatolik:', e);
                    headers = [];
                }
            }
            
            // Agar columns string bo'lsa, parse qilish
            if (typeof columns === 'string') {
                try {
                    columns = JSON.parse(columns);
                } catch (e) {
                    log.warn('[CREATE] Columns parse qilishda xatolik:', e);
                    columns = {};
                }
            }
            
            const formattedData = formatExcelData(state.data.excel_data, columns, headers);
            
            // Excel total ni tekshirish va qo'shish
            let excelTotal = state.data.excel_total;
            if (excelTotal === null || excelTotal === undefined || excelTotal === 0) {
                excelTotal = calculateTotalFromExcel(state.data.excel_data, columns, headers);
            }
            
            // Formatlangan ma'lumotlarni qo'shish, lekin TOTAL ni yangilash
            const formattedLines = formattedData.split('\n');
            const totalLineIndex = formattedLines.findIndex(line => line.startsWith('TOTAL:'));
            if (totalLineIndex !== -1) {
                formattedLines[totalLineIndex] = `TOTAL: ${excelTotal.toLocaleString('ru-RU')}`;
            } else {
                formattedLines.push(`TOTAL: ${excelTotal.toLocaleString('ru-RU')}`);
            }
            messageText += `\n\n${formattedLines.join('\n')}`;
        }
        
        // Raxbarlar guruhiga yuborish uchun keyboard
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash', callback_data: 'leader_approve' }],
                [{ text: '❌ Bekor qilish', callback_data: 'leader_cancel' }],
                [{ text: '⚠️ Qarzi bor', callback_data: 'leader_debt_exists' }]
            ]
        };
        
        // So'rovni database'ga yozish
        const { generateRequestUID } = require('../../../utils/requestIdGenerator.js');
        const { logRequestAction } = require('../../../utils/auditLogger.js');
        const { scheduleReminder } = require('../../../utils/debtReminder.js');
        const { formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
        const { showSetRequestToLeaders } = require('../../debt-approval/handlers/leader.js');
        
        const requestUID = generateRequestUID();
        
        // Excel ma'lumotlarini JSON formatiga o'tkazish (agar array/object bo'lsa)
        const excelHeaders = state.data.excel_headers 
            ? (Array.isArray(state.data.excel_headers) ? JSON.stringify(state.data.excel_headers) : state.data.excel_headers)
            : null;
        const excelColumns = state.data.excel_columns 
            ? (typeof state.data.excel_columns === 'object' ? JSON.stringify(state.data.excel_columns) : state.data.excel_columns)
            : null;
        const excelData = state.data.excel_data 
            ? (Array.isArray(state.data.excel_data) ? JSON.stringify(state.data.excel_data) : state.data.excel_data)
            : null;
        
        const [requestId] = await db('debt_requests').insert({
            request_uid: requestUID,
            type: 'SET',
            brand_id: state.data.brand_id || branch.brand_id,
            branch_id: state.data.branch_id,
            svr_id: state.data.svr_id,
            status: 'SET_PENDING',
            created_by: user.id,
            extra_info: state.data.extra_info || null,
            excel_file_path: state.data.excel_file_path || null,
            excel_data: excelData,
            excel_headers: excelHeaders,
            excel_columns: excelColumns,
            excel_total: state.data.excel_total || null
        });
        
        // Rahbarlar guruhiga xabar yuborish
        const leadersGroup = await db('debt_groups')
            .where('group_type', 'leaders')
            .where('is_active', true)
            .first();
        
        if (leadersGroup) {
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
            
            await showSetRequestToLeaders(fullRequest, leadersGroup.telegram_group_id);
        }
        
        // Audit log
        await logRequestAction(requestId, 'request_created', user.id, {
            new_status: 'SET_PENDING',
            type: 'SET'
        });
        
        // Eslatma boshlash
        await scheduleReminder(requestId);
        
        log.info(`[CREATE] SET so'rov yaratildi va raxbarlar guruhiga yuborildi:`, {
            requestId: requestId,
            requestUID: requestUID,
            type: 'SET',
            brand_id: state.data.brand_id || branch.brand_id,
            branch_id: state.data.branch_id,
            svr_id: state.data.svr_id,
            created_by: user.id,
            extra_info: state.data.extra_info,
            has_excel: !!(state.data.excel_data && state.data.excel_data.length > 0)
        });
        
        // Jarayon statuslarini ko'rsatish
        const approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
            `1️⃣ <b>Rahbarlar guruhi</b> - <code>jarayonda</code>\n` +
            `2️⃣ <b>Kassir</b> - <code>kutilyabdi</code>\n` +
            `3️⃣ <b>Operator</b> - <code>kutilyabdi</code>\n` +
            `4️⃣ <b>Final guruh</b> - <code>kutilyabdi</code>`;
        
        const sentMessage = await bot.editMessageText(
            `✅ <b>SET So'rov yuborildi!</b>\n\n` +
            `📝 <b>ID:</b> ${requestUID}\n` +
            `📋 <b>Turi:</b> SET (Muddat uzaytirish)\n` +
            approvalFlow +
            `\n\nXabar raxbarlar guruhiga yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
        // preview_message_id ni saqlash (keyinroq real-time yangilash uchun)
        // MUHIM: sentMessage.message_id dan foydalanish (xabar yangilanganidan keyin)
        if (requestId && sentMessage) {
            try {
                // sentMessage.message_id yoki query.message.message_id (ikkalasi ham bir xil bo'lishi kerak)
                const messageId = sentMessage.message_id || query.message.message_id;
                await db('debt_requests')
                    .where('id', requestId)
                    .update({
                        preview_message_id: messageId,
                        preview_chat_id: chatId
                    });
                log.info(`[SEND_SET] ✅ preview_message_id saqlandi: messageId=${messageId}, chatId=${chatId}, requestId=${requestId}`);
            } catch (error) {
                log.warn(`[SEND_SET] ⚠️ preview_message_id saqlashda xatolik: ${error.message}`);
            }
        }
        
        // State'ni tozalash
        stateManager.clearUserState(userId);
        
    } catch (error) {
        log.error('SET so\'rovni yuborishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Hisobotni bekor qilish
 */
async function handleCancelReport(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        stateManager.clearUserState(userId);
        
        await bot.editMessageText(
            '❌ Hisobot yaratish bekor qilindi.',
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
    } catch (error) {
        log.error('Hisobotni bekor qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel preview ko'rsatish
 */
async function showExcelPreview(chatId, userId, bot, parsed) {
    try {
        const state = stateManager.getUserState(userId);
        if (!state || !state.data) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // Filial, SVR va brend ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
        
        // O'tgan oy nomini olish
        const oldMonthName = getPreviousMonthName();
        
        // Xabar matni
        let messageText = 'Assalomu aleykum\n\n';
        
        if (brand) {
            messageText += `Brend: ${brand.name}\n\n`;
        }
        
        messageText += `${branch.name} filial supervayzeri ${svr.name} ${oldMonthName} oyi qarzlarini yopdi.\n`;
        
        if (state.data.request_type === 'SET') {
            messageText += `Tekshirib chiqib tugri bulsa, konsignatsiyasini ochtirib bersangiz.\n\n`;
        } else {
            messageText += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz\n\n`;
        }
        
        // Excel ma'lumotlari
        messageText += parsed.formatted;
        
        // Keyboard
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash', callback_data: 'report_confirm_excel' }],
                [{ text: '✏️ Tahrirlash', callback_data: 'report_edit_excel' }],
                [{ text: '❌ Bekor qilish', callback_data: 'report_cancel' }]
            ]
        };
        
        await bot.sendMessage(
            chatId,
            `📋 <b>Excel ma'lumotlari preview:</b>\n\n` +
            `<code>${messageText}</code>`,
            {
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
    } catch (error) {
        log.error('[PREVIEW] Preview ko\'rsatishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Preview ko\'rsatishda xatolik yuz berdi.');
    }
}

/**
 * Ustun nomlarini tanlash
 */
async function handleColumnSelection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_COLUMNS) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const headers = state.data.excel_headers || [];
        
        if (headers.length === 0) {
            await bot.sendMessage(chatId, '❌ Ustunlar topilmadi.');
            return;
        }
        
        // Ustunlarni ro'yxat sifatida ko'rsatish
        let messageText = '📋 <b>Ustunlarni tanlang:</b>\n\n';
        messageText += '<b>Majburiy ustunlar:</b>\n';
        messageText += '1️⃣ ID ustuni\n';
        messageText += '2️⃣ Name ustuni\n';
        messageText += '3️⃣ Summa ustuni\n\n';
        messageText += '<b>Ixtiyoriy ustunlar (moslik tekshiruvi uchun):</b>\n';
        messageText += '4️⃣ SVR ustuni\n';
        messageText += '5️⃣ Brend ustuni\n\n';
        messageText += '<b>Mavjud ustunlar:</b>\n';
        
        headers.forEach((header, index) => {
            messageText += `${index + 1}. ${header || `Ustun ${index + 1}`}\n`;
        });
        
        // Keyboard yaratish
        const keyboardRows = [];
        
        // Majburiy ustunlar
        keyboardRows.push([
            { text: '1️⃣ ID', callback_data: `report_select_column:id` },
            { text: '2️⃣ Name', callback_data: `report_select_column:name` },
            { text: '3️⃣ Summa', callback_data: `report_select_column:summa` }
        ]);
        
        // Ixtiyoriy ustunlar
        keyboardRows.push([
            { text: '4️⃣ SVR (ixtiyoriy)', callback_data: `report_select_column:svr` },
            { text: '5️⃣ Brend (ixtiyoriy)', callback_data: `report_select_column:brand` }
        ]);
        
        keyboardRows.push([{ text: '✅ Tasdiqlash', callback_data: 'report_confirm_columns' }]);
        keyboardRows.push([{ text: '❌ Bekor qilish', callback_data: 'report_cancel' }]);
        
        await bot.sendMessage(
            chatId,
            messageText,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: keyboardRows
                }
            }
        );
        
    } catch (error) {
        log.error('[COLUMN_SELECT] Ustun tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bitta ustunni tanlash
 */
async function handleSelectSingleColumn(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        const columnType = query.data.split(':')[1]; // id, name, summa, svr, brand
        await bot.answerCallbackQuery(query.id, { text: `Ustun tanlash: ${columnType}` });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_COLUMNS) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const headers = state.data.excel_headers || [];
        const selectedColumns = state.data.excel_selected_columns || {};
        
        // Ustunlarni ro'yxat sifatida ko'rsatish
        let messageText = `📋 <b>${columnType.toUpperCase()} ustunini tanlang:</b>\n\n`;
        
        headers.forEach((header, index) => {
            const isSelected = selectedColumns[columnType] === index;
            messageText += `${isSelected ? '✅' : '⚪'} ${index + 1}. ${header || `Ustun ${index + 1}`}\n`;
        });
        
        // Keyboard yaratish
        const keyboardRows = [];
        const row = [];
        
        headers.forEach((header, index) => {
            const isSelected = selectedColumns[columnType] === index;
            row.push({
                text: `${isSelected ? '✅' : ''} ${index + 1}`,
                callback_data: `report_select_column_value:${columnType}:${index}`
            });
            
            if (row.length === 3) {
                keyboardRows.push([...row]);
                row.length = 0;
            }
        });
        
        if (row.length > 0) {
            keyboardRows.push(row);
        }
        
        keyboardRows.push([{ text: '⬅️ Orqaga', callback_data: 'report_select_columns' }]);
        
        await bot.editMessageText(
            messageText,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: keyboardRows
                }
            }
        );
        
    } catch (error) {
        log.error('[COLUMN_SELECT] Ustun tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Ustun qiymatini tanlash
 */
async function handleSelectColumnValue(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        const [, columnType, columnIndex] = query.data.split(':');
        await bot.answerCallbackQuery(query.id, { text: 'Tanlandi' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_COLUMNS) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const selectedColumns = state.data.excel_selected_columns || {};
        selectedColumns[columnType] = parseInt(columnIndex);
        
        stateManager.updateUserState(userId, STATES.SELECT_COLUMNS, {
            ...state.data,
            excel_selected_columns: selectedColumns
        });
        
        // Orqaga qaytish
        await handleColumnSelection(query, bot);
        
    } catch (error) {
        log.error('[COLUMN_VALUE] Ustun qiymati tanlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Ustunlarni tasdiqlash va Excel faylni qayta ishlash
 */
async function handleConfirmColumns(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tekshirilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.SELECT_COLUMNS) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const selectedColumns = state.data.excel_selected_columns || {};
        
        // Majburiy ustunlarni tekshirish
        if (selectedColumns.id === undefined || selectedColumns.name === undefined || selectedColumns.summa === undefined) {
            await bot.sendMessage(
                chatId,
                '❌ Barcha majburiy ustunlar tanlanishi kerak:\n' +
                '- ID ustuni\n' +
                '- Name ustuni\n' +
                '- Summa ustuni'
            );
            return;
        }
        
        // Ustunlar obyektini yaratish
        const columns = {
            id: selectedColumns.id,
            name: selectedColumns.name,
            summa: selectedColumns.summa,
            svr: selectedColumns.svr !== undefined ? selectedColumns.svr : null,
            brand: selectedColumns.brand !== undefined ? selectedColumns.brand : null
        };
        
        // So'rov ma'lumotlarini olish
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
        
        const requestData = {
            svr_name: svr ? svr.name : null,
            brand_name: brand ? brand.name : null
        };
        
        // Ma'lumotlarni filtrlash
        const { validateAndFilterRows, formatExcelData } = require('../../../utils/excelParser.js');
        const headers = state.data.excel_headers || [];
        const validationResult = validateAndFilterRows(state.data.excel_raw_data, columns, requestData, headers);
        const filteredData = validationResult.filtered;
        const stats = validationResult.stats;
        
        if (filteredData.length === 0) {
            let errorMessage = '⚠️ <b>Tanlangan ustunlar bo\'yicha mos qatorlar topilmadi!</b>\n\n';
            errorMessage += '<b>So\'rov ma\'lumotlari:</b>\n';
            errorMessage += (requestData.svr_name ? `👤 SVR: <code>${requestData.svr_name}</code>\n` : '');
            errorMessage += (requestData.brand_name ? `🏢 Brend: <code>${requestData.brand_name}</code>\n` : '');
            errorMessage += `📍 Filial: ${branch ? branch.name : 'N/A'}\n\n`;
            
            if (stats.svrMismatches && stats.svrMismatches.length > 0) {
                errorMessage += `❌ Excel faylda "${requestData.svr_name}" SVR topilmadi\n`;
                errorMessage += `   Topilgan: ${stats.svrMismatches.slice(0, 3).join(', ')}\n\n`;
            }
            
            if (stats.brandMismatches && stats.brandMismatches.length > 0) {
                errorMessage += `❌ Excel faylda "${requestData.brand_name}" Brend topilmadi\n`;
                errorMessage += `   Topilgan: ${stats.brandMismatches.slice(0, 3).join(', ')}\n\n`;
            }
            
            errorMessage += '💡 Iltimos, ustunlarni qayta tanlang yoki Excel fayl ma\'lumotlarini tekshiring.';
            
            await bot.sendMessage(
                chatId,
                errorMessage,
                {
                    parse_mode: 'HTML'
                }
            );
            return;
        }
        
        // Jami summani hisoblash
        const total = filteredData.reduce((sum, row) => {
            const summa = row[columns.summa] ? parseFloat(String(row[columns.summa]).replace(/\s/g, '')) : 0;
            return sum + summa;
        }, 0);
        
        // Formatlash
        const formatted = formatExcelData(filteredData, columns, headers);
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.EXCEL_PREVIEW, {
            ...state.data,
            excel_headers: headers, // Headers qo'shildi
            excel_columns: columns,
            excel_data: filteredData,
            excel_total: total,
            excel_formatted: formatted
        });
        
        // Preview ko'rsatish
        const parsed = {
            filteredData,
            columns,
            total,
            formatted
        };
        
        await showExcelPreview(chatId, userId, bot, parsed);
        
    } catch (error) {
        log.error('[CONFIRM_COLUMNS] Ustunlarni tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel ma'lumotlarini tasdiqlash va so'rovga qo'shish
 */
async function handleConfirmExcel(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.EXCEL_PREVIEW) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // Excel ma'lumotlari state'da saqlanadi, endi so'rovga qo'shiladi
        // State'ni SET_PREVIEW yoki ENTER_REPORT_DATA ga o'zgartirish
        if (state.data.request_type === 'SET') {
            stateManager.updateUserState(userId, STATES.SET_PREVIEW, {
                ...state.data
            });
        } else {
            stateManager.updateUserState(userId, STATES.ENTER_REPORT_DATA, {
                ...state.data
            });
        }
        
        // Excel total ni tekshirish va hisoblash
        let excelTotal = state.data.excel_total;
        if (!excelTotal && state.data.excel_data && state.data.excel_data.length > 0) {
            // Agar excel_total bo'sh bo'lsa, qayta hisoblash
            const { formatExcelData } = require('../../../utils/excelParser.js');
            const headers = state.data.excel_headers || [];
            const columns = state.data.excel_columns || {};
            
            // Jami summani hisoblash
            const summaHeader = headers[columns.summa] || '';
            excelTotal = state.data.excel_data.reduce((sum, row) => {
                const summaValue = row[summaHeader];
                const summa = summaValue !== undefined && summaValue !== null 
                    ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.')) 
                    : 0;
                return sum + (isNaN(summa) ? 0 : summa);
            }, 0);
            
            // State'ni yangilash
            stateManager.updateUserState(userId, state.state, {
                ...state.data,
                excel_total: excelTotal
            });
        }
        
        // Keyboard yaratish - SET so'rovlar uchun report_send_set, oddiy so'rovlar uchun report_send
        const requestType = state.data.request_type || 'NORMAL';
        const sendCallback = requestType === 'SET' ? 'report_send_set' : 'report_send';
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Yuborish', callback_data: sendCallback }
                ],
                [
                    { text: '❌ Bekor qilish', callback_data: 'report_cancel' }
                ]
            ]
        };
        
        await bot.editMessageText(
            `✅ <b>Excel ma'lumotlari tasdiqlandi!</b>\n\n` +
            `📊 ${state.data.excel_data ? state.data.excel_data.length : 0} ta qator\n` +
            `💰 Jami: ${(excelTotal || 0).toLocaleString('ru-RU')}\n\n` +
            `So'rovni yuborish uchun "Yuborish" tugmasini bosing.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
    } catch (error) {
        log.error('[CONFIRM_EXCEL] Excel ma\'lumotlarini tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel ma'lumotlarini tahrirlash (qayta yuklash)
 */
async function handleEditExcel(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || state.state !== STATES.EXCEL_PREVIEW) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // State'ni UPLOAD_EXCEL ga o'zgartirish
        stateManager.updateUserState(userId, STATES.UPLOAD_EXCEL, {
            ...state.data,
            excel_file: null,
            excel_data: null,
            excel_columns: null,
            excel_total: null,
            excel_formatted: null
        });
        
        await bot.editMessageText(
            `📎 <b>Yangi Excel fayl yuboring</b>\n\n` +
            `Iltimos, Excel faylni yuboring (.xlsx yoki .xls formatida).`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('[EDIT_EXCEL] Excel ma\'lumotlarini tahrirlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * "Qarzi bor" tugmasi bosilganda (oddiy so'rov)
 */
async function handleDebtExists(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // State'ni UPLOAD_EXCEL ga o'zgartirish
        stateManager.updateUserState(userId, STATES.UPLOAD_EXCEL, {
            ...state.data,
            request_type: 'NORMAL'
        });
        
        await bot.editMessageText(
            `📎 <b>Excel fayl yuboring</b>\n\n` +
            `Qarzdorlik ma'lumotlarini Excel fayl formatida yuboring.\n\n` +
            `Fayl formati:\n` +
            `- ID ustuni (Ид клиента, ID, Client ID)\n` +
            `- Name ustuni (Клиент, Client, Name)\n` +
            `- Summa ustuni (Общий, Total, Summa)\n` +
            `- (Ixtiyoriy) SVR ustuni (Супервайзер, Supervisor)\n` +
            `- (Ixtiyoriy) Brend ustuni (Направление торговли, Brand)\n\n` +
            `Iltimos, Excel faylni yuboring (.xlsx yoki .xls formatida).`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('[DEBT_EXISTS] "Qarzi bor" tugmasida xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * "Qarzi bor" tugmasi bosilganda (SET so'rov)
 */
async function handleSetDebtExists(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // State'ni UPLOAD_EXCEL ga o'zgartirish
        stateManager.updateUserState(userId, STATES.UPLOAD_EXCEL, {
            ...state.data,
            request_type: 'SET'
        });
        
        await bot.editMessageText(
            `📎 <b>Excel fayl yuboring</b>\n\n` +
            `Qarzdorlik ma'lumotlarini Excel fayl formatida yuboring.\n\n` +
            `Fayl formati:\n` +
            `- ID ustuni (Ид клиента, ID, Client ID)\n` +
            `- Name ustuni (Клиент, Client, Name)\n` +
            `- Summa ustuni (Общий, Total, Summa)\n` +
            `- (Ixtiyoriy) SVR ustuni (Супервайзер, Supervisor)\n` +
            `- (Ixtiyoriy) Brend ustuni (Направление торговли, Brand)\n\n` +
            `Iltimos, Excel faylni yuboring (.xlsx yoki .xls formatida).`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        log.error('[SET_DEBT_EXISTS] "Qarzi bor" tugmasida xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel fayl qabul qilish
 */
async function handleExcelFile(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        let state = stateManager.getUserState(userId);
        // Excel fayl qabul qilish UPLOAD_EXCEL yoki enter_report_data state'ida bo'lishi mumkin
        if (!state || state.context !== stateManager.CONTEXTS.HISOBOT || 
            (state.state !== STATES.UPLOAD_EXCEL && state.state !== STATES.ENTER_REPORT_DATA)) {
            return false;
        }
        
        // Agar enter_report_data state'ida bo'lsa, state'ni UPLOAD_EXCEL ga o'zgartirish
        if (state.state === STATES.ENTER_REPORT_DATA) {
            stateManager.updateUserState(userId, STATES.UPLOAD_EXCEL, {
                ...state.data
            });
            // State'ni yangilash
            state = stateManager.getUserState(userId);
        }
        
        if (!msg.document) {
            await bot.sendMessage(chatId, '❌ Excel fayl yuborilmadi. Iltimos, Excel fayl yuboring.');
            return true;
        }
        
        // Excel fayl ekanligini tekshirish
        const fileName = msg.document.file_name || '';
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || 
                       msg.document.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                       msg.document.mime_type === 'application/vnd.ms-excel';
        
        if (!isExcel) {
            await bot.sendMessage(chatId, '❌ Faqat Excel fayllar (.xlsx, .xls) qabul qilinadi.');
            return true;
        }
        
        log.info(`[EXCEL] Excel fayl qabul qilindi: ${fileName}, UserId: ${userId}`);
        
        const fileId = msg.document.file_id;
        const file = await bot.getFile(fileId);
        
        // Faylni yuklab olish
        const uploadsDir = path.join(__dirname, '../../../uploads/debt-approval');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Fayl nomini tozalash (maxsus belgilarni olib tashlash)
        // Windows fayl tizimida qo'llab-quvvatlanmaydigan belgilar: < > : " / \ | ? *
        const sanitizedFileName = fileName
            .replace(/[<>:"/\\|?*]/g, '_') // Maxsus belgilarni almashtirish
            .replace(/\s+/g, '_') // Bo'shliqlarni underscore bilan almashtirish
            .replace(/_{2,}/g, '_') // Ko'p underscore'larni bittaga qisqartirish
            .trim();
        
        // Fayl yo'lini yaratish
        const timestamp = Date.now();
        const filePath = path.join(uploadsDir, `${timestamp}_${sanitizedFileName}`);
        
        log.debug(`[EXCEL] Fayl yo'li: ${filePath}`);
        
        // Faylni yuklab olish (bot.downloadFile o'rniga to'g'ridan-to'g'ri HTTP)
        try {
            const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
            const https = require('https');
            const http = require('http');
            
            await new Promise((resolve, reject) => {
                const protocol = fileUrl.startsWith('https') ? https : http;
                const fileStream = fs.createWriteStream(filePath);
                
                const request = protocol.get(fileUrl, (response) => {
                    if (response.statusCode !== 200) {
                        fileStream.close();
                        fs.unlinkSync(filePath);
                        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                        return;
                    }
                    response.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                });
                
                request.on('error', (error) => {
                    fileStream.close();
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    reject(error);
                });
                
                fileStream.on('error', (error) => {
                    fileStream.close();
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    reject(error);
                });
            });
        } catch (downloadError) {
            log.error(`[EXCEL] Faylni yuklab olishda xatolik: ${downloadError.message}`);
            throw downloadError;
        }
        
        log.debug(`[EXCEL] Fayl yuklandi: ${filePath}`);
        
        // So'rov ma'lumotlarini olish (moslik tekshiruvi uchun)
        const branch = await db('debt_branches').where('id', state.data.branch_id).first();
        const svr = await db('debt_svrs').where('id', state.data.svr_id).first();
        const brand = state.data.brand_id ? await db('debt_brands').where('id', state.data.brand_id).first() : null;
        
        const requestData = {
            svr_name: svr ? svr.name : null,
            brand_name: brand ? brand.name : null
        };
        
        // Excel faylni tahlil qilish
        const parsed = await parseExcelFile(filePath, requestData);
        
        // Ustunlar to'liq aniqlanganligini tekshirish
        if (parsed.columns.id === null || parsed.columns.name === null || parsed.columns.summa === null) {
            // Ustun nomlarini tanlash kerak
            log.info(`[EXCEL] Ustunlar to'liq aniqlanmadi, foydalanuvchidan tanlash so'raladi`);
            stateManager.updateUserState(userId, STATES.SELECT_COLUMNS, {
                ...state.data,
                excel_file: filePath,
                excel_headers: parsed.headers,
                excel_raw_data: parsed.data
            });
            
            await bot.sendMessage(
                chatId,
                '📋 Excel faylda kerakli ustunlar avtomatik aniqlanmadi.\n\n' +
                'Iltimos, quyidagi ustunlarni tanlang:',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔍 Ustunlarni tanlash', callback_data: 'report_select_columns' }],
                            [{ text: '❌ Bekor qilish', callback_data: 'report_cancel' }]
                        ]
                    }
                }
            );
            return true;
        }
        
        // Agar mos qatorlar topilmasa
        if (parsed.filteredData.length === 0) {
            // Qaysi shartlar to'g'ri kelmasligini aniqlash
            let mismatchDetails = [];
            const stats = parsed.validationStats || {};
            
            if (parsed.columns.svr !== null && requestData.svr_name) {
                // SVR ustuni mavjud, lekin mos qatorlar topilmadi
                if (stats.svrMismatches && stats.svrMismatches.length > 0) {
                    mismatchDetails.push(`❌ SVR: Excel faylda "${requestData.svr_name}" topilmadi`);
                    mismatchDetails.push(`   Topilgan SVR'lar: ${stats.svrMismatches.slice(0, 5).join(', ')}${stats.svrMismatches.length > 5 ? '...' : ''}`);
                } else {
                    mismatchDetails.push(`❌ SVR: Excel faylda "${requestData.svr_name}" topilmadi`);
                }
            }
            
            if (parsed.columns.brand !== null && requestData.brand_name) {
                // Brend ustuni mavjud, lekin mos qatorlar topilmadi
                if (stats.brandMismatches && stats.brandMismatches.length > 0) {
                    mismatchDetails.push(`❌ Brend: Excel faylda "${requestData.brand_name}" topilmadi`);
                    mismatchDetails.push(`   Topilgan Brendlar: ${stats.brandMismatches.slice(0, 5).join(', ')}${stats.brandMismatches.length > 5 ? '...' : ''}`);
                } else {
                    mismatchDetails.push(`❌ Brend: Excel faylda "${requestData.brand_name}" topilmadi`);
                }
            }
            
            let errorMessage = '⚠️ <b>Excel faylda mos qatorlar topilmadi!</b>\n\n';
            errorMessage += '<b>So\'rov ma\'lumotlari:</b>\n';
            errorMessage += (requestData.svr_name ? `👤 SVR: <code>${requestData.svr_name}</code>\n` : '');
            errorMessage += (requestData.brand_name ? `🏢 Brend: <code>${requestData.brand_name}</code>\n` : '');
            errorMessage += `📍 Filial: ${branch ? branch.name : 'N/A'}\n\n`;
            
            if (mismatchDetails.length > 0) {
                errorMessage += '<b>Muammo:</b>\n';
                errorMessage += mismatchDetails.join('\n') + '\n\n';
            }
            
            errorMessage += '💡 <b>Yechim:</b>\n';
            errorMessage += '1. Excel faylda SVR va Brend ustunlarini tekshiring\n';
            errorMessage += '2. Ustun nomlari va qiymatlari to\'g\'ri ekanligini tekshiring\n';
            errorMessage += '3. Ma\'lumotlar so\'rov ma\'lumotlari bilan mos kelishini tekshiring\n';
            errorMessage += '4. Agar kerak bo\'lsa, yangi Excel fayl yuboring';
            
            await bot.sendMessage(
                chatId,
                errorMessage,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Qayta yuborish', callback_data: 'report_edit_excel' }],
                            [{ text: '❌ Bekor qilish', callback_data: 'report_cancel' }]
                        ]
                    }
                }
            );
            
            // Faylni o'chirish
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (unlinkError) {
                log.warn(`[EXCEL] Faylni o'chirishda xatolik: ${unlinkError.message}`);
            }
            
            return true;
        }
        
        // Preview ko'rsatish
        stateManager.updateUserState(userId, STATES.EXCEL_PREVIEW, {
            ...state.data,
            excel_file_path: filePath,
            excel_file: filePath,
            excel_data: parsed.filteredData,
            excel_headers: parsed.headers, // Headers qo'shildi
            excel_columns: parsed.columns,
            excel_total: parsed.total,
            excel_formatted: parsed.formatted
        });
        
        await showExcelPreview(chatId, userId, bot, parsed);
        
        return true;
        
    } catch (error) {
        log.error('[EXCEL] Excel fayl qabul qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Excel faylni o\'qishda xatolik yuz berdi. Iltimos, fayl formati to\'g\'ri ekanligini tekshiring.');
        return true;
    }
}

module.exports = {
    handleCreateReport,
    handleBrandSelection,
    handleBranchSelection,
    handleSVRSelection,
    handleReportData,
    handleSetExtraInfo,
    handleSendReport,
    handleSendSetReport,
    handleSetReport,
    handleCancelReport,
    handleExcelFile,
    handleColumnSelection,
    handleSelectSingleColumn,
    handleSelectColumnValue,
    handleConfirmColumns,
    handleConfirmExcel,
    handleEditExcel,
    handleDebtExists,
    handleSetDebtExists,
    showExcelPreview
};

