// utils/supervisorAssignment.js
// Supervisor tayinlash va tekshirish funksiyalari

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('SUPERVISOR_ASSIGN');

/**
 * Kasirlarga nazoratchilarni olish (barcha kasirlar tasdiqlaganidan keyin)
 * @param {number} requestId - So'rov ID
 * @param {number} branchId - Filial ID
 * @returns {Promise<Array>} - Nazoratchilar ro'yxati
 */
async function getSupervisorsForCashiers(requestId, branchId) {
    try {
        log.debug(`[GET_SUPERVISORS_CASHIERS] Supervisorlar qidirilmoqda: requestId=${requestId}, branchId=${branchId}`);
        
        // 1. `approve_supervisor_cashier` task_type'ga ega bo'lgan foydalanuvchilarni olish
        const supervisors = await db('debt_user_tasks')
            .join('users', 'debt_user_tasks.user_id', 'users.id')
            .where('debt_user_tasks.task_type', 'approve_supervisor_cashier')
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id')
            .where(function() {
                // Agar branch_id null bo'lsa, barcha filiallar uchun, aks holda faqat shu filial
                this.whereNull('debt_user_tasks.branch_id')
                    .orWhere('debt_user_tasks.branch_id', branchId);
            })
            .select(
                'users.id',
                'users.username',
                'users.fullname',
                'users.telegram_chat_id',
                'users.role',
                'debt_user_tasks.branch_id'
            )
            .distinct();
        
        log.info(`[GET_SUPERVISORS_CASHIERS] Topildi: ${supervisors.length} ta supervisor`);
        
        return supervisors.map(s => ({
            id: s.id,
            username: s.username,
            fullname: s.fullname,
            telegram_chat_id: s.telegram_chat_id,
            role: s.role
        }));
    } catch (error) {
        log.error('[GET_SUPERVISORS_CASHIERS] Xatolik:', error);
        return [];
    }
}

/**
 * Operatorlarga nazoratchilarni olish (barcha operatorlar tasdiqlaganidan keyin)
 * @param {number} requestId - So'rov ID
 * @param {number} brandId - Brend ID
 * @returns {Promise<Array>} - Nazoratchilar ro'yxati
 */
async function getSupervisorsForOperators(requestId, brandId) {
    try {
        log.debug(`[GET_SUPERVISORS_OPERATORS] Supervisorlar qidirilmoqda: requestId=${requestId}, brandId=${brandId}`);
        
        // 1. `approve_supervisor_operator` task_type'ga ega bo'lgan foydalanuvchilarni olish
        const supervisors = await db('debt_user_tasks')
            .join('users', 'debt_user_tasks.user_id', 'users.id')
            .where('debt_user_tasks.task_type', 'approve_supervisor_operator')
            .where('users.status', 'active')
            .whereNotNull('users.telegram_chat_id')
            .where(function() {
                // Agar brand_id null bo'lsa, barcha brendlar uchun, aks holda faqat shu brend
                this.whereNull('debt_user_tasks.brand_id')
                    .orWhere('debt_user_tasks.brand_id', brandId);
            })
            .select(
                'users.id',
                'users.username',
                'users.fullname',
                'users.telegram_chat_id',
                'users.role',
                'debt_user_tasks.brand_id'
            )
            .distinct();
        
        log.info(`[GET_SUPERVISORS_OPERATORS] Topildi: ${supervisors.length} ta supervisor`);
        
        return supervisors.map(s => ({
            id: s.id,
            username: s.username,
            fullname: s.fullname,
            telegram_chat_id: s.telegram_chat_id,
            role: s.role
        }));
    } catch (error) {
        log.error('[GET_SUPERVISORS_OPERATORS] Xatolik:', error);
        return [];
    }
}

/**
 * Barcha kasirlar tasdiqlaganini tekshirish
 * @param {number} requestId - So'rov ID
 * @param {number} branchId - Filial ID
 * @returns {Promise<boolean>} - Barcha kasirlar tasdiqlagan bo'lsa true
 */
async function areAllCashiersApproved(requestId, branchId) {
    try {
        log.debug(`[CHECK_ALL_CASHIERS] Tekshirilmoqda: requestId=${requestId}, branchId=${branchId}`);
        
        // So'rovni olish
        const request = await db('debt_requests').where('id', requestId).first();
        if (!request) {
            log.warn(`[CHECK_ALL_CASHIERS] So'rov topilmadi: requestId=${requestId}`);
            return false;
        }
        
        // Faqat APPROVED_BY_CASHIER statusida bo'lsa, barcha kasirlar tasdiqlagan deb hisoblaymiz
        // (chunki hozirgi sistemada bir kassir tasdiqlagandan keyin status o'zgaradi)
        // Keyinroq bu logikani yaxshilash mumkin - barcha kasirlarning tasdiqlashini alohida hisobga olish
        const isApprovedByCashier = request.status === 'APPROVED_BY_CASHIER';
        
        log.info(`[CHECK_ALL_CASHIERS] Natija: ${isApprovedByCashier}`);
        return isApprovedByCashier;
    } catch (error) {
        log.error('[CHECK_ALL_CASHIERS] Xatolik:', error);
        return false;
    }
}

/**
 * Barcha operatorlar tasdiqlaganini tekshirish
 * @param {number} requestId - So'rov ID
 * @param {number} brandId - Brend ID
 * @returns {Promise<boolean>} - Barcha operatorlar tasdiqlagan bo'lsa true
 */
async function areAllOperatorsApproved(requestId, brandId) {
    try {
        log.debug(`[CHECK_ALL_OPERATORS] Tekshirilmoqda: requestId=${requestId}, brandId=${brandId}`);
        
        // So'rovni olish
        const request = await db('debt_requests').where('id', requestId).first();
        if (!request) {
            log.warn(`[CHECK_ALL_OPERATORS] So'rov topilmadi: requestId=${requestId}`);
            return false;
        }
        
        // Faqat APPROVED_BY_OPERATOR statusida bo'lsa, barcha operatorlar tasdiqlagan deb hisoblaymiz
        // (chunki hozirgi sistemada bir operator tasdiqlagandan keyin status o'zgaradi)
        // Keyinroq bu logikani yaxshilash mumkin - barcha operatorlarning tasdiqlashini alohida hisobga olish
        const isApprovedByOperator = request.status === 'APPROVED_BY_OPERATOR';
        
        log.info(`[CHECK_ALL_OPERATORS] Natija: ${isApprovedByOperator}`);
        return isApprovedByOperator;
    } catch (error) {
        log.error('[CHECK_ALL_OPERATORS] Xatolik:', error);
        return false;
    }
}

module.exports = {
    getSupervisorsForCashiers,
    getSupervisorsForOperators,
    areAllCashiersApproved,
    areAllOperatorsApproved
};

