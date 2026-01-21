// bot/debt-approval/handlers/registration.js

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const bcrypt = require('bcrypt');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');

const log = createLogger('DEBT_REG');

// Foydalanuvchi holatlari (FSM)
const STATES = {
    IDLE: 'idle',
    WAITING_FULLNAME: 'waiting_fullname',
    WAITING_USERNAME: 'waiting_username',
    WAITING_PASSWORD: 'waiting_password',
    WAITING_SECRET_WORD: 'waiting_secret_word',
    WAITING_CONFIRM: 'waiting_confirm',
    EDITING_FULLNAME: 'editing_fullname',
    EDITING_USERNAME: 'editing_username',
    EDITING_PASSWORD: 'editing_password',
    EDITING_SECRET_WORD: 'editing_secret_word'
};

// Foydalanuvchi xabarlarini saqlash (o'chirish uchun)
const userMessages = {};

// Ro'yxatdan o'tishni boshlash
async function handleRegistrationStart(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        // Foydalanuvchi allaqachon ro'yxatdan o'tganmi?
        const existingUser = await userHelper.getUserByTelegram(chatId, userId);
        if (existingUser) {
            if (existingUser.status === 'active') {
                // Eski xabarlarni tozalash (xavfsizlik uchun)
                await cleanupOldMessages(chatId, userId, bot);
                
                // Foydalanuvchiga biriktirilgan filial va brendlarni olish
                const db = require('../../../db.js').db;
                const userHelper = require('../../unified/userHelper.js');
                const [userBrandsRaw, userBranchesRaw, cashierBranchesRaw] = await Promise.all([
                    db('debt_user_brands')
                        .where('user_id', existingUser.id)
                        .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                        .select('debt_brands.id', 'debt_brands.name')
                        .groupBy('debt_brands.id', 'debt_brands.name')
                        .orderBy('debt_brands.name'),
                    db('debt_user_branches')
                        .where('user_id', existingUser.id)
                        .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                        .select('debt_branches.id', 'debt_branches.name')
                        .groupBy('debt_branches.id', 'debt_branches.name')
                        .orderBy('debt_branches.name'),
                    // Kassir uchun debt_cashiers jadvalidan ham filiallarni olish
                    userHelper.hasRole(existingUser, ['kassir', 'cashier']) 
                        ? db('debt_cashiers')
                            .where('user_id', existingUser.id)
                            .where('is_active', true)
                            .join('debt_branches', 'debt_cashiers.branch_id', 'debt_branches.id')
                            .select('debt_branches.id', 'debt_branches.name')
                            .groupBy('debt_branches.id', 'debt_branches.name')
                            .orderBy('debt_branches.name')
                        : Promise.resolve([])
                ]);
                
                // Dublikatlarni olib tashlash (ID bo'yicha)
                const uniqueBrandsMap = new Map();
                userBrandsRaw.forEach(brand => {
                    if (!uniqueBrandsMap.has(brand.id)) {
                        uniqueBrandsMap.set(brand.id, brand);
                    }
                });
                const userBrands = Array.from(uniqueBrandsMap.values());
                
                // Filiallarni birlashtirish (debt_user_branches va debt_cashiers dan)
                const allBranchesRaw = [...userBranchesRaw, ...cashierBranchesRaw];
                const uniqueBranchesMap = new Map();
                allBranchesRaw.forEach(branch => {
                    if (!uniqueBranchesMap.has(branch.id)) {
                        uniqueBranchesMap.set(branch.id, branch);
                    }
                });
                const userBranches = Array.from(uniqueBranchesMap.values());
                
                // Biriktirilgan filial va brendlarni formatlash
                let bindingsText = '';
                if (userBrands.length > 0 || userBranches.length > 0) {
                    bindingsText = `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                    if (userBrands.length > 0) {
                        const brandNames = userBrands.map(b => b.name).join(', ');
                        bindingsText += `🏷️ <b>Brendlar:</b> ${brandNames}\n`;
                    }
                    if (userBranches.length > 0) {
                        const branchNames = userBranches.map(b => b.name).join(', ');
                        bindingsText += `📍 <b>Filiallar:</b> ${branchNames}\n`;
                    }
                }
                
                // Active foydalanuvchilar uchun xabar yubormaslik kerak
                // Chunki /start handler allaqachon welcome xabarini yuboradi
                // Faqat /register buyrug'i bilan kelganda xabar yuboramiz
                const text = msg.text?.trim() || '';
                if (text === '/register' || text.toLowerCase().includes('register') || text.toLowerCase().includes('ro\'yxatdan o\'tish')) {
                const activeMessage = `✅ <b>Siz allaqachon ro'yxatdan o'tgansiz!</b>\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 <b>To'liq ism:</b> ${existingUser.fullname || 'Noma\'lum'}\n` +
                    `👔 <b>Rol:</b> <b>${existingUser.role || 'Tasdiqlanmagan'}</b>\n` +
                    `📊 <b>Holat:</b> <b>Faol</b>${bindingsText}\n\n` +
                    `💡 Tizimdan foydalanish uchun /start buyrug'ini yuboring.`;
                await bot.sendMessage(chatId, activeMessage, { parse_mode: 'HTML' });
                }
                return true;
            } else if (existingUser.status === 'pending_approval' || existingUser.status === 'pending_telegram_subscription') {
                    // Eski xabarlarni tozalash (xavfsizlik uchun)
                    await cleanupOldMessages(chatId, userId, bot);
                    
                    const pendingMessage = `⏳ <b>So'rovingiz ko'rib chiqilmoqda</b>\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `👤 <b>To'liq ism:</b> ${existingUser.fullname || 'Noma\'lum'}\n` +
                        `👔 <b>Rol:</b> ${existingUser.role || 'Tasdiqlanmagan'}\n` +
                        `📊 <b>Holat:</b> <b>Admin tasdig'ini kutmoqda</b>\n\n` +
                        `⏱️ Admin tomonidan tasdiqlangandan keyin sizga xabar yuboriladi.\n\n` +
                        `💡 Bu odatda 1-2 soat ichida amalga oshiriladi.`;
                    await bot.sendMessage(chatId, pendingMessage, { parse_mode: 'HTML' });
                return true;
            }
        }
        
        // Yangi ro'yxatdan o'tish jarayonini boshlash
        stateManager.setUserState(userId, stateManager.CONTEXTS.REGISTRATION, STATES.WAITING_FULLNAME, {});
        
        // Eski xabarlarni tozalash
        if (userMessages[userId]) {
            delete userMessages[userId];
        }
        userMessages[userId] = {};
        
        const welcomeMessage = `🎉 <b>Qarzdorlik Tasdiqlash Tizimiga Xush Kelibsiz!</b>\n\n` +
            `📝 <b>Ro'yxatdan o'tish jarayoni</b>\n\n` +
            `Sizga quyidagi ma'lumotlar kerak bo'ladi:\n` +
            `• To'liq ismingiz (FISH)\n` +
            `• Login (username)\n` +
            `• Parol\n` +
            `• Maxfiy so'z (xavfsizlik uchun)\n\n` +
            `⏱️ Jarayon 2-3 daqiqa davom etadi.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `1️⃣ <b>To'liq ismingiz (FISH):</b>\n` +
            `Masalan: Aliyev Ali Aliyevich`;
        
        const sentMessage = await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
        userMessages[userId].welcomeMessageId = sentMessage.message_id;
        return true;
    } catch (error) {
        log.error('Ro\'yxatdan o\'tishni boshlashda xatolik:', error);
        await bot.sendMessage(chatId, `❌ Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
        return false;
    }
}

// FISH (To'liq ism) qabul qilish
async function handleFullname(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fullname = msg.text?.trim();
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION) {
        return false;
    }
    if (state.state !== STATES.WAITING_FULLNAME && state.state !== STATES.EDITING_FULLNAME) {
        return false;
    }
    
    // Command'larni tekshirish - agar command bo'lsa, qabul qilmaslik
    if (fullname && (fullname.startsWith('/') || fullname.toLowerCase() === 'cancel' || fullname.toLowerCase() === 'bekor qilish')) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Iltimos, to'liq ismingizni kiriting.\n\n` +
            `Command'lar (masalan: /start, /register) qabul qilinmaydi.\n\n` +
            `💡 <b>Masalan:</b> <i>Aliyev Ali Aliyevich</i>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    if (!fullname || fullname.length < 3) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `To'liq ism kamida 3 belgidan iborat bo'lishi kerak.\n\n` +
            `Iltimos, qayta kiriting:\n` +
            `Masalan: <i>Aliyev Ali Aliyevich</i>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    stateManager.updateUserState(userId, STATES.WAITING_USERNAME, { fullname: fullname });
    
    // Eski xabarlarni o'chirish (xavfsizlik uchun)
    await cleanupOldMessages(chatId, userId, bot);
    
    const successMsg = `✅ To'liq ism qabul qilindi: <b>${fullname}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `2️⃣ <b>Login (username) kiriting:</b>\n\n` +
        `📌 <b>Qoidalar:</b>\n` +
        `• Faqat harflar, raqamlar va _ belgisi\n` +
        `• Kamida 3 belgi\n` +
        `• Katta-kichik harf farqi yo'q\n\n` +
        `💡 <b>Masalan:</b> <code>aliyev_ali</code> yoki <code>user123</code>`;
    
    const sentMessage = await bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
    if (!userMessages[userId]) {
        userMessages[userId] = {};
    }
    userMessages[userId].currentStepMessageId = sentMessage.message_id;
    
    return true;
}

// Username qabul qilish
async function handleUsername(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.text?.trim();
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION) {
        return false;
    }
    if (state.state !== STATES.WAITING_USERNAME && state.state !== STATES.EDITING_USERNAME) {
        return false;
    }
    
    // Command'larni tekshirish
    if (username && (username.startsWith('/') || username.toLowerCase() === 'cancel' || username.toLowerCase() === 'bekor qilish')) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Iltimos, login (username) kiriting.\n\n` +
            `Command'lar (masalan: /start, /register) qabul qilinmaydi.\n\n` +
            `💡 <b>Masalan:</b> <code>aliyev_ali</code> yoki <code>user123</code>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    if (!username || username.length < 3) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Username kamida 3 belgidan iborat bo'lishi kerak.\n\n` +
            `Iltimos, qayta kiriting:\n` +
            `💡 <b>Masalan:</b> <code>aliyev_ali</code>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    // Username formatini tekshirish (faqat harflar, raqamlar va _)
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Username faqat quyidagi belgilardan iborat bo'lishi kerak:\n` +
            `• Harflar (a-z, A-Z)\n` +
            `• Raqamlar (0-9)\n` +
            `• Pastki chiziq (_)\n\n` +
            `Iltimos, qayta kiriting:\n` +
            `💡 <b>Masalan:</b> <code>aliyev_ali</code> yoki <code>user123</code>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    // Username allaqachon mavjudmi?
    const existingUser = await db('users').where({ username: username.toLowerCase() }).first();
    if (existingUser) {
        const errorMsg = `❌ <b>Username band</b>\n\n` +
            `Bu username allaqachon ishlatilmoqda.\n\n` +
            `Iltimos, boshqa username kiriting:\n` +
            `💡 <b>Masalan:</b> <code>${username.toLowerCase()}_2024</code> yoki <code>${username.toLowerCase()}1</code>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    stateManager.updateUserState(userId, STATES.WAITING_PASSWORD, { username: username.toLowerCase() });
    
    // Eski xabarlarni o'chirish (xavfsizlik uchun)
    await cleanupOldMessages(chatId, userId, bot);
    
    const successMsg = `✅ Username qabul qilindi: <b>${username}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `3️⃣ <b>Parol kiriting:</b>\n\n` +
        `📌 <b>Qoidalar:</b>\n` +
        `• Kamida 8 belgi\n` +
        `• Kuchli parol tanlang\n\n` +
        `💡 <b>Masalan:</b> <code>MyP@ssw0rd</code> yoki <code>Secure123!</code>`;
    
    const sentMessage = await bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
    if (!userMessages[userId]) {
        userMessages[userId] = {};
    }
    userMessages[userId].currentStepMessageId = sentMessage.message_id;
    
    return true;
}

// Password qabul qilish
async function handlePassword(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const password = msg.text?.trim();
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION) {
        return false;
    }
    if (state.state !== STATES.WAITING_PASSWORD && state.state !== STATES.EDITING_PASSWORD) {
        return false;
    }
    
    // Command'larni tekshirish
    if (password && (password.startsWith('/') || password.toLowerCase() === 'cancel' || password.toLowerCase() === 'bekor qilish')) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Iltimos, parol kiriting.\n\n` +
            `Command'lar (masalan: /start, /register) qabul qilinmaydi.\n\n` +
            `💡 Kuchli parol tanlang (harflar, raqamlar, belgilar)`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    if (!password || password.length < 8) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Parol kamida 8 belgidan iborat bo'lishi kerak.\n\n` +
            `Iltimos, qayta kiriting:\n` +
            `💡 Kuchli parol tanlang (harflar, raqamlar, belgilar)`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    stateManager.updateUserState(userId, STATES.WAITING_SECRET_WORD, { password: password });
    
    // Eski xabarlarni o'chirish (xavfsizlik uchun)
    await cleanupOldMessages(chatId, userId, bot);
    
    const successMsg = `✅ Parol qabul qilindi\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `4️⃣ <b>Maxfiy so'z kiriting:</b>\n\n` +
        `📌 <b>Qoidalar:</b>\n` +
        `• Kamida 6 belgi\n` +
        `• Paroldan farq qilishi kerak\n` +
        `• Xavfsizlik uchun ishlatiladi\n\n` +
        `💡 <b>Masalan:</b> <code>Secret123</code> yoki <code>MySecret</code>`;
    
    const sentMessage = await bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
    if (!userMessages[userId]) {
        userMessages[userId] = {};
    }
    userMessages[userId].currentStepMessageId = sentMessage.message_id;
    
    return true;
}

// Maxfiy so'z qabul qilish
async function handleSecretWord(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const secretWord = msg.text?.trim();
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION) {
        return false;
    }
    if (state.state !== STATES.WAITING_SECRET_WORD && state.state !== STATES.EDITING_SECRET_WORD) {
        return false;
    }
    
    // Command'larni tekshirish
    if (secretWord && (secretWord.startsWith('/') || secretWord.toLowerCase() === 'cancel' || secretWord.toLowerCase() === 'bekor qilish')) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Iltimos, maxfiy so'z kiriting.\n\n` +
            `Command'lar (masalan: /start, /register) qabul qilinmaydi.\n\n` +
            `💡 <b>Masalan:</b> <code>Secret123</code> yoki <code>MySecret</code>`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    if (!secretWord || secretWord.length < 6) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Maxfiy so'z kamida 6 belgidan iborat bo'lishi kerak.\n\n` +
            `Iltimos, qayta kiriting:`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    // Parol va maxfiy so'z o'xshashligini tekshirish
    if (state.data && state.data.password && secretWord.toLowerCase() === state.data.password.toLowerCase()) {
        const errorMsg = `❌ <b>Xatolik</b>\n\n` +
            `Maxfiy so'z paroldan farq qilishi kerak.\n\n` +
            `Iltimos, boshqa maxfiy so'z kiriting:`;
        await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        return true;
    }
    
    stateManager.updateUserState(userId, STATES.WAITING_CONFIRM, { secret_word: secretWord });
    
    // Eski xabarlarni o'chirish (xavfsizlik uchun)
    await cleanupOldMessages(chatId, userId, bot);
    
    // Preview ko'rsatish
    const currentState = stateManager.getUserState(userId);
    const preview = `📋 <b>Ma'lumotlarni tekshiring</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 <b>To'liq ism:</b> ${currentState.data.fullname}\n` +
        `🔒 <b>Parol:</b> <code>${'•'.repeat(Math.min(currentState.data.password.length, 20))}</code>\n` +
        `🔐 <b>Maxfiy so'z:</b> <code>${'•'.repeat(Math.min(secretWord.length, 20))}</code>\n` +
        `📱 <b>Telegram:</b> ${msg.from.username ? '@' + msg.from.username : 'ID: ' + userId}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚠️ Ma'lumotlarni tekshiring. Tasdiqlangandan keyin o'zgartirib bo'lmaydi.\n\n` +
        `✅ <b>Tasdiqlash</b> - Ro'yxatdan o'tishni yakunlash\n` +
        `✏️ <b>O'zgartirish</b> - Ma'lumotlarni o'zgartirish\n` +
        `❌ <b>Bekor qilish</b> - Jarayonni to'xtatish`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "✅ Tasdiqlash va yuborish", callback_data: "debt_reg_confirm" }],
            [
                { text: "✏️ Ism", callback_data: "debt_reg_edit:fullname" },
                { text: "✏️ Login", callback_data: "debt_reg_edit:username" }
            ],
            [
                { text: "✏️ Parol", callback_data: "debt_reg_edit:password" },
                { text: "✏️ Maxfiy so'z", callback_data: "debt_reg_edit:secret_word" }
            ],
            [{ text: "❌ Bekor qilish", callback_data: "debt_reg_cancel" }]
        ]
    };
    
    const sentMessage = await bot.sendMessage(chatId, preview, { parse_mode: 'HTML', reply_markup: keyboard });
    if (!userMessages[userId]) {
        userMessages[userId] = {};
    }
    userMessages[userId].previewMessageId = sentMessage.message_id;
    
    return true;
}

// Eski xabarlarni tozalash funksiyasi (xavfsizlik uchun)
async function cleanupOldMessages(chatId, userId, bot) {
    try {
        // userMessages'dan saqlangan xabarlarni o'chirish
        if (userMessages[userId]) {
            const messagesToDelete = [];
            
            if (userMessages[userId].currentStepMessageId) {
                messagesToDelete.push(userMessages[userId].currentStepMessageId);
            }
            if (userMessages[userId].previewMessageId) {
                messagesToDelete.push(userMessages[userId].previewMessageId);
            }
            if (userMessages[userId].editMessageId) {
                messagesToDelete.push(userMessages[userId].editMessageId);
            }
            if (userMessages[userId].welcomeMessageId) {
                messagesToDelete.push(userMessages[userId].welcomeMessageId);
            }
            
            // Xabarlarni o'chirish
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms kutish
                } catch (e) {
                    // Xabarni o'chirib bo'lmasa, e'tiborsiz qoldirish
                }
            }
        }
        
        // getUpdates() orqali so'nggi xabarlarni olish va o'chirish (polling rejimida)
        if (bot.isPolling && bot.isPolling()) {
            try {
                const updates = await bot.getUpdates({ offset: -30, limit: 30 });
                const messagesToDelete = [];
                
                // Faqat joriy chat'dan va foydalanuvchidan kelgan xabarlarni to'plash
                for (const update of updates || []) {
                    if (update.message && 
                        update.message.chat.id === chatId && 
                        update.message.from.id === userId &&
                        update.message.message_id) {
                        messagesToDelete.push(update.message.message_id);
                    }
                }
                
                // Xabarlarni teskari tartibda o'chirish (eng eski avval)
                messagesToDelete.reverse();
                // Bir safarda 5 tagacha o'chirish
                for (const messageId of messagesToDelete.slice(0, 5)) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms kutish
                    } catch (deleteError) {
                        // Silent fail
                    }
                }
            } catch (getUpdatesError) {
                // getUpdates() ishlamasa, e'tiborsiz qoldirish
            }
        }
    } catch (error) {
        // Silent fail - cleanup ixtiyoriy
    }
}

// Ro'yxatdan o'tishni tasdiqlash
async function handleConfirmRegistration(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION || state.state !== STATES.WAITING_CONFIRM) {
        await bot.answerCallbackQuery(query.id, { text: 'Xatolik: Ma\'lumotlar topilmadi', show_alert: true });
        return false;
    }
    
    try {
        const { fullname, username, password, secret_word } = state.data;
        
        // Validatsiya
        if (!fullname || !username || !password || !secret_word) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Barcha maydonlar to\'ldirilishi kerak', show_alert: true });
            return false;
        }
        
        // Parol va maxfiy so'zni hash qilish
        const [hashedPassword, hashedSecretWord] = await Promise.all([
            bcrypt.hash(password, 10),
            bcrypt.hash(secret_word, 10)
        ]);
        
        // Foydalanuvchini database'ga saqlash
        const { isSqlite, isPostgres } = require('../../../db.js');
        let newUserId;
        if (isSqlite) {
            const insertedIds = await db('users').insert({
                username: username,
                password: hashedPassword,
                secret_word: hashedSecretWord,
                fullname: fullname,
                telegram_chat_id: chatId,
                telegram_username: query.from.username || null,
                role: 'pending',
                status: 'pending_approval',
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            });
            newUserId = Array.isArray(insertedIds) ? insertedIds[0] : insertedIds;
        } else {
            const result = await db('users').insert({
                username: username,
                password: hashedPassword,
                secret_word: hashedSecretWord,
                fullname: fullname,
                telegram_chat_id: chatId,
                telegram_username: query.from.username || null,
                role: 'pending',
                status: 'pending_approval',
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            }).returning('id');
            newUserId = result[0]?.id || result[0];
        }
        
        // Barcha eski xabarlarni o'chirish
        if (userMessages[userId]) {
            const messagesToDelete = [];
            if (userMessages[userId].previewMessageId) {
                messagesToDelete.push(userMessages[userId].previewMessageId);
            }
            if (userMessages[userId].editMessageId) {
                messagesToDelete.push(userMessages[userId].editMessageId);
            }
            if (userMessages[userId].welcomeMessageId) {
                messagesToDelete.push(userMessages[userId].welcomeMessageId);
            }
            if (userMessages[userId].currentStepMessageId) {
                messagesToDelete.push(userMessages[userId].currentStepMessageId);
            }
            
            // Preview xabarni ham o'chirish (agar mavjud bo'lsa)
            try {
                await bot.deleteMessage(chatId, query.message.message_id);
            } catch (e) {
                // Xabarni o'chirib bo'lmasa, e'tiborsiz qoldirish
            }
            
            // Barcha xabarlarni o'chirish (xavfsizlik uchun - login, parol, maxfiy so'z ko'rinmasligi uchun)
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                } catch (e) {
                    // Xabarni o'chirib bo'lmasa, e'tiborsiz qoldirish
                }
            }
        }
        
        // State va xabarlarni tozalash
        stateManager.clearUserState(userId);
        delete userMessages[userId];
        
        await bot.answerCallbackQuery(query.id, { text: '✅ Ro\'yxatdan o\'tish muvaffaqiyatli!', show_alert: true });
        
        const successMessage = `🎉 <b>Ro'yxatdan o'tish muvaffaqiyatli!</b>\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `✅ Ma'lumotlaringiz qabul qilindi va saqlandi.\n\n` +
            `📋 <b>Ma'lumotlaringiz:</b>\n` +
            `👤 To'liq ism: <b>${fullname}</b>\n` +
            `📱 Telegram: ${query.from.username ? '@' + query.from.username : 'ID: ' + userId}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `⏳ <b>Keyingi qadam:</b>\n` +
            `Sizning so'rovingiz admin tomonidan ko'rib chiqilmoqda.\n` +
            `Tasdiqlangandan keyin sizga xabar yuboriladi va tizimdan foydalanish imkoniyati beriladi.\n\n` +
            `💡 <b>Eslatma:</b>\n` +
            `• Admin tasdiqlashini kuting (odatda 1-2 soat)\n` +
            `• Login va parolingizni xavfsiz saqlang\n` +
            `• Maxfiy so'zingizni hech kimga bermang\n\n` +
            `📞 Savollar bo'lsa, administratorga murojaat qiling.`;
        
        await bot.sendMessage(chatId, successMessage, { parse_mode: 'HTML' });
        
        // Admin'ga xabar yuborish
        try {
            const { sendToTelegram } = require('../../../utils/bot.js');
            await sendToTelegram({
                type: 'new_user_request',
                user_id: newUserId,
                username: username,
                fullname: fullname
            });
        } catch (telegramError) {
            log.error('Admin\'ga xabar yuborishda xatolik:', telegramError);
        }
        
        return true;
    } catch (error) {
        log.error('Ro\'yxatdan o\'tishni saqlashda xatolik:', error);
        await bot.answerCallbackQuery(query.id, { text: '❌ Xatolik yuz berdi', show_alert: true });
        await bot.sendMessage(chatId, `❌ Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
        return false;
    }
}

// Ro'yxatdan o'tishni bekor qilish
async function handleCancelRegistration(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    // Barcha eski xabarlarni o'chirish
    if (userMessages[userId]) {
        const messagesToDelete = [];
        if (userMessages[userId].previewMessageId) {
            messagesToDelete.push(userMessages[userId].previewMessageId);
        }
        if (userMessages[userId].editMessageId) {
            messagesToDelete.push(userMessages[userId].editMessageId);
        }
            if (userMessages[userId].welcomeMessageId) {
                messagesToDelete.push(userMessages[userId].welcomeMessageId);
            }
            if (userMessages[userId].currentStepMessageId) {
                messagesToDelete.push(userMessages[userId].currentStepMessageId);
            }
            
            // Preview xabarni ham o'chirish (agar mavjud bo'lsa)
            try {
                await bot.deleteMessage(chatId, query.message.message_id);
            } catch (e) {
                // Xabarni o'chirib bo'lmasa, e'tiborsiz qoldirish
            }
            
            // Barcha xabarlarni o'chirish (xavfsizlik uchun - login, parol, maxfiy so'z ko'rinmasligi uchun)
            for (const messageId of messagesToDelete) {
                try {
                    await bot.deleteMessage(chatId, messageId);
                } catch (e) {
                    // Xabarni o'chirib bo'lmasa, e'tiborsiz qoldirish
                }
            }
        }
    
    stateManager.clearUserState(userId);
    delete userMessages[userId];
    
    await bot.answerCallbackQuery(query.id, { text: 'Ro\'yxatdan o\'tish bekor qilindi', show_alert: true });
    
    const cancelMessage = `❌ <b>Ro'yxatdan o'tish bekor qilindi</b>\n\n` +
        `Barcha kiritilgan ma'lumotlar o'chirildi.\n\n` +
        `Agar qayta ro'yxatdan o'tmoqchi bo'lsangiz, /register buyrug'ini yuboring.`;
    
    await bot.sendMessage(chatId, cancelMessage, { parse_mode: 'HTML' });
    return true;
}

// Ma'lumotlarni o'zgartirish
async function handleEditRegistration(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION || state.state !== STATES.WAITING_CONFIRM) {
        await bot.answerCallbackQuery(query.id, { text: 'Xatolik: Ma\'lumotlar topilmadi', show_alert: true });
        return false;
    }
    
    // Qaysi maydonni o'zgartirish kerak?
    const field = data.split(':')[1]; // debt_reg_edit:fullname -> fullname
    
    await bot.answerCallbackQuery(query.id);
    
    // Eski preview xabarni o'chirish
    try {
        await bot.deleteMessage(chatId, query.message.message_id);
    } catch (e) {
        // Xabarni o'chirib bo'lmasa, e'tiborsiz qoldirish
    }
    
    let editMessage = '';
    let newState = '';
    
    switch (field) {
        case 'fullname':
            newState = STATES.EDITING_FULLNAME;
            editMessage = `✏️ <b>To'liq ismni o'zgartirish</b>\n\n` +
                `Hozirgi ism: <b>${state.data.fullname}</b>\n\n` +
                `Yangi to'liq ismingizni kiriting:\n` +
                `Masalan: <i>Aliyev Ali Aliyevich</i>`;
            break;
        case 'username':
            newState = STATES.EDITING_USERNAME;
            editMessage = `✏️ <b>Login (username) o'zgartirish</b>\n\n` +
                `Hozirgi login: <b>${state.data ? state.data.username : 'N/A'}</b>\n\n` +
                `Yangi login kiriting:\n` +
                `💡 <b>Masalan:</b> <code>aliyev_ali</code>`;
            break;
        case 'password':
            newState = STATES.EDITING_PASSWORD;
            editMessage = `✏️ <b>Parol o'zgartirish</b>\n\n` +
                `Yangi parol kiriting:\n` +
                `📌 Kamida 8 belgi\n` +
                `💡 Kuchli parol tanlang`;
            break;
        case 'secret_word':
            newState = STATES.EDITING_SECRET_WORD;
            editMessage = `✏️ <b>Maxfiy so'z o'zgartirish</b>\n\n` +
                `Yangi maxfiy so'z kiriting:\n` +
                `📌 Kamida 6 belgi\n` +
                `📌 Paroldan farq qilishi kerak`;
            break;
        default:
            return false;
    }
    
    stateManager.updateUserState(userId, newState);
    
    const sentMessage = await bot.sendMessage(chatId, editMessage, { parse_mode: 'HTML' });
    
    // Xabarni saqlash
    if (!userMessages[userId]) {
        userMessages[userId] = {};
    }
    userMessages[userId].editMessageId = sentMessage.message_id;
    
    return true;
}

// Callback handler - registration callback query'larni boshqarish
async function handleRegistrationCallback(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    try {
        // Registration callback'larni boshqarish
        if (data === 'debt_reg_confirm') {
            return await handleConfirmRegistration(query, bot);
        }
        if (data === 'debt_reg_cancel') {
            return await handleCancelRegistration(query, bot);
        }
        if (data.startsWith('debt_reg_edit:')) {
            return await handleEditRegistration(query, bot);
        }
        
        return false;
    } catch (error) {
        log.error('Registration callback handle qilishda xatolik:', error);
        return false;
    }
}

// Message handler - FSM bo'yicha ma'lumotlarni qabul qilish
async function handleRegistrationMessage(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();
    
    const state = stateManager.getUserState(userId);
    if (!state || state.context !== stateManager.CONTEXTS.REGISTRATION) {
        return false;
    }
    
    // Agar command bo'lsa (masalan /start, /register, /cancel), registration jarayonini bekor qilish
    if (text && (text.startsWith('/') || text.toLowerCase() === 'cancel' || text.toLowerCase() === 'bekor qilish')) {
        const cancelMessage = `⚠️ <b>Ro'yxatdan o'tish bekor qilindi</b>\n\n` +
            `Command yuborilganda registration jarayoni to'xtatildi.\n\n` +
            `Agar qayta ro'yxatdan o'tmoqchi bo'lsangiz, /register buyrug'ini yuboring.`;
        await bot.sendMessage(chatId, cancelMessage, { parse_mode: 'HTML' });
        stateManager.clearUserState(userId);
        if (userMessages[userId]) {
            delete userMessages[userId];
        }
        return true;
    }
    
    try {
        switch (state.state) {
            case STATES.WAITING_FULLNAME:
            case STATES.EDITING_FULLNAME:
                return await handleFullname(msg, bot);
            case STATES.WAITING_USERNAME:
            case STATES.EDITING_USERNAME:
                return await handleUsername(msg, bot);
            case STATES.WAITING_PASSWORD:
            case STATES.EDITING_PASSWORD:
                return await handlePassword(msg, bot);
            case STATES.WAITING_SECRET_WORD:
            case STATES.EDITING_SECRET_WORD:
                return await handleSecretWord(msg, bot);
            default:
                return false;
        }
    } catch (error) {
        log.error('Registration message handle qilishda xatolik:', error);
        return false;
    }
}

module.exports = {
    STATES,
    handleRegistrationStart,
    handleRegistrationMessage,
    handleRegistrationCallback,
    handleConfirmRegistration,
    handleCancelRegistration,
    handleEditRegistration
};

