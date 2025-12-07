// routes/roles.js (TO'LIQ FAYL)

const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { refreshSessionsByRole } = require('../utils/sessionManager.js'); // YORDAMCHINI IMPORT QILAMIZ

const router = express.Router();

// Barcha rollar va ularning huquqlarini olish
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const [roles, permissions, rolePermissions] = await Promise.all([
            db('roles').select('role_name', 'requires_brands', 'requires_locations').orderBy('role_name'),
            db('permissions').select('*').orderBy('category', 'permission_key'),
            db('role_permissions').select('*')
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
            // Agar qiymat null yoki undefined bo'lsa, null qaytarish
            // Agar qiymat 0 (false) yoki 1 (true) bo'lsa, boolean qaytarish
            const requiresBrands = (role.requires_brands === null || role.requires_brands === undefined) 
                ? null 
                : Boolean(role.requires_brands);
            const requiresLocations = (role.requires_locations === null || role.requires_locations === undefined) 
                ? null 
                : Boolean(role.requires_locations);
            
            return {
                role_name: role.role_name,
                permissions: assignedPermissions,
                requires_brands: requiresBrands,
                requires_locations: requiresLocations
            };
        });

        res.json({ roles: result, all_permissions: permissionsByCategory });

    } catch (error) {
        console.error("/api/roles GET xatoligi:", error);
        res.status(500).json({ message: "Rollar va huquqlarni yuklashda xatolik." });
    }
});

// Rolning huquqlarini yangilash
router.put('/:role_name', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ message: "Huquqlar massiv formatida yuborilishi kerak." });
    }
    
    if (role_name === 'admin') {
        return res.status(403).json({ message: "Admin rolini huquqlarini o'zgartirish mumkin emas." });
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

        res.json({ message: `"${role_name}" roli uchun huquqlar muvaffaqiyatli yangilandi.` });

    } catch (error) {
        console.error(`/api/roles/${role_name} PUT xatoligi:`, error);
        res.status(500).json({ message: "Rol huquqlarini yangilashda xatolik." });
    }
});

// Get all available permissions
router.get('/permissions', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const permissions = await db('permissions')
            .select('*')
            .orderBy('category', 'permission_key');
        res.json(permissions);
    } catch (error) {
        console.error('Get permissions error:', error);
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
        console.error('Get permissions overview error:', error);
        res.status(500).json({ message: 'Huquqlar ko\'rinishini yuklashda xatolik' });
    }
});

// Create new role
router.post('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name, requires_brands = false, requires_locations = false } = req.body;
    
    if (!role_name || !/^[a-z_]+$/.test(role_name)) {
        return res.status(400).json({ message: 'Noto\'g\'ri rol nomi formati' });
    }
    
    try {
        // Check if role already exists
        const existing = await db('roles').where('role_name', role_name).first();
        if (existing) {
            console.log(`❌ [ROLES] Rol yaratishda xatolik: "${role_name}" allaqachon mavjud`);
            return res.status(400).json({ message: 'Bu rol allaqachon mavjud' });
        }
        
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        console.log(`📝 [ROLES] Yangi rol yaratilmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}, Requires Brands: ${requires_brands}, Requires Locations: ${requires_locations}`);
        
        // Create new role - null qiymatni qo'llab-quvvatlash
        await db('roles').insert({ 
            role_name,
            requires_brands: requires_brands === null || requires_brands === undefined ? null : Boolean(requires_brands),
            requires_locations: requires_locations === null || requires_locations === undefined ? null : Boolean(requires_locations)
        });
        
        console.log(`✅ [ROLES] Rol muvaffaqiyatli yaratildi: ${role_name}`);
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'create_role',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ 
                role_name, 
                requires_brands: Boolean(requires_brands), 
                requires_locations: Boolean(requires_locations) 
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        console.log(`📋 [ROLES] Audit log yozildi. Action: create_role, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        res.json({ message: 'Yangi rol muvaffaqiyatli yaratildi', role_name });
    } catch (error) {
        console.error('Create role error:', error);
        res.status(500).json({ message: 'Rol yaratishda xatolik' });
    }
});

// Update role requirements
router.put('/:role_name/requirements', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    const { requires_brands, requires_locations } = req.body;
    
    try {
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        console.log(`📝 [ROLES] Rol talablari yangilanmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}, Requires Brands: ${requires_brands}, Requires Locations: ${requires_locations}`);
        
        const role = await db('roles').where('role_name', role_name).first();
        if (!role) {
            console.log(`❌ [ROLES] Rol topilmadi: ${role_name}`);
            return res.status(404).json({ message: 'Rol topilmadi' });
        }
        
        // null qiymatni qo'llab-quvvatlash
        await db('roles').where('role_name', role_name).update({
            requires_brands: requires_brands === null || requires_brands === undefined ? null : Boolean(requires_brands),
            requires_locations: requires_locations === null || requires_locations === undefined ? null : Boolean(requires_locations)
        });
        
        console.log(`✅ [ROLES] Rol talablari yangilandi: ${role_name}`);
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'update_role_requirements',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ 
                requires_brands: Boolean(requires_brands), 
                requires_locations: Boolean(requires_locations) 
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        console.log(`📋 [ROLES] Audit log yozildi. Action: update_role_requirements, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        res.json({ message: 'Rol talablari yangilandi' });
    } catch (error) {
        console.error('Update role requirements error:', error);
        res.status(500).json({ message: 'Rol talablarini yangilashda xatolik' });
    }
});

module.exports = router;
