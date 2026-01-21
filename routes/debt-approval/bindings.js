// routes/debt-approval/bindings.js
// Qarzdorlik Tasdiqlash - Bog'lanishlar (Bindings) API

const express = require('express');
const router = express.Router();
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');
const { refreshSessionsByRole } = require('../../utils/sessionManager.js');

const log = createLogger('DEBT_BINDINGS');

// ===== ROL BOG'LANISHLARI =====

// Rol bog'lanishlarini olish
router.get('/roles/:role_name', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { role_name } = req.params;
        
        const [brandsRaw, branchesRaw, svrsRaw] = await Promise.all([
            db('debt_role_brands')
                .where('role_name', role_name)
                .join('debt_brands', 'debt_role_brands.debt_brand_id', 'debt_brands.id')
                .select('debt_brands.id', 'debt_brands.name')
                .groupBy('debt_brands.id', 'debt_brands.name')
                .orderBy('debt_brands.name'),
            db('debt_role_branches')
                .where('role_name', role_name)
                .join('debt_branches', 'debt_role_branches.debt_branch_id', 'debt_branches.id')
                .select('debt_branches.id', 'debt_branches.name', 'debt_branches.brand_id')
                .groupBy('debt_branches.id', 'debt_branches.name', 'debt_branches.brand_id')
                .orderBy('debt_branches.name'),
            db('debt_role_svrs')
                .where('role_name', role_name)
                .join('debt_svrs', 'debt_role_svrs.debt_svr_id', 'debt_svrs.id')
                .select('debt_svrs.id', 'debt_svrs.name', 'debt_svrs.brand_id', 'debt_svrs.branch_id')
                .groupBy('debt_svrs.id', 'debt_svrs.name', 'debt_svrs.brand_id', 'debt_svrs.branch_id')
                .orderBy('debt_svrs.name')
        ]);
        
        // Dublikat tekshiruvi va filtrlash
        const uniqueBrandsMap = new Map();
        brandsRaw.forEach(brand => {
            if (!uniqueBrandsMap.has(brand.id)) {
                uniqueBrandsMap.set(brand.id, brand);
            } else {
                log.warn(`⚠️ [bindings/roles/${role_name}] Brend dublikat: ID=${brand.id}, Name=${brand.name}`);
            }
        });
        const uniqueBrands = Array.from(uniqueBrandsMap.values());
        
        const uniqueBranchesMap = new Map();
        branchesRaw.forEach(branch => {
            if (!uniqueBranchesMap.has(branch.id)) {
                uniqueBranchesMap.set(branch.id, branch);
            } else {
                log.warn(`⚠️ [bindings/roles/${role_name}] Filial dublikat: ID=${branch.id}, Name=${branch.name}`);
            }
        });
        const uniqueBranches = Array.from(uniqueBranchesMap.values());
        
        const uniqueSvrsMap = new Map();
        svrsRaw.forEach(svr => {
            if (!uniqueSvrsMap.has(svr.id)) {
                uniqueSvrsMap.set(svr.id, svr);
            } else {
                log.warn(`⚠️ [bindings/roles/${role_name}] SVR dublikat: ID=${svr.id}, Name=${svr.name}`);
            }
        });
        const uniqueSvrs = Array.from(uniqueSvrsMap.values());
        
        res.json({
            role_name,
            brands: uniqueBrands.map(b => ({ id: b.id, name: b.name })),
            branches: uniqueBranches.map(b => ({ id: b.id, name: b.name, brand_id: b.brand_id })),
            svrs: uniqueSvrs.map(s => ({ id: s.id, name: s.name, brand_id: s.brand_id, branch_id: s.branch_id }))
        });
    } catch (error) {
        log.error('Rol bog\'lanishlarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Rol bog'lanishlarini saqlash
router.post('/roles/:role_name', isAuthenticated, hasPermission('debt:manage_bindings'), async (req, res) => {
    try {
        const { role_name } = req.params;
        const { brands = [], branches = [], svrs = [] } = req.body;
        
        // Superadmin roli uchun o'zgartirish mumkin emas
        if (role_name === 'superadmin' || role_name === 'super_admin') {
            return res.status(403).json({ error: 'Superadmin roli uchun bog\'lanishlarni o\'zgartirish mumkin emas' });
        }
        
        await db.transaction(async trx => {
            // Eski bog'lanishlarni o'chirish
            await trx('debt_role_brands').where('role_name', role_name).del();
            await trx('debt_role_branches').where('role_name', role_name).del();
            await trx('debt_role_svrs').where('role_name', role_name).del();
            
            // Yangi bog'lanishlarni qo'shish
            if (brands.length > 0) {
                await trx('debt_role_brands').insert(
                    brands.map(brandId => ({
                        role_name,
                        debt_brand_id: parseInt(brandId),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }))
                );
            }
            
            if (branches.length > 0) {
                await trx('debt_role_branches').insert(
                    branches.map(branchId => ({
                        role_name,
                        debt_branch_id: parseInt(branchId),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }))
                );
            }
            
            if (svrs.length > 0) {
                await trx('debt_role_svrs').insert(
                    svrs.map(svrId => ({
                        role_name,
                        debt_svr_id: parseInt(svrId),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }))
                );
            }
        });
        
        // Rol o'zgargani uchun sessiyalarni yangilash
        await refreshSessionsByRole(role_name);
        
        // Audit log
        const adminId = req.session.user.id;
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'update_debt_role_bindings',
            target_type: 'role',
            target_id: role_name,
            details: JSON.stringify({ brands: brands.length, branches: branches.length, svrs: svrs.length }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        log.info(`Rol bog'lanishlari yangilandi: ${role_name}`);
        res.json({ message: 'Bog\'lanishlar muvaffaqiyatli saqlandi' });
    } catch (error) {
        log.error('Rol bog\'lanishlarini saqlashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// ===== FOYDALANUVCHI BOG'LANISHLARI =====

// Foydalanuvchi bog'lanishlarini olish
router.get('/users/:user_id', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { user_id } = req.params;
        
        const [brandsRaw, branchesRaw] = await Promise.all([
            db('debt_user_brands')
                .where('user_id', user_id)
                .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                .select('debt_brands.id', 'debt_brands.name')
                .groupBy('debt_brands.id', 'debt_brands.name')
                .orderBy('debt_brands.name'),
            db('debt_user_branches')
                .where('user_id', user_id)
                .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                .select('debt_branches.id', 'debt_branches.name', 'debt_branches.brand_id')
                .groupBy('debt_branches.id', 'debt_branches.name', 'debt_branches.brand_id')
                .orderBy('debt_branches.name')
        ]);
        
        // Dublikat tekshiruvi va filtrlash
        const uniqueBrandsMap = new Map();
        brandsRaw.forEach(brand => {
            if (!uniqueBrandsMap.has(brand.id)) {
                uniqueBrandsMap.set(brand.id, brand);
            } else {
                log.warn(`⚠️ [bindings/users/${user_id}] Brend dublikat: ID=${brand.id}, Name=${brand.name}`);
            }
        });
        const uniqueBrands = Array.from(uniqueBrandsMap.values());
        
        const uniqueBranchesMap = new Map();
        branchesRaw.forEach(branch => {
            if (!uniqueBranchesMap.has(branch.id)) {
                uniqueBranchesMap.set(branch.id, branch);
            } else {
                log.warn(`⚠️ [bindings/users/${user_id}] Filial dublikat: ID=${branch.id}, Name=${branch.name}`);
            }
        });
        const uniqueBranches = Array.from(uniqueBranchesMap.values());
        
        res.json({
            user_id: parseInt(user_id),
            brands: uniqueBrands.map(b => ({ id: b.id, name: b.name })),
            branches: uniqueBranches.map(b => ({ id: b.id, name: b.name, brand_id: b.brand_id }))
        });
    } catch (error) {
        log.error('Foydalanuvchi bog\'lanishlarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Foydalanuvchi bog'lanishlarini saqlash
router.post('/users/:user_id', isAuthenticated, hasPermission('debt:manage_bindings'), async (req, res) => {
    try {
        const { user_id } = req.params;
        const { brands = [], branches = [] } = req.body;
        
        await db.transaction(async trx => {
            // Eski bog'lanishlarni o'chirish
            await trx('debt_user_brands').where('user_id', user_id).del();
            await trx('debt_user_branches').where('user_id', user_id).del();
            
            // Yangi bog'lanishlarni qo'shish
            if (brands.length > 0) {
                await trx('debt_user_brands').insert(
                    brands.map(brandId => ({
                        user_id: parseInt(user_id),
                        brand_id: parseInt(brandId)
                    }))
                );
            }
            
            if (branches.length > 0) {
                await trx('debt_user_branches').insert(
                    branches.map(branchId => ({
                        user_id: parseInt(user_id),
                        branch_id: parseInt(branchId)
                    }))
                );
            }
        });
        
        // Foydalanuvchi sessiyasini yangilash
        const { refreshUserSessions } = require('../../utils/sessionManager.js');
        await refreshUserSessions(parseInt(user_id));
        
        // Audit log
        const adminId = req.session.user.id;
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'update_debt_user_bindings',
            target_type: 'user',
            target_id: user_id,
            details: JSON.stringify({ brands: brands.length, branches: branches.length }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });
        
        log.info(`Foydalanuvchi bog'lanishlari yangilandi: user_id=${user_id}`);
        res.json({ message: 'Bog\'lanishlar muvaffaqiyatli saqlandi' });
    } catch (error) {
        log.error('Foydalanuvchi bog\'lanishlarini saqlashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// ===== MAVJUD MA'LUMOTLAR =====

// Barcha mavjud brendlar/filiallar/SVR'lar ro'yxati
router.get('/available', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { brand_id, branch_id } = req.query;
        
        const [brandsRaw, branchesRaw, svrsRaw] = await Promise.all([
            db('debt_brands').select('id', 'name').orderBy('name'),
            brand_id 
                ? db('debt_branches').where('brand_id', brand_id).select('id', 'name', 'brand_id').orderBy('name')
                : db('debt_branches').select('id', 'name', 'brand_id').orderBy('name'),
            branch_id
                ? db('debt_svrs').where('branch_id', branch_id).select('id', 'name', 'brand_id', 'branch_id').orderBy('name')
                : brand_id
                    ? db('debt_svrs').where('brand_id', brand_id).select('id', 'name', 'brand_id', 'branch_id').orderBy('name')
                    : db('debt_svrs').select('id', 'name', 'brand_id', 'branch_id').orderBy('name')
        ]);
        
        // Dublikat tekshiruvi va filtrlash - Brendlar (ID bo'yicha)
        const originalBrandsCount = brandsRaw.length;
        const uniqueBrandsMap = new Map();
        brandsRaw.forEach(brand => {
            if (!uniqueBrandsMap.has(brand.id)) {
                uniqueBrandsMap.set(brand.id, brand);
            } else {
                log.warn(`⚠️ [bindings/available] Brend dublikat topildi: ID=${brand.id}, Name=${brand.name}`);
            }
        });
        const uniqueBrands = Array.from(uniqueBrandsMap.values());
        
        if (originalBrandsCount !== uniqueBrands.length) {
            log.warn(`⚠️ [bindings/available] Brendlar dublikatlari: Original=${originalBrandsCount}, Unique=${uniqueBrands.length}, Dublikatlar=${originalBrandsCount - uniqueBrands.length}`);
        }
        
        // Dublikat tekshiruvi va filtrlash - Filiallar (ID bo'yicha)
        const originalBranchesCount = branchesRaw.length;
        const uniqueBranchesMap = new Map();
        branchesRaw.forEach(branch => {
            if (!uniqueBranchesMap.has(branch.id)) {
                uniqueBranchesMap.set(branch.id, branch);
            } else {
                log.warn(`⚠️ [bindings/available] Filial dublikat topildi: ID=${branch.id}, Name=${branch.name}, BrandID=${branch.brand_id}`);
            }
        });
        const uniqueBranches = Array.from(uniqueBranchesMap.values());
        
        if (originalBranchesCount !== uniqueBranches.length) {
            log.warn(`⚠️ [bindings/available] Filiallar dublikatlari: Original=${originalBranchesCount}, Unique=${uniqueBranches.length}, Dublikatlar=${originalBranchesCount - uniqueBranches.length}`);
        }
        
        // Dublikat tekshiruvi va filtrlash - SVR'lar (ID bo'yicha)
        const originalSvrsCount = svrsRaw.length;
        const uniqueSvrsMap = new Map();
        svrsRaw.forEach(svr => {
            if (!uniqueSvrsMap.has(svr.id)) {
                uniqueSvrsMap.set(svr.id, svr);
            } else {
                log.warn(`⚠️ [bindings/available] SVR dublikat topildi: ID=${svr.id}, Name=${svr.name}, BrandID=${svr.brand_id}, BranchID=${svr.branch_id}`);
            }
        });
        const uniqueSvrs = Array.from(uniqueSvrsMap.values());
        
        if (originalSvrsCount !== uniqueSvrs.length) {
            log.warn(`⚠️ [bindings/available] SVR'lar dublikatlari: Original=${originalSvrsCount}, Unique=${uniqueSvrs.length}, Dublikatlar=${originalSvrsCount - uniqueSvrs.length}`);
        }
        
        res.json({
            brands: uniqueBrands.map(b => ({ id: b.id, name: b.name })),
            branches: uniqueBranches.map(b => ({ id: b.id, name: b.name, brand_id: b.brand_id })),
            svrs: uniqueSvrs.map(s => ({ id: s.id, name: s.name, brand_id: s.brand_id, branch_id: s.branch_id }))
        });
    } catch (error) {
        log.error('Mavjud ma\'lumotlarni olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

module.exports = router;

