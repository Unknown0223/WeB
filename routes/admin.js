const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const multer = require('multer');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('ADMIN');


const router = express.Router();

// Multer konfiguratsiyasi - database fayllari uchun
const uploadDb = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit (database fayllari katta bo'lishi mumkin)
    },
    fileFilter: (req, file, cb) => {
        // Faqat .db fayllarni qabul qilish
        if (file.originalname.endsWith('.db') || 
            file.mimetype === 'application/x-sqlite3' ||
            file.mimetype === 'application/octet-stream') {
            cb(null, true);
        } else {
            cb(new Error('Faqat database fayllarni (.db) yuklash mumkin'), false);
        }
    }
});

// Bu butun router uchun middleware vazifasini o'taydi.
// Faqat 'roles:manage' huquqi borlar bu endpointlarga kira oladi.
router.use(isAuthenticated, hasPermission('roles:manage'));

// GET /api/admin/backup-db - Ma'lumotlar bazasini yuklab olish (TAKOMILLASHTIRILGAN)
router.get('/backup-db', async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '..', 'database.db');
        
        // Database faylini tekshirish
        try {
            await fs.access(dbPath);
        } catch (error) {
            return res.status(404).json({ message: "Ma'lumotlar bazasi fayli topilmadi." });
        }
        
        // Database hajmini olish
        const stats = await fs.stat(dbPath);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        // Fayl nomini yaratish (sana va vaqt bilan)
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const fileName = `database_backup_${dateStr}_${timeStr}.db`;

        // Response header'larni o'rnatish
        res.setHeader('Content-Type', 'application/x-sqlite3');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', stats.size);
        
        // Database faylini yuborish
        const fileStream = require('fs').createReadStream(dbPath);
        fileStream.pipe(res);
        

    } catch (error) {
        log.error("Baza nusxasini yuklashda kutilmagan xatolik:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Serverda ichki xatolik: " + error.message });
        }
    }
});

// POST /api/admin/restore-db - Ma'lumotlar bazasini restore qilish (YANGI)
router.post('/restore-db', uploadDb.single('database'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Database fayl yuklanmagan. Iltimos, .db faylini tanlang.' });
        }

        const dbPath = path.join(__dirname, '..', 'database.db');
        const backupDir = path.join(__dirname, '..', 'backups');
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        
        // Backup papkasini yaratish (agar mavjud bo'lmasa)
        try {
            await fs.access(backupDir);
        } catch {
            await fs.mkdir(backupDir, { recursive: true });
        }

        // Eski database'ni backup qilish (xavfsizlik uchun)
        const backupFileName = `database_backup_before_restore_${dateStr}_${timeStr}.db`;
        const backupPath = path.join(backupDir, backupFileName);
        
        try {
            await fs.copyFile(dbPath, backupPath);
        } catch (error) {
            log.error(`Eski database backup qilishda xatolik (ehtimol fayl mavjud emas): ${error.message}`);
        }

        // Yangi database faylini yozish
        await fs.writeFile(dbPath, req.file.buffer);

        // Database'ni tekshirish (bazaga ulanishni sinab ko'rish)
        try {
            // Yangi database bilan bog'lanishni sinab ko'rish
            const testDb = require('knex')({
                client: 'sqlite3',
                connection: {
                    filename: dbPath
                },
                useNullAsDefault: true
            });
            
            // Oddiy so'rovni sinab ko'rish
            await testDb.raw('SELECT 1');
            await testDb.destroy();
        } catch (error) {
            // Agar yangi database noto'g'ri bo'lsa, eski database'ni qaytarish
            try {
                await fs.copyFile(backupPath, dbPath);
                log.error(`Yangi database noto'g'ri, eski database qaytarildi`);
            } catch (restoreError) {
                log.error(`❌ Eski database'ni qaytarishda xatolik: ${restoreError.message}`);
            }
            
            return res.status(400).json({ 
                message: 'Yuklangan database fayli noto\'g\'ri yoki buzilgan. Eski database qaytarildi.',
                error: error.message 
            });
        }

        res.json({ 
            message: 'Database muvaffaqiyatli restore qilindi!',
            backup_file: backupFileName,
            restored_file: req.file.originalname,
            file_size_mb: (req.file.size / (1024 * 1024)).toFixed(2),
            warning: 'Iltimos, serverni qayta ishga tushiring (restart) yangi database ishlashi uchun.'
        });

    } catch (error) {
        log.error("Database restore xatoligi:", error);
        res.status(500).json({ message: "Database restore qilishda xatolik: " + error.message });
    }
});

// POST /api/admin/clear-sessions - Barcha sessiyalarni tozalash
router.post('/clear-sessions', isAuthenticated, hasPermission('users:manage_sessions'), async (req, res) => {
    try {
        const currentSessionId = req.sessionID;

        // O'zining (joriy adminning) sessiyasidan tashqari barcha sessiyalarni o'chiramiz.
        const changes = await db('sessions').whereNot('sid', currentSessionId).del();

        // Online statusni real-time yangilash
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('sessions_cleared', {
                clearedBy: req.session.user.id,
                clearedCount: changes
            });
        }

        res.json({ message: `${changes} ta foydalanuvchi sessiyasi muvaffaqiyatli tugatildi.` });
    } catch (error) {
        log.error("Sessiyalarni tozalashda xatolik:", error);
        res.status(500).json({ message: "Sessiyalarni tozalashda server xatoligi." });
    }
});

// GET /api/admin/export-full-db - To'liq ma'lumotlar bazasini JSON formatda export qilish
router.get('/export-full-db', async (req, res) => {
    try {
        
        // Barcha jadvallardan ma'lumot olish (to'liq ro'yxat)
        const tables = {
            // Asosiy jadvallar
            users: await db('users').select('*'),
            roles: await db('roles').select('*'),
            permissions: await db('permissions').select('*').catch(() => []),
            role_permissions: await db('role_permissions').select('*'),
            user_permissions: await db('user_permissions').select('*').catch(() => []),
            
            // Foydalanuvchi bog'lanishlar
            user_locations: await db('user_locations').select('*'),
            user_brands: await db('user_brands').select('*').catch(() => []),
            
            // Rol bog'lanishlari (QO'SHILDI)
            role_locations: await db('role_locations').select('*'),
            role_brands: await db('role_brands').select('*').catch(() => []),
            
            // Hisobotlar
            reports: await db('reports').select('*'),
            report_history: await db('report_history').select('*').catch(() => []),
            
            // Sozlamalar
            settings: await db('settings').select('*'),
            
            // Brendlar
            brands: await db('brands').select('*'),
            brand_locations: await db('brand_locations').select('*').catch(() => []),
            
            // Ro'yxatdan o'tish
            pending_registrations: await db('pending_registrations').select('*'),
            
            // Audit va xavfsizlik
            audit_logs: await db('audit_logs').select('*'),
            password_change_requests: await db('password_change_requests').select('*').catch(() => []),
            
            // Pivot va shablonlar
            pivot_templates: await db('pivot_templates').select('*'),
            
            // Magic links
            magic_links: await db('magic_links').select('*').catch(() => []),
            
            // Valyuta kurslari
            exchange_rates: await db('exchange_rates').select('*').catch(() => []),
            
            // Solishtirish
            comparisons: await db('comparisons').select('*').catch(() => []),
            
            // Bildirishnomalar
            notifications: await db('notifications').select('*').catch(() => []),
            
            // Filiallar va mahsulotlar
            branches: await db('branches').select('*').catch(() => []),
            products: await db('products').select('*').catch(() => []),
            stocks: await db('stocks').select('*').catch(() => []),
            sales: await db('sales').select('*').catch(() => []),
            
            // Ostatki tahlil
            ostatki_analysis: await db('ostatki_analysis').select('*').catch(() => []),
            ostatki_imports: await db('ostatki_imports').select('*').catch(() => []),
            
            // Bloklangan filiallar
            blocked_filials: await db('blocked_filials').select('*').catch(() => []),
            
            // Import loglari
            imports_log: await db('imports_log').select('*').catch(() => [])
        };
        
        // Counts hisoblash
        const counts = {};
        Object.keys(tables).forEach(tableName => {
            counts[tableName] = Array.isArray(tables[tableName]) ? tables[tableName].length : 0;
        });
        
        // JSON obyekt yaratish
        const fullExport = {
            export_info: {
                version: '2.0',
                exported_at: new Date().toISOString(),
                exported_by: req.user?.username || 'admin',
                description: 'To\'liq ma\'lumotlar bazasi eksporti - barcha jadvallar',
                total_tables: Object.keys(tables).length,
                total_records: Object.values(counts).reduce((sum, count) => sum + count, 0)
            },
            data: tables,
            counts: counts
        };
        
        
        // JSON fayl sifatida yuborish
        const fileName = `full_database_export_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.json(fullExport);
        
    } catch (error) {
        log.error('❌ To\'liq export xatolik:', error);
        res.status(500).json({ message: 'Export qilishda xatolik: ' + error.message });
    }
});

// POST /api/admin/import-full-db - To'liq ma'lumotlar bazasini JSON dan import qilish
router.post('/import-full-db', async (req, res) => {
    try {
        
        const importData = req.body;
        
        // Validatsiya
        if (!importData || !importData.data) {
            return res.status(400).json({ message: 'Noto\'g\'ri import fayl formati' });
        }
        
        const { data } = importData;
        
        // Joriy user ID va role ni olish
        const currentUserId = req.user?.id;
        const currentUserRole = req.user?.role;
        
        // Super admin'ni bazadan olish (himoya qilish uchun)
        const superAdminUsers = await db('users').where('role', 'super_admin').select('id', 'username', 'role');
        const superAdminIds = superAdminUsers.map(u => u.id);
        
        
        // Transaction ichida import qilish (xatolik bo'lsa rollback)
        const importCounts = {};
        const skippedCounts = {};
        const errorCounts = {};
        
        await db.transaction(async (trx) => {
            // 1. Ma'lumotlarni import qilish (tozalash emas, faqat yangi ma'lumotlarni qo'shish)
            
            // Import oldidan rollarni tekshirish va saqlash (keyinroq solishtirish uchun)
            let existingRoleNames = [];
            if (data.roles && Array.isArray(data.roles)) {
                const existingRoles = await trx('roles').select('role_name');
                existingRoleNames = existingRoles.map(r => r.role_name);
                const importRoleNames = data.roles.map(r => r.role_name).filter(Boolean);
                
                
                // O'chirilgan rollarni topish (import faylida yo'q, lekin bazada mavjud)
                const deletedRoles = existingRoleNames.filter(role => !importRoleNames.includes(role));
                if (deletedRoles.length > 0) {
                } else {
                }
                
                // Yangi rollarni topish
                const newRoles = importRoleNames.filter(role => !existingRoleNames.includes(role));
                if (newRoles.length > 0) {
                }
                
                // Yangilanadigan rollarni topish
                const updatedRoles = importRoleNames.filter(role => existingRoleNames.includes(role));
                if (updatedRoles.length > 0) {
                }
            }
            
            // Helper funksiya - jadvalni import qilish (smart import)
            const importTable = async (tableName, tableData, options = {}) => {
                if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
                    importCounts[tableName] = 0;
                    skippedCounts[tableName] = 0;
                    return;
                }
                
                let imported = 0;
                let skipped = 0;
                let errors = 0;
                
                try {
                    for (const record of tableData) {
                        try {
                            // Super admin himoyasi - users jadvali uchun
                            if (tableName === 'users' && record.role === 'super_admin') {
                                skipped++;
                                continue;
                            }
                            
                            // Super admin ID'larni o'tkazib yuborish
                            if (tableName === 'users' && superAdminIds.includes(record.id)) {
                                skipped++;
                                continue;
                            }
                            
                            // Mavjud ma'lumotlarni tekshirish va skip qilish
                            if (options.checkDuplicate) {
                                const existing = await trx(tableName)
                                    .where(options.checkDuplicate.where, record[options.checkDuplicate.key])
                                    .first();
                                
                                if (existing) {
                                    // Agar mavjud bo'lsa va to'liq bir xil bo'lsa, skip qilish
                                    const isIdentical = JSON.stringify(existing) === JSON.stringify(record);
                                    if (isIdentical) {
                                        skipped++;
                                        continue;
                                    }
                                }
                            }
                            
                            // Foreign key tekshiruvi
                            if (options.foreignKeys) {
                                let canImport = true;
                                for (const fk of options.foreignKeys) {
                                    const fkValue = record[fk.reference];
                                    
                                    // Null qiymatlar uchun tekshiruvni o'tkazib yuborish (null - ixtiyoriy foreign key)
                                    if (fkValue === null || fkValue === undefined) {
                                        continue; // Null qiymatlar uchun tekshiruvni o'tkazib yuborish
                                    }
                                    
                                    const relatedRecord = await trx(fk.table)
                                        .where(fk.column, fkValue)
                                        .first();
                                    
                                    if (!relatedRecord) {
                                        log.error(`Foreign key tekshiruvi: ${fk.table}.${fk.column} = ${fkValue} topilmadi`);
                                        canImport = false;
                                        break;
                                    }
                                }
                                
                                if (!canImport) {
                                    skipped++;
                                    continue;
                                }
                            }
                            
                            // Insert yoki update
                            if (options.upsert) {
                                let existing = null;
                                
                                // Composite unique key uchun tekshirish
                                if (options.compositeUnique) {
                                    const whereClause = {};
                                    for (const key of options.compositeUnique) {
                                        if (record[key] !== undefined && record[key] !== null) {
                                            whereClause[key] = record[key];
                                        }
                                    }
                                    if (Object.keys(whereClause).length === options.compositeUnique.length) {
                                        existing = await trx(tableName).where(whereClause).first();
                                    }
                                } else {
                                    // Oddiy unique key uchun tekshirish
                                    existing = await trx(tableName)
                                        .where(options.upsert.where, record[options.upsert.key])
                                        .first();
                                }
                                
                                if (existing) {
                                    // Super admin'ni yangilamaslik
                                    if (tableName === 'users' && existing.role === 'super_admin') {
                                        skipped++;
                                        continue;
                                    }
                                    
                                    // Rollar jadvali uchun log
                                    if (tableName === 'roles') {
                                        const roleName = record.role_name || record[options.upsert.key];
                                    }
                                    
                                    // Users jadvali uchun telegram_chat_id unique constraint tekshiruvi
                                    if (tableName === 'users' && record.telegram_chat_id) {
                                        const existingByTelegram = await trx(tableName)
                                            .where('telegram_chat_id', record.telegram_chat_id)
                                            .where('id', '!=', existing.id)
                                            .first();
                                        if (existingByTelegram) {
                                            // Boshqa user allaqachon bu telegram_chat_id'ga ega
                                            skipped++;
                                            continue;
                                        }
                                    }
                                    
                                    // ID'ni o'chirib, update qilish (avtomatik generatsiya uchun)
                                    const recordToUpdate = { ...record };
                                    if (options.upsert.key === 'id' && tableName !== 'users') {
                                        delete recordToUpdate.id;
                                    }
                                    
                                    // Update uchun where clause
                                    let updateWhere = {};
                                    if (options.compositeUnique) {
                                        for (const key of options.compositeUnique) {
                                            if (record[key] !== undefined && record[key] !== null) {
                                                updateWhere[key] = record[key];
                                            }
                                        }
                                    } else {
                                        updateWhere[options.upsert.where] = record[options.upsert.key];
                                    }
                                    
                                    await trx(tableName)
                                        .where(updateWhere)
                                        .update(recordToUpdate);
                                    
                                    // Rollar jadvali uchun log
                                    if (tableName === 'roles') {
                                        const roleName = record.role_name || record[options.upsert.key];
                                    }
                                } else {
                                    // ID'ni o'chirib, insert qilish (avtomatik generatsiya uchun)
                                    const recordToInsert = { ...record };
                                    if (options.upsert.key === 'id' && tableName !== 'users') {
                                        delete recordToInsert.id;
                                    }
                                    
                                    // Rollar jadvali uchun log
                                    if (tableName === 'roles') {
                                        const roleName = recordToInsert.role_name || recordToInsert[options.upsert?.key];
                                    }
                                    
                                    // Users jadvali uchun telegram_chat_id unique constraint tekshiruvi
                                    if (tableName === 'users' && recordToInsert.telegram_chat_id) {
                                        const existingByTelegram = await trx(tableName)
                                            .where('telegram_chat_id', recordToInsert.telegram_chat_id)
                                            .first();
                                        if (existingByTelegram) {
                                            skipped++;
                                            continue;
                                        }
                                    }
                                    
                                    await trx(tableName).insert(recordToInsert);
                                    
                                    // Rollar jadvali uchun log
                                    if (tableName === 'roles') {
                                        const roleName = recordToInsert.role_name || recordToInsert[options.upsert?.key];
                                    }
                                }
                                imported++;
                            } else {
                                // Composite unique key tekshiruvi (agar upsert yo'q bo'lsa)
                                if (options.compositeUnique) {
                                    const whereClause = {};
                                    for (const key of options.compositeUnique) {
                                        if (record[key] !== undefined && record[key] !== null) {
                                            whereClause[key] = record[key];
                                        }
                                    }
                                    if (Object.keys(whereClause).length === options.compositeUnique.length) {
                                        const existing = await trx(tableName).where(whereClause).first();
                                        if (existing) {
                                            // Mavjud bo'lsa, update qilish
                                            await trx(tableName)
                                                .where(whereClause)
                                                .update(record);
                                            imported++;
                                            continue;
                                        }
                                    }
                                }
                                
                                // ID'ni tekshirish - agar mavjud bo'lsa, update qilish
                                if (record.id) {
                                    const existing = await trx(tableName)
                                        .where('id', record.id)
                                        .first();
                                    if (existing) {
                                        // Mavjud bo'lsa, update qilish
                                        await trx(tableName)
                                            .where('id', record.id)
                                            .update(record);
                                        imported++;
                                        continue;
                                    }
                                    // ID mavjud lekin bazada yo'q, ID bilan insert qilish
                                    await trx(tableName).insert(record);
                                    imported++;
                                } else {
                                    // ID yo'q, insert qilish (avtomatik generatsiya uchun)
                                    await trx(tableName).insert(record);
                                imported++;
                                }
                            }
                        } catch (err) {
                            // UNIQUE constraint xatoliklarini skip qilish
                            if (err.code === 'SQLITE_CONSTRAINT' && err.message && err.message.includes('UNIQUE constraint failed')) {
                                skipped++;
                            } else {
                                log.error(`  ❌ ${tableName} yozuv import xatolik:`, err.message);
                                errors++;
                            }
                        }
                    }
                    
                    importCounts[tableName] = imported;
                    skippedCounts[tableName] = skipped;
                    errorCounts[tableName] = errors;
                    
                } catch (err) {
                    log.error(`  ❌ ${tableName} import xatolik:`, err.message);
                    importCounts[tableName] = 0;
                    skippedCounts[tableName] = 0;
                    errorCounts[tableName] = tableData.length;
                }
            };
            
            // Asosiy jadvallar
            await importTable('users', data.users, {
                upsert: { where: 'id', key: 'id' },
                checkDuplicate: { where: 'username', key: 'username' }
                // telegram_chat_id unique constraint kod ichida tekshiriladi
            });
            
            await importTable('roles', data.roles, {
                upsert: { where: 'role_name', key: 'role_name' }
            });
            
            await importTable('permissions', data.permissions, {
                upsert: { where: 'permission_key', key: 'permission_key' }
            });
            
            await importTable('role_permissions', data.role_permissions, {
                compositeUnique: ['role_name', 'permission_key'],
                foreignKeys: [
                    { table: 'roles', column: 'role_name', reference: 'role_name' },
                    { table: 'permissions', column: 'permission_key', reference: 'permission_key' }
                ]
            });
            
            await importTable('user_permissions', data.user_permissions, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' },
                    { table: 'permissions', column: 'permission_key', reference: 'permission_key' }
                ]
            });
            
            // Sozlamalar (bog'liq emas, avval import qilish)
            await importTable('settings', data.settings, {
                upsert: { where: 'key', key: 'key' }
            });
            
            // Brendlar (boshqa jadvallar uchun asos bo'ladi)
            await importTable('brands', data.brands, {
                upsert: { where: 'id', key: 'id' }
            });
            
            // Foydalanuvchi bog'lanishlar
            await importTable('user_locations', data.user_locations, {
                compositeUnique: ['user_id', 'location_name'],
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            await importTable('user_brands', data.user_brands, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' },
                    { table: 'brands', column: 'id', reference: 'brand_id' }
                ]
            });
            
            // Rol bog'lanishlari (QO'SHILDI)
            await importTable('role_locations', data.role_locations, {
                compositeUnique: ['role_name', 'location_name'],
                foreignKeys: [
                    { table: 'roles', column: 'role_name', reference: 'role_name' }
                ]
            });
            
            await importTable('role_brands', data.role_brands, {
                foreignKeys: [
                    { table: 'roles', column: 'role_name', reference: 'role_name' },
                    { table: 'brands', column: 'id', reference: 'brand_id' }
                ]
            });
            
            await importTable('brand_locations', data.brand_locations, {
                compositeUnique: ['brand_id', 'location_name'],
                foreignKeys: [
                    { table: 'brands', column: 'id', reference: 'brand_id' }
                ]
            });
            
            // Hisobotlar
            await importTable('reports', data.reports, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'created_by' }
                ]
            });
            
            await importTable('report_history', data.report_history, {
                foreignKeys: [
                    { table: 'reports', column: 'id', reference: 'report_id' },
                    { table: 'users', column: 'id', reference: 'changed_by' }
                ]
            });
            
            // Ro'yxatdan o'tish
            await importTable('pending_registrations', data.pending_registrations);
            
            // Audit va xavfsizlik
            await importTable('audit_logs', data.audit_logs, {
                upsert: { where: 'id', key: 'id' },
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            await importTable('password_change_requests', data.password_change_requests, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            // Pivot va shablonlar
            await importTable('pivot_templates', data.pivot_templates, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'created_by' }
                ]
            });
            
            // Magic links
            await importTable('magic_links', data.magic_links, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            // Valyuta kurslari
            await importTable('exchange_rates', data.exchange_rates, {
                compositeUnique: ['base_currency', 'target_currency', 'date'],
                upsert: { where: 'id', key: 'id' }
            });
            
            // Solishtirish
            await importTable('comparisons', data.comparisons);
            
            // Bildirishnomalar
            await importTable('notifications', data.notifications, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            // Filiallar va mahsulotlar
            await importTable('branches', data.branches, {
                upsert: { where: 'id', key: 'id' }
            });
            
            await importTable('products', data.products, {
                upsert: { where: 'id', key: 'id' }
            });
            
            await importTable('stocks', data.stocks, {
                foreignKeys: [
                    { table: 'branches', column: 'id', reference: 'branch_id' },
                    { table: 'products', column: 'id', reference: 'product_id' }
                ]
            });
            
            await importTable('sales', data.sales, {
                foreignKeys: [
                    { table: 'branches', column: 'id', reference: 'branch_id' },
                    { table: 'products', column: 'id', reference: 'product_id' }
                ]
            });
            
            // Ostatki tahlil
            await importTable('ostatki_analysis', data.ostatki_analysis);
            await importTable('ostatki_imports', data.ostatki_imports);
            
            // Bloklangan filiallar
            await importTable('blocked_filials', data.blocked_filials);
            
            // Import loglari
            await importTable('imports_log', data.imports_log);
            
            // Import keyin rollarni tekshirish
            if (data.roles && Array.isArray(data.roles)) {
                const finalRoles = await trx('roles').select('role_name');
                const finalRoleNames = finalRoles.map(r => r.role_name);
                const importRoleNames = data.roles.map(r => r.role_name).filter(Boolean);
                
                
                // O'chirilgan rollarni topish (import faylida yo'q, lekin bazada mavjud)
                const deletedRoles = finalRoleNames.filter(role => !importRoleNames.includes(role));
                if (deletedRoles.length > 0) {
                }
                
                // Qo'shilgan yangi rollarni topish (import oldin yo'q edi, keyin qo'shildi)
                const actuallyNewRoles = finalRoleNames.filter(role => {
                    const wasInImport = importRoleNames.includes(role);
                    const wasInDbBefore = existingRoleNames.includes(role);
                    return wasInImport && !wasInDbBefore;
                });
                if (actuallyNewRoles.length > 0) {
                }
                
                // Yo'qolgan rollarni topish (import oldin bor edi, keyin yo'qoldi)
                const lostRoles = existingRoleNames.filter(role => !finalRoleNames.includes(role));
                if (lostRoles.length > 0) {
                    log.error(`[ROLES] XATOLIK: Quyidagi rollar import oldin bor edi, lekin keyin yo'qoldi (${lostRoles.length} ta):`, lostRoles);
                    log.error(`[ROLES] Bu rollar o'chirilgan bo'lishi mumkin!`);
                }
            }
        });
        
        // Import yakunlandi
        const totalImported = Object.values(importCounts).reduce((sum, count) => sum + count, 0);
        const totalSkipped = Object.values(skippedCounts).reduce((sum, count) => sum + count, 0);
        const totalErrors = Object.values(errorCounts).reduce((sum, count) => sum + count, 0);
        
        res.json({ 
            message: 'Ma\'lumotlar bazasi muvaffaqiyatli import qilindi!',
            counts: importCounts,
            skipped: skippedCounts,
            errors: errorCounts,
            total_imported: totalImported,
            total_skipped: totalSkipped,
            total_errors: totalErrors,
            tables_imported: Object.keys(importCounts).filter(key => importCounts[key] > 0).length
        });
        
    } catch (error) {
        log.error('❌ Import xatolik:', error);
        res.status(500).json({ message: 'Import qilishda xatolik: ' + error.message });
    }
});

// POST /api/admin/cleanup-orphaned-records - Orphaned foreign key yozuvlarni tozalash
router.post('/cleanup-orphaned-records', async (req, res) => {
    try {
        const cleanupResults = {};
        
        // Mavjud user ID'larni olish
        const existingUserIds = new Set();
        const users = await db('users').select('id');
        users.forEach(user => existingUserIds.add(user.id));
        
        // Jadval mavjudligini tekshirish va orphaned yozuvlarni tozalash
        const tablesToClean = [
            { table: 'user_permissions', fkColumn: 'user_id' },
            { table: 'user_locations', fkColumn: 'user_id' },
            { table: 'user_brands', fkColumn: 'user_id' },
            { table: 'reports', fkColumn: 'created_by' },
            { table: 'report_history', fkColumn: 'changed_by' },
            { table: 'audit_logs', fkColumn: 'user_id' },
            { table: 'password_change_requests', fkColumn: 'user_id' },
            { table: 'pivot_templates', fkColumn: 'created_by' },
            { table: 'magic_links', fkColumn: 'user_id' },
            { table: 'notifications', fkColumn: 'user_id' }
        ];
        
        for (const { table, fkColumn } of tablesToClean) {
            try {
                // Jadval mavjudligini tekshirish
                const hasTable = await db.schema.hasTable(table);
                if (!hasTable) {
                    cleanupResults[table] = { deleted: 0, skipped: true, reason: 'Jadval mavjud emas' };
                    continue;
                }
                
                // Orphaned yozuvlarni topish va o'chirish
                const orphanedRecords = await db(table)
                    .whereNotNull(fkColumn)
                    .whereNotIn(fkColumn, Array.from(existingUserIds));
                
                if (orphanedRecords.length > 0) {
                    const deleted = await db(table)
                        .whereNotNull(fkColumn)
                        .whereNotIn(fkColumn, Array.from(existingUserIds))
                        .del();
                    
                    cleanupResults[table] = { deleted, skipped: false };
                    log.info(`✅ [CLEANUP] ${table}: ${deleted} ta orphaned yozuv o'chirildi`);
                } else {
                    cleanupResults[table] = { deleted: 0, skipped: false };
                }
            } catch (err) {
                log.error(`❌ [CLEANUP] ${table} tozalashda xatolik:`, err.message);
                cleanupResults[table] = { deleted: 0, skipped: true, error: err.message };
            }
        }
        
        const totalDeleted = Object.values(cleanupResults)
            .reduce((sum, result) => sum + (result.deleted || 0), 0);
        
        res.json({
            message: 'Orphaned yozuvlar muvaffaqiyatli tozalandi',
            results: cleanupResults,
            total_deleted: totalDeleted
        });
        
    } catch (error) {
        log.error('❌ Orphaned yozuvlarni tozalashda xatolik:', error);
        res.status(500).json({ message: 'Tozalashda xatolik: ' + error.message });
    }
});

module.exports = router;
