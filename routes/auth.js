const express = require('express');
const bcrypt = require('bcrypt');
const { db, logAction } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');
const { sendToTelegram } = require('../utils/bot.js');
const userRepository = require('../data/userRepository.js');
const similarity = require('string-similarity');

const router = express.Router();

// Login sahifasi uchun brending sozlamalarini olish (loader sozlamalari bilan)
router.get('/public/settings/branding', async (req, res) => {
    try {
        const brandingSetting = await db('settings').where({ key: 'branding_settings' }).first();
        
        let settings = brandingSetting 
            ? JSON.parse(brandingSetting.value) 
            : { 
                logo: {
                    text: 'MANUS', 
                    color: '#4CAF50', 
                    animation: 'anim-glow-pulse', 
                    border: 'border-none',
                    size: 32
                },
                loader: {
                    type: 'spinner',
                    text: 'Yuklanmoqda...',
                    showProgress: false,
                    blurBackground: true
                }
            };
        
        // MUAMMO: Bazada ikkala format ham mavjud bo'lishi mumkin
        // Yechim: Avval logo strukturasini tekshirish, agar mavjud bo'lsa uni ishlatish
        // Faqat logo strukturasida ma'lumotlar bo'lmasa, keyin eski formatni qo'llash
        
        if (settings.logo && (settings.logo.text || settings.logo.color)) {
            // Yangi format mavjud - logo strukturasini ishlatish
            
            // Logo strukturasini to'ldirish
            if (!settings.logo.size) {
                settings.logo.size = 32;
            }
            if (!settings.logo.text) {
                settings.logo.text = 'MANUS';
            }
            if (!settings.logo.color) {
                settings.logo.color = '#4CAF50';
            }
            if (!settings.logo.animation) {
                settings.logo.animation = 'anim-glow-pulse';
            }
            if (!settings.logo.border) {
                settings.logo.border = 'border-none';
            }
            
            // Eski format maydonlarini olib tashlash (tozalash)
            delete settings.text;
            delete settings.color;
            delete settings.animation;
            delete settings.border;
            
        } else if (settings.text || settings.color) {
            // Faqat eski format mavjud - yangi formatga o'tkazish
            settings = {
                logo: {
                    text: settings.text || 'MANUS',
                    color: settings.color || '#4CAF50',
                    animation: settings.animation || 'anim-glow-pulse',
                    border: settings.border || 'border-none',
                    size: settings.size || 32
                },
                loader: settings.loader || {
                    type: 'spinner',
                    text: 'Yuklanmoqda...',
                    showProgress: false,
                    blurBackground: true
                }
            };
        } else {
            // Hech qanday format mavjud emas - default qo'llash
            if (!settings.logo) {
                settings.logo = {};
            }
            if (!settings.logo.size) {
                settings.logo.size = 32;
            }
            if (!settings.logo.text) {
                settings.logo.text = 'MANUS';
            }
            if (!settings.logo.color) {
                settings.logo.color = '#4CAF50';
            }
            if (!settings.logo.animation) {
                settings.logo.animation = 'anim-glow-pulse';
            }
            if (!settings.logo.border) {
                settings.logo.border = 'border-none';
            }
        }
        
        res.json(settings);
    } catch (error) {
        console.error("Public branding settings xatoligi:", error);
        res.status(500).json({ 
            logo: {
                text: 'MANUS', 
                color: '#4CAF50', 
                animation: 'anim-glow-pulse', 
                border: 'border-none',
                size: 32
            },
            loader: {
                type: 'spinner',
                text: 'Yuklanmoqda...',
                showProgress: false,
                blurBackground: true
            }
        });
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
        
        // Tekshirish: foydalanuvchi haqiqatan yaratildimi?
        const createdUser = await db('users').where({ id: userId }).first();
        if (!createdUser) {
            console.error(`❌ [REGISTER] XATOLIK: Foydalanuvchi yaratildi, lekin bazadan topilmadi! User ID: ${userId}`);
            return res.status(500).json({ message: "Foydalanuvchi yaratishda xatolik yuz berdi." });
        }
        
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
        
            // WebSocket orqali realtime yuborish - yangi foydalanuvchi ro'yxatdan o'tdi
            if (global.broadcastWebSocket) {
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
        }

        const connectLink = `https://t.me/${botUsername}?start=subscribe_${userId}`;

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

    if (!username || !password) {
        return res.status(400).json({ message: "Login va parol kiritilishi shart." });
    }

    try {
        const user = await userRepository.findByUsername(username);

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
        
        // Online statusni real-time yangilash
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_status_changed', {
                userId: user.id,
                username: user.username,
                isOnline: true
            });
        }

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

        // === BOT OBUNASI TEKSHIRUVI (VARIANT A: MAJBURIY) ===
        // Superadmin uchun bot obunasi majburiy emas
        const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
        const isTelegramConnected = user.is_telegram_connected === 1 || user.is_telegram_connected === true;
        const hasTelegramChatId = !!user.telegram_chat_id;

        if (!isSuperAdmin && (!isTelegramConnected || !hasTelegramChatId)) {
            // Bot obunasi yo'q - bot bog'lash sahifasiga redirect
            // Sessiya yaratiladi, lekin bot bog'languncha dashboard ochilmaydi
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                locations: locations,
                permissions: finalPermissions,
                requires_bot_connection: true // Flag qo'shildi
            };
            req.session.ip_address = ipAddress;
            req.session.user_agent = userAgent;
            req.session.last_activity = Date.now();

            // Background'da log yozish
            logAction(user.id, 'login_success_but_bot_required', 'user', user.id, { 
                ip: ipAddress, 
                userAgent,
                reason: 'Bot subscription required'
            }).catch(err => console.error('Log yozishda xatolik:', err));

            return res.json({ 
                message: "Login muvaffaqiyatli, lekin Telegram bot bilan bog'lash kerak.", 
                user: req.session.user, 
                redirectUrl: '/bot-connect',
                requiresBotConnection: true
            });
        }
        // =======================================================

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
        
        // Online statusni real-time yangilash
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_status_changed', {
                userId: user.id,
                username: user.username,
                isOnline: true
            });
        }
        
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
    const userId = user.id;
    const username = user.username;
    
    await logAction(user.id, 'logout', 'user', user.id, { ip: req.session.ip_address, userAgent: req.session.user_agent });
    
    // Online statusni real-time yangilash (sessiya o'chirilishidan oldin)
    if (global.broadcastWebSocket) {
        global.broadcastWebSocket('user_status_changed', {
            userId: userId,
            username: username,
            isOnline: false
        });
    }
    
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

// POST /api/auth/bot-connect/generate-token - Bot bog'lash uchun token yaratish
router.post('/bot-connect/generate-token', async (req, res) => {
    let { username } = req.body;
    
    // Agar sessiya mavjud bo'lsa, sessiyadagi username'ni ishlatish
    if (req.session && req.session.user && req.session.user.username) {
        username = req.session.user.username;
    }
    
    if (!username) {
        return res.status(400).json({ message: "Login kiritilishi shart." });
    }

    try {
        // Login tekshiruvi
        const user = await db('users').where({ username: username }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Bunday login topilmadi." });
        }

        // Sessiya mavjud bo'lsa, sessiyadagi user ID bilan mos kelishini tekshirish
        if (req.session && req.session.user) {
            if (req.session.user.id !== user.id) {
                return res.status(403).json({ message: "Bu login sizning akkauntingizga tegishli emas." });
            }
        }

        // Superadmin uchun bot obunasi majburiy emas
        const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
        if (isSuperAdmin) {
            return res.status(400).json({ message: "Superadmin uchun bot obunasi majburiy emas." });
        }

        // Token yaratish
        const { v4: uuidv4 } = require('uuid');
        const token = `bot_connect_${uuidv4()}`;
        const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa

        // Eski tokenlarni o'chirish
        await db('magic_links')
            .where({ user_id: user.id })
            .where('token', 'like', 'bot_connect_%')
            .del();

        // Yangi token yaratish
        await db('magic_links').insert({
            token: token,
            user_id: user.id,
            expires_at: expires_at.toISOString()
        });

        // Bot username olish
        const botUsernameSetting = await db('settings').where({ key: 'telegram_bot_username' }).first();
        const botUsername = botUsernameSetting ? botUsernameSetting.value : null;

        if (!botUsername) {
            return res.status(500).json({ message: "Bot username topilmadi. Iltimos, administrator bilan bog'laning." });
        }

        // Bot havolasi yaratish
        const botLink = `https://t.me/${botUsername}?start=${token}`;


        res.json({
            success: true,
            token: token,
            botLink: botLink,
            expiresAt: expires_at.toISOString(),
            message: "Bot havolasi yaratildi. Iltimos, havola orqali botga ulaning."
        });

    } catch (error) {
        console.error("Bot bog'lash token yaratish xatoligi:", error);
        res.status(500).json({ message: "Token yaratishda xatolik yuz berdi." });
    }
});

// POST /api/auth/bot-connect/verify - Bot bog'lash tokenini tekshirish
router.post('/bot-connect/verify', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ message: "Token kiritilishi shart." });
    }

    try {
        // Token tekshiruvi
        const magicLink = await db('magic_links')
            .where({ token: token })
            .where('expires_at', '>', new Date().toISOString())
            .first();

        if (!magicLink) {
            return res.status(404).json({ message: "Token topilmadi yoki muddati tugagan." });
        }

        // Foydalanuvchi ma'lumotlarini olish
        const user = await db('users').where({ id: magicLink.user_id }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }

        // Bot obunasi tekshiruvi (telegram_chat_id va is_telegram_connected)
        const isTelegramConnected = user.is_telegram_connected === 1 || user.is_telegram_connected === true;
        const hasTelegramChatId = !!user.telegram_chat_id;

        if (!isTelegramConnected || !hasTelegramChatId) {
            return res.json({
                success: false,
                message: "Bot obunasi hali tasdiqlanmagan. Iltimos, botga ulanib, /start buyrug'ini bosing."
            });
        }

        // Token o'chirish (bir marta ishlatiladi)
        await db('magic_links').where({ token: token }).del();


        res.json({
            success: true,
            message: "Bot obunasi muvaffaqiyatli tasdiqlandi!",
            user: {
                id: user.id,
                username: user.username
            }
        });

    } catch (error) {
        console.error("Bot bog'lash token tekshirish xatoligi:", error);
        res.status(500).json({ message: "Token tekshirishda xatolik yuz berdi." });
    }
});

// GET /api/auth/bot-connect/status - Bot obunasi holatini tekshirish
router.get('/bot-connect/status', async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ message: "Avtorizatsiyadan o'tmagansiz." });
    }

    try {
        const userId = req.session.user.id;
        const user = await db('users').where({ id: userId }).select('id', 'username', 'is_telegram_connected', 'telegram_chat_id', 'role').first();

        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }

        const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
        const isTelegramConnected = user.is_telegram_connected === 1 || user.is_telegram_connected === true;
        const hasTelegramChatId = !!user.telegram_chat_id;

        res.json({
            isSuperAdmin: isSuperAdmin,
            isTelegramConnected: isTelegramConnected && hasTelegramChatId,
            requiresBotConnection: !isSuperAdmin && (!isTelegramConnected || !hasTelegramChatId),
            username: user.username // Sessiyadagi username'ni qaytarish
        });

    } catch (error) {
        console.error("Bot obunasi holati tekshirish xatoligi:", error);
        res.status(500).json({ message: "Holatni tekshirishda xatolik yuz berdi." });
    }
});

module.exports = router;
