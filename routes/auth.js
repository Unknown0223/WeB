const express = require('express');
const bcrypt = require('bcrypt');
const { db, logAction } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');
const { sendToTelegram } = require('../utils/bot.js');
const userRepository = require('../data/userRepository.js');
const similarity = require('string-similarity');

const router = express.Router();

// Login sahifasi uchun brending sozlamalarini olish
router.get('/public/settings/branding', async (req, res) => {
    try {
        const brandingSetting = await db('settings').where({ key: 'branding_settings' }).first();
        const settings = brandingSetting 
            ? JSON.parse(brandingSetting.value) 
            : { text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' };
        res.json(settings);
    } catch (error) {
        console.error("Public branding settings xatoligi:", error);
        res.status(500).json({ text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' });
    }
});

// Foydalanuvchi registratsiyasi (YANGILANGAN)
router.post('/register', async (req, res) => {
    const { fullname, username, password, secret_word } = req.body;

    // --- Validatsiya ---
    if (!fullname || !username || !password || !secret_word) {
        return res.status(400).json({ message: "Barcha maydonlarni to'ldiring: To'liq ism, Login, Parol va Maxfiy so'z." });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "Parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    if (secret_word.length < 6) {
        return res.status(400).json({ message: "Maxfiy so'z kamida 6 belgidan iborat bo'lishi kerak." });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ message: "Login faqat lotin harflari, raqamlar va pastki chiziqdan iborat bo'lishi mumkin." });
    }

    // --- Parol va Maxfiy so'z o'xshashligini tekshirish ---
    const passSimilarity = similarity.compareTwoStrings(password, secret_word);
    if (passSimilarity > 0.4) {
        return res.status(400).json({ message: "Maxfiy so'z parolga juda o'xshash bo'lmasligi kerak (40% dan kam)." });
    }

    try {
        const existingUser = await db('users').where({ username: username }).first();
        if (existingUser) {
            return res.status(409).json({ message: "Bu nomdagi foydalanuvchi allaqachon mavjud." });
        }

        const [hashedPassword, hashedSecretWord] = await Promise.all([
            bcrypt.hash(password, 10),
            bcrypt.hash(secret_word, 10)
        ]);

        // Foydalanuvchini bazaga qo'shish
        const [userId] = await db('users').insert({
            username: username,
            password: hashedPassword,
            secret_word: hashedSecretWord,
            fullname: fullname,
            status: 'pending_telegram_subscription',
            role: 'pending'
        });
        
        // Asl parolni vaqtinchalik saqlash
        await db('pending_registrations').insert({
            user_id: userId,
            user_data: JSON.stringify({ password, secret_word }), // ASL PAROL VA MAXFIY SO'Z
            expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 daqiqa
        });

        const botUsernameSetting = await db('settings').where({ key: 'telegram_bot_username' }).first();
        const botUsername = botUsernameSetting ? botUsernameSetting.value : null;

        if (!botUsername) {
            await db('users').where({ id: userId }).update({ status: 'pending_approval' });
            
            await sendToTelegram({
                type: 'new_user_request',
                user_id: userId,
                username: username,
                fullname: fullname
            });
            return res.status(201).json({ 
                status: 'pending_approval',
                message: "So'rovingiz qabul qilindi. Administrator tasdiqlashini kuting." 
            });
        }

        const connectLink = `https://t.me/${botUsername}?start=subscribe_${userId}`;

        res.status(201   ).json({
            status: 'subscription_required',
            message: "Ro'yxatdan o'tish deyarli yakunlandi! So'rovingiz adminga yuborilishi uchun, iltimos, Telegram botimizga obuna bo'ling.",
            subscription_link: connectLink
        });

    } catch (error) {
        console.error("/api/register xatoligi:", error);
        res.status(500).json({ message: "Registratsiyada kutilmagan xatolik." });
    }
});


// POST /api/login - Tizimga kirish
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const MAX_LOGIN_ATTEMPTS = 5;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!username || !password) {
        return res.status(400).json({ message: "Login va parol kiritilishi shart." });
    }

    try {
        const user = await userRepository.findByUsername(username);

        if (!user) {
            await logAction(null, 'login_fail', 'user', null, { username, reason: 'User not found', ip: ipAddress, userAgent });
            return res.status(401).json({ message: "Login yoki parol noto'g'ri." });
        }

        if (user.status !== 'active') {
            let reason = "Bu foydalanuvchi faol emas. Iltimos, administratorga murojaat qiling.";
            if (user.status === 'pending_approval' || user.status === 'pending_telegram_subscription') {
                reason = "Sizning akkauntingiz hali admin tomonidan tasdiqlanmagan. Iltimos, kutib turing yoki administrator bilan bog'laning.";
            } else if (user.status === 'blocked') {
                reason = user.lock_reason || "Bu foydalanuvchi bloklangan.";
            } else if (user.status === 'archived') {
                reason = "Bu akkaunt arxivlangan. Qayta tiklash uchun administrator bilan bog'laning.";
            }
            await logAction(user.id, 'login_fail', 'user', user.id, { username, reason: `Account status: ${user.status}`, ip: ipAddress, userAgent });
            return res.status(403).json({ message: reason });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            const newAttempts = (user.login_attempts || 0) + 1;
            
            if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
                const lockMessage = `Parol ${MAX_LOGIN_ATTEMPTS} marta xato kiritilgani uchun bloklandi.`;
                await userRepository.lockUserForFailedAttempts(user.id, lockMessage);
                await logAction(user.id, 'account_lock', 'user', user.id, { username, reason: 'Max login attempts exceeded', ip: ipAddress, userAgent });

                await sendToTelegram({
                    type: 'account_lock_alert',
                    user_id: user.id,
                    username: user.username
                });
                return res.status(403).json({ message: "Xavfsizlik tufayli akkauntingiz bloklandi. Administratorga xabar berildi." });
            } else {
                await userRepository.incrementLoginAttempts(user.id, newAttempts);
                await logAction(user.id, 'login_fail', 'user', user.id, { username, reason: 'Invalid password', ip: ipAddress, userAgent });
                const attemptsLeft = MAX_LOGIN_ATTEMPTS - newAttempts;
                return res.status(401).json({ message: `Login yoki parol noto'g'ri. Qolgan urinishlar soni: ${attemptsLeft}.` });
            }
        }
        
        // Tizimga kirganda maxfiy xabarni o'chirish
        if (user.must_delete_creds && user.telegram_chat_id) {
            await sendToTelegram({
                type: 'delete_credentials',
                chat_id: user.telegram_chat_id,
                user_id: user.id
            });
            await db('users').where({ id: user.id }).update({ must_delete_creds: false });
        }

        if (user.login_attempts > 0 || user.lock_reason) {
            await userRepository.resetLoginAttempts(user.id);
        }

        const sessions = await db('sessions').where('sess', 'like', `%"id":${user.id}%`);
        
        if (sessions.length >= user.device_limit) {
            if (!user.telegram_chat_id) {
                await logAction(user.id, 'login_fail', 'user', user.id, { username, reason: 'Device limit reached, no Telegram', ip: ipAddress, userAgent });
                return res.status(403).json({ 
                    message: `Qurilmalar limiti (${user.device_limit}) to'lgan. Yangi qurilmadan kirish uchun Telegram botga ulanmagansiz. Iltimos, adminga murojaat qiling.` 
                });
            }
            
            await sendToTelegram({
                type: 'secret_word_request',
                chat_id: user.telegram_chat_id,
                user_id: user.id,
                username: user.username,
                ip: ipAddress,
                device: userAgent
            });
            await logAction(user.id, '2fa_sent', 'user', user.id, { username, reason: 'Device limit reached', ip: ipAddress, userAgent });

            return res.status(429).json({
                secretWordRequired: true,
                message: "Qurilmalar limiti to'lgan. Xavfsizlikni tasdiqlash uchun Telegramingizga yuborilgan ko'rsatmalarga amal qiling."
            });
        }

        const [locations, permissions] = await Promise.all([
            userRepository.getLocationsByUserId(user.id),
            userRepository.getPermissionsByRole(user.role)
        ]);
        
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            locations: locations,
            permissions: permissions
        };

        req.session.ip_address = ipAddress;
        req.session.user_agent = userAgent;
        req.session.last_activity = Date.now();

        await logAction(user.id, 'login_success', 'user', user.id, { ip: ipAddress, userAgent });

        const redirectUrl = (permissions.includes('dashboard:view') || permissions.includes('users:view')) ? '/admin' : '/';
        res.json({ message: "Tizimga muvaffaqiyatli kirildi.", user: req.session.user, redirectUrl });

    } catch (error) {
        console.error("/api/login xatoligi:", error);
        res.status(500).json({ message: "Serverda kutilmagan xatolik yuz berdi." });
    }
});

// GET /verify-session/:token - Sehrli havolani tasdiqlash uchun
router.get('/verify-session/:token', async (req, res) => {
    const { token } = req.params;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    try {
        const link = await db('magic_links').where({ token: token }).first();

        if (!link || new Date() > new Date(link.expires_at)) {
            await logAction(link ? link.user_id : null, '2fa_fail', 'magic_link', null, { token, reason: 'Invalid or expired token', ip: ipAddress, userAgent });
            return res.status(400).send("<h1>Havola yaroqsiz yoki muddati o'tgan</h1><p>Iltimos, tizimga qayta kirishga urinib ko'ring.</p>");
        }

        const sessions = await db('sessions').select('sid', 'sess');
        const userSessionIds = sessions
            .filter(s => {
                try { return JSON.parse(s.sess)?.user?.id === link.user_id; } catch { return false; }
            })
            .map(s => s.sid);

        if (userSessionIds.length > 0) {
            await db('sessions').whereIn('sid', userSessionIds).del();
        }

        const user = await userRepository.findById(link.user_id);
        const [locations, permissions] = await Promise.all([
            userRepository.getLocationsByUserId(user.id),
            userRepository.getPermissionsByRole(user.role)
        ]);

        req.session.regenerate(async (err) => {
            if (err) {
                console.error("Sessiyani qayta yaratishda xatolik:", err);
                return res.status(500).send("<h1>Ichki xatolik</h1><p>Sessiyani yaratib bo'lmadi.</p>");
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                locations: locations,
                permissions: permissions
            };
            req.session.ip_address = ipAddress;
            req.session.user_agent = userAgent;
            req.session.last_activity = Date.now();
            
            await logAction(user.id, '2fa_success', 'magic_link', user.id, { ip: ipAddress, userAgent });
            await logAction(user.id, 'login_success', 'user', user.id, { ip: ipAddress, userAgent, method: 'magic_link' });

            await db('magic_links').where({ token: token }).del();
            res.redirect('/');
        });

    } catch (error) {
        console.error("/verify-session xatoligi:", error);
        res.status(500).send("<h1>Serverda kutilmagan xatolik</h1>");
    }
});

// POST /api/logout - Tizimdan chiqish
router.post('/logout', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    
    await logAction(user.id, 'logout', 'user', user.id, { ip: req.session.ip_address, userAgent: req.session.user_agent });
    
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ message: "Tizimdan chiqishda xatolik." });
        }
        res.clearCookie('connect.sid');
        res.json({ message: "Tizimdan muvaffaqiyatli chiqdingiz." });
    });
});

// GET /api/current-user - Joriy foydalanuvchi ma'lumotlari
router.get('/current-user', isAuthenticated, (req, res) => {
    const userWithSession = {
        ...req.session.user,
        sessionId: req.sessionID
    };
    res.json(userWithSession);
});

module.exports = router;
