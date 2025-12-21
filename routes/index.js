// routes/index.js

const express = require('express');
const router = express.Router();

// Barcha routerlarni import qilish va ularni to'g'ri yo'llarga ulash
// Auth route'larini /auth path bilan qo'shish (barcha auth endpoint'lari /api/auth/... formatida)
router.use('/auth', require('./auth.js'));
router.use('/user', require('./auth.js')); // User-specific endpoints (preferred-currency, etc.)
router.use('/users', require('./users.js'));
router.use('/sessions', require('./sessions.js'));
router.use('/reports', require('./reports.js'));
router.use('/settings', require('./settings.js'));
router.use('/pivot', require('./pivot.js'));
router.use('/dashboard', require('./dashboard.js'));
router.use('/roles', require('./roles.js'));
router.use('/telegram', require('./telegram.js'));
router.use('/admin', require('./admin.js'));
router.use('/statistics', require('./statistics.js'));
router.use('/brands', require('./brands.js'));

router.use('/security', require('./security.js'));
router.use('/exchange-rates', require('./exchangeRates.js'));
router.use('/comparison', require('./comparison.js'));
router.use('/notifications', require('./notifications.js'));

const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { db } = require('../db.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('INDEX');


// GET /api/user/preferred-currency - Foydalanuvchi valyuta sozlamasini olish
router.get('/user/preferred-currency', isAuthenticated, async (req, res) => {
    try {
        const user = await db('users').where({ id: req.session.user.id }).first();
        const preferredCurrency = user?.preferred_currency || null;
        res.json({ currency: preferredCurrency });
    } catch (error) {
        log.error('Currency fetch error:', error);
        res.status(500).json({ message: "Valyuta sozlamasini olishda xatolik." });
    }
});

// POST /api/user/preferred-currency - Foydalanuvchi valyuta sozlamasini saqlash
router.post('/user/preferred-currency', isAuthenticated, async (req, res) => {
    const { currency } = req.body;
    
    if (!currency || typeof currency !== 'string') {
        return res.status(400).json({ message: "Valyuta tanlash majburiy." });
    }
    
    const allowedCurrencies = ['UZS', 'USD', 'EUR', 'RUB', 'KZT'];
    if (!allowedCurrencies.includes(currency)) {
        return res.status(400).json({ message: "Noto'g'ri valyuta tanlandi." });
    }
    
    try {
        await db('users')
            .where({ id: req.session.user.id })
            .update({ preferred_currency: currency });
        
        // Session'ni yangilash
        req.session.user.preferred_currency = currency;
        
        res.json({ message: "Valyuta sozlamasi saqlandi.", currency });
    } catch (error) {
        log.error('Currency save error:', error);
        res.status(500).json({ message: "Valyuta sozlamasini saqlashda xatolik." });
    }
});

// Audit log statistikasini olish
router.get('/audit-logs/stats', isAuthenticated, hasPermission('audit:view'), async (req, res) => {
    try {
        // Jami audit loglar soni
        const totalResult = await db('audit_logs').count('* as total').first();
        const total = totalResult.total || 0;
        
        // Bugungi audit loglar soni
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayResult = await db('audit_logs')
            .where('timestamp', '>=', today.toISOString())
            .count('* as today')
            .first();
        const todayCount = todayResult.today || 0;
        
        res.json({
            total,
            today: todayCount
        });
    } catch (error) {
        log.error("/api/audit-logs/stats GET xatoligi:", error);
        res.status(500).json({ message: "Audit log statistikasini yuklashda xatolik." });
    }
});

// Audit jurnallarini olish uchun endpoint
router.get('/audit-logs', isAuthenticated, hasPermission('audit:view'), async (req, res) => {
    // ... (bu qism o'zgarishsiz qoladi)
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
        log.error("/api/audit-logs GET xatoligi:", error);
        res.status(500).json({ message: "Jurnal ma'lumotlarini yuklashda xatolik." });
    }
});

module.exports = router;
