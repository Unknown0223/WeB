const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { endOfMonth, startOfMonth, eachDayOfInterval, format } = require('date-fns');

const router = express.Router();

// GET /api/statistics/employees - Xodimlar bo'yicha hisobot statistikasini olish
router.get('/employees', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        console.log(`[KPI LOG] /employees so'rovi qabul qilindi. Oy: ${req.query.month}`);
        const kpiSettingsRow = await db('settings').where({ key: 'kpi_settings' }).first();
        const kpiSettings = kpiSettingsRow ? JSON.parse(kpiSettingsRow.value) : { latePenalty: 0.5, editPenalty: 0.3 };
        console.log("[KPI LOG] Amaldagi KPI sozlamalari:", kpiSettings);

        const month = req.query.month ? new Date(req.query.month) : new Date();
        const startDate = format(startOfMonth(month), 'yyyy-MM-dd');
        const endDate = format(endOfMonth(month), 'yyyy-MM-dd');
        console.log(`[KPI LOG] Hisobotlar uchun sana oralig'i: ${startDate} dan ${endDate} gacha`);

        const employees = await db('users as u')
            .leftJoin('user_locations as ul', 'u.id', 'ul.user_id')
            .whereIn('u.role', ['operator', 'manager'])
            .andWhere('u.status', 'active')
            .groupBy('u.id', 'u.username', 'u.fullname')
            .select(
                'u.id', 
                'u.username', 
                'u.fullname',
                db.raw("GROUP_CONCAT(ul.location_name) as locations")
            );
        console.log(`[KPI LOG] ${employees.length} ta aktiv xodim topildi.`);
        if (employees.length === 0) {
            console.log("[KPI LOG] Hech qanday xodim topilmadi.");
            return res.json([]);
        }

        const employeeIds = employees.map(e => e.id);
        console.log(`[KPI LOG] ${employeeIds.length} ta xodim ID si topildi.`);

        const reports = await db('reports as r')
            .leftJoin('report_history as h', 'r.id', 'h.report_id')
            .whereIn('r.created_by', employeeIds)
            .whereBetween('r.report_date', [startDate, endDate])
            .groupBy('r.id')
            .select(
                'r.id',
                'r.report_date',
                'r.created_at',
                'r.created_by',
                db.raw('COUNT(h.id) as edit_count')
            );
        console.log(`[KPI LOG] Tanlangan oy uchun ${reports.length} ta hisobot topildi.`);

        const statistics = employees.map(employee => {
            const employeeReports = reports.filter(r => r.created_by === employee.id);
            
            let onTimeCount = 0;
            let lateCount = 0;
            
            employeeReports.forEach(report => {
                const deadline = new Date(report.report_date);
                deadline.setDate(deadline.getDate() + 1);
                deadline.setHours(9, 0, 0, 0);
                const createdAt = new Date(report.created_at);
                if (createdAt <= deadline) {
                    onTimeCount++;
                } else {
                    lateCount++;
                }
            });

            const totalSubmitted = employeeReports.length;
            const totalEdited = employeeReports.reduce((sum, r) => sum + r.edit_count, 0);
            
            const onTimePercentage = totalSubmitted > 0 ? (onTimeCount / totalSubmitted) * 100 : 0;
            const latePercentage = totalSubmitted > 0 ? (lateCount / totalSubmitted) * 100 : 0;
            const editedPercentage = totalSubmitted > 0 ? (totalEdited / totalSubmitted) * 100 : 0;

            const kpiScore = Math.max(0, onTimePercentage - (latePercentage * kpiSettings.latePenalty) - (editedPercentage * kpiSettings.editPenalty));

            return {
                userId: employee.id,
                username: employee.username,
                fullname: employee.fullname,
                locations: employee.locations ? employee.locations.split(',').filter(loc => loc.trim() !== '') : [],
                totalSubmitted,
                onTimeCount,
                lateCount,
                totalEdited,
                onTimePercentage,
                latePercentage,
                editedPercentage,
                kpiScore,
                kpiDetails: {
                    latePenalty: kpiSettings.latePenalty,
                    editPenalty: kpiSettings.editPenalty,
                    totalScore: onTimePercentage - (latePercentage * kpiSettings.latePenalty) - (editedPercentage * kpiSettings.editPenalty)
                }
            };
        });
        
        console.log(`[KPI LOG] ${statistics.length} ta xodim uchun statistika tayyor.`);
        console.log("[KPI LOG] Yakuniy statistika frontendga yuborilmoqda.");
        res.json(statistics);

    } catch (error) {
        console.error("/api/statistics/employees GET xatoligi:", error);
        res.status(500).json({ message: "Xodimlar statistikasini yuklashda xatolik." });
    }
});

// GET /api/statistics/employee/:id - Bitta xodimning oylik tabelini olish
router.get('/employee/:id', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        const userId = req.params.id;
        const month = req.query.month ? new Date(req.query.month) : new Date();
        console.log(`[KPI LOG] /employee/${userId} uchun batafsil statistika so'rovi. Oy: ${req.query.month}`);
        
        const startDate = startOfMonth(month);
        const endDate = endOfMonth(month);
        console.log(`[KPI LOG] Hisobotlar uchun sana oralig'i: ${format(startDate, 'yyyy-MM-dd')} dan ${format(endDate, 'yyyy-MM-dd')} gacha`);

        const reports = await db('reports as r')
            .where('r.created_by', userId)
            .whereBetween('r.report_date', [format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')])
            .groupBy('r.id')
            .select(
                'r.id',
                'r.report_date',
                'r.created_at',
                db.raw('(SELECT COUNT(*) FROM report_history WHERE report_id = r.id) as edit_count'),
                db.raw(`(SELECT u.username FROM report_history rh JOIN users u ON rh.changed_by = u.id WHERE rh.report_id = r.id ORDER BY rh.changed_at DESC LIMIT 1) as editorUsername`),
                db.raw(`(SELECT rh.changed_at FROM report_history rh WHERE rh.report_id = r.id ORDER BY rh.changed_at DESC LIMIT 1) as editedAt`)
            );

        const reportsByDate = reports.reduce((acc, report) => {
            acc[report.report_date] = report;
            return acc;
        }, {});

        const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });

        const dailyDetails = daysInMonth.map(day => {
            const dateString = format(day, 'yyyy-MM-dd');
            const report = reportsByDate[dateString];
            
            let status = 'not_submitted';
            let isEdited = false;
            let editorUsername = null;
            let editedAt = null;

            if (report) {
                const deadline = new Date(report.report_date);
                deadline.setDate(deadline.getDate() + 1);
                deadline.setHours(9, 0, 0, 0);
                const createdAt = new Date(report.created_at);

                status = createdAt <= deadline ? 'on_time' : 'late';
                isEdited = report.edit_count > 0;
                if (isEdited) {
                    editorUsername = report.editorUsername;
                    editedAt = report.editedAt;
                }
            }

            return {
                date: dateString,
                day: format(day, 'd'),
                status,
                isEdited,
                reportId: report ? report.id : null,
                editInfo: {
                    editor: editorUsername,
                    editedAt: editedAt
                }
            };
        });

        res.json(dailyDetails);

    } catch (error) {
        console.error(`/api/statistics/employee/${req.params.id} GET xatoligi:`, error);
        res.status(500).json({ message: "Xodimning batafsil statistikasini olishda xatolik." });
    }
});

module.exports = router;
