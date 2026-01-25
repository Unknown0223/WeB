const express = require('express');
const { db, logAction, isPostgres } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { sendToTelegram } = require('../utils/bot.js');
const { filterReportsByRole, getVisibleLocations, getVisibleBrands } = require('../utils/roleFiltering.js');
const { createLogger } = require('../utils/logger.js');

const router = express.Router();
const log = createLogger('REPORTS');

function extractLateReasonWords(text) {
    const s = String(text ?? '').trim();
    if (!s) return [];
    const matches = s.match(/[\p{L}\p{N}]+(?:[’'ʻ`][\p{L}\p{N}]+)*/gu) || [];
    return matches
        .map(w => w.replace(/[’'ʻ`]/g, ''))
        .filter(w => w.length >= 2);
}

function isValidLateReason(text) {
    const words = extractLateReasonWords(text);
    // Minimal talab: 2 tadan ko'p so'z (ya'ni kamida 3 ta)
    if (words.length < 3) return false;
    const totalChars = words.reduce((sum, w) => sum + w.length, 0);
    return totalChars >= 8;
}

function isLateReportNow(dateStr) {
    // Frontend logikasi: reportDate + 1 kun, 09:00 dan keyin kechikkan hisoblanadi.
    // Server UTC'da ishlashi mumkin, lekin Uzbekistan (Asia/Tashkent) doim UTC+5 (DST yo'q).
    // dateStr: "YYYY-MM-DD"
    if (!dateStr || typeof dateStr !== 'string') return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;

    // cutoff Tashkent time: next day 09:00
    // Convert to UTC by subtracting 5 hours.
    const tashkentOffsetMinutes = 5 * 60;
    const cutoffUtcMs = Date.UTC(y, mo, d + 1, 9, 0, 0) - tashkentOffsetMinutes * 60 * 1000;
    return Date.now() > cutoffUtcMs;
}

// GET /api/reports - Hisobotlar ro'yxatini olish
router.get('/', isAuthenticated, hasPermission(['reports:view_own', 'reports:view_assigned', 'reports:view_all']), async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) {
            return res.status(401).json({ message: "Foydalanuvchi ma'lumotlari topilmadi" });
        }
        
        // Permissions va locations ni tekshirish
        if (!user.permissions || !Array.isArray(user.permissions)) {
            user.permissions = [];
        }
        if (!user.locations || !Array.isArray(user.locations)) {
            user.locations = [];
        }
        
        const page = parseInt(req.query.page) || 1;
        
        const { getSetting } = require('../utils/settingsCache.js');
        const paginationLimit = await getSetting('pagination_limit', 20);
        const limit = parseInt(paginationLimit) || 20;
        const offset = (page - 1) * limit;

        const { startDate, endDate, searchTerm, filter } = req.query;
        
        let query = db('reports as r')
            .leftJoin('users as u', 'r.created_by', 'u.id')
            .leftJoin('brands as b', 'r.brand_id', 'b.id');

        // Foydalanuvchining huquqlariga qarab so'rovni filtrlash
        if (user.permissions.includes('reports:view_all')) {
            // Barcha hisobotlarni ko'rish huquqi bor
            // Rol shartlari bo'yicha filtrlash
            try {
                const filteredQuery = await filterReportsByRole(query, user);
                if (filteredQuery && typeof filteredQuery.select === 'function') {
                    query = filteredQuery;
                } else {
                }
            } catch (filterError) {
                log.error('filterReportsByRole xatolik (view_all):', filterError.message);
                // Xatolik bo'lsa, asl query'ni ishlatamiz
            }
        } else if (user.permissions.includes('reports:view_assigned')) {
            // Biriktirilgan filiallar hisobotlarini ko'rish
            const visibleLocations = await getVisibleLocations(user);
            const visibleBrands = await getVisibleBrands(user);
            
            // MUAMMO TUZATILDI: To'g'ri filtr qo'llash
            query.where(function() {
                // O'zi yaratgan hisobotlar
                this.where('r.created_by', user.id);
                
                // Yoki biriktirilgan filiallar hisobotlari
                if (visibleLocations.length > 0) {
                    this.orWhere(function() {
                        // Filiallar bo'yicha filtr
                        this.whereIn('r.location', visibleLocations);
                        
                        // Agar brendlar ham belgilangan bo'lsa, ularni ham qo'shish (AND mantiqida)
                        if (visibleBrands.length > 0) {
                            this.whereIn('r.brand_id', visibleBrands);
                        }
                    });
                } else if (visibleBrands.length > 0) {
                    // Agar faqat brendlar belgilangan bo'lsa
                    this.orWhereIn('r.brand_id', visibleBrands);
                }
            });
        } else if (user.permissions.includes('reports:view_own')) {
            // Faqat o'zi yaratgan hisobotlarni ko'rish
            query.where('r.created_by', user.id);
            // reports:view_own uchun rol shartlarini qo'llamaymiz, chunki foydalanuvchi o'zi yaratgan barcha hisobotlarni ko'rish huquqiga ega
            // Lekin agar rol shartlari belgilangan bo'lsa, ularni ham hisobga olishimiz mumkin
            // Bu holda, faqat o'zi yaratgan va rol shartlariga mos keladigan hisobotlarni ko'rsatamiz
            try {
                const visibleLocations = await getVisibleLocations(user);
                const visibleBrands = await getVisibleBrands(user);
                
                // MUAMMO TUZATILDI: Agar rol shartlari belgilangan bo'lsa, ularni qo'llash
                if (visibleLocations.length > 0) {
                    query.whereIn('r.location', visibleLocations);
                }
                if (visibleBrands.length > 0) {
                    query.whereIn('r.brand_id', visibleBrands);
                }
                // Agar visibleLocations va visibleBrands bo'sh bo'lsa, hech qanday qo'shimcha filtr qo'llanmaydi
                // va foydalanuvchi o'zi yaratgan barcha hisobotlarni ko'radi
            } catch (roleFilterError) {
                // Xatolik bo'lsa ham, o'zi yaratgan hisobotlarni ko'rsatamiz
            }
        } else {
            // Agar hech qanday ko'rish huquqi bo'lmasa, bo'sh ro'yxat qaytaramiz.
            return res.json({ reports: {}, total: 0, pages: 0, currentPage: 1 });
        }

        if (startDate) query.where('r.report_date', '>=', startDate);
        if (endDate) query.where('r.report_date', '<=', endDate);
        if (searchTerm) {
            query.where(function() {
                this.where('r.id', 'like', `%${searchTerm}%`)
                    .orWhere('r.location', 'like', `%${searchTerm}%`);
            });
        }
        
        // Filter parametrini SQL query'da qo'llamaymiz - edit_count reports jadvalida yo'q
        // Ma'lumotlarni o'qib olgandan keyin memory'da filter qo'llaymiz

        // Avval reports'ni olish (LIMIT va OFFSET'siz, chunki filter qo'llashdan keyin pagination qilamiz)
        let allReports = [];
        try {
            // Query obyektini tekshirish
            if (!query || typeof query.select !== 'function') {
                log.error('Query obyekti to\'g\'ri emas:', typeof query);
                // Agar query obyekti to'g'ri emas bo'lsa, yangi query yaratamiz
                query = db('reports as r')
                    .leftJoin('users as u', 'r.created_by', 'u.id')
                    .leftJoin('brands as b', 'r.brand_id', 'b.id');
                // Faqat o'zi yaratgan hisobotlarni ko'rsatish
                if (user.permissions.includes('reports:view_own')) {
                    query.where('r.created_by', user.id);
                }
            }
            
            allReports = await query
                .select('r.*', 'u.username as created_by_username', 'b.name as brand_name')
                .orderBy('r.id', 'desc');
        } catch (queryError) {
            log.error('Query xatolik:', queryError.message);
            allReports = [];
        }

        // Barcha report'lar uchun edit_count'larni olish
        const allReportIds = allReports.map(r => r.id).filter(id => id != null);
        let editCountMap = {};
        if (allReportIds.length > 0) {
            try {
                const editCounts = await db('report_history')
                    .select('report_id')
                    .count('* as edit_count')
                    .whereIn('report_id', allReportIds)
                    .groupBy('report_id');
                
                editCountMap = editCounts.reduce((acc, item) => {
                    acc[item.report_id] = parseInt(item.edit_count) || 0;
                    return acc;
                }, {});
            } catch (editCountError) {
                log.error('Edit count xatolik:', editCountError.message);
                editCountMap = {};
            }
        }

        // Memory'da filter qo'llash
        let filteredReports = allReports.filter(report => {
            if (!report || !report.id) return false;
            const edit_count = editCountMap[report.id] || 0;
            if (filter === 'edited') return edit_count > 0;
            if (filter === 'unedited') return edit_count === 0;
            return true;
        });

        // Total sonini hisoblash (filter qo'llanganidan keyin)
        const total = filteredReports.length;
        
        // Pages sonini hisoblash
        const pages = Math.ceil(total / limit) || 1;
        
        // Pagination qo'llash
        const reports = filteredReports.slice(offset, offset + limit);

        const formattedReports = {};
        reports.forEach(report => {
            try {
                if (!report || !report.data || !report.settings) {
                    // Invalid report format - skip silently
                    return;
                }
                const parsedData = JSON.parse(report.data);
                const parsedSettings = JSON.parse(report.settings);
            
                formattedReports[report.id] = {
                    id: report.id,
                    date: report.report_date,
                    location: report.location,
                    brand_id: report.brand_id,
                    brand_name: report.brand_name,
                    data: parsedData,
                    settings: parsedSettings,
                    edit_count: editCountMap[report.id] || 0,
                    created_by: report.created_by,
                    created_by_username: report.created_by_username,
                    late_comment: report.late_comment,
                    currency: report.currency || null,
                    created_at: report.created_at,
                    updated_at: report.updated_at
                };
            } catch (parseError) {
                log.error(`Report ${report?.id || 'unknown'} parse xatolik:`, parseError.message);
                // Xatolik bo'lsa, bu report'ni o'tkazib yuboramiz
            }
        });

        res.json({ reports: formattedReports, total, pages, currentPage: page });
    } catch (error) {
        log.error("/api/reports GET xatoligi:", error.message);
        res.status(500).json({ 
            message: "Hisobotlarni yuklashda xatolik",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.post('/', isAuthenticated, hasPermission('reports:create'), async (req, res) => {
    const { date, location, data, settings, late_comment, brand_id, currency } = req.body;
    const user = req.session.user;

    if (!date || !location) {
        return res.status(400).json({ message: "Sana va filial tanlanishi shart." });
    }

    // Kechikkan hisobot bo'lsa, kechikish sababi majburiy va mazmunli bo'lishi kerak
    if (isLateReportNow(date)) {
        if (!isValidLateReason(late_comment)) {
            return res.status(400).json({
                message: "Kechikish sababini aniq yozing (kamida 3 ta so'z)!"
            });
        }
    } else if (late_comment != null && String(late_comment).trim() !== '') {
        // Kechikmagan bo'lsa ham, agar comment yuborilgan bo'lsa, mazmunli bo'lsin
        if (!isValidLateReason(late_comment)) {
            return res.status(400).json({
                message: "Kechikish sababi noto'g'ri (kamida 3 ta so'z)!"
            });
        }
    }

    // Data validatsiyasi
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ message: "Hisobot ma'lumotlari noto'g'ri formatda." });
    }

    // Settings validatsiyasi
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ message: "Hisobot sozlamalari noto'g'ri formatda." });
    }

    // User permissions va locations validatsiyasi
    if (!Array.isArray(user.permissions)) {
        log.warn(`[REPORTS] User permissions array emas: ${typeof user.permissions}`, { userId: user.id });
        user.permissions = [];
    }
    if (!Array.isArray(user.locations)) {
        log.warn(`[REPORTS] User locations array emas: ${typeof user.locations}`, { userId: user.id });
        user.locations = [];
    }

    const totalSum = Object.values(data).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (totalSum === 0) {
        return res.status(400).json({ message: "Bo'sh hisobotni saqlab bo'lmaydi. Iltimos, ma'lumot kiriting." });
    }

    // Foydalanuvchiga filial biriktirilganligini tekshirish
    if (!user.permissions.includes('reports:view_all') && !user.locations.includes(location)) {
        return res.status(403).json({ message: "Siz faqat o'zingizga biriktirilgan filiallar uchun hisobot qo'sha olasiz." });
    }

    try {
        // ✅ Duplicate tekshirish: bir xil sana, filial va brend uchun hisobot mavjudligini tekshirish
        // Transaction ishlatish - race condition'ni oldini olish uchun
        const trx = await db.transaction();
        
        try {
            let existingReportQuery = trx('reports')
                .where({ report_date: date, location: location });
            
            // PostgreSQL uchun row-level lock
            if (isPostgres) {
                existingReportQuery = existingReportQuery.forUpdate();
            }
            
            // Agar brand_id mavjud bo'lsa, uni ham tekshirish
            if (brand_id) {
                existingReportQuery = existingReportQuery.where({ brand_id: brand_id });
            } else {
                // Agar brand_id null bo'lsa, faqat brand_id null bo'lgan hisobotlarni tekshirish
                existingReportQuery = existingReportQuery.whereNull('brand_id');
            }
            
            const existingReport = await existingReportQuery.first();
            if (existingReport) {
                await trx.rollback();
                const brandInfo = brand_id ? ` va brend ID: ${brand_id}` : '';
                return res.status(409).json({ 
                    message: `Ushbu sana (${date}) uchun "${location}" filialida${brandInfo} hisobot allaqachon mavjud. Sahifani yangilang yoki mavjud hisobotni tahrirlang.`,
                    existingReportId: existingReport.id
                });
            }

        // Получаем название бренда для Telegram сообщения
        let brandName = null;
        if (brand_id) {
            const brand = await db('brands').where({ id: brand_id }).first();
            brandName = brand ? brand.name : null;
        }

            let reportId;
            if (isPostgres) {
                // PostgreSQL uchun returning('id') ishlatish
                const result = await trx('reports').insert({
                    report_date: date,
                    location: location,
                    brand_id: brand_id || null,
                    data: JSON.stringify(data),
                    settings: JSON.stringify(settings),
                    created_by: user.id,
                    late_comment: late_comment || null,
                    currency: currency || null
                }).returning('id');
                reportId = result[0]?.id || result[0];
            } else {
                // SQLite uchun odatiy insert
                const insertResult = await trx('reports').insert({
                    report_date: date,
                    location: location,
                    brand_id: brand_id || null,
                    data: JSON.stringify(data),
                    settings: JSON.stringify(settings),
                    created_by: user.id,
                    late_comment: late_comment || null,
                    currency: currency || null
                });
                reportId = Array.isArray(insertResult) && insertResult.length > 0 
                    ? insertResult[0] 
                    : insertResult;
            }
            
            if (!reportId) {
                await trx.rollback();
                log.error("[REPORTS] Report ID olinmadi", { isPostgres });
                return res.status(500).json({ message: "Hisobot saqlanmadi. ID olinmadi." });
            }
            
            // Transaction commit qilish
            await trx.commit();
            
            await logAction(user.id, 'create_report', 'report', reportId, { date, location, brand_id, ip: req.session.ip_address, userAgent: req.session.user_agent });
            
            sendToTelegram({ 
                type: 'new', 
                report_id: reportId, 
                location, 
                date, 
                author: user.username,
                author_id: user.id,
                data, 
                settings, 
                late_comment,
                brand_name: brandName,
                currency: currency || null
            });
            
            // WebSocket orqali realtime yuborish
            if (global.broadcastWebSocket) {
                global.broadcastWebSocket('new_report', {
                    reportId: reportId,
                    date: date,
                    location: location,
                    brand_id: brand_id,
                    brand_name: brandName,
                    created_by: user.id,
                    created_by_username: user.username
                });
            }
            
            res.status(201).json({ message: "Hisobot muvaffaqiyatli saqlandi.", reportId: reportId });
        } catch (trxError) {
            await trx.rollback();
            // Transaction xatoligini asosiy catch'ga tashlaymiz
            throw trxError;
        }
    } catch (error) {
        // ✅ Duplicate xatolikni tekshirish (database constraint yoki application level)
        if (error.code === 'SQLITE_CONSTRAINT' || 
            error.code === '23505' || // PostgreSQL unique violation
            (error.message && (
                error.message.includes('UNIQUE constraint failed') ||
                error.message.includes('duplicate key value') ||
                error.message.includes('unique constraint')
            ))) {
            log.warn(`[REPORTS] Duplicate hisobot yaratishga urinish: date=${date}, location=${location}, brand_id=${brand_id}`, { userId: user.id });
            return res.status(409).json({ 
                message: `Ushbu sana (${date}) uchun "${location}" filialida hisobot allaqachon mavjud. Sahifani yangilang yoki mavjud hisobotni tahrirlang.` 
            });
        }
        log.error("/api/reports POST xatoligi:", error.message, { stack: error.stack });
        res.status(500).json({ message: "Hisobotni saqlashda kutilmagan xatolik" });
    }
});

router.put('/:id', isAuthenticated, async (req, res) => {
    const reportId = req.params.id;
    const { date, location, data, settings, brand_id, currency, late_comment } = req.body;
    const user = req.session.user;

    // Agar late_comment yuborilgan bo'lsa, mazmunli bo'lishi shart
    if (late_comment != null && String(late_comment).trim() !== '') {
        if (!isValidLateReason(late_comment)) {
            return res.status(400).json({
                message: "Kechikish sababi noto'g'ri (kamida 3 ta so'z)!"
            });
        }
    }

    const totalSum = Object.values(data).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (totalSum === 0) {
        return res.status(400).json({ message: "Hisobotni bo'sh holatda saqlab bo'lmaydi. Barcha qiymatlar nolga teng." });
    }

    try {
        const oldReport = await db('reports').where({ id: reportId }).first();
        if (!oldReport) {
            return res.status(404).json({ message: "Hisobot topilmadi." });
        }

        const canEditAll = user.permissions.includes('reports:edit_all');
        const canEditAssigned = user.permissions.includes('reports:edit_assigned') && user.locations.includes(oldReport.location);
        const canEditOwn = user.permissions.includes('reports:edit_own') && oldReport.created_by === user.id;

        if (!canEditAll && !canEditAssigned && !canEditOwn) {
            return res.status(403).json({ message: "Bu hisobotni tahrirlash uchun sizda ruxsat yo'q." });
        }

        if (date !== oldReport.report_date || location !== oldReport.location) {
            const existingReport = await db('reports')
                .where({ report_date: date, location: location })
                .whereNot({ id: reportId })
                .first();
            if (existingReport) {
                return res.status(409).json({ message: `Ushbu sana (${date}) uchun "${location}" filialida boshqa hisobot allaqachon mavjud.` });
            }
        }

        const isDataChanged = JSON.stringify(data) !== oldReport.data;
        const isMetaChanged = date !== oldReport.report_date || location !== oldReport.location || brand_id !== oldReport.brand_id;

        if (isDataChanged || isMetaChanged) {
            const historyEntry = {
                report_id: reportId,
                old_data: oldReport.data,
                old_report_date: oldReport.report_date,
                old_location: oldReport.location,
                old_brand_id: oldReport.brand_id,
                changed_by: user.id
            };
            await db('report_history').insert(historyEntry);
        }
        
        // Получаем название бренда для Telegram сообщения
        let brandName = null;
        let oldBrandName = null;
        if (brand_id) {
            const brand = await db('brands').where({ id: brand_id }).first();
            brandName = brand ? brand.name : null;
        }
        if (oldReport.brand_id) {
            const oldBrand = await db('brands').where({ id: oldReport.brand_id }).first();
            oldBrandName = oldBrand ? oldBrand.name : null;
        }
        
        await db('reports').where({ id: reportId }).update({
            report_date: date,
            location: location,
            brand_id: brand_id || null,
            data: JSON.stringify(data),
            settings: JSON.stringify(settings),
            updated_by: user.id,
            updated_at: db.fn.now(),
            currency: currency || oldReport.currency || null,
            late_comment: late_comment || null
        });

        await logAction(user.id, 'edit_report', 'report', reportId, { date, location, brand_id, ip: req.session.ip_address, userAgent: req.session.user_agent });

        // === O'ZGARTIRISH: sendToTelegram'ga eski sana va filialni ham yuborish ===
        if (isDataChanged || isMetaChanged) {
            sendToTelegram({ 
                type: 'edit', 
                report_id: reportId, 
                author: user.username,
                author_id: user.id,
                data, 
                old_data: JSON.parse(oldReport.data), 
                settings,
                // Yangi qo'shilgan maydonlar
                date: date,
                location: location,
                old_report_date: oldReport.report_date,
                old_location: oldReport.location,
                brand_name: brandName,
                currency: currency || oldReport.currency || null,
                old_brand_name: oldBrandName,
                late_comment: late_comment || oldReport.late_comment || null
            });
            
            // WebSocket orqali realtime yuborish
            if (global.broadcastWebSocket) {
                global.broadcastWebSocket('report_edited', {
                    reportId: reportId,
                    date: date,
                    location: location,
                    brand_id: brand_id,
                    brand_name: brandName,
                    updated_by: user.id,
                    updated_by_username: user.username,
                    old_date: oldReport.report_date,
                    old_location: oldReport.location
                });
            }
        }
        
        res.json({ message: "Hisobot muvaffaqiyatli yangilandi." });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: `Ushbu sana (${date}) uchun "${location}" filialida boshqa hisobot allaqachon mavjud.` });
        }
        log.error(`/api/reports/${reportId} PUT xatoligi:`, error.message);
        res.status(500).json({ message: "Hisobotni yangilashda xatolik." });
    }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
    const reportId = req.params.id;
    const user = req.session.user;

    try {
        const report = await db('reports')
            .where({ id: reportId })
            .select('id', 'report_date', 'location', 'created_by', 'brand_id')
            .first();

        if (!report) {
            return res.status(404).json({ message: "O'chirish uchun hisobot topilmadi." });
        }

        // 3 ta permission bo'yicha tekshirish (edit kabi)
        const canDeleteAll = user.permissions.includes('reports:delete_all');
        const canDeleteAssigned = user.permissions.includes('reports:delete_assigned') && 
            user.locations && Array.isArray(user.locations) && 
            user.locations.includes(report.location);
        const canDeleteOwn = user.permissions.includes('reports:delete_own') && 
            report.created_by === user.id;
        
        // Eski permission'ni ham qo'llab-quvvatlash (backward compatibility)
        const hasOldDeletePermission = user.permissions.includes('reports:delete');

        if (!canDeleteAll && !canDeleteAssigned && !canDeleteOwn && !hasOldDeletePermission) {
            return res.status(403).json({ 
                message: "Bu hisobotni o'chirish uchun sizda ruxsat yo'q." 
            });
        }

        // Agar faqat delete_own permission bo'lsa va hisobot o'ziga tegishli emas bo'lsa
        if (!canDeleteAll && !canDeleteAssigned && !hasOldDeletePermission && 
            canDeleteOwn && report.created_by !== user.id) {
            return res.status(403).json({ 
                message: "Siz faqat o'z hisobotlaringizni o'chira olasiz." 
            });
        }

        // Agar faqat delete_assigned permission bo'lsa va filial biriktirilmagan bo'lsa
        if (!canDeleteAll && !canDeleteOwn && !hasOldDeletePermission && 
            canDeleteAssigned && (!user.locations || !user.locations.includes(report.location))) {
            return res.status(403).json({ 
                message: "Siz faqat biriktirilgan filial hisobotlarini o'chira olasiz." 
            });
        }
        
        const changes = await db('reports').where({ id: reportId }).del();

        if (changes === 0) {
            return res.status(404).json({ message: "Hisobotni o'chirib bo'lmadi." });
        }

        // Brend nomini olish
        let brandName = null;
        if (report.brand_id) {
            const brand = await db('brands').where({ id: report.brand_id }).first();
            brandName = brand ? brand.name : null;
        }

        await logAction(user.id, 'delete_report', 'report', reportId, { 
            date: report.report_date, 
            location: report.location, 
            brand_id: report.brand_id,
            ip: req.session.ip_address, 
            userAgent: req.session.user_agent 
        });

        // Telegram'ga o'chirish xabari yuborish
        sendToTelegram({ 
            type: 'delete', 
            report_id: reportId, 
            location: report.location, 
            date: report.report_date,
            brand_name: brandName,
            brand_id: report.brand_id,
            deleted_by: user.username,
            deleted_by_id: user.id,
            deleted_by_fullname: user.fullname || user.username
        });

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('report_deleted', {
                reportId: reportId,
                date: report.report_date,
                location: report.location,
                brand_id: report.brand_id,
                deleted_by: user.id,
                deleted_by_username: user.username
            });
        }

        res.json({ message: `Hisobot #${reportId} muvaffaqiyatli o'chirildi.` });

    } catch (error) {
        log.error(`/api/reports/${reportId} DELETE xatoligi:`, error.message);
        res.status(500).json({ message: "Hisobotni o'chirishda kutilmagan server xatoligi." });
    }
});

router.get('/:id/history', isAuthenticated, async (req, res) => {
    try {
        const reportId = req.params.id;
        
        const currentReport = await db('reports').where({ id: reportId }).first();
        if (!currentReport) {
            return res.status(404).json({ message: "Hisobot topilmadi." });
        }

        const historyRecords = await db('report_history as h')
             .join('users as u', 'h.changed_by', 'u.id')
             .where('h.report_id', reportId)
             .select('h.*', 'u.username as changed_by_username')
             .orderBy('h.changed_at', 'desc');

        const fullHistory = [
            {
                is_current: true,
                report_date: currentReport.report_date,
                location: currentReport.location,
                data: currentReport.data,
                currency: currentReport.currency || null,
                changed_at: currentReport.updated_at || currentReport.created_at,
                changed_by_username: (await db('users').where({ id: currentReport.updated_by || currentReport.created_by }).first())?.username || 'N/A'
            },
            ...historyRecords.map(h => ({
                is_current: false,
                report_date: h.old_report_date,
                location: h.old_location,
                data: h.old_data,
                currency: currentReport.currency || null, // History uchun ham joriy valyutani ishlatamiz
                changed_at: h.changed_at,
                changed_by_username: h.changed_by_username
            }))
        ];
        
        res.json(fullHistory);
    } catch (error) {
        log.error(`/api/reports/${req.params.id}/history GET xatoligi:`, error.message);
        res.status(500).json({ message: "Hisobot tarixini olishda xatolik" });
    }
});

module.exports = router;
