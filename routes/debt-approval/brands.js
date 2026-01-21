// routes/debt-approval/brands.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');

const log = createLogger('DEBT_BRANDS');

// Upload sozlamalari
const upload = multer({ 
    dest: 'uploads/debt-approval/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Brendlar ro'yxati
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const brands = await db('debt_brands').select('*').orderBy('name');
        res.json(brands);
    } catch (error) {
        log.error('Brendlar ro\'yxatini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Brend yaratish
router.post('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Brend nomi kiritilishi kerak' });
        }
        
        const [id] = await db('debt_brands').insert({
            name: name.trim(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
        
        res.json({ success: true, id });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Bunday nomdagi brend allaqachon mavjud' });
        }
        log.error('Brend yaratishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Excel import - Bitta fayldan barcha ma'lumotlar (Brend, Filial, SVR)
// Multer error handler
const uploadHandler = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            log.error('Multer xatolik:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Fayl hajmi juda katta. Maksimal hajm: 10MB' });
            }
            if (err.message && err.message.includes('qabul qilinadi')) {
                return res.status(400).json({ error: err.message });
            }
            return res.status(400).json({ error: 'Fayl yuklashda xatolik: ' + (err.message || 'Noma\'lum xatolik') });
        }
        next();
    });
};

router.post('/import', isAuthenticated, hasPermission('roles:manage'), uploadHandler, async (req, res) => {
    try {
        log.info('Import so\'rovi keldi', {
            hasFile: !!req.file,
            fileName: req.file?.originalname,
            fileSize: req.file?.size,
            clearExisting: req.body.clearExisting
        });
        
        const { clearExisting } = req.body;
        const file = req.file;
        
        if (!file) {
            log.warn('Fayl yuklanmadi');
            return res.status(400).json({ error: 'Fayl yuklanmadi. Iltimos, Excel faylni tanlang va qayta urinib ko\'ring.' });
        }
        
        log.info('Fayl qabul qilindi', {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: file.path
        });
        
        // Excel faylni o'qish
        let workbook;
        let data;
        try {
            log.info('Excel faylni o\'qish boshlanmoqda...', { path: file.path });
            workbook = XLSX.readFile(file.path);
            
            if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
                log.error('Excel faylda varaqlar topilmadi');
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
                return res.status(400).json({ error: 'Excel faylda varaqlar topilmadi' });
            }
            
            log.info('Excel fayl o\'qildi', { 
                sheetCount: workbook.SheetNames.length,
                sheetNames: workbook.SheetNames
            });
            
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!sheet) {
                log.error('Excel faylda birinchi varaqni o\'qib bo\'lmadi');
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
                return res.status(400).json({ error: 'Excel faylda birinchi varaqni o\'qib bo\'lmadi' });
            }
            
            data = XLSX.utils.sheet_to_json(sheet);
            const columnNames = data.length > 0 ? Object.keys(data[0]) : [];
            log.info('Excel ma\'lumotlari JSON formatiga o\'tkazildi', { 
                rows: data.length,
                columns: columnNames
            });
            
            // Birinchi qatorni namuna sifatida ko'rsatish (debug uchun)
            if (data.length > 0) {
                log.debug('Birinchi qator namuna:', data[0]);
            }
        } catch (readError) {
            log.error('Excel faylni o\'qishda xatolik:', {
                message: readError.message,
                stack: readError.stack,
                code: readError.code,
                name: readError.name
            });
            if (fs.existsSync(file.path)) {
                try {
                    fs.unlinkSync(file.path);
                } catch (unlinkErr) {
                    log.warn('Faylni o\'chirishda xatolik:', unlinkErr);
                }
            }
            return res.status(400).json({ 
                error: 'Excel faylni o\'qib bo\'lmadi: ' + (readError.message || 'Noma\'lum xatolik') 
            });
        }
        
        if (!data || data.length === 0) {
            log.warn('Excel fayl bo\'sh yoki ma\'lumotlar topilmadi');
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            return res.status(400).json({ error: 'Excel fayl bo\'sh yoki ma\'lumotlar topilmadi' });
        }
        
        // Eski ma'lumotlarni tozalash
        if (clearExisting === 'true') {
            await db('debt_svrs').del();
            await db('debt_branches').del();
            await db('debt_brands').del();
        }
        
        let brandsImported = 0;
        let branchesImported = 0;
        let svrsImported = 0;
        let errors = [];
        const brandsMap = {}; // name -> id
        const branchesMap = {}; // brand_id + name -> id
        
        // Ma'lumotlarni qayta ishlash
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            
            // Ustun nomlarini aniqlash (turli variantlar, bo'shliqlar bilan)
            // Barcha mumkin bo'lgan ustun nomlarini sinab ko'rish
            const getColumnValue = (row, possibleNames) => {
                // Avval to'g'ridan-to'g'ri nomlarni tekshirish
                for (const name of possibleNames) {
                    // To'g'ridan-to'g'ri nom
                    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
                        return String(row[name]).trim();
                    }
                    // Bo'shliqlar bilan nom
                    const nameWithSpaces = ` ${name} `;
                    if (row[nameWithSpaces] !== undefined && row[nameWithSpaces] !== null && String(row[nameWithSpaces]).trim() !== '') {
                        return String(row[nameWithSpaces]).trim();
                    }
                    // Kichik harflar bilan
                    const nameLower = name.toLowerCase();
                    if (row[nameLower] !== undefined && row[nameLower] !== null && String(row[nameLower]).trim() !== '') {
                        return String(row[nameLower]).trim();
                    }
                }
                
                // Agar to'g'ridan-to'g'ri topilmasa, barcha kalitlarni tekshirish (case-insensitive, trim bilan)
                const rowKeys = Object.keys(row);
                for (const key of rowKeys) {
                    const keyTrimmed = key.trim().toLowerCase();
                    for (const name of possibleNames) {
                        const nameTrimmed = name.trim().toLowerCase();
                        if (keyTrimmed === nameTrimmed || keyTrimmed.includes(nameTrimmed) || nameTrimmed.includes(keyTrimmed)) {
                            const value = String(row[key]).trim();
                            if (value !== '') {
                                return value;
                            }
                        }
                    }
                }
                
                return '';
            };
            
            const brandName = getColumnValue(row, ['brand_name', 'Brend', 'brand', 'Brand']);
            const branchName = getColumnValue(row, ['branch_name', 'Filial', 'branch', 'Branch']);
            // SVR uchun maxsus: "SVR (FISH)" formatini ham qo'llab-quvvatlash
            const svrName = getColumnValue(row, ['svr_name', 'SVR', 'FISH', 'svr', 'SVR (FISH)', 'SVR(FISH)', 'fish', 'SVR (FISH)']);
            
            // Brend import qilish
            if (brandName) {
                try {
                    if (!brandsMap[brandName]) {
                        // Avval mavjudligini tekshirish
                        const existing = await db('debt_brands').where('name', brandName).first();
                        if (existing) {
                            brandsMap[brandName] = existing.id;
                        } else {
                            // Yangi brend qo'shish
                            const [brandId] = await db('debt_brands').insert({
                                name: brandName,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            });
                            if (brandId) {
                                brandsMap[brandName] = brandId;
                                brandsImported++;
                            }
                        }
                    }
                } catch (error) {
                    // UNIQUE constraint xatoliklarini skip qilish
                    if (error.code === 'SQLITE_CONSTRAINT' && error.message && error.message.includes('UNIQUE constraint failed')) {
                        const existing = await db('debt_brands').where('name', brandName).first();
                        if (existing) {
                            brandsMap[brandName] = existing.id;
                        }
                    } else {
                        errors.push(`Satr ${i + 2}: Brend "${brandName}" - ${error.message}`);
                    }
                }
            }
            
            // Filial import qilish
            if (brandName && branchName) {
                try {
                    const brandId = brandsMap[brandName];
                    if (!brandId) {
                        errors.push(`Satr ${i + 2}: Brend "${brandName}" topilmadi`);
                        continue;
                    }
                    
                    const branchKey = `${brandId}_${branchName}`;
                    if (!branchesMap[branchKey]) {
                        // Avval mavjudligini tekshirish
                        const existing = await db('debt_branches')
                            .where('brand_id', brandId)
                            .where('name', branchName)
                            .first();
                        if (existing) {
                            branchesMap[branchKey] = existing.id;
                        } else {
                            // Yangi filial qo'shish
                            const [branchId] = await db('debt_branches').insert({
                                brand_id: brandId,
                                name: branchName,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            });
                            if (branchId) {
                                branchesMap[branchKey] = branchId;
                                branchesImported++;
                            }
                        }
                    }
                } catch (error) {
                    errors.push(`Satr ${i + 2}: Filial "${branchName}" - ${error.message}`);
                }
            }
            
            // SVR import qilish
            if (brandName && branchName && svrName) {
                try {
                    const brandId = brandsMap[brandName];
                    const branchKey = `${brandId}_${branchName}`;
                    const branchId = branchesMap[branchKey];
                    
                    if (!brandId) {
                        errors.push(`Satr ${i + 2}: Brend "${brandName}" topilmadi`);
                        continue;
                    }
                    if (!branchId) {
                        errors.push(`Satr ${i + 2}: Filial "${branchName}" topilmadi`);
                        continue;
                    }
                    
                    // Avval mavjudligini tekshirish
                    const existingSvr = await db('debt_svrs')
                        .where('brand_id', brandId)
                        .where('branch_id', branchId)
                        .where('name', svrName)
                        .first();
                    
                    if (!existingSvr) {
                        await db('debt_svrs').insert({
                            brand_id: brandId,
                            branch_id: branchId,
                            name: svrName,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });
                        svrsImported++;
                    }
                } catch (error) {
                    errors.push(`Satr ${i + 2}: SVR "${svrName}" - ${error.message}`);
                }
            } else {
                if (!brandName && !branchName && !svrName) {
                    errors.push(`Satr ${i + 2}: Barcha maydonlar bo'sh`);
                }
            }
        }
        
        // Faylni o'chirish
        fs.unlinkSync(file.path);
        
        res.json({ 
            success: true, 
            imported: {
                brands: brandsImported,
                branches: branchesImported,
                svrs: svrsImported,
                total: brandsImported + branchesImported + svrsImported
            },
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        log.error('Import xatolik:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            name: error.name
        });
        
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                log.warn('Faylni o\'chirishda xatolik:', unlinkError);
            }
        }
        
        // Batafsil xatolik xabari
        let errorMessage = 'Import xatolik';
        let statusCode = 500;
        
        if (error.message) {
            errorMessage += ': ' + error.message;
        }
        
        // XLSX xatoliklarini aniqlash
        if (error.message && error.message.includes('Cannot find module')) {
            errorMessage = 'Excel faylni o\'qishda xatolik. Iltimos, fayl formati to\'g\'ri ekanligini tekshiring.';
            statusCode = 400;
        } else if (error.message && error.message.includes('ENOENT')) {
            errorMessage = 'Fayl topilmadi yoki o\'qib bo\'lmaydi.';
            statusCode = 400;
        } else if (error.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'Fayl hajmi juda katta. Maksimal hajm: 10MB';
            statusCode = 400;
        } else if (error.code === 'SQLITE_CONSTRAINT') {
            errorMessage = 'Ma\'lumotlar bazaga saqlashda xatolik. Iltimos, fayl ma\'lumotlarini tekshiring.';
            statusCode = 400;
        } else if (error.message && error.message.includes('UNIQUE constraint')) {
            errorMessage = 'Ba\'zi ma\'lumotlar allaqachon mavjud. Iltimos, fayl ma\'lumotlarini tekshiring.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({ error: errorMessage });
    }
});

// Eski import endpoint (alohida turlar uchun) - backward compatibility
router.post('/import/:type', isAuthenticated, hasPermission('roles:manage'), upload.single('file'), async (req, res) => {
    try {
        const { type } = req.params;
        const { clearExisting } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'Fayl yuklanmadi' });
        }
        
        if (!type || !['brands', 'branches', 'svrs'].includes(type)) {
            return res.status(400).json({ error: 'Noto\'g\'ri import turi' });
        }
        
        // Excel faylni o'qish
        const workbook = XLSX.readFile(file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);
        
        if (data.length === 0) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Excel fayl bo\'sh' });
        }
        
        // Eski ma'lumotlarni tozalash
        if (clearExisting === 'true') {
            await db(`debt_${type}`).del();
        }
        
        let imported = 0;
        let errors = [];
        
        // Import qilish
        if (type === 'brands') {
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const brandName = row.brand_name || row.name || row.Brend;
                
                if (!brandName) {
                    errors.push(`Satr ${i + 2}: Brend nomi topilmadi`);
                    continue;
                }
                
                try {
                    await db('debt_brands').insert({
                        name: String(brandName).trim(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }).onConflict('name').ignore();
                    imported++;
                } catch (error) {
                    errors.push(`Satr ${i + 2}: ${error.message}`);
                }
            }
        } else if (type === 'branches') {
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const brandName = row.brand_name || row.Brend;
                const branchName = row.branch_name || row.Filial || row.name;
                
                if (!brandName || !branchName) {
                    errors.push(`Satr ${i + 2}: Brend yoki filial nomi topilmadi`);
                    continue;
                }
                
                try {
                    const brand = await db('debt_brands').where('name', brandName.trim()).first();
                    if (!brand) {
                        errors.push(`Satr ${i + 2}: Brend topilmadi: ${brandName}`);
                        continue;
                    }
                    
                    await db('debt_branches').insert({
                        brand_id: brand.id,
                        name: String(branchName).trim(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }).onConflict(['brand_id', 'name']).ignore();
                    imported++;
                } catch (error) {
                    errors.push(`Satr ${i + 2}: ${error.message}`);
                }
            }
        } else if (type === 'svrs') {
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const brandName = row.brand_name || row.Brend;
                const branchName = row.branch_name || row.Filial;
                const svrName = row.svr_name || row.SVR || row.FISH || row.name;
                
                if (!brandName || !branchName || !svrName) {
                    errors.push(`Satr ${i + 2}: Ma\'lumotlar to\'liq emas`);
                    continue;
                }
                
                try {
                    const brand = await db('debt_brands').where('name', brandName.trim()).first();
                    if (!brand) {
                        errors.push(`Satr ${i + 2}: Brend topilmadi: ${brandName}`);
                        continue;
                    }
                    
                    const branch = await db('debt_branches')
                        .where('brand_id', brand.id)
                        .where('name', branchName.trim())
                        .first();
                    
                    if (!branch) {
                        errors.push(`Satr ${i + 2}: Filial topilmadi: ${branchName}`);
                        continue;
                    }
                    
                    await db('debt_svrs').insert({
                        brand_id: brand.id,
                        branch_id: branch.id,
                        name: String(svrName).trim(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                    imported++;
                } catch (error) {
                    errors.push(`Satr ${i + 2}: ${error.message}`);
                }
            }
        }
        
        // Faylni o'chirish
        fs.unlinkSync(file.path);
        
        res.json({ 
            success: true, 
            imported,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        log.error('Import xatolik:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Import xatolik' });
    }
});

// Filiallar ro'yxati
router.get('/branches', isAuthenticated, hasPermission(['roles:manage', 'debt:create', 'debt:view_own']), async (req, res) => {
    try {
        const { brand_id } = req.query;
        let query = db('debt_branches')
            .join('debt_brands', 'debt_branches.brand_id', 'debt_brands.id')
            .select('debt_branches.*', 'debt_brands.name as brand_name');
        
        if (brand_id) {
            query = query.where('debt_branches.brand_id', brand_id);
        }
        
        let branches = await query.orderBy('debt_branches.name');
        
        // Filiallarni filtrlash: agar tanlangan brenddagi filialda jarayondagi so'rovlarga ega bo'lmagan SVR qolmagan bo'lsa, filialni olib tashlash
        if (brand_id && branches.length > 0) {
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const filteredBranches = [];
            
            for (const branch of branches) {
                // Filialdagi barcha SVR'larni olish (faqat tanlangan brend uchun)
                const svrs = await db('debt_svrs')
                    .where('branch_id', branch.id)
                    .where('brand_id', brand_id)
                    .select('id');
                
                if (svrs.length === 0) {
                    // Agar SVR'lar yo'q bo'lsa, filialni saqlash (ehtimol boshqa brend uchun SVR'lar bor)
                    filteredBranches.push(branch);
                    continue;
                }
                
                // Filialdagi jarayondagi so'rovlarni topish
                const svrIds = svrs.map(s => s.id);
                const inProcessRequests = await db('debt_requests')
                    .where('branch_id', branch.id)
                    .whereIn('svr_id', svrIds)
                    .whereNotIn('status', inProcessStatuses)
                    .select('svr_id')
                    .distinct('svr_id');
                
                const usedSvrIds = new Set(inProcessRequests.map(r => r.svr_id));
                
                // Agar hali jarayondagi so'rovga ega bo'lmagan SVR'lar qolgan bo'lsa, filialni saqlash
                const availableSvrs = svrs.filter(svr => !usedSvrIds.has(svr.id));
                if (availableSvrs.length > 0) {
                    filteredBranches.push(branch);
                }
            }
            
            branches = filteredBranches;
        }
        
        res.json(branches);
    } catch (error) {
        log.error('Filiallar ro\'yxatini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// SVR ro'yxati
router.get('/svrs', isAuthenticated, hasPermission(['roles:manage', 'debt:create', 'debt:view_own']), async (req, res) => {
    try {
        const { brand_id, branch_id } = req.query;
        let query = db('debt_svrs')
            .join('debt_brands', 'debt_svrs.brand_id', 'debt_brands.id')
            .join('debt_branches', 'debt_svrs.branch_id', 'debt_branches.id')
            .select('debt_svrs.*', 'debt_brands.name as brand_name', 'debt_branches.name as branch_name');
        
        if (brand_id) {
            query = query.where('debt_svrs.brand_id', brand_id);
        }
        if (branch_id) {
            query = query.where('debt_svrs.branch_id', branch_id);
        }
        
        let svrs = await query.orderBy('debt_svrs.name');
        
        // Jarayondagi so'rovlarni filtrlash (bot'dagi logikaga o'xshash)
        if (branch_id && svrs.length > 0) {
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const inProcessRequests = await db('debt_requests')
                .where('branch_id', branch_id)
                .whereNotIn('status', inProcessStatuses)
                .select('svr_id')
                .distinct('svr_id');
            
            const usedSvrIds = new Set(inProcessRequests.map(r => r.svr_id));
            svrs = svrs.filter(svr => !usedSvrIds.has(svr.id));
        }
        
        res.json(svrs);
    } catch (error) {
        log.error('SVR ro\'yxatini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

module.exports = router;

