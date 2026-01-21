// bot/debt-approval/handlers/operator.js
// Operator FSM handlers - So'rovlarni ko'rish, tasdiqlash, qarzi bor, preview

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { formatNormalRequestMessage, formatDebtResponseMessage, formatApprovalMessage } = require('../../../utils/messageTemplates.js');
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
 */
async function showOperatorRequests(userId, chatId) {
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
            .whereIn('debt_requests.status', ['APPROVED_BY_CASHIER', 'DEBT_MARKED_BY_CASHIER'])
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
        
        // So'rovlarni guruhga yuborish (har bir so'rovga tayinlangan operator bilan)
        if (requests.length > 0) {
            for (const req of requests) {
                // Har bir so'rovga tayinlangan operatorni olish
                const assignedOperatorId = req.current_approver_id || null;
                if (assignedOperatorId) {
                    const assignedOperator = await db('users').where('id', assignedOperatorId).first();
                    if (assignedOperator) {
                        await showRequestToOperator(req, assignedOperatorId, assignedOperator);
                        log.info(`[OPERATOR] [SHOW_REQUESTS] So'rov ko'rsatildi: requestId=${req.id}, operatorId=${assignedOperatorId}`);
                    }
                } else {
                    // Agar operator tayinlanmagan bo'lsa, log qilamiz
                    log.warn(`[OPERATOR] [SHOW_REQUESTS] So'rovga operator tayinlanmagan: requestId=${req.id}`);
                }
            }
            log.info(`[OPERATOR] [SHOW_REQUESTS] Jami ${requests.length} ta so'rov ko'rsatildi`);
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
            .whereIn('debt_requests.status', ['APPROVED_BY_CASHIER', 'DEBT_MARKED_BY_CASHIER'])
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
                    log.info(`[OPERATOR] [SHOW_NEXT] Keyingi so'rov ko'rsatilmoqda: requestId=${nextRequest.id}, operatorId=${assignedOperatorId}`);
                    await showRequestToOperator(nextRequest, assignedOperatorId, assignedOperator);
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
 */
async function showRequestToOperator(request, operatorId, operatorUser) {
    try {
        log.info(`[OPERATOR] [SHOW_REQUEST] Operatorlar guruhiga so'rov ko'rsatish boshlanmoqda: requestId=${request.id}, requestUID=${request.request_uid}, operatorId=${operatorId}`);
        
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
        
        // Operatorning ismini va username'ni olish
        let operatorFullname = 'Noma\'lum operator';
        let operatorUsername = null;
        if (operatorUser && operatorUser.fullname) {
            operatorFullname = operatorUser.fullname;
            if (operatorUser.username) {
                operatorUsername = operatorUser.username;
            }
        } else if (operatorId) {
            const operatorFromDb = await db('users').where('id', operatorId).first();
            if (operatorFromDb) {
                if (operatorFromDb.fullname) {
                    operatorFullname = operatorFromDb.fullname;
                }
                if (operatorFromDb.username) {
                    operatorUsername = operatorFromDb.username;
                }
            }
        }
        
        log.debug(`[OPERATOR] [SHOW_REQUEST] 1. So'rov ma'lumotlari: RequestId=${request.id}, Type=${request.type}, Brand=${request.brand_name}, Branch=${request.filial_name}, SVR=${request.svr_name}, OperatorId=${operatorId}, OperatorName=${operatorFullname}, OperatorUsername=${operatorUsername || 'yo\'q'}`);
        
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
                is_for_cashier: false // Operatorlar guruhiga yuborilayotgani
            });
            
            log.debug(`[OPERATOR] [SHOW_REQUEST] 2.4. SET so'rov xabari formatlandi: messageLength=${message.length}`);
        } else {
            log.debug(`[OPERATOR] [SHOW_REQUEST] 2. NORMAL so'rov, oddiy xabar formatlash...`);
            // Oddiy so'rov uchun formatNormalRequestMessage
            const { formatNormalRequestMessage } = require('../../../utils/messageTemplates.js');
            message = formatNormalRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                request_uid: request.request_uid
            });
            
            log.debug(`[OPERATOR] [SHOW_REQUEST] 2.1. NORMAL so'rov xabari formatlandi: messageLength=${message.length}`);
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
                [{ text: '✅ Tasdiqlash', callback_data: `operator_approve_${request.id}_${operatorId}` }],
                [{ text: '⚠️ Qarzi bor', callback_data: `operator_debt_${request.id}_${operatorId}` }]
            ]
        };
        
        log.info(`[OPERATOR] [SHOW_REQUEST] 3. Operatorlar guruhiga xabar yuborilmoqda: groupId=${groupId}, requestId=${request.id}, operatorId=${operatorId}`);
        
        let sentMessage;
        try {
            sentMessage = await bot.sendMessage(groupId, message, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
            
            log.info(`[OPERATOR] [SHOW_REQUEST] ✅ Operatorlar guruhiga xabar muvaffaqiyatli yuborildi: requestId=${request.id}, requestUID=${request.request_uid}, groupId=${groupId}, messageId=${sentMessage.message_id}, operatorId=${operatorId}`);
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
            } else {
                // Boshqa xatoliklar
                throw sendError;
            }
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
    
    log.info(`[OPERATOR] [APPROVAL] Operator tasdiqlash boshlanmoqda: requestId=${requestId}, userId=${userId}, chatId=${chatId}, assignedOperatorId=${assignedOperatorId}`);
    
    try {
        log.debug(`[OPERATOR] [APPROVAL] 1. Callback query javob berilmoqda...`);
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        log.debug(`[OPERATOR] [APPROVAL] 2. Foydalanuvchi ma'lumotlarini olish: userId=${userId}, chatId=${chatId}`);
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            log.error(`[OPERATOR] [APPROVAL] ❌ Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        log.info(`[OPERATOR] [APPROVAL] 2.1. Foydalanuvchi topildi: UserId=${user.id}, Fullname=${user.fullname}, Role=${user.role}, Username=${user.username}`);
        
        // Foydalanuvchi operator ekanligini tekshirish - rolni yoki vazifani tekshirish
        let isOperator = false;
        
        // 1. Asosiy rolni tekshirish
        if (user.role === 'operator') {
            isOperator = true;
            log.info(`[OPERATOR] [APPROVAL] 2.2.1. ✅ Foydalanuvchi asosiy roli operator`);
        } else {
            // 2. Operator vazifasini tekshirish (debt_user_tasks jadvalidan)
            const operatorTask = await db('debt_user_tasks')
                .where('user_id', user.id)
                .where(function() {
                    this.where('task_type', 'approve_operator')
                        .orWhere('task_type', 'debt:approve_operator');
                })
                .first();
            
            if (operatorTask) {
                isOperator = true;
                log.info(`[OPERATOR] [APPROVAL] 2.2.2. ✅ Foydalanuvchi operator vazifasiga ega: taskId=${operatorTask.id}, taskType=${operatorTask.task_type}`);
            } else {
                // 3. Permission'ni tekshirish
                const hasPermission = await userHelper.hasPermission(user.id, 'debt:approve_operator');
                if (hasPermission) {
                    isOperator = true;
                    log.info(`[OPERATOR] [APPROVAL] 2.2.3. ✅ Foydalanuvchi operator permission'iga ega`);
                }
            }
        }
        
        if (!isOperator) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Foydalanuvchi operator emas: userId=${user.id}, role=${user.role}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu funksiya faqat operatorlar uchun.', show_alert: true });
            return;
        }
        
        log.info(`[OPERATOR] [APPROVAL] 2.2. ✅ Foydalanuvchi operator ekanligi tasdiqlandi`);
        
        // So'rovni olish
        log.debug(`[OPERATOR] [APPROVAL] 3. So'rov ma'lumotlarini olish: requestId=${requestId}`);
        let request = await db('debt_requests')
            .where('id', requestId)
            .whereIn('status', ['APPROVED_BY_CASHIER', 'DEBT_MARKED_BY_CASHIER'])
            .first();
        
        if (!request) {
            // Agar status bilan topilmasa, statusni tekshirmasdan qidirish (debug uchun)
            const requestWithoutStatus = await db('debt_requests')
                .where('id', requestId)
                .first();
            
            if (requestWithoutStatus) {
                log.warn(`[OPERATOR] [APPROVAL] ❌ So'rov topildi, lekin status mos kelmaydi: requestId=${requestId}, status=${requestWithoutStatus.status}`);
                await bot.answerCallbackQuery(query.id, { text: `So'rov statusi mos kelmaydi: ${requestWithoutStatus.status}`, show_alert: true });
            } else {
                log.warn(`[OPERATOR] [APPROVAL] ❌ So'rov topilmadi: requestId=${requestId}`);
                await bot.answerCallbackQuery(query.id, { text: 'So\'rov topilmadi.', show_alert: true });
            }
            return;
        }
        
        // Tegishli operator ekanligini tekshirish
        if (assignedOperatorId && assignedOperatorId !== user.id) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Bu so'rov boshqa operatorga biriktirilgan: requestId=${requestId}, assignedOperatorId=${assignedOperatorId}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga tegishli emas. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        // current_approver_id va current_approver_type ni tekshirish (agar mavjud bo'lsa)
        if (request.current_approver_id && request.current_approver_id !== user.id) {
            log.warn(`[OPERATOR] [APPROVAL] ❌ Bu so'rov boshqa operatorga biriktirilgan (current_approver_id): requestId=${requestId}, currentApproverId=${request.current_approver_id}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov boshqa operatorga biriktirilgan. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        log.info(`[OPERATOR] [APPROVAL] 3.1. So'rov topildi: RequestId=${request.id}, RequestUID=${request.request_uid}, Status=${request.status}, BrandId=${request.brand_id}, BranchId=${request.branch_id}`);
        
        // Lock tekshirish
        log.debug(`[OPERATOR] [APPROVAL] 4. So'rov bloklanganligini tekshirish: locked=${request.locked}, locked_by=${request.locked_by}`);
        if (request.locked) {
            log.warn(`[OPERATOR] [APPROVAL] ⚠️ So'rov bloklangan: requestId=${requestId}, locked_by=${request.locked_by}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov allaqachon tasdiqlanmoqda.', show_alert: true });
            return;
        }
        
        // Operatorning brendiga tegishli ekanligini tekshirish
        log.debug(`[OPERATOR] [APPROVAL] 5. Operatorning brendiga tegishli ekanligini tekshirish: current_approver_id=${request.current_approver_id}, user.id=${user.id}, current_approver_type=${request.current_approver_type}`);
        // Agar current_approver_id null bo'lsa, operatorning brendiga tegishli ekanligini tekshiramiz
        if (request.current_approver_id !== user.id || request.current_approver_type !== 'operator') {
            log.debug(`[OPERATOR] [APPROVAL] 5.1. Operatorning brendlarini olish: userId=${user.id}`);
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
            log.debug(`[OPERATOR] [APPROVAL] 5.3. So'rov brendi: ${request.brand_id}, Operator brendlari: ${operatorBrands.join(', ')}`);
            
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
        
        // So'rovni bloklash
        log.debug(`[OPERATOR] [APPROVAL] 6. So'rovni bloklash: requestId=${requestId}, operatorId=${user.id}`);
        await db('debt_requests')
            .where('id', requestId)
            .update({
                locked: true,
                locked_by: user.id,
                locked_at: db.fn.now()
            });
        
        log.info(`[OPERATOR] [APPROVAL] 6.1. ✅ So'rov bloklandi`);
        
        // Tasdiqlashni log qilish
        log.debug(`[OPERATOR] [APPROVAL] 7. Tasdiqlashni log qilish...`);
        await logApproval(requestId, user.id, 'operator', 'approved', {});
        await logRequestAction(requestId, 'operator_approved', user.id, {
            new_status: 'APPROVED_BY_OPERATOR'
        });
        
        log.info(`[OPERATOR] [APPROVAL] 7.1. ✅ Tasdiqlash log qilindi`);
        
        // Status yangilash
        log.debug(`[OPERATOR] [APPROVAL] 8. Status yangilash: APPROVED_BY_OPERATOR`);
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
        
        log.info(`[OPERATOR] [APPROVAL] 8.1. ✅ Status yangilandi: APPROVED_BY_OPERATOR`);
        
        // Final guruhga yuborish (status FINAL_APPROVED ga o'zgaradi)
        log.debug(`[OPERATOR] [APPROVAL] 9. Final guruhga yuborish boshlanmoqda...`);
        await sendToFinalGroup(requestId);
        log.info(`[OPERATOR] [APPROVAL] 9.1. ✅ Final guruhga yuborildi`);
        
        // Xabarni yangilash (status FINAL_APPROVED bo'ldi)
        log.debug(`[OPERATOR] [APPROVAL] 10. Xabarni yangilash...`);
        await updateRequestMessage(requestId, 'FINAL_APPROVED', {
            username: user.username,
            fullname: user.fullname,
            approval_type: 'operator'
        });
        
        log.info(`[OPERATOR] [APPROVAL] 10.1. ✅ Xabar yangilandi`);
        
        // Eslatmalarni to'xtatish
        log.debug(`[OPERATOR] [APPROVAL] 11. Eslatmalarni to'xtatish...`);
        cancelReminders(requestId);
        log.info(`[OPERATOR] [APPROVAL] 11.1. ✅ Eslatmalar to'xtatildi`);
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextOperatorRequest(userId, chatId);
        
        // Tasdiqlash xabari
        log.debug(`[OPERATOR] [APPROVAL] 12. Tasdiqlash xabari formatlash va yuborish...`);
        const approvalMessage = formatApprovalMessage({
            request_uid: request.request_uid,
            username: user.username,
            fullname: user.fullname,
            timestamp: new Date().toISOString(),
            approval_type: 'operator'
        });
        
        await bot.editMessageText(
            approvalMessage,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
        log.info(`[OPERATOR] [APPROVAL] ✅ Operator tasdiqlash muvaffaqiyatli yakunlandi: requestId=${requestId}, requestUID=${request.request_uid}, operatorId=${user.id}, operatorName=${user.fullname}`);
    } catch (error) {
        log.error('Error handling operator approval:', error);
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
            .whereIn('debt_requests.status', ['APPROVED_BY_CASHIER', 'DEBT_MARKED_BY_CASHIER'])
            .first();
        
        if (!request) {
            await bot.answerCallbackQuery(query.id, { text: 'So\'rov topilmadi yoki allaqachon tasdiqlangan.', show_alert: true });
            return;
        }
        
        // Tegishli operator ekanligini tekshirish
        if (assignedOperatorId && assignedOperatorId !== user.id) {
            log.warn(`[OPERATOR] [DEBT] ❌ Bu so'rov boshqa operatorga biriktirilgan: requestId=${requestId}, assignedOperatorId=${assignedOperatorId}, currentUserId=${user.id}`);
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga tegishli emas. Faqat biriktirilgan operator javob qaytara oladi.', show_alert: true });
            return;
        }
        
        // current_approver_id va current_approver_type ni tekshirish (agar mavjud bo'lsa)
        if (request.current_approver_id && request.current_approver_id !== user.id) {
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
        if (debtData.comparison_result && debtData.comparison_result.isIdentical) {
            debtMessage = '⚠️ <b>Eslatma:</b> Yuborilgan ma\'lumotlar so\'rovdagi ma\'lumotlar bilan bir xil.\n\n' + debtMessage;
        }
        
        // Solishtirish natijasini tekshirish
        const comparisonResult = debtData.comparison_result;
        const hasDifferences = comparisonResult && !comparisonResult.isIdentical && comparisonResult.differences && comparisonResult.differences.length > 0;
        
        // Agar farq bo'lsa va farqi ko'p bo'lsa (totalDifference > 0), teskari jarayon (rahbarlarga qaytarish)
        if (hasDifferences && comparisonResult.totalDifference > 0) {
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Farq topildi va teskari jarayon boshlanmoqda: requestId=${requestId}, totalDifference=${comparisonResult.totalDifference}`);
            
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
                    `Operator tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n` +
                    `${differencesMessage}`;
                
                const bot = getBot();
                await bot.sendMessage(manager.telegram_chat_id, reverseMessage, { parse_mode: 'HTML' });
                log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Menejerga teskari jarayon xabari yuborildi: requestId=${requestId}, managerId=${manager.id}`);
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
                        `Operator tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n` +
                        `${differencesMessage}`;
                    
                    const bot = getBot();
                    await bot.sendMessage(leadersGroup.telegram_group_id, reverseMessage, { parse_mode: 'HTML' });
                    log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Rahbarlar guruhiga teskari jarayon xabari yuborildi: requestId=${requestId}, groupId=${leadersGroup.telegram_group_id}`);
                }
            }
            
            // Status yangilash - teskari jarayon
            await db('debt_requests')
                .where('id', requestId)
                .update({
                    status: 'REVERSED_BY_OPERATOR',
                    current_approver_id: null,
                    current_approver_type: null
                });
            
            // Tasdiqlashni log qilish
            await logApproval(requestId, user.id, 'operator', 'reversed', {
                excel_file_path: debtData.excel_file_path,
                total_difference: comparisonResult.totalDifference,
                differences_count: comparisonResult.differences.length
            });
            
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Teskari jarayon yakunlandi: requestId=${requestId}, operatorId=${user.id}`);
            return; // Teskari jarayon - final guruhga yuborilmaydi
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
        
        // Final guruhga yuborish (faqat farq bo'lmasa yoki farqi kichik bo'lsa)
        const { sendToFinalGroup } = require('./final-group.js');
        try {
            await sendToFinalGroup(requestId);
            log.info(`[OPERATOR] [SEND_DEBT_RESPONSE] Final guruhga xabar yuborildi: requestId=${requestId}`);
        } catch (error) {
            log.error(`[OPERATOR] [SEND_DEBT_RESPONSE] Final guruhga yuborishda xatolik:`, error);
        }
        
        // Tasdiqlashni log qilish
        await logApproval(requestId, user.id, 'operator', 'debt_marked', {
            excel_file_path: debtData.excel_file_path,
            image_file_path: debtData.image_file_path,
            debt_amount: debtData.total_amount
        });
        
        // Status yangilash (sendToFinalGroup funksiyasida FINAL_APPROVED ga o'zgaradi, shuning uchun bu yerda faqat current_approver_id ni tozalaymiz)
        await db('debt_requests')
            .where('id', requestId)
            .update({
                current_approver_id: null,
                current_approver_type: null
            });
        
        log.info(`Debt response sent: requestId=${requestId}, operatorId=${user.id}`);
        
        // Keyingi so'rovni avtomatik ko'rsatish
        await showNextOperatorRequest(userId, chatId);
    } catch (error) {
        log.error('Error sending debt response:', error);
        throw error;
    }
}

module.exports = {
    showOperatorRequests,
    showRequestToOperator,
    showNextOperatorRequest,
    handleOperatorApproval,
    handleOperatorDebt,
    sendDebtResponse,
    STATES
};

