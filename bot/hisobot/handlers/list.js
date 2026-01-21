// bot/hisobot/handlers/list.js
// Hisobotlar ro'yxati handler

const { db } = require('../../../db.js');
const { createLogger } = require('../../../utils/logger.js');
const userHelper = require('../../unified/userHelper.js');
const { filterReportsByRole, getVisibleLocations, getVisibleBrands } = require('../../../utils/roleFiltering.js');
const { getUserPermissions } = require('../../../utils/userPermissions.js');

const log = createLogger('HISOBOT_LIST');

// getUserPermissions funksiyasi utils/userPermissions.js dan import qilingan

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

