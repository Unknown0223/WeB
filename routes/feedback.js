const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');

// GET /api/feedback - Murojaatlarni olish (Pagination bilan)
router.get('/', isAuthenticated, hasPermission('reports:view_all'), async (req, res) => {
    try {
        const { type, startDate, endDate, page = 1, limit = 20 } = req.query;
        const currentPage = parseInt(page);
        const currentLimit = parseInt(limit);
        const offset = (currentPage - 1) * currentLimit;

        let query = db('feedbacks').select('*').orderBy('created_at', 'desc');
        let countQuery = db('feedbacks').count('* as total');

        if (type) {
            query.where('type', type);
            countQuery.where('type', type);
        }

        if (startDate) {
            query.whereRaw("date(created_at / 1000, 'unixepoch') >= ?", [startDate]);
            countQuery.whereRaw("date(created_at / 1000, 'unixepoch') >= ?", [startDate]);
        }

        if (endDate) {
            query.whereRaw("date(created_at / 1000, 'unixepoch') <= ?", [endDate]);
            countQuery.whereRaw("date(created_at / 1000, 'unixepoch') <= ?", [endDate]);
        }

        const totalResult = await countQuery.first();
        const total = totalResult.total || 0;
        const pages = Math.ceil(total / currentLimit);

        const feedbacks = await query.limit(currentLimit).offset(offset);

        res.json({
            feedbacks,
            pagination: {
                total,
                pages,
                currentPage,
                limit: currentLimit
            }
        });
    } catch (error) {
        console.error('Feedback fetch error:', error);
        res.status(500).json({ message: "Murojaatlarni yuklashda xatolik" });
    }
});

// POST /api/feedback/status - Holatni o'zgartirish
router.post('/status', isAuthenticated, hasPermission('reports:edit_all'), async (req, res) => {
    const { id, status } = req.body;
    try {
        await db('feedbacks').where({ id }).update({ status });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: "Holatni yangilashda xatolik" });
    }
});

module.exports = router;
