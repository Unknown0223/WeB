// utils/debtDataArchiver.js
// Tasdiqlangan so'rovlarning Excel ma'lumotlarini arxivlash

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('DEBT_DATA_ARCHIVER');

/**
 * Tasdiqlangan so'rovning Excel ma'lumotlarini arxivlash
 * @param {Number} requestId - So'rov ID
 * @returns {Promise<Object>} Arxivlangan qatorlar soni
 */
async function archiveAcceptedRequestData(requestId) {
    try {
        // So'rovni olish
        const request = await db('debt_requests')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .where('debt_requests.id', requestId)
            .where('debt_requests.status', 'FINAL_APPROVED')
            .select(
                'debt_requests.*',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
            .first();
        
        if (!request) {
            return { success: false, message: 'So\'rov topilmadi yoki FINAL_APPROVED emas', archived: 0 };
        }
        
        // Duplicate tekshiruv - bir xil request_id uchun qayta arxivlamaslik
        const existingArchive = await db('debt_accepted_data')
            .where('request_id', requestId)
            .first();
        
        if (existingArchive) {
            return { success: true, message: 'Allaqachon arxivlangan', archived: 0, skipped: true };
        }
        
        // Excel ma'lumotlari mavjudligini tekshirish
        if (!request.excel_data) {
            return { success: false, message: 'Excel ma\'lumotlari mavjud emas', archived: 0 };
        }
        
        // Excel ma'lumotlarini parse qilish
        let excelData;
        let excelHeaders;
        let excelColumns;
        
        try {
            excelData = typeof request.excel_data === 'string' 
                ? JSON.parse(request.excel_data) 
                : request.excel_data;
            
            excelHeaders = typeof request.excel_headers === 'string' 
                ? JSON.parse(request.excel_headers) 
                : (request.excel_headers || []);
            
            excelColumns = typeof request.excel_columns === 'string' 
                ? JSON.parse(request.excel_columns) 
                : (request.excel_columns || {});
        } catch (parseError) {
            log.error(`[DEBT_ARCHIVE] Excel ma'lumotlarini parse qilishda xatolik: requestId=${requestId}`, parseError);
            return { success: false, message: 'Excel ma\'lumotlarini parse qilishda xatolik', archived: 0 };
        }
        
        if (!Array.isArray(excelData) || excelData.length === 0) {
            return { success: false, message: 'Excel ma\'lumotlari bo\'sh', archived: 0 };
        }
        
        // Ustunlar mavjudligini tekshirish
        if (!excelColumns.id && excelColumns.id !== 0) {
            return { success: false, message: 'ID ustuni topilmadi', archived: 0 };
        }
        
        // Header nomlarini olish
        const idHeader = excelHeaders[excelColumns.id] || '';
        const nameHeader = excelHeaders[excelColumns.name] || '';
        const summaHeader = excelHeaders[excelColumns.summa] || '';
        
        if (!idHeader || !nameHeader || !summaHeader) {
            return { success: false, message: 'Kerakli header nomlari topilmadi', archived: 0 };
        }
        
        // So'rov tasdiqlangan vaqtni olish (oxirgi operator tasdiqlash vaqti)
        const lastApproval = await db('debt_request_approvals')
            .where('request_id', requestId)
            .whereIn('status', ['approved', 'debt_marked'])
            .orderBy('created_at', 'desc')
            .first();
        
        const approvedAt = lastApproval ? lastApproval.created_at : new Date().toISOString();
        const approvedBy = lastApproval ? lastApproval.approver_id : null;
        
        // Har bir qatorni arxivga yozish
        const archiveRecords = [];
        
        for (const row of excelData) {
            const clientId = row[idHeader] !== undefined && row[idHeader] !== null 
                ? String(row[idHeader]).trim() 
                : '';
            const clientName = row[nameHeader] !== undefined && row[nameHeader] !== null 
                ? String(row[nameHeader]).trim() 
                : '';
            
            // Summa ni parse qilish
            const summaValue = row[summaHeader];
            const debtAmount = summaValue !== undefined && summaValue !== null 
                ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.')) 
                : null;
            
            // Faqat clientId va clientName mavjud bo'lgan qatorlarni arxivlash
            if (clientId && clientName) {
                archiveRecords.push({
                    request_id: requestId,
                    request_uid: request.request_uid,
                    brand_id: request.brand_id,
                    branch_id: request.branch_id,
                    svr_id: request.svr_id,
                    brand_name: request.brand_name,
                    branch_name: request.branch_name,
                    svr_name: request.svr_name,
                    client_id: clientId,
                    client_name: clientName,
                    debt_amount: isNaN(debtAmount) ? null : debtAmount,
                    excel_row_data: JSON.stringify(row), // Butun qator JSON sifatida
                    approved_at: approvedAt,
                    approved_by: approvedBy,
                    created_at: new Date().toISOString()
                });
            }
        }
        
        if (archiveRecords.length === 0) {
            return { success: false, message: 'Arxivlash uchun ma\'lumotlar topilmadi', archived: 0 };
        }
        
        // Batch insert
        await db('debt_accepted_data').insert(archiveRecords);
        
        log.info(`[DEBT_ARCHIVE] Arxivlandi: requestId=${requestId}, qatorlar=${archiveRecords.length}`);
        
        return { 
            success: true, 
            message: 'Muvaffaqiyatli arxivlandi', 
            archived: archiveRecords.length 
        };
        
    } catch (error) {
        log.error(`[DEBT_ARCHIVE] Arxivlashda xatolik: requestId=${requestId}`, error);
        throw error;
    }
}

module.exports = {
    archiveAcceptedRequestData
};

