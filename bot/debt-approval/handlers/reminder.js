// bot/debt-approval/handlers/reminder.js
// Eslatma handler'lari - navbat bilan eslatmalarni ko'rsatish

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const userHelper = require('../../unified/userHelper.js');
const { formatNormalRequestMessage, formatSetRequestMessage } = require('../../../utils/messageTemplates.js');
const { getPendingRemindersForUser, getPendingRemindersForGroup, getRemindersSummary } = require('../../../utils/debtReminder.js');
const { getCashierBranches } = require('./cashier.js');
const { showRequestToCashier } = require('./cashier.js');
const { showRequestToOperator } = require('./operator.js');
const { showSetRequestToLeaders } = require('./leader.js');

const log = createLogger('REMINDER_HANDLER');

/**
 * Keyingi eslatmani ko'rsatish (kassir/operator uchun)
 * @param {Object} query - Callback query yoki fake query (to'g'ridan-to'g'ri chaqirilganda)
 * @param {Object} bot - Telegram bot instance
 * @param {string} recipientType - 'user' yoki 'group'
 * @param {string} role - 'cashier', 'operator' yoki 'leader'
 * @param {boolean} skipAnswerCallback - answerCallbackQuery ni o'tkazib yuborish (default: false)
 */
async function handleShowNextReminder(query, bot, recipientType, role, skipAnswerCallback = false) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        // ✅ answerCallbackQuery ni faqat haqiqiy callback query bo'lsa chaqirish
        if (!skipAnswerCallback && query.id && !query.id.startsWith('fake_')) {
            try {
                await bot.answerCallbackQuery(query.id);
            } catch (answerError) {
                // Agar query ID noto'g'ri bo'lsa (masalan, fake query), xatolikni e'tiborsiz qoldirish
                log.debug(`[REMINDER_HANDLER] answerCallbackQuery xatolik (ignored): ${answerError.message}`);
            }
        }
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        // Role ni aniqlash (agar berilgan bo'lsa)
        let userRole = role;
        if (!userRole) {
            if (await userHelper.hasPermission(user.id, 'debt:approve_cashier')) {
                userRole = 'cashier';
            } else if (await userHelper.hasPermission(user.id, 'debt:approve_operator')) {
                userRole = 'operator';
            } else if (await userHelper.hasPermission(user.id, 'debt:approve_leader')) {
                userRole = 'leader';
            }
        }
        
        if (!userRole) {
            await bot.sendMessage(chatId, '❌ Sizda eslatmalarni ko\'rish huquqi yo\'q.');
            return;
        }
        
        // Kutilayotgan eslatmalarni olish
        const requests = await getPendingRemindersForUser(user.id, userRole);
        
        if (requests.length === 0) {
            await bot.sendMessage(chatId, '✅ Kutilayotgan eslatmalar yo\'q.');
            return;
        }
        
        // Birinchi kutilayotgan eslatmani ko'rsatish
        const firstRequest = requests[0];
        
        // MUHIM: "Hozircha kutayotgan so'rovlar yo'q" xabari faqat eslatmada 1 tadan ko'p bo'lsa chiqishi kerak
        // Qolgan eslatmalar soni (birinchi eslatmadan tashqari)
        const remainingCount = requests.length - 1;
        
        // Kechikish vaqti hisoblash
        const createdDate = new Date(firstRequest.created_at);
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
        
        let reminderHeader = `⚠️ <b>Tasdiqlanmagan va kechikib ketilgan</b>\n\n`;
        reminderHeader += `⏰ Kechikish: ${delayText}\n\n`;
        
        let message = reminderHeader;
        let keyboard = null;
        
        // Request ma'lumotlarini formatlash
        if (firstRequest.type === 'SET' && firstRequest.excel_data) {
            let excelData = firstRequest.excel_data;
            let excelHeaders = firstRequest.excel_headers;
            let excelColumns = firstRequest.excel_columns;
            
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
            
            // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
            // MUHIM: Eslatmalarda har doim Telegraph link ishlatilishi kerak
            let telegraphUrl = null;
            if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                try {
                    const { createDebtDataPage } = require('../../../utils/telegraph.js');
                    telegraphUrl = await createDebtDataPage({
                        request_uid: firstRequest.request_uid,
                        brand_name: firstRequest.brand_name,
                        filial_name: firstRequest.branch_name,
                        svr_name: firstRequest.svr_name,
                        month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                        extra_info: firstRequest.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: firstRequest.excel_total
                    });
                    
                    if (!telegraphUrl) {
                        log.warn(`[REMINDER_HANDLER] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${firstRequest.id}`);
                        // Qayta urinish
                        try {
                            telegraphUrl = await createDebtDataPage({
                                request_uid: firstRequest.request_uid,
                                brand_name: firstRequest.brand_name,
                                filial_name: firstRequest.branch_name,
                                svr_name: firstRequest.svr_name,
                                month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                                extra_info: firstRequest.extra_info,
                                excel_data: excelData,
                                excel_headers: excelHeaders,
                                excel_columns: excelColumns,
                                total_amount: firstRequest.excel_total
                            });
                        } catch (retryError) {
                            log.error(`[REMINDER_HANDLER] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${firstRequest.id}, error=${retryError.message}`);
                        }
                    }
                } catch (telegraphError) {
                    log.error(`[REMINDER_HANDLER] Telegraph sahifa yaratishda xatolik: requestId=${firstRequest.id}, error=${telegraphError.message}`);
                    // Qayta urinish
                    try {
                        telegraphUrl = await createDebtDataPage({
                            request_uid: firstRequest.request_uid,
                            brand_name: firstRequest.brand_name,
                            filial_name: firstRequest.branch_name,
                            svr_name: firstRequest.svr_name,
                            month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                            extra_info: firstRequest.extra_info,
                            excel_data: excelData,
                            excel_headers: excelHeaders,
                            excel_columns: excelColumns,
                            total_amount: firstRequest.excel_total
                        });
                    } catch (retryError) {
                        log.error(`[REMINDER_HANDLER] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${firstRequest.id}, error=${retryError.message}`);
                    }
                }
            }
            
            const requestMessage = formatSetRequestMessage({
                brand_name: firstRequest.brand_name,
                filial_name: firstRequest.branch_name,
                svr_name: firstRequest.svr_name,
                extra_info: firstRequest.extra_info,
                request_uid: firstRequest.request_uid,
                excel_data: excelData,
                excel_headers: excelHeaders,
                excel_columns: excelColumns,
                excel_total: firstRequest.excel_total,
                is_for_cashier: userRole === 'cashier',
                is_for_operator: userRole === 'operator',
                telegraph_url: telegraphUrl
            });
            
            message += requestMessage;
        } else {
            const requestMessage = formatNormalRequestMessage({
                brand_name: firstRequest.brand_name,
                filial_name: firstRequest.branch_name,
                svr_name: firstRequest.svr_name,
                request_uid: firstRequest.request_uid
            });
            
            message += requestMessage;
        }
        
        // Knopkalar
        if (userRole === 'cashier') {
            keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Tasdiqlash', callback_data: `cashier_approve_${firstRequest.id}` }],
                    [{ text: '⚠️ Qarzi bor', callback_data: `cashier_debt_${firstRequest.id}` }]
                ]
            };
        } else if (userRole === 'operator') {
            // Reminder message'larida operatorId qo'shmaslik kerak, chunki har qanday operator tasdiqlay oladi
            // callback_data format: operator_approve_${requestId} (operatorId yo'q)
            keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Tasdiqlash', callback_data: `operator_approve_${firstRequest.id}` }],
                    [{ text: '⚠️ Qarzi bor', callback_data: `operator_debt_${firstRequest.id}` }]
                ]
            };
        } else if (userRole === 'leader') {
            keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Tasdiqlash', callback_data: `leader_approve_${firstRequest.id}` }],
                    [{ text: '❌ Rad etish', callback_data: `leader_reject_${firstRequest.id}` }]
                ]
            };
        }
        
        // ✅ MUHIM: Avval barcha eski eslatma xabarlarini o'chirish
        try {
            const { getMessagesByType, getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
            
            // 1. Reminder type xabarlarni olish va o'chirish
            const reminderMessageIds = getMessagesByType(chatId, 'reminder');
            
            if (reminderMessageIds.length > 0) {
                // Barcha eslatma xabarlarini o'chirish (faqat so'nggi 5 ta emas, barchasini)
                for (const messageId of reminderMessageIds) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        untrackMessage(chatId, messageId);
                        await new Promise(resolve => setTimeout(resolve, 100));
                        log.debug(`[REMINDER_HANDLER] Eski eslatma xabari o'chirildi: chatId=${chatId}, messageId=${messageId}`);
                    } catch (deleteError) {
                        untrackMessage(chatId, messageId);
                        log.debug(`[REMINDER_HANDLER] Eski eslatma xabari o'chirishda xatolik (ignored): ${deleteError.message}`);
                    }
                }
            }
            
            // 2. "Sizda X ta kutilayotgan so'rov bor" xabarlarini o'chirish
            // Bu xabarlar USER_MESSAGE type bo'lishi mumkin, lekin shouldCleanup=true
            const messagesToDelete = getMessagesToCleanup(chatId, []);
            
            if (messagesToDelete.length > 0) {
                // So'nggi 10 ta xabarni o'chirish (ehtimol "kutilayotgan so'rovlar" xabarlari)
                const messagesToDeleteNow = messagesToDelete.slice(-10);
                
                for (const messageId of messagesToDeleteNow) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        untrackMessage(chatId, messageId);
                        await new Promise(resolve => setTimeout(resolve, 100));
                        log.debug(`[REMINDER_HANDLER] Eski "kutilayotgan so'rovlar" xabari o'chirildi: chatId=${chatId}, messageId=${messageId}`);
                    } catch (deleteError) {
                        untrackMessage(chatId, messageId);
                        log.debug(`[REMINDER_HANDLER] Xabar o'chirishda xatolik (ignored): ${deleteError.message}`);
                    }
                }
            }
        } catch (cleanupError) {
            log.debug(`[REMINDER_HANDLER] Eski eslatma xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
        }
        
        const sentMessage = await bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        // Eslatma xabarlarini messageTracker'ga qo'shish va cleanup'dan himoya qilish
        const { trackMessage } = require('../utils/messageTracker.js');
        trackMessage(chatId, sentMessage.message_id, 'reminder', false); // shouldCleanup=false - eslatma xabarlari o'chirilmasligi kerak
        
        // MUHIM: "Hozircha kutayotgan so'rovlar yo'q" xabari faqat eslatmada 1 tadan ko'p bo'lsa chiqishi kerak
        // Agar eslatmalar 1 tadan ko'p bo'lsa (remainingCount > 0), "Hozircha kutayotgan so'rovlar yo'q" xabari yuboriladi
        // Agar eslatmalar 1 tadan ko'p bo'lmasa (remainingCount === 0), xabar yuborilmaydi
        if (remainingCount > 0 && userRole === 'cashier') {
            // ✅ Avval eski "kutilayotgan so'rovlar" xabarlarini o'chirish
            // (Bu qism yuqorida allaqachon o'chirilgan, lekin qo'shimcha tekshiruv)
            try {
                const { getMessagesByType, getMessagesToCleanup, untrackMessage } = require('../utils/messageTracker.js');
                
                // Reminder type xabarlarni qayta tekshirish
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
                
                // Boshqa cleanup xabarlarni o'chirish
                const messagesToDelete = getMessagesToCleanup(chatId, []);
                if (messagesToDelete.length > 0) {
                    const messagesToDeleteNow = messagesToDelete.slice(-5);
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
                log.debug(`[REMINDER_HANDLER] Eski xabarlarni o'chirishda xatolik (ignored): ${cleanupError.message}`);
            }
            
            // Kassir uchun reply keyboard qo'shish (eslatmada 1 tadan ko'p bo'lsa)
            const replyKeyboard = {
                keyboard: [
                    [{ text: `⏰ Kutilayotgan so'rovlar (${remainingCount} ta)` }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            };
            
            try {
                const pendingMessage = await bot.sendMessage(chatId, `📋 Sizda ${remainingCount} ta kutilayotgan so'rov bor.`, {
                    reply_markup: replyKeyboard
                });
                trackMessage(chatId, pendingMessage.message_id, 'reminder', false);
            } catch (error) {
                log.debug(`[REMINDER_HANDLER] Kutilayotgan so'rovlar xabari yuborishda xatolik (ignored): ${error.message}`);
            }
        }
        // Agar remainingCount === 0 bo'lsa, "Hozircha kutayotgan so'rovlar yo'q" xabari yuborilmaydi
        // (Bu xabar faqat eslatmada 1 tadan ko'p bo'lsa chiqishi kerak)
        
        log.info(`Next reminder shown: userId=${userId}, role=${userRole}, requestId=${firstRequest.id}, messageId=${sentMessage.message_id}, remainingCount=${remainingCount}`);
    } catch (error) {
        log.error('Error showing next reminder:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Barcha eslatmalarni ko'rsatish (rahbarlar guruhida)
 */
async function handleShowAllReminders(query, bot, groupType) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // Guruh ma'lumotlarini olish
        const group = await db('debt_groups')
            .where('telegram_group_id', chatId)
            .where('is_active', true)
            .first();
        
        if (!group) {
            await bot.sendMessage(chatId, '❌ Guruh topilmadi.');
            return;
        }
        
        // Kutilayotgan eslatmalarni olish
        const result = await getPendingRemindersForGroup(chatId, group.group_type);
        
        if (result.count === 0) {
            await bot.sendMessage(chatId, '✅ Kutilayotgan eslatmalar yo\'q.');
            return;
        }
        
        // Birinchi eslatmani ko'rsatish (rahbarlar uchun)
        if (result.requests.length > 0) {
            const firstRequest = result.requests[0];
            
            // Kechikish vaqti
            const createdDate = new Date(firstRequest.created_at);
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
            
            let reminderHeader = `⚠️ <b>Tasdiqlanmagan va kechikib ketilgan</b>\n\n`;
            reminderHeader += `⏰ Kechikish: ${delayText}\n\n`;
            
            let message = reminderHeader;
            
            // Request ma'lumotlarini formatlash
            if (firstRequest.type === 'SET' && firstRequest.excel_data) {
                let excelData = firstRequest.excel_data;
                let excelHeaders = firstRequest.excel_headers;
                let excelColumns = firstRequest.excel_columns;
                
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
                
                // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
                // MUHIM: Eslatmalarda har doim Telegraph link ishlatilishi kerak
                let telegraphUrl = null;
                if (excelData && Array.isArray(excelData) && excelData.length > 0) {
                    try {
                        const { createDebtDataPage } = require('../../../utils/telegraph.js');
                        telegraphUrl = await createDebtDataPage({
                            request_uid: firstRequest.request_uid,
                            brand_name: firstRequest.brand_name,
                            filial_name: firstRequest.branch_name,
                            svr_name: firstRequest.svr_name,
                            month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                            extra_info: firstRequest.extra_info,
                            excel_data: excelData,
                            excel_headers: excelHeaders,
                            excel_columns: excelColumns,
                            total_amount: firstRequest.excel_total
                        });
                        
                        if (!telegraphUrl) {
                            log.warn(`[REMINDER_HANDLER] Telegraph sahifa yaratilmadi (null qaytdi): requestId=${firstRequest.id}`);
                            // Qayta urinish
                            try {
                                telegraphUrl = await createDebtDataPage({
                                    request_uid: firstRequest.request_uid,
                                    brand_name: firstRequest.brand_name,
                                    filial_name: firstRequest.branch_name,
                                    svr_name: firstRequest.svr_name,
                                    month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                                    extra_info: firstRequest.extra_info,
                                    excel_data: excelData,
                                    excel_headers: excelHeaders,
                                    excel_columns: excelColumns,
                                    total_amount: firstRequest.excel_total
                                });
                            } catch (retryError) {
                                log.error(`[REMINDER_HANDLER] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${firstRequest.id}, error=${retryError.message}`);
                            }
                        }
                    } catch (telegraphError) {
                        log.error(`[REMINDER_HANDLER] Telegraph sahifa yaratishda xatolik: requestId=${firstRequest.id}, error=${telegraphError.message}`);
                        // Qayta urinish
                        try {
                            telegraphUrl = await createDebtDataPage({
                                request_uid: firstRequest.request_uid,
                                brand_name: firstRequest.brand_name,
                                filial_name: firstRequest.branch_name,
                                svr_name: firstRequest.svr_name,
                                month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                                extra_info: firstRequest.extra_info,
                                excel_data: excelData,
                                excel_headers: excelHeaders,
                                excel_columns: excelColumns,
                                total_amount: firstRequest.excel_total
                            });
                        } catch (retryError) {
                            log.error(`[REMINDER_HANDLER] Telegraph sahifa yaratishda qayta urinishda xatolik: requestId=${firstRequest.id}, error=${retryError.message}`);
                        }
                    }
                }
                
                const requestMessage = formatSetRequestMessage({
                    brand_name: firstRequest.brand_name,
                    filial_name: firstRequest.branch_name,
                    svr_name: firstRequest.svr_name,
                    extra_info: firstRequest.extra_info,
                    request_uid: firstRequest.request_uid,
                    excel_data: excelData,
                    excel_headers: excelHeaders,
                    excel_columns: excelColumns,
                    excel_total: firstRequest.excel_total,
                    is_for_leaders: true,
                    telegraph_url: telegraphUrl
                });
                
                message += requestMessage;
            }
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Tasdiqlash', callback_data: `leader_approve_${firstRequest.id}` }],
                    [{ text: '❌ Rad etish', callback_data: `leader_reject_${firstRequest.id}` }]
                ]
            };
            
            const sentMessage = await bot.sendMessage(chatId, message, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
            
            // Eslatma xabarlarini messageTracker'ga qo'shish va cleanup'dan himoya qilish
            const { trackMessage } = require('../utils/messageTracker.js');
            trackMessage(chatId, sentMessage.message_id, 'reminder', false); // shouldCleanup=false - eslatma xabarlari o'chirilmasligi kerak
            
            log.info(`All reminders shown (first): groupId=${chatId}, requestId=${firstRequest.id}, total=${result.count}, messageId=${sentMessage.message_id}`);
        }
    } catch (error) {
        log.error('Error showing all reminders:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

module.exports = {
    handleShowNextReminder,
    handleShowAllReminders
};

