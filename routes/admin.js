const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { db, logAction } = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

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

// Export full database as JSON
router.post('/export-full-data', async (req, res) => {
    try {
        // List of tables to export
        const tablesToExport = [
            'roles', 'permissions', 'role_permissions', 'users', 'user_locations',
            'reports', 'report_history', 'settings', 'pivot_templates', 
            'audit_logs', 'sessions'
        ];

        const exportData = {};

        // Read data from each table asynchronously
        for (const table of tablesToExport) {
            exportData[table] = await db(table).select('*');
        }

        const fileName = `full_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        
        // Log the action first
        await logAction(req.session.user.id, 'export_data', 'system', null, { 
            ip: req.session.ip_address, 
            userAgent: req.session.user_agent 
        });
        
        // Then send the response
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify(exportData, null, 2));

    } catch (error) {
        console.error("Ma'lumotlarni eksport qilishda xatolik:", error);
        res.status(500).json({ message: "Eksport qilishda serverda kutilmagan xatolik." });
    }
});

// Import full database from JSON file
router.post('/import-full-data', upload.single('backupFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "Import uchun fayl tanlanmagan." });
    }

    const filePath = req.file.path;

    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const importData = JSON.parse(fileContent);

        // List of tables in correct order (considering foreign key constraints)
        const tablesInOrder = [
            'audit_logs', 'pivot_templates', 'report_history', 'reports', 
            'user_locations', 'role_permissions', 'users', 'permissions', 'roles', 
            'settings', 'sessions'
        ];

        // Perform all operations in a transaction
        await db.transaction(async trx => {
            // 1. Clear all tables (in reverse order of dependencies)
            for (const table of tablesInOrder) {
                await trx(table).del();
            }

            // 2. Fill tables with new data (in correct order)
            for (const table of [...tablesInOrder].reverse()) {
                if (importData[table] && importData[table].length > 0) {
                    await trx.batchInsert(table, importData[table], 100);
                }
            }
        });

        // Log the action
        await logAction(req.session.user.id, 'import_data', 'system', null, { 
            fileName: req.file.originalname, 
            ip: req.session.ip_address, 
            userAgent: req.session.user_agent 
        });

        res.json({ message: "Ma'lumotlar muvaffaqiyatli import qilindi! Tizim qayta ishga tushishi mumkin." });

    } catch (error) {
        console.error("Ma'lumotlarni import qilishda xatolik:", error);
        res.status(500).json({ message: `Import qilishda xatolik: ${error.message}` });
    } finally {
        // Clean up the temporary file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

module.exports = router;
