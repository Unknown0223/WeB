// bot/debt-approval/handlers/approval.js

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const { getBot } = require('../../../utils/bot.js');
const { approvalKeyboard } = require('../keyboards.js');
const userHelper = require('../../unified/userHelper.js');
const axios = require('axios');

const log = createLogger('DEBT_APPROVAL');
const API_URL = process.env.API_URL || 'http://localhost:3000';

// Settings'dan o'qish helper funksiyasi
async function getDebtSetting(key, defaultValue = null) {
    try {
        const setting = await db('settings').where('key', key).first();
        return setting ? setting.value : defaultValue;
    } catch (error) {
        log.error(`Setting o'qishda xatolik (${key}):`, error);
        return defaultValue;
    }
}

// Leader tasdiqlash (SET so'rovlar uchun)
async function handleLeaderApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // Foydalanuvchi va permission tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        const hasPermission = await userHelper.hasPermission(user.id, 'debt:approve_leader');
        if (!hasPermission) {
            await bot.sendMessage(chatId, '❌ Sizda Leader tasdiqlash huquqi yo\'q.\n\n' +
                'Bu funksiyadan foydalanish uchun "Qarzdorlik Tasdiqlash" bo\'limida "Leader sifatida SET so\'rovlarni tasdiqlash" huquqiga ega bo\'lishingiz kerak.');
            return;
        }
        
        // So'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // Faqat SET so'rovlar
        if (request.type !== 'SET') {
            await bot.sendMessage(chatId, '❌ Bu so\'rov SET emas.');
            return;
        }
        
        // Lock tekshirish
        if (request.locked) {
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov allaqachon tasdiqlangan', show_alert: true });
            return;
        }
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_LEADER',
                locked: true,
                updated_at: new Date().toISOString()
            });
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'leader_approve',
            old_status: request.status,
            new_status: 'APPROVED_BY_LEADER',
            performed_by: user.id,
            created_at: new Date().toISOString()
        });
        
        // Cashier'ga yuborish
        const cashier = await db('users')
            .where('role', 'cashier')
            .where('telegram_chat_id', 'IS NOT', null)
            .first();
        
        if (cashier && cashier.telegram_chat_id) {
            const brand = await db('debt_brands').where('id', request.brand_id).first();
            const branch = await db('debt_branches').where('id', request.branch_id).first();
            const svr = await db('debt_svrs').where('id', request.svr_id).first();
            
            const message = `🧾 SO\'ROV: ${request.request_uid}\n\n` +
                `📌 Brend: ${brand?.name || 'N/A'}\n` +
                `📍 Filial: ${branch?.name || 'N/A'}\n` +
                `👤 SVR: ${svr?.name || 'N/A'}\n` +
                `📋 Turi: SET\n` +
                `\n✅ Leader tasdiqladi\n` +
                `\nHolat: Sizning tasdig'ingiz kutilmoqda`;
            
            await bot.sendMessage(
                cashier.telegram_chat_id,
                message,
                { reply_markup: approvalKeyboard(requestId) }
            );
        }
        
        // Leader'ga javob
        await bot.editMessageText(
            `✅ So\'rov tasdiqlandi!\n\n📋 ID: ${request.request_uid}\n\nCashier'ga yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
    } catch (error) {
        log.error('Leader tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// Cashier tasdiqlash
async function handleCashierApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // Foydalanuvchi va permission tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        const hasPermission = await userHelper.hasPermission(user.id, 'debt:approve_cashier');
        if (!hasPermission) {
            await bot.sendMessage(chatId, '❌ Sizda Cashier tasdiqlash huquqi yo\'q.\n\n' +
                'Bu funksiyadan foydalanish uchun "Qarzdorlik Tasdiqlash" bo\'limida "Cashier sifatida so\'rovlarni tasdiqlash" huquqiga ega bo\'lishingiz kerak.');
            return;
        }
        
        // So'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // Lock tekshirish
        if (request.locked) {
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov allaqachon tasdiqlangan', show_alert: true });
            return;
        }
        
        // Status yangilash (lock qilmaymiz, chunki nazoratchi tasdiqlashi kerak)
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_CASHIER',
                locked: false, // Nazoratchi tasdiqlashidan oldin unlock
                updated_at: new Date().toISOString()
            });
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'cashier_approve',
            old_status: request.status,
            new_status: 'APPROVED_BY_CASHIER',
            performed_by: user.id,
            created_at: new Date().toISOString()
        });
        
        // Nazoratchilarga yuborish
        const debtAccessFilter = require('../../../utils/debtAccessFilter.js');
        const supervisors = await debtAccessFilter.getSupervisorsForRequest(requestId, request.brand_id, request.branch_id);
        
        const brand = await db('debt_brands').where('id', request.brand_id).first();
        const branch = await db('debt_branches').where('id', request.branch_id).first();
        const svr = await db('debt_svrs').where('id', request.svr_id).first();
        
        const message = `🧾 SO\'ROV: ${request.request_uid}\n\n` +
            `📌 Brend: ${brand?.name || 'N/A'}\n` +
            `📍 Filial: ${branch?.name || 'N/A'}\n` +
            `👤 SVR: ${svr?.name || 'N/A'}\n` +
            `\n✅ Leader: ${request.type === 'SET' ? '✅' : 'N/A'}\n` +
            `✅ Cashier: ✅\n` +
            `\n⚠️ Sizning tasdig'ingiz kutilmoqda (Nazoratchi)`;
        
        if (supervisors.length > 0) {
            // Barcha nazoratchilarga bir vaqtda yuborish
            const sendPromises = supervisors.map(supervisor => {
                return bot.sendMessage(
                    supervisor.telegram_chat_id,
                    message,
                    { reply_markup: approvalKeyboard(requestId, 'supervisor') }
                ).catch(err => {
                    log.error(`Nazoratchiga xabar yuborishda xatolik (User ID: ${supervisor.id}):`, err);
                });
            });
            
            await Promise.all(sendPromises);
            log.info(`✅ ${supervisors.length} ta nazoratchiga xabar yuborildi`);
        } else {
            log.warn('⚠️ Nazoratchilar topilmadi, Operatorga to\'g\'ridan-to\'g\'ri yuborilmoqda');
            // Agar nazoratchilar bo'lmasa, Operatorga to'g'ridan-to'g'ri yuborish
            const operator = await db('users')
                .where('role', 'operator')
                .where('telegram_chat_id', 'IS NOT', null)
                .first();
            
            if (operator && operator.telegram_chat_id) {
                const operatorMessage = `🧾 SO\'ROV: ${request.request_uid}\n\n` +
                    `📌 Brend: ${brand?.name || 'N/A'}\n` +
                    `📍 Filial: ${branch?.name || 'N/A'}\n` +
                    `👤 SVR: ${svr?.name || 'N/A'}\n` +
                    `\n✅ Leader: ${request.type === 'SET' ? '✅' : 'N/A'}\n` +
                    `✅ Cashier: ✅\n` +
                    `\nHolat: Sizning tasdig'ingiz kutilmoqda`;
                
                await bot.sendMessage(
                    operator.telegram_chat_id,
                    operatorMessage,
                    { reply_markup: approvalKeyboard(requestId) }
                );
            }
        }
        
        // Cashier'ga javob
        await bot.editMessageText(
            `✅ So\'rov tasdiqlandi!\n\n📋 ID: ${request.request_uid}\n\n${supervisors.length > 0 ? 'Nazoratchilarga' : 'Operatorga'} yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
    } catch (error) {
        log.error('Cashier tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// Nazoratchi tasdiqlash
async function handleSupervisorApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // Foydalanuvchi va permission tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        const hasPermission = await userHelper.hasPermission(user.id, 'debt:approve_supervisor');
        if (!hasPermission) {
            await bot.sendMessage(chatId, '❌ Sizda Nazoratchi tasdiqlash huquqi yo\'q.\n\n' +
                'Bu funksiyadan foydalanish uchun "Qarzdorlik Tasdiqlash" bo\'limida "Nazoratchi sifatida so\'rovlarni tasdiqlash" huquqiga ega bo\'lishingiz kerak.');
            return;
        }
        
        // So'rovni olish va lock qilish (birinchi bosgan qabul qiladi)
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // Lock tekshirish - birinchi bosgan qabul qiladi
        if (request.locked) {
            await bot.answerCallbackQuery(query.id, { 
                text: 'Bu so\'rov allaqachon tasdiqlangan', 
                show_alert: true 
            });
            return;
        }
        
        // Lock qilish (birinchi bosgan qabul qiladi)
        const updateResult = await db('debt_requests')
            .where('id', requestId)
            .where('locked', false) // Faqat unlock bo'lganlarini yangilash
            .update({
                status: 'APPROVED_BY_SUPERVISOR',
                locked: true,
                updated_at: new Date().toISOString()
            });
        
        if (updateResult === 0) {
            // Boshqa nazoratchi allaqachon tasdiqlagan
            await bot.answerCallbackQuery(query.id, { 
                text: 'Bu so\'rov boshqa nazoratchi tomonidan tasdiqlangan', 
                show_alert: true 
            });
            return;
        }
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'supervisor_approve',
            old_status: request.status,
            new_status: 'APPROVED_BY_SUPERVISOR',
            performed_by: user.id,
            created_at: new Date().toISOString()
        });
        
        // Operator'ga yuborish
        const operator = await db('users')
            .where('role', 'operator')
            .where('telegram_chat_id', 'IS NOT', null)
            .first();
        
        if (operator && operator.telegram_chat_id) {
            const brand = await db('debt_brands').where('id', request.brand_id).first();
            const branch = await db('debt_branches').where('id', request.branch_id).first();
            const svr = await db('debt_svrs').where('id', request.svr_id).first();
            
            const message = `🧾 SO\'ROV: ${request.request_uid}\n\n` +
                `📌 Brend: ${brand?.name || 'N/A'}\n` +
                `📍 Filial: ${branch?.name || 'N/A'}\n` +
                `👤 SVR: ${svr?.name || 'N/A'}\n` +
                `\n✅ Leader: ${request.type === 'SET' ? '✅' : 'N/A'}\n` +
                `✅ Cashier: ✅\n` +
                `✅ Nazoratchi: ✅\n` +
                `\nHolat: Sizning tasdig'ingiz kutilmoqda`;
            
            await bot.sendMessage(
                operator.telegram_chat_id,
                message,
                { reply_markup: approvalKeyboard(requestId) }
            );
        }
        
        // Nazoratchiga javob
        await bot.editMessageText(
            `✅ So\'rov tasdiqlandi!\n\n📋 ID: ${request.request_uid}\n\nOperator'ga yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
        log.info(`✅ Nazoratchi (User ID: ${user.id}) so'rovni tasdiqladi (Request ID: ${requestId})`);
        
    } catch (error) {
        log.error('Nazoratchi tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// Operator tasdiqlash
async function handleOperatorApproval(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tasdiqlanmoqda...' });
        
        // Foydalanuvchi va permission tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        const hasPermission = await userHelper.hasPermission(user.id, 'debt:approve_operator');
        if (!hasPermission) {
            await bot.sendMessage(chatId, '❌ Sizda Operator tasdiqlash huquqi yo\'q.\n\n' +
                'Bu funksiyadan foydalanish uchun "Qarzdorlik Tasdiqlash" bo\'limida "Operator sifatida so\'rovlarni tasdiqlash" huquqiga ega bo\'lishingiz kerak.');
            return;
        }
        
        // So'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // Lock tekshirish
        if (request.locked) {
            await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov allaqachon tasdiqlangan', show_alert: true });
            return;
        }
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'APPROVED_BY_OPERATOR',
                locked: true,
                updated_at: new Date().toISOString()
            });
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'operator_approve',
            old_status: request.status,
            new_status: 'APPROVED_BY_OPERATOR',
            performed_by: user.id,
            created_at: new Date().toISOString()
        });
        
        // Final group'ga yuborish (agar sozlangan bo'lsa)
        const finalGroupId = await getDebtSetting('debt_final_group_id');
        if (finalGroupId) {
            const brand = await db('debt_brands').where('id', request.brand_id).first();
            const branch = await db('debt_branches').where('id', request.branch_id).first();
            const svr = await db('debt_svrs').where('id', request.svr_id).first();
            
            const message = `✅ SO\'ROV TASDIQLANDI\n\n` +
                `📋 ID: ${request.request_uid}\n` +
                `📌 Brend: ${brand?.name || 'N/A'}\n` +
                `📍 Filial: ${branch?.name || 'N/A'}\n` +
                `👤 SVR: ${svr?.name || 'N/A'}\n` +
                `\n✅ Leader: ✅\n` +
                `✅ Cashier: ✅\n` +
                `✅ Operator: ✅\n` +
                `\n📅 ${new Date().toLocaleString('uz-UZ')}`;
            
            await bot.sendMessage(finalGroupId, message);
        }
        
        // Operator'ga javob
        await bot.editMessageText(
            `✅ So\'rov muvaffaqiyatli tasdiqlandi!\n\n📋 ID: ${request.request_uid}\n\nUmumiy guruhga yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
    } catch (error) {
        log.error('Operator tasdiqlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

module.exports = {
    handleLeaderApproval,
    handleCashierApproval,
    handleSupervisorApproval,
    handleOperatorApproval
};

