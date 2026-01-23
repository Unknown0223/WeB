const express = require('express');
const bcrypt = require('bcrypt');
const { db, logAction } = require('../db.js');
const { isAuthenticated } = require('../middleware/auth.js');
const { sendToTelegram } = require('../utils/bot.js');
const userRepository = require('../data/userRepository.js');
const similarity = require('string-similarity');
const { createLogger } = require('../utils/logger.js');

const router = express.Router();
const log = createLogger('AUTH');

// Login sahifasi uchun brending sozlamalarini olish (loader sozlamalari bilan)
router.get('/public/settings/branding', async (req, res) => {
    let retries = 3;
    let lastError = null;
    
    while (retries > 0) {
        try {
            const { getSettings } = require('../utils/settingsCache.js');
            const allSettings = await getSettings();
            
            let settings = allSettings.branding_settings || { 
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
            return; // Muvaffaqiyatli bo'lsa, return qilish
        } catch (error) {
            lastError = error;
            retries--;
            
            const isRetryableError = 
                error.message?.includes('Timeout acquiring a connection') ||
                error.message?.includes('pool is probably full') ||
                error.message?.includes('ECONNREFUSED') ||
                error.code === 'ECONNREFUSED';
            
            if (isRetryableError && retries > 0) {
                const delay = Math.min(500 * (4 - retries), 2000); // 500ms, 1000ms, 1500ms
                log.warn(`[AUTH] Public branding settings retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${retries} qoldi)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Boshqa xatolik yoki retry'lar tugagan
                break;
            }
        }
    }
    
    // Xatolik bo'lsa, default qiymatlarni qaytarish
    if (lastError) {
        log.error("Public branding settings xatoligi:", lastError.message);
    }
    
    res.status(lastError ? 500 : 200).json({ 
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
            log.error(`Foydalanuvchi yaratildi, lekin bazadan topilmadi! User ID: ${userId}`);
            return res.status(500).json({ message: "Foydalanuvchi yaratishda xatolik yuz berdi." });
        }
        
        // Asl parolni vaqtinchalik saqlash
        await db('pending_registrations').insert({
            user_id: userId,
            user_data: JSON.stringify({ password, secret_word }), // ASL PAROL VA MAXFIY SO'Z
            expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 daqiqa
        });
        
        const { getSetting } = require('../utils/settingsCache.js');
        const botUsername = await getSetting('telegram_bot_username', null);

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
        log.error("/api/register xatoligi:", error.message);
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

    log.info(`[LOGIN] Login so'rovi boshlandi. Username: ${username}, IP: ${ipAddress}`);

    if (!username || !password) {
        log.warn(`[LOGIN] Username yoki parol kiritilmagan`);
        return res.status(400).json({ message: "Login va parol kiritilishi shart." });
    }

    // Username va password'ni trim qilish
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
        log.warn(`[LOGIN] Trim qilgandan keyin username yoki parol bo'sh`);
        return res.status(400).json({ message: "Login va parol kiritilishi shart." });
    }

    log.info(`[LOGIN] User'ni topish boshlandi. Username: ${trimmedUsername}`);

    // Retry mexanizmi bilan user'ni topish
    let user = null;
    let userRetries = 3;
    while (userRetries > 0 && !user) {
        try {
            log.debug(`[LOGIN] User'ni topishga urinilmoqda... (${userRetries} qoldi)`);
            user = await userRepository.findByUsername(trimmedUsername);
            const userFindDuration = Date.now() - userFindStartTime;
            if (user) {
                log.info(`[LOGIN] ✅ User topildi (${userFindDuration}ms). User ID: ${user?.id}, Status: ${user?.status}, Role: ${user?.role}`);
            } else {
                log.warn(`[LOGIN] ⚠️ User topilmadi (${userFindDuration}ms)`);
            }
            break;
        } catch (error) {
            userRetries--;
            const isRetryableError = 
                error.message?.includes('Timeout acquiring a connection') ||
                error.message?.includes('pool is probably full');
        
            if (isRetryableError && userRetries > 0) {
                const delay = Math.min(500 * (4 - userRetries), 2000); // 500ms, 1000ms, 1500ms
                log.warn(`[LOGIN] ⚠️ User'ni topishda retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${userRetries} qoldi)`);
                log.warn(`[LOGIN] Xatolik: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                const userFindDuration = Date.now() - userFindStartTime;
                log.error(`[LOGIN] ❌ User'ni topishda xatolik (${userFindDuration}ms):`, error.message);
                throw error;
            }
        }
    }

    try {
        if (!user) {
            log.warn(`[LOGIN] User topilmadi. Username: ${trimmedUsername}`);
            // Background'da log yozish
            logAction(null, 'login_fail', 'user', null, { username: trimmedUsername, reason: 'User not found', ip: ipAddress, userAgent }).catch(() => {});
            return res.status(401).json({ message: "Login yoki parol noto'g'ri." });
        }

        log.info(`[LOGIN] User status tekshiruvi. Status: ${user.status}`);

        if (user.status !== 'active') {
            let reason = "Bu foydalanuvchi faol emas. Iltimos, administratorga murojaat qiling.";
            if (user.status === 'pending_approval' || user.status === 'pending_telegram_subscription') {
                reason = "Sizning akkauntingiz hali admin tomonidan tasdiqlanmagan. Iltimos, kutib turing yoki administrator bilan bog'laning.";
            } else if (user.status === 'blocked') {
                reason = user.lock_reason || "Bu foydalanuvchi bloklangan.";
            } else if (user.status === 'archived') {
                reason = "Bu akkaunt arxivlangan. Qayta tiklash uchun administrator bilan bog'laning.";
            }
            log.warn(`[LOGIN] User faol emas. Status: ${user.status}, Reason: ${reason}`);
            // Background'da log yozish
            logAction(user.id, 'login_fail', 'user', user.id, { username, reason: `Account status: ${user.status}`, ip: ipAddress, userAgent }).catch(() => {});
            return res.status(403).json({ message: reason });
        }

        log.info(`[LOGIN] Parol tekshiruvi boshlandi`);

        const match = await bcrypt.compare(trimmedPassword, user.password);

        if (!match) {
            log.warn(`[LOGIN] Parol noto'g'ri. User ID: ${user.id}`);
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
                ]).catch(() => {});
                
                return res.status(403).json({ message: "Xavfsizlik tufayli akkauntingiz bloklandi. Administratorga xabar berildi." });
            } else {
                // Increment'ni kutamiz (muhim)
                await userRepository.incrementLoginAttempts(user.id, newAttempts);
                // Background'da log yozish
                logAction(user.id, 'login_fail', 'user', user.id, { username, reason: 'Invalid password', ip: ipAddress, userAgent }).catch(() => {});
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

        log.info(`[LOGIN] Parol to'g'ri. Data fetch boshlandi`);

        // Superadmin uchun optimizatsiya - kamroq query
        const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
        
        // Superadmin uchun optimizatsiya - faqat kerakli ma'lumotlarni olish
        let locations, rolePermissions, additionalPerms, restrictedPerms, existingSessions;
        
        if (isSuperAdmin) {
            // Superadmin uchun minimal query - faqat permissions (cache'dan)
            log.info(`[LOGIN] Superadmin uchun optimizatsiya - minimal query`);
            const dataFetchStartTime = Date.now();
            
            try {
                // Superadmin uchun faqat permissions olish (cache'dan tez)
                rolePermissions = await userRepository.getPermissionsByRole(user.role);
                locations = []; // Superadmin uchun locations kerak emas
                additionalPerms = [];
                restrictedPerms = [];
                existingSessions = []; // Superadmin uchun sessiya tekshiruvi o'tkazilmaydi
                
                const dataFetchDuration = Date.now() - dataFetchStartTime;
                log.info(`[LOGIN] ✅ Superadmin data fetch muvaffaqiyatli (${dataFetchDuration}ms)`);
            } catch (error) {
                log.error(`[LOGIN] Superadmin data fetch xatolik:`, error.message);
                throw error;
            }
        } else {
            // Oddiy foydalanuvchilar uchun to'liq query
            let dataRetries = 3;
            
            while (dataRetries > 0) {
                try {
                    log.debug(`[LOGIN] Data fetch urinilmoqda... (${dataRetries} qoldi)`);
                    const dataFetchStartTime = Date.now();
                    
                    const queries = [
                        userRepository.getLocationsByUserId(user.id),
                        userRepository.getPermissionsByRole(user.role),
                        db('user_permissions').where({ user_id: user.id, type: 'additional' }).pluck('permission_key'),
                        db('user_permissions').where({ user_id: user.id, type: 'restricted' }).pluck('permission_key'),
                        db('sessions')
                            .select('sid', 'sess')
                            .whereRaw(`sess LIKE ?`, [`%"id":${user.id}%`])
                            .limit(100)
                    ];
                    
                    [
                        locations,
                        rolePermissions,
                        additionalPerms,
                        restrictedPerms,
                        existingSessions
                    ] = await Promise.all(queries);
                    
                    const dataFetchDuration = Date.now() - dataFetchStartTime;
                    log.info(`[LOGIN] Data fetch muvaffaqiyatli (${dataFetchDuration}ms). Locations: ${locations?.length || 0}, Permissions: ${rolePermissions?.length || 0}, Sessions: ${existingSessions?.length || 0}`);
                    break; // Muvaffaqiyatli bo'lsa, loop'ni to'xtatish
                } catch (error) {
                    dataRetries--;
                    const isRetryableError = 
                        error.message?.includes('Timeout acquiring a connection') ||
                        error.message?.includes('pool is probably full') ||
                        error.message?.includes('ECONNREFUSED') ||
                        error.code === 'ECONNREFUSED';
                
                    if (isRetryableError && dataRetries > 0) {
                        const delay = Math.min(1000 * (4 - dataRetries), 3000); // 1s, 2s, 3s
                        log.warn(`[LOGIN] Data fetch retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${dataRetries} qoldi)`);
                        log.warn(`[LOGIN] Xatolik: ${error.message}`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        log.error(`[LOGIN] Data fetch xatolik:`, error.message);
                        throw error;
                    }
                }
            }
        }

        log.info(`[LOGIN] Sessiya limit tekshiruvi boshlandi`);

        // SESSIYA LIMIT TEKSHIRUVI
        // Qoida: "Qurilma + Brauzer" kombinatsiyasi asosida
        // 1. Bir xil qurilma + bir xil brauzer = 1 ta sessiya (eski o'chiriladi, limitga ta'sir qilmaydi)
        // 2. Bir xil qurilma + turli brauzerlar = har bir brauzer uchun alohida sessiya (limit tekshiriladi)
        // 3. Turli qurilmalar = har bir qurilma uchun alohida sessiya (limit tekshiriladi)
        
        if (!isSuperAdmin) {
            // Foydalanuvchining barcha aktiv sessiyalarini olish
            const userSessions = existingSessions
                .map(s => {
                    try {
                        const sessData = JSON.parse(s.sess);
                        if (sessData.user && sessData.user.id == user.id) {
                            return {
                                sid: s.sid,
                                user_agent: sessData.user_agent || ''
                            };
                        }
                    } catch (e) {
                        return null;
                    }
                    return null;
                })
                .filter(Boolean);

            // Unique device/browser'larni aniqlash (user_agent asosida)
            const uniqueDevices = new Map();
            userSessions.forEach(session => {
                const deviceKey = session.user_agent || 'unknown';
                // Bir xil qurilma+brauzer bo'lsa, eski sessiyani o'chirish
                if (uniqueDevices.has(deviceKey)) {
                    db('sessions').where({ sid: uniqueDevices.get(deviceKey).sid }).del().catch(() => {});
                }
                uniqueDevices.set(deviceKey, session);
            });

            // Joriy kirish qurilmasini tekshirish
            const currentDeviceKey = userAgent || 'unknown';
            const isExistingDevice = uniqueDevices.has(currentDeviceKey);
            
            // Bir xil qurilma+brauzer bilan kirilayotgan bo'lsa, eski sessiyani o'chirish
            if (isExistingDevice) {
                const existingSession = uniqueDevices.get(currentDeviceKey);
                await db('sessions').where({ sid: existingSession.sid }).del();
                uniqueDevices.delete(currentDeviceKey);
            }

            // Limit tekshiruvi: faqat yangi qurilma/brauzer kombinatsiyasi uchun
            const uniqueDevicesCount = uniqueDevices.size;
            if (uniqueDevicesCount >= user.device_limit && !isExistingDevice) {
                if (!user.telegram_chat_id) {
                    logAction(user.id, 'login_fail', 'user', user.id, { username, reason: 'Device limit reached, no Telegram', ip: ipAddress, userAgent }).catch(() => {});
                    return res.status(403).json({ 
                        message: `Qurilmalar limiti (${user.device_limit}) to'lgan. Yangi qurilmadan kirish uchun Telegram botga ulanmagansiz. Iltimos, adminga murojaat qiling.` 
                    });
                }
                
                sendToTelegram({
                    type: 'secret_word_request',
                    chat_id: user.telegram_chat_id,
                    user_id: user.id,
                    username: user.username,
                    ip: ipAddress,
                    device: userAgent
                }).catch(() => {});
                
                logAction(user.id, '2fa_sent', 'user', user.id, { username, reason: 'Device limit reached', ip: ipAddress, userAgent }).catch(() => {});

                return res.status(429).json({
                    secretWordRequired: true,
                    message: "Qurilmalar limiti to'lgan. Xavfsizlikni tasdiqlash uchun Telegramingizga yuborilgan ko'rsatmalarga amal qiling."
                });
            }
        }

        log.info(`[LOGIN] Permissions hisoblash boshlandi`);

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

        log.info(`[LOGIN] Sessiya yaratish boshlandi`);
        const sessionStartTime = Date.now();

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            locations: locations,
            permissions: finalPermissions,
            preferred_currency: user.preferred_currency || null
        };

        req.session.ip_address = ipAddress;
        req.session.user_agent = userAgent;
        req.session.last_activity = Date.now();
        
        // Session save'ni kutish - muhim!
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    log.error(`[LOGIN] Session save xatolik:`, err.message);
                    reject(err);
                } else {
                    const sessionDuration = Date.now() - sessionStartTime;
                    log.info(`[LOGIN] ✅ Sessiya yaratildi va saqlandi (${sessionDuration}ms)`);
                    log.info(`[LOGIN] Session ID: ${req.sessionID}`);
                    resolve();
                }
            });
        });
        
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
            userRepository.resetLoginAttempts(user.id).catch(() => {});
        }

        // Telegram xabarni o'chirish (agar kerak bo'lsa) - background'da
        if (user.must_delete_creds && user.telegram_chat_id) {
            sendToTelegram({
                type: 'delete_credentials',
                chat_id: user.telegram_chat_id,
                user_id: user.id
            }).catch(() => {});
            db('users').where({ id: user.id }).update({ must_delete_creds: false }).catch(() => {});
        }
        
        // Parol o'zgartirish xabarini o'chirish (agar kerak bo'lsa) - background'da
        if (user.must_delete_password_change_message && user.telegram_chat_id) {
            sendToTelegram({
                type: 'delete_credentials',
                chat_id: user.telegram_chat_id,
                user_id: user.id
            }).catch(() => {});
            db('users').where({ id: user.id }).update({ must_delete_password_change_message: false }).catch(() => {});
        }

        // === BOT OBUNASI TEKSHIRUVI ===
        // Bot obunasi tekshiruvi faqat quyidagi holatda ishlaydi:
        // 1. Foydalanuvchi status === 'active' (ya'ni tasdiqlangan)
        // 2. Va bot obunasi bekor qilingan (is_telegram_connected === false yoki telegram_chat_id === null)
        // Bu shuni anglatadiki, foydalanuvchi avval bot obunasiga ega bo'lgan, keyin uni bekor qilgan
        // 
        // Ro'yxatdan o'tish jarayonida (pending_approval, pending_telegram_subscription) 
        // bot obunasi tekshiruvi o'tkazilmaydi, chunki bu jarayon allaqachon bot obunasi bilan boshlandi
        
        const isTelegramConnected = user.is_telegram_connected === 1 || user.is_telegram_connected === true;
        const hasTelegramChatId = !!user.telegram_chat_id;
        const isActiveUser = user.status === 'active';

        log.info(`[LOGIN] Bot obunasi tekshiruvi boshlandi`);

        // Telegram aktiv holatini tekshirish
        const { getSetting } = require('../utils/settingsCache.js');
        const telegramEnabled = await getSetting('telegram_enabled', 'false');
        const telegramEnabledBool = telegramEnabled === 'true' || telegramEnabled === true;

        log.info(`[LOGIN] Telegram enabled: ${telegramEnabledBool}, IsSuperAdmin: ${isSuperAdmin}, IsTelegramConnected: ${isTelegramConnected}, HasTelegramChatId: ${hasTelegramChatId}`);

        // Bot obunasi tekshiruvi faqat telegram aktiv bo'lsa va active foydalanuvchilar uchun
        // Agar foydalanuvchi active bo'lsa va bot obunasi yo'q bo'lsa, bu shuni anglatadiki:
        // - Foydalanuvchi tizimda ishlagan
        // - Bot obunasini bekor qilgan
        // - Tizimdan chiqib ketgan
        // - Keyin qayta kirishga harakat qilgan
        if (telegramEnabledBool && !isSuperAdmin && isActiveUser && (!isTelegramConnected || !hasTelegramChatId)) {
            log.info(`[LOGIN] Bot obunasi kerak. Redirect: /bot-connect`);
            // Bot obunasi yo'q - bot bog'lash sahifasiga redirect
            // Sessiya yaratiladi, lekin bot bog'languncha dashboard ochilmaydi
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                locations: locations,
                permissions: finalPermissions,
                requires_bot_connection: true, // Flag qo'shildi
                preferred_currency: user.preferred_currency || null
            };
            req.session.ip_address = ipAddress;
            req.session.user_agent = userAgent;
            req.session.last_activity = Date.now();

            // Background'da log yozish
            logAction(user.id, 'login_success_but_bot_required', 'user', user.id, { 
                ip: ipAddress, 
                userAgent,
                reason: 'Bot subscription cancelled - reconnection required'
            }).catch(() => {});

            return res.json({ 
                message: "Login muvaffaqiyatli, lekin Telegram bot bilan bog'lash kerak.", 
                user: req.session.user, 
                redirectUrl: '/bot-connect',
                requiresBotConnection: true
            });
        }
        
        // =======================================================

        log.info(`[LOGIN] Redirect URL aniqlash boshlandi`);

        // Barcha foydalanuvchilar uchun admin paneliga redirect
        // Menejer, kassir, operator, rahbar ham web interfeysdan foydalana oladi
        let redirectUrl = '/';
        
        // Super admin yoki admin uchun admin paneliga redirect
        if (user.role === 'super_admin' || user.role === 'admin') {
            redirectUrl = '/admin';
        } 
        // Qarzdorlik tasdiqlash tizimi uchun permission'ga ega foydalanuvchilar uchun
        else if (finalPermissions.includes('debt:create') || 
                 finalPermissions.includes('debt:approve_cashier') || 
                 finalPermissions.includes('debt:approve_operator') || 
                 finalPermissions.includes('debt:approve_leader') ||
                 finalPermissions.includes('debt:view_statistics') ||
                 finalPermissions.includes('debt:view_own')) {
            redirectUrl = '/admin';
        }
        // Dashboard yoki boshqa permission'ga ega foydalanuvchilar uchun
        else if (finalPermissions.includes('dashboard:view') || finalPermissions.includes('users:view')) {
            redirectUrl = '/admin';
        }
        
        const duration = Date.now() - startTime;
        log.info(`[LOGIN] Login muvaffaqiyatli tugadi. Username: ${username}, Duration: ${duration}ms, Redirect: ${redirectUrl}`);
        log.info(`[LOGIN] Response yuborilmoqda...`);
        
        // Background'da log yozish (javobni kutmaslik)
        logAction(user.id, 'login_success', 'user', user.id, { ip: ipAddress, userAgent }).catch(() => {});
        
        // Online statusni real-time yangilash
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_status_changed', {
                userId: user.id,
                username: user.username,
                isOnline: true
            });
        }
        
        const responseStartTime = Date.now();
        res.json({ message: "Tizimga muvaffaqiyatli kirildi.", user: req.session.user, redirectUrl });
        const responseDuration = Date.now() - responseStartTime;
        log.info(`[LOGIN] ✅ Response yuborildi (${responseDuration}ms)`);
        log.info('═══════════════════════════════════════════════════════════');
        log.info(`✅ LOGIN ENDPOINT MUVAFFAQIYATLI TUGADI`);
        log.info(`⏱️  Jami vaqt: ${duration}ms`);
        log.info('═══════════════════════════════════════════════════════════');

    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('═══════════════════════════════════════════════════════════');
        log.error('❌ LOGIN ENDPOINT XATOLIK');
        log.error(`⏱️  Vaqt: ${duration}ms`);
        log.error(`👤 Username: ${username}`);
        log.error(`📝 Xatolik turi: ${error.name || 'Unknown'}`);
        log.error(`📝 Xatolik xabari: ${error.message || 'No message'}`);
        log.error(`📚 Stack trace:`, error.stack);
        log.error('═══════════════════════════════════════════════════════════');
        
        const responseStartTime = Date.now();
        res.status(500).json({ message: "Serverda kutilmagan xatolik yuz berdi." });
        const responseDuration = Date.now() - responseStartTime;
        log.error(`[LOGIN] ❌ Error response yuborildi (${responseDuration}ms)`);
    }
});

// GET /verify-session/:token - Sehrli havolani tasdiqlash uchun
router.get('/verify-session/:token', async (req, res) => {
    const { token } = req.params;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    try {
        const link = await db('magic_links').where({ token: token }).first();

        if (!link) {
            log.error(`[VERIFY_SESSION] Token topilmadi: ${token.substring(0, 10)}...`);
            await logAction(null, '2fa_fail', 'magic_link', null, { token, reason: 'Token not found', ip: ipAddress, userAgent });
            return res.status(400).send("<h1>Havola yaroqsiz yoki muddati o'tgan</h1><p>Iltimos, tizimga qayta kirishga urinib ko'ring.</p>");
        }

        // Timezone muammosini hal qilish - UTC vaqt bilan solishtirish
        const now = new Date();
        const expiresAt = new Date(link.expires_at);
        
        if (now > expiresAt) {
            log.error(`[VERIFY_SESSION] Token muddati o'tgan - Token: ${token.substring(0, 10)}..., User ID: ${link.user_id}`);
            await logAction(link.user_id, '2fa_fail', 'magic_link', null, { token, reason: 'Token expired', ip: ipAddress, userAgent, expiresAt: expiresAt.toISOString(), now: now.toISOString() });
            return res.status(400).send("<h1>Havola yaroqsiz yoki muddati o'tgan</h1><p>Iltimos, tizimga qayta kirishga urinib ko'ring.</p>");
        }

        const user = await userRepository.findById(link.user_id);
        if (!user) {
            log.error(`[VERIFY_SESSION] Foydalanuvchi topilmadi - User ID: ${link.user_id}`);
            return res.status(404).send("<h1>Foydalanuvchi topilmadi</h1>");
        }

        // Magic link orqali kirilganda BARCHA eski sessiyalarni o'chirish
        // Bu xavfsizlik uchun muhim - faqat bitta aktiv sessiya bo'lishi kerak
        const sessions = await db('sessions').select('sid', 'sess');
        const userSessionSids = sessions
            .filter(s => {
                try { 
                    const sessData = JSON.parse(s.sess);
                    return sessData.user && sessData.user.id === link.user_id;
                } catch { 
                    return false; 
                }
            })
            .map(s => s.sid);

        // Barcha eski sessiyalarni o'chirish
        if (userSessionSids.length > 0) {
            await db('sessions').whereIn('sid', userSessionSids).del();
            log.info(`[VERIFY_SESSION] ${userSessionSids.length} ta eski sessiya o'chirildi - User ID: ${user.id}`);
        }


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
                log.error(`[VERIFY_SESSION] Sessiya yaratish xatoligi - User ID: ${link.user_id}`, err);
                // Token'ni o'chirish (xatolik bo'lsa ham)
                try {
                    await db('magic_links').where({ token: token }).del();
                } catch (tokenError) {
                    log.error(`[VERIFY_SESSION] Token o'chirishda xatolik:`, tokenError);
                }
                return res.status(500).send("<h1>Ichki xatolik</h1><p>Sessiyani yaratib bo'lmadi. Iltimos, qayta urinib ko'ring.</p>");
            }

            try {
                req.session.user = {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    locations: locations,
                    permissions: finalPermissions,
                    preferred_currency: user.preferred_currency || null
                };
                req.session.ip_address = ipAddress;
                req.session.user_agent = userAgent;
                req.session.last_activity = Date.now();
                
                // Sessiya saqlash
                await new Promise((resolve, reject) => {
                    req.session.save((saveErr) => {
                        if (saveErr) {
                            log.error(`[VERIFY_SESSION] Sessiya saqlashda xatolik - User ID: ${user.id}`, saveErr);
                            reject(saveErr);
                        } else {
                            resolve();
                        }
                    });
                });
                
                await logAction(user.id, '2fa_success', 'magic_link', user.id, { ip: ipAddress, userAgent });
                await logAction(user.id, 'login_success', 'user', user.id, { ip: ipAddress, userAgent, method: 'magic_link' });

                // Bot login xabarini o'chirish (agar mavjud bo'lsa)
                if (user.telegram_chat_id && user.bot_login_message_id) {
                    const { getBot } = require('../utils/bot.js');
                    const bot = getBot();
                    if (bot) {
                        try {
                            await bot.deleteMessage(user.telegram_chat_id, user.bot_login_message_id);
                            await db('users').where({ id: user.id }).update({ bot_login_message_id: null });
                        } catch (error) {
                            log.error(`[VERIFY_SESSION] Bot xabarini o'chirishda xatolik - User ID: ${user.id}`, error.message);
                        }
                    }
                }

                // Token'ni o'chirish (muvaffaqiyatli bo'lsa)
                try {
                    await db('magic_links').where({ token: token }).del();
                    log.debug(`[VERIFY_SESSION] Token muvaffaqiyatli o'chirildi - User ID: ${user.id}`);
                } catch (tokenError) {
                    log.error(`[VERIFY_SESSION] Token o'chirishda xatolik - User ID: ${user.id}`, tokenError);
                    // Token o'chirilmadi, lekin sessiya yaratildi - davom etamiz
                }
                
                // Redirect'ni to'g'ri qilish
                const baseUrl = process.env.APP_BASE_URL || req.protocol + '://' + req.get('host');
                res.redirect(baseUrl + '/');
            } catch (sessionError) {
                log.error(`[VERIFY_SESSION] Sessiya sozlashda xatolik - User ID: ${user.id}`, sessionError);
                // Token'ni o'chirish
                try {
                    await db('magic_links').where({ token: token }).del();
                } catch (tokenError) {
                    log.error(`[VERIFY_SESSION] Token o'chirishda xatolik:`, tokenError);
                }
                res.status(500).send("<h1>Ichki xatolik</h1><p>Sessiyani sozlab bo'lmadi. Iltimos, qayta urinib ko'ring.</p>");
            }
        });

    } catch (error) {
        log.error(`[VERIFY_SESSION] Xatolik - Token: ${token?.substring(0, 10)}...`, error);
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
            log.error('Session destroy xatoligi:', err);
            return res.status(500).json({ message: "Tizimdan chiqishda xatolik." });
        }
        res.clearCookie('connect.sid');
        res.json({ message: "Tizimdan muvaffaqiyatli chiqdingiz." });
    });
});

// GET /api/current-user - Joriy foydalanuvchi ma'lumotlari (preferred_currency sessiyada bo'lsa DB so'rovsiz)
router.get('/current-user', isAuthenticated, async (req, res) => {
    try {
        let preferred_currency = req.session.user.preferred_currency;
        if (preferred_currency === undefined) {
            const row = await db('users').where({ id: req.session.user.id }).select('preferred_currency').first();
            preferred_currency = row?.preferred_currency || null;
        }
        const userWithSession = {
            ...req.session.user,
            preferred_currency,
            sessionId: req.sessionID
        };
        res.json(userWithSession);
    } catch (error) {
        log.error('Current user fetch error:', error.message);
        res.json({
            ...req.session.user,
            preferred_currency: req.session.user.preferred_currency ?? null,
            sessionId: req.sessionID
        });
    }
});

// POST /api/user/preferred-currency - Foydalanuvchi valyuta sozlamasini saqlash
router.post('/preferred-currency', isAuthenticated, async (req, res) => {
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
        log.error('Currency save error:', error.message);
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
        
        // Eski pending so'rovlarni rejected qilish (bir foydalanuvchidan faqat eng yangi so'rov pending bo'lishi kerak)
        const oldPendingRequests = await db('password_change_requests')
            .where({ user_id: userId, status: 'pending' })
            .select('id');
        
        if (oldPendingRequests.length > 0) {
            await db('password_change_requests')
                .whereIn('id', oldPendingRequests.map(r => r.id))
                .update({
                    status: 'rejected',
                    admin_comment: 'Yangi so\'rov yuborilgani uchun avtomatik rad etildi',
                    processed_at: db.fn.now()
                });
        }
        
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
        // Superadmin'larni qo'shish
        const superAdmins = await db('users')
            .whereIn('role', ['superadmin', 'super_admin'])
            .select('telegram_chat_id', 'username');
        
        // Role-based permission'ga ega foydalanuvchilarni qo'shish
        const roleBasedAdmins = await db('users')
            .join('role_permissions', 'users.role', 'role_permissions.role_name')
            .where('role_permissions.permission_key', 'users:change_password')
            .select('users.telegram_chat_id', 'users.username')
            .distinct();
        
        // Additional permission'ga ega foydalanuvchilarni qo'shish
        const additionalAdmins = await db('users')
            .join('user_permissions', 'users.id', 'user_permissions.user_id')
            .where('user_permissions.permission_key', 'users:change_password')
            .where('user_permissions.type', 'additional')
            .select('users.telegram_chat_id', 'users.username')
            .distinct();
        
        // Barcha adminlarni birlashtirish (duplikatlarni olib tashlash)
        const adminMap = new Map();
        
        [...superAdmins, ...roleBasedAdmins, ...additionalAdmins].forEach(admin => {
            const key = admin.username;
            if (!adminMap.has(key)) {
                adminMap.set(key, admin);
            }
        });
        
        const admins = Array.from(adminMap.values());
        
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
        log.error("Parol o'zgartirish so'rovi xatoligi:", error.message);
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
        log.error("Maxfiy so'zni tekshirish xatoligi:", error.message);
        res.status(500).json({ message: "Tekshirishda xatolik yuz berdi." });
    }
});

// Parol tiklash so'rovini yuborish (autentifikatsiya qilinmagan foydalanuvchilar uchun)
router.post('/reset-password-request', async (req, res) => {
    const { username, secretWord, newPassword, confirmPassword } = req.body;
    
    // Validatsiya
    if (!username || !secretWord || !newPassword || !confirmPassword) {
        return res.status(400).json({ message: "Barcha maydonlarni to'ldiring." });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ message: "Yangi parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: "Parol va tasdiqlash mos kelmaydi." });
    }
    
    try {
        // Transaction ichida barcha database operatsiyalarini bajarish
        // Bu connection pool'ni to'ldirib qo'yishni oldini oladi
        const { isPostgres, isSqlite } = require('../db.js');
        let requestId = null;
        let user = null;
        
        await db.transaction(async (trx) => {
            // Foydalanuvchini topish
            user = await trx('users').where({ username }).first();
            
            if (!user) {
                throw new Error('USER_NOT_FOUND');
            }
            
            // Maxfiy so'zni tekshirish
            if (!user.secret_word) {
                throw new Error('SECRET_WORD_NOT_SET');
            }
            
            const isSecretValid = await bcrypt.compare(secretWord, user.secret_word);
            if (!isSecretValid) {
                throw new Error('INVALID_SECRET_WORD');
            }
            
            // Yangi parolni hash qilish
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            
            // Eski pending so'rovlarni rejected qilish (bir foydalanuvchidan faqat eng yangi so'rov pending bo'lishi kerak)
            log.info(`[RESET-PASSWORD] Eski pending so'rovlar tekshirilmoqda. User ID: ${user.id}`);
            const oldPendingRequests = await trx('password_change_requests')
                .where({ user_id: user.id, status: 'pending' })
                .select('id');
            
            if (oldPendingRequests.length > 0) {
                log.info(`[RESET-PASSWORD] ${oldPendingRequests.length} ta eski pending so'rov topildi, rejected qilinmoqda...`);
                await trx('password_change_requests')
                    .whereIn('id', oldPendingRequests.map(r => r.id))
                    .update({
                        status: 'rejected',
                        admin_comment: 'Yangi so\'rov yuborilgani uchun avtomatik rad etildi',
                        processed_at: trx.fn.now()
                    });
                log.info(`[RESET-PASSWORD] ✅ ${oldPendingRequests.length} ta eski so'rov rejected qilindi`);
            }
            
            // So'rovni saqlash
            log.info(`[RESET-PASSWORD] So'rov yuborilmoqda. Username: ${username}, User ID: ${user.id}`);
            log.info(`[RESET-PASSWORD] Database type: ${isPostgres ? 'PostgreSQL' : isSqlite ? 'SQLite' : 'Unknown'}`);
            
            if (isPostgres) {
                // PostgreSQL uchun returning('id') ishlatish
                const insertResult = await trx('password_change_requests').insert({
                    user_id: user.id,
                    new_password_hash: hashedPassword,
                    status: 'pending',
                    requested_at: trx.fn.now(),
                    ip_address: req.ip || req.connection.remoteAddress,
                    user_agent: req.get('user-agent') || 'Unknown'
                }).returning('id');
                
                log.info(`[RESET-PASSWORD] PostgreSQL insert result:`, JSON.stringify(insertResult));
                
                if (Array.isArray(insertResult) && insertResult.length > 0) {
                    requestId = insertResult[0]?.id || insertResult[0];
                    log.info(`[RESET-PASSWORD] PostgreSQL requestId extracted: ${requestId}`);
                } else if (insertResult && insertResult.id) {
                    requestId = insertResult.id;
                    log.info(`[RESET-PASSWORD] PostgreSQL requestId from object: ${requestId}`);
                }
            } else {
                // SQLite uchun odatiy insert
                const insertResult = await trx('password_change_requests').insert({
                    user_id: user.id,
                    new_password_hash: hashedPassword,
                    status: 'pending',
                    requested_at: trx.fn.now(),
                    ip_address: req.ip || req.connection.remoteAddress,
                    user_agent: req.get('user-agent') || 'Unknown'
                });
                
                log.info(`[RESET-PASSWORD] SQLite insert result:`, JSON.stringify(insertResult));
                
                if (Array.isArray(insertResult) && insertResult.length > 0) {
                    requestId = insertResult[0];
                    log.info(`[RESET-PASSWORD] SQLite requestId extracted: ${requestId}`);
                } else if (insertResult) {
                    requestId = insertResult;
                    log.info(`[RESET-PASSWORD] SQLite requestId from direct value: ${requestId}`);
                }
            }
            
            log.info(`[RESET-PASSWORD] So'rov bazaga saqlandi. Insert ID: ${requestId || 'N/A'}`);
            
            if (!requestId) {
                log.error(`[RESET-PASSWORD] ⚠️ Request ID olinmadi! Insert result to'g'ri parse qilinmadi.`);
            }
        });
        
        // Transaction'dan keyin adminlarni topish (alohida query, lekin connection tezda release qilinadi)
        // Superadmin'larni qo'shish
        const superAdmins = await db('users')
            .whereIn('role', ['superadmin', 'super_admin'])
            .select('telegram_chat_id', 'username', 'id');
        
        log.info(`[RESET-PASSWORD] Topilgan superadmin'lar soni: ${superAdmins.length}`);
        superAdmins.forEach(admin => {
            log.info(`[RESET-PASSWORD] Superadmin: ${admin.username} (ID: ${admin.id}), Telegram Chat ID: ${admin.telegram_chat_id || 'YO\'Q'}`);
        });
        
        // Role-based permission'ga ega foydalanuvchilarni qo'shish
        const roleBasedAdmins = await db('users')
            .join('role_permissions', 'users.role', 'role_permissions.role_name')
            .where('role_permissions.permission_key', 'users:change_password')
            .select('users.telegram_chat_id', 'users.username', 'users.id', 'users.role')
            .distinct();
        
        log.info(`[RESET-PASSWORD] Role-based permission'ga ega foydalanuvchilar soni: ${roleBasedAdmins.length}`);
        roleBasedAdmins.forEach(admin => {
            log.info(`[RESET-PASSWORD] Role-based admin: ${admin.username} (ID: ${admin.id}, Role: ${admin.role}), Telegram Chat ID: ${admin.telegram_chat_id || 'YO\'Q'}`);
        });
        
        // Additional permission'ga ega foydalanuvchilarni qo'shish
        const additionalAdmins = await db('users')
            .join('user_permissions', 'users.id', 'user_permissions.user_id')
            .where('user_permissions.permission_key', 'users:change_password')
            .where('user_permissions.type', 'additional')
            .select('users.telegram_chat_id', 'users.username', 'users.id')
            .distinct();
        
        log.info(`[RESET-PASSWORD] Additional permission'ga ega foydalanuvchilar soni: ${additionalAdmins.length}`);
        additionalAdmins.forEach(admin => {
            log.info(`[RESET-PASSWORD] Additional admin: ${admin.username} (ID: ${admin.id}), Telegram Chat ID: ${admin.telegram_chat_id || 'YO\'Q'}`);
        });
        
        // Barcha adminlarni birlashtirish (duplikatlarni olib tashlash)
        const adminMap = new Map();
        
        [...superAdmins, ...roleBasedAdmins, ...additionalAdmins].forEach(admin => {
            if (!adminMap.has(admin.id)) {
                adminMap.set(admin.id, admin);
            }
        });
        
        const admins = Array.from(adminMap.values());
        
        log.info(`[RESET-PASSWORD] Jami topilgan adminlar soni: ${admins.length}`);
        admins.forEach(admin => {
            log.info(`[RESET-PASSWORD] Admin: ${admin.username} (ID: ${admin.id}), Telegram Chat ID: ${admin.telegram_chat_id || 'YO\'Q'}`);
        });
        
        // Telegram orqali xabar yuborish - faqat superadmin'larga (foydalanuvchiga keyin yuboriladi tasdiqlanganda)
        let sentCount = 0;
        let failedCount = 0;
        
        // Settings'dan admin chat ID ni olish (agar superadmin'ning chat ID si yo'q bo'lsa)
        const adminChatIdSetting = await db('settings').where({ key: 'telegram_admin_chat_id' }).first();
        const adminChatIdFromSettings = adminChatIdSetting ? adminChatIdSetting.value : null;
        
        // Faqat superadmin'larga yuborish
        for (const admin of superAdmins) {
            log.info(`[RESET-PASSWORD] Superadmin tekshirilmoqda: ${admin.username}, Chat ID: ${admin.telegram_chat_id || 'YO\'Q'}`);
            
            // Agar superadmin'ning telegram_chat_id yo'q bo'lsa, settings'dan olish
            let chatIdToUse = admin.telegram_chat_id;
            if (!chatIdToUse && adminChatIdFromSettings) {
                chatIdToUse = adminChatIdFromSettings;
                log.info(`[RESET-PASSWORD] Superadmin ${admin.username} uchun settings'dan chat ID olingan: ${chatIdToUse}`);
            }
            
            if (chatIdToUse) {
                try {
                    log.info(`[RESET-PASSWORD] Superadmin ${admin.username} (ID: ${admin.id}, Chat ID: ${chatIdToUse}) ga xabar yuborilmoqda...`);
                    log.info(`[RESET-PASSWORD] Request ID yuborilmoqda: ${requestId || 'NULL'}`);
                    await sendToTelegram({
                        type: 'password_change_request',
                        chat_id: chatIdToUse,
                        requester: user.username,
                        requester_fullname: user.fullname,
                        user_id: user.id,
                        request_id: requestId
                    });
                    log.info(`[RESET-PASSWORD] ✅ Xabar yuborildi. Request ID: ${requestId || 'NULL'}`);
                    sentCount++;
                    log.info(`[RESET-PASSWORD] ✅ Xabar superadmin ${admin.username} ga yuborildi`);
                } catch (error) {
                    failedCount++;
                    log.error(`[RESET-PASSWORD] ❌ Xabar superadmin ${admin.username} ga yuborishda xatolik:`, error.message);
                }
            } else {
                log.warn(`[RESET-PASSWORD] ⚠️ Superadmin ${admin.username} ning Telegram chat ID si yo'q va settings'dan ham topilmadi`);
            }
        }
        
        log.info(`[RESET-PASSWORD] Xabar yuborish natijasi: ${sentCount} ta superadminga muvaffaqiyatli, ${failedCount} ta xatolik`);
        
        res.json({ 
            message: "So'rov muvaffaqiyatli yuborildi. Admin tasdiqini kuting.",
            success: true 
        });
    } catch (error) {
        // Transaction ichida xatolik bo'lsa, uni to'g'ri handle qilish
        if (error.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        if (error.message === 'SECRET_WORD_NOT_SET') {
            return res.status(400).json({ message: "Maxfiy so'z o'rnatilmagan." });
        }
        if (error.message === 'INVALID_SECRET_WORD') {
            return res.status(401).json({ message: "Maxfiy so'z noto'g'ri." });
        }
        
        log.error("Parol tiklash so'rovi xatoligi:", error.message);
        res.status(500).json({ message: "So'rov yuborishda xatolik yuz berdi." });
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
        const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa (optimizatsiya: 5 dan 10 ga oshirildi)

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
        const { getSetting } = require('../utils/settingsCache.js');
        const botUsername = await getSetting('telegram_bot_username', null);

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
        const { createLogger } = require('../utils/logger.js');
        const log = createLogger('BOT_CONNECT');
        log.error(`[GENERATE_TOKEN] Token yaratishda xatolik: ${error.message}`, {
            username,
            stack: error.stack
        });
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
        log.error("Bot bog'lash token tekshirish xatoligi:", error.message);
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

        // Telegram aktiv holatini tekshirish
        const { getSetting } = require('../utils/settingsCache.js');
        const telegramEnabled = await getSetting('telegram_enabled', 'false');
        const telegramEnabledBool = telegramEnabled === 'true' || telegramEnabled === true;

        res.json({
            isSuperAdmin: isSuperAdmin,
            isTelegramConnected: isTelegramConnected && hasTelegramChatId,
            requiresBotConnection: telegramEnabledBool && !isSuperAdmin && (!isTelegramConnected || !hasTelegramChatId),
            username: user.username // Sessiyadagi username'ni qaytarish
        });

    } catch (error) {
        log.error("Bot obunasi holati tekshirish xatoligi:", error.message);
        res.status(500).json({ message: "Holatni tekshirishda xatolik yuz berdi." });
    }
});

module.exports = router;
