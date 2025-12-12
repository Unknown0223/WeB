const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const userRepository = require('../data/userRepository.js');
const { refreshUserSessions } = require('../utils/sessionManager.js');
const { sendToTelegram } = require('../utils/bot.js');
const geoip = require('geoip-lite');
const ExcelJS = require('exceljs');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('USERS');


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
        log.error("/api/users GET xatoligi:", error);
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
        log.error("/api/users/pending GET xatoligi:", error);
        res.status(500).json({ message: "So'rovlarni yuklashda xatolik." });
    }
});

// GET /api/users/pending/export - Pending users ro'yxatini Excel formatida export qilish
router.get('/pending/export', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
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

        // Excel workbook yaratish
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Yangi Foydalanuvchi So\'rovlari');

        // Sarlavhalar
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Foydalanuvchi nomi', key: 'username', width: 25 },
            { header: 'To\'liq ism', key: 'fullname', width: 30 },
            { header: 'Telegram ID', key: 'telegram_id', width: 15 },
            { header: 'Telegram Username', key: 'telegram_username', width: 25 },
            { header: 'Holat', key: 'status_text', width: 30 },
            { header: 'So\'rov yuborilgan sana', key: 'created_at', width: 25 }
        ];

        // Status matnlari
        const statusMap = {
            'pending_approval': 'Admin tasdiqlashini kutmoqda',
            'pending_telegram_subscription': 'Botga obuna bo\'lishni kutmoqda',
            'status_in_process': 'Jarayonda'
        };

        // Ma'lumotlarni qo'shish
        pendingUsers.forEach((user, index) => {
            const row = worksheet.addRow({
                id: user.id,
                username: user.username || '-',
                fullname: user.fullname || '-',
                telegram_id: user.telegram_chat_id || '-',
                telegram_username: user.telegram_username ? `@${user.telegram_username}` : '-',
                status_text: statusMap[user.status] || user.status,
                created_at: user.created_at ? new Date(user.created_at).toLocaleString('uz-UZ') : '-'
            });

            // Ranglar qo'shish - status bo'yicha
            const statusCell = row.getCell('status_text');
            if (user.status === 'pending_approval') {
                statusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFE0B2' } // Sariq
                };
            } else if (user.status === 'pending_telegram_subscription') {
                statusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFF59D' } // Yengil sariq
                };
            } else if (user.status === 'status_in_process') {
                statusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFCC80' } // To'q sariq
                };
            }

            // Qatorlar uchun alternativ ranglar
            if (index % 2 === 0) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF5F5F5' } // Yengil kulrang
                };
            }
        });

        // Sarlavha qatorini formatlash (ko'k rang - rasmdagidek)
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F4788' } // Ko'k rang (rasmdagidek)
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 25;

        // Barcha qatorlar uchun alignment
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.alignment = { vertical: 'middle', horizontal: 'left' };
                row.height = 20;
            }
        });

        // Border qo'shish
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        // Response
        const timestamp = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="yangi_foydalanuvchi_so'rovlari_${timestamp}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        log.error("/api/users/pending/export GET xatoligi:", error);
        log.error("Error stack:", error.stack);
        log.error("Error message:", error.message);
        res.status(500).json({ 
            message: "Excel faylni yaratishda xatolik.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
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
        log.error(`/api/users/me/sessions GET xatoligi:`, error);
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
        log.error(`/api/users/${userId}/settings GET xatoligi:`, error);
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
        log.error(`/api/users/${userId}/sessions GET xatoligi:`, error);
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
            log.debug(`📡 [USERS] Yangi foydalanuvchi yaratildi, WebSocket orqali yuborilmoqda...`);
            const newUser = await db('users').where('id', userId).first();
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
            log.debug(`✅ [USERS] WebSocket yuborildi: user_created`);
        }
        
        // Superadmin yaratilganda avtomatik login qilish imkoniyati
        // Superadmin yaratilganda, login ma'lumotlarini qaytarish (faqat bir marta)
        if (role === 'superadmin' || role === 'super_admin') {
            if (global.broadcastWebSocket) {
                log.debug(`📡 [USERS] Yangi superadmin yaratildi, WebSocket orqali yuborilmoqda...`);
                const newUser = await db('users').where('id', userId).first();
                global.broadcastWebSocket('user_created', {
                    userId: userId,
                    username: username,
                    fullname: fullname,
                    role: role,
                    created_by: adminId
                });
                log.debug(`✅ [USERS] WebSocket yuborildi: user_created`);
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
            log.debug(`📡 [USERS] Yangi foydalanuvchi yaratildi, WebSocket orqali yuborilmoqda...`);
            const newUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_created', {
                userId: userId,
                username: username,
                fullname: fullname,
                role: role,
                status: 'active',
                created_by: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: user_created`);
        }
        
        res.status(201).json({ 
            message: "Foydalanuvchi muvaffaqiyatli qo'shildi."
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
            return res.status(409).json({ message: "Bu nomdagi foydalanuvchi allaqachon mavjud." });
        }
        log.error("/api/users POST xatoligi:", error);
        res.status(500).json({ message: "Foydalanuvchi qo'shishda xatolik." });
    }
});

// Foydalanuvchini tahrirlash
router.put('/:id', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    log.debug('🔍 [USERS] PUT /:id - Foydalanuvchini tahrirlash so\'rovi kelindi');
    const userId = req.params.id;
    const { role, locations = [], device_limit, fullname, brands = [], user_settings } = req.body;
    const adminId = req.session.user.id;
    const currentUserRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    log.debug(`📝 [USERS] So'rov ma'lumotlari:`, {
        userId,
        requestedRole: role,
        adminId,
        currentUserRole,
        locations: locations.length,
        brands: brands.length
    });

    if (!role) {
        log.error(`❌ [USERS] Rol kiritilmagan`);
        return res.status(400).json({ message: "Rol kiritilishi shart." });
    }
    
    // Foydalanuvchi ma'lumotlarini olish
    const targetUser = await db('users').where('id', userId).first();
    if (!targetUser) {
        log.error(`❌ [USERS] Foydalanuvchi topilmadi: ${userId}`);
        return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
    }
    
    const targetUserRole = targetUser.role;
    const isTargetSuperadmin = targetUserRole === 'superadmin' || targetUserRole === 'super_admin';
    const isCurrentUserSuperadmin = currentUserRole === 'superadmin' || currentUserRole === 'super_admin';
    
    log.debug(`🔐 [USERS] Rol tekshiruvi:`, {
        targetUserRole,
        isTargetSuperadmin,
        isCurrentUserSuperadmin,
        requestedRole: role
    });
    
    // Superadmin o'zini tahrirlashga ruxsat berish (lekin rolini o'zgartirishga ruxsat bermaslik)
    const isEditingSelf = parseInt(userId) === parseInt(adminId);
    if (isTargetSuperadmin) {
        // Agar superadmin o'zini tahrirlayotgan bo'lsa, faqat login, to'liq ism, parol o'zgartirishga ruxsat berish
        if (isEditingSelf) {
            log.debug(`✅ [USERS] Superadmin o'zini tahrirlayapti - faqat login, to'liq ism, parol o'zgartirish mumkin`);
            // Rol o'zgartirishga ruxsat bermaslik
            if (role !== targetUserRole) {
                log.error(`❌ [USERS] Superadmin o'z rolini o'zgartirishga urinish!`);
                return res.status(403).json({ message: "Superadmin o'z rolini o'zgartira olmaydi." });
            }
            // Filial va brendlarni o'zgartirishga ruxsat bermaslik (superadmin barchasini ko'radi)
            // locations va brands bo'sh bo'lishi kerak yoki e'tiborsiz qoldiriladi
        } else {
            // Superadmin boshqa superadminni tahrirlashga ruxsat bermaslik
            log.error(`❌ [USERS] Superadmin boshqa superadminni tahrirlashga urinish!`);
            return res.status(403).json({ message: "Superadmin boshqa superadminni tahrirlash mumkin emas." });
        }
    }
    
    // Superadmin yaratish faqat superadmin tomonidan mumkin (lekin superadmin allaqachon mavjud bo'lsa, yaratish mumkin emas)
    if ((role === 'superadmin' || role === 'super_admin') && 
        currentUserRole !== 'superadmin' && currentUserRole !== 'super_admin') {
        log.error(`❌ [USERS] Superadmin yaratishga urinish (ruxsat yo'q)!`);
        return res.status(403).json({ message: "Superadmin yaratish faqat superadmin tomonidan mumkin." });
    }
    
    // Superadmin faqat bitta bo'lishi kerak
    if (role === 'superadmin' || role === 'super_admin') {
        const existingSuperAdmin = await db('users')
            .whereIn('role', ['superadmin', 'super_admin'])
            .where('id', '!=', userId) // Joriy foydalanuvchini hisobga olmaslik
            .first();
        if (existingSuperAdmin) {
            log.error(`❌ [USERS] Superadmin allaqachon mavjud!`);
            log.error(`   - Existing superadmin: ${existingSuperAdmin.username} (ID: ${existingSuperAdmin.id})`);
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
        log.debug(`💾 [USERS] Foydalanuvchi ma'lumotlarini yangilash...`);
        log.debug(`   - Oldingi rol: ${targetUserRole}`);
        log.debug(`   - Yangi rol: ${role}`);
        log.debug(`   - Filiallar: ${locations.length} ta`);
        log.debug(`   - Brendlar: ${brands.length} ta`);
        log.debug(`   - Superadmin o'zini tahrirlayapti: ${isTargetSuperadmin && isEditingSelf}`);
        
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
                log.debug(`   ✅ Parol yangilandi`);
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
            
            log.debug(`   ✅ Superadmin o'z ma'lumotlari yangilandi (login, to'liq ism${req.body.password ? ', parol' : ''})`);
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
                log.debug(`   ✅ Brendlar yangilandi: ${brands.length} ta`);
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
            log.debug(`   ✅ User-specific sozlamalar yangilandi`);
        }

        await refreshUserSessions(parseInt(userId, 10));
        log.debug(`   ✅ Sessiyalar yangilandi`);

        // Cache'ni tozalash - user o'zgarganda
        const { clearUserCache } = require('../utils/userAccessFilter');
        clearUserCache(parseInt(userId, 10));
        
        // User repository cache'ni ham tozalash
        if (userRepository && typeof userRepository.clearUserCache === 'function') {
            userRepository.clearUserCache(parseInt(userId, 10));
        }

        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [USERS] Foydalanuvchi yangilandi, WebSocket orqali yuborilmoqda...`);
            const updatedUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_updated', {
                userId: parseInt(userId),
                username: updatedUser?.username,
                fullname: updatedUser?.fullname,
                role: updatedUser?.role,
                status: updatedUser?.status,
                updated_by: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: user_updated`);
        }

        log.debug(`✅ [USERS] Foydalanuvchi muvaffaqiyatli yangilandi!`);
        log.debug(`   - User ID: ${userId}`);
        log.debug(`   - Username: ${targetUser.username}`);
        log.debug(`   - Oldingi rol: ${targetUserRole} -> Yangi rol: ${role}`);
        
        res.json({ message: "Foydalanuvchi ma'lumotlari muvaffaqiyatli yangilandi." });
    } catch (error) {
        log.error(`❌ [USERS] /api/users/${userId} PUT xatoligi:`, error);
        log.error(`   - Error stack:`, error.stack);
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
        
        // Foydalanuvchi ma'lumotlarini olish
        const user = await db('users').where('id', userId).first();
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket && user) {
            log.debug(`📡 [USERS] Account status o'zgardi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('account_status_changed', {
                userId: parseInt(userId),
                username: user.username,
                fullname: user.fullname,
                status: status,
                previousStatus: user.status,
                changedBy: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: account_status_changed`);
        }
        
        const message = status === 'active' ? "Foydalanuvchi muvaffaqiyatli aktivlashtirildi." : "Foydalanuvchi muvaffaqiyatli bloklandi va barcha sessiyalari tugatildi.";
        res.json({ message });
    } catch (error) {
        log.error(`/api/users/${userId}/status PUT xatoligi:`, error);
        res.status(500).json({ message: "Foydalanuvchi holatini o'zgartirishda xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHI SO'ROVINI TASDIQLASH (YANGILANGAN TO'LIQ MANTIQ) ===
// ===================================================================
// Middleware'lardan oldin log qo'shish
router.put('/:id/approve', (req, res, next) => {
    log.debug('🔍 [BACKEND] PUT /:id/approve endpoint\'ga so\'rov kelindi');
    log.debug(`   - Method: ${req.method}`);
    log.debug(`   - Path: ${req.path}`);
    log.debug(`   - Original URL: ${req.originalUrl}`);
    log.debug(`   - User ID param: ${req.params.id}`);
    log.debug(`   - Body:`, JSON.stringify(req.body, null, 2));
    log.debug(`   - Session ID: ${req.sessionID}`);
    log.debug(`   - Session user: ${req.session?.user ? 'MAVJUD' : 'YO\'Q'}`);
    next();
}, isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    log.debug('🚀 ========================================');
    log.debug('🚀 [BACKEND] Foydalanuvchi tasdiqlash so\'rovi kelindi');
    log.debug('🚀 ========================================');
    
    const userId = req.params.id;
    const { role, locations = [], brands = [] } = req.body;
    const adminId = req.session.user.id;
    const currentUserRole = req.session.user.role;
    const ipAddress = req.session.ip_address;
    const userAgent = req.session.user_agent;

    log.debug(`📝 [BACKEND] 1. So'rov ma'lumotlari:`);
    log.debug(`   - User ID: ${userId}`);
    log.debug(`   - Role: ${role}`);
    log.debug(`   - Locations: ${JSON.stringify(locations)}`);
    log.debug(`   - Brands: ${JSON.stringify(brands)}`);
    log.debug(`   - Admin ID: ${adminId}`);
    log.debug(`   - Admin Role: ${currentUserRole}`);
    log.debug(`   - IP Address: ${ipAddress}`);

    if (!role) {
        log.error(`❌ [BACKEND] 2. XATOLIK: Rol tanlanmagan!`);
        return res.status(400).json({ message: "Rol tanlanishi shart." });
    }
    
    // Superadmin yaratish faqat superadmin tomonidan mumkin
    if ((role === 'superadmin' || role === 'super_admin') && 
        currentUserRole !== 'superadmin' && currentUserRole !== 'super_admin') {
        log.error(`❌ [BACKEND] 2. XATOLIK: Superadmin yaratishga urinish!`);
        log.error(`   - Requested role: ${role}`);
        log.error(`   - Current user role: ${currentUserRole}`);
        return res.status(403).json({ message: "Superadmin yaratish faqat superadmin tomonidan mumkin." });
    }
    
    // Rol bazada mavjudligini tekshirish va talablarini olish
    log.debug(`🔍 [BACKEND] 3. Rol ma'lumotlarini bazadan olish...`);
    const roleData = await db('roles').where({ role_name: role }).first();
    if (!roleData) {
        log.error(`❌ [BACKEND] 3. XATOLIK: Rol topilmadi!`);
        log.error(`   - Requested role: ${role}`);
        return res.status(400).json({ message: "Tanlangan rol mavjud emas." });
    }
    
    log.debug(`✅ [BACKEND] 3. Rol topildi:`);
    log.debug(`   - Role Name: ${roleData.role_name}`);
    log.debug(`   - Requires Locations: ${roleData.requires_locations} (type: ${typeof roleData.requires_locations})`);
    log.debug(`   - Requires Brands: ${roleData.requires_brands} (type: ${typeof roleData.requires_brands})`);
    log.debug(`   - Requires Locations === null: ${roleData.requires_locations === null}`);
    log.debug(`   - Requires Brands === null: ${roleData.requires_brands === null}`);
    log.debug(`   - Requires Locations === undefined: ${roleData.requires_locations === undefined}`);
    log.debug(`   - Requires Brands === undefined: ${roleData.requires_brands === undefined}`);
    log.debug(`   - Full Role Data:`, JSON.stringify(roleData, null, 2));
    
    // Rol shartlarini tekshirish
    // SQLite'da 0 (false) va null o'rtasidagi farqni to'g'ri aniqlash
    // Agar qiymat null yoki undefined bo'lsa, bu "belgilanmagan" degan ma'noni anglatadi
    log.debug(`🔍 [BACKEND] 4. Rol shartlarini tekshirish...`);
    
    // SQLite'da null tekshiruvi: agar qiymat null yoki undefined bo'lsa
    const isLocationsNull = (roleData.requires_locations === null || roleData.requires_locations === undefined);
    const isBrandsNull = (roleData.requires_brands === null || roleData.requires_brands === undefined);
    
    log.debug(`   - isLocationsNull: ${isLocationsNull}`);
    log.debug(`   - isBrandsNull: ${isBrandsNull}`);
    
    // Agar null bo'lsa, null qaytarish, aks holda boolean qiymatni qaytarish
    const isLocationsRequired = isLocationsNull 
        ? null 
        : Boolean(roleData.requires_locations);
    const isBrandsRequired = isBrandsNull 
        ? null 
        : Boolean(roleData.requires_brands);
    
    log.debug(`   - isLocationsRequired: ${isLocationsRequired} (type: ${typeof isLocationsRequired})`);
    log.debug(`   - isBrandsRequired: ${isBrandsRequired} (type: ${typeof isBrandsRequired})`);
    log.debug(`   - isLocationsRequired === null: ${isLocationsRequired === null}`);
    log.debug(`   - isBrandsRequired === null: ${isBrandsRequired === null}`);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    const isLocationsUndefined = (isLocationsRequired === null || isLocationsRequired === undefined);
    const isBrandsUndefined = (isBrandsRequired === null || isBrandsRequired === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    log.debug(`   - isLocationsUndefined: ${isLocationsUndefined}`);
    log.debug(`   - isBrandsUndefined: ${isBrandsUndefined}`);
    log.debug(`   - isRequirementsUndefined: ${isRequirementsUndefined}`);
    
    if (isRequirementsUndefined) {
        log.error(`❌ [BACKEND] 4. XATOLIK: Rol shartlari belgilanmagan!`);
        log.error(`   - Role: ${role}`);
        log.error(`   - requires_locations: ${roleData.requires_locations} (${typeof roleData.requires_locations})`);
        log.error(`   - requires_brands: ${roleData.requires_brands} (${typeof roleData.requires_brands})`);
        return res.status(400).json({ 
            message: `"${role}" roli uchun shartlar belgilanmagan. Avval shart belgilanishi kerak.`,
            requires_locations: roleData.requires_locations,
            requires_brands: roleData.requires_brands
        });
    }
    
    log.debug(`✅ [BACKEND] 4. Rol shartlari belgilangan. Validatsiyaga o'tilmoqda...`);
    
    // Validatsiya: Agar shartlar majburiy bo'lsa, tanlanganlar bo'lishi kerak
    log.debug(`🔍 [BACKEND] 5. Validatsiya tekshiruvi...`);
    
    if (isLocationsRequired === true) {
        log.debug(`   - Filiallar majburiy (true)`);
        log.debug(`   - Tanlangan filiallar soni: ${locations.length}`);
        if (locations.length === 0) {
            log.error(`   ❌ XATOLIK: Filiallar majburiy, lekin tanlanmagan!`);
            return res.status(400).json({ 
                message: `"${role}" roli uchun kamida bitta filial tanlanishi shart.`,
                requires_locations: true,
                locations_provided: locations.length
            });
        }
        log.debug(`   ✅ Filiallar validatsiyasi o'tdi`);
    } else {
        // false - filiallar kerak emas
        log.debug(`   - Filiallar kerak emas (false)`);
    }
    
    if (isBrandsRequired === true) {
        log.debug(`   - Brendlar majburiy (true)`);
        log.debug(`   - Tanlangan brendlar soni: ${brands.length}`);
        if (brands.length === 0) {
            log.error(`   ❌ XATOLIK: Brendlar majburiy, lekin tanlanmagan!`);
            return res.status(400).json({ 
                message: `"${role}" roli uchun kamida bitta brend tanlanishi shart.`,
                requires_brands: true,
                brands_provided: brands.length
            });
        }
        log.debug(`   ✅ Brendlar validatsiyasi o'tdi`);
    } else {
        // false - brendlar kerak emas
        log.debug(`   - Brendlar kerak emas (false)`);
    }
    
    log.debug(`✅ [BACKEND] 5. Barcha validatsiyalar o'tdi.`);

    try {
        // 1. Foydalanuvchi va uning vaqtinchalik ma'lumotlarini tekshirish
        log.debug(`🔍 [BACKEND] 6. Foydalanuvchi ma'lumotlarini bazadan olish...`);
        const user = await db('users').where({ id: userId }).first();
        if (!user || !['pending_approval', 'pending_telegram_subscription'].includes(user.status)) {
            log.error(`❌ [BACKEND] 6. XATOLIK: Foydalanuvchi topilmadi yoki allaqachon tasdiqlangan!`);
            log.error(`   - User ID: ${userId}`);
            log.error(`   - User found: ${user ? 'HA' : 'YO\'Q'}`);
            if (user) {
                log.error(`   - User status: ${user.status}`);
            }
            return res.status(404).json({ message: "Foydalanuvchi topilmadi yoki allaqachon tasdiqlangan." });
        }
        
        log.debug(`✅ [BACKEND] 6. Foydalanuvchi topildi:`);
        log.debug(`   - Username: ${user.username}`);
        log.debug(`   - Fullname: ${user.fullname}`);
        log.debug(`   - Status: ${user.status}`);
        log.debug(`   - Telegram Chat ID: ${user.telegram_chat_id || 'YO\'Q'}`);

        const tempReg = await db('pending_registrations').where({ user_id: userId }).first();
        if (!tempReg) {
            log.error(`❌ [BACKEND] 6. XATOLIK: Ro'yxatdan o'tish so'rovi topilmadi!`);
            log.error(`   - User ID: ${userId}`);
            return res.status(404).json({ message: "Ro'yxatdan o'tish so'rovi topilmadi yoki eskirgan." });
        }
        
        log.debug(`✅ [BACKEND] 6. Ro'yxatdan o'tish so'rovi topildi`);
        const userData = JSON.parse(tempReg.user_data);
        const { password, secret_word } = userData;

        // 2. Foydalanuvchini aktivlashtirish (bitta tranzaksiya ichida)
        log.debug(`💾 [BACKEND] 7. Ma'lumotlarni bazaga saqlash...`);
        await db.transaction(async trx => {
            log.debug(`   - Foydalanuvchi statusini yangilash: active, role: ${role}`);
            await trx('users').where({ id: userId }).update({
                status: 'active',
                role: role,
                must_delete_creds: true // Kirish ma'lumotlari yuborilgach, xabarni o'chirish uchun belgi
            });

            log.debug(`   - Eski filiallarni o'chirish...`);
            await trx('user_locations').where({ user_id: userId }).del();
            if (locations && locations.length > 0) {
                log.debug(`   - Yangi filiallarni qo'shish: ${locations.length} ta`);
                const locationsToInsert = locations.map(loc => ({ user_id: userId, location_name: loc }));
                await trx('user_locations').insert(locationsToInsert);
                log.debug(`   ✅ Filiallar saqlandi:`, locations);
            } else {
                log.debug(`   - Filiallar qo'shilmadi (bo'sh)`);
            }
            
            // Brendlarni saqlash (agar rol shartlari bo'yicha kerak bo'lsa)
            log.debug(`   - Eski brendlarni o'chirish...`);
            await trx('user_brands').where({ user_id: userId }).del();
            if (brands && brands.length > 0) {
                log.debug(`   - Yangi brendlarni qo'shish: ${brands.length} ta`);
                const brandRecords = brands.map(brandId => ({
                    user_id: userId,
                    brand_id: brandId
                }));
                await trx('user_brands').insert(brandRecords);
                log.debug(`   ✅ Brendlar saqlandi:`, brands);
            } else {
                log.debug(`   - Brendlar qo'shilmadi (bo'sh)`);
            }
        });
        log.debug(`✅ [BACKEND] 7. Ma'lumotlar muvaffaqiyatli saqlandi`);

        // WebSocket orqali realtime yuborish - foydalanuvchi tasdiqlandi
        if (global.broadcastWebSocket) {
            log.debug(`📡 [USERS] Foydalanuvchi tasdiqlandi, WebSocket orqali yuborilmoqda...`);
            const updatedUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('account_status_changed', {
                userId: parseInt(userId),
                username: updatedUser?.username,
                fullname: updatedUser?.fullname,
                status: 'active',
                previousStatus: 'pending_approval',
                changedBy: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: account_status_changed (approved)`);
        }

        // 3. Foydalanuvchiga kirish ma'lumotlarini Telegram orqali yuborish
        log.debug(`📨 [BACKEND] 8. Telegram orqali kirish ma'lumotlarini yuborish...`);
        let credentialsSent = false;
        if (user.telegram_chat_id) {
            log.debug(`   - Telegram Chat ID: ${user.telegram_chat_id}`);
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
                log.debug(`   ✅ Kirish ma'lumotlari Telegramga yuborildi`);
            } catch (telegramError) {
                log.error(`   ❌ Telegram yuborishda xatolik:`, telegramError);
            }
        } else {
            log.debug(`   - Telegram Chat ID yo'q, kirish ma'lumotlari yuborilmaydi`);
        }

        // 4. Vaqtinchalik ma'lumotlarni tozalash
        log.debug(`🗑️ [BACKEND] 9. Vaqtinchalik ma'lumotlarni tozalash...`);
        await db('pending_registrations').where({ user_id: userId }).del();
        log.debug(`   ✅ Vaqtinchalik ma'lumotlar tozalandi`);

        // 5. Audit jurnaliga yozish
        log.debug(`📝 [BACKEND] 10. Audit jurnaliga yozish...`);
        await userRepository.logAction(adminId, 'approve_user', 'user', userId, { 
            approved_role: role, 
            locations, 
            brands,
            requires_locations: roleData.requires_locations,
            requires_brands: roleData.requires_brands,
            ip: ipAddress, 
            userAgent 
        });
        log.debug(`   ✅ Audit jurnaliga yozildi`);
        
        // 6. Adminga yakuniy javobni qaytarish
        const message = `Foydalanuvchi muvaffaqiyatli tasdiqlandi. ${credentialsSent ? "Kirish ma'lumotlari uning Telegramiga yuborildi." : "Foydalanuvchi botga ulanmaganligi sababli kirish ma'lumotlari yuborilmadi."}`;
        
        log.debug(`✅ [BACKEND] 11. Muvaffaqiyatli yakunlandi!`);
        log.debug(`   - User ID: ${userId}`);
        log.debug(`   - Role: ${role}`);
        log.debug(`   - Locations: ${locations.length} ta`);
        log.debug(`   - Brands: ${brands.length} ta`);
        log.debug(`   - Credentials Sent: ${credentialsSent}`);
        log.debug('✅ ========================================');
        log.debug('✅ [BACKEND] Tasdiqlash jarayoni muvaffaqiyatli yakunlandi!');
        log.debug('✅ ========================================');
        
        res.json({ 
            message: message,
            credentials_sent: credentialsSent
        });

    } catch (error) {
        log.error('❌ ========================================');
        log.error(`❌ [BACKEND] XATOLIK YUZ BERDI!`);
        log.error(`❌ [BACKEND] Endpoint: /api/users/${userId}/approve`);
        log.error(`❌ [BACKEND] Method: PUT`);
        log.error(`❌ [BACKEND] Error:`, error);
        log.error(`❌ [BACKEND] Error Stack:`, error.stack);
        log.error(`❌ [BACKEND] Request Body:`, JSON.stringify(req.body, null, 2));
        log.error('❌ ========================================');
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
            log.debug(`📡 [USERS] Foydalanuvchi rad etildi, WebSocket orqali yuborilmoqda...`);
            const rejectedUser = await db('users').where('id', userId).first();
            global.broadcastWebSocket('account_status_changed', {
                userId: parseInt(userId),
                username: rejectedUser?.username,
                fullname: rejectedUser?.fullname,
                status: 'archived',
                previousStatus: rejectedUser?.status || 'pending_approval',
                changedBy: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: account_status_changed (rejected)`);
        }

        res.json({ message: "Foydalanuvchi so'rovi muvaffaqiyatli rad etildi va arxivlandi." });
    } catch (error) {
        log.error(`/api/users/${userId}/reject PUT xatoligi:`, error);
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
            log.debug(`📡 [USERS] Parol o'zgartirildi, WebSocket orqali yuborilmoqda...`);
            const user = await db('users').where('id', req.params.id).first();
            global.broadcastWebSocket('user_password_changed', {
                userId: parseInt(req.params.id),
                username: user?.username,
                changed_by: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: user_password_changed`);
        }
        
        res.json({ message: "Parol muvaffaqiyatli yangilandi." });
    } catch (error) {
        log.error(`/api/users/${req.params.id}/password PUT xatoligi:`, error);
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
            log.debug(`📡 [USERS] Maxfiy so'z o'zgartirildi, WebSocket orqali yuborilmoqda...`);
            const user = await db('users').where('id', req.params.id).first();
            global.broadcastWebSocket('user_secret_word_changed', {
                userId: parseInt(req.params.id),
                username: user?.username,
                changed_by: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: user_secret_word_changed`);
        }
        
        res.json({ message: "Maxfiy so'z muvaffaqiyatli o'rnatildi/yangilandi." });
    } catch (error) {
        log.error(`/api/users/${req.params.id}/secret-word PUT xatoligi:`, error);
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
        log.error('Get user permissions error:', error);
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
            log.debug(`📡 [USERS] Foydalanuvchi huquqlari yangilandi, WebSocket orqali yuborilmoqda...`);
            const user = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_permissions_updated', {
                userId: parseInt(userId),
                username: user?.username,
                type: type,
                permissions_count: permissions.length,
                updated_by: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: user_permissions_updated`);
        }

        res.json({ message: 'Huquqlar muvaffaqiyatli saqlandi' });
    } catch (error) {
        log.error('Save user permissions error:', error);
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
            log.debug(`📡 [USERS] Foydalanuvchi huquqlari tiklandi, WebSocket orqali yuborilmoqda...`);
            const user = await db('users').where('id', userId).first();
            global.broadcastWebSocket('user_permissions_reset', {
                userId: parseInt(userId),
                username: user?.username,
                reset_by: adminId
            });
            log.debug(`✅ [USERS] WebSocket yuborildi: user_permissions_reset`);
        }

        res.json({ message: 'Barcha maxsus huquqlar o\'chirildi' });
    } catch (error) {
        log.error('Reset user permissions error:', error);
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
        log.error('Avatar olishda xatolik:', error);
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
        log.error('Avatar yangilashda xatolik:', error);
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
        log.error('Avatar o\'chirishda xatolik:', error);
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
        log.error("Parol so'rovlarini olish xatoligi:", error);
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
        log.error("So'rovni tasdiqlash xatoligi:", error);
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
        log.error("So'rovni rad etish xatoligi:", error);
        res.status(500).json({ message: "So'rovni rad etishda xatolik." });
    }
});

// ===================================================================
// === TELEGRAM BOG'LANISHNI TOZALASH (FAQAT SUPERADMIN) ===
// ===================================================================
router.post('/:id/clear-telegram', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const adminId = req.session.user?.id;
    const adminRole = req.session.user?.role;
    
    // Faqat superadmin uchun
    if (adminRole !== 'superadmin' && adminRole !== 'super_admin') {
        return res.status(403).json({ message: "Bu amalni faqat superadmin bajara oladi." });
    }
    
    try {
        const user = await db('users').where({ id: userId }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        
        // O'zini tozalashga ruxsat yo'q
        if (userId === adminId) {
            return res.status(400).json({ message: "O'z Telegram bog'lanishingizni tozalay olmaysiz." });
        }
        
        // Telegram ma'lumotlarini tozalash
        await db('users').where({ id: userId }).update({
            telegram_chat_id: null,
            telegram_username: null,
            is_telegram_connected: false
        });
        
        log.debug(`✅ [USERS] Telegram bog'lanish tozalandi. User ID: ${userId}, Admin: ${req.session.user?.username}`);
        
        // Audit log
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'clear_telegram',
            entity_type: 'user',
            entity_id: userId,
            details: JSON.stringify({
                username: user.username,
                old_telegram_chat_id: user.telegram_chat_id,
                old_telegram_username: user.telegram_username
            }),
            timestamp: new Date().toISOString()
        });
        
        // WebSocket orqali yuborish
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_updated', {
                userId: userId,
                username: user.username,
                action: 'telegram_cleared'
            });
        }
        
        res.json({ 
            success: true, 
            message: "Telegram bog'lanish muvaffaqiyatli tozalandi. Foydalanuvchi qaytadan bot obunasini qilishi kerak." 
        });
        
    } catch (error) {
        log.error("Telegram tozalash xatoligi:", error);
        res.status(500).json({ message: "Telegram bog'lanishni tozalashda xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHI MA'LUMOTLARINI TEKSHIRISH (O'CHIRISH UCHUN) ===
// ===================================================================
router.get('/:id/check-data', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const adminRole = req.session.user?.role;
    
    // Faqat superadmin uchun
    if (adminRole !== 'superadmin' && adminRole !== 'super_admin') {
        return res.status(403).json({ message: "Bu amalni faqat superadmin bajara oladi." });
    }
    
    try {
        const user = await db('users').where({ id: userId }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        
        // Foydalanuvchi kiritgan ma'lumotlarni tekshirish
        const reports = await db('reports').where({ user_id: userId }).count('* as count').first();
        const history = await db('report_history').where({ user_id: userId }).count('* as count').first();
        const comparisons = await db('comparisons').where({ user_id: userId }).count('* as count').first();
        const auditLogs = await db('audit_logs').where({ user_id: userId }).count('* as count').first();
        
        const hasData = {
            reports: reports?.count || 0,
            history: history?.count || 0,
            comparisons: comparisons?.count || 0,
            auditLogs: auditLogs?.count || 0
        };
        
        const totalData = hasData.reports + hasData.history + hasData.comparisons;
        const canDeleteSafely = totalData === 0;
        
        res.json({
            userId: userId,
            username: user.username,
            fullname: user.fullname,
            role: user.role,
            status: user.status,
            hasData: hasData,
            totalDataCount: totalData,
            canDeleteSafely: canDeleteSafely,
            message: canDeleteSafely 
                ? "Bu foydalanuvchi hech qanday ma'lumot kiritmagan. Xavfsiz o'chirish mumkin." 
                : `Bu foydalanuvchi ${totalData} ta ma'lumot kiritgan. O'chirish kelajakdagi tarixlarga ta'sir qilishi mumkin.`
        });
        
    } catch (error) {
        log.error("Ma'lumotlarni tekshirish xatoligi:", error);
        res.status(500).json({ message: "Ma'lumotlarni tekshirishda xatolik." });
    }
});

// ===================================================================
// === FOYDALANUVCHINI TO'LIQ O'CHIRISH (FAQAT SUPERADMIN) ===
// ===================================================================
router.delete('/:id', isAuthenticated, hasPermission('users:edit'), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const adminId = req.session.user?.id;
    const adminRole = req.session.user?.role;
    const { forceDelete } = req.query; // ?forceDelete=true - majburiy o'chirish
    
    // Faqat superadmin uchun
    if (adminRole !== 'superadmin' && adminRole !== 'super_admin') {
        return res.status(403).json({ message: "Bu amalni faqat superadmin bajara oladi." });
    }
    
    try {
        const user = await db('users').where({ id: userId }).first();
        
        if (!user) {
            return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
        }
        
        // O'zini o'chirishga ruxsat yo'q
        if (userId === adminId) {
            return res.status(400).json({ message: "O'zingizni o'chira olmaysiz." });
        }
        
        // Superadmin'ni o'chirishga ruxsat yo'q
        if (user.role === 'superadmin' || user.role === 'super_admin') {
            return res.status(400).json({ message: "Superadmin akkauntini o'chirib bo'lmaydi." });
        }
        
        // Ma'lumotlarni tekshirish
        const reports = await db('reports').where({ user_id: userId }).count('* as count').first();
        const history = await db('report_history').where({ user_id: userId }).count('* as count').first();
        const comparisons = await db('comparisons').where({ user_id: userId }).count('* as count').first();
        
        const totalData = (reports?.count || 0) + (history?.count || 0) + (comparisons?.count || 0);
        
        // Agar ma'lumot bor va majburiy o'chirish so'ralmagan bo'lsa
        if (totalData > 0 && forceDelete !== 'true') {
            return res.status(409).json({ 
                requiresConfirmation: true,
                message: `Bu foydalanuvchi ${totalData} ta ma'lumot kiritgan. O'chirish kelajakdagi tarixlarga ta'sir qilishi mumkin.`,
                dataCount: {
                    reports: reports?.count || 0,
                    history: history?.count || 0,
                    comparisons: comparisons?.count || 0
                }
            });
        }
        
        // Tranzaksiya bilan o'chirish
        await db.transaction(async trx => {
            // Bog'liq jadvallarni tozalash
            await trx('user_locations').where({ user_id: userId }).del();
            await trx('user_brands').where({ user_id: userId }).del();
            await trx('user_permissions').where({ user_id: userId }).del();
            await trx('pending_registrations').where({ user_id: userId }).del();
            await trx('magic_links').where({ user_id: userId }).del();
            await trx('password_change_requests').where({ user_id: userId }).del();
            await trx('notifications').where({ user_id: userId }).del();
            
            // Agar majburiy o'chirish bo'lsa, hisobotlardagi user_id ni null qilish
            if (forceDelete === 'true' && totalData > 0) {
                await trx('reports').where({ user_id: userId }).update({ user_id: null });
                await trx('report_history').where({ user_id: userId }).update({ user_id: null });
                await trx('comparisons').where({ user_id: userId }).update({ user_id: null });
            }
            
            // Foydalanuvchini o'chirish
            await trx('users').where({ id: userId }).del();
        });
        
        log.debug(`🗑️ [USERS] Foydalanuvchi o'chirildi. User ID: ${userId}, Username: ${user.username}, Admin: ${req.session.user?.username}, Force: ${forceDelete === 'true'}`);
        
        // Audit log (alohida, chunki user_id o'chirildi)
        await db('audit_logs').insert({
            user_id: adminId,
            action: 'delete_user',
            entity_type: 'user',
            entity_id: userId,
            details: JSON.stringify({
                deleted_username: user.username,
                deleted_fullname: user.fullname,
                deleted_role: user.role,
                force_delete: forceDelete === 'true',
                had_data: totalData > 0
            }),
            timestamp: new Date().toISOString()
        });
        
        // WebSocket orqali yuborish
        if (global.broadcastWebSocket) {
            global.broadcastWebSocket('user_deleted', {
                userId: userId,
                username: user.username
            });
        }
        
        res.json({ 
            success: true, 
            message: forceDelete === 'true' 
                ? "Foydalanuvchi va unga tegishli bog'lanishlar o'chirildi. Hisobotlar saqlab qolindi (user_id = null)." 
                : "Foydalanuvchi muvaffaqiyatli o'chirildi." 
        });
        
    } catch (error) {
        log.error("Foydalanuvchini o'chirish xatoligi:", error);
        res.status(500).json({ message: "Foydalanuvchini o'chirishda xatolik." });
    }
});

module.exports = router;

