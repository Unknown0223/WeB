// routes/debt-approval/blocked.js
// Bloklangan brendlar, filiallar va SVR'lar boshqaruvi

const express = require('express');
const router = express.Router();
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');

const log = createLogger('DEBT_BLOCKED');

/**
 * Bloklangan elementlarni olish
 * GET /api/debt-approval/blocked?item_type=brand|branch|svr&is_active=true
 */
router.get('/', isAuthenticated, hasPermission(['debt:block', 'debt:unblock', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { item_type, is_active = 'true' } = req.query;
        
        let query = db('debt_blocked_items')
            .leftJoin('users as blocker', 'debt_blocked_items.blocked_by', 'blocker.id')
            .leftJoin('users as unblocker', 'debt_blocked_items.unblocked_by', 'unblocker.id')
            .leftJoin('debt_brands', 'debt_blocked_items.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_blocked_items.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_blocked_items.svr_id', 'debt_svrs.id')
            .select(
                'debt_blocked_items.*',
                'blocker.username as blocked_by_username',
                'blocker.fullname as blocked_by_fullname',
                'unblocker.username as unblocked_by_username',
                'unblocker.fullname as unblocked_by_fullname',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            );
        
        if (item_type) {
            query = query.where('debt_blocked_items.item_type', item_type);
        }
        
        if (is_active === 'true') {
            query = query.where('debt_blocked_items.is_active', true);
        } else if (is_active === 'false') {
            query = query.where('debt_blocked_items.is_active', false);
        }
        
        const blocked = await query.orderBy('debt_blocked_items.blocked_at', 'desc');
        
        res.json(blocked);
    } catch (error) {
        log.error('Bloklangan elementlarni olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

/**
 * Elementni bloklash
 * POST /api/debt-approval/blocked
 * Body: { item_type: 'brand'|'branch'|'svr', brand_id?: number, branch_id?: number, svr_id?: number, reason: string, comment?: string }
 */
router.post('/', isAuthenticated, hasPermission(['debt:block', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { item_type, brand_id, branch_id, svr_id, reason, comment } = req.body;
        const userId = req.session.user.id;
        
        // Validatsiya
        if (!item_type || !['brand', 'branch', 'svr'].includes(item_type)) {
            return res.status(400).json({ error: 'item_type "brand", "branch" yoki "svr" bo\'lishi kerak' });
        }
        
        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Bloklash sababi (reason) kiritilishi shart' });
        }
        
        // Item_type bo'yicha ID tekshirish
        if (item_type === 'brand' && !brand_id) {
            return res.status(400).json({ error: 'brand_id kiritilishi shart' });
        }
        if (item_type === 'branch' && !branch_id) {
            return res.status(400).json({ error: 'branch_id kiritilishi shart' });
        }
        if (item_type === 'svr' && !svr_id) {
            return res.status(400).json({ error: 'svr_id kiritilishi shart' });
        }
        
        // Avval faol bloklash bor-yo'qligini tekshirish
        let existingQuery = db('debt_blocked_items').where('is_active', true);
        
        if (item_type === 'brand') {
            existingQuery = existingQuery.where('brand_id', brand_id).where('item_type', 'brand');
        } else if (item_type === 'branch') {
            existingQuery = existingQuery.where('branch_id', branch_id).where('item_type', 'branch');
        } else if (item_type === 'svr') {
            existingQuery = existingQuery.where('svr_id', svr_id).where('item_type', 'svr');
        }
        
        const existing = await existingQuery.first();
        
        if (existing) {
            return res.status(400).json({ error: 'Bu element allaqachon bloklangan' });
        }
        
        // Bloklash
        const [blockedId] = await db('debt_blocked_items').insert({
            item_type,
            brand_id: item_type === 'brand' ? brand_id : null,
            branch_id: item_type === 'branch' ? branch_id : null,
            svr_id: item_type === 'svr' ? svr_id : null,
            reason: reason.trim(),
            comment: comment ? comment.trim() : null,
            blocked_by: userId,
            blocked_at: db.fn.now(),
            is_active: true
        });
        
        log.info(`Element bloklandi: item_type=${item_type}, id=${brand_id || branch_id || svr_id}, blocked_by=${userId}`);
        
        // Bloklangan elementni olish
        const blocked = await db('debt_blocked_items')
            .leftJoin('users as blocker', 'debt_blocked_items.blocked_by', 'blocker.id')
            .leftJoin('debt_brands', 'debt_blocked_items.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_blocked_items.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_blocked_items.svr_id', 'debt_svrs.id')
            .select(
                'debt_blocked_items.*',
                'blocker.username as blocked_by_username',
                'blocker.fullname as blocked_by_fullname',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
            .where('debt_blocked_items.id', blockedId)
            .first();
        
        res.json({ success: true, blocked });
    } catch (error) {
        log.error('Elementni bloklashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

/**
 * Bloklashni bekor qilish (unblock)
 * POST /api/debt-approval/blocked/:id/unblock
 */
router.post('/:id/unblock', isAuthenticated, hasPermission(['debt:unblock', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.id;
        
        // Bloklangan elementni to'liq ma'lumotlari bilan olish
        const blocked = await db('debt_blocked_items')
            .leftJoin('users as blocker', 'debt_blocked_items.blocked_by', 'blocker.id')
            .leftJoin('debt_brands', 'debt_blocked_items.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_blocked_items.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_blocked_items.svr_id', 'debt_svrs.id')
            .select(
                'debt_blocked_items.*',
                'blocker.telegram_chat_id as blocker_telegram_chat_id',
                'blocker.fullname as blocker_fullname',
                'blocker.username as blocker_username',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
            .where('debt_blocked_items.id', id)
            .where('debt_blocked_items.is_active', true)
            .first();
        
        if (!blocked) {
            return res.status(404).json({ error: 'Bloklangan element topilmadi yoki allaqachon ochilgan' });
        }
        
        // Unblock qiluvchi foydalanuvchi ma'lumotlarini olish
        const unblocker = await db('users').where('id', userId).first();
        
        // Bloklashni bekor qilish
        await db('debt_blocked_items')
            .where('id', id)
            .update({
                is_active: false,
                unblocked_at: db.fn.now(),
                unblocked_by: userId
            });
        
        log.info(`Bloklash bekor qilindi: id=${id}, unblocked_by=${userId}`);
        
        // Element nomi va turini aniqlash
        const itemName = blocked.brand_name || blocked.branch_name || blocked.svr_name || 'Noma\'lum';
        const itemTypeText = blocked.item_type === 'brand' ? 'Brend' : 
                           blocked.item_type === 'branch' ? 'Filial' : 'SVR';
        
        // Bloklashni yaratgan foydalanuvchiga (menejerga) xabar yuborish
        // Faqat menejerlarga xabar yuborish
        if (blocked.blocker_telegram_chat_id) {
            try {
                // Bloklashni yaratgan foydalanuvchining rolini tekshirish
                const blockerUser = await db('users').where('id', blocked.blocked_by).first();
                
                if (blockerUser && (blockerUser.role === 'menejer' || blockerUser.role === 'manager')) {
                    const { getBot } = require('../../utils/bot.js');
                    const bot = getBot();
                    
                    if (bot) {
                        const message = `🔓 <b>Bloklash bekor qilindi</b>\n\n` +
                            `✅ <b>${itemName}</b> (${itemTypeText}) elementining bloklanishi bekor qilindi.\n\n` +
                            `📝 <b>Bloklash sababi:</b> ${blocked.reason || 'Noma\'lum'}\n` +
                            (blocked.comment ? `💬 <b>Izoh:</b> ${blocked.comment}\n` : '') +
                            `\n👤 <b>Bekor qildi:</b> ${unblocker?.fullname || unblocker?.username || 'Noma\'lum'}\n` +
                            `📅 <b>Vaqt:</b> ${new Date().toLocaleString('uz-UZ')}\n\n` +
                            `⚠️ Endi bu element yana so'rov yaratish uchun mavjud.`;
                        
                        await bot.sendMessage(blocked.blocker_telegram_chat_id, message, {
                            parse_mode: 'HTML'
                        });
                        
                        log.info(`Bloklash bekor qilish xabari menejerga yuborildi: blocker_chat_id=${blocked.blocker_telegram_chat_id}, blocker_id=${blocked.blocked_by}, item=${itemName}`);
                    } else {
                        log.warn('Bot topilmadi, xabar yuborilmadi');
                    }
                } else {
                    log.info(`Bloklashni yaratgan foydalanuvchi menejer emas, xabar yuborilmadi: blocked_by=${blocked.blocked_by}, role=${blockerUser?.role || 'Noma\'lum'}`);
                }
            } catch (telegramError) {
                log.error('Telegram xabar yuborishda xatolik:', telegramError);
                // Xabar yuborishda xatolik bo'lsa ham, unblock amali muvaffaqiyatli bo'lishi kerak
            }
        } else {
            log.info(`Bloklashni yaratgan foydalanuvchining telegram_chat_id yo'q, xabar yuborilmadi: blocked_by=${blocked.blocked_by}`);
        }
        
        res.json({ success: true, message: 'Bloklash muvaffaqiyatli bekor qilindi' });
    } catch (error) {
        log.error('Bloklashni bekor qilishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

/**
 * Bloklangan elementni o'chirish
 * DELETE /api/debt-approval/blocked/:id
 */
router.delete('/:id', isAuthenticated, hasPermission(['debt:block', 'debt:unblock', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { id } = req.params;
        
        const deleted = await db('debt_blocked_items').where('id', id).delete();
        
        if (deleted === 0) {
            return res.status(404).json({ error: 'Bloklangan element topilmadi' });
        }
        
        log.info(`Bloklangan element o'chirildi: id=${id}`);
        
        res.json({ success: true, message: 'Bloklangan element o\'chirildi' });
    } catch (error) {
        log.error('Bloklangan elementni o\'chirishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

/**
 * Element bloklanganligini tekshirish
 * GET /api/debt-approval/blocked/check?item_type=brand&brand_id=1
 */
router.get('/check', isAuthenticated, async (req, res) => {
    try {
        const { item_type, brand_id, branch_id, svr_id } = req.query;
        
        if (!item_type || !['brand', 'branch', 'svr'].includes(item_type)) {
            return res.status(400).json({ error: 'item_type "brand", "branch" yoki "svr" bo\'lishi kerak' });
        }
        
        let query = db('debt_blocked_items')
            .where('is_active', true)
            .where('item_type', item_type);
        
        if (item_type === 'brand' && brand_id) {
            query = query.where('brand_id', brand_id);
        } else if (item_type === 'branch' && branch_id) {
            query = query.where('branch_id', branch_id);
        } else if (item_type === 'svr' && svr_id) {
            query = query.where('svr_id', svr_id);
        } else {
            return res.status(400).json({ error: 'Tegishli ID kiritilishi shart' });
        }
        
        const blocked = await query.first();
        
        if (blocked) {
            res.json({ 
                is_blocked: true, 
                blocked,
                message: blocked.reason || 'Bu element bloklangan'
            });
        } else {
            res.json({ is_blocked: false });
        }
    } catch (error) {
        log.error('Bloklashni tekshirishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

module.exports = router;

