// utils/dataHistory.js
// Ma'lumotlar o'zgarish tarixi - brend, filial, SVR nomlarini o'zgartirishda

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('DATA_HISTORY');

/**
 * Ma'lumot o'zgarishini log qilish
 */
async function logDataChange(entityType, entityId, oldName, newName, userId, reason = null) {
    try {
        await db('debt_data_history').insert({
            entity_type: entityType,
            entity_id: entityId,
            old_name: oldName,
            new_name: newName,
            changed_by: userId,
            change_reason: reason
        });
        
        // Entity jadvalini yangilash
        const tableMap = {
            'brand': 'debt_brands',
            'branch': 'debt_branches',
            'svr': 'debt_svrs'
        };
        
        const tableName = tableMap[entityType];
        if (tableName) {
            await db(tableName)
                .where('id', entityId)
                .update({
                    name: newName,
                    changed_at: db.fn.now(),
                    changed_by: userId
                });
        }
        
        log.debug(`Data change logged: entityType=${entityType}, entityId=${entityId}, oldName=${oldName}, newName=${newName}, userId=${userId}`);
    } catch (error) {
        log.error('Error logging data change:', error);
        throw error;
    }
}

/**
 * Entity o'zgarishlar tarixini olish
 */
async function getEntityHistory(entityType, entityId) {
    try {
        const history = await db('debt_data_history')
            .where({
                entity_type: entityType,
                entity_id: entityId
            })
            .orderBy('changed_at', 'desc');
        
        return history;
    } catch (error) {
        log.error('Error getting entity history:', error);
        throw error;
    }
}

/**
 * Barcha o'zgarishlar tarixini olish (admin uchun)
 */
async function getAllHistory(limit = 100) {
    try {
        const history = await db('debt_data_history')
            .orderBy('changed_at', 'desc')
            .limit(limit);
        
        return history;
    } catch (error) {
        log.error('Error getting all history:', error);
        throw error;
    }
}

module.exports = {
    logDataChange,
    getEntityHistory,
    getAllHistory
};

