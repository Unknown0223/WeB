// utils/sqliteToPostgres.js
// SQLite faylini PostgreSQL ga konvertatsiya qilish

const knex = require('knex');
const path = require('path');
const fs = require('fs').promises;
const { createLogger } = require('./logger.js');

const log = createLogger('SQLITE2PG');

/**
 * SQLite faylini PostgreSQL ga konvertatsiya qilish
 * @param {string} sqliteFilePath - SQLite .db fayl yo'li
 * @param {object} postgresDb - PostgreSQL Knex connection obyekti
 * @returns {Promise<object>} Import natijalari (counts, errors, etc.)
 */
async function convertSqliteToPostgres(sqliteFilePath, postgresDb) {
    const tempSqliteDb = knex({
        client: 'sqlite3',
        connection: {
            filename: sqliteFilePath
        },
        useNullAsDefault: true
    });

    const importCounts = {};
    const skippedCounts = {};
    const errorCounts = {};

    try {
        // Barcha jadvallarni o'qish (admin.js dagi export funksiyasiga asoslangan)
        const tables = [
            // Asosiy jadvallar
            'users', 'roles', 'permissions', 'role_permissions', 'user_permissions',
            // Foydalanuvchi bog'lanishlar
            'user_locations', 'user_brands',
            // Rol bog'lanishlari
            'role_locations', 'role_brands',
            // Sozlamalar
            'settings',
            // Brendlar
            'brands', 'brand_locations',
            // Hisobotlar
            'reports', 'report_history',
            // Ro'yxatdan o'tish
            'pending_registrations',
            // Audit va xavfsizlik
            'audit_logs', 'password_change_requests',
            // Pivot va shablonlar
            'pivot_templates',
            // Magic links
            'magic_links',
            // Valyuta kurslari
            'exchange_rates',
            // Solishtirish
            'comparisons',
            // Bildirishnomalar
            'notifications',
            // Filiallar va mahsulotlar
            'branches', 'products', 'stocks', 'sales',
            // Ostatki tahlil
            'ostatki_analysis', 'ostatki_imports',
            // Bloklangan filiallar
            'blocked_filials',
            // Import loglari
            'imports_log',
            // Debt approval jadvallari
            'debt_brands', 'debt_branches', 'debt_svrs', 'debt_requests',
            'debt_request_logs', 'debt_request_items', 'debt_reminders',
            'debt_settings', 'debt_group_users', 'debt_bindings',
            'debt_preview_messages', 'debt_excel_headers', 'debt_excel_columns',
            'debt_accepted_data', 'debt_blocked_items', 'debt_requests_archive'
        ];

        // Transaction ichida barcha ma'lumotlarni import qilish
        await postgresDb.transaction(async (trx) => {
            for (const tableName of tables) {
                try {
                    // Jadval mavjudligini tekshirish (SQLite da)
                    const hasTable = await tempSqliteDb.schema.hasTable(tableName);
                    if (!hasTable) {
                        importCounts[tableName] = 0;
                        skippedCounts[tableName] = 0;
                        continue;
                    }

                    // SQLite dan ma'lumotlarni o'qish
                    const records = await tempSqliteDb(tableName).select('*');
                    
                    if (!records || records.length === 0) {
                        importCounts[tableName] = 0;
                        skippedCounts[tableName] = 0;
                        continue;
                    }

                    let imported = 0;
                    let skipped = 0;
                    let errors = 0;

                    // Har bir yozuvni PostgreSQL ga import qilish
                    for (const record of records) {
                        try {
                            // Superadmin himoyasi
                            if (tableName === 'users' && (record.role === 'super_admin' || record.role === 'superadmin')) {
                                skipped++;
                                continue;
                            }

                            // PostgreSQL jadvali mavjudligini tekshirish
                            const pgHasTable = await trx.schema.hasTable(tableName);
                            if (!pgHasTable) {
                                log.warn(`PostgreSQL jadvali topilmadi: ${tableName}`);
                                skipped++;
                                continue;
                            }

                            // Ma'lumotlarni tozalash (SQLite dan PostgreSQL ga moslashtirish)
                            const cleanedRecord = cleanRecordForPostgres(record);

                            // Insert qilish (onConflict ignore)
                            try {
                                await trx(tableName)
                                    .insert(cleanedRecord)
                                    .onConflict() // PostgreSQL da avtomatik primary key conflict
                                    .ignore();
                                imported++;
                            } catch (insertError) {
                                // Unique constraint xatolik - skip qilish
                                if (insertError.code === '23505' || insertError.message?.includes('duplicate key')) {
                                    skipped++;
                                } else {
                                    throw insertError;
                                }
                            }
                        } catch (recordError) {
                            errors++;
                            log.error(`  ❌ ${tableName} yozuv import xatolik:`, recordError.message);
                        }
                    }

                    importCounts[tableName] = imported;
                    skippedCounts[tableName] = skipped;
                    errorCounts[tableName] = errors;

                } catch (tableError) {
                    log.error(`❌ ${tableName} import xatolik:`, tableError.message);
                    importCounts[tableName] = 0;
                    skippedCounts[tableName] = 0;
                    errorCounts[tableName] = records?.length || 0;
                }
            }
        });

        return {
            success: true,
            counts: importCounts,
            skipped: skippedCounts,
            errors: errorCounts,
            total_imported: Object.values(importCounts).reduce((sum, count) => sum + count, 0),
            total_skipped: Object.values(skippedCounts).reduce((sum, count) => sum + count, 0),
            total_errors: Object.values(errorCounts).reduce((sum, count) => sum + count, 0)
        };

    } catch (error) {
        log.error('SQLite dan PostgreSQL ga konvertatsiya xatoligi:', error);
        throw error;
    } finally {
        // Temp SQLite connection'ni yopish
        await tempSqliteDb.destroy();
    }
}

/**
 * Record'ni PostgreSQL ga moslashtirish
 * SQLite va PostgreSQL o'rtasidagi farqlarni hal qilish
 */
function cleanRecordForPostgres(record) {
    const cleaned = { ...record };

    // Boolean qiymatlarni to'g'rilash (SQLite 0/1, PostgreSQL true/false)
    Object.keys(cleaned).forEach(key => {
        const value = cleaned[key];
        if (value === 0 || value === 1) {
            // Boolean ustunlarini tekshirish (nomi boolean ma'noni anglatadi)
            if (key.includes('is_') || key.includes('has_') || key === 'locked' || key === 'active' || key === 'enabled') {
                cleaned[key] = Boolean(value);
            }
        }
    });

    // Null qiymatlarni to'g'rilash
    Object.keys(cleaned).forEach(key => {
        if (cleaned[key] === null || cleaned[key] === undefined) {
            cleaned[key] = null;
        }
    });

    return cleaned;
}

module.exports = { convertSqliteToPostgres };

