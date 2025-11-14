const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');

const router = express.Router();

// GET /api/dashboard/stats - Dashboard uchun barcha statistikani olish
router.get('/stats', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ message: "Sana parametri yuborilishi shart." });
        }

        // 1. Asosiy sozlamalar va foydalanuvchilar sonini olish
        const [settingsRow, usersCountResult] = await Promise.all([
            db('settings').where({ key: 'app_settings' }).first(),
            db('users').count('* as count').first()
        ]);

        const allLocations = settingsRow ? (JSON.parse(settingsRow.value).locations || []) : [];
        const totalUsers = usersCountResult.count;

        if (allLocations.length === 0) {
            return res.json({
                generalStats: { totalUsers, totalLocations: 0, dailyTotalReports: 0 },
                dailyStatus: { submittedCount: 0, statusData: [] },
                weeklyDynamics: []
            });
        }
        
        // 2. Tanlangan sana uchun topshirilgan hisobotlarni olish (QO'SHIMCHA MA'LUMOTLAR BILAN)
        const submittedReports = await db('reports as r')
            .leftJoin('users as u_creator', 'r.created_by', 'u_creator.id')
            .where('r.report_date', date)
            .select(
                'r.id',
                'r.location',
                'r.late_comment',
                'u_creator.username as creator_username',
                // Tahrirlar sonini hisoblash uchun subquery
                db.raw(`(
                    SELECT COUNT(h.id) 
                    FROM report_history h 
                    WHERE h.report_id = r.id
                ) as edit_count`),
                // Oxirgi tahrirlovchi username'ini olish uchun subquery
                db.raw(`(
                    SELECT u.username 
                    FROM report_history rh 
                    JOIN users u ON rh.changed_by = u.id 
                    WHERE rh.report_id = r.id 
                    ORDER BY rh.changed_at DESC 
                    LIMIT 1
                ) as last_edited_by`),
                // Oxirgi tahrir vaqtini olish uchun subquery
                db.raw(`(
                    SELECT rh.changed_at 
                    FROM report_history rh 
                    WHERE rh.report_id = r.id 
                    ORDER BY rh.changed_at DESC 
                    LIMIT 1
                ) as last_edited_at`)
            );
        
        const submittedLocations = new Set(submittedReports.map(r => r.location));

        const statusData = allLocations.map(location => {
            const reportForLocation = submittedReports.find(r => r.location === location);
            const isSubmitted = !!reportForLocation;
            
            let editInfo = null;
            if (isSubmitted && reportForLocation.edit_count > 0) {
                editInfo = {
                    count: reportForLocation.edit_count,
                    last_by: reportForLocation.last_edited_by,
                    last_at: reportForLocation.last_edited_at,
                };
            }

            return {
                name: location,
                submitted: isSubmitted,
                is_edited: isSubmitted && reportForLocation.edit_count > 0,
                edit_info: editInfo,
                late_comment: reportForLocation?.late_comment || null,
                creator: reportForLocation?.creator_username || null
            };
        });

        // 3. Oxirgi 7 kunlik hisobotlar dinamikasini olish
        const sevenDaysAgo = new Date(date);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const startDate = sevenDaysAgo.toISOString().split('T')[0];

        const weeklyDynamics = await db('reports')
            .select('report_date')
            .count('* as count')
            .where('report_date', '>=', startDate)
            .andWhere('report_date', '<=', date)
            .groupBy('report_date')
            .orderBy('report_date', 'asc');
            
        const weeklyDataMap = weeklyDynamics.reduce((acc, item) => {
            acc[item.report_date] = item.count;
            return acc;
        }, {});

        const finalWeeklyDynamics = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const formattedDate = d.toISOString().split('T')[0];
            finalWeeklyDynamics.push({
                date: formattedDate,
                count: weeklyDataMap[formattedDate] || 0
            });
        }

        res.json({
            generalStats: {
                totalUsers: totalUsers,
                totalLocations: allLocations.length,
                dailyTotalReports: submittedReports.length
            },
            dailyStatus: {
                submittedCount: submittedLocations.size,
                statusData: statusData
            },
            weeklyDynamics: finalWeeklyDynamics
        });

    } catch (error) {
        console.error("/api/dashboard/stats GET xatoligi:", error);
        res.status(500).json({ message: "Dashboard statistikasini yuklashda xatolik" });
    }
});

// Eski endpointni o'chiramiz, chunki u endi ishlatilmaydi.
router.get('/status', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    res.status(404).json({ message: "Bu endpoint eskirgan. Iltimos, /api/dashboard/stats'dan foydalaning." });
});

module.exports = router;
