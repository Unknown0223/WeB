const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('SECURITY');


const router = express.Router();

// GET /api/security/statistics - Xavfsizlik statistikasini olish
router.get('/statistics', isAuthenticated, async (req, res) => {
    const currentUser = req.session.user;
    
    // Tekshiruv: Faqat admin va roles:manage permissionga ega foydalanuvchilar
    const hasPermission = currentUser.permissions.includes('roles:manage') || currentUser.permissions.includes('users:manage_sessions');
    
    if (!hasPermission) {
        return res.status(403).json({ message: "Sizda statistikani ko'rish uchun ruxsat yo'q." });
    }

    try {
        // Aktiv sessiyalar soni
        const activeSessionsCount = await db('sessions').count('* as count').first();
        
        // So'nggi 24 soat ichidagi muvaffaqiyatli loginlar
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const successfulLoginsCount = await db('audit_logs')
            .where('action', 'login_success')
            .where('timestamp', '>=', oneDayAgo)
            .count('* as count')
            .first();
        
        // So'nggi 24 soat ichidagi muvaffaqiyatsiz loginlar
        const failedLoginsCount = await db('audit_logs')
            .where('action', 'login_fail')
            .where('timestamp', '>=', oneDayAgo)
            .count('* as count')
            .first();
        
        // Bloklangan IP'lar soni (hozircha 0, keyinchalik qo'shamiz)
        const blockedIpsCount = 0;

        res.json({
            active_sessions: activeSessionsCount.count || 0,
            successful_logins: successfulLoginsCount.count || 0,
            failed_logins: failedLoginsCount.count || 0,
            blocked_ips: blockedIpsCount
        });
    } catch (error) {
        log.error('GET /api/security/statistics xatoligi:', error);
        res.status(500).json({ message: "Statistikani yuklashda xatolik." });
    }
});

// GET /api/security/logs - Xavfsizlik loglarini olish
router.get('/logs', isAuthenticated, async (req, res) => {
    const currentUser = req.session.user;
    
    // Tekshiruv: Faqat admin va audit:view permissionga ega foydalanuvchilar
    const hasPermission = currentUser.permissions.includes('audit:view') || currentUser.permissions.includes('roles:manage');
    
    if (!hasPermission) {
        return res.status(403).json({ message: "Sizda loglarni ko'rish uchun ruxsat yo'q." });
    }

    try {
        const { type, date, limit = 100 } = req.query;
        
        let query = db('audit_logs')
            .select('audit_logs.*', 'users.username', 'users.fullname')
            .leftJoin('users', 'audit_logs.user_id', 'users.id')
            .orderBy('audit_logs.timestamp', 'desc')
            .limit(parseInt(limit));
        
        // Filter bo'yicha
        if (type && type !== 'all') {
            if (type === 'login') {
                query = query.where('audit_logs.action', 'login_success');
            } else if (type === 'logout') {
                query = query.where('audit_logs.action', 'logout');
            } else if (type === 'failed') {
                query = query.where('audit_logs.action', 'login_fail');
            } else if (type === 'blocked') {
                query = query.where('audit_logs.action', 'account_lock');
            } else if (type === 'suspicious') {
                query = query.where('audit_logs.action', 'suspicious_activity');
            }
        }
        
        // Sana bo'yicha filter
        if (date) {
            const filterDate = new Date(date);
            const nextDay = new Date(filterDate);
            nextDay.setDate(nextDay.getDate() + 1);
            
            query = query
                .where('audit_logs.timestamp', '>=', filterDate.toISOString())
                .where('audit_logs.timestamp', '<', nextDay.toISOString());
        }
        
        const logs = await query;
        
        // Loglarni formatlash
        const formattedLogs = logs.map(log => {
            let logType = 'login';
            let message = 'Tizimga kirish';
            
            if (log.action === 'logout') {
                logType = 'logout';
                message = 'Tizimdan chiqish';
            } else if (log.action === 'login_fail') {
                logType = 'failed';
                message = 'Tizimga kirish muvaffaqiyatsiz bo\'ldi';
            } else if (log.action === 'account_lock') {
                logType = 'blocked';
                message = 'Akkaunt bloklandi';
            } else if (log.action === 'suspicious_activity') {
                logType = 'suspicious';
                message = 'Shubhali faollik aniqlandi';
            } else if (log.action === 'login_success') {
                logType = 'login';
                message = 'Tizimga muvaffaqiyatli kirish';
            }
            
            return {
                id: log.id,
                type: logType,
                message: message,
                username: log.username || 'Noma\'lum',
                full_name: log.fullname || '',
                ip_address: log.ip_address || 'Unknown',
                timestamp: log.timestamp,
                details: log.details
            };
        });

        res.json(formattedLogs);
    } catch (error) {
        log.error('GET /api/security/logs xatoligi:', error);
        res.status(500).json({ message: "Loglarni yuklashda xatolik." });
    }
});

// GET /api/security/settings - Xavfsizlik sozlamalarini olish
router.get('/settings', isAuthenticated, async (req, res) => {
    const currentUser = req.session.user;
    
    // Tekshiruv: Faqat admin
    const hasPermission = currentUser.permissions.includes('roles:manage') || currentUser.permissions.includes('settings:edit_general');
    
    if (!hasPermission) {
        return res.status(403).json({ message: "Sizda sozlamalarni ko'rish uchun ruxsat yo'q." });
    }

    try {
        // Hozircha default qiymatlar, keyinchalik database'dan olamiz
        const settings = {
            session_timeout: 60,
            max_sessions: 5,
            remember_me: true,
            force_2fa: false,
            block_multiple_logins: false,
            failed_login_limit: 5,
            block_duration: 30,
            notify_new_login: true,
            notify_failed_login: true,
            notify_telegram: false
        };

        res.json(settings);
    } catch (error) {
        log.error('GET /api/security/settings xatoligi:', error);
        res.status(500).json({ message: "Sozlamalarni yuklashda xatolik." });
    }
});

// POST /api/security/settings - Xavfsizlik sozlamalarini saqlash
router.post('/settings', isAuthenticated, async (req, res) => {
    const currentUser = req.session.user;
    
    // Tekshiruv: Faqat admin
    const hasPermission = currentUser.permissions.includes('roles:manage') || currentUser.permissions.includes('settings:edit_general');
    
    if (!hasPermission) {
        return res.status(403).json({ message: "Sizda sozlamalarni o'zgartirish uchun ruxsat yo'q." });
    }

    try {
        const settings = req.body;
        
        // Validatsiya
        if (settings.session_timeout < 5 || settings.session_timeout > 1440) {
            return res.status(400).json({ message: "Sessiya timeout 5 dan 1440 daqiqa oralig'ida bo'lishi kerak." });
        }
        
        if (settings.max_sessions < 1 || settings.max_sessions > 20) {
            return res.status(400).json({ message: "Maksimal sessiyalar soni 1 dan 20 gacha bo'lishi kerak." });
        }
        
        if (settings.failed_login_limit < 3 || settings.failed_login_limit > 20) {
            return res.status(400).json({ message: "Muvaffaqiyatsiz login limiti 3 dan 20 gacha bo'lishi kerak." });
        }
        
        if (settings.block_duration < 5 || settings.block_duration > 1440) {
            return res.status(400).json({ message: "Bloklash davri 5 dan 1440 daqiqa oralig'ida bo'lishi kerak." });
        }

        // Hozircha console'ga yozib qo'yamiz, keyinchalik database'ga saqlaymiz
        log.debug('Yangi xavfsizlik sozlamalari:', settings);
        
        // Keyinroq settings jadvalida saqlaymiz
        // await db('settings').where({ key: 'security' }).update({ value: JSON.stringify(settings) });

        res.json({ 
            message: "Sozlamalar muvaffaqiyatli saqlandi.",
            settings: settings
        });
    } catch (error) {
        log.error('POST /api/security/settings xatoligi:', error);
        res.status(500).json({ message: "Sozlamalarni saqlashda xatolik." });
    }
});

module.exports = router;
