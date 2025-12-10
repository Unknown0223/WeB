const TelegramBot = require('node-telegram-bot-api');
const { db } = require('../db.js');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { URL } = require('url');
const path = require('path');
const { format } = require('date-fns');

let bot;
let botIsInitialized = false;
let pollingConflictHandled = false; // 409 Conflict xatolikni bir marta handle qilish uchun

const userStates = {}; // Adminning holatini saqlash uchun
const NODE_SERVER_URL = process.env.APP_BASE_URL || "http://127.0.0.1:3000/";

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
    console.log(`🔐 [TELEGRAM] safeSendMessage chaqirildi. Chat ID: ${chatId}, Bot initialized: ${botIsInitialized}, Bot exists: ${!!bot}`);
    
    if (!bot || !botIsInitialized) {
        console.warn(`❌ [TELEGRAM] Bot ishga tushirilmagan, xabar yuborib bo'lmaydi. Bot: ${!!bot}, Initialized: ${botIsInitialized}`);
        return null;
    }
    
    try {
        console.log(`📨 [TELEGRAM] Telegram API'ga xabar yuborilmoqda... Chat ID: ${chatId}`);
        const result = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
        console.log(`✅ [TELEGRAM] Telegram API javob berdi. Message ID: ${result?.message_id}`);
        return result;
    } catch (error) {
        const body = error.response?.body;
        console.error(`❌ [TELEGRAM] Telegram API xatolik:`, {
            error_code: body?.error_code,
            description: body?.description,
            message: error.message,
            chatId: chatId
        });
        
        if (body?.error_code === 403) {
            console.warn(`⚠️ [TELEGRAM] Xabar yuborish imkonsiz (chat_id: ${chatId}). Bot foydalanuvchi tomonidan bloklangan.`);
            await db('users').where({ telegram_chat_id: chatId }).update({ telegram_chat_id: null, telegram_username: null });
            console.log(`🗑️ [TELEGRAM] Foydalanuvchi (chat_id: ${chatId}) bloklagani uchun bazadan tozalandi.`);
        } else if (body?.error_code === 400) {
            console.error(`❌ [TELEGRAM] Bad Request (400). Chat ID: ${chatId}, Description: ${body?.description}`);
            if (body?.description?.includes("chat not found")) {
                console.error(`❌ [TELEGRAM] Guruh topilmadi! Group ID noto'g'ri yoki bot guruhda yo'q.`);
            } else if (body?.description?.includes("not enough rights")) {
                console.error(`❌ [TELEGRAM] Bot guruhda xabar yuborish huquqiga ega emas!`);
            }
        } else {
            console.error(`❌ [TELEGRAM] Telegramga xabar yuborishda xatolik (chat_id: ${chatId}): ${body?.description || error.message}`);
            if (String(body?.description).includes("can't parse entities")) {
                try {
                    console.log(`🔄 [TELEGRAM] HTML xatoligi tufayli oddiy matn rejimida qayta yuborilmoqda...`);
                    const plainText = text.replace(/<[^>]*>/g, '');
                    const fallbackResult = await bot.sendMessage(chatId, plainText, { ...options, parse_mode: undefined });
                    console.log(`✅ [TELEGRAM] Oddiy matn rejimida yuborildi. Message ID: ${fallbackResult?.message_id}`);
                    return fallbackResult;
                } catch (fallbackError) {
                    console.error(`❌ [TELEGRAM] Oddiy matn rejimida ham yuborib bo'lmadi:`, fallbackError.response?.body || fallbackError.message);
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
    const { type, report_id, location, date, author, data, old_data, settings, group_id, old_report_date, old_location, brand_name, old_brand_name, currency } = payload;
    
    console.log(`📋 [TELEGRAM] formatAndSendReport boshlandi. Type: ${type}, Report ID: ${report_id}, Group ID: ${group_id}`);
    
    // Valyuta formatlash uchun
    const { formatCurrency, BASE_CURRENCY } = require('./exchangeRates.js');
    const reportCurrency = currency || BASE_CURRENCY;
    // Konvertatsiya qilmaslik kerak - qiymatlar allaqachon tanlangan valyutada saqlangan
    
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
        console.error('Brendlarni olishda xatolik:', error);
    }

    if (type === 'new') {
        const formattedDate = format(new Date(date), 'dd.MM.yyyy');
        
        messageText += `<b>${escapeHtml(location.toUpperCase())} filiali</b>\n`;
        if (brand_name) {
            messageText += `🏢 Brend: <b>${escapeHtml(brand_name)}</b>\n`;
        }
        messageText += `${formattedDate} uchun yangi hisobot\n`;
        messageText += `Hisobot #${String(report_id).padStart(4, '0')}\n\n`;
        messageText += `👤 Kiritdi: <b>${escapeHtml(author)}</b>\n\n`;

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
        messageText += brandLines.join('\n') + `\n`;

        // Jami summa - qiymat allaqachon tanlangan valyutada, konvertatsiya qilmaslik kerak
        messageText += `💰 <b>JAMI:</b> <code>${formatCurrency(grandTotal, reportCurrency)}</code>`;

    } else if (type === 'edit') {
        messageText += `✍️ <b>Hisobot Tahrirlandi #${String(report_id).padStart(4, '0')}</b>\n`;
        messageText += `👤 O'zgartirdi: <b>${escapeHtml(author)}</b>\n\n`;
        
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
        messageText += brandLines.join('\n') + `\n`;
        
        // Jami summalar - qiymatlar allaqachon tanlangan valyutada, konvertatsiya qilmaslik kerak
        const difference = newGrandTotal - oldGrandTotal;
        let diffText = '';
        if (difference > 0) {
            diffText = `<b>▲ ${formatCurrency(difference, reportCurrency)}</b>`;
        } else if (difference < 0) {
            diffText = `<b>▼ ${formatCurrency(Math.abs(difference), reportCurrency)}</b>`;
        }

        messageText += `\n💰 <b>JAMI:</b> <code>${formatCurrency(newGrandTotal, reportCurrency)}</code>  ${diffText}`;
    }

    if (messageText) {
        console.log(`💬 [TELEGRAM] Xabar tayyor. Uzunligi: ${messageText.length} belgi`);
        console.log(`📤 [TELEGRAM] safeSendMessage chaqirilmoqda. Group ID: ${group_id}`);
        const result = await safeSendMessage(group_id, messageText);
        if (result) {
            console.log(`✅ [TELEGRAM] Xabar muvaffaqiyatli yuborildi. Message ID: ${result.message_id}`);
        } else {
            console.error(`❌ [TELEGRAM] Xabar yuborilmadi. Result: null`);
        }
    } else {
        console.warn(`⚠️ [TELEGRAM] Xabar matni bo'sh. Xabar yuborilmadi.`);
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
        console.log(`📨 [TELEGRAM] sendMarkdownV2Message chaqirildi. Chat ID: ${chatId}, Bot initialized: ${botIsInitialized}, Bot exists: ${!!bot}`);
        
        if (!bot || !botIsInitialized) {
            console.warn(`❌ [TELEGRAM] Bot ishga tushirilmagan, MarkdownV2 xabar yuborib bo'lmaydi. Bot: ${!!bot}, Initialized: ${botIsInitialized}`);
            return null;
        }
        
        try {
            console.log(`📤 [TELEGRAM] MarkdownV2 xabar yuborilmoqda... Chat ID: ${chatId}, Text length: ${text?.length || 0}`);
            const result = await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', ...options });
            console.log(`✅ [TELEGRAM] MarkdownV2 xabar muvaffaqiyatli yuborildi. Chat ID: ${chatId}, Message ID: ${result?.message_id}`);
            return result;
        } catch (error) {
            const body = error.response?.body;
            console.error(`❌ [TELEGRAM] MarkdownV2 xabar yuborishda xatolik (chat_id: ${chatId}):`, {
                error_code: body?.error_code,
                description: body?.description,
                message: error.message,
                chatId: chatId
            });
            
            if (body?.error_code === 403) {
                console.warn(`⚠️ [TELEGRAM] MarkdownV2 xabar yuborish imkonsiz (chat_id: ${chatId}). Bot foydalanuvchi tomonidan bloklangan.`);
            } else if (body?.error_code === 400) {
                console.error(`❌ [TELEGRAM] MarkdownV2 Bad Request (400). Chat ID: ${chatId}, Description: ${body?.description}`);
                if (body?.description?.includes("chat not found")) {
                    console.error(`❌ [TELEGRAM] MarkdownV2: Chat topilmadi! Chat ID noto'g'ri yoki bot chat'da yo'q.`);
                }
            }
            
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
            console.log(`🔗 [TELEGRAM] Magic link so'rovi. Chat ID: ${chat_id}, User ID: ${user_id}`);
            const magicLink = new URL(path.join('api/verify-session/', token), NODE_SERVER_URL).href;
            text = `Salom, *${escapeMarkdownV2(username)}*\\! \n\n${escapeMarkdownV2("Yangi qurilmadan kirishni tasdiqlash uchun quyidagi tugmani bosing. Bu havola 5 daqiqa amal qiladi.")}`;
            keyboard = { inline_keyboard: [[{ text: "✅ Yangi Qurilmada Kirish", url: magicLink }]] };
            const magicLinkResult = await sendMarkdownV2Message(chat_id, text, { reply_markup: keyboard });
            if (magicLinkResult) {
                console.log(`✅ [TELEGRAM] Magic link yuborildi. Chat ID: ${chat_id}, Message ID: ${magicLinkResult.message_id}`);
            } else {
                console.error(`❌ [TELEGRAM] Magic link yuborilmadi. Chat ID: ${chat_id}`);
            }
            break;

        case 'security_alert':
            console.log(`⚠️ [TELEGRAM] Security alert. Admin Chat ID: ${admin_chat_id}, User ID: ${user_id}`);
            text = `⚠️ *${escapeMarkdownV2("Xavfsizlik Ogohlantirishi!")}* \n\n*${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(username)} \\(ID: ${user_id}\\)\n*${escapeMarkdownV2("Holat:")}* ${escapeMarkdownV2("Akkauntga kirish uchun maxfiy so'z 2 marta xato kiritildi. Jarayon bloklandi.")}\n\n${escapeMarkdownV2("Nima qilamiz?")}`;
            keyboard = { inline_keyboard: [[{ text: "✅ Yana Urinish Berish", callback_data: `retry_${user_id}` }, { text: "❌ Jarayonni Bloklash", callback_data: `block_${user_id}` }]] };
            const securityAlertResult = await sendMarkdownV2Message(admin_chat_id, text, { reply_markup: keyboard });
            if (securityAlertResult) {
                console.log(`✅ [TELEGRAM] Security alert yuborildi. Admin Chat ID: ${admin_chat_id}, Message ID: ${securityAlertResult.message_id}`);
            } else {
                console.error(`❌ [TELEGRAM] Security alert yuborilmadi. Admin Chat ID: ${admin_chat_id}`);
            }
            break;

        case 'account_lock_alert':
            console.log(`🔒 [TELEGRAM] Account lock alert. Admin Chat ID: ${admin_chat_id}, User ID: ${user_id}`);
            text = `⚠️ *${escapeMarkdownV2("Xavfsizlik Ogohlantirishi!")}* \n\n*${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(username)} \\(ID: ${user_id}\\)\n*${escapeMarkdownV2("Holat:")}* ${escapeMarkdownV2("Parol kiritish limitidan oshib ketgani uchun akkaunt bloklandi.")}\n\n${escapeMarkdownV2("Foydalanuvchiga qayta kirishga ruxsat berilsinmi?")}`;
            keyboard = { inline_keyboard: [[{ text: "✅ Ruxsat Berish", callback_data: `unblock_${user_id}` }, { text: "❌ Rad Etish", callback_data: `keep_blocked_${user_id}` }]] };
            const accountLockResult = await sendMarkdownV2Message(admin_chat_id, text, { reply_markup: keyboard });
            if (accountLockResult) {
                console.log(`✅ [TELEGRAM] Account lock alert yuborildi. Admin Chat ID: ${admin_chat_id}, Message ID: ${accountLockResult.message_id}`);
            } else {
                console.error(`❌ [TELEGRAM] Account lock alert yuborilmadi. Admin Chat ID: ${admin_chat_id}`);
            }
            break;
            
        case 'new_user_request':
            console.log(`🔔 [TELEGRAM] Yangi foydalanuvchi so'rovi (bot sozlanmagan). User ID: ${user_id}, Admin Chat ID: ${admin_chat_id}`);
            text = `🔔 *${escapeMarkdownV2("Yangi Foydalanuvchi So'rovi (Bot sozlanmagan)!")}* \n\n${escapeMarkdownV2("Tizimda yangi foydalanuvchi ro'yxatdan o'tdi, lekin bot sozlanmaganligi sababli obuna bo'la olmadi. Iltimos, admin panel orqali so'rovni tasdiqlang yoki rad eting.")} \n\n👤 *${escapeMarkdownV2("To'liq ism:")}* ${escapeMarkdownV2(fullname)}\n🔑 *${escapeMarkdownV2("Login:")}* \`${escapeMarkdownV2(username)}\``;
            const newUserRequestResult = await sendMarkdownV2Message(admin_chat_id, text);
            if (newUserRequestResult) {
                console.log(`✅ [TELEGRAM] Yangi foydalanuvchi so'rovi admin'ga yuborildi. User ID: ${user_id}, Message ID: ${newUserRequestResult.message_id}`);
            } else {
                console.error(`❌ [TELEGRAM] Yangi foydalanuvchi so'rovi yuborilmadi. User ID: ${user_id}, Admin Chat ID: ${admin_chat_id}`);
            }
            break;

        case 'new_user_approval':
            console.log(`🔔 [TELEGRAM] Yangi foydalanuvchi bildirishnomasi. User ID: ${user_id}, Admin Chat ID: ${admin_chat_id}`);
            text = `🔔 *${escapeMarkdownV2("Yangi Foydalanuvchi So'rovi!")}* \n\n${escapeMarkdownV2("Foydalanuvchi botga obuna bo'ldi va tasdiqlashingizni kutmoqda.")} \n\n👤 *${escapeMarkdownV2("To'liq ism:")}* ${escapeMarkdownV2(fullname)}\n🔑 *${escapeMarkdownV2("Login:")}* \`${escapeMarkdownV2(username)}\`\n\n${escapeMarkdownV2("Iltimos, admin panel orqali so'rovni tasdiqlang, rol va huquqlar bering.")}`;
            const newUserApprovalResult = await sendMarkdownV2Message(admin_chat_id, text);
            if (newUserApprovalResult) {
                console.log(`✅ [TELEGRAM] Bildirishnoma admin'ga yuborildi. User ID: ${user_id}, Message ID: ${newUserApprovalResult.message_id}`);
            } else {
                console.error(`❌ [TELEGRAM] Bildirishnoma yuborilmadi. User ID: ${user_id}, Admin Chat ID: ${admin_chat_id}`);
            }
            break;

        case 'user_approved_credentials':
            console.log(`🎉 [TELEGRAM] Foydalanuvchi tasdiqlandi va kirish ma'lumotlari yuborilmoqda. User ID: ${user_id}, Chat ID: ${chat_id}`);
            text = `🎉 *${escapeMarkdownV2("Tabriklaymiz, " + fullname)}*\\! \n\n${escapeMarkdownV2("Sizning hisobot tizimidagi akkauntingiz tasdiqlandi.")} \n\n${escapeMarkdownV2("Quyidagi ma'lumotlar orqali tizimga kirishingiz mumkin. Ushbu xabar tizimga birinchi marta kirganingizdan so'ng ")}*${escapeMarkdownV2("avtomatik o'chib ketadi")}*${escapeMarkdownV2(".")} \n\n${escapeMarkdownV2("—".repeat(25))}\n\n*${escapeMarkdownV2("Login:")}* \`${escapeMarkdownV2(username)}\`\n*${escapeMarkdownV2("Parol:")}* \`${escapeMarkdownV2(password)}\`\n*${escapeMarkdownV2("Maxfiy so'z:")}* \`${escapeMarkdownV2(secret_word)}\`\n\n${escapeMarkdownV2("—".repeat(25))}\n\n⚠️ *${escapeMarkdownV2("Diqqat!")}* ${escapeMarkdownV2("Bu ma'lumotlarni hech kimga bermang.")}`;
            const sentMessage = await sendMarkdownV2Message(chat_id, text, {
                disable_web_page_preview: true,
                protect_content: true
            });
            if (sentMessage) {
                await db('users').where({ id: user_id }).update({ creds_message_id: sentMessage.message_id });
                console.log(`✅ [TELEGRAM] Kirish ma'lumotlari yuborildi. User ID: ${user_id}, Message ID: ${sentMessage.message_id}`);
            } else {
                console.error(`❌ [TELEGRAM] Kirish ma'lumotlarini yuborib bo'lmadi. User ID: ${user_id}, Chat ID: ${chat_id}`);
            }
            break;
        
        case 'delete_credentials':
            const user = await db('users').where({ id: user_id }).select('creds_message_id').first();
            if (user && user.creds_message_id) {
                try {
                    await bot.deleteMessage(chat_id, user.creds_message_id);
                    await db('users').where({ id: user_id }).update({ creds_message_id: null });
                } catch (error) {
                    console.warn(`Eski kirish ma'lumotlari xabarini o'chirib bo'lmadi (chat_id: ${chat_id}, msg_id: ${user.creds_message_id}). Sabab: ${error.message}`);
                }
            }
            break;
    }
}


async function sendToTelegram(payload) {
    try {
        const { type } = payload;
        console.log(`📤 [TELEGRAM] sendToTelegram chaqirildi. Type: ${type}, Payload:`, JSON.stringify(payload, null, 2));

        if (type === 'new' || type === 'edit') {
            const groupIdSetting = await db('settings').where({ key: 'telegram_group_id' }).first();
            let groupId = groupIdSetting ? groupIdSetting.value : null;

            console.log(`🔍 [TELEGRAM] Group ID sozlamasi:`, groupIdSetting);
            console.log(`🔍 [TELEGRAM] Olingan Group ID: ${groupId} (type: ${typeof groupId})`);

            if (!groupId) {
                console.error("❌ [TELEGRAM] Telegram guruh ID si topilmadi. Hisobot yuborilmadi.");
                return;
            }
            
            // Group ID ni number'ga o'tkazish (agar string bo'lsa)
            if (typeof groupId === 'string') {
                const parsedId = parseInt(groupId, 10);
                if (!isNaN(parsedId)) {
                    groupId = parsedId;
                    console.log(`🔄 [TELEGRAM] Group ID string'dan number'ga o'tkazildi: ${groupId}`);
                } else {
                    console.error(`❌ [TELEGRAM] Group ID noto'g'ri format: "${groupId}". Number bo'lishi kerak.`);
                    return;
                }
            }
            
            console.log(`📝 [TELEGRAM] formatAndSendReport chaqirilmoqda. Group ID: ${groupId} (type: ${typeof groupId})`);
            await formatAndSendReport({ ...payload, group_id: groupId });
            console.log(`✅ [TELEGRAM] formatAndSendReport yakunlandi.`);

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
                
                console.log(`👤 [TELEGRAM] Admin chat ID tekshiruvi. Type: ${type}, Admin Chat ID: ${adminChatId}`);
                
                if (!adminChatId) {
                    console.error(`❌ [TELEGRAM] Admin chat ID topilmadi. Type: ${type}, Xabarni yuborib bo'lmaydi.`);
                    if (type !== 'new_user_approval' && type !== 'new_user_request') {
                        return;
                    }
                }
                payload.admin_chat_id = adminChatId;
            }
            
            console.log(`🔄 [TELEGRAM] handleSecurityRequest chaqirilmoqda. Type: ${type}`);
            await handleSecurityRequest(payload);
            console.log(`✅ [TELEGRAM] handleSecurityRequest yakunlandi. Type: ${type}`);
        }

    } catch (error) {
        console.error(`❌ [TELEGRAM] Telegramga yuborish funksiyasida kutilmagan xatolik:`, error.message);
        console.error(`❌ [TELEGRAM] Stack trace:`, error.stack);
    }
}

const initializeBot = async (botToken, options = { polling: true }) => {
    if (!botToken) {
        console.warn("Bot tokeni berilmadi. Bot ishga tushirilmadi.");
        return;
    }

    if (bot && botIsInitialized) {
        console.log("Bot qayta ishga tushirilmoqda...");
        if (bot.isPolling()) {
            await bot.stopPolling();
        }
    }

    // 409 Conflict flag'ni qayta tiklash
    pollingConflictHandled = false;

    bot = new TelegramBot(botToken, options);
    botIsInitialized = true;

    if (options.polling) {
        console.log("✅ Telegram bot (polling rejimi) muvaffaqiyatli ishga tushdi.");
    } else {
        console.log("✅ Telegram bot (webhook rejimi) uchun tayyor.");
        console.log("📝 [BOT] Event handler'lar o'rnatilmoqda...");
        console.log(`📝 [BOT] Bot instance mavjud: ${!!bot}, Bot token: ${botToken?.substring(0, 10)}...`);
    }

    bot.on('polling_error', (error) => {
        // 409 Conflict - boshqa bot instance allaqachon polling qilmoqda
        if (error.code === 'ETELEGRAM' && error.message && error.message.includes('409')) {
            if (!pollingConflictHandled) {
                pollingConflictHandled = true;
                console.warn('⚠️ [BOT] 409 Conflict: Boshqa bot instance allaqachon polling qilmoqda.');
                console.warn('⚠️ [BOT] Bu bot instance polling rejimini to\'xtatmoqda. Webhook rejimiga o\'tish tavsiya etiladi.');
                try {
                    if (bot && bot.isPolling && bot.isPolling()) {
                        bot.stopPolling();
                        botIsInitialized = false;
                        console.log('✅ [BOT] Polling to\'xtatildi. Webhook rejimini ishlatish tavsiya etiladi.');
                    }
                } catch (stopError) {
                    console.error('❌ [BOT] Polling to\'xtatishda xatolik:', stopError);
                }
            }
            // Xatolikni qayta ko'rsatmaslik
            return;
        }
        
        // Boshqa xatoliklarni ko'rsatish
        console.error('Polling xatoligi:', error.code, '-', error.message);
        
        if (error.response && error.response.statusCode === 401) {
            console.error("Noto'g'ri bot tokeni. Bot to'xtatildi.");
            try {
                if (bot && bot.isPolling && bot.isPolling()) {
                    bot.stopPolling();
                }
            } catch (stopError) {
                console.error('❌ [BOT] Polling to\'xtatishda xatolik:', stopError);
            }
            botIsInitialized = false;
        }
    });

    bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
        try {
            const chatId = msg.chat.id;
            const code = match[1];
            
            console.log(`🤖 [BOT] /start komandasi qabul qilindi. Chat ID: ${chatId}, Code: ${code || 'yo\'q'}`);

            if (code && code.startsWith('subscribe_')) {
                const newUserIdStr = code.split('_')[1];
                const newUserId = parseInt(newUserIdStr, 10);
                
                console.log(`🔗 [BOT] Subscribe so'rovi. Code: ${code}, User ID (string): ${newUserIdStr}, User ID (int): ${newUserId}, Chat ID: ${chatId}`);
            
                if (isNaN(newUserId) || newUserId <= 0) {
                    console.error(`❌ [BOT] Noto'g'ri User ID: ${newUserIdStr}`);
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
                            
                            console.log(`🗑️ [BOT] Eski, keraksiz foydalanuvchi yozuvi (ID: ${existingUserWithTg.id}) tozalanmoqda...`);
                            await db('users').where({ id: existingUserWithTg.id }).del();
                        }
                    }

                    console.log(`🔍 [BOT] Bazadan foydalanuvchini qidiryapman. User ID: ${newUserId} (type: ${typeof newUserId})`);
                    const user = await db('users').where({ id: newUserId }).first();
                    
                    if (!user) {
                        console.error(`❌ [BOT] Foydalanuvchi topilmadi! User ID: ${newUserId}`);
                        console.error(`🔍 [BOT] Bazada mavjud foydalanuvchilar (birinchi 5 ta):`);
                        const allUsers = await db('users').select('id', 'username', 'status').limit(5);
                        console.error(`   ${JSON.stringify(allUsers, null, 2)}`);
                        await safeSendMessage(chatId, `❌ Noma'lum yoki eskirgan so'rov. Iltimos, ro'yxatdan o'tishni qaytadan boshlang.`);
                        return;
                    }
                    
                    console.log(`✅ [BOT] Foydalanuvchi topildi: ID=${user.id}, Username=${user.username}, Status=${user.status}`);

                    if (user.status !== 'pending_telegram_subscription') {
                        console.log(`⚠️ [BOT] Foydalanuvchi statusi noto'g'ri. Kutilgan: pending_telegram_subscription, Hozirgi: ${user.status}`);
                        await safeSendMessage(chatId, `✅ Siz allaqachon obuna bo'lgansiz yoki so'rovingiz ko'rib chiqilmoqda.`);
                        return;
                    }

                    await db('users').where({ id: newUserId }).update({
                        telegram_chat_id: chatId,
                        telegram_username: msg.from.username,
                        status: 'pending_approval'
                    });

                    console.log(`✅ [BOT] Foydalanuvchi botga ulandi. User ID: ${newUserId}, Status: pending_approval`);
                    
                    await safeSendMessage(chatId, `✅ Rahmat! Siz botga muvaffaqiyatli obuna bo'ldingiz. \n\nSo'rovingiz ko'rib chiqish uchun adminga yuborildi. Tasdiqlanishini kuting.`);

                    await sendToTelegram({
                        type: 'new_user_approval',
                        user_id: user.id,
                        username: user.username,
                        fullname: user.fullname
                    });
                    console.log(`✅ [BOT] Admin'ga tasdiqlash so'rovi yuborildi.`);

                } catch (error) {
                console.error("Yangi foydalanuvchi obunasida xatolik:", error);
                await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik. Iltimos, keyinroq qayta urinib ko'ring.");
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
                    console.log(`✅ [BOT] Admin chat ID avtomatik saqlandi. Chat ID: ${chatId}, User: ${user.username}`);
                    await safeSendMessage(chatId, `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\nSizning Chat ID'ingiz avtomatik saqlandi.`);
                } else {
                    await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.`);
                }
            } else {
                await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.`);
                }
            } catch (error) {
                console.error(`❌ [BOT] Else blokida xatolik:`, error);
                await safeSendMessage(chatId, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
            }
            }
        } catch (error) {
            console.error(`❌ [BOT] /start handler'da xatolik:`, error);
            try {
                await safeSendMessage(msg.chat.id, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
            } catch (sendError) {
                console.error(`❌ [BOT] Xatolik xabarini yuborishda muammo:`, sendError);
            }
        }
    });

    bot.on('message', async (msg) => {
        try {
            const chatId = msg.chat.id;
            const text = msg.text;
            
            console.log(`💬 [BOT] Xabar qabul qilindi. Chat ID: ${chatId}, Text: ${text?.substring(0, 50) || 'yo\'q'}`);
            console.log(`💬 [BOT] message event handler ishga tushdi. Message:`, JSON.stringify(msg, null, 2));

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
                    console.log(`✅ [BOT] Admin chat ID avtomatik saqlandi. Chat ID: ${chatId}, User: ${user.username}`);
                }
            }
        } catch (error) {
            console.error(`❌ [BOT] Admin chat ID saqlashda xatolik:`, error);
        }

        if (!text || text.startsWith('/')) return;

        const state = userStates[chatId];
        if (state && state.state === 'awaiting_secret_word') {
            const { user_id } = state;
            console.log(`🔐 [BOT] Secret word kutilmoqda. User ID: ${user_id}, Chat ID: ${chatId}`);
            try {
                const response = await fetch(new URL('api/telegram/verify-secret-word', NODE_SERVER_URL).href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id, secret_word: text })
                });
                const result = await response.json();

                if (result.status === 'success') {
                    console.log(`✅ [BOT] Secret word to'g'ri. Magic link yuborilmoqda. User ID: ${user_id}`);
                    const magicLink = new URL(path.join('api/verify-session/', result.magic_token), NODE_SERVER_URL).href;
                    const messageText = `Salom, <b>${escapeHtml(msg.from.username)}</b>! \n\nYangi qurilmadan kirishni tasdiqlash uchun quyidagi tugmani bosing. Bu havola 5 daqiqa amal qiladi.`;
                    const keyboard = { inline_keyboard: [[{ text: "✅ Yangi Qurilmada Kirish", url: magicLink }]] };
                    await safeSendMessage(chatId, messageText, { reply_markup: keyboard });
                    delete userStates[chatId];
                    console.log(`✅ [BOT] Magic link yuborildi. User ID: ${user_id}`);
                } else if (result.status === 'locked') {
                    console.log(`🔒 [BOT] Secret word urinishlari bloklandi. User ID: ${user_id}`);
                    await safeSendMessage(chatId, "Xavfsizlik qoidasi buzildi. Kirishga urinish bloklandi. Administrator bilan bog'laning.");
                    delete userStates[chatId];
                } else {
                    state.attempts_left--;
                    console.log(`⚠️ [BOT] Secret word noto'g'ri. Qolgan urinishlar: ${state.attempts_left}, User ID: ${user_id}`);
                    if (state.attempts_left > 0) {
                        await safeSendMessage(chatId, `Maxfiy so'z noto'g'ri. Qayta urinib ko'ring. (Qolgan urinishlar: ${state.attempts_left})`);
                    } else {
                        console.log(`🔒 [BOT] Secret word urinishlari tugadi. Admin'ga xabar yuborilmoqda. User ID: ${user_id}`);
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
                console.error("Node.js serveriga maxfiy so'zni tekshirish uchun ulanishda xatolik:", error);
                await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik.");
            }
        }
        } catch (error) {
            console.error(`❌ [BOT] message event handler'da xatolik:`, error);
            console.error(`❌ [BOT] Error stack:`, error.stack);
            try {
                if (msg && msg.chat && msg.chat.id) {
                    await safeSendMessage(msg.chat.id, `❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.`);
                }
            } catch (sendError) {
                console.error(`❌ [BOT] Xatolik xabarini yuborishda muammo:`, sendError);
            }
        }
    });

    bot.on('callback_query', async (query) => {
        console.log(`🔄 [BOT] callback_query event handler ishga tushdi. Query:`, JSON.stringify(query, null, 2));
        const adminChatId = query.message.chat.id;
        const { data, message } = query;
        
        console.log(`🔘 [BOT] Callback query qabul qilindi. Chat ID: ${adminChatId}, Data: ${data}`);
        
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
                console.error(`Node.js serveriga (${endpoint}) so'rov yuborishda xatolik:`, error);
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
                    telegram_username: null
                });

                const adminSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
                const adminChatId = adminSetting ? adminSetting.value : null;
                if (adminChatId) {
                    const text = `⚠️ <b>Obuna Bekor Qilindi!</b> \n\nFoydalanuvchi <b>${escapeHtml(user.fullname || user.username)}</b> botga obunani bekor qildi. \n\nUning tizimga kirish imkoniyatlari cheklanishi mumkin.`;
                    await safeSendMessage(adminChatId, text);
                }
                console.log(`Foydalanuvchi ${user.username} (ID: ${user.id}) botdan chiqib ketdi.`);
            }
        } else if (newStatus === 'member') {
            const user = await db('users').where({ telegram_chat_id: chatId }).first();
            if (user) {
                console.log(`Foydalanuvchi ${user.username} (ID: ${user.id}) botga qayta qo'shildi.`);
            }
        }
    });
    
    // Event handler'lar o'rnatilganligini tasdiqlash
    console.log(`✅ [BOT] Barcha event handler'lar o'rnatildi. Bot ready: ${!!bot}, Initialized: ${botIsInitialized}`);
    console.log(`✅ [BOT] Event handler'lar ro'yxati:`);
    console.log(`   - onText(/\\/start/)`);
    console.log(`   - on('message')`);
    console.log(`   - on('callback_query')`);
    console.log(`   - on('my_chat_member')`);
    console.log(`   - on('polling_error')`);
};

const getBot = () => {
    return bot;
};

module.exports = {
    initializeBot,
    getBot,
    sendToTelegram
};

