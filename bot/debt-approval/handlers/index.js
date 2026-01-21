// bot/debt-approval/handlers/index.js

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const { getBot } = require('../../../utils/bot.js');
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
        const blockedHandlers = require('./blocked.js');
        
        // Block handlers (avval tekshirish)
        if (data === 'block_item' || data === 'unblock_item' || data === 'list_blocked' || 
            data.startsWith('block_type:') || data.startsWith('block_select_item:') || 
            data.startsWith('unblock_item:') || data === 'block_back' || data === 'block_cancel' ||
            data === 'block_skip_comment' || data === 'block_confirm') {
            if (data === 'block_item') {
                await blockedHandlers.handleBlockItem(query, bot);
            } else if (data === 'unblock_item') {
                await blockedHandlers.handleUnblockItem(query, bot);
            } else if (data === 'list_blocked') {
                await blockedHandlers.handleListBlocked(query, bot);
            } else if (data.startsWith('block_type:')) {
                await blockedHandlers.handleBlockTypeSelection(query, bot);
            } else if (data.startsWith('block_select_item:')) {
                await blockedHandlers.handleBlockItemSelection(query, bot);
            } else if (data.startsWith('unblock_item:')) {
                await blockedHandlers.handleUnblockConfirm(query, bot);
            } else if (data === 'block_back') {
                await blockedHandlers.handleBlockBack(query, bot);
            } else if (data === 'block_cancel') {
                await bot.answerCallbackQuery(query.id);
                const stateManager = require('../../unified/stateManager.js');
                stateManager.clearUserState(userId);
                await bot.sendMessage(chatId, '❌ Jarayon bekor qilindi.');
            } else if (data === 'block_skip_comment') {
                // Comment o'tkazib yuborish
                const stateManager = require('../../unified/stateManager.js');
                const state = stateManager.getUserState(userId);
                if (state && state.data) {
                    state.data.comment = null;
                    await blockedHandlers.handleBlockConfirm(query, bot);
                }
            } else if (data === 'block_confirm') {
                await blockedHandlers.handleBlockConfirm(query, bot);
            }
            return true;
        }
        
        // Cashier handlers (avval tekshirish, chunki ular debt_ bilan boshlanmaydi)
        if (data.startsWith('cashier_approve_')) {
            await cashierHandlers.handleCashierApproval(query, bot);
            return true;
        }
        if (data.startsWith('cashier_debt_')) {
            await cashierHandlers.handleCashierDebt(query, bot);
            return true;
        }
        
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
                // Bekor qilish bekor qilindi
                await bot.answerCallbackQuery(query.id);
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
        if (data === 'debt_cancel_excel') {
            await bot.answerCallbackQuery(query.id);
            const stateManager = require('../../unified/stateManager.js');
            stateManager.clearUserState(userId);
            await bot.sendMessage(chatId, '❌ Excel import bekor qilindi.');
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
    
    try {
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
        
        // Cashier - "Kutayotgan so'rovlar"
        if (text && (text.includes('⏰ Kutayotgan so\'rovlar') || text.includes('Kutayotgan so\'rovlar'))) {
            await cashierHandlers.showPendingCashierRequests(userId, chatId);
            return true;
        }
        
        // Operator - "Yangi so'rovlar"
        const operatorHandlers = require('./operator.js');
        if (text && (text.includes('📥 Yangi so\'rovlar') || text.includes('Yangi so\'rovlar'))) {
            await operatorHandlers.showOperatorRequests(userId, chatId);
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
        
        // Block handlers
        const blockedHandlers = require('./blocked.js');
        if (text && (text.includes('🚫 Bloklash') || text.includes('Bloklash'))) {
            const user = await userHelper.getUserByTelegram(chatId, userId);
            // debt:block, debt:admin, roles:manage yoki backward compatibility uchun debt:create, debt:approve_leader
            if (user && (await userHelper.hasPermission(user.id, 'debt:block') || 
                        await userHelper.hasPermission(user.id, 'debt:admin') ||
                        await userHelper.hasPermission(user.id, 'roles:manage') ||
                        await userHelper.hasPermission(user.id, 'debt:create') || 
                        await userHelper.hasPermission(user.id, 'debt:approve_leader'))) {
                await blockedHandlers.handleBlockStart(msg, bot);
                return true;
            } else {
                await getBot().sendMessage(chatId, '❌ Sizda bloklash huquqi yo\'q.');
                return true;
            }
        }
        
        // Block reason handler
        const blockReasonHandled = await blockedHandlers.handleBlockReason(msg, bot);
        if (blockReasonHandled) {
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

