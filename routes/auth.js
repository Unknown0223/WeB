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
        console.log(`📝 [REGISTER] Ro'yxatdan o'tish so'rovi. Username: ${username}, Fullname: ${fullname}`);
        
        const existingUser = await db('users').where({ username: username }).first();
        if (existingUser) {
            console.log(`❌ [REGISTER] Username allaqachon mavjud: ${username}`);
            return res.status(409).json({ message: "Bu nomdagi foydalanuvchi allaqachon mavjud." });
        }

        const [hashedPassword, hashedSecretWord] = await Promise.all([
            bcrypt.hash(password, 10),
            bcrypt.hash(secret_word, 10)
        ]);

        // Foydalanuvchini bazaga qo'shish
        const insertResult = await db('users').insert({
            username: username,
            password: hashedPassword,
            secret_word: hashedSecretWord,
            fullname: fullname,
            status: 'pending_telegram_subscription',
            role: 'pending'
        });
        
        // SQLite'da insert qilganda ID qaytariladi
        const userId = Array.isArray(insertResult) ? insertResult[0] : insertResult;
        
        console.log(`✅ [REGISTER] Foydalanuvchi yaratildi. User ID: ${userId} (type: ${typeof userId}), Status: pending_telegram_subscription`);
        console.log(`🔍 [REGISTER] Insert result: ${JSON.stringify(insertResult)}`);
        
        // Tekshirish: foydalanuvchi haqiqatan yaratildimi?
        const createdUser = await db('users').where({ id: userId }).first();
        if (!createdUser) {
            console.error(`❌ [REGISTER] XATOLIK: Foydalanuvchi yaratildi, lekin bazadan topilmadi! User ID: ${userId}`);
            return res.status(500).json({ message: "Foydalanuvchi yaratishda xatolik yuz berdi." });
        }
        console.log(`✅ [REGISTER] Tekshiruv: Foydalanuvchi bazada mavjud. ID: ${createdUser.id}, Username: ${createdUser.username}, Status: ${createdUser.status}`);
        
        // Asl parolni vaqtinchalik saqlash
        await db('pending_registrations').insert({
            user_id: userId,
            user_data: JSON.stringify({ password, secret_word }), // ASL PAROL VA MAXFIY SO'Z
            expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 daqiqa
        });
        
        console.log(`💾 [REGISTER] Vaqtinchalik ma'lumotlar saqlandi. User ID: ${userId}`);

        const botUsernameSetting = await db('settings').where({ key: 'telegram_bot_username' }).first();
        const botUsername = botUsernameSetting ? botUsernameSetting.value : null;

        if (!botUsername) {
            console.log(`⚠️ [REGISTER] Bot username topilmadi. Status: pending_approval ga o'zgartirildi`);
        await db('users').where({ id: userId }).update({ status: 'pending_approval' });
        
            console.log(`📤 [REGISTER] Admin'ga yangi foydalanuvchi so'rovi yuborilmoqda...`);
        await sendToTelegram({
            type: 'new_user_request',
            user_id: userId,
            username: username,
            fullname: fullname
        });
            console.log(`✅ [REGISTER] Admin'ga so'rov yuborildi. User ID: ${userId}`);
        
            // WebSocket orqali realtime yuborish - yangi foydalanuvchi ro'yxatdan o'tdi
            if (global.broadcastWebSocket) {
                console.log(`📡 [REGISTER] Yangi foydalanuvchi ro'yxatdan o'tdi, WebSocket orqali yuborilmoqda...`);
                global.broadcastWebSocket('user_registered', {
                    user: {
                        id: userId,
                        username: username,
                        fullname: fullname,
                        status: 'pending_approval',
                        role: null
                    },
                    username: username
                });
                console.log(`✅ [REGISTER] WebSocket yuborildi: user_registered`);
            }
        
            return res.status(201).json({ 
            status: 'pending_approval',
            message: "So'rovingiz qabul qilindi. Administrator tasdiqlashini kuting." 
            });
        }

        // Foydalanuvchi statusini pending_telegram_subscription ga o'zgartirish
        await db('users').where({ id: userId }).update({ status: 'pending_telegram_subscription' });

        // WebSocket orqali realtime yuborish - yangi foydalanuvchi ro'yxatdan o'tdi
        if (global.broadcastWebSocket) {
            console.log(`📡 [REGISTER] Yangi foydalanuvchi ro'yxatdan o'tdi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('user_registered', {
                user: {
                    id: userId,
                    username: username,
                    fullname: fullname,
                    status: 'pending_telegram_subscription',
                    role: null
                },
                username: username
            });
            console.log(`✅ [REGISTER] WebSocket yuborildi: user_registered`);
        }

        const connectLink = `https://t.me/${botUsername}?start=subscribe_${userId}`;
        console.log(`🔗 [REGISTER] Bot obuna havolasi yaratildi. Link: ${connectLink}, User ID: ${userId}`);

        res.status(201).json({
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
    const startTime = Date.now();
    const { username, password } = req.body;
    const MAX_LOGIN_ATTEMPTS = 5;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    console.log(`🔐 [LOGIN] Login so'rovi. Username: ${username}, IP: ${ipAddress}`);

    if (!username || !password) {
        console.warn(`⚠️ [LOGIN] Login yoki parol kiritilmagan`);
        return res.status(400).json({ message: "Login va parol kiritilishi shart." });
    }

    try {
        const user = await userRepository.findByUsername(username);
        console.log(`🔍 [LOGIN] User topildi: ${user ? `ID: ${user.id}, Status: ${user.status}` : 'topilmadi'}`);

        if (!user) {
            // Background'da log yozish
            logAction(null, 'login_fail', 'user', null, { username, reason: 'User not found', ip: ipAddress, userAgent }).catch(err => console.error('Log yozishda xatolik:', err));
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
            // Background'da log yozish
            logAction(user.id, 'login_fail', 'user', user.id, { username, reason: `Account status: ${user.status}`, ip: ipAddress, userAgent }).catch(err => console.error('Log yozishda xatolik:', err));
            return res.status(403).json({ message: reason });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            const newAttempts = (user.login_attempts || 0) + 1;
            
            if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
                const lockMessage = `Parol ${MAX_LOGIN_ATTEMPTS} marta xato kiritilgani uchun bloklandi.`;
                // Lock qilishni kutamiz (muhim)
                await userRepository.lockUserForFailedAttempts(user.id, lockMessage);
                
                // Background'da log va Telegram xabar
                Promise.all([
                    logAction(user.id, 'account_lock', 'user', user.id, { username, reason: 'Max login attempts exceeded', ip: ipAddress, userAgent }),
                    sendToTelegram({
                        type: 'account_lock_alert',
                        user_id: user.id,
                        username: user.username
                    })
                ]).catch(err => console.error('Background operatsiyalarda xatolik:', err));
                
                return res.status(403).json({ message: "Xavfsizlik tufayli akkauntingiz bloklandi. Administratorga xabar berildi." });
            } else {
                // Increment'ni kutamiz (muhim)
                await userRepository.incrementLoginAttempts(user.id, newAttempts);
                // Background'da log yozish
                logAction(user.id, 'login_fail', 'user', user.id, { username, reason: 'Invalid password', ip: ipAddress, userAgent }).catch(err => console.error('Log yozishda xatolik:', err));
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

        // Barcha kerakli ma'lumotlarni parallel olish (optimizatsiya)
        const [
            locations,
            rolePermissions,
            additionalPerms,
            restrictedPerms,
            sessionsCount
        ] = await Promise.all([
            userRepository.getLocationsByUserId(user.id),
            userRepository.getPermissionsByRole(user.role),
            db('user_permissions').where({ user_id: user.id, type: 'additional' }).pluck('permission_key'),
            db('user_permissions').where({ user_id: user.id, type: 'restricted' }).pluck('permission_key'),
            // Device limit tekshiruvini optimallashtirish - faqat super admin emas bo'lsa
            user.role !== 'super_admin' 
                ? db('sessions').where('sess', 'like', `%"id":${user.id}%`).count('* as count').first()
                : Promise.resolve({ count: 0 })
        ]);

        // Super admin uchun device limit tekshiruvi o'tkazib yuboriladi
        if (user.role !== 'super_admin') {
            const activeSessionsCount = sessionsCount ? parseInt(sessionsCount.count) : 0;
            
            if (activeSessionsCount >= user.device_limit) {
                if (!user.telegram_chat_id) {
                    // Background'da log yozish (await qilmaslik)
                    logAction(user.id, 'login_fail', 'user', user.id, { username, reason: 'Device limit reached, no Telegram', ip: ipAddress, userAgent }).catch(err => console.error('Log yozishda xatolik:', err));
                    return res.status(403).json({ 
                        message: `Qurilmalar limiti (${user.device_limit}) to'lgan. Yangi qurilmadan kirish uchun Telegram botga ulanmagansiz. Iltimos, adminga murojaat qiling.` 
                    });
                }
                
                // Telegram xabarni background'da yuborish
                sendToTelegram({
                    type: 'secret_word_request',
                    chat_id: user.telegram_chat_id,
                    user_id: user.id,
                    username: user.username,
                    ip: ipAddress,
                    device: userAgent
                }).catch(err => console.error('Telegram xabar yuborishda xatolik:', err));
                
                // Background'da log yozish
                logAction(user.id, '2fa_sent', 'user', user.id, { username, reason: 'Device limit reached', ip: ipAddress, userAgent }).catch(err => console.error('Log yozishda xatolik:', err));

                return res.status(429).json({
                    secretWordRequired: true,
                    message: "Qurilmalar limiti to'lgan. Xavfsizlikni tasdiqlash uchun Telegramingizga yuborilgan ko'rsatmalarga amal qiling."
                });
            }
        }

        // Final permissions: rolePermissions + additional - restricted
        let finalPermissions = [...rolePermissions];
        
        // Qo'shimcha huquqlarni qo'shish
        additionalPerms.forEach(perm => {
            if (!finalPermissions.includes(perm)) {
                finalPermissions.push(perm);
            }
        });
        
        // Cheklangan huquqlarni olib tashlash
        finalPermissions = finalPermissions.filter(perm => !restrictedPerms.includes(perm));

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            locations: locations,
            permissions: finalPermissions
        };

        req.session.ip_address = ipAddress;
        req.session.user_agent = userAgent;
        req.session.last_activity = Date.now();

        // Login attempts'ni reset qilish (agar kerak bo'lsa)
        if (user.login_attempts > 0 || user.lock_reason) {
            // Background'da reset qilish
            userRepository.resetLoginAttempts(user.id).catch(err => console.error('Login attempts reset xatolik:', err));
        }

        // Telegram xabarni o'chirish (agar kerak bo'lsa) - background'da
        if (user.must_delete_creds && user.telegram_chat_id) {
            sendToTelegram({
                type: 'delete_credentials',
                chat_id: user.telegram_chat_id,
                user_id: user.id
            }).catch(err => console.error('Telegram xabar yuborishda xatolik:', err));
            db('users').where({ id: user.id }).update({ must_delete_creds: false }).catch(err => console.error('Update xatolik:', err));
        }

        // Super admin yoki admin uchun admin paneliga redirect
        // Yoki kerakli permissions'ga ega foydalanuvchilar uchun
        let redirectUrl = '/';
        if (user.role === 'super_admin' || user.role === 'admin') {
            redirectUrl = '/admin';
        } else if (finalPermissions.includes('dashboard:view') || finalPermissions.includes('users:view')) {
            redirectUrl = '/admin';
        }
        
        // Background'da log yozish (javobni kutmaslik)
        logAction(user.id, 'login_success', 'user', user.id, { ip: ipAddress, userAgent }).catch(err => console.error('Log yozishda xatolik:', err));
        
        const elapsedTime = Date.now() - startTime;
        console.log(`✅ [LOGIN] Login muvaffaqiyatli. User ID: ${user.id}, Vaqt: ${elapsedTime}ms, Redirect: ${redirectUrl}`);
        
        res.json({ message: "Tizimga muvaffaqiyatli kirildi.", user: req.session.user, redirectUrl });

    } catch (error) {
        const elapsedTime = Date.now() - startTime;
        console.error(`❌ [LOGIN] Login xatoligi. Username: ${username}, Vaqt: ${elapsedTime}ms`, error);
        console.error(`❌ [LOGIN] Error stack:`, error.stack);
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
        const [locations, rolePermissions] = await Promise.all([
            userRepository.getLocationsByUserId(user.id),
            userRepository.getPermissionsByRole(user.role)
        ]);

        // User-specific permissions
        const additionalPerms = await db('user_permissions')
            .where({ user_id: user.id, type: 'additional' })
            .pluck('permission_key');
        
        const restrictedPerms = await db('user_permissions')
            .where({ user_id: user.id, type: 'restricted' })
            .pluck('permission_key');

        let finalPermissions = [...rolePermissions];
        additionalPerms.forEach(perm => {
            if (!finalPermissions.includes(perm)) {
                finalPermissions.push(perm);
            }
        });
        finalPermissions = finalPermissions.filter(perm => !restrictedPerms.includes(perm));

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
                permissions: finalPermissions
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
router.get('/current-user', isAuthenticated, async (req, res) => {
    try {
        const user = await db('users').where({ id: req.session.user.id }).first();
        const userWithSession = {
            ...req.session.user,
            preferred_currency: user?.preferred_currency || null,
            sessionId: req.sessionID
        };
        res.json(userWithSession);
    } catch (error) {
        console.error('Current user fetch error:', error);
        const userWithSession = {
            ...req.session.user,
            preferred_currency: null,
            sessionId: req.sessionID
        };
        res.json(userWithSession);
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
        console.error('Currency save error:', error);
        res.status(500).json({ message: "Valyuta sozlamasini saqlashda xatolik." });
    }
});

// Parol o'zgartirish so'rovini yuborish (admin tasdiqini kutadi)
router.post('/request-password-change', isAuthenticated, async (req, res) => {
    const { userId, newPassword, secretWord } = req.body;
    
    // Faqat o'z parolini o'zgartirish mumkin
    if (parseInt(userId) !== req.session.user.id) {
        return res.status(403).json({ message: "Faqat o'z parolingizni o'zgartira olasiz." });
    }
    
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Yangi parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    
    try {
        const user = await db('users').where({ id: userId }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        
        // Maxfiy so'zni tekshirish
        const isSecretValid = await bcrypt.compare(secretWord, user.secret_word);
        if (!isSecretValid) {
            return res.status(401).json({ message: "Maxfiy so'z noto'g'ri." });
        }
        
        // Yangi parolni hash qilish
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // So'rovni saqlash
        await db('password_change_requests').insert({
            user_id: userId,
            new_password_hash: hashedPassword,
            status: 'pending',
            requested_at: db.fn.now(),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        // Adminlarni xabardor qilish
        const admins = await db('users')
            .join('user_permissions', 'users.id', 'user_permissions.user_id')
            .where('user_permissions.permission_key', 'users:change_password')
            .where('user_permissions.type', 'additional')
            .select('users.telegram_chat_id', 'users.username');
        
        // Telegram orqali xabar yuborish
        for (const admin of admins) {
            if (admin.telegram_chat_id) {
                await sendToTelegram({
                    type: 'password_change_request',
                    chat_id: admin.telegram_chat_id,
                    requester: user.username,
                    requester_fullname: user.fullname,
                    user_id: userId
                });
            }
        }
        
        res.json({ 
            message: "So'rov muvaffaqiyatli yuborildi. Admin tasdiqini kuting.",
            success: true 
        });
    } catch (error) {
        console.error("Parol o'zgartirish so'rovi xatoligi:", error);
        res.status(500).json({ message: "So'rov yuborishda xatolik yuz berdi." });
    }
});

// Maxfiy so'zni tekshirish endpoint
router.post('/verify-secret', async (req, res) => {
    const { username, secretWord } = req.body;
    
    if (!username || !secretWord) {
        return res.status(400).json({ message: "Username va maxfiy so'z talab qilinadi." });
    }
    
    try {
        const user = await db('users').where({ username }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        
        if (!user.secret_word) {
            return res.status(400).json({ message: "Maxfiy so'z o'rnatilmagan." });
        }
        
        const isValid = await bcrypt.compare(secretWord, user.secret_word);
        
        if (isValid) {
            res.json({ success: true, message: "Maxfiy so'z to'g'ri." });
        } else {
            res.status(401).json({ message: "Maxfiy so'z noto'g'ri." });
        }
    } catch (error) {
        console.error("Maxfiy so'zni tekshirish xatoligi:", error);
        res.status(500).json({ message: "Tekshirishda xatolik yuz berdi." });
    }
});

module.exports = router;
