// bot/debt-approval/handlers/leader.js
// Rahbar FSM handlers - SET so'rovlarni ko'rish, tasdiqlash, bekor qilish

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { formatSetRequestMessage, formatApprovalMessage, formatRejectionMessage } = require('../../../utils/messageTemplates.js');
const { isUserInGroup } = require('../../../utils/groupValidator.js');
const { logRequestAction, logApproval } = require('../../../utils/auditLogger.js');
const { updateRequestMessage } = require('../../../utils/messageUpdater.js');
const { assignCashierToRequest } = require('../../../utils/cashierAssignment.js');
const { scheduleReminder, cancelReminders } = require('../../../utils/debtReminder.js');

const log = createLogger('LEADER');

// FSM states
const STATES = {
    IDLE: 'idle',
    VIEW_SET_REQUEST: 'view_set_request',
    PREVIEW_APPROVAL: 'preview_approval',
    ENTER_REJECTION_REASON: 'enter_rejection_reason'
};

/**
 * Rahbarlarga kelgan SET so'rovlarni ko'rsatish
 */
async function showLeaderRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Rahbarlar guruhini olish
        const leadersGroup = await db('debt_groups')
            .where('group_type', 'leaders')
            .where('is_active', true)
            .first();
        
        if (!leadersGroup) {
            await getBot().sendMessage(chatId, '❌ Rahbarlar guruhi topilmadi.');
            return;
        }
        
        // Foydalanuvchi guruhda ekanligini yoki debt_user_tasks jadvalidan rahbar vazifasiga ega ekanligini tekshirish
        const userInGroup = await isUserInGroup(user.id, 'leaders');
        
        // debt_user_tasks jadvalidan rahbar vazifasini tekshirish
        const leaderTask = await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                this.where('task_type', 'approve_leader')
                    .orWhere('task_type', 'debt:approve_leader');
            })
            .first();
        
        if (!userInGroup && !leaderTask) {
            await getBot().sendMessage(chatId, '❌ Siz rahbarlar guruhida emassiz va rahbar vazifasiga ham ega emassiz.');
            return;
        }
        
        
        // SET so'rovlarni olish
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.type', 'SET')
            .where('debt_requests.status', 'SET_PENDING')
            .where('debt_requests.locked', false)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'desc')
            .limit(10);
        
        if (requests.length === 0) {
            await getBot().sendMessage(chatId, '📭 Hozircha yangi SET so\'rovlar yo\'q.');
            return;
        }
        
        // So'rovlarni guruhga ko'rsatish
        for (const request of requests) {
            await showSetRequestToLeaders(request, leadersGroup.telegram_group_id);
        }
    } catch (error) {
        log.error('Error showing leader requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * SET so'rovni rahbarlarga ko'rsatish
 */
async function showSetRequestToLeaders(request, groupId) {
    try {
        const bot = getBot();
        if (!bot) {
            log.error(`[LEADER] [SHOW_REQUEST] ❌ Bot topilmadi: requestId=${request.id}`);
            return;
        }
        
        // Excel ma'lumotlarini parse qilish (agar string bo'lsa)
        let excelData = request.excel_data;
        let excelHeaders = request.excel_headers;
        let excelColumns = request.excel_columns;
        
        if (typeof excelData === 'string' && excelData) {
            try {
                excelData = JSON.parse(excelData);
            } catch (e) {
                excelData = null;
                log.warn(`[LEADER] [SHOW_REQUEST] Excel data parse qilishda xatolik: ${e.message}`);
            }
        }
        
        if (typeof excelHeaders === 'string' && excelHeaders) {
            try {
                excelHeaders = JSON.parse(excelHeaders);
            } catch (e) {
                excelHeaders = null;
                log.warn(`[LEADER] [SHOW_REQUEST] Excel headers parse qilishda xatolik: ${e.message}`);
            }
        }
        
        if (typeof excelColumns === 'string' && excelColumns) {
            try {
                excelColumns = JSON.parse(excelColumns);
            } catch (e) {
                excelColumns = null;
                log.warn(`[LEADER] [SHOW_REQUEST] Excel columns parse qilishda xatolik: ${e.message}`);
            }
        }
        
        // Telegraph sahifasini yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
        let telegraphUrl = null;
        if (excelData && Array.isArray(excelData) && excelData.length > 0) {
            try {
                const { createDebtDataPage } = require('../../../utils/telegraph.js');
                telegraphUrl = await createDebtDataPage({
                    request_uid: request.request_uid,
                    brand_name: request.brand_name,
                    filial_name: request.filial_name,
                    svr_name: request.svr_name,
                    month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                    extra_info: request.extra_info,
                    excel_data: excelData,
                    excel_headers: excelHeaders,
                    excel_columns: excelColumns,
                    total_amount: request.excel_total
                });
                if (telegraphUrl) {
                    log.info(`[LEADER] [TELEGRAPH] ✅ Sahifa yaratildi: requestId=${request.id}, URL=${telegraphUrl}`);
                } else {
                    log.warn(`[LEADER] [TELEGRAPH] ⚠️ Sahifa yaratilmadi: requestId=${request.id}`);
                }
            } catch (telegraphError) {
                log.error(`[LEADER] [TELEGRAPH] Xatolik: requestId=${request.id}`, telegraphError);
            }
        }
        
        const message = formatSetRequestMessage({
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            extra_info: request.extra_info,
            request_uid: request.request_uid,
            excel_data: excelData,
            excel_headers: excelHeaders,
            excel_columns: excelColumns,
            excel_total: request.excel_total,
            telegraph_url: telegraphUrl
        });
        
        // Keyboard yaratish - faqat Tasdiqlash va Bekor qilish knopkalari
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash', callback_data: `leader_approve_${request.id}` }],
                [{ text: '❌ Bekor qilish', callback_data: `leader_reject_${request.id}` }]
            ]
        };
        
        await bot.sendMessage(groupId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        // MUHIM: preview_message_id ni O'ZGARTIRMASLIK!
        // preview_message_id menejerga yuborilgan xabar uchun saqlanadi
        // Rahbarlar guruhidagi xabar ID'sini alohida saqlash kerak (leaders_message_id field'i yo'q)
        // Shuning uchun, rahbarlar guruhidagi xabar ID'sini handleLeaderApproval funksiyasida olamiz
        // Bu yerda faqat log qilamiz
        
    } catch (error) {
        log.error(`[LEADER] [SHOW_REQUEST] ❌ Rahbarlarga SET so'rov ko'rsatishda xatolik: requestId=${request.id}, groupId=${groupId}, error=${error.message}`, error);
        log.error(`[LEADER] [SHOW_REQUEST] Xatolik stack trace:`, error.stack);
    }
}

/**
 * Qarzdorliklar ro'yxatini ko'rsatish
 */
async function handleShowDebtList(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Yuborilmoqda...' });
        
        log.info(`[LEADER] [SHOW_DEBT_LIST] Qarzdorliklar ro'yxatini ko'rsatish: requestId=${requestId}, userId=${userId}`);
        
        // So'rov ma'lumotlarini olish
        const request = await db('debt_requests')
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
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // Excel ma'lumotlarini parse qilish
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
        
        if (!excelData || !Array.isArray(excelData) || excelData.length === 0 || !excelColumns) {
            await bot.sendMessage(chatId, '❌ Qarzdorliklar ro\'yxati topilmadi.');
            return;
        }
        
        // Barcha qarzdorliklarni formatlash (maxRows parametrini juda katta qilamiz)
        const { formatExcelData } = require('../../../utils/excelParser.js');
        const formattedData = formatExcelData(excelData, excelColumns, excelHeaders, excelData.length);
        
        // Xabar yaratish
        const message = `📊 <b>Qarzdorliklar ro'yxati</b>\n\n` +
            `So'rov ID: ${request.request_uid}\n` +
            `Brend: ${request.brand_name}\n` +
            `Filial: ${request.filial_name}\n` +
            `SVR: ${request.svr_name}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            formattedData;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        
        log.info(`[LEADER] [SHOW_DEBT_LIST] ✅ Qarzdorliklar ro'yxati ko'rsatildi: requestId=${requestId}, totalItems=${excelData.length}`);
    } catch (error) {
        log.error(`[LEADER] [SHOW_DEBT_LIST] Xatolik:`, error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Rahbar tasdiqlash
 */
async function handleLeaderApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            log.error(`[LEADER] [APPROVAL] ❌ Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Foydalanuvchi guruhda ekanligini yoki debt_user_tasks jadvalidan rahbar vazifasiga ega ekanligini tekshirish
        const userInGroup = await isUserInGroup(user.id, 'leaders');
        
        // debt_user_tasks jadvalidan rahbar vazifasini tekshirish
        const leaderTask = await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                this.where('task_type', 'approve_leader')
                    .orWhere('task_type', 'debt:approve_leader');
            })
            .first();
        
        if (!userInGroup && !leaderTask) {
            log.warn(`[LEADER] [APPROVAL] ❌ Foydalanuvchi rahbarlar guruhida emas va rahbar vazifasiga ham ega emas: userId=${user.id}`);
            await bot.sendMessage(chatId, '❌ Siz rahbarlar guruhida emassiz va rahbar vazifasiga ham ega emassiz.');
            return;
        }
        
        // So'rovni olish (brand, branch, svr ma'lumotlari bilan)
        const request = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.id', requestId)
            .where('debt_requests.type', 'SET')
            .where('debt_requests.status', 'SET_PENDING')
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .first();
        
        if (!request) {
            log.warn(`[LEADER] [APPROVAL] ❌ So'rov topilmadi yoki status to'g'ri emas: requestId=${requestId}`);
            await bot.answerCallbackQuery(query.id, { 
                text: 'So\'rov topilmadi yoki allaqachon tasdiqlangan.',
                show_alert: true 
            });
            return;
        }
        
        // So'rovni bloklash (boshqa rahbar tasdiqlamasligi uchun)
        await db('debt_requests')
            .where('id', requestId)
            .update({
                locked: true,
                locked_by: user.id,
                locked_at: db.fn.now()
            });
        
        // Tasdiqlashni log qilish
        await logApproval(requestId, user.id, 'leader', 'approved', {});
        await logRequestAction(requestId, 'leader_approved', user.id, {
            new_status: 'APPROVED_BY_LEADER'
        });
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_LEADER',
                locked: false,
                locked_by: null,
                locked_at: null
            });
        
        // Kassir tayinlash
        const cashier = await assignCashierToRequest(request.branch_id, requestId);
        
        if (!cashier) {
            log.warn(`[LEADER] [APPROVAL] ❌ Kassir tayinlanmadi: branchId=${request.branch_id}`);
        }
        
        // Kassirga xabar yuborish (agar mavjud bo'lsa)
        if (cashier && cashier.telegram_chat_id) {
            // Kassirda hozircha boshqa so'rovlar bor-yo'qligini tekshirish
            const { getCashierBranches, showRequestToCashier } = require('./cashier.js');
            const cashierBranches = await getCashierBranches(cashier.user_id);
            
            if (cashierBranches.length === 0) {
                log.warn(`[LEADER] [APPROVAL] Kassirga biriktirilgan filiallar topilmadi: cashierId=${cashier.user_id}`);
            } else {
                const existingRequests = await db('debt_requests')
                    .whereIn('branch_id', cashierBranches)
                    .where('current_approver_id', cashier.user_id)
                    .where('current_approver_type', 'cashier')
                    .whereIn('status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
                    .where('locked', false)
                    .where('id', '!=', requestId)
                    .count('* as count')
                    .first();
                
                const hasOtherRequests = existingRequests && parseInt(existingRequests.count) > 0;
                
                if (!hasOtherRequests) {
                    const cashierUser = await db('users').where('id', cashier.user_id).first();
                    await showRequestToCashier(request, cashier.telegram_chat_id, cashierUser || cashier);
                }
            }
        } else {
            log.warn(`[LEADER] [APPROVAL] ⚠️ Kassirga xabar yuborilmadi: cashier=${cashier ? 'mavjud' : 'yo\'q'}, telegramChatId=${cashier?.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
        }
        
        // Rahbarlar guruhidagi xabarni yangilash (Excel ma'lumotlari va tasdiqlash ma'lumotlari bilan)
        // Eslatma: preview_message_id menejerga yuborilgan xabar uchun saqlanadi
        // Rahbarlar guruhidagi xabar ID'sini query.message.message_id dan olamiz
        const leadersGroup = await db('debt_groups')
            .where('group_type', 'leaders')
            .where('is_active', true)
            .first();
        
        // Rahbarlar guruhidagi xabar ID'sini query.message.message_id dan olamiz
        const leadersMessageId = query.message.message_id;
        
        if (leadersGroup && leadersMessageId) {
            // Excel ma'lumotlarini parse qilish
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
            
            // Tasdiqlash ma'lumotlarini olish
            const approvals = await db('debt_request_approvals')
                .join('users', 'debt_request_approvals.approver_id', 'users.id')
                .where('debt_request_approvals.request_id', requestId)
                .where('debt_request_approvals.status', 'approved')
                .orderBy('debt_request_approvals.created_at', 'asc')
                .select(
                    'users.username',
                    'users.fullname',
                    'debt_request_approvals.approval_type',
                    'debt_request_approvals.created_at'
                );
            
            if (leadersGroup && leadersMessageId) {
                // Xabarni yangilash
                const updatedMessage = formatSetRequestMessage({
                    brand_name: request.brand_name,
                    filial_name: request.filial_name,
                    svr_name: request.svr_name,
                    extra_info: request.extra_info,
                    request_uid: request.request_uid,
                    excel_data: excelData,
                    excel_headers: excelHeaders,
                    excel_columns: excelColumns,
                    excel_total: request.excel_total,
                    approvals: approvals
                });
                
                try {
                    // Knopkalarni olib tashlash (tasdiqlashdan keyin)
                    await bot.editMessageText(
                        updatedMessage,
                        {
                            chat_id: leadersGroup.telegram_group_id,
                            message_id: leadersMessageId, // Rahbarlar guruhidagi xabar ID'si
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: [] } // Knopkalarni olib tashlash
                        }
                    );
                    log.info(`[LEADER] ✅ Leaders group message updated: requestId=${requestId}, messageId=${leadersMessageId}, groupId=${leadersGroup.telegram_group_id}`);
                } catch (error) {
                    log.warn(`[LEADER] ⚠️ Could not update leaders group message: requestId=${requestId}, messageId=${leadersMessageId}, error=${error.message}`);
                }
            }
        }
        
        
        // Xabarni yangilash (preview uchun - menejerga)
        log.debug(`[LEADER] [APPROVAL] 9. Xabarni yangilash (menejerga)...`);
        await updateRequestMessage(requestId, 'APPROVED_BY_LEADER', {
            username: user.username,
            fullname: user.fullname,
            approval_type: 'leader'
        });
        
        log.info(`[LEADER] [APPROVAL] 9.1. ✅ Xabar yangilandi`);
        
        // Eslatmalarni to'xtatish
        log.debug(`[LEADER] [APPROVAL] 10. Eslatmalarni to'xtatish...`);
        cancelReminders(requestId);
        log.info(`[LEADER] [APPROVAL] 10.1. ✅ Eslatmalar to'xtatildi`);
        
        log.info(`Leader approved: requestId=${requestId}, leaderId=${user.id}`);
    } catch (error) {
        log.error('Error handling leader approval:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Rahbar bekor qilish
 */
async function handleLeaderRejection(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Foydalanuvchi guruhda ekanligini yoki debt_user_tasks jadvalidan rahbar vazifasiga ega ekanligini tekshirish
        const userInGroup = await isUserInGroup(user.id, 'leaders');
        
        // debt_user_tasks jadvalidan rahbar vazifasini tekshirish
        const leaderTask = await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                this.where('task_type', 'approve_leader')
                    .orWhere('task_type', 'debt:approve_leader');
            })
            .first();
        
        if (!userInGroup && !leaderTask) {
            await bot.sendMessage(chatId, '❌ Siz rahbarlar guruhida emassiz va rahbar vazifasiga ham ega emassiz.');
            return;
        }
        
        if (leaderTask) {
            log.info(`[LEADER] [REJECTION] Foydalanuvchi rahbar vazifasiga ega (taskId=${leaderTask.id}, taskType=${leaderTask.task_type})`);
        }
        
        // So'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .where('type', 'SET')
            .where('status', 'SET_PENDING')
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki allaqachon tasdiqlangan.');
            return;
        }
        
        // State'ni boshlash (sabab kiritish uchun)
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.ENTER_REJECTION_REASON, {
            request_id: requestId
        });
        
        await bot.sendMessage(
            chatId,
            '❌ <b>So\'rovni bekor qilish</b>\n\n' +
            'Bekor qilish sababini kiriting:',
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Bekor qilish', callback_data: `leader_reject_cancel_${requestId}` }]
                    ]
                }
            }
        );
    } catch (error) {
        log.error('Error handling leader rejection:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Bekor qilish sababini qabul qilish
 */
async function handleRejectionReason(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const reason = msg.text;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.ENTER_REJECTION_REASON) {
            return false;
        }
        
        const requestId = state.data.request_id;
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return false;
        }
        
        // So'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .where('type', 'SET')
            .where('status', 'SET_PENDING')
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki allaqachon tasdiqlangan.');
            stateManager.clearUserState(userId);
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
        
        // Bekor qilishni log qilish
        await logApproval(requestId, user.id, 'leader', 'rejected', {
            note: reason
        });
        await logRequestAction(requestId, 'leader_rejected', user.id, {
            new_status: 'REJECTED',
            note: reason
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
        
        // Xabarni yangilash
        const rejectionMessage = formatRejectionMessage({
            request_uid: request.request_uid,
            username: user.username,
            fullname: user.fullname,
            reason: reason,
            timestamp: new Date().toISOString()
        });
        
        // Guruhdagi xabarni yangilash
        const leadersGroup = await db('debt_groups')
            .where('group_type', 'leaders')
            .where('is_active', true)
            .first();
        
        // Rahbarlar guruhidagi xabar ID'sini state'dan yoki request'dan olamiz
        // Agar state'da saqlangan bo'lsa, undan olamiz, aks holda request'dan olamiz
        const leadersMessageId = state.data?.leaders_message_id || null;
        
        if (leadersGroup && leadersMessageId) {
            try {
                await bot.editMessageText(
                    rejectionMessage,
                    {
                        chat_id: leadersGroup.telegram_group_id,
                        message_id: leadersMessageId, // Rahbarlar guruhidagi xabar ID'si
                        parse_mode: 'HTML'
                    }
                );
            } catch (error) {
                log.warn(`[LEADER] Could not update rejection message: requestId=${requestId}, messageId=${leadersMessageId}, error=${error.message}`);
            }
        }
        
        // Menejerga xabar yuborish
        const manager = await db('users').where('id', request.created_by).first();
        if (manager && manager.telegram_chat_id) {
            await bot.sendMessage(manager.telegram_chat_id, rejectionMessage, {
                parse_mode: 'HTML'
            });
        }
        
        // Eslatmalarni to'xtatish
        cancelReminders(requestId);
        
        // State'ni tozalash
        stateManager.clearUserState(userId);
        
        await bot.sendMessage(chatId, '✅ So\'rov bekor qilindi.');
        
        log.info(`Leader rejected: requestId=${requestId}, leaderId=${user.id}, reason=${reason}`);
        
        return true;
    } catch (error) {
        log.error('Error handling rejection reason:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
    }
}

module.exports = {
    showLeaderRequests,
    showSetRequestToLeaders,
    handleShowDebtList,
    handleLeaderApproval,
    handleLeaderRejection,
    handleRejectionReason,
    STATES
};

