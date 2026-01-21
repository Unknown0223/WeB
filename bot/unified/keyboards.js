// bot/unified/keyboards.js
// Unified Keyboard - barcha tugmalar bir joyda

const { DEBT_APPROVAL_ROLES, ADMIN_ROLES } = require('./userHelper.js');
const userHelper = require('./userHelper.js');

/**
 * Unified keyboard yaratish (barcha foydalanuvchilar uchun)
 * Permission-based knopkalar
 */
async function createUnifiedKeyboard(user) {
    const keyboard = [];
    
    // Permission'larni olish (async)
    const permissions = await userHelper.getUserPermissions(user.id);
    
    // 1. Hisobotlar bo'limi (permission'ga qarab)
    // MUHIM: Kassirlar uchun "Hisobotlar ro'yxati" va "Yangi hisobot" ko'rsatilmaydi
    // Kassirlar uchun faqat "Yangi so'rovlar", "Mening so'rovlarim", "Kutayotgan so'rovlar" kerak
    const isCashier = userHelper.hasRole(user, ['kassir', 'cashier']);
    
    if (!isCashier && (permissions.includes('reports:view_own') || permissions.includes('reports:view_assigned') || permissions.includes('reports:view_all'))) {
        keyboard.push([{ text: "📊 Hisobotlar ro'yxati" }]);
    }
    
    // "Yangi hisobot" knopkasi - faqat debt:create permission'i bo'lmagan foydalanuvchilar uchun
    // Menejerlar uchun "Yangi so'rov" knopkasi bor, shuning uchun "Yangi hisobot" kerak emas
    // Kassirlar uchun ham ko'rsatilmaydi
    if (!isCashier && permissions.includes('reports:create') && !permissions.includes('debt:create')) {
        keyboard.push([{ text: "➕ Yangi hisobot" }]);
        keyboard.push([{ text: "💾 SET (Muddat uzaytirish)" }]);
    }
    
    if (!isCashier && (permissions.includes('reports:view_own') || permissions.includes('reports:view_assigned') || permissions.includes('reports:view_all'))) {
        keyboard.push([{ text: "📈 Statistika" }]);
    }
    
    // 2. Qarzdorlik tasdiqlash tugmalari (permission'ga qarab)
    
    // Menejerlar - yangi so'rov yaratish (bu "Yangi hisobot" o'rniga ishlatiladi)
    if (permissions.includes('debt:create')) {
        keyboard.push([{ text: "➕ Yangi so'rov" }]);
        keyboard.push([{ text: "💾 SET (Muddat uzaytirish)" }]);
        keyboard.push([
            { text: "📋 Mening so'rovlarim" },
            { text: "⏳ Jarayondagi so'rovlar" }
        ]);
        keyboard.push([
            { text: "✅ Tasdiqlangan so'rovlar" }
        ]);
        keyboard.push([
            { text: "📊 Brend va Filiallar statistikasi" }
        ]);
        keyboard.push([
            { text: "🚫 Bloklash" }
        ]);
    }
    
    // Kassirlar - so'rovlarni tasdiqlash
    // MUHIM: Kassir uchun knopkalar roliga asoslanib ko'rsatiladi, permission'ga qaramay
    if (isCashier || permissions.includes('debt:approve_cashier')) {
        keyboard.push([{ text: "📥 Yangi so'rovlar" }]);
        keyboard.push([
            { text: "📋 Mening so'rovlarim" },
            { text: "⏰ Kutayotgan so'rovlar" }
        ]);
    }
    
    // Operatorlar - so'rovlarni yakuniy tasdiqlash
    if (permissions.includes('debt:approve_operator')) {
        keyboard.push([{ text: "📥 Yangi so'rovlar" }]);
        keyboard.push([
            { text: "📋 Mening so'rovlarim" },
            { text: "⏰ Kutayotgan so'rovlar" }
        ]);
    }
    
    // Rahbarlar - SET so'rovlarni tasdiqlash
    if (permissions.includes('debt:approve_leader')) {
        keyboard.push([{ text: "📥 SET so'rovlari" }]);
        keyboard.push([{ text: "📋 Tasdiqlangan so'rovlar" }]);
        keyboard.push([
            { text: "🚫 Bloklash" }
        ]);
    }
    
    // Nazoratchilar - so'rovlarni nazorat qilish
    if (permissions.includes('debt:approve_supervisor')) {
        keyboard.push([{ text: "📥 Nazorat so'rovlari" }]);
        keyboard.push([{ text: "📋 Nazorat qilingan so'rovlar" }]);
    }
    
    // Bloklash funksiyasi - debt:block permission'i bo'lganlar uchun
    // Bu menejerlar, rahbarlar va admin'lar uchun
    if (permissions.includes('debt:block') || permissions.includes('debt:admin') || ADMIN_ROLES.includes(user.role)) {
        // Agar allaqachon bloklash tugmasi qo'shilmagan bo'lsa (menejer yoki rahbar uchun)
        const hasBlockButton = keyboard.some(row => row.some(btn => btn.text && btn.text.includes('🚫 Bloklash')));
        if (!hasBlockButton) {
            keyboard.push([{ text: "🚫 Bloklash" }]);
        }
    }
    
    // Admin - sozlamalar
    if (permissions.includes('debt:admin') || permissions.includes('debt:manage_bindings') || ADMIN_ROLES.includes(user.role)) {
        keyboard.push([{ text: "⚙️ Sozlamalar" }]);
    }
    
    return {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

/**
 * Registration keyboard (ro'yxatdan o'tish uchun)
 */
function createRegistrationKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "📝 Ro'yxatdan o'tish", callback_data: "debt_reg_start" }]
        ]
    };
}

/**
 * Default keyboard (foydalanuvchi topilmagan yoki tasdiqlanmagan)
 */
function createDefaultKeyboard() {
    return {
        keyboard: [],
        resize_keyboard: true
    };
}

module.exports = {
    createUnifiedKeyboard,
    createRegistrationKeyboard,
    createDefaultKeyboard
};

