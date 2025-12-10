const express = require('express');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { applyReportsFilter } = require('../utils/userAccessFilter.js');

const router = express.Router();

// Multer konfiguratsiyasi - memory storage (faylni RAM'da saqlash)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Faqat Excel fayllarni qabul qilish
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.endsWith('.xlsx') ||
            file.originalname.endsWith('.xls')) {
            cb(null, true);
        } else {
            cb(new Error('Faqat Excel fayllarni (.xlsx, .xls) yuklash mumkin'), false);
        }
    }
});

/**
 * GET /api/comparison/data
 * Filiallar bo'yicha operatorlar kiritgan summalarni olish
 * Yangi sxema: Bir kunlik sana + bitta brend
 */
router.get('/data', isAuthenticated, hasPermission('comparison:view'), async (req, res) => {
    try {
        const { date, brandId } = req.query;
        
        if (!date || !brandId) {
            return res.status(400).json({
                success: false,
                error: 'Sana va brend majburiy'
            });
        }

        // Sana formatini tekshirish va to'g'rilash
        let formattedDate = date;
        // Agar sana YYYY-MM-DD formatida bo'lmasa, formatlash
        if (date.includes('.')) {
            // DD.MM.YYYY -> YYYY-MM-DD
            const parts = date.split('.');
            if (parts.length === 3) {
                formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }

        // Brend nomini alohida olish
        const brand = await db('brands')
            .where('id', parseInt(brandId))
            .first();
        
        const brandName = brand ? brand.name : null;
        
        // Avval barcha hisobotlarni olamiz (brand_id null bo'lishi mumkin, lekin data ichida brand_id bor)
        const allReportsQuery = db('reports as r')
            .leftJoin('brands as b', 'r.brand_id', 'b.id')
            .select(
                'r.id',
                'r.location',
                'r.data',
                'r.currency',
                'r.report_date',
                'r.brand_id',
                'b.id as brand_id',
                'b.name as brand_name'
            )
            .where('r.report_date', formattedDate);
        
        // Universal access filter qo'llash
        await applyReportsFilter(allReportsQuery, req.session.user);
        
        const allReports = await allReportsQuery;
        
        // Endi data ichidan brand_id ni tekshirib, faqat tanlangan brand_id uchun filtrlash
        const targetBrandId = String(parseInt(brandId));
        const reports = [];
        
        for (const report of allReports) {
            // Agar report.brand_id mos kelsa, qo'shamiz
            if (report.brand_id === parseInt(brandId)) {
                reports.push(report);
                continue;
            }
            
            // Agar brand_id null bo'lsa, data ichidan tekshiramiz
            if (!report.brand_id && report.data) {
                try {
                    const reportData = JSON.parse(report.data);
                    // Data ichida brand_id bor-yo'qligini tekshiramiz
                    let hasBrandId = false;
                    for (const key in reportData) {
                        const parts = key.split('_');
                        if (parts[0] === targetBrandId) {
                            hasBrandId = true;
                            break;
                        }
                    }
                    if (hasBrandId) {
                        reports.push(report);
                    }
                } catch (error) {
                    // Silent error handling
                }
            }
        }

        // Har bir filial bo'yicha operatorlar kiritgan summalarni hisoblash
        const locationTotals = {};
        
        for (const report of reports) {
            const location = report.location || 'Noma\'lum';
            
            if (!locationTotals[location]) {
                locationTotals[location] = {
                    location: location,
                    operator_amount: 0,
                    currency: report.currency || 'UZS'
                };
            }

            // Report data'dan faqat tanlangan brend uchun qiymatlarni yig'ish
            try {
                const rawData = report.data || '{}';
                const reportData = JSON.parse(rawData);
                
                let reportTotal = 0;
                for (const key in reportData) {
                    // Key format: {brandId}_{columnName}
                    const parts = key.split('_');
                    if (parts.length >= 2 && parts[0] === targetBrandId) {
                        const value = parseFloat(reportData[key]) || 0;
                        reportTotal += value;
                    }
                }
                
                locationTotals[location].operator_amount += reportTotal;
            } catch (error) {
                // Silent error handling
            }
        }

        // Saqlangan solishtirish ma'lumotlarini olish
        const savedComparisons = await db('comparisons')
            .where('comparison_date', date)
            .where('brand_id', brandId);

        const savedMap = {};
        for (const comp of savedComparisons) {
            savedMap[comp.location] = comp;
        }

        // Natijalarni formatlash
        const result = Object.values(locationTotals).map(item => {
            const saved = savedMap[item.location];
            const comparisonAmount = saved ? saved.comparison_amount : null;
            const difference = comparisonAmount !== null 
                ? (item.operator_amount - comparisonAmount) 
                : null;
            const percentage = comparisonAmount && comparisonAmount > 0
                ? ((item.operator_amount / comparisonAmount) * 100).toFixed(2)
                : null;

            return {
                location: item.location,
                operator_amount: item.operator_amount,
                comparison_amount: comparisonAmount,
                difference: difference,
                percentage: percentage ? parseFloat(percentage) : null,
                currency: item.currency
            };
        });

        // Agar hech qanday ma'lumot topilmasa, barcha filiallarni ko'rsatish
        // (operator summa 0 bo'lsa ham)
        if (result.length === 0) {
            // Barcha filiallarni olish (reports jadvalidan yoki branches jadvalidan)
            const allLocations = await db('reports')
                .select('location')
                .distinct()
                .whereNotNull('location')
                .orderBy('location', 'asc');
            
            // Har bir filial uchun 0 summa bilan yozuv yaratish
            for (const loc of allLocations) {
                const saved = savedMap[loc.location];
                result.push({
                    location: loc.location,
                    operator_amount: 0,
                    comparison_amount: saved ? saved.comparison_amount : null,
                    difference: saved && saved.comparison_amount !== null 
                        ? (0 - saved.comparison_amount) 
                        : null,
                    percentage: saved && saved.comparison_amount && saved.comparison_amount > 0
                        ? 0
                        : null,
                    currency: 'UZS'
                });
            }
        }

        // Filiallar ro'yxatini alfavit bo'yicha tartiblash
        result.sort((a, b) => a.location.localeCompare(b.location));

        res.json({
            success: true,
            data: result,
            brand_name: brandName || (reports.length > 0 ? reports[0].brand_name : null),
            date: date
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Permission tekshiruvchi middleware - admin/manager uchun ham ruxsat beradi
 */
const checkComparisonEditPermission = (req, res, next) => {
    const userPermissions = req.session.user?.permissions || [];
    const userRole = req.session.user?.role;
    
    // Admin yoki Manager uchun har doim ruxsat
    if (userRole === 'admin' || userRole === 'manager') {
        return next();
    }
    
    // Yoki comparison:edit permission bor bo'lsa
    if (userPermissions.includes('comparison:edit')) {
        return next();
    }
    
    res.status(403).json({ 
        success: false,
        message: "Bu amalni bajarish uchun sizda yetarli huquq yo'q." 
    });
};

/**
 * POST /api/comparison/save
 * Solishtirish summalarini saqlash
 */
router.post('/save', isAuthenticated, checkComparisonEditPermission, async (req, res) => {
    try {
        const { date, brandId, comparisons } = req.body;
        const userId = req.session.user.id;

        if (!date || !brandId || !Array.isArray(comparisons)) {
            return res.status(400).json({
                success: false,
                error: 'Sana, brend va comparisons majburiy'
            });
        }

        let savedCount = 0;
        let updatedCount = 0;
        const differences = []; // Farqlar ro'yxati

        // Brend nomini olish
        const brand = await db('brands').where('id', brandId).first();
        const brandName = brand ? brand.name : 'Noma\'lum brend';

        for (const comp of comparisons) {
            const { location, comparison_amount } = comp;
            
            if (!location) continue;

            // Operator summasini olish
            const reports = await db('reports as r')
                .select('r.data', 'r.currency')
                .where('r.report_date', date)
                .where('r.brand_id', brandId)
                .where('r.location', location);

            let operatorAmount = 0;
            const targetBrandIdStr = String(brandId);
            for (const report of reports) {
                try {
                    const reportData = JSON.parse(report.data || '{}');
                    for (const key in reportData) {
                        // Key format: {brandId}_{columnName}
                        const parts = key.split('_');
                        if (parts.length >= 2 && parts[0] === targetBrandIdStr) {
                            const value = parseFloat(reportData[key]) || 0;
                            operatorAmount += value;
                        }
                    }
                } catch (error) {
                    // Silent error handling
                }
            }

            // Farq va foizni hisoblash
            const difference = comparison_amount !== null 
                ? (operatorAmount - comparison_amount) 
                : null;
            const percentage = comparison_amount && comparison_amount > 0
                ? parseFloat(((operatorAmount / comparison_amount) * 100).toFixed(2))
                : null;

            // Mavjud yozuvni tekshirish
            const existing = await db('comparisons')
                .where('comparison_date', date)
                .where('brand_id', brandId)
                .where('location', location)
                .first();

            if (existing) {
                // Yangilash
                await db('comparisons')
                    .where('id', existing.id)
                    .update({
                        operator_amount: operatorAmount,
                        comparison_amount: comparison_amount,
                        difference: difference,
                        percentage: percentage,
                        updated_at: db.fn.now()
                    });
                updatedCount++;
            } else {
                // Yangi yozuv
                await db('comparisons').insert({
                    comparison_date: date,
                    brand_id: brandId,
                    location: location,
                    operator_amount: operatorAmount,
                    comparison_amount: comparison_amount,
                    difference: difference,
                    percentage: percentage,
                    created_by: userId,
                    created_at: db.fn.now(),
                    updated_at: db.fn.now()
                });
                savedCount++;
            }

            // Farq bo'lsa, ro'yxatga qo'shish
            if (difference !== null && difference !== 0) {
                differences.push({
                    location,
                    operator_amount: operatorAmount,
                    comparison_amount: comparison_amount,
                    difference,
                    percentage
                });
            }
        }

        // Agar farqlar bo'lsa, barcha operatorlarga notification yaratish
        if (differences.length > 0) {
            console.log(`🔔 [COMPARISON] ========================================`);
            console.log(`🔔 [COMPARISON] Farqlar topildi: ${differences.length} ta filial`);
            console.log(`🔔 [COMPARISON] Brand: ${brandName}, Date: ${date}`);
            console.log(`🔔 [COMPARISON] Farqlar ro'yxati:`, JSON.stringify(differences, null, 2));
            
            try {
                // Barcha operatorlarni olish - barcha variantlarni tekshirish
                console.log(`🔔 [COMPARISON] Operatorlarni qidirish boshlandi...`);
                
                // Avval barcha rollarni ko'rish
                const allRoles = await db('users').distinct('role').pluck('role');
                console.log(`🔔 [COMPARISON] Bazadagi barcha rollar:`, allRoles);
                
                // Barcha aktiv foydalanuvchilarni ko'rish
                const allActiveUsers = await db('users')
                    .where('status', 'active')
                    .select('id', 'username', 'role', 'status');
                console.log(`🔔 [COMPARISON] Barcha aktiv foydalanuvchilar:`, allActiveUsers);
                
                // Operatorlarni qidirish - turli variantlar
                let operators = await db('users')
                    .where('role', 'operator')
                    .where('status', 'active')
                    .select('id', 'username', 'role');
                
                console.log(`🔔 [COMPARISON] 'operator' roli bilan topilganlar: ${operators.length}`, operators);
                
                // Agar 'operator' bilan topilmasa, 'kassir' yoki boshqa variantlarni tekshirish
                if (operators.length === 0) {
                    console.log(`⚠️ [COMPARISON] 'operator' roli bilan topilmadi, boshqa variantlarni tekshirish...`);
                    
                    // 'kassir' roli bilan qidirish
                    const kassirUsers = await db('users')
                        .where('role', 'kassir')
                        .where('status', 'active')
                        .select('id', 'username', 'role');
                    console.log(`🔔 [COMPARISON] 'kassir' roli bilan topilganlar: ${kassirUsers.length}`, kassirUsers);
                    
                    // Barcha aktiv foydalanuvchilarni operator sifatida qabul qilish (test uchun)
                    if (kassirUsers.length === 0) {
                        console.log(`⚠️ [COMPARISON] 'kassir' roli bilan ham topilmadi`);
                        console.log(`⚠️ [COMPARISON] Test rejimida: barcha aktiv foydalanuvchilar operator sifatida qabul qilinadi`);
                        operators = allActiveUsers.map(u => ({ id: u.id, username: u.username, role: u.role }));
                    } else {
                        operators = kassirUsers;
                    }
                }

                console.log(`🔔 [COMPARISON] Yakuniy topilgan operatorlar soni: ${operators.length}`);
                console.log(`🔔 [COMPARISON] Operatorlar ro'yxati:`, operators);
                
                if (operators.length === 0) {
                    console.log(`⚠️ [COMPARISON] Hech qanday aktiv operator topilmadi`);
                    console.log(`⚠️ [COMPARISON] Notification yuborilmaydi`);
                }

                // Har bir operator uchun notification yaratish
                const notificationData = operators.map(operator => ({
                    user_id: operator.id,
                    type: 'comparison_difference',
                    title: `Solishtirishda farqlar aniqlandi`,
                    message: `${brandName} brendi uchun ${date} sanasida ${differences.length} ta filialda farqlar topildi.`,
                    details: JSON.stringify({
                        date,
                        brand_id: brandId,
                        brand_name: brandName,
                        differences: differences,
                        total_differences: differences.length
                    }),
                    is_read: false,
                    created_at: db.fn.now()
                }));

                if (notificationData.length > 0) {
                    console.log(`💾 [COMPARISON] ${notificationData.length} ta notification yaratilmoqda...`);
                    // Circular structure xatolikni oldini olish uchun faqat kerakli ma'lumotlarni ko'rsatish
                    const notificationDataForLog = notificationData.map(n => ({
                        user_id: n.user_id,
                        type: n.type,
                        title: n.title,
                        message: n.message,
                        details: n.details,
                        is_read: n.is_read
                    }));
                    console.log(`💾 [COMPARISON] Notification data:`, JSON.stringify(notificationDataForLog, null, 2));
                    
                    try {
                        await db('notifications').insert(notificationData);
                        console.log(`✅ [COMPARISON] Notification'lar muvaffaqiyatli bazaga yozildi`);
                    } catch (insertError) {
                        console.error(`❌ [COMPARISON] Notification'lar bazaga yozishda xatolik:`, insertError);
                        console.error(`❌ [COMPARISON] Error message:`, insertError.message);
                        console.error(`❌ [COMPARISON] Error stack:`, insertError.stack);
                    }
                    
                    // WebSocket orqali realtime yuborish
                    try {
                        console.log(`📡 [COMPARISON] WebSocket yuborishga harakat qilinmoqda...`);
                        console.log(`📡 [COMPARISON] global.broadcastWebSocket mavjudligi:`, typeof global.broadcastWebSocket);
                        
                        if (global.broadcastWebSocket) {
                            console.log(`📡 [COMPARISON] WebSocket orqali realtime yuborilmoqda...`);
                            
                            let successCount = 0;
                            let errorCount = 0;
                            
                            // Har bir operator uchun alohida yuborish
                            for (const operator of operators) {
                                try {
                                    const wsPayload = {
                                        user_id: operator.id,
                                        notification: {
                                            type: 'comparison_difference',
                                            title: `Solishtirishda farqlar aniqlandi`,
                                            message: `${brandName} brendi uchun ${date} sanasida ${differences.length} ta filialda farqlar topildi.`,
                                            details: {
                                                date,
                                                brand_id: brandId,
                                                brand_name: brandName,
                                                differences: differences,
                                                total_differences: differences.length
                                            }
                                        }
                                    };
                                    
                                    console.log(`📡 [COMPARISON] Operator ${operator.id} (${operator.username}) uchun yuborilmoqda...`);
                                    console.log(`📡 [COMPARISON] Payload:`, JSON.stringify(wsPayload, null, 2));
                                    
                                    global.broadcastWebSocket('comparison_difference', wsPayload);
                                    successCount++;
                                    console.log(`✅ [COMPARISON] Operator ${operator.id} ga muvaffaqiyatli yuborildi`);
                                } catch (operatorError) {
                                    errorCount++;
                                    console.error(`❌ [COMPARISON] Operator ${operator.id} ga yuborishda xatolik:`, operatorError);
                                }
                            }
                            
                            console.log(`✅ [COMPARISON] WebSocket yuborish yakunlandi:`);
                            console.log(`   - Muvaffaqiyatli: ${successCount} ta`);
                            console.log(`   - Xatoliklar: ${errorCount} ta`);
                        } else {
                            console.log(`⚠️ [COMPARISON] global.broadcastWebSocket funksiyasi mavjud emas`);
                            console.log(`⚠️ [COMPARISON] global obyekti:`, Object.keys(global));
                        }
                    } catch (wsError) {
                        console.error(`❌ [COMPARISON] WebSocket yuborishda xatolik:`, wsError);
                        console.error(`❌ [COMPARISON] Error message:`, wsError.message);
                        console.error(`❌ [COMPARISON] Error stack:`, wsError.stack);
                    }
                } else {
                    console.log(`⚠️ [COMPARISON] Notification data bo'sh, yuborilmaydi`);
                    console.log(`⚠️ [COMPARISON] Operators length: ${operators.length}`);
                    console.log(`⚠️ [COMPARISON] Operators:`, operators);
                }
            } catch (error) {
                console.error(`❌ [COMPARISON] Notification yaratishda xatolik:`, error);
                // Notification yaratishda xatolik bo'lsa ham, asosiy javob qaytariladi
            }
        } else {
            console.log(`ℹ️ [COMPARISON] Farqlar topilmadi, notification yuborilmaydi`);
        }

        res.json({
            success: true,
            message: 'Ma\'lumotlar saqlandi',
            saved_count: savedCount,
            updated_count: updatedCount,
            differences_found: differences.length > 0,
            differences_count: differences.length
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * GET /api/comparison/history
 * Oldingi solishtirishlarni ko'rish
 */
router.get('/history', isAuthenticated, hasPermission('comparison:view'), async (req, res) => {
    try {
        const { date, brandId, startDate, endDate } = req.query;

        let query = db('comparisons as c')
            .leftJoin('brands as b', 'c.brand_id', 'b.id')
            .leftJoin('users as u', 'c.created_by', 'u.id')
            .select(
                'c.id',
                'c.comparison_date',
                'c.location',
                'c.operator_amount',
                'c.comparison_amount',
                'c.difference',
                'c.percentage',
                'b.name as brand_name',
                'u.username as created_by_name',
                'c.created_at'
            )
            .orderBy('c.comparison_date', 'desc')
            .orderBy('c.location', 'asc');

        if (date) {
            query = query.where('c.comparison_date', date);
        }
        if (brandId) {
            query = query.where('c.brand_id', brandId);
        }
        if (startDate) {
            query = query.where('c.comparison_date', '>=', startDate);
        }
        if (endDate) {
            query = query.where('c.comparison_date', '<=', endDate);
        }

        const results = await query;

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * GET /api/comparison/export
 * Solishtirish natijalarini Excel faylga eksport qilish
 */
router.get('/export', isAuthenticated, hasPermission('comparison:export'), async (req, res) => {
    try {
        const { date, brandId } = req.query;

        if (!date || !brandId) {
            return res.status(400).json({
                success: false,
                error: 'Sana va brend majburiy'
            });
        }

        // Ma'lumotlarni olish
        const dataRes = await db('reports as r')
            .leftJoin('brands as b', 'r.brand_id', 'b.id')
            .select(
                'r.location',
                'r.data',
                'r.currency',
                'b.name as brand_name'
            )
            .where('r.report_date', date)
            .where('r.brand_id', brandId);

        const locationTotals = {};
        for (const report of dataRes) {
            const location = report.location || 'Noma\'lum';
            if (!locationTotals[location]) {
                locationTotals[location] = {
                    location: location,
                    operator_amount: 0,
                    currency: report.currency || 'UZS'
                };
            }
            try {
                const reportData = JSON.parse(report.data || '{}');
                const targetBrandIdStr = String(brandId);
                for (const key in reportData) {
                    // Key format: {brandId}_{columnName}
                    const parts = key.split('_');
                    if (parts.length >= 2 && parts[0] === targetBrandIdStr) {
                        locationTotals[location].operator_amount += parseFloat(reportData[key]) || 0;
                    }
                }
            } catch (error) {
                // Silent error handling
            }
        }

        const savedComparisons = await db('comparisons')
            .where('comparison_date', date)
            .where('brand_id', brandId);

        const savedMap = {};
        for (const comp of savedComparisons) {
            savedMap[comp.location] = comp;
        }

        // Excel workbook yaratish
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Solishtirish Natijalari');

        // Sarlavhalar
        worksheet.columns = [
            { header: 'Filial', key: 'location', width: 30 },
            { header: 'Operator Kiritgan Summa', key: 'operator_amount', width: 25 },
            { header: 'Solishtirish Summasi', key: 'comparison_amount', width: 25 },
            { header: 'Farq', key: 'difference', width: 20 },
            { header: 'Foiz (%)', key: 'percentage', width: 15 },
            { header: 'Valyuta', key: 'currency', width: 15 }
        ];

        // Ma'lumotlarni qo'shish
        const sortedLocations = Object.keys(locationTotals).sort();
        for (const location of sortedLocations) {
            const item = locationTotals[location];
            const saved = savedMap[location];
            const comparisonAmount = saved ? saved.comparison_amount : null;
            const difference = comparisonAmount !== null 
                ? (item.operator_amount - comparisonAmount) 
                : null;
            const percentage = comparisonAmount && comparisonAmount > 0
                ? ((item.operator_amount / comparisonAmount) * 100).toFixed(2)
                : null;

            worksheet.addRow({
                location: item.location,
                operator_amount: item.operator_amount,
                comparison_amount: comparisonAmount || '-',
                difference: difference !== null ? difference : '-',
                percentage: percentage ? `${percentage}%` : '-',
                currency: item.currency
            });
        }

        // Stil qo'shish
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Response
        const brandName = dataRes.length > 0 ? dataRes[0].brand_name : 'Unknown';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="solishtirish_${date}_${brandName}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/comparison/import
 * Excel fayldan solishtirish ma'lumotlarini import qilish
 */
router.post('/import', isAuthenticated, checkComparisonEditPermission, upload.single('file'), async (req, res) => {
    try {
        const { date, brandId } = req.body;
        const userId = req.session.user.id;

        if (!date || !brandId) {
            return res.status(400).json({
                success: false,
                error: 'Sana va brend majburiy'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Excel fayl yuklanmagan'
            });
        }

        // Excel faylni o'qish
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);

        // Birinchi worksheet'ni olish
        const worksheet = workbook.getWorksheet(1);
        if (!worksheet) {
            return res.status(400).json({
                success: false,
                error: 'Excel faylda worksheet topilmadi'
            });
        }

        // Sarlavhalarni topish (birinchi qator)
        const headerRow = worksheet.getRow(1);
        const headers = [];
        headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            headers[colNumber] = cell.value ? String(cell.value).trim().toLowerCase() : '';
        });

        // Filial va Solishtirish Summasi ustunlarini topish
        let locationColIndex = null;
        let comparisonAmountColIndex = null;

        // Turli xil nomlanish variantlarini qidirish
        const locationVariants = ['filial', 'location', 'филиал', 'филиаллар', 'filiallar'];
        const amountVariants = ['solishtirish summasi', 'comparison amount', 'solishtirish', 'summa', 'сумма', 'сравнение'];

        headers.forEach((header, index) => {
            const headerLower = header.toLowerCase();
            if (locationVariants.some(v => headerLower.includes(v))) {
                locationColIndex = index;
            }
            if (amountVariants.some(v => headerLower.includes(v))) {
                comparisonAmountColIndex = index;
            }
        });

        // Agar aniq topilmasa, birinchi va ikkinchi ustunlarni ishlatish
        if (locationColIndex === null) {
            locationColIndex = 1; // Birinchi ustun
        }
        if (comparisonAmountColIndex === null) {
            comparisonAmountColIndex = 2; // Ikkinchi ustun
        }

        // Ma'lumotlarni o'qish (2-qatordan boshlab)
        const importedData = [];
        const errors = [];

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
            const row = worksheet.getRow(rowNumber);
            const location = row.getCell(locationColIndex).value ? String(row.getCell(locationColIndex).value).trim() : '';
            const amountValue = row.getCell(comparisonAmountColIndex).value;

            // Bo'sh qatorlarni o'tkazib yuborish
            if (!location && (!amountValue || amountValue === '')) {
                continue;
            }

            if (!location) {
                errors.push(`Qator ${rowNumber}: Filial nomi kiritilmagan`);
                continue;
            }

            // Summani parse qilish
            let comparisonAmount = null;
            if (amountValue !== null && amountValue !== undefined && amountValue !== '') {
                // Agar raqam bo'lsa, to'g'ridan-to'g'ri ishlatish
                if (typeof amountValue === 'number') {
                    comparisonAmount = amountValue;
                } else {
                    // Agar string bo'lsa, bo'sh joylarni olib tashlash va parse qilish
                    const cleaned = String(amountValue).replace(/\s/g, '').replace(/,/g, '.');
                    const parsed = parseFloat(cleaned);
                    if (!isNaN(parsed)) {
                        comparisonAmount = parsed;
                    } else {
                        errors.push(`Qator ${rowNumber} (${location}): Noto'g'ri summa formati: "${amountValue}"`);
                        continue;
                    }
                }
            }

            importedData.push({
                location: location,
                comparison_amount: comparisonAmount
            });
        }

        if (importedData.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Excel faylda ma\'lumotlar topilmadi yoki barcha qatorlar xatolarga ega',
                errors: errors
            });
        }

        // Operator summalarini olish va saqlash
        let savedCount = 0;
        let updatedCount = 0;

        for (const comp of importedData) {
            const { location, comparison_amount } = comp;

            // Operator summasini olish
            const reports = await db('reports as r')
                .select('r.data', 'r.currency')
                .where('r.report_date', date)
                .where('r.brand_id', brandId)
                .where('r.location', location);

            let operatorAmount = 0;
            const targetBrandIdStr = String(brandId);
            for (const report of reports) {
                try {
                    const reportData = JSON.parse(report.data || '{}');
                    for (const key in reportData) {
                        // Key format: {brandId}_{columnName}
                        const parts = key.split('_');
                        if (parts.length >= 2 && parts[0] === targetBrandIdStr) {
                            const value = parseFloat(reportData[key]) || 0;
                            operatorAmount += value;
                        }
                    }
                } catch (error) {
                    // Silent error handling
                }
            }

            // Farq va foizni hisoblash
            const difference = comparison_amount !== null 
                ? (operatorAmount - comparison_amount) 
                : null;
            const percentage = comparison_amount && comparison_amount > 0
                ? parseFloat(((operatorAmount / comparison_amount) * 100).toFixed(2))
                : null;

            // Mavjud yozuvni tekshirish
            const existing = await db('comparisons')
                .where('comparison_date', date)
                .where('brand_id', brandId)
                .where('location', location)
                .first();

            if (existing) {
                // Yangilash
                await db('comparisons')
                    .where('id', existing.id)
                    .update({
                        operator_amount: operatorAmount,
                        comparison_amount: comparison_amount,
                        difference: difference,
                        percentage: percentage,
                        updated_at: db.fn.now()
                    });
                updatedCount++;
            } else {
                // Yangi yozuv
                await db('comparisons').insert({
                    comparison_date: date,
                    brand_id: brandId,
                    location: location,
                    operator_amount: operatorAmount,
                    comparison_amount: comparison_amount,
                    difference: difference,
                    percentage: percentage,
                    created_by: userId,
                    created_at: db.fn.now(),
                    updated_at: db.fn.now()
                });
                savedCount++;
            }
        }

        res.json({
            success: true,
            message: 'Ma\'lumotlar muvaffaqiyatli import qilindi',
            saved_count: savedCount,
            updated_count: updatedCount,
            total_imported: importedData.length,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Import qilishda xatolik yuz berdi'
        });
    }
});

/**
 * GET /api/comparison/template
 * Excel import uchun shablon fayl yuklab olish
 */
router.get('/template', isAuthenticated, hasPermission('comparison:view'), async (req, res) => {
    try {
        // Excel workbook yaratish
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Solishtirish Ma\'lumotlari');

        // Sarlavhalar
        worksheet.columns = [
            { header: 'Filial', key: 'location', width: 30 },
            { header: 'Solishtirish Summasi', key: 'comparison_amount', width: 25 }
        ];

        // Namuna ma'lumotlar
        worksheet.addRow({
            location: 'Namuna Filial 1',
            comparison_amount: 1000000
        });
        worksheet.addRow({
            location: 'Namuna Filial 2',
            comparison_amount: 2000000
        });

        // Stil qo'shish
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="solishtirish_shablon.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;
