// routes/debt-approval/export.js
// Ma'lumotlarni export qilish (nusxa olish) va yangilash

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');

const log = createLogger('DEBT_EXPORT');

/**
 * Ma'lumotlarni export qilish (Excel formatida)
 * GET /api/debt-approval/export
 * 
 * Barcha brendlar, filiallar va SVR'larni Excel fayl sifatida yuklab olish
 */
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        // Barcha ma'lumotlarni olish
        const brands = await db('debt_brands').select('*').orderBy('name');
        const branches = await db('debt_branches')
            .join('debt_brands', 'debt_branches.brand_id', 'debt_brands.id')
            .select(
                'debt_branches.id',
                'debt_branches.brand_id',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_branches.created_at',
                'debt_branches.updated_at'
            )
            .orderBy('debt_brands.name')
            .orderBy('debt_branches.name');
        
        const svrs = await db('debt_svrs')
            .join('debt_brands', 'debt_svrs.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_svrs.branch_id', 'debt_branches.id')
            .select(
                'debt_svrs.id',
                'debt_svrs.brand_id',
                'debt_svrs.branch_id',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name',
                'debt_svrs.created_at',
                'debt_svrs.updated_at'
            )
            .orderBy('debt_brands.name')
            .orderBy('debt_branches.name')
            .orderBy('debt_svrs.name');
        
        // Excel workbook yaratish - faqat 3 ta ustun: Brend, Filial, SVR (FISH)
        const workbook = XLSX.utils.book_new();
        
        // Asosiy ma'lumotlar varaqasi (import/export uchun)
        const mainData = [
            ['Brend', 'Filial', 'SVR (FISH)'] // Header
        ];
        
        // Unique kombinatsiyalarni olish (dublikatlarni olib tashlash)
        const uniqueRows = new Map();
        svrs.forEach(svr => {
            const key = `${svr.brand_name}|${svr.branch_name || ''}|${svr.svr_name}`;
            if (!uniqueRows.has(key)) {
                uniqueRows.set(key, {
                    brand: svr.brand_name,
                    branch: svr.branch_name || '',
                    svr: svr.svr_name
                });
            }
        });
        
        // Ma'lumotlarni qo'shish
        uniqueRows.forEach(row => {
            mainData.push([row.brand, row.branch, row.svr]);
        });
        
        const mainSheet = XLSX.utils.aoa_to_sheet(mainData);
        XLSX.utils.book_append_sheet(workbook, mainSheet, 'Ma\'lumotlar');
        
        // Temporary file yaratish
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const fileName = `debt_data_export_${Date.now()}.xlsx`;
        const filePath = path.join(tempDir, fileName);
        
        XLSX.writeFile(workbook, filePath);
        
        log.info(`Export fayl yaratildi: ${fileName}, jami: ${uniqueRows.size} ta ma'lumot (Brend, Filial, SVR)`);
        
        // Faylni yuborish
        res.download(filePath, 'debt_data_export.xlsx', (err) => {
            // Temporary faylni o'chirish (10 soniyadan keyin)
            setTimeout(() => {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (unlinkErr) {
                        log.warn('Export faylni o\'chirishda xatolik:', unlinkErr);
                    }
                }
            }, 10000);
            
            if (err) {
                log.error('Export faylni yuborishda xatolik:', err);
            }
        });
    } catch (error) {
        log.error('Export qilishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Export qilishda xatolik yuz berdi' });
    }
});

/**
 * Shablon yuklab olish (bo'sh shablon yoki mavjud ma'lumotlar bilan)
 * GET /api/debt-approval/export/template?withData=true
 */
router.get('/template', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { withData = 'false' } = req.query;
        const includeData = withData === 'true';
        
        // Excel workbook yaratish
        const workbook = XLSX.utils.book_new();
        
        if (includeData) {
            // Ma'lumotlar bilan shablon
            const brands = await db('debt_brands').select('*').orderBy('name');
            const branches = await db('debt_branches')
                .join('debt_brands', 'debt_branches.brand_id', 'debt_brands.id')
                .select(
                    'debt_brands.name as brand_name',
                    'debt_branches.name as branch_name'
                )
                .orderBy('debt_brands.name')
                .orderBy('debt_branches.name');
            
            const svrs = await db('debt_svrs')
                .join('debt_brands', 'debt_svrs.brand_id', 'debt_brands.id')
                .leftJoin('debt_branches', 'debt_svrs.branch_id', 'debt_branches.id')
                .select(
                    'debt_brands.name as brand_name',
                    'debt_branches.name as branch_name',
                    'debt_svrs.name as svr_name'
                )
                .orderBy('debt_brands.name')
                .orderBy('debt_branches.name')
                .orderBy('debt_svrs.name');
            
            // Asosiy shablon - SVR'lar (import uchun)
            const templateData = [
                ['Brend', 'Filial', 'SVR (FISH)'] // Header
            ];
            
            // Unique kombinatsiyalarni olish
            const uniqueRows = new Map();
            svrs.forEach(svr => {
                const key = `${svr.brand_name}|${svr.branch_name || ''}|${svr.svr_name}`;
                if (!uniqueRows.has(key)) {
                    uniqueRows.set(key, {
                        brand: svr.brand_name,
                        branch: svr.branch_name || '',
                        svr: svr.svr_name
                    });
                }
            });
            
            // Ma'lumotlarni qo'shish
            uniqueRows.forEach(row => {
                templateData.push([row.brand, row.branch, row.svr]);
            });
            
            const templateSheet = XLSX.utils.aoa_to_sheet(templateData);
            XLSX.utils.book_append_sheet(workbook, templateSheet, 'Ma\'lumotlar');
        } else {
            // Bo'sh shablon
            const templateData = [
                ['Brend', 'Filial', 'SVR (FISH)'], // Header
                ['GIGA', 'Toshkent', 'SV ISM FAMILIYA [KOD]'], // Namuna
                ['GIGA', 'Samarqand', 'SV ISM FAMILIYA [KOD]'] // Namuna
            ];
            const templateSheet = XLSX.utils.aoa_to_sheet(templateData);
            XLSX.utils.book_append_sheet(workbook, templateSheet, 'Shablon');
        }
        
        // Temporary file yaratish
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const fileName = `debt_template_${includeData ? 'with_data' : 'empty'}_${Date.now()}.xlsx`;
        const filePath = path.join(tempDir, fileName);
        
        XLSX.writeFile(workbook, filePath);
        
        log.info(`Shablon yaratildi: ${fileName}, withData: ${includeData}`);
        
        // Faylni yuborish
        res.download(filePath, 'debt_template.xlsx', (err) => {
            // Temporary faylni o'chirish
            setTimeout(() => {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (unlinkErr) {
                        log.warn('Shablon faylni o\'chirishda xatolik:', unlinkErr);
                    }
                }
            }, 10000);
            
            if (err) {
                log.error('Shablon faylni yuborishda xatolik:', err);
            }
        });
    } catch (error) {
        log.error('Shablon yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Shablon yaratishda xatolik yuz berdi' });
    }
});

// Multer sozlamalari
const multer = require('multer');
const upload = multer({ 
    dest: 'uploads/debt-approval/',
    limits: { fileSize: 10 * 1024 * 1024 }
});

/**
 * Yangilash import (update mode)
 * POST /api/debt-approval/export/update
 * 
 * Excel fayldan ma'lumotlarni o'qib, mavjud ma'lumotlarni yangilash
 */
router.post('/update', isAuthenticated, hasPermission('roles:manage'), upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'Fayl yuklanmadi' });
        }
        
        try {
                // Excel faylni o'qish
                const workbook = XLSX.readFile(file.path);
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(sheet);
                
                if (!data || data.length === 0) {
                    fs.unlinkSync(file.path);
                    return res.status(400).json({ success: false, message: 'Excel fayl bo\'sh' });
                }
                
                let updated = 0;
                let created = 0;
                let errors = [];
                const changes = []; // O'zgartirilgan ma'lumotlar
                
                // Ustun nomlarini aniqlash
                const getColumnValue = (row, possibleNames) => {
                    for (const name of possibleNames) {
                        if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
                            return String(row[name]).trim();
                        }
                        // Case-insensitive qidirish
                        const rowKeys = Object.keys(row);
                        for (const key of rowKeys) {
                            if (key.trim().toLowerCase() === name.trim().toLowerCase()) {
                                const value = String(row[key]).trim();
                                if (value !== '') {
                                    return value;
                                }
                            }
                        }
                    }
                    return '';
                };
                
                // Ma'lumotlarni tekshirish va o'zgarishlarni aniqlash
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    
                    const brandName = getColumnValue(row, ['Brend', 'brand_name', 'brand', 'Brand']);
                    const branchName = getColumnValue(row, ['Filial', 'branch_name', 'branch', 'Branch']);
                    const svrName = getColumnValue(row, ['SVR (FISH)', 'SVR', 'FISH', 'svr_name', 'svr', 'fish']);
                    
                    if (!brandName || !branchName || !svrName) {
                        errors.push(`Satr ${i + 2}: Ma'lumotlar to'liq emas`);
                        continue;
                    }
                    
                    try {
                        // Brendni topish
                        let brand = await db('debt_brands').where('name', brandName).first();
                        if (!brand) {
                            // Yangi brend - o'zgarish emas
                            continue;
                        }
                        
                        // Filialni topish
                        let branch = await db('debt_branches')
                            .where('brand_id', brand.id)
                            .where('name', branchName)
                            .first();
                        
                        if (!branch) {
                            // Yangi filial - o'zgarish emas
                            continue;
                        }
                        
                        // SVR'ni topish
                        let svr = await db('debt_svrs')
                            .where('brand_id', brand.id)
                            .where('branch_id', branch.id)
                            .where('name', svrName)
                            .first();
                        
                        if (!svr) {
                            // Yangi SVR - o'zgarish emas
                            continue;
                        }
                        
                        // O'zgarish topilmadi - bu yangi yoki mavjud ma'lumot
                        // Faqat o'zgartirilgan ma'lumotlarni qaytarish uchun, barcha ma'lumotlarni saqlash
                        changes.push({
                            row: i + 2,
                            brand: brandName,
                            branch: branchName,
                            svr: svrName,
                            action: 'exists' // Mavjud ma'lumot
                        });
                    } catch (error) {
                        errors.push(`Satr ${i + 2}: ${error.message}`);
                    }
                }
                
                // Agar mavjud ma'lumotlar bo'lsa, ularni qaytarish (tasdiqlash uchun)
                if (changes.length > 0) {
                    // Faylni saqlash (keyinroq ishlatish uchun)
                    const tempFilePath = file.path + '.pending';
                    fs.copyFileSync(file.path, tempFilePath);
                    
                    log.info(`Mavjud ma'lumotlar topildi: ${changes.length} ta, tasdiqlash kutilyapti`);
                    
                    return res.json({
                        success: false,
                        needsConfirmation: true,
                        message: `${changes.length} ta mavjud ma'lumot topildi. Tasdiqlash kerak.`,
                        changes: changes,
                        filePath: tempFilePath,
                        errors: errors.length > 0 ? errors : undefined
                    });
                }
                
                // Agar o'zgarishlar yo'q bo'lsa, to'g'ridan-to'g'ri yangilash
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    
                    const brandName = getColumnValue(row, ['Brend', 'brand_name', 'brand', 'Brand']);
                    const branchName = getColumnValue(row, ['Filial', 'branch_name', 'branch', 'Branch']);
                    const svrName = getColumnValue(row, ['SVR (FISH)', 'SVR', 'FISH', 'svr_name', 'svr', 'fish']);
                    
                    if (!brandName || !branchName || !svrName) {
                        continue;
                    }
                    
                    try {
                        // Brendni topish yoki yaratish
                        let brand = await db('debt_brands').where('name', brandName).first();
                        if (!brand) {
                            const [brandId] = await db('debt_brands').insert({
                                name: brandName,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            });
                            brand = { id: brandId };
                            created++;
                        }
                        
                        // Filialni topish yoki yaratish
                        let branch = await db('debt_branches')
                            .where('brand_id', brand.id)
                            .where('name', branchName)
                            .first();
                        
                        if (!branch) {
                            const [branchId] = await db('debt_branches').insert({
                                brand_id: brand.id,
                                name: branchName,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            });
                            branch = { id: branchId };
                            created++;
                        }
                        
                        // SVR'ni topish yoki yaratish
                        let svr = await db('debt_svrs')
                            .where('brand_id', brand.id)
                            .where('branch_id', branch.id)
                            .where('name', svrName)
                            .first();
                        
                        if (svr) {
                            // Yangilash
                            await db('debt_svrs')
                                .where('id', svr.id)
                                .update({
                                    updated_at: new Date().toISOString()
                                });
                            updated++;
                        } else {
                            // Yaratish
                            await db('debt_svrs').insert({
                                brand_id: brand.id,
                                branch_id: branch.id,
                                name: svrName,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            });
                            created++;
                        }
                    } catch (error) {
                        errors.push(`Satr ${i + 2}: ${error.message}`);
                    }
                }
                
                // Faylni o'chirish
                fs.unlinkSync(file.path);
                
                log.info(`Yangilash import yakunlandi: ${updated} yangilandi, ${created} yaratildi, ${errors.length} xatolik`);
                
                res.json({
                    success: true,
                    message: `Ma'lumotlar yangilandi: ${updated} yangilandi, ${created} yaratildi`,
                    updated,
                    created,
                    errors: errors.length > 0 ? errors : undefined
                });
            } catch (error) {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
                log.error('Yangilash import xatolik:', error);
            res.status(500).json({ success: false, message: 'Yangilashda xatolik yuz berdi' });
        }
    } catch (error) {
        log.error('Yangilash import xatolik:', error);
        res.status(500).json({ success: false, message: 'Yangilashda xatolik yuz berdi' });
    }
});

/**
 * Tasdiqlashdan keyin yangilash
 * POST /api/debt-approval/export/update/confirm
 * Body: { filePath: 'path/to/file.pending', changes: [...] }
 */
router.post('/update/confirm', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { filePath } = req.body;
        
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(400).json({ success: false, message: 'Fayl topilmadi' });
        }
        
        try {
            // Excel faylni o'qish
            const workbook = XLSX.readFile(filePath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(sheet);
            
            if (!data || data.length === 0) {
                fs.unlinkSync(filePath);
                return res.status(400).json({ success: false, message: 'Excel fayl bo\'sh' });
            }
            
            let updated = 0;
            let created = 0;
            let errors = [];
            const archived = []; // Arxivlangan ma'lumotlar
            
            // Ustun nomlarini aniqlash
            const getColumnValue = (row, possibleNames) => {
                for (const name of possibleNames) {
                    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
                        return String(row[name]).trim();
                    }
                    const rowKeys = Object.keys(row);
                    for (const key of rowKeys) {
                        if (key.trim().toLowerCase() === name.trim().toLowerCase()) {
                            const value = String(row[key]).trim();
                            if (value !== '') {
                                return value;
                            }
                        }
                    }
                }
                return '';
            };
            
            // Ma'lumotlarni yangilash
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                
                const brandName = getColumnValue(row, ['Brend', 'brand_name', 'brand', 'Brand']);
                const branchName = getColumnValue(row, ['Filial', 'branch_name', 'branch', 'Branch']);
                const svrName = getColumnValue(row, ['SVR (FISH)', 'SVR', 'FISH', 'svr_name', 'svr', 'fish']);
                
                if (!brandName || !branchName || !svrName) {
                    errors.push(`Satr ${i + 2}: Ma'lumotlar to'liq emas`);
                    continue;
                }
                
                try {
                    // Brendni topish yoki yaratish
                    let brand = await db('debt_brands').where('name', brandName).first();
                    if (!brand) {
                        const [brandId] = await db('debt_brands').insert({
                            name: brandName,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });
                        brand = { id: brandId };
                        created++;
                    }
                    
                    // Filialni topish yoki yaratish
                    let branch = await db('debt_branches')
                        .where('brand_id', brand.id)
                        .where('name', branchName)
                        .first();
                    
                    if (!branch) {
                        const [branchId] = await db('debt_branches').insert({
                            brand_id: brand.id,
                            name: branchName,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });
                        branch = { id: branchId };
                        created++;
                    }
                    
                    // SVR'ni topish yoki yaratish
                    let svr = await db('debt_svrs')
                        .where('brand_id', brand.id)
                        .where('branch_id', branch.id)
                        .where('name', svrName)
                        .first();
                    
                    if (svr) {
                        // Eski ma'lumotlarni arxivlash (agar mavjud bo'lsa)
                        // Bu yerda faqat updated_at yangilanadi, lekin eski ma'lumotlar saqlanadi
                        await db('debt_svrs')
                            .where('id', svr.id)
                            .update({
                                updated_at: new Date().toISOString()
                            });
                        updated++;
                    } else {
                        // Yaratish
                        await db('debt_svrs').insert({
                            brand_id: brand.id,
                            branch_id: branch.id,
                            name: svrName,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });
                        created++;
                    }
                } catch (error) {
                    errors.push(`Satr ${i + 2}: ${error.message}`);
                }
            }
            
            // Faylni o'chirish
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            log.info(`Tasdiqlashdan keyin yangilash yakunlandi: ${updated} yangilandi, ${created} yaratildi, ${errors.length} xatolik`);
            
            res.json({
                success: true,
                message: `Ma'lumotlar yangilandi: ${updated} yangilandi, ${created} yaratildi`,
                updated,
                created,
                archived: archived.length,
                errors: errors.length > 0 ? errors : undefined
            });
        } catch (error) {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            log.error('Tasdiqlashdan keyin yangilash xatolik:', error);
            res.status(500).json({ success: false, message: 'Yangilashda xatolik yuz berdi' });
        }
    } catch (error) {
        log.error('Tasdiqlash xatolik:', error);
        res.status(500).json({ success: false, message: 'Tasdiqlashda xatolik yuz berdi' });
    }
});

module.exports = router;

