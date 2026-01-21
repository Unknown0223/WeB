const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { db, isPostgres, isConstraintError } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const multer = require('multer');
const { createLogger } = require('../utils/logger.js');
const { convertSqliteToPostgres } = require('../utils/sqliteToPostgres.js');
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

// Multer konfiguratsiyasi - SQL fayllari uchun
const uploadSql = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Faqat .sql fayllarni qabul qilish
        if (file.originalname.endsWith('.sql') || 
            file.mimetype === 'text/plain' ||
            file.mimetype === 'application/sql') {
            cb(null, true);
        } else {
            cb(new Error('Faqat SQL fayllarni (.sql) yuklash mumkin'), false);
        }
    }
});

// Bu butun router uchun middleware vazifasini o'taydi.
// Faqat 'roles:manage' huquqi borlar bu endpointlarga kira oladi.
router.use(isAuthenticated, hasPermission('roles:manage'));

// GET /api/admin/backup-db - Ma'lumotlar bazasini yuklab olish (PostgreSQL - JSON format)
router.get('/backup-db', async (req, res) => {
    try {
        // PostgreSQL JSON formatda backup
        // Barcha jadvallardan ma'lumot olish
            const tables = {
                users: await db('users').select('*'),
                roles: await db('roles').select('*'),
                permissions: await db('permissions').select('*').catch(() => []),
                role_permissions: await db('role_permissions').select('*'),
                user_permissions: await db('user_permissions').select('*').catch(() => []),
                user_locations: await db('user_locations').select('*'),
                user_brands: await db('user_brands').select('*').catch(() => []),
                role_locations: await db('role_locations').select('*'),
                role_brands: await db('role_brands').select('*').catch(() => []),
                reports: await db('reports').select('*'),
                report_history: await db('report_history').select('*').catch(() => []),
                settings: await db('settings').select('*'),
                brands: await db('brands').select('*'),
                brand_locations: await db('brand_locations').select('*').catch(() => []),
                pending_registrations: await db('pending_registrations').select('*'),
                audit_logs: await db('audit_logs').select('*'),
                password_change_requests: await db('password_change_requests').select('*').catch(() => []),
                pivot_templates: await db('pivot_templates').select('*'),
                magic_links: await db('magic_links').select('*').catch(() => []),
                exchange_rates: await db('exchange_rates').select('*').catch(() => []),
                comparisons: await db('comparisons').select('*').catch(() => []),
                notifications: await db('notifications').select('*').catch(() => []),
                branches: await db('branches').select('*').catch(() => []),
                products: await db('products').select('*').catch(() => []),
                stocks: await db('stocks').select('*').catch(() => []),
                sales: await db('sales').select('*').catch(() => []),
                ostatki_analysis: await db('ostatki_analysis').select('*').catch(() => []),
                ostatki_imports: await db('ostatki_imports').select('*').catch(() => []),
                blocked_filials: await db('blocked_filials').select('*').catch(() => []),
                imports_log: await db('imports_log').select('*').catch(() => [])
            };
            
            const counts = {};
            Object.keys(tables).forEach(tableName => {
                counts[tableName] = Array.isArray(tables[tableName]) ? tables[tableName].length : 0;
            });
            
            const fullExport = {
                export_info: {
                    version: '2.0',
                    exported_at: new Date().toISOString(),
                    exported_by: req.user?.username || 'admin',
                    description: 'PostgreSQL ma\'lumotlar bazasi backup (nusxa)',
                    database_type: 'postgresql',
                    total_tables: Object.keys(tables).length,
                    total_records: Object.values(counts).reduce((sum, count) => sum + count, 0)
                },
                data: tables,
                counts: counts
            };
            
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
            const fileName = `postgresql_backup_${dateStr}_${timeStr}.json`;

            res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.json(fullExport);

    } catch (error) {
        log.error("Baza nusxasini yuklashda kutilmagan xatolik:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Serverda ichki xatolik: " + error.message });
        }
    }
});

// POST /api/admin/restore-db - DEPRECATED: Endi faqat JSON import qo'llab-quvvatlanadi
// Eski SQLite restore funksiyasi olib tashlandi - faqat PostgreSQL bilan ishlaydi
// JSON import uchun /api/admin/import-full-db endpoint'ini ishlating
router.post('/restore-db', async (req, res) => {
    res.status(400).json({ 
        message: 'Bu endpoint endi qo\'llab-quvvatlanmaydi. Iltimos, JSON import uchun "To\'liq Ma\'lumotlar Bazasi Import" funksiyasini ishlating.' 
    });
});

// POST /api/admin/import-sqlite-db - SQLite .db faylini yuklash va PostgreSQL ga konvertatsiya qilish
// Bu endpoint eski SQLite fayllarni import qilish uchun saqlanadi (foydali bo'lishi mumkin)
router.post('/import-sqlite-db', uploadDb.single('database'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Database fayl yuklanmagan. Iltimos, .db faylini tanlang.' });
        }

        const tempDir = path.join(__dirname, '..', 'temp');
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const tempFileName = `import_${dateStr}_${timeStr}_${req.file.originalname}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        
        // Temp papkasini yaratish (agar mavjud bo'lmasa)
        try {
            await fs.access(tempDir);
        } catch {
            await fs.mkdir(tempDir, { recursive: true });
        }

        // Yuklangan faylni temp papkaga yozish
        await fs.writeFile(tempFilePath, req.file.buffer);
        log.info(`SQLite fayl yuklandi: ${tempFilePath}`);

        try {
        // SQLite dan PostgreSQL ga konvertatsiya qilish
            log.info('SQLite dan PostgreSQL ga konvertatsiya boshlandi...');
            const result = await convertSqliteToPostgres(tempFilePath, db);
        
        // Muvaffaqiyatli bo'lsa, SQLite faylini o'chirish
        try {
                await fs.unlink(tempFilePath);
                log.info(`Temp SQLite fayl o'chirildi: ${tempFilePath}`);
            } catch (unlinkError) {
                log.warn(`Temp faylni o'chirishda xatolik (ehtimol allaqachon o'chirilgan): ${unlinkError.message}`);
        }

            res.json({
                message: 'SQLite database muvaffaqiyatli PostgreSQL ga konvertatsiya qilindi!',
                file_name: req.file.originalname,
                file_size_mb: (req.file.size / (1024 * 1024)).toFixed(2),
                counts: result.counts,
                skipped: result.skipped,
                errors: result.errors,
                total_imported: result.total_imported,
                total_skipped: result.total_skipped,
                total_errors: result.total_errors
            });

        } catch (convertError) {
        // Xatolik bo'lsa, temp faylni o'chirish
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                log.warn(`Xatolikdan keyin temp faylni o'chirishda muammo: ${unlinkError.message}`);
            }
            
            log.error('SQLite konvertatsiya xatoligi:', convertError);
            res.status(500).json({ 
                message: 'SQLite dan PostgreSQL ga konvertatsiya qilishda xatolik: ' + convertError.message 
            });
        }

    } catch (error) {
        log.error("SQLite import xatoligi:", error);
        res.status(500).json({ message: "SQLite import qilishda xatolik: " + error.message });
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
            imports_log: await db('imports_log').select('*').catch(() => []),
            
        // Qarz tasdiqlash tizimi
            debt_brands: await db('debt_brands').select('*').catch(() => []),
            debt_branches: await db('debt_branches').select('*').catch(() => []),
            debt_svrs: await db('debt_svrs').select('*').catch(() => [])
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

// GET /api/admin/export-postgres-json - PostgreSQL ma'lumotlarini JSON formatda export qilish
router.get('/export-postgres-json', async (req, res) => {
    try {
        if (!isPostgres) {
            return res.status(400).json({ 
                message: 'Bu endpoint faqat PostgreSQL bazasi bilan ishlaydi.' 
            });
        }

        // Barcha jadvallardan ma'lumot olish (export-full-db bilan bir xil)
        const tables = {
            users: await db('users').select('*'),
            roles: await db('roles').select('*'),
            permissions: await db('permissions').select('*').catch(() => []),
            role_permissions: await db('role_permissions').select('*'),
            user_permissions: await db('user_permissions').select('*').catch(() => []),
            user_locations: await db('user_locations').select('*'),
            user_brands: await db('user_brands').select('*').catch(() => []),
            role_locations: await db('role_locations').select('*'),
            role_brands: await db('role_brands').select('*').catch(() => []),
            reports: await db('reports').select('*'),
            report_history: await db('report_history').select('*').catch(() => []),
            settings: await db('settings').select('*'),
            brands: await db('brands').select('*'),
            brand_locations: await db('brand_locations').select('*').catch(() => []),
            pending_registrations: await db('pending_registrations').select('*'),
            audit_logs: await db('audit_logs').select('*'),
            password_change_requests: await db('password_change_requests').select('*').catch(() => []),
            pivot_templates: await db('pivot_templates').select('*'),
            magic_links: await db('magic_links').select('*').catch(() => []),
            exchange_rates: await db('exchange_rates').select('*').catch(() => []),
            comparisons: await db('comparisons').select('*').catch(() => []),
            notifications: await db('notifications').select('*').catch(() => []),
            branches: await db('branches').select('*').catch(() => []),
            products: await db('products').select('*').catch(() => []),
            stocks: await db('stocks').select('*').catch(() => []),
            sales: await db('sales').select('*').catch(() => []),
            ostatki_analysis: await db('ostatki_analysis').select('*').catch(() => []),
            ostatki_imports: await db('ostatki_imports').select('*').catch(() => []),
            blocked_filials: await db('blocked_filials').select('*').catch(() => []),
            imports_log: await db('imports_log').select('*').catch(() => [])
        };
        
        const counts = {};
        Object.keys(tables).forEach(tableName => {
            counts[tableName] = Array.isArray(tables[tableName]) ? tables[tableName].length : 0;
        });
        
        const fullExport = {
            export_info: {
                version: '2.0',
                exported_at: new Date().toISOString(),
                exported_by: req.user?.username || 'admin',
                description: 'PostgreSQL ma\'lumotlar bazasi eksporti - JSON format',
                database_type: 'postgresql',
                total_tables: Object.keys(tables).length,
                total_records: Object.values(counts).reduce((sum, count) => sum + count, 0)
            },
            data: tables,
            counts: counts
        };
        
        const fileName = `postgresql_export_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.json(fullExport);
        
    } catch (error) {
        log.error('❌ PostgreSQL JSON export xatolik:', error);
        res.status(500).json({ message: 'Export qilishda xatolik: ' + error.message });
    }
});

// GET /api/admin/export-postgres-sql - PostgreSQL ma'lumotlarini SQL dump formatda export qilish
router.get('/export-postgres-sql', async (req, res) => {
    try {
        if (!isPostgres) {
            return res.status(400).json({ 
                message: 'Bu endpoint faqat PostgreSQL bazasi bilan ishlaydi.' 
            });
        }

        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const config = require('../knexfile.js');
        const env = process.env.NODE_ENV || 'development';
        const dbConfig = config[env] || config.development;
        
        // Connection string yoki parametrlarni tayyorlash
        let connectionString;
        if (typeof dbConfig.connection === 'string') {
            connectionString = dbConfig.connection;
        } else {
            const conn = dbConfig.connection;
            const password = encodeURIComponent(conn.password || '');
            connectionString = `postgresql://${conn.user}:${password}@${conn.host}:${conn.port}/${conn.database}`;
        }

        // pg_dump ni ishga tushirish
        try {
            const { stdout, stderr } = await execAsync(`pg_dump "${connectionString}" --data-only --inserts`);
            
            if (stderr && !stderr.includes('NOTICE')) {
                throw new Error(stderr);
            }

            const fileName = `postgresql_dump_${new Date().toISOString().split('T')[0]}.sql`;
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(stdout);
            
        } catch (execError) {
        // pg_dump mavjud emas yoki xatolik - SQL INSERT statements generatsiya qilish
            log.warn('pg_dump ishlatib bo\'lmadi, INSERT statements generatsiya qilinmoqda:', execError.message);
            
            const tables = [
                'users', 'roles', 'permissions', 'role_permissions', 'user_permissions',
                'user_locations', 'user_brands', 'role_locations', 'role_brands',
                'reports', 'report_history', 'settings', 'brands', 'brand_locations',
                'pending_registrations', 'audit_logs', 'password_change_requests',
                'pivot_templates', 'magic_links', 'exchange_rates', 'comparisons',
                'notifications', 'branches', 'products', 'stocks', 'sales',
                'ostatki_analysis', 'ostatki_imports', 'blocked_filials', 'imports_log'
            ];
            
            let sqlDump = `-- PostgreSQL Database Dump\n-- Generated: ${new Date().toISOString()}\n\n`;
            
            for (const tableName of tables) {
                try {
                    const records = await db(tableName).select('*');
                    if (records.length > 0) {
                        sqlDump += `-- Table: ${tableName}\n`;
                        for (const record of records) {
                            const columns = Object.keys(record).join(', ');
                            const values = Object.values(record).map(val => {
                                if (val === null) return 'NULL';
                                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                                if (val instanceof Date) return `'${val.toISOString()}'`;
                                return val;
                            }).join(', ');
                            sqlDump += `INSERT INTO ${tableName} (${columns}) VALUES (${values});\n`;
                        }
                        sqlDump += '\n';
                    }
                } catch (tableError) {
                    log.warn(`Jadval ${tableName} export qilinmadi:`, tableError.message);
                }
            }
            
            const fileName = `postgresql_dump_${new Date().toISOString().split('T')[0]}.sql`;
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(sqlDump);
        }
        
    } catch (error) {
        log.error('❌ PostgreSQL SQL export xatolik:', error);
        res.status(500).json({ message: 'Export qilishda xatolik: ' + error.message });
    }
});

// POST /api/admin/import-full-db - To'liq ma'lumotlar bazasini JSON dan import qilish
router.post('/import-full-db', async (req, res) => {
    try {
        // Import boshlandi logi olib tashlandi (deploy uchun)
        
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
            
            // Import oldidan rollarni tekshirish va saqlash (keyinroq solishtirish uchun)
            let existingRoleNames = [];
            if (data.roles && Array.isArray(data.roles)) {
            const existingRoles = await db('roles').select('role_name');
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
        // ENDI trx PARAMETRI QABUL QILADI (har bir jadval uchun alohida transaksiya)
        const importTable = async (tableName, tableData, options = {}, trx) => {
                if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
                    importCounts[tableName] = 0;
                    skippedCounts[tableName] = 0;
                    return;
                }
                
                let imported = 0;
                let skipped = 0;
                let errors = 0;
                
                try {
                    for (let i = 0; i < tableData.length; i++) {
                        const record = tableData[i];
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
                                        // Foreign key xatoliklari - log olib tashlandi (ortiqcha log)
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
                                    // brands jadvali uchun ID ni saqlash kerak (ID bilan insert qilish uchun)
                                    if (options.upsert.key === 'id' && tableName !== 'users' && tableName !== 'brands') {
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
                            // Constraint xatoliklarini skip qilish (SQLite va PostgreSQL)
                            const isUniqueConstraint = err.code === 'SQLITE_CONSTRAINT' && err.message && err.message.includes('UNIQUE constraint failed') ||
                                                       err.code === '23505' || // PostgreSQL unique_violation
                                                       (err.message && err.message.includes('duplicate key')) ||
                                                       (err.message && err.message.includes('unique constraint'));
                            
                            // PostgreSQL transaction abort xatoligini tekshirish
                            const isTransactionAborted = err.code === '25P02' || 
                                                        (err.message && err.message.includes('current transaction is aborted'));
                            
                            if (isUniqueConstraint) {
                                // UNIQUE constraint xatoliklari - log olib tashlandi (ortiqcha log)
                                skipped++;
                            } else if (isTransactionAborted) {
                                // Transaksiya abort qilingan - bu yozuvni skip qilish va xatolikni qayd etish
                                // Transaksiya abort qilingan, keyingi yozuvlarni import qilish mumkin emas
                                log.error(`  ❌ [IMPORT] ${tableName} yozuv #${i + 1} import xatolik (transaksiya abort):`, {
                                    error: err.message,
                                    code: err.code,
                                    recordIndex: i + 1,
                                    recordId: record.id || 'N/A',
                                    tableName: tableName,
                                    previousRecordIndex: i > 0 ? i : null
                                });
                                console.error(`❌ [IMPORT] ${tableName} #${i + 1} (transaksiya abort): ${err.message.substring(0, 200)}`);
                                errors++;
                                // Transaksiya abort qilingan, keyingi yozuvlarga o'tish mumkin emas
                                break;
                            } else if (isConstraintError(err)) {
                                // Boshqa constraint xatoliklar (foreign key, not null, va boshqalar) - log olib tashlandi (ortiqcha log)
                                skipped++;
                            } else {
                                // Noto'g'ri ma'lumotlar yoki boshqa xatoliklar - bularni log qilish kerak
                                log.error(`  ❌ [IMPORT] ${tableName} yozuv #${i + 1} import xatolik:`, {
                                    error: err.message,
                                    code: err.code,
                                    recordIndex: i + 1,
                                    recordId: record.id || 'N/A',
                                    tableName: tableName,
                                    recordPreview: JSON.stringify(record).substring(0, 200)
                                });
                                console.error(`❌ [IMPORT] ${tableName} #${i + 1} (ID: ${record.id || 'N/A'}): ${err.message.substring(0, 200)}`);
                                errors++;
                            }
                        }
                    }
                    
                    importCounts[tableName] = imported;
                    skippedCounts[tableName] = skipped;
                    errorCounts[tableName] = errors;
                    
                } catch (err) {
                    log.error(`  ❌ [IMPORT] ${tableName} jadvali import qilishda katta xatolik:`, {
                        error: err.message,
                        code: err.code,
                        stack: err.stack,
                        tableName: tableName,
                        recordCount: tableData.length
                    });
                    console.error(`❌ [IMPORT ERROR] ${tableName}:`, {
                        error: err.message,
                        code: err.code,
                        tableName: tableName
                    });
                    importCounts[tableName] = 0;
                    skippedCounts[tableName] = 0;
                    errorCounts[tableName] = tableData.length;
                    throw err; // Xatolikni yuqoriga yuborish
                }
            };
            
        // Helper funksiya - bitta yozuvni import qilish (alohida transaction ichida)
        const importSingleRecord = async (tableName, record, options, trx, superAdminIds) => {
            // Super admin himoyasi - users jadvali uchun
            if (tableName === 'users' && record.role === 'super_admin') {
                skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                return;
            }
            
            // Super admin ID'larni o'tkazib yuborish
            if (tableName === 'users' && superAdminIds.includes(record.id)) {
                skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                return;
            }
            
            // Mavjud ma'lumotlarni tekshirish va skip qilish
            if (options.checkDuplicate) {
                const existing = await trx(tableName)
                    .where(options.checkDuplicate.where, record[options.checkDuplicate.key])
                    .first();
                
                if (existing) {
                    const isIdentical = JSON.stringify(existing) === JSON.stringify(record);
                    if (isIdentical) {
                        skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                        return;
                    }
                }
            }
            
            // Foreign key tekshiruvi
            if (options.foreignKeys) {
                for (const fk of options.foreignKeys) {
                    const fkValue = record[fk.reference];
                    if (fkValue === null || fkValue === undefined) continue;
                    
                    const relatedRecord = await trx(fk.table)
                        .where(fk.column, fkValue)
                        .first();
                    
                    if (!relatedRecord) {
                        skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                        return;
                    }
                }
            }
            
            // Insert yoki update
            if (options.upsert) {
                let existing = null;
                
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
                    existing = await trx(tableName)
                        .where(options.upsert.where, record[options.upsert.key])
                        .first();
                }
                
                if (existing) {
                    if (tableName === 'users' && existing.role === 'super_admin') {
                        skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                        return;
                    }
                    
                    if (tableName === 'users' && record.telegram_chat_id) {
                        const existingByTelegram = await trx(tableName)
                            .where('telegram_chat_id', record.telegram_chat_id)
                            .where('id', '!=', existing.id)
                            .first();
                        if (existingByTelegram) {
                            skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                            return;
                        }
                    }
                    
                    const recordToUpdate = { ...record };
                    if (options.upsert.key === 'id' && tableName !== 'users') {
                        delete recordToUpdate.id;
                    }
                    
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
                    
                    await trx(tableName).where(updateWhere).update(recordToUpdate);
                    importCounts[tableName] = (importCounts[tableName] || 0) + 1;
                } else {
                    const recordToInsert = { ...record };
                    if (options.upsert.key === 'id' && tableName !== 'users' && tableName !== 'brands') {
                        delete recordToInsert.id;
                    }
                    
                    if (tableName === 'users' && recordToInsert.telegram_chat_id) {
                        const existingByTelegram = await trx(tableName)
                            .where('telegram_chat_id', recordToInsert.telegram_chat_id)
                            .first();
                        if (existingByTelegram) {
                            skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                            return;
                        }
                    }
                    
                    await trx(tableName).insert(recordToInsert);
                    importCounts[tableName] = (importCounts[tableName] || 0) + 1;
                }
            } else {
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
                            await trx(tableName).where(whereClause).update(record);
                            importCounts[tableName] = (importCounts[tableName] || 0) + 1;
                            return;
                        }
                    }
                }
                
                if (record.id) {
                    const existing = await trx(tableName).where('id', record.id).first();
                    if (existing) {
                        await trx(tableName).where('id', record.id).update(record);
                        importCounts[tableName] = (importCounts[tableName] || 0) + 1;
                        return;
                    }
                    await trx(tableName).insert(record);
                    importCounts[tableName] = (importCounts[tableName] || 0) + 1;
                } else {
                    await trx(tableName).insert(record);
                    importCounts[tableName] = (importCounts[tableName] || 0) + 1;
                }
            }
        };
        
        // Helper funksiya - importTable chaqiruvini xavfsiz qilish (xatolik bo'lsa, keyingi jadvallarga o'tish)
        // ENDI HAR BIR YOZUV UCHUN ALOHIDA TRANSAKSIYA OCHADI (transaction abort muammosini hal qilish uchun)
        const safeImportTable = async (tableName, tableData, options = {}, superAdminIds = []) => {
            if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
                importCounts[tableName] = 0;
                skippedCounts[tableName] = 0;
                errorCounts[tableName] = 0;
                return;
            }
            
            const tableCount = tableData.length;
            
            // Har bir yozuvni alohida transaction ichida ishlatish (transaction abort muammosini hal qilish uchun)
            for (let i = 0; i < tableData.length; i++) {
                const record = tableData[i];
                await db.transaction(async (trx) => {
                    try {
                        await importSingleRecord(tableName, record, options, trx, superAdminIds);
                    } catch (err) {
                        // Constraint xatoliklarini skip qilish
                        const isUniqueConstraint = err.code === '23505' || 
                                                   (err.message && err.message.includes('duplicate key')) ||
                                                   (err.message && err.message.includes('unique constraint'));
                        
                        if (isUniqueConstraint) {
                            skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                        } else if (isConstraintError(err)) {
                            skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
                        } else {
                            // Boshqa xatoliklar
                            errorCounts[tableName] = (errorCounts[tableName] || 0) + 1;
                            log.error(`  ❌ [IMPORT] ${tableName} yozuv #${i + 1} import xatolik:`, {
                                error: err.message,
                                code: err.code,
                                recordIndex: i + 1,
                                recordId: record.id || 'N/A',
                                tableName: tableName,
                                recordPreview: JSON.stringify(record).substring(0, 200)
                            });
                            console.error(`❌ [IMPORT] ${tableName} #${i + 1} (ID: ${record.id || 'N/A'}): ${err.message.substring(0, 200)}`);
                            throw err;
                        }
                    }
                }).catch(err => {
                    // Har bir yozuv alohida transaction ichida, shuning uchun xatolik boshqa yozuvlarga ta'sir qilmaydi
                });
            }
            
            const imported = importCounts[tableName] || 0;
            const skipped = skippedCounts[tableName] || 0;
            const errors = errorCounts[tableName] || 0;
            
            // Faqat xatolik bo'lsa log qilish (deploy uchun)
            if (errors > 0) {
                log.error(`❌ [IMPORT] ${tableName}: ${errors} xatolik (${imported} qo'shildi, ${skipped} o'tkazib yuborildi)`);
                }
            };
            
            // Asosiy jadvallar
        await safeImportTable('users', data.users, {
                upsert: { where: 'id', key: 'id' },
                checkDuplicate: { where: 'username', key: 'username' }
                // telegram_chat_id unique constraint kod ichida tekshiriladi
            });
            
        await safeImportTable('roles', data.roles, {
                upsert: { where: 'role_name', key: 'role_name' }
            });
            
        await safeImportTable('permissions', data.permissions, {
                upsert: { where: 'permission_key', key: 'permission_key' }
            });
            
        await safeImportTable('role_permissions', data.role_permissions, {
                compositeUnique: ['role_name', 'permission_key'],
                foreignKeys: [
                    { table: 'roles', column: 'role_name', reference: 'role_name' },
                    { table: 'permissions', column: 'permission_key', reference: 'permission_key' }
                ]
            });
            
        await safeImportTable('user_permissions', data.user_permissions, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' },
                    { table: 'permissions', column: 'permission_key', reference: 'permission_key' }
                ]
            });
            
            // Sozlamalar (bog'liq emas, avval import qilish)
        await safeImportTable('settings', data.settings, {
                upsert: { where: 'key', key: 'key' }
            });
            
            // Brendlar (boshqa jadvallar uchun asos bo'ladi)
        await safeImportTable('brands', data.brands, {
                upsert: { where: 'id', key: 'id' }
            });
            
            // Foydalanuvchi bog'lanishlar
        await safeImportTable('user_locations', data.user_locations, {
                compositeUnique: ['user_id', 'location_name'],
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
        await safeImportTable('user_brands', data.user_brands, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' },
                    { table: 'brands', column: 'id', reference: 'brand_id' }
                ]
            });
            
            // Rol bog'lanishlari (QO'SHILDI)
        await safeImportTable('role_locations', data.role_locations, {
                compositeUnique: ['role_name', 'location_name'],
                foreignKeys: [
                    { table: 'roles', column: 'role_name', reference: 'role_name' }
                ]
            });
            
        await safeImportTable('role_brands', data.role_brands, {
                foreignKeys: [
                    { table: 'roles', column: 'role_name', reference: 'role_name' },
                    { table: 'brands', column: 'id', reference: 'brand_id' }
                ]
            });
            
        await safeImportTable('brand_locations', data.brand_locations, {
                compositeUnique: ['brand_id', 'location_name'],
                foreignKeys: [
                    { table: 'brands', column: 'id', reference: 'brand_id' }
                ]
            });
            
            // Hisobotlar
        await safeImportTable('reports', data.reports, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'created_by' }
                ]
            });
            
        await safeImportTable('report_history', data.report_history, {
                foreignKeys: [
                    { table: 'reports', column: 'id', reference: 'report_id' },
                    { table: 'users', column: 'id', reference: 'changed_by' }
                ]
            });
            
        // Ro'yxatdan o'tish (expires_at ni datetime formatiga konvertatsiya qilish)
            const pendingRegistrationsProcessed = data.pending_registrations ? data.pending_registrations.map(reg => {
                if (reg.expires_at) {
                    // Agar expires_at Unix timestamp (millisekundlarda) bo'lsa, datetime formatiga konvertatsiya qilish
                    const expiresAtValue = reg.expires_at;
                    if (typeof expiresAtValue === 'number' || (typeof expiresAtValue === 'string' && /^\d+$/.test(expiresAtValue))) {
                        const timestamp = typeof expiresAtValue === 'string' ? parseInt(expiresAtValue, 10) : expiresAtValue;
                        // Millisekundlarda bo'lsa, sekundga o'zgartirish
                        const seconds = timestamp > 1000000000000 ? Math.floor(timestamp / 1000) : timestamp;
                        // ISO datetime formatiga konvertatsiya qilish
                        reg.expires_at = new Date(seconds * 1000).toISOString();
                    }
                }
                return reg;
            }) : data.pending_registrations;
        await safeImportTable('pending_registrations', pendingRegistrationsProcessed);
            
        // Audit va xavfsizlik (target_id ni tozalash - string bo'lsa NULL qilish)
        const auditLogsProcessed = data.audit_logs ? data.audit_logs.map(log => {
            const cleanedLog = { ...log };
            // target_id string bo'lsa (SQLite dan kelgan noto'g'ri ma'lumot), NULL qilish
            if (cleanedLog.target_id && typeof cleanedLog.target_id === 'string' && isNaN(cleanedLog.target_id)) {
                cleanedLog.target_id = null;
            }
            return cleanedLog;
        }) : data.audit_logs;
        await safeImportTable('audit_logs', auditLogsProcessed, {
                upsert: { where: 'id', key: 'id' },
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
        await safeImportTable('password_change_requests', data.password_change_requests, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            // Pivot va shablonlar
        await safeImportTable('pivot_templates', data.pivot_templates, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'created_by' }
                ]
            });
            
            // Magic links
        await safeImportTable('magic_links', data.magic_links, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            // Valyuta kurslari
        await safeImportTable('exchange_rates', data.exchange_rates, {
                compositeUnique: ['base_currency', 'target_currency', 'date'],
                upsert: { where: 'id', key: 'id' }
            });
            
            // Solishtirish
        await safeImportTable('comparisons', data.comparisons);
            
            // Bildirishnomalar
        await safeImportTable('notifications', data.notifications, {
                foreignKeys: [
                    { table: 'users', column: 'id', reference: 'user_id' }
                ]
            });
            
            // Filiallar va mahsulotlar
        await safeImportTable('branches', data.branches, {
                upsert: { where: 'id', key: 'id' }
            });
            
        await safeImportTable('products', data.products, {
                upsert: { where: 'id', key: 'id' }
            });
            
        await safeImportTable('stocks', data.stocks, {
                foreignKeys: [
                    { table: 'branches', column: 'id', reference: 'branch_id' },
                    { table: 'products', column: 'id', reference: 'product_id' }
                ]
            });
            
        await safeImportTable('sales', data.sales, {
                foreignKeys: [
                    { table: 'branches', column: 'id', reference: 'branch_id' },
                    { table: 'products', column: 'id', reference: 'product_id' }
                ]
            });
            
            // Ostatki tahlil
        await safeImportTable('ostatki_analysis', data.ostatki_analysis);
        await safeImportTable('ostatki_imports', data.ostatki_imports);
            
            // Bloklangan filiallar
        await safeImportTable('blocked_filials', data.blocked_filials);
            
            // Import loglari
        await safeImportTable('imports_log', data.imports_log);
            
            
            // Import keyin rollarni tekshirish
            if (data.roles && Array.isArray(data.roles)) {
            const finalRoles = await db('roles').select('role_name');
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
        
        // Import yakunlandi
        const totalImported = Object.values(importCounts).reduce((sum, count) => sum + count, 0);
        const totalSkipped = Object.values(skippedCounts).reduce((sum, count) => sum + count, 0);
        const totalErrors = Object.values(errorCounts).reduce((sum, count) => sum + count, 0);
        const tablesImported = Object.keys(importCounts).filter(key => importCounts[key] > 0).length;
        
        // Import yakunlandi logi olib tashlandi (deploy uchun)
        // Faqat xatolik bo'lsa log qilish (yuqorida har bir jadval uchun log qilinadi)
        
        // PostgreSQL sequence'larini to'g'rilash (SQLite dan import qilingandan keyin)
        if (isPostgres && totalImported > 0) {
            try {
                const tablesWithSequences = [
                    'users', 'reports', 'brands', 'audit_logs', 'pivot_templates',
                    'exchange_rates', 'report_history', 'pending_registrations',
                    'user_permissions', 'role_permissions', 'user_locations',
                    'user_brands', 'role_locations', 'role_brands', 'brand_locations'
                ];
                
                for (const tableName of tablesWithSequences) {
                    try {
                        // Jadval mavjudligini tekshirish
                        const hasTable = await db.schema.hasTable(tableName);
                        if (!hasTable) continue;
                        
                        // Max ID ni olish
                        const result = await db(tableName).max('id as max_id').first();
                        const maxId = result?.max_id || 0;
                        
                        if (maxId > 0) {
                            // Sequence nomi: {table_name}_id_seq
                            const sequenceName = `${tableName}_id_seq`;
                            
                            // Sequence'ni yangilash (keyingi ID maxId + 1 bo'ladi)
                            await db.raw(`SELECT setval('${sequenceName}', ${maxId}, true)`);
                        }
                    } catch (seqError) {
                        // Sequence topilmagan yoki boshqa xatolik - o'tkazib yuborish (log olib tashlandi)
                    }
                }
            } catch (seqError) {
                // Sequence to'g'rilashda umumiy xatolik - muhim emas (log olib tashlandi)
            }
        }
        
        res.json({ 
            message: 'Ma\'lumotlar bazasi muvaffaqiyatli import qilindi!',
            counts: importCounts,
            skipped: skippedCounts,
            errors: errorCounts,
            total_imported: totalImported,
            total_skipped: totalSkipped,
            total_errors: totalErrors,
            tables_imported: tablesImported
        });
        
    } catch (error) {
        log.error('❌ [IMPORT] Import qilishda katta xatolik:', {
            error: error.message,
            code: error.code,
            stack: error.stack
        });
        console.error('❌ [IMPORT ERROR]:', {
            error: error.message,
            code: error.code
        });
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

// POST /api/admin/import-postgres-json - PostgreSQL JSON formatdagi ma'lumotlarni import qilish
router.post('/import-postgres-json', async (req, res) => {
    try {
        if (!isPostgres) {
            return res.status(400).json({ 
                message: 'Bu endpoint faqat PostgreSQL bazasi bilan ishlaydi.' 
            });
        }

        // import-full-db bilan bir xil logika (u allaqachon PostgreSQL bilan ishlaydi)
        // Bu endpoint faqat PostgreSQL tekshiruvini qo'shadi
        const importData = req.body;
        
        if (!importData || !importData.data) {
            return res.status(400).json({ message: 'Noto\'g\'ri import fayl formati' });
        }

        // import-full-db logikasini chaqirish (qayta kodlash o'rniga redirect)
        // Lekin bu endpoint alohida, shuning uchun logika bu yerda
        // import-full-db endpoint'ini to'g'ridan-to'g'ri ishlatish mumkin
        // Bu endpoint faqat PostgreSQL tekshiruvini qo'shadi va javobni formatlaydi
        
        res.status(400).json({ 
            message: 'Iltimos, /api/admin/import-full-db endpoint\'ini ishlating. U PostgreSQL bilan ham ishlaydi.' 
        });
        
    } catch (error) {
        log.error('❌ PostgreSQL JSON import xatolik:', error);
        res.status(500).json({ message: 'Import qilishda xatolik: ' + error.message });
    }
});

// POST /api/admin/import-postgres-sql - PostgreSQL SQL dump faylini import qilish
router.post('/import-postgres-sql', uploadSql.single('sqlfile'), async (req, res) => {
    try {
        if (!isPostgres) {
            return res.status(400).json({ 
                message: 'Bu endpoint faqat PostgreSQL bazasi bilan ishlaydi.' 
            });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'SQL fayl yuklanmagan. Iltimos, .sql faylini tanlang.' });
        }

        const sqlContent = req.file.buffer.toString('utf-8');
        
        // SQL content'ni execute qilish
        // Ehtiyotkorlik: Faqat INSERT, UPDATE, DELETE statement'larni qabul qilish
        // DROP, TRUNCATE, ALTER kabi xavfli statement'larni cheklash
        
        const dangerousKeywords = ['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'DELETE FROM'];
        const upperSql = sqlContent.toUpperCase();
        
        for (const keyword of dangerousKeywords) {
            if (upperSql.includes(keyword)) {
                // Faqat DELETE FROM va CREATE TABLE (migrations uchun) ruxsat beriladi
                if (keyword === 'DELETE FROM' || keyword === 'CREATE') {
                    continue;
                }
                // DROP va TRUNCATE ruxsat berilmaydi
                if (keyword === 'DROP' || keyword === 'TRUNCATE') {
                    return res.status(400).json({ 
                        message: `Xavfsizlik: ${keyword} statement'lari ruxsat berilmaydi.` 
                    });
                }
            }
        }

        // SQL statement'larni ajratish va execute qilish
        const statements = sqlContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        let executedCount = 0;
        let errorCount = 0;
        const errors = [];

        await db.transaction(async (trx) => {
            for (const statement of statements) {
                try {
                    // INSERT statement'larni execute qilish
                    if (statement.toUpperCase().startsWith('INSERT')) {
                        await trx.raw(statement);
                        executedCount++;
                    } else {
                        // Boshqa statement'lar uchun ehtiyotkorlik
                        log.warn('SQL statement o\'tkazib yuborildi:', statement.substring(0, 50));
                    }
                } catch (stmtError) {
                    errorCount++;
                    errors.push({
                        statement: statement.substring(0, 100),
                        error: stmtError.message
                    });
                    log.error('SQL statement xatoligi:', stmtError.message);
                }
            }
        });

        res.json({
            message: 'SQL dump import muvaffaqiyatli yakunlandi!',
            file_name: req.file.originalname,
            file_size_mb: (req.file.size / (1024 * 1024)).toFixed(2),
            executed_statements: executedCount,
            errors: errorCount,
            error_details: errors
        });
        
    } catch (error) {
        log.error('❌ PostgreSQL SQL import xatolik:', error);
        res.status(500).json({ message: 'Import qilishda xatolik: ' + error.message });
    }
});

module.exports = router;
