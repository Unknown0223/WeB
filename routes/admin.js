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
        
        log.debug(`✅ Database backup yuklab olindi: ${fileName} (${fileSizeInMB} MB)`);

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
            log.debug(`✅ Eski database backup qilindi: ${backupFileName}`);
        } catch (error) {
            log.warn(`⚠️ Eski database backup qilishda xatolik (ehtimol fayl mavjud emas): ${error.message}`);
        }

        // Yangi database faylini yozish
        await fs.writeFile(dbPath, req.file.buffer);
        log.debug(`✅ Yangi database yozildi: ${req.file.originalname} (${(req.file.size / (1024 * 1024)).toFixed(2)} MB)`);

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
            
            log.debug(`✅ Database to'g'ri ishlayapti`);
        } catch (error) {
            // Agar yangi database noto'g'ri bo'lsa, eski database'ni qaytarish
            try {
                await fs.copyFile(backupPath, dbPath);
                log.debug(`⚠️ Yangi database noto'g'ri, eski database qaytarildi`);
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
router.post('/clear-sessions', async (req, res) => {
    try {
        const currentSessionId = req.sessionID;

        // O'zining (joriy adminning) sessiyasidan tashqari barcha sessiyalarni o'chiramiz.
        const changes = await db('sessions').whereNot('sid', currentSessionId).del();

        res.json({ message: `${changes} ta foydalanuvchi sessiyasi muvaffaqiyatli tugatildi.` });
    } catch (error) {
        log.error("Sessiyalarni tozalashda xatolik:", error);
        res.status(500).json({ message: "Sessiyalarni tozalashda server xatoligi." });
    }
});

// GET /api/admin/export-full-db - To'liq ma'lumotlar bazasini JSON formatda export qilish
router.get('/export-full-db', async (req, res) => {
    try {
        log.debug('📥 To\'liq database export boshlandi...');
        
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
        
        log.debug(`✅ Export tayyor: ${Object.keys(tables).length} jadval, ${fullExport.export_info.total_records} yozuv`);
        log.debug(`📊 Jadval statistikasi:`, counts);
        
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
        log.debug('📤 To\'liq database import boshlandi...');
        
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
        
        log.debug(`🛡️ Super admin'lar himoya qilinmoqda: ${superAdminIds.length} ta`);
        
        // Transaction ichida import qilish (xatolik bo'lsa rollback)
        const importCounts = {};
        const skippedCounts = {};
        const errorCounts = {};
        
        await db.transaction(async (trx) => {
            // 1. Ma'lumotlarni import qilish (tozalash emas, faqat yangi ma'lumotlarni qo'shish)
            log.debug('📥 Yangi ma\'lumotlarni yuklash...');
            
            // Import oldidan rollarni tekshirish va saqlash (keyinroq solishtirish uchun)
            let existingRoleNames = [];
            if (data.roles && Array.isArray(data.roles)) {
                const existingRoles = await trx('roles').select('role_name');
                existingRoleNames = existingRoles.map(r => r.role_name);
                const importRoleNames = data.roles.map(r => r.role_name).filter(Boolean);
                
                log.debug(`🔍 [ROLES] Import oldidan rollar tekshiruvi:`);
                log.debug(`  📊 Mavjud rollar (${existingRoleNames.length} ta):`, existingRoleNames);
                log.debug(`  📊 Import qilinadigan rollar (${importRoleNames.length} ta):`, importRoleNames);
                
                // O'chirilgan rollarni topish (import faylida yo'q, lekin bazada mavjud)
                const deletedRoles = existingRoleNames.filter(role => !importRoleNames.includes(role));
                if (deletedRoles.length > 0) {
                    log.debug(`  ⚠️ [ROLES] EHTIYOT: Quyidagi rollar import faylida yo'q (o'chirilishi mumkin):`, deletedRoles);
                    log.debug(`  ⚠️ [ROLES] Bu rollar bazada qoladi, chunki import faqat yangi ma'lumotlarni qo'shadi/yangilaydi`);
                } else {
                    log.debug(`  ✅ [ROLES] Barcha mavjud rollar import faylida mavjud`);
                }
                
                // Yangi rollarni topish
                const newRoles = importRoleNames.filter(role => !existingRoleNames.includes(role));
                if (newRoles.length > 0) {
                    log.debug(`  ➕ [ROLES] Yangi qo'shiladigan rollar (${newRoles.length} ta):`, newRoles);
                }
                
                // Yangilanadigan rollarni topish
                const updatedRoles = importRoleNames.filter(role => existingRoleNames.includes(role));
                if (updatedRoles.length > 0) {
                    log.debug(`  🔄 [ROLES] Yangilanadigan rollar (${updatedRoles.length} ta):`, updatedRoles);
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
                                log.debug(`  ⚠ Super admin o'tkazib yuborildi: ${record.username || record.id}`);
                                skipped++;
                                continue;
                            }
                            
                            // Super admin ID'larni o'tkazib yuborish
                            if (tableName === 'users' && superAdminIds.includes(record.id)) {
                                log.debug(`  ⚠ Super admin ID o'tkazib yuborildi: ${record.id}`);
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
                                    const relatedRecord = await trx(fk.table)
                                        .where(fk.column, record[fk.reference])
                                        .first();
                                    
                                    if (!relatedRecord) {
                                        log.debug(`  ⚠ Foreign key tekshiruvi: ${fk.table}.${fk.column} = ${record[fk.reference]} topilmadi`);
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
                                        log.debug(`  🔄 [ROLES] Rol yangilanmoqda: ${roleName}`);
                                        log.debug(`  📋 [ROLES] Eski ma'lumot:`, JSON.stringify(existing));
                                        log.debug(`  📋 [ROLES] Yangi ma'lumot:`, JSON.stringify(record));
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
                                        log.debug(`  ✅ [ROLES] Rol yangilandi: ${roleName}`);
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
                                        log.debug(`  ➕ [ROLES] Yangi rol qo'shilmoqda: ${roleName}`);
                                        log.debug(`  📋 [ROLES] Rol ma'lumotlari:`, JSON.stringify(recordToInsert));
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
                                        log.debug(`  ✅ [ROLES] Yangi rol qo'shildi: ${roleName}`);
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
                                            skipped++;
                                            continue;
                                        }
                                    }
                                }
                                
                                // ID'ni tekshirish va agar mavjud bo'lsa, skip qilish
                                if (record.id) {
                                    const existing = await trx(tableName)
                                        .where('id', record.id)
                                        .first();
                                    if (existing) {
                                        skipped++;
                                        continue;
                                    }
                                }
                                // ID'ni o'chirib, insert qilish (avtomatik generatsiya uchun)
                                const recordToInsert = { ...record };
                                if (recordToInsert.id && tableName !== 'users') {
                                    delete recordToInsert.id;
                                }
                                await trx(tableName).insert(recordToInsert);
                                imported++;
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
                    
                    log.debug(`  ✓ ${tableName}: ${imported} import, ${skipped} o'tkazib yuborildi, ${errors} xatolik`);
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
                
                log.debug(`🔍 [ROLES] Import keyin rollar tekshiruvi:`);
                log.debug(`  📊 Import oldin bazadagi rollar (${existingRoleNames.length} ta):`, existingRoleNames);
                log.debug(`  📊 Import keyin bazadagi rollar (${finalRoleNames.length} ta):`, finalRoleNames);
                
                // O'chirilgan rollarni topish (import faylida yo'q, lekin bazada mavjud)
                const deletedRoles = finalRoleNames.filter(role => !importRoleNames.includes(role));
                if (deletedRoles.length > 0) {
                    log.debug(`  ⚠️ [ROLES] EHTIYOT: Quyidagi rollar import faylida yo'q, lekin bazada qolgan (${deletedRoles.length} ta):`, deletedRoles);
                    log.debug(`  ⚠️ [ROLES] Bu rollar o'chirilmagan, chunki import faqat yangi ma'lumotlarni qo'shadi/yangilaydi`);
                }
                
                // Qo'shilgan yangi rollarni topish (import oldin yo'q edi, keyin qo'shildi)
                const actuallyNewRoles = finalRoleNames.filter(role => {
                    const wasInImport = importRoleNames.includes(role);
                    const wasInDbBefore = existingRoleNames.includes(role);
                    return wasInImport && !wasInDbBefore;
                });
                if (actuallyNewRoles.length > 0) {
                    log.debug(`  ✅ [ROLES] Muvaffaqiyatli qo'shilgan yangi rollar (${actuallyNewRoles.length} ta):`, actuallyNewRoles);
                }
                
                // Yo'qolgan rollarni topish (import oldin bor edi, keyin yo'qoldi)
                const lostRoles = existingRoleNames.filter(role => !finalRoleNames.includes(role));
                if (lostRoles.length > 0) {
                    log.debug(`  ❌ [ROLES] XATOLIK: Quyidagi rollar import oldin bor edi, lekin keyin yo'qoldi (${lostRoles.length} ta):`, lostRoles);
                    log.debug(`  ❌ [ROLES] Bu rollar o'chirilgan bo'lishi mumkin!`);
                } else {
                    log.debug(`  ✅ [ROLES] Barcha mavjud rollar saqlanib qoldi`);
                }
            }
            
            log.debug('✅ Import muvaffaqiyatli yakunlandi!');
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

module.exports = router;
