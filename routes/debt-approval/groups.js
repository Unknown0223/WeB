// routes/debt-approval/groups.js
// Guruhlar boshqaruvi - Telegram guruh ID'larini sozlash

const express = require('express');
const router = express.Router();
const { db } = require('../../db.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');
const { createLogger } = require('../../utils/logger.js');
const { clearGroupCache } = require('../../utils/groupValidator.js');

const log = createLogger('DEBT_GROUPS');

/**
 * Barcha guruhlarni olish
 */
router.get('/', isAuthenticated, hasPermission('debt:admin'), async (req, res) => {
    try {
        const groups = await db('debt_groups')
            .orderBy('group_type', 'asc')
            .select('*');
        
        res.json({ success: true, groups });
    } catch (error) {
        log.error('Error getting groups:', error);
        res.status(500).json({ success: false, message: 'Xatolik yuz berdi' });
    }
});

/**
 * Guruh yaratish yoki yangilash
 */
router.post('/', isAuthenticated, hasPermission('debt:admin'), async (req, res) => {
    try {
        const { group_type, telegram_group_id, name } = req.body;
        const userId = req.session.user.id;
        
        if (!group_type || !telegram_group_id || !name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Barcha maydonlar to\'ldirilishi kerak' 
            });
        }
        
        // Valid group types
        const validTypes = ['leaders', 'operators', 'final'];
        if (!validTypes.includes(group_type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Noto\'g\'ri guruh turi' 
            });
        }
        
        // Guruh mavjudligini tekshirish
        const existing = await db('debt_groups')
            .where('group_type', group_type)
            .where('is_active', true)
            .first();
        
        if (existing) {
            // Yangilash
            await db('debt_groups')
                .where('id', existing.id)
                .update({
                    telegram_group_id: parseInt(telegram_group_id),
                    name: name,
                    updated_at: db.fn.now()
                });
            
            // Cache'ni tozalash
            clearGroupCache();
            
            log.info(`Group updated: groupType=${group_type}, groupId=${telegram_group_id}, userId=${userId}`);
            
            res.json({ 
                success: true, 
                message: 'Guruh muvaffaqiyatli yangilandi',
                group: await db('debt_groups').where('id', existing.id).first()
            });
        } else {
            // Yangi yaratish
            const [id] = await db('debt_groups').insert({
                group_type: group_type,
                telegram_group_id: parseInt(telegram_group_id),
                name: name,
                is_active: true
            });
            
            log.info(`Group created: groupType=${group_type}, groupId=${telegram_group_id}, userId=${userId}`);
            
            res.json({ 
                success: true, 
                message: 'Guruh muvaffaqiyatli yaratildi',
                group: await db('debt_groups').where('id', id).first()
            });
        }
    } catch (error) {
        log.error('Error creating/updating group:', error);
        res.status(500).json({ success: false, message: 'Xatolik yuz berdi' });
    }
});

/**
 * Guruhni o'chirish (deaktivatsiya qilish)
 */
router.delete('/:id', isAuthenticated, hasPermission('debt:admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.id;
        
        await db('debt_groups')
            .where('id', id)
            .update({
                is_active: false,
                updated_at: db.fn.now()
            });
        
        // Cache'ni tozalash
        clearGroupCache();
        
        log.info(`Group deactivated: id=${id}, userId=${userId}`);
        
        res.json({ success: true, message: 'Guruh deaktivatsiya qilindi' });
    } catch (error) {
        log.error('Error deleting group:', error);
        res.status(500).json({ success: false, message: 'Xatolik yuz berdi' });
    }
});

/**
 * Guruhni faollashtirish
 */
router.post('/:id/activate', isAuthenticated, hasPermission('debt:admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.id;
        
        await db('debt_groups')
            .where('id', id)
            .update({
                is_active: true,
                updated_at: db.fn.now()
            });
        
        // Cache'ni tozalash
        clearGroupCache();
        
        log.info(`Group activated: id=${id}, userId=${userId}`);
        
        res.json({ success: true, message: 'Guruh faollashtirildi' });
    } catch (error) {
        log.error('Error activating group:', error);
        res.status(500).json({ success: false, message: 'Xatolik yuz berdi' });
    }
});

module.exports = router;

