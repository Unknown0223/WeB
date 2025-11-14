const express = require('express');
const router = express.Router();

// Barcha routerlarni import qilish va ularni to'g'ri yo'llarga ulash
router.use(require('./auth.js'));
router.use('/users', require('./users.js'));
router.use('/sessions', require('./sessions.js'));
router.use('/reports', require('./reports.js'));
router.use('/settings', require('./settings.js'));
router.use('/dashboard', require('./dashboard.js'));
router.use('/roles', require('./roles.js'));
router.use('/telegram', require('./telegram.js'));
router.use('/admin', require('./admin.js'));
router.use('/statistics', require('./statistics.js'));
router.use('/pivot-templates', require('./pivot_templates.js'));

const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { db } = require('../db.js');

// Audit jurnallarini olish uchun endpoint
router.get('/audit-logs', isAuthenticated, hasPermission('audit:view'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const offset = (page - 1) * limit;

        const { userId, startDate, endDate, actionType } = req.query;

        const query = db('audit_logs as a').leftJoin('users as u', 'a.user_id', 'u.id');

        if (userId) {
            query.where('a.user_id', userId);
        }
        if (startDate) {
            query.where('a.timestamp', '>=', `${startDate} 00:00:00`);
        }
        if (endDate) {
            query.where('a.timestamp', '<=', `${endDate} 23:59:59`);
        }
        if (actionType) {
            query.where('a.action', actionType);
        }

        const totalResult = await query.clone().count('* as total').first();
        const total = totalResult.total;
        const pages = Math.ceil(total / limit);
        
        const logs = await query
            .select('a.*', 'u.username')
            .orderBy('a.timestamp', 'desc')
            .limit(limit)
            .offset(offset);

        res.json({
            logs,
            pagination: {
                total,
                pages,
                currentPage: page
            }
        });
    } catch (error) {
        console.error("/api/audit-logs GET xatoligi:", error);
        res.status(500).json({ message: "Jurnal ma'lumotlarini yuklashda xatolik." });
    }
});

module.exports = router;
