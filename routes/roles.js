// routes/roles.js (TO'LIQ FAYL)

const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { refreshSessionsByRole } = require('../utils/sessionManager.js'); // YORDAMCHINI IMPORT QILAMIZ

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
            // Agar qiymat null yoki undefined bo'lsa, null qaytarish
            // Agar qiymat 0 (false) yoki 1 (true) bo'lsa, boolean qaytarish
            // Agar qiymat 'by_location' yoki 'by_brand' bo'lsa, string qaytarish
            let requiresBrands = null;
            if (role.requires_brands === null || role.requires_brands === undefined) {
                requiresBrands = null;
            } else if (role.requires_brands === 'by_brand' || role.requires_brands === 'by_brand') {
                requiresBrands = 'by_brand';
            } else {
                requiresBrands = Boolean(role.requires_brands);
            }
            
            let requiresLocations = null;
            if (role.requires_locations === null || role.requires_locations === undefined) {
                requiresLocations = null;
            } else if (role.requires_locations === 'by_location' || role.requires_locations === 'by_location') {
                requiresLocations = 'by_location';
            } else {
                requiresLocations = Boolean(role.requires_locations);
            }
            
            // Role locations va brands
            const roleLocation = roleLocations.find(rl => rl.role_name === role.role_name);
            const roleBrandsList = roleBrands
                .filter(rb => rb.role_name === role.role_name)
                .map(rb => rb.brand_id);
            
            return {
                role_name: role.role_name,
                permissions: assignedPermissions,
                requires_brands: requiresBrands,
                requires_locations: requiresLocations,
                selected_location: roleLocation ? roleLocation.location_name : null,
                selected_brands: roleBrandsList
            };
        });

        res.json({ roles: result, all_permissions: permissionsByCategory });

    } catch (error) {
        console.error("/api/roles GET xatoligi:", error);
        res.status(500).json({ message: "Rollar va huquqlarni yuklashda xatolik." });
    }
});

// Admin rolining ma'lumotlarini olish (404 xatosini oldini olish uchun)
router.get('/admin', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        console.log('📋 [ROLES] /api/roles/admin endpointiga so\'rov keldi');
        console.log('📋 [ROLES] User:', req.session.user?.username, 'Role:', req.session.user?.role);
        
        const [adminRole, rolePermissions] = await Promise.all([
            db('roles').where('role_name', 'admin').first(),
            db('role_permissions').where('role_name', 'admin').select('permission_key')
        ]);

        if (!adminRole) {
            console.log('⚠️ [ROLES] Admin roli topilmadi');
            return res.status(404).json({ message: "Admin roli topilmadi." });
        }

        const assignedPermissions = rolePermissions.map(rp => rp.permission_key);
        
        const requiresBrands = (adminRole.requires_brands === null || adminRole.requires_brands === undefined) 
            ? null 
            : Boolean(adminRole.requires_brands);
        const requiresLocations = (adminRole.requires_locations === null || adminRole.requires_locations === undefined) 
            ? null 
            : Boolean(adminRole.requires_locations);

        console.log('✅ [ROLES] Admin roli ma\'lumotlari yuklandi');
        res.json({
            role_name: adminRole.role_name,
            permissions: assignedPermissions,
            requires_brands: requiresBrands,
            requires_locations: requiresLocations
        });

    } catch (error) {
        console.error("❌ [ROLES] /api/roles/admin GET xatoligi:", error);
        res.status(500).json({ message: "Admin roli ma'lumotlarini yuklashda xatolik." });
    }
});

// Rolning huquqlarini yangilash
router.put('/:role_name', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ message: "Huquqlar massiv formatida yuborilishi kerak." });
    }
    
    // Faqat super_admin roli uchun huquqlarni o'zgartirish mumkin emas
    if (role_name === 'super_admin') {
        return res.status(403).json({ message: "Super admin rolini huquqlarini o'zgartirish mumkin emas." });
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
            console.log(`📡 [ROLES] Rol huquqlari yangilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_updated', {
                role_name: role_name,
                permissions: permissions,
                action: 'updated'
            });
            console.log(`✅ [ROLES] WebSocket yuborildi: role_updated`);
        }

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
    const { role_name, requires_brands, requires_locations, selected_location, selected_brands, permissions } = req.body;
    
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
        
        // Transaction ichida barcha operatsiyalarni bajarish
        await db.transaction(async (trx) => {
            // Create new role - null, true, false, 'by_location', 'by_brand' qiymatlarini qo'llab-quvvatlash
            let requiresBrandsValue = null;
            let requiresLocationsValue = null;
            
            if (requires_brands === true || requires_brands === 'true') requiresBrandsValue = true;
            else if (requires_brands === false || requires_brands === 'false') requiresBrandsValue = false;
            else if (requires_brands === 'by_brand') requiresBrandsValue = 'by_brand';
            else requiresBrandsValue = null;
            
            if (requires_locations === true || requires_locations === 'true') requiresLocationsValue = true;
            else if (requires_locations === false || requires_locations === 'false') requiresLocationsValue = false;
            else if (requires_locations === 'by_location') requiresLocationsValue = 'by_location';
            else requiresLocationsValue = null;
            
            // SQLite'da TEXT tipida saqlash (by_location va by_brand uchun)
            await trx('roles').insert({ 
                role_name,
                requires_brands: requiresBrandsValue === null ? null : (requiresBrandsValue === true ? 1 : requiresBrandsValue === false ? 0 : requiresBrandsValue),
                requires_locations: requiresLocationsValue === null ? null : (requiresLocationsValue === true ? 1 : requiresLocationsValue === false ? 0 : requiresLocationsValue)
            });
            
            // Filial bo'yicha brendlar tanlangan bo'lsa
            if (requiresLocationsValue === 'by_location' && selected_location) {
                await trx('role_locations').insert({
                    role_name: role_name,
                    location_name: selected_location
                });
            }
            
            // Brend bo'yicha filiallar tanlangan bo'lsa
            if (requiresBrandsValue === 'by_brand' && selected_brands && Array.isArray(selected_brands) && selected_brands.length > 0) {
                const roleBrands = selected_brands.map(brandId => ({
                    role_name: role_name,
                    brand_id: brandId
                }));
                await trx('role_brands').insert(roleBrands);
            }
            
            // Permissions qo'shish
            if (permissions && Array.isArray(permissions) && permissions.length > 0) {
                const rolePermissions = permissions.map(perm => ({
                    role_name: role_name,
                    permission_key: perm
                }));
                await trx('role_permissions').insert(rolePermissions);
            }
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
                requires_brands, 
                requires_locations,
                selected_location,
                selected_brands,
                permissions_count: permissions ? permissions.length : 0
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        console.log(`📋 [ROLES] Audit log yozildi. Action: create_role, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            console.log(`📡 [ROLES] Yangi rol yaratildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_updated', {
                role_name: role_name,
                requires_brands: requires_brands,
                requires_locations: requires_locations,
                action: 'created'
            });
            console.log(`✅ [ROLES] WebSocket yuborildi: role_updated (created)`);
        }
        
        res.json({ message: 'Yangi rol muvaffaqiyatli yaratildi', role_name });
    } catch (error) {
        console.error('Create role error:', error);
        res.status(500).json({ message: 'Rol yaratishda xatolik' });
    }
});

// Rolni o'chirish (PUT /:role_name/full dan oldin bo'lishi kerak)
router.delete('/:role_name', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    
    // Faqat super_admin roli o'chirish mumkin emas
    if (role_name === 'super_admin') {
        return res.status(403).json({ message: `"${role_name}" roli o'chirish mumkin emas.` });
    }
    
    try {
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        console.log(`📝 [ROLES] Rol o'chirilmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}`);
        
        const role = await db('roles').where('role_name', role_name).first();
        if (!role) {
            console.log(`❌ [ROLES] Rol topilmadi: ${role_name}`);
            return res.status(404).json({ message: 'Rol topilmadi' });
        }
        
        // Bu roldagi foydalanuvchilar borligini tekshirish
        const usersWithRole = await db('users').where('role', role_name).count('* as count').first();
        const userCount = usersWithRole ? parseInt(usersWithRole.count) : 0;
        
        if (userCount > 0) {
            console.log(`⚠️ [ROLES] Bu rolda ${userCount} ta foydalanuvchi mavjud. Rol o'chirilmaydi.`);
            return res.status(400).json({ 
                message: `Bu rolda ${userCount} ta foydalanuvchi mavjud. Avval foydalanuvchilarga boshqa rol bering yoki ularni o'chiring.`,
                user_count: userCount
            });
        }
        
        // Transaction ichida barcha ma'lumotlarni o'chirish
        await db.transaction(async trx => {
            // Role permissions jadvalidan o'chirish
            await trx('role_permissions').where('role_name', role_name).del();
            
            // Role locations jadvalidan o'chirish
            await trx('role_locations').where('role_name', role_name).del();
            
            // Role brands jadvalidan o'chirish
            await trx('role_brands').where('role_name', role_name).del();
            
            // User specific settings jadvalidan o'chirish
            await trx('user_specific_settings').where('role', role_name).del();
            
            // Rolni o'chirish
            await trx('roles').where('role_name', role_name).del();
        });
        
        console.log(`✅ [ROLES] Rol muvaffaqiyatli o'chirildi: ${role_name}`);
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'delete_role',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ 
                role_name: role_name,
                requires_brands: role.requires_brands,
                requires_locations: role.requires_locations
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        console.log(`📋 [ROLES] Audit log yozildi. Action: delete_role, Role: ${role_name}, Admin: ${username} (ID: ${adminId})`);
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            console.log(`📡 [ROLES] Rol o'chirildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_updated', {
                role_name: role_name,
                action: 'deleted'
            });
            console.log(`✅ [ROLES] WebSocket yuborildi: role_updated (deleted)`);
        }
        
        res.json({ message: `"${role_name}" roli muvaffaqiyatli o'chirildi.` });
    } catch (error) {
        console.error('Delete role error:', error);
        res.status(500).json({ message: 'Rolni o\'chirishda xatolik' });
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

// To'liq rol tahrirlash (rol nomi, talablar, huquqlar birga)
router.put('/:role_name/full', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const { role_name } = req.params;
    const { new_role_name, requires_brands, requires_locations, permissions, selected_location, selected_brands } = req.body;
    
    // Faqat super_admin roli to'liq tahrirlash mumkin emas
    if (role_name === 'super_admin') {
        return res.status(403).json({ message: `"${role_name}" roli to'liq tahrirlash mumkin emas.` });
    }
    
    try {
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        
        console.log(`📝 [ROLES] Rol to'liq tahrirlanmoqda. Admin: ${username} (ID: ${adminId}), Rol: ${role_name}`);
        
        const role = await db('roles').where('role_name', role_name).first();
        if (!role) {
            console.log(`❌ [ROLES] Rol topilmadi: ${role_name}`);
            return res.status(404).json({ message: 'Rol topilmadi' });
        }
        
        // Rol nomini o'zgartirish (agar berilgan bo'lsa)
        if (new_role_name && new_role_name !== role_name) {
            // Yangi rol nomi formati tekshiruvi
            if (!/^[a-z_]+$/.test(new_role_name)) {
                return res.status(400).json({ message: 'Noto\'g\'ri rol nomi formati' });
            }
            
            // Yangi rol nomi allaqachon mavjudligini tekshirish
            const existingRole = await db('roles').where('role_name', new_role_name).first();
            if (existingRole) {
                return res.status(400).json({ message: 'Bu rol nomi allaqachon mavjud' });
            }
            
            // Transaction ichida barcha o'zgarishlarni amalga oshirish
            await db.transaction(async trx => {
                // Rol nomini yangilash
                await trx('roles').where('role_name', role_name).update({ role_name: new_role_name });
                
                // Role permissions jadvalidagi rol nomini yangilash
                await trx('role_permissions').where('role_name', role_name).update({ role_name: new_role_name });
                
                // Users jadvalidagi rol nomini yangilash
                await trx('users').where('role', role_name).update({ role: new_role_name });
                
                // User specific settings jadvalidagi rol nomini yangilash
                await trx('user_specific_settings').where('role', role_name).update({ role: new_role_name });
            });
            
            console.log(`✅ [ROLES] Rol nomi yangilandi: ${role_name} -> ${new_role_name}`);
        }
        
        const finalRoleName = new_role_name || role_name;
        
        // Talablarni yangilash (agar berilgan bo'lsa)
        if (requires_brands !== undefined || requires_locations !== undefined) {
            const updateData = {};
            if (requires_brands !== undefined) {
                // by_brand, true, false, null qiymatlarini qo'llab-quvvatlash
                if (requires_brands === 'by_brand') {
                    updateData.requires_brands = 'by_brand';
                } else if (requires_brands === null || requires_brands === 'null') {
                    updateData.requires_brands = null;
                } else {
                    updateData.requires_brands = Boolean(requires_brands) ? 1 : 0;
                }
            }
            if (requires_locations !== undefined) {
                // by_location, true, false, null qiymatlarini qo'llab-quvvatlash
                if (requires_locations === 'by_location') {
                    updateData.requires_locations = 'by_location';
                } else if (requires_locations === null || requires_locations === 'null') {
                    updateData.requires_locations = null;
                } else {
                    updateData.requires_locations = Boolean(requires_locations) ? 1 : 0;
                }
            }
            
            await db('roles').where('role_name', finalRoleName).update(updateData);
            console.log(`✅ [ROLES] Rol talablari yangilandi: ${finalRoleName}`);
        }
        
        // Filial va brend bog'lanishlarini yangilash
        const { selected_location, selected_brands } = req.body;
        
        // Eski bog'lanishlarni o'chirish
        await db('role_locations').where('role_name', finalRoleName).del();
        await db('role_brands').where('role_name', finalRoleName).del();
        
        // Yangi bog'lanishlarni qo'shish
        const finalRequiresLocations = requires_locations !== undefined ? 
            (requires_locations === 'by_location' ? 'by_location' : 
             requires_locations === null || requires_locations === 'null' ? null : 
             Boolean(requires_locations)) : 
            (await db('roles').where('role_name', finalRoleName).first())?.requires_locations;
        
        const finalRequiresBrands = requires_brands !== undefined ? 
            (requires_brands === 'by_brand' ? 'by_brand' : 
             requires_brands === null || requires_brands === 'null' ? null : 
             Boolean(requires_brands)) : 
            (await db('roles').where('role_name', finalRoleName).first())?.requires_brands;
        
        if (selected_location && finalRequiresLocations === 'by_location') {
            await db('role_locations').insert({
                role_name: finalRoleName,
                location_name: selected_location
            });
            console.log(`✅ [ROLES] Rol-filial bog'lanishi qo'shildi: ${finalRoleName} -> ${selected_location}`);
        }
        
        if (selected_brands && Array.isArray(selected_brands) && selected_brands.length > 0 && finalRequiresBrands === 'by_brand') {
            const roleBrands = selected_brands.map(brandId => ({
                role_name: finalRoleName,
                brand_id: brandId
            }));
            await db('role_brands').insert(roleBrands);
            console.log(`✅ [ROLES] Rol-brend bog'lanishlari qo'shildi: ${finalRoleName} -> ${selected_brands.length} ta brend`);
        }
        
        // Huquqlarni yangilash (agar berilgan bo'lsa)
        if (permissions !== undefined) {
            if (!Array.isArray(permissions)) {
                return res.status(400).json({ message: "Huquqlar massiv formatida yuborilishi kerak." });
            }
            
            await db.transaction(async trx => {
                await trx('role_permissions').where({ role_name: finalRoleName }).del();
                
                if (permissions.length > 0) {
                    const permissionsToInsert = permissions.map(permKey => ({
                        role_name: finalRoleName,
                        permission_key: permKey
                    }));
                    await trx('role_permissions').insert(permissionsToInsert);
                }
            });
            
            // Rol huquqlari o'zgargani uchun shu roldagi barcha foydalanuvchilarning sessiyalarini yangilaymiz
            await refreshSessionsByRole(finalRoleName);
            
            console.log(`✅ [ROLES] Rol huquqlari yangilandi: ${finalRoleName}`);
        }
        
        // Log to audit
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'update_role_full',
            target_type: 'role',
            target_id: finalRoleName,
            details: JSON.stringify({ 
                old_role_name: role_name,
                new_role_name: finalRoleName,
                requires_brands: requires_brands !== undefined ? (requires_brands === null ? null : Boolean(requires_brands)) : role.requires_brands,
                requires_locations: requires_locations !== undefined ? (requires_locations === null ? null : Boolean(requires_locations)) : role.requires_locations,
                permissions_count: permissions !== undefined ? permissions.length : 'not_changed'
            }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        console.log(`📋 [ROLES] Audit log yozildi. Action: update_role_full, Role: ${finalRoleName}, Admin: ${username} (ID: ${adminId})`);
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            console.log(`📡 [ROLES] Rol to'liq yangilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('role_updated', {
                role_name: finalRoleName,
                old_role_name: role_name,
                requires_brands: requires_brands !== undefined ? requires_brands : role.requires_brands,
                requires_locations: requires_locations !== undefined ? requires_locations : role.requires_locations,
                permissions: permissions !== undefined ? permissions : [],
                action: 'full_updated'
            });
            console.log(`✅ [ROLES] WebSocket yuborildi: role_updated (full_updated)`);
        }
        
        res.json({ 
            message: `"${finalRoleName}" roli muvaffaqiyatli yangilandi.`,
            role_name: finalRoleName
        });
    } catch (error) {
        console.error('Update role full error:', error);
        res.status(500).json({ message: 'Rolni to\'liq yangilashda xatolik' });
    }
});

module.exports = router;
