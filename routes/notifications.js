const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('NOTIFICATIONS');


const router = express.Router();

// Bir kun oldingi notification'larni o'chirish funksiyasi
async function cleanupOldNotifications() {
    try {
        // Jadval mavjudligini tekshirish - try-catch orqali
        let hasTable = false;
        try {
            await db('notifications').limit(1);
            hasTable = true;
        } catch (err) {
            // Jadval mavjud emas
            hasTable = false;
        }
        
        if (!hasTable) {
            log.debug('⚠️ [NOTIFICATIONS] Notifications jadvali hali yaratilmagan, tozalash o\'tkazib yuborildi');
            return;
        }
        
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        
        const deleted = await db('notifications')
            .where('created_at', '<', oneDayAgo.toISOString())
            .del();
        
        if (deleted > 0) {
            log.debug(`✅ [NOTIFICATIONS] ${deleted} ta eski bildirishnoma o'chirildi`);
        }
    } catch (error) {
        // Agar jadval mavjud emas bo'lsa, xatolikni e'tiborsiz qoldirish
        if (error.code === 'SQLITE_ERROR' && error.message.includes('no such table')) {
            log.debug('⚠️ [NOTIFICATIONS] Notifications jadvali hali yaratilmagan');
            return;
        }
        log.error('❌ [NOTIFICATIONS] Eski bildirishnomalarni o\'chirishda xatolik:', error);
    }
}

// Har 1 soatda bir marta eski notification'larni tozalash
setInterval(cleanupOldNotifications, 60 * 60 * 1000); // 1 soat

// Server ishga tushganda bir marta tozalash
cleanupOldNotifications();

/**
 * GET /api/notifications
 * Foydalanuvchining bildirishnomalarini olish
 */
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { unread_only } = req.query;

        let query = db('notifications')
            .where('user_id', userId)
            .orderBy('created_at', 'desc')
            .limit(100);

        if (unread_only === 'true') {
            query = query.where('is_read', false);
        }

        const notifications = await query;

        // Unread count
        const unreadCount = await db('notifications')
            .where('user_id', userId)
            .where('is_read', false)
            .count('id as count')
            .first();

        res.json({
            success: true,
            notifications: notifications.map(n => ({
                ...n,
                details: n.details ? JSON.parse(n.details) : null
            })),
            unread_count: unreadCount ? parseInt(unreadCount.count) : 0
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/notifications/:id/read
 * Bildirishnomani o'qilgan deb belgilash
 */
router.put('/:id/read', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const notificationId = req.params.id;

        // Bildirishnoma foydalanuvchiga tegishli ekanligini tekshirish
        const notification = await db('notifications')
            .where('id', notificationId)
            .where('user_id', userId)
            .first();

        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Bildirishnoma topilmadi'
            });
        }

        // O'qilgan deb belgilash
        await db('notifications')
            .where('id', notificationId)
            .update({
                is_read: true,
                read_at: db.fn.now()
            });

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [NOTIFICATIONS] Bildirishnoma o'qilgan deb belgilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('notification_read', {
                notificationId: parseInt(notificationId),
                userId: userId,
                is_read: true
            });
            log.debug(`✅ [NOTIFICATIONS] WebSocket yuborildi: notification_read`);
        }

        res.json({
            success: true,
            message: 'Bildirishnoma o\'qilgan deb belgilandi'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/notifications/read-all
 * Barcha bildirishnomalarni o'qilgan deb belgilash
 */
router.put('/read-all', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const updatedCount = await db('notifications')
            .where('user_id', userId)
            .where('is_read', false)
            .update({
                is_read: true,
                read_at: db.fn.now()
            });

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket && updatedCount > 0) {
            log.debug(`📡 [NOTIFICATIONS] Barcha bildirishnomalar o'qilgan deb belgilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('notifications_read_all', {
                userId: userId,
                count: updatedCount
            });
            log.debug(`✅ [NOTIFICATIONS] WebSocket yuborildi: notifications_read_all`);
        }

        res.json({
            success: true,
            message: 'Barcha bildirishnomalar o\'qilgan deb belgilandi'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

