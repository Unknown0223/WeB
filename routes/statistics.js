// routes/statistics.js

const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
// ===== MUAMMO TUZATILGAN JOY (1): Importni aniqlashtirish =====
const { endOfMonth, startOfMonth, eachDayOfInterval, format } = require('date-fns');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('STATISTICS');


const router = express.Router();

// GET /api/statistics/employees - Xodimlar bo'yicha hisobot statistikasini olish
router.get('/employees', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        const kpiSettingsRow = await db('settings').where({ key: 'kpi_settings' }).first();
        const kpiSettings = kpiSettingsRow ? JSON.parse(kpiSettingsRow.value) : { latePenalty: 0.5, editPenalty: 0.3, roleFilter: [] };

        const month = req.query.month ? new Date(req.query.month) : new Date();
        const startDate = format(startOfMonth(month), 'yyyy-MM-dd');
        const endDate = format(endOfMonth(month), 'yyyy-MM-dd');
        
        // Sozlamalardan rol filtri olish
        const roleFilter = kpiSettings.roleFilter || [];

        let employeesQuery = db('users as u')
            .leftJoin('user_locations as ul', 'u.id', 'ul.user_id')
            .where('u.status', 'active')
            .groupBy('u.id', 'u.username', 'u.fullname', 'u.role')
            .select(
                'u.id', 
                'u.username', 
                'u.fullname',
                'u.role',
                db.raw("GROUP_CONCAT(ul.location_name) as locations")
            );
        
        // Agar rol filtri belgilangan bo'lsa, faqat shu rollardagi foydalanuvchilarni olish
        if (roleFilter && roleFilter.length > 0) {
            employeesQuery = employeesQuery.whereIn('u.role', roleFilter);
        }

        const employees = await employeesQuery;

        if (employees.length === 0) {
            return res.json([]);
        }

        const employeeIds = employees.map(e => e.id);

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
                locations: employee.locations ? employee.locations.split(',') : [],
                totalSubmitted,
                onTimeCount,
                lateCount,
                totalEdited,
                onTimePercentage,
                latePercentage,
                editedPercentage,
                kpiScore
            };
        });

        res.json(statistics);

    } catch (error) {
        log.error("/api/statistics/employees GET xatoligi:", error);
        res.status(500).json({ message: "Xodimlar statistikasini yuklashda xatolik." });
    }
});

// GET /api/statistics/employee/:id - Bitta xodimning oylik tabelini olish
router.get('/employee/:id', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        const userId = req.params.id;
        const month = req.query.month ? new Date(req.query.month) : new Date();
        
        const startDate = startOfMonth(month);
        const endDate = endOfMonth(month);

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
                editorUsername,
                editedAt
            };
        });

        res.json(dailyDetails);

    } catch (error) {
        log.error(`/api/statistics/employee/${req.params.id} GET xatoligi:`, error);
        res.status(500).json({ message: "Xodimning batafsil statistikasini olishda xatolik." });
    }
});

// GET /api/statistics/report/:reportId/history - Hisobot tahrir tarixini olish
router.get('/report/:reportId/history', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        const reportId = req.params.reportId;
        
        const history = await db('report_history as h')
            .leftJoin('users as u', 'h.changed_by', 'u.id')
            .where('h.report_id', reportId)
            .orderBy('h.changed_at', 'desc')
            .select(
                'h.id',
                'h.old_data',
                'h.changed_at',
                'u.username as changed_by_username',
                'u.fullname as changed_by_fullname'
            );
        
        // Hozirgi hisobot ma'lumotlarini olish (yangi qiymatlar)
        const currentReport = await db('reports').where({ id: reportId }).first();
        
        // old_data JSON parse qilib, har bir o'zgarishni ajratamiz
        const detailedHistory = [];
        
        for (let i = 0; i < history.length; i++) {
            const record = history[i];
            try {
                const oldData = JSON.parse(record.old_data);
                
                // Keyingi tahrirdagi old_data bu hozirgi new_value
                let newData = {};
                if (i === 0 && currentReport) {
                    // Eng oxirgi tahrir - hozirgi qiymatlar (data JSON dan)
                    newData = JSON.parse(currentReport.data);
                } else if (i > 0) {
                    // Oldingi tahrirdan olish
                    newData = JSON.parse(history[i - 1].old_data);
                }
                
                // Barcha maydonlarni qo'shish (faqat old_data dan)
                for (const [field, oldValue] of Object.entries(oldData)) {
                    const newValue = newData[field];
                    
                    detailedHistory.push({
                        id: `${record.id}_${field}`,
                        field_name: field,
                        old_value: oldValue !== null && oldValue !== undefined ? String(oldValue) : '',
                        new_value: newValue !== null && newValue !== undefined ? String(newValue) : '',
                        changed_at: record.changed_at,
                        changed_by_username: record.changed_by_username,
                        changed_by_fullname: record.changed_by_fullname
                    });
                }
            } catch (parseError) {
                log.error('old_data parse error:', parseError);
            }
        }
        
        res.json(detailedHistory);
        
    } catch (error) {
        log.error(`/api/statistics/report/${req.params.reportId}/history GET xatoligi:`, error);
        res.status(500).json({ message: "Hisobot tahrir tarixini olishda xatolik." });
    }
});

module.exports = router;
