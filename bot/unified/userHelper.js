// bot/unified/userHelper.js
// Unified User Helper - telegram_chat_id va telegram_id conflict'ini hal qilish

const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const cacheManager = require('../../utils/cacheManager.js');

const log = createLogger('USER_HELPER');

/**
 * Telegram orqali foydalanuvchini topish
 * Avval telegram_chat_id orqali, keyin userId orqali qidiradi
 * Cache bilan optimallashtirilgan
 */
async function getUserByTelegram(chatId, userId) {
    try {
        // Cache key
        const cacheKey = `user_${chatId}_${userId}`;
        
        // Cache'dan olish (5 daqiqa)
        const cached = cacheManager.get('users', cacheKey);
        if (cached) {
            return cached;
        }
        
        // 1. Avval telegram_chat_id orqali qidirish (asosiy usul - shaxsiy chat uchun)
        let user = await db('users').where({ telegram_chat_id: chatId }).first();
        
        if (user) {
            // Cache'ga saqlash
            cacheManager.set('users', cacheKey, user, 5 * 60 * 1000);
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
                    cacheManager.set('users', cacheKey, user, 5 * 60 * 1000);
                    return user;
                }
            } else {
                // Agar chatId va userId bir xil bo'lsa, bu oddiy holat
                if (chatId === userId) {
                    user = await db('users').where({ telegram_chat_id: userId }).first();
                    
                    if (user) {
                        // Cache'ga saqlash
                        cacheManager.set('users', cacheKey, user, 5 * 60 * 1000);
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
 */
async function getUserPermissions(userId) {
    try {
        const user = await db('users').where('id', userId).first();
        if (!user) {
            log.debug(`[getUserPermissions] User not found: userId=${userId}`);
            return [];
        }
        
        // Role-based permissions
        const rolePermissions = await db('role_permissions as rp')
            .join('permissions as p', 'rp.permission_key', 'p.permission_key')
            .where('rp.role_name', user.role)
            .select('p.permission_key');
        
        const permissions = rolePermissions.map(rp => rp.permission_key);
        
        // User-specific permissions (additional)
        const hasUserPermissionsTable = await db.schema.hasTable('user_permissions');
        if (hasUserPermissionsTable) {
            const userPermissions = await db('user_permissions as up')
                .join('permissions as p', 'up.permission_key', 'p.permission_key')
                .where('up.user_id', userId)
                .where('up.type', 'additional')
                .select('p.permission_key');
            
            userPermissions.forEach(up => {
                if (!permissions.includes(up.permission_key)) {
                    permissions.push(up.permission_key);
                }
            });
            
            // Restricted permissions'ni olib tashlash
            const restrictedPermissions = await db('user_permissions as up')
                .where('up.user_id', userId)
                .where('up.type', 'restricted')
                .select('up.permission_key');
            
            restrictedPermissions.forEach(rp => {
                const index = permissions.indexOf(rp.permission_key);
                if (index > -1) {
                    permissions.splice(index, 1);
                }
            });
        }
        
        return permissions;
    } catch (error) {
        log.error('getUserPermissions xatolik:', error);
        return [];
    }
}

/**
 * Foydalanuvchida permission bormi tekshirish
 */
async function hasPermission(userId, permissionKey) {
    if (!userId || !permissionKey) return false;
    
    try {
        const permissions = await getUserPermissions(userId);
        return permissions.includes(permissionKey);
    } catch (error) {
        log.error('hasPermission xatolik:', error);
        return false;
    }
}

/**
 * Foydalanuvchida permission'lardan bittasi bormi tekshirish
 */
async function hasAnyPermission(userId, permissionKeys) {
    if (!userId || !permissionKeys || !Array.isArray(permissionKeys)) return false;
    
    try {
        const permissions = await getUserPermissions(userId);
        return permissionKeys.some(key => permissions.includes(key));
    } catch (error) {
        log.error('hasAnyPermission xatolik:', error);
        return false;
    }
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

