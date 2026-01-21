// bot/debt-approval/handlers/supervisor.js
// Supervisor handlers - So'rovlarni ko'rish va tasdiqlash

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const userHelper = require('../../unified/userHelper.js');
const { formatNormalRequestMessage, formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
const { logRequestAction, logApproval } = require('../../../utils/auditLogger.js');
const { updateRequestMessage } = require('../../../utils/messageUpdater.js');
const { sendToFinalGroup } = require('./final-group.js');
const { assignOperatorToRequest } = require('../../../utils/cashierAssignment.js');
const { showRequestToOperator } = require('./operator.js');

const log = createLogger('SUPERVISOR');

/**
 * Supervisor'ning faol so'rovini tekshirish
 * @param {number} userId - Telegram user ID
 * @param {number} chatId - Telegram chat ID
 * @returns {Promise<Object|null>} - Faol so'rov yoki null
 */
async function checkActiveSupervisorRequest(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return null;
        }
        
        // Supervisor task'larini olish
        const supervisorTasks = await db('debt_user_tasks')
            .where('user_id', user.id)
            .whereIn('task_type', ['approve_supervisor_cashier', 'approve_supervisor_operator'])
            .select('task_type', 'branch_id', 'brand_id');
        
        if (supervisorTasks.length === 0) {
            return null;
        }
        
        // Faol so'rovni qidirish (status = APPROVED_BY_CASHIER yoki APPROVED_BY_OPERATOR, locked = false)
        // User'ning task'lariga mos keladigan so'rovlarni qidirish
        let activeRequest = null;
        
        for (const task of supervisorTasks) {
            let query = db('debt_requests')
                .where('locked', false);
            
            if (task.task_type === 'approve_supervisor_cashier') {
                query = query.where('status', 'APPROVED_BY_CASHIER');
                if (task.branch_id) {
                    query = query.where('branch_id', task.branch_id);
                }
            } else if (task.task_type === 'approve_supervisor_operator') {
                query = query.where('status', 'APPROVED_BY_OPERATOR');
                if (task.brand_id) {
                    query = query.where('brand_id', task.brand_id);
                }
            }
            
            activeRequest = await query.first();
            if (activeRequest) {
                break;
            }
        }
        
        return activeRequest || null;
    } catch (error) {
        log.error('Error checking active supervisor request:', error);
        return null;
    }
}

/**
 * Supervisor'ga so'rov yuborish (kasirlar tasdiqlagandan keyin)
 * @param {Object} request - So'rov ma'lumotlari
 * @param {Array} supervisors - Supervisor'lar ro'yxati
 * @param {string} approvalStage - 'cashier' yoki 'operator'
 */
async function showRequestToSupervisor(request, supervisors, approvalStage = 'cashier') {
    try {
        log.info(`[SUPERVISOR] [SHOW_REQUEST] Supervisor'larga so'rov yuborilmoqda: requestId=${request.id}, requestUID=${request.request_uid}, approvalStage=${approvalStage}, supervisorsCount=${supervisors.length}`);
        
        const bot = getBot();
        if (!bot) {
            log.error(`[SUPERVISOR] [SHOW_REQUEST] ❌ Bot topilmadi: requestId=${request.id}`);
            return;
        }
        
        // Xabar formatlash
        let message;
        if (request.type === 'SET' && request.excel_data) {
            // SET so'rov uchun formatSetRequestMessage
            let excelData = request.excel_data;
            let excelHeaders = request.excel_headers;
            let excelColumns = request.excel_columns;
            
            if (typeof excelData === 'string' && excelData) {
                try {
                    excelData = JSON.parse(excelData);
                } catch (e) {
                    excelData = null;
                }
            }
            
            if (typeof excelHeaders === 'string' && excelHeaders) {
                try {
                    excelHeaders = JSON.parse(excelHeaders);
                } catch (e) {
                    excelHeaders = null;
                }
            }
            
            if (typeof excelColumns === 'string' && excelColumns) {
                try {
                    excelColumns = JSON.parse(excelColumns);
                } catch (e) {
                    excelColumns = null;
                }
            }
            
            // Telegraph sahifa yaratish
            let telegraphUrl = null;
            if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                try {
                    const { createDebtDataPage } = require('../../../utils/telegraph.js');
                    telegraphUrl = await createDebtDataPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name || request.brand?.name,
                        filial_name: request.filial_name || request.filial?.name,
                        svr_name: request.svr_name || request.svr?.name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total
                    });
                } catch (telegraphError) {
                    log.debug(`[SUPERVISOR] [SHOW_REQUEST] Telegraph xatolik: requestId=${request.id}`);
                }
            }
            
            message = formatSetRequestMessage({
                brand_name: request.brand_name || request.brand?.name,
                filial_name: request.filial_name || request.filial?.name,
                svr_name: request.svr_name || request.svr?.name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: request.excel_total,
                is_for_operator: false,
                telegraph_url: telegraphUrl
            });
        } else {
            // Oddiy so'rov uchun formatNormalRequestMessage
            message = formatNormalRequestMessage({
                brand_name: request.brand_name || request.brand?.name,
                filial_name: request.filial_name || request.filial?.name,
                svr_name: request.svr_name || request.svr?.name,
                request_uid: request.request_uid
            });
        }
        
        // Approval stage bo'yicha qo'shimcha ma'lumot
        if (approvalStage === 'cashier') {
            message += `\n\n✅ Kasirlar tasdiqladi\n⚠️ Sizning tasdig'ingiz kutilmoqda (Nazoratchi)`;
        } else if (approvalStage === 'operator') {
            message += `\n\n✅ Operatorlar tasdiqladi\n⚠️ Sizning tasdig'ingiz kutilmoqda (Nazoratchi)`;
        }
        
        // Keyboard yaratish
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Tasdiqlash', callback_data: `supervisor_approve_${request.id}_${approvalStage}` },
                    { text: '⚠️ Qarzi bor', callback_data: `supervisor_debt_${request.id}_${approvalStage}` }
                ]
            ]
        };
        
        // Barcha supervisor'larga yuborish
        let sentCount = 0;
        for (const supervisor of supervisors) {
            if (supervisor.telegram_chat_id) {
                try {
                    // ✅ MUHIM: Joriy so'rovning allaqachon ko'rsatilgan xabarlarini tekshirish
                    const { hasActiveRequestMessage } = require('../utils/messageTracker.js');
                    const hasActiveMessage = hasActiveRequestMessage(supervisor.telegram_chat_id, request.id);
                    
                    if (hasActiveMessage) {
                        log.info(`[SUPERVISOR] [SHOW_REQUEST] ⚠️ Supervisor'da joriy so'rovning faol xabari mavjud, yangi xabar yuborilmaydi: requestId=${request.id}, supervisorId=${supervisor.id}`);
                        continue; // Keyingi supervisor'ga o'tish
                    }
                    
                    // ✅ NAVBATLI KO'RSATISH: Supervisor'ning boshqa faol so'rovlarining xabarlarini o'chirish
                    try {
                        const { getRequestMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                        
                        log.info(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] Eski so'rov xabarlarini qidirish: chatId=${supervisor.telegram_chat_id}, requestId=${request.id}`);
                        
                        // Eski so'rov xabarlarini o'chirish
                        const messagesToDelete = getRequestMessagesToCleanup(supervisor.telegram_chat_id, []);
                        
                        if (messagesToDelete.length > 0) {
                            const messagesToDeleteNow = messagesToDelete.slice(-10);
                            
                            for (const messageId of messagesToDeleteNow) {
                                try {
                                    await bot.deleteMessage(supervisor.telegram_chat_id, messageId);
                                    untrackMessage(supervisor.telegram_chat_id, messageId);
                                    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit uchun
                                } catch (deleteError) {
                                    untrackMessage(supervisor.telegram_chat_id, messageId);
                                }
                            }
                        }
                    } catch (cleanupError) {
                        // Silent fail
                        log.debug(`[SUPERVISOR] [SHOW_REQUEST] Cleanup xatolik (ignored): ${cleanupError.message}`);
                    }
                    
                    const sentMessage = await bot.sendMessage(supervisor.telegram_chat_id, message, {
                        reply_markup: keyboard,
                        parse_mode: 'HTML'
                    });
                    
                    // ✅ Xabarni messageTracker'ga qo'shish (pending so'rov - tasdiqlanmaguncha o'chirilishi mumkin)
                    try {
                        const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                        trackMessage(supervisor.telegram_chat_id, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true, request.id, false); // shouldCleanup=true, isApproved=false - pending so'rov
                    } catch (trackError) {
                        // Silent fail
                    }
                    
                    sentCount++;
                    log.info(`[SUPERVISOR] [SHOW_REQUEST] ✅ Supervisor'ga xabar yuborildi: SupervisorId=${supervisor.id}, Name=${supervisor.fullname}, ChatId=${supervisor.telegram_chat_id}`);
                } catch (sendError) {
                    log.error(`[SUPERVISOR] [SHOW_REQUEST] ❌ Supervisor'ga xabar yuborishda xatolik: SupervisorId=${supervisor.id}, Error=${sendError.message}`);
                }
            }
        }
        
        log.info(`[SUPERVISOR] [SHOW_REQUEST] ✅ Jami ${sentCount}/${supervisors.length} ta supervisor'ga xabar yuborildi: requestId=${request.id}`);
        
    } catch (error) {
        log.error(`[SUPERVISOR] [SHOW_REQUEST] ❌ Xatolik: requestId=${request.id}, error=${error.message}`, error);
    }
}

/**
 * Supervisor tasdiqlash (kasirlar yoki operatorlar tasdiqlagandan keyin)
 */
async function handleSupervisorApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const parts = query.data.split('_');
    const requestId = parseInt(parts[2]);
    const approvalStage = parts[3] || 'cashier'; // 'cashier' yoki 'operator'
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // Foydalanuvchi va permission tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        // Supervisor task_type'ni tekshirish
        const supervisorTask = await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                if (approvalStage === 'cashier') {
                    this.where('task_type', 'approve_supervisor_cashier');
                } else if (approvalStage === 'operator') {
                    this.where('task_type', 'approve_supervisor_operator');
                }
            })
            .first();
        
        if (!supervisorTask) {
            await bot.sendMessage(chatId, '❌ Sizda Nazoratchi tasdiqlash huquqi yo\'q.');
            return;
        }
        
        // So'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // Status tekshirish
        const expectedStatus = approvalStage === 'cashier' ? 'APPROVED_BY_CASHIER' : 'APPROVED_BY_OPERATOR';
        if (request.status !== expectedStatus) {
            await bot.sendMessage(chatId, `❌ So'rov statusi noto'g'ri. Kutilgan: ${expectedStatus}, Hozirgi: ${request.status}`);
            return;
        }
        
        // Lock tekshirish
        if (request.locked) {
            await bot.answerCallbackQuery(query.id, { 
                text: 'Bu so\'rov allaqachon tasdiqlanmoqda', 
                show_alert: true 
            });
            return;
        }
        
        // Lock qilish
        const lockResult = await db('debt_requests')
            .where('id', requestId)
            .where('locked', false)
            .update({
                locked: true,
                locked_by: user.id,
                locked_at: db.fn.now()
            });
        
        if (lockResult === 0) {
            await bot.sendMessage(chatId, '❌ So\'rov allaqachon tasdiqlanmoqda.');
            return;
        }
        
        log.info(`[SUPERVISOR] [APPROVAL] Supervisor tasdiqlash boshlanmoqda: requestId=${requestId}, approvalStage=${approvalStage}, supervisorId=${user.id}`);
        
        // Log yozish
        await Promise.all([
            logApproval(requestId, user.id, 'supervisor', 'approved', { approval_stage: approvalStage }),
            logRequestAction(requestId, 'supervisor_approved', user.id, {
                new_status: 'APPROVED_BY_SUPERVISOR',
                approval_stage: approvalStage
            })
        ]);
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_SUPERVISOR',
                locked: false,
                locked_by: null,
                locked_at: null,
                current_approver_id: null,
                current_approver_type: null
            });
        
        log.info(`[SUPERVISOR] [APPROVAL] ✅ Status yangilandi: APPROVED_BY_SUPERVISOR`);
        
        // Keyingi bosqichga yuborish
        if (approvalStage === 'cashier') {
            // Kasirlar bosqichidan keyin - operatorga yuborish
            log.debug(`[SUPERVISOR] [APPROVAL] Operatorga yuborish boshlanmoqda...`);
            const operator = await assignOperatorToRequest(request.brand_id, requestId);
            
            if (operator) {
                log.info(`[SUPERVISOR] [APPROVAL] ✅ Operator tayinlandi: OperatorId=${operator.user_id}, Name=${operator.fullname}`);
                
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
                    // Operatorning boshqa faol so'rovlarini tekshirish (bir vaqtda faqat bitta so'rov ko'rsatiladi)
                    // MUHIM: Joriy so'rovni (requestId) istisno qilish kerak
                    const { showRequestToOperator } = require('./operator.js');
                    const activeRequestsCount = await db('debt_requests')
                        .where('current_approver_id', operator.user_id)
                        .where('current_approver_type', 'operator')
                        .whereIn('status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER'])
                        .where('locked', false)
                        .where('id', '!=', requestId) // Joriy so'rovni istisno qilish
                        .count('* as count')
                        .first();
                    
                    const operatorPendingCount = activeRequestsCount ? parseInt(activeRequestsCount.count) : 0;
                    
                    // Operator user ma'lumotlarini olish
                    const operatorUser = await db('users').where('id', operator.user_id).first();
                    
                    // HAR DOIM joriy so'rovni yuborish (fullRequest)
                    // pendingCount = boshqa pending so'rovlar soni (joriy so'rovni istisno qilgan holda)
                    log.info(`[SUPERVISOR] [APPROVAL] Operatorlar guruhiga xabar yuborilmoqda: operatorId=${operator.user_id}, requestId=${requestId}, pendingCount=${operatorPendingCount}`);
                    await showRequestToOperator(fullRequest, operator.user_id, operatorUser || operator, operatorPendingCount);
                    log.info(`[SUPERVISOR] [APPROVAL] ✅ So'rov operatorga yuborildi: requestId=${requestId}, requestUID=${fullRequest.request_uid}, operatorId=${operator.user_id}, pendingCount=${operatorPendingCount}`);
                }
            } else {
                log.warn(`[SUPERVISOR] [APPROVAL] ⚠️ Operator topilmadi: requestId=${requestId}, brandId=${request.brand_id}`);
            }
        } else if (approvalStage === 'operator') {
            // Operatorlar bosqichidan keyin - final group'ga yuborish
            log.debug(`[SUPERVISOR] [APPROVAL] Final guruhga yuborish boshlanmoqda...`);
            await sendToFinalGroup(requestId);
            log.info(`[SUPERVISOR] [APPROVAL] ✅ So'rov final guruhga yuborildi: requestId=${requestId}`);
        }
        
        // Xabarni yangilash
        await updateRequestMessage(requestId, 'APPROVED_BY_SUPERVISOR', {
            username: user.username,
            fullname: user.fullname,
            approval_type: 'supervisor',
            approval_stage: approvalStage
        });
        
        // Supervisor'ga javob
        await bot.editMessageText(
            `✅ So'rov tasdiqlandi!\n\n📋 ID: ${request.request_uid}\n\n${approvalStage === 'cashier' ? 'Operatorga yuborildi.' : 'Final guruhga yuborildi.'}`,
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
        // ✅ Tasdiqlangan xabarni belgilash (saqlanib qolishi uchun)
        try {
            const { markAsApproved } = require('../utils/messageTracker.js');
            markAsApproved(chatId, query.message.message_id, requestId);
            log.debug(`[SUPERVISOR] [APPROVAL] Xabar tasdiqlangan sifatida belgilandi: chatId=${chatId}, messageId=${query.message.message_id}, requestId=${requestId}`);
        } catch (markError) {
            log.debug(`[SUPERVISOR] [APPROVAL] Xabarni belgilashda xatolik (ignored): ${markError.message}`);
        }
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextSupervisorRequest(userId, chatId);
        
        log.info(`[SUPERVISOR] [APPROVAL] ✅ Supervisor tasdiqlash yakunlandi: requestId=${requestId}, approvalStage=${approvalStage}, supervisorId=${user.id}`);
        
    } catch (error) {
        log.error(`[SUPERVISOR] [APPROVAL] ❌ Xatolik: requestId=${requestId}, error=${error.message}`, error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Keyingi pending so'rovni topish va ko'rsatish (supervisor uchun)
 * Avval yangi so'rovlarni (< 5 daqiqa), keyin eski so'rovlarni (> 5 daqiqa) ko'rsatadi
 */
async function showNextSupervisorRequest(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Supervisor task'larini olish
        const supervisorTasks = await db('debt_user_tasks')
            .where('user_id', user.id)
            .whereIn('task_type', ['approve_supervisor_cashier', 'approve_supervisor_operator'])
            .select('task_type', 'branch_id', 'brand_id');
        
        if (supervisorTasks.length === 0) {
            return;
        }
        
        // 5 daqiqa oldin vaqtni hisoblash
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        let nextRequest = null;
        
        // Avval yangi so'rovlarni qidirish (< 5 daqiqa)
        for (const task of supervisorTasks) {
            let query = db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .where('debt_requests.locked', false)
                .where('debt_requests.created_at', '>=', fiveMinutesAgo)
                .select(
                    'debt_requests.*',
                    'debt_brands.name as brand_name',
                    'debt_branches.name as filial_name',
                    'debt_svrs.name as svr_name'
                )
                .orderBy('debt_requests.created_at', 'asc');
            
            if (task.task_type === 'approve_supervisor_cashier') {
                query = query.where('debt_requests.status', 'APPROVED_BY_CASHIER');
                if (task.branch_id) {
                    query = query.where('debt_requests.branch_id', task.branch_id);
                }
            } else if (task.task_type === 'approve_supervisor_operator') {
                query = query.where('debt_requests.status', 'APPROVED_BY_OPERATOR');
                if (task.brand_id) {
                    query = query.where('debt_requests.brand_id', task.brand_id);
                }
            }
            
            const request = await query.first();
            if (request) {
                nextRequest = request;
                break;
            }
        }
        
        // Agar yangi so'rov topilmasa, eski so'rovlarni qidirish (> 5 daqiqa)
        if (!nextRequest) {
            for (const task of supervisorTasks) {
                let query = db('debt_requests')
                    .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                    .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                    .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                    .where('debt_requests.locked', false)
                    .where('debt_requests.created_at', '<', fiveMinutesAgo)
                    .select(
                        'debt_requests.*',
                        'debt_brands.name as brand_name',
                        'debt_branches.name as filial_name',
                        'debt_svrs.name as svr_name'
                    )
                    .orderBy('debt_requests.created_at', 'asc');
                
                if (task.task_type === 'approve_supervisor_cashier') {
                    query = query.where('debt_requests.status', 'APPROVED_BY_CASHIER');
                    if (task.branch_id) {
                        query = query.where('debt_requests.branch_id', task.branch_id);
                    }
                } else if (task.task_type === 'approve_supervisor_operator') {
                    query = query.where('debt_requests.status', 'APPROVED_BY_OPERATOR');
                    if (task.brand_id) {
                        query = query.where('debt_requests.brand_id', task.brand_id);
                    }
                }
                
                const request = await query.first();
                if (request) {
                    nextRequest = request;
                    break;
                }
            }
        }
        
        if (nextRequest) {
            // Approval stage'ni aniqlash
            const approvalStage = nextRequest.status === 'APPROVED_BY_CASHIER' ? 'cashier' : 'operator';
            
            // Boshqa kutilayotgan so'rovlar sonini hisoblash (joriy so'rovni istisno qilgan holda)
            let otherPendingCount = 0;
            for (const task of supervisorTasks) {
                let countQuery = db('debt_requests')
                    .where('locked', false)
                    .where('id', '!=', nextRequest.id);
                
                if (task.task_type === 'approve_supervisor_cashier') {
                    countQuery = countQuery.where('status', 'APPROVED_BY_CASHIER');
                    if (task.branch_id) {
                        countQuery = countQuery.where('branch_id', task.branch_id);
                    }
                } else if (task.task_type === 'approve_supervisor_operator') {
                    countQuery = countQuery.where('status', 'APPROVED_BY_OPERATOR');
                    if (task.brand_id) {
                        countQuery = countQuery.where('brand_id', task.brand_id);
                    }
                }
                
                const countResult = await countQuery.count('* as count').first();
                if (countResult && countResult.count) {
                    otherPendingCount += parseInt(countResult.count, 10);
                }
            }
            
            const pendingCount = otherPendingCount;
            
            log.info(`[SUPERVISOR] [SHOW_NEXT] Keyingi so'rov ko'rsatilmoqda: requestId=${nextRequest.id}, approvalStage=${approvalStage}, pendingCount=${pendingCount}`);
            
            // Supervisor'ga so'rovni ko'rsatish (bitta supervisor uchun)
            await showRequestToSupervisorSingle(nextRequest, chatId, user, approvalStage, pendingCount);
        } else {
            log.info(`[SUPERVISOR] [SHOW_NEXT] Keyingi so'rov topilmadi: userId=${userId}`);
        }
    } catch (error) {
        log.error('Error showing next supervisor request:', error);
    }
}

/**
 * Supervisor'ga so'rovni ko'rsatish (bitta supervisor uchun, navbatli ko'rsatish bilan)
 */
async function showRequestToSupervisorSingle(request, chatId, user, approvalStage = 'cashier', pendingCount = 0) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        // ✅ MUHIM: Joriy so'rovning allaqachon ko'rsatilgan xabarlarini tekshirish
        // Agar joriy so'rovning xabari allaqachon mavjud bo'lsa (va tasdiqlanmagan bo'lsa), yangi xabar yubormaslik
        const { hasActiveRequestMessage } = require('../utils/messageTracker.js');
        const hasActiveMessage = hasActiveRequestMessage(chatId, request.id);
        
        if (hasActiveMessage) {
            log.info(`[SUPERVISOR] [SHOW_REQUEST] ⚠️ Joriy so'rovning faol xabari mavjud, yangi xabar yuborilmaydi: requestId=${request.id}`);
            return;
        }
        
        // ✅ NAVBATLI KO'RSATISH: Supervisor'ning boshqa faol so'rovlarining xabarlarini o'chirish
        try {
            const { getRequestMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
            
            log.info(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] Eski so'rov xabarlarini qidirish boshlanmoqda: chatId=${chatId}, requestId=${request.id}`);
            
            // Eski so'rov xabarlarini o'chirish
            const messagesToDelete = getRequestMessagesToCleanup(chatId, []);
            
            log.info(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] Topilgan so'rov xabarlari: ${messagesToDelete.length} ta`);
            
            // Faqat so'nggi 10 ta xabarni o'chirish
            if (messagesToDelete.length > 0) {
                const messagesToDeleteNow = messagesToDelete.slice(-10);
                log.info(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] O'chiriladigan xabarlar: ${messagesToDeleteNow.length} ta (jami: ${messagesToDelete.length} ta)`);
                
                let deletedCount = 0;
                let errorCount = 0;
                
                for (const messageId of messagesToDeleteNow) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        untrackMessage(chatId, messageId);
                        deletedCount++;
                        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit uchun
                        log.debug(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] ✅ So'rov xabari o'chirildi: chatId=${chatId}, messageId=${messageId}`);
                    } catch (deleteError) {
                        // Silent fail - xabar allaqachon o'chirilgan bo'lishi mumkin
                        untrackMessage(chatId, messageId);
                        errorCount++;
                        log.debug(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] ⚠️ So'rov xabari o'chirishda xatolik (ignored): chatId=${chatId}, messageId=${messageId}, error=${deleteError.message}`);
                    }
                }
                
                log.info(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] ✅ O'chirish yakunlandi: deleted=${deletedCount}, errors=${errorCount}, total=${messagesToDeleteNow.length}`);
            } else {
                log.info(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] ℹ️ O'chiriladigan so'rov xabarlari yo'q`);
            }
        } catch (cleanupError) {
            // Silent fail - cleanup ixtiyoriy
            log.error(`[SUPERVISOR] [SHOW_REQUEST] [NAVBATLI] ❌ Eski so'rovlarni o'chirishda xatolik: chatId=${chatId}, error=${cleanupError.message}`, cleanupError);
        }
        
        // Xabar formatlash
        let message;
        if (request.type === 'SET' && request.excel_data) {
            // SET so'rov uchun formatSetRequestMessage
            let excelData = request.excel_data;
            let excelHeaders = request.excel_headers;
            let excelColumns = request.excel_columns;
            
            if (typeof excelData === 'string' && excelData) {
                try {
                    excelData = JSON.parse(excelData);
                } catch (e) {
                    excelData = null;
                }
            }
            
            if (typeof excelHeaders === 'string' && excelHeaders) {
                try {
                    excelHeaders = JSON.parse(excelHeaders);
                } catch (e) {
                    excelHeaders = null;
                }
            }
            
            if (typeof excelColumns === 'string' && excelColumns) {
                try {
                    excelColumns = JSON.parse(excelColumns);
                } catch (e) {
                    excelColumns = null;
                }
            }
            
            // Telegraph sahifa yaratish
            let telegraphUrl = null;
            if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                try {
                    const { createDebtDataPage } = require('../../../utils/telegraph.js');
                    telegraphUrl = await createDebtDataPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name || request.brand?.name,
                        filial_name: request.filial_name || request.filial?.name,
                        svr_name: request.svr_name || request.svr?.name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total
                    });
                } catch (telegraphError) {
                    log.debug(`[SUPERVISOR] [SHOW_REQUEST] Telegraph xatolik: requestId=${request.id}`);
                }
            }
            
            message = formatSetRequestMessage({
                brand_name: request.brand_name || request.brand?.name,
                filial_name: request.filial_name || request.filial?.name,
                svr_name: request.svr_name || request.svr?.name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: request.excel_total,
                is_for_operator: false,
                telegraph_url: telegraphUrl
            });
        } else {
            // Oddiy so'rov uchun formatNormalRequestMessage
            message = formatNormalRequestMessage({
                brand_name: request.brand_name || request.brand?.name,
                filial_name: request.filial_name || request.filial?.name,
                svr_name: request.svr_name || request.svr?.name,
                request_uid: request.request_uid
            });
        }
        
        // Approval stage bo'yicha qo'shimcha ma'lumot
        if (approvalStage === 'cashier') {
            message += `\n\n✅ Kasirlar tasdiqladi\n⚠️ Sizning tasdig'ingiz kutilmoqda (Nazoratchi)`;
        } else if (approvalStage === 'operator') {
            message += `\n\n✅ Operatorlar tasdiqladi\n⚠️ Sizning tasdig'ingiz kutilmoqda (Nazoratchi)`;
        }
        
        // Keyboard yaratish
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Tasdiqlash', callback_data: `supervisor_approve_${request.id}_${approvalStage}` },
                    { text: '⚠️ Qarzi bor', callback_data: `supervisor_debt_${request.id}_${approvalStage}` }
                ]
            ]
        };
        
        const sentMessage = await bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        // Reply keyboard'ni yangilash (pendingCount ga qarab)
        if (pendingCount > 0) {
            const replyKeyboard = {
                keyboard: [
                    [{ text: `⏰ Kutilayotgan so'rovlar (${pendingCount} ta)` }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            };
            
            const pendingMessage = await bot.sendMessage(chatId, `📋 Sizda ${pendingCount} ta kutilayotgan so'rov bor.`, {
                reply_markup: replyKeyboard
            });
            
            // "Kutilayotgan so'rovlar" xabarlarini track qilish (keyinchalik o'chirish uchun)
            try {
                const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                trackMessage(chatId, pendingMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true); // shouldCleanup=true - o'chirilishi kerak
            } catch (trackError) {
                // Silent fail
            }
        } else {
            // Agar kutilayotgan so'rovlar yo'q bo'lsa, reply keyboard'ni olib tashlash
            const removeKeyboard = {
                remove_keyboard: true
            };
        }
        
        // ✅ Xabarni messageTracker'ga qo'shish (pending so'rov - tasdiqlanmaguncha o'chirilishi mumkin)
        try {
            const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
            trackMessage(chatId, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true, request.id, false); // shouldCleanup=true, isApproved=false - pending so'rov
            log.debug(`[SUPERVISOR] [SHOW_REQUEST] Xabar kuzatishga qo'shildi: chatId=${chatId}, messageId=${sentMessage.message_id}, requestId=${request.id}`);
        } catch (trackError) {
            log.debug(`[SUPERVISOR] [SHOW_REQUEST] Xabarni kuzatishga qo'shishda xatolik (ignored): ${trackError.message}`);
        }
        
        log.info(`[SUPERVISOR] [SHOW_REQUEST] ✅ Supervisor'ga so'rov yuborildi: requestId=${request.id}, requestUID=${request.request_uid}, chatId=${chatId}, pendingCount=${pendingCount}`);
        
    } catch (error) {
        log.error(`[SUPERVISOR] [SHOW_REQUEST] ❌ Xatolik: requestId=${request.id}, error=${error.message}`, error);
        throw error;
    }
}

/**
 * Supervisor'ga kutilayotgan so'rovlarni ko'rsatish
 */
async function showPendingSupervisorRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Faol so'rovni tekshirish
        const activeRequest = await checkActiveSupervisorRequest(userId, chatId);
        
        if (activeRequest) {
            // Faol so'rov bor, bildirishnoma yuborish
            await getBot().sendMessage(chatId, '⚠️ Sizda hozirgi vaqtda faol so\'rov bor. Avval uni tugatishingiz kerak.');
            log.info(`[SUPERVISOR] [SHOW_PENDING] Faol so'rov bor, keyingi so'rovlar ko'rsatilmaydi: requestId=${activeRequest.id}, userId=${userId}`);
            return;
        }
        
        // Keyingi so'rovni ko'rsatish
        await showNextSupervisorRequest(userId, chatId);
    } catch (error) {
        log.error('Error showing pending supervisor requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Kutilinayotgan so'rovlarni ko'rsatish (knopka bosilganda)
 */
async function handleShowPendingRequests(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // Faol so'rovni tekshirish
        const activeRequest = await checkActiveSupervisorRequest(userId, chatId);
        
        if (activeRequest) {
            // Faol so'rov bor, bildirishnoma yuborish
            await bot.sendMessage(chatId, '⚠️ Sizda hozirgi vaqtda faol so\'rov bor. Avval uni tugatishingiz kerak.');
            log.info(`[SUPERVISOR] [SHOW_PENDING] Faol so'rov bor, keyingi so'rovlar ko'rsatilmaydi: requestId=${activeRequest.id}, userId=${userId}`);
            return;
        }
        
        // Faol so'rov yo'q, keyingi so'rovni ko'rsatish
        await showNextSupervisorRequest(userId, chatId);
    } catch (error) {
        log.error('Error showing pending requests:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

module.exports = {
    showRequestToSupervisor,
    handleSupervisorApproval,
    checkActiveSupervisorRequest,
    showNextSupervisorRequest,
    showPendingSupervisorRequests,
    handleShowPendingRequests,
    showRequestToSupervisorSingle
};

