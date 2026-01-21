// utils/messageUpdater.js
// Xabar yangilanishi - har bir tasdiqlashda xabarni yangilash

const { getBot } = require('./bot.js');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const { formatFinalGroupMessage, formatApprovalMessage } = require('./messageTemplates.js');

const log = createLogger('MSG_UPDATER');

/**
 * So'rov xabarni yangilash
 */
async function updateRequestMessage(requestId, newStatus, approverInfo) {
    try {
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
            log.warn(`Request not found: requestId=${requestId}`);
            return;
        }
        
        const bot = getBot();
        if (!bot) {
            log.warn('Bot mavjud emas');
            return;
        }
        
        // Agar final_message_id mavjud bo'lsa, final guruhdagi xabarni yangilash
        if (request.final_message_id) {
            await updateFinalGroupMessage(request, approverInfo);
        }
        
        // Preview xabarni yangilash (agar mavjud bo'lsa)
        if (request.preview_message_id) {
            await updatePreviewMessage(request, newStatus, approverInfo);
        }
        
        log.debug(`Request message updated: requestId=${requestId}, status=${newStatus}`);
    } catch (error) {
        log.error('Error updating request message:', error);
        throw error;
    }
}

/**
 * Final guruhdagi xabarni yangilash
 */
async function updateFinalGroupMessage(request, approverInfo) {
    try {
        // Final guruh ma'lumotlarini olish
        const finalGroup = await db('debt_groups')
            .where('group_type', 'final')
            .where('is_active', true)
            .first();
        
        if (!finalGroup || !request.final_message_id) {
            return;
        }
        
        // Barcha tasdiqlashlarni olish
        const approvals = await db('debt_request_approvals')
            .join('users', 'debt_request_approvals.approver_id', 'users.id')
            .where('debt_request_approvals.request_id', request.id)
            .where('debt_request_approvals.status', 'approved')
            .orderBy('debt_request_approvals.created_at', 'asc')
            .select(
                'users.username',
                'users.fullname',
                'debt_request_approvals.approval_type',
                'debt_request_approvals.created_at'
            );
        
        // Excel ma'lumotlarini olish va parse qilish
        let excel_data = null;
        let excel_headers = null;
        let excel_columns = null;
        let total_amount = null;
        
        if (request.excel_data) {
            // Agar string bo'lsa, parse qilish
            if (typeof request.excel_data === 'string' && request.excel_data) {
                try {
                    excel_data = JSON.parse(request.excel_data);
                } catch (e) {
                    excel_data = null;
                }
            } else {
                excel_data = request.excel_data;
            }
            
            if (typeof request.excel_headers === 'string' && request.excel_headers) {
                try {
                    excel_headers = JSON.parse(request.excel_headers);
                } catch (e) {
                    excel_headers = [];
                }
            } else {
                excel_headers = request.excel_headers || [];
            }
            
            if (typeof request.excel_columns === 'string' && request.excel_columns) {
                try {
                    excel_columns = JSON.parse(request.excel_columns);
                } catch (e) {
                    excel_columns = {};
                }
            } else {
                excel_columns = request.excel_columns || {};
            }
            
            total_amount = request.excel_total;
        }
        
        // Xabarni formatlash
        const { getPreviousMonthName } = require('./dateHelper.js');
        const month_name = getPreviousMonthName();
        
        const message = formatFinalGroupMessage({
            request_uid: request.request_uid,
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            month_name: month_name,
            extra_info: request.extra_info,
            approvals: approvals,
            total_amount: total_amount,
            excel_data: excel_data,
            excel_headers: excel_headers,
            excel_columns: excel_columns
        });
        
        // Xabarni yangilash
        const bot = getBot();
        try {
            await bot.editMessageText(message, {
                chat_id: finalGroup.telegram_group_id,
                message_id: request.final_message_id,
                parse_mode: 'HTML'
            });
            
            log.debug(`Final group message updated: requestId=${request.id}, messageId=${request.final_message_id}`);
        } catch (error) {
            // Agar xabarni yangilab bo'lmasa (masalan, o'chirilgan bo'lsa yoki bir xil bo'lsa), e'tiborsiz qoldirish
            if (error.message.includes('message is not modified')) {
                // Xabar bir xil bo'lsa, bu xatolik emas
                log.debug(`Final group message unchanged: requestId=${request.id}`);
            } else {
                log.debug(`Could not update final group message: requestId=${request.id}, error=${error.message}`);
            }
        }
    } catch (error) {
        log.error('Error updating final group message:', error);
    }
}

/**
 * Preview xabarni yangilash (menejerga yuborilgan xabarni yangilash)
 */
async function updatePreviewMessage(request, newStatus, approverInfo) {
    try {
        const bot = getBot();
        if (!bot) {
            log.warn('Bot mavjud emas');
            return;
        }
        
        // Menejerni olish (preview_chat_id mavjud bo'lsa, undan foydalanish)
        const chatId = request.preview_chat_id || (await db('users').where('id', request.created_by).first())?.telegram_chat_id;
        if (!chatId || !request.preview_message_id) {
            log.debug(`[MSG_UPDATER] Preview message not found: chatId=${chatId}, messageId=${request.preview_message_id}, requestId=${request.id}`);
            return;
        }
        
        log.debug(`[MSG_UPDATER] Updating preview message: requestId=${request.id}, chatId=${chatId}, messageId=${request.preview_message_id}, newStatus=${newStatus}`);
        
        // Barcha tasdiqlashlarni olish
        const approvals = await db('debt_request_approvals')
            .join('users', 'debt_request_approvals.approver_id', 'users.id')
            .where('debt_request_approvals.request_id', request.id)
            .where('debt_request_approvals.status', 'approved')
            .orderBy('debt_request_approvals.created_at', 'asc')
            .select(
                'users.username',
                'users.fullname',
                'debt_request_approvals.approval_type',
                'debt_request_approvals.created_at'
            );
        
        // Status nomlarini formatlash
        const statusNames = {
            'PENDING_APPROVAL': 'Kassir kutmoqda',
            'SET_PENDING': 'Rahbarlar kutmoqda',
            'APPROVED_BY_LEADER': 'Rahbarlar tasdiqladi',
            'APPROVED_BY_CASHIER': 'Kassir tasdiqladi',
            'APPROVED_BY_OPERATOR': 'Operator tasdiqladi',
            'CANCELLED': 'Bekor qilindi',
            'DEBT_FOUND': 'Qarzdorlik topildi',
            'DIFFERENCE_FOUND': 'Farq topildi'
        };
        
        // So'rov turiga qarab tasdiqlash jarayonini ko'rsatish - har bir bosqich yonida status
        let approvalFlow = '';
        
        // Status belgilari
        const getStepStatus = (stepNumber, currentStatus, requestType) => {
            if (requestType === 'SET') {
                if (stepNumber === 1) {
                    // Rahbarlar guruhi
                    if (currentStatus === 'SET_PENDING') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_LEADER' || currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 2) {
                    // Kassir
                    if (currentStatus === 'APPROVED_BY_LEADER') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 3) {
                    // Operator
                    if (currentStatus === 'APPROVED_BY_CASHIER') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 4) {
                    // Final guruh
                    if (currentStatus === 'APPROVED_BY_OPERATOR') return '<code>jarayonda</code>';
                    if (currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                }
            } else {
                // NORMAL so'rov
                if (stepNumber === 1) {
                    // Kassir
                    if (currentStatus === 'PENDING_APPROVAL') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 2) {
                    // Operator
                    if (currentStatus === 'APPROVED_BY_CASHIER') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 3) {
                    // Final guruh
                    if (currentStatus === 'APPROVED_BY_OPERATOR') return '<code>jarayonda</code>';
                    if (currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                }
            }
            return '<code>kutilyabdi</code>';
        };
        
        if (request.type === 'SET') {
            approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
                `1️⃣ <b>Rahbarlar guruhi</b> - ${getStepStatus(1, newStatus, 'SET')}\n` +
                `2️⃣ <b>Kassir</b> - ${getStepStatus(2, newStatus, 'SET')}\n` +
                `3️⃣ <b>Operator</b> - ${getStepStatus(3, newStatus, 'SET')}\n` +
                `4️⃣ <b>Final guruh</b> - ${getStepStatus(4, newStatus, 'SET')}`;
        } else {
            approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
                `1️⃣ <b>Kassir</b> - ${getStepStatus(1, newStatus, 'NORMAL')}\n` +
                `2️⃣ <b>Operator</b> - ${getStepStatus(2, newStatus, 'NORMAL')}\n` +
                `3️⃣ <b>Final guruh</b> - ${getStepStatus(3, newStatus, 'NORMAL')}`;
        }
        
        // Tasdiqlashlar ro'yxati
        let approvalsText = '';
        if (approvals.length > 0) {
            approvalsText = `\n\n✅ <b>Tasdiqlanganlar:</b>\n`;
            approvals.forEach((approval, index) => {
                const approverName = approval.fullname || approval.username || 'Noma\'lum';
                const approvalType = approval.approval_type === 'leader' ? 'Rahbar' :
                                   approval.approval_type === 'cashier' ? 'Kassir' :
                                   approval.approval_type === 'operator' ? 'Operator' : approval.approval_type;
                approvalsText += `${index + 1}. ${approvalType}: ${approverName}\n`;
            });
        }
        
        // Xabarni formatlash
        const message = `✅ <b>So'rov muvaffaqiyatli yaratildi!</b>\n\n` +
            `📋 <b>ID:</b> ${request.request_uid}\n` +
            `📋 <b>Turi:</b> ${request.type === 'SET' ? 'SET (Muddat uzaytirish)' : 'ODDIY'}\n` +
            approvalFlow +
            approvalsText;
        
        // Xabarni yangilash
        try {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: request.preview_message_id,
                parse_mode: 'HTML'
            });
            
            log.info(`[MSG_UPDATER] ✅ Preview message updated: requestId=${request.id}, status=${newStatus}, chatId=${chatId}, messageId=${request.preview_message_id}`);
        } catch (error) {
            // Agar xabarni yangilab bo'lmasa (masalan, o'chirilgan bo'lsa), e'tiborsiz qoldirish
            log.warn(`[MSG_UPDATER] ⚠️ Could not update preview message: requestId=${request.id}, chatId=${chatId}, messageId=${request.preview_message_id}, error=${error.message}`);
            
            // Agar xabar topilmasa, preview_message_id ni null qilish (keyingi safar yangi xabar yuborish uchun)
            if (error.message.includes('message to edit not found') || error.message.includes('message not found')) {
                try {
                    await db('debt_requests')
                        .where('id', request.id)
                        .update({
                            preview_message_id: null,
                            preview_chat_id: null
                        });
                    log.debug(`[MSG_UPDATER] Preview message_id cleared: requestId=${request.id}`);
                } catch (dbError) {
                    log.warn(`[MSG_UPDATER] Could not clear preview_message_id: ${dbError.message}`);
                }
            }
        }
    } catch (error) {
        log.error('Error updating preview message:', error);
    }
}

/**
 * Tasdiqlash xabarini qo'shish
 */
async function addApprovalToMessage(requestId, approverInfo) {
    try {
        const request = await db('debt_requests').where('id', requestId).first();
        if (!request) {
            return;
        }
        
        // Tasdiqlash xabarini formatlash
        const approvalMessage = formatApprovalMessage({
            request_uid: request.request_uid,
            username: approverInfo.username,
            fullname: approverInfo.fullname,
            timestamp: new Date().toISOString(),
            approval_type: approverInfo.approval_type
        });
        
        // Final guruhdagi xabarni yangilash
        await updateFinalGroupMessage(request, approverInfo);
        
        log.debug(`Approval added to message: requestId=${requestId}`);
    } catch (error) {
        log.error('Error adding approval to message:', error);
    }
}

module.exports = {
    updateRequestMessage,
    updateFinalGroupMessage,
    updatePreviewMessage,
    addApprovalToMessage
};

