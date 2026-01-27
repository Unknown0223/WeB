// routes/debt-approval/buttons.js
// Bot menu knopkalari sozlamalari

const express = require('express');
const router = express.Router();
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');

const log = createLogger('BOT_BUTTONS');

// GET /api/debt-approval/buttons - Barcha knopkalar ro'yxati
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const buttons = await db('bot_menu_buttons')
            .orderBy('category', 'asc')
            .orderBy('order_index', 'asc')
            .select('*');
        
        res.json({ buttons });
    } catch (error) {
        log.error('Knopkalarni olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// GET /api/debt-approval/buttons/roles/list - Barcha rollar ro'yxati (/:role dan oldin bo'lishi kerak)
router.get('/roles/list', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const roles = await db('roles')
            .orderBy('role_name', 'asc')
            .select('role_name');
        
        res.json({ roles: roles.map(r => r.role_name) });
    } catch (error) {
        log.error('Rollarni olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// GET /api/debt-approval/buttons/:role - Rol uchun knopkalar
router.get('/:role', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { role } = req.params;
        
        log.debug(`[GET] Rol uchun knopkalar so'raldi: role=${role}`);
        
        // Barcha knopkalarni olish
        const allButtons = await db('bot_menu_buttons')
            .orderBy('category', 'asc')
            .orderBy('order_index', 'asc')
            .select('*');
        
        // Bu rol uchun sozlamalarni olish
        const settings = await db('bot_role_button_settings')
            .where('role_name', role)
            .select('button_id', 'is_visible', 'order_index');
        
        log.debug(`[GET] Topildi: allButtons=${allButtons.length}, settings=${settings.length}`);
        
        // Settings'ni map qilish
        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.button_id] = {
                is_visible: s.is_visible,
                order_index: s.order_index
            };
        });
        
        // Barcha knopkalarni qo'shish, lekin is_visible ni to'g'ri belgilash
        const buttons = allButtons.map(btn => {
            const setting = settingsMap[btn.id];
            // SQLite'da boolean qiymatlar 1/0 sifatida qaytadi
            const isVisible = setting 
                ? (setting.is_visible === true || setting.is_visible === 1 || Boolean(setting.is_visible))
                : true; // Agar sozlama bo'lmasa, default true
            return {
                ...btn,
                is_visible: isVisible,
                final_order_index: setting ? setting.order_index : btn.order_index
            };
        });
        
        // SQLite'da boolean qiymatlar 1/0 sifatida qaytadi, shuning uchun tekshirishni yaxshilash
        const visibleCount = buttons.filter(b => b.is_visible === true || b.is_visible === 1 || Boolean(b.is_visible)).length;
        const hiddenCount = buttons.length - visibleCount;
        
        log.debug(`[GET] Natija: role=${role}, total=${buttons.length}, visible=${visibleCount}, hidden=${hiddenCount}`);
        
        res.json({ buttons, role });
    } catch (error) {
        log.error('Rol knopkalarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// POST /api/debt-approval/buttons/:role - Rol uchun knopkalarni sozlash
router.post('/:role', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { role } = req.params;
        const { buttons, button_id, is_visible } = req.body;
        
        log.debug(`[POST] Saqlash so'rovi: role=${role}, buttons=${Array.isArray(buttons) ? buttons.length : 'N/A'}, button_id=${button_id}, is_visible=${is_visible}`);
        
        // Agar bitta knopka yangilansa (button_id va is_visible mavjud)
        if (button_id !== undefined && is_visible !== undefined) {
            // Mavjud sozlamani tekshirish
            const existingSetting = await db('bot_role_button_settings')
                .where({ role_name: role, button_id })
                .first();
            
            if (existingSetting) {
                await db('bot_role_button_settings')
                    .where({ role_name: role, button_id })
                    .update({ is_visible, updated_at: db.fn.now() });
                log.debug(`[POST] Knopka yangilandi: role=${role}, button_id=${button_id}, is_visible=${is_visible}`);
            } else {
                // Button ma'lumotlarini olish
                const button = await db('bot_menu_buttons').where('id', button_id).first();
                if (button) {
                    await db('bot_role_button_settings').insert({
                        role_name: role,
                        button_id,
                        is_visible,
                        order_index: button.order_index || 0,
                        updated_at: db.fn.now()
                    });
                    log.debug(`[POST] Yangi knopka qo'shildi: role=${role}, button_id=${button_id}, is_visible=${is_visible}`);
                }
            }
            
            log.info(`Rol uchun bitta knopka sozlandi: role=${role}, button_id=${button_id}, is_visible=${is_visible}`);
            return res.json({ success: true, message: 'Knopka sozlamasi saqlandi' });
        }
        
        // Agar buttons array yuborilsa (ko'p knopkalar bir vaqtda)
        if (!Array.isArray(buttons)) {
            log.warn(`[POST] Noto'g'ri format: buttons array emas`);
            return res.status(400).json({ error: 'buttons array bo\'lishi kerak yoki button_id va is_visible berilishi kerak' });
        }
        
        log.debug(`[POST] Transaction boshlandi: role=${role}, buttons=${buttons.length}`);
        
        // Visible va hidden knopkalarni sanash
        const visibleCount = buttons.filter(b => b.is_visible).length;
        const hiddenCount = buttons.filter(b => !b.is_visible).length;
        log.debug(`[POST] Knopkalar: visible=${visibleCount}, hidden=${hiddenCount}`);
        
        // Transaction ichida barcha o'zgarishlarni saqlash
        await db.transaction(async (trx) => {
            // Avval barcha eski sozlamalarni o'chirish
            const deleted = await trx('bot_role_button_settings')
                .where('role_name', role)
                .delete();
            
            log.debug(`[POST] Eski sozlamalar o'chirildi: role=${role}, deleted=${deleted}`);
            
            // Yangi sozlamalarni qo'shish (ham visible, ham hidden)
            let inserted = 0;
            for (const btn of buttons) {
                if (btn.button_id && btn.is_visible !== undefined) {
                    await trx('bot_role_button_settings').insert({
                        role_name: role,
                        button_id: btn.button_id,
                        is_visible: btn.is_visible, // false ham saqlanadi!
                        order_index: btn.order_index || 0,
                        updated_at: db.fn.now()
                    });
                    inserted++;
                }
            }
            
            log.debug(`[POST] Yangi sozlamalar qo'shildi: role=${role}, inserted=${inserted}`);
        });
        
        log.info(`Rol uchun knopkalar sozlandi: role=${role}, buttons=${buttons.length}, visible=${visibleCount}, hidden=${hiddenCount}`);
        res.json({ success: true, message: 'Knopkalar muvaffaqiyatli saqlandi' });
    } catch (error) {
        log.error('Rol knopkalarini saqlashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// POST /api/debt-approval/buttons/:role/copy-from/:fromRole - Bir roldan boshqa rolgaknopkalarni qo'shish
router.post('/:role/copy-from/:fromRole', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { role, fromRole } = req.params;
        
        if (role === fromRole) {
            return res.status(400).json({ error: 'Bir xil roldan ko\'chirib bo\'lmaydi' });
        }
        
        // FromRole'dan ko'rsatiladigan knopkalarni olish
        const fromRoleButtons = await db('bot_role_button_settings')
            .where('role_name', fromRole)
            .where('is_visible', true)
            .select('button_id', 'order_index');
        
        if (fromRoleButtons.length === 0) {
            return res.json({ success: true, message: 'Ko\'chiriladigan knopkalar topilmadi', copied: 0 });
        }
        
        // Target role uchun mavjud sozlamalarni olish
        const existingSettings = await db('bot_role_button_settings')
            .where('role_name', role)
            .select('button_id');
        
        const existingButtonIds = new Set(existingSettings.map(s => s.button_id));
        
        // Transaction ichida qo'shish
        let copied = 0;
        await db.transaction(async (trx) => {
            for (const btn of fromRoleButtons) {
                // Agar bu knopka allaqachon mavjud bo'lsa, o'tkazib yuborish
                if (existingButtonIds.has(btn.button_id)) {
                    continue;
                }
                
                // Button ma'lumotlarini olish
                const button = await trx('bot_menu_buttons').where('id', btn.button_id).first();
                if (button) {
                    await trx('bot_role_button_settings').insert({
                        role_name: role,
                        button_id: btn.button_id,
                        is_visible: true,
                        order_index: btn.order_index || button.order_index || 0,
                        updated_at: db.fn.now()
                    });
                    copied++;
                }
            }
        });
        
        log.info(`Knopkalar ko'chirildi: fromRole=${fromRole}, toRole=${role}, copied=${copied}`);
        res.json({ success: true, message: `${copied} ta knopka muvaffaqiyatli qo'shildi`, copied });
    } catch (error) {
        log.error('Knopkalarni ko\'chirishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

module.exports = router;

