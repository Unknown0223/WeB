// routes/debt-approval/users.js
// Qarzdorlik Tasdiqlash - Foydalanuvchilar API

const express = require('express');
const router = express.Router();
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');

const log = createLogger('DEBT_USERS');

// Foydalanuvchilar ro'yxatini olish (rol bo'yicha filter)
router.get('/', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { role } = req.query;
        
        let query = db('users')
            .select('users.id', 'users.username', 'users.fullname', 'users.role', 'users.status')
            .where('users.status', 'active');
        
        if (role) {
            query = query.where('users.role', role);
        }
        
        const users = await query.orderBy('users.fullname');
        
        res.json(users);
    } catch (error) {
        log.error('Foydalanuvchilar ro\'yxatini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Foydalanuvchi ma'lumotlarini olish
router.get('/:userId', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await db('users')
            .where('id', userId)
            .first();
        
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        
        res.json(user);
    } catch (error) {
        log.error('Foydalanuvchi ma\'lumotlarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Foydalanuvchi bog'lanishlarini olish
router.get('/:userId/bindings', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [brandsRaw, branchesRaw, svrsRaw] = await Promise.all([
            db('debt_user_brands')
                .where('user_id', userId)
                .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                .select('debt_brands.id', 'debt_brands.name')
                .groupBy('debt_brands.id', 'debt_brands.name')
                .orderBy('debt_brands.name'),
            db('debt_user_branches')
                .where('user_id', userId)
                .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                .select('debt_branches.id', 'debt_branches.name', 'debt_branches.brand_id')
                .groupBy('debt_branches.id', 'debt_branches.name', 'debt_branches.brand_id')
                .orderBy('debt_branches.name'),
            db('debt_user_svrs')
                .where('user_id', userId)
                .join('debt_svrs', 'debt_user_svrs.svr_id', 'debt_svrs.id')
                .select('debt_svrs.id', 'debt_svrs.name', 'debt_svrs.brand_id', 'debt_svrs.branch_id')
                .groupBy('debt_svrs.id', 'debt_svrs.name', 'debt_svrs.brand_id', 'debt_svrs.branch_id')
                .orderBy('debt_svrs.name')
        ]);
        
        // Dublikat tekshiruvi va filtrlash - Brendlar
        const uniqueBrandsMap = new Map();
        brandsRaw.forEach(brand => {
            if (!uniqueBrandsMap.has(brand.id)) {
                uniqueBrandsMap.set(brand.id, brand);
            } else {
                log.warn(`⚠️ [users/${userId}/bindings] Brend dublikat topildi: ID=${brand.id}, Name=${brand.name}`);
            }
        });
        const uniqueBrands = Array.from(uniqueBrandsMap.values());
        
        if (brandsRaw.length !== uniqueBrands.length) {
            log.warn(`⚠️ [users/${userId}/bindings] Brendlar dublikatlari: Original=${brandsRaw.length}, Unique=${uniqueBrands.length}`);
        }
        
        // Dublikat tekshiruvi va filtrlash - Filiallar
        const uniqueBranchesMap = new Map();
        branchesRaw.forEach(branch => {
            if (!uniqueBranchesMap.has(branch.id)) {
                uniqueBranchesMap.set(branch.id, branch);
            } else {
                log.warn(`⚠️ [users/${userId}/bindings] Filial dublikat topildi: ID=${branch.id}, Name=${branch.name}, BrandID=${branch.brand_id}`);
            }
        });
        const uniqueBranches = Array.from(uniqueBranchesMap.values());
        
        if (branchesRaw.length !== uniqueBranches.length) {
            log.warn(`⚠️ [users/${userId}/bindings] Filiallar dublikatlari: Original=${branchesRaw.length}, Unique=${uniqueBranches.length}`);
        }
        
        // Dublikat tekshiruvi va filtrlash - SVR'lar
        const uniqueSvrsMap = new Map();
        svrsRaw.forEach(svr => {
            if (!uniqueSvrsMap.has(svr.id)) {
                uniqueSvrsMap.set(svr.id, svr);
            } else {
                log.warn(`⚠️ [users/${userId}/bindings] SVR dublikat topildi: ID=${svr.id}, Name=${svr.name}`);
            }
        });
        const uniqueSvrs = Array.from(uniqueSvrsMap.values());
        
        if (svrsRaw.length !== uniqueSvrs.length) {
            log.warn(`⚠️ [users/${userId}/bindings] SVR'lar dublikatlari: Original=${svrsRaw.length}, Unique=${uniqueSvrs.length}`);
        }
        
        res.json({
            user_id: parseInt(userId),
            brands: uniqueBrands.map(b => ({ id: b.id, name: b.name })),
            branches: uniqueBranches.map(b => ({ id: b.id, name: b.name, brand_id: b.brand_id })),
            svrs: uniqueSvrs.map(s => ({ id: s.id, name: s.name, brand_id: s.brand_id, branch_id: s.branch_id }))
        });
    } catch (error) {
        log.error('Foydalanuvchi bog\'lanishlarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Foydalanuvchi bog'lanishlarini saqlash
router.post('/:userId/bindings', isAuthenticated, hasPermission('debt:manage_bindings'), async (req, res) => {
    const { userId } = req.params;
    const { brands, branches, svrs } = req.body; // IDs array

    if (!Array.isArray(brands) || !Array.isArray(branches) || !Array.isArray(svrs)) {
        return res.status(400).json({ message: "Brendlar, filiallar va SVRlar massiv formatida yuborilishi kerak." });
    }

    log.info(`[USER_BINDINGS] Saqlash so'rovi qabul qilindi: userId=${userId}, brands=${JSON.stringify(brands)}, branches=${JSON.stringify(branches)}, svrs=${JSON.stringify(svrs)}`);

    try {
        // Foydalanuvchi roli va ma'lumotlarini olish
        const user = await db('users').where('id', userId).first();
        if (!user) {
            log.error(`[USER_BINDINGS] Foydalanuvchi topilmadi: userId=${userId}`);
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        
        log.info(`[USER_BINDINGS] Foydalanuvchi ma'lumotlari: userId=${userId}, fullname=${user.fullname}, role=${user.role}, status=${user.status}`);

        await db.transaction(async trx => {
            // MUHIM: Avtomatik biriktirish OLIB TASHLANDI
            // Faqat foydalanuvchi tanlagan brendlar va filiallar saqlanadi
            // Agar filial tanlab brend tanlanmasa, brend qo'shilmaydi
            // Agar brend tanlab filial tanlanmasa, filial qo'shilmaydi
            
            // Oldingi bog'lanishlarni o'chirish
            const deletedBrands = await trx('debt_user_brands').where({ user_id: userId }).del();
            const deletedBranches = await trx('debt_user_branches').where({ user_id: userId }).del();
            const deletedSvrs = await trx('debt_user_svrs').where({ user_id: userId }).del();

            log.info(`[USER_BINDINGS] Eski bog'lanishlar o'chirildi: brands=${deletedBrands}, branches=${deletedBranches}, svrs=${deletedSvrs}`);

            // Faqat tanlangan brendlar saqlanadi
            if (brands.length > 0) {
                const brandRecords = brands.map(brand_id => ({ user_id: parseInt(userId), brand_id: parseInt(brand_id) }));
                await trx('debt_user_brands').insert(brandRecords);
                log.info(`[USER_BINDINGS] Brendlar saqlandi: ${brandRecords.length} ta`, brandRecords);
                
                // Operator uchun debt_operators jadvalini sinxronlash
                if (user.role === 'operator') {
                    await trx('debt_operators').where({ user_id: userId }).del();
                    
                    const uniqueBrandIds = [...new Set(brands.map(b => parseInt(b)))];
                    const operatorRecords = uniqueBrandIds.map(brandId => ({
                        user_id: parseInt(userId),
                        brand_id: brandId,
                        is_active: true
                    }));
                    
                    if (operatorRecords.length > 0) {
                        await trx('debt_operators').insert(operatorRecords);
                        log.info(`[USER_BINDINGS] Operator ${userId} uchun debt_operators jadvaliga ${operatorRecords.length} ta brend biriktirildi`);
                    }
                }
            } else {
                log.info(`[USER_BINDINGS] Brendlar saqlanmadi: brands array bo'sh`);
                
                // Agar brendlar o'chirilsa, operator uchun debt_operators jadvalidan ham o'chirish
                if (user.role === 'operator') {
                    await trx('debt_operators').where({ user_id: userId }).del();
                    log.info(`[USER_BINDINGS] Operator ${userId} uchun debt_operators jadvalidan barcha biriktirishlar o'chirildi`);
                }
            }

            // Faqat tanlangan filiallar saqlanadi
            if (branches.length > 0) {
                const branchRecords = branches.map(branch_id => ({ user_id: parseInt(userId), branch_id: parseInt(branch_id) }));
                await trx('debt_user_branches').insert(branchRecords);
                log.info(`[USER_BINDINGS] Filiallar saqlandi: ${branchRecords.length} ta`, branchRecords);
                
                // Kassir uchun debt_cashiers jadvalini sinxronlash
                log.debug(`[USER_BINDINGS] Foydalanuvchi roli tekshirilmoqda: role=${user.role}, kassir=${user.role === 'kassir' || user.role === 'cashier'}`);
                if (user.role === 'kassir' || user.role === 'cashier') {
                    log.info(`[USER_BINDINGS] Kassir roli tasdiqlandi. debt_cashiers jadvalini sinxronlash boshlanmoqda...`);
                    
                    // Eski biriktirishlarni o'chirish
                    const deletedCashiers = await trx('debt_cashiers').where({ user_id: userId }).del();
                    log.info(`[USER_BINDINGS] Eski debt_cashiers biriktirishlari o'chirildi: ${deletedCashiers} ta`);
                    
                    // Yangi biriktirishlarni qo'shish
                    const uniqueBranchIds = [...new Set(branches.map(b => parseInt(b)))];
                    log.debug(`[USER_BINDINGS] Unique filial ID'lari: ${uniqueBranchIds.join(', ')}`);
                    
                    const cashierRecords = uniqueBranchIds.map(branchId => ({
                        user_id: parseInt(userId),
                        branch_id: branchId,
                        is_active: true
                    }));
                    
                    if (cashierRecords.length > 0) {
                        await trx('debt_cashiers').insert(cashierRecords);
                        log.info(`[USER_BINDINGS] ✅ Kassir ${userId} uchun debt_cashiers jadvaliga ${cashierRecords.length} ta filial biriktirildi`, 
                            cashierRecords.map(r => ({ user_id: r.user_id, branch_id: r.branch_id, is_active: r.is_active }))
                        );
                    } else {
                        log.warn(`[USER_BINDINGS] ⚠️ Kassir ${userId} uchun cashierRecords bo'sh, biriktirish amalga oshirilmadi`);
                    }
                } else {
                    log.debug(`[USER_BINDINGS] Foydalanuvchi kassir emas (role=${user.role}), debt_cashiers sinxronlash o'tkazildi`);
                }
            } else {
                log.info(`[USER_BINDINGS] Filiallar saqlanmadi: branches array bo'sh`);
                
                // Agar filiallar o'chirilsa, kassir uchun debt_cashiers jadvalidan ham o'chirish
                if (user.role === 'kassir' || user.role === 'cashier') {
                    const deletedCashiers = await trx('debt_cashiers').where({ user_id: userId }).del();
                    log.info(`[USER_BINDINGS] Kassir ${userId} uchun debt_cashiers jadvalidan barcha biriktirishlar o'chirildi: ${deletedCashiers} ta`);
                }
            }

            // Yangi SVR bog'lanishlarini qo'shish
            if (svrs.length > 0) {
                const svrRecords = svrs.map(svr_id => ({ user_id: parseInt(userId), svr_id: parseInt(svr_id) }));
                await trx('debt_user_svrs').insert(svrRecords);
                log.info(`[USER_BINDINGS] SVR'lar saqlandi: ${svrRecords.length} ta`, svrRecords);
            } else {
                log.info(`[USER_BINDINGS] SVR'lar saqlanmadi: svrs array bo'sh`);
            }
        });

        log.info(`[USER_BINDINGS] ✅ Foydalanuvchi (ID: ${userId}) uchun bog'lanishlar muvaffaqiyatli yangilandi.`);
        res.json({ message: `Foydalanuvchi (ID: ${userId}) uchun bog'lanishlar muvaffaqiyatli yangilandi.` });
    } catch (error) {
        log.error(`[USER_BINDINGS] ❌ /api/debt-approval/users/${userId}/bindings POST xatoligi:`, error);
        res.status(500).json({ message: "Bog'lanishlarni saqlashda xatolik." });
    }
});

// Foydalanuvchi vazifalarini olish
router.get('/:userId/tasks', isAuthenticated, hasPermission('debt:view_bindings'), async (req, res) => {
    try {
        const { userId } = req.params;
        
        const tasks = await db('debt_user_tasks')
            .where('user_id', userId)
            .select('*')
            .orderBy('task_type');
        
        res.json(tasks);
    } catch (error) {
        log.error('Foydalanuvchi vazifalarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Foydalanuvchi vazifalarini saqlash
router.post('/:userId/tasks', isAuthenticated, hasPermission('debt:manage_bindings'), async (req, res) => {
    const { userId } = req.params;
    const { tasks } = req.body; // Array of { task_type, brand_id?, branch_id?, svr_id? }

    if (!Array.isArray(tasks)) {
        return res.status(400).json({ message: "Vazifalar massiv formatida yuborilishi kerak." });
    }

    try {
        // Foydalanuvchi roli va ma'lumotlarini olish
        const user = await db('users').where('id', userId).first();
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }

        await db.transaction(async trx => {
            // Oldingi vazifalarni o'chirish
            await trx('debt_user_tasks').where({ user_id: userId }).del();

            // Kassir uchun filial biriktirishlarni o'chirish (agar kassir bo'lsa)
            if (user.role === 'kassir' || user.role === 'cashier') {
                await trx('debt_cashiers').where({ user_id: userId }).del();
            }

                // Operator uchun brend biriktirishlarni o'chirish (agar operator bo'lsa)
                if (user.role === 'operator') {
                    await trx('debt_operators').where({ user_id: userId }).del();
                }
                
                // Admin uchun biriktirishlar yo'q (chunki ular barcha funksiyalarga ega)
                // Lekin admin uchun ham task saqlash kerak bo'lishi mumkin

            // Yangi vazifalarni qo'shish
            if (tasks.length > 0) {
                const taskRecords = tasks.map(task => ({
                    user_id: parseInt(userId),
                    task_type: task.task_type,
                    brand_id: task.brand_id || null,
                    branch_id: task.branch_id || null,
                    svr_id: task.svr_id || null
                }));
                await trx('debt_user_tasks').insert(taskRecords);

                // Kassir uchun filial biriktirishlarni qo'shish
                if (user.role === 'kassir' || user.role === 'cashier') {
                    const cashierTasks = tasks.filter(task => 
                        (task.task_type === 'approve_cashier' || task.task_type === 'debt:approve_cashier')
                    );
                    
                    if (cashierTasks.length > 0) {
                        // Avval task'lardan filiallarni olish
                        let branchIds = cashierTasks
                            .filter(t => t.branch_id)
                            .map(t => t.branch_id);
                        
                        // Agar task'larda filial bo'lmasa, "Bog'lanishlar" tab'idagi filiallarni olish
                        if (branchIds.length === 0) {
                            const userBranches = await trx('debt_user_branches')
                                .where('user_id', userId)
                                .select('branch_id');
                            branchIds = userBranches.map(b => b.branch_id);
                            log.info(`Kassir ${userId} uchun task'larda filial topilmadi, "Bog'lanishlar" tab'idagi filiallar ishlatilmoqda: ${branchIds.join(', ')}`);
                        }
                        
                        if (branchIds.length > 0) {
                            // Unique filiallarni olish
                            const uniqueBranchIds = [...new Set(branchIds)];
                            
                            const cashierRecords = uniqueBranchIds.map(branchId => ({
                                user_id: parseInt(userId),
                                branch_id: parseInt(branchId),
                                is_active: true
                            }));
                            
                            await trx('debt_cashiers').insert(cashierRecords);
                            log.info(`Kassir ${userId} uchun ${uniqueBranchIds.length} ta filial biriktirildi: ${uniqueBranchIds.join(', ')}`);
                        }
                    }
                }

                // Operator uchun brend biriktirishlarni qo'shish
                if (user.role === 'operator') {
                    const operatorTasks = tasks.filter(task => 
                        (task.task_type === 'approve_operator' || task.task_type === 'debt:approve_operator')
                    );
                    
                    if (operatorTasks.length > 0) {
                        // Avval task'lardan brendlarni olish
                        let brandIds = operatorTasks
                            .filter(t => t.brand_id)
                            .map(t => t.brand_id);
                        
                        // Agar task'larda brend bo'lmasa, "Bog'lanishlar" tab'idagi brendlarni olish
                        if (brandIds.length === 0) {
                            const userBrands = await trx('debt_user_brands')
                                .where('user_id', userId)
                                .select('brand_id');
                            brandIds = userBrands.map(b => b.brand_id);
                            log.info(`Operator ${userId} uchun task'larda brend topilmadi, "Bog'lanishlar" tab'idagi brendlar ishlatilmoqda: ${brandIds.join(', ')}`);
                        }
                        
                        if (brandIds.length > 0) {
                            // Unique brendlarni olish
                            const uniqueBrandIds = [...new Set(brandIds)];
                            
                            const operatorRecords = uniqueBrandIds.map(brandId => ({
                                user_id: parseInt(userId),
                                brand_id: parseInt(brandId),
                                is_active: true
                            }));
                            
                            await trx('debt_operators').insert(operatorRecords);
                            log.info(`Operator ${userId} uchun ${uniqueBrandIds.length} ta brend biriktirildi: ${uniqueBrandIds.join(', ')}`);
                        }
                    }
                }
            }
        });

        res.json({ message: `Foydalanuvchi (ID: ${userId}) uchun vazifalar muvaffaqiyatli yangilandi.` });
    } catch (error) {
        log.error(`/api/debt-approval/users/${userId}/tasks POST xatoligi:`, error);
        res.status(500).json({ message: "Vazifalarni saqlashda xatolik." });
    }
});

module.exports = router;

