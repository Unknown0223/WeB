const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const userRepository = require('../data/userRepository.js');
const { refreshUserSessions } = require('../utils/sessionManager.js');
const { sendToTelegram } = require('../utils/bot.js');
const geoip = require('geoip-lite');

const router = express.Router();

// IP manzildan geolokatsiya ma'lumotlarini olish
function getLocationFromIP(ip) {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
        return {
            country: 'UZ',
            countryName: 'O\'zbekiston',
            region: 'TAS',
            city: 'Toshkent',
            timezone: 'Asia/Tashkent'
        };
    }
    
    const geo = geoip.lookup(ip);
    if (geo) {
        return {
            country: geo.country,
            countryName: getCountryName(geo.country),
            region: geo.region,
            city: geo.city || 'Noma\'lum',
            timezone: geo.timezone
        };
    }
    
    return {
        country: 'Unknown',
        countryName: 'Noma\'lum',
        region: 'Unknown',
        city: 'Noma\'lum',
        timezone: 'UTC'
    };
}

function getCountryName(countryCode) {
    const countries = {
        'UZ': 'O\'zbekiston',
        'RU': 'Rossiya',
        'KZ': 'Qozog\'iston',
        'TR': 'Turkiya',
        'US': 'AQSh',
        'GB': 'Buyuk Britaniya',
        'DE': 'Germaniya',
        'FR': 'Fransiya'
    };
    return countries[countryCode] || countryCode;
}

// Barcha AKTIV, BLOKLANGAN va ARXIVLANGAN foydalanuvchilarni olish
router.get('/', isAuthenticated, hasPermission('users:view'), async (req, res) => {
    try {
        const users = await userRepository.getAllUsersWithDetails();
        // Super admin'ni faqat super admin o'zi ko'rsin
        const currentUserRole = req.session.user?.role;
        const filteredUsers = users.filter(user => {
            if (user.role === 'super_admin' && currentUserRole !== 'super_admin') {
                return false;
            }
            return true;
        });
        res.json(filteredUsers);
    } catch (error) {
        console.error("/api/users GET xatoligi:", error);
        res.status(500).json({ message: "Foydalanuvchilarni olishda xatolik." });
    }
});

// Tasdiqlanishini kutayotgan foydalanuvchilarni olish
router.get('/pending', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    try {
        console.log('📋 [PENDING] Pending so\'rovlarni olish boshlandi...');
        
        const pendingUsers = await db('users')
            .whereIn('status', ['pending_approval', 'pending_telegram_subscription', 'status_in_process'])
            .select(
                'id', 
                'username', 
                'fullname', 
                'created_at', 
                'status',
                'telegram_chat_id',
                'telegram_username'
            )
            .orderBy('created_at', 'desc');
        
        console.log(`📋 [PENDING] Topilgan so'rovlar soni: ${pendingUsers.length}`);
        pendingUsers.forEach((user, index) => {
            console.log(`   ${index + 1}. ID: ${user.id}, Username: ${user.username}, Status: ${user.status}, Created: ${user.created_at}`);
        });
        
        // Ma'lumotlarni formatlash
        const formattedUsers = pendingUsers.map(user => ({
            id: user.id,
            username: user.username,
            full_name: user.fullname, // frontend'da full_name ishlatiladi
            fullname: user.fullname, // eski format uchun
            created_at: user.created_at,
            status: user.status,
            telegram_id: user.telegram_chat_id, // frontend'da telegram_id ishlatiladi
            telegram_chat_id: user.telegram_chat_id,
            telegram_username: user.telegram_username,
            telegram_connection_status: user.telegram_chat_id ? 'subscribed' : null
        }));
        
        console.log(`✅ [PENDING] ${formattedUsers.length} ta so'rov yuborilmoqda`);
        res.json(formattedUsers);
    } catch (error) {
        console.error("❌ [PENDING] /api/users/pending GET xatoligi:", error);
        res.status(500).json({ message: "So'rovlarni yuklashda xatolik." });
    }
});

// JORIY foydalanuvchining o'z sessiyalarini olish
router.get('/me/sessions', isAuthenticated, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const sessions = await db('sessions').select('sid', 'sess');
        
        const userSessions = sessions.map(s => {
            try {
                const sessData = JSON.parse(s.sess);
                if (sessData.user && sessData.user.id == userId) {
                    const ipAddress = sessData.ip_address || 'Unknown';
                    const location = getLocationFromIP(ipAddress);
                    
                    return {
                        sid: s.sid,
                        ip_address: ipAddress,
                        user_agent: sessData.user_agent,
                        location: location,
                        last_activity: new Date(sessData.cookie.expires).toISOString(),
                        is_current: s.sid === req.sessionID
                    };
                }
                return null;
            } catch { return null; }
        }).filter(Boolean);

        res.json(userSessions);
    } catch (error) {
        console.error(`/api/users/me/sessions GET xatoligi:`, error);
        res.status(500).json({ message: "Sessiyalarni olishda xatolik." });
    }
});

// User-specific sozlamalarni olish
router.get('/:id/settings', isAuthenticated, hasPermission('users:view'), async (req, res) => {
    const userId = req.params.id;
    try {
        const settings = await db('user_specific_settings')
            .where({ user_id: userId })
            .first();
        
        if (!settings) {
            return res.json({ requires_locations: null, requires_brands: null });
        }
        
        res.json({
            requires_locations: settings.requires_locations,
            requires_brands: settings.requires_brands
        });
    } catch (error) {
        console.error(`/api/users/${userId}/settings GET xatoligi:`, error);
        res.status(500).json({ message: "Sozlamalarni olishda xatolik." });
    }
});

// Foydalanuvchining aktiv sessiyalarini olish (Admin uchun)
router.get('/:id/sessions', isAuthenticated, hasPermission('users:manage_sessions'), async (req, res) => {
    const userId = req.params.id;
    try {
        const sessions = await db('sessions').select('sid', 'sess');
        
        const userSessions = sessions.map(s => {
            try {
                const sessData = JSON.parse(s.sess);
                if (sessData.user && sessData.user.id == userId) {
                    return {
                        sid: s.sid,
                        ip_address: sessData.ip_address,
                        user_agent: sessData.user_agent,
                        last_activity: new Date(sessData.cookie.expires).toISOString(),
                        is_current: s.sid === req.sessionID
                    };
                }
                return null;
            } catch { return null; }
        }).filter(Boolean);

        res.json(userSessions);
    } catch (error) {
        console.error(`/api/users/${userId}/sessions GET xatoligi:`, error);
        res.status(500).json({ message: "Sessiyalarni olishda xatolik." });
    }
});

// Yangi foydalanuvchi yaratish (Admin tomonidan)
router.post('/', isAuthenticated, hasPermission('users:create'), async (req, res) => {
    const { username, password, role, locations = [], device_limit = 1, fullname, brands = [], user_settings } = req.body;
    const adminId = req.session.user.id;
    const currentUserRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;
    
    if (!username || !password || !role) {
        return res.status(400).json({ message: "Login, parol va rol kiritilishi shart." });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "Parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    
    // Super admin yaratish faqat super admin tomonidan mumkin
    if (role === 'super_admin' && currentUserRole !== 'super_admin') {
        return res.status(403).json({ message: "Super admin yaratish faqat super admin tomonidan mumkin." });
    }
    
    if ((role === 'operator' || role === 'manager') && locations.length === 0) {
        return res.status(400).json({ message: "Operator yoki Menejer uchun kamida bitta filial tanlanishi shart." });
    }
    
    // Admin yoki Manager uchun brend belgilash majburiy
    if ((role === 'admin' || role === 'manager') && brands.length === 0) {
        return res.status(400).json({ message: "Admin yoki Manager uchun kamida bitta brend tanlanishi shart." });
    }

    try {
        const userId = await userRepository.createUser(adminId, username, password, role, device_limit, fullname, 'active', ipAddress, userAgent);
        await userRepository.updateUserLocations(adminId, userId, locations, ipAddress, userAgent);
        
        // Manager uchun brendlarni saqlash
        if (role === 'manager' && brands.length > 0) {
            await db('user_brands').where('user_id', userId).del();
            const brandRecords = brands.map(brandId => ({
                user_id: userId,
                brand_id: brandId
            }));
            await db('user_brands').insert(brandRecords);
        }
        
        // User-specific sozlamalarni saqlash
        if (user_settings) {
            await db('user_specific_settings')
                .insert({
                    user_id: userId,
                    role: role,
                    requires_locations: user_settings.requires_locations,
                    requires_brands: user_settings.requires_brands
                })
                .onConflict(['user_id', 'role'])
                .merge({
                    requires_locations: user_settings.requires_locations,
                    requires_brands: user_settings.requires_brands,
                    updated_at: db.fn.now()
                });
        }
        
        // Super admin yaratilganda avtomatik login qilish imkoniyati
        // Super admin yaratilganda, login ma'lumotlarini qaytarish (faqat bir marta)
        if (role === 'super_admin') {
            return res.status(201).json({ 
                message: "Super admin muvaffaqiyatli yaratildi.",
                autoLogin: true,
                loginData: {
                    username: username,
                    password: password
                },
                redirectUrl: '/admin'
            });
        }
        
        res.status(201).json({ 
            message: "Foydalanuvchi muvaffaqiyatli qo'shildi."
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: "Bu nomdagi foydalanuvchi allaqachon mavjud." });
        }
        console.error("/api/users POST xatoligi:", error);
        res.status(500).json({ message: "Foydalanuvchi qo'shishda xatolik." });
    }
});

// Foydalanuvchini tahrirlash
router.put('/:id', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = req.params.id;
    const { role, locations = [], device_limit, fullname, brands = [], user_settings } = req.body;
    const adminId = req.session.user.id;
    const currentUserRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!role) {
        return res.status(400).json({ message: "Rol kiritilishi shart." });
    }
    
    // Super admin yaratish faqat super admin tomonidan mumkin
    if (role === 'super_admin' && currentUserRole !== 'super_admin') {
        return res.status(403).json({ message: "Super admin yaratish faqat super admin tomonidan mumkin." });
    }
    
    // Admin role'ni yaratish mumkin emas - faqat super admin yaratiladi
    if (role === 'admin') {
        return res.status(403).json({ message: "Admin role'ni yaratish mumkin emas. Faqat super admin yaratiladi." });
    }
    
    if ((role === 'operator' || role === 'manager') && locations.length === 0) {
        return res.status(400).json({ message: "Operator yoki Menejer uchun kamida bitta filial tanlanishi shart." });
    }
    
    // Manager uchun brend belgilash majburiy
    if (role === 'manager' && brands.length === 0) {
        return res.status(400).json({ message: "Manager uchun kamida bitta brend tanlanishi shart." });
    }

    try {
        await userRepository.updateUser(adminId, userId, role, device_limit, fullname, ipAddress, userAgent);
        await userRepository.updateUserLocations(adminId, userId, locations, ipAddress, userAgent);
        
        // Manager uchun brendlarni yangilash
        await db('user_brands').where('user_id', userId).del();
        if (role === 'manager' && brands.length > 0) {
            const brandRecords = brands.map(brandId => ({
                user_id: userId,
                brand_id: brandId
            }));
            await db('user_brands').insert(brandRecords);
        }
        
        // User-specific sozlamalarni yangilash
        if (user_settings) {
            await db('user_specific_settings')
                .insert({
                    user_id: userId,
                    role: role,
                    requires_locations: user_settings.requires_locations,
                    requires_brands: user_settings.requires_brands
                })
                .onConflict(['user_id', 'role'])
                .merge({
                    requires_locations: user_settings.requires_locations,
                    requires_brands: user_settings.requires_brands,
                    updated_at: db.fn.now()
                });
        }

        await refreshUserSessions(parseInt(userId, 10));

        res.json({ message: "Foydalanuvchi ma'lumotlari muvaffaqiyatli yangilandi." });
    } catch (error) {
        console.error(`/api/users/${userId} PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchini yangilashda xatolik." });
    }
});

// Foydalanuvchi holatini o'zgartirish (Bloklash/Aktivlashtirish)
router.put('/:id/status', isAuthenticated, hasPermission('users:change_status'), async (req, res) => {
    const userId = req.params.id;
    const { status } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (Number(userId) === req.session.user.id) {
        return res.status(403).json({ message: "Siz o'zingizning holatingizni o'zgartira olmaysiz." });
    }
    if (!['active', 'blocked'].includes(status)) {
        return res.status(400).json({ message: "Status noto'g'ri: faqat 'active' yoki 'blocked' bo'lishi mumkin." });
    }

    try {
        await userRepository.updateUserStatus(adminId, userId, status, ipAddress, userAgent);
        
        const message = status === 'active' ? "Foydalanuvchi muvaffaqiyatli aktivlashtirildi." : "Foydalanuvchi muvaffaqiyatli bloklandi va barcha sessiyalari tugatildi.";
        res.json({ message });
    } catch (error) {
        console.error(`/api/users/${userId}/status PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchi holatini o'zgartirishda xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHI SO'ROVINI TASDIQLASH (YANGILANGAN TO'LIQ MANTIQ) ===
// ===================================================================
// Middleware'lardan oldin log qo'shish
router.put('/:id/approve', (req, res, next) => {
    console.log('🔍 [BACKEND] PUT /:id/approve endpoint\'ga so\'rov kelindi');
    console.log(`   - Method: ${req.method}`);
    console.log(`   - Path: ${req.path}`);
    console.log(`   - Original URL: ${req.originalUrl}`);
    console.log(`   - User ID param: ${req.params.id}`);
    console.log(`   - Body:`, JSON.stringify(req.body, null, 2));
    console.log(`   - Session ID: ${req.sessionID}`);
    console.log(`   - Session user: ${req.session?.user ? 'MAVJUD' : 'YO\'Q'}`);
    next();
}, isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    console.log('🚀 ========================================');
    console.log('🚀 [BACKEND] Foydalanuvchi tasdiqlash so\'rovi kelindi');
    console.log('🚀 ========================================');
    
    const userId = req.params.id;
    const { role, locations = [], brands = [] } = req.body;
    const adminId = req.session.user.id;
    const currentUserRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    console.log(`📝 [BACKEND] 1. So'rov ma'lumotlari:`);
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Role: ${role}`);
    console.log(`   - Locations: ${JSON.stringify(locations)}`);
    console.log(`   - Brands: ${JSON.stringify(brands)}`);
    console.log(`   - Admin ID: ${adminId}`);
    console.log(`   - Admin Role: ${currentUserRole}`);
    console.log(`   - IP Address: ${ipAddress}`);

    if (!role) {
        console.error(`❌ [BACKEND] 2. XATOLIK: Rol tanlanmagan!`);
        return res.status(400).json({ message: "Rol tanlanishi shart." });
    }
    
    // Super admin yaratish faqat super admin tomonidan mumkin
    if (role === 'super_admin' && currentUserRole !== 'super_admin') {
        console.error(`❌ [BACKEND] 2. XATOLIK: Super admin yaratishga urinish!`);
        console.error(`   - Requested role: ${role}`);
        console.error(`   - Current user role: ${currentUserRole}`);
        return res.status(403).json({ message: "Super admin yaratish faqat super admin tomonidan mumkin." });
    }
    
    // Rol bazada mavjudligini tekshirish va talablarini olish
    console.log(`🔍 [BACKEND] 3. Rol ma'lumotlarini bazadan olish...`);
    const roleData = await db('roles').where({ role_name: role }).first();
    if (!roleData) {
        console.error(`❌ [BACKEND] 3. XATOLIK: Rol topilmadi!`);
        console.error(`   - Requested role: ${role}`);
        return res.status(400).json({ message: "Tanlangan rol mavjud emas." });
    }
    
    console.log(`✅ [BACKEND] 3. Rol topildi:`);
    console.log(`   - Role Name: ${roleData.role_name}`);
    console.log(`   - Requires Locations: ${roleData.requires_locations} (type: ${typeof roleData.requires_locations})`);
    console.log(`   - Requires Brands: ${roleData.requires_brands} (type: ${typeof roleData.requires_brands})`);
    console.log(`   - Requires Locations === null: ${roleData.requires_locations === null}`);
    console.log(`   - Requires Brands === null: ${roleData.requires_brands === null}`);
    console.log(`   - Requires Locations === undefined: ${roleData.requires_locations === undefined}`);
    console.log(`   - Requires Brands === undefined: ${roleData.requires_brands === undefined}`);
    console.log(`   - Full Role Data:`, JSON.stringify(roleData, null, 2));
    
    // Rol shartlarini tekshirish
    // SQLite'da 0 (false) va null o'rtasidagi farqni to'g'ri aniqlash
    // Agar qiymat null yoki undefined bo'lsa, bu "belgilanmagan" degan ma'noni anglatadi
    console.log(`🔍 [BACKEND] 4. Rol shartlarini tekshirish...`);
    
    // SQLite'da null tekshiruvi: agar qiymat null yoki undefined bo'lsa
    const isLocationsNull = (roleData.requires_locations === null || roleData.requires_locations === undefined);
    const isBrandsNull = (roleData.requires_brands === null || roleData.requires_brands === undefined);
    
    console.log(`   - isLocationsNull: ${isLocationsNull}`);
    console.log(`   - isBrandsNull: ${isBrandsNull}`);
    
    // Agar null bo'lsa, null qaytarish, aks holda boolean qiymatni qaytarish
    const isLocationsRequired = isLocationsNull 
        ? null 
        : Boolean(roleData.requires_locations);
    const isBrandsRequired = isBrandsNull 
        ? null 
        : Boolean(roleData.requires_brands);
    
    console.log(`   - isLocationsRequired: ${isLocationsRequired} (type: ${typeof isLocationsRequired})`);
    console.log(`   - isBrandsRequired: ${isBrandsRequired} (type: ${typeof isBrandsRequired})`);
    console.log(`   - isLocationsRequired === null: ${isLocationsRequired === null}`);
    console.log(`   - isBrandsRequired === null: ${isBrandsRequired === null}`);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    const isLocationsUndefined = (isLocationsRequired === null || isLocationsRequired === undefined);
    const isBrandsUndefined = (isBrandsRequired === null || isBrandsRequired === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    console.log(`   - isLocationsUndefined: ${isLocationsUndefined}`);
    console.log(`   - isBrandsUndefined: ${isBrandsUndefined}`);
    console.log(`   - isRequirementsUndefined: ${isRequirementsUndefined}`);
    
    if (isRequirementsUndefined) {
        console.error(`❌ [BACKEND] 4. XATOLIK: Rol shartlari belgilanmagan!`);
        console.error(`   - Role: ${role}`);
        console.error(`   - requires_locations: ${roleData.requires_locations} (${typeof roleData.requires_locations})`);
        console.error(`   - requires_brands: ${roleData.requires_brands} (${typeof roleData.requires_brands})`);
        return res.status(400).json({ 
            message: `"${role}" roli uchun shartlar belgilanmagan. Avval shart belgilanishi kerak.`,
            requires_locations: roleData.requires_locations,
            requires_brands: roleData.requires_brands
        });
    }
    
    console.log(`✅ [BACKEND] 4. Rol shartlari belgilangan. Validatsiyaga o'tilmoqda...`);
    
    // Validatsiya: Agar shartlar majburiy bo'lsa, tanlanganlar bo'lishi kerak
    console.log(`🔍 [BACKEND] 5. Validatsiya tekshiruvi...`);
    
    if (isLocationsRequired === true) {
        console.log(`   - Filiallar majburiy (true)`);
        console.log(`   - Tanlangan filiallar soni: ${locations.length}`);
        if (locations.length === 0) {
            console.error(`   ❌ XATOLIK: Filiallar majburiy, lekin tanlanmagan!`);
            return res.status(400).json({ 
                message: `"${role}" roli uchun kamida bitta filial tanlanishi shart.`,
                requires_locations: true,
                locations_provided: locations.length
            });
        }
        console.log(`   ✅ Filiallar validatsiyasi o'tdi`);
    } else {
        // false - filiallar kerak emas
        console.log(`   - Filiallar kerak emas (false)`);
    }
    
    if (isBrandsRequired === true) {
        console.log(`   - Brendlar majburiy (true)`);
        console.log(`   - Tanlangan brendlar soni: ${brands.length}`);
        if (brands.length === 0) {
            console.error(`   ❌ XATOLIK: Brendlar majburiy, lekin tanlanmagan!`);
            return res.status(400).json({ 
                message: `"${role}" roli uchun kamida bitta brend tanlanishi shart.`,
                requires_brands: true,
                brands_provided: brands.length
            });
        }
        console.log(`   ✅ Brendlar validatsiyasi o'tdi`);
    } else {
        // false - brendlar kerak emas
        console.log(`   - Brendlar kerak emas (false)`);
    }
    
    console.log(`✅ [BACKEND] 5. Barcha validatsiyalar o'tdi.`);

    try {
        // 1. Foydalanuvchi va uning vaqtinchalik ma'lumotlarini tekshirish
        console.log(`🔍 [BACKEND] 6. Foydalanuvchi ma'lumotlarini bazadan olish...`);
        const user = await db('users').where({ id: userId }).first();
        if (!user || !['pending_approval', 'pending_telegram_subscription'].includes(user.status)) {
            console.error(`❌ [BACKEND] 6. XATOLIK: Foydalanuvchi topilmadi yoki allaqachon tasdiqlangan!`);
            console.error(`   - User ID: ${userId}`);
            console.error(`   - User found: ${user ? 'HA' : 'YO\'Q'}`);
            if (user) {
                console.error(`   - User status: ${user.status}`);
            }
            return res.status(404).json({ message: "Foydalanuvchi topilmadi yoki allaqachon tasdiqlangan." });
        }
        
        console.log(`✅ [BACKEND] 6. Foydalanuvchi topildi:`);
        console.log(`   - Username: ${user.username}`);
        console.log(`   - Fullname: ${user.fullname}`);
        console.log(`   - Status: ${user.status}`);
        console.log(`   - Telegram Chat ID: ${user.telegram_chat_id || 'YO\'Q'}`);

        const tempReg = await db('pending_registrations').where({ user_id: userId }).first();
        if (!tempReg) {
            console.error(`❌ [BACKEND] 6. XATOLIK: Ro'yxatdan o'tish so'rovi topilmadi!`);
            console.error(`   - User ID: ${userId}`);
            return res.status(404).json({ message: "Ro'yxatdan o'tish so'rovi topilmadi yoki eskirgan." });
        }
        
        console.log(`✅ [BACKEND] 6. Ro'yxatdan o'tish so'rovi topildi`);
        const userData = JSON.parse(tempReg.user_data);
        const { password, secret_word } = userData;

        // 2. Foydalanuvchini aktivlashtirish (bitta tranzaksiya ichida)
        console.log(`💾 [BACKEND] 7. Ma'lumotlarni bazaga saqlash...`);
        await db.transaction(async trx => {
            console.log(`   - Foydalanuvchi statusini yangilash: active, role: ${role}`);
            await trx('users').where({ id: userId }).update({
                status: 'active',
                role: role,
                must_delete_creds: true // Kirish ma'lumotlari yuborilgach, xabarni o'chirish uchun belgi
            });

            console.log(`   - Eski filiallarni o'chirish...`);
            await trx('user_locations').where({ user_id: userId }).del();
            if (locations && locations.length > 0) {
                console.log(`   - Yangi filiallarni qo'shish: ${locations.length} ta`);
                const locationsToInsert = locations.map(loc => ({ user_id: userId, location_name: loc }));
                await trx('user_locations').insert(locationsToInsert);
                console.log(`   ✅ Filiallar saqlandi:`, locations);
            } else {
                console.log(`   - Filiallar qo'shilmadi (bo'sh)`);
            }
            
            // Manager va Admin uchun brendlarni saqlash
            console.log(`   - Eski brendlarni o'chirish...`);
            await trx('user_brands').where({ user_id: userId }).del();
            if ((role === 'manager' || role === 'admin') && brands && brands.length > 0) {
                console.log(`   - Yangi brendlarni qo'shish: ${brands.length} ta`);
                const brandRecords = brands.map(brandId => ({
                    user_id: userId,
                    brand_id: brandId
                }));
                await trx('user_brands').insert(brandRecords);
                console.log(`   ✅ Brendlar saqlandi:`, brands);
            } else {
                console.log(`   - Brendlar qo'shilmadi (bo'sh yoki rol mos emas)`);
            }
        });
        console.log(`✅ [BACKEND] 7. Ma'lumotlar muvaffaqiyatli saqlandi`);

        // 3. Foydalanuvchiga kirish ma'lumotlarini Telegram orqali yuborish
        console.log(`📨 [BACKEND] 8. Telegram orqali kirish ma'lumotlarini yuborish...`);
        let credentialsSent = false;
        if (user.telegram_chat_id) {
            console.log(`   - Telegram Chat ID: ${user.telegram_chat_id}`);
            try {
                await sendToTelegram({
                    type: 'user_approved_credentials',
                    chat_id: user.telegram_chat_id,
                    user_id: userId,
                    fullname: user.fullname,
                    username: user.username,
                    password: password,
                    secret_word: secret_word
                });
                credentialsSent = true;
                console.log(`   ✅ Kirish ma'lumotlari Telegramga yuborildi`);
            } catch (telegramError) {
                console.error(`   ❌ Telegram yuborishda xatolik:`, telegramError);
            }
        } else {
            console.log(`   - Telegram Chat ID yo'q, kirish ma'lumotlari yuborilmaydi`);
        }

        // 4. Vaqtinchalik ma'lumotlarni tozalash
        console.log(`🗑️ [BACKEND] 9. Vaqtinchalik ma'lumotlarni tozalash...`);
        await db('pending_registrations').where({ user_id: userId }).del();
        console.log(`   ✅ Vaqtinchalik ma'lumotlar tozalandi`);

        // 5. Audit jurnaliga yozish
        console.log(`📝 [BACKEND] 10. Audit jurnaliga yozish...`);
        await userRepository.logAction(adminId, 'approve_user', 'user', userId, { 
            approved_role: role, 
            locations, 
            brands,
            requires_locations: roleData.requires_locations,
            requires_brands: roleData.requires_brands,
            ip: ipAddress, 
            userAgent 
        });
        console.log(`   ✅ Audit jurnaliga yozildi`);
        
        // 6. Adminga yakuniy javobni qaytarish
        const message = `Foydalanuvchi muvaffaqiyatli tasdiqlandi. ${credentialsSent ? "Kirish ma'lumotlari uning Telegramiga yuborildi." : "Foydalanuvchi botga ulanmaganligi sababli kirish ma'lumotlari yuborilmadi."}`;
        
        console.log(`✅ [BACKEND] 11. Muvaffaqiyatli yakunlandi!`);
        console.log(`   - User ID: ${userId}`);
        console.log(`   - Role: ${role}`);
        console.log(`   - Locations: ${locations.length} ta`);
        console.log(`   - Brands: ${brands.length} ta`);
        console.log(`   - Credentials Sent: ${credentialsSent}`);
        console.log('✅ ========================================');
        console.log('✅ [BACKEND] Tasdiqlash jarayoni muvaffaqiyatli yakunlandi!');
        console.log('✅ ========================================');
        
        res.json({ 
            message: message,
            credentials_sent: credentialsSent
        });

    } catch (error) {
        console.error('❌ ========================================');
        console.error(`❌ [BACKEND] XATOLIK YUZ BERDI!`);
        console.error(`❌ [BACKEND] Endpoint: /api/users/${userId}/approve`);
        console.error(`❌ [BACKEND] Method: PUT`);
        console.error(`❌ [BACKEND] Error:`, error);
        console.error(`❌ [BACKEND] Error Stack:`, error.stack);
        console.error(`❌ [BACKEND] Request Body:`, JSON.stringify(req.body, null, 2));
        console.error('❌ ========================================');
        res.status(500).json({ message: "Foydalanuvchini tasdiqlashda kutilmagan xatolik." });
    }
});

// Foydalanuvchi so'rovini rad etish (SOFT DELETE)
router.put('/:id/reject', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = req.params.id;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    try {
        const updatedCount = await db('users')
            .where({ id: userId })
            .whereIn('status', ['pending_approval', 'pending_telegram_subscription', 'status_in_process'])
            .update({ status: 'archived' }); // O'chirish o'rniga arxivlash

        if (updatedCount === 0) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi yoki allaqachon ko'rib chiqilgan." });
        }

        // Vaqtinchalik ma'lumotlarni ham o'chiramiz
        await db('pending_registrations').where({ user_id: userId }).del();

        await userRepository.logAction(adminId, 'reject_user', 'user', userId, { ip: ipAddress, userAgent });

        res.json({ message: "Foydalanuvchi so'rovi muvaffaqiyatli rad etildi va arxivlandi." });
    } catch (error) {
        console.error(`/api/users/${userId}/reject PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchini rad etishda xatolik." });
    }
});

// Foydalanuvchi parolini o'zgartirish
router.put('/:id/password', isAuthenticated, hasPermission('users:change_password'), async (req, res) => {
    const { newPassword } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Yangi parol kamida 8 belgidan iborat bo'lishi kerak." });
    }
    try {
        await userRepository.updateUserPassword(adminId, req.params.id, newPassword, ipAddress, userAgent);
        res.json({ message: "Parol muvaffaqiyatli yangilandi." });
    } catch (error) {
        console.error(`/api/users/${req.params.id}/password PUT xatoligi:`, error);
        res.status(500).json({ message: "Parolni yangilashda xatolik." });
    }
});

// Foydalanuvchi maxfiy so'zini o'rnatish
router.put('/:id/secret-word', isAuthenticated, hasPermission('users:set_secret_word'), async (req, res) => {
    const { secretWord } = req.body;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!secretWord || secretWord.length < 6) {
        return res.status(400).json({ message: "Maxfiy so'z kamida 6 belgidan iborat bo'lishi kerak." });
    }
    try {
        await userRepository.updateUserSecretWord(adminId, req.params.id, secretWord, ipAddress, userAgent);
        res.json({ message: "Maxfiy so'z muvaffaqiyatli o'rnatildi/yangilandi." });
    } catch (error) {
        console.error(`/api/users/${req.params.id}/secret-word PUT xatoligi:`, error);
        res.status(500).json({ message: "Maxfiy so'zni saqlashda xatolik." });
    }
});

// User-specific permissions - Get
router.get('/:id/permissions', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const userId = req.params.id;
    try {
        // Get user's base role permissions
        const user = await db('users').where('id', userId).first();
        if (!user) {
            return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
        }

        // Get user's additional permissions
        const additional = await db('user_permissions')
            .where({ user_id: userId, type: 'additional' })
            .pluck('permission_key');

        // Get user's restricted permissions
        const restricted = await db('user_permissions')
            .where({ user_id: userId, type: 'restricted' })
            .pluck('permission_key');

        res.json({
            role: user.role,
            additional: additional,
            restricted: restricted
        });
    } catch (error) {
        console.error('Get user permissions error:', error);
        res.status(500).json({ message: 'Huquqlarni yuklashda xatolik' });
    }
});

// User-specific permissions - Save
router.post('/:id/permissions', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const userId = req.params.id;
    const { type, permissions } = req.body; // type: 'additional' or 'restricted'

    try {
        // Delete existing permissions of this type
        await db('user_permissions')
            .where({ user_id: userId, type: type })
            .del();

        // Insert new permissions
        if (permissions && permissions.length > 0) {
            const records = permissions.map(perm => ({
                user_id: userId,
                permission_key: perm,
                type: type
            }));
            await db('user_permissions').insert(records);
        }

        // Log to audit
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'update_user_permissions',
            target_type: 'user',
            target_id: userId,
            details: JSON.stringify({ type, count: permissions.length }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });

        // Foydalanuvchining sessiyasini yangilash
        const { refreshUserSessions } = require('../utils/sessionManager.js');
        await refreshUserSessions(parseInt(userId));

        res.json({ message: 'Huquqlar muvaffaqiyatli saqlandi' });
    } catch (error) {
        console.error('Save user permissions error:', error);
        res.status(500).json({ message: 'Huquqlarni saqlashda xatolik' });
    }
});

// User-specific permissions - Reset (delete all custom permissions)
router.delete('/:id/permissions', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    const userId = req.params.id;

    try {
        await db('user_permissions').where({ user_id: userId }).del();

        // Log to audit
        const adminId = req.session.user.id;
        const username = req.session.user?.username || 'admin';
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'reset_user_permissions',
            target_type: 'user',
            target_id: userId,
            details: JSON.stringify({ message: 'All custom permissions removed' }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });

        // Foydalanuvchining sessiyasini yangilash
        const { refreshUserSessions } = require('../utils/sessionManager.js');
        await refreshUserSessions(parseInt(userId));

        res.json({ message: 'Barcha maxsus huquqlar o\'chirildi' });
    } catch (error) {
        console.error('Reset user permissions error:', error);
        res.status(500).json({ message: 'Huquqlarni tiklashda xatolik' });
    }
});

// ============= AVATAR MANAGEMENT =============

// Joriy foydalanuvchining avatarini olish
router.get('/me/avatar', isAuthenticated, async (req, res) => {
    try {
        const user = await db('users').where('id', req.session.user.id).first();
        res.json({ avatar_url: user.avatar_url || null });
    } catch (error) {
        console.error('Avatar olishda xatolik:', error);
        res.status(500).json({ message: 'Avatar olishda xatolik' });
    }
});

// Joriy foydalanuvchining avatarini yangilash (Base64 format)
router.put('/me/avatar', isAuthenticated, async (req, res) => {
    try {
        const { avatar } = req.body; // Base64 format
        
        if (!avatar) {
            return res.status(400).json({ message: 'Avatar ma\'lumoti topilmadi' });
        }

        // Base64 formatni tekshirish
        if (!avatar.startsWith('data:image/')) {
            return res.status(400).json({ message: 'Noto\'g\'ri avatar formati' });
        }

        await db('users')
            .where('id', req.session.user.id)
            .update({ 
                avatar_url: avatar,
                updated_at: db.fn.now()
            });

        // Sessiyani yangilash
        req.session.user.avatar_url = avatar;

        // Audit log
        await db('audit_logs').insert({
            user_id: req.session.user.id,
            action: 'update_avatar',
            target_type: 'user',
            target_id: req.session.user.id,
            details: JSON.stringify({ message: 'Avatar yangilandi' }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });

        res.json({ 
            message: 'Avatar muvaffaqiyatli yangilandi',
            avatar_url: avatar 
        });
    } catch (error) {
        console.error('Avatar yangilashda xatolik:', error);
        res.status(500).json({ message: 'Avatar yangilashda xatolik' });
    }
});

// Joriy foydalanuvchining avatarini o'chirish
router.delete('/me/avatar', isAuthenticated, async (req, res) => {
    try {
        await db('users')
            .where('id', req.session.user.id)
            .update({ 
                avatar_url: null,
                updated_at: db.fn.now()
            });

        // Sessiyani yangilash
        req.session.user.avatar_url = null;

        // Audit log
        await db('audit_logs').insert({
            user_id: req.session.user.id,
            action: 'delete_avatar',
            target_type: 'user',
            target_id: req.session.user.id,
            details: JSON.stringify({ message: 'Avatar o\'chirildi' }),
            ip_address: req.session.ip_address,
            user_agent: req.session.user_agent
        });

        res.json({ message: 'Avatar muvaffaqiyatli o\'chirildi' });
    } catch (error) {
        console.error('Avatar o\'chirishda xatolik:', error);
        res.status(500).json({ message: 'Avatar o\'chirishda xatolik' });
    }
});

// Parol o'zgartirish so'rovlarini olish (Admin uchun)
router.get('/password-change-requests', isAuthenticated, hasPermission('users:change_password'), async (req, res) => {
    try {
        const requests = await db('password_change_requests')
            .join('users', 'password_change_requests.user_id', 'users.id')
            .where('password_change_requests.status', 'pending')
            .select(
                'password_change_requests.*',
                'users.username',
                'users.fullname',
                'users.role'
            )
            .orderBy('password_change_requests.requested_at', 'desc');
        
        res.json(requests);
    } catch (error) {
        console.error("Parol so'rovlarini olish xatoligi:", error);
        res.status(500).json({ message: "So'rovlarni yuklashda xatolik." });
    }
});

// Parol o'zgartirish so'rovini tasdiqlash (Admin uchun)
router.post('/password-change-requests/:id/approve', isAuthenticated, hasPermission('users:change_password'), async (req, res) => {
    const requestId = req.params.id;
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;
    
    try {
        const request = await db('password_change_requests').where({ id: requestId, status: 'pending' }).first();
        
        if (!request) {
            return res.status(404).json({ message: "So'rov topilmadi yoki allaqachon ko'rib chiqilgan." });
        }
        
        // Parolni yangilash
        await db('users')
            .where({ id: request.user_id })
            .update({ 
                password: request.new_password_hash,
                updated_at: db.fn.now()
            });
        
        // So'rov statusini yangilash
        await db('password_change_requests')
            .where({ id: requestId })
            .update({
                status: 'approved',
                approved_by: adminId,
                processed_at: db.fn.now()
            });
        
        // Audit log
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'approve_password_change',
            target_type: 'user',
            target_id: request.user_id,
            details: JSON.stringify({ request_id: requestId }),
            ip_address: ipAddress,
            user_agent: userAgent
        });
        
        // Foydalanuvchiga Telegram orqali xabar yuborish
        const user = await db('users').where({ id: request.user_id }).first();
        if (user.telegram_chat_id) {
            await sendToTelegram({
                type: 'password_changed',
                chat_id: user.telegram_chat_id,
                username: user.username
            });
        }
        
        res.json({ message: "Parol o'zgartirish so'rovi tasdiqlandi." });
    } catch (error) {
        console.error("So'rovni tasdiqlash xatoligi:", error);
        res.status(500).json({ message: "So'rovni tasdiqlashda xatolik." });
    }
});

// Parol o'zgartirish so'rovini rad etish (Admin uchun)
router.post('/password-change-requests/:id/reject', isAuthenticated, hasPermission('users:change_password'), async (req, res) => {
    const requestId = req.params.id;
    const adminId = req.session.user.id;
    const { comment } = req.body;
    
    try {
        const request = await db('password_change_requests').where({ id: requestId, status: 'pending' }).first();
        
        if (!request) {
            return res.status(404).json({ message: "So'rov topilmadi yoki allaqachon ko'rib chiqilgan." });
        }
        
        // So'rov statusini yangilash
        await db('password_change_requests')
            .where({ id: requestId })
            .update({
                status: 'rejected',
                approved_by: adminId,
                processed_at: db.fn.now(),
                admin_comment: comment || null
            });
        
        // Foydalanuvchiga Telegram orqali xabar yuborish
        const user = await db('users').where({ id: request.user_id }).first();
        if (user.telegram_chat_id) {
            await sendToTelegram({
                type: 'password_change_rejected',
                chat_id: user.telegram_chat_id,
                username: user.username,
                reason: comment || 'Sabab ko\'rsatilmagan'
            });
        }
        
        res.json({ message: "So'rov rad etildi." });
    } catch (error) {
        console.error("So'rovni rad etish xatoligi:", error);
        res.status(500).json({ message: "So'rovni rad etishda xatolik." });
    }
});

module.exports = router;

