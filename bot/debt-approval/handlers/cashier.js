// bot/debt-approval/handlers/cashier.js
// Kassir FSM handlers - So'rovlarni ko'rish, tasdiqlash, qarzi bor, preview

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { formatNormalRequestMessage, formatDebtResponseMessage, formatApprovalMessage } = require('../../../utils/messageTemplates.js');
const { assignCashierToRequest } = require('../../../utils/cashierAssignment.js');
const { logRequestAction, logApproval } = require('../../../utils/auditLogger.js');
const { updateRequestMessage } = require('../../../utils/messageUpdater.js');
const { handleExcelFile, handleConfirmExcel } = require('./debt-excel.js');
const { sendPreviewToUser } = require('./preview.js');
const { scheduleReminder, cancelReminders } = require('../../../utils/debtReminder.js');

const log = createLogger('CASHIER');

// FSM states
const STATES = {
    IDLE: 'idle',
    VIEW_REQUEST: 'view_request',
    PREVIEW_APPROVAL: 'preview_approval',
    ENTER_DEBT_AMOUNT: 'enter_debt_amount',
    UPLOAD_DEBT_EXCEL: 'upload_debt_excel',
    UPLOAD_DEBT_IMAGE: 'upload_debt_image',
    PREVIEW_DEBT_RESPONSE: 'preview_debt_response',
    CONFIRM_DEBT_RESPONSE: 'confirm_debt_response'
};

/**
 * Kassirning filiallarini olish (debt_cashiers, debt_user_branches va debt_user_tasks dan)
 */
async function getCashierBranches(userId) {
    // 1. debt_cashiers jadvalidan
    const cashierBranches = await db('debt_cashiers')
        .where('user_id', userId)
        .where('is_active', true)
        .pluck('branch_id');
    
    // 2. debt_user_branches jadvalidan
    const userBranches = await db('debt_user_branches')
        .where('user_id', userId)
        .pluck('branch_id');
    
    // 3. debt_user_tasks jadvalidan (kassir vazifasiga ega foydalanuvchilar)
    const cashierTasks = await db('debt_user_tasks')
        .where('user_id', userId)
        .where(function() {
            this.where('task_type', 'approve_cashier')
                .orWhere('task_type', 'debt:approve_cashier');
        })
        .select('branch_id');
    
        // Agar debt_user_tasks jadvalidan vazifa topilsa
        if (cashierTasks.length > 0) {
            // Agar branch_id null bo'lsa, barcha filiallar
            const hasNullBranch = cashierTasks.some(t => t.branch_id === null);
            if (hasNullBranch) {
                // Barcha filiallarni olish
                const allBranches = await db('debt_branches').pluck('id');
                log.info(`[CASHIER] [GET_BRANCHES] Kassir vazifasiga ega (branch_id=null), barcha filiallar bo'yicha ishlaydi: ${allBranches.length} ta filial`);
                return allBranches;
            } else {
                // Faqat belgilangan filiallar
                const taskBranches = cashierTasks.map(t => t.branch_id).filter(b => b !== null);
                const allBranches = [...new Set([...cashierBranches, ...userBranches, ...taskBranches])];
                log.info(`[CASHIER] [GET_BRANCHES] Kassir vazifasiga ega (belgilangan filiallar), jami: ${allBranches.length} ta filial`);
                return allBranches;
            }
        }
    
    // Birlashtirish (dublikatlarni olib tashlash)
    const allBranches = [...new Set([...cashierBranches, ...userBranches])];
    return allBranches;
}

/**
 * Kassirga kelgan so'rovlarni ko'rsatish (Yangi so'rovlar)
 */
async function showCashierRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Kassirning filiallarini olish
        const cashierBranches = await getCashierBranches(user.id);
        
        if (cashierBranches.length === 0) {
            await getBot().sendMessage(chatId, '❌ Sizga biriktirilgan filiallar topilmadi.');
            return;
        }
        
        // Pending so'rovlarni olish
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.branch_id', cashierBranches)
            .where('debt_requests.current_approver_id', user.id)
            .where('debt_requests.current_approver_type', 'cashier')
            .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
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
            await getBot().sendMessage(chatId, '📭 Hozircha yangi so\'rovlar yo\'q.');
            return;
        }
        
        // So'rovlarni ketma-ket ko'rsatish (faqat birinchi so'rovni)
        if (requests.length > 0) {
            await showRequestToCashier(requests[0], chatId, user);
            log.info(`[CASHIER] [SHOW_REQUESTS] Birinchi so'rov ko'rsatildi: requestId=${requests[0].id}, qolgan so'rovlar=${requests.length - 1} ta`);
        }
    } catch (error) {
        log.error('Error showing cashier requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Kassir tasdiqlagan so'rovlarni ko'rsatish (Mening so'rovlarim)
 */
async function showMyCashierRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Kassir tasdiqlagan so'rovlarni olish (debt_request_approvals jadvalidan)
        // Avval approval ID'larni olish
        const approvalIds = await db('debt_request_approvals')
            .where('approver_id', user.id)
            .where('approval_type', 'cashier')
            .whereIn('status', ['approved', 'debt_marked'])
            .pluck('request_id');
        
        if (approvalIds.length === 0) {
            await getBot().sendMessage(chatId, '📋 Siz hali hech qanday so\'rovni tasdiqlamagansiz.');
            return;
        }
        
        // So'rovlarni olish
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.id', approvalIds)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'desc')
            .limit(20);
        
        // Har bir so'rov uchun approval ma'lumotlarini olish
        const requestsWithApprovals = await Promise.all(requests.map(async (request) => {
            const approval = await db('debt_request_approvals')
                .where('request_id', request.id)
                .where('approver_id', user.id)
                .where('approval_type', 'cashier')
                .orderBy('created_at', 'desc')
                .first();
            
            return {
                ...request,
                action: approval ? approval.status : null,
                approved_at: approval ? approval.created_at : null
            };
        }));
        
        let message = `📋 <b>Sizning tasdiqlagan so'rovlaringiz:</b>\n\n`;
        for (const request of requestsWithApprovals) {
            const statusIcon = request.action === 'approved' ? '✅' : '⚠️';
            const statusText = request.action === 'approved' ? 'Tasdiqlangan' : 'Qarzi bor';
            const approvedDate = new Date(request.approved_at).toLocaleString('uz-UZ');
            
            message += `${statusIcon} <b>${request.request_uid}</b>\n` +
                `Brend: ${request.brand_name}\n` +
                `Filial: ${request.filial_name}\n` +
                `SVR: ${request.svr_name}\n` +
                `Holat: ${statusText}\n` +
                `Sana: ${approvedDate}\n\n`;
        }
        
        await getBot().sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        log.error('Error showing my cashier requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Kassirga yuborilgan, lekin hali javob bermagan so'rovlarni ko'rsatish (Kutayotgan so'rovlar)
 */
async function showPendingCashierRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Kassirning filiallarini olish
        const cashierBranches = await getCashierBranches(user.id);
        
        if (cashierBranches.length === 0) {
            await getBot().sendMessage(chatId, '❌ Sizga biriktirilgan filiallar topilmadi.');
            return;
        }
        
        // Kassirga yuborilgan, lekin hali javob bermagan so'rovlarni olish
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.branch_id', cashierBranches)
            .where(function() {
                // Kassirga yuborilgan so'rovlar (current_approver_id = user.id)
                this.where('debt_requests.current_approver_id', user.id)
                    .where('debt_requests.current_approver_type', 'cashier');
            })
            .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
            .where('debt_requests.locked', false)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'desc')
            .limit(20);
        
        if (requests.length === 0) {
            await getBot().sendMessage(chatId, '⏰ Hozircha kutayotgan so\'rovlar yo\'q.');
            return;
        }
        
        let message = `⏰ <b>Kutayotgan so'rovlar:</b>\n\n`;
        for (const request of requests) {
            const createdDate = new Date(request.created_at).toLocaleString('uz-UZ');
            const statusText = request.status === 'PENDING_APPROVAL' ? 'Kutilyabdi' : 'Rahbar tasdiqlagan';
            
            message += `📋 <b>${request.request_uid}</b>\n` +
                `Brend: ${request.brand_name}\n` +
                `Filial: ${request.filial_name}\n` +
                `SVR: ${request.svr_name}\n` +
                `Holat: ${statusText}\n` +
                `Yaratilgan: ${createdDate}\n\n`;
        }
        
        await getBot().sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        log.error('Error showing pending cashier requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Keyingi pending so'rovni topish va ko'rsatish (kassir uchun)
 */
async function showNextCashierRequest(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Kassirning filiallarini olish
        const cashierBranches = await getCashierBranches(user.id);
        
        if (cashierBranches.length === 0) {
            return;
        }
        
        // Keyingi pending so'rovni olish
        const nextRequest = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.branch_id', cashierBranches)
            .where('debt_requests.current_approver_id', user.id)
            .where('debt_requests.current_approver_type', 'cashier')
            .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
            .where('debt_requests.locked', false)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'asc')
            .first();
        
        if (nextRequest) {
            log.info(`[CASHIER] [SHOW_NEXT] Keyingi so'rov ko'rsatilmoqda: requestId=${nextRequest.id}, qolgan so'rovlar mavjud`);
            await showRequestToCashier(nextRequest, chatId, user);
        } else {
            log.info(`[CASHIER] [SHOW_NEXT] Keyingi so'rov topilmadi: userId=${userId}`);
        }
    } catch (error) {
        log.error('Error showing next cashier request:', error);
    }
}

/**
 * So'rovni kassirga ko'rsatish
 */
async function showRequestToCashier(request, chatId, user) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        // Agar so'rov SET bo'lsa va Excel ma'lumotlari bo'lsa, ularni qo'shish
        let message;
        if (request.type === 'SET' && request.excel_data) {
            // SET so'rov uchun formatSetRequestMessage ishlatish
            const { formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
            
            // Excel ma'lumotlarini parse qilish (agar string bo'lsa)
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
            
            message = formatSetRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: request.excel_total,
                is_for_cashier: true // Kassirga yuborilayotgani
            });
        } else {
            // Oddiy so'rov uchun formatNormalRequestMessage
            message = formatNormalRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                request_uid: request.request_uid
            });
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash', callback_data: `cashier_approve_${request.id}` }],
                [{ text: '⚠️ Qarzi bor', callback_data: `cashier_debt_${request.id}` }]
            ]
        };
        
        const sentMessage = await bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        // MUHIM: preview_message_id ni O'ZGARTIRMASLIK!
        // preview_message_id faqat menejerga yuborilgan xabar uchun saqlanadi
        // Kassirga yuborilgan xabar uchun alohida field kerak (lekin hozircha yo'q)
        // Shuning uchun, bu yerda faqat log qilamiz
        
    } catch (error) {
        log.error('Error showing request to cashier:', error);
    }
}

/**
 * Kassir tasdiqlash
 */
async function handleCashierApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        // Callback query'ga tez javob berish (timeout muammosini oldini olish uchun)
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        } catch (callbackError) {
            // Agar callback query timeout bo'lsa, e'tiborsiz qoldirish
            log.warn(`[CASHIER] Callback query timeout: ${callbackError.message}`);
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // So'rovni olish (Excel ma'lumotlari bilan)
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
            .where('debt_requests.current_approver_id', user.id)
            .where('debt_requests.current_approver_type', 'cashier')
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki sizga tegishli emas.');
            return;
        }
        
        // So'rovni bloklash (boshqa kassir tasdiqlamasligi uchun)
        await db('debt_requests')
            .where('id', requestId)
            .update({
                locked: true,
                locked_by: user.id,
                locked_at: db.fn.now()
            });
        
        // Tasdiqlashni log qilish
        await logApproval(requestId, user.id, 'cashier', 'approved', {});
        await logRequestAction(requestId, 'cashier_approved', user.id, {
            new_status: 'APPROVED_BY_CASHIER'
        });
        
        // Operator tayinlash (avval, chunki u current_approver_id va current_approver_type ni o'rnatadi)
        log.debug(`[CASHIER] [APPROVAL] 7. Operator tayinlash boshlanmoqda: brandId=${request.brand_id}, requestId=${requestId}`);
        const { assignOperatorToRequest } = require('../../../utils/cashierAssignment.js');
        const operator = await assignOperatorToRequest(request.brand_id, requestId);
        
        if (operator) {
            log.info(`[CASHIER] [APPROVAL] 7.1. ✅ Operator tayinlandi: OperatorId=${operator.user_id}, Name=${operator.fullname}, TelegramChatId=${operator.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
        } else {
            log.warn(`[CASHIER] [APPROVAL] 7.1. ❌ Operator tayinlanmadi: brandId=${request.brand_id}`);
        }
        
        // Status yangilash (current_approver_id va current_approver_type operator tayinlashda o'rnatilgan, agar operator topilsa)
        log.debug(`[CASHIER] [APPROVAL] 8. Status yangilash: APPROVED_BY_CASHIER`);
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_CASHIER',
                locked: false,
                locked_by: null,
                locked_at: null
            });
        
        log.info(`[CASHIER] [APPROVAL] 8.1. ✅ Status yangilandi: APPROVED_BY_CASHIER`);
        
        // Operatorga guruh orqali yuborish
        log.debug(`[CASHIER] [APPROVAL] 9. Operatorga guruh orqali yuborish...`);
        const { showRequestToOperator } = require('./operator.js');
        
        if (operator) {
            log.info(`[CASHIER] [APPROVAL] 9.1. Operator topildi: OperatorId=${operator.user_id}, Name=${operator.fullname}`);
            
            // So'rovni to'liq ma'lumotlar bilan olish (brand_name, filial_name, svr_name bilan)
            log.debug(`[CASHIER] [APPROVAL] 9.2. So'rov ma'lumotlarini olish: requestId=${requestId}`);
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
                log.info(`[CASHIER] [APPROVAL] 9.3. So'rov ma'lumotlari topildi: RequestUID=${fullRequest.request_uid}, Brand=${fullRequest.brand_name}, Branch=${fullRequest.filial_name}`);
                
                // Operator user ma'lumotlarini olish
                const operatorUser = await db('users').where('id', operator.user_id).first();
                log.info(`[CASHIER] [APPROVAL] 9.4. Operatorlar guruhiga xabar yuborilmoqda: operatorId=${operator.user_id}`);
                await showRequestToOperator(fullRequest, operator.user_id, operatorUser || operator);
                log.info(`[CASHIER] [APPROVAL] 9.5. ✅ So'rov operatorlar guruhiga yuborildi: requestId=${requestId}, requestUID=${request.request_uid}, operatorId=${operator.user_id}`);
            } else {
                log.error(`[CASHIER] [APPROVAL] 9.3. ❌ So'rov ma'lumotlari topilmadi: requestId=${requestId}`);
            }
        } else {
            log.warn(`[CASHIER] [APPROVAL] 9.1. ⚠️ Operator topilmadi: requestId=${requestId}, brandId=${request.brand_id} - So'rov operatorlar guruhiga yuborilmadi`);
        }
        
        // Agar operator topilmasa, log qilamiz
        if (!operator) {
            log.warn(`[CASHIER] [APPROVAL] ⚠️ Operator tayinlanmadi: requestId=${requestId}, brandId=${request.brand_id} - So'rov operatorlar guruhiga yuborilmadi`);
        }
        
        log.info(`[CASHIER] [APPROVAL] ✅ Kassir tasdiqlash muvaffaqiyatli yakunlandi: requestId=${requestId}, requestUID=${request.request_uid}, cashierId=${user.id}, cashierName=${user.fullname}`);
        
        // Xabarni yangilash (menejerga)
        await updateRequestMessage(requestId, 'APPROVED_BY_CASHIER', {
            username: user.username,
            fullname: user.fullname,
            approval_type: 'cashier'
        });
        
        // Eslatmalarni to'xtatish
        cancelReminders(requestId);
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextCashierRequest(userId, chatId);
        
        // Tasdiqlash xabari - Excel ma'lumotlarini saqlab qolish uchun
        // Agar SET so'rov bo'lsa va Excel ma'lumotlari bo'lsa, ularni qo'shish
        let approvalMessage;
        if (request.type === 'SET' && request.excel_data) {
            // SET so'rov uchun formatSetRequestMessage ishlatish va tasdiqlash ma'lumotlarini qo'shish
            const { formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
            
            // Excel ma'lumotlarini parse qilish (agar string bo'lsa)
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
            
            // Tasdiqlash ma'lumotlarini tayyorlash
            const approvals = [{
                username: user.username,
                fullname: user.fullname,
                approval_type: 'cashier',
                created_at: new Date().toISOString()
            }];
            
            approvalMessage = formatSetRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: request.excel_total,
                is_for_cashier: true, // Kassirga yuborilayotgani
                approvals: approvals // Tasdiqlash ma'lumotlari
            });
        } else {
            // Oddiy so'rov uchun formatApprovalMessage
            approvalMessage = formatApprovalMessage({
                request_uid: request.request_uid,
                username: user.username,
                fullname: user.fullname,
                timestamp: new Date().toISOString(),
                approval_type: 'cashier'
            });
        }
        
        await bot.editMessageText(
            approvalMessage,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
    } catch (error) {
        log.error('Error handling cashier approval:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Qarzi bor bosilganda
 */
async function handleCashierDebt(query, bot) {
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
        
        // So'rovni olish (brand_name, filial_name, svr_name bilan)
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
            .where('debt_requests.current_approver_id', user.id)
            .where('debt_requests.current_approver_type', 'cashier')
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki sizga tegishli emas.');
            return;
        }
        
        // State'ni boshlash (branch_id va brand_id saqlash - tekshirish uchun)
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.UPLOAD_DEBT_EXCEL, {
            request_id: requestId,
            request_uid: request.request_uid,
            brand_id: request.brand_id,
            branch_id: request.branch_id,
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            allowed_user_id: user.id // Faqat shu foydalanuvchidan qabul qilish
        });
        
        log.info(`[CASHIER_DEBT] Qarzi bor bosildi: requestId=${requestId}, userId=${user.id}, brandId=${request.brand_id}, branchId=${request.branch_id}`);
        
        // Faqat xabar yuborish (Excel shablon yo'q)
        await bot.sendMessage(
            chatId,
            '📎 Qarzdorlik faylingizni yuboring.'
        );
    } catch (error) {
        log.error('Error handling cashier debt:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Qarzi bor javobini yuborish
 */
async function sendDebtResponse(requestId, userId, chatId, debtData) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
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
        
        // Solishtirish natijasini tekshirish
        const comparisonResult = debtData.comparison_result;
        const hasDifferences = comparisonResult && !comparisonResult.isIdentical && comparisonResult.differences && comparisonResult.differences.length > 0;
        const isIdentical = comparisonResult && comparisonResult.isIdentical;
        
        // Agar farq bo'lsa va farqi ko'p bo'lsa (totalDifference > 0), teskari jarayon (rahbarlarga va menejerga qaytarish)
        if (hasDifferences && comparisonResult.totalDifference > 0) {
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Farq topildi va teskari jarayon boshlanmoqda: requestId=${requestId}, totalDifference=${comparisonResult.totalDifference}`);
            
            // Menejerga xabar yuborish (farqlar bilan)
            const manager = await db('users').where('id', request.created_by).first();
            if (manager && manager.telegram_chat_id) {
                const { formatDifferencesMessage } = require('./debt-excel.js');
                const differencesMessage = formatDifferencesMessage(comparisonResult);
                const reverseMessage = `⚠️ <b>Teskari jarayon</b>\n\n` +
                    `So'rov ID: ${request.request_uid}\n` +
                    `Brend: ${request.brand_name}\n` +
                    `Filial: ${request.filial_name}\n` +
                    `SVR: ${request.svr_name}\n\n` +
                    `Kassir tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n` +
                    `${differencesMessage}`;
                
                const bot = getBot();
                await bot.sendMessage(manager.telegram_chat_id, reverseMessage, { parse_mode: 'HTML' });
                log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Menejerga teskari jarayon xabari yuborildi: requestId=${requestId}, managerId=${manager.id}`);
            }
            
            // Agar SET so'rov bo'lsa, rahbarlarga ham yuborish (reverse process)
            if (request.type === 'SET') {
                const leadersGroup = await db('debt_groups')
                    .where('group_type', 'leaders')
                    .where('is_active', true)
                    .first();
                
                if (leadersGroup) {
                    const { formatDifferencesMessage } = require('./debt-excel.js');
                    const differencesMessage = formatDifferencesMessage(comparisonResult);
                    const reverseMessage = `⚠️ <b>Teskari jarayon</b>\n\n` +
                        `So'rov ID: ${request.request_uid}\n` +
                        `Brend: ${request.brand_name}\n` +
                        `Filial: ${request.filial_name}\n` +
                        `SVR: ${request.svr_name}\n\n` +
                        `Kassir tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n` +
                        `${differencesMessage}`;
                    
                    const bot = getBot();
                    await bot.sendMessage(leadersGroup.telegram_group_id, reverseMessage, { parse_mode: 'HTML' });
                    log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Rahbarlar guruhiga teskari jarayon xabari yuborildi: requestId=${requestId}, groupId=${leadersGroup.telegram_group_id}`);
                }
            }
            
            // Status yangilash - teskari jarayon
            await db('debt_requests')
                .where('id', requestId)
                .update({
                    status: 'REVERSED_BY_CASHIER',
                    current_approver_id: null,
                    current_approver_type: null
                });
            
            // Tasdiqlashni log qilish
            await logApproval(requestId, user.id, 'cashier', 'reversed', {
                excel_file_path: debtData.excel_file_path,
                total_difference: comparisonResult.totalDifference,
                differences_count: comparisonResult.differences.length
            });
            
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Teskari jarayon yakunlandi: requestId=${requestId}, cashierId=${user.id}`);
            return; // Teskari jarayon - operatorga yuborilmaydi
        }
        
        // Agar farqi yo'q bo'lsa (bir xil) YOKI farq bo'lsa lekin farqi kichik bo'lsa (totalDifference <= 0)
        // Rahbarga va menejerga yuborilmaydi, faqat operatorga yuboriladi
        if (isIdentical || (hasDifferences && comparisonResult.totalDifference <= 0)) {
            if (isIdentical) {
                log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Ma'lumotlar bir xil, rahbarga va menejerga yuborilmaydi: requestId=${requestId}`);
            } else {
                log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Farq topildi, lekin farqi kichik (totalDifference=${comparisonResult.totalDifference}), rahbarga va menejerga yuborilmaydi: requestId=${requestId}`);
            }
            // Rahbarga va menejerga yuborilmaydi, faqat operatorga yuboriladi
        }
        
        // Qarzi bor javobini formatlash
        let debtMessage = formatDebtResponseMessage({
            request_uid: request.request_uid,
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            debt_details: debtData.debt_details,
            total_amount: debtData.total_amount,
            excel_data: debtData.excel_data,
            excel_headers: debtData.excel_headers,
            excel_columns: debtData.excel_columns
        });
        
        // Agar bir xil bo'lsa, bir xil ekanligi haqida ma'lumot qo'shish
        if (isIdentical) {
            debtMessage = '⚠️ <b>Eslatma:</b> Yuborilgan ma\'lumotlar so\'rovdagi ma\'lumotlar bilan bir xil.\n\n' + debtMessage;
        }
        
        // Oldingi bosqichlarga yuborish
        // Agar bir xil yoki farqi kichik bo'lsa, menejerga va rahbarlarga yuborilmaydi (faqat operatorga yuboriladi)
        const recipients = [];
        
        // Menejerga va rahbarlarga faqat farq bo'lsa va farqi katta bo'lsa yuboriladi
        // Agar bir xil yoki farqi kichik bo'lsa, yuborilmaydi (faqat operatorga yuboriladi)
        // Shuning uchun bu yerda recipients bo'sh qoladi
        
        // Operatorga guruh orqali yuborish
        const { showRequestToOperator } = require('./operator.js');
        const { assignOperatorToRequest } = require('../../../utils/cashierAssignment.js');
        const operator = await assignOperatorToRequest(request.brand_id, requestId);
        
        if (operator) {
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
                // Excel ma'lumotlarini qo'shish (agar mavjud bo'lsa)
                if (debtData.excel_data) {
                    fullRequest.excel_data = debtData.excel_data;
                    fullRequest.excel_headers = debtData.excel_headers;
                    fullRequest.excel_columns = debtData.excel_columns;
                    fullRequest.excel_total = debtData.total_amount;
                }
                
                // Operator user ma'lumotlarini olish
                const operatorUser = await db('users').where('id', operator.user_id).first();
                await showRequestToOperator(fullRequest, operator.user_id, operatorUser || operator);
                log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Operatorlar guruhiga xabar yuborildi (knopkalar bilan): requestId=${requestId}, operatorId=${operator.user_id}`);
            }
        } else {
            log.warn(`[CASHIER] [SEND_DEBT_RESPONSE] ⚠️ Operator topilmadi: requestId=${requestId}, brandId=${request.brand_id}`);
        }
        
        // Xabarlarni yuborish (operatorlar guruhini olib tashlash, chunki u allaqachon yuborildi)
        const bot = getBot();
        for (const recipient of recipients) {
            // Operatorlar guruhini o'tkazib yuborish (chunki u allaqachon showRequestToOperator orqali yuborildi)
            if (recipient.role === 'operators') {
                continue;
            }
            
            try {
                await bot.sendMessage(recipient.id, debtMessage, {
                    parse_mode: 'HTML'
                });
            } catch (error) {
                log.error(`Error sending debt response to ${recipient.role}:`, error);
            }
        }
        
        // Tasdiqlashni log qilish
        await logApproval(requestId, user.id, 'cashier', 'debt_marked', {
            excel_file_path: debtData.excel_file_path,
            image_file_path: debtData.image_file_path,
            debt_amount: debtData.total_amount
        });
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'DEBT_MARKED_BY_CASHIER',
                current_approver_id: null,
                current_approver_type: null
            });
        
        log.info(`Debt response sent: requestId=${requestId}, cashierId=${user.id}`);
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextCashierRequest(userId, chatId);
    } catch (error) {
        log.error('Error sending debt response:', error);
        throw error;
    }
}

/**
 * Operatorga so'rov yuborish
 */
async function sendRequestToOperator(request, operatorChatId) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        const message = formatNormalRequestMessage({
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            request_uid: request.request_uid
        });
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash', callback_data: `operator_approve_${request.id}` }],
                [{ text: '⚠️ Qarzi bor', callback_data: `operator_debt_${request.id}` }]
            ]
        };
        
        await bot.sendMessage(operatorChatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
    } catch (error) {
        log.error('Error sending request to operator:', error);
    }
}

module.exports = {
    showCashierRequests,
    showMyCashierRequests,
    showPendingCashierRequests,
    showRequestToCashier,
    showNextCashierRequest,
    getCashierBranches,
    handleCashierApproval,
    handleCashierDebt,
    sendDebtResponse,
    sendRequestToOperator,
    STATES
};

