const TelegramBot = require('node-telegram-bot-api');
const { db } = require('../db.js');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { URL } = require('url');
const path = require('path');
const { format } = require('date-fns');
const { createLogger } = require('./logger.js');

const botLog = createLogger('BOT');
let bot;
let botIsInitialized = false;
let pollingConflictHandled = false; // 409 Conflict xatolikni bir marta handle qilish uchun

const userStates = {}; // Adminning holatini saqlash uchun
const NODE_SERVER_URL = process.env.APP_BASE_URL || "http://127.0.0.1:3000/";

// Esirgan tokenlarni avtomatik tozalash (har 1 soatda bir marta)
let cleanupInterval = null;
function startTokenCleanup() {
    if (cleanupInterval) return; // Allaqachon ishlamoqda
    
    cleanupInterval = setInterval(async () => {
        try {
            const deletedCount = await db('magic_links')
                .where('expires_at', '<', new Date().toISOString())
                .where('token', 'like', 'bot_connect_%')
                .del();
            
            if (deletedCount > 0) {
                botLog.info(`[CLEANUP] ${deletedCount} ta eskirgan bot_connect token o'chirildi`);
            }
        } catch (error) {
            botLog.error(`[CLEANUP] Esirgan tokenlarni tozalashda xatolik: ${error.message}`);
        }
    }, 60 * 60 * 1000); // 1 soat
    
    botLog.info('[CLEANUP] Esirgan tokenlarni avtomatik tozalash mexanizmi ishga tushirildi');
}

function stopTokenCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        botLog.info('[CLEANUP] Esirgan tokenlarni avtomatik tozalash mexanizmi to\'xtatildi');
    }
}

// --- Yordamchi funksiyalar ---

function escapeHtml(text  ) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Brend nomi va qiymat o'rtasida nuqtalar bilan to'ldirish
function formatBrandLine(brandName, value, maxLength = 30) {
    const dots = '.'.repeat(Math.max(1, maxLength - brandName.length - value.length));
    return `${escapeHtml(brandName)} ${dots} ${value}`;
}

// Filiallar tugmalarini yaratish (grid formatida)
function createLocationButtons(locations, selectedLocations = []) {
    const buttons = [];
    const isSelected = (loc) => selectedLocations.includes(loc);
    
    if (locations.length <= 5) {
        // 5 tagacha - list formatida
        return locations.map(loc => ([{ 
            text: `${isSelected(loc) ? '✔️ ' : ''}${escapeHtml(loc)}`, 
            callback_data: `loc_${loc}` 
        }]));
    } else if (locations.length <= 8) {
        // 8 tagacha - grid 2 ustunli
        for (let i = 0; i < locations.length; i += 2) {
            const row = [];
            row.push({ 
                text: `${isSelected(locations[i]) ? '✔️ ' : ''}${escapeHtml(locations[i])}`, 
                callback_data: `loc_${locations[i]}` 
            });
            if (i + 1 < locations.length) {
                row.push({ 
                    text: `${isSelected(locations[i + 1]) ? '✔️ ' : ''}${escapeHtml(locations[i + 1])}`, 
                    callback_data: `loc_${locations[i + 1]}` 
                });
            }
            buttons.push(row);
        }
    } else {
        // Undan oshiq - grid 3 ustunli
        for (let i = 0; i < locations.length; i += 3) {
            const row = [];
            row.push({ 
                text: `${isSelected(locations[i]) ? '✔️ ' : ''}${escapeHtml(locations[i])}`, 
                callback_data: `loc_${locations[i]}` 
            });
            if (i + 1 < locations.length) {
                row.push({ 
                    text: `${isSelected(locations[i + 1]) ? '✔️ ' : ''}${escapeHtml(locations[i + 1])}`, 
                    callback_data: `loc_${locations[i + 1]}` 
                });
            }
            if (i + 2 < locations.length) {
                row.push({ 
                    text: `${isSelected(locations[i + 2]) ? '✔️ ' : ''}${escapeHtml(locations[i + 2])}`, 
                    callback_data: `loc_${locations[i + 2]}` 
                });
            }
            buttons.push(row);
        }
    }
    return buttons;
}

// Brendlar tugmalarini yaratish (grid formatida)
function createBrandButtons(brands, selectedBrands = []) {
    const buttons = [];
    const isSelected = (brandId) => selectedBrands.includes(brandId);
    
    if (brands.length <= 5) {
        // 5 tagacha - list formatida
        return brands.map(brand => ([{ 
            text: `${isSelected(brand.id) ? '✔️ ' : ''}${brand.emoji || '🏷️'} ${escapeHtml(brand.name)}`,
            callback_data: `brand_${brand.id}` 
        }]));
    } else if (brands.length <= 8) {
        // 8 tagacha - grid 2 ustunli
        for (let i = 0; i < brands.length; i += 2) {
            const row = [];
            row.push({ 
                text: `${isSelected(brands[i].id) ? '✔️ ' : ''}${brands[i].emoji || '🏷️'} ${escapeHtml(brands[i].name)}`,
                callback_data: `brand_${brands[i].id}` 
            });
            if (i + 1 < brands.length) {
                row.push({ 
                    text: `${isSelected(brands[i + 1].id) ? '✔️ ' : ''}${brands[i + 1].emoji || '🏷️'} ${escapeHtml(brands[i + 1].name)}`,
                    callback_data: `brand_${brands[i + 1].id}` 
                });
            }
            buttons.push(row);
        }
    } else {
        // Undan oshiq - grid 3 ustunli
        for (let i = 0; i < brands.length; i += 3) {
            const row = [];
            row.push({ 
                text: `${isSelected(brands[i].id) ? '✔️ ' : ''}${brands[i].emoji || '🏷️'} ${escapeHtml(brands[i].name)}`,
                callback_data: `brand_${brands[i].id}` 
            });
            if (i + 1 < brands.length) {
                row.push({ 
                    text: `${isSelected(brands[i + 1].id) ? '✔️ ' : ''}${brands[i + 1].emoji || '🏷️'} ${escapeHtml(brands[i + 1].name)}`,
                    callback_data: `brand_${brands[i + 1].id}` 
                });
            }
            if (i + 2 < brands.length) {
                row.push({ 
                    text: `${isSelected(brands[i + 2].id) ? '✔️ ' : ''}${brands[i + 2].emoji || '🏷️'} ${escapeHtml(brands[i + 2].name)}`,
                    callback_data: `brand_${brands[i + 2].id}` 
                });
            }
            buttons.push(row);
        }
    }
    return buttons;
}

async function safeSendMessage(chatId, text, options = {}) {
    if (!bot || !botIsInitialized) {
        return null;
    }
    
    try {
        const result = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
        return result;
    } catch (error) {
        const body = error.response?.body;
        botLog.error(`Telegram API xatolik:`, {
            error_code: body?.error_code,
            description: body?.description,
            message: error.message,
            chatId: chatId
        });
        
        if (body?.error_code === 403) {
            await db('users').where({ telegram_chat_id: chatId }).update({ telegram_chat_id: null, telegram_username: null });
        } else if (body?.error_code === 400) {
            botLog.error(`Bad Request (400). Chat ID: ${chatId}, Description: ${body?.description}`);
            if (body?.description?.includes("group chat was upgraded to a supergroup chat")) {
                botLog.warn(`Guruh supergroup'ga o'zgartirilgan. Eski chat ID: ${chatId}`);
            }
        } else {
            botLog.error(`Telegramga xabar yuborishda xatolik (chat_id: ${chatId}): ${body?.description || error.message}`);
            if (String(body?.description).includes("can't parse entities")) {
                try {
                    const plainText = text.replace(/<[^>]*>/g, '');
                    const fallbackResult = await bot.sendMessage(chatId, plainText, { ...options, parse_mode: undefined });
                    return fallbackResult;
                } catch (fallbackError) {
                    botLog.error(`Oddiy matn rejimida ham yuborib bo'lmadi:`, fallbackError.response?.body || fallbackError.message);
                }
            }
        }
        return null;
    }
}

// --- Asosiy mantiq funksiyalari ---

// ===================================================================
// === HISOBOTNI FORMATLASH FUNKSIYASI (YANGILANGAN VERSIYA) ===
// ===================================================================
async function formatAndSendReport(payload) {
    // `old_report_date` va `old_location` payload'dan olinmoqda
    const { type, report_id, location, date, author, author_id, data, old_data, settings, group_id, old_report_date, old_location, brand_name, old_brand_name, currency } = payload;
    

    
    // Valyuta formatlash uchun
    const { formatCurrency, BASE_CURRENCY } = require('./exchangeRates.js');
    const reportCurrency = currency || BASE_CURRENCY;
    // Konvertatsiya qilmaslik kerak - qiymatlar allaqachon tanlangan valyutada saqlangan
    
    // Foydalanuvchi ma'lumotlarini olish (FISH va Telegram username uchun)
    let userFullname = author;
    let userTelegramUsername = null;
    
    try {
        let user;
        if (author_id) {
            user = await db('users').where({ id: author_id }).select('fullname', 'telegram_username', 'username').first();
        } else if (author) {
            // Agar author_id bo'lmasa, username orqali qidirish
            user = await db('users').where({ username: author }).select('fullname', 'telegram_username', 'username').first();
        }
        
        if (user) {
            userFullname = user.fullname || user.username || author;
            userTelegramUsername = user.telegram_username;
        }
    } catch (error) {
        botLog.error('Foydalanuvchi ma\'lumotlarini olishda xatolik:', error.message);
    }
    
    let messageText = '';
    const reportRowsOrder = settings.rows || [];
    
    // Brendlarni database'dan olish
    let brandsMap = {}; // { brand_id: brand_name }
    try {
        const brands = await db('brands').select('id', 'name');
        brands.forEach(b => {
            brandsMap[b.id] = b.name;
        });
    } catch (error) {
        botLog.error('Brendlarni olishda xatolik:', error.message);
    }

    if (type === 'new') {
        const formattedDate = format(new Date(date), 'dd.MM.yyyy');
        
        messageText += `<b>${escapeHtml(location.toUpperCase())} filiali</b>\n`;
        if (brand_name) {
            messageText += `🏢 Brend: <b>${escapeHtml(brand_name)}</b>\n`;
        }
        messageText += `${formattedDate} uchun yangi hisobot\n`;
        messageText += `Hisobot #${String(report_id).padStart(4, '0')}\n\n`;
        messageText += `👤 Kiritdi: <b>${escapeHtml(userFullname)}</b>\n`;
        if (userTelegramUsername) {
            messageText += `📱 @${escapeHtml(userTelegramUsername)}\n`;
        }
        messageText += `\n`;

        let grandTotal = 0;
        
        // YANGI: Brendlar bo'yicha ma'lumotlarni ajratish
        const brandTotals = {}; // { brandId: { brandTotal, columns: { colName: value } } }
        
        // Ma'lumotlarni brendlar bo'yicha guruhlash
        for (const key in data) {
            const value = data[key] || 0;
            const parts = key.split('_');
            if (parts.length >= 2) {
                const brandId = parts[0];
                const colName = parts.slice(1).join('_');
                
                if (!brandTotals[brandId]) {
                    brandTotals[brandId] = { brandTotal: 0, columns: {} };
                }
                
                brandTotals[brandId].columns[colName] = value;
                brandTotals[brandId].brandTotal += value;
                grandTotal += value;
            }
        }
        
        // Brendlar bo'yicha ko'rsatish (ustun tekis, ikki nuqta bilan)
        messageText += `<b>Yangilangan summalar:</b>\n\n`;
        
        const sortedBrandIds = Object.keys(brandTotals).sort((a, b) => a - b);
        const brandLines = [];
        
        // Eng uzun brend nomini va eng uzun qiymatni topish (ustun tekisligi uchun)
        let maxBrandNameLength = 0;
        let maxValueLength = 0;
        const brandValues = [];
        
        for (const brandId of sortedBrandIds) {
            const { brandTotal } = brandTotals[brandId];
            if (brandTotal > 0) {
                const brandName = brandsMap[brandId] || `Brend #${brandId}`;
                const formattedValue = formatCurrency(brandTotal, reportCurrency);
                maxBrandNameLength = Math.max(maxBrandNameLength, brandName.length);
                maxValueLength = Math.max(maxValueLength, formattedValue.length);
                brandValues.push({ brandName, formattedValue });
            }
        }
        
        // Har bir brend uchun formatlash (ustun tekis - brend nomlari va qiymatlar)
        for (const { brandName, formattedValue } of brandValues) {
            const brandSpaces = ' '.repeat(maxBrandNameLength - brandName.length);
            const valueSpaces = ' '.repeat(maxValueLength - formattedValue.length);
            brandLines.push(`${escapeHtml(brandName)}${brandSpaces}: ${valueSpaces}<code>${formattedValue}</code>`);
        }
        
        // Har bir brend alohida qatorda
        messageText += brandLines.join('\n') + `\n\n`;

        // Jami summa - qiymat allaqachon tanlangan valyutada, konvertatsiya qilmaslik kerak
        messageText += `💰 <b>JAMI:</b> <code>${formatCurrency(grandTotal, reportCurrency)}</code>`;

    } else if (type === 'edit') {
        messageText += `✍️ <b>Hisobot Tahrirlandi #${String(report_id).padStart(4, '0')}</b>\n`;
        messageText += `👤 O'zgartirdi: <b>${escapeHtml(userFullname)}</b>\n`;
        if (userTelegramUsername) {
            messageText += `📱 @${escapeHtml(userTelegramUsername)}\n`;
        }
        messageText += `\n`;
        
        const changes = [];

        // === O'ZGARTIRISH: Filial o'zgarishini tekshirish ===
        if (old_location && location !== old_location) {
            changes.push(`Filial: <s>${escapeHtml(old_location)}</s> → <b>${escapeHtml(location)}</b>`);
        }

        // === O'ZGARTIRISH: Sana o'zgarishini tekshirish ===
        if (old_report_date && date !== old_report_date) {
            const formattedOldDate = format(new Date(old_report_date), 'dd.MM.yyyy');
            const formattedNewDate = format(new Date(date), 'dd.MM.yyyy');
            changes.push(`Sana: <s>${formattedOldDate}</s> → <b>${formattedNewDate}</b>`);
        }

        // === Brend o'zgarishini tekshirish ===
        if (old_brand_name !== brand_name) {
            const oldBrand = old_brand_name || 'Ko\'rsatilmagan';
            const newBrand = brand_name || 'Ko\'rsatilmagan';
            changes.push(`Brend: <s>${escapeHtml(oldBrand)}</s> → <b>${escapeHtml(newBrand)}</b>`);
        } else if (brand_name) {
            messageText += `🏢 Brend: <b>${escapeHtml(brand_name)}</b>\n`;
        }

        if (changes.length > 0) {
            messageText += `<b>O'zgargan ma'lumotlar:</b>\n${changes.join('\n')}\n\n`;
        }
        
        messageText += `<b>Yangilangan summalar:</b>\n\n`;

        let newGrandTotal = 0;
        let oldGrandTotal = 0;
        
        // Brendlar bo'yicha ma'lumotlarni ajratish
        const brandChanges = {}; // { brandId: { newTotal, oldTotal, columns: {...} } }
        
        // Yangi va eski ma'lumotlarni brendlar bo'yicha guruhlash
        const allKeys = new Set([...Object.keys(data), ...Object.keys(old_data)]);
        
        for (const key of allKeys) {
            const newValue = data[key] || 0;
            const oldValue = old_data[key] || 0;
            const parts = key.split('_');
            
            if (parts.length >= 2) {
                const brandId = parts[0];
                const colName = parts.slice(1).join('_');
                
                if (!brandChanges[brandId]) {
                    brandChanges[brandId] = { newTotal: 0, oldTotal: 0, columns: {} };
                }
                
                brandChanges[brandId].columns[colName] = { newValue, oldValue };
                brandChanges[brandId].newTotal += newValue;
                brandChanges[brandId].oldTotal += oldValue;
                
                newGrandTotal += newValue;
                oldGrandTotal += oldValue;
            }
        }
        
        // Brendlar bo'yicha o'zgarishlarni ko'rsatish (ustun tekis, ikki nuqta bilan)
        const sortedBrandIds = Object.keys(brandChanges).sort((a, b) => a - b);
        const brandLines = [];
        const brandData = [];
        
        // Ma'lumotlarni to'plash
        for (const brandId of sortedBrandIds) {
            const { newTotal, oldTotal } = brandChanges[brandId];
            
            if (newTotal > 0 || oldTotal > 0) {
                const brandName = brandsMap[brandId] || `Brend #${brandId}`;
                const formattedNewValue = formatCurrency(newTotal, reportCurrency);
                const formattedOldValue = formatCurrency(oldTotal, reportCurrency);
                brandData.push({ brandName, newTotal, oldTotal, formattedNewValue, formattedOldValue });
            }
        }
        
        // Eng uzun brend nomini va eng uzun qiymat kombinatsiyasini topish (ustun tekisligi uchun)
        let maxBrandNameLength = 0;
        let maxValueLength = 0;
        for (const { brandName, formattedNewValue, formattedOldValue, newTotal, oldTotal } of brandData) {
            maxBrandNameLength = Math.max(maxBrandNameLength, brandName.length);
            
            if (newTotal !== oldTotal) {
                // O'zgarishlar uchun: oldValue + " → " + newValue + " ➕" (HTML tag'larsiz uzunlik)
                // " → " = 3 belgi, " ➕" = 2 belgi, jami 5 belgi
                const changeLength = formattedOldValue.length + formattedNewValue.length + 5;
                maxValueLength = Math.max(maxValueLength, changeLength);
            } else {
                // O'zgarish yo'q
                maxValueLength = Math.max(maxValueLength, formattedNewValue.length);
            }
        }
        
        // Har bir brend uchun formatlash (ustun tekis - brend nomlari va qiymatlar)
        for (const { brandName, newTotal, oldTotal, formattedNewValue, formattedOldValue } of brandData) {
            const brandSpaces = ' '.repeat(maxBrandNameLength - brandName.length);
            
            if (newTotal !== oldTotal) {
                const sign = newTotal > oldTotal ? '➕' : '➖';
                // HTML tag'larsiz uzunlikni hisoblash (faqat matn uzunligi)
                const changeText = `${formattedOldValue} → ${formattedNewValue} ${sign}`;
                const changeLength = changeText.length;
                const valueSpaces = ' '.repeat(maxValueLength - changeLength);
                brandLines.push(`${escapeHtml(brandName)}${brandSpaces}: ${valueSpaces}<s>${formattedOldValue}</s> → <code>${formattedNewValue}</code> ${sign}`);
            } else {
                const valueSpaces = ' '.repeat(maxValueLength - formattedNewValue.length);
                brandLines.push(`${escapeHtml(brandName)}${brandSpaces}: ${valueSpaces}<code>${formattedNewValue}</code>`);
            }
        }
        
        // Har bir brend alohida qatorda
        messageText += brandLines.join('\n') + `\n\n`;
        
        // Jami summalar - qiymatlar allaqachon tanlangan valyutada, konvertatsiya qilmaslik kerak
        const difference = newGrandTotal - oldGrandTotal;
        let diffText = '';
        if (difference > 0) {
            diffText = `<b>▲ ${formatCurrency(difference, reportCurrency)}</b>`;
        } else if (difference < 0) {
            diffText = `<b>▼ ${formatCurrency(Math.abs(difference), reportCurrency)}</b>`;
        }

        messageText += `💰 <b>JAMI:</b> <code>${formatCurrency(newGrandTotal, reportCurrency)}</code>  ${diffText}`;
    }

    if (messageText) {


        const result = await safeSendMessage(group_id, messageText);
        if (!result) {
            botLog.error(`Xabar yuborilmadi. Result: null`);
        }
    } else {

    }
}


async function handleSecurityRequest(payload) {
    const { type, chat_id, admin_chat_id, user_id, username, fullname, token, password, secret_word } = payload;
    let text, keyboard;

    function escapeMarkdownV2(text) {
        if (!text) return "";
        return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }

    async function sendMarkdownV2Message(chatId, text, options = {}) {

        
        if (!bot || !botIsInitialized) {

            return null;
        }
        
        try {

            const result = await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', ...options });

            return result;
        } catch (error) {
            const body = error.response?.body;
            botLog.error(`MarkdownV2 xabar yuborishda xatolik (chat_id: ${chatId}):`, {
                error_code: body?.error_code,
                description: body?.description,
                message: error.message
            });
            
            return null;
        }
    }

    switch (type) {
        case 'secret_word_request':
            userStates[chat_id] = { state: 'awaiting_secret_word', user_id, attempts_left: 2 };
            text = `Salom, *${escapeMarkdownV2(username)}*\\! \n\n${escapeMarkdownV2("Tizimga yangi qurilmadan kirishga urinish aniqlandi. Xavfsizlikni tasdiqlash uchun, iltimos, ")}*${escapeMarkdownV2("maxfiy so'zingizni")}*${escapeMarkdownV2(" shu botga yozib yuboring.")}`;
            await sendMarkdownV2Message(chat_id, text);
            break;

        case 'magic_link_request':

            const magicLink = new URL(path.join('api/verify-session/', token), NODE_SERVER_URL).href;
            text = `Salom, *${escapeMarkdownV2(username)}*\\! \n\n${escapeMarkdownV2("Yangi qurilmadan kirishni tasdiqlash uchun quyidagi tugmani bosing. Bu havola 5 daqiqa amal qiladi.")}`;
            keyboard = { inline_keyboard: [[{ text: "✅ Yangi Qurilmada Kirish", url: magicLink }]] };
            const magicLinkResult = await sendMarkdownV2Message(chat_id, text, { reply_markup: keyboard });
            if (!magicLinkResult) {
                botLog.error(`Magic link yuborilmadi. Chat ID: ${chat_id}`);
            }
            break;

        case 'security_alert':

            text = `⚠️ *${escapeMarkdownV2("Xavfsizlik Ogohlantirishi!")}* \n\n*${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(username)} \\(ID: ${user_id}\\)\n*${escapeMarkdownV2("Holat:")}* ${escapeMarkdownV2("Akkauntga kirish uchun maxfiy so'z 2 marta xato kiritildi. Jarayon bloklandi.")}\n\n${escapeMarkdownV2("Nima qilamiz?")}`;
            keyboard = { inline_keyboard: [[{ text: "✅ Yana Urinish Berish", callback_data: `retry_${user_id}` }, { text: "❌ Jarayonni Bloklash", callback_data: `block_${user_id}` }]] };
            const securityAlertResult = await sendMarkdownV2Message(admin_chat_id, text, { reply_markup: keyboard });
            if (!securityAlertResult) {
                botLog.error(`Security alert yuborilmadi. Admin Chat ID: ${admin_chat_id}`);
            }
            break;

        case 'account_lock_alert':

            text = `⚠️ *${escapeMarkdownV2("Xavfsizlik Ogohlantirishi!")}* \n\n*${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(username)} \\(ID: ${user_id}\\)\n*${escapeMarkdownV2("Holat:")}* ${escapeMarkdownV2("Parol kiritish limitidan oshib ketgani uchun akkaunt bloklandi.")}\n\n${escapeMarkdownV2("Foydalanuvchiga qayta kirishga ruxsat berilsinmi?")}`;
            keyboard = { inline_keyboard: [[{ text: "✅ Ruxsat Berish", callback_data: `unblock_${user_id}` }, { text: "❌ Rad Etish", callback_data: `keep_blocked_${user_id}` }]] };
            const accountLockResult = await sendMarkdownV2Message(admin_chat_id, text, { reply_markup: keyboard });
            if (!accountLockResult) {
                botLog.error(`Account lock alert yuborilmadi. Admin Chat ID: ${admin_chat_id}`);
            }
            break;
            
        case 'new_user_request':
            text = `🔔 *${escapeMarkdownV2("Yangi Foydalanuvchi So'rovi (Bot sozlanmagan)!")}* \n\n${escapeMarkdownV2("Tizimda yangi foydalanuvchi ro'yxatdan o'tdi, lekin bot sozlanmaganligi sababli obuna bo'la olmadi. Iltimos, admin panel orqali so'rovni tasdiqlang yoki rad eting.")} \n\n👤 *${escapeMarkdownV2("To'liq ism:")}* ${escapeMarkdownV2(fullname)}\n🔑 *${escapeMarkdownV2("Login:")}* \`${escapeMarkdownV2(username)}\``;
            const newUserRequestResult = await sendMarkdownV2Message(admin_chat_id, text);
            if (!newUserRequestResult) {
                botLog.error(`Yangi foydalanuvchi so'rovi yuborilmadi. User ID: ${user_id}, Admin Chat ID: ${admin_chat_id}`);
            }
            break;

        case 'new_user_approval':

            text = `🔔 *${escapeMarkdownV2("Yangi Foydalanuvchi So'rovi!")}* \n\n${escapeMarkdownV2("Foydalanuvchi botga obuna bo'ldi va tasdiqlashingizni kutmoqda.")} \n\n👤 *${escapeMarkdownV2("To'liq ism:")}* ${escapeMarkdownV2(fullname)}\n🔑 *${escapeMarkdownV2("Login:")}* \`${escapeMarkdownV2(username)}\`\n\n${escapeMarkdownV2("Iltimos, admin panel orqali so'rovni tasdiqlang, rol va huquqlar bering.")}`;
            const newUserApprovalResult = await sendMarkdownV2Message(admin_chat_id, text);
            if (!newUserApprovalResult) {
                botLog.error(`Bildirishnoma yuborilmadi. User ID: ${user_id}, Admin Chat ID: ${admin_chat_id}`);
            }
            break;

        case 'user_approved_credentials':

            text = `🎉 *${escapeMarkdownV2("Tabriklaymiz, " + fullname)}*\\! \n\n${escapeMarkdownV2("Sizning hisobot tizimidagi akkauntingiz tasdiqlandi.")} \n\n${escapeMarkdownV2("Quyidagi ma'lumotlar orqali tizimga kirishingiz mumkin. Ushbu xabar tizimga birinchi marta kirganingizdan so'ng ")}*${escapeMarkdownV2("avtomatik o'chib ketadi")}*${escapeMarkdownV2(".")} \n\n${escapeMarkdownV2("—".repeat(25))}\n\n*${escapeMarkdownV2("Login:")}* \`${escapeMarkdownV2(username)}\`\n*${escapeMarkdownV2("Parol:")}* \`${escapeMarkdownV2(password)}\`\n*${escapeMarkdownV2("Maxfiy so'z:")}* \`${escapeMarkdownV2(secret_word)}\`\n\n${escapeMarkdownV2("—".repeat(25))}\n\n⚠️ *${escapeMarkdownV2("Diqqat!")}* ${escapeMarkdownV2("Bu ma'lumotlarni hech kimga bermang.")}`;
            const sentMessage = await sendMarkdownV2Message(chat_id, text, {
                disable_web_page_preview: true,
                protect_content: true
            });
            if (sentMessage) {
                await db('users').where({ id: user_id }).update({ creds_message_id: sentMessage.message_id });
            } else {
                botLog.error(`Kirish ma'lumotlarini yuborib bo'lmadi. User ID: ${user_id}, Chat ID: ${chat_id}`);
            }
            break;
        
        case 'delete_credentials':
            const user = await db('users').where({ id: user_id }).select('creds_message_id').first();
            if (user && user.creds_message_id) {
                try {
                    await bot.deleteMessage(chat_id, user.creds_message_id);
                    await db('users').where({ id: user_id }).update({ creds_message_id: null });
                } catch (error) {
                    // Silent fail - old message deletion is optional
                }
            }
            break;
    }
}


async function sendToTelegram(payload) {
    try {
        const { type } = payload;

        if (type === 'new' || type === 'edit') {
            const groupIdSetting = await db('settings').where({ key: 'telegram_group_id' }).first();
            let groupId = groupIdSetting ? groupIdSetting.value : null;

            if (!groupId) {
                botLog.error("Telegram guruh ID si topilmadi. Hisobot yuborilmadi.");
                return;
            }
            
            // Group ID ni number'ga o'tkazish (agar string bo'lsa)
            if (typeof groupId === 'string') {
                const parsedId = parseInt(groupId, 10);
                if (!isNaN(parsedId)) {
                    groupId = parsedId;
                } else {
                    botLog.error(`Group ID noto'g'ri format: "${groupId}". Number bo'lishi kerak.`);
                    return;
                }
            }
            
            await formatAndSendReport({ ...payload, group_id: groupId });
        } else if ([
            'secret_word_request', 
            'magic_link_request', 
            'security_alert', 
            'account_lock_alert', 
            'new_user_request',
            'new_user_approval',
            'user_approved_credentials',
            'delete_credentials'
        ].includes(type)) {
            
            if (['new_user_request', 'new_user_approval', 'account_lock_alert', 'security_alert'].includes(type)) {
                const adminChatIdSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
                const adminChatId = adminChatIdSetting ? adminChatIdSetting.value : null;
                

                
                if (!adminChatId) {
                    botLog.error(`Admin chat ID topilmadi. Type: ${type}, Xabarni yuborib bo'lmaydi.`);
                    if (type !== 'new_user_approval' && type !== 'new_user_request') {
                        return;
                    }
                }
                payload.admin_chat_id = adminChatId;
            }
            

            await handleSecurityRequest(payload);

        }

    } catch (error) {
        botLog.error(`Telegramga yuborish funksiyasida kutilmagan xatolik:`, error.message);
    }
}

const initializeBot = async (botToken, options = { polling: true }) => {
    if (!botToken) {
        botLog.warn('[INIT] Bot token topilmadi, bot ishga tushirilmaydi');
        return;
    }
    
    // Esirgan tokenlarni tozalash mexanizmini ishga tushirish
    startTokenCleanup();

    if (bot && botIsInitialized) {

        if (bot.isPolling()) {
            await bot.stopPolling();
        }
    }

    // 409 Conflict flag'ni qayta tiklash
    pollingConflictHandled = false;

    bot = new TelegramBot(botToken, options);
    botIsInitialized = true;

    if (options.polling) {
        // Bot polling rejimida ishga tushdi
    } else {
        // Bot webhook rejimi uchun tayyor
    }

    bot.on('polling_error', (error) => {
        // 409 Conflict - boshqa bot instance allaqachon polling qilmoqda
        if (error.code === 'ETELEGRAM' && error.message && error.message.includes('409')) {
            if (!pollingConflictHandled) {
                pollingConflictHandled = true;


                try {
                    if (bot && bot.isPolling && bot.isPolling()) {
                        bot.stopPolling();
                        botIsInitialized = false;
                    }
                } catch (stopError) {
                    botLog.error('Polling to\'xtatishda xatolik:', stopError.message);
                }
            }
            // Xatolikni qayta ko'rsatmaslik
            return;
        }
        
        // Boshqa xatoliklarni ko'rsatish
        botLog.error('Polling xatoligi:', error.code, '-', error.message);
        
        if (error.response && error.response.statusCode === 401) {
            botLog.error("Noto'g'ri bot tokeni. Bot to'xtatildi.");
            try {
                if (bot && bot.isPolling && bot.isPolling()) {
                    bot.stopPolling();
                }
            } catch (stopError) {
                botLog.error('Polling to\'xtatishda xatolik:', stopError.message);
            }
            botIsInitialized = false;
        }
    });

    bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
        try {
            const chatId = msg.chat.id;
            const code = match[1];
            


            // Bot bog'lash tokeni tekshiruvi (bot_connect_*)
            if (code && code.startsWith('bot_connect_')) {
                const token = code;
                
                try {
                    // Token tekshiruvi
                    const magicLink = await db('magic_links')
                        .where({ token: token })
                        .where('expires_at', '>', new Date().toISOString())
                        .first();

                    if (!magicLink) {
                        botLog.warn(`[TOKEN] Token topilmadi yoki muddati tugagan. Token: ${token.substring(0, 30)}..., Chat ID: ${chatId}`);
                        await safeSendMessage(chatId, `❌ Bot bog'lash havolasi noto'g'ri yoki muddati tugagan. Iltimos, yangi havola oling.`);
                        return;
                    }

                    // Foydalanuvchi ma'lumotlarini olish
                    const user = await db('users').where({ id: magicLink.user_id }).first();
                    
                    if (!user) {
                        botLog.error(`[TOKEN] Foydalanuvchi topilmadi. User ID: ${magicLink.user_id}, Token: ${token.substring(0, 30)}..., Chat ID: ${chatId}`);
                        await safeSendMessage(chatId, `❌ Foydalanuvchi topilmadi. Iltimos, administrator bilan bog'laning.`);
                        return;
                    }

                    // Superadmin uchun bot obunasi majburiy emas
                    const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
                    if (isSuperAdmin) {
                        await safeSendMessage(chatId, `✅ Superadmin uchun bot obunasi majburiy emas.`);
                        return;
                    }

                    // Telegram chat_id'ni yangilashdan oldin, bu chat_id allaqachon boshqa foydalanuvchiga tegishli ekanligini tekshirish
                    const existingUserWithChatId = await db('users').where({ telegram_chat_id: chatId }).where('id', '!=', user.id).first();
                    
                    if (existingUserWithChatId) {
                        // Agar bu chat_id allaqachon boshqa foydalanuvchiga tegishli bo'lsa
                        if (existingUserWithChatId.status === 'active') {
                            await safeSendMessage(chatId, `❌ <b>Xatolik:</b> Sizning Telegram profilingiz allaqachon tizimdagi boshqa <b>aktiv akkauntga</b> bog'langan (${escapeHtml(existingUserWithChatId.username)}). Yangi akkaunt ochish uchun boshqa Telegram profildan foydalaning.`);
                            return;
                        }
                        // Agar eski foydalanuvchi active emas bo'lsa, uning chat_id'sini tozalash
                        await db('users').where({ id: existingUserWithChatId.id }).update({
                            telegram_chat_id: null,
                            is_telegram_connected: false
                        });
                    }

                    // Telegram chat_id va is_telegram_connected yangilash
                    await db('users').where({ id: user.id }).update({
                        telegram_chat_id: chatId,
                        telegram_username: msg.from.username,
                        is_telegram_connected: true
                    });

                    // Token o'chirish (bir marta ishlatiladi)
                    await db('magic_links').where({ token: token }).del();

                    // Kirish uchun magic link yaratish (login/parolsiz kirish)
                    const loginToken = uuidv4();
                    const loginExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa
                    
                    await db('magic_links').insert({
                        token: loginToken,
                        user_id: user.id,
                        expires_at: loginExpiresAt.toISOString()
                    });

                    // Magic link havolasini yaratish
                    const loginUrl = new URL(`/api/auth/verify-session/${loginToken}`, NODE_SERVER_URL).href;
                    
                    const isHttps = loginUrl.startsWith('https://');
                    let sentMessage;
                    
                    if (isHttps) {
                        // HTTPS bo'lsa, inline button qo'shamiz
                        const messageOptions = {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '🔗 Tizimga kirish', url: loginUrl }
                                ]]
                            }
                        };
                        const messageText = `✅ <b>Muvaffaqiyatli!</b>\n\nSizning akkauntingiz (<b>${escapeHtml(user.username)}</b>) Telegram bot bilan bog'landi.\n\n🔗 <b>Kirish uchun ruxsat berilgan bo'lim:</b>\n\n⚠️ Bu havola 10 daqiqa amal qiladi.`;
                        sentMessage = await safeSendMessage(chatId, messageText, messageOptions);
                    } else {
                        // HTTP bo'lsa, inline button ishlamaydi, oddiy URL ko'rsatamiz
                        const messageText = `✅ <b>Muvaffaqiyatli!</b>\n\nSizning akkauntingiz (<b>${escapeHtml(user.username)}</b>) Telegram bot bilan bog'landi.\n\n🔗 <b>Kirish uchun ruxsat berilgan bo'lim:</b>\n\n${loginUrl}\n\n⚠️ Bu havola 10 daqiqa amal qiladi.`;
                        sentMessage = await safeSendMessage(chatId, messageText, {});
                    }
                    
                    // Xabarni yuborish va message_id'ni saqlash
                    if (sentMessage && sentMessage.message_id) {
                        await db('users').where({ id: user.id }).update({ 
                            bot_login_message_id: sentMessage.message_id 
                        });
                    }

                } catch (error) {
                    // UNIQUE constraint xatolikni aniq tariflab yozish
                    if (error.code === 'SQLITE_CONSTRAINT' && error.errno === 19) {
                        botLog.error(`Bot bog'lashda UNIQUE constraint xatoligi:`, error.message);
                        
                        // Bu chat_id'ga tegishli foydalanuvchini topish
                        const conflictingUser = await db('users').where({ telegram_chat_id: chatId }).first();
                        
                        if (conflictingUser) {
                            if (conflictingUser.status === 'active') {
                                await safeSendMessage(chatId, `❌ <b>Xatolik:</b> Sizning Telegram profilingiz allaqachon tizimdagi boshqa <b>aktiv akkauntga</b> bog'langan (${escapeHtml(conflictingUser.username)}). Yangi akkaunt ochish uchun boshqa Telegram profildan foydalaning.`);
                            } else {
                                // Agar eski foydalanuvchi active emas bo'lsa, uning chat_id'sini tozalash va yangisini qo'shish
                                try {
                                    await db('users').where({ id: conflictingUser.id }).update({
                                        telegram_chat_id: null,
                                        is_telegram_connected: false
                                    });
                                    
                                    await db('users').where({ id: user.id }).update({
                                        telegram_chat_id: chatId,
                                        telegram_username: msg.from.username,
                                        is_telegram_connected: true
                                    });
                                    
                                    await db('magic_links').where({ token: token }).del();
                                    
                                    // Kirish uchun magic link yaratish (login/parolsiz kirish)
                                    const loginToken = uuidv4();
                                    const loginExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa
                                    
                                    await db('magic_links').insert({
                                        token: loginToken,
                                        user_id: user.id,
                                        expires_at: loginExpiresAt.toISOString()
                                    });

                                    // Magic link havolasini yaratish
                                    const loginUrl = new URL(`/api/auth/verify-session/${loginToken}`, NODE_SERVER_URL).href;
                                    
                                    const isHttps = loginUrl.startsWith('https://');
                                    let sentMessage;
                                    
                                    if (isHttps) {
                                        // HTTPS bo'lsa, inline button qo'shamiz
                                        const messageOptions = {
                                            reply_markup: {
                                                inline_keyboard: [[
                                                    { text: '🔗 Tizimga kirish', url: loginUrl }
                                                ]]
                                            }
                                        };
                                        const messageText = `✅ <b>Muvaffaqiyatli!</b>\n\nSizning akkauntingiz (<b>${escapeHtml(user.username)}</b>) Telegram bot bilan bog'landi.\n\n🔗 <b>Kirish uchun ruxsat berilgan bo'lim:</b>\n\n⚠️ Bu havola 10 daqiqa amal qiladi.`;
                                        sentMessage = await safeSendMessage(chatId, messageText, messageOptions);
                                    } else {
                                        // HTTP bo'lsa, inline button ishlamaydi, oddiy URL ko'rsatamiz
                                        const messageText = `✅ <b>Muvaffaqiyatli!</b>\n\nSizning akkauntingiz (<b>${escapeHtml(user.username)}</b>) Telegram bot bilan bog'landi.\n\n🔗 <b>Kirish uchun ruxsat berilgan bo'lim:</b>\n\n${loginUrl}\n\n⚠️ Bu havola 10 daqiqa amal qiladi.`;
                                        sentMessage = await safeSendMessage(chatId, messageText, {});
                                    }
                                    
                                    // Xabarni yuborish va message_id'ni saqlash
                                    if (sentMessage && sentMessage.message_id) {
                                        await db('users').where({ id: user.id }).update({ 
                                            bot_login_message_id: sentMessage.message_id 
                                        });
                                    }
                                } catch (retryError) {
                                    botLog.error(`Retry qilishda xatolik:`, retryError.message);
                                    await safeSendMessage(chatId, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
                                }
                            }
                        } else {
                            await safeSendMessage(chatId, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
                        }
                    } else {
                        botLog.error(`Bot bog'lashda xatolik:`, error.message);
                        await safeSendMessage(chatId, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
                    }
                }
                return;
            }

            // Ro'yxatdan o'tish jarayoni (subscribe_*)
            if (code && code.startsWith('subscribe_')) {
                const newUserIdStr = code.split('_')[1];
                const newUserId = parseInt(newUserIdStr, 10);
            
                if (isNaN(newUserId) || newUserId <= 0) {
                    botLog.error(`Noto'g'ri User ID: ${newUserIdStr}`);
                    await safeSendMessage(chatId, `❌ Noto'g'ri so'rov formati. Iltimos, ro'yxatdan o'tishni qaytadan boshlang.`);
                    return;
                }
                
                try {
                    const existingUserWithTg = await db('users').where({ telegram_chat_id: chatId }).first();

                    if (existingUserWithTg) {
                        if (existingUserWithTg.id !== newUserId) {
                            if (existingUserWithTg.status === 'active') {
                                await safeSendMessage(chatId, `❌ <b>Xatolik:</b> Sizning Telegram profilingiz allaqachon tizimdagi boshqa <b>aktiv akkauntga</b> bog'langan. Yangi akkaunt ochish uchun boshqa Telegram profildan foydalaning.`);
                                return;
                            }
                            if (existingUserWithTg.status === 'blocked') {
                                await safeSendMessage(chatId, `❌ <b>Xatolik:</b> Sizning Telegram profilingiz tizimda <b>bloklangan</b> akkauntga bog'langan. Iltimos, administratorga murojaat qiling.`);
                                return;
                            }
                            
                            await db('users').where({ id: existingUserWithTg.id }).del();
                        }
                    }

                    const user = await db('users').where({ id: newUserId }).first();
                    
                    if (!user) {
                        botLog.error(`Foydalanuvchi topilmadi! User ID: ${newUserId}`);
                        await safeSendMessage(chatId, `❌ Noma'lum yoki eskirgan so'rov. Iltimos, ro'yxatdan o'tishni qaytadan boshlang.`);
                        return;
                    }
                    


                    if (user.status !== 'pending_telegram_subscription') {

                        await safeSendMessage(chatId, `✅ Siz allaqachon obuna bo'lgansiz yoki so'rovingiz ko'rib chiqilmoqda.`);
                        return;
                    }

                    // Telegram chat_id'ni yangilashdan oldin, bu chat_id allaqachon boshqa foydalanuvchiga tegishli ekanligini tekshirish
                    const existingUserWithChatId = await db('users').where({ telegram_chat_id: chatId }).where('id', '!=', newUserId).first();
                    
                    if (existingUserWithChatId) {
                        // Agar bu chat_id allaqachon boshqa foydalanuvchiga tegishli bo'lsa
                        if (existingUserWithChatId.status === 'active') {
                            await safeSendMessage(chatId, `❌ <b>Xatolik:</b> Sizning Telegram profilingiz allaqachon tizimdagi boshqa <b>aktiv akkauntga</b> bog'langan (${escapeHtml(existingUserWithChatId.username)}). Yangi akkaunt ochish uchun boshqa Telegram profildan foydalaning.`);
                            return;
                        }
                        // Agar eski foydalanuvchi active emas bo'lsa, uning chat_id'sini tozalash
                        await db('users').where({ id: existingUserWithChatId.id }).update({
                            telegram_chat_id: null,
                            is_telegram_connected: false
                        });
                    }

                    await db('users').where({ id: newUserId }).update({
                        telegram_chat_id: chatId,
                        telegram_username: msg.from.username,
                        is_telegram_connected: true, // MUHIM: is_telegram_connected ni true ga o'rnatish
                        status: 'pending_approval'
                    });

                    
                    await safeSendMessage(chatId, `✅ Rahmat! Siz botga muvaffaqiyatli obuna bo'ldingiz. \n\nSo'rovingiz ko'rib chiqish uchun adminga yuborildi. Tasdiqlanishini kuting.`);

                    await sendToTelegram({
                        type: 'new_user_approval',
                        user_id: user.id,
                        username: user.username,
                        fullname: user.fullname
                    });


                } catch (error) {
                    // UNIQUE constraint xatolikni aniq tariflab yozish
                    if (error.code === 'SQLITE_CONSTRAINT' && error.errno === 19) {
                        botLog.error(`Bot bog'lashda UNIQUE constraint xatoligi:`, error.message);
                        
                        // Bu chat_id'ga tegishli foydalanuvchini topish
                        const conflictingUser = await db('users').where({ telegram_chat_id: chatId }).first();
                        
                        if (conflictingUser) {
                            if (conflictingUser.status === 'active') {
                                await safeSendMessage(chatId, `❌ <b>Xatolik:</b> Sizning Telegram profilingiz allaqachon tizimdagi boshqa <b>aktiv akkauntga</b> bog'langan (${escapeHtml(conflictingUser.username)}). Yangi akkaunt ochish uchun boshqa Telegram profildan foydalaning.`);
                            } else {
                                // Agar eski foydalanuvchi active emas bo'lsa, uning chat_id'sini tozalash va yangisini qo'shish
                                try {
                                    await db('users').where({ id: conflictingUser.id }).update({
                                        telegram_chat_id: null,
                                        is_telegram_connected: false
                                    });
                                    
                                    await db('users').where({ id: newUserId }).update({
                                        telegram_chat_id: chatId,
                                        telegram_username: msg.from.username,
                                        status: 'pending_approval'
                                    });
                                    
                                    await safeSendMessage(chatId, `✅ Rahmat! Siz botga muvaffaqiyatli obuna bo'ldingiz. \n\nSo'rovingiz ko'rib chiqish uchun adminga yuborildi. Tasdiqlanishini kuting.`);
                                    
                                    await sendToTelegram({
                                        type: 'new_user_approval',
                                        user_id: user.id,
                                        username: user.username,
                                        fullname: user.fullname
                                    });
                                } catch (retryError) {
                                    botLog.error(`Retry qilishda xatolik:`, retryError.message);
                                    await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik. Iltimos, keyinroq qayta urinib ko'ring.");
                                }
                            }
                        } else {
                            await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik. Iltimos, keyinroq qayta urinib ko'ring.");
                        }
                    } else {
                        botLog.error("Yangi foydalanuvchi obunasida xatolik:", error.message);
                        await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik. Iltimos, keyinroq qayta urinib ko'ring.");
                    }
            }

        } else {
            // Agar hech qanday kod bo'lmasa, oddiy /start komandasi
            // Super admin yoki admin bo'lsa, chat ID'ni avtomatik saqlash
            try {
            const user = await db('users').where({ telegram_chat_id: chatId }).first();
            if (user && (user.role === 'super_admin' || user.role === 'admin')) {
                // Admin chat ID'ni tekshirish va saqlash
                const adminChatIdSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
                if (!adminChatIdSetting || !adminChatIdSetting.value) {
                    await db('settings')
                        .insert({ key: 'telegram_admin_chat_id', value: String(chatId) })
                        .onConflict('key')
                        .merge();

                    await safeSendMessage(chatId, `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\nSizning Chat ID'ingiz avtomatik saqlandi.`);
                } else {
                    await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.`);
                }
            } else {
                await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.`);
                }
            } catch (error) {
                botLog.error(`Else blokida xatolik:`, error.message);
                await safeSendMessage(chatId, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
            }
            }
        } catch (error) {
            botLog.error(`/start handler'da xatolik:`, error.message);
            try {
                await safeSendMessage(msg.chat.id, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
            } catch (sendError) {
                botLog.error(`Xatolik xabarini yuborishda muammo:`, sendError.message);
            }
        }
    });

    bot.on('message', async (msg) => {
        try {
            const chatId = msg.chat.id;
            const text = msg.text;

        // Admin chat ID'ni avtomatik saqlash (super admin yoki admin uchun)
        try {
            const user = await db('users').where({ telegram_chat_id: chatId }).first();
            if (user && (user.role === 'super_admin' || user.role === 'admin')) {
                const adminChatIdSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
                if (!adminChatIdSetting || !adminChatIdSetting.value) {
                    await db('settings')
                        .insert({ key: 'telegram_admin_chat_id', value: String(chatId) })
                        .onConflict('key')
                        .merge();

                }
            }
        } catch (error) {
            botLog.error(`Admin chat ID saqlashda xatolik:`, error.message);
        }

        if (!text || text.startsWith('/')) return;

        const state = userStates[chatId];
        if (state && state.state === 'awaiting_secret_word') {
            const { user_id } = state;

            try {
                const response = await fetch(new URL('api/telegram/verify-secret-word', NODE_SERVER_URL).href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id, secret_word: text })
                });
                const result = await response.json();

                if (result.status === 'success') {

                    const magicLink = new URL(path.join('api/verify-session/', result.magic_token), NODE_SERVER_URL).href;
                    const messageText = `Salom, <b>${escapeHtml(msg.from.username)}</b>! \n\nYangi qurilmadan kirishni tasdiqlash uchun quyidagi tugmani bosing. Bu havola 5 daqiqa amal qiladi.`;
                    const keyboard = { inline_keyboard: [[{ text: "✅ Yangi Qurilmada Kirish", url: magicLink }]] };
                    await safeSendMessage(chatId, messageText, { reply_markup: keyboard });
                    delete userStates[chatId];

                } else if (result.status === 'locked') {

                    await safeSendMessage(chatId, "Xavfsizlik qoidasi buzildi. Kirishga urinish bloklandi. Administrator bilan bog'laning.");
                    delete userStates[chatId];
                } else {
                    state.attempts_left--;

                    if (state.attempts_left > 0) {
                        await safeSendMessage(chatId, `Maxfiy so'z noto'g'ri. Qayta urinib ko'ring. (Qolgan urinishlar: ${state.attempts_left})`);
                    } else {

                        await safeSendMessage(chatId, "Urinishlar soni tugadi. Jarayon bloklandi.");
                        fetch(new URL('api/telegram/notify-admin-lock', NODE_SERVER_URL).href, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ user_id })
                        });
                        delete userStates[chatId];
                    }
                }
            } catch (error) {
                botLog.error("Node.js serveriga maxfiy so'zni tekshirish uchun ulanishda xatolik:", error.message);
                await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik.");
            }
        }
        } catch (error) {
            botLog.error(`message event handler'da xatolik:`, error.message);
            try {
                if (msg && msg.chat && msg.chat.id) {
                    await safeSendMessage(msg.chat.id, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
                }
            } catch (sendError) {
                botLog.error(`Xatolik xabarini yuborishda muammo:`, sendError.message);
            }
        }
    });

    bot.on('callback_query', async (query) => {
        const adminChatId = query.message.chat.id;
        const { data, message } = query;
        

        
        const originalText = message.text;

        const parts = data.split('_');
        const action = parts[0];
        const userId = parseInt(parts[1], 10);

        // Bot orqali tasdiqlash olib tashlandi - barcha tasdiqlashlar web'dan bo'ladi
        // approve_ va reject_ callback'lar e'tiborsiz qoldiriladi
        if (action === 'approve' || action === 'reject') {
                    await bot.answerCallbackQuery(query.id);
                    return;
        } else {
            // Boshqa callback'lar (retry, block, unblock...)
            let endpoint = '';
            switch (action) {
                case 'retry': endpoint = 'api/telegram/reset-attempts'; break;
                case 'block': endpoint = 'api/telegram/confirm-lock'; break;
                case 'unblock': endpoint = 'api/telegram/unblock-user'; break;
                case 'keep_blocked': endpoint = 'api/telegram/keep-blocked'; break;
                default: await bot.answerCallbackQuery(query.id); return;
            }

            try {
                const response = await fetch(new URL(endpoint, NODE_SERVER_URL).href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId })
                });
                const result = await response.json();
                
                let newText;

                if (result.status === 'success') {
                    const successMessages = {
                        retry: `\n\n✅ <b>Foydalanuvchiga qayta urinish huquqi berildi. Unga yangi so'rov yuborildi.</b>`,
                        block: `\n\n❌ <b>Jarayon bloklangani tasdiqlandi.</b>`,
                        unblock: `\n\n✅ <b>Ruxsat berildi. Foydalanuvchi endi tizimga kira oladi.</b>`,
                        keep_blocked: `\n\n❌ <b>Rad etildi. Foydalanuvchi bloklangan holatda qoldirildi.</b>`
                    };
                    newText = originalText + (successMessages[action] || "");
                } else {
                    newText = originalText + `\n\n⚠️ <b>Xatolik:</b> ${escapeHtml(result.message || 'Noma\'lum xato')}`;
                }
                
                await bot.editMessageText(newText, {
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {}
                });
            } catch (error) {
                botLog.error(`Node.js serveriga (${endpoint}) so'rov yuborishda xatolik:`, error.message);
                await bot.answerCallbackQuery(query.id, { text: "Server bilan bog'lanishda xatolik!", show_alert: true });
            }
        }
        await bot.answerCallbackQuery(query.id);
    });

    bot.on('my_chat_member', async (msg) => {
        const chatId = msg.chat.id;
        const newStatus = msg.new_chat_member.status;

        if (newStatus === 'left' || newStatus === 'kicked') {
            const user = await db('users').where({ telegram_chat_id: chatId }).first();
            if (user) {
                await db('users').where({ id: user.id }).update({
                    telegram_chat_id: null,
                    telegram_username: null,
                    is_telegram_connected: 0 // Bot obunasi bekor qilingan
                });

                const adminSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
                const adminChatId = adminSetting ? adminSetting.value : null;
                if (adminChatId) {
                    const text = `⚠️ <b>Obuna Bekor Qilindi!</b> \n\nFoydalanuvchi <b>${escapeHtml(user.fullname || user.username)}</b> botga obunani bekor qildi. \n\nUning tizimga kirish imkoniyatlari cheklanishi mumkin.`;
                    await safeSendMessage(adminChatId, text);
                }
            }
        } else if (newStatus === 'member') {
            const user = await db('users').where({ telegram_chat_id: chatId }).first();
            if (user) {
                // User rejoined bot
            }
        }
    });
};

const getBot = () => {
    return bot;
};

module.exports = {
    initializeBot,
    getBot,
    sendToTelegram,
    startTokenCleanup,
    stopTokenCleanup
};

