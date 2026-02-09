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
        
        // ✅ MUHIM: Joriy so'rovning allaqachon ko'rsatilgan xabarlarini tekshirish
        // Agar joriy so'rovning xabari allaqachon mavjud bo'lsa (va tasdiqlanmagan bo'lsa), yangi xabar yubormaslik
        const { hasActiveRequestMessage } = require('../utils/messageTracker.js');
        const hasActiveMessage = hasActiveRequestMessage(groupId, request.id);
        
        if (hasActiveMessage) {
            log.info(`[LEADER] [SHOW_REQUEST] ⚠️ Joriy so'rovning faol xabari mavjud, yangi xabar yuborilmaydi: requestId=${request.id}`);
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
        // MUHIM: Rahbarlarga har doim Telegraph link ishlatilishi kerak
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
                    log.debug(`[LEADER] [TELEGRAPH] ✅ Sahifa yaratildi: requestId=${request.id}, URL=${telegraphUrl}`);
                } else {
                    log.warn(`[LEADER] [TELEGRAPH] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${request.id}`);
                    // Qayta urinish
                    try {
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
                    } catch (retryError) {
                        log.error(`[LEADER] [TELEGRAPH] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                    }
                }
            } catch (telegraphError) {
                log.error(`[LEADER] [TELEGRAPH] Telegraph sahifa yaratishda xatolik: requestId=${request.id}, error=${telegraphError.message}`);
                // Qayta urinish
                try {
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
                } catch (retryError) {
                    log.error(`[LEADER] [TELEGRAPH] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                }
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
            is_for_leaders: true, // Rahbarlarga yuborilayotgani
            telegraph_url: telegraphUrl
        });
        
        // Keyboard yaratish - faqat Tasdiqlash va Bekor qilish knopkalari (yonma-yon)
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Tasdiqlash', callback_data: `leader_approve_${request.id}` },
                    { text: '❌ Bekor qilish', callback_data: `leader_reject_${request.id}` }
                ]
            ]
        };
        
        log.debug(`[LINK_HABAR] leader: kimga=rahbarlar_guruhi, requestId=${request.id}, request_uid=${request.request_uid}, telegraph_link=${telegraphUrl ? 'mavjud' : 'yo\'q'}, ma_lumotlar=faqat_telegraph_link, groupId=${groupId}`);
        
        let sentMessage;
        try {
            sentMessage = await bot.sendMessage(groupId, message, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        } catch (sendError) {
            // Agar guruh supergroup'ga o'zgartirilgan bo'lsa
            const errorBody = sendError.response?.body;
            const errorDescription = errorBody?.description || sendError.message || '';
            
            if (errorBody?.error_code === 400 && errorDescription.includes('group chat was upgraded to a supergroup chat')) {
                // Agar migrate_to_chat_id parametri bo'lsa, uni ishlatamiz
                if (errorBody?.parameters?.migrate_to_chat_id) {
                    const newChatId = errorBody.parameters.migrate_to_chat_id;
                    log.warn(`[LEADER] [SHOW_REQUEST] ⚠️ Guruh supergroup'ga o'zgartirilgan. Eski ID: ${groupId}, Yangi ID: ${newChatId}`);
                    
                    // Database'da yangi chat ID'ni yangilash
                    await db('debt_groups')
                        .where('group_type', 'leaders')
                        .where('is_active', true)
                        .update({
                            telegram_group_id: newChatId
                        });
                    
                    log.info(`[LEADER] [SHOW_REQUEST] ✅ Database yangilandi. Yangi chat ID: ${newChatId}`);
                    
                    // Yangi chat ID bilan qayta urinish
                    sentMessage = await bot.sendMessage(newChatId, message, {
                        reply_markup: keyboard,
                        parse_mode: 'HTML'
                    });
                    
                    log.info(`[LEADER] [SHOW_REQUEST] ✅ Rahbarlar guruhiga xabar muvaffaqiyatli yuborildi (yangi chat ID): requestId=${request.id}, requestUID=${request.request_uid}, groupId=${newChatId}, messageId=${sentMessage.message_id}`);
                    
                    // ✅ Xabarni messageTracker'ga qo'shish (yangi chat ID bilan)
                    try {
                        const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                        trackMessage(newChatId, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, false, request.id, false); // shouldCleanup=false, requestId=request.id
                        log.debug(`[LEADER] [SHOW_REQUEST] Xabar kuzatishga qo'shildi (yangi chat ID): groupId=${newChatId}, messageId=${sentMessage.message_id}, requestId=${request.id}`);
                    } catch (trackError) {
                        log.debug(`[LEADER] [SHOW_REQUEST] Xabarni kuzatishga qo'shishda xatolik (ignored): ${trackError.message}`);
                    }
                } else {
                    // migrate_to_chat_id yo'q - guruh allaqachon o'zgartirilgan, lekin database'da eski ID saqlangan
                    log.error(`[LEADER] [SHOW_REQUEST] ❌ Guruh supergroup'ga o'zgartirilgan, lekin yangi chat ID ko'rsatilmadi. Database'dagi rahbarlar guruhi ID'ni qo'lda yangilash kerak. Eski ID: ${groupId}`);
                    log.error(`[LEADER] [SHOW_REQUEST] 💡 Yechim: Admin panelida Debt Approval sozlamalarida "Rahbarlar guruhi" ID'sini yangilang. Yangi supergroup ID odatda -100 bilan boshlanadi.`);
                    // Xatolikni throw qilamiz, chunki qayta urinish mumkin emas
                    throw sendError;
                }
            } else {
                // Boshqa xatoliklar
                throw sendError;
            }
        }
        
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
    
    log.info(`[LEADER] [APPROVAL] [START] Rahbar tasdiqlash boshlandi: requestId=${requestId}, userId=${userId}, chatId=${chatId}`);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // ✅ OPTIMALLASHTIRISH: Avval so'rovni tekshirish (eng tez)
        const request = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.id', requestId)
            .where('debt_requests.type', 'SET')
            .where('debt_requests.status', 'SET_PENDING')
            .where('debt_requests.locked', false)
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
        log.info(`[LEADER] [APPROVAL] [STEP_1] So'rov topildi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}, status=${request.status}, brand=${request.brand_name}, branch=${request.filial_name}`);
        
        // ✅ OPTIMALLASHTIRISH: Foydalanuvchi va tekshiruvlarni parallel qilish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        const leaderTask = user ? await db('debt_user_tasks')
            .where('user_id', user.id)
            .where(function() {
                this.where('task_type', 'approve_leader')
                    .orWhere('task_type', 'debt:approve_leader');
            })
            .first() : null;
        
        if (!user) {
            log.error(`[LEADER] [APPROVAL] ❌ Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Foydalanuvchi guruhda ekanligini tekshirish
        const userInGroup = await isUserInGroup(user.id, 'leaders');
        
        if (!userInGroup && !leaderTask) {
            log.warn(`[LEADER] [APPROVAL] ❌ Foydalanuvchi rahbarlar guruhida emas va rahbar vazifasiga ham ega emas: userId=${user.id}`);
            await bot.sendMessage(chatId, '❌ Siz rahbarlar guruhida emassiz va rahbar vazifasiga ham ega emassiz.');
            return;
        }
        
        // So'rovni bloklash (boshqa rahbar tasdiqlamasligi uchun) - double-check
        const lockResult = await db('debt_requests')
            .where('id', requestId)
            .where('locked', false)
            .update({
                locked: true,
                locked_by: user.id,
                locked_at: db.fn.now()
            });
        
        // Agar lock qilinmagan bo'lsa (boshqa kimdir tasdiqlagan)
        if (lockResult === 0) {
            log.warn(`[LEADER] [APPROVAL] ❌ Lock muvaffaqiyatsiz (allaqachon tasdiqlangan): requestId=${requestId}`);
            await bot.answerCallbackQuery(query.id, { 
                text: 'So\'rov allaqachon tasdiqlangan.',
                show_alert: true 
            });
            return;
        }
        log.info(`[LEADER] [APPROVAL] [STEP_2] Lock muvaffaqiyatli: requestId=${requestId}, leaderId=${user.id}`);
        
        // ✅ OPTIMALLASHTIRISH: Loglarni parallel qilish
        await Promise.all([
            logApproval(requestId, user.id, 'leader', 'approved', {}),
            logRequestAction(requestId, 'leader_approved', user.id, {
                new_status: 'APPROVED_BY_LEADER'
            })
        ]);
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_LEADER',
                locked: false,
                locked_by: null,
                locked_at: null
            });
        log.info(`[LEADER] [APPROVAL] [STEP_3] Status APPROVED_BY_LEADER: requestId=${requestId}, type=${request.type}`);
        
        // Kassir tayinlash
        const cashier = await assignCashierToRequest(request.branch_id, requestId);
        
        if (!cashier) {
            log.warn(`[LEADER] [APPROVAL] ❌ Kassir tayinlanmadi: branchId=${request.branch_id}, requestId=${requestId}`);
        } else {
            log.info(`[LEADER] [APPROVAL] [STEP_4] Kassir tayinlandi: requestId=${requestId}, cashierUserId=${cashier.user_id}, cashierFullname=${cashier.fullname || 'n/a'}`);
        }
        
        // Kassirga xabar yuborish (agar mavjud bo'lsa)
        if (cashier) {
            // Kassirning telegram_chat_id ni database'dan olish (agar assignCashierToRequest'da null bo'lsa)
            const cashierUser = await db('users').where('id', cashier.user_id).first();
            const telegramChatId = cashier.telegram_chat_id || cashierUser?.telegram_chat_id;
            
            if (telegramChatId) {
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
                    const pendingCount = hasOtherRequests ? parseInt(existingRequests.count) : 0;
                    
                    // HAR DOIM joriy so'rovni yuborish (navbatli ko'rsatish uchun)
                    // pendingCount = boshqa pending so'rovlar soni (joriy so'rovni istisno qilgan holda)
                    await showRequestToCashier(request, telegramChatId, cashierUser || cashier, pendingCount);
                    log.info(`[LEADER] [APPROVAL] [STEP_5] Kassirga xabar yuborildi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}, cashierId=${cashier.user_id}, telegramChatId=${telegramChatId}, pendingCount=${pendingCount}`);
                }
            } else {
                log.warn(`[LEADER] [APPROVAL] ⚠️ Kassirga xabar yuborilmadi: cashierId=${cashier.user_id}, telegramChatId=yo'q`);
            }
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
                // Telegraph URL ni olish (agar mavjud bo'lsa)
                let telegraphUrl = null;
                if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                    try {
                        const { createDebtDataPage } = require('../../../utils/telegraph.js');
                        telegraphUrl = await createDebtDataPage({
                            request_id: requestId, // ✅ MUHIM: Mavjud URL'ni qayta ishlatish uchun
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
                    } catch (telegraphError) {
                        // Telegraph xatolari silent qilinadi (ixtiyoriy xizmat)
                        log.debug(`[LEADER] [APPROVAL] Telegraph xatolik (ixtiyoriy xizmat): requestId=${requestId}`);
                    }
                }
                
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
                    is_for_leaders: true, // Rahbarlarga yuborilayotgani
                    approvals: approvals,
                    telegraph_url: telegraphUrl
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
        
        
        // Operatorlar guruhiga yuborish — faqat ODDIY (NORMAL) so'rov uchun.
        // SET so'rov uchun ketma-ketlik: rahbar → kassir → (kassir tasdiqlagach) → operator → final.
        // Rahbar tasdiqlaganda SET faqat kassirga boradi; operatorga kassir tasdiqlagach cashier.js orqali boradi.
        if (request.type === 'SET') {
            log.info(`[LEADER] [APPROVAL] [SET_FLOW] requestId=${requestId}, requestUID=${request.request_uid}, type=SET → faqat kassirga yuborildi. Operatorga kassir tasdiqlagach cashier.js orqali yuboriladi.`);
        } else {
            log.debug(`[LEADER] [APPROVAL] 8. Operatorlar guruhiga yuborish tekshiruvi (ODDIY so'rov)... requestId=${requestId}, type=${request.type}`);
            try {
                const operatorTasks = await db('debt_user_tasks')
                    .join('users', 'debt_user_tasks.user_id', 'users.id')
                    .where(function() {
                        this.where('debt_user_tasks.task_type', 'approve_operator')
                            .orWhere('debt_user_tasks.task_type', 'debt:approve_operator');
                    })
                    .where('users.status', 'active')
                    .where(function() {
                        this.whereNull('debt_user_tasks.brand_id')
                            .orWhere('debt_user_tasks.brand_id', request.brand_id);
                    })
                    .select('users.id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'debt_user_tasks.brand_id');
                
                const [operatorsFromBrands, operatorsFromTable] = await Promise.all([
                    db('debt_user_brands')
                        .join('debt_user_tasks', 'debt_user_brands.user_id', '=', 'debt_user_tasks.user_id')
                        .where(function() {
                            this.where('debt_user_tasks.task_type', 'approve_operator')
                                .orWhere('debt_user_tasks.task_type', 'debt:approve_operator');
                        })
                        .join('users', 'debt_user_brands.user_id', 'users.id')
                        .where('debt_user_brands.brand_id', request.brand_id)
                        .where('users.status', 'active')
                        .select('users.id', 'users.telegram_chat_id', 'users.fullname', 'users.username')
                        .distinct(),
                    db('debt_operators')
                        .join('users', 'debt_operators.user_id', 'users.id')
                        .where('debt_operators.brand_id', request.brand_id)
                        .where('debt_operators.is_active', true)
                        .where('users.status', 'active')
                        .select('users.id', 'users.telegram_chat_id', 'users.fullname', 'users.username')
                        .distinct()
                ]);
                
                const allOperators = new Map();
                [...operatorTasks, ...operatorsFromBrands, ...operatorsFromTable].forEach(op => {
                    if (op.id && !allOperators.has(op.id)) {
                        allOperators.set(op.id, op);
                    }
                });
                const uniqueOperators = Array.from(allOperators.values());
                
                if (uniqueOperators.length > 0) {
                    log.info(`[LEADER] [APPROVAL] 8.1. ODDIY so'rov — operatorlar topildi: ${uniqueOperators.length} ta, requestId=${requestId}, brandId=${request.brand_id}`);
                    const { showRequestToOperator } = require('./operator.js');
                    const firstOperator = uniqueOperators[0];
                    if (firstOperator) {
                        try {
                            const pendingRequests = await db('debt_requests')
                                .where('status', 'APPROVED_BY_LEADER')
                                .where('brand_id', request.brand_id)
                                .where('id', '!=', requestId)
                                .where('locked', false)
                                .count('* as count')
                                .first();
                            const pendingCount = pendingRequests ? parseInt(pendingRequests.count) : 0;
                            await db('debt_requests')
                                .where('id', requestId)
                                .update({
                                    current_approver_id: firstOperator.id,
                                    current_approver_type: 'operator'
                                });
                            await showRequestToOperator(request, firstOperator.id, firstOperator, pendingCount, false);
                            log.info(`[LEADER] [APPROVAL] 8.2. ODDIY so'rov — operatorlar guruhiga yuborildi: operatorId=${firstOperator.id}, requestId=${requestId}`);
                        } catch (operatorError) {
                            log.error(`[LEADER] [APPROVAL] 8.2. Operatorlar guruhiga yuborishda xatolik: requestId=${requestId}, error=${operatorError.message}`);
                        }
                    }
                } else {
                    log.info(`[LEADER] [APPROVAL] 8.1. Operatorlar topilmadi: requestId=${requestId}, brandId=${request.brand_id}`);
                }
            } catch (operatorError) {
                log.error(`[LEADER] [APPROVAL] 8. Operatorlar guruhiga yuborishda xatolik: requestId=${requestId}, error=${operatorError.message}`);
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
        
        log.info(`[LEADER] [APPROVAL] [DONE] Rahbar tasdiqlash yakunlandi: requestId=${requestId}, requestUID=${request.request_uid}, type=${request.type}, leaderId=${user.id}. Ketma-ketlik: SET bo'lsa faqat kassirga yuborildi, operatorga kassir tasdiqlagach boradi.`);
    } catch (error) {
        log.error(`[LEADER] [APPROVAL] [ERROR] requestId=${requestId}, error=${error.message}`, error);
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
        // ✅ MUHIM: Sabab so'rash xabarini yuboramiz va message_id ni state'ga saqlaymiz (keyin o'chirish uchun)
        const leadersMessageId = query.message.message_id;
        const sent = await bot.sendMessage(
            chatId,
            '❌ <b>So\'rovni bekor qilish</b>\n\n' +
            'Bekor qilish sababini kiriting (ixtiyoriy):\n' +
            'Agar sabab kiritmasangiz, "❌ Bekor qilish" knopkasini bosing.',
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Bekor qilish (sababsiz)', callback_data: `leader_reject_cancel_${requestId}` }]
                    ]
                }
            }
        );
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.ENTER_REJECTION_REASON, {
            request_id: requestId,
            leaders_message_id: leadersMessageId,
            leaders_chat_id: chatId,
            rejection_prompt_message_id: sent.message_id // Sabab so'rash xabarini keyin o'chirish uchun
        });
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
    // ✅ MUHIM: Sabab ixtiyoriy - agar bo'sh bo'lsa, null qabul qilish
    const reason = msg.text ? msg.text.trim() : null;
    
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
        
        // Bekor qilishni log qilish (sabab ixtiyoriy)
        await logApproval(requestId, user.id, 'leader', 'rejected', {
            note: reason || 'Sabab kiritilmadi'
        });
        await logRequestAction(requestId, 'leader_rejected', user.id, {
            new_status: 'REJECTED',
            note: reason || 'Sabab kiritilmadi'
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
        
        // ✅ MUHIM: Status yangilanganidan keyin request'ni Brend/Filial/SVR bilan olish (menejer va final xabarida "undefined" bo'lmasin)
        const updatedRequest = await db('debt_requests')
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
        
        // Rahbarlar guruhidagi xabarni to'liq yangilash (Brend, Filial, SVR, Telegraph link + Tasdiqlash jarayoni + Bekor qilindi blok — qisqarib ketmasin)
        const leadersGroup = await db('debt_groups')
            .where('group_type', 'leaders')
            .where('is_active', true)
            .first();
        
        const leadersMessageId = state.data?.leaders_message_id || null;
        
        if (leadersGroup && leadersMessageId) {
            try {
                const { formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
                const fullMessage = await formatRequestMessageWithApprovals(updatedRequest, db, 'leader');
                const rejectionBlock = formatRejectionMessage({
                    request_uid: request.request_uid,
                    username: user.username,
                    fullname: user.fullname,
                    reason: reason || 'Sabab kiritilmadi',
                    timestamp: new Date().toISOString()
                });
                const finalLeadersMessage = fullMessage + '\n\n━━━━━━━━━━━━━━━━━━━━\n\n' + rejectionBlock;
                await bot.editMessageText(finalLeadersMessage, {
                    chat_id: leadersGroup.telegram_group_id,
                    message_id: leadersMessageId,
                    parse_mode: 'HTML',
                    reply_markup: null
                });
                log.info(`[LEADER] [REJECTION] ✅ Rahbarlar guruhidagi xabar to'liq yangilandi (link + bekor qilindi): requestId=${requestId}, messageId=${leadersMessageId}`);
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
            
            // Eski xabarlarni o'chirish — preview xabarini SAQLAB QOLAMIZ (birinchi xabar qisqarmasin, 2-rasmdagi holat qolsin)
            try {
                const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                const keepPreviewId = updatedRequest.preview_message_id ? [updatedRequest.preview_message_id] : [];
                const messagesToDelete = getMessagesToCleanup(manager.telegram_chat_id, keepPreviewId);
                
                if (messagesToDelete.length > 0) {
                    const messagesToDeleteNow = messagesToDelete.slice(-5);
                    for (const messageId of messagesToDeleteNow) {
                        try {
                            await bot.deleteMessage(manager.telegram_chat_id, messageId);
                            untrackMessage(manager.telegram_chat_id, messageId);
                            await new Promise(resolve => setTimeout(resolve, 100));
                            log.debug(`[LEADER] [REJECTION] [CLEANUP] Eski xabar o'chirildi: chatId=${manager.telegram_chat_id}, messageId=${messageId}`);
                        } catch (deleteError) {
                            untrackMessage(manager.telegram_chat_id, messageId);
                            log.debug(`[LEADER] [REJECTION] [CLEANUP] Xabar o'chirishda xatolik (ignored): messageId=${messageId}, error=${deleteError.message}`);
                        }
                    }
                }
            } catch (cleanupError) {
                log.debug(`[LEADER] [REJECTION] [CLEANUP] Eski xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
            
            // Sabab so'rash xabari va knopkani o'chirish (rahbarlar guruhida qolmasin)
            try {
                const promptMsgId = state.data?.rejection_prompt_message_id;
                const leadersChatId = state.data?.leaders_chat_id;
                if (promptMsgId && leadersChatId) {
                    await bot.deleteMessage(leadersChatId, promptMsgId);
                    log.debug(`[LEADER] [REJECTION] Sabab so'rash xabari o'chirildi: chatId=${leadersChatId}, messageId=${promptMsgId}`);
                }
            } catch (delErr) {
                log.debug(`[LEADER] [REJECTION] Sabab so'rash xabarini o'chirishda xatolik (ignored): ${delErr.message}`);
            }
            
            // ✅ "Bekor qilindi" xabarini yuborishni olib tashlash
            // Chunki "So'rov muvaffaqiyatli yaratildi!" xabari allaqachon yangilanadi va bekor qilish holatini ko'rsatadi
            // await bot.sendMessage(manager.telegram_chat_id, rejectionMessage, {
            //     parse_mode: 'HTML'
            // });
        }
        
        // Eslatmalarni to'xtatish
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
        
        log.info(`Leader rejected: requestId=${requestId}, leaderId=${user.id}, reason=${reason || 'Sabab kiritilmadi'}`);
        
        return true;
    } catch (error) {
        log.error('Error handling rejection reason:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
    }
}

/**
 * Kutilinayotgan so'rovlarni ko'rsatish (knopka bosilganda) - Leader uchun
 * Leader guruhda ishlaydi, shuning uchun barcha SET_PENDING so'rovlarni ko'rsatadi
 */
async function handleShowPendingRequests(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // Leader uchun showLeaderRequests funksiyasini ishlatamiz
        // Bu funksiya barcha SET_PENDING so'rovlarni guruhga ko'rsatadi
        await showLeaderRequests(userId, chatId);
        
    } catch (error) {
        log.error('Error showing pending requests:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

module.exports = {
    showLeaderRequests,
    showSetRequestToLeaders,
    handleShowDebtList,
    handleLeaderApproval,
    handleLeaderRejection,
    handleRejectionReason,
    handleShowPendingRequests,
    STATES
};

