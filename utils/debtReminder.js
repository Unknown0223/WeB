// utils/debtReminder.js

const { getBot } = require('./bot.js');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const { formatNormalRequestMessage, formatSetRequestMessage } = require('./messageTemplates.js');

const log = createLogger('DEBT_REMINDER');

// Reminder interval (daqiqa)
let reminderInterval = 15; // Default
let reminderMaxCount = 3; // Default

// Reminder'lar ro'yxati
const reminders = new Map(); // requestId -> { count, lastSent }

// Reminder sozlamalarini yuklash
async function loadReminderSettings() {
    try {
        // Avval debt_settings jadvalidan qidirish
        let intervalSetting = await db('debt_settings').where('key', 'debt_reminder_interval').first();
        let countSetting = await db('debt_settings').where('key', 'debt_reminder_max_count').first();
        
        // Agar topilmasa, eski settings jadvalidan qidirish (backward compatibility)
        if (!intervalSetting) {
            intervalSetting = await db('settings').where('key', 'debt_reminder_interval_minutes').first();
        }
        if (!countSetting) {
            countSetting = await db('settings').where('key', 'debt_reminder_max_count').first();
        }
        
        if (intervalSetting) {
            reminderInterval = parseInt(intervalSetting.value) || 30;
        }
        if (countSetting) {
            reminderMaxCount = parseInt(countSetting.value) || 3;
        }
        
    } catch (error) {
        log.error('Reminder sozlamalarini yuklashda xatolik:', error);
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
    
    log.info(`Reminder sozlamalari yangilandi: interval=${reminderInterval}min, maxCount=${reminderMaxCount}`);
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
        log.info(`Reminder to'xtatildi: requestId=${requestId}`);
    }
}

// Reminder yuborish
async function checkAndSendReminder(requestId) {
    try {
        log.info(`[REMINDER] Eslatma tekshirilmoqda: requestId=${requestId}`);
        
        const reminder = reminders.get(requestId);
        if (!reminder) {
            log.warn(`[REMINDER] Reminder topilmadi: requestId=${requestId}`);
            return;
        }
        
        // Max count tekshirish
        if (reminder.count >= reminderMaxCount) {
            log.info(`[REMINDER] Max count yetib borgan: requestId=${requestId}, count=${reminder.count}/${reminderMaxCount}`);
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
        
        log.info(`[REMINDER] So'rov topildi: requestId=${requestId}, requestUID=${request.request_uid}, status=${request.status}, brand=${request.brand_name}, branch=${request.branch_name}`);
        
        // Status tekshirish (faqat pending statuslar uchun)
        const pendingStatuses = [
            'PENDING_APPROVAL',
            'SET_PENDING',
            'APPROVED_BY_LEADER',
            'APPROVED_BY_CASHIER'
        ];
        
        if (!pendingStatuses.includes(request.status)) {
            log.info(`[REMINDER] Status pending emas: requestId=${requestId}, status=${request.status}`);
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
        
        if (request.status === 'SET_PENDING' || request.status === 'APPROVED_BY_LEADER') {
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
        
        // Xabarni formatlash va yuborish
        if (bot) {
            for (const recipient of recipients) {
                try {
                    let message = reminderHeader;
                    let keyboard = null;
                    
                    // Role bo'yicha xabar va knopkalar
                    if (recipient.role === 'cashier') {
                        // Kassir uchun to'liq xabar
                        // Excel ma'lumotlarini parse qilish (agar SET bo'lsa)
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
                            
                            const requestMessage = formatSetRequestMessage({
                                brand_name: request.brand_name,
                                filial_name: request.branch_name,
                                svr_name: request.svr_name,
                                extra_info: request.extra_info,
                                request_uid: request.request_uid,
                                excel_data: excelData,
                                excel_headers: excelHeaders,
                                excel_columns: excelColumns,
                                excel_total: request.excel_total,
                                is_for_cashier: true
                            });
                            
                            message = reminderHeader + requestMessage;
                        } else {
                            const requestMessage = formatNormalRequestMessage({
                                brand_name: request.brand_name,
                                filial_name: request.branch_name,
                                svr_name: request.svr_name,
                                request_uid: request.request_uid
                            });
                            
                            message = reminderHeader + requestMessage;
                        }
                        
                        keyboard = {
                            inline_keyboard: [
                                [{ text: '✅ Tasdiqlash', callback_data: `cashier_approve_${request.id}` }],
                                [{ text: '⚠️ Qarzi bor', callback_data: `cashier_debt_${request.id}` }]
                            ]
                        };
                        
                        log.info(`[REMINDER] Kassirga eslatma yuborilmoqda: requestId=${requestId}, cashierId=${recipient.user_id}, chatId=${recipient.id}`);
                    } else if (recipient.role === 'operator') {
                        // Operator uchun to'liq xabar
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
                            
                            const requestMessage = formatSetRequestMessage({
                                brand_name: request.brand_name,
                                filial_name: request.branch_name,
                                svr_name: request.svr_name,
                                extra_info: request.extra_info,
                                request_uid: request.request_uid,
                                excel_data: excelData,
                                excel_headers: excelHeaders,
                                excel_columns: excelColumns,
                                excel_total: request.excel_total,
                                is_for_operator: true
                            });
                            
                            message = reminderHeader + requestMessage;
                        } else {
                            const requestMessage = formatNormalRequestMessage({
                                brand_name: request.brand_name,
                                filial_name: request.branch_name,
                                svr_name: request.svr_name,
                                request_uid: request.request_uid
                            });
                            
                            message = reminderHeader + requestMessage;
                        }
                        
                        keyboard = {
                            inline_keyboard: [
                                [{ text: '✅ Tasdiqlash', callback_data: `operator_approve_${request.id}` }],
                                [{ text: '⚠️ Qarzi bor', callback_data: `operator_debt_${request.id}` }]
                            ]
                        };
                        
                        log.info(`[REMINDER] Operatorlarga eslatma yuborilmoqda: requestId=${requestId}, groupId=${recipient.id}`);
                    } else if (recipient.role === 'leader') {
                        // Leader uchun to'liq xabar
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
                            
                            const requestMessage = formatSetRequestMessage({
                                brand_name: request.brand_name,
                                filial_name: request.branch_name,
                                svr_name: request.svr_name,
                                extra_info: request.extra_info,
                                request_uid: request.request_uid,
                                excel_data: excelData,
                                excel_headers: excelHeaders,
                                excel_columns: excelColumns,
                                excel_total: request.excel_total,
                                is_for_leaders: true
                            });
                            
                            message = reminderHeader + requestMessage;
                        }
                        
                        keyboard = {
                            inline_keyboard: [
                                [{ text: '✅ Tasdiqlash', callback_data: `leader_approve_${request.id}` }],
                                [{ text: '❌ Rad etish', callback_data: `leader_reject_${request.id}` }]
                            ]
                        };
                        
                        log.info(`[REMINDER] Rahbarlarga eslatma yuborilmoqda: requestId=${requestId}, groupId=${recipient.id}`);
                    }
                    
                    await bot.sendMessage(recipient.id, message, {
                        reply_markup: keyboard,
                        parse_mode: 'HTML'
                    });
                    
                    log.info(`[REMINDER] ✅ Eslatma yuborildi: requestId=${requestId}, recipient=${recipient.type}:${recipient.id}, role=${recipient.role}`);
                } catch (error) {
                    log.error(`[REMINDER] Reminder yuborishda xatolik (${recipient.type}:${recipient.id}):`, error);
                }
            }
        }
        
        // Counter yangilash
        reminder.count++;
        reminder.lastSent = new Date();
        
        log.info(`[REMINDER] ✅ Eslatma jarayoni yakunlandi: requestId=${requestId}, count=${reminder.count}/${reminderMaxCount}, recipients=${recipients.length} ta`);
    } catch (error) {
        log.error('Reminder tekshirishda xatolik:', error);
    }
}

// Barcha pending requestlar uchun reminder boshlash
async function startRemindersForPendingRequests() {
    try {
        const pendingRequests = await db('debt_requests')
            .whereIn('status', [
                'PENDING_APPROVAL',
                'SET_PENDING',
                'APPROVED_BY_LEADER',
                'APPROVED_BY_CASHIER'
            ])
            .where('locked', false)
            .select('id');
        
        for (const req of pendingRequests) {
            if (!reminders.has(req.id)) {
                startReminder(req.id);
            }
        }
        
        // ${pendingRequests.length} ta request uchun reminder boshlandi (log olib tashlandi)
    } catch (error) {
        log.error('Pending requestlar uchun reminder boshlashda xatolik:', error);
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
    
    log.info(`Reminder sozlamalari yangilandi: interval=${reminderInterval}min, maxCount=${reminderMaxCount}`);
}

// Initialization
loadReminderSettings().then(() => {
    // 5 daqiqadan keyin barcha pending requestlar uchun reminder boshlash
    setTimeout(() => {
        startRemindersForPendingRequests();
    }, 5 * 60 * 1000);
});

/**
 * Reminder'ni database'ga saqlash
 */
async function scheduleReminder(requestId, intervalMinutes = null, maxCount = null) {
    try {
        const interval = intervalMinutes || reminderInterval;
        const max = maxCount || reminderMaxCount;
        
        // Database'ga saqlash
        await db('debt_reminders').insert({
            request_id: requestId,
            reminder_count: 0,
            next_reminder_at: db.raw("datetime('now', '+' || ? || ' minutes')", [interval]),
            max_reminders: max
        }).onConflict('request_id').merge();
        
        // Memory'da ham boshlash
        startReminder(requestId);
        
        log.info(`Reminder scheduled: requestId=${requestId}, interval=${interval}min, maxCount=${max}`);
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
        log.info(`Reminders cancelled: requestId=${requestId}`);
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

module.exports = {
    startReminder,
    stopReminder,
    updateReminderSettings,
    startRemindersForPendingRequests,
    scheduleReminder,
    cancelReminders,
    loadRemindersFromDatabase
};

