const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db.js');
const { sendToTelegram } = require('../utils/bot.js');

const router = express.Router();

// POST /api/telegram/register-chat - Mavjud foydalanuvchini botga ulash
router.post('/register-chat', async (req, res) => {
    const { chat_id, username, code } = req.body;
    if (!chat_id || !code || !code.startsWith('connect_')) {
        return res.status(400).json({ message: "Ma'lumotlar to'liq emas." });
    }

    try {
        const parts = code.split('_');
        if (parts.length < 3) return res.status(400).json({ message: "Kod formati noto'g'ri." });
        
        const userId = parts[1];
        
        // Avval bu chat_id ga ulangan boshqa foydalanuvchini tozalash
        await db('users').where({ telegram_chat_id: chat_id }).update({ telegram_chat_id: null, telegram_username: null });
        
        // Yangi foydalanuvchini ulash
        const result = await db('users').where({ id: userId }).update({
            telegram_chat_id: chat_id,
            telegram_username: username
        });

        if (result === 0) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }

        res.json({ status: 'success', message: 'Muvaffaqiyatli ulandi.' });
    } catch (error) {
        console.error("/api/telegram/register-chat xatoligi:", error);
        res.status(500).json({ message: "Serverda kutilmagan xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHINI TASDIQLASHNI YAKUNLASH (YANGILANGAN MANTIQ) ===
// ===================================================================
router.post('/finalize-approval', async (req, res) => {
    const { user_id, role, locations } = req.body;
    if (!user_id || !role) {
        return res.status(400).json({ message: "Foydalanuvchi ID si va rol yuborilishi shart." });
    }

    try {
        // Foydalanuvchi allaqachon tasdiqlanmaganligini tekshirish
        const existingUser = await db('users').where({ id: user_id }).first();
        if (existingUser && existingUser.status === 'active') {
            return res.status(409).json({ message: "Bu foydalanuvchi allaqachon tasdiqlangan (ehtimol admin panel orqali)." });
        }
        if (!existingUser || existingUser.status !== 'status_in_process') {
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
        console.error("/api/telegram/finalize-approval xatoligi:", error);
        // Agar xatolik yuz bersa, statusni qaytarish
        await db('users').where({ id: user_id, status: 'status_in_process' }).update({ status: 'pending_approval' });
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
            return res.status(400).json({ status: 'fail', message: "Foydalanuvchi yoki maxfiy so'z topilmadi." });
        }

        const match = await bcrypt.compare(secret_word, user.secret_word);

        if (match) {
            const token = uuidv4();
            const expires_at = new Date(Date.now() + 5 * 60 * 1000);
            
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
        console.error("/api/telegram/verify-secret-word xatoligi:", error);
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
        console.error("/api/telegram/notify-admin-lock xatoligi:", error);
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
        console.error("/api/telegram/reset-attempts xatoligi:", error);
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
        console.error("/api/telegram/unblock-user xatoligi:", error);
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
        console.error("/api/telegram/keep-blocked xatoligi:", error);
        res.status(500).json({ message: "Serverda xatolik." });
    }
});

module.exports = router;
