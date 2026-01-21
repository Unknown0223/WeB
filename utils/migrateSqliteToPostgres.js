// utils/migrateSqliteToPostgres.js
// Mavjud SQLite ma'lumotlarini PostgreSQL ga migratsiya qilish

const path = require('path');
const fs = require('fs').promises;
const { createLogger } = require('./logger.js');
const { convertSqliteToPostgres } = require('./sqliteToPostgres.js');

const log = createLogger('MIGRATE');

/**
 * Mavjud SQLite database.db faylini PostgreSQL ga migratsiya qilish
 * @param {object} sqliteDb - SQLite Knex connection (optional, faqat tekshirish uchun)
 * @param {object} postgresDb - PostgreSQL Knex connection
 */
async function migrateSqliteToPostgres(sqliteDb, postgresDb) {
    const sqliteDbPath = path.resolve(__dirname, '..', 'database.db');
    
    try {
        // SQLite fayl mavjudligini tekshirish
        await fs.access(sqliteDbPath);
        
        // Backup yaratish
        const backupDir = path.resolve(__dirname, '..', 'backups');
        try {
            await fs.access(backupDir);
        } catch {
            await fs.mkdir(backupDir, { recursive: true });
        }

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const backupFileName = `database_migrated_to_postgres_${dateStr}_${timeStr}.db`;
        const backupPath = path.join(backupDir, backupFileName);

        log.info(`SQLite fayl backup qilinmoqda: ${backupPath}`);
        await fs.copyFile(sqliteDbPath, backupPath);
        log.info(`Backup yaratildi: ${backupFileName}`);

        // PostgreSQL da jadvallar mavjudligini tekshirish
        // Agar jadvallar bo'sh bo'lsa, migratsiya qilish
        const usersCount = await postgresDb('users').count('* as count').first();
        const hasData = usersCount && parseInt(usersCount.count || usersCount.count) > 0;

        if (hasData) {
            log.warn('PostgreSQL bazasida allaqachon ma\'lumotlar mavjud. Migratsiya o\'tkazilmaydi.');
            return {
                success: false,
                message: 'PostgreSQL bazasida allaqachon ma\'lumotlar mavjud',
                backup_file: backupFileName
            };
        }

        // SQLite dan PostgreSQL ga konvertatsiya qilish
        log.info('SQLite dan PostgreSQL ga migratsiya boshlandi...');
        const result = await convertSqliteToPostgres(sqliteDbPath, postgresDb);
        
        log.info(`Migratsiya muvaffaqiyatli! Import qilindi: ${result.total_imported}, Skipped: ${result.total_skipped}, Xatolar: ${result.total_errors}`);
        
        return {
            success: true,
            message: 'Migratsiya muvaffaqiyatli yakunlandi',
            backup_file: backupFileName,
            ...result
        };

    } catch (error) {
        if (error.code === 'ENOENT') {
            // SQLite fayl mavjud emas - bu normal holat
            log.debug('SQLite fayl topilmadi - migratsiya kerak emas');
            return {
                success: false,
                message: 'SQLite fayl topilmadi',
                skip: true
            };
        }
        
        log.error('Migratsiya xatoligi:', error);
        throw error;
    }
}

module.exports = { migrateSqliteToPostgres };

