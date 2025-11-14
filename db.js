const knex = require('knex');
const config = require('./knexfile.js');
const bcrypt = require('bcrypt');
const saltRounds = 10;

const db = knex(config.development);

// Yordamchi funksiya: Audit jurnaliga yozish
const logAction = async (userId, action, targetType = null, targetId = null, details = {}) => {
    try {
        const ipAddress = details.ip || null;
        const userAgent = details.userAgent || null;
        if (details.ip) delete details.ip;
        if (details.userAgent) delete details.userAgent;
        
        await db('audit_logs').insert({
            user_id: userId,
            action: action,
            target_type: targetType,
            target_id: targetId,
            details: JSON.stringify(details),
            ip_address: ipAddress,
            user_agent: userAgent,
        });
    } catch (error) {
        console.error("Audit log yozishda xatolik:", error);
    }
};

const initializeDB = async () => {
    console.log('Ma\'lumotlar bazasi migratsiyalari tekshirilmoqda...');
    
    await db.migrate.latest();
    
    console.log('Migratsiyalar muvaffaqiyatli yakunlandi.');

    // --- BOSHLANG'ICH MA'LUMOTLARNI (SEEDS) YARATISH VA YANGILASH ---

    const initialRoles = ['admin', 'manager', 'operator'];
    
    const initialPermissions = [
        { permission_key: 'reports:view_all', description: 'Barcha hisobotlarni ko\'rish', category: 'Hisobotlar' },
        { permission_key: 'reports:view_pivot', description: 'Interaktiv hisobotlarni (Pivot Table) ko\'rish', category: 'Hisobotlar' },
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
        { permission_key: 'audit:view', description: 'Tizim jurnali (audit log)ni ko\'rish', category: 'Admin' }
    ];

    // Har bir rol uchun standart huquqlar to'plami
    const rolePerms = {
        admin: initialPermissions.map(p => p.permission_key), // Admin barcha huquqlarga ega
        manager: [
            'dashboard:view', 
            'reports:view_all',
            'reports:view_pivot', // Menejerga ham interaktiv hisobotni ko'rish huquqi berildi
            'reports:create',
            'reports:edit_assigned',
            'reports:edit_own'
        ],
        operator: [
            'reports:view_own',
            'reports:create', 
            'reports:edit_own'
        ]
    };

    // Tranzaksiya ichida boshlang'ich ma'lumotlarni kiritish
    await db.transaction(async trx => {
        await trx('roles')
            .insert(initialRoles.map(r => ({ role_name: r })))
            .onConflict('role_name')
            .ignore();
        
        await trx('permissions')
            .insert(initialPermissions)
            .onConflict('permission_key')
            .merge(); // .merge() o'rniga .ignore() dan foydalanish mumkin, agar mavjud bo'lsa o'zgartirish kerak bo'lmasa

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
    });

    const adminUser = await db('users').where({ role: 'admin' }).first();
    if (!adminUser) {
        const hashedPassword = await bcrypt.hash('admin123', saltRounds);
        await db('users').insert({ username: 'admin', password: hashedPassword, role: 'admin' });
        console.log("Boshlang'ich admin yaratildi. Login: 'admin', Parol: 'admin123'");
    }
    
    console.log('Boshlang\'ich ma\'lumotlar (seeds) tekshirildi va qo\'shildi.');
};

module.exports = { db, initializeDB, logAction };
