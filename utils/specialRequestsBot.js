const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const { getSetting } = require('./settingsCache.js');
const { parseSpecialRequestFromBuffer, getCell, REQUIRED_COLUMNS } = require('./specialRequestsExcel.js');

const botLog = createLogger('SPECIAL_REQUESTS_BOT');
let bot = null;

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
    let filialButtons = [];
    try {
        const raw = await getSetting('special_requests_buttons', null);
        if (raw && typeof raw === 'string') buttons = JSON.parse(raw);
        else if (Array.isArray(raw)) buttons = raw;
    } catch (_) {}
    try {
        const raw = await getSetting('special_requests_filial_buttons', null);
        if (raw && typeof raw === 'string') filialButtons = JSON.parse(raw);
        else if (Array.isArray(raw)) filialButtons = raw;
    } catch (_) {}
    const sumFilterType = await getSetting('special_requests_sum_filter_type', '');
    const sumFilterValue = await getSetting('special_requests_sum_filter_value', '');
    return {
        token: (token && String(token).trim()) || null,
        enabled: String(enabled).toLowerCase() === 'true',
        groupId,
        buttons,
        filialButtons,
        sumFilterType: String(sumFilterType || '').trim(),
        sumFilterValue: String(sumFilterValue || '').trim()
    };
}

function buttonToUserMap(buttons) {
    const map = {};
    (buttons || []).forEach(b => {
        if (b && b.label && b.username) map[String(b.label).trim()] = String(b.username).trim().replace(/^@/, '');
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

/** Matnni maksimal uzunlikda qisqartirish (xabar qisqa bo'lishi uchun) */
function truncate(val, maxLen = 45) {
    const s = String(val == null ? '' : val).trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
}

/** Summani 3 xonali guruhda (o'qishga oson) */
function formatSumma(val) {
    const s = String(val == null ? '' : val).trim().replace(/\s/g, '');
    if (!s || !/^\d+$/.test(s)) return s || '0';
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Bir qator uchun guruhga yuboriladigan xabar matni
 * Zakaz_ID: № yoki Заказ ustunidan; Агент/Код qisqa va takrorlansiz.
 */
function formatRowMessage(row, headers, columns, senderLabel, brendUsername, filialUsername, rowKeyMap) {
    const get = (key) => getCell(row, headers, columns[key] != null ? columns[key] : -1, rowKeyMap);
    const qabul = [brendUsername, filialUsername].filter(Boolean).map(u => (u.startsWith('@') ? u : `@${u}`)).join(', ') || '-';
    const zakazId = get('№');
    const agent = get('Агент');
    const kodAgenta = get('Код агента');
    const agentShort = truncate(agent, 45);
    const kodShort = truncate(kodAgenta, 45);
    const agentLine = agentShort === kodShort ? `Агент/Код: ${agentShort}` : `Агент: ${agentShort}\nКод агента: ${kodShort}`;
    return (
        `YUBORUVCHI: ${senderLabel}\n` +
        `Qabul Qiluvchi: ${qabul}\n` +
        `Склад: ${truncate(get('Склад'), 30)}\n` +
        `BREND: ${truncate(get('Направление торговли'), 25)}\n` +
        `${agentLine}\n` +
        `Ид клиента: ${truncate(get('Ид клиента'), 35)}\n` +
        `Клиент: ${truncate(get('Клиент'), 35)}\n` +
        `Zakaz_ID: ${zakazId || '-'}\n` +
        `Экспедиторы: ${truncate(get('Экспедиторы'), 40)}\n` +
        `Территория: ${get('Территория')}\n` +
        `Сумма: ${formatSumma(get('Сумма'))}`
    );
}

async function initializeSpecialRequestsBot() {
    const { token, enabled, groupId, buttons, filialButtons, sumFilterType, sumFilterValue } = await getConfig();
    if (!enabled || !token || !groupId) {
        await stopSpecialRequestsBot();
        if (!enabled) botLog.info('Maxsus so\'rovlar boti o\'chirilgan');
        return;
    }

    const buttonMap = buttonToUserMap(buttons);
    const filialMap = buttonToUserMap(filialButtons);
    const buttonLabels = Object.keys(buttonMap);
    const sumFilterValueNum = parseFloat(String(sumFilterValue || '').replace(/\s/g, '').replace(/,/g, '.'));
    const sumFilter = (sumFilterType === 'eq' || sumFilterType === 'gte' || sumFilterType === 'lte') && Number.isFinite(sumFilterValueNum)
        ? { type: sumFilterType, value: sumFilterValueNum }
        : null;
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
        botLog.info('[SR_BOT] Maxsus so\'rovlar boti ishga tushirildi (faqat shaxsiy chat: fayl/xabar guruhda qabul qilinmaydi)');

        const isPrivateChat = (chat) => chat && chat.type === 'private';

        // Guruhda faqat tugmalar (callback) qabul qilinadi; /start va faylga javob berilmaydi
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const chatType = msg.chat?.type;
            botLog.info(`[SR_BOT] /start chatId=${chatId}, chatType=${chatType}`);
            if (!isPrivateChat(msg.chat)) {
                return; // guruhda hech narsa yubormaslik – faqat tugmalar ishlashi kerak
            }
            bot.sendMessage(chatId, 'Excel fayl (.xlsx yoki .xls) yuboring. Shartlar: Консигнация = "Да" va Тип = "Заказ" bo\'lgan qatorlar guruhga xabar sifatida yuboriladi.', {
                reply_markup: { remove_keyboard: true }
            });
        });

        // Fayllar navbatda qayta ishlanadi (bir vaqtda bitta), halokatlardan qochish
        const fileQueue = [];
        let fileProcessing = false;

        async function processNextFile() {
            if (fileProcessing || fileQueue.length === 0) return;
            fileProcessing = true;
            const job = fileQueue.shift();
            try {
                await processOneExcelFile(job);
            } catch (e) {
                botLog.error('[SR_BOT] Navbatda fayl qayta ishlashda xatolik:', e);
                if (job && job.chatId) {
                    await bot.sendMessage(job.chatId, `Xatolik: ${e.message || e}`).catch(() => {});
                }
            } finally {
                fileProcessing = false;
                if (fileQueue.length > 0) processNextFile();
            }
        }

        // Excel document – faqat shaxsiy chatda; guruhda e'tiborsiz
        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const fromId = msg.from?.id;
            if (!fromId) return;
            if (!isPrivateChat(msg.chat)) {
                return; // guruhdan faqat tugmalar qabul qilinadi – xabar/faylga javob yo'q
            }

            const doc = msg.document;
            if (!doc) return;

            const fileName = doc.file_name || '';
            const fileNameLower = fileName.toLowerCase();
            const isExcel = fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls');
            const mime = (doc.mime_type || '').toLowerCase();
            const isExcelMime = mime.includes('spreadsheet') || mime.includes('excel') || mime === 'application/vnd.ms-excel';
            if (!isExcel && !isExcelMime) {
                await bot.sendMessage(chatId, 'Iltimos, faqat Excel fayl yuboring (.xlsx yoki .xls).');
                return;
            }

            const placeInLine = (fileProcessing ? 1 : 0) + fileQueue.length + 1;
            fileQueue.push({ chatId, fromId, doc, msg });
            if (placeInLine > 1) {
                await bot.sendMessage(chatId, `Faylingiz qabul qilindi. Navbatda ${placeInLine}-o'rindasiz, tez orada qayta ishlanadi.`).catch(() => {});
            }
            processNextFile();
        });

        async function processOneExcelFile(job) {
            const { chatId, fromId, doc, msg } = job;
            const fileName = doc.file_name || '';
            const fileSize = doc.file_size;
            botLog.info(`[SR_BOT] Excel qayta ishlanmoqda: chatId=${chatId}, fileName=${fileName}, fileSize=${fileSize}, navbatda qolgan=${fileQueue.length}`);

            const senderLabel = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'Xodim');

            const fileId = doc.file_id;
            const fileInfo = await bot.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${fileInfo.file_path}`;
            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(response.data);

            const parseResult = parseSpecialRequestFromBuffer(buffer, sumFilter);
            if (!parseResult.ok) {
                const missing = (parseResult.missing || []).join(', ');
                await bot.sendMessage(
                    chatId,
                    `Faylda quyidagi ustunlar topilmadi: ${missing}\n\nIltimos, to'g'ri formatdagi Excel fayl yuboring.`
                );
                return;
            }

            const { columns, headers, filteredRows, rowKeyMap } = parseResult;
            if (!filteredRows || filteredRows.length === 0) {
                await bot.sendMessage(
                    chatId,
                    'Shartlarga muvofiq hech qanday qator topilmadi. (Консигнация = "Да" va Тип = "Заказ" bo\'lishi kerak.)'
                );
                return;
            }

            let sentCount = 0;
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

            for (let i = 0; i < filteredRows.length; i++) {
                const row = filteredRows[i];
                const brendVal = getCell(row, headers, columns['Направление торговли'], rowKeyMap);
                const territoriyaVal = getCell(row, headers, columns['Территория'], rowKeyMap);
                const brendUsername = (brendVal && buttonMap[String(brendVal).trim()]) || '';
                const filialUsername = (territoriyaVal && filialMap[String(territoriyaVal).trim()]) || '';

                const caption = formatRowMessage(row, headers, columns, senderLabel, brendUsername, filialUsername, rowKeyMap);
                try {
                    const groupMsg = await bot.sendMessage(groupId, caption, inlineKeyboard);
                    await db('special_requests_messages').insert({
                        group_message_id: groupMsg.message_id,
                        user_id: fromId,
                        caption
                    });
                    sentCount++;
                } catch (e) {
                    botLog.error('[SR_BOT] Guruhga xabar yuborishda xatolik:', e);
                }
            }

            const summary =
                sentCount > 0
                    ? `Sizning yuborgan faylingizdan shartlarga muvofiq ${sentCount} ta xabar yaratildi va guruhga yuborildi. Javob kutilmoqda.`
                    : 'Hech qanday xabar yuborilmadi.';
            await bot.sendMessage(chatId, summary);
        }

        bot.on('callback_query', async (query) => {
            const data = query.data;
            const msg = query.message;
            if (!data || !msg) return;
            await bot.answerCallbackQuery(query.id);

            const parts = data.split('_');
            const action = parts[0];
            const userId = parseInt(parts[1], 10);
            if (parts.length < 2 || (action !== 'approve' && action !== 'reject') || Number.isNaN(userId)) return;
            botLog.info(`[SR_BOT] Callback: action=${action}, userId=${userId}, group_message_id=${msg.message_id}`);

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
            const from = query.from;
            const who = from ? (from.username ? `@${from.username}` : (from.first_name || (from.last_name ? from.last_name : 'Noma\'lum'))) : 'Noma\'lum';
            const finalText = `${originalCaption}\n\nJavobi: ${replyStatus}\nJavob beruvchi: ${who}`;

            try {
                await bot.sendMessage(userId, finalText);
            } catch (_) {}

            const newCaption = (msg.text || '') + `\n\n${replyStatus}\nJavob beruvchi: ${who}`;
            await bot.editMessageText(newCaption, {
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
