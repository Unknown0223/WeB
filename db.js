// db.js (TO'LIQ FAYL)

const knex = require('knex');
const config = require('./knexfile.js');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// NODE_ENV ga qarab development yoki production sozlamasini tanlash
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env] || config.development;

const db = knex(dbConfig);

// Yordamchi funksiya: Audit jurnaliga yozish
const logAction = async (userId, action, targetType = null, targetId = null, details = {}) => {
    try {
        const ipAddress = details.ip || null;
        const userAgent = details.userAgent || null;
        if (details.ip) delete details.ip;
        if (details.userAgent) delete details.userAgent;
        
        const logEntry = {
            user_id: userId,
            action: action,
            target_type: targetType,
            target_id: targetId,
            details: JSON.stringify(details),
            ip_address: ipAddress,
            user_agent: userAgent,
        };
        
        const [logId] = await db('audit_logs').insert(logEntry);
        
        // Muhim event'lar uchun WebSocket orqali realtime yuborish
        const importantActions = [
            'create_report', 'edit_report', 'delete_report',
            'create_user', 'edit_user', 'delete_user', 'approve_user', 'reject_user',
            'create_role', 'update_role', 'delete_role',
            'login_success', 'login_fail', 'logout', 'account_lock',
            'change_password', 'change_secret_word'
        ];
        
        if (global.broadcastWebSocket && importantActions.includes(action)) {
            console.log(`📡 [AUDIT] Muhim action yozildi, WebSocket orqali yuborilmoqda... Action: ${action}`);
            global.broadcastWebSocket('audit_log_added', {
                logId: logId,
                userId: userId,
                action: action,
                targetType: targetType,
                targetId: targetId,
                details: details,
                timestamp: new Date().toISOString()
            });
            console.log(`✅ [AUDIT] WebSocket yuborildi: audit_log_added`);
        }
    } catch (error) {
        console.error("Audit log yozishda xatolik:", error);
    }
};

const initializeDB = async () => {
    console.log('Ma\'lumotlar bazasi migratsiyalari tekshirilmoqda...');
    
    await db.migrate.latest();
    
    console.log('Migratsiyalar muvaffaqiyatli yakunlandi.');

    // --- BOSHLANG'ICH MA'LUMOTLARNI (SEEDS) YARATISH VA YANGILASH ---

    // Faqat super_admin roli yaratiladi, boshqa rollar superadmin tomonidan yaratiladi
    const initialRoles = ['super_admin'];
    
    const initialPermissions = [
        { permission_key: 'reports:view_all', description: 'Barcha hisobotlarni ko\'rish (Pivot uchun ham)', category: 'Hisobotlar' },
        { permission_key: 'reports:view_assigned', description: 'Biriktirilgan filial hisobotlarini ko\'rish', category: 'Hisobotlar' },
        { permission_key: 'reports:view_own', description: 'Faqat o\'zi yaratgan hisobotlarni ko\'rish', category: 'Hisobotlar' },
        { permission_key: 'reports:create', description: 'Yangi hisobot yaratish', category: 'Hisobotlar' },
        { permission_key: 'reports:edit_all', description: 'Barcha hisobotlarni tahrirlash', category: 'Hisobotlar' },
        { permission_key: 'reports:edit_assigned', description: 'Biriktirilgan filial hisobotlarini tahrirlash', category: 'Hisobotlar' },
        { permission_key: 'reports:edit_own', description: 'Faqat o\'zi yaratgan hisobotlarni tahrirlash', category: 'Hisobotlar' },
        { permission_key: 'reports:delete', description: 'Hisobotlarni o\'chirish', category: 'Hisobotlar' },
        { permission_key: 'users:view', description: 'Foydalanuvchilar ro\'yxatini ko\'rish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:create', description: 'Yangi foydalanuvchi yaratish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:edit', description: 'Foydalanuvchi ma\'lumotlarini (rol, filial) tahrirlash', category: 'Foydalanuvchilar' },
        { permission_key: 'users:change_password', description: 'Foydalanuvchi parolini o\'zgartirish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:set_secret_word', description: 'Foydalanuvchi maxfiy so\'zini o\'rnatish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:change_status', description: 'Foydalanuvchini bloklash/aktivlashtirish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:manage_sessions', description: 'Foydalanuvchi sessiyalarini boshqarish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:connect_telegram', description: 'Foydalanuvchini Telegram botga ulash', category: 'Foydalanuvchilar' },
        { permission_key: 'settings:view', description: 'Sozlamalarni ko\'rish', category: 'Sozlamalar' },
        { permission_key: 'settings:edit_general', description: 'Umumiy sozlamalarni (sahifalash, brending) o\'zgartirish', category: 'Sozlamalar' },
        { permission_key: 'settings:edit_table', description: 'Jadval (ustun, qator, filial) sozlamalarini o\'zgartirish', category: 'Sozlamalar' },
        { permission_key: 'settings:edit_telegram', description: 'Telegram sozlamalarini o\'zgartirish', category: 'Sozlamalar' },
        { permission_key: 'roles:manage', description: 'Rollar va huquqlarni boshqarish', category: 'Rollar' },
        { permission_key: 'dashboard:view', description: 'Boshqaruv panelini (statistika) ko\'rish', category: 'Boshqaruv Paneli' },
        { permission_key: 'audit:view', description: 'Tizim jurnali (audit log)ni ko\'rish', category: 'Admin' },
        // Qiymatlarni Solishtirish permission'lari
        { permission_key: 'comparison:view', description: 'Qiymatlarni solishtirish bo\'limini ko\'rish', category: 'Qiymatlarni Solishtirish' },
        { permission_key: 'comparison:edit', description: 'Solishtirish summalarini kiritish va saqlash', category: 'Qiymatlarni Solishtirish' },
        { permission_key: 'comparison:export', description: 'Solishtirish natijalarini Excel faylga eksport qilish', category: 'Qiymatlarni Solishtirish' },
        { permission_key: 'comparison:notify', description: 'Farqlar haqida operatorlarga bildirishnoma yuborish', category: 'Qiymatlarni Solishtirish' }
    ];

    // === MUAMMO TUZATILGAN JOY ===
    // Faqat super_admin roli uchun huquqlar belgilanadi
    // Boshqa rollar superadmin tomonidan yaratiladi va ularning huquqlari ham superadmin tomonidan belgilanadi
    const rolePerms = {
        super_admin: initialPermissions.map(p => p.permission_key) // Super admin barcha huquqlarga ega va cheklovsiz
    };
    // ============================

    // Tranzaksiya ichida boshlang'ich ma'lumotlarni kiritish
    await db.transaction(async trx => {
        await trx('roles')
            .insert(initialRoles.map(r => ({ role_name: r })))
            .onConflict('role_name')
            .ignore();
        
        await trx('permissions')
            .insert(initialPermissions)
            .onConflict('permission_key')
            .ignore();

        for (const role in rolePerms) {
            await trx('role_permissions').where({ role_name: role }).del();
            const permsToInsert = rolePerms[role].map(pKey => ({
                role_name: role,
                permission_key: pKey
            }));
            if (permsToInsert.length > 0) {
                await trx('role_permissions').insert(permsToInsert);
            }
        }
        
        // Rollar uchun shartlarni o'rnatish
        // Super admin: hech qanday shartlar yo'q (to'liq dotup) - null
        await trx('roles')
            .where('role_name', 'super_admin')
            .update({ requires_locations: null, requires_brands: null });
    });

    // Seeds faylini ishga tushirish (kengaytirilgan permission'lar)
    try {
        const expandedPermissionsSeed = require('./seeds/02_expanded_permissions.js');
        await expandedPermissionsSeed.seed(db);
        console.log('Kengaytirilgan permission\'lar qo\'shildi.');
    } catch (error) {
        console.error('Seeds faylini ishga tushirishda xatolik:', error.message);
        // Xatolik bo'lsa ham davom etamiz
    }

    // Super admin yaratish (agar mavjud bo'lmasa)
    const superAdminUser = await db('users').where({ role: 'super_admin' }).first();
    if (!superAdminUser) {
        const hashedPassword = await bcrypt.hash('superadmin123', saltRounds);
        await db('users').insert({ 
            username: 'superadmin', 
            password: hashedPassword, 
            role: 'super_admin',
            status: 'active',
            device_limit: 999 // Super admin uchun cheksiz device limit
        });
        console.log("Boshlang'ich super admin yaratildi. Login: 'superadmin', Parol: 'superadmin123'");
    }
    
    // Telegram sozlamalarini tekshirish va qo'yish (agar mavjud bo'lmasa)
    const telegramSettings = [
        { key: 'telegram_bot_token', value: '8448375034:AAE4az26SqxDP4CFbW0hkTGfc8zkL-zm5ig' },
        { key: 'telegram_bot_username', value: 'kassa_opertor_bot' },
        { key: 'telegram_admin_chat_id', value: '5988510278' },
        { key: 'telegram_group_id', value: '-4521600300' }
    ];
    
    for (const setting of telegramSettings) {
        const existing = await db('settings').where({ key: setting.key }).first();
        if (!existing) {
            await db('settings').insert(setting);
            console.log(`✅ Telegram sozlamasi qo'shildi: ${setting.key}`);
        }
    }
    
    console.log('Boshlang\'ich ma\'lumotlar (seeds) tekshirildi va qo\'shildi.');
};

module.exports = { db, initializeDB, logAction };
