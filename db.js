// db.js (TO'LIQ FAYL)

const knex = require('knex');
const bcrypt = require('bcrypt');
const { createLogger } = require('./utils/logger.js');
const path = require('path');
const fs = require('fs').promises;

const log = createLogger('DB');
const saltRounds = 10;

// Database config'ni dynamic olish (har safar environment variable'larni qayta o'qish)
function getDbConfig() {
    // Railway.com'da DATABASE_URL mavjud bo'lsa, uni to'g'ridan-to'g'ri ishlatish
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID || !!process.env.RAILWAY_SERVICE_NAME;
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    const hasPostgresConfig = !!(process.env.POSTGRES_HOST && process.env.POSTGRES_DB);
    
    // Railway.com'da va DATABASE_URL mavjud bo'lsa, to'g'ridan-to'g'ri PostgreSQL config qaytarish
    if (isRailway && hasDatabaseUrl) {
        return {
            client: 'pg',
            connection: process.env.DATABASE_URL,
            migrations: {
                directory: path.resolve(__dirname, 'migrations')
            },
            pool: {
                min: 2,
                max: 10,
                acquireTimeoutMillis: 30000,
                idleTimeoutMillis: 30000,
                createTimeoutMillis: 10000,
                destroyTimeoutMillis: 5000
            },
            acquireConnectionTimeout: 10000,
            asyncStackTraces: false,
            debug: false
        };
    }
    
    // Boshqa holatda knexfile.js dan config olish
    const config = require('./knexfile.js');
    const env = process.env.NODE_ENV || 'development';
    return config[env] || config.development;
}

// NODE_ENV ga qarab development yoki production sozlamasini tanlash
const env = process.env.NODE_ENV || 'development';
const dbConfig = getDbConfig();

// Asosiy database connection
const db = knex(dbConfig);

// Database turini aniqlash (avtomatik)
const isPostgres = dbConfig.client === 'pg';
const isSqlite = dbConfig.client === 'sqlite3';

// Yordamchi funksiya: Constraint xatolikni tekshirish
const isConstraintError = (error) => {
    if (!error) return false;
    
    // PostgreSQL xatoliklari
    if (error.code === '23505') return true; // unique_violation
    if (error.code === '23503') return true; // foreign_key_violation
    if (error.code === '23502') return true; // not_null_violation
    
    // SQLite xatoliklari
    if (error.code === 'SQLITE_CONSTRAINT') return true;
    if (error.message && error.message.includes('UNIQUE constraint failed')) return true;
    
    return false;
};

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
        
        // SQLite uchun .returning() ishlamaydi
        let logId;
        if (isSqlite) {
            const insertedIds = await db('audit_logs').insert(logEntry);
            logId = Array.isArray(insertedIds) ? insertedIds[0] : insertedIds;
        } else {
            const result = await db('audit_logs').insert(logEntry).returning('id');
            logId = result[0]?.id || result[0];
        }
        
        // Muhim event'lar uchun WebSocket orqali realtime yuborish
        const importantActions = [
            'create_report', 'edit_report', 'delete_report',
            'create_user', 'edit_user', 'delete_user', 'approve_user', 'reject_user',
            'create_role', 'update_role', 'delete_role',
            'login_success', 'login_fail', 'logout', 'account_lock',
            'change_password', 'change_secret_word'
        ];
        
        if (global.broadcastWebSocket && importantActions.includes(action)) {
            global.broadcastWebSocket('audit_log_added', {
                logId: logId,
                userId: userId,
                action: action,
                targetType: targetType,
                targetId: targetId,
                details: details,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        log.error('Audit log yozishda xatolik:', error.message);
    }
};

const initializeDB = async () => {
    
    await db.migrate.latest();

    // --- BOSHLANG'ICH MA'LUMOTLARNI (SEEDS) YARATISH VA YANGILASH ---
    // YANGI LOGIKA: Faqat superadmin standart rol bo'ladi, boshqa rollar superadmin tomonidan yaratiladi

    const initialRoles = ['superadmin']; // Faqat superadmin standart rol
    
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

    // Superadmin uchun barcha huquqlar
    const rolePerms = {
        superadmin: initialPermissions.map(p => p.permission_key) // Superadmin barcha huquqlarga ega va cheklovsiz
    };

    // Tranzaksiya ichida boshlang'ich ma'lumotlarni kiritish
    // Retry mexanizmi bilan - SQLite BUSY xatoliklarini hal qilish
    let retries = 3;
    let lastError = null;
    
    while (retries > 0) {
        try {
            await db.transaction(async trx => {
                // Import oldidan rollarni tekshirish
                const rolesBefore = await trx('roles').select('role_name');
                const roleNamesBefore = rolesBefore.map(r => r.role_name);
                
                // Faqat superadmin rolini yaratish - retry bilan
                try {
                    await trx('roles')
                        .insert(initialRoles.map(r => ({ role_name: r })))
                        .onConflict('role_name')
                        .ignore();
                } catch (insertError) {
                    // Agar insert xatolik bo'lsa, ignore qilish (chunki onConflict.ignore() ishlashi kerak)
                    if (!isConstraintError(insertError)) {
                        throw insertError;
                    }
                }
        
        // Permissions yaratish
        await trx('permissions')
            .insert(initialPermissions)
            .onConflict('permission_key')
            .ignore();

        // Superadmin uchun barcha huquqlarni biriktirish
        await trx('role_permissions').where({ role_name: 'superadmin' }).del();
        const permsToInsert = rolePerms.superadmin.map(pKey => ({
            role_name: 'superadmin',
            permission_key: pKey
        }));
        if (permsToInsert.length > 0) {
            await trx('role_permissions').insert(permsToInsert);
        }
        
        // Superadmin uchun shartlar null (cheksiz dostup)
        await trx('roles')
            .where('role_name', 'superadmin')
            .update({ requires_locations: null, requires_brands: null });
        
        // EHTIYOT: Eski standart rollarni o'chirish kodi olib tashlandi
        // Chunki bu kod har safar server ishga tushganda rollarni o'chiryapti
        // Rollar endi import yoki admin panel orqali boshqariladi
        // Agar eski rollarni tozalash kerak bo'lsa, buni qo'lda qilish kerak
        
        // Import keyin rollarni tekshirish
        const rolesAfter = await trx('roles').select('role_name');
        const roleNamesAfter = rolesAfter.map(r => r.role_name);
        
        // Yo'qolgan rollarni topish
        const lostRoles = roleNamesBefore.filter(role => !roleNamesAfter.includes(role));
        if (lostRoles.length > 0) {
            log.error(`[ROLES] XATOLIK: Quyidagi rollar yo'qoldi (${lostRoles.length} ta):`, lostRoles);
        }
            });
            
            // Agar muvaffaqiyatli bo'lsa, retry loop'ni to'xtatish
            retries = 0;
            break;
        } catch (error) {
            lastError = error;
            retries--;
            
            if (error.code === '23505' && retries > 0) {
                // Qisqa kutish va qayta urinish (PostgreSQL lock)
                await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries))); // 100ms, 200ms, 300ms
            } else {
                // Boshqa xatolik yoki retry'lar tugagan
                throw error;
            }
        }
    }
    
    if (lastError && retries === 0) {
        throw lastError;
    }

    // Seeds faylini ishga tushirish (kengaytirilgan permission'lar)
    try {
        const expandedPermissionsSeed = require('./seeds/02_expanded_permissions.js');
        await expandedPermissionsSeed.seed(db);
    } catch (error) {
        log.warn('Seeds faylini ishga tushirishda xatolik:', error.message);
        // Xatolik bo'lsa ham davom etamiz
    }

    // Superadmin yaratish (agar mavjud bo'lmasa)
    // Eski super_admin va yangi superadmin ni tekshirish
    const superAdminUser = await db('users').whereIn('role', ['super_admin', 'superadmin']).first();
    if (!superAdminUser) {
        const hashedPassword = await bcrypt.hash('superadmin123', saltRounds);
        await db('users').insert({ 
            username: 'superadmin', 
            password: hashedPassword, 
            role: 'superadmin',
            status: 'active',
            device_limit: 999 // Superadmin uchun cheksiz device limit
        });
        log.info('Superadmin foydalanuvchi yaratildi');
    } else if (superAdminUser.role === 'super_admin') {
        // Eski super_admin ni superadmin ga o'zgartirish
        await db('users').where({ id: superAdminUser.id }).update({ role: 'superadmin' });
        log.info('Eski super_admin roli superadmin ga o\'zgartirildi');
    }
    
    // Telegram sozlamalarini tekshirish va qo'yish (agar mavjud bo'lmasa)
    // Faqat mavjud bo'lmaganda bo'sh yaratish, avtomatik to'ldirmaslik
    const telegramSettings = [
        { key: 'telegram_bot_token', value: '' },
        { key: 'telegram_bot_username', value: '' },
        { key: 'telegram_admin_chat_id', value: '' },
        { key: 'telegram_group_id', value: '' },
        { key: 'telegram_enabled', value: 'false' } // Telegram aktiv/neaktiv holati
    ];
    
    for (const setting of telegramSettings) {
        const existing = await db('settings').where({ key: setting.key }).first();
        if (!existing) {
            // Yangi setting yaratish (faqat mavjud bo'lmaganda)
            await db('settings').insert(setting);
            log.debug(`Telegram sozlamasi qo'shildi: ${setting.key}`);
        }
        // Mavjud bo'lsa, o'zgartirmaymiz - foydalanuvchi sozlamalar orqali boshqaradi
    }
    
};

module.exports = { db, initializeDB, logAction, isPostgres, isSqlite, isConstraintError };
