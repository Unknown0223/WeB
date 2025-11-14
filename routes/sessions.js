const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');

const router = express.Router();

// DELETE /api/sessions/:sid - Muayyan sessiyani tugatish
router.delete('/:sid', isAuthenticated, async (req, res) => {
    const sidToDelete = req.params.sid;
    const currentUser = req.session.user;

    try {
        // O'chirilmoqchi bo'lgan sessiyani topamiz
        const sessionToDelete = await db('sessions').where({ sid: sidToDelete }).first();
        if (!sessionToDelete) {
            return res.status(404).json({ message: "Sessiya topilmadi yoki allaqachon tugatilgan." });
        }

        const sessionData = JSON.parse(sessionToDelete.sess);
        const sessionOwnerId = sessionData.user?.id;

        // Tekshiruv: Admin hamma sessiyani o'chira oladi, oddiy foydalanuvchi faqat o'zinikini.
        const isAdmin = currentUser.permissions.includes('users:manage_sessions');
        const isOwner = sessionOwnerId === currentUser.id;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: "Sizda bu sessiyani tugatish uchun ruxsat yo'q." });
        }
        
        // Foydalanuvchi o'zining joriy sessiyasini o'chira olmaydi (bu logout orqali qilinadi)
        if (sidToDelete === req.sessionID) {
            return res.status(400).json({ message: "Joriy sessiyani bu yerdan tugatib bo'lmaydi. Tizimdan chiqish tugmasini ishlating." });
        }

        const result = await db('sessions').where({ sid: sidToDelete }).del();
        
        if (result === 0) {
            // Bu holat kamdan-kam yuz beradi, lekin tekshirib qo'ygan yaxshi
            return res.status(404).json({ message: "Sessiyani o'chirib bo'lmadi." });
        }

        res.json({ message: "Sessiya muvaffaqiyatli tugatildi." });
    } catch (error) {
        console.error(`/api/sessions/${sidToDelete} DELETE xatoligi:`, error);
        res.status(500).json({ message: "Sessiyani tugatishda xatolik." });
    }
});

module.exports = router;
