const TelegramBot = require('node-telegram-bot-api');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const { getSetting } = require('./settingsCache.js');

const botLog = createLogger('SPECIAL_REQUESTS_BOT');
let bot = null;

const userStates = {}; // { chatId: { selected: 'LLK' } }

async function getConfig() {
    const token = await getSetting('special_requests_bot_token', null);
    const enabled = await getSetting('special_requests_bot_enabled', 'false');
    const groupIdRaw = await getSetting('special_requests_group_id', '');
    let groupId = null;
    if (groupIdRaw && String(groupIdRaw).trim() !== '') {
        const n = parseInt(String(groupIdRaw).trim(), 10);
        if (!Number.isNaN(n)) groupId = n;
    }
    let buttons = [];
    try {
        const raw = await getSetting('special_requests_buttons', null);
        if (raw && typeof raw === 'string') buttons = JSON.parse(raw);
        else if (Array.isArray(raw)) buttons = raw;
    } catch (_) {}
    return { token: (token && String(token).trim()) || null, enabled: String(enabled).toLowerCase() === 'true', groupId, buttons };
}

function buttonToUserMap(buttons) {
    const map = {};
    (buttons || []).forEach(b => {
        if (b && b.label && b.username) map[String(b.label).trim()] = String(b.username).trim();
    });
    return map;
}

async function stopSpecialRequestsBot() {
    if (bot) {
        try {
            await bot.stopPolling();
            bot = null;
            botLog.info('Maxsus so\'rovlar boti to\'xtatildi');
        } catch (err) {
            botLog.error('Maxsus so\'rovlar botini to\'xtatishda xatolik:', err);
        }
    }
}

async function initializeSpecialRequestsBot() {
    const { token, enabled, groupId, buttons } = await getConfig();
    if (!enabled || !token || !groupId) {
        await stopSpecialRequestsBot();
        if (!enabled) botLog.info('Maxsus so\'rovlar boti o\'chirilgan');
        return;
    }

    const buttonMap = buttonToUserMap(buttons);
    const buttonLabels = Object.keys(buttonMap);
    if (buttonLabels.length === 0) {
        botLog.warn('Maxsus so\'rovlar: bo\'limlar bo\'sh, bot ishga tushmaydi');
        await stopSpecialRequestsBot();
        return;
    }

    try {
        await stopSpecialRequestsBot();
    } catch (_) {}

    try {
        bot = new TelegramBot(token, { polling: true });
        botLog.info('Maxsus so\'rovlar boti ishga tushirildi');

        const buildKeyboard = () => {
            const rows = [];
            for (let i = 0; i < buttonLabels.length; i += 3) {
                rows.push(buttonLabels.slice(i, i + 3).map(text => ({ text })));
            }
            return {
                reply_markup: {
                    keyboard: rows,
                    resize_keyboard: true
                }
            };
        };

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            delete userStates[chatId];
            bot.sendMessage(chatId, 'Tugmani tanlang:', buildKeyboard());
        });

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            if (!text || msg.photo || msg.document) return;

            if (text === '/start') return;

            if (buttonLabels.includes(text)) {
                userStates[chatId] = { selected: text };
                await bot.sendMessage(chatId, 'Endi rasm yoki screenshot + matn yuboring.');
                return;
            }

            const state = userStates[chatId];
            if (!state || !state.selected) {
                await bot.sendMessage(chatId, 'Avval tugmani tanlang.', buildKeyboard());
            }
        });

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const fromId = msg.from?.id;
            if (!fromId) return;

            const state = userStates[chatId];
            if (!state || !state.selected) return;

            const hasPhoto = msg.photo && msg.photo.length > 0;
            const hasDoc = msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/');
            if (!hasPhoto && !hasDoc) return;

            const caption = msg.caption || '';
            if (!caption.trim()) {
                await bot.sendMessage(chatId, 'Iltimos, matn bilan birga yuboring.');
                return;
            }

            const selected = state.selected;
            const receiver = buttonMap[selected];
            const username = msg.from.username ? `@${msg.from.username}` : 'user';

            const fullCaption =
                `${caption.trim()}\n\n` +
                `👤 ${username}\n` +
                `📌 Bo'lim: ${selected}\n` +
                `👨‍💼 Mas'ul: ${receiver || '-'}`;

            const inlineKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Tasdiqlash', callback_data: `approve_${fromId}` },
                            { text: '❌ Bekor qilish', callback_data: `reject_${fromId}` }
                        ]
                    ]
                }
            };

            try {
                let groupMsg;
                if (hasPhoto) {
                    const fileId = msg.photo[msg.photo.length - 1].file_id;
                    groupMsg = await bot.sendPhoto(groupId, fileId, { caption: fullCaption, ...inlineKeyboard });
                } else {
                    const fileId = msg.document.file_id;
                    groupMsg = await bot.sendDocument(groupId, fileId, { caption: fullCaption, ...inlineKeyboard });
                }

                await db('special_requests_messages').insert({
                    group_message_id: groupMsg.message_id,
                    user_id: fromId,
                    caption: caption.trim()
                });
                await bot.sendMessage(chatId, 'Xabaringiz guruhga yuborildi.');
                delete userStates[chatId];
            } catch (e) {
                botLog.error('Guruhga yuborishda xatolik:', e);
                await bot.sendMessage(chatId, `Xatolik: ${e.message || e}`);
            }
        });

        bot.on('callback_query', async (query) => {
            const data = query.data;
            const msg = query.message;
            if (!data || !msg) return;
            await bot.answerCallbackQuery(query.id);

            const parts = data.split('_');
            const action = parts[0];
            const userId = parseInt(parts[1], 10);
            if (parts.length < 2 || (action !== 'approve' && action !== 'reject') || Number.isNaN(userId)) return;

            const row = await db('special_requests_messages').where('group_message_id', msg.message_id).first();
            if (!row) {
                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: msg.chat.id,
                    message_id: msg.message_id
                }).catch(() => {});
                return;
            }

            const originalCaption = row.caption;
            const replyStatus = action === 'approve' ? '✅ TASDIQLANDI' : '❌ BEKOR QILINDI';
            const responseText = action === 'approve' ? '✅ Zakazingiz tasdiqlandi.' : '❌ Zakazingiz bekor qilindi.';
            const finalText = `${originalCaption}\n\nJavobi: ${replyStatus}`;

            try {
                await bot.sendMessage(userId, finalText);
            } catch (_) {}

            const newCaption = (msg.caption || '') + `\n\n${replyStatus}`;
            await bot.editMessageCaption(newCaption, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                reply_markup: { inline_keyboard: [] }
            }).catch(() => {});

            await db('special_requests_messages').where('group_message_id', msg.message_id).del();
        });
    } catch (err) {
        botLog.error('Maxsus so\'rovlar botini ishga tushirishda xatolik:', err);
        bot = null;
    }
}

module.exports = { initializeSpecialRequestsBot, stopSpecialRequestsBot, getConfig };
