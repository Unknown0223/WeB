// utils/debtAccessFilter.js
// Qarzdorlik Tasdiqlash - Foydalanuvchi dostup filtrlash

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('DEBT_ACCESS_FILTER');

/**
 * Foydalanuvchiga ruxsat berilgan brendlar ro'yxatini olish
 * Avval foydalanuvchiga biriktirilganlar, keyin rol shartlari tekshiriladi
 * @param {Object} user - Foydalanuvchi ma'lumotlari (session.user yoki user object)
 * @returns {Promise<number[]>} - Ruxsat berilgan brendlar ID ro'yxati
 */
async function getAllowedDebtBrands(user) {
    try {
        if (!user || !user.id) {
            log.warn('getAllowedDebtBrands: User yoki user.id mavjud emas');
            return [];
        }
        
        // 1. Foydalanuvchiga biriktirilgan brendlar
        const userBrands = await db('debt_user_brands')
            .where('user_id', user.id)
            .pluck('brand_id');
        
        // 2. Rol shartlari
        const roleBrands = await db('debt_role_brands')
            .where('role_name', user.role)
            .pluck('debt_brand_id');
        
        // 3. Birlashtirish (unique)
        const allowedBrands = [...new Set([...userBrands, ...roleBrands])];
        
        // 4. Agar hech qanday cheklov yo'q bo'lsa (barcha brendlar ruxsat berilgan)
        // Bu holatda bo'sh array qaytaramiz (barcha brendlar ko'rsatiladi)
        if (allowedBrands.length === 0 && userBrands.length === 0 && roleBrands.length === 0) {
            // Hech qanday cheklov yo'q - barcha brendlar ruxsat berilgan
            return null; // null = barcha brendlar
        }
        
        return allowedBrands;
    } catch (error) {
        log.error('getAllowedDebtBrands xatolik:', error);
        return [];
    }
}

/**
 * Foydalanuvchiga ruxsat berilgan filiallar ro'yxatini olish
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {number|null} brandId - Brend ID (agar belgilangan bo'lsa, faqat shu brenddagi filiallar)
 * @returns {Promise<number[]>} - Ruxsat berilgan filiallar ID ro'yxati
 */
async function getAllowedDebtBranches(user, brandId = null) {
    try {
        if (!user || !user.id) {
            log.warn('getAllowedDebtBranches: User yoki user.id mavjud emas');
            return [];
        }
        
        // 1. Foydalanuvchiga biriktirilgan filiallar
        let userBranchIds = [];
        if (brandId) {
            // Agar brandId bo'lsa, join qilish kerak
            const userBranchesRows = await db('debt_user_branches')
                .join('debt_branches', 'debt_user_branches.branch_id', 'debt_branches.id')
                .where('debt_user_branches.user_id', user.id)
                .where('debt_branches.brand_id', brandId)
                .select('debt_user_branches.branch_id');
            userBranchIds = userBranchesRows.map(r => r.branch_id);
        } else {
            // Agar brandId bo'lmasa, oddiy pluck
            userBranchIds = await db('debt_user_branches')
                .where('user_id', user.id)
                .pluck('branch_id');
        }
        
        // 2. Rol shartlari
        let roleBranchIds = [];
        if (brandId) {
            // Agar brandId bo'lsa, join qilish kerak
            const roleBranchesRows = await db('debt_role_branches')
                .join('debt_branches', 'debt_role_branches.debt_branch_id', 'debt_branches.id')
                .where('debt_role_branches.role_name', user.role)
                .where('debt_branches.brand_id', brandId)
                .select('debt_role_branches.debt_branch_id');
            roleBranchIds = roleBranchesRows.map(r => r.debt_branch_id);
        } else {
            // Agar brandId bo'lmasa, oddiy pluck
            roleBranchIds = await db('debt_role_branches')
                .where('role_name', user.role)
                .pluck('debt_branch_id');
        }
        
        // 3. Birlashtirish (unique)
        const allowedBranches = [...new Set([...userBranchIds, ...roleBranchIds])];
        
        
        if (userBranchIds.length > 0) {
            log.debug(`[DEBT_ACCESS_FILTER] User branch IDs: ${userBranchIds.join(', ')}`);
        }
        if (roleBranchIds.length > 0) {
            log.debug(`[DEBT_ACCESS_FILTER] Role branch IDs: ${roleBranchIds.join(', ')}`);
        }
        
        // Dublikat ID'larni tekshirish
        const allIds = [...userBranchIds, ...roleBranchIds];
        const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
        if (duplicateIds.length > 0) {
            log.warn(`[DEBT_ACCESS_FILTER] ⚠️ Dublikat branch ID'lar topildi (birlashtirishdan oldin): ${[...new Set(duplicateIds)].join(', ')}`);
        }
        
        // 4. Agar hech qanday cheklov yo'q bo'lsa
        if (allowedBranches.length === 0 && userBranchIds.length === 0 && roleBranchIds.length === 0) {
            // Agar brandId belgilangan bo'lsa, faqat shu brenddagi filiallarni qaytaramiz
            if (brandId) {
                const branchesForBrand = await db('debt_branches')
                    .where('brand_id', brandId)
                    .pluck('id');
                return branchesForBrand.length > 0 ? branchesForBrand : null;
            }
            log.debug(`[DEBT_ACCESS_FILTER] Hech qanday cheklov yo'q, barcha filiallar ruxsat berilgan (null qaytaramiz)`);
            return null; // null = barcha filiallar
        }
        
        log.debug(`[DEBT_ACCESS_FILTER] ✅ Ruxsat berilgan filiallar: ${allowedBranches.length} ta, ID'lar: ${allowedBranches.join(', ')}`);
        return allowedBranches;
    } catch (error) {
        log.error('getAllowedDebtBranches xatolik:', error);
        return [];
    }
}

/**
 * Foydalanuvchiga ruxsat berilgan SVR'lar ro'yxatini olish
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {number|null} brandId - Brend ID
 * @param {number|null} branchId - Filial ID
 * @returns {Promise<number[]>} - Ruxsat berilgan SVR'lar ID ro'yxati
 */
async function getAllowedDebtSVRs(user, brandId = null, branchId = null) {
    try {
        if (!user || !user.id) {
            log.warn('getAllowedDebtSVRs: User yoki user.id mavjud emas');
            return [];
        }
        
        // 1. Rol shartlari (SVR'lar uchun)
        let roleSVRIds = [];
        if (brandId || branchId) {
            // Agar brandId yoki branchId bo'lsa, join qilish kerak
            let roleSVRsQuery = db('debt_role_svrs')
                .join('debt_svrs', 'debt_role_svrs.debt_svr_id', 'debt_svrs.id')
                .where('debt_role_svrs.role_name', user.role);
            
            if (brandId) {
                roleSVRsQuery = roleSVRsQuery.where('debt_svrs.brand_id', brandId);
            }
            if (branchId) {
                roleSVRsQuery = roleSVRsQuery.where('debt_svrs.branch_id', branchId);
            }
            
            const roleSVRsRows = await roleSVRsQuery.select('debt_role_svrs.debt_svr_id');
            roleSVRIds = roleSVRsRows.map(r => r.debt_svr_id);
        } else {
            // Agar brandId va branchId bo'lmasa, oddiy pluck
            roleSVRIds = await db('debt_role_svrs')
                .where('role_name', user.role)
                .pluck('debt_svr_id');
        }
        
        // 2. Agar SVR'lar uchun alohida cheklov yo'q bo'lsa,
        // brend va filial bo'yicha filtrlash
        if (roleSVRIds.length === 0) {
            // Brend va filial bo'yicha filtrlash
            let svrsQuery = db('debt_svrs');
            
            if (brandId) {
                svrsQuery = svrsQuery.where('brand_id', brandId);
            }
            
            if (branchId) {
                svrsQuery = svrsQuery.where('branch_id', branchId);
            }
            
            const svrs = await svrsQuery.pluck('id');
            return svrs.length > 0 ? svrs : null;
        }
        
        return roleSVRIds;
    } catch (error) {
        log.error('getAllowedDebtSVRs xatolik:', error);
        return [];
    }
}

/**
 * Foydalanuvchiga ruxsat berilgan brendlar ro'yxatini olish (to'liq ma'lumotlar bilan)
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @returns {Promise<Array>} - Ruxsat berilgan brendlar ro'yxati (id, name)
 */
async function getAllowedDebtBrandsList(user) {
    try {
        const allowedBrandIds = await getAllowedDebtBrands(user);
        
        if (allowedBrandIds === null) {
            // Barcha brendlar
            return await db('debt_brands').select('id', 'name').orderBy('name');
        }
        
        if (allowedBrandIds.length === 0) {
            return [];
        }
        
        return await db('debt_brands')
            .whereIn('id', allowedBrandIds)
            .select('id', 'name')
            .orderBy('name');
    } catch (error) {
        log.error('getAllowedDebtBrandsList xatolik:', error);
        return [];
    }
}

/**
 * Foydalanuvchiga ruxsat berilgan filiallar ro'yxatini olish (to'liq ma'lumotlar bilan)
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {number|null} brandId - Brend ID
 * @returns {Promise<Array>} - Ruxsat berilgan filiallar ro'yxati (id, name, brand_id)
 */
async function getAllowedDebtBranchesList(user, brandId = null) {
    try {
        const allowedBranchIds = await getAllowedDebtBranches(user, brandId);
        
        
        let branches;
        
        if (allowedBranchIds === null) {
            // Barcha filiallar (yoki brandId bo'yicha)
            let query = db('debt_branches');
            if (brandId) {
                query = query.where('brand_id', brandId);
            }
            branches = await query.select('id', 'name', 'brand_id').orderBy('name');
        } else if (allowedBranchIds.length === 0) {
            return [];
        } else {
            let query = db('debt_branches')
                .whereIn('id', allowedBranchIds);
            
            if (brandId) {
                query = query.where('brand_id', brandId);
            }
            
            branches = await query.select('id', 'name', 'brand_id').orderBy('name');
        }
        
        // Dublikatlarni olib tashlash (ID bo'yicha) - Utility funksiya ishlatiladi
        const { removeDuplicatesById } = require('./arrayUtils.js');
        
        const uniqueBranches = removeDuplicatesById(branches, 'id', {
            warnOnDuplicate: true,
            context: 'DEBT_ACCESS_FILTER'
        });
        
        return uniqueBranches;
    } catch (error) {
        log.error('getAllowedDebtBranchesList xatolik:', error);
        return [];
    }
}

/**
 * Foydalanuvchiga ruxsat berilgan SVR'lar ro'yxatini olish (to'liq ma'lumotlar bilan)
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {number|null} brandId - Brend ID
 * @param {number|null} branchId - Filial ID
 * @returns {Promise<Array>} - Ruxsat berilgan SVR'lar ro'yxati (id, name, brand_id, branch_id)
 */
async function getAllowedDebtSVRsList(user, brandId = null, branchId = null) {
    try {
        const allowedSVRIds = await getAllowedDebtSVRs(user, brandId, branchId);
        
        if (allowedSVRIds === null) {
            // Barcha SVR'lar (yoki brandId/branchId bo'yicha)
            let query = db('debt_svrs');
            if (brandId) {
                query = query.where('brand_id', brandId);
            }
            if (branchId) {
                query = query.where('branch_id', branchId);
            }
            return await query.select('id', 'name', 'brand_id', 'branch_id').orderBy('name');
        }
        
        if (allowedSVRIds.length === 0) {
            return [];
        }
        
        let query = db('debt_svrs')
            .whereIn('id', allowedSVRIds);
        
        if (brandId) {
            query = query.where('brand_id', brandId);
        }
        
        if (branchId) {
            query = query.where('branch_id', branchId);
        }
        
        return await query.select('id', 'name', 'brand_id', 'branch_id').orderBy('name');
    } catch (error) {
        log.error('getAllowedDebtSVRsList xatolik:', error);
        return [];
    }
}

/**
 * So'rov uchun tegishli nazoratchilarni olish
 * @param {number} requestId - So'rov ID
 * @param {number} brandId - Brend ID
 * @param {number} branchId - Filial ID
 * @returns {Promise<Array>} - Nazoratchilar ro'yxati (id, username, fullname, telegram_chat_id)
 */
async function getSupervisorsForRequest(requestId, brandId, branchId) {
    try {
        // 1. `debt:approve_supervisor` permission'iga ega bo'lgan foydalanuvchilarni olish
        const supervisors = await db('users')
            .join('role_permissions', 'users.role', 'role_permissions.role_name')
            .join('permissions', 'role_permissions.permission_key', 'permissions.permission_key')
            .where('permissions.permission_key', 'debt:approve_supervisor')
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id')
            .select('users.id', 'users.username', 'users.fullname', 'users.telegram_chat_id', 'users.role')
            .distinct();
        
        // 2. Brend va filial bo'yicha filter qilish
        const filteredSupervisors = [];
        
        for (const supervisor of supervisors) {
            // Foydalanuvchiga biriktirilgan brendlar va filiallar
            const userBrands = await db('debt_user_brands')
                .where('user_id', supervisor.id)
                .pluck('brand_id');
            
            const userBranches = await db('debt_user_branches')
                .where('user_id', supervisor.id)
                .pluck('branch_id');
            
            // Rolga biriktirilgan brendlar va filiallar
            const roleBrands = await db('debt_role_brands')
                .where('role_name', supervisor.role)
                .pluck('debt_brand_id');
            
            const roleBranches = await db('debt_role_branches')
                .where('role_name', supervisor.role)
                .pluck('debt_branch_id');
            
            // Birlashtirish
            const allowedBrands = [...new Set([...userBrands, ...roleBrands])];
            const allowedBranches = [...new Set([...userBranches, ...roleBranches])];
            
            // Agar hech qanday cheklov yo'q bo'lsa (barcha brendlar/filiallar ruxsat berilgan)
            const hasBrandAccess = allowedBrands.length === 0 || allowedBrands.includes(brandId);
            const hasBranchAccess = allowedBranches.length === 0 || allowedBranches.includes(branchId);
            
            if (hasBrandAccess && hasBranchAccess) {
                filteredSupervisors.push(supervisor);
            }
        }
        
        return filteredSupervisors;
    } catch (error) {
        log.error('getSupervisorsForRequest xatolik:', error);
        return [];
    }
}

module.exports = {
    getAllowedDebtBrands,
    getAllowedDebtBranches,
    getAllowedDebtSVRs,
    getAllowedDebtBrandsList,
    getAllowedDebtBranchesList,
    getAllowedDebtSVRsList,
    getSupervisorsForRequest
};

