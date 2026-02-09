// bot/debt-approval/handlers/operator.js
// Operator FSM handlers - So'rovlarni ko'rish, tasdiqlash, qarzi bor, preview

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { formatNormalRequestMessage, formatDebtResponseMessage, formatApprovalMessage, formatAllApprovalsMessage, formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
const { logRequestAction, logApproval } = require('../../../utils/auditLogger.js');
const { updateRequestMessage } = require('../../../utils/messageUpdater.js');
const { sendToFinalGroup } = require('./final-group.js');
const { handleExcelFile, handleConfirmExcel } = require('./debt-excel.js');
const { scheduleReminder, cancelReminders } = require('../../../utils/debtReminder.js');

const log = createLogger('OPERATOR');

// FSM states (cashier bilan bir xil)
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
 * Operatorga kelgan so'rovlarni ko'rsatish
 * ✅ MUHIM: Avval eslatmalarni tekshirish, agar bo'lmasa, keyin kutilayotgan so'rovlarni ko'rsatish
 */
async function showOperatorRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // ✅ MUHIM: Avval eslatmalarni tekshirish
        const { getPendingRemindersForUser } = require('../../../utils/debtReminder.js');
        const reminderRequests = await getPendingRemindersForUser(user.id, 'operator');
        
        if (reminderRequests.length > 0) {
            // Eslatmalar bor, eslatmalarni ko'rsatish
            const reminderHandlers = require('./reminder.js');
            const bot = getBot();
            
            // Eslatma knopkasini simulyatsiya qilish (query yaratish)
            // ✅ skipAnswerCallback=true - answerCallbackQuery ni o'tkazib yuborish
            const fakeQuery = {
                message: { chat: { id: chatId } },
                from: { id: userId },
                id: `fake_${Date.now()}`
            };
            
            await reminderHandlers.handleShowNextReminder(fakeQuery, bot, 'user', 'operator', true);
            log.info(`[OPERATOR] [SHOW_REQUESTS] Eslatmalar topildi va ko'rsatildi: count=${reminderRequests.length}, userId=${userId}`);
            return;
        }
        
        // Eslatmalar yo'q, keyin kutilayotgan so'rovlarni ko'rsatish
        // Note: Operator uchun active so'rov tekshiruvi yo'q, chunki operatorlar guruhida ishlaydi
        // Operatorning brendlarini olish (debt_operators, debt_user_brands va debt_user_tasks jadvallaridan)
        const [operatorBrandsFromTable, operatorBrandsFromBindings, operatorTask] = await Promise.all([
            db('debt_operators')
                .where('user_id', user.id)
                .where('is_active', true)
                .pluck('brand_id'),
            db('debt_user_brands')
                .where('user_id', user.id)
                .pluck('brand_id'),
            db('debt_user_tasks')
                .where('user_id', user.id)
                .where(function() {
                    this.where('task_type', 'approve_operator')
                        .orWhere('task_type', 'debt:approve_operator');
                })
                .first()
        ]);
        
        let operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
        
        // Agar operator vazifasiga ega bo'lsa (debt_user_tasks), barcha brendlar bo'yicha ishlaydi
        if (operatorTask) {
            // Barcha brendlarni olish (cheklovlarsiz)
            const allBrands = await db('debt_brands').pluck('id');
            operatorBrands = allBrands;
            log.info(`[OPERATOR] [SHOW_REQUESTS] Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi: ${allBrands.length} ta brend`);
        }
        
        if (operatorBrands.length === 0) {
            await getBot().sendMessage(chatId, '❌ Sizga biriktirilgan brendlar topilmadi.');
            return;
        }
        
        // Operatorlar guruhini olish
        const operatorsGroup = await db('debt_groups')
            .where('group_type', 'operators')
            .where('is_active', true)
            .first();
        
        if (!operatorsGroup) {
            await getBot().sendMessage(chatId, '❌ Operatorlar guruhi topilmadi.');
            return;
        }
        
        // Pending so'rovlarni olish
        // Operatorning brendlariga tegishli so'rovlarni ko'rsatish
        // current_approver_id null bo'lsa ham ko'rsatish (operator tayinlanmasa ham)
        const requests = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.brand_id', operatorBrands)
            .where(function() {
                this.where(function() {
                    this.where('debt_requests.current_approver_id', user.id)
                        .where('debt_requests.current_approver_type', 'operator');
                }).orWhereNull('debt_requests.current_approver_id');
            })
            .whereIn('debt_requests.status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER', 'REVERSED_BY_OPERATOR'])
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
        
        // Navbatli ko'rsatish: faqat birinchi so'rovni ko'rsatish
        if (requests.length > 0) {
            const firstRequest = requests[0];
            const assignedOperatorId = firstRequest.current_approver_id || user.id;
                    const assignedOperator = await db('users').where('id', assignedOperatorId).first();
            
                    if (assignedOperator) {
                // Kutilayotgan so'rovlar sonini hisoblash (birinchi so'rovni istisno qilish)
                const pendingCount = requests.length - 1;
                await showRequestToOperator(firstRequest, assignedOperatorId, assignedOperator, pendingCount);
                log.info(`[OPERATOR] [SHOW_REQUESTS] Birinchi so'rov ko'rsatildi: requestId=${firstRequest.id}, operatorId=${assignedOperatorId}, pendingCount=${pendingCount}`);
                } else {
                log.warn(`[OPERATOR] [SHOW_REQUESTS] Operator topilmadi: operatorId=${assignedOperatorId}`);
                }
        }
    } catch (error) {
        log.error('Error showing operator requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Keyingi pending so'rovni topish va ko'rsatish (operator uchun)
 */
async function showNextOperatorRequest(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // Operatorning brendlarini olish (debt_operators, debt_user_brands va debt_user_tasks jadvallaridan)
        const [operatorBrandsFromTable, operatorBrandsFromBindings, operatorTask] = await Promise.all([
            db('debt_operators')
                .where('user_id', user.id)
                .where('is_active', true)
                .pluck('brand_id'),
            db('debt_user_brands')
                .where('user_id', user.id)
                .pluck('brand_id'),
            db('debt_user_tasks')
                .where('user_id', user.id)
                .where(function() {
                    this.where('task_type', 'approve_operator')
                        .orWhere('task_type', 'debt:approve_operator');
                })
                .first()
        ]);
        
        let operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
        
        // Agar operator vazifasiga ega bo'lsa (debt_user_tasks), barcha brendlar bo'yicha ishlaydi
        if (operatorTask) {
            // Barcha brendlarni olish (cheklovlarsiz)
            const allBrands = await db('debt_brands').pluck('id');
            operatorBrands = allBrands;
            log.info(`[OPERATOR] [SHOW_NEXT] Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi: ${allBrands.length} ta brend`);
        }
        
        if (operatorBrands.length === 0) {
            return;
        }
        
        // Keyingi pending so'rovni olish
        const nextRequest = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.brand_id', operatorBrands)
            .where(function() {
                this.where(function() {
                    this.where('debt_requests.current_approver_id', user.id)
                        .where('debt_requests.current_approver_type', 'operator');
                }).orWhereNull('debt_requests.current_approver_id');
            })
            .whereIn('debt_requests.status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER', 'REVERSED_BY_OPERATOR'])
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
            // So'rovga tayinlangan operatorni olish
            const assignedOperatorId = nextRequest.current_approver_id || null;
            if (assignedOperatorId) {
                const assignedOperator = await db('users').where('id', assignedOperatorId).first();
                if (assignedOperator) {
                    // Boshqa pending so'rovlar sonini hisoblash (joriy so'rovni istisno qilgan holda)
                    const otherPendingCount = await db('debt_requests')
                        .whereIn('brand_id', operatorBrands)
                        .where(function() {
                            this.where('current_approver_id', assignedOperatorId)
                                .where('current_approver_type', 'operator');
                        })
                        .whereIn('status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER', 'REVERSED_BY_OPERATOR'])
                        .where('locked', false)
                        .where('id', '!=', nextRequest.id)
                        .count('* as count')
                        .first();
                    
                    const pendingCount = otherPendingCount ? parseInt(otherPendingCount.count) : 0;
                    
                    log.info(`[OPERATOR] [SHOW_NEXT] Keyingi so'rov ko'rsatilmoqda: requestId=${nextRequest.id}, operatorId=${assignedOperatorId}, pendingCount=${pendingCount}`);
                    // shouldCleanup=true - keyingi so'rovni ko'rsatishda eski xabarlarni o'chirish
                    await showRequestToOperator(nextRequest, assignedOperatorId, assignedOperator, pendingCount, true);
                } else {
                    log.warn(`[OPERATOR] [SHOW_NEXT] Operator topilmadi: operatorId=${assignedOperatorId}`);
                }
            } else {
                log.warn(`[OPERATOR] [SHOW_NEXT] So'rovga operator tayinlanmagan: requestId=${nextRequest.id}`);
            }
        } else {
            log.info(`[OPERATOR] [SHOW_NEXT] Keyingi so'rov topilmadi: userId=${userId}`);
        }
    } catch (error) {
        log.error('Error showing next operator request:', error);
    }
}

/**
 * So'rovni operatorlar guruhiga ko'rsatish
 * @param {Object} request - So'rov ma'lumotlari
 * @param {number} operatorId - Operator ID
 * @param {Object} operatorUser - Operator foydalanuvchi ma'lumotlari
 * @param {number} pendingCount - Kutilayotgan so'rovlar soni (ixtiyoriy)
 * @param {boolean} shouldCleanup - Eski xabarlarni o'chirish kerakmi (default: false)
 */
async function showRequestToOperator(request, operatorId, operatorUser, pendingCount = 0, shouldCleanup = false) {
    try {
        log.info(`[OPERATOR] [SHOW_REQUEST] 📤 Operatorlar guruhiga xabar yuborilmoqda: requestId=${request.id}, requestUID=${request.request_uid}, operatorId=${operatorId}, operatorName=${operatorUser?.fullname || 'N/A'}`);
        
        const bot = getBot();
        if (!bot) {
            log.error(`[OPERATOR] [SHOW_REQUEST] ❌ Bot topilmadi: requestId=${request.id}`);
            return;
        }
        
        // Operatorlar guruhini olish
        const operatorsGroup = await db('debt_groups')
            .where('group_type', 'operators')
            .where('is_active', true)
            .first();
        
        if (!operatorsGroup) {
            log.error(`[OPERATOR] [SHOW_REQUEST] ❌ Operatorlar guruhi topilmadi: requestId=${request.id}`);
            return;
        }
        
        const groupId = operatorsGroup.telegram_group_id;
        
        // ✅ MUHIM: Joriy so'rovning allaqachon ko'rsatilgan xabarlarini tekshirish
        // Agar joriy so'rovning xabari allaqachon mavjud bo'lsa (va tasdiqlanmagan bo'lsa), yangi xabar yubormaslik
        const { hasActiveRequestMessage } = require('../utils/messageTracker.js');
        const hasActiveMessage = hasActiveRequestMessage(groupId, request.id);
        
        if (hasActiveMessage) {
            log.info(`[OPERATOR] [SHOW_REQUEST] ⚠️ Joriy so'rovning faol xabari mavjud, yangi xabar yuborilmaydi: requestId=${request.id}`);
            return;
        }
        
        // ✅ NAVBATLI KO'RSATISH: Operatorning boshqa faol so'rovlarining xabarlarini o'chirish
        // Faqat birinchi so'rov ko'rsatilishi kerak, shuning uchun eski so'rovlarni o'chirish
        // Faqat shouldCleanup=true bo'lsa, eski xabarlarni o'chirish (keyingi so'rovni ko'rsatishda)
        if (shouldCleanup) {
            try {
                const { getMessagesToCleanup } = require('../utils/messageTracker.js');
                
                // Operatorning boshqa faol so'rovlarini olish (joriy so'rovni istisno qilgan holda)
                const otherRequests = await db('debt_requests')
                    .where('current_approver_id', operatorId)
                    .where('current_approver_type', 'operator')
                    .whereIn('status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER', 'REVERSED_BY_OPERATOR'])
                    .where('locked', false)
                    .where('id', '!=', request.id)
                    .select('id', 'request_uid')
                    .orderBy('created_at', 'desc')
                    .limit(10);
                
                log.info(`[OPERATOR] [SHOW_REQUEST] Navbatli ko'rsatish: joriy so'rov=${request.id}, operatorId=${operatorId}, boshqa so'rovlar=${otherRequests.length} ta`);
                
                // Eski so'rovlarning xabarlarini o'chirish (messageTracker'dan)
                // Faqat so'rov xabarlarini o'chirish, boshqa xabarlarni saqlab qolish
                const messagesToDelete = getMessagesToCleanup(groupId, []);
                
                // Faqat so'nggi 5 ta xabarni o'chirish (ehtimol so'rov xabarlari)
                // Keyingi so'rov yuborilganda, yangi xabar messageTracker'ga qo'shiladi
                if (messagesToDelete.length > 0) {
                    log.info(`[OPERATOR] [SHOW_REQUEST] Eski xabarlarni o'chirish: ${messagesToDelete.length} ta xabar`);
                    
                    // O'chirish (silent mode) - faqat so'nggi 5 ta xabarni
                    const { untrackMessage } = require('../utils/messageTracker.js');
                    const messagesToDeleteNow = messagesToDelete.slice(-5);
                    for (const messageId of messagesToDeleteNow) {
                        try {
                            await bot.deleteMessage(groupId, messageId);
                            // Xabarni messageTracker'dan ham o'chirish
                            untrackMessage(groupId, messageId);
                            await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit uchun
                            log.debug(`[OPERATOR] [SHOW_REQUEST] Xabar o'chirildi va kuzatishdan olib tashlandi: groupId=${groupId}, messageId=${messageId}`);
                        } catch (deleteError) {
                            // Silent fail - xabar allaqachon o'chirilgan bo'lishi mumkin
                            // Lekin messageTracker'dan o'chirishga harakat qilish
                            untrackMessage(groupId, messageId);
                            log.debug(`[OPERATOR] [SHOW_REQUEST] Xabar o'chirishda xatolik (ignored): messageId=${messageId}, error=${deleteError.message}`);
                        }
                    }
                }
            } catch (cleanupError) {
                // Silent fail - cleanup ixtiyoriy
                log.debug(`[OPERATOR] [SHOW_REQUEST] Eski so'rovlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
        }
        
        // Operatorning ismini va username'ni olish
        let operatorFullname = 'Noma\'lum operator';
        let operatorUsername = null;
        if (operatorUser && operatorUser.fullname) {
            operatorFullname = operatorUser.fullname;
            // Telegram username yoki username ustunidan olish
            operatorUsername = operatorUser.telegram_username || operatorUser.username;
        } else if (operatorId) {
            const operatorFromDb = await db('users').where('id', operatorId).first();
            if (operatorFromDb) {
                if (operatorFromDb.fullname) {
                    operatorFullname = operatorFromDb.fullname;
                }
                // Telegram username yoki username ustunidan olish
                operatorUsername = operatorFromDb.telegram_username || operatorFromDb.username;
            }
        }
        
        log.debug(`[OPERATOR] [SHOW_REQUEST] 1. So'rov ma'lumotlari: RequestId=${request.id}, Type=${request.type}, Brand=${request.brand_name}, Branch=${request.filial_name}, SVR=${request.svr_name}, OperatorId=${operatorId}, OperatorName=${operatorFullname}, OperatorUsername=${operatorUsername || 'yo\'q'}`);
        
        // Telegraph URL ni funksiya boshida aniqlash (har doim mavjud bo'lishi uchun)
        let telegraphUrl = null;
        
        // Agar SET so'rov bo'lsa va Excel ma'lumotlari bo'lsa, ularni qo'shish
        let message;
        if (request.type === 'SET' && request.excel_data) {
            log.debug(`[OPERATOR] [SHOW_REQUEST] 2. SET so'rov, Excel ma'lumotlarini parse qilish...`);
            const { formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
            
            // Excel ma'lumotlarini parse qilish (agar string bo'lsa)
            let excelData = request.excel_data;
            let excelHeaders = request.excel_headers;
            let excelColumns = request.excel_columns;
            
            if (typeof excelData === 'string' && excelData) {
                try {
                    excelData = JSON.parse(excelData);
                    log.debug(`[OPERATOR] [SHOW_REQUEST] 2.1. Excel data parse qilindi: ${Array.isArray(excelData) ? excelData.length + ' qator' : 'object'}`);
                } catch (e) {
                    excelData = null;
                    log.warn(`[OPERATOR] [SHOW_REQUEST] 2.1. Excel data parse qilishda xatolik: ${e.message}`);
                }
            }
            
            if (typeof excelHeaders === 'string' && excelHeaders) {
                try {
                    excelHeaders = JSON.parse(excelHeaders);
                    log.debug(`[OPERATOR] [SHOW_REQUEST] 2.2. Excel headers parse qilindi: ${Array.isArray(excelHeaders) ? excelHeaders.length + ' ustun' : 'object'}`);
                } catch (e) {
                    excelHeaders = null;
                    log.warn(`[OPERATOR] [SHOW_REQUEST] 2.2. Excel headers parse qilishda xatolik: ${e.message}`);
                }
            }
            
            if (typeof excelColumns === 'string' && excelColumns) {
                try {
                    excelColumns = JSON.parse(excelColumns);
                    log.debug(`[OPERATOR] [SHOW_REQUEST] 2.3. Excel columns parse qilindi: ${Array.isArray(excelColumns) ? excelColumns.length + ' ustun' : 'object'}`);
                } catch (e) {
                    excelColumns = null;
                    log.warn(`[OPERATOR] [SHOW_REQUEST] 2.3. Excel columns parse qilishda xatolik: ${e.message}`);
                }
            }
            
            // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
            // MUHIM: Operatorlar guruhida har doim Telegraph link ishlatilishi kerak
            // ✅ MUHIM: Mavjud URL ni qayta ishlatmaymiz, chunki u kassir uchun yaratilgan bo'lishi mumkin (agent bo'yicha)
            // Operator uchun har doim yangi URL yaratamiz (klient bo'yicha)
            if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                // Agar Telegraph URL mavjud bo'lmasa, yangi yaratish
                try {
                    const { createDebtDataPage } = require('../../../utils/telegraph.js');
                    telegraphUrl = await createDebtDataPage({
                        request_id: request.id,
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total,
                        isForCashier: false,
                        logContext: 'operator'
                    });
                    
                    if (telegraphUrl) {
                        log.info(`[OPERATOR] [SHOW_REQUEST] ✅ Telegraph sahifa yaratildi: requestId=${request.id}, URL=${telegraphUrl}`);
                    } else {
                        log.warn(`[OPERATOR] [SHOW_REQUEST] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${request.id}`);
                        // Qayta urinish
                        try {
                            telegraphUrl = await createDebtDataPage({
                                request_id: request.id,
                                request_uid: request.request_uid,
                                brand_name: request.brand_name,
                                filial_name: request.filial_name,
                                svr_name: request.svr_name,
                                month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                                extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total,
                        isForCashier: false,
                        logContext: 'operator'
                    });
                        } catch (retryError) {
                            log.error(`[OPERATOR] [SHOW_REQUEST] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                        }
                    }
                } catch (telegraphError) {
                    log.error(`[OPERATOR] [SHOW_REQUEST] Telegraph sahifa yaratishda xatolik: requestId=${request.id}, error=${telegraphError.message}`);
                    // Qayta urinish
                    try {
                        telegraphUrl = await createDebtDataPage({
                            request_id: request.id,
                            request_uid: request.request_uid,
                            brand_name: request.brand_name,
                            filial_name: request.filial_name,
                            svr_name: request.svr_name,
                            month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                            extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total,
                        isForCashier: false,
                        logContext: 'operator'
                    });
                    } catch (retryError) {
                        log.error(`[OPERATOR] [SHOW_REQUEST] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                    }
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
                is_for_operator: true, // Operatorlar guruhiga yuborilayotgani
                telegraph_url: telegraphUrl
            });
            
        } else {
            // Oddiy so'rov uchun formatNormalRequestMessage
            const { formatNormalRequestMessage } = require('../../../utils/messageTemplates.js');
            message = formatNormalRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                request_uid: request.request_uid
            });
            
        }
        
        // Operatorning ismini va username'ni xabarga qo'shish
        let operatorDisplayName = operatorFullname;
        if (operatorUsername) {
            operatorDisplayName = `${operatorFullname} (@${operatorUsername})`;
        }
        const operatorHeader = `👤 <b>Operator:</b> ${operatorDisplayName}\n\n`;
        message = operatorHeader + message;
        
        // Callback_data'da operator ID'sini qo'shish
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Tasdiqlash', callback_data: `operator_approve_${request.id}_${operatorId}` },
                    { text: '⚠️ Qarzi bor', callback_data: `operator_debt_${request.id}_${operatorId}` }
                ]
            ]
        };
        
        log.info(`[OPERATOR] [SHOW_REQUEST] 3. Operatorlar guruhiga xabar yuborilmoqda: groupId=${groupId}, requestId=${request.id}, operatorId=${operatorId}, pendingCount=${pendingCount}`);
        log.info(`[LINK_HABAR] operator: kimga=operatorlar_guruhi, requestId=${request.id}, request_uid=${request.request_uid}, telegraph_link=${telegraphUrl ? 'mavjud' : 'yo\'q'}, ma_lumotlar=${request.type === 'SET' ? 'faqat_telegraph_link' : 'oddiy'}, groupId=${groupId}`);
        
        let sentMessage;
        try {
            sentMessage = await bot.sendMessage(groupId, message, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
            
            log.info(`[OPERATOR] [SHOW_REQUEST] ✅ Operatorlar guruhiga xabar yuborildi: requestId=${request.id}, requestUID=${request.request_uid}, groupId=${groupId}, messageId=${sentMessage.message_id}, operatorId=${operatorId}, operatorName=${operatorUser?.fullname || 'N/A'}, pendingCount=${pendingCount}, chatType=group, telegraphUrl=${telegraphUrl || 'yo\'q'}`);
            
            // ✅ Avval eski "kutilayotgan so'rovlar" va "eslatma" xabarlarini o'chirish
            try {
                const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                const messagesToDelete = getMessagesToCleanup(groupId, []);
                
                // "Kutilayotgan so'rovlar" va "eslatma" xabarlarini o'chirish
                // Faqat so'nggi 5 ta xabarni o'chirish (ehtimol "kutilayotgan so'rovlar" va "eslatma" xabarlari)
                if (messagesToDelete.length > 0) {
                    const messagesToDeleteNow = messagesToDelete.slice(-5);
                    for (const messageId of messagesToDeleteNow) {
                        try {
                            await bot.deleteMessage(groupId, messageId);
                            untrackMessage(groupId, messageId);
                            await new Promise(resolve => setTimeout(resolve, 100));
                            log.debug(`[OPERATOR] [SHOW_REQUEST] Eski xabar o'chirildi (kutilayotgan so'rovlar yoki eslatma): groupId=${groupId}, messageId=${messageId}`);
                        } catch (deleteError) {
                            untrackMessage(groupId, messageId);
                            log.debug(`[OPERATOR] [SHOW_REQUEST] Xabar o'chirishda xatolik (ignored): messageId=${messageId}, error=${deleteError.message}`);
                        }
                    }
                }
            } catch (cleanupError) {
                log.debug(`[OPERATOR] [SHOW_REQUEST] Eski xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
            
            // Agar kutilayotgan so'rovlar bo'lsa, guruhga xabar va inline keyboard yuborish
            if (pendingCount > 0) {
                const pendingMessage = `📋 Sizda ${pendingCount} ta kutilayotgan so'rov bor.`;
                
                // Inline keyboard qo'shish
                const pendingKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '⏰ Kutilayotgan so\'rovlar', callback_data: `show_pending_requests_operator` }
                        ]
                    ]
                };
                
                try {
                    const pendingSentMessage = await bot.sendMessage(groupId, pendingMessage, {
                        reply_markup: pendingKeyboard,
                        parse_mode: 'HTML'
                    });
                    
                    // ✅ "Kutilayotgan so'rovlar" xabarlarini track qilish (keyinchalik o'chirish uchun)
                    try {
                        const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                        trackMessage(groupId, pendingSentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true); // shouldCleanup=true - o'chirilishi kerak
                    } catch (trackError) {
                        log.debug(`[OPERATOR] [SHOW_REQUEST] "Kutilayotgan so'rovlar" xabarni track qilishda xatolik (ignored): ${trackError.message}`);
                    }
                    
                    log.info(`[OPERATOR] [SHOW_REQUEST] 2.6. ✅ Kutilayotgan so'rovlar xabari va knopka yuborildi: ${pendingCount} ta`);
                } catch (error) {
                    log.debug(`[OPERATOR] [SHOW_REQUEST] Kutilayotgan so'rovlar xabari yuborishda xatolik (ignored): ${error.message}`);
                }
            }
        } catch (sendError) {
            // Agar guruh supergroup'ga o'zgartirilgan bo'lsa
            const errorBody = sendError.response?.body;
            if (errorBody?.error_code === 400 && errorBody?.parameters?.migrate_to_chat_id) {
                const newChatId = errorBody.parameters.migrate_to_chat_id;
                log.warn(`[OPERATOR] [SHOW_REQUEST] ⚠️ Guruh supergroup'ga o'zgartirilgan. Eski ID: ${groupId}, Yangi ID: ${newChatId}`);
                
                // Database'da yangi chat ID'ni yangilash
                await db('debt_groups')
                    .where('group_type', 'operators')
                    .where('is_active', true)
                    .update({
                        telegram_group_id: newChatId
                    });
                
                log.info(`[OPERATOR] [SHOW_REQUEST] ✅ Database yangilandi. Yangi chat ID: ${newChatId}`);
                
                // Yangi chat ID bilan qayta urinish
                sentMessage = await bot.sendMessage(newChatId, message, {
                    reply_markup: keyboard,
                    parse_mode: 'HTML'
                });
                
                log.info(`[OPERATOR] [SHOW_REQUEST] ✅ Operatorlar guruhiga xabar muvaffaqiyatli yuborildi (yangi chat ID): requestId=${request.id}, requestUID=${request.request_uid}, groupId=${newChatId}, messageId=${sentMessage.message_id}, operatorId=${operatorId}`);
                
                // ✅ Xabarni messageTracker'ga qo'shish (yangi chat ID bilan)
                try {
                    const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                    trackMessage(newChatId, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, false, request.id, false); // shouldCleanup=false, requestId=request.id
                    log.debug(`[OPERATOR] [SHOW_REQUEST] Xabar kuzatishga qo'shildi (yangi chat ID): groupId=${newChatId}, messageId=${sentMessage.message_id}, requestId=${request.id}`);
                } catch (trackError) {
                    log.debug(`[OPERATOR] [SHOW_REQUEST] Xabarni kuzatishga qo'shishda xatolik (ignored): ${trackError.message}`);
                }
                
                // ✅ Avval eski "kutilayotgan so'rovlar" va "eslatma" xabarlarini o'chirish (yangi chat ID)
                try {
                    const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                    const messagesToDelete = getMessagesToCleanup(newChatId, []);
                    
                    // "Kutilayotgan so'rovlar" va "eslatma" xabarlarini o'chirish
                    if (messagesToDelete.length > 0) {
                        const messagesToDeleteNow = messagesToDelete.slice(-5);
                        for (const messageId of messagesToDeleteNow) {
                            try {
                                await bot.deleteMessage(newChatId, messageId);
                                untrackMessage(newChatId, messageId);
                                await new Promise(resolve => setTimeout(resolve, 100));
                                log.debug(`[OPERATOR] [SHOW_REQUEST] Eski xabar o'chirildi (kutilayotgan so'rovlar yoki eslatma, yangi chat ID): groupId=${newChatId}, messageId=${messageId}`);
                            } catch (deleteError) {
                                untrackMessage(newChatId, messageId);
                                log.debug(`[OPERATOR] [SHOW_REQUEST] Xabar o'chirishda xatolik (ignored): messageId=${messageId}, error=${deleteError.message}`);
                            }
                        }
                    }
                } catch (cleanupError) {
                    log.debug(`[OPERATOR] [SHOW_REQUEST] Eski xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
                }
                
                // Agar kutilayotgan so'rovlar bo'lsa, guruhga xabar va inline keyboard yuborish
                if (pendingCount > 0) {
                    const pendingMessage = `📋 Sizda ${pendingCount} ta kutilayotgan so'rov bor.`;
                    
                    // Inline keyboard qo'shish
                    const pendingKeyboard = {
                        inline_keyboard: [
                            [
                                { text: '⏰ Kutilayotgan so\'rovlar', callback_data: `show_pending_requests_operator` }
                            ]
                        ]
                    };
                    
                    try {
                        const pendingSentMessage = await bot.sendMessage(newChatId, pendingMessage, {
                            reply_markup: pendingKeyboard,
                            parse_mode: 'HTML'
                        });
                        
                        // ✅ "Kutilayotgan so'rovlar" xabarlarini track qilish (keyinchalik o'chirish uchun)
                        try {
                            const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                            trackMessage(newChatId, pendingSentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true); // shouldCleanup=true - o'chirilishi kerak
                        } catch (trackError) {
                            log.debug(`[OPERATOR] [SHOW_REQUEST] "Kutilayotgan so'rovlar" xabarni track qilishda xatolik (ignored): ${trackError.message}`);
                        }
                        
                        log.info(`[OPERATOR] [SHOW_REQUEST] 2.6. ✅ Kutilayotgan so'rovlar xabari va knopka yuborildi (yangi chat ID): ${pendingCount} ta`);
                    } catch (error) {
                        log.debug(`[OPERATOR] [SHOW_REQUEST] Kutilayotgan so'rovlar xabari yuborishda xatolik (ignored): ${error.message}`);
                    }
                }
            } else {
                // Boshqa xatoliklar
                throw sendError;
            }
        }
        
        // ✅ Xabarni messageTracker'ga qo'shish (cleanup'dan himoya qilish - Telegraph linklar va xabarlar saqlanishi kerak)
        try {
            const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
            trackMessage(groupId, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, false, request.id, false); // shouldCleanup=false, requestId=request.id - so'rov xabarlari o'chirilmasligi kerak
            log.debug(`[OPERATOR] [SHOW_REQUEST] Xabar kuzatishga qo'shildi: groupId=${groupId}, messageId=${sentMessage.message_id}, requestId=${request.id}`);
        } catch (trackError) {
            log.debug(`[OPERATOR] [SHOW_REQUEST] Xabarni kuzatishga qo'shishda xatolik (ignored): ${trackError.message}`);
        }
        
    } catch (error) {
        log.error(`[OPERATOR] [SHOW_REQUEST] ❌ Operatorlar guruhiga so'rov ko'rsatishda xatolik: requestId=${request.id}, operatorId=${operatorId}, error=${error.message}`, error);
        log.error(`[OPERATOR] [SHOW_REQUEST] Xatolik stack trace:`, error.stack);
    }
}

/**
 * Operator tasdiqlash
 */
async function handleOperatorApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    // Callback_data'dan requestId va operatorId ni olish: operator_approve_${requestId}_${operatorId}
    const parts = query.data.split('_');
    const requestId = parseInt(parts[2]);
    const assignedOperatorId = parts.length > 3 ? parseInt(parts[3]) : null;
    
    log.info(`[OPERATOR] [APPROVAL] [START] Operator tasdiqlash boshlandi: requestId=${requestId}, userId=${userId}, chatId=${chatId}, assignedOperatorId=${assignedOperatorId}`);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // ✅ OPTIMALLASHTIRISH: Avval so'rovni tekshirish (eng tez)
        let request = await db('debt_requests')
            .where('id', requestId)
            .whereIn('status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER', 'REVERSED_BY_OPERATOR'])
            .where('locked', false)
            .first();
        
        if (!request) {
            // Agar status bilan topilmasa, statusni tekshirmasdan qidirish (debug uchun)
            const requestWithoutStatus = await db('debt_requests')
                .where('id', requestId)
                .first();
            
            if (requestWithoutStatus) {
                log.warn(`[OPERATOR] [APPROVAL] ❌ So'rov topildi, lekin status mos kelmaydi yoki bloklangan: requestId=${requestId}, status=${requestWithoutStatus.status}, locked=${requestWithoutStatus.locked}`);
                // Eski tugmani olib tashlash va "Allaqachon tasdiqlangan" ko'rsatish — foydalanuvchi qayta bosmasin
                try {
                    await bot.editMessageText(
                        `✅ So'rov allaqachon tasdiqlangan.\n\n📋 ID: ${requestWithoutStatus.request_uid || requestId}`,
                        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
                    );
                } catch (editErr) {
                    log.debug(`[OPERATOR] [APPROVAL] Xabarni yangilashda xatolik (e'tiborsiz): messageId=${query.message.message_id}, err=${editErr.message}`);
                }
                // Boshida "Tasdiqlanmoqda..." yuborilgan, qayta answerCallbackQuery chaqirilmaydi
            } else {
                log.warn(`[OPERATOR] [APPROVAL] ❌ So'rov topilmadi: requestId=${requestId}`);
                await bot.answerCallbackQuery(query.id, { text: 'So\'rov topilmadi.', show_alert: true });
            }
            return;
        }
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        
        if (!user) {
            log.error(`[OPERATOR] [APPROVAL] ❌ Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        log.info(`[OPERATOR] [APPROVAL] 3.1. Foydalanuvchi topildi: UserId=${user.id}, Fullname=${user.fullname}, Role=${user.role}, Username=${user.username}`);
        
        // Foydalanuvchi operator ekanligini tekshirish - rolni yoki vazifani tekshirish
        let isOperator = false;
        
        // 1. Asosiy rolni tekshirish
        if (user.role === 'operator') {
            isOperator = true;
            log.info(`[OPERATOR] [APPROVAL] 3.2.1. ✅ Foydalanuvchi asosiy roli operator`);
        } else {
            // 2. Operator vazifasini tekshirish (debt_user_tasks jadvalidan) - user.id ishlatiladi
            const operatorTask = await db('debt_user_tasks')
                .where('user_id', user.id)
                .where(function() {
                    this.where('task_type', 'approve_operator')
                        .orWhere('task_type', 'debt:approve_operator');
                })
                .first();
            
            if (operatorTask) {
                isOperator = true;
                log.info(`[OPERATOR] [APPROVAL] 3.2.2. ✅ Foydalanuvchi operator vazifasiga ega: taskId=${operatorTask.id}, taskType=${operatorTask.task_type}`);
            } else {
                // 3. Permission'ni tekshirish
                const hasPermission = await userHelper.hasPermission(user.id, 'debt:approve_operator');
                if (hasPermission) {
                    isOperator = true;
                    log.info(`[OPERATOR] [APPROVAL] 3.2.3. ✅ Foydalanuvchi operator permission'iga ega`);
                }
            }
        }
        
        if (!isOperator) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Foydalanuvchi operator emas: userId=${user.id}, role=${user.role}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu funksiya faqat operatorlar uchun.', show_alert: true });
            return;
        }
        
        log.info(`[OPERATOR] [APPROVAL] 3.2. ✅ Foydalanuvchi operator ekanligi tasdiqlandi`);
        
        // Operatorning barcha brendlar uchun ishlaydiganligini tekshirish (operatorTask)
        const operatorTask = await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                this.where('task_type', 'approve_operator')
                    .orWhere('task_type', 'debt:approve_operator');
            })
            .first();
        
        const hasAllBrandsAccess = !!operatorTask;
        
        // Tegishli operator ekanligini tekshirish
        // Agar callback_data'da assignedOperatorId bo'lsa va u foydalanuvchi ID'siga teng bo'lmasa, rad etish
        // Lekin agar operator barcha brendlar uchun ishlaydi (operatorTask mavjud), assignedOperatorId tekshiruvini o'tkazib yuborish
        // Yoki agar assignedOperatorId null bo'lsa (reminder message format), tekshiruvni o'tkazib yuborish
        if (assignedOperatorId && assignedOperatorId !== user.id && !hasAllBrandsAccess) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Bu so'rov boshqa operatorga biriktirilgan: requestId=${requestId}, assignedOperatorId=${assignedOperatorId}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga tegishli emas. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        // current_approver_id va current_approver_type ni tekshirish
        // Agar operator barcha brendlar uchun ishlaydi (operatorTask mavjud), current_approver_id tekshiruvini o'tkazib yuborish
        // Yoki agar callback_data'da assignedOperatorId null bo'lsa (reminder message format), current_approver_id tekshiruvini o'tkazib yuborish
        // Chunki reminder message'larida va barcha brendlar uchun ishlaydigan operatorlar har qanday so'rovni tasdiqlay oladi
        if (assignedOperatorId !== null && !hasAllBrandsAccess && request.current_approver_id && request.current_approver_id !== user.id) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Bu so'rov boshqa operatorga biriktirilgan (current_approver_id): requestId=${requestId}, currentApproverId=${request.current_approver_id}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov boshqa operatorga biriktirilgan. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        // To'liq request ma'lumotlarini olish (brand_name, filial_name, svr_name bilan)
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
            log.error(`[OPERATOR] [APPROVAL] ❌ To'liq request ma'lumotlari topilmadi: requestId=${requestId}`);
            await bot.sendMessage(chatId, '❌ So\'rov ma\'lumotlari topilmadi.');
            return;
        }
        
        request = fullRequest; // To'liq ma'lumotlar bilan almashtirish
        
        log.info(`[OPERATOR] [APPROVAL] [STEP_1] So'rov topildi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}, status=${request.status}, brand=${request.brand_name}, branch=${request.filial_name}`);
        
        // So'rovni bloklash (double-check)
        const lockResult = await db('debt_requests')
            .where('id', requestId)
            .where('locked', false)
            .update({
                locked: true,
                locked_by: user.id,
                locked_at: db.fn.now()
            });
        
        if (lockResult === 0) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Lock muvaffaqiyatsiz (allaqachon tasdiqlanmoqda): requestId=${requestId}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov allaqachon tasdiqlanmoqda.', show_alert: true });
            return;
        }
        log.info(`[OPERATOR] [APPROVAL] [STEP_2] Lock muvaffaqiyatli: requestId=${requestId}, operatorId=${user.id}`);
        
        // Operatorning brendiga tegishli ekanligini tekshirish
        // Agar current_approver_id null bo'lsa, operatorning brendiga tegishli ekanligini tekshiramiz
        if (request.current_approver_id !== user.id || request.current_approver_type !== 'operator') {
            // Operatorning brendlarini olish (debt_operators, debt_user_brands va debt_user_tasks jadvallaridan)
            const [operatorBrandsFromTable, operatorBrandsFromBindings, operatorTask] = await Promise.all([
                db('debt_operators')
                    .where('user_id', user.id)
                    .where('is_active', true)
                    .pluck('brand_id'),
                db('debt_user_brands')
                    .where('user_id', user.id)
                    .pluck('brand_id'),
                db('debt_user_tasks')
                    .where('user_id', user.id)
                    .where(function() {
                        this.where('task_type', 'approve_operator')
                            .orWhere('task_type', 'debt:approve_operator');
                    })
                    .first()
            ]);
            
            log.info(`[OPERATOR] [APPROVAL] 5.1. Operatorning brendlari: debt_operators=${operatorBrandsFromTable.length} ta, debt_user_brands=${operatorBrandsFromBindings.length} ta, hasOperatorTask=${!!operatorTask}`, {
                debt_operators: operatorBrandsFromTable,
                debt_user_brands: operatorBrandsFromBindings
            });
            
            // Birlashtirish (dublikatlarni olib tashlash)
            let operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
            
            // Agar operator vazifasiga ega bo'lsa (debt_user_tasks), barcha brendlar bo'yicha ishlaydi
            if (operatorTask) {
                // Barcha brendlarni olish (cheklovlarsiz)
                const allBrands = await db('debt_brands').pluck('id');
                operatorBrands = allBrands;
                log.info(`[OPERATOR] [APPROVAL] 5.1.1. Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi: ${allBrands.length} ta brend`);
            }
            
            log.info(`[OPERATOR] [APPROVAL] 5.2. Birlashtirilgan brendlar: ${operatorBrands.length} ta`, operatorBrands);
            
            if (operatorBrands.length === 0 || !operatorBrands.includes(request.brand_id)) {
                log.warn(`[OPERATOR] [APPROVAL] ❌ Operator bu brendga tegishli emas: requestBrandId=${request.brand_id}, operatorBrands=${operatorBrands.join(', ')}`);
                await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga tegishli emas.', show_alert: true });
                return;
            }
            
            // Agar current_approver_id null bo'lsa, uni o'rnatamiz
            if (!request.current_approver_id) {
                log.info(`[OPERATOR] [APPROVAL] 5.4. current_approver_id null, o'rnatilmoqda: operatorId=${user.id}`);
                await db('debt_requests')
                    .where('id', requestId)
                    .update({
                        current_approver_id: user.id,
                        current_approver_type: 'operator'
                    });
            }
        } else {
            log.info(`[OPERATOR] [APPROVAL] 5.1. ✅ Operator so'rovga tayinlangan: operatorId=${user.id}`);
        }
        
        // So'rovni bloklash (bu yerda allaqachon bloklangan, lekin keyingi kodlar uchun saqlanmoqda)
        log.info(`[OPERATOR] [APPROVAL] 6.1. ✅ So'rov bloklandi`);
        
        // ✅ OPTIMALLASHTIRISH: Loglarni parallel qilish
        await Promise.all([
            logApproval(requestId, user.id, 'operator', 'approved', {}),
            logRequestAction(requestId, 'operator_approved', user.id, {
                new_status: 'APPROVED_BY_OPERATOR'
            })
        ]);
        
        log.info(`[OPERATOR] [APPROVAL] 7.1. ✅ Tasdiqlash log qilindi`);
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_OPERATOR',
                current_approver_id: null,
                current_approver_type: null,
                locked: false,
                locked_by: null,
                locked_at: null
            });
        
        log.info(`[OPERATOR] [APPROVAL] [STEP_3] Status APPROVED_BY_OPERATOR: requestId=${requestId}, type=${request.type}. Keyingi: supervisor bor bo'lsa ularga, yo'q bo'lsa final guruhga.`);
        
        // Supervisor'larga yuborish (agar operatorlarga nazoratchi biriktirilgan bo'lsa)
        const { getSupervisorsForOperators } = require('../../../utils/supervisorAssignment.js');
        const supervisors = await getSupervisorsForOperators(requestId, request.brand_id);
        
        if (supervisors.length > 0) {
            log.info(`[OPERATOR] [APPROVAL] [STEP_4A] Supervisor'lar topildi: requestId=${requestId}, count=${supervisors.length}. So'rov avval supervisor'larga yuboriladi.`);
            const { showRequestToSupervisor } = require('./supervisor.js');
            
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
                await showRequestToSupervisor(fullRequest, supervisors, 'operator');
                log.info(`[OPERATOR] [APPROVAL] [STEP_5A] So'rov supervisor'larga yuborildi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}`);
            }
        } else {
            log.info(`[OPERATOR] [APPROVAL] [STEP_4B] Supervisor'lar yo'q: requestId=${requestId}, type=${request.type}. Final guruhga to'g'ridan-to'g'ri yuboriladi (ketma-ketlik: operator→final, jarayon tugaydi).`);
            
            // Final guruhga yuborish (status FINAL_APPROVED ga o'zgaradi)
            await sendToFinalGroup(requestId);
            log.info(`[OPERATOR] [APPROVAL] [DONE_FINAL] Final guruhga xabar yuborildi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}. Status=FINAL_APPROVED, jarayon tugadi.`);
        }
        
        // Xabarni yangilash
        const newStatus = supervisors.length > 0 ? 'APPROVED_BY_OPERATOR' : 'FINAL_APPROVED';
        await updateRequestMessage(requestId, newStatus, {
            username: user.username,
            fullname: user.fullname,
            approval_type: 'operator'
        });
        
        log.info(`[OPERATOR] [APPROVAL] 10.1. ✅ Xabar yangilandi: status=${newStatus}`);
        
        // Eslatmalarni to'xtatish
        cancelReminders(requestId);
        
        const clickedMessageId = query.message.message_id;
        
        // Tasdiqlash xabari: xabarni o'chirmasdan edit qilamiz — Operator: ism (@username), Status, Telegraph link qoladi
        if (request.type === 'SET' && request.excel_data) {
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
            
            request.excel_data = excelData;
            request.excel_headers = excelHeaders;
            request.excel_columns = excelColumns;
        }
        
        const approvalMessage = await formatRequestMessageWithApprovals(request, db, 'operator');
        const statusLine = supervisors.length > 0 ? "Supervisor'larga yuborildi." : "Final guruhga yuborildi.";
        const operatorLine = `Operator: ${user.fullname || 'Noma\'lum'}${user.username ? ' (@' + user.username + ')' : ''}`;
        const header = `✅ So'rov tasdiqlandi!\n\nID: ${request.request_uid}\n${operatorLine}\nStatus: ${statusLine}\n\n`;
        const fullApprovalMessage = header + approvalMessage;
        
        try {
            await bot.editMessageText(fullApprovalMessage, {
                chat_id: chatId,
                message_id: clickedMessageId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
            });
            const { markAsApproved } = require('../utils/messageTracker.js');
            markAsApproved(chatId, clickedMessageId, requestId);
            log.debug(`[OPERATOR] [APPROVAL] Xabar tasdiqlangan ko'rinishda yangilandi (o'chirilmadi): chatId=${chatId}, messageId=${clickedMessageId}`);
        } catch (editError) {
            const isMessageNotFound = editError.message?.includes('message to edit not found') ||
                                     editError.message?.includes('message not found') ||
                                     (editError.response?.body?.description && editError.response.body.description.includes('message to edit not found'));
            if (!isMessageNotFound) {
                log.warn(`[OPERATOR] [APPROVAL] Xabarni yangilashda xatolik: requestId=${requestId}, error=${editError.message}`);
            }
        }
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextOperatorRequest(userId, chatId);
        
        log.info(`[OPERATOR] [APPROVAL] [DONE] Operator tasdiqlash yakunlandi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}, operatorId=${user.id}. So'rov supervisor'ga yoki final guruhga yuborildi (ketma-ketlik).`);
    } catch (error) {
        log.error(`[OPERATOR] [APPROVAL] [ERROR] requestId=${requestId}, error=${error.message}`, error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Qarzi bor bosilganda
 */
async function handleOperatorDebt(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    // Callback_data'dan requestId va operatorId ni olish: operator_debt_${requestId}_${operatorId}
    const parts = query.data.split('_');
    const requestId = parseInt(parts[2]);
    const assignedOperatorId = parts.length > 3 ? parseInt(parts[3]) : null;
    
    log.info(`[OPERATOR] [DEBT] Operator qarzi bor boshlanmoqda: requestId=${requestId}, userId=${userId}, chatId=${chatId}, assignedOperatorId=${assignedOperatorId}`);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // So'rovni olish (brand_name, filial_name, svr_name bilan)
        let request = await db('debt_requests')
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
            .whereIn('debt_requests.status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER', 'REVERSED_BY_OPERATOR'])
            .first();
        
        if (!request) {
            await bot.answerCallbackQuery(query.id, { text: 'So\'rov topilmadi yoki allaqachon tasdiqlangan.', show_alert: true });
            return;
        }
        
        // Operatorning barcha brendlar uchun ishlaydiganligini tekshirish (operatorTask)
        const operatorTask = await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                this.where('task_type', 'approve_operator')
                    .orWhere('task_type', 'debt:approve_operator');
            })
            .first();
        
        const hasAllBrandsAccess = !!operatorTask;
        
        // Tegishli operator ekanligini tekshirish
        // Agar operator barcha brendlar uchun ishlaydi (operatorTask mavjud), assignedOperatorId tekshiruvini o'tkazib yuborish
        if (assignedOperatorId && assignedOperatorId !== user.id && !hasAllBrandsAccess) {
            log.warn(`[OPERATOR] [DEBT] ❌ Bu so'rov boshqa operatorga biriktirilgan: requestId=${requestId}, assignedOperatorId=${assignedOperatorId}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga tegishli emas. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        // current_approver_id va current_approver_type ni tekshirish (agar mavjud bo'lsa)
        // Agar operator barcha brendlar uchun ishlaydi (operatorTask mavjud), current_approver_id tekshiruvini o'tkazib yuborish
        if (!hasAllBrandsAccess && request.current_approver_id && request.current_approver_id !== user.id) {
            log.warn(`[OPERATOR] [DEBT] ❌ Bu so'rov boshqa operatorga biriktirilgan (current_approver_id): requestId=${requestId}, currentApproverId=${request.current_approver_id}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov boshqa operatorga biriktirilgan. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        // Operatorning brendiga tegishli ekanligini tekshirish
        // Agar current_approver_id null bo'lsa, operatorning brendiga tegishli ekanligini tekshiramiz
        if (request.current_approver_id !== user.id || request.current_approver_type !== 'operator') {
            // Operatorning brendlarini olish (debt_operators, debt_user_brands va debt_user_tasks jadvallaridan)
            const [operatorBrandsFromTable, operatorBrandsFromBindings, operatorTask] = await Promise.all([
                db('debt_operators')
                    .where('user_id', user.id)
                    .where('is_active', true)
                    .pluck('brand_id'),
                db('debt_user_brands')
                    .where('user_id', user.id)
                    .pluck('brand_id'),
                db('debt_user_tasks')
                    .where('user_id', user.id)
                    .where(function() {
                        this.where('task_type', 'approve_operator')
                            .orWhere('task_type', 'debt:approve_operator');
                    })
                    .first()
            ]);
            
            // Birlashtirish (dublikatlarni olib tashlash)
            let operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
            
            // Agar operator vazifasiga ega bo'lsa (debt_user_tasks), barcha brendlar bo'yicha ishlaydi
            if (operatorTask) {
                // Barcha brendlarni olish (cheklovlarsiz)
                const allBrands = await db('debt_brands').pluck('id');
                operatorBrands = allBrands;
                log.info(`[OPERATOR] [DEBT] Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi: ${allBrands.length} ta brend`);
            }
            
            if (operatorBrands.length === 0 || !operatorBrands.includes(request.brand_id)) {
                await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga tegishli emas.', show_alert: true });
                return;
            }
            
            // Agar current_approver_id null bo'lsa, uni o'rnatamiz
            if (!request.current_approver_id) {
                await db('debt_requests')
                    .where('id', requestId)
                    .update({
                        current_approver_id: user.id,
                        current_approver_type: 'operator'
                    });
            }
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
        
        log.info(`[OPERATOR_DEBT] Qarzi bor bosildi: requestId=${requestId}, userId=${user.id}, brandId=${request.brand_id}, branchId=${request.branch_id}`);
        log.info(`[QARZI_BOR] [OPERATOR] 1. Tugma bosildi → State: UPLOAD_DEBT_EXCEL. So'rov: ${request.request_uid}, brend: ${request.brand_name}, filial: ${request.filial_name}. Keyingi: Operator Excel fayl yuboradi.`);
        
        // Xabarni callback query kelgan chatga yuborish (guruhda bo'lsa guruhga, shaxsiy chatda bo'lsa shaxsiy chatga)
        await bot.sendMessage(
            chatId,
            '📎 Qarzdorlik faylingizni yuboring.'
        );
    } catch (error) {
        log.error('Error handling operator debt:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Qarzi bor javobini yuborish
 */
async function sendDebtResponse(requestId, userId, chatId, debtData) {
    log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] 🔄 Qardorlik javobi yuborilmoqda: requestId=${requestId}, operatorId=${userId}, chatId=${chatId}, debtRows=${debtData.excel_data?.length || 0}, totalAmount=${debtData.total_amount || 0}`);
    log.info(`[QARZI_BOR] [OPERATOR] 2. sendDebtResponse boshlandi. requestId=${requestId}, operatorId=${userId}. Ma'lumot: excelQator=${debtData.excel_data?.length || 0}, totalAmount=${debtData.total_amount ?? 'yo\'q'}.`);
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
        
        // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
        // MUHIM: "Qarzi bor" javobida har doim Telegraph link ishlatilishi kerak
        let telegraphUrl = null;
        if (debtData.excel_data && Array.isArray(debtData.excel_data) && debtData.excel_data.length > 0 && debtData.excel_columns) {
            try {
                const { createDebtDataPage } = require('../../../utils/telegraph.js');
                telegraphUrl = await createDebtDataPage({
                    request_uid: request.request_uid,
                    brand_name: request.brand_name,
                    filial_name: request.filial_name,
                    svr_name: request.svr_name,
                    month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                    extra_info: request.extra_info,
                    excel_data: debtData.excel_data,
                    excel_headers: debtData.excel_headers,
                    excel_columns: debtData.excel_columns,
                    total_amount: debtData.total_amount,
                    logContext: 'operator_debt_response'
                });
                if (telegraphUrl) log.info(`[QARZI_BOR] [OPERATOR] Telegraph sahifa yaratildi (qarzdorlik ro'yxati): ${telegraphUrl}`);
                
                if (!telegraphUrl) {
                    log.warn(`[OPERATOR] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${requestId}`);
                    // Qayta urinish
                    try {
                        telegraphUrl = await createDebtDataPage({
                            request_uid: request.request_uid,
                            brand_name: request.brand_name,
                            filial_name: request.filial_name,
                            svr_name: request.svr_name,
                            month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                            extra_info: request.extra_info,
                            excel_data: debtData.excel_data,
                            excel_headers: debtData.excel_headers,
                            excel_columns: debtData.excel_columns,
                            total_amount: debtData.total_amount,
                            logContext: 'operator_debt_response_retry'
                        });
                    } catch (retryError) {
                        log.error(`[OPERATOR] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${requestId}, error=${retryError.message}`);
                    }
                }
            } catch (telegraphError) {
                log.error(`[OPERATOR] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda xatolik: requestId=${requestId}, error=${telegraphError.message}`);
                // Qayta urinish
                try {
                    telegraphUrl = await createDebtDataPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: debtData.excel_data,
                        excel_headers: debtData.excel_headers,
                        excel_columns: debtData.excel_columns,
                        total_amount: debtData.total_amount,
                        logContext: 'operator_debt_response_retry2'
                    });
                } catch (retryError) {
                    log.error(`[OPERATOR] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${requestId}, error=${retryError.message}`);
                }
            }
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
            excel_columns: debtData.excel_columns,
            telegraph_url: telegraphUrl
        });
        
        // Solishtirish natijasini tekshirish (FAQAT SET so'rovlar uchun)
        const comparisonResult = debtData.comparison_result;
        const isSetRequest = request.type === 'SET';
        const hasDifferences = isSetRequest && comparisonResult && comparisonResult.canCompare && !comparisonResult.isIdentical && comparisonResult.differences && comparisonResult.differences.length > 0;
        const isIdentical = isSetRequest && comparisonResult && comparisonResult.canCompare && comparisonResult.isIdentical;
        
        // SET so'rovlar uchun: Agar farq bo'lsa va farqi ko'p bo'lsa (totalDifference > 0), teskari jarayon
        if (isSetRequest && hasDifferences && comparisonResult.totalDifference > 0) {
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] SET so'rovda farq topildi va teskari jarayon boshlanmoqda: requestId=${requestId}, totalDifference=${comparisonResult.totalDifference}, inputType=${debtData.input_type}`);
            log.info(`[QARZI_BOR] [OPERATOR] 3. TESKARI JARAYON (SET, farq bor). Xabarlar: Menejer (preview yangilanadi), Rahbarlar guruhi, Final guruh. Status → REVERSED_BY_OPERATOR.`);
            
            // ✅ Operator uchun klient bo'yicha farqlar sahifasini yaratish
            let differencesTelegraphUrl = null;
            if (comparisonResult.differences && comparisonResult.differences.length > 0) {
                // Operator tayyor faylni biriktiradi (klientlar ro'yxati)
                try {
                    const { createDifferencesPage } = require('../../../utils/telegraph.js');
                    differencesTelegraphUrl = await createDifferencesPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        differences: comparisonResult.differences,
                        input_type: 'client' // Operator uchun klient bo'yicha farqlar
                    });
                    log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Klient bo'yicha farqlar sahifasi yaratildi: URL=${differencesTelegraphUrl}`);
                } catch (error) {
                    log.error(`[OPERATOR] [SEND_DEBT_RESPONSE] Klient bo'yicha farqlar sahifasini yaratishda xatolik: ${error.message}`);
                }
            }
            // Reja: debtData da Link 1 (telegraph) va Link 2 (farqlar) – formatRequestMessageWithApprovals va logApproval uchun
            debtData.telegraph_url = telegraphUrl;
            debtData.differences_telegraph_url = differencesTelegraphUrl;
            
            // Ro'yxatga qaytarish: so'rov yana operatorga biriktiriladi
            await db('debt_requests').where('id', requestId).update({
                status: 'REVERSED_BY_OPERATOR',
                current_approver_id: user.id,
                current_approver_type: 'operator'
            });
            await logApproval(requestId, user.id, 'operator', 'reversed', {
                excel_file_path: debtData.excel_file_path,
                image_file_path: debtData.image_file_path,
                telegraph_url: debtData.telegraph_url,
                differences_telegraph_url: debtData.differences_telegraph_url,
                total_difference: comparisonResult.totalDifference,
                differences_count: comparisonResult.differences.length,
                comparison_result: comparisonResult
            });
            // Qaytarilish soni: shu so'rov (request_id) bo'yicha
            const reversalRow = await db('debt_request_approvals').where('request_id', requestId).where('status', 'reversed').count('* as c').first();
            const reversalCount = reversalRow && reversalRow.c != null ? parseInt(reversalRow.c, 10) : 1;
            const reversalSuffix = reversalCount > 0 ? ` (${reversalCount}-marta)` : '';
            
            // Menejerga xabar yuborish (tasdiqlanganlar va qaytarilgan holatlar bilan)
            const manager = await db('users').where('id', request.created_by).first();
            if (manager && manager.telegram_chat_id) {
                // ✅ formatRequestMessageWithApprovals ishlatish (tasdiqlanganlar va qaytarilgan holatlar bilan)
                // Funksiya allaqachon fayl boshida import qilingan
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
                    // Status'ni reversed ga o'zgartirish (formatRequestMessageWithApprovals uchun)
                    fullRequest.status = 'reversed';
                    
                    // Kim tomonidan qaytarilganini aniqlash
                    const reversedApproval = await db('debt_request_approvals')
                        .where('request_id', requestId)
                        .where('status', 'reversed')
                        .orderBy('created_at', 'desc')
                        .first();
                    
                    let reversedBy = 'Operator';
                    if (reversedApproval) {
                        if (reversedApproval.approval_type === 'cashier') {
                            reversedBy = 'Kassir';
                        } else if (reversedApproval.approval_type === 'operator') {
                            reversedBy = 'Operator';
                        }
                    }
                    
                    let reverseMessage = `⚠️ <b>Teskari jarayon${reversalSuffix}</b>\n\n` +
                        `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                    // Link 1 + Link 2 shablon ichida (formatRequestMessageWithApprovals)
                    const approvalMessage = await formatRequestMessageWithApprovals(fullRequest, db, 'manager', debtData);
                    reverseMessage += approvalMessage;
                    log.info(`[REJA] [OPERATOR] Teskari xabar menejer uchun: Link1=${!!debtData.telegraph_url}, Link2=${!!debtData.differences_telegraph_url}`);
                
                const bot = getBot();
                
                // ✅ "So'rov muvaffaqiyatli yaratildi!" xabarini "Teskari jarayon" formatiga o'zgartirish
                if (fullRequest.preview_message_id && fullRequest.preview_chat_id) {
                    try {
                        await bot.editMessageText(
                            reverseMessage,
                            {
                                chat_id: fullRequest.preview_chat_id,
                                message_id: fullRequest.preview_message_id,
                                parse_mode: 'HTML'
                            }
                        );
                        log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] ✅ "So'rov muvaffaqiyatli yaratildi!" xabari "Teskari jarayon" formatiga o'zgartirildi: requestId=${requestId}, messageId=${fullRequest.preview_message_id}`);
                        log.info(`[QARZI_BOR] [OPERATOR] Teskari jarayon: Menejer xabari yangilandi (preview → Teskari jarayon). chatId=${fullRequest.preview_chat_id}, messageId=${fullRequest.preview_message_id}`);
                    } catch (updateError) {
                        log.warn(`[OPERATOR] [SEND_DEBT_RESPONSE] ⚠️ "So'rov muvaffaqiyatli yaratildi!" xabarini yangilashda xatolik: requestId=${requestId}, error=${updateError.message}`);
                        // Xatolik bo'lsa, yangi xabar sifatida yuborish
                        await bot.sendMessage(manager.telegram_chat_id, reverseMessage, { parse_mode: 'HTML' });
                        log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Menejerga teskari jarayon xabari yangi xabar sifatida yuborildi: requestId=${requestId}, managerId=${manager.id}`);
                    }
                } else {
                    // Preview message ID yo'q bo'lsa, yangi xabar sifatida yuborish
                    await bot.sendMessage(manager.telegram_chat_id, reverseMessage, { parse_mode: 'HTML' });
                    log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Menejerga teskari jarayon xabari yuborildi: requestId=${requestId}, managerId=${manager.id}, hasDifferencesTelegraphUrl=${!!differencesTelegraphUrl}`);
                    log.info(`[QARZI_BOR] [OPERATOR] Teskari jarayon: xabar yuborildi → Menejer (yangi xabar). chatId=${manager.telegram_chat_id}`);
                }
                }
            }
            
            // SET so'rov bo'lsa, rahbarlarga va final guruhga ham yuborish (reverse process)
            const leadersGroup = await db('debt_groups')
                .where('group_type', 'leaders')
                .where('is_active', true)
                .first();
            
            const finalGroup = await db('debt_groups')
                .where('group_type', 'final')
                .where('is_active', true)
                .first();
            
            // ✅ formatRequestMessageWithApprovals ishlatish (tasdiqlanganlar va qaytarilgan holatlar bilan)
            // Funksiya allaqachon fayl boshida import qilingan
            // Rahbarlar va final guruhga yuborish uchun so'rov ma'lumotlarini olish
            const fullRequestForGroups = await db('debt_requests')
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
            
            if (fullRequestForGroups) {
                // Status'ni reversed ga o'zgartirish (formatRequestMessageWithApprovals uchun)
                fullRequestForGroups.status = 'reversed';
                
                // Kim tomonidan qaytarilganini aniqlash
                const reversedApproval = await db('debt_request_approvals')
                    .where('request_id', requestId)
                    .where('status', 'reversed')
                    .orderBy('created_at', 'desc')
                    .first();
                
                let reversedBy = 'Operator';
                if (reversedApproval) {
                    if (reversedApproval.approval_type === 'cashier') {
                        reversedBy = 'Kassir';
                    } else if (reversedApproval.approval_type === 'operator') {
                        reversedBy = 'Operator';
                    }
                }
                
                let reverseMessage = `⚠️ <b>Teskari jarayon${reversalSuffix}</b>\n\n` +
                    `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                
                // Rahbarlar guruhiga yuborish – faqat SET (NORMAL da operatorga kelgunicha rahbar yo'q, menejer→kassir→operator)
                if (leadersGroup && fullRequestForGroups.type === 'SET') {
                    const approvalMessageForLeaders = await formatRequestMessageWithApprovals(fullRequestForGroups, db, 'leader', debtData);
                    let reverseMessageForLeaders = `⚠️ <b>Teskari jarayon${reversalSuffix}</b>\n\n` +
                        `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                    reverseMessageForLeaders += approvalMessageForLeaders;
                    log.info(`[REJA] [OPERATOR] Teskari xabar rahbarlar uchun: Link1=${!!debtData.telegraph_url}, Link2=${!!debtData.differences_telegraph_url}`);
                    
                    const bot = getBot();
                    await bot.sendMessage(leadersGroup.telegram_group_id, reverseMessageForLeaders, { parse_mode: 'HTML' });
                    log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Rahbarlar guruhiga teskari jarayon xabari yuborildi: requestId=${requestId}, groupId=${leadersGroup.telegram_group_id}, hasDifferencesTelegraphUrl=${!!differencesTelegraphUrl}`);
                    log.info(`[QARZI_BOR] [OPERATOR] Teskari jarayon: xabar yuborildi → Rahbarlar guruhi. groupId=${leadersGroup.telegram_group_id}`);
                }
                
                // Final guruhga yuborish (Link 1 + Link 2 shablon ichida)
                if (finalGroup) {
                    const approvalMessageForFinal = await formatRequestMessageWithApprovals(fullRequestForGroups, db, 'final', debtData);
                    let reverseMessageForFinal = `⚠️ <b>Teskari jarayon${reversalSuffix}</b>\n\n` +
                        `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                    reverseMessageForFinal += approvalMessageForFinal;
                    log.info(`[REJA] [OPERATOR] Teskari xabar final uchun: Link1=${!!debtData.telegraph_url}, Link2=${!!debtData.differences_telegraph_url}`);
                    
                    const bot = getBot();
                    await bot.sendMessage(finalGroup.telegram_group_id, reverseMessageForFinal, { parse_mode: 'HTML' });
                    log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Final guruhga teskari jarayon xabari yuborildi: requestId=${requestId}, groupId=${finalGroup.telegram_group_id}, hasDifferencesTelegraphUrl=${!!differencesTelegraphUrl}`);
                    log.info(`[QARZI_BOR] [OPERATOR] Teskari jarayon: xabar yuborildi → Final guruh. groupId=${finalGroup.telegram_group_id}`);
                }
            }
            
            log.info(`[QARZI_BOR] [OPERATOR] 5. Status yangilandi → REVERSED_BY_OPERATOR (teskari jarayon). requestId=${requestId}. Ro'yxatga qaytarildi.`);
            log.info(`[REJA] [OPERATOR] logApproval reversed: telegraph_url=${!!debtData.telegraph_url}, differences_telegraph_url=${!!debtData.differences_telegraph_url}`);
            
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Teskari jarayon yakunlandi: requestId=${requestId}, operatorId=${user.id}`);
            return; // Teskari jarayon - final guruhga yuborilmaydi
        }
        
        // SET so'rovlar uchun: Agar bir xil bo'lsa, teskari jarayon xabari yuborilmaydi
        // Agar bir xil bo'lsa, operator "Tasdiqlash" tugmasini bosishi kerak (handleOperatorApproval chaqiriladi)
        if (isSetRequest && isIdentical) {
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] SET so'rovda ma'lumotlar bir xil, teskari jarayon xabari yuborilmaydi: requestId=${requestId}`);
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Operator "Tasdiqlash" tugmasini bosishi kerak (handleOperatorApproval chaqiriladi)`);
            // Bir xil bo'lsa, teskari jarayon xabari yuborilmaydi
            // Operator "Tasdiqlash" tugmasini bosishi kerak
            return;
        }
        
        // QARDIKLIK JAVOBI HAR DOIM TESKARI JARAYON - menejerga va rahbarlarga yuboriladi
        // Final guruhga yuborilmaydi (faqat tasdiqlash final guruhga yuboriladi)
        const recipients = [];
        
        // Menejerga xabar yuborish (ODDIY va SET so'rovlar uchun)
        const managerForDebtResponse = await db('users').where('id', request.created_by).first();
        if (managerForDebtResponse && managerForDebtResponse.telegram_chat_id) {
            recipients.push({
                id: managerForDebtResponse.telegram_chat_id,
                role: 'manager'
            });
        }
        
        // SET so'rov bo'lsa, rahbarlarga ham yuborish (faqat farq bo'lsa)
        if (isSetRequest && hasDifferences) {
            const leadersGroup = await db('debt_groups')
                .where('group_type', 'leaders')
                .where('is_active', true)
                .first();
            
            if (leadersGroup) {
                recipients.push({
                    id: leadersGroup.telegram_group_id,
                    role: 'leaders'
                });
            }
        }
        
        // Xabarlarni yuborish
        log.info(`[QARZI_BOR] [OPERATOR] 4. "Qarzi bor" xabari yuboriladi. Kimga: ${recipients.map(r => r.role).join(', ') || 'menejer'}.`);
        const bot = getBot();
        for (const recipient of recipients) {
            try {
                await bot.sendMessage(recipient.id, debtMessage, {
                    parse_mode: 'HTML'
                });
                log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] ✅ Qardorlik javobi yuborildi: requestId=${requestId}, recipientRole=${recipient.role}, recipientId=${recipient.id}, chatType=${recipient.role === 'leaders' ? 'group' : 'personal'}`);
                log.info(`[QARZI_BOR] [OPERATOR] Xabar yuborildi → ${recipient.role === 'manager' ? 'Menejer (shaxsiy)' : recipient.role === 'leaders' ? 'Rahbarlar guruhi' : recipient.role}. chatId=${recipient.id}`);
            } catch (error) {
                log.error(`Error sending debt response to ${recipient.role}:`, error);
            }
        }
        
        // Excel ma'lumotlarini yangilash (agar mavjud bo'lsa)
        if (debtData.excel_data) {
            await db('debt_requests')
                .where('id', requestId)
                .update({
                    excel_data: JSON.stringify(debtData.excel_data),
                    excel_headers: debtData.excel_headers ? JSON.stringify(debtData.excel_headers) : null,
                    excel_columns: debtData.excel_columns ? JSON.stringify(debtData.excel_columns) : null,
                    excel_total: debtData.total_amount
                });
        }
        
        // Status yangilash - qardorlik topildi, teskari jarayon
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'DEBT_FOUND_BY_OPERATOR',
                current_approver_id: null,
                current_approver_type: null
            });
        log.info(`[QARZI_BOR] [OPERATOR] 5. Status yangilandi → DEBT_FOUND_BY_OPERATOR. requestId=${requestId}. Jarayon tugadi.`);
        
        // Tasdiqlashni log qilish
        const logData = {
            excel_file_path: debtData.excel_file_path,
            image_file_path: debtData.image_file_path,
            debt_amount: debtData.total_amount
        };
        
        // SET so'rovlar uchun: Solishtirish ma'lumotlarini qo'shish (agar mavjud bo'lsa)
        if (isSetRequest && comparisonResult && comparisonResult.canCompare) {
            logData.comparison_result = comparisonResult;
            if (comparisonResult.totalDifference !== undefined) {
                logData.total_difference = comparisonResult.totalDifference;
            }
            if (comparisonResult.differences && comparisonResult.differences.length > 0) {
                logData.differences_count = comparisonResult.differences.length;
            }
        }
        
        await logApproval(requestId, user.id, 'operator', 'debt_marked', logData);
        
        log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] ✅ Qardorlik javobi yuborildi (teskari jarayon): requestId=${requestId}, requestUID=${request.request_uid}, operatorId=${user.id}, operatorName=${user.fullname}, requestType=${request.type}, recipientsCount=${recipients.length}, telegraphUrl=${telegraphUrl || 'yo\'q'}`);
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextOperatorRequest(userId, chatId);
    } catch (error) {
        log.error('Error sending debt response:', error);
        throw error;
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
        
        // Birinchi so'rovni ko'rsatish (mavjud showNextOperatorRequest ishlatiladi)
        await showNextOperatorRequest(userId, chatId);
        
        // Agar so'rov topilmagan bo'lsa, showNextOperatorRequest ichida log qilinadi
    } catch (error) {
        log.error('Error showing pending requests:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

module.exports = {
    showOperatorRequests,
    showRequestToOperator,
    showNextOperatorRequest,
    handleOperatorApproval,
    handleOperatorDebt,
    sendDebtResponse,
    handleShowPendingRequests,
    STATES
};

