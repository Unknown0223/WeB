const { db, logAction } = require('../db.js');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// Cache mexanizmi - permissions va locations
const permissionsCache = new Map();
const locationsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 daqiqa

function clearUserCache(userId) {
    // User-specific cache'larni tozalash
    for (const [key] of locationsCache.entries()) {
        if (key.startsWith(`user_${userId}_`)) {
            locationsCache.delete(key);
        }
    }
}

// --- QIDIRISH FUNKSIYALARI (READ) ---

async function findByUsername(username) {
    return db('users').where({ username: username }).first();
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


// Cache - sessions parsing (5 daqiqa)
let sessionsCache = null;
let sessionsCacheTime = 0;
const SESSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 daqiqa

async function getAllUsersWithDetails() {
    // Parallel so'rovlar - tezlashtirish
    const [users, roleRequirements] = await Promise.all([
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
        db('roles').select('role_name', 'requires_locations', 'requires_brands')
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
    
    return users.map(user => {
        const sessionCount = sessionsCache.get(user.id) || 0;
        const roleReq = roleRequirementsMap[user.role] || { hasNoAccess: false };
        
        // Superadmin uchun istisno
        const isSuperadmin = user.role === 'superadmin' || user.role === 'super_admin';
        const hasNoAccess = isSuperadmin ? false : roleReq.hasNoAccess;
        
        return {
            ...user,
            locations: user.locations ? user.locations.split(',') : [],
            is_online: sessionCount > 0,
            active_sessions_count: sessionCount,
            has_no_access: hasNoAccess
        };
    });
}

async function getPermissionsByRole(role) {
    // Cache tekshirish
    const cacheKey = `role_${role}`;
    const cached = permissionsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data;
    }
    
    const permissions = await db('role_permissions').where({ role_name: role }).select('permission_key');
    const result = permissions.map(p => p.permission_key);
    
    // Cache'ga saqlash
    permissionsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
}

async function getLocationsByUserId(userId) {
    // Cache tekshirish
    const cacheKey = `user_${userId}_locations`;
    const cached = locationsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data;
    }
    
    const locations = await db('user_locations').where({ user_id: userId }).select('location_name');
    const result = locations.map(l => l.location_name);
    
    // Cache'ga saqlash
    locationsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
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
    const cacheKey = `user_${userId}_locations`;
    locationsCache.delete(cacheKey);
    
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
    clearUserCache // Cache'ni tozalash funksiyasi
};

