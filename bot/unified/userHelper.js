// bot/unified/userHelper.js
// Unified User Helper - telegram_chat_id va telegram_id conflict'ini hal qilish

const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');

const log = createLogger('USER_HELPER');

/**
 * Telegram orqali foydalanuvchini topish
 * Avval telegram_chat_id orqali, keyin userId orqali qidiradi
 */
async function getUserByTelegram(chatId, userId) {
    try {
        // 1. Avval telegram_chat_id orqali qidirish (asosiy usul - shaxsiy chat uchun)
        let user = await db('users').where({ telegram_chat_id: chatId }).first();
        
        if (user) {
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
                    return user;
                }
            } else {
                // Agar chatId va userId bir xil bo'lsa, bu oddiy holat
                if (chatId === userId) {
                    user = await db('users').where({ telegram_chat_id: userId }).first();
                    
                    if (user) {
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
    DEBT_APPROVAL_ROLES,
    ADMIN_ROLES
};

