const { db } = require('../db.js');
const userRepository = require('../data/userRepository.js');
const { createLogger } = require('./logger.js');
const log = createLogger('SESSIONMANAGER');


/**
 * Muayyan foydalanuvchining yoki barcha foydalanuvchilarning aktiv sessiyalarini yangilaydi.
 * @param {number|null} userId - Muayyan foydalanuvchi ID si. Agar null bo'lsa, barcha aktiv sessiyalar yangilanadi.
 */
async function refreshUserSessions(userId = null) {
    try {
        log.debug(`Sessiyalarni yangilash boshlandi. Foydalanuvchi ID: ${userId || 'Barcha'}`);

        // Barcha aktiv sessiyalarni bazadan olamiz
        const sessions = await db('sessions').select('sid', 'sess');
        
        for (const session of sessions) {
            let sessionData;
            try {
                sessionData = JSON.parse(session.sess);
            } catch (e) {
                log.warn(`Sessiya (sid: ${session.sid}) ma'lumotini parse qilib bo'lmadi.`);
                continue;
            }

            // Sessiyada foydalanuvchi ma'lumoti borligini va u bizga kerakli foydalanuvchi ekanligini tekshiramiz
            if (sessionData && sessionData.user && sessionData.user.id) {
                const sessionUserId = sessionData.user.id;

                // Agar muayyan foydalanuvchi kerak bo'lsa va bu o'sha bo'lmasa, o'tkazib yuboramiz
                if (userId !== null && sessionUserId !== userId) {
                    continue;
                }

                // Foydalanuvchining eng so'nggi ma'lumotlarini bazadan olamiz
                const user = await userRepository.findById(sessionUserId);
                if (!user) {
                    // Agar foydalanuvchi o'chirilgan bo'lsa, uning sessiyasini tugatamiz
                    await db('sessions').where({ sid: session.sid }).del();
                    log.debug(`O'chirilgan foydalanuvchi (ID: ${sessionUserId}) sessiyasi (sid: ${session.sid}) tugatildi.`);
                    continue;
                }

                // Foydalanuvchining yangi huquqlari va filiallarini olamiz
                const [locations, rolePermissions] = await Promise.all([
                    userRepository.getLocationsByUserId(sessionUserId),
                    userRepository.getPermissionsByRole(user.role)
                ]);

                // User-specific permissions (additional va restricted)
                const additionalPerms = await db('user_permissions')
                    .where({ user_id: sessionUserId, type: 'additional' })
                    .pluck('permission_key');
                
                const restrictedPerms = await db('user_permissions')
                    .where({ user_id: sessionUserId, type: 'restricted' })
                    .pluck('permission_key');

                // Final permissions: rolePermissions + additional - restricted
                let finalPermissions = [...rolePermissions];
                
                // Qo'shimcha huquqlarni qo'shish
                additionalPerms.forEach(perm => {
                    if (!finalPermissions.includes(perm)) {
                        finalPermissions.push(perm);
                    }
                });
                
                // Cheklangan huquqlarni olib tashlash
                finalPermissions = finalPermissions.filter(perm => !restrictedPerms.includes(perm));

                // Sessiya ma'lumotlarini yangilaymiz
                sessionData.user = {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    locations: locations,
                    permissions: finalPermissions
                };

                // Yangilangan sessiyani bazaga qayta yozamiz
                await db('sessions')
                    .where({ sid: session.sid })
                    .update({ sess: JSON.stringify(sessionData) });
                    
                log.debug(`Foydalanuvchi (ID: ${sessionUserId}) sessiyasi (sid: ${session.sid}) muvaffaqiyatli yangilandi.`);
            }
        }
    } catch (error) {
        log.error("Sessiyalarni yangilashda kutilmagan xatolik:", error);
    }
}

/**
 * Muayyan rolga ega barcha foydalanuvchilarning sessiyalarini yangilaydi.
 * @param {string} roleName - Rol nomi.
 */
async function refreshSessionsByRole(roleName) {
    try {
        log.debug(`"${roleName}" rolidagi foydalanuvchilar uchun sessiyalar yangilanmoqda...`);
        // Shu roldagi barcha foydalanuvchilarni topamiz
        const usersInRole = await db('users').where({ role: roleName }).select('id');
        if (usersInRole.length === 0) {
            log.debug(`"${roleName}" rolida aktiv foydalanuvchilar topilmadi.`);
            return;
        }

        // Har bir foydalanuvchi uchun sessiyani yangilash funksiyasini chaqiramiz
        for (const user of usersInRole) {
            await refreshUserSessions(user.id);
        }
    } catch (error) {
        log.error(`"${roleName}" roli uchun sessiyalarni yangilashda xatolik:`, error);
    }
}

module.exports = {
    refreshUserSessions,
    refreshSessionsByRole
};
