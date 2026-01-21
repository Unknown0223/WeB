// bot/hisobot/handlers/stats.js
// Statistika handler

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const userHelper = require('../../unified/userHelper.js');

const log = createLogger('HISOBOT_STATS');

/**
 * Statistika ko'rsatish
 */
async function handleStats(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        log.info(`[STATS] Statistika so'ralmoqda. UserId: ${userId}`);
        
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, `❌ Siz ro'yxatdan o'tmagansiz. Iltimos, avval ro'yxatdan o'ting.`);
            return true;
        }
        
        // Permissions tekshirish
        const permissions = await userHelper.getUserPermissions(user.id);
        const viewPermissions = ['reports:view_own', 'reports:view_assigned', 'reports:view_all'];
        const hasViewPermission = viewPermissions.some(p => permissions.includes(p));
        
        if (!hasViewPermission) {
            await bot.sendMessage(chatId, `❌ Sizda statistika ko'rish huquqi yo'q.`);
            return true;
        }
        
        // Statistika ma'lumotlarini olish
        let baseQuery = db('reports');
        
        // Filtrlash
        if (permissions.includes('reports:view_own')) {
            baseQuery = baseQuery.where('created_by', user.id);
        } else if (permissions.includes('reports:view_assigned')) {
            // Biriktirilgan filiallar uchun
            const { getVisibleLocations } = require('../../../utils/roleFiltering.js');
            const visibleLocations = await getVisibleLocations({ ...user, permissions });
            if (visibleLocations.length > 0) {
                baseQuery = baseQuery.where(function() {
                    this.where('created_by', user.id)
                        .orWhereIn('location', visibleLocations);
                });
            } else {
                baseQuery = baseQuery.where('created_by', user.id);
            }
        }
        
        // Jami hisobotlar soni
        const totalReports = await baseQuery.clone().count('* as count').first();
        
        // Oxirgi 30 kunlik statistika
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recentReports = await baseQuery.clone()
            .where('created_at', '>=', thirtyDaysAgo.toISOString())
            .count('* as count')
            .first();
        
        // Bu oy hisobotlar
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const thisMonthReports = await baseQuery.clone()
            .where('created_at', '>=', thisMonthStart.toISOString())
            .count('* as count')
            .first();
        
        // Formatlash
        const message = `📈 <b>Hisobotlar statistikasi</b>\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📊 <b>Jami hisobotlar:</b> ${totalReports.count || 0}\n` +
            `📅 <b>Oxirgi 30 kun:</b> ${recentReports.count || 0}\n` +
            `📆 <b>Bu oy:</b> ${thisMonthReports.count || 0}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `💡 <i>Batafsil statistika uchun web paneldan foydalaning.</i>`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        return true;
        
    } catch (error) {
        log.error('[STATS] Xatolik:', error);
        await bot.sendMessage(chatId, `❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.`);
        return true;
    }
}

module.exports = {
    handleStats
};

