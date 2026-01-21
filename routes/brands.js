const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { getVisibleBrands, filterBrandsByRole } = require('../utils/roleFiltering.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('BRANDS');


// GET /api/brands - Barcha brendlarni olish (barcha autentifikatsiya qilingan foydalanuvchilar uchun)
// Query parameter: location - faqat shu filialdagi brendlarni olish
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const { location } = req.query;
        
        let query = db('brands')
            .leftJoin('users', 'brands.created_by', 'users.id')
            .select(
                'brands.id',
                'brands.name',
                'brands.color',
                'brands.emoji',
                'brands.sort_order',
                'brands.created_by',
                'brands.created_at',
                'brands.updated_at',
                'users.username as created_by_username',
                'users.fullname as created_by_fullname'
            )
            .orderBy('brands.name');

        // Agar location parametr berilgan bo'lsa, faqat shu filialdagi brendlarni filtrlaymiz
        if (location) {
            query = query
                .join('brand_locations', 'brands.id', 'brand_locations.brand_id')
                .where('brand_locations.location_name', location)
                .distinct();
        }

        const brands = await query;

        // Har bir brend uchun filiallarni olish (agar location filtr qo'llanmagan bo'lsa)
        if (!location) {
            for (let brand of brands) {
                const locations = await db('brand_locations')
                    .where('brand_id', brand.id)
                    .select('location_name');
                brand.locations = locations.map(l => l.location_name);
            }
        } else {
            // Location filtr qo'llanganida har bir brendga faqat shu filialni qo'shamiz
            for (let brand of brands) {
                brand.locations = [location];
            }
        }

        res.json(brands);
    } catch (error) {
        log.error('/api/brands GET xatoligi:', error);
        res.status(500).json({ message: "Brendlarni olishda xatolik" });
    }
});

// GET /api/brands/for-user - Foydalanuvchi uchun mavjud brendlar
router.get('/for-user', isAuthenticated, async (req, res) => {
    try {
        const user = req.session.user;
        
        // Yangi logika: rol shartlari bo'yicha ko'rinadigan brendlarni olish
        const visibleBrandIds = await getVisibleBrands(user);
        
        if (visibleBrandIds.length === 0) {
            // Agar hech narsa ko'rinmasa, bo'sh ro'yxat qaytaramiz
            return res.json([]);
        }
        
        const brands = await db('brands')
            .whereIn('id', visibleBrandIds)
            .select('*')
            .orderBy('name');

        res.json(brands);
    } catch (error) {
        log.error('/api/brands/for-user GET xatoligi:', error);
        res.status(500).json({ message: "Brendlarni olishda xatolik" });
    }
});

// POST /api/brands - Yangi brend yaratish
router.post('/', isAuthenticated, hasPermission('settings:edit_table'), async (req, res) => {
    try {
        const { name, locations, color, emoji, sort_order } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Brend nomi kiritilmagan" });
        }

        // Brend nomini tekshirish
        const existing = await db('brands').where('name', name).first();
        if (existing) {
            return res.status(400).json({ message: "Bunday nomdagi brend allaqachon mavjud" });
        }

        // Brendni yaratish
        const [brandId] = await db('brands').insert({
            name: name.trim(),
            color: color || '#4facfe',
            emoji: emoji || '🏢',
            sort_order: sort_order !== undefined && sort_order !== null && sort_order !== '' ? parseInt(sort_order) : null,
            created_by: req.user?.id || null,
            created_at: new Date().toISOString()
        });

        // Filiallarn biriktirish
        if (locations && Array.isArray(locations) && locations.length > 0) {
            const locationRecords = locations.map(loc => ({
                brand_id: brandId,
                location_name: loc
            }));
            await db('brand_locations').insert(locationRecords);
        }

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [BRANDS] Yangi brend yaratildi, WebSocket orqali yuborilmoqda...`);
            const newBrand = await db('brands').where('id', brandId).first();
            global.broadcastWebSocket('brand_updated', {
                action: 'created',
                brand: {
                    id: brandId,
                    name: newBrand.name,
                    color: newBrand.color,
                    emoji: newBrand.emoji
                }
            });
            log.debug(`✅ [BRANDS] WebSocket yuborildi: brand_updated (created)`);
        }
        
        res.json({ 
            message: "Brend muvaffaqiyatli yaratildi",
            id: brandId
        });
    } catch (error) {
        log.error('/api/brands POST xatoligi:', error);
        res.status(500).json({ message: "Brendni yaratishda xatolik" });
    }
});

// PUT /api/brands/:id - Brendni yangilash
router.put('/:id', isAuthenticated, hasPermission('settings:edit_table'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, locations, color, emoji, description, sort_order } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Brend nomi kiritilmagan" });
        }

        // Boshqa brend bilan nom to'qnashmasligi
        const existing = await db('brands')
            .where('name', name)
            .whereNot('id', id)
            .first();
        if (existing) {
            return res.status(400).json({ message: "Bunday nomdagi brend allaqachon mavjud" });
        }

        // Brendni yangilash
        await db('brands')
            .where('id', id)
            .update({
                name: name.trim(),
                color: color || '#4facfe',
                emoji: emoji || '🏢',
                sort_order: sort_order !== undefined && sort_order !== null && sort_order !== '' ? parseInt(sort_order) : null,
                updated_at: new Date().toISOString()
            });

        // Filiallarn yangilash
        await db('brand_locations').where('brand_id', id).del();
        if (locations && Array.isArray(locations) && locations.length > 0) {
            const locationRecords = locations.map(loc => ({
                brand_id: id,
                location_name: loc
            }));
            await db('brand_locations').insert(locationRecords);
        }

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [BRANDS] Brend yangilandi, WebSocket orqali yuborilmoqda...`);
            const updatedBrand = await db('brands').where('id', id).first();
            global.broadcastWebSocket('brand_updated', {
                action: 'updated',
                brand: {
                    id: parseInt(id),
                    name: updatedBrand.name,
                    color: updatedBrand.color,
                    emoji: updatedBrand.emoji
                }
            });
            log.debug(`✅ [BRANDS] WebSocket yuborildi: brand_updated (updated)`);
        }
        
        res.json({ message: "Brend muvaffaqiyatli yangilandi" });
    } catch (error) {
        log.error(`/api/brands/${req.params.id} PUT xatoligi:`, error);
        res.status(500).json({ message: "Brendni yangilashda xatolik" });
    }
});

// DELETE /api/brands/:id - Brendni o'chirish
router.delete('/:id', isAuthenticated, hasPermission('settings:edit_table'), async (req, res) => {
    try {
        const { id } = req.params;

        // Brendni o'chirishdan oldin ma'lumotlarni olish
        const deletedBrand = await db('brands').where('id', id).first();
        
        // Brendni o'chirish (CASCADE orqali bog'lanishlar ham o'chadi)
        await db('brands').where('id', id).del();

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket && deletedBrand) {
            log.debug(`📡 [BRANDS] Brend o'chirildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('brand_updated', {
                action: 'deleted',
                brand: {
                    id: parseInt(id),
                    name: deletedBrand.name
                }
            });
            log.debug(`✅ [BRANDS] WebSocket yuborildi: brand_updated (deleted)`);
        }

        res.json({ message: "Brend muvaffaqiyatli o'chirildi" });
    } catch (error) {
        log.error(`/api/brands/${req.params.id} DELETE xatoligi:`, error);
        res.status(500).json({ message: "Brendni o'chirishda xatolik" });
    }
});

// GET /api/users/:id/brands - Foydalanuvchiga biriktirilgan brendlar
router.get('/user/:userId', isAuthenticated, hasPermission('users:view'), async (req, res) => {
    try {
        const { userId } = req.params;

        const brands = await db('brands')
            .join('user_brands', 'brands.id', 'user_brands.brand_id')
            .where('user_brands.user_id', userId)
            .select('brands.id', 'brands.name');

        res.json(brands);
    } catch (error) {
        log.error(`/api/brands/user/${req.params.userId} GET xatoligi:`, error);
        res.status(500).json({ message: "Brendlarni olishda xatolik" });
    }
});

// POST /api/users/:id/brands - Foydalanuvchiga brendlarni biriktirish
router.post('/user/:userId', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { brandIds } = req.body;

        // Avvalgi brendlarni o'chirish
        await db('user_brands').where('user_id', userId).del();

        // Yangi brendlarni biriktirish
        if (brandIds && Array.isArray(brandIds) && brandIds.length > 0) {
            const records = brandIds.map(brandId => ({
                user_id: userId,
                brand_id: brandId
            }));
            await db('user_brands').insert(records);
        }

        res.json({ message: "Brendlar muvaffaqiyatli biriktirildi" });
    } catch (error) {
        log.error(`/api/brands/user/${req.params.userId} POST xatoligi:`, error);
        res.status(500).json({ message: "Brendlarni biriktirishda xatolik" });
    }
});

// GET /api/brands/:id/locations - Brendga biriktirilgan filiallarni olish
router.get('/:id/locations', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        
        const locations = await db('brand_locations')
            .where('brand_id', id)
            .select('location_name')
            .orderBy('location_name');
        
        res.json(locations.map(l => l.location_name));
    } catch (error) {
        log.error(`/api/brands/${req.params.id}/locations GET xatoligi:`, error);
        res.status(500).json({ message: "Filiallarni olishda xatolik" });
    }
});

// GET /api/locations/:locationName/brands - Filialga biriktirilgan brendlarni olish
router.get('/by-location/:locationName', isAuthenticated, async (req, res) => {
    try {
        const { locationName } = req.params;
        
        const brands = await db('brands')
            .join('brand_locations', 'brands.id', 'brand_locations.brand_id')
            .where('brand_locations.location_name', locationName)
            .select('brands.id', 'brands.name', 'brands.emoji', 'brands.color')
            .orderBy('brands.name');
        
        res.json(brands);
    } catch (error) {
        log.error(`/api/brands/by-location/${req.params.locationName} GET xatoligi:`, error);
        res.status(500).json({ message: "Brendlarni olishda xatolik" });
    }
});

module.exports = router;
