/**
 * User Permissions Utility
 * Foydalanuvchi permission'larini olish uchun markaziy funksiyalar
 */

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('USER_PERMISSIONS');

/**
 * Foydalanuvchining barcha permission'larini olish
 * @param {number} userId - Foydalanuvchi ID
 * @returns {Promise<Array<string>>} - Permission key'lar ro'yxati
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
 * @param {number} userId - Foydalanuvchi ID
 * @param {string} permissionKey - Permission key
 * @returns {Promise<boolean>} - Permission bor yoki yo'q
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
 * @param {number} userId - Foydalanuvchi ID
 * @param {Array<string>} permissionKeys - Permission key'lar ro'yxati
 * @returns {Promise<boolean>} - Hech bo'lmaganda bitta permission bor yoki yo'q
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
 * Foydalanuvchida barcha permission'lar bormi tekshirish
 * @param {number} userId - Foydalanuvchi ID
 * @param {Array<string>} permissionKeys - Permission key'lar ro'yxati
 * @returns {Promise<boolean>} - Barcha permission'lar bor yoki yo'q
 */
async function hasAllPermissions(userId, permissionKeys) {
    if (!userId || !permissionKeys || !Array.isArray(permissionKeys)) return false;
    
    try {
        const permissions = await getUserPermissions(userId);
        return permissionKeys.every(key => permissions.includes(key));
    } catch (error) {
        log.error('hasAllPermissions xatolik:', error);
        return false;
    }
}

module.exports = {
    getUserPermissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions
};

