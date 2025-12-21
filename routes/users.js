const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const userRepository = require('../data/userRepository.js');
const { refreshUserSessions } = require('../utils/sessionManager.js');
const { sendToTelegram } = require('../utils/bot.js');
const geoip = require('geoip-lite');
const { createLogger } = require('../utils/logger.js');

const router = express.Router();
const log = createLogger('USERS');

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
        // Superadmin'ni faqat superadmin o'zi ko'rsin
        const currentUserRole = req.session.user?.role;
        const filteredUsers = users.filter(user => {
            // Eski super_admin va yangi superadmin ni tekshirish
            if ((user.role === 'super_admin' || user.role === 'superadmin') && 
                currentUserRole !== 'superadmin' && currentUserRole !== 'super_admin') {
                return false;
            }
            return true;
        });
        res.json(filteredUsers);
    } catch (error) {
        log.error("/api/users GET xatoligi:", error.message);
        res.status(500).json({ message: "Foydalanuvchilarni olishda xatolik." });
    }
});

// Tasdiqlanishini kutayotgan foydalanuvchilarni olish
router.get('/pending', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    try {
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
        
        res.json(formattedUsers);
    } catch (error) {
        log.error("/api/users/pending GET xatoligi:", error.message);
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
        log.error(`/api/users/me/sessions GET xatoligi:`, error.message);
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
        log.error(`/api/users/${userId}/settings GET xatoligi:`, error.message);
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
        log.error(`/api/users/${userId}/sessions GET xatoligi:`, error.message);
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
    
    // Superadmin yaratish faqat superadmin tomonidan mumkin
    if ((role === 'superadmin' || role === 'super_admin') && 
        currentUserRole !== 'superadmin' && currentUserRole !== 'super_admin') {
        return res.status(403).json({ message: "Superadmin yaratish faqat superadmin tomonidan mumkin." });
    }
    
    // Superadmin faqat bitta bo'lishi kerak
    if (role === 'superadmin' || role === 'super_admin') {
        const existingSuperAdmin = await db('users')
            .whereIn('role', ['superadmin', 'super_admin'])
            .first();
        if (existingSuperAdmin) {
            return res.status(403).json({ message: "Superadmin faqat bitta bo'lishi mumkin. Mavjud superadmin: " + existingSuperAdmin.username });
        }
    }
    
    // Superadmin uchun hech qanday shartlar yo'q (to'liq dostup)
    if (role === 'superadmin' || role === 'super_admin') {
        // Superadmin uchun filiallar va brendlar shart emas
    } else {
        // Boshqa rollar uchun rol shartlarini tekshirish
        const roleData = await db('roles').where('role_name', role).first();
        if (roleData) {
            const requiresLocations = roleData.requires_locations !== null && roleData.requires_locations !== undefined 
                ? Boolean(roleData.requires_locations) 
                : null;
            const requiresBrands = roleData.requires_brands !== null && roleData.requires_brands !== undefined 
                ? Boolean(roleData.requires_brands) 
                : null;
            
            // Agar shartlar belgilanmagan bo'lsa (null), hech narsa ko'rinmaydi
            // Shuning uchun kamida bitta filial yoki brend tanlanishi kerak
            if (requiresLocations === null && requiresBrands === null) {
                // Hech qanday shart belgilanmagan - hech narsa ko'rinmaydi
                // Lekin foydalanuvchi yaratishda bu ruxsat beriladi (keyin rol shartlari belgilanadi)
            } else {
                // Agar filiallar majburiy bo'lsa
                if (requiresLocations === true && locations.length === 0) {
                    return res.status(400).json({ message: `"${role}" roli uchun kamida bitta filial tanlanishi shart.` });
                }
                // Agar brendlar majburiy bo'lsa
                if (requiresBrands === true && brands.length === 0) {
                    return res.status(400).json({ message: `"${role}" roli uchun kamida bitta brend tanlanishi shart.` });
                }
            }
        }
    }

    try {
        const userId = await userRepository.createUser(adminId, username, password, role, device_limit, fullname, 'active', ipAddress, userAgent);
        await userRepository.updateUserLocations(adminId, userId, locations, ipAddress, userAgent);
        
        // Admin va Manager uchun brendlarni saqlash (agar tanlangan bo'lsa)
        if ((role === 'admin' || role === 'manager') && brands.length > 0) {
            await db('user_brands').where('user_id', userId).del();
            const brandRecords = brands.map(brandId => ({
                user_id: userId,
                brand_id: brandId
            }));
            await db('user_brands').insert(brandRecords);
        }
        
        // Admin uchun ham filiallarni saqlash (agar tanlangan bo'lsa)
        // updateUserLocations allaqachon chaqirilgan, lekin agar locations bo'sh bo'lsa ham ishlaydi
        
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
        
        // WebSocket orqali realtime yuborish - yangi foydalanuvchi yaratildi
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_created', {
                userId: userId,
                username: username,
                fullname: fullname,
                role: role,
                status: 'active',
                created_by: adminId,
                locations: locations,
                brands: brands
            });
        }
        
        // Superadmin yaratilganda avtomatik login qilish imkoniyati
        // Superadmin yaratilganda, login ma'lumotlarini qaytarish (faqat bir marta)
        if (role === 'superadmin' || role === 'super_admin') {
            if (global.broadcastWebSocket) {
                global.broadcastWebSocket('user_created', {
                    userId: userId,
                    username: username,
                    fullname: fullname,
                    role: role,
                    created_by: adminId
                });
            }
            
            return res.status(201).json({ 
                message: "Superadmin muvaffaqiyatli yaratildi.",
                autoLogin: true,
                loginData: {
                    username: username,
                    password: password
                },
                redirectUrl: '/admin'
            });
        }
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_created', {
                userId: userId,
                username: username,
                fullname: fullname,
                role: role,
                status: 'active',
                created_by: adminId
            });
        }
        
        res.status(201).json({ 
            message: "Foydalanuvchi muvaffaqiyatli qo'shildi."
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: "Bu nomdagi foydalanuvchi allaqachon mavjud." });
        }
        log.error("/api/users POST xatoligi:", error.message);
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
    
    // Foydalanuvchi ma'lumotlarini olish
    const targetUser = await db('users').where('id', userId).first();
    if (!targetUser) {
        return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
    }
    
    const targetUserRole = targetUser.role;
    const isTargetSuperadmin = targetUserRole === 'superadmin' || targetUserRole === 'super_admin';
    const isCurrentUserSuperadmin = currentUserRole === 'superadmin' || currentUserRole === 'super_admin';
    
    // Superadmin o'zini tahrirlashga ruxsat berish (lekin rolini o'zgartirishga ruxsat bermaslik)
    const isEditingSelf = parseInt(userId) === parseInt(adminId);
    if (isTargetSuperadmin) {
        // Agar superadmin o'zini tahrirlayotgan bo'lsa, faqat login, to'liq ism, parol o'zgartirishga ruxsat berish
        if (isEditingSelf) {
            // Rol o'zgartirishga ruxsat bermaslik
            if (role !== targetUserRole) {
                return res.status(403).json({ message: "Superadmin o'z rolini o'zgartira olmaydi." });
            }
        } else {
            // Superadmin boshqa superadminni tahrirlashga ruxsat bermaslik
            return res.status(403).json({ message: "Superadmin boshqa superadminni tahrirlash mumkin emas." });
        }
    }
    
    // Superadmin yaratish faqat superadmin tomonidan mumkin (lekin superadmin allaqachon mavjud bo'lsa, yaratish mumkin emas)
    if ((role === 'superadmin' || role === 'super_admin') && 
        currentUserRole !== 'superadmin' && currentUserRole !== 'super_admin') {
        return res.status(403).json({ message: "Superadmin yaratish faqat superadmin tomonidan mumkin." });
    }
    
    // Superadmin faqat bitta bo'lishi kerak
    if (role === 'superadmin' || role === 'super_admin') {
        const existingSuperAdmin = await db('users')
            .whereIn('role', ['superadmin', 'super_admin'])
            .where('id', '!=', userId) // Joriy foydalanuvchini hisobga olmaslik
            .first();
        if (existingSuperAdmin) {
            return res.status(403).json({ message: "Superadmin faqat bitta bo'lishi mumkin. Mavjud superadmin: " + existingSuperAdmin.username });
        }
    }
    
    // Superadmin uchun hech qanday shartlar yo'q
    if (role === 'superadmin' || role === 'super_admin') {
        // Superadmin uchun filiallar va brendlar shart emas
    } else {
        // Boshqa rollar uchun rol shartlarini tekshirish
        const roleData = await db('roles').where('role_name', role).first();
        if (roleData) {
            const requiresLocations = roleData.requires_locations !== null && roleData.requires_locations !== undefined 
                ? Boolean(roleData.requires_locations) 
                : null;
            const requiresBrands = roleData.requires_brands !== null && roleData.requires_brands !== undefined 
                ? Boolean(roleData.requires_brands) 
                : null;
            
            // Agar filiallar majburiy bo'lsa
            if (requiresLocations === true && locations.length === 0) {
                return res.status(400).json({ message: `"${role}" roli uchun kamida bitta filial tanlanishi shart.` });
            }
            // Agar brendlar majburiy bo'lsa
            if (requiresBrands === true && brands.length === 0) {
                return res.status(400).json({ message: `"${role}" roli uchun kamida bitta brend tanlanishi shart.` });
            }
        }
    }

    try {
        // Superadmin o'zini tahrirlayotgan bo'lsa, login, to'liq ism, parol va device limit o'zgartirish
        if (isTargetSuperadmin && isEditingSelf) {
            // Username, fullname va device_limit o'zgartirish
            const updateData = {
                username: req.body.username || targetUser.username,
                fullname: fullname || targetUser.fullname,
                updated_at: db.fn.now()
            };
            
            // Device limit o'zgartirish (agar berilgan bo'lsa)
            if (device_limit !== undefined && device_limit !== null) {
                const deviceLimitValue = parseInt(device_limit);
                if (!isNaN(deviceLimitValue) && deviceLimitValue >= 0) {
                    updateData.device_limit = deviceLimitValue;
                }
            }
            
            // Parol o'zgartirish (agar berilgan bo'lsa)
            if (req.body.password) {
                const bcrypt = require('bcrypt');
                const saltRounds = 10;
                updateData.password = await bcrypt.hash(req.body.password, saltRounds);
            }
            
            await db('users')
                .where('id', userId)
                .update(updateData);
            
            // Audit log
            await userRepository.logAction(adminId, 'update_self', 'user', userId, { 
                username: updateData.username, 
                fullname: updateData.fullname,
                password_changed: !!req.body.password,
                ip: ipAddress, 
                userAgent 
            });
        } else {
            // Oddiy foydalanuvchilar uchun to'liq yangilash
            await userRepository.updateUser(adminId, userId, role, device_limit, fullname, ipAddress, userAgent);
            await userRepository.updateUserLocations(adminId, userId, locations, ipAddress, userAgent);
            
            // Brendlarni yangilash
            await db('user_brands').where('user_id', userId).del();
            if (brands && brands.length > 0) {
                const brandRecords = brands.map(brandId => ({
                    user_id: userId,
                    brand_id: brandId
                }));
                await db('user_brands').insert(brandRecords);
            }
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

        // Cache'ni tozalash - user o'zgarganda
        const { clearAllUserCaches } = require('../utils/cacheUtils.js');
        clearAllUserCaches(parseInt(userId, 10));

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            const updatedUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_updated', {
                userId: parseInt(userId),
                username: updatedUser?.username,
                fullname: updatedUser?.fullname,
                role: updatedUser?.role,
                status: updatedUser?.status,
                updated_by: adminId
            });
        }
        
        res.json({ message: "Foydalanuvchi ma'lumotlari muvaffaqiyatli yangilandi." });
    } catch (error) {
        log.error(`/api/users/${userId} PUT xatoligi:`, error.message);
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
        
        // Cache'ni tozalash - user status o'zgarganda
        const { clearAllUserCaches } = require('../utils/cacheUtils.js');
        clearAllUserCaches(parseInt(userId, 10));
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await db('users').where('id', userId).first();
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket && user) {
            global.broadcastWebSocket('account_status_changed', {
                userId: parseInt(userId),
                username: user.username,
                fullname: user.fullname,
                status: status,
                previousStatus: user.status,
                changedBy: adminId
            });
        }
        
        const message = status === 'active' ? "Foydalanuvchi muvaffaqiyatli aktivlashtirildi." : "Foydalanuvchi muvaffaqiyatli bloklandi va barcha sessiyalari tugatildi.";
        res.json({ message });
    } catch (error) {
        log.error(`/api/users/${userId}/status PUT xatoligi:`, error.message);
        res.status(500).json({ message: "Foydalanuvchi holatini o'zgartirishda xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHI SO'ROVINI TASDIQLASH (YANGILANGAN TO'LIQ MANTIQ) ===
// ===================================================================
// Middleware'lardan oldin log qo'shish
router.put('/:id/approve', (req, res, next) => {
    next();
}, isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = req.params.id;
    const { role, locations = [], brands = [] } = req.body;
    const adminId = req.session.user.id;
    const currentUserRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!role) {
        return res.status(400).json({ message: "Rol tanlanishi shart." });
    }
    
    // Superadmin yaratish faqat superadmin tomonidan mumkin
    if ((role === 'superadmin' || role === 'super_admin') && 
        currentUserRole !== 'superadmin' && currentUserRole !== 'super_admin') {
        return res.status(403).json({ message: "Superadmin yaratish faqat superadmin tomonidan mumkin." });
    }
    
    // Rol bazada mavjudligini tekshirish va talablarini olish
    const roleData = await db('roles').where({ role_name: role }).first();
    if (!roleData) {
        return res.status(400).json({ message: "Tanlangan rol mavjud emas." });
    }
    
    // Rol shartlarini tekshirish
    // SQLite'da 0 (false) va null o'rtasidagi farqni to'g'ri aniqlash
    // Agar qiymat null yoki undefined bo'lsa, bu "belgilanmagan" degan ma'noni anglatadi
    // SQLite'da null tekshiruvi: agar qiymat null yoki undefined bo'lsa
    const isLocationsNull = (roleData.requires_locations === null || roleData.requires_locations === undefined);
    const isBrandsNull = (roleData.requires_brands === null || roleData.requires_brands === undefined);
    
    // Agar null bo'lsa, null qaytarish, aks holda boolean qiymatni qaytarish
    const isLocationsRequired = isLocationsNull 
        ? null 
        : Boolean(roleData.requires_locations);
    const isBrandsRequired = isBrandsNull 
        ? null 
        : Boolean(roleData.requires_brands);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    const isLocationsUndefined = (isLocationsRequired === null || isLocationsRequired === undefined);
    const isBrandsUndefined = (isBrandsRequired === null || isBrandsRequired === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    if (isRequirementsUndefined) {
        return res.status(400).json({ 
            message: `"${role}" roli uchun shartlar belgilanmagan. Avval shart belgilanishi kerak.`,
            requires_locations: roleData.requires_locations,
            requires_brands: roleData.requires_brands
        });
    }
    
    // Validatsiya: Agar shartlar majburiy bo'lsa, tanlanganlar bo'lishi kerak
    
    if (isLocationsRequired === true) {
        if (locations.length === 0) {
            return res.status(400).json({ 
                message: `"${role}" roli uchun kamida bitta filial tanlanishi shart.`,
                requires_locations: true,
                locations_provided: locations.length
            });
        }
    }
    
    if (isBrandsRequired === true) {
        if (brands.length === 0) {
            return res.status(400).json({ 
                message: `"${role}" roli uchun kamida bitta brend tanlanishi shart.`,
                requires_brands: true,
                brands_provided: brands.length
            });
        }
    }

    try {
        // 1. Foydalanuvchi va uning vaqtinchalik ma'lumotlarini tekshirish
        const user = await db('users').where({ id: userId }).first();
        if (!user || !['pending_approval', 'pending_telegram_subscription'].includes(user.status)) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi yoki allaqachon tasdiqlangan." });
        }

        const tempReg = await db('pending_registrations').where({ user_id: userId }).first();
        if (!tempReg) {
            return res.status(404).json({ message: "Ro'yxatdan o'tish so'rovi topilmadi yoki eskirgan." });
        }
        
        const userData = JSON.parse(tempReg.user_data);
        const { password, secret_word } = userData;

        // 2. Foydalanuvchini aktivlashtirish (bitta tranzaksiya ichida)
        await db.transaction(async trx => {
            // MUHIM: Agar telegram_chat_id mavjud bo'lsa, is_telegram_connected ni true ga o'rnatish kerak
            const updateData = {
                status: 'active',
                role: role,
                must_delete_creds: true // Kirish ma'lumotlari yuborilgach, xabarni o'chirish uchun belgi
            };
            
            // Agar telegram_chat_id mavjud bo'lsa, is_telegram_connected ni true ga o'rnatish
            if (user.telegram_chat_id) {
                updateData.is_telegram_connected = true;
            }
            
            await trx('users').where({ id: userId }).update(updateData);

            await trx('user_locations').where({ user_id: userId }).del();
            if (locations && locations.length > 0) {
                const locationsToInsert = locations.map(loc => ({ user_id: userId, location_name: loc }));
                await trx('user_locations').insert(locationsToInsert);
            }
            
            // Brendlarni saqlash (agar rol shartlari bo'yicha kerak bo'lsa)
            await trx('user_brands').where({ user_id: userId }).del();
            if (brands && brands.length > 0) {
                const brandRecords = brands.map(brandId => ({
                    user_id: userId,
                    brand_id: brandId
                }));
                await trx('user_brands').insert(brandRecords);
            }
        });
        
        // Cache'ni tozalash - user approve qilinganda
        const { clearAllUserCaches } = require('../utils/cacheUtils.js');
        clearAllUserCaches(parseInt(userId, 10));
        
        // WebSocket orqali realtime yuborish - foydalanuvchi tasdiqlandi
        if (global.broadcastWebSocket) {
            const updatedUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('account_status_changed', {
                userId: parseInt(userId),
                username: updatedUser?.username,
                fullname: updatedUser?.fullname,
                status: 'active',
                previousStatus: 'pending_approval',
                changedBy: adminId
            });
        }

        // 3. Foydalanuvchiga kirish ma'lumotlarini Telegram orqali yuborish
        let credentialsSent = false;
        if (user.telegram_chat_id) {
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
            } catch (telegramError) {
                log.error(`Telegram yuborishda xatolik:`, telegramError.message);
            }
        }

        // 4. Vaqtinchalik ma'lumotlarni tozalash
        await db('pending_registrations').where({ user_id: userId }).del();

        // 5. Audit jurnaliga yozish
        await userRepository.logAction(adminId, 'approve_user', 'user', userId, { 
            approved_role: role, 
            locations, 
            brands,
            requires_locations: roleData.requires_locations,
            requires_brands: roleData.requires_brands,
            ip: ipAddress, 
            userAgent 
        });
        
        // 6. Adminga yakuniy javobni qaytarish
        const message = `Foydalanuvchi muvaffaqiyatli tasdiqlandi. ${credentialsSent ? "Kirish ma'lumotlari uning Telegramiga yuborildi." : "Foydalanuvchi botga ulanmaganligi sababli kirish ma'lumotlari yuborilmadi."}`;
        
        res.json({ 
            message: message,
            credentials_sent: credentialsSent
        });

    } catch (error) {
        log.error(`/api/users/${userId}/approve PUT xatoligi:`, error.message);
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

        // WebSocket orqali realtime yuborish - foydalanuvchi rad etildi
        if (global.broadcastWebSocket) {
            const rejectedUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('account_status_changed', {
                userId: parseInt(userId),
                username: rejectedUser?.username,
                fullname: rejectedUser?.fullname,
                status: 'archived',
                previousStatus: rejectedUser?.status || 'pending_approval',
                changedBy: adminId
            });
        }

        res.json({ message: "Foydalanuvchi so'rovi muvaffaqiyatli rad etildi va arxivlandi." });
    } catch (error) {
        log.error(`/api/users/${userId}/reject PUT xatoligi:`, error.message);
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
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            const user = await db('users').where('id', req.params.id).first();
            global.broadcastWebSocket('user_password_changed', {
                userId: parseInt(req.params.id),
                username: user?.username,
                changed_by: adminId
            });
        }
        
        res.json({ message: "Parol muvaffaqiyatli yangilandi." });
    } catch (error) {
        log.error(`/api/users/${req.params.id}/password PUT xatoligi:`, error.message);
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
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            const user = await db('users').where('id', req.params.id).first();
            global.broadcastWebSocket('user_secret_word_changed', {
                userId: parseInt(req.params.id),
                username: user?.username,
                changed_by: adminId
            });
        }
        
        res.json({ message: "Maxfiy so'z muvaffaqiyatli o'rnatildi/yangilandi." });
    } catch (error) {
        log.error(`/api/users/${req.params.id}/secret-word PUT xatoligi:`, error.message);
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
        log.error('Get user permissions error:', error.message);
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

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            const user = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_permissions_updated', {
                userId: parseInt(userId),
                username: user?.username,
                type: type,
                permissions_count: permissions.length,
                updated_by: adminId
            });
        }

        res.json({ message: 'Huquqlar muvaffaqiyatli saqlandi' });
    } catch (error) {
        log.error('Save user permissions error:', error.message);
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

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            const user = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_permissions_reset', {
                userId: parseInt(userId),
                username: user?.username,
                reset_by: adminId
            });
        }

        res.json({ message: 'Barcha maxsus huquqlar o\'chirildi' });
    } catch (error) {
        log.error('Reset user permissions error:', error.message);
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
        log.error('Avatar olishda xatolik:', error.message);
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
        log.error('Avatar yangilashda xatolik:', error.message);
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
        log.error('Avatar o\'chirishda xatolik:', error.message);
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
        log.error("Parol so'rovlarini olish xatoligi:", error.message);
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
        log.error("So'rovni tasdiqlash xatoligi:", error.message);
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
        log.error("So'rovni rad etish xatoligi:", error.message);
        res.status(500).json({ message: "So'rovni rad etishda xatolik." });
    }
});

// Foydalanuvchi o'chirishdan oldin ma'lumotlarni tekshirish
router.get('/:id/check-data', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Noto\'g\'ri foydalanuvchi ID' });
        }

        // Foydalanuvchi mavjudligini tekshirish
        const user = await db('users').where({ id: userId }).first();
        if (!user) {
            return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
        }

        // Jadval mavjudligini tekshirish (eski backup DBlarda bo'lmasligi mumkin)
        const [hasReportsTable, hasHistoryTable, hasComparisonsTable] = await Promise.all([
            db.schema.hasTable('reports'),
            db.schema.hasTable('report_history'),
            db.schema.hasTable('comparisons')
        ]);

        // Foydalanuvchi ma'lumotlarini tekshirish (jadval bo'lmasa 0 deb hisoblaymiz)
        const [reportsCount, historyCount, comparisonsCount] = await Promise.all([
            hasReportsTable
                ? db('reports').where({ created_by: userId }).count('* as count').first()
                : Promise.resolve({ count: 0 }),
            hasHistoryTable
                ? db('report_history').where({ changed_by: userId }).count('* as count').first()
                : Promise.resolve({ count: 0 }),
            hasComparisonsTable
                ? db('comparisons').where({ created_by: userId }).count('* as count').first()
                : Promise.resolve({ count: 0 })
        ]);

        const hasData = {
            reports: parseInt(reportsCount.count) || 0,
            history: parseInt(historyCount.count) || 0,
            comparisons: parseInt(comparisonsCount.count) || 0
        };

        const canDeleteSafely = hasData.reports === 0 && hasData.history === 0 && hasData.comparisons === 0;

        res.json({
            canDeleteSafely,
            hasData
        });
    } catch (error) {
        log.error(`Check data xatoligi. userId=${req.params.id}`, error.message);
        res.status(500).json({ message: 'Ma\'lumotlarni tekshirishda xatolik' });
    }
});

// Foydalanuvchini o'chirish
router.delete('/:id', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const forceDelete = req.query.forceDelete === 'true';
        const adminId = req.session.user.id;
        const ipAddress = req.session.ip_address;
        const userAgent = req.session.user_agent;

        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Noto\'g\'ri foydalanuvchi ID' });
        }

        // Foydalanuvchi mavjudligini tekshirish
        const user = await db('users').where({ id: userId }).first();
        if (!user) {
            return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
        }

        // O'zini o'chirishni oldini olish
        if (userId === adminId) {
            return res.status(403).json({ message: 'O\'zingizni o\'chira olmaysiz' });
        }

        // Superadmin o'chirishni oldini olish
        if ((user.role === 'superadmin' || user.role === 'super_admin') && 
            req.session.user.role !== 'superadmin' && req.session.user.role !== 'super_admin') {
            return res.status(403).json({ message: 'Superadminni faqat superadmin o\'chira oladi' });
        }

        // Jadval mavjudligini tekshirish (eski backup DBlarda bo'lmasligi mumkin)
        const [hasReportsTable, hasHistoryTable, hasComparisonsTable] = await Promise.all([
            db.schema.hasTable('reports'),
            db.schema.hasTable('report_history'),
            db.schema.hasTable('comparisons')
        ]);

        // Ma'lumotlarni tekshirish (jadval bo'lmasa 0 deb hisoblaymiz)
        const [reportsCount, historyCount, comparisonsCount] = await Promise.all([
            hasReportsTable
                ? db('reports').where({ created_by: userId }).count('* as count').first()
                : Promise.resolve({ count: 0 }),
            hasHistoryTable
                ? db('report_history').where({ changed_by: userId }).count('* as count').first()
                : Promise.resolve({ count: 0 }),
            hasComparisonsTable
                ? db('comparisons').where({ created_by: userId }).count('* as count').first()
                : Promise.resolve({ count: 0 })
        ]);

        const hasData = {
            reports: parseInt(reportsCount.count) || 0,
            history: parseInt(historyCount.count) || 0,
            comparisons: parseInt(comparisonsCount.count) || 0
        };

        // Agar ma'lumot bor bo'lsa va forceDelete false bo'lsa, xatolik qaytarish
        if (!forceDelete && (hasData.reports > 0 || hasData.history > 0 || hasData.comparisons > 0)) {
            return res.status(400).json({ 
                message: 'Foydalanuvchi ma\'lumotlari mavjud. Force delete parametri bilan o\'chirish mumkin.',
                hasData 
            });
        }

        // Foydalanuvchini o'chirish (yoki ma'lumotlarni null qilish)
        if (forceDelete) {
            // Ma'lumotlarni null qilish
            await Promise.all([
                db('reports').where({ created_by: userId }).update({ created_by: null }),
                db('report_history').where({ changed_by: userId }).update({ changed_by: null }),
                db('comparisons').where({ created_by: userId }).update({ created_by: null })
            ]);
        }

        // Foydalanuvchini o'chirish
        await db('users').where({ id: userId }).delete();

        // Audit log
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'delete_user',
            target_type: 'user',
            target_id: userId,
            details: JSON.stringify({ 
                username: user.username, 
                forceDelete,
                hasData 
            }),
            ip_address: ipAddress,
            user_agent: userAgent
        });

        res.json({ message: 'Foydalanuvchi muvaffaqiyatli o\'chirildi' });
    } catch (error) {
        log.error('Foydalanuvchini o\'chirish xatoligi:', error.message);
        res.status(500).json({ message: 'Foydalanuvchini o\'chirishda xatolik' });
    }
});

// POST /api/users/:id/generate-telegram-link - Foydalanuvchi uchun Telegram obunasi linkini yaratish
router.post('/:id/generate-telegram-link', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = parseInt(req.params.id);
    const adminId = req.session.user.id;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    if (!userId || isNaN(userId)) {
        return res.status(400).json({ message: "Foydalanuvchi ID noto'g'ri." });
    }

    try {
        const { createLogger } = require('../utils/logger.js');
        const log = createLogger('TELEGRAM_LINK');

        // Foydalanuvchini tekshirish
        const user = await db('users').where({ id: userId }).first();
        
        if (!user) {
            log.error(`[GENERATE_LINK] Foydalanuvchi topilmadi: ${userId}`);
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }

        // Superadmin uchun bot obunasi majburiy emas
        const isSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
        if (isSuperAdmin) {
            log.error(`[GENERATE_LINK] Superadmin uchun link yaratishga urinish: ${userId}`);
            return res.status(400).json({ message: "Superadmin uchun bot obunasi majburiy emas." });
        }

        // Agar allaqachon ulangan bo'lsa
        if (user.telegram_chat_id && user.is_telegram_connected) {
            return res.status(400).json({ 
                message: "Foydalanuvchi allaqachon Telegram'ga ulangan.",
                alreadyConnected: true,
                telegram_chat_id: user.telegram_chat_id,
                telegram_username: user.telegram_username
            });
        }

        // Bot username olish
        const botUsernameSetting = await db('settings').where({ key: 'telegram_bot_username' }).first();
        const botUsername = botUsernameSetting ? botUsernameSetting.value : null;

        if (!botUsername) {
            log.error(`[GENERATE_LINK] Bot username topilmadi. Sozlamalarni tekshiring.`);
            return res.status(500).json({ message: "Bot username topilmadi. Iltimos, sozlamalarni tekshiring." });
        }

        // Eski tokenlarni o'chirish (faqat bot_connect_ tokenlari)
        const deletedTokens = await db('magic_links')
            .where({ user_id: userId })
            .where('token', 'like', 'bot_connect_%')
            .del();

        // Yangi token yaratish
        const { v4: uuidv4 } = require('uuid');
        const token = `bot_connect_${uuidv4()}`;
        const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa

        // Yangi token yaratish
        await db('magic_links').insert({
            token: token,
            user_id: userId,
            expires_at: expires_at.toISOString()
        });

        // Bot havolasi yaratish
        const botLink = `https://t.me/${botUsername}?start=${token}`;

        // Audit log
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'generate_telegram_link',
            target_type: 'user',
            target_id: userId,
            details: JSON.stringify({ 
                username: user.username,
                token: token.substring(0, 20) + '...',
                expires_at: expires_at.toISOString()
            }),
            ip_address: ipAddress,
            user_agent: userAgent
        });

        res.json({
            success: true,
            token: token,
            botLink: botLink,
            expiresAt: expires_at.toISOString(),
            message: "Telegram obunasi linki yaratildi. Bu havola 10 daqiqa amal qiladi."
        });

    } catch (error) {
        const { createLogger } = require('../utils/logger.js');
        const log = createLogger('TELEGRAM_LINK');
        log.error(`[GENERATE_LINK] Xatolik: ${error.message}`, {
            userId,
            adminId,
            stack: error.stack
        });
        res.status(500).json({ message: "Link yaratishda xatolik yuz berdi." });
    }
});

// POST /api/users/:id/clear-telegram - Foydalanuvchining Telegram bog'lanishini tozalash
router.post('/:id/clear-telegram', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const adminId = req.session.user.id;
    const adminRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    // Faqat superadmin'ga ruxsat beramiz (frontend ham shuni kutadi)
    if (adminRole !== 'superadmin' && adminRole !== 'super_admin') {
        return res.status(403).json({ message: "Telegram bog'lanishni faqat superadmin tozalashi mumkin." });
    }

    if (!userId || Number.isNaN(userId)) {
        return res.status(400).json({ message: "Foydalanuvchi ID noto'g'ri." });
    }

    try {
        const { createLogger } = require('../utils/logger.js');
        const log = createLogger('TELEGRAM_CLEAR');

        const user = await db('users').where({ id: userId }).first();
        if (!user) {
            log.error(`[CLEAR] Foydalanuvchi topilmadi: ${userId}`);
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }

        // Superadmin uchun Telegram bog'lanishni tozalashga ruxsat bermaymiz
        const isTargetSuperAdmin = user.role === 'superadmin' || user.role === 'super_admin';
        if (isTargetSuperAdmin) {
            log.error(`[CLEAR] Superadmin uchun Telegram bog'lanishni tozalashga urinish: ${userId}`);
            return res.status(400).json({ message: "Superadmin uchun Telegram bog'lanishini tozalashga ruxsat berilmaydi." });
        }

        // Agar foydalanuvchi allaqachon botga ulanmagan bo'lsa
        if (!user.telegram_chat_id && !user.is_telegram_connected) {
            return res.status(400).json({ message: "Foydalanuvchi Telegram botga ulanmagan." });
        }

        await db.transaction(async trx => {
            // Foydalanuvchi jadvalidagi Telegram maydonlarini tozalash
            await trx('users')
                .where({ id: userId })
                .update({
                    telegram_chat_id: null,
                    telegram_username: null,
                    is_telegram_connected: false,
                    updated_at: db.fn.now()
                });

            // Ushbu foydalanuvchi uchun barcha bot_connect tokenlarini o'chirish
            const deletedTokens = await trx('magic_links')
                .where({ user_id: userId })
                .where('token', 'like', 'bot_connect_%')
                .del();

        });

        // Audit log
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'clear_telegram_connection',
            target_type: 'user',
            target_id: userId,
            details: JSON.stringify({
                username: user.username,
                previous_chat_id: user.telegram_chat_id,
                previous_username: user.telegram_username
            }),
            ip_address: ipAddress,
            user_agent: userAgent
        });

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('telegram_connection_cleared', {
                userId,
                username: user.username
            });
        }

        const message = "Foydalanuvchining Telegram bog'lanishi muvaffaqiyatli tozalandi.";

        res.json({ message });
    } catch (error) {
        const { createLogger } = require('../utils/logger.js');
        const log = createLogger('TELEGRAM_CLEAR');
        log.error(`[CLEAR] Xatolik: ${error.message}`, {
            userId,
            adminId,
            stack: error.stack
        });
        res.status(500).json({ message: "Telegram bog'lanishni tozalashda kutilmagan xatolik." });
    }
});

module.exports = router;

