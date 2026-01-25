// bot/debt-approval/handlers/index.js

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const { getBot } = require('../../../utils/bot.js');
const userHelper = require('../../unified/userHelper.js');
const stateManager = require('../../unified/stateManager.js');
const managerHandlers = require('./manager.js');
const approvalHandlers = require('./approval.js');
const debtHandlers = require('./debt.js');
const registrationHandlers = require('./registration.js');

const log = createLogger('DEBT_BOT');

// Handle callback queries
async function handleDebtApprovalCallback(query, bot) {
    const { data } = query;
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    if (!data) {
        return false;
    }
    
    try {
        // Handler modullarni yuklash (barcha callback'lar uchun)
        const cashierHandlers = require('./cashier.js');
        const operatorHandlers = require('./operator.js');
        const leaderHandlers = require('./leader.js');
        const supervisorHandlers = require('./supervisor.js');
        // Bloklash faqat WEB orqali qilinadi (bot callback'lari olib tashlandi)
        
        // Reminder handlers (avval tekshirish)
        const reminderHandlers = require('./reminder.js');
        if (data.startsWith('reminder_show_next_')) {
            const parts = data.split('_');
            if (parts.length >= 4) {
                const role = parts[3]; // cashier, operator, leader
                await reminderHandlers.handleShowNextReminder(query, bot, 'user', role);
                return true;
            }
        }
        if (data.startsWith('reminder_show_all_')) {
            const parts = data.split('_');
            if (parts.length >= 4) {
                const groupType = parts[3]; // leaders, operators
                await reminderHandlers.handleShowAllReminders(query, bot, groupType);
                return true;
            }
        }
        
        // Show pending requests handler (cashier, operator, leader, supervisor uchun)
        if (data.startsWith('show_pending_requests_')) {
            const parts = data.split('_');
            if (parts.length >= 4) {
                const role = parts[3]; // cashier, operator, leader, supervisor
                if (role === 'cashier') {
                    await cashierHandlers.handleShowPendingRequests(query, bot);
                    return true;
                } else if (role === 'operator') {
                    await operatorHandlers.handleShowPendingRequests(query, bot);
                    return true;
                } else if (role === 'leader') {
                    await leaderHandlers.handleShowPendingRequests(query, bot);
                    return true;
                } else if (role === 'supervisor') {
                    await supervisorHandlers.handleShowPendingRequests(query, bot);
                    return true;
                }
            }
        }
        
        // Supervisor handlers (avval tekshirish)
        if (data.startsWith('supervisor_approve_')) {
            await supervisorHandlers.handleSupervisorApproval(query, bot);
            return true;
        }
        if (data.startsWith('supervisor_debt_')) {
            // TODO: Supervisor debt handler
            await bot.answerCallbackQuery(query.id, { text: 'Qarzdorlik funksiyasi tez orada qo\'shiladi' });
            return true;
        }
        
        // Cashier handlers (avval tekshirish, chunki ular debt_ bilan boshlanmaydi)
        if (data.startsWith('cashier_approve_')) {
            await cashierHandlers.handleCashierApproval(query, bot);
            return true;
        }
        if (data.startsWith('cashier_debt_')) {
            const parts = data.split('_');
            if (parts.length >= 4) {
                const subType = parts[2]; // total, agent, excel
                if (subType === 'total') {
                    await cashierHandlers.handleCashierDebtTotal(query, bot);
                    return true;
                } else if (subType === 'agent') {
                    await cashierHandlers.handleCashierDebtAgent(query, bot);
                    return true;
                } else if (subType === 'excel') {
                    await cashierHandlers.handleCashierDebtExcel(query, bot);
                    return true;
                }
            }
            // Eski format (faqat cashier_debt_)
            await cashierHandlers.handleCashierDebt(query, bot);
            return true;
        }
        // Agent nomini nusxalash - o'chirildi (rejada yo'q)
        
        // Operator handlers
        if (data.startsWith('operator_approve_')) {
            await operatorHandlers.handleOperatorApproval(query, bot);
            return true;
        }
        if (data.startsWith('operator_debt_')) {
            await operatorHandlers.handleOperatorDebt(query, bot);
            return true;
        }
        
        // Leader handlers
        if (data.startsWith('show_debt_list_')) {
            await leaderHandlers.handleShowDebtList(query, bot);
            return true;
        }
        if (data.startsWith('leader_approve_')) {
            await leaderHandlers.handleLeaderApproval(query, bot);
            return true;
        }
        if (data.startsWith('leader_reject_')) {
            if (data.includes('_cancel_')) {
                // ✅ Bekor qilish sababsiz (ixtiyoriy)
                const requestId = parseInt(data.split('_').pop());
                const userId = query.from.id;
                const chatId = query.message.chat.id;
                
                try {
                await bot.answerCallbackQuery(query.id);
                    
                    const user = await userHelper.getUserByTelegram(chatId, userId);
                    if (!user) {
                        return true;
                    }
                    
                    // So'rovni olish
                    const request = await db('debt_requests')
                        .where('id', requestId)
                        .where('type', 'SET')
                        .where('status', 'SET_PENDING')
                        .first();
                    
                    if (!request) {
                        await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki allaqachon tasdiqlangan.');
                        return true;
                    }
                    
                    // So'rovni bloklash
                    await db('debt_requests')
                        .where('id', requestId)
                        .update({
                            locked: true,
                            locked_by: user.id,
                            locked_at: db.fn.now()
                        });
                    
                    // Bekor qilishni log qilish (sababsiz)
                    const { logApproval, logRequestAction } = require('../../../utils/auditLogger.js');
                    await logApproval(requestId, user.id, 'leader', 'rejected', {
                        note: 'Sabab kiritilmadi'
                    });
                    await logRequestAction(requestId, 'leader_rejected', user.id, {
                        new_status: 'REJECTED',
                        note: 'Sabab kiritilmadi'
                    });
                    
                    // Status yangilash
                    await db('debt_requests')
                        .where('id', requestId)
                        .update({
                            status: 'REJECTED',
                            locked: false,
                            locked_by: null,
                            locked_at: null
                        });
                    
                    // ✅ MUHIM: Status yangilanganidan keyin request'ni qayta olish
                    const updatedRequest = await db('debt_requests')
                        .where('id', requestId)
                        .first();
                    
                    // Xabarni yangilash
                    const { formatRejectionMessage } = require('../../../utils/messageTemplates.js');
                    const rejectionMessage = formatRejectionMessage({
                        request_uid: request.request_uid,
                        username: user.username,
                        fullname: user.fullname,
                        reason: 'Sabab kiritilmadi',
                        timestamp: new Date().toISOString()
                    });
                    
                    // Guruhdagi xabarni yangilash
                    const leadersGroup = await db('debt_groups')
                        .where('group_type', 'leaders')
                        .where('is_active', true)
                        .first();
                    
                    // Rahbarlar guruhidagi xabar ID'sini olish
                    const state = stateManager.getUserState(userId);
                    const leadersMessageId = state?.data?.leaders_message_id || query.message?.message_id || null;
                    
                    if (leadersGroup && leadersMessageId) {
                        try {
                            await bot.editMessageText(
                                rejectionMessage,
                                {
                                    chat_id: leadersGroup.telegram_group_id,
                                    message_id: leadersMessageId,
                                    parse_mode: 'HTML',
                                    reply_markup: null // Knopkalarni olib tashlash
                                }
                            );
                            log.info(`[LEADER] [REJECTION] ✅ Rahbarlar guruhidagi xabar yangilandi: requestId=${requestId}, messageId=${leadersMessageId}`);
                        } catch (error) {
                            log.warn(`[LEADER] [REJECTION] ⚠️ Rahbarlar guruhidagi xabarni yangilashda xatolik: requestId=${requestId}, messageId=${leadersMessageId}, error=${error.message}`);
                        }
                    } else {
                        log.warn(`[LEADER] [REJECTION] ⚠️ Rahbarlar guruhi yoki xabar ID topilmadi: requestId=${requestId}, leadersGroup=${!!leadersGroup}, leadersMessageId=${leadersMessageId}`);
                    }
                    
                    // ✅ MUHIM: Menejerga xabar yuborish va chatni tozalash
                    const manager = await db('users').where('id', request.created_by).first();
                    if (manager && manager.telegram_chat_id) {
                        // "So'rov muvaffaqiyatli yaratildi!" xabarini yangilash
                        if (updatedRequest.preview_message_id && updatedRequest.preview_chat_id) {
                            try {
                                const { formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
                                // ✅ Status yangilangan request'ni ishlatish
                                const updatedMessage = await formatRequestMessageWithApprovals(updatedRequest, db, 'manager');
                                
                                await bot.editMessageText(
                                    updatedMessage,
                                    {
                                        chat_id: updatedRequest.preview_chat_id,
                                        message_id: updatedRequest.preview_message_id,
                                        parse_mode: 'HTML'
                                    }
                                );
                                log.info(`[LEADER] [REJECTION] ✅ "So'rov muvaffaqiyatli yaratildi!" xabari yangilandi: requestId=${requestId}, messageId=${updatedRequest.preview_message_id}`);
                            } catch (updateError) {
                                log.warn(`[LEADER] [REJECTION] ⚠️ "So'rov muvaffaqiyatli yaratildi!" xabarini yangilashda xatolik: requestId=${requestId}, error=${updateError.message}`);
                            }
                        } else {
                            log.warn(`[LEADER] [REJECTION] ⚠️ Preview message ID topilmadi: requestId=${requestId}, preview_message_id=${updatedRequest?.preview_message_id}, preview_chat_id=${updatedRequest?.preview_chat_id}`);
                        }
                        
                        // Avval eski xabarlarni o'chirish
                        try {
                            const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                            const messagesToDelete = getMessagesToCleanup(manager.telegram_chat_id, []);
                            
                            if (messagesToDelete.length > 0) {
                                const messagesToDeleteNow = messagesToDelete.slice(-5);
                                for (const messageId of messagesToDeleteNow) {
                                    try {
                                        await bot.deleteMessage(manager.telegram_chat_id, messageId);
                                        untrackMessage(manager.telegram_chat_id, messageId);
                                        await new Promise(resolve => setTimeout(resolve, 100));
                                    } catch (deleteError) {
                                        untrackMessage(manager.telegram_chat_id, messageId);
                                    }
                                }
                            }
                        } catch (cleanupError) {
                            // Silent fail
                        }
                        
                        // ✅ "Bekor qilindi" xabarini yuborishni olib tashlash
                        // Chunki "So'rov muvaffaqiyatli yaratildi!" xabari allaqachon yangilanadi va bekor qilish holatini ko'rsatadi
                        // await bot.sendMessage(manager.telegram_chat_id, rejectionMessage, {
                        //     parse_mode: 'HTML'
                        // });
                    }
                    
                    // Eslatmalarni to'xtatish
                    const { cancelReminders } = require('../../../utils/debtReminder.js');
                    cancelReminders(requestId);
                    
                    // ✅ Final guruhga bekor qilingan so'rovni yuborish
                    try {
                        const finalGroup = await db('debt_groups')
                            .where('group_type', 'final')
                            .where('is_active', true)
                            .first();
                        
                        if (finalGroup) {
                            // Request'ni to'liq ma'lumotlari bilan olish
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
                                // Excel ma'lumotlarini parse qilish
                                if (fullRequest.excel_data) {
                                    if (typeof fullRequest.excel_data === 'string' && fullRequest.excel_data) {
                                        try {
                                            fullRequest.excel_data = JSON.parse(fullRequest.excel_data);
                                        } catch (e) {
                                            fullRequest.excel_data = null;
                                        }
                                    }
                                    if (typeof fullRequest.excel_headers === 'string' && fullRequest.excel_headers) {
                                        try {
                                            fullRequest.excel_headers = JSON.parse(fullRequest.excel_headers);
                                        } catch (e) {
                                            fullRequest.excel_headers = [];
                                        }
                                    } else {
                                        fullRequest.excel_headers = fullRequest.excel_headers || [];
                                    }
                                    if (typeof fullRequest.excel_columns === 'string' && fullRequest.excel_columns) {
                                        try {
                                            fullRequest.excel_columns = JSON.parse(fullRequest.excel_columns);
                                        } catch (e) {
                                            fullRequest.excel_columns = null;
                                        }
                                    }
                                }
                                
                                const { formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
                                const finalMessage = await formatRequestMessageWithApprovals(fullRequest, db, 'manager');
                                
                                await bot.sendMessage(finalGroup.telegram_group_id, finalMessage, {
                                    parse_mode: 'HTML'
                                });
                                
                                log.info(`[LEADER] [REJECTION] ✅ Final guruhga bekor qilingan so'rov yuborildi: requestId=${requestId}, groupId=${finalGroup.telegram_group_id}`);
                            }
                        } else {
                            log.warn(`[LEADER] [REJECTION] ⚠️ Final guruh topilmadi: requestId=${requestId}`);
                        }
                    } catch (finalGroupError) {
                        log.error(`[LEADER] [REJECTION] ⚠️ Final guruhga yuborishda xatolik: requestId=${requestId}, error=${finalGroupError.message}`);
                    }
                    
                    // State'ni tozalash
                    stateManager.clearUserState(userId);
                    
                    await bot.sendMessage(chatId, '✅ So\'rov bekor qilindi.');
                } catch (error) {
                    log.error('Error handling rejection cancel:', error);
                }
                return true;
            }
            await leaderHandlers.handleLeaderRejection(query, bot);
            return true;
        }
        
        // Faqat debt_ bilan boshlangan callback'larni tekshirish
        if (!data.startsWith('debt_')) {
            return false;
        }
        
        // Manager handlers
        if (data.startsWith('debt_select_brand:')) {
            await managerHandlers.handleBrandSelection(query, bot);
            return true;
        }
        if (data.startsWith('debt_select_branch:')) {
            await managerHandlers.handleBranchSelection(query, bot);
            return true;
        }
        if (data.startsWith('debt_select_svr:')) {
            await managerHandlers.handleSVRSelection(query, bot);
            return true;
        }
        if (data.startsWith('debt_select_type:')) {
            await managerHandlers.handleTypeSelection(query, bot);
            return true;
        }
        if (data.startsWith('debt_send:')) {
            await managerHandlers.handleSendRequest(query, bot);
            return true;
        }
        if (data === 'debt_cancel_request' || data.startsWith('debt_cancel:')) {
            await managerHandlers.handleCancelRequest(query, bot);
            return true;
        }
        if (data.startsWith('debt_back_to_')) {
            await managerHandlers.handleBack(query, bot);
            return true;
        }
        
        // Debt Excel handlers
        const debtExcelHandlers = require('./debt-excel.js');
        if (data.startsWith('debt_select_column:')) {
            await debtExcelHandlers.handleSelectSingleColumn(query, bot);
            return true;
        }
        if (data.startsWith('debt_select_column_value:')) {
            await debtExcelHandlers.handleSelectColumnValue(query, bot);
            return true;
        }
        if (data === 'debt_confirm_columns') {
            await debtExcelHandlers.handleConfirmColumns(query, bot);
            return true;
        }
        if (data.startsWith('debt_confirm_excel_')) {
            await debtExcelHandlers.handleConfirmExcel(query, bot);
            return true;
        }
        if (data === 'debt_edit_excel') {
            await debtExcelHandlers.handleEditExcel(query, bot);
            return true;
        }
        if (data === 'debt_cancel_excel' || data.startsWith('debt_cancel_excel_')) {
            await bot.answerCallbackQuery(query.id);
            
            // Xabarni o'chirish
            try {
                await bot.deleteMessage(chatId, query.message.message_id);
            } catch (deleteError) {
                log.debug(`Could not delete message: ${deleteError.message}`);
            }
            
            // State'ni tozalash
            const stateManager = require('../../unified/stateManager.js');
            stateManager.clearUserState(userId);
            
            await bot.sendMessage(chatId, '❌ Qarzdorlik ma\'lumotlarini yuborish bekor qilindi.');
            return true;
        }
        
        // Approval handlers (old - backward compatibility)
        if (data.startsWith('debt_approve:')) {
            const requestId = parseInt(data.split(':')[1]);
            // Foydalanuvchi rolini aniqlash
            const userHelper = require('../../unified/userHelper.js');
            const user = await userHelper.getUserByTelegram(query.message.chat.id, userId);
            if (user) {
                // Permission asosida aniqlash (rol emas)
                const hasSupervisorPermission = await userHelper.hasPermission(user.id, 'debt:approve_supervisor');
                const hasLeaderPermission = await userHelper.hasPermission(user.id, 'debt:approve_leader');
                const hasCashierPermission = await userHelper.hasPermission(user.id, 'debt:approve_cashier');
                const hasOperatorPermission = await userHelper.hasPermission(user.id, 'debt:approve_operator');
                
                // So'rov statusini tekshirish
                const request = await db('debt_requests').where('id', requestId).first();
                if (request) {
                    if (request.status === 'APPROVED_BY_CASHIER' && hasSupervisorPermission) {
                        await approvalHandlers.handleSupervisorApproval(query, bot);
                    } else if (request.status === 'APPROVED_BY_SUPERVISOR' && hasOperatorPermission) {
                        await approvalHandlers.handleOperatorApproval(query, bot);
                    } else if (request.status === 'SET_PENDING' && hasLeaderPermission) {
                        await leaderHandlers.handleLeaderApproval(query, bot);
                    } else if (request.status === 'PENDING_APPROVAL' && hasCashierPermission) {
                        await cashierHandlers.handleCashierApproval(query, bot);
                    } else {
                        // Fallback to role-based (old logic)
                        if (userHelper.hasRole(user, 'leader')) {
                            await leaderHandlers.handleLeaderApproval(query, bot);
                        } else if (userHelper.hasRole(user, 'cashier')) {
                            await cashierHandlers.handleCashierApproval(query, bot);
                        } else if (userHelper.hasRole(user, 'operator')) {
                            await operatorHandlers.handleOperatorApproval(query, bot);
                        }
                    }
                }
            }
            return true;
        }
        
        // Debt handlers
        if (data.startsWith('debt_debt:')) {
            await debtHandlers.handleDebtFound(query, bot);
            return true;
        }
        if (data.startsWith('debt_upload_excel:')) {
            await debtHandlers.handleUploadExcel(query, bot);
            return true;
        }
        if (data.startsWith('debt_upload_image:')) {
            await debtHandlers.handleUploadImage(query, bot);
            return true;
        }
        if (data.startsWith('debt_enter_amount:')) {
            await debtHandlers.handleEnterAmount(query, bot);
            return true;
        }
        if (data.startsWith('debt_send:')) {
            // Debt preview'dan yuborish
            const stateManager = require('../../unified/stateManager.js');
            const state = stateManager.getUserState(userId);
            if (state && state.context === stateManager.CONTEXTS.DEBT_APPROVAL && state.state === debtHandlers.STATES.PREVIEW) {
                await debtHandlers.handleSendDebt(query, bot);
                return true;
            }
        }
        if (data.startsWith('debt_cancel_debt:')) {
            await debtHandlers.handleCancelDebt(query, bot);
            return true;
        }
        
        // Registration handlers
        if (data === 'debt_register_start') {
            await registrationHandlers.handleRegistrationStart({ chat: { id: query.message.chat.id }, from: query.from }, bot);
        await bot.answerCallbackQuery(query.id);
            return true;
        }
        if (data === 'debt_reg_confirm') {
            await registrationHandlers.handleConfirmRegistration(query, bot);
            return true;
        }
        if (data === 'debt_reg_cancel') {
            await registrationHandlers.handleCancelRegistration(query, bot);
            return true;
        }
        if (data.startsWith('debt_reg_edit:')) {
            await registrationHandlers.handleEditRegistration(query, bot);
            return true;
        }
        
        log.info(`Debt-approval callback: ${data} from user ${userId}`);
        return false;
        
    } catch (error) {
        log.error('Debt-approval callback handle qilishda xatolik:', error);
        return false;
    }
}

// Handle messages
async function handleDebtApprovalMessage(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    const userHelper = require('../../unified/userHelper.js');
    const { trackMessage, detectMessageType, MESSAGE_TYPES } = require('../utils/messageTracker.js');
    
    try {
        // Xabarni kuzatishga qo'shish (tozalanadigan xabarlar)
        if (msg.message_id) {
            const messageType = detectMessageType(msg);
            if (messageType && messageType !== MESSAGE_TYPES.STATUS) {
                trackMessage(chatId, msg.message_id, messageType, true);
            }
        }
        
        // Registration - /register yoki "Ro'yxatdan o'tish"
        if (text && (text === '/register' || text.toLowerCase().includes('ro\'yxatdan o\'tish') || text.toLowerCase().includes('register'))) {
            const handled = await registrationHandlers.handleRegistrationStart(msg, bot);
            if (handled) return true;
        }
        
        // Registration message handler (FSM)
        const regHandled = await registrationHandlers.handleRegistrationMessage(msg, bot);
        if (regHandled) return true;
        
        // Manager - "Yangi so'rov"
        if (text && (text.includes('➕ Yangi so\'rov') || text.includes('Yangi so\'rov'))) {
            log.info(`[DEBT_BOT] 📝 "Yangi so'rov" buyrug'i qabul qilindi. UserId: ${userId}, Text: ${text}`);
            log.info(`[DEBT_BOT] 📝 handleNewRequest chaqirilmoqda: requestType='NORMAL'`);
            await managerHandlers.handleNewRequest(msg, bot, 'NORMAL');
            return true;
        }
        
        // Manager - "SET (Muddat uzaytirish)"
        if (text && (text.includes('💾 SET (Muddat uzaytirish)') || text.includes('SET (Muddat uzaytirish)') || (text.includes('SET') && text.includes('uzaytirish')))) {
            log.info(`[DEBT_BOT] 📝 "SET (Muddat uzaytirish)" buyrug'i qabul qilindi. UserId: ${userId}, Text: ${text}`);
            log.info(`[DEBT_BOT] 📝 handleNewRequest chaqirilmoqda: requestType='SET'`);
            await managerHandlers.handleNewRequest(msg, bot, 'SET');
            return true;
        }
        
        // Manager - SET so'rov uchun qo'shimcha ma'lumot
        const handled = await managerHandlers.handleExtraInfo(msg, bot);
        if (handled) {
            return true;
        }
        
        // Cashier - "Yangi so'rovlar"
        const cashierHandlers = require('./cashier.js');
        if (text && (text.includes('📥 Yangi so\'rovlar') || text.includes('Yangi so\'rovlar'))) {
            await cashierHandlers.showCashierRequests(userId, chatId);
            return true;
        }
        
        // Cashier - "Mening so'rovlarim"
        if (text && (text.includes('📋 Mening so\'rovlarim') || text.includes('Mening so\'rovlarim'))) {
            // Kassir yoki menejer ekanligini tekshirish
            const user = await userHelper.getUserByTelegram(chatId, userId);
            if (user && userHelper.hasRole(user, ['kassir', 'cashier'])) {
                await cashierHandlers.showMyCashierRequests(userId, chatId);
            } else if (user && userHelper.hasRole(user, ['menejer', 'manager'])) {
                // Menejer uchun - faqat yangi so'rovlar (PENDING_APPROVAL)
                if (managerHandlers.showMyRequests) {
                    await managerHandlers.showMyRequests(userId, chatId);
                } else {
                    await getBot().sendMessage(chatId, '📋 Bu funksiya tez orada qo\'shiladi.');
                }
            } else {
                await getBot().sendMessage(chatId, '❌ Bu funksiya faqat kassir va menejerlar uchun.');
            }
            return true;
        }
        
        // Manager - "Jarayondagi so'rovlar"
        if (text && (text.includes('⏳ Jarayondagi so\'rovlar') || text.includes('Jarayondagi so\'rovlar'))) {
            const user = await userHelper.getUserByTelegram(chatId, userId);
            if (user && userHelper.hasRole(user, ['menejer', 'manager'])) {
                if (managerHandlers.showInProgressRequests) {
                    await managerHandlers.showInProgressRequests(userId, chatId);
                } else {
                    await getBot().sendMessage(chatId, '⏳ Bu funksiya tez orada qo\'shiladi.');
                }
            } else {
                await getBot().sendMessage(chatId, '❌ Bu funksiya faqat menejerlar uchun.');
            }
            return true;
        }
        
        // Manager - "Tasdiqlangan so'rovlar"
        if (text && (text.includes('✅ Tasdiqlangan so\'rovlar') || text.includes('Tasdiqlangan so\'rovlar'))) {
            const user = await userHelper.getUserByTelegram(chatId, userId);
            if (user && userHelper.hasRole(user, ['menejer', 'manager'])) {
                if (managerHandlers.showApprovedRequests) {
                    await managerHandlers.showApprovedRequests(userId, chatId);
                } else {
                    await getBot().sendMessage(chatId, '✅ Bu funksiya tez orada qo\'shiladi.');
                }
            } else {
                await getBot().sendMessage(chatId, '❌ Bu funksiya faqat menejerlar uchun.');
            }
            return true;
        }
        
        // Manager - "Brend va Filiallar statistikasi"
        if (text && (text.includes('📊 Brend va Filiallar statistikasi') || text.includes('Brend va Filiallar statistikasi') || text.includes('statistikasi'))) {
            const user = await userHelper.getUserByTelegram(chatId, userId);
            if (user && userHelper.hasRole(user, ['menejer', 'manager'])) {
                if (managerHandlers.showBrandBranchStats) {
                    await managerHandlers.showBrandBranchStats(userId, chatId);
                } else {
                    await getBot().sendMessage(chatId, '📊 Bu funksiya tez orada qo\'shiladi.');
                }
            } else {
                await getBot().sendMessage(chatId, '❌ Bu funksiya faqat menejerlar uchun.');
            }
            return true;
        }
        
        // Cashier - "Kutayotgan so'rovlar" / "Kutilyotgan so'rovlar" / "Kutilayotgan so'rovlar"
        if (text && (text.includes('⏰ Kutayotgan so\'rovlar') || text.includes('Kutayotgan so\'rovlar') || 
            text.includes('Kutilyotgan so\'rovlar') || text.includes('⏰ Kutilyotgan so\'rovlar') ||
            text.includes('Kutilayotgan so\'rovlar') || text.includes('⏰ Kutilayotgan so\'rovlar'))) {
            await cashierHandlers.showPendingCashierRequests(userId, chatId);
            return true;
        }
        
        // Operator - "Kutilayotgan so'rovlar"
        if (text && (text.includes('⏰ Kutilayotgan so\'rovlar') || text.includes('Kutilayotgan so\'rovlar'))) {
            await operatorHandlers.showOperatorRequests(userId, chatId);
            return true;
        }
        
        // Operator - "Yangi so'rovlar"
        const operatorHandlers = require('./operator.js');
        if (text && (text.includes('📥 Yangi so\'rovlar') || text.includes('Yangi so\'rovlar'))) {
            await operatorHandlers.showOperatorRequests(userId, chatId);
            return true;
        }
        
        // Supervisor - "Kutilayotgan so'rovlar"
        if (text && (text.includes('⏰ Kutilayotgan so\'rovlar') || text.includes('Kutilayotgan so\'rovlar'))) {
            await supervisorHandlers.showPendingSupervisorRequests(userId, chatId);
            return true;
        }
        
        // Leader - "SET so'rovlari"
        const leaderHandlers = require('./leader.js');
        if (text && (text.includes('📥 SET so\'rovlari') || text.includes('SET so\'rovlari'))) {
            await leaderHandlers.showLeaderRequests(userId, chatId);
            return true;
        }
        
        // Leader - Rejection reason
        const rejectionHandled = await leaderHandlers.handleRejectionReason(msg, bot);
        if (rejectionHandled) {
            return true;
        }
        
        // Bloklash faqat WEB orqali qilinadi (botdagi bloklash olib tashlandi)
        
        // "Rolni o'zgartirish" knopkasi handler
        if (text && text === "🔄 Rolni o'zgartirish") {
            log.info(`[ROLE_CHANGE] "Rolni o'zgartirish" knopkasi bosildi: userId=${userId}, chatId=${chatId}`);
            const userHelper = require('../../unified/userHelper.js');
            const { getUserRolesFromTasks, ROLE_DISPLAY_NAMES, shouldShowRoleSelection, getRolesForSelection } = userHelper;
            
            // Avval foydalanuvchini topish (telegram userId'dan users.id'ga o'tish)
            const user = await userHelper.getUserByTelegram(chatId, userId);
            if (!user) {
                log.warn(`[ROLE_CHANGE] Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
                await getBot().sendMessage(chatId, "Xatolik: foydalanuvchi topilmadi.");
                return true;
            }
            
            const userRolesFromTasks = await getUserRolesFromTasks(user.id);
            
            log.debug(`[ROLE_CHANGE] Foydalanuvchi rollari: userId=${userId}, rolesCount=${userRolesFromTasks.length}, roles=${userRolesFromTasks.join(',')}`);
            
            // Faqat manager va cashier kombinatsiyasi bo'lsa, rol tanlash ko'rsatish
            if (!shouldShowRoleSelection(userRolesFromTasks)) {
                log.debug(`[ROLE_CHANGE] Manager+cashier kombinatsiyasi yo'q, knopka ishlamaydi: userId=${userId}, roles=${userRolesFromTasks.join(',')}`);
                await getBot().sendMessage(chatId, "Sizda rol tanlash uchun tegishli kombinatsiya mavjud emas.");
                return true;
            }
            
            // Reply keyboard yaratish (faqat manager va cashier)
            const rolesForSelection = getRolesForSelection(userRolesFromTasks);
            const roleButtons = rolesForSelection.map(role => ({
                text: ROLE_DISPLAY_NAMES[role] || role
            }));
            
            // Reply keyboard'ni 2 ta yonma-yon qilish
            const replyKeyboardRows = [];
            for (let i = 0; i < roleButtons.length; i += 2) {
                if (i + 1 < roleButtons.length) {
                    replyKeyboardRows.push([roleButtons[i], roleButtons[i + 1]]);
                } else {
                    replyKeyboardRows.push([roleButtons[i]]);
                }
            }
            
            const replyKeyboard = {
                keyboard: replyKeyboardRows,
                resize_keyboard: true,
                one_time_keyboard: false
            };
            
            log.info(`[ROLE_CHANGE] Rol tanlash reply keyboard yuborilmoqda: userId=${userId}, rolesCount=${rolesForSelection.length}`);
            await getBot().sendMessage(chatId,
                "Qaysi rol bilan ishlashni xohlaysiz? Quyidagi knopkalardan birini tanlang:",
                { reply_markup: replyKeyboard }
            );
            
            return true;
        }
        
        // Rol tanlash (Menejer/Kassir text message'larini tutib olish)
        if (text && (text === "Menejer" || text === "Kassir")) {
            log.info(`[ROLE_SELECTION] Rol tanlash text message: userId=${userId}, text=${text}, chatId=${chatId}`);
            const userHelper = require('../../unified/userHelper.js');
            const { getUserRolesFromTasks, ROLE_DISPLAY_NAMES, shouldShowRoleSelection } = userHelper;
            const stateManager = require('../../unified/stateManager.js');
            
            // Faqat shaxsiy chatda ishlaydi
            if (chatId < 0) {
                log.debug(`[ROLE_SELECTION] Guruhda rol tanlash mumkin emas: userId=${userId}, chatId=${chatId}`);
                return false;
            }
            
            // Avval foydalanuvchini topish (telegram userId'dan users.id'ga o'tish)
            const userForRoleCheck = await userHelper.getUserByTelegram(chatId, userId);
            if (!userForRoleCheck) {
                log.warn(`[ROLE_SELECTION] Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
                return false;
            }
            
            const userRolesFromTasks = await getUserRolesFromTasks(userForRoleCheck.id);
            
            // Faqat manager va cashier kombinatsiyasi bo'lsa, rol tanlash ko'rsatish
            if (!shouldShowRoleSelection(userRolesFromTasks)) {
                log.debug(`[ROLE_SELECTION] Manager+cashier kombinatsiyasi yo'q: userId=${userId}, roles=${userRolesFromTasks.join(',')}`);
                return false;
            }
            
            // Text'dan rolni aniqlash
            const roleMap = {
                'Menejer': 'manager',
                'Kassir': 'cashier'
            };
            
            const selectedRole = roleMap[text];
            if (!selectedRole) {
                log.warn(`[ROLE_SELECTION] Noma'lum rol: userId=${userId}, text=${text}`);
                return false;
            }
            
            // Rolni state'ga saqlash
            const currentState = stateManager.getUserState(userId);
            const stateData = currentState?.data || {};
            stateData.selectedRole = selectedRole;
            
            stateManager.setUserState(userId, stateManager.CONTEXTS.IDLE, 'idle', stateData);
            log.info(`[ROLE_SELECTION] Rol state'ga saqlandi: userId=${userId}, selectedRole=${selectedRole}`);
            
            // Welcome message'ni qayta yuborish
            const userHelperFull = require('../../unified/userHelper.js');
            const { createUnifiedKeyboard } = require('../../unified/keyboards.js');
            const user = await userHelperFull.getUserByTelegram(chatId, userId);
            
            if (!user) {
                log.warn(`[ROLE_SELECTION] Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
                await getBot().sendMessage(chatId, "Xatolik: foydalanuvchi topilmadi.");
                return true;
            }
            
            // Active role'ni aniqlash
            const activeRole = selectedRole;
            const roleDisplayName = ROLE_DISPLAY_NAMES[activeRole] || activeRole || 'Tasdiqlanmagan';
            
            // Welcome message'ni yuborish (createUnifiedKeyboard orqali)
            const keyboard = await createUnifiedKeyboard(user, activeRole);
            
            // Keyboard'ga "Rolni o'zgartirish" knopkasini qo'shish (faqat shaxsiy chatda va faqat manager+cashier kombinatsiyasi bo'lsa)
            if (shouldShowRoleSelection(userRolesFromTasks)) {
                keyboard.keyboard.push([{ text: "🔄 Rolni o'zgartirish" }]);
            }
            
            // escapeHtml funksiyasi
            const escapeHtml = (text) => {
                if (!text) return '';
                return String(text)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            };
            
            const welcomeMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                `📋 <b>Ma'lumotlar:</b>\n` +
                `👤 To'liq ism: ${escapeHtml(user.fullname || 'Noma\'lum')}\n` +
                `🎭 Rol: ${roleDisplayName}\n` +
                `📊 Holat: ${user.status === 'active' ? '✅ Faol' : '❌ Nofaol'}\n\n` +
                `Quyidagi tugmalardan foydalaning:`;
            
            await getBot().sendMessage(chatId, welcomeMessage, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
            
            log.info(`[ROLE_SELECTION] Rol tanlandi va welcome message yuborildi: userId=${userId}, selectedRole=${selectedRole}`);
            return true;
        }
        
        // Debt Excel handlers
        const debtExcelHandlers = require('./debt-excel.js');
        if (msg.document) {
            const excelHandled = await debtExcelHandlers.handleExcelFile(msg, bot);
            if (excelHandled) return true;
        }
        
        // Debt handlers - Excel, rasm, summa (old - backward compatibility)
        if (msg.document) {
            const excelHandled = await debtHandlers.handleExcelFile(msg, bot);
            if (excelHandled) return true;
        }
        if (msg.photo || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/'))) {
            const imageHandled = await debtHandlers.handleImageFile(msg, bot);
            if (imageHandled) return true;
        }
        if (text) {
            const amountHandled = await debtHandlers.handleAmountText(msg, bot);
            if (amountHandled) return true;
        }
        
        // ✅ Kassir uchun avtomatik tanib olish va text input handler'lar
        const stateManager = require('../../unified/stateManager.js');
        const state = stateManager.getUserState(userId);
        if (state && state.context === stateManager.CONTEXTS.DEBT_APPROVAL) {
            const cashierHandlers = require('./cashier.js');
            
            // Avtomatik tanib olish (text, document, photo)
            if (state.state === cashierHandlers.STATES.AUTO_DETECT_DEBT_INPUT) {
                const handled = await cashierHandlers.handleAutoDetectDebtInput(msg, bot);
                if (handled) return true;
            }
            
            // Umumiy summa kiritish
            if (state.state === cashierHandlers.STATES.ENTER_TOTAL_AMOUNT) {
                const handled = await cashierHandlers.handleTotalAmountInput(msg, bot);
                if (handled) return true;
            }
            
            // Agent bo'yicha qarzdorlik kiritish
            if (state.state === cashierHandlers.STATES.ENTER_AGENT_DEBTS) {
                const handled = await cashierHandlers.handleAgentDebtsInput(msg, bot);
                if (handled) return true;
            }
        }
        
        return false;
        
    } catch (error) {
        log.error('Debt-approval message handle qilishda xatolik:', error);
        return false;
    }
}

module.exports = {
    handleDebtApprovalCallback,
    handleDebtApprovalMessage
};

