const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db.js');
const { sendToTelegram } = require('../utils/bot.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('TELEGRAM');


const router = express.Router();

// Ro'yxatdan o'tish bilan bog'liq endpoint'lar olib tashlandi
// Barcha tasdiqlashlar web'dan (admin panel) amalga oshiriladi

// ===================================================================
// === FOYDALANUVCHINI TASDIQLASHNI YAKUNLASH (YANGILANGAN MANTIQ) ===
// ===================================================================
// Bu endpoint endi faqat web'dan chaqiriladi
router.post('/finalize-approval', async (req, res) => {
    const { user_id, role, locations = [], brands = [] } = req.body;
    
    if (!user_id || !role) {
        log.error(`[TELEGRAM API] Validatsiya xatosi: user_id yoki role yo'q`);
        return res.status(400).json({ message: "Foydalanuvchi ID si va rol yuborilishi shart." });
    }

    // Super admin yaratish mumkin emas
    if (role === 'super_admin') {
        log.error(`[TELEGRAM API] Super admin yaratishga urinish`);
        return res.status(403).json({ message: "Super admin yaratish mumkin emas." });
    }

    // Rol bazada mavjudligini tekshirish
    const { db } = require('../db.js');
    const roleExists = await db('roles').where({ role_name: role }).first();
    if (!roleExists) {
        log.error(`[TELEGRAM API] Rol topilmadi. Role: ${role}`);
        return res.status(400).json({ message: "Tanlangan rol mavjud emas." });
    }

    // Rol talablarini bazadan olish
    const roleData = await db('roles').where({ role_name: role }).first();
    if (!roleData) {
        log.error(`[TELEGRAM API] Rol ma'lumotlari topilmadi. Role: ${role}`);
        return res.status(400).json({ message: "Tanlangan rol mavjud emas." });
    }
    
    try {
        // Foydalanuvchi allaqachon tasdiqlanmaganligini tekshirish
        const existingUser = await db('users').where({ id: user_id }).first();
        if (existingUser && existingUser.status === 'active') {
            return res.status(409).json({ message: "Bu foydalanuvchi allaqachon tasdiqlangan (ehtimol admin panel orqali)." });
        }
        // Bot orqali yoki web'dan tasdiqlash uchun status_in_process yoki pending_approval bo'lishi mumkin
        if (!existingUser || !['status_in_process', 'pending_approval'].includes(existingUser.status)) {
             return res.status(404).json({ message: "So'rov topilmadi yoki eskirgan. Ehtimol, jarayon bekor qilingan." });
        }

        const tempReg = await db('pending_registrations').where({ user_id: user_id }).first();
        if (!tempReg) {
            return res.status(404).json({ message: "Ro'yxatdan o'tish uchun vaqtinchalik ma'lumotlar topilmadi." });
        }

        const userData = JSON.parse(tempReg.user_data);
        const { password, secret_word } = userData;

        await db.transaction(async trx => {
            await trx('users').where({ id: user_id }).update({
                status: 'active',
                role: role,
                must_delete_creds: true
            });

            await trx('user_locations').where({ user_id: user_id }).del();
            if (locations && locations.length > 0) {
                const locationsToInsert = locations.map(loc => ({ user_id: user_id, location_name: loc }));
                await trx('user_locations').insert(locationsToInsert);
            }
            
            // Manager va Admin uchun brendlarni saqlash
            await trx('user_brands').where({ user_id: user_id }).del();
            if ((role === 'manager' || role === 'admin') && brands && brands.length > 0) {
                const brandRecords = brands.map(brandId => ({
                    user_id: user_id,
                    brand_id: brandId
                }));
                await trx('user_brands').insert(brandRecords);
            }
        });

        if (existingUser && existingUser.telegram_chat_id) {
            await sendToTelegram({
                type: 'user_approved_credentials',
                chat_id: existingUser.telegram_chat_id,
                user_id: user_id,
                fullname: existingUser.fullname,
                username: existingUser.username,
                password: password,
                secret_word: secret_word
            });
        }

        await db('pending_registrations').where({ user_id: user_id }).del();

        res.json({ status: 'success', message: 'Foydalanuvchi muvaffaqiyatli tasdiqlandi.' });

    } catch (error) {
        log.error(`[TELEGRAM API] /api/telegram/finalize-approval xatoligi:`, error);
        log.error(`[TELEGRAM API] Error stack:`, error.stack);
        // Agar xatolik yuz bersa, statusni qaytarish
        try {
            await db('users').where({ id: user_id, status: 'status_in_process' }).update({ status: 'pending_approval' });
        } catch (updateError) {
            log.error(`❌ [TELEGRAM API] Statusni qaytarishda xatolik:`, updateError);
        }
        res.status(500).json({ message: "Foydalanuvchini tasdiqlashda server xatoligi." });
    }
});


// POST /api/telegram/verify-secret-word - Maxfiy so'zni tekshirish
router.post('/verify-secret-word', async (req, res) => {
    const { user_id, secret_word } = req.body;
    const MAX_SECRET_ATTEMPTS = 2;

    try {
        const user = await db('users').where({ id: user_id }).first();

        if (!user || !user.secret_word) {
            log.error(`[VERIFY_SECRET] Foydalanuvchi yoki maxfiy so'z topilmadi - User ID: ${user_id}`);
            return res.status(400).json({ status: 'fail', message: "Foydalanuvchi yoki maxfiy so'z topilmadi." });
        }

        // Maxfiy so'zni trim qilish va bo'sh joylarni olib tashlash
        const trimmedSecretWord = (secret_word || '').trim();
        
        if (!trimmedSecretWord) {
            log.error(`[VERIFY_SECRET] Maxfiy so'z bo'sh - User ID: ${user_id}`);
            return res.status(400).json({ status: 'fail', message: "Maxfiy so'z kiritilmadi." });
        }

        const match = await bcrypt.compare(trimmedSecretWord, user.secret_word);

        if (match) {
            const token = uuidv4();
            const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa
            
            await db('magic_links').insert({
                token: token,
                user_id: user_id,
                expires_at: expires_at.toISOString()
            });
            await db('users').where({ id: user_id }).update({ login_attempts: 0 });
            
            return res.json({ status: 'success', magic_token: token });

        } else {
            const newAttempts = (user.login_attempts || 0) + 1;
            await db('users').where({ id: user_id }).update({ login_attempts: newAttempts });

            log.error(`[VERIFY_SECRET] Maxfiy so'z noto'g'ri - User ID: ${user_id}, Urinishlar: ${newAttempts}/${MAX_SECRET_ATTEMPTS}`);

            if (newAttempts >= MAX_SECRET_ATTEMPTS) {
                await sendToTelegram({
                    type: 'security_alert',
                    user_id: user.id,
                    username: user.username
                });
                return res.json({ status: 'locked', message: "Urinishlar soni tugadi." });
            }
            return res.json({ status: 'fail', message: "Maxfiy so'z noto'g'ri." });
        }
    } catch (error) {
        log.error(`[VERIFY_SECRET] Xatolik - User ID: ${user_id}`, error);
        res.status(500).json({ message: "Serverda kutilmagan xatolik." });
    }
});

// POST /api/telegram/notify-admin-lock - Adminni ogohlantirish
router.post('/notify-admin-lock', async (req, res) => {
    const { user_id } = req.body;
    try {
        const user = await db('users').where({ id: user_id }).select('username').first();
        if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi." });

        await sendToTelegram({
            type: 'security_alert',
            user_id: user_id,
            username: user.username
        });
        res.json({ status: 'success' });
    } catch (error) {
        log.error("/api/telegram/notify-admin-lock xatoligi:", error);
        res.status(500).json({ message: "Serverda xatolik." });
    }
});

// POST /api/telegram/reset-attempts - Urinishlarni tiklash
router.post('/reset-attempts', async (req, res) => {
    const { user_id } = req.body;
    try {
        const user = await db('users').where({ id: user_id }).select('id', 'username', 'telegram_chat_id').first();
        if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi." });

        await db('users').where({ id: user_id }).update({ login_attempts: 0 });

        if (user.telegram_chat_id) {
            await sendToTelegram({
                type: 'secret_word_request',
                chat_id: user.telegram_chat_id,
                user_id: user.id,
                username: user.username
            });
        }
        res.json({ status: 'success' });
    } catch (error) {
        log.error("/api/telegram/reset-attempts xatoligi:", error);
        res.status(500).json({ message: "Serverda xatolik." });
    }
});

// POST /api/telegram/confirm-lock - Bloklashni tasdiqlash
router.post('/confirm-lock', async (req, res) => {
    res.json({ status: 'success', message: 'Bloklash tasdiqlandi.' });
});

// POST /api/telegram/unblock-user - Blokdan chiqarish
router.post('/unblock-user', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ message: "Foydalanuvchi ID'si yuborilmadi." });
    try {
        await db('users').where({ id: user_id }).update({ 
            status: 'active', 
            login_attempts: 0, 
            lock_reason: null 
        });
        res.json({ status: 'success', message: "Foydalanuvchi blokdan chiqarildi." });
    } catch (error) {
        log.error("/api/telegram/unblock-user xatoligi:", error);
        res.status(500).json({ message: "Serverda xatolik." });
    }
});

// POST /api/telegram/keep-blocked - Bloklashni tasdiqlash
router.post('/keep-blocked', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ message: "Foydalanuvchi ID'si yuborilmadi." });
    try {
        const lockMessage = "Kirishingiz administrator tomonidan rad etildi.";
        await db('users').where({ id: user_id }).update({ lock_reason: lockMessage });
        res.json({ status: 'success', message: "Foydalanuvchi bloklangan holatda qoldirildi." });
    } catch (error) {
        log.error("/api/telegram/keep-blocked xatoligi:", error);
        res.status(500).json({ message: "Serverda xatolik." });
    }
});

module.exports = router;
