// bot/debt-approval/handlers/debt.js

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const { getBot } = require('../../../utils/bot.js');
const { debtPreviewKeyboard } = require('../keyboards.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const log = createLogger('DEBT_DEBT');
const API_URL = process.env.API_URL || 'http://localhost:3000';

// FSM states
const STATES = {
    IDLE: 'idle',
    UPLOAD_EXCEL: 'upload_excel',
    UPLOAD_IMAGE: 'upload_image',
    ENTER_AMOUNT: 'enter_amount',
    PREVIEW: 'preview'
};

// "Qarzi bor" bosilganda
async function handleDebtFound(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        // Foydalanuvchi va permission tekshirish
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Siz ro\'yxatdan o\'tmagansiz.');
            return;
        }
        
        const hasPermission = await userHelper.hasPermission(user.id, 'debt:mark_debt');
        if (!hasPermission) {
            await bot.sendMessage(chatId, '❌ Sizda qarzdorlik belgilash huquqi yo\'q.\n\n' +
                'Bu funksiyadan foydalanish uchun "Qarzdorlik Tasdiqlash" bo\'limida "Qarzdorlik belgilash" huquqiga ega bo\'lishingiz kerak.');
            return;
        }
        
        // So\'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // State'ni boshlash
        stateManager.setUserState(userId, stateManager.CONTEXTS.DEBT_APPROVAL, STATES.UPLOAD_EXCEL, {
            request_id: requestId,
            user_id: user.id,
            excel_file: null,
            image_file: null,
            amount: null,
            note: null
        });
        
        // Qarzdorlik ma'lumotlarini kirish uchun variantlar
        const keyboard = {
            inline_keyboard: [
                [
                    { text: "📎 Excel yuklash", callback_data: `debt_upload_excel:${requestId}` },
                    { text: "🖼 Rasm yuklash", callback_data: `debt_upload_image:${requestId}` }
                ],
                [
                    { text: "✍️ Summa yozma", callback_data: `debt_enter_amount:${requestId}` }
                ],
                [
                    { text: "❌ Bekor", callback_data: `debt_cancel_debt:${requestId}` }
                ]
            ]
        };
        
        await bot.editMessageText(
            `⚠️ QARZDORLIK ANIQLANDI\n\n` +
            `So\'rov: ${request.request_uid}\n\n` +
            `Qarzdorlik ma'lumotlarini kiriting:`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: keyboard
            }
        );
        
    } catch (error) {
        log.error('Qarzdorlik topilgan holatni boshlashda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// Excel yuklash
async function handleUploadExcel(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || !state.data || state.data.request_id !== requestId) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        stateManager.updateUserState(userId, STATES.UPLOAD_EXCEL);
        
        await bot.sendMessage(
            chatId,
            `📎 Excel faylni yuklang:\n\n` +
            `Shablon format:\n` +
            `- client_id (yoki id, code)\n` +
            `- client_name (yoki name, fio)\n` +
            `- debt_amount (yoki debt, qarz)\n\n` +
            `Yoki shablon yuklab olish uchun /debt_template yuboring.`
        );
        
    } catch (error) {
        log.error('Excel yuklashni boshlashda xatolik:', error);
    }
}

// Rasm yuklash
async function handleUploadImage(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || !state.data || state.data.request_id !== requestId) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        stateManager.updateUserState(userId, STATES.UPLOAD_IMAGE);
        
        await bot.sendMessage(
            chatId,
            `🖼 Rasm yuklang:\n\n` +
            `Qarzdorlik ma'lumotlari bo'lgan rasmni yuboring.`
        );
        
    } catch (error) {
        log.error('Rasm yuklashni boshlashda xatolik:', error);
    }
}

// Summa yozma kirish
async function handleEnterAmount(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || !state.data || state.data.request_id !== requestId) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        stateManager.updateUserState(userId, STATES.ENTER_AMOUNT);
        
        await bot.sendMessage(
            chatId,
            `✍️ Summa kiriting:\n\n` +
            `Masalan: -500000 yoki "Aliyev A → -150000, Karimov B → -90000"`
        );
        
    } catch (error) {
        log.error('Summa kirishni boshlashda xatolik:', error);
    }
}

// Excel fayl qabul qilish
async function handleExcelFile(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.UPLOAD_EXCEL) {
            return false;
        }
        
        if (!msg.document) {
            await bot.sendMessage(chatId, '❌ Excel fayl yuborilmadi.');
            return true;
        }
        
        const fileId = msg.document.file_id;
        const file = await bot.getFile(fileId);
        
        // Faylni yuklab olish
        const uploadsDir = path.join(__dirname, '../../../uploads/debt-approval');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const filePath = path.join(uploadsDir, `${Date.now()}_${msg.document.file_name}`);
        await bot.downloadFile(fileId, filePath);
        
        // Excel faylni o'qish
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);
        
        if (data.length === 0) {
            await bot.sendMessage(chatId, '❌ Excel fayl bo\'sh.');
            fs.unlinkSync(filePath);
            return true;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.PREVIEW, {
            excel_file: filePath,
            excel_data: data
        });
        
        // Preview ko'rsatish
        await showDebtPreview(chatId, userId, bot);
        
        return true;
        
    } catch (error) {
        log.error('Excel fayl qabul qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Excel faylni o\'qishda xatolik.');
        return true;
    }
}

// Rasm qabul qilish
async function handleImageFile(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.UPLOAD_IMAGE) {
            return false;
        }
        
        if (!msg.photo && !msg.document) {
            await bot.sendMessage(chatId, '❌ Rasm yuborilmadi.');
            return true;
        }
        
        const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
        const file = await bot.getFile(fileId);
        
        // Faylni yuklab olish
        const uploadsDir = path.join(__dirname, '../../../uploads/debt-approval');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const filePath = path.join(uploadsDir, `${Date.now()}_image.jpg`);
        await bot.downloadFile(fileId, filePath);
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.PREVIEW, { image_file: filePath });
        
        // Preview ko'rsatish
        await showDebtPreview(chatId, userId, bot);
        
        return true;
        
    } catch (error) {
        log.error('Rasm qabul qilishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Rasm yuklashda xatolik.');
        return true;
    }
}

// Summa yozma kirish
async function handleAmountText(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    try {
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || state.state !== STATES.ENTER_AMOUNT) {
            return false;
        }
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.PREVIEW, {
            amount: text,
            note: text
        });
        
        // Preview ko'rsatish
        await showDebtPreview(chatId, userId, bot);
        
        return true;
        
    } catch (error) {
        log.error('Summa qabul qilishda xatolik:', error);
        return false;
    }
}

// Preview ko'rsatish
async function showDebtPreview(chatId, userId, bot) {
    try {
        const state = stateManager.getUserState(userId);
        if (!state || !state.data || !state.data.request_id) return;
        
        const request = await db('debt_requests')
            .where('id', state.data.request_id)
            .first();
        
        const brand = await db('debt_brands').where('id', request.brand_id).first();
        const branch = await db('debt_branches').where('id', request.branch_id).first();
        const svr = await db('debt_svrs').where('id', request.svr_id).first();
        
        let previewText = `⚠️ QARZDORLIK ANIQLANDI\n\n`;
        previewText += `So\'rov: ${request.request_uid}\n`;
        previewText += `Brend: ${brand?.name || 'N/A'}\n`;
        previewText += `Filial: ${branch?.name || 'N/A'}\n`;
        previewText += `SVR: ${svr?.name || 'N/A'}\n\n`;
        
        if (state.data && state.data.excel_data) {
            previewText += `📎 Excel ma'lumotlari:\n`;
            state.data.excel_data.slice(0, 5).forEach((row, i) => {
                const clientName = row.client_name || row.name || row.fio || 'N/A';
                const debtAmount = row.debt_amount || row.debt || row.qarz || 'N/A';
                previewText += `${i + 1}. ${clientName} → ${debtAmount}\n`;
            });
            if (state.data.excel_data.length > 5) {
                previewText += `... va ${state.data.excel_data.length - 5} ta yana\n`;
            }
        } else if (state.data && state.data.image_file) {
            previewText += `🖼 Rasm yuklandi\n`;
        } else if (state.data && state.data.amount) {
            previewText += `✍️ Ma'lumot: ${state.data.amount}\n`;
        }
        
        previewText += `\n✅ Yuborishni tasdiqlaysizmi?`;
        
        const keyboard = debtPreviewKeyboard(state.data ? state.data.request_id : null);
        await bot.sendMessage(chatId, previewText, { reply_markup: keyboard });
        
    } catch (error) {
        log.error('Preview ko\'rsatishda xatolik:', error);
    }
}

// Qarzdorlik ma'lumotlarini yuborish
async function handleSendDebt(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split(':')[1]);
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Yuborilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || state.context !== stateManager.CONTEXTS.DEBT_APPROVAL || !state.data || state.data.request_id !== requestId) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // So\'rovni olish
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        // Status yangilash
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status: 'DEBT_FOUND',
                updated_at: new Date().toISOString()
            });
        
        // Attachment saqlash
        if (state.data.excel_file) {
            await db('debt_attachments').insert({
                request_id: requestId,
                type: 'excel',
                file_path: state.data.excel_file,
                created_at: new Date().toISOString()
            });
        }
        if (state.data && state.data.image_file) {
            await db('debt_attachments').insert({
                request_id: requestId,
                type: 'image',
                file_path: state.data.image_file,
                created_at: new Date().toISOString()
            });
        }
        
        // Debt report yaratish
        if (state.data && (state.data.excel_data || state.data.amount)) {
            await db('debt_debt_reports').insert({
                request_id: requestId,
                data: JSON.stringify(state.data.excel_data || { amount: state.data.amount }),
                note: state.data ? state.data.note : null,
                created_by: state.data ? state.data.user_id : null,
                created_at: new Date().toISOString()
            });
        }
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'debt_found',
            old_status: request.status,
            new_status: 'DEBT_FOUND',
            performed_by: state.data.user_id,
            note: state.data.note,
            created_at: new Date().toISOString()
        });
        
        // Nazoratchilarga yuborish
        const debtAccessFilter = require('../../../utils/debtAccessFilter.js');
        const supervisors = await debtAccessFilter.getSupervisorsForRequest(requestId, request.brand_id, request.branch_id);
        
        const brand = await db('debt_brands').where('id', request.brand_id).first();
        const branch = await db('debt_branches').where('id', request.branch_id).first();
        const svr = await db('debt_svrs').where('id', request.svr_id).first();
        
        let message = `⚠️ QARZDORLIK ANIQLANDI\n\n`;
        message += `So\'rov: ${request.request_uid}\n`;
        message += `Brend: ${brand?.name || 'N/A'}\n`;
        message += `Filial: ${branch?.name || 'N/A'}\n`;
        message += `SVR: ${svr?.name || 'N/A'}\n\n`;
        
        if (state.data && state.data.excel_data) {
            message += `Clientlar:\n`;
            state.data.excel_data.forEach(row => {
                const clientName = row.client_name || row.name || row.fio || 'N/A';
                const debtAmount = row.debt_amount || row.debt || row.qarz || 'N/A';
                message += `- ${clientName} → ${debtAmount}\n`;
            });
        } else if (state.data && state.data.amount) {
            message += `Ma'lumot: ${state.data.amount}\n`;
        }
        
        message += `\n⚠️ Sizning tasdig'ingiz kutilmoqda (Nazoratchi)`;
        
        if (supervisors.length > 0) {
            // Barcha nazoratchilarga bir vaqtda yuborish
            const { approvalKeyboard } = require('../keyboards.js');
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
            log.info(`✅ ${supervisors.length} ta nazoratchiga qarzdorlik xabari yuborildi`);
        } else {
            log.warn('⚠️ Nazoratchilar topilmadi, Manager\'ga to\'g\'ridan-to\'g\'ri yuborilmoqda');
            // Agar nazoratchilar bo'lmasa, Manager'ga to'g'ridan-to'g'ri yuborish
            const manager = await db('users')
                .where('id', request.created_by)
                .first();
            
            if (manager && manager.telegram_chat_id) {
                await bot.sendMessage(manager.telegram_chat_id, message);
            }
        }
        
        // Foydalanuvchiga javob
        await bot.editMessageText(
            `✅ Qarzdorlik ma'lumotlari yuborildi!\n\n📋 ID: ${request.request_uid}\n\nManager'ga xabar yuborildi.`,
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
        // State'ni tozalash
        delete userStates[userId];
        
    } catch (error) {
        log.error('Qarzdorlik ma\'lumotlarini yuborishda xatolik:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

// Bekor qilish
async function handleCancelDebt(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        delete userStates[userId];
        
        await bot.editMessageText(
            '❌ Qarzdorlik ma\'lumotlarini yuborish bekor qilindi.',
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
    } catch (error) {
        log.error('Qarzdorlik ma\'lumotlarini bekor qilishda xatolik:', error);
    }
}

module.exports = {
    handleDebtFound,
    handleUploadExcel,
    handleUploadImage,
    handleEnterAmount,
    handleExcelFile,
    handleImageFile,
    handleAmountText,
    handleSendDebt,
    handleCancelDebt,
    STATES
};

