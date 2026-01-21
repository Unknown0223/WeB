// bot/debt-approval/handlers/final-group.js
// Final guruh handler - barcha tasdiqlashlardan keyin final guruhga xabar yuborish

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { formatFinalGroupMessage, formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
const { getPreviousMonthName } = require('../../../utils/dateHelper.js');
const { getBot } = require('../../../utils/bot.js');

const log = createLogger('FINAL_GROUP');

/**
 * Final guruhga xabar yuborish
 */
async function sendToFinalGroup(requestId) {
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
        
        // Agar allaqachon FINAL_APPROVED bo'lsa, xabarni yangilash (ikkinchi marta yubormaslik)
        if (request.status === 'FINAL_APPROVED' && request.final_message_id) {
            log.info(`[FINAL_GROUP] So'rov allaqachon FINAL_APPROVED, xabarni yangilash: requestId=${requestId}, finalMessageId=${request.final_message_id}`);
            const { updateFinalGroupMessage } = require('../../../utils/messageUpdater.js');
            await updateFinalGroupMessage(request);
            return;
        }
        
        // Final guruh ma'lumotlarini olish
        const finalGroup = await db('debt_groups')
            .where('group_type', 'final')
            .where('is_active', true)
            .first();
        
        if (!finalGroup) {
            log.warn('Final group not found');
            return;
        }
        
        // Barcha tasdiqlashlarni olish (status='approved' va status='debt_marked' ikkalasini ham)
        const approvals = await db('debt_request_approvals')
            .join('users', 'debt_request_approvals.approver_id', 'users.id')
            .where('debt_request_approvals.request_id', request.id)
            .whereIn('debt_request_approvals.status', ['approved', 'debt_marked'])
            .orderBy('debt_request_approvals.created_at', 'asc')
            .select(
                'users.username',
                'users.fullname',
                'debt_request_approvals.approver_id',
                'debt_request_approvals.approval_type',
                'debt_request_approvals.status',
                'debt_request_approvals.created_at'
            );
        
        // Tasdiqlashlarni log qilish (debug uchun)
        log.info(`[FINAL_GROUP] Tasdiqlashlar soni: ${approvals.length}, requestId=${requestId}`);
        approvals.forEach((approval, index) => {
            log.info(`[FINAL_GROUP] Tasdiqlash ${index + 1}: approverId=${approval.approver_id}, fullname=${approval.fullname}, type=${approval.approval_type}, status=${approval.status}, createdAt=${approval.created_at}`);
        });
        
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
        const month_name = getPreviousMonthName();
        
        // Telegraph sahifa yaratish (agar Excel ma'lumotlari bo'lsa)
        let telegraphUrl = null;
        if (excel_data && excel_data.length > 0) {
            try {
                log.info(`[FINAL_GROUP] Telegraph sahifa yaratish boshlanmoqda: requestId=${requestId}, requestUID=${request.request_uid}`);
                const { createDebtDataPage } = require('../../../utils/telegraph.js');
                telegraphUrl = await createDebtDataPage({
                    request_id: requestId, // ✅ MUHIM: Mavjud URL'ni qayta ishlatish uchun
                    request_uid: request.request_uid,
                    brand_name: request.brand_name,
                    filial_name: request.filial_name,
                    svr_name: request.svr_name,
                    month_name: month_name,
                    extra_info: request.extra_info,
                    excel_data: excel_data,
                    excel_headers: excel_headers,
                    excel_columns: excel_columns,
                    total_amount: total_amount
                });
                if (telegraphUrl) {
                    log.info(`[FINAL_GROUP] ✅ Telegraph sahifa muvaffaqiyatli yaratildi: requestId=${requestId}, URL=${telegraphUrl}`);
                }
                // Agar sahifa yaratilmagan bo'lsa, log qilmaymiz (ixtiyoriy xizmat)
            } catch (telegraphError) {
                // Telegraph xatolari silent qilinadi (ixtiyoriy xizmat)
                log.debug(`[FINAL_GROUP] Telegraph sahifa yaratishda xatolik (ixtiyoriy xizmat): requestId=${requestId}`);
            }
        }
        
        // Request object'ga telegraphUrl va excel ma'lumotlarini qo'shish
        request.telegraph_url = telegraphUrl;
        request.excel_data = excel_data;
        request.excel_headers = excel_headers;
        request.excel_columns = excel_columns;
        
        // formatRequestMessageWithApprovals ishlatish - original xabar + tasdiqlashlar
        // ✅ MUHIM: Final guruh uchun 'final' roli bilan chaqirish (vaqt hisoblash uchun va link ko'rsatish uchun)
        const message = await formatRequestMessageWithApprovals(request, db, 'final');
        
        // Xabarni yuborish
        const bot = getBot();
        if (!bot) {
            log.warn('Bot mavjud emas');
            return;
        }
        
        const sentMessage = await bot.sendMessage(finalGroup.telegram_group_id, message, {
            parse_mode: 'HTML'
        });
        
        // Statusni FINAL_APPROVED ga o'zgartirish va final_message_id'ni saqlash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'FINAL_APPROVED',
                final_message_id: sentMessage.message_id,
                updated_at: db.fn.now()
            });
        
        log.info(`Message sent to final group: requestId=${requestId}, messageId=${sentMessage.message_id}, status=FINAL_APPROVED`);
        
        // Arxivlash - FINAL_APPROVED bo'lganda Excel ma'lumotlarini arxivlash
        try {
            const { archiveAcceptedRequestData } = require('../../../utils/debtDataArchiver.js');
            await archiveAcceptedRequestData(requestId);
        } catch (archiveError) {
            log.error(`[FINAL_GROUP] Arxivlashda xatolik: requestId=${requestId}`, archiveError);
            // Arxivlash xatosi so'rovni to'xtatmaydi
        }
        
        return sentMessage;
    } catch (error) {
        log.error('Error sending to final group:', error);
        throw error;
    }
}

/**
 * Final guruhdagi xabarni real-time yangilash
 */
async function updateFinalGroupMessageRealTime(requestId, newApproverInfo) {
    try {
        const { updateFinalGroupMessage } = require('../../../utils/messageUpdater.js');
        
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
            return;
        }
        
        await updateFinalGroupMessage(request, newApproverInfo);
        
        log.debug(`Final group message updated in real-time: requestId=${requestId}`);
    } catch (error) {
        log.error('Error updating final group message in real-time:', error);
    }
}

module.exports = {
    sendToFinalGroup,
    updateFinalGroupMessageRealTime
};

