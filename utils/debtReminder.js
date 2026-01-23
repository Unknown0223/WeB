// utils/debtReminder.js

const { getBot } = require('./bot.js');
const { db, isPostgres } = require('../db.js');
const { createLogger } = require('./logger.js');
const { formatNormalRequestMessage, formatSetRequestMessage } = require('./messageTemplates.js');

const log = createLogger('DEBT_REMINDER');

// Reminder interval (daqiqa)
let reminderInterval = 15; // Default
let reminderMaxCount = 3; // Default

// Reminder'lar ro'yxati
const reminders = new Map(); // requestId -> { count, lastSent, interval }
// Recipient-based reminder tracking (summary uchun)
const recipientReminders = new Map(); // "recipientType:recipientId" -> { lastSent, count, lastSummaryMessageId }
// Summary yuborish jarayonini boshqarish (takrorlanishni oldini olish)
const sendingSummary = new Set(); // "recipientType:recipientId" -> sending process flag

// Reminder sozlamalarini yuklash
async function loadReminderSettings() {
    let retries = 5;
    let lastError = null;
    const initialDelay = 5000; // 5 seconds initial delay - database initialization tugaguncha kutish
    
    await new Promise(resolve => setTimeout(resolve, initialDelay));
    
    while (retries > 0) {
        try {
            // Connection pool'ni test qilish
            try {
                await db.raw('SELECT 1');
            } catch (testError) {
                if (retries > 1) {
                    const delay = Math.min(2000 * (6 - retries), 10000); // Exponential backoff
                    log.warn(`[DEBT_REMINDER] Connection test xatolik, ${delay}ms kutib qayta urinilmoqda...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    retries--;
                    continue;
                } else {
                    throw testError;
                }
            }
            
            // Avval debt_settings jadvali mavjudligini tekshirish
            const hasDebtSettingsTable = await db.schema.hasTable('debt_settings');
            
            let intervalLoaded = false;
            let countLoaded = false;
            
            if (hasDebtSettingsTable) {
                // Avval debt_settings jadvalidan qidirish
                const intervalSetting = await db('debt_settings').where('key', 'debt_reminder_interval').first();
                const countSetting = await db('debt_settings').where('key', 'debt_reminder_max_count').first();
                
                if (intervalSetting) {
                    reminderInterval = parseInt(intervalSetting.value) || 30;
                    intervalLoaded = true;
                }
                if (countSetting) {
                    reminderMaxCount = parseInt(countSetting.value) || 3;
                    countLoaded = true;
                }
            }
            
            // Agar debt_settings jadvalidan topilmasa, eski settings jadvalidan qidirish (backward compatibility)
            if (!intervalLoaded || !countLoaded) {
                const hasSettingsTable = await db.schema.hasTable('settings');
                if (hasSettingsTable) {
                    if (!intervalLoaded) {
                        const intervalSetting = await db('settings').where('key', 'debt_reminder_interval_minutes').first();
                        if (intervalSetting) {
                            reminderInterval = parseInt(intervalSetting.value) || 30;
                        }
                    }
                    if (!countLoaded) {
                        const countSetting = await db('settings').where('key', 'debt_reminder_max_count').first();
                        if (countSetting) {
                            reminderMaxCount = parseInt(countSetting.value) || 3;
                        }
                    }
                }
            }
            
            // Muvaffaqiyatli bo'lsa, retry loop'ni to'xtatish
            retries = 0;
            break;
        } catch (error) {
            lastError = error;
            retries--;
            
            // Connection pool timeout yoki lock xatoliklari uchun retry
            const isRetryableError = 
                error.message?.includes('Timeout acquiring a connection') ||
                error.message?.includes('pool is probably full') ||
                error.message?.includes('ECONNREFUSED') ||
                error.code === 'ECONNREFUSED' ||
                error.code === 'SQLITE_ERROR';
            
            // Faqat SQLITE_ERROR: no such table xatosini e'tiborsiz qoldiramiz
            if (error.code === 'SQLITE_ERROR' && error.message?.includes('no such table')) {
                // Migration hali ishlamagan bo'lishi mumkin, bu normal
                log.debug('[DEBT_REMINDER] Jadval topilmadi (migration hali ishlamagan bo\'lishi mumkin)');
                retries = 0;
                break;
            }
            
            if (isRetryableError && retries > 0) {
                // Exponential backoff - har safar kutish vaqti oshadi
                const delay = Math.min(2000 * (6 - retries), 10000); // 2s, 4s, 6s, 8s, 10s
                log.warn(`[DEBT_REMINDER] Retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${retries} qoldi)`);
                log.warn(`[DEBT_REMINDER] Xatolik: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Boshqa xatolik yoki retry'lar tugagan
                if (error.code !== 'SQLITE_ERROR' || !error.message?.includes('no such table')) {
                    log.error('Reminder sozlamalarini yuklashda xatolik:', error);
                }
                break;
            }
        }
    }
    
    if (lastError && retries === 0 && (lastError.code !== 'SQLITE_ERROR' || !lastError.message?.includes('no such table'))) {
        log.error('Reminder sozlamalarini yuklashda barcha retry urinishlari tugadi');
    }
}

// Reminder sozlamalarini yangilash (settings route'dan chaqiriladi)
function updateReminderSettings(interval, maxCount) {
    reminderInterval = interval || 15;
    reminderMaxCount = maxCount || 3;
    
    // Mavjud reminder'larni yangilash
    reminders.forEach((reminder, requestId) => {
        if (reminder.interval) {
            clearInterval(reminder.interval);
        }
        
        reminder.interval = setInterval(async () => {
            await checkAndSendReminder(requestId);
        }, reminderInterval * 60 * 1000);
    });
    
    // log.info(`Reminder sozlamalari yangilandi: interval=${reminderInterval}min, maxCount=${reminderMaxCount}`);
}

// Reminder'ni boshlash
function startReminder(requestId) {
    reminders.set(requestId, {
        count: 0,
        lastSent: null,
        interval: null
    });
    
    const reminder = reminders.get(requestId);
    reminder.interval = setInterval(async () => {
        await checkAndSendReminder(requestId);
    }, reminderInterval * 60 * 1000); // daqiqadan millisekundga
    
    // Reminder boshlandi (log olib tashlandi - server qayta ishga tushganda juda ko'p loglar chiqadi)
}

// Reminder'ni to'xtatish
function stopReminder(requestId) {
    const reminder = reminders.get(requestId);
    if (reminder && reminder.interval) {
        clearInterval(reminder.interval);
        reminders.delete(requestId);
        // log.info(`Reminder to'xtatildi: requestId=${requestId}`);
    }
}

// Reminder yuborish
async function checkAndSendReminder(requestId) {
    try {
        // log.info(`[REMINDER] Eslatma tekshirilmoqda: requestId=${requestId}`);
        
        const reminder = reminders.get(requestId);
        if (!reminder) {
            log.warn(`[REMINDER] Reminder topilmadi: requestId=${requestId}`);
            return;
        }
        
        // Max count tekshirish
        if (reminder.count >= reminderMaxCount) {
            // log.info(`[REMINDER] Max count yetib borgan: requestId=${requestId}, count=${reminder.count}/${reminderMaxCount}`);
            stopReminder(requestId);
            return;
        }
        
        const request = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
            .where('debt_requests.id', requestId)
            .first();
        
        if (!request) {
            log.warn(`[REMINDER] So'rov topilmadi: requestId=${requestId}`);
            stopReminder(requestId);
            return;
        }
        
        // log.info(`[REMINDER] So'rov topildi: requestId=${requestId}, requestUID=${request.request_uid}, status=${request.status}, brand=${request.brand_name}, branch=${request.branch_name}`);
        
        // Status tekshirish (faqat pending statuslar uchun)
        const pendingStatuses = [
            'PENDING_APPROVAL',
            'SET_PENDING',
            'APPROVED_BY_LEADER',
            'APPROVED_BY_CASHIER'
        ];
        
        if (!pendingStatuses.includes(request.status)) {
            // log.info(`[REMINDER] Status pending emas: requestId=${requestId}, status=${request.status}`);
            stopReminder(requestId);
            return;
        }
        
        // Kechikish vaqti hisoblash
        const createdDate = new Date(request.created_at);
        const now = new Date();
        const delayMinutes = Math.floor((now - createdDate) / (1000 * 60));
        const delayHours = Math.floor(delayMinutes / 60);
        const delayDays = Math.floor(delayHours / 24);
        
        let delayText = '';
        if (delayDays > 0) {
            delayText = `${delayDays} kun`;
        } else if (delayHours > 0) {
            delayText = `${delayHours} soat`;
        } else {
            delayText = `${delayMinutes} daqiqa`;
        }
        
        // Reminder xabari - "tasdiqlanmagan va kechikib ketilgan"
        let reminderHeader = `⚠️ <b>Tasdiqlanmagan va kechikib ketilgan</b>\n\n`;
        reminderHeader += `⏰ Kechikish: ${delayText}\n`;
        reminderHeader += `🔄 Eslatma: ${reminder.count + 1}/${reminderMaxCount}\n\n`;
        
        // Kimga yuborish va xabarni formatlash
        let recipients = [];
        const bot = getBot();
        
        if (request.status === 'SET_PENDING') {
            // Leaders Group'ga
            let leadersGroup = await db('debt_groups').where('group_type', 'leaders').where('is_active', true).first();
            if (!leadersGroup) {
                // Backward compatibility
                const leadersGroupId = await db('settings').where('key', 'debt_leaders_group_id').first();
                if (leadersGroupId && leadersGroupId.value) {
                    recipients.push({ 
                        type: 'group', 
                        id: parseInt(leadersGroupId.value),
                        role: 'leader'
                    });
                }
            } else {
                recipients.push({ 
                    type: 'group', 
                    id: leadersGroup.telegram_group_id,
                    role: 'leader'
                });
            }
        } else if (request.status === 'APPROVED_BY_LEADER') {
            // Kassirga - current_approver_id bo'yicha
            if (request.current_approver_id && request.current_approver_type === 'cashier') {
                const cashier = await db('users')
                    .where('id', request.current_approver_id)
                    .where('status', 'active')
                    .whereNotNull('telegram_chat_id')
                    .first();
                
                if (cashier && cashier.telegram_chat_id) {
                    recipients.push({ 
                        type: 'user', 
                        id: cashier.telegram_chat_id,
                        role: 'cashier',
                        user_id: cashier.id
                    });
                }
            } else {
                // Agar current_approver_id yo'q bo'lsa, barcha filialga biriktirilgan kassirlarga
                const cashiers = await db('debt_cashiers')
                    .join('users', 'debt_cashiers.user_id', 'users.id')
                    .where('debt_cashiers.branch_id', request.branch_id)
                    .where('debt_cashiers.is_active', true)
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_chat_id')
                    .select('users.id', 'users.telegram_chat_id');
                
                cashiers.forEach(cashier => {
                    recipients.push({ 
                        type: 'user', 
                        id: cashier.telegram_chat_id,
                        role: 'cashier',
                        user_id: cashier.id
                    });
                });
            }
        } else if (request.status === 'PENDING_APPROVAL' || request.status === 'APPROVED_BY_CASHIER') {
            // Cashier'larga - current_approver_id bo'yicha
            if (request.current_approver_id && request.current_approver_type === 'cashier') {
                const cashier = await db('users')
                    .where('id', request.current_approver_id)
                    .where('status', 'active')
                    .whereNotNull('telegram_chat_id')
                    .first();
                
                if (cashier && cashier.telegram_chat_id) {
                    recipients.push({ 
                        type: 'user', 
                        id: cashier.telegram_chat_id,
                        role: 'cashier',
                        user_id: cashier.id
                    });
                }
            } else {
                // Agar current_approver_id yo'q bo'lsa, barcha filialga biriktirilgan kassirlarga
                const cashiers = await db('debt_cashiers')
                    .join('users', 'debt_cashiers.user_id', 'users.id')
                    .where('debt_cashiers.branch_id', request.branch_id)
                    .where('debt_cashiers.is_active', true)
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_chat_id')
                    .select('users.id', 'users.telegram_chat_id');
                
                cashiers.forEach(cashier => {
                    recipients.push({ 
                        type: 'user', 
                        id: cashier.telegram_chat_id,
                        role: 'cashier',
                        user_id: cashier.id
                    });
                });
            }
            
            // Operatorlarga ham (APPROVED_BY_CASHIER bo'lsa)
            if (request.status === 'APPROVED_BY_CASHIER') {
                // Operatorlar guruhiga
                const operatorsGroup = await db('debt_groups')
                    .where('group_type', 'operators')
                    .where('is_active', true)
                    .first();
                
                if (operatorsGroup) {
                    recipients.push({ 
                        type: 'group', 
                        id: operatorsGroup.telegram_group_id,
                        role: 'operator'
                    });
                }
            }
        }
        
        // Summary formatda xabarni yuborish (yangi format)
        // Faqat bitta summary per recipient yuborish (takrorlanishni oldini olish)
        if (bot) {
            const recipientKeys = new Set(); // Takrorlanishni oldini olish
            for (const recipient of recipients) {
                // Recipient key yaratish (type:id)
                const recipientKey = `${recipient.type}:${recipient.id || recipient.user_id}`;
                
                // Agar bu recipient'ga allaqachon summary yuborilgan bo'lsa, o'tkazib yuborish
                if (recipientKeys.has(recipientKey)) {
                    continue;
                }
                
                // Agar boshqa requestId interval'da summary yuborilayotgan bo'lsa, o'tkazib yuborish
                if (sendingSummary.has(recipientKey)) {
                    // log.debug(`[REMINDER] Summary yuborish jarayonida, o'tkazib yuborilmoqda: recipient=${recipientKey}`);
                    continue;
                }
                
                // Recipient'ning oxirgi summary yuborilgan vaqtini tekshirish
                const lastSent = recipientReminders.get(recipientKey);
                const now = new Date();
                
                // Agar oxirgi summary reminderInterval*60*1000 ms dan oldin yuborilgan bo'lsa, yangi summary yuborish
                if (!lastSent || (now - lastSent.lastSent) >= (reminderInterval * 60 * 1000)) {
                    // Sending flag'ni qo'shish
                    sendingSummary.add(recipientKey);
                    
                    try {
                        // Operatorlar guruhida har bir operator uchun alohida eslatma yuborish
                        if (recipient.type === 'group' && recipient.role === 'operator') {
                            await sendOperatorGroupReminders(recipient.id, requestId, reminder.count + 1);
                        } else {
                            // Summary formatda xabar yuborish (ichida lastSummaryMessageId yangilanadi)
                            await sendSummaryReminder(recipient, requestId, reminder.count + 1);
                        }
                        
                        // Recipient tracking yangilash (lastSent va count)
                        const currentReminder = recipientReminders.get(recipientKey);
                        recipientReminders.set(recipientKey, {
                            ...currentReminder,
                            lastSent: now,
                            count: (lastSent?.count || 0) + 1
                        });
                        
                        recipientKeys.add(recipientKey);
                        // log.info(`[REMINDER] ✅ Summary eslatma yuborildi: requestId=${requestId}, recipient=${recipient.type}:${recipient.id}, role=${recipient.role}`);
                    } catch (error) {
                        log.error(`[REMINDER] Summary reminder yuborishda xatolik (${recipient.type}:${recipient.id}):`, error);
                    } finally {
                        // Sending flag'ni olib tashlash
                        sendingSummary.delete(recipientKey);
                    }
                } else {
                    // log.debug(`[REMINDER] Summary eslatma yaqinda yuborilgan, o'tkazib yuborilmoqda: recipient=${recipientKey}`);
                }
            }
        }
        
        // Counter yangilash
        reminder.count++;
        reminder.lastSent = new Date();
        
        // log.info(`[REMINDER] ✅ Eslatma jarayoni yakunlandi: requestId=${requestId}, count=${reminder.count}/${reminderMaxCount}, recipients=${recipients.length} ta`);
    } catch (error) {
        log.error('Reminder tekshirishda xatolik:', error);
    }
}

/**
 * Operatorlar guruhida har bir operator uchun alohida eslatma yuborish
 */
async function sendOperatorGroupReminders(groupId, requestId, reminderNumber) {
    const bot = getBot();
    if (!bot) {
        log.error(`[REMINDER] Bot topilmadi`);
        return;
    }
    
    try {
        // Operatorlar guruhidagi barcha operatorlarni olish
        const summary = await getRemindersSummary(groupId, 'group');
        
        if (!summary.users || summary.users.length === 0) {
            // log.debug(`[REMINDER] Operatorlar guruhida operatorlar topilmadi: groupId=${groupId}`);
            return;
        }
        
        // Har bir operator uchun alohida eslatma yuborish
        for (const operator of summary.users) {
            try {
                // Operatorning kutilayotgan eslatmalarini olish
                const operatorRequests = await getPendingRemindersForUser(operator.id, 'operator');
                
                if (operatorRequests.length === 0) {
                    continue; // Agar eslatmalar yo'q bo'lsa, o'tkazib yuborish
                }
                
                const operatorKey = `operator:${operator.id}:group:${groupId}`;
                const existingReminder = recipientReminders.get(operatorKey);
                
                let message = '';
                if (operator.telegram_username) {
                    message = `@${operator.telegram_username}\n\n⚠️ Sizda ${operatorRequests.length} ta eslatma bor`;
                } else {
                    message = `${operator.fullname || 'Operator'}\n\n⚠️ Sizda ${operatorRequests.length} ta eslatma bor`;
                }
                
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '➡️ Keyingi eslatmani ko\'rsatish', callback_data: 'reminder_show_next_operator' }]
                    ]
                };
                
                // ✅ MUHIM: Avval eski eslatma xabarlarini o'chirish
                // Agar eski summary xabar mavjud bo'lsa, uni yangilash yoki o'chirish
                if (existingReminder && existingReminder.lastSummaryMessageId) {
                    try {
                        // Avval yangilashga harakat qilish
                        await bot.editMessageText(message, {
                            chat_id: groupId,
                            message_id: existingReminder.lastSummaryMessageId,
                            reply_markup: keyboard,
                            parse_mode: 'HTML'
                        });
                        // Yangilash muvaffaqiyatli bo'lsa, davom etish
                        log.debug(`[REMINDER] Operator summary message updated: operatorId=${operator.id}, groupId=${groupId}, messageId=${existingReminder.lastSummaryMessageId}`);
                        continue;
                    } catch (editError) {
                        // "chat not found" xatoligini boshqarish
                        if (editError.code === 'ETELEGRAM' && editError.response && editError.response.body) {
                            const errorBody = editError.response.body;
                            if (errorBody.description && errorBody.description.includes('chat not found')) {
                                log.warn(`[REMINDER] Operator guruhi topilmadi yoki bot guruhdan chiqarilgan (operatorId=${operator.id}, groupId=${groupId}). Eslatma yuborilmadi.`);
                                return;
                            }
                        }
                        
                        // Agar yangilab bo'lmasa, eski xabarni o'chirishga harakat qilish
                        try {
                            await bot.deleteMessage(groupId, existingReminder.lastSummaryMessageId);
                            log.debug(`[REMINDER] Eski eslatma xabari o'chirildi: operatorId=${operator.id}, groupId=${groupId}, messageId=${existingReminder.lastSummaryMessageId}`);
                        } catch (deleteError) {
                            // "chat not found" xatoligini boshqarish
                            if (deleteError.code === 'ETELEGRAM' && deleteError.response && deleteError.response.body) {
                                const errorBody = deleteError.response.body;
                                if (errorBody.description && errorBody.description.includes('chat not found')) {
                                    log.warn(`[REMINDER] Operator guruhi topilmadi yoki bot guruhdan chiqarilgan (operatorId=${operator.id}, groupId=${groupId}). Eslatma yuborilmadi.`);
                                    return;
                                }
                            }
                            // Silent fail - xabar allaqachon o'chirilgan bo'lishi mumkin
                            log.debug(`[REMINDER] Eski eslatma xabari o'chirishda xatolik (ignored): ${deleteError.message}`);
                        }
                        
                        // messageTracker'dan ham o'chirish
                        try {
                            const { untrackMessage } = require('../bot/debt-approval/utils/messageTracker.js');
                            untrackMessage(groupId, existingReminder.lastSummaryMessageId);
                        } catch (untrackError) {
                            // Silent fail
                        }
                    }
                }
                
                    // Yangi xabar yuborish
                    const sentMessage = await bot.sendMessage(groupId, message, {
                        reply_markup: keyboard,
                        parse_mode: 'HTML'
                    });
                
                // Eslatma xabarlarini messageTracker'ga qo'shish
                const { trackMessage } = require('../bot/debt-approval/utils/messageTracker.js');
                trackMessage(groupId, sentMessage.message_id, 'reminder', true); // shouldCleanup=true - keyingi so'rov kelganda o'chirilishi kerak
                    
                    recipientReminders.set(operatorKey, {
                        lastSent: new Date(),
                        count: (existingReminder?.count || 0) + 1,
                        lastSummaryMessageId: sentMessage.message_id
                    });
                    
                    log.debug(`[REMINDER] Operator summary message sent: operatorId=${operator.id}, groupId=${groupId}, messageId=${sentMessage.message_id}`);
            } catch (error) {
                // "chat not found" xatoligini boshqarish
                if (error.code === 'ETELEGRAM' && error.response && error.response.body) {
                    const errorBody = error.response.body;
                    if (errorBody.description && errorBody.description.includes('chat not found')) {
                        log.warn(`[REMINDER] Operator guruhi topilmadi yoki bot guruhdan chiqarilgan (operatorId=${operator.id}, groupId=${groupId}). Eslatma yuborilmadi.`);
                        // Xatolikni log qilish, lekin dasturni to'xtatmaslik
                        return;
                    }
                }
                log.error(`[REMINDER] Operator reminder yuborishda xatolik (operatorId=${operator.id}, groupId=${groupId}):`, error);
            }
        }
    } catch (error) {
        log.error(`[REMINDER] sendOperatorGroupReminders xatolik:`, error);
        throw error;
    }
}

/**
 * Summary formatda eslatma yuborish
 */
async function sendSummaryReminder(recipient, requestId, reminderNumber) {
    const bot = getBot();
    if (!bot) {
        log.error(`[REMINDER] Bot topilmadi`);
        return;
    }
    
    try {
        let message = '';
        let keyboard = null;
        
        if (recipient.type === 'group') {
            // Guruh uchun summary
            const summary = await getRemindersSummary(recipient.id, 'group');
            
            if (summary.count === 0) {
                // Eslatmalar yo'q
                return;
            }
            
            if (recipient.role === 'leader') {
                // Rahbarlar guruhida: faqat umumiy son + "Barcha eslatmalarni ko'rsatish" knopkasi
                message = `⚠️ ${summary.count} ta eslatma bor`;
                
                keyboard = {
                    inline_keyboard: [
                        [{ text: '📋 Barcha eslatmalarni ko\'rsatish', callback_data: 'reminder_show_all_leaders' }]
                    ]
                };
            } else if (recipient.role === 'operator') {
                // Operatorlar guruhida: har bir operator uchun alohida eslatma yuborish
                // Bu funksiya endi chaqirilmaydi, chunki alohida funksiya ishlatiladi
                // Faqat fallback uchun qoldirilgan
                message = `⚠️ ${summary.count} ta eslatma bor`;
                keyboard = {
                    inline_keyboard: [
                        [{ text: '➡️ Keyingi eslatmani ko\'rsatish', callback_data: 'reminder_show_next_operator' }]
                    ]
                };
            }
        } else if (recipient.type === 'user') {
            // Shaxsiy chat uchun summary
            const summary = await getRemindersSummary(recipient.user_id, 'user');
            
            if (summary.count === 0) {
                // Eslatmalar yo'q
                return;
            }
            
            message = `⚠️ Sizda ${summary.count} ta eslatma bor`;
            
            if (recipient.role === 'cashier') {
                keyboard = {
                    inline_keyboard: [
                        [{ text: '➡️ Keyingi eslatmani ko\'rsatish', callback_data: 'reminder_show_next_cashier' }]
                    ]
                };
            } else if (recipient.role === 'operator') {
                keyboard = {
                    inline_keyboard: [
                        [{ text: '➡️ Keyingi eslatmani ko\'rsatish', callback_data: 'reminder_show_next_operator' }]
                    ]
                };
            } else if (recipient.role === 'leader') {
                keyboard = {
                    inline_keyboard: [
                        [{ text: '➡️ Keyingi eslatmani ko\'rsatish', callback_data: 'reminder_show_next_leader' }]
                    ]
                };
            }
        }
        
        if (message && keyboard) {
            // Recipient key yaratish
            const recipientKey = `${recipient.type}:${recipient.id || recipient.user_id}`;
            const existingReminder = recipientReminders.get(recipientKey);
            
            const chatId = recipient.id || recipient.user_id;
            
            // ✅ MUHIM: Avval eski eslatma xabarlarini o'chirish
            // Agar eski summary xabar mavjud bo'lsa, uni yangilash yoki o'chirish
            if (existingReminder && existingReminder.lastSummaryMessageId) {
                try {
                    // Avval yangilashga harakat qilish
                    await bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: existingReminder.lastSummaryMessageId,
                        reply_markup: keyboard,
                        parse_mode: 'HTML'
                    });
                    // Yangilash muvaffaqiyatli bo'lsa, davom etish
                    log.debug(`[REMINDER] Summary message updated: recipientKey=${recipientKey}, messageId=${existingReminder.lastSummaryMessageId}`);
                    return;
                } catch (editError) {
                    // Agar yangilab bo'lmasa, eski xabarni o'chirishga harakat qilish
                    try {
                        await bot.deleteMessage(chatId, existingReminder.lastSummaryMessageId);
                        log.debug(`[REMINDER] Eski eslatma xabari o'chirildi: recipientKey=${recipientKey}, messageId=${existingReminder.lastSummaryMessageId}`);
                    } catch (deleteError) {
                        // Silent fail - xabar allaqachon o'chirilgan bo'lishi mumkin
                        log.debug(`[REMINDER] Eski eslatma xabari o'chirishda xatolik (ignored): ${deleteError.message}`);
                    }
                    
                    // messageTracker'dan ham o'chirish
                    try {
                        const { untrackMessage } = require('../bot/debt-approval/utils/messageTracker.js');
                        untrackMessage(chatId, existingReminder.lastSummaryMessageId);
                    } catch (untrackError) {
                        // Silent fail
                    }
                }
            }
            
                // Yangi xabar yuborish
            const sentMessage = await bot.sendMessage(chatId, message, {
                    reply_markup: keyboard,
                    parse_mode: 'HTML'
                });
            
            // Eslatma xabarlarini messageTracker'ga qo'shish
            const { trackMessage } = require('../bot/debt-approval/utils/messageTracker.js');
            trackMessage(chatId, sentMessage.message_id, 'reminder', true); // shouldCleanup=true - keyingi so'rov kelganda o'chirilishi kerak
                
                // Recipient tracking yangilash
                recipientReminders.set(recipientKey, {
                    lastSent: new Date(),
                    count: (existingReminder?.count || 0) + 1,
                    lastSummaryMessageId: sentMessage.message_id
                });
        }
    } catch (error) {
        log.error(`[REMINDER] sendSummaryReminder xatolik:`, error);
        throw error;
    }
}

// Barcha pending requestlar uchun reminder boshlash
async function startRemindersForPendingRequests() {
    let retries = 5;
    let lastError = null;
    const initialDelay = 2000; // 2 seconds initial delay
    
    await new Promise(resolve => setTimeout(resolve, initialDelay));
    
    while (retries > 0) {
        try {
            // Connection pool'ni test qilish
            try {
                await db.raw('SELECT 1');
            } catch (testError) {
                if (retries > 1) {
                    const delay = Math.min(2000 * (6 - retries), 10000); // Exponential backoff
                    log.warn(`[DEBT_REMINDER] Connection test xatolik, ${delay}ms kutib qayta urinilmoqda...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    retries--;
                    continue;
                } else {
                    throw testError;
                }
            }
            
            const pendingRequests = await db('debt_requests')
                .whereIn('status', [
                    'PENDING_APPROVAL',
                    'SET_PENDING',
                    'APPROVED_BY_LEADER',
                'APPROVED_BY_CASHIER'
                ])
                .where('locked', false)
                .select('id')
                .limit(100); // Limit qo'shish - juda ko'p request bo'lmasligi uchun
            
            for (const req of pendingRequests) {
                if (!reminders.has(req.id)) {
                    startReminder(req.id);
                }
            }
            
            // Muvaffaqiyatli bo'lsa, retry loop'ni to'xtatish
            retries = 0;
            break;
        } catch (error) {
            lastError = error;
            retries--;
            
            const isRetryableError = 
                error.message?.includes('Timeout acquiring a connection') ||
                error.message?.includes('pool is probably full') ||
                error.message?.includes('ECONNREFUSED') ||
                error.code === 'ECONNREFUSED';
            
            if (isRetryableError && retries > 0) {
                const delay = Math.min(2000 * (6 - retries), 10000); // Exponential backoff
                log.warn(`[DEBT_REMINDER] Retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${retries} qoldi)`);
                log.warn(`[DEBT_REMINDER] Xatolik: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                log.error('Pending requestlar uchun reminder boshlashda xatolik:', error);
                break;
            }
        }
    }
    
    if (lastError && retries === 0) {
        log.error('Pending requestlar uchun reminder boshlashda barcha retry urinishlari tugadi');
    }
}

// Reminder sozlamalarini yangilash (settings route'dan chaqiriladi)
function updateReminderSettings(interval, maxCount) {
    reminderInterval = interval || 15;
    reminderMaxCount = maxCount || 3;
    
    // Mavjud reminder'larni yangilash
    reminders.forEach((reminder, requestId) => {
        if (reminder.interval) {
            clearInterval(reminder.interval);
        }
        
        reminder.interval = setInterval(async () => {
            await checkAndSendReminder(requestId);
        }, reminderInterval * 60 * 1000);
    });
    
    // log.info(`Reminder sozlamalari yangilandi: interval=${reminderInterval}min, maxCount=${reminderMaxCount}`);
}

// Initialization - server ishga tushganda uzoqroq delay (Railway: init va listen ketma-ket, pool bo'sh bo'lishi uchun)
setTimeout(() => {
    loadReminderSettings().then(() => {
        setTimeout(() => startRemindersForPendingRequests(), 5 * 60 * 1000);
    }).catch((error) => {
        log.warn('[DEBT_REMINDER] Initialization xatolik (ignored):', error.message);
        setTimeout(() => loadReminderSettings().catch(() => {}), 30 * 1000);
    });
}, 60000); // 60 soniya - DB init va birinchi so'rovlar tugaguncha

/**
 * Reminder'ni database'ga saqlash
 */
async function scheduleReminder(requestId, intervalMinutes = null, maxCount = null) {
    try {
        const interval = intervalMinutes || reminderInterval;
        const max = maxCount || reminderMaxCount;
        
        // next_reminder_at ni hisoblash
        const nextReminderAt = new Date(Date.now() + interval * 60 * 1000).toISOString();
        
        // Database'ga saqlash (upsert)
        const existing = await db('debt_reminders').where('request_id', requestId).first();
        if (existing) {
            await db('debt_reminders').where('request_id', requestId).update({
                reminder_count: 0,
                next_reminder_at: nextReminderAt,
                max_reminders: max
            });
        } else {
            await db('debt_reminders').insert({
                request_id: requestId,
                reminder_count: 0,
                next_reminder_at: nextReminderAt,
                max_reminders: max
            });
        }
        
        // Memory'da ham boshlash
        startReminder(requestId);
        
        // log.info(`Reminder scheduled: requestId=${requestId}, interval=${interval}min, maxCount=${max}`);
    } catch (error) {
        log.error('Error scheduling reminder:', error);
        throw error;
    }
}

/**
 * Reminder'ni database'dan o'chirish
 */
async function cancelReminders(requestId) {
    try {
        await db('debt_reminders').where('request_id', requestId).del();
        stopReminder(requestId);
        // log.info(`Reminders cancelled: requestId=${requestId}`);
    } catch (error) {
        log.error('Error cancelling reminders:', error);
        throw error;
    }
}

/**
 * Database'dan reminder'larni yuklash va boshlash
 */
async function loadRemindersFromDatabase() {
    try {
        const reminders = await db('debt_reminders')
            .where('next_reminder_at', '<=', db.fn.now())
            .whereRaw('reminder_count < max_reminders')
            .select('*');
        
        for (const reminder of reminders) {
            if (!reminders.has(reminder.request_id)) {
                startReminder(reminder.request_id);
            }
        }
        
    } catch (error) {
        log.error('Error loading reminders from database:', error);
    }
}

/**
 * Foydalanuvchining kutilayotgan eslatmalarini olish
 * @param {number} userId - User ID
 * @param {string} role - 'cashier', 'operator', 'leader'
 * @returns {Promise<Array>} - Kutilayotgan so'rovlar ro'yxati
 */
async function getPendingRemindersForUser(userId, role) {
    try {
        if (role === 'cashier') {
            // Kassirning filiallarini olish
            const { getCashierBranches } = require('../bot/debt-approval/handlers/cashier.js');
            const cashierBranches = await getCashierBranches(userId);
            
            if (cashierBranches.length === 0) {
                return [];
            }
            
            const requests = await db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .whereIn('debt_requests.branch_id', cashierBranches)
                .where(function() {
                    this.where('debt_requests.current_approver_id', userId)
                        .where('debt_requests.current_approver_type', 'cashier')
                        .orWhere(function() {
                            // Agar current_approver_id yo'q bo'lsa, filialga biriktirilgan so'rovlar
                            this.whereNull('debt_requests.current_approver_id')
                                .whereIn('debt_requests.branch_id', cashierBranches);
                        });
                })
                .whereIn('debt_requests.status', ['PENDING_APPROVAL', 'APPROVED_BY_LEADER'])
                .where('debt_requests.locked', false)
                .select(
                    'debt_requests.*',
                    'debt_brands.name as brand_name',
                    'debt_branches.name as branch_name',
                    'debt_svrs.name as svr_name'
                )
                .orderBy('debt_requests.created_at', 'asc');
            
            return requests;
        } else if (role === 'operator') {
            // Operator uchun - APPROVED_BY_CASHIER statusli so'rovlar
            const requests = await db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .where('debt_requests.status', 'APPROVED_BY_CASHIER')
                .where('debt_requests.locked', false)
                .select(
                    'debt_requests.*',
                    'debt_brands.name as brand_name',
                    'debt_branches.name as branch_name',
                    'debt_svrs.name as svr_name'
                )
                .orderBy('debt_requests.created_at', 'asc');
            
            return requests;
        } else if (role === 'leader') {
            // Leader uchun - SET_PENDING statusli so'rovlar
            const requests = await db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .where('debt_requests.status', 'SET_PENDING')
                .where('debt_requests.locked', false)
                .select(
                    'debt_requests.*',
                    'debt_brands.name as brand_name',
                    'debt_branches.name as branch_name',
                    'debt_svrs.name as svr_name'
                )
                .orderBy('debt_requests.created_at', 'asc');
            
            return requests;
        }
        
        return [];
    } catch (error) {
        log.error('Error getting pending reminders for user:', error);
        return [];
    }
}

/**
 * Guruh uchun kutilayotgan eslatmalar soni va ma'lumotlari
 * @param {number} groupId - Telegram group ID
 * @param {string} groupType - 'leaders', 'operators'
 * @returns {Promise<{count: number, requests: Array, users: Array}>}
 */
async function getPendingRemindersForGroup(groupId, groupType) {
    try {
        const pendingStatuses = [
            'PENDING_APPROVAL',
            'SET_PENDING',
            'APPROVED_BY_LEADER',
            'APPROVED_BY_CASHIER'
        ];
        
        let statusFilter = [];
        if (groupType === 'leaders') {
            statusFilter = ['SET_PENDING'];
        } else if (groupType === 'operators') {
            statusFilter = ['APPROVED_BY_CASHIER'];
        }
        
        let query = db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereIn('debt_requests.status', statusFilter)
            .where('debt_requests.locked', false)
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            );
        
        const requests = await query.orderBy('debt_requests.created_at', 'asc');
        
        // Agar operators guruhi bo'lsa, operatorlarni olish (APPROVED_BY_CASHIER so'rovlariga tegishli operatorlar)
        let users = [];
        if (groupType === 'operators') {
            // APPROVED_BY_CASHIER statusli so'rovlar uchun operatorlarni olish
            // Operatorlar brend bo'yicha biriktirilgan, shuning uchun brendlarga qarab topish kerak
            
            // Avval barcha APPROVED_BY_CASHIER so'rovlarining brendlarini olish
            const requestBrands = await db('debt_requests')
                .whereIn('status', statusFilter)
                .where('locked', false)
                .distinct('brand_id')
                .pluck('brand_id');
            
            if (requestBrands.length > 0) {
                // Bu brendlarga biriktirilgan operatorlarni topish
                // debt_operators jadvalidan
                const operatorsFromTable = await db('debt_operators')
                    .join('users', 'debt_operators.user_id', 'users.id')
                    .where('debt_operators.is_active', true)
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_username')
                    .whereIn('debt_operators.brand_id', requestBrands)
                    .select('users.id', 'users.telegram_username', 'users.fullname', 'users.telegram_chat_id')
                    .distinct();
                
                // debt_user_brands jadvalidan
                const operatorsFromBindings = await db('debt_user_brands')
                    .join('users', 'debt_user_brands.user_id', 'users.id')
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_username')
                    .whereIn('debt_user_brands.brand_id', requestBrands)
                    .select('users.id', 'users.telegram_username', 'users.fullname', 'users.telegram_chat_id')
                    .distinct();
                
                // debt_user_tasks jadvalidan (approve_operator task_type)
                const operatorsFromTasks = await db('debt_user_tasks')
                    .join('users', 'debt_user_tasks.user_id', 'users.id')
                    .where(function() {
                        this.where('debt_user_tasks.task_type', 'approve_operator')
                            .orWhere('debt_user_tasks.task_type', 'debt:approve_operator');
                    })
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_username')
                    .where(function() {
                        this.whereNull('debt_user_tasks.brand_id')
                            .orWhereIn('debt_user_tasks.brand_id', requestBrands);
                    })
                    .select('users.id', 'users.telegram_username', 'users.fullname', 'users.telegram_chat_id')
                    .distinct();
                
                // Birlashtirish va dublikatlarni olib tashlash
                const operatorsMap = new Map();
                [...operatorsFromTable, ...operatorsFromBindings, ...operatorsFromTasks].forEach(op => {
                    if (!operatorsMap.has(op.id)) {
                        operatorsMap.set(op.id, op);
                    }
                });
                
                users = Array.from(operatorsMap.values());
            }
        }
        
        return {
            count: requests.length,
            requests: requests,
            users: users
        };
    } catch (error) {
        log.error('Error getting pending reminders for group:', error);
        return { count: 0, requests: [], users: [] };
    }
}

/**
 * Eslatmalar uchun umumiy ma'lumot
 * @param {number} recipientId - Recipient ID (user_id yoki group_id)
 * @param {string} recipientType - 'user' yoki 'group'
 * @returns {Promise<{count: number, users?: Array}>}
 */
async function getRemindersSummary(recipientId, recipientType) {
    try {
        if (recipientType === 'user') {
            const user = await db('users').where('id', recipientId).first();
            if (!user) {
                return { count: 0 };
            }
            
            // Role ni aniqlash
            const userHelper = require('../bot/unified/userHelper.js');
            let role = null;
            if (await userHelper.hasPermission(user.id, 'debt:approve_cashier')) {
                role = 'cashier';
            } else if (await userHelper.hasPermission(user.id, 'debt:approve_operator')) {
                role = 'operator';
            } else if (await userHelper.hasPermission(user.id, 'debt:approve_leader')) {
                role = 'leader';
            }
            
            if (!role) {
                return { count: 0 };
            }
            
            const requests = await getPendingRemindersForUser(user.id, role);
            return { count: requests.length };
        } else if (recipientType === 'group') {
            // Group type ni aniqlash
            const group = await db('debt_groups')
                .where('telegram_group_id', recipientId)
                .where('is_active', true)
                .first();
            
            if (!group) {
                return { count: 0 };
            }
            
            const result = await getPendingRemindersForGroup(recipientId, group.group_type);
            return result;
        }
        
        return { count: 0 };
    } catch (error) {
        log.error('Error getting reminders summary:', error);
        return { count: 0 };
    }
}

module.exports = {
    startReminder,
    stopReminder,
    updateReminderSettings,
    startRemindersForPendingRequests,
    scheduleReminder,
    cancelReminders,
    loadRemindersFromDatabase,
    getPendingRemindersForUser,
    getPendingRemindersForGroup,
    getRemindersSummary
};

