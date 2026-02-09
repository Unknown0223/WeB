const TelegramBot = require('node-telegram-bot-api');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const { getSetting } = require('./settingsCache.js');

const botLog = createLogger('FEEDBACK_BOT');
let bot;

const userStates = {}; // { chatId: { step, type } }

const MESSAGES = {
    welcome: "🇺🇿 Assalomu alaykum! Taklif va shikoyatlar botiga xush kelibsiz. Bu bot orqali siz o'z fikr-mulohazalaringizni anonim tarzda yuborishingiz mumkin. Shaxsingizga oid ma'lumotlar saqlanmaydi.\n\n" +
        "🇷🇺 Здравствуйте! Добро пожаловать в бот предложений и жалоб. Через этот бот вы можете отправить свои отзывы анонимно. Ваша личная информация не сохраняется.\n\n" +
        "👇 🇺🇿 Iltimos, murojaat turini tanlang:\n" +
        "👇 🇷🇺 Пожалуйста, выберите тип обращения:",
    enter_message: "🇺🇿 Iltimos, o'z fikringizni yozib yuboring:\n" +
        "🇷🇺 Пожалуйста, напишите ваше сообщение:",
    thanks: "🇺🇿 Rahmat! Sizning murojaatingiz qabul qilindi.\n" +
        "🇷🇺 Спасибо! Ваше обращение принято.",
    error: "🇺🇿 Xatolik yuz berdi. Iltimos, keyinroq qayta urining.\n" +
        "🇷🇺 Произошла ошибка. Пожалуйста, попробуйте позже.",
    buttons: {
        taklif: "💡 Taklif / Предложение",
        shikoyat: "⚠️ Shikoyat / Жалоба"
    }
};

async function stopFeedbackBot() {
    if (bot) {
        try {
            await bot.stopPolling();
            bot = null;
            botLog.info('Feedback Bot to\'xtatildi');
        } catch (err) {
            botLog.error('Feedback Botni to\'xtatishda xatolik:', err);
        }
    }
}

async function initializeFeedbackBot(token) {
    if (!token) return;

    try {
        if (bot) {
            await bot.stopPolling();
        }

        bot = new TelegramBot(token, { polling: true });
        botLog.info('Feedback Bot ishga tushirildi');

        const mainKeyboard = {
            reply_markup: {
                keyboard: [
                    [{ text: MESSAGES.buttons.taklif }, { text: MESSAGES.buttons.shikoyat }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            userStates[chatId] = { step: 'start' };
            bot.sendMessage(chatId, MESSAGES.welcome, mainKeyboard);
        });

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            if (!text) return;
            if (text === '/start') return;

            const state = userStates[chatId] || { step: 'start' };

            // Tugmalarni tekshirish
            if (text === MESSAGES.buttons.taklif || text === MESSAGES.buttons.shikoyat) {
                const type = text === MESSAGES.buttons.taklif ? 'taklif' : 'shikoyat';
                userStates[chatId] = { step: 'message', type };

                bot.sendMessage(chatId, MESSAGES.enter_message, {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }

            // Xabarni qabul qilish
            if (state.step === 'message' && state.type) {
                try {
                    await db('feedbacks').insert({
                        username: msg.from.username || 'anonim',
                        fullname: 'Anonim', // Ism-sharif saqlanmaydi (user so'ragandek)
                        type: state.type,
                        message: text,
                        telegram_chat_id: chatId,
                        created_at: new Date()
                    });

                    bot.sendMessage(chatId, MESSAGES.thanks, mainKeyboard);
                    delete userStates[chatId];

                } catch (err) {
                    botLog.error('Feedback saqlashda xatolik:', err);
                    bot.sendMessage(chatId, MESSAGES.error, mainKeyboard);
                }
            } else if (!text.startsWith('/')) {
                // Agar hech qanday bosqichda bo'lmasa start xabarini ko'rsatish
                bot.sendMessage(chatId, MESSAGES.welcome, mainKeyboard);
            }
        });

    } catch (err) {
        botLog.error('Feedback Botni ishga tushirishda xatolik:', err);
    }
}

module.exports = { initializeFeedbackBot, stopFeedbackBot };
