// bot/unified/keyboards.js
// Unified Keyboard - barcha tugmalar bir joyda

const { DEBT_APPROVAL_ROLES, ADMIN_ROLES } = require('./userHelper.js');
const userHelper = require('./userHelper.js');
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');

const log = createLogger('KEYBOARDS');

/**
 * Database'dan rol uchun ko'rsatiladigan knopkalarni olish
 */
async function getButtonsFromDatabase(roleName, permissions) {
    try {
        log.debug(`[KEYBOARDS] getButtonsFromDatabase chaqirildi: role=${roleName}, permissions=${permissions.length}`);
        
        // Faqat bot_role_button_settings jadvalida sozlanmagan (is_visible = true) knopkalarni qaytarish
        // Agar knopka bot_role_button_settings jadvalida bo'lmasa, u ko'rsatilmaydi
        const buttons = await db('bot_menu_buttons')
            .innerJoin('bot_role_button_settings', function() {
                this.on('bot_menu_buttons.id', '=', 'bot_role_button_settings.button_id')
                    .andOn('bot_role_button_settings.role_name', '=', db.raw('?', [roleName]));
            })
            .where('bot_menu_buttons.is_active', true)
            .where('bot_role_button_settings.is_visible', true)
            .orderBy('bot_menu_buttons.category', 'asc')
            .orderBy(db.raw('COALESCE(bot_role_button_settings.order_index, bot_menu_buttons.order_index)'), 'asc')
            .select(
                'bot_menu_buttons.*',
                'bot_role_button_settings.is_visible',
                db.raw('COALESCE(bot_role_button_settings.order_index, bot_menu_buttons.order_index) as final_order_index')
            );
        
        log.debug(`[KEYBOARDS] Database'dan knopkalar o'qildi: role=${roleName}, found=${buttons.length}`);
        
        // SQLite'da boolean qiymatlar 1/0 sifatida qaytadi, shuning uchun tekshirishni yaxshilash
        if (buttons.length > 0) {
            log.debug(`[KEYBOARDS] Birinchi knopka misoli: id=${buttons[0].id}, is_visible=${buttons[0].is_visible}, type=${typeof buttons[0].is_visible}`);
        }
        
        // Faqat ko'rsatishga ruxsat berilgan knopkalarni filtrlash
        // SQLite'da boolean qiymatlar 1/0 sifatida qaytadi
        const visibleButtons = buttons.filter(btn => {
            const isVisible = btn.is_visible === true || btn.is_visible === 1 || Boolean(btn.is_visible);
            if (!isVisible) {
                log.debug(`[KEYBOARDS] Knopka o'tkazib yuborildi: id=${btn.id}, is_visible=${btn.is_visible}, type=${typeof btn.is_visible}`);
            }
            return isVisible;
        });
        
        log.debug(`[KEYBOARDS] Visible buttons: role=${roleName}, count=${visibleButtons.length}`);
        
        // Permission tekshiruvi
        const filteredButtons = [];
        for (const btn of visibleButtons) {
            log.debug(`[KEYBOARDS] Knopka tekshirilmoqda: id=${btn.id}, text=${btn.button_text}, permission=${btn.permission_required}, userPermissions=${permissions.join(',')}`);
            
            // Bloklash faqat WEB orqali (bot menyusidan olib tashlangan)
            if (
                btn.button_key === 'block' ||
                btn.button_key === 'block_leader' ||
                (btn.button_text && String(btn.button_text).includes('Bloklash')) ||
                btn.permission_required === 'debt:block' ||
                btn.permission_required === 'debt:unblock'
            ) {
                log.debug(`[KEYBOARDS] Knopka bloklash - o'tkazib yuborildi: id=${btn.id}`);
                continue;
            }

            // Agar permission_required bo'sh bo'lsa, har doim ko'rsatish
            if (!btn.permission_required) {
                log.debug(`[KEYBOARDS] Knopka permission yo'q - qo'shildi: id=${btn.id}`);
                filteredButtons.push(btn);
                continue;
            }
            
            // Permission tekshiruvi
            if (permissions.includes(btn.permission_required)) {
                log.debug(`[KEYBOARDS] Knopka permission mavjud - qo'shildi: id=${btn.id}, permission=${btn.permission_required}`);
                filteredButtons.push(btn);
            } else {
                log.debug(`[KEYBOARDS] Knopka permission yo'q - o'tkazib yuborildi: id=${btn.id}, permission=${btn.permission_required}, userPermissions=${permissions.join(',')}`);
            }
        }
        
        log.debug(`[KEYBOARDS] Permission tekshiruvidan keyin: role=${roleName}, filtered=${filteredButtons.length}`);
        
        // Agar hech qanday knopka topilmasa, bo'sh array qaytarish (fallback uchun emas)
        return filteredButtons;
    } catch (error) {
        log.error(`[KEYBOARDS] Database'dan knopkalarni olishda xatolik: role=${roleName}`, error);
        return null; // Fallback uchun null qaytarish (faqat xatolik bo'lganda)
    }
}

/**
 * Unified keyboard yaratish (barcha foydalanuvchilar uchun)
 * Permission-based knopkalar
 * Database sozlamalaridan foydalanadi
 */
async function createUnifiedKeyboard(user, activeRole = null) {
    const keyboard = [];
    
    // Agar activeRole berilgan bo'lsa, shu rol bo'yicha ishlash
    // Aks holda user.role ishlatiladi
    let roleName = activeRole || user.role || 'user';
    
    // Rol nomini database'dagi formatga o'tkazish (cashier -> kassir, manager -> menejer)
    const roleNameMap = {
        'cashier': 'kassir',
        'manager': 'menejer',
        'operator': 'operator',
        'leader': 'rahbar',
        'supervisor': 'nazoratchi'
    };
    
    // Agar roleName map'da mavjud bo'lsa, database formatiga o'tkazish
    if (roleNameMap[roleName]) {
        roleName = roleNameMap[roleName];
    }
    
    log.debug(`[KEYBOARDS] createUnifiedKeyboard chaqirildi: userId=${user.id}, activeRole=${activeRole || 'null'}, roleName=${roleName}, user.role=${user.role}`);
    
    // Permission'larni olish: agar activeRole bo'lsa, shu rol bo'yicha, aks holda user.role bo'yicha
    let permissions;
    if (activeRole && roleName !== user.role) {
        // activeRole bo'yicha permission'larni to'g'ridan-to'g'ri database'dan olish
        const { db } = require('../../db.js');
        const rolePermissions = await db('role_permissions as rp')
            .join('permissions as p', 'rp.permission_key', 'p.permission_key')
            .where('rp.role_name', roleName)
            .select('p.permission_key');
        permissions = rolePermissions.map(rp => rp.permission_key);
        
        // User-specific additional permissions qo'shish
        const hasUserPermissionsTable = await db.schema.hasTable('user_permissions');
        if (hasUserPermissionsTable) {
            const userPermissions = await db('user_permissions as up')
                .join('permissions as p', 'up.permission_key', 'p.permission_key')
                .where('up.user_id', user.id)
                .where('up.type', 'additional')
                .select('p.permission_key');
            
            userPermissions.forEach(up => {
                if (!permissions.includes(up.permission_key)) {
                    permissions.push(up.permission_key);
                }
            });
        }
        
        log.debug(`[KEYBOARDS] activeRole bo'yicha permission'lar olingan: role=${roleName}, permissions=${permissions.length}`);
    } else {
        // Oddiy usul: user.role bo'yicha
        permissions = await userHelper.getUserPermissions(user.id);
    }
    
    // Database'dan knopkalarni olish
    const dbButtons = await getButtonsFromDatabase(roleName, permissions);
    
    // Agar database'dan o'qib bo'lsa, database knopkalarini ishlatish
    if (dbButtons !== null && dbButtons.length > 0) {
        // Knopkalarni kategoriya va order_index bo'yicha tartiblash
        const sortedButtons = [...dbButtons].sort((a, b) => {
            if (a.category !== b.category) {
                return a.category.localeCompare(b.category);
            }
            return (a.final_order_index || a.order_index || 0) - (b.final_order_index || b.order_index || 0);
        });
        
        // Knopkalarni keyboard formatiga o'tkazish
        // Bir xil kategoriyadagi knopkalarni birga qo'shish
        const categoryMap = {};
        sortedButtons.forEach(btn => {
            if (!categoryMap[btn.category]) {
                categoryMap[btn.category] = [];
            }
            categoryMap[btn.category].push({ text: btn.button_text });
        });
        
        // Keyboard'ni to'ldirish (Grid - 2 ta yonma-yon)
        Object.keys(categoryMap).sort().forEach(category => {
            const categoryButtons = categoryMap[category];
            
            // Knopkalarni 2 ta yonma-yon qo'yish (grid)
            for (let i = 0; i < categoryButtons.length; i += 2) {
                if (i + 1 < categoryButtons.length) {
                    // 2 ta knopka yonma-yon
                    keyboard.push([categoryButtons[i], categoryButtons[i + 1]]);
                } else {
                    // Oxirgi knopka alohida
                    keyboard.push([categoryButtons[i]]);
                }
            }
        });
        
        log.debug(`[KEYBOARDS] Database'dan knopkalar yuklandi: role=${roleName}, buttons=${keyboard.length}`);
    } else if (dbButtons === null) {
        // Xatolik bo'lganda fallback kod ishlatish
        log.warn(`[KEYBOARDS] Database'dan knopkalar o'qilmadi (xatolik), fallback kod ishlatilmoqda: role=${roleName}`);
        
        const isCashier = userHelper.hasRole(user, ['kassir', 'cashier']);
        
        if (!isCashier && (permissions.includes('reports:view_own') || permissions.includes('reports:view_assigned') || permissions.includes('reports:view_all'))) {
            keyboard.push([{ text: "📊 Hisobotlar ro'yxati" }]);
        }
        
        if (!isCashier && permissions.includes('reports:create') && !permissions.includes('debt:create')) {
            keyboard.push([{ text: "➕ Yangi hisobot" }]);
            keyboard.push([{ text: "💾 SET (Muddat uzaytirish)" }]);
        }
        
        if (!isCashier && (permissions.includes('reports:view_own') || permissions.includes('reports:view_assigned') || permissions.includes('reports:view_all'))) {
            keyboard.push([{ text: "📈 Statistika" }]);
        }
        
        if (permissions.includes('debt:create')) {
            keyboard.push([
                { text: "➕ Yangi so'rov" },
                { text: "💾 SET (Muddat uzaytirish)" }
            ]);
            keyboard.push([
                { text: "📋 Mening so'rovlarim" },
                { text: "⏳ Jarayondagi so'rovlar" }
            ]);
            keyboard.push([
                { text: "✅ Tasdiqlangan so'rovlar" },
                { text: "📊 Brend va Filiallar statistikasi" }
            ]);
        }
        
        if (isCashier || permissions.includes('debt:approve_cashier')) {
            keyboard.push([{ text: "📥 Yangi so'rovlar" }]);
            keyboard.push([
                { text: "📋 Mening so'rovlarim" },
                { text: "⏰ Kutayotgan so'rovlar" }
            ]);
        }
        
        if (permissions.includes('debt:approve_operator')) {
            keyboard.push([{ text: "📥 Yangi so'rovlar" }]);
            keyboard.push([
                { text: "📋 Mening so'rovlarim" },
                { text: "⏰ Kutayotgan so'rovlar" }
            ]);
        }
        
        if (permissions.includes('debt:approve_leader')) {
            keyboard.push([
                { text: "📥 SET so'rovlari" },
                { text: "📋 Tasdiqlangan so'rovlar" }
            ]);
        }
        
        if (permissions.includes('debt:approve_supervisor')) {
            keyboard.push([
                { text: "📥 Nazorat so'rovlari" },
                { text: "📋 Nazorat qilingan so'rovlar" }
            ]);
        }
        
        // Bloklash faqat WEB orqali qilinadi (botdan olib tashlandi)
        
        if (permissions.includes('debt:admin') || permissions.includes('debt:manage_bindings') || ADMIN_ROLES.includes(user.role)) {
            keyboard.push([{ text: "⚙️ Sozlamalar" }]);
        }
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

