// bot/hisobot/handlers/list.js
// Hisobotlar ro'yxati handler

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const userHelper = require('../../unified/userHelper.js');
const { filterReportsByRole, getVisibleLocations, getVisibleBrands } = require('../../../utils/roleFiltering.js');

const log = createLogger('HISOBOT_LIST');

/**
 * Foydalanuvchining permissions'larini olish
 * @deprecated userHelper.getUserPermissions ishlatish kerak
 */
async function getUserPermissions(userId) {
    try {
        const user = await db('users').where('id', userId).first();
        if (!user) return [];
        
        // Permissions'ni olish - permission_key ishlatish kerak, permission_id emas
        const rolePermissions = await db('role_permissions as rp')
            .join('permissions as p', 'rp.permission_key', 'p.permission_key')
            .where('rp.role_name', user.role)
            .select('p.permission_key');
        
        const permissions = rolePermissions.map(rp => rp.permission_key);
        
        // User-specific permissions - user_permissions jadvalini ham tekshirish kerak
        const hasUserPermissionsTable = await db.schema.hasTable('user_permissions');
        if (hasUserPermissionsTable) {
            // Additional permissions qo'shish
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
 * Hisobotlar ro'yxatini ko'rsatish
 */
async function handleListReports(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        log.info(`[LIST] Hisobotlar ro'yxati so'ralmoqda. UserId: ${userId}`);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, `❌ Siz ro'yxatdan o'tmagansiz. Iltimos, avval ro'yxatdan o'ting.`);
            return true;
        }
        
        // Permissions'ni olish
        const permissions = await userHelper.getUserPermissions(user.id);
        const viewPermissions = ['reports:view_own', 'reports:view_assigned', 'reports:view_all'];
        const hasViewPermission = viewPermissions.some(p => permissions.includes(p));
        
        // Menejer uchun "Yangi hisobot" yaratish huquqi bor, lekin "Hisobotlar ro'yxati" uchun huquq yo'q bo'lishi mumkin
        // Bu holda, xabar yubormaslik yaxshiroq (chunki menejer asosan yangi hisobot yaratish uchun ishlatiladi)
        if (!hasViewPermission) {
            // Faqat menejer bo'lsa, xabar yubormaslik (chunki ular "Yangi hisobot" yaratish uchun ishlatiladi)
            if (user.role === 'menejer') {
                await bot.sendMessage(
                    chatId,
                    `ℹ️ Siz menejer sifatida "Yangi hisobot" yaratishingiz mumkin.\n\n` +
                    `Hisobotlar ro'yxatini ko'rish uchun web paneldan foydalaning.`,
                    { parse_mode: 'HTML' }
                );
            } else {
                await bot.sendMessage(chatId, `❌ Sizda hisobotlarni ko'rish huquqi yo'q.`);
            }
            return true;
        }
        
        // Hisobotlarni olish
        let query = db('reports as r')
            .leftJoin('users as u', 'r.created_by', 'u.id')
            .leftJoin('brands as b', 'r.brand_id', 'b.id')
            .select(
                'r.id',
                'r.report_date as date',
                'r.location',
                'r.created_at',
                'u.fullname as author',
                'b.name as brand_name'
            )
            .orderBy('r.created_at', 'desc')
            .limit(10);
        
        // Filtrlash
        if (permissions.includes('reports:view_all')) {
            try {
                const userWithPermissions = { ...user, permissions };
                const filteredQuery = await filterReportsByRole(query, userWithPermissions);
                if (filteredQuery && typeof filteredQuery.select === 'function') {
                    query = filteredQuery;
                }
            } catch (filterError) {
                log.error('filterReportsByRole xatolik:', filterError);
            }
        } else if (permissions.includes('reports:view_assigned')) {
            const visibleLocations = await getVisibleLocations({ ...user, permissions });
            const visibleBrands = await getVisibleBrands({ ...user, permissions });
            
            query.where(function() {
                this.where('r.created_by', user.id);
                if (visibleLocations.length > 0) {
                    this.orWhereIn('r.location', visibleLocations);
                }
                if (visibleBrands.length > 0) {
                    this.orWhereIn('r.brand_id', visibleBrands);
                }
            });
        } else if (permissions.includes('reports:view_own')) {
            query.where('r.created_by', user.id);
        }
        
        const reports = await query;
        
        if (reports.length === 0) {
            await bot.sendMessage(chatId, `📊 <b>Hisobotlar ro'yxati</b>\n\n` +
                `Hozircha hech qanday hisobot topilmadi.`, { parse_mode: 'HTML' });
            return true;
        }
        
        // Hisobotlarni formatlash
        let message = `📊 <b>Hisobotlar ro'yxati</b>\n\n`;
        message += `Jami: <b>${reports.length}</b> ta hisobot\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        reports.forEach((report, index) => {
            const date = new Date(report.date).toLocaleDateString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            
            message += `${index + 1}. <b>${report.location}</b>\n`;
            message += `   📅 Sana: ${date}\n`;
            if (report.brand_name) {
                message += `   🏷️ Brend: ${report.brand_name}\n`;
            }
            message += `   👤 Muallif: ${report.author || 'Noma\'lum'}\n`;
            message += `\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `💡 <i>Barcha hisobotlarni ko'rish uchun web paneldan foydalaning.</i>`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        return true;
        
    } catch (error) {
        log.error('[LIST] Xatolik:', error);
        await bot.sendMessage(chatId, `❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.`);
        return true;
    }
}

module.exports = {
    handleListReports,
    getUserPermissions
};

