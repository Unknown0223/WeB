// routes/roles.js (TO'LIQ FAYL)

const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { refreshSessionsByRole } = require('../utils/sessionManager.js'); // YORDAMCHINI IMPORT QILAMIZ
const { createLogger } = require('../utils/logger.js');
const log = createLogger('ROLES');


const router = express.Router();

// Barcha rollar va ularning huquqlarini olish
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const [roles, permissions, rolePermissions, roleLocations, roleBrands] = await Promise.all([
            db('roles').select('role_name', 'requires_brands', 'requires_locations').orderBy('role_name'),
            db('permissions').select('*').orderBy('category', 'permission_key'),
            db('role_permissions').select('*'),
            db('role_locations').select('*'),
            db('role_brands').select('*')
        ]);

        const permissionsByCategory = permissions.reduce((acc, p) => {
            if (!acc[p.category]) {
                acc[p.category] = [];
            }
            acc[p.category].push({ key: p.permission_key, description: p.description });
            return acc;
        }, {});

        const result = roles.map(role => {
            const assignedPermissions = rolePermissions
                .filter(rp => rp.role_name === role.role_name)
                .map(rp => rp.permission_key);
            
            // SQLite'da 0 (false) va null o'rtasidagi farqni to'g'ri aniqlash
            const requiresBrands = (role.requires_brands === null || role.requires_brands === undefined) 
                ? null 
                : Boolean(role.requires_brands);
            const requiresLocations = (role.requires_locations === null || role.requires_locations === undefined) 
                ? null 
                : Boolean(role.requires_locations);
            
            // Rol uchun belgilangan filiallar va brendlar
            const locations = roleLocations
                .filter(rl => rl.role_name === role.role_name)
                .map(rl => rl.location_name);
            const brands = roleBrands
                .filter(rb => rb.role_name === role.role_name)
                .map(rb => rb.brand_id);
            
            return {
                role_name: role.role_name,
                permissions: assignedPermissions,
                requires_brands: requiresBrands,
                requires_locations: requiresLocations,
                locations: locations,
                brands: brands
            };
        });

        res.json({ roles: result, all_permissions: permissionsByCategory });

    } catch (error) {
        log.error("/api/roles GET xatoligi:", error);
        res.status(500).json({ message: "Rollar va huquqlarni yuklashda xatolik." });
    }
});

// ===== STATIK ROUTE'LAR (dinamik :role_name dan OLDIN bo'lishi kerak) =====

// Get all available permissions
router.get('/permissions', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const permissions = await db('permissions')
            .select('*')
            .orderBy('category', 'permission_key');
        res.json(permissions);
    } catch (error) {
        log.error('Get permissions error:', error);
        res.status(500).json({ message: 'Huquqlarni yuklashda xatolik' });
    }
});

// Get permissions overview with roles that have each permission
router.get('/permissions/overview', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const permissions = await db('permissions')
            .select('*')
            .orderBy('category', 'permission_key');
        
        res.json(permissions);
    } catch (error) {
        log.error('Get permissions overview error:', error);
        res.status(500).json({ message: 'Huquqlar ko\'rinishini yuklashda xatolik' });
    }
});

// Admin rolining ma'lumotlarini olish
router.get('/admin', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        log.debug('📋 [ROLES] /api/roles/admin endpointiga so\'rov keldi');
        log.debug('📋 [ROLES] User:', req.session.user?.username, 'Role:', req.session.user?.role);
        
        const [adminRole, rolePermissions] = await Promise.all([
            db('roles').where('role_name', 'admin').first(),
            db('role_permissions').where('role_name', 'admin').select('permission_key')
        ]);

        if (!adminRole) {
            log.debug('⚠️ [ROLES] Admin roli topilmadi');
            return res.status(404).json({ message: "Admin roli topilmadi." });
        }

        const assignedPermissions = rolePermissions.map(rp => rp.permission_key);
        
        const requiresBrands = (adminRole.requires_brands === null || adminRole.requires_brands === undefined) 
            ? null 
            : Boolean(adminRole.requires_brands);
        const requiresLocations = (adminRole.requires_locations === null || adminRole.requires_locations === undefined) 
            ? null 
            : Boolean(adminRole.requires_locations);

        log.debug('✅ [ROLES] Admin roli ma\'lumotlari yuklandi');
        res.json({
            role_name: adminRole.role_name,
            permissions: assignedPermissions,
            requires_brands: requiresBrands,
            requires_locations: requiresLocations
        });

    } catch (error) {
        log.error("❌ [ROLES] /api/roles/admin GET xatoligi:", error);
        res.status(500).json({ message: "Admin roli ma'lumotlarini yuklashda xatolik." });
    }
});

// ===== DINAMIK ROUTE'LAR =====

// Rol ma'lumotlarini olish (GET /api/roles/:role_name)
router.get('/:role_name', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    
    try {
        // Superadmin roli uchun ma'lumotlarni olishga ruxsat berilmaydi
        if (role_name === 'superadmin' || role_name === 'super_admin') {
            return res.status(403).json({ message: "Superadmin roli ma'lumotlarini olish mumkin emas." });
        }
        
        const [role, rolePermissions, roleLocations, roleBrands] = await Promise.all([
            db('roles').where('role_name', role_name).first(),
            db('role_permissions').where('role_name', role_name).select('permission_key'),
            db('role_locations').where('role_name', role_name).select('location_name'),
            db('role_brands').where('role_name', role_name).select('brand_id')
        ]);
        
        if (!role) {
            return res.status(404).json({ message: "Rol topilmadi." });
        }
        
        const assignedPermissions = rolePermissions.map(rp => rp.permission_key);
        const locations = roleLocations.map(rl => rl.location_name);
        const brands = roleBrands.map(rb => rb.brand_id);
        
        const requiresBrands = (role.requires_brands === null || role.requires_brands === undefined) 
            ? null 
            : Boolean(role.requires_brands);
        const requiresLocations = (role.requires_locations === null || role.requires_locations === undefined) 
            ? null 
            : Boolean(role.requires_locations);
        
        res.json({
            role_name: role.role_name,
            permissions: assignedPermissions,
            requires_brands: requiresBrands,
            requires_locations: requiresLocations,
            locations: locations,
            brands: brands
        });
    } catch (error) {
        log.error(`/api/roles/${role_name} GET xatoligi:`, error);
        res.status(500).json({ message: "Rol ma'lumotlarini yuklashda xatolik." });
    }
});

// Rolning huquqlarini yangilash
router.put('/:role_name', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ message: "Huquqlar massiv formatida yuborilishi kerak." });
    }
    
    // Faqat superadmin roli uchun huquqlarni o'zgartirish mumkin emas
    if (role_name === 'superadmin' || role_name === 'super_admin') {
        return res.status(403).json({ message: "Superadmin rolini huquqlarini o'zgartirish mumkin emas." });
    }

    try {
        await db.transaction(async trx => {
            await trx('role_permissions').where({ role_name: role_name }).del();

            if (permissions.length > 0) {
                const permissionsToInsert = permissions.map(permKey => ({
                    role_name: role_name,
                    permission_key: permKey
                }));
                await trx('role_permissions').insert(permissionsToInsert);
            }
        });

        // === MUHIM O'ZGARISH ===
        // Rol huquqlari o'zgargani uchun shu roldagi barcha foydalanuvchilarning sessiyalarini yangilaymiz
        await refreshSessionsByRole(role_name);
        // =======================

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [ROLES] Rol huquqlari yangilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_updated', {
                role_name: role_name,
                permissions: permissions,
                action: 'updated'
            });
            log.debug(`✅ [ROLES] WebSocket yuborildi: role_updated`);
        }

        res.json({ message: `"${role_name}" roli uchun huquqlar muvaffaqiyatli yangilandi.` });

    } catch (error) {
        log.error(`/api/roles/${role_name} PUT xatoligi:`, error);
        res.status(500).json({ message: "Rol huquqlarini yangilashda xatolik." });
    }
});

// Create new role
router.post('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name, requires_brands = null, requires_locations = null, locations = [], brands = [], permissions = [] } = req.body;
    
    if (!role_name || !/^[a-z0-9_]+$/.test(role_name)) {
        return res.status(400).json({ message: 'Noto\'g\'ri rol nomi formati. Faqat kichik harflar, raqamlar va _ belgisi ishlatilishi mumkin.' });
    }
    
    // superadmin rolini yaratishga ruxsat berilmaydi
    if (role_name === 'superadmin' || role_name === 'super_admin') {
        return res.status(403).json({ message: 'Superadmin roli yaratib bo\'lmaydi. Bu standart rol.' });
    }
    
    // Validatsiya: agar ikkalasi ham false/null bo'lsa, hech narsa ko'rsatilmaydi
    // Kamida bitta shart tanlanishi kerak (true bo'lishi kerak)
    const isLocationsFalse = requires_locations === false || requires_locations === null || requires_locations === undefined;
    const isBrandsFalse = requires_brands === false || requires_brands === null || requires_brands === undefined;
    
    if (isLocationsFalse && isBrandsFalse) {
        log.error(`❌ [ROLES] Validatsiya xatolik: Ikkalasi ham false/null - hech narsa ko'rsatilmaydi`);
        return res.status(400).json({ 
            message: "Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar). Agar ikkalasi ham tanlanmagan bo'lsa, foydalanuvchi hech qanday ma'lumot ko'ra olmaydi." 
        });
    }
    
    try {
        // Check if role already exists
        const existing = await db('roles').where('role_name', role_name).first();
        if (existing) {
            log.debug(`❌ [ROLES] Rol yaratishda xatolik: "${role_name}" allaqachon mavjud`);
            return res.status(400).json({ message: 'Bu rol allaqachon mavjud' });
        }
        
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        log.debug(`📝 [ROLES] Yangi rol yaratilmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}`);
        log.debug(`   - Requires Brands: ${requires_brands}, Requires Locations: ${requires_locations}`);
        log.debug(`   - Locations: ${locations.length} ta, Brands: ${brands.length} ta, Permissions: ${permissions.length} ta`);
        
        await db.transaction(async trx => {
            // Create new role - null qiymatni qo'llab-quvvatlash
            await trx('roles').insert({ 
                role_name,
                requires_brands: requires_brands === null || requires_brands === undefined ? null : Boolean(requires_brands),
                requires_locations: requires_locations === null || requires_locations === undefined ? null : Boolean(requires_locations)
            });
            
            // Filiallarni saqlash
            if (locations && locations.length > 0) {
                const locationRecords = locations.map(loc => ({
                    role_name: role_name,
                    location_name: loc
                }));
                await trx('role_locations').insert(locationRecords);
            }
            
            // Brendlarni saqlash
            if (brands && brands.length > 0) {
                const brandRecords = brands.map(brandId => ({
                    role_name: role_name,
                    brand_id: parseInt(brandId)
                }));
                await trx('role_brands').insert(brandRecords);
            }
            
            // Huquqlarni saqlash
            if (permissions && permissions.length > 0) {
                const permissionRecords = permissions.map(permKey => ({
                    role_name: role_name,
                    permission_key: permKey
                }));
                await trx('role_permissions').insert(permissionRecords);
            }
        });
        
        log.debug(`✅ [ROLES] Rol muvaffaqiyatli yaratildi: ${role_name}`);
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'create_role',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ 
                role_name, 
                requires_brands: requires_brands,
                requires_locations: requires_locations,
                locations_count: locations.length,
                brands_count: brands.length,
                permissions_count: permissions.length
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        log.debug(`📋 [ROLES] Audit log yozildi. Action: create_role, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [ROLES] Yangi rol yaratildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_updated', {
                role_name: role_name,
                requires_brands: requires_brands,
                requires_locations: requires_locations,
                action: 'created'
            });
            log.debug(`✅ [ROLES] WebSocket yuborildi: role_updated (created)`);
        }
        
        res.json({ message: 'Yangi rol muvaffaqiyatli yaratildi', role_name });
    } catch (error) {
        log.error('Create role error:', error);
        res.status(500).json({ message: 'Rol yaratishda xatolik' });
    }
});

// Update role requirements (filiallar va brendlar)
router.put('/:role_name/requirements', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    const { requires_brands, requires_locations, locations = [], brands = [] } = req.body;
    
    // Validatsiya: agar ikkalasi ham false/null bo'lsa, hech narsa ko'rsatilmaydi
    // Kamida bitta shart tanlanishi kerak (true bo'lishi kerak)
    const isLocationsFalse = requires_locations === false || requires_locations === null || requires_locations === undefined;
    const isBrandsFalse = requires_brands === false || requires_brands === null || requires_brands === undefined;
    
    if (isLocationsFalse && isBrandsFalse) {
        log.error(`❌ [ROLES] Validatsiya xatolik: Ikkalasi ham false/null - hech narsa ko'rsatilmaydi`);
        return res.status(400).json({ 
            message: "Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar). Agar ikkalasi ham tanlanmagan bo'lsa, foydalanuvchi hech qanday ma'lumot ko'ra olmaydi." 
        });
    }
    
    try {
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        log.debug(`📝 [ROLES] Rol talablari yangilanmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}`);
        log.debug(`   - Requires Brands: ${requires_brands}, Requires Locations: ${requires_locations}`);
        log.debug(`   - Locations: ${locations.length} ta, Brands: ${brands.length} ta`);
        
        const role = await db('roles').where('role_name', role_name).first();
        if (!role) {
            log.debug(`❌ [ROLES] Rol topilmadi: ${role_name}`);
            return res.status(404).json({ message: 'Rol topilmadi' });
        }
        
        // superadmin rolini o'zgartirishga ruxsat berilmaydi
        if (role_name === 'superadmin' || role_name === 'super_admin') {
            return res.status(403).json({ message: 'Superadmin rolini o\'zgartirish mumkin emas.' });
        }
        
        await db.transaction(async trx => {
            // null qiymatni qo'llab-quvvatlash
            await trx('roles').where('role_name', role_name).update({
                requires_brands: requires_brands === null || requires_brands === undefined ? null : Boolean(requires_brands),
                requires_locations: requires_locations === null || requires_locations === undefined ? null : Boolean(requires_locations)
            });
            
            // Eski filiallarni o'chirish va yangilarini qo'shish
            await trx('role_locations').where('role_name', role_name).del();
            if (locations && locations.length > 0) {
                const locationRecords = locations.map(loc => ({
                    role_name: role_name,
                    location_name: loc
                }));
                await trx('role_locations').insert(locationRecords);
            }
            
            // Eski brendlarni o'chirish va yangilarini qo'shish
            await trx('role_brands').where('role_name', role_name).del();
            if (brands && brands.length > 0) {
                const brandRecords = brands.map(brandId => ({
                    role_name: role_name,
                    brand_id: parseInt(brandId)
                }));
                await trx('role_brands').insert(brandRecords);
            }
        });
        
        log.debug(`✅ [ROLES] Rol talablari yangilandi: ${role_name}`);
        
        // Rol o'zgargani uchun shu roldagi barcha foydalanuvchilarning sessiyalarini yangilash
        await refreshSessionsByRole(role_name);
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'update_role_requirements',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ 
                requires_brands: requires_brands,
                requires_locations: requires_locations,
                locations_count: locations.length,
                brands_count: brands.length
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        log.debug(`📋 [ROLES] Audit log yozildi. Action: update_role_requirements, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        res.json({ message: 'Rol talablari yangilandi' });
    } catch (error) {
        log.error('Update role requirements error:', error);
        res.status(500).json({ message: 'Rol talablarini yangilashda xatolik' });
    }
});

// Delete role
router.delete('/:role_name', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    
    try {
        // Superadmin roli o'chirilmaydi
        if (role_name === 'superadmin' || role_name === 'super_admin') {
            return res.status(403).json({ message: "Superadmin roli o'chirilmaydi." });
        }
        
        const role = await db('roles').where('role_name', role_name).first();
        if (!role) {
            return res.status(404).json({ message: 'Rol topilmadi' });
        }
        
        // Bu roldagi foydalanuvchilar borligini tekshirish
        const usersWithRole = await db('users').where('role', role_name).count('* as count').first();
        if (usersWithRole && parseInt(usersWithRole.count) > 0) {
            return res.status(400).json({ 
                message: `Bu rolda ${usersWithRole.count} ta foydalanuvchi mavjud. Avval foydalanuvchilarning rolini o'zgartiring.` 
            });
        }
        
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        log.debug(`📝 [ROLES] Rol o'chirilmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}`);
        
        await db.transaction(async trx => {
            // Rol bilan bog'liq barcha ma'lumotlarni o'chirish
            await trx('role_permissions').where('role_name', role_name).del();
            await trx('role_locations').where('role_name', role_name).del();
            await trx('role_brands').where('role_name', role_name).del();
            await trx('roles').where('role_name', role_name).del();
        });
        
        log.debug(`✅ [ROLES] Rol muvaffaqiyatli o'chirildi: ${role_name}`);
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'delete_role',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ role_name }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        log.debug(`📋 [ROLES] Audit log yozildi. Action: delete_role, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [ROLES] Rol o'chirildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_deleted', {
                role_name: role_name,
                deleted_by: adminId,
                deleted_by_username: username
            });
            log.debug(`✅ [ROLES] WebSocket yuborildi: role_deleted`);
        }
        
        res.json({ message: 'Rol muvaffaqiyatli o\'chirildi' });
    } catch (error) {
        log.error('Delete role error:', error);
        res.status(500).json({ message: 'Rolni o\'chirishda xatolik' });
    }
});

module.exports = router;
