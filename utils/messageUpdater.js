// utils/messageUpdater.js
// Xabar yangilanishi - har bir tasdiqlashda xabarni yangilash

const { getBot } = require('./bot.js');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const { formatFinalGroupMessage, formatApprovalMessage, formatRequestMessageWithApprovals, formatNormalRequestMessage, formatSetRequestMessage } = require('./messageTemplates.js');

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
        
        // Excel ma'lumotlarini olish va parse qilish
        let excel_data = null;
        let excel_headers = null;
        let excel_columns = null;
        
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
        }
        
        // Xabarni formatlash
        const { getPreviousMonthName } = require('./dateHelper.js');
        const month_name = getPreviousMonthName();
        
        // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
        // Final guruh uchun: klient bo'yicha sahifa, xabarda faqat link
        let telegraphUrl = request.telegraph_url || null;
        if (!telegraphUrl && excel_data && excel_data.length > 0) {
            try {
                const { createDebtDataPage } = require('./telegraph.js');
                telegraphUrl = await createDebtDataPage({
                    request_id: request.id,
                    request_uid: request.request_uid,
                    brand_name: request.brand_name,
                    filial_name: request.filial_name,
                    svr_name: request.svr_name,
                    month_name: month_name,
                    extra_info: request.extra_info,
                    excel_data: excel_data,
                    excel_headers: excel_headers,
                    excel_columns: excel_columns,
                    total_amount: request.excel_total,
                    isForCashier: false,
                    logContext: 'final_updater'
                });
            } catch (telegraphError) {
                log.debug(`[MSG_UPDATER] Telegraph xatolik (ixtiyoriy xizmat): requestId=${request.id}`);
            }
        }
        
        // Final guruh xabari: faqat Telegraph link + tasdiqlashlar (agent ro'yxati emas)
        request.telegraph_url = telegraphUrl;
        request.excel_data = null;
        request.excel_headers = null;
        request.excel_columns = null;
        
        // Final guruh uchun 'final' formati – link mavjud, agent ro'yxati yo'q
        const message = await formatRequestMessageWithApprovals(request, db, 'final');
        log.debug(`[LINK_HABAR] final_updater: requestId=${request.id}, request_uid=${request.request_uid}, xabar_formati=final, telegraph_link=${request.telegraph_url ? 'mavjud' : 'yoq'}, xabar_ichida_telegra_ph=${message && message.includes('telegra.ph') ? 'ha' : 'yoq'}`);
        
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
        
        // Original so'rov xabarini format qilish
        let originalMessage = '';
        
        if (request.type === 'SET') {
            // SET so'rov uchun formatSetRequestMessage — to'liq tasdiqlangan bo'lsa ham link qolishi kerak
            // Avval DB'dagi telegraph_url dan foydalanish (FINAL_APPROVED da excel_data null bo'lishi mumkin)
            let telegraphUrl = request.telegraph_url || null;
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
            
            // Telegraph link yo'q bo'lsa va Excel mavjud bo'lsa — yaratish
            if (!telegraphUrl && excelData && Array.isArray(excelData) && excelData.length > 0 && excelColumns) {
                try {
                    const { createDebtDataPage } = require('./telegraph.js');
                    const { getPreviousMonthName } = require('./dateHelper.js');
                    telegraphUrl = await createDebtDataPage({
                        request_id: request.id,
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total,
                        logContext: 'preview_updater'
                    });
                    
                    if (!telegraphUrl) {
                        log.warn(`[MSG_UPDATER] [UPDATE_PREVIEW] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${request.id}`);
                        // Qayta urinish
                        try {
                            telegraphUrl = await createDebtDataPage({
                                request_id: request.id,
                                request_uid: request.request_uid,
                                brand_name: request.brand_name,
                                filial_name: request.filial_name,
                                svr_name: request.svr_name,
                                month_name: getPreviousMonthName(),
                                extra_info: request.extra_info,
                                excel_data: excelData,
                                excel_headers: excelHeaders,
                                excel_columns: excelColumns,
                                total_amount: request.excel_total,
                                logContext: 'preview_updater_retry'
                            });
                        } catch (retryError) {
                            log.error(`[MSG_UPDATER] [UPDATE_PREVIEW] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                        }
                    }
                } catch (telegraphError) {
                    log.error(`[MSG_UPDATER] [UPDATE_PREVIEW] Telegraph sahifa yaratishda xatolik: requestId=${request.id}, error=${telegraphError.message}`);
                    // Qayta urinish
                    try {
                        const { createDebtDataPage } = require('./telegraph.js');
                        const { getPreviousMonthName } = require('./dateHelper.js');
                        telegraphUrl = await createDebtDataPage({
                            request_id: request.id,
                            request_uid: request.request_uid,
                            brand_name: request.brand_name,
                            filial_name: request.filial_name,
                            svr_name: request.svr_name,
                            month_name: getPreviousMonthName(),
                            extra_info: request.extra_info,
                            excel_data: excelData,
                            excel_headers: excelHeaders,
                            excel_columns: excelColumns,
                            total_amount: request.excel_total,
                            logContext: 'preview_updater_retry2'
                        });
                    } catch (retryError) {
                        log.error(`[MSG_UPDATER] [UPDATE_PREVIEW] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                    }
                }
            }
            log.debug(`[LINK_HABAR] manager_preview: kimga=menejer_preview, requestId=${request.id}, request_uid=${request.request_uid}, telegraph_link=${telegraphUrl ? 'mavjud' : 'yo\'q'}, ma_lumotlar=telegraph_link+status_yangilanishi`);
            
            originalMessage = formatSetRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: request.excel_total,
                is_for_cashier: false, // Preview message uchun
                approvals: [],
                telegraph_url: telegraphUrl
            });
        } else {
            // NORMAL so'rov uchun formatNormalRequestMessage
            originalMessage = formatNormalRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                request_uid: request.request_uid
            });
        }
        
        // Status belgilari
        const getStepStatus = (stepNumber, currentStatus, requestType) => {
            if (requestType === 'SET') {
                if (stepNumber === 1) {
                    // Rahbarlar guruhi
                    if (currentStatus === 'SET_PENDING') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_LEADER' || currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_SUPERVISOR' || currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 2) {
                    // Kassir
                    if (currentStatus === 'APPROVED_BY_LEADER') return '<code>jarayonda</code>';
                    if (currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_SUPERVISOR' || currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 3) {
                    // Operator
                    if (currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_SUPERVISOR') return '<code>jarayonda</code>';
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
                    if (currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_SUPERVISOR' || currentStatus === 'APPROVED_BY_OPERATOR' || currentStatus === 'FINAL_APPROVED') return '✅ <code>tugallandi</code>';
                    return '<code>kutilyabdi</code>';
                } else if (stepNumber === 2) {
                    // Operator
                    if (currentStatus === 'APPROVED_BY_CASHIER' || currentStatus === 'APPROVED_BY_SUPERVISOR') return '<code>jarayonda</code>';
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
        
        // Tasdiqlash jarayoni
        let approvalFlow = '';
        if (request.type === 'SET') {
            approvalFlow = `\n\n━━━━━━━━━━━━━━━━━━━━\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
                `1️⃣ <b>Rahbarlar guruhi</b> - ${getStepStatus(1, newStatus, 'SET')}\n` +
                `2️⃣ <b>Kassir</b> - ${getStepStatus(2, newStatus, 'SET')}\n` +
                `3️⃣ <b>Operator</b> - ${getStepStatus(3, newStatus, 'SET')}\n` +
                `4️⃣ <b>Final guruh</b> - ${getStepStatus(4, newStatus, 'SET')}`;
        } else {
            approvalFlow = `\n\n━━━━━━━━━━━━━━━━━━━━\n\n📋 <b>Tasdiqlash jarayoni:</b>\n` +
                `1️⃣ <b>Kassir</b> - ${getStepStatus(1, newStatus, 'NORMAL')}\n` +
                `2️⃣ <b>Operator</b> - ${getStepStatus(2, newStatus, 'NORMAL')}\n` +
                `3️⃣ <b>Final guruh</b> - ${getStepStatus(3, newStatus, 'NORMAL')}`;
        }
        
        // Xabarni formatlash - original xabar + tasdiqlash jarayoni
        const message = originalMessage + approvalFlow;
        
        // Xabarni yangilash
        try {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: request.preview_message_id,
                parse_mode: 'HTML'
            });
            
            // Status xabarni belgilash va tozalash
            const { markAsStatusMessage } = require('../bot/debt-approval/utils/messageTracker.js');
            const { cleanupAfterStatusMessage } = require('../bot/debt-approval/utils/messageCleanup.js');
            markAsStatusMessage(chatId, request.preview_message_id);
            
            // Status xabari yangilanganidan keyin tozalash
            try {
                await new Promise(resolve => setTimeout(resolve, 300)); // Kichik kutish
                const cleanupResult = await cleanupAfterStatusMessage(
                    bot,
                    chatId,
                    request.preview_message_id,
                    { maxMessages: 50, delayBetween: 100, silent: true }
                );
                log.debug(`[MSG_UPDATER] Cleanup completed: deleted=${cleanupResult.deleted}, errors=${cleanupResult.errors}`);
            } catch (cleanupError) {
                log.debug(`[MSG_UPDATER] Cleanup error (ignored): ${cleanupError.message}`);
            }
            
            log.debug(`[MSG_UPDATER] ✅ Preview message updated: requestId=${request.id}, status=${newStatus}, chatId=${chatId}, messageId=${request.preview_message_id}`);
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

