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
            
            // Cleanup completed silently
        } catch (error) {
            botLog.error(`[CLEANUP] Esirgan tokenlarni tozalashda xatolik: ${error.message}`);
        }
    }, 60 * 60 * 1000); // 1 soat
}

function stopTokenCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
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
                botLog.error(`Guruh supergroup'ga o'zgartirilgan. Eski chat ID: ${chatId}`);
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
    const { type, report_id, location, date, author, author_id, data, old_data, settings, group_id, old_report_date, old_location, brand_name, old_brand_name, currency, late_comment } = payload;
    

    
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
    
    // Brendlarni database'dan olish (saralash uchun)
    let brandsMap = {}; // { brand_id: brand_name }
    try {
        const brands = await db('brands').select('id', 'name');
        brands.forEach(b => {
            // Key'ni string sifatida saqlash (saralash uchun)
            brandsMap[String(b.id)] = b.name;
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
        
        // Filialga biriktirilgan brendlarni olish (sort_order bilan)
        let locationBrands = [];
        try {
            locationBrands = await db('brands')
                .join('brand_locations', 'brands.id', 'brand_locations.brand_id')
                .where('brand_locations.location_name', location)
                .select('brands.id', 'brands.name', 'brands.sort_order');
        } catch (error) {
            botLog.error('Filialga biriktirilgan brendlarni olishda xatolik:', error.message);
        }
        
        // Brendlar bo'yicha ma'lumotlarni ajratish
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
        
        // Filialga biriktirilgan barcha brendlar uchun 0 qiymat qo'shish (agar qiymat yo'q bo'lsa)
        for (const locationBrand of locationBrands) {
            const brandId = String(locationBrand.id);
            if (!brandTotals[brandId]) {
                brandTotals[brandId] = { brandTotal: 0, columns: {} };
            }
        }
        
        // Brendlar bo'yicha ko'rsatish (ustun tekis, ikki nuqta bilan)
        messageText += `<b>Yangilangan summalar:</b>\n\n`;
        
        // Filialga biriktirilgan brendlar bo'yicha tartiblash
        // Agar sort_order mavjud bo'lsa, shu bo'yicha saralash, aks holda alifbo tartibida
        const sortedBrandIds = locationBrands.length > 0
            ? locationBrands
                .map(b => ({
                    id: String(b.id),
                    name: b.name || brandsMap[String(b.id)] || '',
                    sortOrder: b.sort_order !== null && b.sort_order !== undefined ? parseInt(b.sort_order) : null
                }))
                .sort((a, b) => {
                    // Agar ikkala brendda ham sort_order mavjud bo'lsa, sort_order bo'yicha saralash
                    if (a.sortOrder !== null && b.sortOrder !== null) {
                        return a.sortOrder - b.sortOrder;
                    }
                    // Agar faqat birida sort_order bo'lsa, u birinchi bo'ladi
                    if (a.sortOrder !== null) return -1;
                    if (b.sortOrder !== null) return 1;
                    // Agar ikkalasida ham sort_order yo'q bo'lsa, alifbo tartibida saralash
                    return a.name.localeCompare(b.name, 'uz', { sensitivity: 'base', numeric: true });
                })
                .map(b => b.id)
            : Object.keys(brandTotals)
                .map(brandId => {
                    // brandsMap dan sort_order ni olish uchun qayta so'rov
                    const brand = locationBrands.find(b => String(b.id) === brandId);
                    return {
                        id: brandId,
                        name: brandsMap[brandId] || `Brend #${brandId}`,
                        sortOrder: brand && brand.sort_order !== null && brand.sort_order !== undefined 
                            ? parseInt(brand.sort_order) 
                            : null
                    };
                })
                .sort((a, b) => {
                    // Agar ikkala brendda ham sort_order mavjud bo'lsa, sort_order bo'yicha saralash
                    if (a.sortOrder !== null && b.sortOrder !== null) {
                        return a.sortOrder - b.sortOrder;
                    }
                    // Agar faqat birida sort_order bo'lsa, u birinchi bo'ladi
                    if (a.sortOrder !== null) return -1;
                    if (b.sortOrder !== null) return 1;
                    // Agar ikkalasida ham sort_order yo'q bo'lsa, alifbo tartibida saralash
                    return a.name.localeCompare(b.name, 'uz', { sensitivity: 'base', numeric: true });
                })
                .map(b => b.id);
        
        const brandLines = [];
        
        // Brendlar va qiymatlarni to'plash
        for (const brandId of sortedBrandIds) {
            const { brandTotal = 0 } = brandTotals[brandId] || {};
                const brandName = brandsMap[brandId] || `Brend #${brandId}`;
                const formattedValue = formatCurrency(brandTotal, reportCurrency);
            // Oddiy format: BrandName: summa
            brandLines.push(`${escapeHtml(brandName)}: <code>${formattedValue}</code>`);
        }
        
        // Har bir brend alohida qatorda
        messageText += brandLines.join('\n') + `\n\n`;

        // Jami summa - qiymat allaqachon tanlangan valyutada, konvertatsiya qilmaslik kerak
        messageText += `💰 <b>JAMI:</b> <code>${formatCurrency(grandTotal, reportCurrency)}</code>`;
        
        // Kechikish sababi (agar mavjud bo'lsa)
        if (late_comment && late_comment.trim()) {
            messageText += `\n\n⚠️ <b>Kechikish sababi:</b> ${escapeHtml(late_comment)}`;
        }

    } else if (type === 'edit') {
        // Eski sanani ko'rsatish
        const formattedOldDate = old_report_date ? format(new Date(old_report_date), 'dd.MM.yyyy') : null;
        const formattedNewDate = format(new Date(date), 'dd.MM.yyyy');
        
        messageText += `✍️ <b>Hisobot Tahrirlandi #${String(report_id).padStart(4, '0')}</b>\n`;
        if (formattedOldDate) {
            messageText += `📅 ${formattedOldDate} uchun hisobot\n`;
        }
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

        // Filialga biriktirilgan brendlarni olish (sort_order bilan)
        let locationBrands = [];
        try {
            locationBrands = await db('brands')
                .join('brand_locations', 'brands.id', 'brand_locations.brand_id')
                .where('brand_locations.location_name', location)
                .select('brands.id', 'brands.name', 'brands.sort_order');
        } catch (error) {
            botLog.error('Filialga biriktirilgan brendlarni olishda xatolik:', error.message);
        }

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
        
        // Filialga biriktirilgan barcha brendlar uchun 0 qiymat qo'shish (agar qiymat yo'q bo'lsa)
        for (const locationBrand of locationBrands) {
            const brandId = String(locationBrand.id);
            if (!brandChanges[brandId]) {
                brandChanges[brandId] = { newTotal: 0, oldTotal: 0, columns: {} };
            }
        }
        
        // Filialga biriktirilgan brendlar bo'yicha tartiblash
        // Agar sort_order mavjud bo'lsa, shu bo'yicha saralash, aks holda alifbo tartibida
        const sortedBrandIds = locationBrands.length > 0
            ? locationBrands
                .map(b => ({
                    id: String(b.id),
                    name: b.name || brandsMap[String(b.id)] || '',
                    sortOrder: b.sort_order !== null && b.sort_order !== undefined ? parseInt(b.sort_order) : null
                }))
                .sort((a, b) => {
                    // Agar ikkala brendda ham sort_order mavjud bo'lsa, sort_order bo'yicha saralash
                    if (a.sortOrder !== null && b.sortOrder !== null) {
                        return a.sortOrder - b.sortOrder;
                    }
                    // Agar faqat birida sort_order bo'lsa, u birinchi bo'ladi
                    if (a.sortOrder !== null) return -1;
                    if (b.sortOrder !== null) return 1;
                    // Agar ikkalasida ham sort_order yo'q bo'lsa, alifbo tartibida saralash
                    return a.name.localeCompare(b.name, 'uz', { sensitivity: 'base', numeric: true });
                })
                .map(b => b.id)
            : Object.keys(brandChanges)
                .map(brandId => {
                    // brandsMap dan sort_order ni olish uchun qayta so'rov
                    const brand = locationBrands.find(b => String(b.id) === brandId);
                    return {
                        id: brandId,
                        name: brandsMap[brandId] || `Brend #${brandId}`,
                        sortOrder: brand && brand.sort_order !== null && brand.sort_order !== undefined 
                            ? parseInt(brand.sort_order) 
                            : null
                    };
                })
                .sort((a, b) => {
                    // Agar ikkala brendda ham sort_order mavjud bo'lsa, sort_order bo'yicha saralash
                    if (a.sortOrder !== null && b.sortOrder !== null) {
                        return a.sortOrder - b.sortOrder;
                    }
                    // Agar faqat birida sort_order bo'lsa, u birinchi bo'ladi
                    if (a.sortOrder !== null) return -1;
                    if (b.sortOrder !== null) return 1;
                    // Agar ikkalasida ham sort_order yo'q bo'lsa, alifbo tartibida saralash
                    return a.name.localeCompare(b.name, 'uz', { sensitivity: 'base', numeric: true });
                })
                .map(b => b.id);
        
        const brandLines = [];
        const brandData = [];
        
        // Ma'lumotlarni to'plash (barcha brendlar, 0 qiymat bilan ham)
        for (const brandId of sortedBrandIds) {
            const { newTotal = 0, oldTotal = 0 } = brandChanges[brandId] || {};
                const brandName = brandsMap[brandId] || `Brend #${brandId}`;
                const formattedNewValue = formatCurrency(newTotal, reportCurrency);
                const formattedOldValue = formatCurrency(oldTotal, reportCurrency);
                brandData.push({ brandName, newTotal, oldTotal, formattedNewValue, formattedOldValue });
            }
        
        // Har bir brend uchun formatlash (oddiy format)
        for (const { brandName, newTotal, oldTotal, formattedNewValue, formattedOldValue } of brandData) {
            if (newTotal !== oldTotal) {
                const sign = newTotal > oldTotal ? '➕' : '➖';
                // Oddiy format: BrandName: oldValue → newValue ➕
                brandLines.push(`${escapeHtml(brandName)}: <s>${formattedOldValue}</s> → <code>${formattedNewValue}</code> ${sign}`);
            } else {
                // Oddiy format: BrandName: summa
                brandLines.push(`${escapeHtml(brandName)}: <code>${formattedNewValue}</code>`);
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
        
        // Kechikish sababi (agar mavjud bo'lsa)
        if (late_comment && late_comment.trim()) {
            messageText += `\n\n⚠️ <b>Kechikish sababi:</b> ${escapeHtml(late_comment)}`;
        }
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
    const { type, chat_id, admin_chat_id, user_id, username, fullname, token, password, secret_word, requester, requester_fullname, request_id, reason } = payload;
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
            // Log options va reply_markup ni tekshirish
            if (options.reply_markup) {
                botLog.info(`[BOT] [SEND-MARKDOWN-V2] reply_markup mavjud:`, JSON.stringify(options.reply_markup, null, 2));
            } else {
                botLog.info(`[BOT] [SEND-MARKDOWN-V2] reply_markup yo'q`);
            }
            
            const messageOptions = { parse_mode: 'MarkdownV2', ...options };
            botLog.info(`[BOT] [SEND-MARKDOWN-V2] Yuboriladigan options:`, JSON.stringify(messageOptions, null, 2));
            
            // Telegram API'ga to'g'ridan-to'g'ri yuborish va javobni log qilish
            const result = await bot.sendMessage(chatId, text, messageOptions);
            
            botLog.info(`[BOT] [SEND-MARKDOWN-V2] ✅ Xabar muvaffaqiyatli yuborildi. Message ID: ${result.message_id}`);
            
            // Agar reply_markup yuborilgan bo'lsa, javobni tekshirish
            if (options.reply_markup && result) {
                botLog.info(`[BOT] [SEND-MARKDOWN-V2] Reply markup yuborilgan. Result:`, JSON.stringify(result, null, 2));
                // Telegram API javobida reply_markup borligini tekshirish
                if (result.reply_markup) {
                    botLog.info(`[BOT] [SEND-MARKDOWN-V2] ✅ Reply markup Telegram API javobida mavjud`);
                } else {
                    botLog.warn(`[BOT] [SEND-MARKDOWN-V2] ⚠️ Reply markup Telegram API javobida yo'q!`);
                }
            }

            return result;
        } catch (error) {
            const body = error.response?.body;
            botLog.error(`[BOT] [SEND-MARKDOWN-V2] ❌ MarkdownV2 xabar yuborishda xatolik (chat_id: ${chatId}):`, {
                error_code: body?.error_code,
                description: body?.description,
                message: error.message,
                options: JSON.stringify(options, null, 2),
                stack: error.stack
            });
            
            // Agar reply_markup bilan muammo bo'lsa, uni log qilish
            if (options.reply_markup) {
                botLog.error(`[BOT] [SEND-MARKDOWN-V2] ⚠️ Reply markup bilan xatolik yuz berdi. Reply markup:`, JSON.stringify(options.reply_markup, null, 2));
            }
            
            return null;
        }
    }

    switch (type) {
        case 'secret_word_request':
            text = `Salom, *${escapeMarkdownV2(username)}*\\! \n\n${escapeMarkdownV2("Tizimga yangi qurilmadan kirishga urinish aniqlandi. Xavfsizlikni tasdiqlash uchun, iltimos, ")}*${escapeMarkdownV2("maxfiy so'zingizni")}*${escapeMarkdownV2(" shu botga yozib yuboring.")}`;
            const secretWordMsg = await sendMarkdownV2Message(chat_id, text);
            // Xabar ID'sini saqlash (keyinchalik o'chirish uchun)
            userStates[chat_id] = { 
                state: 'awaiting_secret_word', 
                user_id, 
                attempts_left: 2,
                secret_word_message_id: secretWordMsg?.message_id || null
            };
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
            const user = await db('users').where({ id: user_id }).select('creds_message_id', 'password_change_message_id').first();
            if (user && user.creds_message_id) {
                try {
                    await bot.deleteMessage(chat_id, user.creds_message_id);
                    await db('users').where({ id: user_id }).update({ creds_message_id: null });
                } catch (error) {
                    // Silent fail - old message deletion is optional
                }
            }
            // Parol o'zgartirish xabarini ham o'chirish
            if (user && user.password_change_message_id) {
                try {
                    await bot.deleteMessage(chat_id, user.password_change_message_id);
                    await db('users').where({ id: user_id }).update({ 
                        password_change_message_id: null,
                        must_delete_password_change_message: false
                    });
                } catch (error) {
                    // Silent fail - old message deletion is optional
                }
            }
            break;
            
        case 'password_change_request':
            botLog.info(`[BOT] password_change_request qayta ishlanmoqda. Chat ID: ${chat_id}, User ID: ${user_id}, Requester: ${requester || username}, Request ID: ${request_id}`);
            botLog.info(`[BOT] Request ID type: ${typeof request_id}, value: ${request_id}, is null: ${request_id === null}, is undefined: ${request_id === undefined}`);
            text = `🔑 *${escapeMarkdownV2("Parol O'zgartirish So'rovi")}*\\!\n\n${escapeMarkdownV2("Foydalanuvchi parolni o'zgartirish so'rovi yubordi.")}\n\n👤 *${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(requester || username)}\n${requester_fullname ? `📝 *${escapeMarkdownV2("To'liq ism:")}* ${escapeMarkdownV2(requester_fullname)}\n` : ''}🆔 *${escapeMarkdownV2("ID:")}* ${user_id}\n\n${escapeMarkdownV2("Quyidagi tugmalar orqali tasdiqlash yoki rad etish mumkin.")}`;
            
            // Inline keyboard qo'shish - knopkalar yonma-yon bo'lishi kerak
            keyboard = null;
            if (request_id) {
                keyboard = {
                    inline_keyboard: [
                        [
                            { text: "✅ Tasdiq", callback_data: `password_approve_${request_id}` },
                            { text: "❌ Rad et", callback_data: `password_reject_${request_id}` }
                        ]
                    ]
                };
                botLog.info(`[BOT] ✅ Inline keyboard yaratildi. Request ID: ${request_id}, Callback data: password_approve_${request_id}, password_reject_${request_id}`);
            } else {
                botLog.warn(`[BOT] ⚠️ Request ID yo'q, inline keyboard yaratilmaydi. Request ID: ${request_id}`);
            }
            
            botLog.info(`[BOT] Xabar matni tayyorlandi, yuborilmoqda... Keyboard: ${keyboard ? 'mavjud' : 'yo\'q'}`);
            if (keyboard) {
                botLog.info(`[BOT] Keyboard structure:`, JSON.stringify(keyboard, null, 2));
            }
            const passwordChangeResult = await sendMarkdownV2Message(chat_id, text, keyboard ? { reply_markup: keyboard } : {});
            if (!passwordChangeResult) {
                botLog.error(`[BOT] ❌ Parol o'zgartirish so'rovi yuborilmadi. Chat ID: ${chat_id}`);
            } else {
                botLog.info(`[BOT] ✅ Parol o'zgartirish so'rovi muvaffaqiyatli yuborildi. Chat ID: ${chat_id}, Message ID: ${passwordChangeResult.message_id}, Keyboard: ${keyboard ? 'yuborildi' : 'yuborilmadi'}`);
            }
            break;
            
        case 'password_changed':
            botLog.info(`[BOT] password_changed qayta ishlanmoqda. Chat ID: ${chat_id}, Username: ${username}`);
            
            // Agar foydalanuvchi yangi parolni o'zi kiritgan bo'lsa (request yuborilganda), 
            // uni xabarda ko'rsatish kerak emas, chunki u allaqachon biladi.
            // Faqat parol o'zgartirildi haqida xabar yuboriladi.
            text = `✅ *${escapeMarkdownV2("Parol O'zgartirildi")}*\\!\n\n${escapeMarkdownV2("Sizning parolingiz muvaffaqiyatli o'zgartirildi.")}\n\n👤 *${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(username)}\n\n${escapeMarkdownV2("Endi yangi parol bilan tizimga kirishingiz mumkin.")}\n\n${escapeMarkdownV2("⚠️ Diqqat:")} ${escapeMarkdownV2("Ushbu xabar tizimga birinchi marta kirganingizdan so'ng avtomatik o'chib ketadi.")}`;
            botLog.info(`[BOT] Xabar matni tayyorlandi, yuborilmoqda...`);
            const passwordChangedResult = await sendMarkdownV2Message(chat_id, text, {
                disable_web_page_preview: true,
                protect_content: true
            });
            if (!passwordChangedResult) {
                botLog.error(`[BOT] ❌ Parol o'zgartirildi xabari yuborilmadi. Chat ID: ${chat_id}`);
            } else {
                // Xabar ID'sini saqlash (keyinchalik o'chirish uchun)
                await db('users').where({ id: user_id }).update({ 
                    password_change_message_id: passwordChangedResult.message_id,
                    must_delete_password_change_message: true
                });
                botLog.info(`[BOT] ✅ Parol o'zgartirildi xabari muvaffaqiyatli yuborildi. Chat ID: ${chat_id}, Message ID: ${passwordChangedResult.message_id}`);
            }
            break;
            
        case 'password_change_rejected':
            botLog.info(`[BOT] password_change_rejected qayta ishlanmoqda. Chat ID: ${chat_id}, Username: ${username}`);
            const reason = payload.reason || 'Sabab ko\'rsatilmagan';
            text = `❌ *${escapeMarkdownV2("Parol O'zgartirish So'rovi Rad Etildi")}*\\!\n\n${escapeMarkdownV2("Sizning parol o'zgartirish so'rovingiz rad etildi.")}\n\n👤 *${escapeMarkdownV2("Foydalanuvchi:")}* ${escapeMarkdownV2(username)}\n📝 *${escapeMarkdownV2("Sabab:")}* ${escapeMarkdownV2(reason)}\n\n${escapeMarkdownV2("Iltimos, admin bilan bog'laning yoki qayta urinib ko'ring.")}`;
            botLog.info(`[BOT] Xabar matni tayyorlandi, yuborilmoqda...`);
            const passwordRejectedResult = await sendMarkdownV2Message(chat_id, text);
            if (!passwordRejectedResult) {
                botLog.error(`[BOT] ❌ Parol o'zgartirish rad etildi xabari yuborilmadi. Chat ID: ${chat_id}`);
            } else {
                botLog.info(`[BOT] ✅ Parol o'zgartirish rad etildi xabari muvaffaqiyatli yuborildi. Chat ID: ${chat_id}, Message ID: ${passwordRejectedResult.message_id}`);
            }
            break;
    }
}


// Parol tiklash so'rovini tasdiqlash/rad etish handler
async function handlePasswordChangeRequestCallback(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    try {
        // Callback_data format: password_approve_${requestId} yoki password_reject_${requestId}
        const parts = data.split('_');
        const action = parts[1]; // 'approve' yoki 'reject'
        const requestId = parseInt(parts[2]);
        
        botLog.info(`[PASSWORD-CALLBACK] ${action} chaqirildi. Request ID: ${requestId}, User ID: ${userId}, Chat ID: ${chatId}`);
        
        // Superadmin chat ID ni settings'dan olish
        const adminChatIdSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
        const adminChatIdFromSettings = adminChatIdSetting ? adminChatIdSetting.value : null;
        
        botLog.info(`[PASSWORD-CALLBACK] Settings'dan admin chat ID: ${adminChatIdFromSettings || 'YO\'Q'}, Callback chat ID: ${chatId}`);
        
        // Foydalanuvchini tekshirish
        const user = await db('users').where({ telegram_chat_id: chatId }).first();
        
        // Bot orqali ruxsat: agar chat ID settings'dagi admin chat ID ga mos kelsa, superadmin ruxsati beriladi
        const isSuperAdminChatId = adminChatIdFromSettings && String(chatId) === String(adminChatIdFromSettings);
        
        if (!user && !isSuperAdminChatId) {
            botLog.error(`[PASSWORD-CALLBACK] ❌ Foydalanuvchi topilmadi va superadmin chat ID ham mos kelmaydi. Chat ID: ${chatId}`);
            await bot.answerCallbackQuery(query.id, { text: '❌ Foydalanuvchi topilmadi', show_alert: true });
            return;
        }
        
        // Bot orqali superadmin ruxsati tekshiruvi
        if (isSuperAdminChatId) {
            botLog.info(`[PASSWORD-CALLBACK] ✅ Superadmin chat ID mos keldi. Bot orqali ruxsat berildi. Chat ID: ${chatId}`);
            // Superadmin ruxsati mavjud, davom etamiz
        } else if (user) {
            // Foydalanuvchi topildi, permission tekshirish
            botLog.info(`[PASSWORD-CALLBACK] Foydalanuvchi topildi: ${user.username} (ID: ${user.id}), Role: ${user.role}`);
            
            // Permission tekshirish - superadmin uchun alohida tekshirish
            const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
            let hasPermission = false;
            
            if (isSuperAdmin) {
                // Superadmin uchun permission mavjud
                hasPermission = true;
                botLog.info(`[PASSWORD-CALLBACK] ✅ Superadmin permission mavjud`);
            } else {
                // Boshqa foydalanuvchilar uchun permission tekshirish
                const rolePermission = await db('users')
                    .join('role_permissions', 'users.role', 'role_permissions.role_name')
                    .where('users.id', user.id)
                    .where('role_permissions.permission_key', 'users:change_password')
                    .first();
                
                const userPermission = await db('users')
                    .join('user_permissions', 'users.id', 'user_permissions.user_id')
                    .where('users.id', user.id)
                    .where('user_permissions.permission_key', 'users:change_password')
                    .where('user_permissions.type', 'additional')
                    .first();
                
                hasPermission = !!(rolePermission || userPermission);
                botLog.info(`[PASSWORD-CALLBACK] Permission tekshiruvi: Role permission: ${!!rolePermission}, User permission: ${!!userPermission}, Has permission: ${hasPermission}`);
            }
            
            if (!hasPermission) {
                botLog.error(`[PASSWORD-CALLBACK] ❌ Permission yo'q. User: ${user.username} (ID: ${user.id}), Role: ${user.role}`);
                await bot.answerCallbackQuery(query.id, { text: '❌ Sizda bu amalni bajarish huquqi yo\'q', show_alert: true });
                return;
            }
        } else {
            botLog.error(`[PASSWORD-CALLBACK] ❌ Foydalanuvchi topilmadi va superadmin chat ID ham mos kelmaydi. Chat ID: ${chatId}`);
            await bot.answerCallbackQuery(query.id, { text: '❌ Foydalanuvchi topilmadi', show_alert: true });
            return;
        }
        
        // user_id ni aniqlash - agar superadmin chat ID bo'lsa, superadmin'ni topish
        let userIdForApi = user ? user.id : null;
        if (!userIdForApi && isSuperAdminChatId) {
            const superAdminUser = await db('users').whereIn('role', ['superadmin', 'super_admin']).first();
            if (superAdminUser) {
                userIdForApi = superAdminUser.id;
                botLog.info(`[PASSWORD-CALLBACK] Superadmin user topildi: ${superAdminUser.username} (ID: ${superAdminUser.id})`);
            }
        }
        
        if (!userIdForApi) {
            botLog.error(`[PASSWORD-CALLBACK] ❌ User ID aniqlanmadi. Chat ID: ${chatId}`);
            await bot.answerCallbackQuery(query.id, { text: '❌ Foydalanuvchi topilmadi', show_alert: true });
            return;
        }
        
        // So'rovni olish
        const request = await db('password_change_requests')
            .where({ id: requestId, status: 'pending' })
            .first();
        
        if (!request) {
            await bot.answerCallbackQuery(query.id, { text: '❌ So\'rov topilmadi yoki allaqachon ko\'rib chiqilgan', show_alert: true });
            // Xabarni yangilash
            try {
                await bot.editMessageText(
                    query.message.text + '\n\n⚠️ <b>So\'rov topilmadi yoki allaqachon ko\'rib chiqilgan.</b>',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: {}
                    }
                );
            } catch (e) {
                // Xatolikni e'tiborsiz qoldirish
            }
            return;
        }
        
        // API endpoint'ga so'rov yuborish
        const endpoint = action === 'approve' 
            ? `/api/telegram/password-change-requests/${requestId}/approve`
            : `/api/telegram/password-change-requests/${requestId}/reject`;
        
        const method = 'POST';
        const body = JSON.stringify({
            telegram_chat_id: chatId,
            user_id: userIdForApi,
            comment: action === 'reject' ? 'Telegram bot orqali rad etildi' : undefined
        });
        
        botLog.info(`[PASSWORD-CALLBACK] API so'rovi yuborilmoqda: ${endpoint}, User ID: ${userIdForApi}`);
        
        const response = await fetch(new URL(endpoint, NODE_SERVER_URL).href, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'API xatolik');
        }
        
        // Xabarni yangilash
        const statusText = action === 'approve' 
            ? '✅ <b>Tasdiqlandi</b>'
            : '❌ <b>Rad etildi</b>';
        
        const userName = user ? (user.fullname || user.username) : 'Superadmin';
        const newText = query.message.text + `\n\n${statusText}\n👤 <b>Tasdiqlovchi:</b> ${escapeHtml(userName)}`;
        
        try {
            await bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {}
            });
        } catch (editError) {
            botLog.warn(`[PASSWORD-CALLBACK] Xabarni yangilashda xatolik: ${editError.message}`);
        }
        
        await bot.answerCallbackQuery(query.id, { 
            text: action === 'approve' ? '✅ So\'rov tasdiqlandi' : '❌ So\'rov rad etildi',
            show_alert: false 
        });
        
        botLog.info(`[PASSWORD-CALLBACK] ✅ ${action} muvaffaqiyatli yakunlandi. Request ID: ${requestId}`);
        
    } catch (error) {
        botLog.error(`[PASSWORD-CALLBACK] ❌ Xatolik:`, error);
        try {
            await bot.answerCallbackQuery(query.id, { 
                text: `❌ Xatolik: ${error.message}`, 
                show_alert: true 
            });
        } catch (e) {
            // E'tiborsiz qoldirish
        }
    }
}

async function sendToTelegram(payload) {
    try {
        const { type } = payload;
        botLog.info(`[SEND-TO-TELEGRAM] Xabar yuborilmoqda. Type: ${type}, Payload keys: ${Object.keys(payload).join(', ')}`);

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
        } else if (type === 'delete') {
            // O'chirish xabari
            const groupIdSetting = await db('settings').where({ key: 'telegram_group_id' }).first();
            let groupId = groupIdSetting ? groupIdSetting.value : null;

            if (!groupId) {
                botLog.error("Telegram guruh ID si topilmadi. O'chirish xabari yuborilmadi.");
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

            const { report_id, location, date, brand_name, deleted_by, deleted_by_fullname, deleted_by_id } = payload;
            
            // Foydalanuvchi ma'lumotlarini olish
            let userFullname = deleted_by_fullname || deleted_by;
            let userTelegramUsername = null;
            
            try {
                if (deleted_by_id) {
                    const user = await db('users').where({ id: deleted_by_id }).select('fullname', 'telegram_username', 'username').first();
                    if (user) {
                        userFullname = user.fullname || user.username || deleted_by;
                        userTelegramUsername = user.telegram_username;
                    }
                }
            } catch (error) {
                botLog.error('Foydalanuvchi ma\'lumotlarini olishda xatolik:', error.message);
            }

            const formattedDate = format(new Date(date), 'dd.MM.yyyy');
            
            let messageText = `🗑️ <b>Hisobot O'chirildi</b>\n\n`;
            messageText += `📋 Hisobot #${String(report_id).padStart(4, '0')}\n`;
            messageText += `📍 Filial: <b>${escapeHtml(location)}</b>\n`;
            if (brand_name) {
                messageText += `🏢 Brend: <b>${escapeHtml(brand_name)}</b>\n`;
            }
            messageText += `📅 Sana: ${formattedDate}\n\n`;
            messageText += `👤 O'chirdi: <b>${escapeHtml(userFullname)}</b>\n`;
            if (userTelegramUsername) {
                messageText += `📱 @${escapeHtml(userTelegramUsername)}\n`;
            }
            messageText += `\n⚠️ <i>Bu amalni qaytarib bo'lmaydi!</i>`;

            await safeSendMessage(groupId, messageText);
        } else if ([
            'secret_word_request', 
            'magic_link_request', 
            'security_alert', 
            'account_lock_alert', 
            'new_user_request',
            'new_user_approval',
            'user_approved_credentials',
            'delete_credentials',
            'password_change_request',
            'password_changed',
            'password_change_rejected'
        ].includes(type)) {
            botLog.info(`[SEND-TO-TELEGRAM] Type ${type} ro'yxatda topildi, handleSecurityRequest chaqirilmoqda`);
            
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
            
            botLog.info(`[SEND-TO-TELEGRAM] handleSecurityRequest chaqirilmoqda. Type: ${type}, Chat ID: ${payload.chat_id || payload.admin_chat_id || 'N/A'}`);
            await handleSecurityRequest(payload);
            botLog.info(`[SEND-TO-TELEGRAM] handleSecurityRequest yakunlandi. Type: ${type}`);

        }

    } catch (error) {
        botLog.error(`[SEND-TO-TELEGRAM] ❌ Telegramga yuborish funksiyasida kutilmagan xatolik:`, error.message);
        botLog.error(`[SEND-TO-TELEGRAM] Stack trace:`, error.stack);
    }
}

const initializeBot = async (botToken, options = { polling: true }) => {
    if (!botToken) {
        botLog.error('[INIT] Bot token topilmadi, bot ishga tushirilmaydi');
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

    // Polling sozlamalari - timeout va qayta urinish
    if (options.polling) {
        // Polling rejimida - timeout va interval sozlamalari
        bot = new TelegramBot(botToken, {
            polling: {
                interval: 1000, // 1 soniyada bir marta so'rov
                autoStart: true,
                params: {
                    timeout: 10 // 10 soniya timeout
                }
            }
        });
    } else {
        bot = new TelegramBot(botToken, options);
    }
    
    botIsInitialized = true;

    // Polling error handler - qayta urinish mexanizmi bilan
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 30000; // 30 soniya
    
    bot.on('polling_error', async (error) => {
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
        
        // ETIMEDOUT yoki boshqa tarmoq xatoliklari - debug level'da log qilamiz
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.message?.includes('timeout')) {
            // Bu xatoliklar odatda tarmoq muammosi yoki vaqtinchalik bog'lanish muammosi
            // Bot avtomatik qayta urinib ko'radi, shuning uchun faqat debug level'da log qilamiz
            botLog.debug(`[BOT] Polling tarmoq xatoligi (avtomatik qayta uriniladi): ${error.code} - ${error.message}`);
            return; // Xatolikni qayta ko'rsatmaslik, bot avtomatik qayta urinib ko'radi
        }
        
        // Boshqa xatoliklarni ko'rsatish
        botLog.error(`[BOT] Polling xatoligi: ${error.code} - ${error.message}`);
        
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
            
            // Agar bu guruh bo'lsa (chatId manfiy raqam)
            if (chatId < 0) {
                try {
                    // Rahbarlar guruhini tekshirish
                    const leadersGroup = await db('debt_groups')
                        .where('group_type', 'leaders')
                        .where('is_active', true)
                        .first();
                    
                    if (leadersGroup && leadersGroup.telegram_group_id === chatId) {
                        // Rahbarlar guruhida /start bosilganda reply keyboard yuborish
                        const welcomeText = `✅ <b>Bot ishga tushdi!</b>\n\n` +
                            `Rahbarlar uchun bloklash va boshqaruv funksiyalari mavjud.\n\n` +
                            `Quyidagi tugmalardan foydalaning:`;
                        
                        const keyboard = {
                            keyboard: [
                                [{ text: "📥 SET so'rovlari" }],
                                [{ text: "📋 Tasdiqlangan so'rovlar" }],
                                [{ text: "🚫 Bloklash" }]
                            ],
                            resize_keyboard: true,
                            one_time_keyboard: false
                        };
                        
                        try {
                            await bot.sendMessage(chatId, welcomeText, {
                                parse_mode: 'HTML',
                                reply_markup: keyboard
                            });
                            botLog.info(`Reply keyboard rahbarlar guruhiga /start orqali yuborildi: groupId=${chatId}`);
                            return; // Guruhda /start bosilganda, shaxsiy chat handler'iga o'tmasin
                        } catch (keyboardError) {
                            botLog.warn(`Guruhga keyboard yuborishda xatolik (bot admin bo'lishi kerak): ${keyboardError.message}`);
                        }
                    }
                    
                    // Operatorlar guruhini tekshirish
                    const operatorsGroup = await db('debt_groups')
                        .where('group_type', 'operators')
                        .where('is_active', true)
                        .first();
                    
                    if (operatorsGroup && operatorsGroup.telegram_group_id === chatId) {
                        // Operatorlar guruhida /start bosilganda xabar yuborish
                        const welcomeText = `✅ <b>Bot ishga tushdi!</b>\n\n` +
                            `Operatorlar guruhi uchun bot faollashtirildi.\n\n` +
                            `Operatorlar tasdiqlash jarayonlari bu yerda amalga oshiriladi.`;
                        
                        try {
                            await bot.sendMessage(chatId, welcomeText, {
                                parse_mode: 'HTML'
                            });
                            botLog.info(`Xabar operatorlar guruhiga /start orqali yuborildi: groupId=${chatId}`);
                            return; // Guruhda /start bosilganda, shaxsiy chat handler'iga o'tmasin
                        } catch (sendError) {
                            botLog.warn(`Operatorlar guruhiga xabar yuborishda xatolik: ${sendError.message}`);
                        }
                    }
                } catch (groupError) {
                    botLog.error('Guruh tekshiruvida xatolik:', groupError);
                }
            }
            


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
                        botLog.error(`[TOKEN] Token topilmadi yoki muddati tugagan. Token: ${token.substring(0, 30)}..., Chat ID: ${chatId}`);
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
            try {
                const userHelper = require('../bot/unified/userHelper.js');
                const { createUnifiedKeyboard, createRegistrationKeyboard } = require('../bot/unified/keyboards.js');
                const stateManager = require('../bot/unified/stateManager.js');
                
                // userId ni msg.from.id dan olish
                const telegramUserId = msg.from.id;
                const user = await userHelper.getUserByTelegram(chatId, telegramUserId);
                
                if (user) {
                    // Rahbarlar guruhida ekanligini tekshirish
                    const { isUserInGroup } = require('../utils/groupValidator.js');
                    const userInLeadersGroup = await isUserInGroup(user.id, 'leaders');
                    
                    // Eski xabarlarni tozalash (xavfsizlik uchun - maxfiy ma'lumotlar ko'rinmasligi uchun)
                    // Message ID'larni saqlash orqali tozalash
                    try {
                        // Foydalanuvchining so'nggi xabarlarini o'chirish
                        // Telegram API orqali so'nggi xabarlarni olish va o'chirish
                        // Eslatma: Bu faqat polling rejimida ishlaydi
                        if (bot.isPolling && bot.isPolling()) {
                            // getUpdates() orqali so'nggi xabarlarni olish
                            try {
                                const updates = await bot.getUpdates({ offset: -50, limit: 50 });
                                const messagesToDelete = [];
                                
                                // Faqat joriy chat'dan va foydalanuvchidan kelgan xabarlarni to'plash
                                for (const update of updates || []) {
                                    if (update.message && 
                                        update.message.chat.id === chatId && 
                                        update.message.from.id === telegramUserId &&
                                        update.message.message_id &&
                                        update.message.message_id !== msg.message_id) { // Joriy xabarni o'chirmaslik
                                        messagesToDelete.push(update.message.message_id);
                                    }
                                }
                                
                                // Xabarlarni teskari tartibda o'chirish (eng eski avval)
                                messagesToDelete.reverse();
                                // Bir safarda 5 tagacha o'chirish (rate limit'ni oldini olish uchun)
                                for (const messageId of messagesToDelete.slice(0, 5)) {
                                    try {
                                        await bot.deleteMessage(chatId, messageId);
                                        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms kutish
                                    } catch (deleteError) {
                                        // Silent fail - eski xabarlarni o'chirish ixtiyoriy
                                    }
                                }
                            } catch (getUpdatesError) {
                                // getUpdates() ishlamasa, e'tiborsiz qoldirish
                            }
                        }
                    } catch (cleanupError) {
                        // Silent fail - cleanup ixtiyoriy
                    }
                    
                    // Status tekshirish
                    if (userHelper.isPending(user)) {
                        const pendingMessage = `⏳ <b>So'rovingiz ko'rib chiqilmoqda</b>\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `👤 <b>To'liq ism:</b> ${user.fullname || 'Noma\'lum'}\n` +
                            `👔 <b>Rol:</b> ${user.role || 'Tasdiqlanmagan'}\n` +
                            `📊 <b>Holat:</b> <b>Admin tasdig'ini kutmoqda</b>\n\n` +
                            `⏱️ Admin tomonidan tasdiqlangandan keyin sizga xabar yuboriladi.\n\n` +
                            `💡 Bu odatda 1-2 soat ichida amalga oshiriladi.`;
                        
                        // Agar so'nggi xabar mavjud bo'lsa, uni yangilash, aks holda yangi xabar yuborish
                        // Avval database'dan to'liq ma'lumotni olish (bot_pending_message_id bilan)
                        const userWithPendingMsg = await db('users').where({ id: user.id }).first();
                        
                        if (userWithPendingMsg && userWithPendingMsg.bot_pending_message_id) {
                            try {
                                await bot.editMessageText(pendingMessage, {
                                    chat_id: chatId,
                                    message_id: userWithPendingMsg.bot_pending_message_id,
                                    parse_mode: 'HTML'
                                });
                                botLog.debug(`Pending xabar yangilandi: message_id=${userWithPendingMsg.bot_pending_message_id}`);
                                return;
                            } catch (editError) {
                                // Agar xabarni yangilab bo'lmasa (masalan, o'chirilgan bo'lsa), yangi xabar yuborish
                                botLog.debug(`Pending xabarni yangilab bo'lmadi, yangi xabar yuborilmoqda: ${editError.message}`);
                                // Eski message_id'ni tozalash
                                await db('users').where({ id: user.id }).update({ 
                                    bot_pending_message_id: null 
                                });
                            }
                        }
                        
                        // Yangi xabar yuborish va message_id'ni saqlash
                        const sentMessage = await safeSendMessage(chatId, pendingMessage, { parse_mode: 'HTML' });
                        if (sentMessage && sentMessage.message_id) {
                            await db('users').where({ id: user.id }).update({ 
                                bot_pending_message_id: sentMessage.message_id 
                            });
                            botLog.debug(`Yangi pending xabar yuborildi va saqlandi: message_id=${sentMessage.message_id}`);
                        }
                        return;
                    }
                    
                    // Agar status = 'active' bo'lsa, unified keyboard ko'rsatish
                    if (userHelper.isActive(user)) {
                        // Foydalanuvchiga biriktirilgan filial va brendlarni olish
                        const [userBrandsRaw, userBranchesRaw, cashierBranchesRaw, operatorBrandsRaw] = await Promise.all([
                            db('debt_user_brands')
                                .where('user_id', user.id)
                                .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                                .select('debt_brands.id', 'debt_brands.name')
                                .groupBy('debt_brands.id', 'debt_brands.name')
                                .orderBy('debt_brands.name'),
                            db('debt_user_branches')
                                .where('user_id', user.id)
                                .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                                .select('debt_branches.id', 'debt_branches.name')
                                .groupBy('debt_branches.id', 'debt_branches.name')
                                .orderBy('debt_branches.name'),
                            // Kassir uchun debt_cashiers jadvalidan ham filiallarni olish
                            userHelper.hasRole(user, ['kassir', 'cashier']) 
                                ? db('debt_cashiers')
                                    .where('user_id', user.id)
                                    .where('is_active', true)
                                    .join('debt_branches', 'debt_cashiers.branch_id', 'debt_branches.id')
                                    .select('debt_branches.id', 'debt_branches.name')
                                    .groupBy('debt_branches.id', 'debt_branches.name')
                                    .orderBy('debt_branches.name')
                                : Promise.resolve([]),
                            // Operator uchun debt_operators jadvalidan ham brendlarni olish
                            userHelper.hasRole(user, ['operator']) 
                                ? db('debt_operators')
                                    .where('user_id', user.id)
                                    .where('is_active', true)
                                    .join('debt_brands', 'debt_operators.brand_id', 'debt_brands.id')
                                    .select('debt_brands.id', 'debt_brands.name')
                                    .groupBy('debt_brands.id', 'debt_brands.name')
                                    .orderBy('debt_brands.name')
                                : Promise.resolve([])
                        ]);
                        
                        // Dublikatlarni olib tashlash (ID bo'yicha) - debt_user_brands va debt_operators ni birlashtirish
                        const allBrandsRaw = [...userBrandsRaw, ...operatorBrandsRaw];
                        const uniqueBrandsMap = new Map();
                        allBrandsRaw.forEach(brand => {
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
                                const brandNames = userBrands.map(b => escapeHtml(b.name)).join(', ');
                                bindingsText += `🏷️ <b>Brendlar:</b> ${brandNames}\n`;
                            }
                            if (userBranches.length > 0) {
                                const branchNames = userBranches.map(b => escapeHtml(b.name)).join(', ');
                                bindingsText += `📍 <b>Filiallar:</b> ${branchNames}\n`;
                            }
                        }
                        
                        // Vazifalardan rollarni olish
                        const { getUserRolesFromTasks, getSelectedRole, ROLE_DISPLAY_NAMES, shouldShowRoleSelection, getRolesForSelection, getGroupRoleByChatId } = userHelper;
                        const userRolesFromTasks = await getUserRolesFromTasks(user.id);
                        
                        // Guruhda bo'lsa, guruh roli bilan ishlash (rol tanlash so'ralmaydi)
                        const isGroup = chatId < 0;
                        let activeRole = null;
                        
                        if (isGroup) {
                            // Guruhda → guruh roli bilan ishlash
                            const groupRole = await getGroupRoleByChatId(chatId);
                            if (groupRole) {
                                activeRole = groupRole;
                                botLog.info(`[ROLE_SELECTION] Guruhda rol avtomatik tanlandi: userId=${user.id}, chatId=${chatId}, groupRole=${groupRole}`);
                            } else {
                                // Agar guruh roli aniqlanmasa, birinchi rolni tanlash
                                activeRole = userRolesFromTasks.length > 0 ? userRolesFromTasks[0] : user.role;
                            }
                        } else {
                            // Shaxsiy chatda
                            const selectedRole = getSelectedRole(user.id);
                            
                            // Faqat manager + cashier kombinatsiyasi bo'lsa va rol tanlanmagan bo'lsa, rol tanlash so'raladi
                            const shouldShowSelection = shouldShowRoleSelection(userRolesFromTasks);
                            
                            if (shouldShowSelection && !selectedRole) {
                                // Rol tanlash inline keyboard (faqat manager va cashier)
                                const rolesForSelection = getRolesForSelection(userRolesFromTasks);
                                const roleButtons = rolesForSelection.map(role => ({
                                    text: ROLE_DISPLAY_NAMES[role] || role,
                                    callback_data: `select_role_${role}`
                                }));
                            
                            // Keyboard'ni 2 ta yonma-yon qilish
                            const inlineKeyboardRows = [];
                            for (let i = 0; i < roleButtons.length; i += 2) {
                                if (i + 1 < roleButtons.length) {
                                    inlineKeyboardRows.push([roleButtons[i], roleButtons[i + 1]]);
                                } else {
                                    inlineKeyboardRows.push([roleButtons[i]]);
                                }
                            }
                            
                            const roleSelectionMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                                `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                                `Sizda bir nechta rol mavjud. Iltimos, qaysi rol bilan ishlashni tanlang:`;
                            
                            const inlineKeyboard = {
                                inline_keyboard: inlineKeyboardRows
                            };
                            
                            // Agar so'nggi welcome xabar mavjud bo'lsa, uni o'chirish
                            const userWithWelcomeMsg = await db('users').where({ id: user.id }).first();
                            if (userWithWelcomeMsg && userWithWelcomeMsg.bot_welcome_message_id) {
                                try {
                                    await bot.deleteMessage(chatId, userWithWelcomeMsg.bot_welcome_message_id);
                                } catch (deleteError) {
                                    // Silent fail
                                }
                                await db('users').where({ id: user.id }).update({ 
                                    bot_welcome_message_id: null 
                                });
                            }
                            
                            const sentMessage = await safeSendMessage(chatId, roleSelectionMessage, {
                                reply_markup: inlineKeyboard,
                                parse_mode: 'HTML'
                            });
                            
                            if (sentMessage && sentMessage.message_id) {
                                await db('users').where({ id: user.id }).update({
                                    bot_welcome_message_id: sentMessage.message_id
                                });
                            }
                            
                                return; // Rol tanlanguncha boshqa kod ishlamaydi
                            } else {
                                // Agar rol tanlash so'ralmasa yoki rol tanlangan bo'lsa
                                activeRole = selectedRole || (userRolesFromTasks.length > 0 ? userRolesFromTasks[0] : null) || user.role;
                            }
                        }
                        
                        const roleDisplayName = ROLE_DISPLAY_NAMES[activeRole] || activeRole || 'Tasdiqlanmagan';
                        
                        // Foydalanuvchi ma'lumotlarini formatlash (menejernikidek)
                        const userInfoText = `━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `👤 <b>To'liq ism:</b> ${escapeHtml(user.fullname || 'Noma\'lum')}\n` +
                            `👔 <b>Rol:</b> <b>${escapeHtml(roleDisplayName)}</b>\n` +
                            `📊 <b>Holat:</b> <b>Faol</b>`;
                        
                        // Agar so'nggi welcome xabar mavjud bo'lsa, uni yangilash yoki o'chirish
                        const userWithWelcomeMsg = await db('users').where({ id: user.id }).first();
                        
                        // Rahbarlar guruhida bo'lsa VA rahbar roli yoki permission'ga ega bo'lsa, maxsus xabar
                        let welcomeMessage;
                        const userPermissions = await userHelper.getUserPermissions(user.id);
                        const isLeader = userInLeadersGroup && (
                            activeRole === 'rahbar' || 
                            activeRole === 'leader' || 
                            userPermissions.includes('debt:approve_leader')
                        );
                        
                        if (isLeader) {
                            // Rahbarlar uchun maxsus xabar
                            welcomeMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                                `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                                `${userInfoText}${bindingsText}\n\n` +
                                `📋 <b>Rahbarlar uchun funksiyalar:</b>\n` +
                                `• SET so'rovlarni ko'rish va tasdiqlash\n` +
                                `• Bloklangan elementlarni boshqarish\n` +
                                `• Tasdiqlangan so'rovlarni ko'rish\n\n` +
                                `Quyidagi tugmalardan foydalaning:`;
                        } else {
                            // Oddiy foydalanuvchilar uchun
                            welcomeMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                                `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                                `${userInfoText}${bindingsText}\n\n` +
                                `Quyidagi tugmalardan foydalaning:`;
                        }
                        
                        const keyboard = await createUnifiedKeyboard(user, activeRole);
                        
                        // Keyboard'ga "Rolni o'zgartirish" knopkasini qo'shish (faqat shaxsiy chatda va faqat manager+cashier kombinatsiyasi bo'lsa)
                        botLog.debug(`[ROLE_SELECTION] Rol tanlash tekshiruvi: userId=${user.id}, isGroup=${isGroup}, userRolesFromTasks=${userRolesFromTasks.length}, activeRole=${activeRole || 'none'}`);
                        
                        if (!isGroup && shouldShowRoleSelection(userRolesFromTasks)) {
                            // Faqat shaxsiy chatda va faqat manager+cashier kombinatsiyasi bo'lsa
                            keyboard.keyboard.push([{ text: "🔄 Rolni o'zgartirish" }]);
                            botLog.info(`[ROLE_SELECTION] "Rolni o'zgartirish" knopkasi qo'shildi: userId=${user.id}, roles=${userRolesFromTasks.join(',')}`);
                        } else {
                            botLog.debug(`[ROLE_SELECTION] "Rolni o'zgartirish" knopkasi qo'shilmadi: userId=${user.id}, isGroup=${isGroup}, shouldShowSelection=${shouldShowRoleSelection(userRolesFromTasks)}`);
                        }
                        
                        if (userWithWelcomeMsg && userWithWelcomeMsg.bot_welcome_message_id) {
                            try {
                                // Avval yangilashga urinish
                                await bot.editMessageText(welcomeMessage, {
                                    chat_id: chatId,
                                    message_id: userWithWelcomeMsg.bot_welcome_message_id,
                                    reply_markup: keyboard,
                                    parse_mode: 'HTML'
                                });
                                botLog.debug(`Welcome xabar yangilandi: message_id=${userWithWelcomeMsg.bot_welcome_message_id}`);
                                return;
                            } catch (editError) {
                                // Agar xabarni yangilab bo'lmasa, eski xabarni o'chirishga urinish
                                botLog.debug(`Welcome xabarni yangilab bo'lmadi, eski xabarni o'chirishga urinilmoqda: ${editError.message}`);
                                try {
                                    await bot.deleteMessage(chatId, userWithWelcomeMsg.bot_welcome_message_id);
                                    botLog.debug(`Eski welcome xabar o'chirildi: message_id=${userWithWelcomeMsg.bot_welcome_message_id}`);
                                } catch (deleteError) {
                                    // Agar o'chirib bo'lmasa, e'tiborsiz qoldirish
                                    botLog.debug(`Eski welcome xabarni o'chirib bo'lmadi: ${deleteError.message}`);
                                }
                                // Eski message_id'ni tozalash
                                await db('users').where({ id: user.id }).update({ 
                                    bot_welcome_message_id: null 
                                });
                            }
                        }
                        
                        // Yangi xabar yuborish va message_id'ni saqlash
                        const sentMessage = await safeSendMessage(chatId, welcomeMessage, { reply_markup: keyboard, parse_mode: 'HTML' });
                        if (sentMessage && sentMessage.message_id) {
                            await db('users').where({ id: user.id }).update({ 
                                bot_welcome_message_id: sentMessage.message_id 
                            });
                            botLog.debug(`Yangi welcome xabar yuborildi va saqlandi: message_id=${sentMessage.message_id}`);
                        }
                        return;
                    }
                    
                    // Super admin yoki admin bo'lsa, chat ID'ni avtomatik saqlash
                    if (userHelper.isAdminUser(user)) {
                        const adminChatIdSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
                        if (!adminChatIdSetting || !adminChatIdSetting.value) {
                            await db('settings')
                                .insert({ key: 'telegram_admin_chat_id', value: String(chatId) })
                                .onConflict('key')
                                .merge();

                            await safeSendMessage(chatId, `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\nSizning Chat ID'ingiz avtomatik saqlandi.`, { parse_mode: 'HTML' });
                        } else {
                            const keyboard = await createUnifiedKeyboard(user);
                            await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.`, { reply_markup: keyboard });
                        }
                    } else {
                        await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.`);
                    }
                } else {
                    // Foydalanuvchi topilmadi - ro'yxatdan o'tish taklif qilish
                    const keyboard = createRegistrationKeyboard();
                    // Yangi foydalanuvchilar uchun faqat inline keyboard ko'rsatish (reply keyboard yuborilmaydi)
                    await safeSendMessage(chatId, `Salom! Bu hisobot tizimining rasmiy boti.\n\nTizimga kirish uchun ro'yxatdan o'ting:`, { reply_markup: keyboard });
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
            const userHelper = require('../bot/unified/userHelper.js');
            const user = await userHelper.getUserByTelegram(chatId, msg.from.id);
            if (user && userHelper.isAdminUser(user)) {
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

        // Message routing - unified handler chain
        try {
            const messageRouter = require('../bot/unified/messageRouter.js');
            const stateManager = require('../bot/unified/stateManager.js');
            const userHelper = require('../bot/unified/userHelper.js');
            
            const user = await userHelper.getUserByTelegram(chatId, msg.from.id);
            const context = messageRouter.routeMessage(msg, user, stateManager);
            
            // ✅ Context switching tekshiruvi - agar foydalanuvchi boshqa bo'limda ishlamoqda bo'lsa
            if (context !== stateManager.CONTEXTS.IDLE && 
                context !== stateManager.CONTEXTS.REGISTRATION) {
                
                const currentState = stateManager.getUserState(msg.from.id);
                if (currentState && 
                    currentState.context !== stateManager.CONTEXTS.IDLE &&
                    currentState.context !== stateManager.CONTEXTS.REGISTRATION &&
                    currentState.context !== context) {
                    
                    // Foydalanuvchi boshqa bo'limda ishlamoqda
                    const contextNames = {
                        [stateManager.CONTEXTS.DEBT_APPROVAL]: "Qarzdorlik tasdiqlash",
                        [stateManager.CONTEXTS.HISOBOT]: "Hisobotlar"
                    };
                    
                    const currentContextName = contextNames[currentState.context] || "boshqa bo'lim";
                    
                    await safeSendMessage(chatId, 
                        `⚠️ <b>E'tibor!</b>\n\n` +
                        `Siz hozir <b>${currentContextName}</b> bo'limida ishlamoqdasiz.\n\n` +
                        `Boshqa bo'limga o'tish uchun avval joriy jarayonni yakunlang yoki\n` +
                        `<code>/start</code> buyrug'i bilan asosiy menyuga qayting.`,
                        { parse_mode: 'HTML' }
                    );
                    return; // Boshqa bo'limga o'tish mumkin emas
                }
            }
            
            // Handler chain (prioritet bo'yicha)
            if (context === stateManager.CONTEXTS.REGISTRATION) {
                const { handleRegistrationMessage } = require('../bot/debt-approval/handlers/registration.js');
                const handled = await handleRegistrationMessage(msg, bot);
                if (handled) return;
            }
            
            // "Rolni o'zgartirish" knopkasi handler (IDLE context'da ham ishlashi kerak)
            if (text && text === "🔄 Rolni o'zgartirish") {
                const { handleDebtApprovalMessage } = require('../bot/debt-approval/handlers/index.js');
                const handled = await handleDebtApprovalMessage(msg, bot);
                if (handled) return;
            }
            
            if (context === stateManager.CONTEXTS.DEBT_APPROVAL) {
                const { handleDebtApprovalMessage } = require('../bot/debt-approval/handlers/index.js');
                const handled = await handleDebtApprovalMessage(msg, bot);
                if (handled) return;
            }
            
            // "Menejer"/"Kassir" rol tanlash handler'i (IDLE context'da ham ishlashi kerak)
            if (text && (text === "Menejer" || text === "Kassir")) {
                const { handleDebtApprovalMessage } = require('../bot/debt-approval/handlers/index.js');
                const handled = await handleDebtApprovalMessage(msg, bot);
                if (handled) return;
            }
            
            // IDLE context'da ham debt approval button text'larni tekshirish (masalan, "Kutayotgan so'rovlar")
            if (context === stateManager.CONTEXTS.IDLE && text) {
                const { handleDebtApprovalMessage } = require('../bot/debt-approval/handlers/index.js');
                const handled = await handleDebtApprovalMessage(msg, bot);
                if (handled) return;
            }
            
            if (context === stateManager.CONTEXTS.HISOBOT) {
                // Hisobot handler
                botLog.info(`[HISOBOT] Hisobot buyrug'i qabul qilindi. UserId: ${msg.from.id}, Text: ${text}`);
                
                // State tekshirish - agar foydalanuvchi hisobot ma'lumotlarini kiritish jarayonida bo'lsa
                const currentState = stateManager.getUserState(msg.from.id);
                if (currentState && 
                    currentState.context === stateManager.CONTEXTS.HISOBOT) {
                    const createHandler = require('../bot/hisobot/handlers/create.js');
                    
                    // Excel fayl qabul qilish (barcha state'larda)
                    if (msg.document) {
                        // Excel fayl ekanligini tekshirish
                        const fileName = msg.document.file_name || '';
                        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || 
                                       msg.document.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                                       msg.document.mime_type === 'application/vnd.ms-excel';
                        
                        if (isExcel) {
                            // Agar UPLOAD_EXCEL yoki enter_report_data state'ida bo'lsa, Excel faylni qabul qilish
                            if (currentState.state === 'upload_excel' || currentState.state === 'enter_report_data') {
                                // handleExcelFile funksiyasi ichida state o'zgartiriladi
                                const handled = await createHandler.handleExcelFile(msg, bot);
                                if (handled) return;
                            }
                        }
                    }
                    
                    // Oddiy hisobot ma'lumotlari (faqat text bo'lsa)
                    if (text && !text.startsWith('/')) {
                        if (currentState.state === 'enter_report_data') {
                            const handled = await createHandler.handleReportData(msg, bot);
                            if (handled) return;
                        }
                        
                        // SET qo'shimcha ma'lumot
                        if (currentState.state === 'set_extra_info') {
                            const handled = await createHandler.handleSetExtraInfo(msg, bot);
                            if (handled) return;
                        }
                    }
                }
                
                // Hisobotlar handler'ini chaqirish
                const { handleHisobotMessage } = require('../bot/hisobot/handlers/index.js');
                const handled = await handleHisobotMessage(msg, bot);
                if (handled) return;
                
                // Default javob
                await safeSendMessage(chatId, `📊 <b>Hisobotlar bo'limi</b>\n\n` +
                    `Quyidagi tugmalardan foydalaning:\n\n` +
                    `📊 <b>Hisobotlar ro'yxati</b> - Barcha hisobotlarni ko'rish\n` +
                    `➕ <b>Yangi hisobot</b> - Yangi hisobot yaratish\n` +
                    `📈 <b>Statistika</b> - Hisobotlar statistikasi`, { parse_mode: 'HTML' });
                return;
            }
            
            // /register command handler
            if (text && messageRouter.isRegistrationCommand(text)) {
                const { handleRegistrationStart } = require('../bot/debt-approval/handlers/registration.js');
                const handled = await handleRegistrationStart(msg, bot);
                if (handled) return;
            }
        } catch (routeError) {
            botLog.error('Message routing xatolik:', routeError);
        }

        if (!text || text.startsWith('/')) return;

        // Eski secret word verification logikasi (faqat admin uchun)
        const state = userStates[chatId];
        if (state && state.state === 'awaiting_secret_word') {
            const { user_id } = state;
            
            // Text'ni trim qilish (qayta e'lon qilish shart emas, lekin xavfsizlik uchun)
            const secretWordText = (msg.text || '').trim();

            try {
                const response = await fetch(new URL('api/telegram/verify-secret-word', NODE_SERVER_URL).href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id, secret_word: secretWordText })
                });
                
                if (!response.ok) {
                    botLog.error(`[BOT] Server javob bermadi - Status: ${response.status}`);
                    throw new Error(`Server javob bermadi: ${response.status}`);
                }
                
                const result = await response.json();

                if (result.status === 'success') {
                    // Xavfsizlik: Maxfiy so'z xabarini o'chirish
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        botLog.info(`[BOT] Maxfiy so'z xabari o'chirildi - ChatId: ${chatId}`);
                    } catch (delErr) {
                        botLog.warn(`[BOT] Maxfiy so'z xabarini o'chirib bo'lmadi - ChatId: ${chatId}`, delErr.message);
                    }
                    
                    // Eski "maxfiy so'zingizni yuboring" xabarini o'chirish
                    if (state.secret_word_message_id) {
                        try {
                            await bot.deleteMessage(chatId, state.secret_word_message_id);
                            botLog.info(`[BOT] Eski maxfiy so'z so'rovi xabari o'chirildi - ChatId: ${chatId}`);
                        } catch (delErr) {
                            botLog.warn(`[BOT] Eski maxfiy so'z so'rovi xabarini o'chirib bo'lmadi - ChatId: ${chatId}`, delErr.message);
                        }
                    }

                    const magicLink = new URL(path.join('api/auth/verify-session/', result.magic_token), NODE_SERVER_URL).href;
                    const isHttps = magicLink.startsWith('https://');
                    
                    let sentMagicLinkMsg;
                    if (isHttps) {
                        // HTTPS bo'lsa, inline button bilan yuborish
                        const messageText = `✅ <b>Maxfiy so'z to'g'ri!</b>\n\nYangi qurilmadan kirishni tasdiqlash uchun quyidagi tugmani bosing.\n\n⚠️ Bu havola <b>5 daqiqa</b> amal qiladi.`;
                        const keyboard = { inline_keyboard: [[{ text: "🔗 Yangi Qurilmada Kirish", url: magicLink }]] };
                        sentMagicLinkMsg = await safeSendMessage(chatId, messageText, { reply_markup: keyboard });
                    } else {
                        // HTTP bo'lsa (localhost), oddiy matn sifatida yuborish
                        const messageText = `✅ <b>Maxfiy so'z to'g'ri!</b>\n\nYangi qurilmadan kirishni tasdiqlash uchun quyidagi havolani brauzerda oching:\n\n<code>${magicLink}</code>\n\n⚠️ Bu havola <b>5 daqiqa</b> amal qiladi.`;
                        sentMagicLinkMsg = await safeSendMessage(chatId, messageText);
                    }
                    
                    // Magic link xabarining message_id'sini saqlash (keyinchalik o'chirish uchun)
                    if (sentMagicLinkMsg && sentMagicLinkMsg.message_id) {
                        try {
                            await db('users').where({ id: user_id }).update({ 
                                bot_login_message_id: sentMagicLinkMsg.message_id 
                            });
                            botLog.info(`[BOT] Magic link message_id saqlandi - User ID: ${user_id}, Message ID: ${sentMagicLinkMsg.message_id}`);
                        } catch (saveErr) {
                            botLog.warn(`[BOT] Magic link message_id saqlashda xatolik - User ID: ${user_id}`, saveErr.message);
                        }
                    }
                    
                    botLog.info(`[BOT] Magic link yuborildi - ChatId: ${chatId}, HTTPS: ${isHttps}`);
                    delete userStates[chatId];

                } else if (result.status === 'locked') {
                    await safeSendMessage(chatId, "Xavfsizlik qoidasi buzildi. Kirishga urinish bloklandi. Administrator bilan bog'laning.");
                    delete userStates[chatId];
                    botLog.error(`[BOT] Akkaunt bloklandi - User ID: ${user_id}`);
                } else {
                    state.attempts_left--;
                    botLog.error(`[BOT] Maxfiy so'z noto'g'ri - User ID: ${user_id}, Qolgan urinishlar: ${state.attempts_left}`);

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
                botLog.error(`[BOT] Maxfiy so'z tekshirish xatoligi - User ID: ${user_id}`, error);
                await safeSendMessage(chatId, "Tizimda vaqtinchalik xatolik. Iltimos, keyinroq qayta urinib ko'ring.");
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
        try {
            const chatId = query.message.chat.id;
            const userId = query.from.id;
            const data = query.data;

            // Hisobot callback handler'larini tekshirish
            if (data && data.startsWith('hisobot_')) {
                botLog.info(`[HISOBOT] Callback qabul qilindi: ${data}, UserId: ${userId}`);
                
                if (data === 'hisobot_back') {
                    await bot.answerCallbackQuery(query.id, { text: 'Asosiy menyuga qaytildi' });
                    const userHelper = require('../bot/unified/userHelper.js');
                    const { createUnifiedKeyboard } = require('../bot/unified/keyboards.js');
                    const user = await userHelper.getUserByTelegram(chatId, userId);
                    if (user) {
                        // Foydalanuvchiga biriktirilgan filial va brendlarni olish
                        const [userBrands, userBranches] = await Promise.all([
                            db('debt_user_brands')
                                .where('user_id', user.id)
                                .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                                .select('debt_brands.id', 'debt_brands.name')
                                .groupBy('debt_brands.id', 'debt_brands.name')
                                .orderBy('debt_brands.name'),
                            db('debt_user_branches')
                                .where('user_id', user.id)
                                .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                                .select('debt_branches.id', 'debt_branches.name')
                                .groupBy('debt_branches.id', 'debt_branches.name')
                                .orderBy('debt_branches.name')
                        ]);
                        
                        // Biriktirilgan filial va brendlarni formatlash
                        let bindingsText = '';
                        if (userBrands.length > 0 || userBranches.length > 0) {
                            bindingsText = `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                            if (userBrands.length > 0) {
                                const brandNames = userBrands.map(b => escapeHtml(b.name)).join(', ');
                                bindingsText += `🏷️ <b>Brendlar:</b> ${brandNames}\n`;
                            }
                            if (userBranches.length > 0) {
                                const branchNames = userBranches.map(b => escapeHtml(b.name)).join(', ');
                                bindingsText += `📍 <b>Filiallar:</b> ${branchNames}\n`;
                            }
                        }
                        
                        const keyboard = await createUnifiedKeyboard(user);
                        const welcomeMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                            `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                            `Quyidagi tugmalardan foydalaning:${bindingsText}`;
                        await safeSendMessage(chatId, welcomeMessage, { reply_markup: keyboard, parse_mode: 'HTML' });
                    }
                    return;
                }
                
                if (data === 'hisobot_list' || data === 'hisobot_new' || data === 'hisobot_stats') {
                    await bot.answerCallbackQuery(query.id, { text: 'Bu funksiya tez orada qo\'shiladi' });
                    return;
                }
            }

            // Report creation callback handler'larini tekshirish
            if (data && data.startsWith('report_')) {
                botLog.info(`[REPORT] Callback qabul qilindi: ${data}, UserId: ${userId}`);
                
                try {
                    const { 
                        handleBrandSelection, 
                        handleBranchSelection, 
                        handleSVRSelection, 
                        handleSendReport, 
                        handleCancelReport,
                        handleDebtExists,
                        handleSetDebtExists,
                        handleColumnSelection,
                        handleSelectSingleColumn,
                        handleSelectColumnValue,
                        handleConfirmColumns,
                        handleConfirmExcel,
                        handleEditExcel
                    } = require('../bot/hisobot/handlers/create.js');
                    
                    if (data.startsWith('report_select_brand:')) {
                        await handleBrandSelection(query, bot);
                        return;
                    }
                    
                    if (data.startsWith('report_select_branch:')) {
                        await handleBranchSelection(query, bot);
                        return;
                    }
                    
                    if (data.startsWith('report_select_svr:')) {
                        await handleSVRSelection(query, bot);
                        return;
                    }
                    
                    if (data === 'report_send') {
                        await handleSendReport(query, bot);
                        return;
                    }
                    
                    if (data === 'report_send_set') {
                        const { handleSendSetReport } = require('../bot/hisobot/handlers/create.js');
                        await handleSendSetReport(query, bot);
                        return;
                    }
                    
                    if (data === 'report_edit_set') {
                        // Qayta qo'shimcha ma'lumot kiritish
                        const { handleSetReport } = require('../bot/hisobot/handlers/create.js');
                        await handleSetReport(query, bot);
                        return;
                    }
                    
                    if (data === 'report_debt_exists') {
                        await handleDebtExists(query, bot);
                        return;
                    }
                    
                    if (data === 'report_set_debt_exists') {
                        await handleSetDebtExists(query, bot);
                        return;
                    }
                    
                    if (data === 'report_select_columns') {
                        await handleColumnSelection(query, bot);
                        return;
                    }
                    
                    if (data.startsWith('report_select_column:')) {
                        await handleSelectSingleColumn(query, bot);
                        return;
                    }
                    
                    if (data.startsWith('report_select_column_value:')) {
                        await handleSelectColumnValue(query, bot);
                        return;
                    }
                    
                    if (data === 'report_confirm_columns') {
                        await handleConfirmColumns(query, bot);
                        return;
                    }
                    
                    if (data === 'report_confirm_excel') {
                        await handleConfirmExcel(query, bot);
                        return;
                    }
                    
                    if (data === 'report_edit_excel') {
                        await handleEditExcel(query, bot);
                        return;
                    }
                    
                    if (data === 'report_cancel') {
                        await handleCancelReport(query, bot);
                        return;
                    }
                } catch (reportError) {
                    botLog.error('Report callback handler xatolik:', reportError);
                    await bot.answerCallbackQuery(query.id, { text: 'Xatolik yuz berdi', show_alert: true });
                    return;
                }
            }

            // Rol tanlash callback handler (avval tekshirish)
            if (data && data.startsWith('select_role_')) {
                const userHelper = require('../bot/unified/userHelper.js');
                const { createUnifiedKeyboard } = require('../bot/unified/keyboards.js');
                const stateManager = require('../bot/unified/stateManager.js');
                
                const selectedRole = data.replace('select_role_', '');
                botLog.info(`[ROLE_SELECTION] Rol tanlash callback qabul qilindi: userId=${userId}, selectedRole=${selectedRole}`);
                
                const user = await userHelper.getUserByTelegram(chatId, userId);
                
                if (!user) {
                    botLog.warn(`[ROLE_SELECTION] Foydalanuvchi topilmadi: userId=${userId}, chatId=${chatId}`);
                    await bot.answerCallbackQuery(query.id, { text: 'Foydalanuvchi topilmadi', show_alert: false });
                    return;
                }
                
                // State'ga saqlash
                const currentState = stateManager.getUserState(userId);
                const stateData = currentState?.data || {};
                stateData.selectedRole = selectedRole;
                
                stateManager.setUserState(userId, stateManager.CONTEXTS.IDLE, 'idle', stateData);
                botLog.info(`[ROLE_SELECTION] Rol state'ga saqlandi: userId=${userId}, selectedRole=${selectedRole}`);
                
                await bot.answerCallbackQuery(query.id, {
                    text: `Rol tanlandi: ${userHelper.ROLE_DISPLAY_NAMES[selectedRole] || selectedRole}`,
                    show_alert: false
                });
                
                // Welcome message'ni qayta yuborish
                try {
                    // Eski xabarni o'chirish
                    await bot.deleteMessage(chatId, query.message.message_id);
                } catch (deleteError) {
                    // Silent fail
                }
                
                // Welcome message'ni qayta yuborish
                const { getUserRolesFromTasks, getSelectedRole, ROLE_DISPLAY_NAMES, shouldShowRoleSelection, getGroupRoleByChatId } = userHelper;
                const userRolesFromTasks = await getUserRolesFromTasks(user.id);
                const isGroup = chatId < 0;
                
                let activeRole = selectedRole;
                if (isGroup) {
                    // Guruhda → guruh roli bilan ishlash
                    const groupRole = await getGroupRoleByChatId(chatId);
                    if (groupRole) {
                        activeRole = groupRole;
                    } else {
                        activeRole = userRolesFromTasks.length > 0 ? userRolesFromTasks[0] : user.role;
                    }
                } else {
                    // Shaxsiy chatda → tanlangan rol yoki birinchi rol
                    activeRole = selectedRole || (userRolesFromTasks.length > 0 ? userRolesFromTasks[0] : null) || user.role;
                }
                
                const roleDisplayName = ROLE_DISPLAY_NAMES[activeRole] || activeRole || 'Tasdiqlanmagan';
                
                // Foydalanuvchiga biriktirilgan filial va brendlarni olish
                const [userBrandsRaw, userBranchesRaw, cashierBranchesRaw] = await Promise.all([
                    db('debt_user_brands')
                        .where('user_id', user.id)
                        .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                        .select('debt_brands.id', 'debt_brands.name')
                        .groupBy('debt_brands.id', 'debt_brands.name')
                        .orderBy('debt_brands.name'),
                    db('debt_user_branches')
                        .where('user_id', user.id)
                        .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                        .select('debt_branches.id', 'debt_branches.name')
                        .groupBy('debt_branches.id', 'debt_branches.name')
                        .orderBy('debt_branches.name'),
                    db('debt_cashiers')
                        .where('user_id', user.id)
                        .where('is_active', true)
                        .join('debt_branches', 'debt_cashiers.branch_id', 'debt_branches.id')
                        .select('debt_branches.id', 'debt_branches.name')
                        .groupBy('debt_branches.id', 'debt_branches.name')
                        .orderBy('debt_branches.name')
                ]);
                
                // Brendlarni birlashtirish
                const uniqueBrandsMap = new Map();
                userBrandsRaw.forEach(brand => {
                    if (!uniqueBrandsMap.has(brand.id)) {
                        uniqueBrandsMap.set(brand.id, brand);
                    }
                });
                const userBrands = Array.from(uniqueBrandsMap.values());
                
                // Filiallarni birlashtirish
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
                        const brandNames = userBrands.map(b => escapeHtml(b.name)).join(', ');
                        bindingsText += `🏷️ <b>Brendlar:</b> ${brandNames}\n`;
                    }
                    if (userBranches.length > 0) {
                        const branchNames = userBranches.map(b => escapeHtml(b.name)).join(', ');
                        bindingsText += `📍 <b>Filiallar:</b> ${branchNames}\n`;
                    }
                }
                
                // Foydalanuvchi ma'lumotlarini formatlash
                const userInfoText = `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 <b>To'liq ism:</b> ${escapeHtml(user.fullname || 'Noma\'lum')}\n` +
                    `👔 <b>Rol:</b> <b>${escapeHtml(roleDisplayName)}</b>\n` +
                    `📊 <b>Holat:</b> <b>Faol</b>`;
                
                const userPermissions = await userHelper.getUserPermissions(user.id);
                const { isUserInGroup } = require('../utils/groupValidator.js');
                const userInLeadersGroup = await isUserInGroup(user.id, 'leaders');
                const isLeader = userInLeadersGroup && (
                    activeRole === 'rahbar' || 
                    activeRole === 'leader' || 
                    userPermissions.includes('debt:approve_leader')
                );
                
                let welcomeMessage;
                if (isLeader) {
                    welcomeMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                        `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                        `${userInfoText}${bindingsText}\n\n` +
                        `📋 <b>Rahbarlar uchun funksiyalar:</b>\n` +
                        `• SET so'rovlarni ko'rish va tasdiqlash\n` +
                        `• Bloklangan elementlarni boshqarish\n` +
                        `• Tasdiqlangan so'rovlarni ko'rish\n\n` +
                        `Quyidagi tugmalardan foydalaning:`;
                } else {
                    welcomeMessage = `✅ <b>Salom, ${escapeHtml(user.fullname || user.username)}!</b>\n\n` +
                        `Hisobot va Qarzdorlik tasdiqlash tizimiga xush kelibsiz!\n\n` +
                        `${userInfoText}${bindingsText}\n\n` +
                        `Quyidagi tugmalardan foydalaning:`;
                }
                
                const keyboard = await createUnifiedKeyboard(user, activeRole);
                botLog.debug(`[ROLE_SELECTION] Rol tanlash tekshiruvi (callback): userId=${user.id}, isGroup=${isGroup}, userRolesFromTasks=${userRolesFromTasks.length}, activeRole=${activeRole || 'none'}`);
                
                if (!isGroup && shouldShowRoleSelection(userRolesFromTasks)) {
                    // Faqat shaxsiy chatda va faqat manager+cashier kombinatsiyasi bo'lsa
                    keyboard.keyboard.push([{ text: "🔄 Rolni o'zgartirish" }]);
                    botLog.info(`[ROLE_SELECTION] "Rolni o'zgartirish" knopkasi qo'shildi (callback): userId=${user.id}, roles=${userRolesFromTasks.join(',')}`);
                } else {
                    botLog.debug(`[ROLE_SELECTION] "Rolni o'zgartirish" knopkasi qo'shilmadi (callback): userId=${user.id}, isGroup=${isGroup}, shouldShowSelection=${shouldShowRoleSelection(userRolesFromTasks)}`);
                }
                
                const sentMessage = await safeSendMessage(chatId, welcomeMessage, { reply_markup: keyboard, parse_mode: 'HTML' });
                if (sentMessage && sentMessage.message_id) {
                    await db('users').where({ id: user.id }).update({
                        bot_welcome_message_id: sentMessage.message_id
                    });
                }
                
                return;
            }

            // Debt-approval callback handler
            const { handleDebtApprovalCallback } = require('../bot/debt-approval/handlers/index.js');
            const handled = await handleDebtApprovalCallback(query, bot);
            if (handled) {
                // Callback query'ni javob berish (xatolik bo'lsa ham e'tiborsiz qoldirish)
                try {
                    await bot.answerCallbackQuery(query.id);
                } catch (callbackError) {
                    // "query is too old" kabi xatoliklarni e'tiborsiz qoldirish
                    if (callbackError.code === 'ETELEGRAM' && callbackError.response?.body?.description?.includes('too old')) {
                        botLog.debug(`[BOT] Callback query eski (timeout): ${query.id}`);
                    } else {
                        botLog.warn(`[BOT] Callback query javob berishda xatolik: ${callbackError.message}`);
                    }
                }
                return; // Agar debt-approval handler qayta ishlagan bo'lsa, boshqa handler'larni o'tkazib yuborish
            }
        } catch (debtError) {
            botLog.error('Debt-approval callback handler xatolik:', debtError);
        }
        
        const adminChatId = query.message.chat.id;
        const { data, message } = query;
        

        
        const originalText = message.text;

        const parts = data.split('_');
        const action = parts[0];
        const userId = parseInt(parts[1], 10);

        // Bot orqali tasdiqlash olib tashlandi - barcha tasdiqlashlar web'dan bo'ladi
        // approve_ va reject_ callback'lar e'tiborsiz qoldiriladi
        if (action === 'approve' || action === 'reject') {
                    try {
                        await bot.answerCallbackQuery(query.id);
                    } catch (callbackError) {
                        if (callbackError.code === 'ETELEGRAM' && callbackError.response?.body?.description?.includes('too old')) {
                            botLog.debug(`[BOT] Callback query eski (timeout): ${query.id}`);
                        }
                    }
                    return;
        } else if (data.startsWith('password_approve_') || data.startsWith('password_reject_')) {
            // Parol tiklash so'rovlarini tasdiqlash/rad etish
            await handlePasswordChangeRequestCallback(query, bot);
                    return;
        } else {
            // Boshqa callback'lar (retry, block, unblock...)
            let endpoint = '';
            switch (action) {
                case 'retry': endpoint = 'api/telegram/reset-attempts'; break;
                case 'block': endpoint = 'api/telegram/confirm-lock'; break;
                case 'unblock': endpoint = 'api/telegram/unblock-user'; break;
                case 'keep_blocked': endpoint = 'api/telegram/keep-blocked'; break;
                default: 
                    try {
                        await bot.answerCallbackQuery(query.id);
                    } catch (callbackError) {
                        if (callbackError.code === 'ETELEGRAM' && callbackError.response?.body?.description?.includes('too old')) {
                            botLog.debug(`[BOT] Callback query eski (timeout): ${query.id}`);
                        }
                    }
                    return;
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
        // Callback query'ni javob berish (xatolik bo'lsa ham e'tiborsiz qoldirish)
        try {
            await bot.answerCallbackQuery(query.id);
        } catch (callbackError) {
            // "query is too old" kabi xatoliklarni e'tiborsiz qoldirish
            if (callbackError.code === 'ETELEGRAM' && callbackError.response?.body?.description?.includes('too old')) {
                botLog.debug(`[BOT] Callback query eski (timeout): ${query.id}`);
            } else {
                botLog.warn(`[BOT] Callback query javob berishda xatolik: ${callbackError.message}`);
            }
        }
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
        } else if (newStatus === 'member' || newStatus === 'administrator') {
            // Bot guruhga qo'shildi
            // Agar bu rahbarlar guruhi bo'lsa, reply keyboard yuborish
            try {
                const leadersGroup = await db('debt_groups')
                    .where('group_type', 'leaders')
                    .where('is_active', true)
                    .first();
                
                if (leadersGroup && leadersGroup.telegram_group_id === chatId) {
                    // Rahbarlar guruhiga bot qo'shilganda reply keyboard yuborish
                    const { createUnifiedKeyboard } = require('../bot/unified/keyboards.js');
                    const userHelper = require('../bot/unified/userHelper.js');
                    
                    // Guruhda birinchi rahbar foydalanuvchisini topish (misol uchun)
                    // Yoki guruh uchun umumiy keyboard yaratish
                    // Guruhda keyboard yuborish uchun bot admin bo'lishi kerak
                    const welcomeText = `✅ <b>Bot guruhga qo'shildi!</b>\n\n` +
                        `Rahbarlar uchun bloklash va boshqaruv funksiyalari mavjud.\n\n` +
                        `Quyidagi tugmalardan foydalaning:`;
                    
                    // Guruh uchun umumiy keyboard yaratish (rahbarlar uchun)
                    const keyboard = {
                        keyboard: [
                            [{ text: "📥 SET so'rovlari" }],
                            [{ text: "📋 Tasdiqlangan so'rovlar" }],
                            [{ text: "🚫 Bloklash" }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: false
                    };
                    
                    try {
                        await bot.sendMessage(chatId, welcomeText, {
                            parse_mode: 'HTML',
                            reply_markup: keyboard
                        });
                        botLog.info(`Reply keyboard rahbarlar guruhiga yuborildi: groupId=${chatId}`);
                    } catch (keyboardError) {
                        botLog.warn(`Guruhga keyboard yuborishda xatolik (bot admin bo'lishi kerak): ${keyboardError.message}`);
                    }
                }
            } catch (error) {
                botLog.error('Guruhga bot qo\'shilganda xatolik:', error);
            }
        }
    });
};

const getBot = () => {
    return bot;
};

// Botni to'xtatish funksiyasi (takrorlanishni oldini olish uchun flag)
let isStopping = false;

const stopBot = async () => {
    // Agar allaqachon to'xtatilmoqda bo'lsa, qayta chaqirmaslik
    if (isStopping) {
        return;
    }
    
    try {
        isStopping = true;
        
        if (bot && botIsInitialized) {
            // Polling rejimida bo'lsa, to'xtatish
            if (bot.isPolling && bot.isPolling()) {
                await bot.stopPolling();
                botLog.info('Bot polling to\'xtatildi');
            }
            
            // Webhook rejimida bo'lsa, webhookni o'chirish
            const { getSetting } = require('./settingsCache.js');
            const botToken = await getSetting('telegram_bot_token', null);
            if (botToken) {
                try {
                    const axios = require('axios');
                    await axios.post(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { 
                        drop_pending_updates: true 
                    });
                    botLog.info('Telegram webhook o\'chirildi');
                } catch (error) {
                    // Rate limit xatoliklarini tushunish
                    if (error.response && error.response.data && error.response.data.error_code === 429) {
                        botLog.warn(`Telegram API rate limit: ${error.response.data.description}`);
                    } else {
                        botLog.error('Webhook o\'chirishda xatolik:', error.message);
                    }
                }
            }
            
            botIsInitialized = false;
            bot = null;
            
            // Token cleanup'ni to'xtatish
            stopTokenCleanup();
            
            botLog.info('Bot to\'xtatildi');
        }
    } catch (error) {
        botLog.error('Botni to\'xtatishda xatolik:', error.message);
    } finally {
        // Flag'ni qayta tiklash
        isStopping = false;
    }
};

module.exports = {
    initializeBot,
    getBot,
    stopBot,
    sendToTelegram,
    startTokenCleanup,
    stopTokenCleanup
};

