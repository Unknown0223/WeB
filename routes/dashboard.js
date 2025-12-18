const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { getVisibleLocations } = require('../utils/roleFiltering.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('DASHBOARD');


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
        
        // Yangi logika: rol shartlari bo'yicha ko'rinadigan filiallarni olish
        const user = req.session.user;
        const visibleLocations = await getVisibleLocations(user);
        
        // Agar hech narsa ko'rinmasa, bo'sh natija qaytaramiz
        if (visibleLocations.length === 0 && user.role !== 'superadmin' && user.role !== 'super_admin') {
            return res.json({
                generalStats: { totalUsers, totalLocations: 0, dailyTotalReports: 0 },
                dailyStatus: { submittedCount: 0, statusData: [] },
                weeklyDynamics: []
            });
        }
        
        // Superadmin uchun barcha filiallar, boshqalar uchun faqat ko'rinadiganlar
        let locationsToShow = (user.role === 'superadmin' || user.role === 'super_admin') 
            ? allLocations 
            : allLocations.filter(loc => visibleLocations.includes(loc));

        if (allLocations.length === 0) {
            return res.json({
                generalStats: { totalUsers, totalLocations: 0, dailyTotalReports: 0 },
                dailyStatus: { submittedCount: 0, statusData: [] },
                weeklyDynamics: []
            });
        }
        
        // 2. Tanlangan sana uchun topshirilgan hisobotlarni olish (QO'SHIMCHA MA'LUMOTLAR BILAN)
        let submittedReportsQuery = db('reports as r')
            .leftJoin('users as u_creator', 'r.created_by', 'u_creator.id')
            .where('r.report_date', date);
        
        // Yangi logika: rol shartlari bo'yicha filtrlash
        if (user.role !== 'superadmin' && user.role !== 'super_admin') {
            if (visibleLocations.length > 0) {
                submittedReportsQuery = submittedReportsQuery.whereIn('r.location', visibleLocations);
            } else {
                // Agar hech narsa ko'rinmasa, bo'sh natija
                submittedReportsQuery = submittedReportsQuery.whereRaw('1 = 0');
            }
        }
        
        // Optimallashtirilgan - subquery o'rniga bir marta olish
        const submittedReports = await submittedReportsQuery
            .select(
                'r.id',
                'r.location',
                'r.late_comment',
                'u_creator.username as creator_username'
            );
        
        // Report history ma'lumotlarini bir marta olish (optimallashtirish)
        const reportIds = submittedReports.map(r => r.id);
        let editInfoMap = {};
        if (reportIds.length > 0) {
            // Barcha report history ma'lumotlarini bir marta olish (parallel)
            const [editCounts, allLastEdits] = await Promise.all([
                db('report_history')
                    .select('report_id')
                    .count('* as edit_count')
                    .whereIn('report_id', reportIds)
                    .groupBy('report_id'),
                db('report_history as rh')
                    .leftJoin('users as u', 'rh.changed_by', 'u.id')
                    .select('rh.report_id', 'u.username as last_edited_by', 'rh.changed_at')
                    .whereIn('rh.report_id', reportIds)
                    .orderBy('rh.changed_at', 'desc')
            ]);
            
            // Har bir report uchun eng so'nggi edit'ni topish (memory'da)
            const lastEdits = [];
            const seenReports = new Set();
            for (const edit of allLastEdits) {
                if (!seenReports.has(edit.report_id)) {
                    lastEdits.push(edit);
                    seenReports.add(edit.report_id);
                }
            }
            
            // Edit counts map
            const editCountMap = {};
            editCounts.forEach(item => {
                editCountMap[item.report_id] = parseInt(item.edit_count) || 0;
            });
            
            // Last edits map
            const lastEditMap = {};
            lastEdits.forEach(item => {
                lastEditMap[item.report_id] = {
                    last_edited_by: item.last_edited_by,
                    last_edited_at: item.changed_at
                };
            });
            
            // Birlashtirish
            reportIds.forEach(id => {
                editInfoMap[id] = {
                    edit_count: editCountMap[id] || 0,
                    last_edited_by: lastEditMap[id]?.last_edited_by || null,
                    last_edited_at: lastEditMap[id]?.last_edited_at || null
                };
            });
        }
        
        // Reports'ga edit info qo'shish
        submittedReports.forEach(report => {
            const editInfo = editInfoMap[report.id] || { edit_count: 0, last_edited_by: null, last_edited_at: null };
            report.edit_count = editInfo.edit_count;
            report.last_edited_by = editInfo.last_edited_by;
            report.last_edited_at = editInfo.last_edited_at;
        });
        
        const submittedLocations = new Set(submittedReports.map(r => r.location));

        const statusData = locationsToShow.map(location => {
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

        const weeklyDynamicsQuery = db('reports')
            .select('report_date')
            .count('* as count')
            .where('report_date', '>=', startDate)
            .andWhere('report_date', '<=', date);
        
        // Admin uchun filiallar cheklovi
        if (user.role === 'admin' && user.locations && user.locations.length > 0) {
            weeklyDynamicsQuery.whereIn('location', user.locations);
        }
        
        const weeklyDynamics = await weeklyDynamicsQuery
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

        // 4. Qo'shimcha statistikalar
        const totalReportsCountQuery = db('reports');
        if (user.role === 'admin' && user.locations && user.locations.length > 0) {
            totalReportsCountQuery.whereIn('location', user.locations);
        }
        const totalReportsCount = await totalReportsCountQuery.count('* as count').first();
        
        const editedReportsCountQuery = db('reports')
            .whereExists(function() {
                this.select('*').from('report_history').whereRaw('report_history.report_id = reports.id');
            });
        if (user.role === 'admin' && user.locations && user.locations.length > 0) {
            editedReportsCountQuery.whereIn('location', user.locations);
        }
        const editedReportsCount = await editedReportsCountQuery.count('* as count').first();
        
        const lateReportsCountQuery = db('reports')
            .where('report_date', date)
            .whereNotNull('late_comment');
        if (user.role === 'admin' && user.locations && user.locations.length > 0) {
            lateReportsCountQuery.whereIn('location', user.locations);
        }
        const lateReportsCount = await lateReportsCountQuery.count('* as count').first();
            
        const onTimeReportsCount = submittedReports.length - (lateReportsCount?.count || 0);
        
        const activeUsersCount = await db('users')
            .where('status', 'active')
            .count('* as count')
            .first();
            
        const pendingUsersCount = await db('pending_registrations')
            .count('* as count')
            .first();

        res.json({
            generalStats: {
                totalUsers: totalUsers,
                totalLocations: locationsToShow.length,
                dailyTotalReports: submittedReports.length
            },
            dailyStatus: {
                submittedCount: submittedLocations.size,
                statusData: statusData
            },
            weeklyDynamics: finalWeeklyDynamics,
            additionalStats: {
                totalReports: totalReportsCount.count,
                editedReports: editedReportsCount.count,
                lateReports: lateReportsCount.count,
                onTimeReports: onTimeReportsCount,
                activeUsers: activeUsersCount.count,
                pendingUsers: pendingUsersCount.count,
                submittedPercent: allLocations.length > 0 ? ((submittedLocations.size / allLocations.length) * 100).toFixed(1) : 0,
                notSubmittedCount: allLocations.length - submittedLocations.size
            }
        });

    } catch (error) {
        log.error("/api/dashboard/stats GET xatoligi:", error);
        res.status(500).json({ message: "Dashboard statistikasini yuklashda xatolik" });
    }
});

// GET /api/dashboard/chart-data - Turli xil grafiklar uchun ma'lumotlar
router.get('/chart-data', isAuthenticated, hasPermission('dashboard:view'), async (req, res) => {
    try {
        const { type, date } = req.query;
        
        if (!type || !date) {
            return res.status(400).json({ message: "Type va date parametrlari zarur." });
        }
        
        let chartData = {};
        
        switch(type) {
                        case 'by_brand':
                            // Brendlar bo'yicha statistika
                            // 1. Barcha brendlarni va ularning rangini olish
                            const brands = await db('brands').select('id', 'name', 'color');
                            // 2. Brend-filial bog'lanishini olish
                            const brandLocations = await db('brand_locations');
                            // 3. Sana bo'yicha barcha hisobotlarni olish
                            const reports = await db('reports').where('report_date', date);

                            // 4. Har bir brend uchun hisobotlar sonini hisoblash
                            const brandStats = brands.map(brand => {
                                // Ushbu brendga tegishli filiallar
                                const locations = brandLocations.filter(bl => bl.brand_id === brand.id).map(bl => bl.location_name);
                                // Ushbu brendga tegishli hisobotlar soni (shu brendga biriktirilgan filiallar bo'yicha)
                                const count = reports.filter(r => locations.includes(r.location)).length;
                                return {
                                    brand: brand.name,
                                    count,
                                    color: brand.color || '#4facfe'
                                };
                            });
                            chartData = brandStats;
                            break;
            case 'weekly':
                // Haftalik dinamika (7 kun)
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
                
                const finalWeeklyData = [];
                for (let i = 0; i < 7; i++) {
                    const d = new Date(startDate);
                    d.setDate(d.getDate() + i);
                    const formattedDate = d.toISOString().split('T')[0];
                    finalWeeklyData.push({
                        date: formattedDate,
                        count: weeklyDataMap[formattedDate] || 0
                    });
                }
                chartData = finalWeeklyData;
                break;
                
            case 'monthly':
                // Oylik dinamika (30 kun)
                const thirtyDaysAgo = new Date(date);
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
                const monthStartDate = thirtyDaysAgo.toISOString().split('T')[0];
                
                const monthlyDynamics = await db('reports')
                    .select('report_date')
                    .count('* as count')
                    .where('report_date', '>=', monthStartDate)
                    .andWhere('report_date', '<=', date)
                    .groupBy('report_date')
                    .orderBy('report_date', 'asc');
                
                const monthlyDataMap = monthlyDynamics.reduce((acc, item) => {
                    acc[item.report_date] = item.count;
                    return acc;
                }, {});
                
                const finalMonthlyData = [];
                for (let i = 0; i < 30; i++) {
                    const d = new Date(monthStartDate);
                    d.setDate(d.getDate() + i);
                    const formattedDate = d.toISOString().split('T')[0];
                    finalMonthlyData.push({
                        date: formattedDate,
                        count: monthlyDataMap[formattedDate] || 0
                    });
                }
                chartData = finalMonthlyData;
                break;
                
            case 'by_location':
                // Filiallar bo'yicha statistika
                const settingsRow = await db('settings').where({ key: 'app_settings' }).first();
                const allLocations = settingsRow ? (JSON.parse(settingsRow.value).locations || []) : [];
                
                const locationStats = await db('reports')
                    .select('location')
                    .count('* as count')
                    .where('report_date', date)
                    .groupBy('location');
                
                const locationMap = locationStats.reduce((acc, item) => {
                    acc[item.location] = item.count;
                    return acc;
                }, {});
                
                chartData = allLocations.map(loc => ({
                    location: loc,
                    count: locationMap[loc] || 0
                }));
                break;
                
            case 'by_user':
                // Foydalanuvchilar bo'yicha statistika (bugungi kun)
                const userStats = await db('reports as r')
                    .join('users as u', 'r.created_by', 'u.id')
                    .select('u.username', 'u.fullname')
                    .count('r.id as count')
                    .where('r.report_date', date)
                    .groupBy('u.id', 'u.username', 'u.fullname')
                    .orderBy('count', 'desc')
                    .limit(10);
                
                chartData = userStats.map(item => ({
                    user: item.fullname || item.username,
                    count: item.count
                }));
                break;
                
            case 'late_vs_ontime':
                // Kechikkan vs O'z vaqtida
                const lateCount = await db('reports')
                    .where('report_date', date)
                    .whereNotNull('late_comment')
                    .count('* as count')
                    .first();
                
                const totalCount = await db('reports')
                    .where('report_date', date)
                    .count('* as count')
                    .first();
                
                chartData = {
                    late: lateCount.count || 0,
                    onTime: (totalCount.count || 0) - (lateCount.count || 0)
                };
                break;
                
            case 'edited_reports':
                // Tahrirlangan hisobotlar dinamikasi (7 kun)
                const editedSevenDaysAgo = new Date(date);
                editedSevenDaysAgo.setDate(editedSevenDaysAgo.getDate() - 6);
                const editedStartDate = editedSevenDaysAgo.toISOString().split('T')[0];
                
                const editedDynamics = await db('reports as r')
                    .select('r.report_date')
                    .count('r.id as count')
                    .whereExists(function() {
                        this.select('*').from('report_history').whereRaw('report_history.report_id = r.id');
                    })
                    .where('r.report_date', '>=', editedStartDate)
                    .andWhere('r.report_date', '<=', date)
                    .groupBy('r.report_date')
                    .orderBy('r.report_date', 'asc');
                
                const editedDataMap = editedDynamics.reduce((acc, item) => {
                    acc[item.report_date] = item.count;
                    return acc;
                }, {});
                
                const finalEditedData = [];
                for (let i = 0; i < 7; i++) {
                    const d = new Date(editedStartDate);
                    d.setDate(d.getDate() + i);
                    const formattedDate = d.toISOString().split('T')[0];
                    finalEditedData.push({
                        date: formattedDate,
                        count: editedDataMap[formattedDate] || 0
                    });
                }
                chartData = finalEditedData;
                break;
                
            default:
                return res.status(400).json({ message: "Noto'g'ri grafik turi." });
        }
        
        res.json({ type, data: chartData });
        
    } catch (error) {
        log.error("/api/dashboard/chart-data GET xatoligi:", error);
        res.status(500).json({ message: "Grafik ma'lumotlarini yuklashda xatolik" });
    }
});

module.exports = router;
