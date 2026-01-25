// bot/unified/userHelper.js
// Unified User Helper - telegram_chat_id va telegram_id conflict'ini hal qilish

const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const cacheManager = require('../../utils/cacheManager.js');
const { getUserPermissions: getUserPermissionsUtil, hasPermission: hasPermissionUtil, hasAnyPermission: hasAnyPermissionUtil } = require('../../utils/userPermissions.js');

const log = createLogger('USER_HELPER');

/**
 * Telegram orqali foydalanuvchini topish
 * Avval telegram_chat_id orqali, keyin userId orqali qidiradi
 * Cache bilan optimallashtirilgan
 */
async function getUserByTelegram(chatId, userId) {
    try {
        // Cache key'lar:
        // - lookupKey: telegram chat/user -> internal DB userId mapping (tezkor)
        // - userKey: internal DB userId -> user object (clearUserCache(userId) bilan tozalanadi)
        const lookupKey = `tg_lookup_${chatId}_${userId}`;
        
        // 0) Agar mapping cache mavjud bo'lsa, avval userKey orqali qaytarishga harakat qilamiz
        const cachedDbId = cacheManager.get('users', lookupKey);
        if (cachedDbId) {
            const userKey = `user_${cachedDbId}`;
            const cachedUser = cacheManager.get('users', userKey);
            if (cachedUser) {
                return cachedUser;
            }
            // Agar userKey cache yo'q bo'lsa (invalidation bo'lgan), DB'dan ID bo'yicha olib yangilaymiz
            const userById = await db('users').where({ id: cachedDbId }).first();
            if (userById) {
                cacheManager.set('users', userKey, userById, 5 * 60 * 1000);
                return userById;
            }
        }
        
        // 1. Avval telegram_chat_id orqali qidirish (asosiy usul - shaxsiy chat uchun)
        let user = await db('users').where({ telegram_chat_id: chatId }).first();
        
        if (user) {
            // Cache'ga saqlash
            cacheManager.set('users', lookupKey, user.id, 5 * 60 * 1000);
            cacheManager.set('users', `user_${user.id}`, user, 5 * 60 * 1000);
            return user;
        }
        
        // 2. Agar chatId guruh ID'si bo'lsa (manfiy raqam), userId orqali qidirish
        // Guruhda callback query kelganda, chatId guruh ID'si bo'lib qoladi
        // Lekin userId foydalanuvchi Telegram user ID'si
        // Database'da telegram_chat_id foydalanuvchi shaxsiy chat ID'si bo'lgani uchun,
        // userId va telegram_chat_id bir xil bo'lishi mumkin (shaxsiy chat uchun)
        if (!user && userId) {
            // Agar chatId guruh ID'si bo'lsa (manfiy raqam), userId orqali qidirish
            if (chatId < 0) {
                // Guruh ID'si - userId orqali qidirish
                // Lekin userId bu Telegram user ID, database'da esa telegram_chat_id saqlanadi
                // Shaxsiy chat uchun userId va telegram_chat_id bir xil bo'lishi mumkin
                user = await db('users').where({ telegram_chat_id: userId }).first();
                
                if (user) {
                    // Cache'ga saqlash
                    cacheManager.set('users', lookupKey, user.id, 5 * 60 * 1000);
                    cacheManager.set('users', `user_${user.id}`, user, 5 * 60 * 1000);
                    return user;
                }
            } else {
                // Agar chatId va userId bir xil bo'lsa, bu oddiy holat
                if (chatId === userId) {
                    user = await db('users').where({ telegram_chat_id: userId }).first();
                    
                    if (user) {
                        // Cache'ga saqlash
                        cacheManager.set('users', lookupKey, user.id, 5 * 60 * 1000);
                        cacheManager.set('users', `user_${user.id}`, user, 5 * 60 * 1000);
                        return user;
                    }
                }
            }
            
        }
        
        return null;
    } catch (error) {
        log.error('getUserByTelegram xatolik:', error);
        return null;
    }
}

/**
 * Foydalanuvchi rolini tekshirish
 */
function hasRole(user, roles) {
    if (!user || !user.role) return false;
    
    const userRole = user.role.toLowerCase();
    const roleArray = Array.isArray(roles) ? roles : [roles];
    
    return roleArray.some(role => role.toLowerCase() === userRole);
}

/**
 * Foydalanuvchi statusini tekshirish
 */
function hasStatus(user, status) {
    if (!user || !user.status) return false;
    return user.status.toLowerCase() === status.toLowerCase();
}

/**
 * Foydalanuvchi faolmi tekshirish
 */
function isActive(user) {
    return hasStatus(user, 'active');
}

/**
 * Foydalanuvchi tasdiqlanishini kutmoqdami tekshirish
 */
function isPending(user) {
    return hasStatus(user, 'pending_approval') || 
           hasStatus(user, 'pending_telegram_subscription');
}

/**
 * Debt-approval rollari
 */
const DEBT_APPROVAL_ROLES = ['manager', 'leader', 'cashier', 'operator'];

/**
 * Admin rollari
 */
const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * Debt-approval foydalanuvchisimi tekshirish
 */
function isDebtApprovalUser(user) {
    return hasRole(user, DEBT_APPROVAL_ROLES);
}

/**
 * Admin foydalanuvchisimi tekshirish
 */
function isAdminUser(user) {
    return hasRole(user, ADMIN_ROLES);
}

/**
 * Foydalanuvchining barcha permission'larini olish
 * @deprecated utils/userPermissions.js dan import qiling
 */
async function getUserPermissions(userId) {
    return getUserPermissionsUtil(userId);
}

/**
 * Foydalanuvchida permission bormi tekshirish
 * @deprecated utils/userPermissions.js dan import qiling
 */
async function hasPermission(userId, permissionKey) {
    return hasPermissionUtil(userId, permissionKey);
}

/**
 * Foydalanuvchida permission'lardan bittasi bormi tekshirish
 * @deprecated utils/userPermissions.js dan import qiling
 */
async function hasAnyPermission(userId, permissionKeys) {
    return hasAnyPermissionUtil(userId, permissionKeys);
}

/**
 * Rol ko'rsatish nomlari
 */
const ROLE_DISPLAY_NAMES = {
    'manager': 'Menejer',
    'cashier': 'Kassir',
    'operator': 'Operator',
    'leader': 'Rahbar',
    'supervisor': 'Nazoratchi'
};

/**
 * Foydalanuvchining debt_user_tasks jadvalidan vazifalarini olish
 */
async function getUserTasks(userId) {
    try {
        const tasks = await db('debt_user_tasks')
            .where('user_id', userId)
            .select('task_type', 'brand_id', 'branch_id', 'svr_id');
        
        return tasks;
    } catch (error) {
        log.error('getUserTasks xatolik:', error);
        return [];
    }
}

/**
 * Vazifalardan rollarni olish
 */
async function getUserRolesFromTasks(userId) {
    const tasks = await getUserTasks(userId);
    
    // Task type'larni role'ga o'tkazish
    const taskRoleMap = {
        'create': 'manager',
        'debt:create': 'manager',
        'approve_cashier': 'cashier',
        'debt:approve_cashier': 'cashier',
        'approve_operator': 'operator',
        'debt:approve_operator': 'operator',
        'approve_leader': 'leader',
        'debt:approve_leader': 'leader',
        'approve_supervisor_cashier': 'supervisor',
        'approve_supervisor_operator': 'supervisor'
    };
    
    const roles = [...new Set(tasks.map(t => taskRoleMap[t.task_type] || null).filter(Boolean))];
    return roles;
}

/**
 * Tanlangan rolni olish (state'dan)
 */
function getSelectedRole(userId) {
    const stateManager = require('./stateManager.js');
    const state = stateManager.getUserState(userId);
    return state?.data?.selectedRole || null;
}

/**
 * Faqat manager va cashier rollari bo'lsa tekshirish (rol tanlash uchun)
 * Agar manager va cashier ikkalasi ham mavjud bo'lsa, boshqa rollar bo'lsa ham true qaytaradi
 */
function shouldShowRoleSelection(userRoles) {
    if (!userRoles || userRoles.length === 0) {
        return false;
    }
    
    // Agar manager va cashier ikkalasi ham mavjud bo'lsa, true qaytaradi
    // Boshqa rollar (operator, leader, supervisor) bo'lsa ham bo'ladi
    const hasManager = userRoles.includes('manager');
    const hasCashier = userRoles.includes('cashier');
    
    return hasManager && hasCashier;
}

/**
 * Rol tanlash uchun faqat manager va cashier rollarini olish
 */
function getRolesForSelection(userRoles) {
    if (!userRoles || userRoles.length === 0) {
        return [];
    }
    
    // Faqat manager va cashier rollarini qaytarish
    return userRoles.filter(role => role === 'manager' || role === 'cashier');
}

/**
 * Guruh roli ni aniqlash (guruh ID'si bo'yicha)
 */
async function getGroupRoleByChatId(chatId) {
    try {
        const leadersGroup = await db('debt_groups')
            .where('group_type', 'leaders')
            .where('is_active', true)
            .first();
        
        if (leadersGroup && leadersGroup.telegram_group_id === chatId) {
            return 'leader';
        }
        
        const operatorsGroup = await db('debt_groups')
            .where('group_type', 'operators')
            .where('is_active', true)
            .first();
        
        if (operatorsGroup && operatorsGroup.telegram_group_id === chatId) {
            return 'operator';
        }
        
        return null;
    } catch (error) {
        log.error('getGroupRoleByChatId xatolik:', error);
        return null;
    }
}

module.exports = {
    getUserByTelegram,
    hasRole,
    hasStatus,
    isActive,
    isPending,
    isDebtApprovalUser,
    isAdminUser,
    getUserPermissions,
    hasPermission,
    hasAnyPermission,
    getUserTasks,
    getUserRolesFromTasks,
    getSelectedRole,
    shouldShowRoleSelection,
    getRolesForSelection,
    getGroupRoleByChatId,
    ROLE_DISPLAY_NAMES,
    DEBT_APPROVAL_ROLES,
    ADMIN_ROLES
};

