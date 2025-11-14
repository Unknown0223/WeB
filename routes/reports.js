const express = require('express');
const { db, logAction } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { sendToTelegram } = require('../utils/bot.js');

const router = express.Router();

// GET /api/reports - Hisobotlar ro'yxatini olish
router.get('/', isAuthenticated, hasPermission(['reports:view_own', 'reports:view_assigned', 'reports:view_all']), async (req, res) => {
    try {
        const user = req.session.user;
        const page = parseInt(req.query.page) || 1;
        
        const limitSetting = await db('settings').where({ key: 'pagination_limit' }).first();
        const limit = limitSetting ? parseInt(limitSetting.value) : 20;
        const offset = (page - 1) * limit;

        const { startDate, endDate, searchTerm, filter } = req.query;
        
        const query = db('reports as r').leftJoin('users as u', 'r.created_by', 'u.id');

        // Foydalanuvchining huquqlariga qarab so'rovni filtrlash
        if (user.permissions.includes('reports:view_all')) {
            // Admin/Menejer barcha hisobotlarni ko'radi, hech narsa qilmaymiz.
        } else if (user.permissions.includes('reports:view_assigned')) {
            // Foydalanuvchi o'ziga biriktirilgan filiallar hisobotlarini ko'radi.
            if (user.locations.length === 0) {
                // Agar biriktirilgan filial bo'lmasa, bo'sh ro'yxat qaytaramiz.
                return res.json({ reports: {}, total: 0, pages: 0, currentPage: 1 });
            }
            query.whereIn('r.location', user.locations);
        } else if (user.permissions.includes('reports:view_own')) {
            // Operator faqat o'zi yaratgan hisobotlarni ko'radi.
            query.where('r.created_by', user.id);
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
        
        const totalResult = await query.clone().count('* as total').first();
        const total = totalResult.total;

        const reports = await query
            .select('r.*', 'u.username as created_by_username')
            .orderBy('r.id', 'desc')
            .limit(limit)
            .offset(offset);

        const reportIds = reports.map(r => r.id);
        let editCountMap = {};
        if (reportIds.length > 0) {
            const editCounts = await db('report_history')
                .select('report_id')
                .count('* as edit_count')
                .whereIn('report_id', reportIds)
                .groupBy('report_id');
            
            editCountMap = editCounts.reduce((acc, item) => {
                acc[item.report_id] = item.edit_count;
                return acc;
            }, {});
        }

        const filteredReports = reports.filter(report => {
            const edit_count = editCountMap[report.id] || 0;
            if (filter === 'edited') return edit_count > 0;
            if (filter === 'unedited') return edit_count === 0;
            return true;
        });

        const pages = Math.ceil(total / limit);

        const formattedReports = {};
        filteredReports.forEach(report => {
            formattedReports[report.id] = {
                id: report.id,
                date: report.report_date,
                location: report.location,
                data: JSON.parse(report.data),
                settings: JSON.parse(report.settings),
                edit_count: editCountMap[report.id] || 0,
                created_by: report.created_by,
                created_by_username: report.created_by_username,
                late_comment: report.late_comment
            };
        });

        res.json({ reports: formattedReports, total, pages, currentPage: page });
    } catch (error) {
        console.error("/api/reports GET xatoligi:", error);
        res.status(500).json({ message: "Hisobotlarni yuklashda xatolik" });
    }
});

router.post('/', isAuthenticated, hasPermission('reports:create'), async (req, res) => {
    const { date, location, data, settings, late_comment } = req.body;
    const user = req.session.user;

    if (!date || !location) {
        return res.status(400).json({ message: "Sana va filial tanlanishi shart." });
    }

    const totalSum = Object.values(data).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (totalSum === 0) {
        return res.status(400).json({ message: "Bo'sh hisobotni saqlab bo'lmaydi. Iltimos, ma'lumot kiriting." });
    }

    if (!user.permissions.includes('reports:view_all') && !user.locations.includes(location)) {
        return res.status(403).json({ message: "Siz faqat o'zingizga biriktirilgan filiallar uchun hisobot qo'sha olasiz." });
    }

    try {
        const existingReport = await db('reports').where({ report_date: date, location: location }).first();
        if (existingReport) {
            return res.status(409).json({ message: `Ushbu sana (${date}) uchun "${location}" filialida hisobot allaqachon mavjud. Sahifani yangilang.` });
        }

        const [reportId] = await db('reports').insert({
            report_date: date,
            location: location,
            data: JSON.stringify(data),
            settings: JSON.stringify(settings),
            created_by: user.id,
            late_comment: late_comment
        });
        
        await logAction(user.id, 'create_report', 'report', reportId, { date, location, ip: req.session.ip_address, userAgent: req.session.user_agent });
        
        sendToTelegram({ type: 'new', report_id: reportId, location, date, author: user.username, data, settings, late_comment });
        
        res.status(201).json({ message: "Hisobot muvaffaqiyatli saqlandi.", reportId: reportId });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: `Ushbu sana (${date}) uchun "${location}" filialida hisobot allaqachon mavjud.` });
        }
        console.error("/api/reports POST xatoligi:", error);
        res.status(500).json({ message: "Hisobotni saqlashda kutilmagan xatolik" });
    }
});

router.put('/:id', isAuthenticated, async (req, res) => {
    const reportId = req.params.id;
    const { date, location, data, settings } = req.body;
    const user = req.session.user;

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
        const isMetaChanged = date !== oldReport.report_date || location !== oldReport.location;

        if (isDataChanged || isMetaChanged) {
            const historyEntry = {
                report_id: reportId,
                old_data: oldReport.data,
                old_report_date: oldReport.report_date,
                old_location: oldReport.location,
                changed_by: user.id
            };
            await db('report_history').insert(historyEntry);
        }
        
        await db('reports').where({ id: reportId }).update({
            report_date: date,
            location: location,
            data: JSON.stringify(data),
            settings: JSON.stringify(settings),
            updated_by: user.id,
            updated_at: db.fn.now()
        });
        
        await logAction(user.id, 'edit_report', 'report', reportId, { date, location, ip: req.session.ip_address, userAgent: req.session.user_agent });

        // === O'ZGARTIRISH: sendToTelegram'ga eski sana va filialni ham yuborish ===
        if (isDataChanged || isMetaChanged) {
            sendToTelegram({ 
                type: 'edit', 
                report_id: reportId, 
                author: user.username, 
                data, 
                old_data: JSON.parse(oldReport.data), 
                settings,
                // Yangi qo'shilgan maydonlar
                date: date,
                location: location,
                old_report_date: oldReport.report_date,
                old_location: oldReport.location
            });
        }
        
        res.json({ message: "Hisobot muvaffaqiyatli yangilandi." });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: `Ushbu sana (${date}) uchun "${location}" filialida boshqa hisobot allaqachon mavjud.` });
        }
        console.error(`/api/reports/${reportId} PUT xatoligi:`, error);
        res.status(500).json({ message: "Hisobotni yangilashda xatolik." });
    }
});

router.delete('/:id', isAuthenticated, hasPermission('reports:delete'), async (req, res) => {
    const reportId = req.params.id;
    const user = req.session.user;

    try {
        const report = await db('reports').where({ id: reportId }).select('id', 'report_date', 'location').first();

        if (!report) {
            return res.status(404).json({ message: "O'chirish uchun hisobot topilmadi." });
        }
        
        const changes = await db('reports').where({ id: reportId }).del();

        if (changes === 0) {
            return res.status(404).json({ message: "Hisobotni o'chirib bo'lmadi." });
        }

        await logAction(user.id, 'delete_report', 'report', reportId, { date: report.report_date, location: report.location, ip: req.session.ip_address, userAgent: req.session.user_agent });

        res.json({ message: `Hisobot #${reportId} muvaffaqiyatli o'chirildi.` });

    } catch (error) {
        console.error(`/api/reports/${reportId} DELETE xatoligi:`, error);
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
                changed_at: currentReport.updated_at || currentReport.created_at,
                changed_by_username: (await db('users').where({ id: currentReport.updated_by || currentReport.created_by }).first())?.username || 'N/A'
            },
            ...historyRecords.map(h => ({
                is_current: false,
                report_date: h.old_report_date,
                location: h.old_location,
                data: h.old_data,
                changed_at: h.changed_at,
                changed_by_username: h.changed_by_username
            }))
        ];
        
        res.json(fullHistory);
    } catch (error) {
        console.error(`/api/reports/${req.params.id}/history GET xatoligi:`, error);
        res.status(500).json({ message: "Hisobot tarixini olishda xatolik" });
    }
});


// Interaktiv hisobotlar uchun ma'lumotlarni olish (Loglar bilan yangilangan versiya)
router.get('/pivot-data', isAuthenticated, hasPermission('reports:view_pivot'), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        console.log(`[LOG] /pivot-data so'rovi keldi. Sana: ${startDate || 'Boshidan'} - ${endDate || 'Oxirigacha'}`);

        let query = db('reports as r')
            .join('users as u', 'r.created_by', 'u.id')
            .select(
                'r.id as report_id',
                'r.report_date',
                'r.location',
                'r.data',
                'r.settings',
                'u.username as created_by'
            );

        if (startDate) query.where('r.report_date', '>=', startDate);
        if (endDate) query.where('r.report_date', '<=', endDate);

        const reports = await query;
        console.log(`[LOG] Bazadan ${reports.length} ta hisobot topildi.`);

        if (!reports || reports.length === 0) {
            return res.json([]);
        }

        const pivotData = [];
        reports.forEach(report => {
            try {
                const reportData = JSON.parse(report.data);
                const reportSettings = JSON.parse(report.settings);
                
                if (!reportSettings.rows || !reportSettings.columns) {
                    console.warn(`[LOG] Hisobot #${report.report_id} uchun sozlamalar (rows/columns) topilmadi. O'tkazib yuborildi.`);
                    return;
                }

                reportSettings.rows.forEach(rowName => {
                    reportSettings.columns.forEach(colName => {
                        const key = `${rowName}_${colName}`;
                        const value = parseFloat(reportData[key]) || 0;

                        if (value !== 0) {
                            pivotData.push({
                                "Filial": report.location,
                                "Sana": report.report_date,
                                "Kiritgan": report.created_by,
                                "Qator": rowName,
                                "Turi": colName,
                                "Summa": value
                            });
                        }
                    });
                });

            } catch (e) {
                console.error(`[XATOLIK] Hisobotni (ID: ${report.report_id}) parse qilishda xatolik:`, e.message);
            }
        });
        
        console.log(`[LOG] Pivot uchun ${pivotData.length} ta yozuv tayyorlandi.`);
        res.json(pivotData);

    } catch (error) {
        console.error(`[KRITIK XATO] /api/reports/pivot-data GET xatoligi:`, error);
        res.status(500).json({ message: "Interaktiv hisobot uchun ma'lumotlarni yuklashda serverda kutilmagan xatolik." });
    }
});

module.exports = router;

