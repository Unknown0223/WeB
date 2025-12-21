const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');
const geoip = require('geoip-lite');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('SESSIONS');


const router = express.Router();

// IP manzildan geolokatsiya ma'lumotlarini olish
function getLocationFromIP(ip) {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
        return {
            country: 'UZ',
            countryName: 'O\'zbekiston',
            region: 'TAS',
            city: 'Toshkent',
            timezone: 'Asia/Tashkent',
            ll: [41.2995, 69.2401]
        };
    }
    
    const geo = geoip.lookup(ip);
    if (geo) {
        return {
            country: geo.country,
            countryName: getCountryName(geo.country),
            region: geo.region,
            city: geo.city || 'Noma\'lum',
            timezone: geo.timezone,
            ll: geo.ll
        };
    }
    
    return {
        country: 'Unknown',
        countryName: 'Noma\'lum',
        region: 'Unknown',
        city: 'Noma\'lum',
        timezone: 'UTC',
        ll: [0, 0]
    };
}

// Mamlakat kodini o'zbek tiliga tarjima qilish
function getCountryName(countryCode) {
    const countries = {
        'UZ': 'O\'zbekiston',
        'RU': 'Rossiya',
        'KZ': 'Qozog\'iston',
        'TR': 'Turkiya',
        'US': 'AQSh',
        'GB': 'Buyuk Britaniya',
        'DE': 'Germaniya',
        'FR': 'Fransiya',
        'CN': 'Xitoy',
        'IN': 'Hindiston',
        'JP': 'Yaponiya',
        'KR': 'Janubiy Koreya'
    };
    return countries[countryCode] || countryCode;
}

// GET /api/sessions/all - Barcha sessiyalarni olish (admin uchun)
router.get('/all', isAuthenticated, async (req, res) => {
    const currentUser = req.session.user;
    
    // Tekshiruv: Faqat admin va roles:manage permissionga ega foydalanuvchilar
    const hasPermission = currentUser.permissions.includes('roles:manage') || currentUser.permissions.includes('users:manage_sessions');
    
    if (!hasPermission) {
        return res.status(403).json({ message: "Sizda barcha sessiyalarni ko'rish uchun ruxsat yo'q." });
    }

    try {
        const sessions = await db('sessions').select('*');
        const formattedSessions = sessions.map(session => {
            try {
                const sessionData = JSON.parse(session.sess);
                const user = sessionData.user || {};
                const ipAddress = sessionData.ip_address || 'Unknown';
                const location = getLocationFromIP(ipAddress);
                
                return {
                    sid: session.sid,
                    user_id: user.id,
                    username: user.username,
                    full_name: user.fullname,
                    user_agent: sessionData.user_agent || 'Unknown',
                    ip_address: ipAddress,
                    location: location,
                    last_activity: session.expire,
                    is_current: session.sid === req.sessionID
                };
            } catch (parseError) {
                log.error('Session parse xatoligi:', parseError);
                return null;
            }
        }).filter(s => s !== null);

        res.json(formattedSessions);
    } catch (error) {
        log.error('GET /api/sessions/all xatoligi:', error);
        res.status(500).json({ message: "Sessiyalarni yuklashda xatolik." });
    }
});

// POST /api/sessions/terminate-all - Barcha sessiyalarni tugatish (joriydan tashqari)
router.post('/terminate-all', isAuthenticated, async (req, res) => {
    const currentUser = req.session.user;
    const currentSid = req.sessionID;

    try {
        // Foydalanuvchining barcha sessiyalarini topamiz
        const allSessions = await db('sessions').select('*');
        let terminatedCount = 0;

        for (const session of allSessions) {
            try {
                const sessionData = JSON.parse(session.sess);
                const sessionOwnerId = sessionData.user?.id;

                // Faqat o'zining sessiyalarini o'chiradi (joriydan tashqari)
                if (sessionOwnerId === currentUser.id && session.sid !== currentSid) {
                    await db('sessions').where({ sid: session.sid }).del();
                    terminatedCount++;
                }
            } catch (parseError) {
                log.error('Session parse xatoligi:', parseError);
            }
        }

        res.json({ 
            message: `${terminatedCount} ta sessiya muvaffaqiyatli tugatildi.`,
            terminated_count: terminatedCount
        });
    } catch (error) {
        log.error('POST /api/sessions/terminate-all xatoligi:', error);
        res.status(500).json({ message: "Sessiyalarni tugatishda xatolik." });
    }
});

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

        // Online statusni real-time yangilash
        // Foydalanuvchining boshqa sessiyalari bor-yo'qligini tekshirish
        const remainingSessions = await db('sessions')
            .where('sess', 'like', `%"id":${sessionOwnerId}%`)
            .where('sid', '!=', sidToDelete);
        
        const isStillOnline = remainingSessions.length > 0;
        
        if (global.broadcastWebSocket) {
            const user = await db('users').where('id', sessionOwnerId).first();
            global.broadcastWebSocket('user_status_changed', {
                userId: sessionOwnerId,
                username: user?.username || 'Unknown',
                isOnline: isStillOnline
            });
        }

        res.json({ message: "Sessiya muvaffaqiyatli tugatildi." });
    } catch (error) {
        log.error(`/api/sessions/${sidToDelete} DELETE xatoligi:`, error);
        res.status(500).json({ message: "Sessiyani tugatishda xatolik." });
    }
});

module.exports = router;
