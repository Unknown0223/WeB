// bot/debt-approval/handlers/preview.js
// Preview mexanizmi - barcha bosqichlarda preview ko'rsatish

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const { formatPreviewMessage, formatNormalRequestMessage, formatSetRequestMessage, formatDebtResponseMessage } = require('../../../utils/messageTemplates.js');
const { getPreviousMonthName } = require('../../../utils/dateHelper.js');

const log = createLogger('PREVIEW');

/**
 * Preview xabar yaratish
 */
function createPreviewMessage(requestData) {
    const { request_type, brand_name, filial_name, svr_name, extra_info, request_uid, debt_details, total_amount, excel_data, excel_headers, excel_columns } = requestData;
    
    const month_name = getPreviousMonthName();
    
    let message = formatPreviewMessage({
        request_uid: request_uid,
        brand_name: brand_name,
        filial_name: filial_name,
        svr_name: svr_name,
        month_name: month_name,
        debt_details: debt_details
    });
    
    // Excel ma'lumotlari mavjud bo'lsa
    if (excel_data && excel_data.length > 0 && excel_columns) {
        const { formatExcelData } = require('../../../utils/excelParser.js');
        const formattedData = formatExcelData(excel_data, excel_columns, excel_headers || [], 10);
        message += `\n\n${formattedData}`;
    }
    
    if (total_amount !== null && total_amount !== undefined) {
        message += `\n\nTOTAL: ${Math.abs(total_amount).toLocaleString('ru-RU')}`;
    }
    
    return message;
}

/**
 * Foydalanuvchiga preview yuborish
 */
async function sendPreviewToUser(userId, chatId, previewData) {
    try {
        const bot = getBot();
        if (!bot) {
            log.warn('Bot mavjud emas');
            return null;
        }
        
        const message = createPreviewMessage(previewData);
        
        // Knopkalar
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Yuborish', callback_data: `preview_confirm_${previewData.request_id || 'new'}` }],
                [{ text: '✏️ Tahrirlash', callback_data: `preview_edit_${previewData.request_id || 'new'}` }],
                [{ text: '❌ Bekor qilish', callback_data: `preview_cancel_${previewData.request_id || 'new'}` }]
            ]
        };
        
        const sentMessage = await bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        log.debug(`Preview sent to user: userId=${userId}, messageId=${sentMessage.message_id}`);
        
        return sentMessage;
    } catch (error) {
        log.error('Error sending preview to user:', error);
        throw error;
    }
}

/**
 * Preview xabarni yangilash
 */
async function updatePreviewMessage(messageId, chatId, newData) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
        const message = createPreviewMessage(newData);
        
        // Knopkalar
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Yuborish', callback_data: `preview_confirm_${newData.request_id || 'new'}` }],
                [{ text: '✏️ Tahrirlash', callback_data: `preview_edit_${newData.request_id || 'new'}` }],
                [{ text: '❌ Bekor qilish', callback_data: `preview_cancel_${newData.request_id || 'new'}` }]
            ]
        };
        
        try {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
            
            log.debug(`Preview message updated: messageId=${messageId}`);
        } catch (error) {
            // Agar xabarni yangilab bo'lmasa, yangi xabar yuborish
            log.debug(`Could not update preview message: ${error.message}`);
            return await sendPreviewToUser(null, chatId, newData);
        }
    } catch (error) {
        log.error('Error updating preview message:', error);
        throw error;
    }
}

/**
 * Preview'ni tasdiqlash va yuborish
 */
async function confirmAndSend(requestId, userId, chatId) {
    try {
        const request = await db('debt_requests').where('id', requestId).first();
        if (!request) {
            throw new Error('So\'rov topilmadi');
        }
        
        // Preview xabarni o'chirish (agar mavjud bo'lsa)
        if (request.preview_message_id) {
            const bot = getBot();
            if (bot) {
                try {
                    await bot.deleteMessage(chatId, request.preview_message_id);
                } catch (error) {
                    log.debug(`Could not delete preview message: ${error.message}`);
                }
            }
        }
        
        // So'rovni yuborish (keyingi bosqichga)
        // Bu funksiya keyingi handler'larda implement qilinadi
        
        log.info(`Preview confirmed and sent: requestId=${requestId}, userId=${userId}`);
        
        return true;
    } catch (error) {
        log.error('Error confirming and sending preview:', error);
        throw error;
    }
}

module.exports = {
    createPreviewMessage,
    sendPreviewToUser,
    updatePreviewMessage,
    confirmAndSend
};

