// utils/cleanup.js
// Vaqtinchalik fayllarni tozalash

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger.js');

const log = createLogger('CLEANUP');

/**
 * Bir papkadagi eski fayllarni tozalash (umumiy funksiya)
 * @param {string} directory - Tozalash kerak bo'lgan papka
 * @param {number} maxAgeHours - Maksimal yashash vaqti (soat). Default: 1 soat
 */
async function cleanupDirectory(directory, maxAgeHours = 1) {
    try {
        // Papka mavjudligini tekshirish
        try {
            await fs.access(directory);
        } catch (error) {
            // Papka mavjud emas, xatolik bermaslik
            return { deleted: 0, errors: 0 };
        }
        
        const files = await fs.readdir(directory);
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000; // soatdan millisekundga
        let deleted = 0;
        let errors = 0;
        
        for (const file of files) {
            try {
                const filePath = path.join(directory, file);
                const stats = await fs.stat(filePath);
                
                // Faqat fayllarni tekshirish (papkalarni emas)
                if (!stats.isFile()) {
                    continue;
                }
                
                const fileAge = now - stats.mtimeMs;
                
                // Agar fayl eski bo'lsa (maxAgeHours soatdan ko'p), o'chirish
                if (fileAge > maxAge) {
                    await fs.unlink(filePath);
                    deleted++;
                    log.debug(`Eski fayl o'chirildi: ${path.basename(directory)}/${file} (${Math.round(fileAge / 1000 / 60)} daqiqa eski)`);
                }
            } catch (error) {
                errors++;
                log.warn(`Faylni o'chirishda xatolik: ${path.basename(directory)}/${file}, error: ${error.message}`);
            }
        }
        
        return { deleted, errors };
    } catch (error) {
        log.error(`Cleanup jarayonida xatolik (${path.basename(directory)}):`, error);
        return { deleted: 0, errors: 1 };
    }
}

/**
 * uploads/debt-approval papkasidagi eski fayllarni tozalash
 * @param {number} maxAgeHours - Maksimal yashash vaqti (soat). Default: 1 soat
 */
async function cleanupUploadsDirectory(maxAgeHours = 1) {
    const uploadsDir = path.join(__dirname, '../uploads/debt-approval');
    const result = await cleanupDirectory(uploadsDir, maxAgeHours);
    
    if (result.deleted > 0 || result.errors > 0) {
        log.info(`Cleanup (uploads/debt-approval): ${result.deleted} ta fayl o'chirildi, ${result.errors} ta xatolik`);
    }
    
    return result;
}

/**
 * temp papkasidagi eski fayllarni tozalash
 * @param {number} maxAgeHours - Maksimal yashash vaqti (soat). Default: 1 soat
 */
async function cleanupTempDirectory(maxAgeHours = 1) {
    const tempDir = path.join(__dirname, '../temp');
    const result = await cleanupDirectory(tempDir, maxAgeHours);
    
    if (result.deleted > 0 || result.errors > 0) {
        log.info(`Cleanup (temp): ${result.deleted} ta fayl o'chirildi, ${result.errors} ta xatolik`);
    }
    
    return result;
}

/**
 * Barcha vaqtinchalik papkalarni tozalash
 * @param {number} maxAgeHours - Maksimal yashash vaqti (soat). Default: 1 soat
 */
async function cleanupAllTempFiles(maxAgeHours = 1) {
    const uploadsResult = await cleanupUploadsDirectory(maxAgeHours);
    const tempResult = await cleanupTempDirectory(maxAgeHours);
    
    const totalDeleted = uploadsResult.deleted + tempResult.deleted;
    const totalErrors = uploadsResult.errors + tempResult.errors;
    
    if (totalDeleted > 0 || totalErrors > 0) {
        log.info(`Cleanup yakunlandi: Jami ${totalDeleted} ta fayl o'chirildi, ${totalErrors} ta xatolik`);
    }
    
    return { deleted: totalDeleted, errors: totalErrors };
}

/**
 * Cleanup ni muntazam ishga tushirish
 * @param {number} intervalHours - Qancha vaqtda bir marta tozalash (soat). Default: 1 soat
 * @param {number} maxAgeHours - Fayl maksimal yashash vaqti (soat). Default: 1 soat
 */
function startCleanupInterval(intervalHours = 1, maxAgeHours = 1) {
    const intervalMs = intervalHours * 60 * 60 * 1000;
    
    // Birinchi marta darhol ishga tushirish (barcha papkalar)
    cleanupAllTempFiles(maxAgeHours).catch(err => {
        log.error('Birinchi cleanup xatolik:', err);
    });
    
    // Keyin muntazam interval'da
    const interval = setInterval(() => {
        cleanupAllTempFiles(maxAgeHours).catch(err => {
            log.error('Cleanup interval xatolik:', err);
        });
    }, intervalMs);
    
    log.info(`Cleanup interval ishga tushirildi: har ${intervalHours} soatda bir marta, fayl yashash vaqti: ${maxAgeHours} soat`);
    
    return interval;
}

module.exports = {
    cleanupUploadsDirectory,
    cleanupTempDirectory,
    cleanupAllTempFiles,
    startCleanupInterval
};

