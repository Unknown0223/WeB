const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const userRepository = require('../data/userRepository.js');
const { refreshUserSessions } = require('../utils/sessionManager.js');
const { sendToTelegram } = require('../utils/bot.js');

const router = express.Router();

// Barcha AKTIV, BLOKLANGAN va ARXIVLANGAN foydalanuvchilarni olish
router.get('/', isAuthenticated, hasPermission('users:view'), async (req, res) => {
    try {
        const users = await userRepository.getAllUsersWithDetails();
        // Admin panelida barcha statusdagi userlarni ko'rsatishimiz mumkin
        res.json(users);
    } catch (error) {
        console.error("/api/users GET xatoligi:", error);
        res.status(500).json({ message: "Foydalanuvchilarni olishda xatolik." });
    }
});

// Tasdiqlanishini kutayotgan foydalanuvchilarni olish
router.get('/pending', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    try {
        const pendingUsers = await db('users')
            .whereIn('status', ['pending_approval', 'pending_telegram_subscription', 'status_in_process']) // status_in_process qo'shildi
            .select('id', 'username', 'fullname', 'created_at', 'status');
        res.json(pendingUsers);
    } catch (error) {
        console.error("/api/users/pending GET xatoligi:", error);
        res.status(500).json({ message: "So'rovlarni yuklashda xatolik." });
    }
});

// JORIY foydalanuvchining o'z sessiyalarini olish
router.get('/me/sessions', isAuthenticated, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const sessions = await db('sessions').select('sid', 'sess');
        
        const userSessions = sessions.map(s => {
            try {
                const sessData = JSON.parse(s.sess);
                if (sessData.user && sessData.user.id == userId) {
                    return {
                        sid: s.sid,
                        ip_address: sessData.ip_address,
                        user_agent: sessData.user_agent,
                        last_activity: new Date(sessData.cookie.expires).toISOString(),
                        is_current: s.sid === req.sessionID
                    };
                }
                return null;
            } catch { return null; }
        }).filter(Boolean);

        res.json(userSessions);
    } catch (error) {
        console.error(`/api/users/me/sessions GET xatoligi:`, error);
        res.status(500).json({ message: "Sessiyalarni olishda xatolik." });
    }
});

// Foydalanuvchining aktiv sessiyalarini olish (Admin uchun)
router.get('/:id/sessions', isAuthenticated, hasPermission('users:manage_sessions'), async (req, res) => {
    const userId = req.params.id;
    try {
        const sessions = await db('sessions').select('sid', 'sess');
        
        const userSessions = sessions.map(s => {
            try {
                const sessData = JSON.parse(s.sess);
                if (sessData.user && sessData.user.id == userId) {
                    return {
                        sid: s.sid,
                        ip_address: sessData.ip_address,
                        user_agent: sessData.user_agent,
                        last_activity: new Date(sessData.cookie.expires).toISOString(),
                        is_current: s.sid === req.sessionID
                    };
                }
                return null;
            } catch { return null; }
        }).filter(Boolean);

        res.json(userSessions);
    } catch (error) {
        console.error(`/api/users/${userId}/sessions GET xatoligi:`, error);
        res.status(500).json({ message: "Sessiyalarni olishda xatolik." });
    }
});

// Yangi foydalanuvchi yaratish (Admin tomonidan)
router.post('/', isAuthenticated, hasPermission('users:create'), async (req, res) => {
    const { username, password, role, locations = [], device_limit = 1, fullname } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;
    
    if (!username || !password || !role) {
        return res.status(400).json({ message: "Login, parol va rol kiritilishi shart." });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "Parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    if ((role === 'operator' || role === 'manager') && locations.length === 0) {
        return res.status(400).json({ message: "Operator yoki Menejer uchun kamida bitta filial tanlanishi shart." });
    }

    try {
        const userId = await userRepository.createUser(adminId, username, password, role, device_limit, fullname, 'active', ipAddress, userAgent);
        await userRepository.updateUserLocations(adminId, userId, locations, ipAddress, userAgent);
        
        res.status(201).json({ message: "Foydalanuvchi muvaffaqiyatli qo'shildi." });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: "Bu nomdagi foydalanuvchi allaqachon mavjud." });
        }
        console.error("/api/users POST xatoligi:", error);
        res.status(500).json({ message: "Foydalanuvchi qo'shishda xatolik." });
    }
});

// Foydalanuvchini tahrirlash
router.put('/:id', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = req.params.id;
    const { role, locations = [], device_limit, fullname } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!role) {
        return res.status(400).json({ message: "Rol kiritilishi shart." });
    }
    if ((role === 'operator' || role === 'manager') && locations.length === 0) {
        return res.status(400).json({ message: "Operator yoki Menejer uchun kamida bitta filial tanlanishi shart." });
    }

    try {
        await userRepository.updateUser(adminId, userId, role, device_limit, fullname, ipAddress, userAgent);
        await userRepository.updateUserLocations(adminId, userId, locations, ipAddress, userAgent);

        await refreshUserSessions(parseInt(userId, 10));

        res.json({ message: "Foydalanuvchi ma'lumotlari muvaffaqiyatli yangilandi." });
    } catch (error) {
        console.error(`/api/users/${userId} PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchini yangilashda xatolik." });
    }
});

// Foydalanuvchi holatini o'zgartirish (Bloklash/Aktivlashtirish)
router.put('/:id/status', isAuthenticated, hasPermission('users:change_status'), async (req, res) => {
    const userId = req.params.id;
    const { status } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (Number(userId) === req.session.user.id) {
        return res.status(403).json({ message: "Siz o'zingizning holatingizni o'zgartira olmaysiz." });
    }
    if (!['active', 'blocked'].includes(status)) {
        return res.status(400).json({ message: "Status noto'g'ri: faqat 'active' yoki 'blocked' bo'lishi mumkin." });
    }

    try {
        await userRepository.updateUserStatus(adminId, userId, status, ipAddress, userAgent);
        
        const message = status === 'active' ? "Foydalanuvchi muvaffaqiyatli aktivlashtirildi." : "Foydalanuvchi muvaffaqiyatli bloklandi va barcha sessiyalari tugatildi.";
        res.json({ message });
    } catch (error) {
        console.error(`/api/users/${userId}/status PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchi holatini o'zgartirishda xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHI SO'ROVINI TASDIQLASH (YANGILANGAN TO'LIQ MANTIQ) ===
// ===================================================================
router.put('/:id/approve', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = req.params.id;
    const { role, locations = [] } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!role) {
        return res.status(400).json({ message: "Rol tanlanishi shart." });
    }
    if ((role === 'operator' || role === 'manager') && locations.length === 0) {
        return res.status(400).json({ message: "Operator yoki Menejer uchun kamida bitta filial tanlanishi shart." });
    }

    try {
        // 1. Foydalanuvchi va uning vaqtinchalik ma'lumotlarini tekshirish
        const user = await db('users').where({ id: userId }).first();
        if (!user || !['pending_approval', 'pending_telegram_subscription'].includes(user.status)) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi yoki allaqachon tasdiqlangan." });
        }

        const tempReg = await db('pending_registrations').where({ user_id: userId }).first();
        if (!tempReg) {
             return res.status(404).json({ message: "Ro'yxatdan o'tish so'rovi topilmadi yoki eskirgan." });
        }
        const userData = JSON.parse(tempReg.user_data);
        const { password, secret_word } = userData;

        // 2. Foydalanuvchini aktivlashtirish (bitta tranzaksiya ichida)
        await db.transaction(async trx => {
            await trx('users').where({ id: userId }).update({
                status: 'active',
                role: role,
                must_delete_creds: true // Kirish ma'lumotlari yuborilgach, xabarni o'chirish uchun belgi
            });

            await trx('user_locations').where({ user_id: userId }).del();
            if (locations && locations.length > 0) {
                const locationsToInsert = locations.map(loc => ({ user_id: userId, location_name: loc }));
                await trx('user_locations').insert(locationsToInsert);
            }
        });

        // 3. Foydalanuvchiga kirish ma'lumotlarini Telegram orqali yuborish
        let credentialsSent = false;
        if (user.telegram_chat_id) {
            await sendToTelegram({
                type: 'user_approved_credentials',
                chat_id: user.telegram_chat_id,
                user_id: userId,
                fullname: user.fullname,
                username: user.username,
                password: password,
                secret_word: secret_word
            });
            credentialsSent = true;
        }

        // 4. Vaqtinchalik ma'lumotlarni tozalash
        await db('pending_registrations').where({ user_id: userId }).del();

        // 5. Audit jurnaliga yozish
        await userRepository.logAction(adminId, 'approve_user', 'user', userId, { approved_role: role, locations, ip: ipAddress, userAgent });
        
        // 6. Adminga yakuniy javobni qaytarish
        const message = `Foydalanuvchi muvaffaqiyatli tasdiqlandi. ${credentialsSent ? "Kirish ma'lumotlari uning Telegramiga yuborildi." : "Foydalanuvchi botga ulanmaganligi sababli kirish ma'lumotlari yuborilmadi."}`;
        res.json({ 
            message: message,
            credentials_sent: credentialsSent
        });

    } catch (error) {
        console.error(`/api/users/${userId}/approve PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchini tasdiqlashda kutilmagan xatolik." });
    }
});

// Foydalanuvchi so'rovini rad etish (SOFT DELETE)
router.put('/:id/reject', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = req.params.id;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    try {
        const updatedCount = await db('users')
            .where({ id: userId })
            .whereIn('status', ['pending_approval', 'pending_telegram_subscription', 'status_in_process'])
            .update({ status: 'archived' }); // O'chirish o'rniga arxivlash

        if (updatedCount === 0) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi yoki allaqachon ko'rib chiqilgan." });
        }

        // Vaqtinchalik ma'lumotlarni ham o'chiramiz
        await db('pending_registrations').where({ user_id: userId }).del();

        await userRepository.logAction(adminId, 'reject_user', 'user', userId, { ip: ipAddress, userAgent });

        res.json({ message: "Foydalanuvchi so'rovi muvaffaqiyatli rad etildi va arxivlandi." });
    } catch (error) {
        console.error(`/api/users/${userId}/reject PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchini rad etishda xatolik." });
    }
});

// Foydalanuvchi parolini o'zgartirish
router.put('/:id/password', isAuthenticated, hasPermission('users:change_password'), async (req, res) => {
    const { newPassword } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Yangi parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    try {
        await userRepository.updateUserPassword(adminId, req.params.id, newPassword, ipAddress, userAgent);
        res.json({ message: "Parol muvaffaqiyatli yangilandi." });
    } catch (error) {
        console.error(`/api/users/${req.params.id}/password PUT xatoligi:`, error);
        res.status(500).json({ message: "Parolni yangilashda xatolik." });
    }
});

// Foydalanuvchi maxfiy so'zini o'rnatish
router.put('/:id/secret-word', isAuthenticated, hasPermission('users:set_secret_word'), async (req, res) => {
    const { secretWord } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!secretWord || secretWord.length < 6) {
        return res.status(400).json({ message: "Maxfiy so'z kamida 6 belgidan iborat bo'lishi kerak." });
    }
    try {
        await userRepository.updateUserSecretWord(adminId, req.params.id, secretWord, ipAddress, userAgent);
        res.json({ message: "Maxfiy so'z muvaffaqiyatli o'rnatildi/yangilandi." });
    } catch (error) {
        console.error(`/api/users/${req.params.id}/secret-word PUT xatoligi:`, error);
        res.status(500).json({ message: "Maxfiy so'zni saqlashda xatolik." });
    }
});

module.exports = router;
