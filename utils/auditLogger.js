// utils/auditLogger.js
// Audit logger - barcha so'rov o'zgarishlarini kuzatish

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('AUDIT');

/**
 * So'rov harakatini log qilish
 */
async function logRequestAction(requestId, action, userId, details = {}) {
    try {
        // Eski statusni olish
        const request = await db('debt_requests').where('id', requestId).first();
        const oldStatus = request ? request.status : null;
        
        // Yangi statusni olish (agar details'da bo'lsa)
        const newStatus = details.new_status || (request ? request.status : null);
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: action,
            old_status: oldStatus,
            new_status: newStatus,
            performed_by: userId,
            note: details.note || null
        });
        
        log.debug(`Request action logged: requestId=${requestId}, action=${action}, userId=${userId}`);
    } catch (error) {
        log.error('Error logging request action:', error);
        throw error;
    }
}

/**
 * So'rov tasdiqlashini log qilish
 */
async function logApproval(requestId, approverId, approvalType, status, details = {}) {
    try {
        await db('debt_request_approvals').insert({
            request_id: requestId,
            approver_id: approverId,
            approval_type: approvalType,
            status: status,
            note: details.note || null,
            excel_file_path: details.excel_file_path || null,
            image_file_path: details.image_file_path || null,
            debt_amount: details.debt_amount || null
        });
        
        log.debug(`Approval logged: requestId=${requestId}, approverId=${approverId}, type=${approvalType}, status=${status}`);
    } catch (error) {
        log.error('Error logging approval:', error);
        throw error;
    }
}

/**
 * So'rov tarixini olish
 */
async function getRequestHistory(requestId) {
    try {
        const logs = await db('debt_request_logs')
            .where('request_id', requestId)
            .orderBy('created_at', 'asc');
        
        const approvals = await db('debt_request_approvals')
            .where('request_id', requestId)
            .orderBy('created_at', 'asc');
        
        return {
            logs,
            approvals
        };
    } catch (error) {
        log.error('Error getting request history:', error);
        throw error;
    }
}

module.exports = {
    logRequestAction,
    logApproval,
    getRequestHistory
};

