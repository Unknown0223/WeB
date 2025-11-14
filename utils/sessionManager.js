const { db } = require('../db.js');
const userRepository = require('../data/userRepository.js');

/**
 * Muayyan foydalanuvchining yoki barcha foydalanuvchilarning aktiv sessiyalarini yangilaydi.
 * @param {number|null} userId - Muayyan foydalanuvchi ID si. Agar null bo'lsa, barcha aktiv sessiyalar yangilanadi.
 */
async function refreshUserSessions(userId = null) {
    try {
        console.log(`Sessiyalarni yangilash boshlandi. Foydalanuvchi ID: ${userId || 'Barcha'}`);

        // Barcha aktiv sessiyalarni bazadan olamiz
        const sessions = await db('sessions').select('sid', 'sess');
        
        for (const session of sessions) {
            let sessionData;
            try {
                sessionData = JSON.parse(session.sess);
            } catch (e) {
                console.warn(`Sessiya (sid: ${session.sid}) ma'lumotini parse qilib bo'lmadi.`);
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
                    console.log(`O'chirilgan foydalanuvchi (ID: ${sessionUserId}) sessiyasi (sid: ${session.sid}) tugatildi.`);
                    continue;
                }

                // Foydalanuvchining yangi huquqlari va filiallarini olamiz
                const [locations, permissions] = await Promise.all([
                    userRepository.getLocationsByUserId(sessionUserId),
                    userRepository.getPermissionsByRole(user.role)
                ]);

                // Sessiya ma'lumotlarini yangilaymiz
                sessionData.user = {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    locations: locations,
                    permissions: permissions
                };

                // Yangilangan sessiyani bazaga qayta yozamiz
                await db('sessions')
                    .where({ sid: session.sid })
                    .update({ sess: JSON.stringify(sessionData) });
                    
                console.log(`Foydalanuvchi (ID: ${sessionUserId}) sessiyasi (sid: ${session.sid}) muvaffaqiyatli yangilandi.`);
            }
        }
    } catch (error) {
        console.error("Sessiyalarni yangilashda kutilmagan xatolik:", error);
    }
}

/**
 * Muayyan rolga ega barcha foydalanuvchilarning sessiyalarini yangilaydi.
 * @param {string} roleName - Rol nomi.
 */
async function refreshSessionsByRole(roleName) {
    try {
        console.log(`"${roleName}" rolidagi foydalanuvchilar uchun sessiyalar yangilanmoqda...`);
        // Shu roldagi barcha foydalanuvchilarni topamiz
        const usersInRole = await db('users').where({ role: roleName }).select('id');
        if (usersInRole.length === 0) {
            console.log(`"${roleName}" rolida aktiv foydalanuvchilar topilmadi.`);
            return;
        }

        // Har bir foydalanuvchi uchun sessiyani yangilash funksiyasini chaqiramiz
        for (const user of usersInRole) {
            await refreshUserSessions(user.id);
        }
    } catch (error) {
        console.error(`"${roleName}" roli uchun sessiyalarni yangilashda xatolik:`, error);
    }
}

module.exports = {
    refreshUserSessions,
    refreshSessionsByRole
};
