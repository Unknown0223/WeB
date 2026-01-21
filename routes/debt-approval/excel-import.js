// routes/debt-approval/excel-import.js
// Excel import mexanizmi - admin uchun

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');
const { detectColumns } = require('../../utils/excelParser.js');

const log = createLogger('EXCEL_IMPORT');

// Upload sozlamalari
const upload = multer({ 
    dest: 'uploads/debt-approval/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * Excel fayl yuklash va parse qilish
 */
router.post('/upload', isAuthenticated, hasPermission('debt:admin'), upload.single('excel'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Excel fayl yuborilmadi' });
        }
        
        const filePath = req.file.path;
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        
        if (data.length < 2) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'Excel fayl bo\'sh yoki noto\'g\'ri formatda' });
        }
        
        // Headers va data ajratish
        const headers = data[0].map(h => h ? String(h).trim() : '');
        const rows = data.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''));
        
        // Ustunlarni aniqlash
        const detectedColumns = detectColumns(headers);
        
        // Ma'lumotlarni formatlash
        const formattedData = rows.map(row => {
            const rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = row[index];
            });
            return rowObj;
        });
        
        // Temporary faylni o'chirish
        fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            headers: headers,
            data: formattedData,
            detectedColumns: detectedColumns,
            totalRows: formattedData.length
        });
    } catch (error) {
        log.error('Error uploading Excel:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ success: false, message: 'Excel faylni qayta ishlashda xatolik' });
    }
});

/**
 * Excel ma'lumotlarini import qilish
 */
router.post('/import', isAuthenticated, hasPermission('debt:admin'), async (req, res) => {
    try {
        const { data, clearExisting = false, columnMapping } = req.body;
        const userId = req.session.user.id;
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ success: false, message: 'Ma\'lumotlar topilmadi' });
        }
        
        // Column mapping olish (agar berilgan bo'lsa)
        const mapping = columnMapping || {
            brand: 'Brend',
            branch: 'Filial',
            svr: 'SVR FISH'
        };
        
        // Agar clearExisting true bo'lsa, mavjud ma'lumotlarni tozalash
        if (clearExisting) {
            await db('debt_svrs').del();
            await db('debt_branches').del();
            await db('debt_brands').del();
            log.info('Existing data cleared by user:', userId);
        }
        
        // Ma'lumotlarni import qilish
        const brandsMap = new Map();
        const branchesMap = new Map();
        const svrsMap = new Map();
        
        let importedCount = 0;
        let skippedCount = 0;
        
        for (const row of data) {
            try {
                const brandName = String(row[mapping.brand] || '').trim();
                const branchName = String(row[mapping.branch] || '').trim();
                const svrName = String(row[mapping.svr] || '').trim();
                
                if (!brandName || !branchName || !svrName) {
                    skippedCount++;
                    continue;
                }
                
                // Brendni olish yoki yaratish
                let brandId;
                if (brandsMap.has(brandName)) {
                    brandId = brandsMap.get(brandName);
                } else {
                    let brand = await db('debt_brands').where('name', brandName).first();
                    if (!brand) {
                        [brandId] = await db('debt_brands').insert({
                            name: brandName,
                            status: 'active'
                        });
                    } else {
                        brandId = brand.id;
                    }
                    brandsMap.set(brandName, brandId);
                }
                
                // Filialni olish yoki yaratish
                let branchId;
                const branchKey = `${brandId}_${branchName}`;
                if (branchesMap.has(branchKey)) {
                    branchId = branchesMap.get(branchKey);
                } else {
                    let branch = await db('debt_branches')
                        .where('brand_id', brandId)
                        .where('name', branchName)
                        .first();
                    if (!branch) {
                        [branchId] = await db('debt_branches').insert({
                            brand_id: brandId,
                            name: branchName,
                            status: 'active'
                        });
                    } else {
                        branchId = branch.id;
                    }
                    branchesMap.set(branchKey, branchId);
                }
                
                // SVRni olish yoki yaratish
                const svrKey = `${branchId}_${svrName}`;
                if (!svrsMap.has(svrKey)) {
                    let svr = await db('debt_svrs')
                        .where('branch_id', branchId)
                        .where('name', svrName)
                        .first();
                    if (!svr) {
                        await db('debt_svrs').insert({
                            brand_id: brandId,
                            branch_id: branchId,
                            name: svrName,
                            status: 'active'
                        });
                    }
                    svrsMap.set(svrKey, true);
                }
                
                importedCount++;
            } catch (error) {
                log.error('Error importing row:', error);
                skippedCount++;
            }
        }
        
        log.info(`Excel import completed: imported=${importedCount}, skipped=${skippedCount}, userId=${userId}`);
        
        res.json({
            success: true,
            message: `Ma'lumotlar muvaffaqiyatli import qilindi`,
            imported: importedCount,
            skipped: skippedCount,
            total: data.length
        });
    } catch (error) {
        log.error('Error importing Excel data:', error);
        res.status(500).json({ success: false, message: 'Import qilishda xatolik' });
    }
});

/**
 * Mavjud ma'lumotlarni tozalash
 */
router.post('/clear', isAuthenticated, hasPermission('debt:admin'), async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        await db('debt_svrs').del();
        await db('debt_branches').del();
        await db('debt_brands').del();
        
        log.info(`Data cleared by user: ${userId}`);
        
        res.json({ success: true, message: 'Ma\'lumotlar tozalandi' });
    } catch (error) {
        log.error('Error clearing data:', error);
        res.status(500).json({ success: false, message: 'Tozalashda xatolik' });
    }
});

module.exports = router;

