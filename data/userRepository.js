const { db, logAction } = require('../db.js');
const bcrypt = require('bcrypt');
const saltRounds = 10;

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


async function getAllUsersWithDetails() {
    // === MUAMMO TUZATILGAN JOY ===
    // Bu yerda `whereNot('u.status', 'archived')` sharti olib tashlandi,
    // chunki endi barcha statusdagi (arxivdan tashqari) foydalanuvchilar kerak.
    // Filtratsiya frontend (admin.js) tarafida qilinadi.
    const users = await db('users as u')
        .leftJoin('user_locations as ul', 'u.id', 'ul.user_id')
        .select(
            'u.id', 'u.username', 'u.fullname', 'u.role', 'u.status', 'u.device_limit',
            'u.telegram_chat_id', 'u.telegram_username'
        )
        .groupBy('u.id')
        .orderBy('u.username')
        .select(db.raw("GROUP_CONCAT(ul.location_name) as locations"));

    const sessions = await db('sessions').select('sess');
    const activeSessions = sessions.map(s => {
        try { return JSON.parse(s.sess); } catch { return null; }
    }).filter(Boolean);

    return users.map(user => {
        const userSessions = activeSessions.filter(s => s.user && s.user.id === user.id);
        return {
            ...user,
            locations: user.locations ? user.locations.split(',') : [],
            is_online: userSessions.length > 0,
            active_sessions_count: userSessions.length
        };
    });
}

async function getPermissionsByRole(role) {
    const permissions = await db('role_permissions').where({ role_name: role }).select('permission_key');
    return permissions.map(p => p.permission_key);
}

async function getLocationsByUserId(userId) {
    const locations = await db('user_locations').where({ user_id: userId }).select('location_name');
    return locations.map(l => l.location_name);
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
    logAction
};

