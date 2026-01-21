// utils/cashierAssignment.js
// Round-robin kassir tayinlash - filialga biriktirilgan kassirlar orasidan eng kam ishlatilganini tanlash

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('CASHIER_ASSIGN');

/**
 * Filialga kassir tayinlash (round-robin)
 */
async function assignCashierToRequest(branchId, requestId) {
    try {
        log.info(`[ASSIGN] Kassir tayinlash boshlanmoqda: branchId=${branchId}, requestId=${requestId}`);
        
        // 0. Filial nomini olish (bir xil nomdagi filiallar uchun)
        const branchInfo = await db('debt_branches')
            .where('id', branchId)
            .select('id', 'name')
            .first();
        
        log.info(`[ASSIGN] 0. Filial ma'lumotlari: BranchId=${branchId}, BranchName=${branchInfo?.name || 'topilmadi'}`);
        
        // 1. Filialga biriktirilgan faol kassirlarni olish
        // 1.1. debt_cashiers jadvalidan (eski usul) - avval ID bo'yicha
        log.debug(`[ASSIGN] 1.1. debt_cashiers jadvalidan qidirilmoqda: branchId=${branchId}`);
        let cashiersFromTable = await db('debt_cashiers')
            .join('users', 'debt_cashiers.user_id', 'users.id')
            .where('debt_cashiers.branch_id', branchId)
            .where('debt_cashiers.is_active', true)
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
            .select(
                'debt_cashiers.user_id',
                'debt_cashiers.id as cashier_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username',
                'users.role'
            );
        
        // 1.1.1. Agar ID bo'yicha topilmasa, filial nomi bo'yicha qidirish
        if (cashiersFromTable.length === 0 && branchInfo) {
            log.debug(`[ASSIGN] 1.1.1. ID bo'yicha topilmadi, filial nomi bo'yicha qidirilmoqda: branchName=${branchInfo.name}`);
            const branchesWithSameName = await db('debt_branches')
                .where('name', branchInfo.name)
                .select('id');
            const branchIdsWithSameName = branchesWithSameName.map(b => b.id);
            
            log.debug(`[ASSIGN] 1.1.1. Bir xil nomdagi filiallar: ${branchIdsWithSameName.length} ta`, branchIdsWithSameName);
            
            if (branchIdsWithSameName.length > 0) {
                cashiersFromTable = await db('debt_cashiers')
                    .join('users', 'debt_cashiers.user_id', 'users.id')
                    .whereIn('debt_cashiers.branch_id', branchIdsWithSameName)
                    .where('debt_cashiers.is_active', true)
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
                    .select(
                        'debt_cashiers.user_id',
                        'debt_cashiers.id as cashier_id',
                        'users.telegram_chat_id',
                        'users.fullname',
                        'users.username',
                        'users.role'
                    );
                
                log.info(`[ASSIGN] 1.1.1. Filial nomi bo'yicha debt_cashiers jadvalidan topildi: ${cashiersFromTable.length} ta`, 
                    cashiersFromTable.map(c => ({ 
                        user_id: c.user_id, 
                        fullname: c.fullname, 
                        role: c.role,
                        telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                    }))
                );
            }
        }
        
        log.info(`[ASSIGN] 1.1. debt_cashiers jadvalidan topildi: ${cashiersFromTable.length} ta`, 
            cashiersFromTable.map(c => ({ 
                user_id: c.user_id, 
                fullname: c.fullname, 
                role: c.role,
                telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        // 1.2. debt_user_branches jadvalidan (yangi usul - foydalanuvchi biriktirishlari)
        log.debug(`[ASSIGN] 1.2. debt_user_branches jadvalidan qidirilmoqda: branchId=${branchId}`);
        let cashiersFromBindings = await db('debt_user_branches')
            .join('users', 'debt_user_branches.user_id', 'users.id')
            .where('debt_user_branches.branch_id', branchId)
            .whereIn('users.role', ['kassir', 'cashier'])
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
            .select(
                'debt_user_branches.user_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username',
                'users.role'
            )
            .groupBy('debt_user_branches.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
        
        // 1.2.1. Agar ID bo'yicha topilmasa, filial nomi bo'yicha qidirish
        if (cashiersFromBindings.length === 0 && branchInfo) {
            log.debug(`[ASSIGN] 1.2.1. ID bo'yicha topilmadi, filial nomi bo'yicha qidirilmoqda: branchName=${branchInfo.name}`);
            const branchesWithSameName = await db('debt_branches')
                .where('name', branchInfo.name)
                .select('id');
            const branchIdsWithSameName = branchesWithSameName.map(b => b.id);
            
            if (branchIdsWithSameName.length > 0) {
                cashiersFromBindings = await db('debt_user_branches')
                    .join('users', 'debt_user_branches.user_id', 'users.id')
                    .whereIn('debt_user_branches.branch_id', branchIdsWithSameName)
                    .whereIn('users.role', ['kassir', 'cashier'])
                    .where('users.status', 'active')
                    .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
                    .select(
                        'debt_user_branches.user_id',
                        'users.telegram_chat_id',
                        'users.fullname',
                        'users.username',
                        'users.role'
                    )
                    .groupBy('debt_user_branches.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
                
                log.info(`[ASSIGN] 1.2.1. Filial nomi bo'yicha debt_user_branches jadvalidan topildi: ${cashiersFromBindings.length} ta`, 
                    cashiersFromBindings.map(c => ({ 
                        user_id: c.user_id, 
                        fullname: c.fullname, 
                        role: c.role,
                        telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
                    }))
                );
            }
        }
        
        log.info(`[ASSIGN] 1.2. debt_user_branches jadvalidan topildi: ${cashiersFromBindings.length} ta`, 
            cashiersFromBindings.map(c => ({ 
                user_id: c.user_id, 
                fullname: c.fullname, 
                role: c.role,
                telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        // 1.3. debt_user_tasks jadvalidan (kassir vazifasiga ega foydalanuvchilar)
        log.debug(`[ASSIGN] 1.3. debt_user_tasks jadvalidan qidirilmoqda: task_type=approve_cashier yoki debt:approve_cashier, branchId=${branchId}`);
        const cashiersFromTasks = await db('debt_user_tasks')
            .join('users', 'debt_user_tasks.user_id', 'users.id')
            .where(function() {
                this.where('debt_user_tasks.task_type', 'approve_cashier')
                    .orWhere('debt_user_tasks.task_type', 'debt:approve_cashier');
            })
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
            .where(function() {
                // Agar branch_id null bo'lsa, barcha filiallar uchun, aks holda faqat shu filial
                this.whereNull('debt_user_tasks.branch_id')
                    .orWhere('debt_user_tasks.branch_id', branchId);
            })
            .select(
                'debt_user_tasks.user_id',
                'debt_user_tasks.branch_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username',
                'users.role'
            )
            .groupBy('debt_user_tasks.user_id', 'debt_user_tasks.branch_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
        
        log.info(`[ASSIGN] 1.3. debt_user_tasks jadvalidan topildi: ${cashiersFromTasks.length} ta`, 
            cashiersFromTasks.map(c => ({ 
                user_id: c.user_id, 
                fullname: c.fullname, 
                role: c.role,
                branch_id: c.branch_id,
                telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        // Debug: Barcha shu filialga biriktirilgan foydalanuvchilarni ko'rish
        let allBranchBindings = await db('debt_user_branches')
            .where('branch_id', branchId)
            .join('users', 'debt_user_branches.user_id', 'users.id')
            .select('debt_user_branches.user_id', 'users.fullname', 'users.role', 'users.status')
            .groupBy('debt_user_branches.user_id', 'users.fullname', 'users.role', 'users.status');
        
        // Agar ID bo'yicha topilmasa, filial nomi bo'yicha qidirish
        if (allBranchBindings.length === 0 && branchInfo) {
            const branchesWithSameName = await db('debt_branches')
                .where('name', branchInfo.name)
                .select('id');
            const branchIdsWithSameName = branchesWithSameName.map(b => b.id);
            
            if (branchIdsWithSameName.length > 0) {
                allBranchBindings = await db('debt_user_branches')
                    .whereIn('branch_id', branchIdsWithSameName)
                    .join('users', 'debt_user_branches.user_id', 'users.id')
                    .select('debt_user_branches.user_id', 'users.fullname', 'users.role', 'users.status')
                    .groupBy('debt_user_branches.user_id', 'users.fullname', 'users.role', 'users.status');
            }
        }
        
        log.debug(`[ASSIGN] 1.4. Barcha filialga biriktirilgan foydalanuvchilar (role tekshiruvsiz): ${allBranchBindings.length} ta`, 
            allBranchBindings.map(b => ({ 
                user_id: b.user_id, 
                fullname: b.fullname, 
                role: b.role,
                status: b.status
            }))
        );
        
        // Birlashtirish (dublikatlarni olib tashlash)
        const cashiersMap = new Map();
        [...cashiersFromTable, ...cashiersFromBindings, ...cashiersFromTasks].forEach(c => {
            if (!cashiersMap.has(c.user_id)) {
                cashiersMap.set(c.user_id, {
                    user_id: c.user_id,
                    cashier_id: c.cashier_id || null,
                    telegram_chat_id: c.telegram_chat_id,
                    fullname: c.fullname,
                    username: c.username
                });
            }
        });
        
        const cashiers = Array.from(cashiersMap.values());
        
        log.info(`[ASSIGN] 1.5. Birlashtirilgan kassirlar (dublikatsiz): ${cashiers.length} ta`, 
            cashiers.map(c => ({ 
                user_id: c.user_id, 
                fullname: c.fullname,
                telegram_chat_id: c.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        if (cashiers.length === 0) {
            log.warn(`[ASSIGN] ❌ Hech qanday faol kassir topilmadi: branchId=${branchId}`);
            log.warn(`[ASSIGN] Tekshiruv natijalari:`);
            log.warn(`[ASSIGN]   - debt_cashiers jadvalidan: ${cashiersFromTable.length} ta`);
            log.warn(`[ASSIGN]   - debt_user_branches jadvalidan: ${cashiersFromBindings.length} ta`);
            log.warn(`[ASSIGN]   - Barcha filialga biriktirilgan foydalanuvchilar: ${allBranchBindings.length} ta`);
            return null;
        }
        
        // 2. Har bir kassirning ishlatilish sonini hisoblash
        log.debug(`[ASSIGN] 2. Kassirlarning ishlatilish sonini hisoblash: branchId=${branchId}`);
        const cashierUsage = await db('debt_requests')
            .where('branch_id', branchId)
            .whereNotNull('current_approver_id')
            .where('current_approver_type', 'cashier')
            .where('status', '!=', 'cancelled')
            .groupBy('current_approver_id')
            .select('current_approver_id')
            .count('* as usage_count');
        
        log.debug(`[ASSIGN] 2.1. Kassirlarning ishlatilish soni: ${cashierUsage.length} ta`, 
            cashierUsage.map(u => ({ 
                user_id: u.current_approver_id, 
                usage_count: u.usage_count 
            }))
        );
        
        // Usage map yaratish
        const usageMap = new Map();
        cashierUsage.forEach(item => {
            usageMap.set(item.current_approver_id, parseInt(item.usage_count));
        });
        
        // 3. Eng kam ishlatilgan kassirni tanlash
        log.debug(`[ASSIGN] 3. Eng kam ishlatilgan kassirni tanlash boshlanmoqda`);
        let selectedCashier = null;
        let minUsage = Infinity;
        let oldestAssignment = null;
        
        for (const cashier of cashiers) {
            const usage = usageMap.get(cashier.user_id) || 0;
            log.debug(`[ASSIGN] 3.1. Kassir: ${cashier.fullname} (ID: ${cashier.user_id}), Usage: ${usage}, MinUsage: ${minUsage}`);
            
            if (usage < minUsage) {
                minUsage = usage;
                selectedCashier = cashier;
                oldestAssignment = null; // Reset
                log.debug(`[ASSIGN] 3.2. Yangi eng kam ishlatilgan: ${cashier.fullname} (Usage: ${usage})`);
            } else if (usage === minUsage) {
                // Agar bir nechta teng bo'lsa, eng eski assignment'ni tanlash
                // Avval debt_cashiers jadvalidan qidirish
                if (!oldestAssignment) {
                    oldestAssignment = await db('debt_cashiers')
                        .where('user_id', selectedCashier.user_id)
                        .where('branch_id', branchId)
                        .first();
                    
                    // Agar debt_cashiers'da topilmasa, debt_user_branches'dan olish
                    if (!oldestAssignment) {
                        const binding = await db('debt_user_branches')
                            .where('user_id', selectedCashier.user_id)
                            .where('branch_id', branchId)
                            .first();
                        if (binding) {
                            oldestAssignment = { assigned_at: binding.created_at || new Date() };
                        }
                    }
                }
                
                let currentAssignment = await db('debt_cashiers')
                    .where('user_id', cashier.user_id)
                    .where('branch_id', branchId)
                    .first();
                
                // Agar debt_cashiers'da topilmasa, debt_user_branches'dan olish
                if (!currentAssignment) {
                    const binding = await db('debt_user_branches')
                        .where('user_id', cashier.user_id)
                        .where('branch_id', branchId)
                        .first();
                    if (binding) {
                        currentAssignment = { assigned_at: binding.created_at || new Date() };
                    }
                }
                
                if (currentAssignment && oldestAssignment) {
                    if (new Date(currentAssignment.assigned_at) < new Date(oldestAssignment.assigned_at)) {
                        selectedCashier = cashier;
                        oldestAssignment = currentAssignment;
                    }
                } else if (currentAssignment) {
                    selectedCashier = cashier;
                    oldestAssignment = currentAssignment;
                }
            }
        }
        
        if (!selectedCashier) {
            // Agar hech qanday tanlov bo'lmasa, birinchi kassirni tanlash
            selectedCashier = cashiers[0];
            log.warn(`[ASSIGN] 3.3. Hech qanday tanlov bo'lmadi, birinchi kassir tanlandi: ${selectedCashier.fullname} (ID: ${selectedCashier.user_id})`);
        }
        
        log.info(`[ASSIGN] 3.4. Tanlangan kassir: ${selectedCashier.fullname} (ID: ${selectedCashier.user_id}), Usage: ${minUsage}, TelegramChatId: ${selectedCashier.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
        
        // 4. So'rovga kassirni biriktirish
        log.debug(`[ASSIGN] 4. So'rovga kassir biriktirilmoqda: requestId=${requestId}, cashierId=${selectedCashier.user_id}`);
        await db('debt_requests')
            .where('id', requestId)
            .update({
                current_approver_id: selectedCashier.user_id,
                current_approver_type: 'cashier'
            });
        
        log.info(`[ASSIGN] ✅ Kassir muvaffaqiyatli tayinlandi: requestId=${requestId}, branchId=${branchId}, cashierId=${selectedCashier.user_id}, cashierName=${selectedCashier.fullname}, usage=${minUsage}`);
        
        return selectedCashier;
    } catch (error) {
        log.error('Error assigning cashier:', error);
        throw error;
    }
}

/**
 * Operator tayinlash (brend bo'yicha)
 */
async function assignOperatorToRequest(brandId, requestId) {
    try {
        log.info(`[ASSIGN_OPERATOR] Operator tayinlash boshlanmoqda: brandId=${brandId}, requestId=${requestId}`);
        
        // 0. Brend ma'lumotlarini olish
        const brandInfo = await db('debt_brands')
            .where('id', brandId)
            .select('id', 'name')
            .first();
        
        log.info(`[ASSIGN_OPERATOR] 0. Brend ma'lumotlari: BrandId=${brandId}, BrandName=${brandInfo?.name || 'topilmadi'}`);
        
        // 0.1. Barcha operatorlarga qaysi brendlar bog'langanini ko'rsatish
        log.debug(`[ASSIGN_OPERATOR] 0.1. Barcha operatorlarga bog'langan brendlarni tekshirish...`);
        const allOperatorsWithBrands = await db('users')
            .whereIn('role', ['operator'])
            .where('status', 'active')
            .select('id', 'fullname', 'username', 'telegram_chat_id', 'role');
        
        for (const operator of allOperatorsWithBrands) {
            // debt_operators jadvalidan
            const operatorBrandsFromTable = await db('debt_operators')
                .where('user_id', operator.id)
                .where('is_active', true)
                .join('debt_brands', 'debt_operators.brand_id', 'debt_brands.id')
                .select('debt_brands.id', 'debt_brands.name')
                .orderBy('debt_brands.name');
            
            // debt_user_brands jadvalidan
            const operatorBrandsFromBindings = await db('debt_user_brands')
                .where('user_id', operator.id)
                .join('debt_brands', 'debt_user_brands.brand_id', 'debt_brands.id')
                .select('debt_brands.id', 'debt_brands.name')
                .orderBy('debt_brands.name');
            
            // Birlashtirish
            const allBrandsMap = new Map();
            [...operatorBrandsFromTable, ...operatorBrandsFromBindings].forEach(b => {
                if (!allBrandsMap.has(b.id)) {
                    allBrandsMap.set(b.id, b.name);
                }
            });
            const allBrands = Array.from(allBrandsMap.entries()).map(([id, name]) => ({ id, name }));
            
            log.info(`[ASSIGN_OPERATOR] 0.1. Operator: ${operator.fullname} (ID: ${operator.id}), Role: ${operator.role}, TelegramChatId: ${operator.telegram_chat_id ? 'mavjud' : 'yo\'q'}, Bog'langan brendlar: ${allBrands.length} ta`, 
                allBrands.map(b => ({ id: b.id, name: b.name }))
            );
            
            // Agar shu brendga bog'langan bo'lsa, alohida log
            const hasThisBrand = allBrands.some(b => b.id === brandId);
            if (hasThisBrand) {
                log.info(`[ASSIGN_OPERATOR] 0.2. ✅ Operator ${operator.fullname} (ID: ${operator.id}) shu brendga (BrandId: ${brandId}) bog'langan!`);
            }
        }
        
        // 1. Brendga biriktirilgan faol operatorlarni olish
        log.debug(`[ASSIGN_OPERATOR] 1.1. debt_operators jadvalidan qidirilmoqda: brandId=${brandId}`);
        const operatorsFromTable = await db('debt_operators')
            .join('users', 'debt_operators.user_id', 'users.id')
            .where('debt_operators.brand_id', brandId)
            .where('debt_operators.is_active', true)
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
            .select(
                'debt_operators.user_id',
                'debt_operators.id as operator_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username',
                'users.role'
            );
        
        log.info(`[ASSIGN_OPERATOR] 1.1. debt_operators jadvalidan topildi: ${operatorsFromTable.length} ta`, 
            operatorsFromTable.map(o => ({ 
                user_id: o.user_id, 
                fullname: o.fullname, 
                role: o.role,
                telegram_chat_id: o.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        // 1.2. debt_user_brands jadvalidan (yangi usul)
        log.debug(`[ASSIGN_OPERATOR] 1.2. debt_user_brands jadvalidan qidirilmoqda: brandId=${brandId}`);
        const operatorsFromBindings = await db('debt_user_brands')
            .join('users', 'debt_user_brands.user_id', 'users.id')
            .where('debt_user_brands.brand_id', brandId)
            .whereIn('users.role', ['operator'])
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
            .select(
                'debt_user_brands.user_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username',
                'users.role'
            )
            .groupBy('debt_user_brands.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
        
        log.info(`[ASSIGN_OPERATOR] 1.2. debt_user_brands jadvalidan topildi: ${operatorsFromBindings.length} ta`, 
            operatorsFromBindings.map(o => ({ 
                user_id: o.user_id, 
                fullname: o.fullname, 
                role: o.role,
                telegram_chat_id: o.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        // 1.3. debt_user_tasks jadvalidan (operator vazifasiga ega foydalanuvchilar - barcha brendlar bo'yicha)
        log.debug(`[ASSIGN_OPERATOR] 1.3. debt_user_tasks jadvalidan qidirilmoqda: task_type=approve_operator yoki debt:approve_operator`);
        const operatorsFromTasks = await db('debt_user_tasks')
            .join('users', 'debt_user_tasks.user_id', 'users.id')
            .where(function() {
                this.where('debt_user_tasks.task_type', 'approve_operator')
                    .orWhere('debt_user_tasks.task_type', 'debt:approve_operator');
            })
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id') // Faqat telegram_chat_id bor foydalanuvchilar
            .select(
                'debt_user_tasks.user_id',
                'users.telegram_chat_id',
                'users.fullname',
                'users.username',
                'users.role'
            )
            .groupBy('debt_user_tasks.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username', 'users.role');
        
        log.info(`[ASSIGN_OPERATOR] 1.3. debt_user_tasks jadvalidan topildi: ${operatorsFromTasks.length} ta (barcha brendlar bo'yicha)`, 
            operatorsFromTasks.map(o => ({ 
                user_id: o.user_id, 
                fullname: o.fullname, 
                role: o.role,
                telegram_chat_id: o.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        // Birlashtirish (dublikatlarni olib tashlash)
        const operatorsMap = new Map();
        [...operatorsFromTable, ...operatorsFromBindings, ...operatorsFromTasks].forEach(o => {
            if (!operatorsMap.has(o.user_id)) {
                operatorsMap.set(o.user_id, {
                    user_id: o.user_id,
                    operator_id: o.operator_id || null,
                    telegram_chat_id: o.telegram_chat_id,
                    fullname: o.fullname,
                    username: o.username
                });
            }
        });
        
        const operators = Array.from(operatorsMap.values());
        
        log.info(`[ASSIGN_OPERATOR] 1.3. Birlashtirilgan operatorlar (dublikatsiz): ${operators.length} ta`, 
            operators.map(o => ({ 
                user_id: o.user_id, 
                fullname: o.fullname,
                telegram_chat_id: o.telegram_chat_id ? 'mavjud' : 'yo\'q'
            }))
        );
        
        if (operators.length === 0) {
            log.warn(`[ASSIGN_OPERATOR] ❌ Hech qanday faol operator topilmadi: brandId=${brandId}`);
            return null;
        }
        
        // 2. Har bir operatorning ishlatilish sonini hisoblash
        log.debug(`[ASSIGN_OPERATOR] 2. Operatorlarning ishlatilish sonini hisoblash: brandId=${brandId}`);
        const operatorUsage = await db('debt_requests')
            .where('brand_id', brandId)
            .whereNotNull('current_approver_id')
            .where('current_approver_type', 'operator')
            .where('status', '!=', 'cancelled')
            .groupBy('current_approver_id')
            .select('current_approver_id')
            .count('* as usage_count');
        
        log.debug(`[ASSIGN_OPERATOR] 2.1. Operatorlarning ishlatilish soni: ${operatorUsage.length} ta`, 
            operatorUsage.map(u => ({ 
                user_id: u.current_approver_id, 
                usage_count: u.usage_count 
            }))
        );
        
        // Usage map yaratish
        const usageMap = new Map();
        operatorUsage.forEach(item => {
            usageMap.set(item.current_approver_id, parseInt(item.usage_count));
        });
        
        // 3. Eng kam ishlatilgan operatorni tanlash
        log.debug(`[ASSIGN_OPERATOR] 3. Eng kam ishlatilgan operatorni tanlash boshlanmoqda`);
        let selectedOperator = null;
        let minUsage = Infinity;
        let oldestAssignment = null;
        
        for (const operator of operators) {
            const usage = usageMap.get(operator.user_id) || 0;
            log.debug(`[ASSIGN_OPERATOR] 3.1. Operator: ${operator.fullname} (ID: ${operator.user_id}), Usage: ${usage}, MinUsage: ${minUsage}`);
            
            if (usage < minUsage) {
                minUsage = usage;
                selectedOperator = operator;
                oldestAssignment = null;
                log.debug(`[ASSIGN_OPERATOR] 3.2. Yangi eng kam ishlatilgan: ${operator.fullname} (Usage: ${usage})`);
            } else if (usage === minUsage) {
                if (!oldestAssignment) {
                    oldestAssignment = await db('debt_operators')
                        .where('user_id', selectedOperator.user_id)
                        .where('brand_id', brandId)
                        .first();
                }
                
                const currentAssignment = await db('debt_operators')
                    .where('user_id', operator.user_id)
                    .where('brand_id', brandId)
                    .first();
                
                if (currentAssignment && oldestAssignment) {
                    if (new Date(currentAssignment.assigned_at) < new Date(oldestAssignment.assigned_at)) {
                        selectedOperator = operator;
                        oldestAssignment = currentAssignment;
                    }
                } else if (currentAssignment) {
                    selectedOperator = operator;
                    oldestAssignment = currentAssignment;
                }
            }
        }
        
        if (!selectedOperator) {
            selectedOperator = operators[0];
            log.warn(`[ASSIGN_OPERATOR] 3.3. Hech qanday tanlov bo'lmadi, birinchi operator tanlandi: ${selectedOperator.fullname} (ID: ${selectedOperator.user_id})`);
        }
        
        log.info(`[ASSIGN_OPERATOR] 3.4. Tanlangan operator: ${selectedOperator.fullname} (ID: ${selectedOperator.user_id}), Usage: ${minUsage}, TelegramChatId: ${selectedOperator.telegram_chat_id ? 'mavjud' : 'yo\'q'}`);
        
        // 4. So'rovga operatorni biriktirish
        log.debug(`[ASSIGN_OPERATOR] 4. So'rovga operator biriktirilmoqda: requestId=${requestId}, operatorId=${selectedOperator.user_id}`);
        await db('debt_requests')
            .where('id', requestId)
            .update({
                current_approver_id: selectedOperator.user_id,
                current_approver_type: 'operator'
            });
        
        log.info(`[ASSIGN_OPERATOR] ✅ Operator muvaffaqiyatli tayinlandi: requestId=${requestId}, brandId=${brandId}, operatorId=${selectedOperator.user_id}, operatorName=${selectedOperator.fullname}, usage=${minUsage}`);
        
        return selectedOperator;
    } catch (error) {
        log.error(`[ASSIGN_OPERATOR] ❌ Operator tayinlashda xatolik: brandId=${brandId}, requestId=${requestId}, Error=${error.message}`, error);
        throw error;
    }
}

module.exports = {
    assignCashierToRequest,
    assignOperatorToRequest
};

