// routes/debt-approval/archive.js
// So'rovlarni arxivlash va boshqarish

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { db } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');

const log = createLogger('DEBT_ARCHIVE');

// Oy nomini olish
function getMonthName(month) {
    const months = {
        '01': 'Yanvar', '02': 'Fevral', '03': 'Mart', '04': 'Aprel',
        '05': 'May', '06': 'Iyun', '07': 'Iyul', '08': 'Avgust',
        '09': 'Sentabr', '10': 'Oktabr', '11': 'Noyabr', '12': 'Dekabr'
    };
    return months[month] || month;
}

/**
 * Arxivlangan so'rovlarni olish (pagination bilan)
 * GET /api/debt-approval/archive?page=1&limit=10&year=2026&month=1
 */
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { page = 1, limit = 10, year, month, brand_id, branch_id, status, type } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = db('debt_requests_archive')
            .select(
                'debt_requests_archive.*',
                'users.username as archived_by_username',
                'users.fullname as archived_by_fullname'
            )
            .leftJoin('users', 'debt_requests_archive.archived_by', 'users.id');
        
        // Filtrlash - created_at bo'yicha (so'rov yuborilgan oy) yoki archived_at bo'yicha
        // Agar year va month berilgan bo'lsa, created_at bo'yicha filtrlash (qaytadan faollashtirish uchun)
        // Aks holda, archived_at bo'yicha filtrlash (arxivlangan so'rovlarni ko'rish uchun)
        if (year && month) {
            // created_at bo'yicha filtrlash (qaytadan faollashtirish uchun)
            const yearStr = year.toString();
            const monthStr = month.toString().padStart(2, '0');
            query = query.whereRaw("strftime('%Y', debt_requests_archive.created_at) = ? AND strftime('%m', debt_requests_archive.created_at) = ?", [yearStr, monthStr]);
            log.debug(`[ARCHIVE] Yil va oy bo'yicha filtrlash (created_at): ${yearStr}-${monthStr}`);
        } else {
            // archived_at bo'yicha filtrlash (arxivlangan so'rovlarni ko'rish uchun)
            if (year) {
                const yearStr = year.toString();
                query = query.whereRaw("strftime('%Y', debt_requests_archive.archived_at) = ?", [yearStr]);
                log.debug(`[ARCHIVE] Yil bo'yicha filtrlash (archived_at): ${yearStr}`);
            }
            if (month) {
                const monthStr = month.toString().padStart(2, '0');
                query = query.whereRaw("strftime('%m', debt_requests_archive.archived_at) = ?", [monthStr]);
                log.debug(`[ARCHIVE] Oy bo'yicha filtrlash (archived_at): ${monthStr}`);
            }
        }
        if (brand_id) {
            query = query.where('debt_requests_archive.brand_id', brand_id);
        }
        if (branch_id) {
            query = query.where('debt_requests_archive.branch_id', branch_id);
        }
        if (status) {
            query = query.where('debt_requests_archive.status', status);
        }
        if (type) {
            query = query.where('debt_requests_archive.type', type);
        }
        
        // Jami soni
        const totalQuery = query.clone().clearSelect().clearOrder().count('* as count').first();
        const total = await totalQuery;
        const totalCount = total ? parseInt(total.count) : 0;
        
        log.info(`[ARCHIVE] Arxivlangan so'rovlar: jami=${totalCount}, page=${page}, limit=${limit}`);
        
        // Ma'lumotlarni olish
        const archivedRequests = await query
            .orderBy('debt_requests_archive.archived_at', 'desc')
            .limit(parseInt(limit))
            .offset(offset);
        
        log.info(`[ARCHIVE] Topilgan arxivlangan so'rovlar: ${archivedRequests.length} ta`);
        
        res.json({
            success: true,
            data: archivedRequests,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                totalPages: Math.ceil(totalCount / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Error getting archived requests:', error);
        res.status(500).json({ success: false, message: 'Xatolik yuz berdi' });
    }
});

/**
 * So'rovlarni arxivlash (oy bo'yicha)
 * POST /api/debt-approval/archive
 * Body: { year: 2026, month: 1, reason: 'monthly_cleanup' }
 */
router.post('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { year, month, reason = 'manual' } = req.body;
        const userId = req.session.user.id;
        
        log.info(`[ARCHIVE] Arxivlash so'rovi qabul qilindi: year=${year}, month=${month}, reason=${reason}, userId=${userId}`);
        
        if (!year || !month) {
            log.warn(`[ARCHIVE] ❌ Yil yoki oy belgilanmagan: year=${year}, month=${month}`);
            return res.status(400).json({ success: false, message: 'Yil va oy belgilanishi kerak' });
        }
        
        // So'rovlarni olish (belgilangan oy uchun)
        const yearStr = year.toString();
        const monthStr = month.toString().padStart(2, '0');
        
        log.info(`[ARCHIVE] So'rovlarni qidirish: year=${yearStr}, month=${monthStr}`);
        
        // Avval jami so'rovlar sonini tekshirish
        const totalRequests = await db('debt_requests')
            .whereRaw("strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?", [yearStr, monthStr])
            .count('* as count')
            .first();
        
        log.info(`[ARCHIVE] Jami so'rovlar soni (${yearStr}-${monthStr}): ${totalRequests?.count || 0}`);
        
        const requests = await db('debt_requests')
            .join('users', 'debt_requests.created_by', 'users.id')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .whereRaw("strftime('%Y', debt_requests.created_at) = ? AND strftime('%m', debt_requests.created_at) = ?", [
                yearStr,
                monthStr
            ])
            .select(
                'debt_requests.*',
                'users.username as created_by_username',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            );
        
        log.info(`[ARCHIVE] Topilgan so'rovlar soni: ${requests.length}`);
        
        if (requests.length === 0) {
            log.info(`[ARCHIVE] ⚠️ Arxivlash uchun so'rovlar topilmadi: year=${yearStr}, month=${monthStr}`);
            return res.json({ 
                success: true, 
                message: `Arxivlash uchun so'rovlar topilmadi (${yearStr}-${monthStr})`,
                archived: 0,
                total: totalRequests?.count || 0
            });
        }
        
        // Arxivga ko'chirish
        const archiveRecords = requests.map(request => ({
            original_request_id: request.id,
            request_uid: request.request_uid,
            type: request.type,
            brand_id: request.brand_id,
            brand_name: request.brand_name,
            branch_id: request.branch_id,
            branch_name: request.branch_name,
            svr_id: request.svr_id,
            svr_name: request.svr_name,
            status: request.status,
            created_by: request.created_by,
            created_by_username: request.created_by_username,
            locked: request.locked || false,
            locked_by: request.locked_by || null,
            locked_at: request.locked_at || null,
            current_approver_id: request.current_approver_id || null,
            current_approver_type: request.current_approver_type || null,
            extra_info: request.extra_info,
            excel_data: request.excel_data,
            excel_headers: request.excel_headers,
            excel_columns: request.excel_columns,
            excel_total: request.excel_total,
            preview_message_id: request.preview_message_id,
            preview_chat_id: request.preview_chat_id,
            archived_by: userId,
            archive_reason: `${reason}_${year}_${month}`,
            created_at: request.created_at,
            updated_at: request.updated_at
        }));
        
        log.info(`[ARCHIVE] Arxivga ko'chirish boshlanmoqda: ${archiveRecords.length} ta so'rov`);
        
        await db('debt_requests_archive').insert(archiveRecords);
        log.info(`[ARCHIVE] ✅ Arxivga ko'chirildi: ${archiveRecords.length} ta so'rov`);
        
        // Asl so'rovlarni o'chirish
        const requestIds = requests.map(r => r.id);
        const deletedCount = await db('debt_requests').whereIn('id', requestIds).del();
        
        log.info(`[ARCHIVE] ✅ Asl so'rovlar o'chirildi: ${deletedCount} ta so'rov`);
        log.info(`[ARCHIVE] ✅ Arxivlash muvaffaqiyatli yakunlandi: ${requests.length} ta so'rov arxivlandi (${yearStr}-${monthStr})`);
        
        res.json({
            success: true,
            message: `${requests.length} ta so'rov muvaffaqiyatli arxivlandi`,
            archived: requests.length,
            year: parseInt(yearStr),
            month: parseInt(monthStr),
            monthName: getMonthName(monthStr)
        });
    } catch (error) {
        log.error('Error archiving requests:', error);
        res.status(500).json({ success: false, message: 'Arxivlashda xatolik yuz berdi' });
    }
});

/**
 * Arxivlangan so'rovni qayta yuborish
 * POST /api/debt-approval/archive/:id/resend
 */
router.post('/:id/resend', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.id;
        
        // Arxivlangan so'rovni olish
        const archivedRequest = await db('debt_requests_archive')
            .where('id', id)
            .first();
        
        if (!archivedRequest) {
            return res.status(404).json({ success: false, message: 'Arxivlangan so\'rov topilmadi' });
        }
        
        // Yangi so'rov yaratish
        const newRequest = {
            request_uid: archivedRequest.request_uid + '_RESTORED_' + Date.now(),
            type: archivedRequest.type,
            brand_id: archivedRequest.brand_id,
            branch_id: archivedRequest.branch_id,
            svr_id: archivedRequest.svr_id,
            status: 'PENDING_APPROVAL', // Yangi holat
            created_by: userId, // Hozirgi foydalanuvchi
            extra_info: archivedRequest.extra_info,
            excel_data: archivedRequest.excel_data,
            excel_headers: archivedRequest.excel_headers,
            excel_columns: archivedRequest.excel_columns,
            excel_total: archivedRequest.excel_total,
            locked: false,
            current_approver_id: null,
            current_approver_type: null
        };
        
        const [insertedId] = await db('debt_requests').insert(newRequest);
        
        log.info(`Restored archived request ${id} as new request ${insertedId} by user ${userId}`);
        
        res.json({
            success: true,
            message: 'So\'rov muvaffaqiyatli qayta yuborildi',
            request_id: insertedId,
            request_uid: newRequest.request_uid
        });
    } catch (error) {
        log.error('Error resending archived request:', error);
        res.status(500).json({ success: false, message: 'Qayta yuborishda xatolik yuz berdi' });
    }
});

/**
 * Arxivlangan so'rovlarni tanlash bo'yicha qaytadan faollashtirish
 * POST /api/debt-approval/archive/bulk-resend
 * Body: { 
 *   filter: { brand_ids: [], branch_ids: [], svr_ids: [] }, // Bo'sh bo'lsa barchasi
 *   year: 2026,
 *   month: 1
 * }
 */
router.post('/bulk-resend', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { filter = {}, year, month } = req.body;
        const userId = req.session.user.id;
        
        // Arxivlangan so'rovlarni olish
        let query = db('debt_requests_archive');
        
        // Filtrlash - created_at bo'yicha (so'rov yuborilgan oy)
        if (year && month) {
            query = query.whereRaw("strftime('%Y', debt_requests_archive.created_at) = ? AND strftime('%m', debt_requests_archive.created_at) = ?", [
                year.toString(),
                month.toString().padStart(2, '0')
            ]);
            log.info(`[BULK_RESEND] Filtrlash: year=${year}, month=${month} (created_at bo'yicha)`);
        }
        
        if (filter.brand_ids && filter.brand_ids.length > 0) {
            query = query.whereIn('brand_id', filter.brand_ids);
        }
        
        if (filter.branch_ids && filter.branch_ids.length > 0) {
            query = query.whereIn('branch_id', filter.branch_ids);
        }
        
        if (filter.svr_ids && filter.svr_ids.length > 0) {
            query = query.whereIn('svr_id', filter.svr_ids);
        }
        
        const archivedRequests = await query.select('*');
        
        if (archivedRequests.length === 0) {
            return res.json({
                success: true,
                message: 'Qaytadan yuborish uchun so\'rovlar topilmadi',
                restored: 0
            });
        }
        
        // Yangi so'rovlar yaratish va cashier/operator tayinlash
        const { assignCashierToRequest, assignOperatorToRequest } = require('../../utils/cashierAssignment.js');
        const cashierHandlers = require('../../bot/debt-approval/handlers/cashier.js');
        
        const restoredRequestIds = [];
        
        for (const archived of archivedRequests) {
            // Har bir so'rov uchun alohida ID yaratish
            const uniqueId = archived.request_uid + '_RESTORED_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const newRequest = {
                request_uid: uniqueId,
                type: archived.type,
                brand_id: archived.brand_id,
                branch_id: archived.branch_id,
                svr_id: archived.svr_id,
                status: archived.type === 'SET' ? 'SET_PENDING' : 'PENDING_APPROVAL',
                created_by: archived.created_by || userId, // Asl yaratuvchini saqlash
                extra_info: archived.extra_info,
                excel_data: archived.excel_data,
                excel_headers: archived.excel_headers,
                excel_columns: archived.excel_columns,
                excel_total: archived.excel_total,
                locked: false,
                current_approver_id: null,
                current_approver_type: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            
            const [insertedId] = await db('debt_requests').insert(newRequest);
            restoredRequestIds.push(insertedId);
            
            // Log yozish
            await db('debt_request_logs').insert({
                request_id: insertedId,
                action: 'restore_request',
                new_status: newRequest.status,
                performed_by: userId,
                note: `So'rov qaytadan faollashtirildi: ${uniqueId}`,
                created_at: new Date().toISOString()
            });
            
            // Cashier yoki Operator tayinlash va botga xabar yuborish
            try {
                // To'liq so'rov ma'lumotlarini olish
                const fullRequest = await db('debt_requests')
                    .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                    .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                    .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                    .select(
                        'debt_requests.*',
                        'debt_brands.name as brand_name',
                        'debt_branches.name as filial_name',
                        'debt_svrs.name as svr_name'
                    )
                    .where('debt_requests.id', insertedId)
                    .first();
                
                if (newRequest.type === 'SET') {
                    // SET so'rovlar uchun operator tayinlash
                    if (newRequest.brand_id) {
                        const operator = await assignOperatorToRequest(newRequest.brand_id, insertedId);
                        log.info(`[BULK_RESEND] Operator tayinlandi: requestId=${insertedId}, operatorId=${operator.user_id}`);
                        
                        // Botga xabar yuborish
                        if (operator.telegram_chat_id && cashierHandlers.sendRequestToOperator) {
                            try {
                                await cashierHandlers.sendRequestToOperator(fullRequest, operator.telegram_chat_id);
                                log.info(`[BULK_RESEND] Operatorga xabar yuborildi: requestId=${insertedId}, operatorId=${operator.user_id}`);
                            } catch (botError) {
                                log.error(`[BULK_RESEND] Operatorga xabar yuborishda xatolik: requestId=${insertedId}`, botError);
                            }
                        }
                    }
                } else {
                    // NORMAL so'rovlar uchun cashier tayinlash
                    if (newRequest.branch_id) {
                        const cashier = await assignCashierToRequest(newRequest.branch_id, insertedId);
                        log.info(`[BULK_RESEND] Cashier tayinlandi: requestId=${insertedId}, cashierId=${cashier.user_id}`);
                        
                        // Botga xabar yuborish
                        if (cashier.telegram_chat_id) {
                            try {
                                await cashierHandlers.showRequestToCashier(fullRequest, cashier.telegram_chat_id, cashier);
                                log.info(`[BULK_RESEND] Cashierga xabar yuborildi: requestId=${insertedId}, cashierId=${cashier.user_id}`);
                            } catch (botError) {
                                log.error(`[BULK_RESEND] Cashierga xabar yuborishda xatolik: requestId=${insertedId}`, botError);
                            }
                        }
                    }
                }
            } catch (assignError) {
                log.error(`[BULK_RESEND] Tayinlashda xatolik: requestId=${insertedId}`, assignError);
                // Xatolik bo'lsa ham davom etish
            }
        }
        
        log.info(`[BULK_RESEND] ✅ ${archivedRequests.length} ta so'rov qaytadan faollashtirildi va tayinlandi by user ${userId}`);
        
        res.json({
            success: true,
            message: `${archivedRequests.length} ta so'rov muvaffaqiyatli qaytadan faollashtirildi`,
            restored: archivedRequests.length,
            request_ids: restoredRequestIds
        });
    } catch (error) {
        log.error('Error bulk resending archived requests:', error);
        res.status(500).json({ success: false, message: 'Qaytadan faollashtirishda xatolik yuz berdi' });
    }
});

/**
 * Arxivlangan so'rovni o'chirish (to'liq)
 * DELETE /api/debt-approval/archive/:id
 */
router.delete('/:id', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const deleted = await db('debt_requests_archive')
            .where('id', id)
            .del();
        
        if (deleted === 0) {
            return res.status(404).json({ success: false, message: 'Arxivlangan so\'rov topilmadi' });
        }
        
        log.info(`Permanently deleted archived request ${id}`);
        
        res.json({
            success: true,
            message: 'Arxivlangan so\'rov to\'liq o\'chirildi'
        });
    } catch (error) {
        log.error('Error deleting archived request:', error);
        res.status(500).json({ success: false, message: 'O\'chirishda xatolik yuz berdi' });
    }
});

/**
 * Arxiv statistikasi
 * GET /api/debt-approval/archive/stats
 */
router.get('/stats', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        // SQLite uchun strftime ishlatish
        const stats = await db('debt_requests_archive')
            .select(
                db.raw("CAST(strftime('%Y', archived_at) AS INTEGER) as year"),
                db.raw("CAST(strftime('%m', archived_at) AS INTEGER) as month"),
                db.raw('COUNT(*) as count')
            )
            .groupByRaw("strftime('%Y', archived_at), strftime('%m', archived_at)")
            .orderByRaw("strftime('%Y', archived_at) DESC, strftime('%m', archived_at) DESC");
        
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        log.error('Error getting archive stats:', error);
        res.status(500).json({ success: false, message: 'Statistikani olishda xatolik' });
    }
});

/**
 * Qabul qilingan ma'lumotlarni ko'rish (debt_accepted_data)
 * GET /api/debt-approval/archive/accepted-data
 * Query: startDate, endDate, brand_id, branch_id, svr_id, page, limit, search
 */
router.get('/accepted-data', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            brand_id, 
            branch_id, 
            svr_id, 
            page = 1, 
            limit = 50,
            search 
        } = req.query;
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = db('debt_accepted_data')
            .leftJoin('users', 'debt_accepted_data.approved_by', 'users.id')
            .select(
                'debt_accepted_data.*',
                'users.username as approved_by_username',
                'users.fullname as approved_by_fullname'
            );
        
        // Vaqt filtrlash
        if (startDate) {
            query = query.where('debt_accepted_data.approved_at', '>=', startDate);
        }
        if (endDate) {
            query = query.where('debt_accepted_data.approved_at', '<=', endDate + ' 23:59:59');
        }
        
        // Filtrlash
        if (brand_id) {
            query = query.where('debt_accepted_data.brand_id', brand_id);
        }
        if (branch_id) {
            query = query.where('debt_accepted_data.branch_id', branch_id);
        }
        if (svr_id) {
            query = query.where('debt_accepted_data.svr_id', svr_id);
        }
        
        // Qidiruv (client_id yoki client_name bo'yicha)
        if (search) {
            query = query.where(function() {
                this.where('debt_accepted_data.client_id', 'like', `%${search}%`)
                    .orWhere('debt_accepted_data.client_name', 'like', `%${search}%`);
            });
        }
        
        // Jami soni
        const totalQuery = query.clone().clearSelect().clearOrder().count('* as count').first();
        const total = await totalQuery;
        const totalCount = total ? parseInt(total.count) : 0;
        
        // Ma'lumotlarni olish
        const data = await query
            .orderBy('debt_accepted_data.approved_at', 'desc')
            .limit(parseInt(limit))
            .offset(offset);
        
        log.info(`[ACCEPTED_DATA] Topilgan ma'lumotlar: ${data.length} ta, jami: ${totalCount}`);
        
        res.json({
            success: true,
            data: data,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                totalPages: Math.ceil(totalCount / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Error getting accepted data:', error);
        res.status(500).json({ success: false, message: 'Ma\'lumotlarni olishda xatolik' });
    }
});

/**
 * Qabul qilingan ma'lumotlarni Excel'ga export qilish
 * GET /api/debt-approval/archive/accepted-data/export
 * Query: startDate, endDate, brand_id, branch_id, svr_id, search
 */
router.get('/accepted-data/export', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            brand_id, 
            branch_id, 
            svr_id,
            search 
        } = req.query;
        
        let query = db('debt_accepted_data')
            .leftJoin('users', 'debt_accepted_data.approved_by', 'users.id')
            .select(
                'debt_accepted_data.*',
                'users.username as approved_by_username',
                'users.fullname as approved_by_fullname'
            );
        
        // Vaqt filtrlash
        if (startDate) {
            query = query.where('debt_accepted_data.approved_at', '>=', startDate);
        }
        if (endDate) {
            query = query.where('debt_accepted_data.approved_at', '<=', endDate + ' 23:59:59');
        }
        
        // Filtrlash
        if (brand_id) {
            query = query.where('debt_accepted_data.brand_id', brand_id);
        }
        if (branch_id) {
            query = query.where('debt_accepted_data.branch_id', branch_id);
        }
        if (svr_id) {
            query = query.where('debt_accepted_data.svr_id', svr_id);
        }
        
        // Qidiruv
        if (search) {
            query = query.where(function() {
                this.where('debt_accepted_data.client_id', 'like', `%${search}%`)
                    .orWhere('debt_accepted_data.client_name', 'like', `%${search}%`);
            });
        }
        
        // Barcha ma'lumotlarni olish (pagination yo'q)
        const data = await query.orderBy('debt_accepted_data.approved_at', 'desc');
        
        // Excel workbook yaratish
        const workbook = XLSX.utils.book_new();
        
        // Headers
        const headers = [
            'ID',
            'Client ID',
            'Client Name',
            'Debt Amount',
            'Brand',
            'Branch',
            'SVR',
            'Request UID',
            'Approved At',
            'Approved By'
        ];
        
        // Data
        const excelData = [headers];
        
        data.forEach(row => {
            excelData.push([
                row.id,
                row.client_id || '',
                row.client_name || '',
                row.debt_amount || 0,
                row.brand_name || '',
                row.branch_name || '',
                row.svr_name || '',
                row.request_uid || '',
                row.approved_at || '',
                row.approved_by_fullname || row.approved_by_username || ''
            ]);
        });
        
        const sheet = XLSX.utils.aoa_to_sheet(excelData);
        XLSX.utils.book_append_sheet(workbook, sheet, 'Qabul qilingan ma\'lumotlar');
        
        // Temporary file yaratish
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const fileName = `debt_accepted_data_${Date.now()}.xlsx`;
        const filePath = path.join(tempDir, fileName);
        
        XLSX.writeFile(workbook, filePath);
        
        log.info(`[ACCEPTED_DATA_EXPORT] Export fayl yaratildi: ${fileName}`);
        
        // Faylni yuborish
        res.download(filePath, 'debt_accepted_data.xlsx', (err) => {
            // Temporary faylni o'chirish (10 soniyadan keyin)
            setTimeout(() => {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (unlinkErr) {
                        log.warn('Export faylni o\'chirishda xatolik:', unlinkErr);
                    }
                }
            }, 10000);
            
            if (err) {
                log.error('Export faylni yuborishda xatolik:', err);
            }
        });
    } catch (error) {
        log.error('Error exporting accepted data:', error);
        res.status(500).json({ success: false, message: 'Export qilishda xatolik' });
    }
});

module.exports = router;

