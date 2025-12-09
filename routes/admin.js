const express = require('express');
const path = require('path');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');

const router = express.Router();

// Bu butun router uchun middleware vazifasini o'taydi.
// Faqat 'roles:manage' huquqi borlar bu endpointlarga kira oladi.
router.use(isAuthenticated, hasPermission('roles:manage'));

// GET /api/admin/backup-db - Ma'lumotlar bazasini yuklab olish
router.get('/backup-db', (req, res) => {
    try {
        const dbPath = path.join(__dirname, '..', 'database.db');
        const fileName = `database_backup_${new Date().toISOString().split('T')[0]}.db`;

        res.download(dbPath, fileName, (err) => {
            if (err) {
                console.error("Baza nusxasini yuklashda xatolik:", err);
                if (!res.headersSent) {
                    res.status(500).json({ message: "Ma'lumotlar bazasi faylini o'qib bo'lmadi." });
                }
            }
        });

    } catch (error) {
        console.error("Baza nusxasini yuklashda kutilmagan xatolik:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Serverda ichki xatolik." });
        }
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
        console.error("Sessiyalarni tozalashda xatolik:", error);
        res.status(500).json({ message: "Sessiyalarni tozalashda server xatoligi." });
    }
});

// GET /api/admin/export-full-db - To'liq ma'lumotlar bazasini JSON formatda export qilish
router.get('/export-full-db', async (req, res) => {
    try {
        console.log('📥 To\'liq database export boshlandi...');
        
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
        
        console.log(`✅ Export tayyor: ${Object.keys(tables).length} jadval, ${fullExport.export_info.total_records} yozuv`);
        console.log(`📊 Jadval statistikasi:`, counts);
        
        // JSON fayl sifatida yuborish
        const fileName = `full_database_export_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.json(fullExport);
        
    } catch (error) {
        console.error('❌ To\'liq export xatolik:', error);
        res.status(500).json({ message: 'Export qilishda xatolik: ' + error.message });
    }
});

// POST /api/admin/import-full-db - To'liq ma'lumotlar bazasini JSON dan import qilish
router.post('/import-full-db', async (req, res) => {
    try {
        console.log('📤 To\'liq database import boshlandi...');
        
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
        
        console.log(`🛡️ Super admin'lar himoya qilinmoqda: ${superAdminIds.length} ta`);
        
        // Transaction ichida import qilish (xatolik bo'lsa rollback)
        const importCounts = {};
        const skippedCounts = {};
        const errorCounts = {};
        
        await db.transaction(async (trx) => {
            // 1. Ma'lumotlarni import qilish (tozalash emas, faqat yangi ma'lumotlarni qo'shish)
            console.log('📥 Yangi ma\'lumotlarni yuklash...');
            
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
                                console.log(`  ⚠ Super admin o'tkazib yuborildi: ${record.username || record.id}`);
                                skipped++;
                                continue;
                            }
                            
                            // Super admin ID'larni o'tkazib yuborish
                            if (tableName === 'users' && superAdminIds.includes(record.id)) {
                                console.log(`  ⚠ Super admin ID o'tkazib yuborildi: ${record.id}`);
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
                                        console.log(`  ⚠ Foreign key tekshiruvi: ${fk.table}.${fk.column} = ${record[fk.reference]} topilmadi`);
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
                                const existing = await trx(tableName)
                                    .where(options.upsert.where, record[options.upsert.key])
                                    .first();
                                
                                if (existing) {
                                    // Super admin'ni yangilamaslik
                                    if (tableName === 'users' && existing.role === 'super_admin') {
                                        skipped++;
                                        continue;
                                    }
                                    
                                    // ID'ni o'chirib, update qilish (avtomatik generatsiya uchun)
                                    const recordToUpdate = { ...record };
                                    if (options.upsert.key === 'id' && tableName !== 'users') {
                                        delete recordToUpdate.id;
                                    }
                                    
                                    await trx(tableName)
                                        .where(options.upsert.where, record[options.upsert.key])
                                        .update(recordToUpdate);
                                } else {
                                    // ID'ni o'chirib, insert qilish (avtomatik generatsiya uchun)
                                    const recordToInsert = { ...record };
                                    if (options.upsert.key === 'id' && tableName !== 'users') {
                                        delete recordToInsert.id;
                                    }
                                    await trx(tableName).insert(recordToInsert);
                                }
                                imported++;
                            } else {
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
                            console.error(`  ❌ ${tableName} yozuv import xatolik:`, err.message);
                            errors++;
                        }
                    }
                    
                    importCounts[tableName] = imported;
                    skippedCounts[tableName] = skipped;
                    errorCounts[tableName] = errors;
                    
                    console.log(`  ✓ ${tableName}: ${imported} import, ${skipped} o'tkazib yuborildi, ${errors} xatolik`);
                } catch (err) {
                    console.error(`  ❌ ${tableName} import xatolik:`, err.message);
                    importCounts[tableName] = 0;
                    skippedCounts[tableName] = 0;
                    errorCounts[tableName] = tableData.length;
                }
            };
            
            // Asosiy jadvallar
            await importTable('users', data.users, {
                upsert: { where: 'id', key: 'id' },
                checkDuplicate: { where: 'username', key: 'username' }
            });
            
            await importTable('roles', data.roles, {
                upsert: { where: 'role_name', key: 'role_name' }
            });
            
            await importTable('permissions', data.permissions, {
                upsert: { where: 'permission_key', key: 'permission_key' }
            });
            
            await importTable('role_permissions', data.role_permissions, {
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
            
            console.log('✅ Import muvaffaqiyatli yakunlandi!');
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
        console.error('❌ Import xatolik:', error);
        res.status(500).json({ message: 'Import qilishda xatolik: ' + error.message });
    }
});

module.exports = router;
