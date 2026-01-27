// bot/debt-approval/handlers/cashier.js
// Kassir FSM handlers - So'rovlarni ko'rish, tasdiqlash, qarzi bor, preview

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { formatNormalRequestMessage, formatDebtResponseMessage, formatApprovalMessage, formatAllApprovalsMessage, formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
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
    CONFIRM_DEBT_RESPONSE: 'confirm_debt_response',
    // ✅ Yangi state'lar
    SELECT_DEBT_INPUT_TYPE: 'select_debt_input_type',
    ENTER_TOTAL_AMOUNT: 'enter_total_amount',
    ENTER_AGENT_DEBTS: 'enter_agent_debts',
    AUTO_DETECT_DEBT_INPUT: 'auto_detect_debt_input' // Avtomatik tanib olish
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
 * ✅ MUHIM: Avval eslatmalarni tekshirish, agar bo'lmasa, keyin kutilayotgan so'rovlarni ko'rsatish
 */
async function showPendingCashierRequests(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return;
        }
        
        // ✅ MUHIM: Avval faol so'rovni tekshirish (eslatmalardan oldin)
        const activeRequest = await checkActiveCashierRequest(userId, chatId);
        
        if (activeRequest) {
            // ✅ Avval eski "Faol so'rov bor" xabarlarini o'chirish
            try {
                const bot = getBot();
                const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                const messagesToDelete = getMessagesToCleanup(chatId, []);
                
                // So'nggi 5 ta xabarni o'chirish (ehtimol "Faol so'rov bor" xabarlari)
                if (messagesToDelete.length > 0) {
                    const messagesToDeleteNow = messagesToDelete.slice(-5);
                    for (const messageId of messagesToDeleteNow) {
                        try {
                            await bot.deleteMessage(chatId, messageId);
                            untrackMessage(chatId, messageId);
                            await new Promise(resolve => setTimeout(resolve, 100));
                            log.debug(`[CASHIER] [SHOW_PENDING] Eski xabar o'chirildi: chatId=${chatId}, messageId=${messageId}`);
                        } catch (deleteError) {
                            untrackMessage(chatId, messageId);
                            log.debug(`[CASHIER] [SHOW_PENDING] Xabar o'chirishda xatolik (ignored): ${deleteError.message}`);
                        }
                    }
                }
            } catch (cleanupError) {
                log.debug(`[CASHIER] [SHOW_PENDING] Eski xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
            
            // Faol so'rov bor, bildirishnoma yuborish
            const bot = getBot();
            const warningMessage = await bot.sendMessage(chatId, '⚠️ Sizda hozirgi vaqtda faol so\'rov bor. Avval uni tugatishingiz kerak.');
            
            // Bu xabarni track qilish (keyinchalik o'chirish uchun)
            try {
                const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                trackMessage(chatId, warningMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true); // shouldCleanup=true - o'chirilishi kerak
            } catch (trackError) {
                // Silent fail
            }
            
            log.info(`[CASHIER] [SHOW_PENDING] Faol so'rov bor, keyingi so'rovlar ko'rsatilmaydi: requestId=${activeRequest.id}, userId=${userId}`);
            return;
        }
        
        // ✅ MUHIM: Keyin eslatmalarni tekshirish
        const { getPendingRemindersForUser } = require('../../../utils/debtReminder.js');
        const reminderRequests = await getPendingRemindersForUser(user.id, 'cashier');
        
        if (reminderRequests.length > 0) {
            // ✅ Avval eski xabarlarni tozalash
            try {
                const bot = getBot();
                const { getMessagesByType, getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                
                // 1. Reminder type xabarlarni o'chirish
                const reminderMessageIds = getMessagesByType(chatId, 'reminder');
                if (reminderMessageIds.length > 0) {
                    for (const messageId of reminderMessageIds) {
                        try {
                            await bot.deleteMessage(chatId, messageId);
                            untrackMessage(chatId, messageId);
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (deleteError) {
                            untrackMessage(chatId, messageId);
                        }
                    }
                }
                
                // 2. "Sizda X ta kutilayotgan so'rov bor" xabarlarini o'chirish
                const messagesToDelete = getMessagesToCleanup(chatId, []);
                if (messagesToDelete.length > 0) {
                    const messagesToDeleteNow = messagesToDelete.slice(-10);
                    for (const messageId of messagesToDeleteNow) {
                        try {
                            await bot.deleteMessage(chatId, messageId);
                            untrackMessage(chatId, messageId);
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (deleteError) {
                            untrackMessage(chatId, messageId);
                        }
                    }
                }
            } catch (cleanupError) {
                log.debug(`[CASHIER] [SHOW_PENDING] Eski xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
            
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
            
            await reminderHandlers.handleShowNextReminder(fakeQuery, bot, 'user', 'cashier', true);
            log.info(`[CASHIER] [SHOW_PENDING] Eslatmalar topildi va ko'rsatildi: count=${reminderRequests.length}, userId=${userId}`);
            return;
        }
        
        // Eslatmalar yo'q, keyin kutilayotgan so'rovlarni ko'rsatish
        
        if (activeRequest) {
            // Faol so'rov bor, bildirishnoma yuborish
            await getBot().sendMessage(chatId, '⚠️ Sizda hozirgi vaqtda faol so\'rov bor. Avval uni tugatishingiz kerak.');
            log.info(`[CASHIER] [SHOW_PENDING] Faol so'rov bor, keyingi so'rovlar ko'rsatilmaydi: requestId=${activeRequest.id}, userId=${userId}`);
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
            // ✅ MUHIM: Avval eski bildirishnoma xabarlarini o'chirish
            // "Kutilayotgan so'rovlar" va "Hozircha kutilayotgan so'rovlar yo'q" xabarlarini o'chirish
            try {
                const bot = getBot();
                if (bot) {
                    const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                    const messagesToDelete = getMessagesToCleanup(chatId, []);
                    
                    // Barcha bildirishnoma xabarlarini o'chirish (so'nggi 10 ta)
                    if (messagesToDelete.length > 0) {
                        const messagesToDeleteNow = messagesToDelete.slice(-10);
                        log.info(`[CASHIER] [SHOW_PENDING] [CLEANUP] Bildirishnoma xabarlarini o'chirish: ${messagesToDeleteNow.length} ta`);
                        for (const messageId of messagesToDeleteNow) {
                            try {
                                await bot.deleteMessage(chatId, messageId);
                                untrackMessage(chatId, messageId);
                                await new Promise(resolve => setTimeout(resolve, 100));
                                log.debug(`[CASHIER] [SHOW_PENDING] [CLEANUP] Bildirishnoma xabari o'chirildi: messageId=${messageId}`);
                            } catch (deleteError) {
                                untrackMessage(chatId, messageId);
                                log.debug(`[CASHIER] [SHOW_PENDING] [CLEANUP] Xabar o'chirishda xatolik (ignored): messageId=${messageId}, error=${deleteError.message}`);
                            }
                        }
                    }
                }
            } catch (cleanupError) {
                log.debug(`[CASHIER] [SHOW_PENDING] [CLEANUP] Bildirishnoma xabarlarini o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
            
            // So'rovlar yo'q, reply keyboard'ni yangilash (0 ta ko'rsatish)
            const bot = getBot();
            if (bot) {
                const replyKeyboard = {
                    keyboard: [
                        [{ text: `⏰ Kutilayotgan so'rovlar (0 ta)` }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                };
                
                // Reply keyboard'ni yangilash uchun xabar yuborish
                try {
                    const pendingMessage = await bot.sendMessage(chatId, `📭 Hozircha kutilayotgan so'rovlar yo'q.`, {
                        reply_markup: replyKeyboard
                    });
                    
                    // Xabarni track qilish
                    try {
                        const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                        trackMessage(chatId, pendingMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true);
                    } catch (trackError) {
                        // Silent fail
                    }
                } catch (sendError) {
                    log.error(`[CASHIER] [SHOW_PENDING] Xabar yuborishda xatolik: ${sendError.message}`);
                }
            }
            
            log.info(`[CASHIER] [SHOW_PENDING] Kutilayotgan so'rovlar yo'q: userId=${userId}`);
            return;
        }
        
        // Navbatli ko'rsatish: faqat birinchi so'rovni ko'rsatish
        const firstRequest = requests[0];
        const pendingCount = requests.length - 1;
        await showRequestToCashier(firstRequest, chatId, user, pendingCount);
        log.info(`[CASHIER] [SHOW_PENDING] Birinchi so'rov ko'rsatildi: requestId=${firstRequest.id}, pendingCount=${pendingCount}`);
    } catch (error) {
        log.error('Error showing pending cashier requests:', error);
        await getBot().sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Kassirning faol so'rovini tekshirish
 * @param {number} userId - Telegram user ID
 * @param {number} chatId - Telegram chat ID
 * @returns {Promise<Object|null>} - Faol so'rov yoki null
 */
async function checkActiveCashierRequest(userId, chatId) {
    try {
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            return null;
        }
        
        // Kassirning filiallarini olish
        const cashierBranches = await getCashierBranches(user.id);
        if (cashierBranches.length === 0) {
            return null;
        }
        
        // Faol so'rovni qidirish (current_approver_id = user.id, status = PENDING_APPROVAL yoki APPROVED_BY_LEADER, locked = false)
        const activeRequest = await db('debt_requests')
            .whereIn('branch_id', cashierBranches)
            .where('current_approver_id', user.id)
            .where('current_approver_type', 'cashier')
            .whereIn('status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
            .where('locked', false)
            .first();
        
        return activeRequest || null;
    } catch (error) {
        log.error('Error checking active cashier request:', error);
        return null;
    }
}

/**
 * Keyingi pending so'rovni topish va ko'rsatish (kassir uchun)
 * Avval yangi so'rovlarni (< 5 daqiqa), keyin eski so'rovlarni (> 5 daqiqa) ko'rsatadi
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
        
        // 5 daqiqa oldin vaqtni hisoblash
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // Avval yangi so'rovlarni qidirish (< 5 daqiqa)
        let nextRequest = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.branch_id', cashierBranches)
            .where('debt_requests.current_approver_id', user.id)
            .where('debt_requests.current_approver_type', 'cashier')
            .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
            .where('debt_requests.locked', false)
            .where('debt_requests.created_at', '>=', fiveMinutesAgo)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as filial_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_requests.created_at', 'asc')
            .first();
        
        // Agar yangi so'rov topilmasa, eski so'rovlarni qidirish (> 5 daqiqa)
        if (!nextRequest) {
            nextRequest = await db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .whereIn('debt_requests.branch_id', cashierBranches)
                .where('debt_requests.current_approver_id', user.id)
                .where('debt_requests.current_approver_type', 'cashier')
                .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
                .where('debt_requests.locked', false)
                .where('debt_requests.created_at', '<', fiveMinutesAgo)
                .select(
                    'debt_requests.*',
                    'debt_brands.name as brand_name',
                    'debt_branches.name as filial_name',
                    'debt_svrs.name as svr_name'
                )
                .orderBy('debt_requests.created_at', 'asc')
                .first();
        }
        
        if (nextRequest) {
            // Boshqa kutilayotgan so'rovlar sonini hisoblash (joriy so'rovni istisno qilgan holda)
            const otherPendingCount = await db('debt_requests')
                .whereIn('branch_id', cashierBranches)
                .where('current_approver_id', user.id)
                .where('current_approver_type', 'cashier')
                .whereIn('status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
                .where('locked', false)
                .where('id', '!=', nextRequest.id)
                .count('* as count')
                .first();
            
            const pendingCount = otherPendingCount ? parseInt(otherPendingCount.count, 10) : 0;
            
            log.info(`[CASHIER] [SHOW_NEXT] Keyingi so'rov ko'rsatilmoqda: requestId=${nextRequest.id}, pendingCount=${pendingCount}`);
            await showRequestToCashier(nextRequest, chatId, user, pendingCount);
        } else {
            log.info(`[CASHIER] [SHOW_NEXT] Keyingi so'rov topilmadi: userId=${userId}`);
        }
    } catch (error) {
        log.error('Error showing next cashier request:', error);
    }
}

/**
 * So'rovni kassirga ko'rsatish
 * @param {Object} request - So'rov ma'lumotlari
 * @param {number} chatId - Telegram chat ID
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {number} pendingCount - Kutilayotgan so'rovlar soni (ixtiyoriy)
 */
async function showRequestToCashier(request, chatId, user, pendingCount = 0) {
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
            log.info(`[CASHIER] [SHOW_REQUEST] ⚠️ Joriy so'rovning faol xabari mavjud, yangi xabar yuborilmaydi: requestId=${request.id}`);
            return;
        }
        
        // ✅ NAVBATLI KO'RSATISH: Kassirning boshqa faol so'rovlarining xabarlarini o'chirish
        // Faqat birinchi so'rov ko'rsatilishi kerak, shuning uchun eski so'rovlarni o'chirish
        try {
            const { getRequestMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
            
            log.info(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] Eski so'rov xabarlarini qidirish boshlanmoqda: chatId=${chatId}, requestId=${request.id}`);
            
            // Eski so'rov xabarlarini o'chirish (faqat USER_MESSAGE type, shouldCleanup=false bo'lsa ham)
            const messagesToDelete = getRequestMessagesToCleanup(chatId, []);
            
            log.info(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] Topilgan so'rov xabarlari: ${messagesToDelete.length} ta`);
            
            // Faqat so'nggi 10 ta xabarni o'chirish
            if (messagesToDelete.length > 0) {
                const messagesToDeleteNow = messagesToDelete.slice(-10);
                log.info(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] O'chiriladigan xabarlar: ${messagesToDeleteNow.length} ta (jami: ${messagesToDelete.length} ta)`);
                
                let deletedCount = 0;
                let errorCount = 0;
                
                for (const messageId of messagesToDeleteNow) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        untrackMessage(chatId, messageId);
                        deletedCount++;
                        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit uchun
                        log.debug(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] ✅ So'rov xabari o'chirildi: chatId=${chatId}, messageId=${messageId}`);
                    } catch (deleteError) {
                        // Silent fail - xabar allaqachon o'chirilgan bo'lishi mumkin
                        untrackMessage(chatId, messageId);
                        errorCount++;
                        log.debug(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] ⚠️ So'rov xabari o'chirishda xatolik (ignored): chatId=${chatId}, messageId=${messageId}, error=${deleteError.message}`);
                    }
                }
                
                log.info(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] ✅ O'chirish yakunlandi: deleted=${deletedCount}, errors=${errorCount}, total=${messagesToDeleteNow.length}`);
            } else {
                log.info(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] ℹ️ O'chiriladigan so'rov xabarlari yo'q`);
            }
        } catch (cleanupError) {
            // Silent fail - cleanup ixtiyoriy
            log.error(`[CASHIER] [SHOW_REQUEST] [NAVBATLI] ❌ Eski so'rovlarni o'chirishda xatolik: chatId=${chatId}, error=${cleanupError.message}`, cleanupError);
        }
        
        // Agar so'rov SET bo'lsa va Excel ma'lumotlari bo'lsa, ularni qo'shish
        let message;
        // Excel ma'lumotlarini parse qilish (agar string bo'lsa) - funksiya boshida e'lon qilish
        let excelData = null;
        let excelHeaders = null;
        let excelColumns = null;
        let telegraphUrl = null; // ✅ Funksiya boshida e'lon qilish (barcha holatlar uchun)
        
        if (request.type === 'SET' && request.excel_data) {
            // SET so'rov uchun formatSetRequestMessage ishlatish
            const { formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
            
            // Excel ma'lumotlarini parse qilish (agar string bo'lsa)
            excelData = request.excel_data;
            excelHeaders = request.excel_headers;
            excelColumns = request.excel_columns;
            
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
            
            // ✅ MUHIM: Avval database'dan mavjud URL ni tekshirish
            if (request.telegraph_url && typeof request.telegraph_url === 'string' && request.telegraph_url.trim() !== '') {
                telegraphUrl = request.telegraph_url;
                log.info(`[CASHIER] [SHOW_REQUEST] ✅ Telegraph URL database'dan olingan: requestId=${request.id}, URL=${telegraphUrl}`);
            } else if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                // Agar database'da URL bo'lmasa, yangi yaratish
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
                        isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                    });
                    
                    if (!telegraphUrl) {
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
                                isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                            });
                        } catch (retryError) {
                            log.error(`[CASHIER] [SHOW_REQUEST] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                        }
                    }
                } catch (telegraphError) {
                    log.error(`[CASHIER] [SHOW_REQUEST] Telegraph sahifa yaratishda xatolik: requestId=${request.id}, error=${telegraphError.message}`);
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
                            isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                        });
                    } catch (retryError) {
                        log.error(`[CASHIER] [SHOW_REQUEST] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${request.id}, error=${retryError.message}`);
                    }
                }
            }
            
            
            // Debug: telegraphUrl tekshiruvi
            if (!telegraphUrl && excelData && excelData.length > 0) {
                log.warn(`[CASHIER] [SHOW_REQUEST] ⚠️ Telegraph URL mavjud emas: requestId=${request.id}, excelDataLength=${excelData.length}, excelColumns=${!!excelColumns}`);
            } else if (telegraphUrl) {
                log.info(`[CASHIER] [SHOW_REQUEST] ✅ Telegraph URL mavjud: requestId=${request.id}, URL=${telegraphUrl}`);
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
                is_for_cashier: true, // Kassirga yuborilayotgani (lekin Telegraph link ko'rsatiladi)
                telegraph_url: telegraphUrl // ✅ MUHIM: telegraphUrl o'zgaruvchisini to'g'ridan-to'g'ri o'tkazish
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
        
        // Keyboard yaratish - agar SET so'rov bo'lsa va agent ro'yxati bo'lsa, har bir agent uchun nusxa olish button qo'shish
        let keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Tasdiqlash', callback_data: `cashier_approve_${request.id}` },
                    { text: '⚠️ Qarzi bor', callback_data: `cashier_debt_${request.id}` }
                ]
            ]
        };
        
        // Agent nomlari bilan knopkalar kerak emas (rejada yo'q)
        
        const sentMessage = await bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        // ✅ MUHIM: Avval eski bildirishnoma xabarlarini o'chirish
        // "Kutilayotgan so'rovlar" va "Hozircha kutilayotgan so'rovlar yo'q" xabarlarini o'chirish
        try {
            const { getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
            const messagesToDelete = getMessagesToCleanup(chatId, []);
            
            // Barcha bildirishnoma xabarlarini o'chirish (so'nggi 10 ta)
            // Bu "Kutilayotgan so'rovlar" va "Hozircha kutilayotgan so'rovlar yo'q" xabarlarini o'z ichiga oladi
            if (messagesToDelete.length > 0) {
                const messagesToDeleteNow = messagesToDelete.slice(-10);
                log.info(`[CASHIER] [SHOW_REQUEST] [CLEANUP] Bildirishnoma xabarlarini o'chirish: ${messagesToDeleteNow.length} ta`);
                for (const messageId of messagesToDeleteNow) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        untrackMessage(chatId, messageId);
                        await new Promise(resolve => setTimeout(resolve, 100));
                        log.debug(`[CASHIER] [SHOW_REQUEST] [CLEANUP] Bildirishnoma xabari o'chirildi: messageId=${messageId}`);
                    } catch (deleteError) {
                        untrackMessage(chatId, messageId);
                        log.debug(`[CASHIER] [SHOW_REQUEST] [CLEANUP] Xabar o'chirishda xatolik (ignored): messageId=${messageId}, error=${deleteError.message}`);
                    }
                }
            }
        } catch (cleanupError) {
            log.debug(`[CASHIER] [SHOW_REQUEST] [CLEANUP] Bildirishnoma xabarlarini o'chirishda xatolik (ignored): ${cleanupError.message}`);
        }
        
        // Reply keyboard'ni har safar yangilash (pendingCount ga qarab)
        // MUHIM: Har safar yangi xabar yuborilganda, reply keyboard'da son to'g'ri yangilanadi
        // Telegram API'da reply keyboard faqat yangi xabar bilan yangilanadi, shuning uchun har safar yangi xabar yuboramiz
        if (pendingCount > 0) {
            const replyKeyboard = {
                keyboard: [
                    [{ text: `⏰ Kutilayotgan so'rovlar (${pendingCount} ta)` }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            };
            
            // Reply keyboard'ni yangilash uchun yangi xabar yuborish (reply keyboard faqat yangi xabar bilan yangilanadi)
            // MUHIM: Har safar yangi xabar yuborilganda, reply keyboard'da son to'g'ri yangilanadi
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
            // Agar kutilayotgan so'rovlar yo'q bo'lsa, reply keyboard'ni yangilash (0 ta ko'rsatish)
            const replyKeyboard = {
                keyboard: [
                    [{ text: `⏰ Kutilayotgan so'rovlar (0 ta)` }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            };
            
            // Reply keyboard'ni yangilash uchun xabar yuborish
            try {
                const pendingMessage = await bot.sendMessage(chatId, `📭 Hozircha kutilayotgan so'rovlar yo'q.`, {
                    reply_markup: replyKeyboard
                });
                
                // Xabarni track qilish
                try {
                    const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
                    trackMessage(chatId, pendingMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true);
                } catch (trackError) {
                    // Silent fail
                }
            } catch (sendError) {
                log.error(`[CASHIER] [SHOW_REQUEST] Xabar yuborishda xatolik: ${sendError.message}`);
            }
        }
        
        // ✅ Xabarni messageTracker'ga qo'shish (pending so'rov - tasdiqlanmaguncha o'chirilishi mumkin)
        try {
            const { trackMessage, MESSAGE_TYPES } = require('../utils/messageTracker.js');
            trackMessage(chatId, sentMessage.message_id, MESSAGE_TYPES.USER_MESSAGE, true, request.id, false); // shouldCleanup=true, isApproved=false - pending so'rov
            log.info(`[CASHIER] [SHOW_REQUEST] ✅ Kassirga xabar yuborildi: requestId=${request.id}, requestUID=${request.request_uid}, chatId=${chatId}, messageId=${sentMessage.message_id}, chatType=personal, telegraphUrl=${telegraphUrl || 'yo\'q'}, format=client-based`);
        } catch (trackError) {
            log.debug(`[CASHIER] [SHOW_REQUEST] Xabarni kuzatishga qo'shishda xatolik (ignored): ${trackError.message}`);
        }
        
        // MUHIM: preview_message_id ni O'ZGARTIRMASLIK!
        // preview_message_id faqat menejerga yuborilgan xabar uchun saqlanadi
        // Kassirga yuborilgan xabar uchun alohida field kerak (lekin hozircha yo'q)
        // Shuning uchun, bu yerda faqat log qilamiz
        
    } catch (error) {
        const errorBody = error.response?.body;
        const errorCode = errorBody?.error_code;
        const errorDescription = errorBody?.description || error.message;
        
        // Chat topilmadi yoki foydalanuvchi botni bloklagan
        if (errorCode === 400 && errorDescription?.includes('chat not found')) {
            log.warn(`[CASHIER] [SHOW_REQUEST] ⚠️ Chat topilmadi yoki foydalanuvchi botni bloklagan: chatId=${chatId}, userId=${user?.id}, userName=${user?.fullname}`);
            
            // telegram_chat_id ni tozalash
            if (user && user.id) {
                try {
                    await db('users').where('id', user.id).update({ 
                        telegram_chat_id: null,
                        telegram_username: null 
                    });
                    log.info(`[CASHIER] [SHOW_REQUEST] ✅ telegram_chat_id tozalandi: userId=${user.id}`);
                } catch (dbError) {
                    log.error(`[CASHIER] [SHOW_REQUEST] ❌ telegram_chat_id tozalashda xatolik:`, dbError);
                }
            }
        } else if (errorCode === 403) {
            log.warn(`[CASHIER] [SHOW_REQUEST] ⚠️ Foydalanuvchi botni bloklagan: chatId=${chatId}, userId=${user?.id}, userName=${user?.fullname}`);
            
            // telegram_chat_id ni tozalash
            if (user && user.id) {
                try {
                    await db('users').where('id', user.id).update({ 
                        telegram_chat_id: null,
                        telegram_username: null 
                    });
                    log.info(`[CASHIER] [SHOW_REQUEST] ✅ telegram_chat_id tozalandi: userId=${user.id}`);
                } catch (dbError) {
                    log.error(`[CASHIER] [SHOW_REQUEST] ❌ telegram_chat_id tozalashda xatolik:`, dbError);
                }
            }
        }
        
        log.error(`[CASHIER] [SHOW_REQUEST] ❌ Kassirga so'rov ko'rsatishda xatolik: requestId=${request.id}, chatId=${chatId}, userId=${user?.id}, error=${errorDescription}`, error);
        
        // Xatolikni qaytarish, chunki handleSendRequest da xatolikni handle qilish kerak
        throw error;
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
        
        // ✅ OPTIMALLASHTIRISH: Foydalanuvchini olish (cache'dan tezroq)
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // ✅ OPTIMALLASHTIRISH: Avval so'rovni tekshirish (eng tez)
        // Eslatma: Raxbar tasdiqlagandan keyin operator tayinlanganda current_approver_type operatorga o'zgaradi,
        // shuning uchun faqat current_approver_type = 'cashier' tekshiruvi yetarli emas.
        // Agar so'rov APPROVED_BY_LEADER statusida bo'lsa va current_approver_id foydalanuvchi ID'siga teng bo'lsa,
        // yoki current_approver_type = 'cashier' bo'lsa, tasdiqlashga ruxsat berish kerak.
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
            .where('debt_requests.locked', false)
            .where(function() {
                // Agar so'rov APPROVED_BY_LEADER statusida bo'lsa va current_approver_id foydalanuvchi ID'siga teng bo'lsa,
                // yoki current_approver_type = 'cashier' bo'lsa, tasdiqlashga ruxsat berish
                this.where(function() {
                    this.where('debt_requests.status', 'APPROVED_BY_LEADER')
                        .where('debt_requests.current_approver_id', user.id);
                })
                .orWhere('debt_requests.current_approver_type', 'cashier');
            })
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki sizga tegishli emas.');
            return;
        }
        
        // Foydalanuvchiga tegishli ekanligini tekshirish
        // Agar current_approver_type = 'cashier' bo'lsa, current_approver_id tekshirish kerak
        // Agar status = APPROVED_BY_LEADER bo'lsa, current_approver_id tekshirish kerak
        if (request.current_approver_type === 'cashier' && request.current_approver_id !== user.id) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki sizga tegishli emas.');
            return;
        }
        
        if (request.status === 'APPROVED_BY_LEADER' && request.current_approver_id !== user.id) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi yoki sizga tegishli emas.');
            return;
        }
        
        // So'rovni bloklash (boshqa kassir tasdiqlamasligi uchun) - double-check
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
        
        // ✅ OPTIMALLASHTIRISH: Loglarni parallel qilish
        await Promise.all([
            logApproval(requestId, user.id, 'cashier', 'approved', {}),
            logRequestAction(requestId, 'cashier_approved', user.id, {
                new_status: 'APPROVED_BY_CASHIER'
            })
        ]);
        
        // Operator tayinlash (avval, chunki u current_approver_id va current_approver_type ni o'rnatadi)
        const { assignOperatorToRequest } = require('../../../utils/cashierAssignment.js');
        const operator = await assignOperatorToRequest(request.brand_id, requestId);
        
        if (operator) {
            log.info(`[CASHIER] [APPROVAL] 7.1. ✅ Operator tayinlandi: OperatorId=${operator.user_id}, Name=${operator.fullname}, TelegramChatId=${operator.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
        } else {
            log.warn(`[CASHIER] [APPROVAL] 7.1. ❌ Operator tayinlanmadi: brandId=${request.brand_id}`);
        }
        
        // Status yangilash (current_approver_id va current_approver_type operator tayinlashda o'rnatilgan, agar operator topilsa)
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_CASHIER',
                locked: false,
                locked_by: null,
                locked_at: null
            });
        
        log.info(`[CASHIER] [APPROVAL] 8.1. ✅ Status yangilandi: APPROVED_BY_CASHIER`);
        
        // Supervisor'larga yuborish (agar kasirlarga nazoratchi biriktirilgan bo'lsa)
        const { getSupervisorsForCashiers } = require('../../../utils/supervisorAssignment.js');
        const supervisors = await getSupervisorsForCashiers(requestId, request.branch_id);
        
        if (supervisors.length > 0) {
            log.info(`[CASHIER] [APPROVAL] 9.1. ✅ Supervisor'lar topildi: ${supervisors.length} ta`);
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
                await showRequestToSupervisor(fullRequest, supervisors, 'cashier');
                log.info(`[CASHIER] [APPROVAL] 9.2. ✅ So'rov supervisor'larga yuborildi: requestId=${requestId}`);
            }
        } else {
            log.info(`[CASHIER] [APPROVAL] 9.1. ⚠️ Supervisor'lar topilmadi, operatorga to'g'ridan-to'g'ri yuborilmoqda`);
            
            // Operatorga guruh orqali yuborish
            const { showRequestToOperator } = require('./operator.js');
            
            if (operator) {
                // So'rovni to'liq ma'lumotlar bilan olish (brand_name, filial_name, svr_name bilan)
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
                    log.info(`[CASHIER] [APPROVAL] 9.2.3. So'rov ma'lumotlari topildi: RequestUID=${fullRequest.request_uid}, Brand=${fullRequest.brand_name}, Branch=${fullRequest.filial_name}`);
                    
                    // Operatorning boshqa faol so'rovlarini tekshirish (bir vaqtda faqat bitta so'rov ko'rsatiladi)
                    // MUHIM: Joriy so'rovni (requestId) istisno qilish kerak
                    const activeRequestsCount = await db('debt_requests')
                        .where('current_approver_id', operator.user_id)
                        .where('current_approver_type', 'operator')
                        .whereIn('status', ['APPROVED_BY_CASHIER', 'APPROVED_BY_SUPERVISOR', 'DEBT_MARKED_BY_CASHIER'])
                        .where('locked', false)
                        .where('id', '!=', requestId) // Joriy so'rovni istisno qilish
                        .count('* as count')
                        .first();
                    
                    // pendingCount ni to'g'ri raqamga o'tkazish
                    let operatorPendingCount = 0;
                    if (activeRequestsCount && activeRequestsCount.count) {
                        operatorPendingCount = parseInt(activeRequestsCount.count, 10);
                        if (isNaN(operatorPendingCount)) {
                            operatorPendingCount = 0;
                        }
                    }
                    
                    // Operator user ma'lumotlarini olish
                    const operatorUser = await db('users').where('id', operator.user_id).first();
                    
                    // HAR DOIM joriy so'rovni yuborish (fullRequest)
                    // pendingCount = boshqa pending so'rovlar soni (joriy so'rovni istisno qilgan holda)
                    log.info(`[CASHIER] [APPROVAL] 📤 Operatorlar guruhiga xabar yuborilmoqda: requestId=${requestId}, operatorId=${operator.user_id}, operatorName=${operator.fullname}, pendingCount=${operatorPendingCount}`);
                    await showRequestToOperator(fullRequest, operator.user_id, operatorUser || operator, operatorPendingCount);
                    log.info(`[CASHIER] [APPROVAL] ✅ Operatorlar guruhiga xabar yuborildi: requestId=${requestId}, requestUID=${request.request_uid}, operatorId=${operator.user_id}, operatorName=${operator.fullname}, pendingCount=${operatorPendingCount}, chatType=group`);
                } else {
                    log.error(`[CASHIER] [APPROVAL] 9.2.3. ❌ So'rov ma'lumotlari topilmadi: requestId=${requestId}`);
                }
            } else {
                log.warn(`[CASHIER] [APPROVAL] 9.2.1. ⚠️ Operator topilmadi: requestId=${requestId}, brandId=${request.brand_id} - So'rov operatorlar guruhiga yuborilmadi`);
            }
        }
        
        log.info(`[CASHIER] [APPROVAL] ✅ Kassir tasdiqladi: requestId=${requestId}, requestUID=${request.request_uid}, cashierId=${user.id}, cashierName=${user.fullname}, brand=${request.brand_name}, branch=${request.filial_name}`);
        
        // ✅ MUHIM: "Qarzi bor" bosilganda yuborilgan xabarlarni tozalash
        // Agar state mavjud bo'lsa va "Qarzi bor" bosilgan bo'lsa, namuna va xatolik xabarlarini o'chirish
        const currentState = stateManager.getUserState(userId);
        if (currentState && currentState.state === STATES.AUTO_DETECT_DEBT_INPUT && currentState.data && currentState.data.request_id === requestId) {
            const messagesToDelete = [];
            
            // Birinchi namuna xabarini o'chirish
            if (currentState.data.first_example_message_id) {
                messagesToDelete.push(currentState.data.first_example_message_id);
            }
            
            // Xatolik xabarini o'chirish
            if (currentState.data.last_error_message_id) {
                messagesToDelete.push(currentState.data.last_error_message_id);
            }
            
            // Barcha eski xabarlarni o'chirish
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                    log.info(`[CASHIER] [APPROVAL] [CLEANUP] Eski xabar o'chirildi: messageId=${messageId}`);
                } catch (deleteError) {
                    log.debug(`[CASHIER] [APPROVAL] [CLEANUP] Eski xabar o'chirilmadi: messageId=${messageId}, error=${deleteError.message}`);
                }
            }
            
            // State'ni tozalash
            stateManager.clearUserState(userId);
            log.info(`[CASHIER] [APPROVAL] [CLEANUP] State tozalandi va ${messagesToDelete.length} ta xabar o'chirildi`);
        }
        
        // Xabarni yangilash (menejerga)
        await updateRequestMessage(requestId, 'APPROVED_BY_CASHIER', {
            username: user.username,
            fullname: user.fullname,
            approval_type: 'cashier'
        });
        
        // Eslatmalarni to'xtatish
        cancelReminders(requestId);
        
        // ✅ MUHIM: Xabarni tasdiqlangan sifatida belgilash (keyingi so'rovni ko'rsatishdan oldin)
        // Bu xabarni tozalashdan himoya qiladi
        try {
            const { markAsApproved } = require('../utils/messageTracker.js');
            markAsApproved(chatId, query.message.message_id, requestId);
            log.debug(`[CASHIER] [APPROVAL] Xabar tasdiqlangan sifatida belgilandi (oldin): chatId=${chatId}, messageId=${query.message.message_id}, requestId=${requestId}`);
        } catch (markError) {
            log.debug(`[CASHIER] [APPROVAL] Xabarni belgilashda xatolik (ignored): ${markError.message}`);
        }
        
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
            
            // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
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
                        total_amount: request.excel_total,
                        isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                    });
                } catch (telegraphError) {
                    // Telegraph xatolari silent qilinadi (ixtiyoriy xizmat)
                    log.debug(`[CASHIER] [APPROVAL] Telegraph xatolik (ixtiyoriy xizmat): requestId=${requestId}`);
                }
            }
            
            // Telegraph URL ni request objectga qo'shish
            request.telegraph_url = telegraphUrl;
            request.excel_data = excelData;
            request.excel_headers = excelHeaders;
            request.excel_columns = excelColumns;
            
            // Original xabar + faqat avvalgilari tasdiqlashlar (kassir uchun)
            approvalMessage = await formatRequestMessageWithApprovals(request, db, 'cashier');
        } else {
            // Oddiy so'rov uchun original xabar + faqat avvalgilari tasdiqlashlar (kassir uchun)
            approvalMessage = await formatRequestMessageWithApprovals(request, db, 'cashier');
        }
        
        // Xabarni yangilash (agar xabar hali mavjud bo'lsa)
        // Eslatma: Agar xabar allaqachon o'chirilgan bo'lsa (navbatli ko'rsatish tufayli), xatolikni e'tiborsiz qoldirish
        try {
        await bot.editMessageText(
            approvalMessage,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
            
            // ✅ Xabar allaqachon belgilangan (yuqorida), shuning uchun bu yerda qayta belgilash shart emas
        } catch (editError) {
            // Agar xabar topilmasa (o'chirilgan bo'lsa), yangi xabar yuborish
            const isMessageNotFound = editError.message?.includes('message to edit not found') ||
                                     editError.message?.includes('message not found') ||
                                     editError.response?.body?.description?.includes('message to edit not found');
            
            if (isMessageNotFound) {
                log.debug(`[CASHIER] [APPROVAL] Xabar allaqachon o'chirilgan, yangi xabar yuborilmaydi (navbatli ko'rsatish tufayli): requestId=${requestId}, messageId=${query.message.message_id}`);
                // Xabar o'chirilgan bo'lsa, yangi xabar yuborish shart emas
                // chunki keyingi so'rov allaqachon ko'rsatilgan
            } else {
                // Boshqa xatoliklar uchun log qilish
                log.warn(`[CASHIER] [APPROVAL] Xabarni yangilashda xatolik: requestId=${requestId}, error=${editError.message}`);
            }
        }
    } catch (error) {
        log.error('Error handling cashier approval:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Qarzi bor bosilganda - Avtomatik tanib olish
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
        
        // State'ni boshlash - avtomatik tanib olish uchun
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.AUTO_DETECT_DEBT_INPUT, {
            request_id: requestId,
            request_uid: request.request_uid,
            brand_id: request.brand_id,
            branch_id: request.branch_id,
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            allowed_user_id: user.id // Faqat shu foydalanuvchidan qabul qilish
        });
        
        log.info(`[CASHIER_DEBT] Qarzi bor bosildi (avtomatik tanib olish): requestId=${requestId}, userId=${user.id}, brandId=${request.brand_id}, branchId=${request.branch_id}, type=${request.type}`);
        
        // Namuna ko'rsatish - agar SET bo'lsa, real ma'lumotlar bilan
        let exampleMessage = '📊 <b>Qarzdorlik ma\'lumotlarini kiriting</b>\n\n';
        exampleMessage += '📝 <b>Namuna:</b>\n\n';
        
        if (request.type === 'SET' && request.excel_data) {
            // SET so'rov: real ma'lumotlar bilan namunani ko'rsatish
            try {
                let excelData = request.excel_data;
                let excelHeaders = request.excel_headers;
                let excelColumns = request.excel_columns;
                
                if (typeof excelData === 'string' && excelData) {
                    excelData = JSON.parse(excelData);
                }
                if (typeof excelHeaders === 'string' && excelHeaders) {
                    excelHeaders = JSON.parse(excelHeaders);
                }
                if (typeof excelColumns === 'string' && excelColumns) {
                    excelColumns = JSON.parse(excelColumns);
                }
                
                // Agent bo'yicha guruhlash
                if (excelData && Array.isArray(excelData) && excelData.length > 0 && excelColumns && excelColumns.agent !== undefined && excelColumns.agent !== null) {
                    const agentMap = new Map();
                    const agentHeader = excelHeaders && excelHeaders[excelColumns.agent] ? excelHeaders[excelColumns.agent] : 'Agent';
                    const summaHeader = excelHeaders && excelHeaders[excelColumns.summa] ? excelHeaders[excelColumns.summa] : 'Summa';
                    
                    excelData.forEach(row => {
                        const agentName = row[agentHeader] !== undefined ? String(row[agentHeader]).trim() : 'Noma\'lum';
                        const summaValue = row[summaHeader] !== undefined 
                            ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                            : 0;
                        
                        if (!agentMap.has(agentName)) {
                            agentMap.set(agentName, 0);
                        }
                        agentMap.set(agentName, agentMap.get(agentName) + (isNaN(summaValue) ? 0 : Math.abs(summaValue)));
                    });
                    
                    // Real namunani ko'rsatish
                    exampleMessage += '💰 <b>Umumiy summa:</b>\n';
                    const totalSum = Array.from(agentMap.values()).reduce((sum, val) => sum + val, 0);
                    // 3 xonali format (bo'shliqlarni saqlash)
                    exampleMessage += `<code>${totalSum.toLocaleString('ru-RU')}</code>\n\n`;
                    
                    exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
                    const sortedAgents = Array.from(agentMap.entries()).sort((a, b) => b[1] - a[1]);
                    sortedAgents.slice(0, 7).forEach(([agentName, sum]) => {
                        // Bitta qatorda agent nomi va summasi (3 xonali format)
                        exampleMessage += `<code>${agentName}: ${sum.toLocaleString('ru-RU')}</code>\n`;
                    });
                    if (sortedAgents.length > 7) {
                        exampleMessage += `<code>...</code>\n`;
                    }
                } else {
                    // Agar agent ustuni bo'lmasa, standart namunani ko'rsatish
                    exampleMessage += '💰 <b>Umumiy summa:</b>\n';
                    exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
                    exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
                    exampleMessage += '<code>Agent1: 200000</code>\n';
                    exampleMessage += '<code>Agent2: 300000</code>\n';
                    exampleMessage += '<code>Agent3: 150000</code>\n';
                }
            } catch (error) {
                log.error(`[CASHIER_DEBT] SET so'rov namunasi yaratishda xatolik: ${error.message}`);
                // Xatolik bo'lsa, standart namunani ko'rsatish
                exampleMessage += '💰 <b>Umumiy summa:</b>\n';
                exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
                exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
                exampleMessage += '<code>Agent1: 200000</code>\n';
                exampleMessage += '<code>Agent2: 300000</code>\n';
                exampleMessage += '<code>Agent3: 150000</code>\n';
            }
        } else {
            // Oddiy so'rov: standart namunani ko'rsatish
            exampleMessage += '💰 <b>Umumiy summa:</b>\n';
            exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
            exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
            exampleMessage += '<code>Agent1: 200000</code>\n';
            exampleMessage += '<code>Agent2: 300000</code>\n';
            exampleMessage += '<code>Agent3: 150000</code>\n';
        }
        
        exampleMessage += '\n📎 <b>Excel fayl:</b> Excel fayl yuborish\n\n';
        exampleMessage += '⚠️ Tizim avtomatik tanib oladi.';
        
        // Birinchi namuna xabarini yuborish va ID'sini saqlash
        const exampleMsg = await bot.sendMessage(chatId, exampleMessage, { parse_mode: 'HTML' });
        
        // Birinchi namuna xabari ID'sini state'ga saqlash (keyinchalik o'chirish uchun)
        const currentState = stateManager.getUserState(userId);
        if (currentState && currentState.data) {
            currentState.data.first_example_message_id = exampleMsg.message_id;
            stateManager.updateUserState(userId, currentState.state, currentState.data);
        }
    } catch (error) {
        log.error('Error handling cashier debt:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Umumiy summa variantini tanlash
 */
async function handleCashierDebtTotal(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.state !== STATES.SELECT_DEBT_INPUT_TYPE) {
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.ENTER_TOTAL_AMOUNT, {
            ...state.data,
            input_type: 'total'
        });
        
        await bot.sendMessage(
            chatId,
            '💰 <b>Umumiy summa kiriting</b>\n\n' +
            'Masalan: <code>500000</code> yoki <code>1 500 000</code>\n\n' +
            '⚠️ Faqat raqam kiriting (so\'m).',
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        log.error('Error handling cashier debt total:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Agent bo'yicha variantini tanlash
 */
async function handleCashierDebtAgent(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.state !== STATES.SELECT_DEBT_INPUT_TYPE) {
            return;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.ENTER_AGENT_DEBTS, {
            ...state.data,
            input_type: 'agent'
        });
        
        await bot.sendMessage(
            chatId,
            '📋 <b>Agent bo\'yicha qarzdorlik kiriting</b>\n\n' +
            'Format:\n' +
            '<code>Agent1: 200000</code>\n' +
            '<code>Agent2: 300000</code>\n' +
            '<code>Agent3: 150000</code>\n\n' +
            '⚠️ Har bir agent uchun alohida qator.\n' +
            'Format: <code>Agent nomi: Summa</code>',
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        log.error('Error handling cashier debt agent:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel fayl variantini tanlash (eski variant)
 */
async function handleCashierDebtExcel(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.state !== STATES.SELECT_DEBT_INPUT_TYPE) {
            return;
        }
        
        // State'ni UPLOAD_DEBT_EXCEL ga o'zgartirish (eski logika)
        stateManager.updateUserState(userId, STATES.UPLOAD_DEBT_EXCEL, {
            ...state.data,
            input_type: 'excel'
        });
        
        await bot.sendMessage(
            chatId,
            '📎 Qarzdorlik faylingizni yuboring.'
        );
    } catch (error) {
        log.error('Error handling cashier debt excel:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Umumiy summa qabul qilish
 */
async function handleTotalAmountInput(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.state !== STATES.ENTER_TOTAL_AMOUNT) {
            return false;
        }
        
        // Faqat raqamni ajratish (vergul, nuqta va boshqa belgilarni olib tashlash)
        const amountStr = text.replace(/[^\d]/g, '');
        const amount = parseFloat(amountStr);
        
        // Tekshiruv: agar vergul, nuqta yoki boshqa belgilar bo'lsa, xatolik
        if (text.match(/[,\.]/)) {
            // Eski xabarlarni o'chirish
            const messagesToDelete = [];
            if (state.data && state.data.first_example_message_id) {
                messagesToDelete.push(state.data.first_example_message_id);
            }
            if (state.data && state.data.last_error_message_id) {
                messagesToDelete.push(state.data.last_error_message_id);
            }
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                } catch (deleteError) {
                    log.debug(`[CASHIER] [TOTAL_AMOUNT] Eski xabar o'chirilmadi: ${deleteError.message}`);
                }
            }
            
            // To'liq namunani yaratish va xatolik xabari yuborish
            const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
            const errorMsg = await bot.sendMessage(
                chatId,
                `❌ <b>Xatolik:</b> Qiymatda vergul, nuqta yoki boshqa belgilar bo'lmasligi kerak: <code>${text}</code>\n\n` +
                '⚠️ <b>Faqat raqamlar qabul qilinadi!</b>\n\n' + fullExampleMessage,
                { parse_mode: 'HTML' }
            );
            if (state.data) {
                state.data.last_error_message_id = errorMsg.message_id;
                stateManager.updateUserState(userId, state.state, state.data);
            }
            return true;
        }
        
        if (isNaN(amount) || amount <= 0) {
            // Eski xabarlarni o'chirish
            const messagesToDelete = [];
            if (state.data && state.data.first_example_message_id) {
                messagesToDelete.push(state.data.first_example_message_id);
            }
            if (state.data && state.data.last_error_message_id) {
                messagesToDelete.push(state.data.last_error_message_id);
            }
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                } catch (deleteError) {
                    log.debug(`[CASHIER] [TOTAL_AMOUNT] Eski xabar o'chirilmadi: ${deleteError.message}`);
                }
            }
            
            // To'liq namunani yaratish va xatolik xabari yuborish
            const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
            const errorMsg = await bot.sendMessage(
                chatId,
                '❌ <b>Xatolik:</b> Noto\'g\'ri format. Faqat raqam kiriting.\n\n' + fullExampleMessage,
                { parse_mode: 'HTML' }
            );
            if (state.data) {
                state.data.last_error_message_id = errorMsg.message_id;
                stateManager.updateUserState(userId, state.state, state.data);
            }
            return true;
        }
        
        // Ma'lumotlarni formatlash (Excel formatiga o'xshash, solishtirish uchun)
        const debtData = {
            excel_data: [{
                'Agent': 'Umumiy',
                'Summa': amount
            }],
            excel_headers: ['Agent', 'Summa'],
            excel_columns: {
                agent: 0,
                summa: 1
            },
            total_amount: amount,
            input_type: 'total'
        };
        
        // Solishtirish uchun ma'lumotlarni tayyorlash (agar SET so'rov bo'lsa)
        const request = await db('debt_requests')
            .where('id', state.data.request_id)
            .first();
        
        let comparisonResult = null;
        if (request && request.type === 'SET' && request.excel_data) {
            try {
                const originalExcelData = JSON.parse(request.excel_data);
                const originalHeaders = request.excel_headers ? JSON.parse(request.excel_headers) : null;
                const originalColumns = request.excel_columns ? JSON.parse(request.excel_columns) : null;
                
                // Original ma'lumotlarni agent bo'yicha guruhlash (agar mavjud bo'lsa)
                let originalTotal = 0;
                if (originalColumns && originalColumns.agent !== undefined && originalColumns.summa !== undefined) {
                    const agentHeader = originalHeaders && originalHeaders[originalColumns.agent] ? originalHeaders[originalColumns.agent] : 'Agent';
                    const summaHeader = originalHeaders && originalHeaders[originalColumns.summa] ? originalHeaders[originalColumns.summa] : 'Summa';
                    
                    originalExcelData.forEach(row => {
                        const summaValue = row[summaHeader] !== undefined 
                            ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                            : 0;
                        originalTotal += (isNaN(summaValue) ? 0 : summaValue);
                    });
                } else if (originalColumns && originalColumns.summa !== undefined) {
                    // Agar agent ustuni bo'lmasa, faqat summani yig'ish
                    const summaHeader = originalHeaders && originalHeaders[originalColumns.summa] ? originalHeaders[originalColumns.summa] : 'Summa';
                    originalExcelData.forEach(row => {
                        const summaValue = row[summaHeader] !== undefined 
                            ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                            : 0;
                        originalTotal += (isNaN(summaValue) ? 0 : summaValue);
                    });
                }
                
                // Solishtirish natijasini yaratish
                const difference = amount - Math.abs(originalTotal);
                comparisonResult = {
                    canCompare: true,
                    isIdentical: difference === 0,
                    totalDifference: difference,
                    differences: [{
                        type: 'total',
                        original_summa: Math.abs(originalTotal),
                        new_summa: amount,
                        difference: difference
                    }]
                };
                
                log.info(`[CASHIER] [TOTAL_AMOUNT] Solishtirish: originalTotal=${originalTotal}, newAmount=${amount}, difference=${difference}`);
            } catch (compareError) {
                log.error(`[CASHIER] [TOTAL_AMOUNT] Solishtirishda xatolik: ${compareError.message}`);
            }
        }
        
        // Solishtirish natijasini qo'shish
        if (comparisonResult) {
            debtData.comparison_result = comparisonResult;
        }
        
        // sendDebtResponse ni chaqirish (keyingi jarayon o'zgarmasdan)
        await sendDebtResponse(state.data.request_id, userId, chatId, debtData);
        
        // State'ni tozalash
        stateManager.clearUserState(userId);
        
        await bot.sendMessage(chatId, '✅ Qarzdorlik ma\'lumotlari qabul qilindi.');
        
        return true;
    } catch (error) {
        log.error('Error handling total amount input:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
    }
}

/**
 * Agent bo'yicha qarzdorlik qabul qilish
 */
async function handleAgentDebtsInput(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.state !== STATES.ENTER_AGENT_DEBTS) {
            return false;
        }
        
        // Qatorlarni ajratish
        const lines = text.split('\n').filter(line => line.trim());
        const agentDebts = [];
        const agentNamesSet = new Set(); // Takrorlanishni tekshirish uchun
        let totalAmount = 0;
        let errorMessageId = null; // Xatolik xabari ID'si (o'chirish uchun)
        
        for (const line of lines) {
            // Format: "Agent nomi: Summa" yoki "Agent nomi - Summa"
            const match = line.match(/^(.+?)[:\-]\s*([\d\s,]+)$/);
            if (!match) {
                // Eski xabarlarni o'chirish
                const messagesToDelete = [];
                if (state.data && state.data.first_example_message_id) {
                    messagesToDelete.push(state.data.first_example_message_id);
                }
                if (state.data && state.data.last_error_message_id) {
                    messagesToDelete.push(state.data.last_error_message_id);
                }
                for (const messageId of messagesToDelete) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        log.debug(`[CASHIER] [AGENT_DEBTS] Eski xabar o'chirilmadi: ${deleteError.message}`);
                    }
                }
                
                // To'liq namunani yaratish va xatolik xabari yuborish
                const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
                const errorMsg = await bot.sendMessage(
                    chatId,
                    `❌ <b>Xatolik:</b> Noto'g'ri format: <code>${line}</code>\n\n` +
                    '⚠️ <b>Har bir agent uchun alohida qator bo\'lishi kerak!</b>\n\n' + fullExampleMessage,
                    { parse_mode: 'HTML' }
                );
                errorMessageId = errorMsg.message_id;
                if (state.data) {
                    state.data.last_error_message_id = errorMsg.message_id;
                    stateManager.updateUserState(userId, state.state, state.data);
                }
                return true;
            }
            
            const agentName = match[1].trim();
            // Faqat raqamlarni qabul qilish (vergul, nuqta va boshqa belgilarni olib tashlash)
            const amountStr = match[2].replace(/[^\d]/g, '');
            const amount = parseFloat(amountStr);
            
            // Tekshiruv: agar vergul, nuqta yoki boshqa belgilar bo'lsa, xatolik
            if (match[2].match(/[,\.]/)) {
                // Eski xabarlarni o'chirish
                const messagesToDelete = [];
                if (state.data && state.data.first_example_message_id) {
                    messagesToDelete.push(state.data.first_example_message_id);
                }
                if (state.data && state.data.last_error_message_id) {
                    messagesToDelete.push(state.data.last_error_message_id);
                }
                for (const messageId of messagesToDelete) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        log.debug(`[CASHIER] [AGENT_DEBTS] Eski xabar o'chirilmadi: ${deleteError.message}`);
                    }
                }
                
                // To'liq namunani yaratish va xatolik xabari yuborish
                const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
                const errorMsg = await bot.sendMessage(
                    chatId,
                    `❌ <b>Xatolik:</b> Qiymatda vergul, nuqta yoki boshqa belgilar bo'lmasligi kerak: <code>${line}</code>\n\n` +
                    '⚠️ <b>Faqat raqamlar qabul qilinadi!</b>\n\n' + fullExampleMessage,
                    { parse_mode: 'HTML' }
                );
                errorMessageId = errorMsg.message_id;
                if (state.data) {
                    state.data.last_error_message_id = errorMsg.message_id;
                    stateManager.updateUserState(userId, state.state, state.data);
                }
                return true;
            }
            
            // Tekshiruv: bir xil agent nomi takrorlanmasligi
            if (agentNamesSet.has(agentName)) {
                // Eski xabarlarni o'chirish
                const messagesToDelete = [];
                if (state.data && state.data.first_example_message_id) {
                    messagesToDelete.push(state.data.first_example_message_id);
                }
                if (state.data && state.data.last_error_message_id) {
                    messagesToDelete.push(state.data.last_error_message_id);
                }
                for (const messageId of messagesToDelete) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        log.debug(`[CASHIER] [AGENT_DEBTS] Eski xabar o'chirilmadi: ${deleteError.message}`);
                    }
                }
                
                // To'liq namunani yaratish va xatolik xabari yuborish
                const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
                const errorMsg = await bot.sendMessage(
                    chatId,
                    `❌ <b>Xatolik:</b> Agent nomi takrorlanadi: <code>${agentName}</code>\n\n` +
                    '⚠️ <b>Har bir agent faqat bir marta kiritilishi kerak!</b>\n\n' + fullExampleMessage,
                    { parse_mode: 'HTML' }
                );
                errorMessageId = errorMsg.message_id;
                if (state.data) {
                    state.data.last_error_message_id = errorMsg.message_id;
                    stateManager.updateUserState(userId, state.state, state.data);
                }
                return true;
            }
            
            if (isNaN(amount) || amount <= 0) {
                // Eski xabarlarni o'chirish
                const messagesToDelete = [];
                if (state.data && state.data.first_example_message_id) {
                    messagesToDelete.push(state.data.first_example_message_id);
                }
                if (state.data && state.data.last_error_message_id) {
                    messagesToDelete.push(state.data.last_error_message_id);
                }
                for (const messageId of messagesToDelete) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        log.debug(`[CASHIER] [AGENT_DEBTS] Eski xabar o'chirilmadi: ${deleteError.message}`);
                    }
                }
                
                // To'liq namunani yaratish va xatolik xabari yuborish
                const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
                const errorMsg = await bot.sendMessage(
                    chatId,
                    `❌ <b>Xatolik:</b> Noto'g'ri summa: <code>${line}</code>\n\n` + fullExampleMessage,
                    { parse_mode: 'HTML' }
                );
                errorMessageId = errorMsg.message_id;
                if (state.data) {
                    state.data.last_error_message_id = errorMsg.message_id;
                    stateManager.updateUserState(userId, state.state, state.data);
                }
                return true;
            }
            
            agentNamesSet.add(agentName);
            agentDebts.push({
                'Agent': agentName,
                'Summa': amount
            });
            
            totalAmount += amount;
        }
        
        if (agentDebts.length === 0) {
            // Eski xabarlarni o'chirish
            const messagesToDelete = [];
            if (state.data && state.data.first_example_message_id) {
                messagesToDelete.push(state.data.first_example_message_id);
            }
            if (state.data && state.data.last_error_message_id) {
                messagesToDelete.push(state.data.last_error_message_id);
            }
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                } catch (deleteError) {
                    log.debug(`[CASHIER] [AGENT_DEBTS] Eski xabar o'chirilmadi: ${deleteError.message}`);
                }
            }
            
            // To'liq namunani yaratish va xatolik xabari yuborish
            const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
            const errorMsg = await bot.sendMessage(
                chatId,
                '❌ <b>Xatolik:</b> Hech qanday ma\'lumot topilmadi.\n\n' + fullExampleMessage,
                { parse_mode: 'HTML' }
            );
            errorMessageId = errorMsg.message_id;
            if (state.data) {
                state.data.last_error_message_id = errorMsg.message_id;
                stateManager.updateUserState(userId, state.state, state.data);
            }
            return true;
        }
        
        // Ma'lumotlarni formatlash
        const debtData = {
            excel_data: agentDebts,
            excel_headers: ['Agent', 'Summa'],
            excel_columns: {
                agent: 0,
                summa: 1
            },
            total_amount: totalAmount,
            input_type: 'agent'
        };
        
        // Solishtirish uchun ma'lumotlarni tayyorlash (agar SET so'rov bo'lsa)
        const request = await db('debt_requests')
            .where('id', state.data.request_id)
            .first();
        
        let comparisonResult = null;
        if (request && request.type === 'SET' && request.excel_data) {
            try {
                const originalExcelData = JSON.parse(request.excel_data);
                const originalHeaders = request.excel_headers ? JSON.parse(request.excel_headers) : null;
                const originalColumns = request.excel_columns ? JSON.parse(request.excel_columns) : null;
                
                // Original ma'lumotlarni agent bo'yicha guruhlash
                const originalAgentMap = new Map();
                if (originalColumns && originalColumns.agent !== undefined && originalColumns.summa !== undefined) {
                    const agentHeader = originalHeaders && originalHeaders[originalColumns.agent] ? originalHeaders[originalColumns.agent] : 'Agent';
                    const summaHeader = originalHeaders && originalHeaders[originalColumns.summa] ? originalHeaders[originalColumns.summa] : 'Summa';
                    
                    originalExcelData.forEach(row => {
                        const agentName = row[agentHeader] !== undefined ? String(row[agentHeader]).trim() : 'Noma\'lum';
                        const summaValue = row[summaHeader] !== undefined 
                            ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                            : 0;
                        
                        if (!originalAgentMap.has(agentName)) {
                            originalAgentMap.set(agentName, 0);
                        }
                        originalAgentMap.set(agentName, originalAgentMap.get(agentName) + (isNaN(summaValue) ? 0 : summaValue));
                    });
                }
                
                // Yangi ma'lumotlarni agent bo'yicha guruhlash
                const newAgentMap = new Map();
                agentDebts.forEach(item => {
                    newAgentMap.set(item.Agent, item.Summa);
                });
                
                // Farqlarni topish
                const differences = [];
                let totalDifference = 0;
                
                // Barcha agentlarni tekshirish
                const allAgents = new Set([...originalAgentMap.keys(), ...newAgentMap.keys()]);
                
                allAgents.forEach(agentName => {
                    const originalSum = originalAgentMap.get(agentName) || 0;
                    const newSum = newAgentMap.get(agentName) || 0;
                    const diff = newSum - Math.abs(originalSum);
                    
                    if (diff !== 0) {
                        differences.push({
                            type: 'changed',
                            agent: agentName,
                            agent_name: agentName, // Telegraph uchun
                            original_summa: Math.abs(originalSum),
                            new_summa: newSum,
                            difference: diff
                        });
                        totalDifference += diff;
                    }
                });
                
                comparisonResult = {
                    canCompare: true,
                    isIdentical: differences.length === 0,
                    totalDifference: totalDifference,
                    differences: differences
                };
                
                log.info(`[CASHIER] [AGENT_DEBTS] Solishtirish: differences=${differences.length}, totalDifference=${totalDifference}`);
            } catch (compareError) {
                log.error(`[CASHIER] [AGENT_DEBTS] Solishtirishda xatolik: ${compareError.message}`);
            }
        }
        
        // Solishtirish natijasini qo'shish
        if (comparisonResult) {
            debtData.comparison_result = comparisonResult;
        }
        
        // sendDebtResponse ni chaqirish (keyingi jarayon o'zgarmasdan)
        await sendDebtResponse(state.data.request_id, userId, chatId, debtData);
        
        // State'ni tozalash
        stateManager.clearUserState(userId);
        
        await bot.sendMessage(chatId, '✅ Qarzdorlik ma\'lumotlari qabul qilindi.');
        
        return true;
    } catch (error) {
        log.error('Error handling agent debts input:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
    }
}

/**
 * To'liq namuna xabari yaratish (xatolik xabari uchun) - birinchi namuna xabari kabi
 */
async function buildFullExampleMessage(requestId, svrName) {
    try {
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        log.info(`[CASHIER] [BUILD_FULL_EXAMPLE] buildFullExampleMessage chaqirildi: requestId=${requestId}, request=${!!request}, type=${request?.type}, hasExcelData=${!!request?.excel_data}`);
        
        let exampleMessage = '📊 <b>Qarzdorlik ma\'lumotlarini kiriting</b>\n\n';
        exampleMessage += '📝 <b>Namuna:</b>\n\n';
        
        if (request && request.type === 'SET' && request.excel_data) {
            // SET so'rov: real ma'lumotlar bilan namunani ko'rsatish
            try {
                let excelData = request.excel_data;
                let excelHeaders = request.excel_headers;
                let excelColumns = request.excel_columns;
                
                if (typeof excelData === 'string' && excelData) {
                    excelData = JSON.parse(excelData);
                }
                if (typeof excelHeaders === 'string' && excelHeaders) {
                    excelHeaders = JSON.parse(excelHeaders);
                }
                if (typeof excelColumns === 'string' && excelColumns) {
                    excelColumns = JSON.parse(excelColumns);
                }
                
                log.info(`[CASHIER] [BUILD_FULL_EXAMPLE] Parsed data: excelData=${Array.isArray(excelData) ? excelData.length : 'not array'}, excelColumns=${JSON.stringify(excelColumns)}, agentColumn=${excelColumns?.agent}`);
                
                // Agent bo'yicha guruhlash
                if (excelData && Array.isArray(excelData) && excelData.length > 0 && excelColumns && excelColumns.agent !== undefined && excelColumns.agent !== null) {
                    const agentMap = new Map();
                    const agentHeader = excelHeaders && excelHeaders[excelColumns.agent] ? excelHeaders[excelColumns.agent] : 'Agent';
                    const summaHeader = excelHeaders && excelHeaders[excelColumns.summa] ? excelHeaders[excelColumns.summa] : 'Summa';
                    
                    log.info(`[CASHIER] [BUILD_FULL_EXAMPLE] Headers: agentHeader=${agentHeader}, summaHeader=${summaHeader}`);
                    
                    excelData.forEach(row => {
                        const agentName = row[agentHeader] !== undefined ? String(row[agentHeader]).trim() : 'Noma\'lum';
                        const summaValue = row[summaHeader] !== undefined 
                            ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                            : 0;
                        
                        if (!agentMap.has(agentName)) {
                            agentMap.set(agentName, 0);
                        }
                        agentMap.set(agentName, agentMap.get(agentName) + (isNaN(summaValue) ? 0 : Math.abs(summaValue)));
                    });
                    
                    log.info(`[CASHIER] [BUILD_FULL_EXAMPLE] Agent map created: ${agentMap.size} agents`);
                    
                    // Real namunani ko'rsatish
                    exampleMessage += '💰 <b>Umumiy summa:</b>\n';
                    const totalSum = Array.from(agentMap.values()).reduce((sum, val) => sum + val, 0);
                    exampleMessage += `<code>${totalSum.toLocaleString('ru-RU')}</code>\n\n`;
                    
                    exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
                    const sortedAgents = Array.from(agentMap.entries()).sort((a, b) => b[1] - a[1]);
                    sortedAgents.slice(0, 7).forEach(([agentName, sum]) => {
                        // Bitta qatorda agent nomi va summasi (3 xonali format)
                        exampleMessage += `<code>${agentName}: ${sum.toLocaleString('ru-RU')}</code>\n`;
                    });
                    if (sortedAgents.length > 7) {
                        exampleMessage += `<code>...</code>\n`;
                    }
                } else {
                    // Agar agent ustuni bo'lmasa, standart namunani ko'rsatish
                    log.warn(`[CASHIER] [BUILD_FULL_EXAMPLE] SET so'rov uchun agent ustuni topilmadi yoki ma'lumotlar bo'sh: excelData=${Array.isArray(excelData) ? excelData.length : 'not array'}, excelColumns=${JSON.stringify(excelColumns)}`);
                    exampleMessage += '💰 <b>Umumiy summa:</b>\n';
                    exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
                    exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
                    exampleMessage += '<code>Agent1: 200000</code>\n';
                    exampleMessage += '<code>Agent2: 300000</code>\n';
                    exampleMessage += '<code>Agent3: 150000</code>\n';
                }
            } catch (error) {
                log.error(`[CASHIER] [BUILD_FULL_EXAMPLE] SET so'rov namunasi yaratishda xatolik: ${error.message}`, error);
                // Xatolik bo'lsa, standart namunani ko'rsatish
                exampleMessage += '💰 <b>Umumiy summa:</b>\n';
                exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
                exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
                exampleMessage += '<code>Agent1: 200000</code>\n';
                exampleMessage += '<code>Agent2: 300000</code>\n';
                exampleMessage += '<code>Agent3: 150000</code>\n';
            }
        } else {
            // Oddiy so'rov: standart namunani ko'rsatish
            log.info(`[CASHIER] [BUILD_FULL_EXAMPLE] Oddiy so'rov yoki SET so'rov emas: request=${!!request}, type=${request?.type}, hasExcelData=${!!request?.excel_data}`);
            exampleMessage += '💰 <b>Umumiy summa:</b>\n';
            exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
            exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
            exampleMessage += '<code>Agent1: 200000</code>\n';
            exampleMessage += '<code>Agent2: 300000</code>\n';
            exampleMessage += '<code>Agent3: 150000</code>\n';
        }
        
        exampleMessage += '\n📎 <b>Excel fayl:</b> Excel fayl yuborish\n\n';
        exampleMessage += '⚠️ Tizim avtomatik tanib oladi.';
        
        log.info(`[CASHIER] [BUILD_FULL_EXAMPLE] To'liq namunani yaratildi: ${exampleMessage.length} chars`);
        return exampleMessage;
    } catch (error) {
        log.error(`[CASHIER] [BUILD_FULL_EXAMPLE] Namuna yaratishda xatolik: ${error.message}`, error);
        // Xatolik bo'lsa, standart namunani ko'rsatish
        let exampleMessage = '📊 <b>Qarzdorlik ma\'lumotlarini kiriting</b>\n\n';
        exampleMessage += '📝 <b>Namuna:</b>\n\n';
        exampleMessage += '💰 <b>Umumiy summa:</b>\n';
        exampleMessage += '<code>500000</code> yoki <code>1 500 000</code>\n\n';
        exampleMessage += '📋 <b>Agent bo\'yicha:</b>\n';
        exampleMessage += '<code>Agent1: 200000</code>\n';
        exampleMessage += '<code>Agent2: 300000</code>\n';
        exampleMessage += '<code>Agent3: 150000</code>\n';
        exampleMessage += '\n📎 <b>Excel fayl:</b> Excel fayl yuborish\n\n';
        exampleMessage += '⚠️ Tizim avtomatik tanib oladi.';
        return exampleMessage;
    }
}

/**
 * Namuna xabari yaratish (oddiy yoki SET bo'yicha) - faqat namunani qaytaradi
 */
async function buildExampleMessage(requestId, svrName) {
    try {
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        log.info(`[CASHIER] [BUILD_EXAMPLE] buildExampleMessage chaqirildi: requestId=${requestId}, request=${!!request}, type=${request?.type}, hasExcelData=${!!request?.excel_data}`);
        
        if (request && request.type === 'SET' && request.excel_data) {
            // SET so'rov: real ma'lumotlar bilan namunani ko'rsatish
            try {
                let excelData = request.excel_data;
                let excelHeaders = request.excel_headers;
                let excelColumns = request.excel_columns;
                
                if (typeof excelData === 'string' && excelData) {
                    excelData = JSON.parse(excelData);
                }
                if (typeof excelHeaders === 'string' && excelHeaders) {
                    excelHeaders = JSON.parse(excelHeaders);
                }
                if (typeof excelColumns === 'string' && excelColumns) {
                    excelColumns = JSON.parse(excelColumns);
                }
                
                log.info(`[CASHIER] [BUILD_EXAMPLE] Parsed data: excelData=${Array.isArray(excelData) ? excelData.length : 'not array'}, excelColumns=${JSON.stringify(excelColumns)}, agentColumn=${excelColumns?.agent}`);
                
                // Agent bo'yicha guruhlash
                if (excelData && Array.isArray(excelData) && excelData.length > 0 && excelColumns && excelColumns.agent !== undefined && excelColumns.agent !== null) {
                    const agentMap = new Map();
                    const agentHeader = excelHeaders && excelHeaders[excelColumns.agent] ? excelHeaders[excelColumns.agent] : 'Agent';
                    const summaHeader = excelHeaders && excelHeaders[excelColumns.summa] ? excelHeaders[excelColumns.summa] : 'Summa';
                    
                    log.info(`[CASHIER] [BUILD_EXAMPLE] Headers: agentHeader=${agentHeader}, summaHeader=${summaHeader}`);
                    
                    excelData.forEach(row => {
                        const agentName = row[agentHeader] !== undefined ? String(row[agentHeader]).trim() : 'Noma\'lum';
                        const summaValue = row[summaHeader] !== undefined 
                            ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                            : 0;
                        
                        if (!agentMap.has(agentName)) {
                            agentMap.set(agentName, 0);
                        }
                        agentMap.set(agentName, agentMap.get(agentName) + (isNaN(summaValue) ? 0 : Math.abs(summaValue)));
                    });
                    
                    log.info(`[CASHIER] [BUILD_EXAMPLE] Agent map created: ${agentMap.size} agents`);
                    
                    // Real namunani ko'rsatish (to'liq format)
                    let example = '💰 <b>Umumiy summa:</b>\n';
                    const totalSum = Array.from(agentMap.values()).reduce((sum, val) => sum + val, 0);
                    example += `<code>${totalSum.toLocaleString('ru-RU')}</code>\n\n`;
                    
                    example += '📋 <b>Agent bo\'yicha:</b>\n';
                    const sortedAgents = Array.from(agentMap.entries()).sort((a, b) => b[1] - a[1]);
                    sortedAgents.slice(0, 7).forEach(([agentName, sum]) => {
                        // Bitta qatorda agent nomi va summasi (3 xonali format)
                        example += `<code>${agentName}: ${sum.toLocaleString('ru-RU')}</code>\n`;
                    });
                    if (sortedAgents.length > 7) {
                        example += `<code>...</code>\n`;
                    }
                    
                    log.info(`[CASHIER] [BUILD_EXAMPLE] Real example created for SET request: ${example.length} chars`);
                    return example;
                } else {
                    // Agar agent ustuni bo'lmasa, standart namunani ko'rsatish
                    log.warn(`[CASHIER] [BUILD_EXAMPLE] SET so'rov uchun agent ustuni topilmadi yoki ma'lumotlar bo'sh: excelData=${Array.isArray(excelData) ? excelData.length : 'not array'}, excelColumns=${JSON.stringify(excelColumns)}`);
                    // Standart namunani qaytarish (keyinchalik)
                }
            } catch (error) {
                log.error(`[CASHIER] [BUILD_EXAMPLE] SET so'rov namunasi yaratishda xatolik: ${error.message}`, error);
            }
        } else {
            log.info(`[CASHIER] [BUILD_EXAMPLE] Oddiy so'rov yoki SET so'rov emas: request=${!!request}, type=${request?.type}, hasExcelData=${!!request?.excel_data}`);
        }
        
        // Oddiy so'rov: standart namunani ko'rsatish
        log.info(`[CASHIER] [BUILD_EXAMPLE] Standart namunani qaytarish`);
        return '💰 <b>Umumiy summa:</b>\n' +
               '<code>500000</code> yoki <code>1 500 000</code>\n\n' +
               '📋 <b>Agent bo\'yicha:</b>\n' +
               '<code>Agent1: 200000</code>\n' +
               '<code>Agent2: 300000</code>\n' +
               '<code>Agent3: 150000</code>\n';
    } catch (error) {
        log.error(`[CASHIER] [BUILD_EXAMPLE] Namuna yaratishda xatolik: ${error.message}`, error);
        return '💰 <b>Umumiy summa:</b>\n' +
               '<code>500000</code> yoki <code>1 500 000</code>\n\n' +
               '📋 <b>Agent bo\'yicha:</b>\n' +
               '<code>Agent1: 200000</code>\n' +
               '<code>Agent2: 300000</code>\n' +
               '<code>Agent3: 150000</code>\n';
    }
}

/**
 * Xatolik xabarlarini tozalash (chat to'lib ketmasligi uchun)
 */
async function cleanupErrorMessages(chatId, userId, currentMessageId) {
    try {
        const bot = getBot();
        if (!bot) return;
        
        // State'dan oldingi xatolik xabari ID'sini olish
        const stateManager = require('../../unified/stateManager.js');
        const state = stateManager.getUserState(userId);
        
        if (state && state.data && state.data.last_error_message_id) {
            const lastErrorId = state.data.last_error_message_id;
            // Eski xatolik xabarni o'chirish
            try {
                await bot.deleteMessage(chatId, lastErrorId);
                log.info(`[CASHIER] [CLEANUP_ERROR] Eski xatolik xabari o'chirildi: messageId=${lastErrorId}`);
            } catch (deleteError) {
                // Xabar allaqachon o'chirilgan bo'lishi mumkin
                log.debug(`[CASHIER] [CLEANUP_ERROR] Eski xatolik xabari o'chirilmadi (ehtimol allaqachon o'chirilgan): messageId=${lastErrorId}, error=${deleteError.message}`);
            }
        }
        
        // Yangi xatolik xabari ID'sini state'ga saqlash
        if (state && state.data) {
            state.data.last_error_message_id = currentMessageId;
            stateManager.updateUserState(userId, state.state, state.data);
        }
    } catch (error) {
        log.error(`[CASHIER] [CLEANUP_ERROR] Xatolik xabarlarini tozalashda xatolik: ${error.message}`);
    }
}

/**
 * Agent nomini nusxalash
 */
async function handleCopyAgent(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // Callback data format: cashier_copy_agent_{requestId}_{index}
        const parts = data.split('_');
        if (parts.length >= 5) {
            const requestId = parseInt(parts[3]);
            const agentIndex = parseInt(parts[4]);
            
            // Database'dan so'rovni olish
            const request = await db('debt_requests')
                .where('id', requestId)
                .first();
            
            if (!request) {
                await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
                return;
            }
            
            // Agent nomlarini xabardan olish (xabarda agent ro'yxati ko'rsatilgan)
            // Xabarni o'qish va agent nomlarini parse qilish
            let agentName = null;
            
            // Agar SET so'rov bo'lsa va Excel ma'lumotlari bo'lsa, agent nomlarini Excel'dan olish
            if (request.type === 'SET' && request.excel_data && request.excel_columns && request.excel_columns.agent !== undefined) {
                try {
                    let excelData = request.excel_data;
                    let excelHeaders = request.excel_headers;
                    let excelColumns = request.excel_columns;
                    
                    if (typeof excelData === 'string' && excelData) {
                        excelData = JSON.parse(excelData);
                    }
                    if (typeof excelHeaders === 'string' && excelHeaders) {
                        excelHeaders = JSON.parse(excelHeaders);
                    }
                    if (typeof excelColumns === 'string' && excelColumns) {
                        excelColumns = JSON.parse(excelColumns);
                    }
                    
                    // Agent bo'yicha guruhlash va summa bo'yicha tartiblash (xuddi showRequestToCashier'dagi kabi)
                    const agentMap = new Map();
                    const agentHeader = excelHeaders && excelHeaders[excelColumns.agent] ? excelHeaders[excelColumns.agent] : 'Agent';
                    const summaHeader = excelHeaders && excelHeaders[excelColumns.summa] ? excelHeaders[excelColumns.summa] : 'Summa';
                    
                    if (excelData && Array.isArray(excelData)) {
                        excelData.forEach(row => {
                            const agentNameFromRow = row[agentHeader] !== undefined ? String(row[agentHeader]).trim() : 'Noma\'lum';
                            const summaValue = row[summaHeader] !== undefined 
                                ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                                : 0;
                            
                            if (!agentMap.has(agentNameFromRow)) {
                                agentMap.set(agentNameFromRow, 0);
                            }
                            agentMap.set(agentNameFromRow, agentMap.get(agentNameFromRow) + (isNaN(summaValue) ? 0 : Math.abs(summaValue)));
                        });
                    }
                    
                    // Summa bo'yicha tartiblash (eng kattadan kichigiga) - xuddi showRequestToCashier'dagi kabi
                    const sortedAgents = Array.from(agentMap.entries()).sort((a, b) => b[1] - a[1]);
                    
                    if (agentIndex >= 0 && agentIndex < sortedAgents.length) {
                        agentName = sortedAgents[agentIndex][0]; // [agentName, sum]
                    }
                } catch (parseError) {
                    log.error(`[CASHIER] [COPY_AGENT] Agent nomlarini parse qilishda xatolik: ${parseError.message}`);
                }
            }
            
            if (!agentName) {
                await bot.sendMessage(chatId, '❌ Agent nomi topilmadi.');
                return;
            }
            
            // Agent nomini clipboard'ga nusxalash (Telegram'da bu imkoniyat yo'q, shuning uchun foydalanuvchiga ko'rsatamiz)
            await bot.sendMessage(
                chatId,
                `📋 <b>Agent nomi:</b>\n<code>${agentName}</code>\n\n` +
                '⚠️ Ushbu matnni nusxalash uchun uzoq bosib turing va "Nusxalash" ni tanlang.',
                { parse_mode: 'HTML' }
            );
        }
    } catch (error) {
        log.error('Error handling copy agent:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Avtomatik tanib olish - text, document yoki photo
 */
async function handleAutoDetectDebtInput(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();
    const document = msg.document;
    const photo = msg.photo;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.state !== STATES.AUTO_DETECT_DEBT_INPUT) {
            return false;
        }
        
        // 1. Excel fayl (document)
        if (document) {
            const mimeType = document.mime_type || '';
            if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || 
                mimeType.includes('vnd.ms-excel') || mimeType.includes('vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
                document.file_name?.endsWith('.xlsx') || document.file_name?.endsWith('.xls')) {
                // Excel fayl deb tanib olindi
                stateManager.updateUserState(userId, STATES.UPLOAD_DEBT_EXCEL, state.data);
                // Excel fayl handler'ni chaqirish
                const excelHandlers = require('./debt-excel.js');
                const handled = await excelHandlers.handleDebtExcelFile(msg, bot);
                return handled;
            }
        }
        
        // 2. Rasm (photo)
        if (photo && photo.length > 0) {
            // Rasm deb tanib olindi
            stateManager.updateUserState(userId, STATES.UPLOAD_DEBT_IMAGE, state.data);
            // Rasm handler'ni chaqirish
            const debtHandlers = require('./debt.js');
            const handled = await debtHandlers.handleImageFile(msg, bot);
            return handled;
        }
        
        // 3. Text - umumiy summa yoki agent bo'yicha
        if (text) {
            // Agent bo'yicha formatni tekshirish: "Agent nomi: Summa" yoki "Agent nomi - Summa"
            const agentPattern = /^(.+?)[:\-]\s*([\d\s,]+)$/;
            const lines = text.split('\n').filter(line => line.trim());
            
            // Agar bir nechta qator bo'lsa va har biri "Agent: Summa" formatida bo'lsa
            if (lines.length > 1) {
                let allMatchAgentFormat = true;
                for (const line of lines) {
                    if (!agentPattern.test(line.trim())) {
                        allMatchAgentFormat = false;
                        break;
                    }
                }
                
                if (allMatchAgentFormat) {
                    // Agent bo'yicha format deb tanib olindi
                    stateManager.updateUserState(userId, STATES.ENTER_AGENT_DEBTS, state.data);
                    const handled = await handleAgentDebtsInput(msg, bot);
                    return handled;
                }
            }
            
            // Agar bir qator bo'lsa va "Agent: Summa" formatida bo'lsa
            if (lines.length === 1 && agentPattern.test(text.trim())) {
                // Agent bo'yicha format deb tanib olindi
                stateManager.updateUserState(userId, STATES.ENTER_AGENT_DEBTS, state.data);
                const handled = await handleAgentDebtsInput(msg, bot);
                return handled;
            }
            
            // Umumiy summa deb tanib olindi (faqat raqam)
            const amountStr = text.replace(/[^\d]/g, '');
            const amount = parseFloat(amountStr);
            if (!isNaN(amount) && amount > 0) {
                stateManager.updateUserState(userId, STATES.ENTER_TOTAL_AMOUNT, state.data);
                const handled = await handleTotalAmountInput(msg, bot);
                return handled;
            }
            
            // Format noto'g'ri - to'liq namunani yaratish (SET yoki oddiy)
            log.info(`[CASHIER] [AUTO_DETECT] Format noto'g'ri, to'liq namunani yaratish: requestId=${state.data?.request_id}, svrName=${state.data?.svr_name}`);
            
            // Eski xabarlarni o'chirish (birinchi namuna xabari va eski xatolik xabari)
            const messagesToDelete = [];
            
            // Birinchi namuna xabarini o'chirish (agar mavjud bo'lsa)
            if (state.data && state.data.first_example_message_id) {
                messagesToDelete.push(state.data.first_example_message_id);
            }
            
            // Eski xatolik xabarini o'chirish (agar mavjud bo'lsa)
            if (state.data && state.data.last_error_message_id) {
                messagesToDelete.push(state.data.last_error_message_id);
            }
            
            // Barcha eski xabarlarni o'chirish
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                    log.info(`[CASHIER] [AUTO_DETECT] Eski xabar o'chirildi: messageId=${messageId}`);
                } catch (deleteError) {
                    log.debug(`[CASHIER] [AUTO_DETECT] Eski xabar o'chirilmadi: messageId=${messageId}, error=${deleteError.message}`);
                }
            }
            
            // To'liq namunani yaratish (birinchi namuna xabari kabi)
            const fullExampleMessage = await buildFullExampleMessage(state.data.request_id, state.data.svr_name);
            log.info(`[CASHIER] [AUTO_DETECT] To'liq namunani yaratildi: length=${fullExampleMessage.length}`);
            
            // Xatolik xabari yuborish (to'liq formatda)
            const errorMsg = await bot.sendMessage(
                chatId,
                '❌ <b>Noto\'g\'ri format.</b>\n\n' + fullExampleMessage,
                { parse_mode: 'HTML' }
            );
            
            log.info(`[CASHIER] [AUTO_DETECT] Xatolik xabari yuborildi: messageId=${errorMsg.message_id}`);
            
            // Xatolik xabari ID'sini saqlash
            if (state.data) {
                state.data.last_error_message_id = errorMsg.message_id;
                stateManager.updateUserState(userId, state.state, state.data);
            }
            
            return true;
        }
        
        return false;
    } catch (error) {
        log.error('Error handling auto detect debt input:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
        return true;
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
        
        // ✅ MUHIM: "Qarzi bor" bosilganda yuborilgan xabarlarni tozalash
        // Agar state mavjud bo'lsa va "Qarzi bor" bosilgan bo'lsa, namuna va xatolik xabarlarini o'chirish
        const currentState = stateManager.getUserState(userId);
        if (currentState && currentState.state === STATES.AUTO_DETECT_DEBT_INPUT && currentState.data && currentState.data.request_id === requestId) {
            const messagesToDelete = [];
            
            // Birinchi namuna xabarini o'chirish
            if (currentState.data.first_example_message_id) {
                messagesToDelete.push(currentState.data.first_example_message_id);
            }
            
            // Xatolik xabarini o'chirish
            if (currentState.data.last_error_message_id) {
                messagesToDelete.push(currentState.data.last_error_message_id);
            }
            
            // Barcha eski xabarlarni o'chirish
            const bot = getBot();
            if (bot) {
                for (const messageId of messagesToDelete) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        log.info(`[CASHIER] [SEND_DEBT_RESPONSE] [CLEANUP] Eski xabar o'chirildi: messageId=${messageId}`);
                    } catch (deleteError) {
                        log.debug(`[CASHIER] [SEND_DEBT_RESPONSE] [CLEANUP] Eski xabar o'chirilmadi: messageId=${messageId}, error=${deleteError.message}`);
                    }
                }
            }
            
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] [CLEANUP] ${messagesToDelete.length} ta xabar o'chirildi`);
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
        // MUHIM: "Qarzi bor" javobida va teskari jarayon xabarlarida har doim Telegraph link ishlatilishi kerak
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
                    isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                });
                
                if (!telegraphUrl) {
                    log.warn(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${requestId}`);
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
                            isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                        });
                    } catch (retryError) {
                        log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${requestId}, error=${retryError.message}`);
                    }
                }
            } catch (telegraphError) {
                log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda xatolik: requestId=${requestId}, error=${telegraphError.message}`);
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
                        isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                    });
                } catch (retryError) {
                    log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${requestId}, error=${retryError.message}`);
                }
            }
        }
        
        // Solishtirish natijasini tekshirish (FAQAT SET so'rovlar uchun)
        const comparisonResult = debtData.comparison_result;
        const isSetRequest = request.type === 'SET';
        const hasDifferences = isSetRequest && comparisonResult && comparisonResult.canCompare && !comparisonResult.isIdentical && comparisonResult.differences && comparisonResult.differences.length > 0;
        const isIdentical = isSetRequest && comparisonResult && comparisonResult.canCompare && comparisonResult.isIdentical;
        
        // SET so'rovlar uchun: Agar farq bo'lsa va farqi ko'p bo'lsa (totalDifference > 0), teskari jarayon
        if (isSetRequest && hasDifferences && comparisonResult.totalDifference > 0) {
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] SET so'rovda farq topildi va teskari jarayon boshlanmoqda: requestId=${requestId}, totalDifference=${comparisonResult.totalDifference}, inputType=${debtData.input_type}`);
            
            // Farqlar uchun Telegraph sahifasini yaratish (input_type bo'yicha)
            let differencesTelegraphUrl = null;
            if (debtData.input_type === 'agent' && comparisonResult.differences && comparisonResult.differences.length > 0) {
                // Agent bo'yicha: faqat farq bergan agentlar
                try {
                    const { createDifferencesPage } = require('../../../utils/telegraph.js');
                    differencesTelegraphUrl = await createDifferencesPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        differences: comparisonResult.differences,
                        input_type: 'agent' // Agent bo'yicha farqlar
                    });
                    log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Agent bo'yicha farqlar sahifasi yaratildi: URL=${differencesTelegraphUrl}`);
                } catch (error) {
                    log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Agent bo'yicha farqlar sahifasini yaratishda xatolik: ${error.message}`);
                }
            } else if (debtData.input_type === 'total') {
                // Umumiy summa: SVR bo'yicha farq
                try {
                    const { createDifferencesPage } = require('../../../utils/telegraph.js');
                    differencesTelegraphUrl = await createDifferencesPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        differences: [{
                            type: 'total',
                            svr_name: request.svr_name,
                            original_summa: request.excel_total || 0,
                            new_summa: debtData.total_amount || 0,
                            difference: comparisonResult.totalDifference
                        }],
                        input_type: 'total' // Umumiy summa bo'yicha farq
                    });
                    log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Umumiy summa bo'yicha farqlar sahifasi yaratildi: URL=${differencesTelegraphUrl}`);
                } catch (error) {
                    log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Umumiy summa bo'yicha farqlar sahifasini yaratishda xatolik: ${error.message}`);
                }
            }
            
            // Menejerga xabar yuborish (tasdiqlanganlar va qaytarilgan holatlar bilan)
            const manager = await db('users').where('id', request.created_by).first();
            if (manager && manager.telegram_chat_id) {
                // ✅ formatRequestMessageWithApprovals ishlatish (tasdiqlanganlar va qaytarilgan holatlar bilan)
                const { formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
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
                    
                    let reversedBy = 'Kassir';
                    if (reversedApproval) {
                        if (reversedApproval.approval_type === 'cashier') {
                            reversedBy = 'Kassir';
                        } else if (reversedApproval.approval_type === 'operator') {
                            reversedBy = 'Operator';
                        }
                    }
                    
                    let reverseMessage = `⚠️ <b>Teskari jarayon</b>\n\n` +
                        `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                    
                    // Telegraph link qo'shish (farqlar ro'yxati bilan) - faqat farqlar sahifasi
                    if (differencesTelegraphUrl) {
                        reverseMessage += `🔗 <a href="${differencesTelegraphUrl}">📊 Farqlar ro'yxati:</a>\n\n`;
                    }
                    
                    // Tasdiqlanganlar va qaytarilgan holatlar (debtData bilan)
                    const approvalMessage = await formatRequestMessageWithApprovals(fullRequest, db, 'manager', debtData);
                    reverseMessage += approvalMessage;
                
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
                            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] ✅ "So'rov muvaffaqiyatli yaratildi!" xabari "Teskari jarayon" formatiga o'zgartirildi: requestId=${requestId}, messageId=${fullRequest.preview_message_id}`);
                        } catch (updateError) {
                            log.warn(`[CASHIER] [SEND_DEBT_RESPONSE] ⚠️ "So'rov muvaffaqiyatli yaratildi!" xabarini yangilashda xatolik: requestId=${requestId}, error=${updateError.message}`);
                            // Xatolik bo'lsa, yangi xabar sifatida yuborish
                await bot.sendMessage(manager.telegram_chat_id, reverseMessage, { parse_mode: 'HTML' });
                            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Menejerga teskari jarayon xabari yangi xabar sifatida yuborildi: requestId=${requestId}, managerId=${manager.id}`);
            }
                    } else {
                        // Preview message ID yo'q bo'lsa, yangi xabar sifatida yuborish
                        await bot.sendMessage(manager.telegram_chat_id, reverseMessage, { parse_mode: 'HTML' });
                        log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Menejerga teskari jarayon xabari yuborildi: requestId=${requestId}, managerId=${manager.id}, hasDifferencesTelegraphUrl=${!!differencesTelegraphUrl}`);
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
            const { formatRequestMessageWithApprovals } = require('../../../utils/messageTemplates.js');
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
                
                let reversedBy = 'Kassir';
                if (reversedApproval) {
                    if (reversedApproval.approval_type === 'cashier') {
                        reversedBy = 'Kassir';
                    } else if (reversedApproval.approval_type === 'operator') {
                        reversedBy = 'Operator';
                    }
                }
                
                let reverseMessage = `⚠️ <b>Teskari jarayon</b>\n\n` +
                    `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                
                // Telegraph link qo'shish (farqlar ro'yxati bilan) - faqat farqlar sahifasi
                if (differencesTelegraphUrl) {
                    reverseMessage += `🔗 <a href="${differencesTelegraphUrl}">📊 Farqlar ro'yxati:</a>\n\n`;
                }
                
                // Rahbarlar guruhiga yuborish
            if (leadersGroup) {
                    // Tasdiqlanganlar va qaytarilgan holatlar (rahbarlar uchun - 'leader' roli)
                    const approvalMessageForLeaders = await formatRequestMessageWithApprovals(fullRequest, db, 'leader', debtData);
                    let reverseMessageForLeaders = `⚠️ <b>Teskari jarayon</b>\n\n` +
                        `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                    
                    // ✅ Telegraph link qo'shish (farqlar ro'yxati bilan) - faqat farqlar sahifasi
                    if (differencesTelegraphUrl) {
                        reverseMessageForLeaders += `🔗 <a href="${differencesTelegraphUrl}">📊 Farqlar ro'yxati:</a>\n\n`;
                    }
                    reverseMessageForLeaders += approvalMessageForLeaders;
                
                const bot = getBot();
                    await bot.sendMessage(leadersGroup.telegram_group_id, reverseMessageForLeaders, { parse_mode: 'HTML' });
                    log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Rahbarlar guruhiga teskari jarayon xabari yuborildi: requestId=${requestId}, groupId=${leadersGroup.telegram_group_id}, hasDifferencesTelegraphUrl=${!!differencesTelegraphUrl}`);
                }
                
                // Final guruhga yuborish
                if (finalGroup) {
                    // ✅ Final guruh uchun 'final' roli bilan chaqirish (agent ro'yxati yoki link)
                    const approvalMessageForFinal = await formatRequestMessageWithApprovals(fullRequest, db, 'final', debtData);
                    let reverseMessageForFinal = `⚠️ <b>Teskari jarayon</b>\n\n` +
                        `${reversedBy} tomonidan yuborilgan Excel ma'lumotlari so'rovdagi ma'lumotlar bilan farq qiladi.\n\n`;
                    
                    // ✅ Telegraph link qo'shish (faqat total bo'lsa, yoki farqlar sahifasi)
                    if (differencesTelegraphUrl) {
                        reverseMessageForFinal += `🔗 <a href="${differencesTelegraphUrl}">📊 Farqlar ro'yxati:</a>\n\n`;
                    }
                    reverseMessageForFinal += approvalMessageForFinal;
                    
                    const bot = getBot();
                    await bot.sendMessage(finalGroup.telegram_group_id, reverseMessageForFinal, { parse_mode: 'HTML' });
                    log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Final guruhga teskari jarayon xabari yuborildi: requestId=${requestId}, groupId=${finalGroup.telegram_group_id}, hasDifferencesTelegraphUrl=${!!differencesTelegraphUrl}`);
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
            
            // Tasdiqlashni log qilish (solishtirish ma'lumotlari bilan)
            await logApproval(requestId, user.id, 'cashier', 'reversed', {
                excel_file_path: debtData.excel_file_path,
                image_file_path: debtData.image_file_path,
                total_difference: comparisonResult.totalDifference,
                differences_count: comparisonResult.differences.length,
                comparison_result: comparisonResult
            });
            
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Teskari jarayon yakunlandi: requestId=${requestId}, cashierId=${user.id}`);
            return; // Teskari jarayon - operatorga yuborilmaydi
        }
        
        // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa va teskari jarayon bo'lmasa)
        // MUHIM: "Qarzi bor" javobida har doim Telegraph link ishlatilishi kerak
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
                    isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                });
                
                if (!telegraphUrl) {
                    log.warn(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${requestId}`);
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
                            isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                        });
                    } catch (retryError) {
                        log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${requestId}, error=${retryError.message}`);
                    }
                }
            } catch (telegraphError) {
                log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda xatolik: requestId=${requestId}, error=${telegraphError.message}`);
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
                        isForCashier: false // ✅ Hammaga bir xil: klient bo'yicha format
                    });
                } catch (retryError) {
                    log.error(`[CASHIER] [SEND_DEBT_RESPONSE] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${requestId}, error=${retryError.message}`);
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
            telegraph_url: telegraphUrl,
            is_for_cashier: true // ✅ Kassir uchun xabarda agent ro'yxati ko'rsatish
        });
        
        // SET so'rovlar uchun: Agar bir xil bo'lsa, teskari jarayon xabari yuborilmaydi
        // Agar bir xil bo'lsa, kassir "Tasdiqlash" tugmasini bosishi kerak (handleCashierApproval chaqiriladi)
        if (isSetRequest && isIdentical) {
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] SET so'rovda ma'lumotlar bir xil, teskari jarayon xabari yuborilmaydi: requestId=${requestId}`);
            log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Kassir "Tasdiqlash" tugmasini bosishi kerak (handleCashierApproval chaqiriladi)`);
            // Bir xil bo'lsa, teskari jarayon xabari yuborilmaydi
            // Kassir "Tasdiqlash" tugmasini bosishi kerak
            return;
        }
        
        // QARDIKLIK JAVOBI HAR DOIM TESKARI JARAYON - menejerga va rahbarlarga yuboriladi
        // Operatorga yuborilmaydi (faqat tasdiqlash operatorga yuboriladi)
        const recipients = [];
        
        // Menejerga xabar yuborish (ODDIY va SET so'rovlar uchun)
        const manager = await db('users').where('id', request.created_by).first();
        if (manager && manager.telegram_chat_id) {
            recipients.push({
                id: manager.telegram_chat_id,
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
        const bot = getBot();
        for (const recipient of recipients) {
            try {
                await bot.sendMessage(recipient.id, debtMessage, {
                    parse_mode: 'HTML'
                });
                log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Qardorlik javobi yuborildi: requestId=${requestId}, recipient=${recipient.role}, recipientId=${recipient.id}`);
            } catch (error) {
                log.error(`Error sending debt response to ${recipient.role}:`, error);
            }
        }
        
        // Status yangilash - qardorlik topildi, teskari jarayon
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'DEBT_FOUND_BY_CASHIER',
                current_approver_id: null,
                current_approver_type: null
            });
        
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
        
        await logApproval(requestId, user.id, 'cashier', 'debt_marked', logData);
        
        log.info(`[CASHIER] [SEND_DEBT_RESPONSE] Qardorlik javobi yuborildi (teskari jarayon): requestId=${requestId}, cashierId=${user.id}, requestType=${request.type}`);
        
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

/**
 * Kutilinayotgan so'rovlarni ko'rsatish (knopka bosilganda)
 */
async function handleShowPendingRequests(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // ✅ MUHIM: showPendingCashierRequests ni chaqirish (to'liq logika bilan)
        // Bu funksiya avval faol so'rovni, keyin eslatmalarni, keyin kutilayotgan so'rovlarni tekshiradi
        await showPendingCashierRequests(userId, chatId);
    } catch (error) {
        log.error('Error showing pending requests:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
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
    handleCashierDebtTotal,
    handleCashierDebtAgent,
    handleCashierDebtExcel,
    handleTotalAmountInput,
    handleAgentDebtsInput,
    handleAutoDetectDebtInput, // ✅ Avtomatik tanib olish
    handleCopyAgent, // ✅ Agent nomini nusxalash
    sendDebtResponse,
    sendRequestToOperator,
    handleShowPendingRequests,
    STATES
};

