const { db, logAction } = require('../db.js');
const bcrypt = require('bcrypt');
const cacheManager = require('../utils/cacheManager.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('USER_REPO');

const saltRounds = 10;
const PERMISSIONS_NAMESPACE = 'permissions';
const LOCATIONS_NAMESPACE = 'locations';
const CACHE_TTL = 2 * 60 * 1000; // 2 daqiqa (qisqartirildi)

// --- QIDIRISH FUNKSIYALARI (READ) ---

async function findByUsername(username) {
    const trimmedUsername = username.trim();
    
    // Avval to'g'ridan-to'g'ri qidiruv
    let user = await db('users')
        .where('username', trimmedUsername)
        .first();
    
    if (user) return user;
    
    // Agar topilmasa, case-insensitive qidiruv
    user = await db('users')
        .whereRaw('LOWER(TRIM(username)) = LOWER(?)', [trimmedUsername])
        .first();
    
    return user;
}

async function findById(id, withDetails = false) {
    const user = await db('users').where({ id: id }).first();
    if (!user || !withDetails) {
        return user;
    }

    const [locations, sessions] = await Promise.all([
        getLocationsByUserId(id),
        db('sessions').where('sess', 'like', `%"id":${id}%`)
    ]);
    
    return {
        ...user,
        locations: locations,
        is_online: sessions.length > 0,
        active_sessions_count: sessions.length
    };
}


// Cache - sessions parsing (2 daqiqa)
let sessionsCache = null;
let sessionsCacheTime = 0;
const SESSIONS_CACHE_TTL = 2 * 60 * 1000; // 2 daqiqa (qisqartirildi)

async function getAllUsersWithDetails() {
    // Parallel so'rovlar - tezlashtirish
    const [users, roleRequirements, userLocations, userBrands, roleLocations, roleBrands, brands] = await Promise.all([
        db('users as u')
            .leftJoin('user_locations as ul', 'u.id', 'ul.user_id')
            .select(
                'u.id', 'u.username', 'u.fullname', 'u.role', 'u.status', 'u.device_limit',
                'u.telegram_chat_id', 'u.telegram_username', 'u.created_at', 'u.updated_at',
                'u.is_telegram_connected', 'u.avatar_url', 'u.preferred_currency'
            )
            .groupBy('u.id')
            .orderBy('u.username')
            .select(db.raw("GROUP_CONCAT(ul.location_name) as locations")),
        db('roles').select('role_name', 'requires_locations', 'requires_brands'),
        db('user_locations').select('user_id', 'location_name'),
        db('user_brands').select('user_id', 'brand_id'),
        db('role_locations').select('role_name', 'location_name'),
        db('role_brands').select('role_name', 'brand_id'),
        db('brands').select('id', 'name')
    ]);

    // Sessions cache - faqat kerakli ma'lumotlarni parse qilish
    const now = Date.now();
    if (!sessionsCache || (now - sessionsCacheTime) > SESSIONS_CACHE_TTL) {
        const sessions = await db('sessions').select('sess');
        // Faqat user ID'larni extract qilish (to'liq parse qilmasdan)
        sessionsCache = new Map();
        sessions.forEach(s => {
            try {
                // Faqat user ID'ni topish (to'liq parse qilmasdan)
                const match = s.sess.match(/"id":(\d+)/);
                if (match) {
                    const userId = parseInt(match[1]);
                    sessionsCache.set(userId, (sessionsCache.get(userId) || 0) + 1);
                }
            } catch (e) {
                // Xatolikni e'tiborsiz qoldirish
            }
        });
        sessionsCacheTime = now;
    }
    
    // Role requirements map
    const roleRequirementsMap = {};
    roleRequirements.forEach(role => {
        const isLocationsFalse = role.requires_locations === false || role.requires_locations === null || role.requires_locations === undefined;
        const isBrandsFalse = role.requires_brands === false || role.requires_brands === null || role.requires_brands === undefined;
        roleRequirementsMap[role.role_name] = {
            hasNoAccess: isLocationsFalse && isBrandsFalse,
            requires_locations: role.requires_locations,
            requires_brands: role.requires_brands
        };
    });
    
    // Brands map
    const brandsMap = {};
    brands.forEach(brand => {
        brandsMap[brand.id] = brand.name;
    });
    
    // User locations map
    const userLocationsMap = {};
    userLocations.forEach(ul => {
        if (!userLocationsMap[ul.user_id]) {
            userLocationsMap[ul.user_id] = [];
        }
        userLocationsMap[ul.user_id].push(ul.location_name);
    });
    
    // User brands map
    const userBrandsMap = {};
    userBrands.forEach(ub => {
        if (!userBrandsMap[ub.user_id]) {
            userBrandsMap[ub.user_id] = [];
        }
        userBrandsMap[ub.user_id].push(ub.brand_id);
    });
    
    // Role locations map
    const roleLocationsMap = {};
    roleLocations.forEach(rl => {
        if (!roleLocationsMap[rl.role_name]) {
            roleLocationsMap[rl.role_name] = [];
        }
        roleLocationsMap[rl.role_name].push(rl.location_name);
    });
    
    // Role brands map
    const roleBrandsMap = {};
    roleBrands.forEach(rb => {
        if (!roleBrandsMap[rb.role_name]) {
            roleBrandsMap[rb.role_name] = [];
        }
        roleBrandsMap[rb.role_name].push(rb.brand_id);
    });
    
    return users.map(user => {
        const sessionCount = sessionsCache.get(user.id) || 0;
        const roleReq = roleRequirementsMap[user.role] || { hasNoAccess: false };
        
        // Superadmin uchun istisno
        const isSuperadmin = user.role === 'superadmin' || user.role === 'super_admin';
        const hasNoAccess = isSuperadmin ? false : roleReq.hasNoAccess;
        
        // Foydalanuvchining o'z filiallari va brendlari
        const userOwnLocations = userLocationsMap[user.id] || [];
        const userOwnBrands = (userBrandsMap[user.id] || []).map(bid => ({
            id: bid,
            name: brandsMap[bid] || `Brend #${bid}`
        }));
        
        // Rol shartiga qarab filiallar va brendlar
        let roleBasedLocations = [];
        let roleBasedBrands = [];
        
        if (!isSuperadmin && user.role) {
            // Agar foydalanuvchining o'z filiallari bo'lsa, ularni ishlatish
            if (userOwnLocations.length > 0) {
                roleBasedLocations = userOwnLocations;
            } else if (roleLocationsMap[user.role]) {
                roleBasedLocations = roleLocationsMap[user.role];
            }
            
            // Agar foydalanuvchining o'z brendlari bo'lsa, ularni ishlatish
            if (userOwnBrands.length > 0) {
                roleBasedBrands = userOwnBrands;
            } else if (roleBrandsMap[user.role]) {
                roleBasedBrands = roleBrandsMap[user.role].map(bid => ({
                    id: bid,
                    name: brandsMap[bid] || `Brend #${bid}`
                }));
            }
        }
        
        return {
            ...user,
            locations: user.locations ? user.locations.split(',') : [],
            is_online: sessionCount > 0,
            active_sessions_count: sessionCount,
            has_no_access: hasNoAccess,
            role_based_locations: roleBasedLocations,
            role_based_brands: roleBasedBrands
        };
    });
}

async function getPermissionsByRole(role) {
    const cacheKey = `role_${role}`;
    const cached = cacheManager.get(PERMISSIONS_NAMESPACE, cacheKey);
    if (cached) {
        return cached;
    }
    
    const permissions = await db('role_permissions')
        .where({ role_name: role })
        .pluck('permission_key');
    
    cacheManager.set(PERMISSIONS_NAMESPACE, cacheKey, permissions, CACHE_TTL);
    return permissions;
}

async function getLocationsByUserId(userId) {
    const cacheKey = `user_${userId}`;
    const cached = cacheManager.get(LOCATIONS_NAMESPACE, cacheKey);
    if (cached) {
        return cached;
    }
    
    const locations = await db('user_locations')
        .where({ user_id: userId })
        .pluck('location_name');
    
    cacheManager.set(LOCATIONS_NAMESPACE, cacheKey, locations, CACHE_TTL);
    return locations;
}

// --- YARATISH VA O'ZGARTIRISH FUNKSIYALARI (WRITE) ---

async function createUser(adminId, username, password, role, device_limit, fullname, status = 'active', ipAddress, userAgent) {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const [userId] = await db('users').insert({
        username,
        password: hashedPassword,
        fullname,
        role,
        status,
        device_limit
    });
    
    await logAction(adminId, 'create_user', 'user', userId, { username, role, status, ip: ipAddress, userAgent });
    
    return userId;
}

async function updateUser(adminId, userId, role, device_limit, fullname, ipAddress, userAgent) {
    const result = await db('users').where({ id: userId }).update({ role, device_limit, fullname });
    
    await logAction(adminId, 'update_user', 'user', userId, { role, device_limit, fullname, ip: ipAddress, userAgent });
    
    return result;
}

async function updateUserPassword(adminId, userId, newPassword, ipAddress, userAgent) {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const result = await db('users').where({ id: userId }).update({ password: hashedPassword });
    
    await logAction(adminId, 'change_password', 'user', userId, { ip: ipAddress, userAgent });
    
    return result;
}

async function updateUserSecretWord(adminId, userId, secretWord, ipAddress, userAgent) {
    const hashedSecretWord = await bcrypt.hash(secretWord, saltRounds);
    const result = await db('users').where({ id: userId }).update({ secret_word: hashedSecretWord });
    
    await logAction(adminId, 'set_secret_word', 'user', userId, { ip: ipAddress, userAgent });
    
    return result;
}

async function updateUserStatus(adminId, userId, status, ipAddress, userAgent) {
    if (status === 'blocked') {
        const sessions = await db('sessions').select('sid', 'sess');
        const userSessionIds = sessions.filter(s => {
            try { return JSON.parse(s.sess).user?.id == userId; } catch { return false; }
        }).map(s => s.sid);

        if (userSessionIds.length > 0) {
            await db('sessions').whereIn('sid', userSessionIds).del();
        }
    }
    
    const result = await db('users').where({ id: userId }).update({ status: status });
    
    const action = status === 'active' ? 'activate_user' : 'deactivate_user';
    await logAction(adminId, action, 'user', userId, { ip: ipAddress, userAgent });
    
    return result;
}

async function updateUserLocations(adminId, userId, locations = [], ipAddress, userAgent) {
    await db.transaction(async trx => {
        await trx('user_locations').where({ user_id: userId }).del();
        if (locations.length > 0) {
            const locationsToInsert = locations.map(location => ({ user_id: userId, location_name: location }));
            await trx('user_locations').insert(locationsToInsert);
        }
    });
    
    // Cache'ni tozalash
    clearUserCache(userId);
    
    await logAction(adminId, 'update_user_locations', 'user', userId, { locations, ip: ipAddress, userAgent });
}

// --- LOGIN BILAN BOG'LIQ FUNKSIYALAR ---

async function incrementLoginAttempts(userId, newAttempts) {
    return db('users')
        .where({ id: userId })
        .update({ 
            login_attempts: newAttempts, 
            last_attempt_at: db.fn.now() 
        });
}

async function lockUserForFailedAttempts(userId, lockMessage) {
    return db('users')
        .where({ id: userId })
        .update({ 
            status: 'blocked',
            login_attempts: 5, 
            lock_reason: lockMessage 
        });
}

async function resetLoginAttempts(userId) {
    return db('users')
        .where({ id: userId })
        .update({ 
            login_attempts: 0, 
            lock_reason: null 
        });
}

function clearUserCache(userId) {
    cacheManager.clearUserCache(userId);
    // Sessions cache'ni ham invalidate qilish
    sessionsCache = null;
    sessionsCacheTime = 0;
}

module.exports = {
    findByUsername,
    findById,
    getAllUsersWithDetails,
    getPermissionsByRole,
    getLocationsByUserId,
    createUser,
    updateUser,
    updateUserPassword,
    updateUserSecretWord,
    updateUserStatus,
    updateUserLocations,
    incrementLoginAttempts,
    lockUserForFailedAttempts,
    resetLoginAttempts,
    logAction,
    clearUserCache
};

