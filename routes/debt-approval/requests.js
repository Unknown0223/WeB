// routes/debt-approval/requests.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, isPostgres } = require('../../db.js');
const { createLogger } = require('../../utils/logger.js');
const { isAuthenticated, hasPermission } = require('../../middleware/auth.js');
const { startReminder, stopReminder } = require('../../utils/debtReminder.js');
const { parseExcelFile } = require('../../utils/excelParser.js');

const log = createLogger('DEBT_REQUESTS');

// Multer sozlamalari
const upload = multer({
    dest: 'uploads/debt-approval/',
    limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB
        fieldSize: 50 * 1024 * 1024, // 50MB - Excel ma'lumotlari uchun
        fields: 20, // Maksimal field'lar soni
        fieldNameSize: 100 // Field nomi maksimal uzunligi
    },
    fileFilter: (req, file, cb) => {
        const isExcel = file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls') ||
                       file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                       file.mimetype === 'application/vnd.ms-excel';
        if (isExcel) {
            cb(null, true);
        } else {
            cb(new Error('Faqat Excel fayllar (.xlsx, .xls) qabul qilinadi'), false);
        }
    }
});

// Request UID yaratish
function generateRequestUID() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `REQ-${year}-${random}`;
}

// So'rovlar ro'yxati
router.get('/', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { status, type, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = db('debt_requests')
            .join('users', 'debt_requests.created_by', 'users.id')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .select(
                'debt_requests.*',
                'users.username as created_by_username',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            );
        
        if (status) {
            query = query.where('debt_requests.status', status);
        }
        if (type) {
            query = query.where('debt_requests.type', type);
        }
        
        const requests = await query
            .orderBy('debt_requests.created_at', 'desc')
            .limit(limit)
            .offset(offset);
        
        const total = await db('debt_requests').count('* as count').first();
        
        res.json({
            requests,
            total: total.count,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        log.error('So\'rovlar ro\'yxatini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Filiallar bo'yicha holat (kartalar ko'rinishida) - aniq route, /:id dan oldin bo'lishi kerak
router.get('/branch-status', isAuthenticated, hasPermission(['roles:manage', 'debt:view_statistics', 'debt:view_own', 'debt:create']), async (req, res) => {
    try {
        const user = req.session.user;
        const { brandId, status: statusFilter, searchTerm } = req.query;
        
        // Biriktirilgan filial/brend bo'yicha filtrlash
        const { getAllowedDebtBrands, getAllowedDebtBranches } = require('../../utils/debtAccessFilter.js');
        const allowedBrands = await getAllowedDebtBrands(user);
        const allowedBranches = await getAllowedDebtBranches(user, brandId);
        
        // Barcha filiallarni olish (guruhlash uchun)
        let branchesQuery = db('debt_branches')
            .join('debt_brands', 'debt_branches.brand_id', 'debt_brands.id')
            .select(
                'debt_branches.id as branch_id',
                'debt_branches.name as branch_name',
                'debt_branches.brand_id',
                'debt_brands.name as brand_name'
            )
            .orderBy('debt_branches.name');
        
        // Ruxsat berilgan brendlar bo'yicha filtrlash
        if (allowedBrands !== null && allowedBrands.length > 0) {
            branchesQuery = branchesQuery.whereIn('debt_branches.brand_id', allowedBrands);
        }
        
        // Ruxsat berilgan filiallar bo'yicha filtrlash
        if (allowedBranches !== null && allowedBranches.length > 0) {
            branchesQuery = branchesQuery.whereIn('debt_branches.id', allowedBranches);
        }
        
        // Brend filter bo'yicha filtrlash (tepadagi filter uchun)
        // Bu filter allaqachon yuqorida qo'llanilgan, lekin qayta tekshirish uchun qoldiramiz
        if (brandId && brandId.trim() !== '' && brandId.trim() !== 'null' && brandId.trim() !== 'undefined') {
            const brandIdNum = parseInt(brandId);
            if (!isNaN(brandIdNum)) {
                branchesQuery = branchesQuery.where('debt_branches.brand_id', brandIdNum);
            }
        }
        
        // Qidiruv bo'yicha filtrlash
        if (searchTerm && searchTerm.trim() !== '') {
            branchesQuery = branchesQuery.where('debt_branches.name', 'like', `%${searchTerm.trim()}%`);
        }
        
        const branches = await branchesQuery;
        
        // Filiallarni NOMI bo'yicha guruhlash (unikal qilish)
        const branchGroupsMap = new Map();
        
        for (const branch of branches) {
            const branchName = branch.branch_name;
            
            if (!branchGroupsMap.has(branchName)) {
                branchGroupsMap.set(branchName, {
                    name: branchName,
                    branchIds: [],
                    brands: []
                });
            }
            
            const group = branchGroupsMap.get(branchName);
            group.branchIds.push(branch.branch_id);
            
            // Brendni qo'shish (takrorlanmaslik uchun)
            if (!group.brands.some(b => b.id === branch.brand_id)) {
                group.brands.push({
                    id: branch.brand_id,
                    name: branch.brand_name
                });
            }
        }
        
        const result = [];
        
        // Har bir unikal filial uchun SVR'larni yig'ish
        for (const [branchName, group] of branchGroupsMap) {
            // Brend filter bo'yicha filial brendlarini tekshirish
            if (brandId && brandId.trim() !== '') {
                const brandIdNum = parseInt(brandId);
                if (!isNaN(brandIdNum)) {
                    // Agar brend filter tanlangan bo'lsa, faqat o'sha brendga tegishli filiallarni ko'rsatish
                    const hasMatchingBrand = group.brands.some(b => b.id === brandIdNum);
                    if (!hasMatchingBrand) {
                        continue; // Bu filialni o'tkazib yuborish
                    }
                }
            }
            
            // Bu filial nomiga tegishli barcha branch_id'lar uchun SVR'larni olish
            let svrsQuery = db('debt_svrs')
                .whereIn('branch_id', group.branchIds)
                .join('debt_branches', 'debt_svrs.branch_id', 'debt_branches.id')
                .join('debt_brands', 'debt_branches.brand_id', 'debt_brands.id');
            
            // Brend filter bo'yicha SVR'larni filtrlash
            if (brandId && brandId.trim() !== '') {
                const brandIdNum = parseInt(brandId);
                if (!isNaN(brandIdNum)) {
                    svrsQuery = svrsQuery.where('debt_branches.brand_id', brandIdNum);
                }
            }
            
            const svrs = await svrsQuery
                .select(
                    'debt_svrs.id',
                    'debt_svrs.name',
                    'debt_svrs.branch_id',
                    'debt_brands.name as brand_name'
                )
                .orderBy('debt_svrs.name');
            
            // Har bir SVR uchun status va so'rovlarni tekshirish
            const svrDetails = [];
            let totalSvrs = svrs.length;
            let completedSvrs = 0;
            
            // Filial va brend bo'yicha tasdiqlovchilarni oldindan olish (optimizatsiya)
            const branchId = group.branchIds[0]; // Birinchi branch ID ni ishlatamiz
            const groupBrandId = group.brands[0]?.id; // Birinchi brend ID ni ishlatamiz (brandId bilan nom ziddiyatini oldini olish uchun)
            
            // Tasdiqlovchilarni olish
            const [leaders, cashiers, operators] = await Promise.all([
                // Leader (rahbar) - brend bo'yicha
                groupBrandId ? db('debt_user_brands')
                    .join('users', 'debt_user_brands.user_id', 'users.id')
                    .where('debt_user_brands.brand_id', groupBrandId)
                    .where(function() {
                        this.where('users.role', 'leader')
                            .orWhere('users.role', 'rahbar');
                    })
                    .select('users.id')
                    .distinct() : [],
                // Cashier (kassir) - filial bo'yicha
                db('debt_cashiers')
                    .join('users', 'debt_cashiers.user_id', 'users.id')
                    .whereIn('debt_cashiers.branch_id', group.branchIds)
                    .where('debt_cashiers.is_active', true)
                    .select('users.id')
                    .distinct(),
                // Operator - brend bo'yicha
                groupBrandId ? db('debt_operators')
                    .join('users', 'debt_operators.user_id', 'users.id')
                    .where('debt_operators.brand_id', groupBrandId)
                    .where('debt_operators.is_active', true)
                    .select('users.id')
                    .distinct() : []
            ]);
            
            const leaderIds = leaders.map(l => l.id);
            const cashierIds = cashiers.map(c => c.id);
            const operatorIds = operators.map(o => o.id);
            
            for (const svr of svrs) {
                // Eng so'nggi so'rovni olish
                const latestRequest = await db('debt_requests')
                    .where('svr_id', svr.id)
                    .orderBy('created_at', 'desc')
                    .first();
                
                let status = 'no_request'; // no_request, pending, approved, debt_found
                if (latestRequest) {
                    // Tasdiqlangan holatlar
                    const approvedStatuses = [
                        'FINAL_APPROVED', 
                        'DEBT_FOUND',
                        'APPROVED_BY_LEADER',
                        'APPROVED_BY_CASHIER',
                        'APPROVED_BY_OPERATOR',
                        'APPROVED_BY_SUPERVISOR'
                    ];
                    
                    // Bekor qilingan holatlar
                    const cancelledStatuses = ['CANCELLED', 'REJECTED', 'REJECTED_BY_LEADER'];
                    
                    if (approvedStatuses.includes(latestRequest.status)) {
                        status = 'approved';
                        completedSvrs++;
                    } else if (cancelledStatuses.includes(latestRequest.status)) {
                        status = 'no_request';
                    } else {
                        // Boshqa barcha holatlar (PENDING_APPROVAL, SET_PENDING va boshqalar) jarayonda
                        status = 'pending';
                    }
                }
                
                // SVR uchun kerakli tasdiqlovchilar sonini hisoblash
                let totalRequiredApprovers = 0;
                let approvedApprovers = 0;
                
                if (latestRequest) {
                    const requestType = latestRequest.type; // 'SET' yoki 'NORMAL'
                    const requestId = latestRequest.id;
                    
                    // Kerakli tasdiqlovchilar sonini hisoblash
                    if (requestType === 'SET') {
                        // SET so'rovlar uchun: Leader kerak
                        totalRequiredApprovers = leaderIds.length;
                        
                        // Haqiqiy tasdiqlangan leaderlar sonini olish (debt_request_approvals jadvalidan)
                        if (totalRequiredApprovers > 0 && requestId) {
                            const approvedLeaders = await db('debt_request_approvals')
                                .where('request_id', requestId)
                                .where('approval_type', 'leader')
                                .where('status', 'approved')
                                .whereIn('approver_id', leaderIds)
                                .count('* as count')
                                .first();
                            
                            approvedApprovers = approvedLeaders ? parseInt(approvedLeaders.count) : 0;
                        } else {
                            approvedApprovers = 0;
                        }
                    } else {
                        // Normal so'rovlar uchun: Cashier va Operator kerak
                        const cashierCount = cashierIds.length;
                        const operatorCount = operatorIds.length;
                        totalRequiredApprovers = cashierCount + operatorCount;
                        
                        // Haqiqiy tasdiqlangan cashier va operatorlar sonini olish (debt_request_approvals jadvalidan)
                        if (totalRequiredApprovers > 0 && requestId) {
                            const approvedCashiers = await db('debt_request_approvals')
                                .where('request_id', requestId)
                                .where('approval_type', 'cashier')
                                .where('status', 'approved')
                                .whereIn('approver_id', cashierIds)
                                .count('* as count')
                                .first();
                            
                            const approvedOperators = await db('debt_request_approvals')
                                .where('request_id', requestId)
                                .where('approval_type', 'operator')
                                .where('status', 'approved')
                                .whereIn('approver_id', operatorIds)
                                .count('* as count')
                                .first();
                            
                            const cashierApproved = approvedCashiers ? parseInt(approvedCashiers.count) : 0;
                            const operatorApproved = approvedOperators ? parseInt(approvedOperators.count) : 0;
                            approvedApprovers = cashierApproved + operatorApproved;
                        } else {
                            approvedApprovers = 0;
                        }
                    }
                } else {
                    // So'rov boshlanmagan bo'lsa, barcha mumkin bo'lgan tasdiqlovchilarni hisoblaymiz
                    // SET va Normal so'rovlar uchun har ikkala holatni hisoblaymiz
                    const setRequired = leaderIds.length;
                    const normalRequired = cashierIds.length + operatorIds.length;
                    totalRequiredApprovers = Math.max(setRequired, normalRequired);
                    approvedApprovers = 0;
                }
                
                // Foiz hisoblash
                let approvalPercentage = 0;
                if (totalRequiredApprovers > 0) {
                    approvalPercentage = Math.round((approvedApprovers / totalRequiredApprovers) * 100);
                }
                
                svrDetails.push({
                    id: svr.id,
                    name: svr.name,
                    status: status,
                    brandName: svr.brand_name, // Qaysi brendga tegishli ekanligini ko'rsatish
                    requestId: latestRequest?.id || null,
                    requestStatus: latestRequest?.status || null,
                    totalRequiredApprovers: totalRequiredApprovers,
                    approvedApprovers: approvedApprovers,
                    approvalPercentage: approvalPercentage
                });
            }
            
            // To'liq yakunlanish foiz darajasi - barcha SVRlar bo'yicha umumiy foiz
            let totalRequiredForBranch = 0;
            let totalApprovedForBranch = 0;
            
            svrDetails.forEach(svr => {
                // Faqat jarayondagi yoki tasdiqlangan SVR'lar uchun foiz hisoblash
                if (svr.status === 'pending' || svr.status === 'approved') {
                    totalRequiredForBranch += svr.totalRequiredApprovers || 0;
                    totalApprovedForBranch += svr.approvedApprovers || 0;
                }
            });
            
            // Agar hech qanday jarayondagi so'rov bo'lmasa, to'liq yakunlangan SVR'lar bo'yicha foiz hisoblash
            const completionPercentage = totalRequiredForBranch > 0 
                ? Math.round((totalApprovedForBranch / totalRequiredForBranch) * 100) 
                : (totalSvrs > 0 ? Math.round((completedSvrs / totalSvrs) * 100) : 0);
            
            // Filial holati
            let branchStatus = 'no_request';
            if (totalSvrs === 0) {
                branchStatus = 'no_svrs';
            } else if (completionPercentage === 100) {
                branchStatus = 'completed';
            } else if (svrDetails.some(s => s.status === 'pending')) {
                branchStatus = 'in_progress';
            } else {
                branchStatus = 'no_request';
            }
            
            // Status filter bo'yicha filtrlash
            // Faqat filter tanlangan bo'lsa va 'all' bo'lmasa, filtrlash bajariladi
            if (statusFilter && typeof statusFilter === 'string' && statusFilter.trim() !== '' && statusFilter.trim() !== 'all') {
                const filterStatus = statusFilter.trim();
                log.debug(`[BRANCH_STATUS] Filial ${branchName}: branchStatus=${branchStatus}, filterStatus=${filterStatus}`);
                
                // Status nomlarini moslashtirish
                if (filterStatus === 'completed') {
                    if (branchStatus !== 'completed') {
                        log.debug(`[BRANCH_STATUS] Filial ${branchName} o'tkazib yuborildi: branchStatus (${branchStatus}) !== completed`);
                        continue; // Bu filialni o'tkazib yuborish
                    }
                } else if (filterStatus === 'in_progress') {
                    if (branchStatus !== 'in_progress') {
                        log.debug(`[BRANCH_STATUS] Filial ${branchName} o'tkazib yuborildi: branchStatus (${branchStatus}) !== in_progress`);
                        continue; // Bu filialni o'tkazib yuborish
                    }
                } else if (filterStatus === 'no_request') {
                    if (branchStatus !== 'no_request' && branchStatus !== 'no_svrs') {
                        log.debug(`[BRANCH_STATUS] Filial ${branchName} o'tkazib yuborildi: branchStatus (${branchStatus}) !== no_request va !== no_svrs`);
                        continue; // Bu filialni o'tkazib yuborish
                    }
                }
                log.debug(`[BRANCH_STATUS] Filial ${branchName} qo'shildi: branchStatus=${branchStatus}, filterStatus=${filterStatus}`);
            }
            
            result.push({
                branch: {
                    ids: group.branchIds, // Barcha branch ID'lar
                    name: branchName
                },
                brands: group.brands, // Tegishli brendlar ro'yxati
                status: branchStatus,
                totalSvrs: totalSvrs,
                completedSvrs: completedSvrs,
                completionPercentage: completionPercentage,
                svrs: svrDetails
            });
        }
        
        // Filial nomi bo'yicha saralash
        result.sort((a, b) => a.branch.name.localeCompare(b.branch.name));
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        log.error('Filiallar holatini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Filiallar bo'yicha tasdiqlovchilar statistikasi (/:requestId dan oldin bo'lishi kerak)
router.get('/branch-approvers-stats', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { brandId } = req.query;
        
        // Barcha filiallarni olish
        let branchesQuery = db('debt_branches')
            .join('debt_brands', 'debt_branches.brand_id', 'debt_brands.id')
            .select('debt_branches.id', 'debt_branches.name as branch_name', 'debt_branches.brand_id', 'debt_brands.name as brand_name');
        
        if (brandId) {
            branchesQuery = branchesQuery.where('debt_branches.brand_id', brandId);
        }
        
        const branches = await branchesQuery.orderBy('debt_branches.name', 'asc');
        
        // Har bir filial uchun SVRlarni olish va har bir SVR uchun alohida qator yaratish
        const allSvrRows = [];
        
        for (const branch of branches) {
            // 1. Avval debt_svrs jadvalidan SVRlarni olish
            let svrsQuery = db('debt_svrs')
                .where('branch_id', branch.id)
                .select('id', 'name')
                .orderBy('name');
            
            const svrsFromTable = await svrsQuery;
            
            // 2. Jarayondagi so'rovlardan SVR ID'larni olish
            // To'liq tasdiqlangan holatlar (ularni o'tkazib yuboramiz - ro'yxatda ko'rsatilmaydi)
            const fullyApprovedStatuses = ['FINAL_APPROVED', 'DEBT_FOUND'];
            
            const requestsWithSvrs = await db('debt_requests')
                .where('branch_id', branch.id)
                .whereNotIn('status', fullyApprovedStatuses)
                .whereNotNull('svr_id')
                .select('svr_id')
                .distinct('svr_id');
            
            const svrIdsFromRequests = new Set(requestsWithSvrs.map(r => r.svr_id));
            const svrIdsFromTable = new Set(svrsFromTable.map(s => s.id));
            
            // 3. Faqat debt_requests da mavjud, lekin debt_svrs da yo'q bo'lgan SVR ID'larni topish
            const missingSvrIds = [...svrIdsFromRequests].filter(id => !svrIdsFromTable.has(id));
            
            // 4. Yo'q bo'lgan SVR ID'lar uchun SVR ma'lumotlarini olish
            const missingSvrs = [];
            if (missingSvrIds.length > 0) {
                // debt_svrs jadvalidan yana bir bor tekshirish (ehtimol parallel query natijasi)
                const missingSvrsFromTable = await db('debt_svrs')
                    .whereIn('id', missingSvrIds)
                    .select('id', 'name');
                
                const foundSvrIds = new Set(missingSvrsFromTable.map(s => s.id));
                
                // Topilgan SVR'larni qo'shish (lekin bu holatda ular allaqachon svrsFromTable da bo'lishi kerak edi)
                // Bu faqat parallel query natijasini tekshirish uchun
                for (const svr of missingSvrsFromTable) {
                    if (!svrIdsFromTable.has(svr.id)) {
                        missingSvrs.push(svr);
                    }
                }
                
                // Topilmagan SVR'lar uchun faqat ID ni ishlatamiz
                const notFoundSvrIds = missingSvrIds.filter(id => !foundSvrIds.has(id));
                for (const svrId of notFoundSvrIds) {
                    // debt_requests jadvalidan SVR nomini olish mumkin emas, chunki u yerda faqat svr_id bor
                    // Shuning uchun, faqat ID ni ishlatamiz yoki "Noma'lum SVR" deb ko'rsatamiz
                    missingSvrs.push({
                        id: svrId,
                        name: `Noma'lum SVR (ID: ${svrId})`
                    });
                }
            }
            
            // 5. Barcha SVR'larni birlashtirish (dublikatlarni olib tashlash)
            const allSvrsMap = new Map();
            for (const svr of svrsFromTable) {
                allSvrsMap.set(svr.id, svr);
            }
            for (const svr of missingSvrs) {
                if (!allSvrsMap.has(svr.id)) {
                    allSvrsMap.set(svr.id, svr);
                }
            }
            const allSvrs = Array.from(allSvrsMap.values());
            
            // Agar SVRlar bo'lmasa, bitta qator yaratamiz (SVR nomi "SVR topilmadi")
            if (allSvrs.length === 0) {
                const branchData = await processBranchData(branch, null);
                if (branchData) {
                    allSvrRows.push(branchData);
                }
                continue;
            }
            
            // Har bir SVR uchun alohida qator yaratish
            // To'liq tasdiqlangan so'rovlar ro'yxatda ko'rsatilmaydi
            for (const svr of allSvrs) {
                // SVR uchun eng so'nggi so'rovni olish va to'liq tasdiqlanganligini tekshirish
                const latestRequest = await db('debt_requests')
                    .where('svr_id', svr.id)
                    .orderBy('created_at', 'desc')
                    .first();
                
                // To'liq tasdiqlangan holatlar
                const fullyApprovedStatuses = ['FINAL_APPROVED', 'DEBT_FOUND'];
                
                // Agar eng so'nggi so'rov to'liq tasdiqlangan bo'lsa, ro'yxatda ko'rsatilmaydi
                if (latestRequest && fullyApprovedStatuses.includes(latestRequest.status)) {
                    continue; // To'liq tasdiqlangan SVRlarni o'tkazib yuborish
                }
                
                // SVR uchun filial ma'lumotlarini olish
                const branchData = await processBranchData(branch, svr);
                if (branchData) {
                    allSvrRows.push(branchData);
                }
            }
        }
        
        // Helper funksiya: filial ma'lumotlarini olish
        async function processBranchData(branch, svr) {
            
            const approvers = {
                manager: [],
                leader: [],
                cashier: [],
                operator: [],
                supervisor: []
            };
            
            // Filialga bog'langan foydalanuvchilarni olish - barcha jadvallardan
            const [boundUsersFromBranches, cashiersFromTable, operatorsFromTable, managersFromRequests, leadersFromBrands] = await Promise.all([
                // debt_user_branches jadvalidan
                db('debt_user_branches')
                    .join('users', 'debt_user_branches.user_id', 'users.id')
                    .where('debt_user_branches.branch_id', branch.id)
                    .select('users.id', 'users.fullname', 'users.username', 'users.role'),
                // debt_cashiers jadvalidan
                db('debt_cashiers')
                    .join('users', 'debt_cashiers.user_id', 'users.id')
                    .where('debt_cashiers.branch_id', branch.id)
                    .where('debt_cashiers.is_active', true)
                    .select('users.id', 'users.fullname', 'users.username', 'users.role'),
                // debt_operators jadvalidan (brend bo'yicha)
                db('debt_operators')
                    .join('users', 'debt_operators.user_id', 'users.id')
                    .where('debt_operators.brand_id', branch.brand_id)
                    .where('debt_operators.is_active', true)
                    .select('users.id', 'users.fullname', 'users.username', 'users.role'),
                // debt_requests jadvalidan (menejerlar - so'rov yaratganlar)
                // Bu foydalanuvchilar so'rov yaratgan, shuning uchun ularni menejer sifatida ko'rsatamiz
                db('debt_requests')
                    .join('users', 'debt_requests.created_by', 'users.id')
                    .where('debt_requests.branch_id', branch.id)
                    .select('users.id', 'users.fullname', 'users.username', 'users.role')
                    .groupBy('users.id', 'users.fullname', 'users.username', 'users.role'),
                // debt_user_brands jadvalidan (rahbarlar - brend bo'yicha)
                db('debt_user_brands')
                    .join('users', 'debt_user_brands.user_id', 'users.id')
                    .where('debt_user_brands.brand_id', branch.brand_id)
                    .where(function() {
                        this.where('users.role', 'leader')
                            .orWhere('users.role', 'rahbar');
                    })
                    .select('users.id', 'users.fullname', 'users.username', 'users.role')
            ]);
            
            
            // Barcha foydalanuvchilarni birlashtirish va dublikatlarni olib tashlash
            const allUsersMap = new Map();
            
            // managersFromRequests ni alohida ishlov berish - ularni menejer sifatida belgilash
            const managersWithFlag = managersFromRequests.map(u => ({ ...u, role: 'manager', isFromRequests: true }));
            
            [...boundUsersFromBranches, ...cashiersFromTable, ...operatorsFromTable, ...managersWithFlag, ...leadersFromBrands].forEach(user => {
                if (!allUsersMap.has(user.id)) {
                    allUsersMap.set(user.id, user);
                } else {
                    // Agar foydalanuvchi allaqachon mavjud bo'lsa, lekin isFromRequests=true bo'lsa, uni yangilaymiz
                    const existing = allUsersMap.get(user.id);
                    if (user.isFromRequests && !existing.isFromRequests) {
                        allUsersMap.set(user.id, { ...existing, role: 'manager', isFromRequests: true });
                    }
                }
            });
            
            const boundUsers = Array.from(allUsersMap.values());
            
            
            // Har bir tasdiqlovchi uchun so'rovlar statistikasini olish
            const getApproverStatus = async (userId, role, currentBranchId = branch.id, currentBrandId = branch.brand_id, currentSvrId = svr?.id) => {
                let userRequests = [];
                
                if (role === 'manager' || role === 'menejer') {
                    // ✅ Tuzatish: Menejer yaratgan so'rovlar - faqat NORMAL so'rovlar (SET so'rovlarni istisno qilish)
                    // SET so'rovlar uchun faqat Rahbar ustunida "Jarayondagi" ko'rsatilishi kerak
                    let query = db('debt_requests')
                        .where('branch_id', currentBranchId)
                        .where('created_by', userId)
                        .where('type', '!=', 'SET'); // SET so'rovlarni istisno qilish
                    
                    if (currentSvrId) {
                        query = query.where('svr_id', currentSvrId);
                    }
                    
                    userRequests = await query.select('status', 'current_approver_type', 'current_approver_id', 'type');
                } else if (role === 'leader' || role === 'rahbar') {
                    // Rahbar uchun SET so'rovlar
                    let query = db('debt_requests')
                        .where('branch_id', currentBranchId)
                        .where('type', 'SET')
                        .whereIn('status', ['SET_PENDING', 'APPROVED_BY_LEADER', 'REJECTED_BY_LEADER', 'APPROVED_BY_CASHIER', 'APPROVED_BY_OPERATOR', 'APPROVED_BY_SUPERVISOR', 'FINAL_APPROVED', 'DEBT_FOUND']);
                    
                    if (currentSvrId) {
                        query = query.where('svr_id', currentSvrId);
                    }
                    
                    userRequests = await query.select('status', 'current_approver_type', 'current_approver_id');
                } else if (role === 'cashier' || role === 'kassir') {
                    // Kassir uchun so'rovlar - faqat bu kassirga biriktirilgan so'rovlar
                    const cashierBranches = await db('debt_cashiers')
                        .where('user_id', userId)
                        .where('branch_id', currentBranchId)
                        .where('is_active', true)
                        .select('branch_id');
                    
                    if (cashierBranches.length > 0) {
                        let query = db('debt_requests')
                            .where('branch_id', currentBranchId)
                            .where(function() {
                                // NORMAL so'rovlar uchun
                                this.where(function() {
                                    this.where('type', '!=', 'SET')
                                        .where(function() {
                                            this.where('status', 'PENDING_APPROVAL')
                                                .orWhere('status', 'APPROVED_BY_LEADER')
                                                .orWhere('status', 'APPROVED_BY_CASHIER')
                                                .orWhere('status', 'APPROVED_BY_OPERATOR')
                                                .orWhere('status', 'APPROVED_BY_SUPERVISOR')
                                                .orWhere('status', 'FINAL_APPROVED')
                                                .orWhere('status', 'DEBT_FOUND')
                                                .orWhere(function() {
                                                    this.where('current_approver_type', 'cashier')
                                                        .where('current_approver_id', userId);
                                                });
                                        });
                                })
                                // SET so'rovlar uchun (APPROVED_BY_LEADER dan keyin)
                                .orWhere(function() {
                                    this.where('type', 'SET')
                                        .where(function() {
                                            this.where('status', 'APPROVED_BY_LEADER')
                                                .orWhere('status', 'APPROVED_BY_CASHIER')
                                                .orWhere('status', 'APPROVED_BY_OPERATOR')
                                                .orWhere('status', 'APPROVED_BY_SUPERVISOR')
                                                .orWhere('status', 'FINAL_APPROVED')
                                                .orWhere('status', 'DEBT_FOUND')
                                                .orWhere(function() {
                                                    this.where('current_approver_type', 'cashier')
                                                        .where('current_approver_id', userId);
                                                });
                                        });
                                });
                            });
                        
                        if (currentSvrId) {
                            query = query.where('svr_id', currentSvrId);
                        }
                        
                        userRequests = await query.select('status', 'current_approver_id', 'current_approver_type', 'type');
                    }
                } else if (role === 'operator') {
                    // Operator uchun so'rovlar - faqat bu operatorga biriktirilgan so'rovlar
                    const operatorBrands = await db('debt_operators')
                        .where('user_id', userId)
                        .where('brand_id', currentBrandId)
                        .where('is_active', true)
                        .select('brand_id');
                    
                    if (operatorBrands.length > 0) {
                        let query = db('debt_requests')
                            .where('branch_id', currentBranchId)
                            .where(function() {
                                this.where('status', 'APPROVED_BY_CASHIER')
                                    .orWhere('status', 'APPROVED_BY_OPERATOR')
                                    .orWhere('status', 'APPROVED_BY_SUPERVISOR')
                                    .orWhere('status', 'FINAL_APPROVED')
                                    .orWhere('status', 'DEBT_FOUND')
                                    .orWhere(function() {
                                        this.where('current_approver_type', 'operator')
                                            .where('current_approver_id', userId);
                                    });
                            });
                        
                        if (currentSvrId) {
                            query = query.where('svr_id', currentSvrId);
                        }
                        
                        userRequests = await query.select('status', 'current_approver_id', 'current_approver_type');
                    }
                } else if (role === 'supervisor' || role === 'nazoratchi') {
                    // Nazoratchi uchun so'rovlar
                    let query = db('debt_requests')
                        .where('branch_id', currentBranchId)
                        .where(function() {
                            this.where('status', 'APPROVED_BY_OPERATOR')
                                .orWhere('status', 'APPROVED_BY_SUPERVISOR')
                                .orWhere('status', 'FINAL_APPROVED')
                                .orWhere('status', 'DEBT_FOUND')
                                .orWhere(function() {
                                    this.where('current_approver_type', 'supervisor')
                                        .where('current_approver_id', userId);
                                });
                        });
                    
                    if (currentSvrId) {
                        query = query.where('svr_id', currentSvrId);
                    }
                    
                    userRequests = await query.select('status', 'current_approver_id', 'current_approver_type');
                }
                
                if (userRequests.length === 0) {
                    return 'none'; // So'rov boshlanmagan
                }
                
                // Statusni aniqlash - tasdiqlangan holatlar
                const approvedStatuses = [
                    'FINAL_APPROVED',
                    'DEBT_FOUND',
                    'APPROVED_BY_LEADER',
                    'APPROVED_BY_CASHIER',
                    'APPROVED_BY_OPERATOR',
                    'APPROVED_BY_SUPERVISOR'
                ];
                
                // Har bir rol uchun to'g'ri tasdiqlangan holatlarni tekshirish
                let roleApprovedStatuses = approvedStatuses;
                if (role === 'leader' || role === 'rahbar') {
                    // Rahbar uchun faqat o'zi tasdiqlagan holatlar
                    roleApprovedStatuses = ['APPROVED_BY_LEADER', 'APPROVED_BY_CASHIER', 'APPROVED_BY_OPERATOR', 'APPROVED_BY_SUPERVISOR', 'FINAL_APPROVED', 'DEBT_FOUND'];
                } else if (role === 'cashier' || role === 'kassir') {
                    // Kassir uchun faqat o'zi tasdiqlagan holatlar
                    roleApprovedStatuses = ['APPROVED_BY_CASHIER', 'APPROVED_BY_OPERATOR', 'APPROVED_BY_SUPERVISOR', 'FINAL_APPROVED', 'DEBT_FOUND'];
                } else if (role === 'operator') {
                    // Operator uchun faqat o'zi tasdiqlagan holatlar
                    roleApprovedStatuses = ['APPROVED_BY_OPERATOR', 'APPROVED_BY_SUPERVISOR', 'FINAL_APPROVED', 'DEBT_FOUND'];
                } else if (role === 'supervisor' || role === 'nazoratchi') {
                    // Nazoratchi uchun faqat o'zi tasdiqlagan holatlar
                    roleApprovedStatuses = ['APPROVED_BY_SUPERVISOR', 'FINAL_APPROVED', 'DEBT_FOUND'];
                }
                
                const allApproved = userRequests.length > 0 && userRequests.every(req => roleApprovedStatuses.includes(req.status));
                const hasApproved = userRequests.some(req => roleApprovedStatuses.includes(req.status));
                const hasPending = userRequests.some(req =>
                    req.status.includes('PENDING') ||
                    req.status === 'SET_PENDING' ||
                    (req.current_approver_type && req.current_approver_id === userId)
                );
                
                let finalStatus = 'none';
                if (allApproved) {
                    finalStatus = 'approved'; // Barchasi to'liq tasdiqlangan
                } else if (hasApproved) {
                    finalStatus = 'approved'; // Ba'zilari tasdiqlangan
                } else if (hasPending) {
                    finalStatus = 'pending'; // Jarayondagi
                }
                
                return finalStatus;
            };
            
            // Rol bo'yicha guruhlash va status qo'shish
            for (const user of boundUsers) {
                let userStatus = 'none';
                const userRole = user.role;
                const isFromRequests = user.isFromRequests || false;
                
                // Agar foydalanuvchi so'rov yaratgan bo'lsa (isFromRequests=true), uni menejer sifatida ko'rsatamiz
                if (isFromRequests || userRole === 'manager' || userRole === 'menejer') {
                    userStatus = await getApproverStatus(user.id, 'manager', branch.id, branch.brand_id, svr?.id);
                    approvers.manager.push({
                        id: user.id,
                        fullname: user.fullname || user.username,
                        username: user.username,
                        status: userStatus
                    });
                } else if (userRole === 'leader' || userRole === 'rahbar') {
                    userStatus = await getApproverStatus(user.id, 'leader', branch.id, branch.brand_id, svr?.id);
                    approvers.leader.push({
                        id: user.id,
                        fullname: user.fullname || user.username,
                        username: user.username,
                        status: userStatus
                    });
                } else if (userRole === 'cashier' || userRole === 'kassir') {
                    userStatus = await getApproverStatus(user.id, 'cashier', branch.id, branch.brand_id, svr?.id);
                    approvers.cashier.push({
                        id: user.id,
                        fullname: user.fullname || user.username,
                        username: user.username,
                        status: userStatus
                    });
                } else if (userRole === 'operator') {
                    userStatus = await getApproverStatus(user.id, 'operator', branch.id, branch.brand_id, svr?.id);
                    approvers.operator.push({
                        id: user.id,
                        fullname: user.fullname || user.username,
                        username: user.username,
                        status: userStatus
                    });
                } else if (userRole === 'supervisor' || userRole === 'nazoratchi') {
                    userStatus = await getApproverStatus(user.id, 'supervisor', branch.id, branch.brand_id, svr?.id);
                    approvers.supervisor.push({
                        id: user.id,
                        fullname: user.fullname || user.username,
                        username: user.username,
                        status: userStatus
                    });
                }
            }
            
            // Filial uchun so'rovlarni olish va statusni aniqlash
            const requests = await db('debt_requests')
                .where('branch_id', branch.id)
                .select('status', 'current_approver_type', 'current_approver_id');
            
            let status = 'none'; // So'rov boshlanmagan
            if (requests.length > 0) {
                // Tasdiqlangan holatlar
                const approvedStatuses = [
                    'FINAL_APPROVED',
                    'DEBT_FOUND',
                    'APPROVED_BY_LEADER',
                    'APPROVED_BY_CASHIER',
                    'APPROVED_BY_OPERATOR',
                    'APPROVED_BY_SUPERVISOR'
                ];
                
                const allApproved = requests.every(req => approvedStatuses.includes(req.status));
                const hasApproved = requests.some(req => approvedStatuses.includes(req.status));
                const hasPending = requests.some(req =>
                    req.status.includes('PENDING') ||
                    req.status === 'SET_PENDING'
                );
                
                if (allApproved) {
                    status = 'approved'; // Barchasi to'liq tasdiqlangan
                } else if (hasApproved) {
                    status = 'approved'; // Ba'zilari tasdiqlangan
                } else if (hasPending) {
                    status = 'pending'; // Jarayondagi
                }
            }
            
            // Har bir rol uchun statusni aniqlash
            // Avval approvers ro'yxatidan, keyin so'rovlardan tekshiramiz
            const roleStatuses = {
                manager: 'none',
                leader: 'none',
                cashier: 'none',
                operator: 'none',
                supervisor: 'none'
            };
            
            // Filial uchun barcha so'rovlarni olish (agar SVR bo'lsa, faqat o'sha SVR uchun)
            let allBranchRequestsQuery = db('debt_requests')
                .where('branch_id', branch.id);
            
            // Agar SVR bo'lsa, faqat o'sha SVR uchun so'rovlarni olish
            if (svr && svr.id) {
                allBranchRequestsQuery = allBranchRequestsQuery.where('svr_id', svr.id);
            }
            
            const allBranchRequests = await allBranchRequestsQuery
                .select('status', 'type', 'current_approver_type', 'current_approver_id', 'svr_id');
            
            // Helper funksiya: statusni aniqlash (ba'zilari tasdiqlangan, ba'zilari jarayonda)
            // Agar ba'zi so'rovlar tasdiqlangan bo'lsa, status "approved" bo'ladi
            // Agar barchasi jarayonda bo'lsa, status "pending" bo'ladi
            const determineStatus = (approvedCount, pendingCount, totalCount) => {
                if (totalCount === 0) return 'none';
                if (approvedCount > 0) return 'approved'; // Agar ba'zi so'rovlar tasdiqlangan bo'lsa, "approved"
                if (pendingCount > 0) return 'pending'; // Agar barchasi jarayonda bo'lsa, "pending"
                return 'none';
            };
            
            // ✅ Tuzatish: Menejer statusi - faqat menejer yaratgan NORMAL so'rovlar
            // SET so'rovlar uchun faqat Rahbar ustunida "Jarayondagi" ko'rsatilishi kerak
            if (approvers.manager.length > 0) {
                const managerStatuses = approvers.manager.map(m => m.status);
                const approvedCount = managerStatuses.filter(s => s === 'approved').length;
                const pendingCount = managerStatuses.filter(s => s === 'pending').length;
                roleStatuses.manager = determineStatus(approvedCount, pendingCount, managerStatuses.length);
            } else if (allBranchRequests.length > 0) {
                // ✅ Tuzatish: Faqat NORMAL so'rovlarni tekshirish (SET so'rovlarni istisno qilish)
                const normalRequests = allBranchRequests.filter(r => r.type !== 'SET');
                
                if (normalRequests.length > 0) {
                    // Agar menejer topilmasa, lekin NORMAL so'rovlar bo'lsa, menejer so'rov yaratgan
                    const approvedCount = normalRequests.filter(r => 
                        r.status === 'APPROVED_BY_LEADER' ||
                        r.status === 'APPROVED_BY_CASHIER' ||
                        r.status === 'APPROVED_BY_OPERATOR' ||
                        r.status === 'APPROVED_BY_SUPERVISOR' ||
                        r.status === 'FINAL_APPROVED' ||
                        r.status === 'DEBT_FOUND'
                    ).length;
                    const pendingCount = normalRequests.filter(r => 
                        r.status.includes('PENDING') && r.status !== 'SET_PENDING' // SET_PENDING ni istisno qilish
                    ).length;
                    roleStatuses.manager = determineStatus(approvedCount, pendingCount, normalRequests.length);
                }
            }
            
            // Rahbar statusi - faqat SET so'rovlar uchun
            const setRequests = allBranchRequests.filter(r => r.type === 'SET');
            
            if (approvers.leader.length > 0) {
                const leaderStatuses = approvers.leader.map(l => l.status);
                const approvedCount = leaderStatuses.filter(s => s === 'approved').length;
                const pendingCount = leaderStatuses.filter(s => s === 'pending').length;
                roleStatuses.leader = determineStatus(approvedCount, pendingCount, leaderStatuses.length);
            } else if (setRequests.length > 0) {
                const approvedCount = setRequests.filter(r => 
                    r.status === 'APPROVED_BY_LEADER' ||
                    r.status === 'APPROVED_BY_CASHIER' ||
                    r.status === 'APPROVED_BY_OPERATOR' ||
                    r.status === 'APPROVED_BY_SUPERVISOR' ||
                    r.status === 'FINAL_APPROVED' ||
                    r.status === 'DEBT_FOUND'
                ).length;
                const pendingCount = setRequests.filter(r => r.status === 'SET_PENDING').length;
                roleStatuses.leader = determineStatus(approvedCount, pendingCount, setRequests.length);
            }
            
            // Kassir statusi - kassir tasdiqlashi kerak bo'lgan so'rovlar
            // SET so'rovlar uchun: APPROVED_BY_LEADER dan keyin kassirga yuboriladi
            // NORMAL so'rovlar uchun: PENDING_APPROVAL dan boshlanadi
            const cashierRequests = allBranchRequests.filter(r => {
                // SET so'rovlar uchun
                if (r.type === 'SET') {
                    return r.status === 'APPROVED_BY_LEADER' ||
                           r.status === 'APPROVED_BY_CASHIER' ||
                           r.status === 'APPROVED_BY_OPERATOR' ||
                           r.status === 'APPROVED_BY_SUPERVISOR' ||
                           r.status === 'FINAL_APPROVED' ||
                           r.status === 'DEBT_FOUND' ||
                           (r.current_approver_type === 'cashier');
                }
                // NORMAL so'rovlar uchun
                return r.status === 'PENDING_APPROVAL' || 
                       r.status === 'APPROVED_BY_LEADER' ||
                       r.status === 'APPROVED_BY_CASHIER' ||
                       r.status === 'APPROVED_BY_OPERATOR' ||
                       r.status === 'APPROVED_BY_SUPERVISOR' ||
                       r.status === 'FINAL_APPROVED' ||
                       r.status === 'DEBT_FOUND' ||
                       (r.current_approver_type === 'cashier');
            });
            
            if (cashierRequests.length > 0) {
                const approvedCount = cashierRequests.filter(r => 
                    r.status === 'APPROVED_BY_CASHIER' ||
                    r.status === 'APPROVED_BY_OPERATOR' ||
                    r.status === 'APPROVED_BY_SUPERVISOR' ||
                    r.status === 'FINAL_APPROVED' ||
                    r.status === 'DEBT_FOUND'
                ).length;
                const pendingCount = cashierRequests.filter(r => 
                    r.status === 'PENDING_APPROVAL' || 
                    r.status === 'APPROVED_BY_LEADER' ||
                    r.current_approver_type === 'cashier'
                ).length;
                roleStatuses.cashier = determineStatus(approvedCount, pendingCount, cashierRequests.length);
            } else if (approvers.cashier.length > 0) {
                const cashierStatuses = approvers.cashier.map(c => c.status);
                const approvedCount = cashierStatuses.filter(s => s === 'approved').length;
                const pendingCount = cashierStatuses.filter(s => s === 'pending').length;
                roleStatuses.cashier = determineStatus(approvedCount, pendingCount, cashierStatuses.length);
            }
            
            // Operator statusi - faqat operator tasdiqlashi kerak bo'lgan so'rovlar
            const operatorRequests = allBranchRequests.filter(r => 
                r.status === 'APPROVED_BY_CASHIER' || 
                r.status === 'APPROVED_BY_OPERATOR' ||
                r.status === 'APPROVED_BY_SUPERVISOR' ||
                r.status === 'FINAL_APPROVED' ||
                r.status === 'DEBT_FOUND' ||
                (r.current_approver_type === 'operator')
            );
            
            if (operatorRequests.length > 0) {
                const approvedCount = operatorRequests.filter(r => 
                    r.status === 'APPROVED_BY_OPERATOR' ||
                    r.status === 'APPROVED_BY_SUPERVISOR' ||
                    r.status === 'FINAL_APPROVED' ||
                    r.status === 'DEBT_FOUND'
                ).length;
                const pendingCount = operatorRequests.filter(r => 
                    r.status === 'APPROVED_BY_CASHIER' ||
                    r.current_approver_type === 'operator'
                ).length;
                roleStatuses.operator = determineStatus(approvedCount, pendingCount, operatorRequests.length);
                
                // Agar operator "Jarayondagi" bo'lsa, kassir ham tasdiqlangan bo'lishi kerak
                // Chunki operator faqat kassir tasdiqlagandan keyin ishlaydi
                if (pendingCount > 0) {
                    // Operator "Jarayondagi" bo'lsa, kassir ham tasdiqlangan bo'lishi kerak
                    if (roleStatuses.cashier === 'none' || !roleStatuses.cashier) {
                        roleStatuses.cashier = 'approved';
                    }
                }
            } else if (approvers.operator.length > 0) {
                const operatorStatuses = approvers.operator.map(o => o.status);
                const approvedCount = operatorStatuses.filter(s => s === 'approved').length;
                const pendingCount = operatorStatuses.filter(s => s === 'pending').length;
                roleStatuses.operator = determineStatus(approvedCount, pendingCount, operatorStatuses.length);
            }
            
            // Nazoratchi statusi - faqat nazoratchi tasdiqlashi kerak bo'lgan so'rovlar
            const supervisorRequests = allBranchRequests.filter(r => 
                r.status === 'APPROVED_BY_OPERATOR' || 
                r.status === 'APPROVED_BY_SUPERVISOR' ||
                r.status === 'FINAL_APPROVED' ||
                r.status === 'DEBT_FOUND' ||
                (r.current_approver_type === 'supervisor')
            );
            
            if (supervisorRequests.length > 0) {
                const approvedCount = supervisorRequests.filter(r => 
                    r.status === 'APPROVED_BY_SUPERVISOR' || 
                    r.status === 'FINAL_APPROVED' ||
                    r.status === 'DEBT_FOUND'
                ).length;
                const pendingCount = supervisorRequests.filter(r => 
                    r.status === 'APPROVED_BY_OPERATOR' ||
                    r.current_approver_type === 'supervisor'
                ).length;
                roleStatuses.supervisor = determineStatus(approvedCount, pendingCount, supervisorRequests.length);
            } else if (approvers.supervisor.length > 0) {
                const supervisorStatuses = approvers.supervisor.map(s => s.status);
                const approvedCount = supervisorStatuses.filter(s => s === 'approved').length;
                const pendingCount = supervisorStatuses.filter(s => s === 'pending').length;
                roleStatuses.supervisor = determineStatus(approvedCount, pendingCount, supervisorStatuses.length);
            }
            
            // SVR nomi
            const svrName = svr ? svr.name : 'SVR topilmadi';
            
            return {
                branch_id: branch.id,
                branch_name: branch.branch_name,
                brand_name: branch.brand_name,
                svr_id: svr ? svr.id : null,
                svr_name: svrName,
                status: status,
                approvers: approvers,
                roleStatuses: roleStatuses
            };
        }
        
        res.json({
            success: true,
            data: allSvrRows
        });
    } catch (error) {
        log.error('Filiallar statistikasini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// =============================================
// TELEGRAM BOT FAOLIYATI (Bot Activity)
// =============================================
// MUHIM: Bu endpointlar /:requestId dan oldin bo'lishi kerak!

// Bot faoliyati - tasdiqlashlar tarixi
router.get('/bot-activity', isAuthenticated, hasPermission(['debt:bot_activity', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { page = 1, limit = 50, status, approvalType, startDate, endDate, searchTerm } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        // Tasdiqlashlar tarixini olish
        let approvalsQuery = db('debt_request_approvals')
            .join('debt_requests', 'debt_request_approvals.request_id', 'debt_requests.id')
            .leftJoin('users as approver', 'debt_request_approvals.approver_id', 'approver.id')
            .leftJoin('users as creator', 'debt_requests.created_by', 'creator.id')
            .leftJoin('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .select(
                'debt_request_approvals.id',
                'debt_request_approvals.request_id',
                'debt_request_approvals.approval_type',
                'debt_request_approvals.status as approval_status',
                'debt_request_approvals.note',
                'debt_request_approvals.debt_amount',
                'debt_request_approvals.created_at as approval_date',
                'debt_requests.request_uid as request_uid',
                'debt_requests.type as request_type',
                'debt_requests.status as request_status',
                'approver.username as approver_username',
                'approver.fullname as approver_fullname',
                'creator.username as creator_username',
                'creator.fullname as creator_fullname',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
            .orderBy('debt_request_approvals.created_at', 'desc');
        
        // Filterlar
        if (status) {
            approvalsQuery = approvalsQuery.where('debt_request_approvals.status', status);
        }
        if (approvalType) {
            approvalsQuery = approvalsQuery.where('debt_request_approvals.approval_type', approvalType);
        }
        if (startDate) {
            approvalsQuery = approvalsQuery.where('debt_request_approvals.created_at', '>=', startDate);
        }
        if (endDate) {
            approvalsQuery = approvalsQuery.where('debt_request_approvals.created_at', '<=', endDate + ' 23:59:59');
        }
        if (searchTerm) {
            approvalsQuery = approvalsQuery.where(function() {
                this.where('debt_requests.request_uid', 'like', `%${searchTerm}%`)
                    .orWhere('approver.username', 'like', `%${searchTerm}%`)
                    .orWhere('approver.fullname', 'like', `%${searchTerm}%`)
                    .orWhere('creator.username', 'like', `%${searchTerm}%`)
                    .orWhere('creator.fullname', 'like', `%${searchTerm}%`);
            });
        }
        
        // Jami sonini olish
        const totalQuery = approvalsQuery.clone();
        const totalResult = await db.raw(`SELECT COUNT(*) as count FROM (${totalQuery.toString()}) as subquery`);
        const total = totalResult[0]?.count || 0;
        
        // Sahifalash
        const approvals = await approvalsQuery.limit(parseInt(limit)).offset(offset);
        
        // Statistika
        const statsQuery = db('debt_request_approvals')
            .select('approval_type', 'status')
            .count('* as count')
            .groupBy('approval_type', 'status');
        
        const stats = await statsQuery;
        
        // Bugungi tasdiqlashlar soni
        const today = new Date().toISOString().split('T')[0];
        const todayApprovals = await db('debt_request_approvals')
            .where('created_at', '>=', today)
            .count('* as count')
            .first();
        
        res.json({
            success: true,
            data: {
                approvals: approvals.map(a => ({
                    id: a.id,
                    requestId: a.request_id,
                    requestUid: a.request_uid,
                    requestType: a.request_type,
                    requestStatus: a.request_status,
                    approvalType: a.approval_type,
                    approvalStatus: a.approval_status,
                    note: a.note,
                    debtAmount: a.debt_amount,
                    approvalDate: a.approval_date,
                    approver: {
                        username: a.approver_username,
                        fullname: a.approver_fullname
                    },
                    creator: {
                        username: a.creator_username,
                        fullname: a.creator_fullname
                    },
                    brand: a.brand_name,
                    branch: a.branch_name,
                    svr: a.svr_name
                })),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    totalPages: Math.ceil(total / parseInt(limit))
                },
                stats: {
                    byType: stats.reduce((acc, s) => {
                        if (!acc[s.approval_type]) acc[s.approval_type] = {};
                        acc[s.approval_type][s.status] = parseInt(s.count) || 0;
                        return acc;
                    }, {}),
                    todayCount: parseInt(todayApprovals?.count) || 0
                }
            }
        });
    } catch (error) {
        log.error('Bot faoliyatini olishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Server xatolik' });
    }
});

// Kutilayotgan tasdiqlashlar (web'dan tasdiqlash uchun)
router.get('/pending-approvals', isAuthenticated, hasPermission(['debt:bot_activity', 'debt:approve_leader', 'debt:approve_cashier', 'debt:approve_operator', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const user = req.session.user;
        const { type, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        // Foydalanuvchi qaysi turda tasdiqlashi mumkinligini aniqlash
        const userHelper = require('../../bot/unified/userHelper.js');
        const canApproveLeader = await userHelper.hasPermission(user.id, 'debt:approve_leader');
        const canApproveCashier = await userHelper.hasPermission(user.id, 'debt:approve_cashier');
        const canApproveOperator = await userHelper.hasPermission(user.id, 'debt:approve_operator');
        const isAdmin = await userHelper.hasPermission(user.id, 'debt:admin') || await userHelper.hasPermission(user.id, 'roles:manage');
        
        let query = db('debt_requests')
            .leftJoin('users as creator', 'debt_requests.created_by', 'creator.id')
            .leftJoin('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .leftJoin('debt_requests_archive', 'debt_requests.id', 'debt_requests_archive.original_request_id')
            .whereNull('debt_requests_archive.original_request_id') // Faqat archive bo'lmagan so'rovlar
            .select(
                'debt_requests.*',
                'creator.username as creator_username',
                'creator.fullname as creator_fullname',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
        
        // Tasdiqlash turiga qarab filter
        if (!isAdmin) {
            const allowedStatuses = [];
            if (canApproveLeader) {
                allowedStatuses.push('SET_PENDING'); // Leader faqat SET so'rovlarni tasdiqlaydi
            }
            if (canApproveCashier) {
                allowedStatuses.push('APPROVED_BY_LEADER', 'PENDING_APPROVAL'); // Cashier leader'dan keyin tasdiqlaydi
            }
            if (canApproveOperator) {
                allowedStatuses.push('APPROVED_BY_CASHIER'); // Operator cashier'dan keyin tasdiqlaydi
            }
            
            if (allowedStatuses.length > 0) {
                query = query.whereIn('debt_requests.status', allowedStatuses);
            } else {
                // Hech qanday tasdiqlash huquqi yo'q
                return res.json({
                    success: true,
                    data: {
                        requests: [],
                        pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                    }
                });
            }
        } else {
            // Admin uchun barcha kutilayotgan so'rovlar
            query = query.whereIn('debt_requests.status', [
                'PENDING_APPROVAL', 'SET_PENDING', 
                'APPROVED_BY_LEADER', 'APPROVED_BY_CASHIER'
            ]);
        }
        
        // To'liq tasdiqlangan so'rovlarni filtrlash (FINAL_APPROVED va DEBT_FOUND)
        query = query.whereNotIn('debt_requests.status', ['FINAL_APPROVED', 'DEBT_FOUND']);
        
        // Type filter
        if (type) {
            query = query.where('debt_requests.type', type);
        }
        
        query = query.orderBy('debt_requests.created_at', 'desc');
        
        // Jami sonini olish
        const totalQuery = query.clone();
        const totalResult = await db.raw(`SELECT COUNT(*) as count FROM (${totalQuery.toString()}) as subquery`);
        const total = totalResult[0]?.count || 0;
        
        // Sahifalash
        const requests = await query.limit(parseInt(limit)).offset(offset);
        
        res.json({
            success: true,
            data: {
                requests: requests.map(r => ({
                    id: r.id,
                    uid: r.request_uid,
                    type: r.type,
                    status: r.status,
                    brandId: r.brand_id,
                    branchId: r.branch_id,
                    svrId: r.svr_id,
                    brandName: r.brand_name,
                    branchName: r.branch_name,
                    svrName: r.svr_name,
                    createdBy: {
                        id: r.created_by,
                        username: r.creator_username,
                        fullname: r.creator_fullname
                    },
                    createdAt: r.created_at,
                    updatedAt: r.updated_at
                })),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        log.error('Kutilayotgan tasdiqlashlarni olishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Server xatolik' });
    }
});

// So'rov ma'lumotlari
router.get('/:requestId', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { requestId } = req.params;
        
        const request = await db('debt_requests')
            .join('users', 'debt_requests.created_by', 'users.id')
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .leftJoin('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
            .leftJoin('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
            .select(
                'debt_requests.*',
                'users.username as created_by_username',
                'debt_brands.name as brand_name',
                'debt_branches.name as branch_name',
                'debt_svrs.name as svr_name'
            )
            .where('debt_requests.id', requestId)
            .first();
        
        if (!request) {
            return res.status(404).json({ error: 'So\'rov topilmadi' });
        }
        
        // Loglar
        const logs = await db('debt_request_logs')
            .join('users', 'debt_request_logs.performed_by', 'users.id')
            .select('debt_request_logs.*', 'users.username', 'users.fullname')
            .where('debt_request_logs.request_id', requestId)
            .orderBy('debt_request_logs.created_at', 'desc');
        
        // Fayllar
        const attachments = await db('debt_attachments')
            .where('request_id', requestId);
        
        // Qarzdorlik hisobotlari
        const debtReports = await db('debt_reports')
            .where('request_id', requestId);
        
        // Tasdiqlovchilar ro'yxati (loglardan)
        const approvers = {
            manager: null,
            leader: null,
            cashier: null,
            operator: null,
            supervisor: null
        };
        
        // Loglardan tasdiqlovchilarni aniqlash
        for (const log of logs) {
            if (log.action === 'approve_by_leader' || log.new_status === 'APPROVED_BY_LEADER') {
                approvers.leader = {
                    username: log.username,
                    fullname: log.fullname,
                    approved_at: log.created_at
                };
            } else if (log.action === 'approve_by_cashier' || log.new_status === 'APPROVED_BY_CASHIER') {
                approvers.cashier = {
                    username: log.username,
                    fullname: log.fullname,
                    approved_at: log.created_at
                };
            } else if (log.action === 'approve_by_operator' || log.new_status === 'APPROVED_BY_OPERATOR') {
                approvers.operator = {
                    username: log.username,
                    fullname: log.fullname,
                    approved_at: log.created_at
                };
            } else if (log.action === 'approve_by_supervisor' || log.new_status === 'APPROVED_BY_SUPERVISOR' || log.new_status === 'FINAL_APPROVED') {
                approvers.supervisor = {
                    username: log.username,
                    fullname: log.fullname,
                    approved_at: log.created_at
                };
            } else if (log.action === 'create_request') {
                approvers.manager = {
                    username: log.username,
                    fullname: log.fullname,
                    created_at: log.created_at
                };
            }
        }
        
        res.json({
            ...request,
            logs,
            attachments,
            debtReports,
            approvers
        });
    } catch (error) {
        log.error('So\'rov ma\'lumotlarini olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// So'rov yaratish (bot va web uchun)
// Excel fayl yuklash va parse qilish (preview uchun)
router.post('/upload-excel', isAuthenticated, upload.single('excel'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Excel fayl yuborilmadi' });
        }
        
        const filePath = req.file.path;
        const { brand_id, branch_id, svr_id } = req.body;
        
        // So'rov ma'lumotlarini olish
        let requestData = {};
        if (brand_id) {
            const brand = await db('debt_brands').where('id', brand_id).first();
            if (brand) requestData.brand_name = brand.name;
        }
        if (svr_id) {
            const svr = await db('debt_svrs').where('id', svr_id).first();
            if (svr) requestData.svr_name = svr.name;
        }
        
        // Excel faylni parse qilish
        const parsed = await parseExcelFile(filePath, requestData);
        
        // 3 ta asosiy ustunni tekshirish (ID, Name, Summa)
        const requiredColumns = ['id', 'name', 'summa'];
        const missingColumns = requiredColumns.filter(col => parsed.columns[col] === null || parsed.columns[col] === undefined);
        
        if (missingColumns.length > 0) {
            // Temporary faylni o'chirish
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (unlinkError) {
                log.warn(`Faylni o'chirishda xatolik: ${unlinkError.message}`);
            }
            
            const missingNames = {
                'id': 'ID (Ид клиента)',
                'name': 'Name (Клиент)',
                'summa': 'Summa (Общий)'
            };
            
            return res.status(400).json({
                success: false,
                error: `Excel faylda quyidagi ustunlar topilmadi: ${missingColumns.map(c => missingNames[c]).join(', ')}. Iltimos, faylda barcha kerakli ustunlar mavjudligini tekshiring.`
            });
        }
        
        // Temporary faylni o'chirish
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (unlinkError) {
            log.warn(`Faylni o'chirishda xatolik: ${unlinkError.message}`);
        }
        
        res.json({
            success: true,
            headers: parsed.headers,
            data: parsed.filteredData,
            detectedColumns: parsed.columns,
            totalRows: parsed.filteredData.length,
            total: parsed.total,
            formatted: parsed.formatted
        });
    } catch (error) {
        log.error('Excel fayl yuklashda xatolik:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                log.warn(`Faylni o'chirishda xatolik: ${unlinkError.message}`);
            }
        }
        res.status(500).json({ success: false, error: error.message || 'Excel faylni qayta ishlashda xatolik' });
    }
});

router.post('/', isAuthenticated, upload.single('excel'), async (req, res) => {
    try {
        const user = req.session.user;
        const { type, brand_id, branch_id, svr_id, created_by, extra_info } = req.body;
        
        // Web'dan kelgan so'rovlar uchun created_by ni session'dan olish
        const creatorId = created_by || (user ? user.id : null);
        
        if (!type || !brand_id || !creatorId) {
            return res.status(400).json({ error: 'Majburiy maydonlar to\'ldirilmagan' });
        }
        
        // Dublikat so'rovni tekshirish (bot'dagi logikaga o'xshash)
        if (svr_id) {
            const inProcessStatuses = ['FINAL_APPROVED', 'CANCELLED', 'REJECTED'];
            const existingRequest = await db('debt_requests')
                .where('svr_id', svr_id)
                .whereNotIn('status', inProcessStatuses)
                .first();
            
            if (existingRequest) {
                log.warn(`[WEB_REQUEST] Dublikat so'rov topildi: SVR ID=${svr_id}, Existing Request ID=${existingRequest.id}, RequestUID=${existingRequest.request_uid}, Status=${existingRequest.status}`);
                return res.status(400).json({ 
                    error: 'Bu SVR uchun jarayondagi so\'rov mavjud',
                    existing_request: {
                        id: existingRequest.id,
                        request_uid: existingRequest.request_uid,
                        status: existingRequest.status
                    }
                });
            }
        }
        
        // SET Type so'rov uchun fayl va qiymat tekshiruvi
        if (type === 'SET') {
            log.info(`[WEB_REQUEST] 🔍 SET so'rov tekshiruvi boshlanmoqda: userId=${creatorId}`);
            
            // Fayl yuborilganligini tekshirish
            if (!req.file) {
                log.warn(`[WEB_REQUEST] ❌ SET so'rov uchun Excel fayl yuborilmagan: userId=${creatorId}`);
                return res.status(400).json({ 
                    error: 'SET so\'rov yaratish uchun Excel fayl yuborilishi shart',
                    message: 'SET (Muddat uzaytirish) so\'rovi yaratish uchun Excel fayl yuborilgan bo\'lishi kerak.'
                });
            }
        }
        
        const requestUID = generateRequestUID();
        const status = type === 'SET' ? 'SET_PENDING' : 'PENDING_APPROVAL';
        
        // Excel fayl ma'lumotlarini tayyorlash
        let excelFilePath = null;
        let excelDataJson = null;
        let excelHeadersJson = null;
        let excelColumnsJson = null;
        let excelTotal = null;
        
        if (type === 'SET' && req.file) {
            try {
                // Faylni saqlash
                const uploadsDir = path.join(__dirname, '../../uploads/debt-approval');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                
                const fileName = `${Date.now()}_${req.file.originalname}`;
                excelFilePath = path.join(uploadsDir, fileName);
                fs.renameSync(req.file.path, excelFilePath);
                
                // So'rov ma'lumotlarini olish
                let requestData = {};
                if (brand_id) {
                    const brand = await db('debt_brands').where('id', brand_id).first();
                    if (brand) requestData.brand_name = brand.name;
                }
                if (svr_id) {
                    const svr = await db('debt_svrs').where('id', svr_id).first();
                    if (svr) requestData.svr_name = svr.name;
                }
                
                // Excel faylni parse qilish
                const parsed = await parseExcelFile(excelFilePath, requestData);
                
                // Excel faylni o'chirish (ma'lumotlar o'qildi, endi fayl kerak emas)
                try {
                    if (fs.existsSync(excelFilePath)) {
                        fs.unlinkSync(excelFilePath);
                        log.info(`[WEB_REQUEST] Excel fayl o'chirildi: filePath=${excelFilePath}`);
                    }
                } catch (unlinkError) {
                    log.warn(`[WEB_REQUEST] Excel faylni o'chirishda xatolik (keraksiz): filePath=${excelFilePath}, error=${unlinkError.message}`);
                }
                
                // Excel ma'lumotlarini JSON formatida saqlash
                excelDataJson = JSON.stringify(parsed.filteredData);
                excelHeadersJson = JSON.stringify(parsed.headers);
                excelColumnsJson = JSON.stringify(parsed.columns);
                excelTotal = parsed.total;
                
                // Fayl yo'li null (fayl saqlanmaydi)
                excelFilePath = null;
                
                // Qiymat tekshiruvi (0 dan farq qilishi kerak, manfiy bo'lishi mumkin)
                log.info(`[WEB_REQUEST] 💰 Qiymat tekshiruvi: excelTotal=${excelTotal}, type=${typeof excelTotal}`);
                const isValidTotal = excelTotal !== null && excelTotal !== undefined && excelTotal !== 0 && !isNaN(excelTotal) && Math.abs(excelTotal) > 0;
                
                if (!isValidTotal) {
                    log.warn(`[WEB_REQUEST] ❌ SET so'rov uchun fayldagi qiymat 0 yoki noto'g'ri: userId=${creatorId}, excelTotal=${excelTotal}`);
                    return res.status(400).json({ 
                        error: 'SET so\'rov yaratish uchun fayldagi qiymat 0 bo\'lmasligi kerak',
                        message: `SET (Muddat uzaytirish) so'rovi yaratish uchun Excel fayldagi jami qiymat 0 dan farq qilishi kerak. Hozirgi qiymat: ${excelTotal || 0}`
                    });
                }
                
                log.info(`[WEB_REQUEST] ✅ SET so'rov tekshiruvi muvaffaqiyatli o'tdi: userId=${creatorId}, excelTotal=${excelTotal}`);
            } catch (parseError) {
                log.error('Excel faylni parse qilishda xatolik:', parseError);
                // Faylni o'chirish
                if (excelFilePath && fs.existsSync(excelFilePath)) {
                    try {
                        fs.unlinkSync(excelFilePath);
                    } catch (unlinkError) {
                        log.warn(`Faylni o'chirishda xatolik: ${unlinkError.message}`);
                    }
                }
                return res.status(400).json({ error: `Excel faylni qayta ishlashda xatolik: ${parseError.message}` });
            }
        }
        
        let id;
        if (isPostgres) {
            const [result] = await db('debt_requests').insert({
                request_uid: requestUID,
                type,
                brand_id,
                branch_id: branch_id || null,
                svr_id: svr_id || null,
                status,
                created_by: creatorId,
                extra_info: extra_info || null,
                excel_file_path: null, // Excel fayl saqlanmaydi, faqat ma'lumotlar database'ga saqlanadi
                excel_data: excelDataJson,
                excel_headers: excelHeadersJson,
                excel_columns: excelColumnsJson,
                excel_total: excelTotal,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).returning('id');
            id = result.id;
        } else {
            [id] = await db('debt_requests').insert({
                request_uid: requestUID,
                type,
                brand_id,
                branch_id: branch_id || null,
                svr_id: svr_id || null,
                status,
                created_by: creatorId,
                extra_info: extra_info || null,
                excel_file_path: null, // Excel fayl saqlanmaydi, faqat ma'lumotlar database'ga saqlanadi
                excel_data: excelDataJson,
                excel_headers: excelHeadersJson,
                excel_columns: excelColumnsJson,
                excel_total: excelTotal,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: id,
            action: 'create_request',
            new_status: status,
            performed_by: creatorId,
            note: `So'rov yaratildi: ${requestUID}`,
            created_at: new Date().toISOString()
        });
        
        // Bot'ga xabar yuborish (web'dan yaratilgan so'rovlar uchun)
        try {
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
                .where('debt_requests.id', id)
                .first();
            
            if (type === 'SET') {
                // SET so'rov uchun rahbarlar guruhiga xabar yuborish
                const leadersGroup = await db('debt_groups')
                    .where('group_type', 'leaders')
                    .where('is_active', true)
                    .first();
                
                if (leadersGroup && fullRequest) {
                    const { showSetRequestToLeaders } = require('../../bot/debt-approval/handlers/leader.js');
                    await showSetRequestToLeaders(fullRequest, leadersGroup.telegram_group_id);
                    log.info(`[WEB_REQUEST] ✅ SET so'rov rahbarlar guruhiga yuborildi: RequestId=${id}, RequestUID=${requestUID}, GroupId=${leadersGroup.telegram_group_id}`);
                } else {
                    log.warn(`[WEB_REQUEST] ⚠️ Rahbarlar guruhi topilmadi yoki so'rov topilmadi: RequestId=${id}, LeadersGroup=${leadersGroup ? 'mavjud' : 'yo\'q'}, FullRequest=${fullRequest ? 'mavjud' : 'yo\'q'}`);
                }
            } else {
                // NORMAL so'rov uchun kassirlarga xabar yuborish
                let allCashiers = [];
                
                if (branch_id) {
                    // Filialga biriktirilgan kassirlar
                    const branchCashiers = await db('debt_user_branches')
                        .join('users', 'debt_user_branches.user_id', 'users.id')
                        .where('debt_user_branches.branch_id', branch_id)
                        .whereIn('users.role', ['kassir', 'cashier'])
                        .where('users.status', 'active')
                        .select(
                            'debt_user_branches.user_id',
                            'users.telegram_chat_id',
                            'users.fullname',
                            'users.username'
                        )
                        .groupBy('debt_user_branches.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username');
                    
                    allCashiers = branchCashiers.map(c => ({
                        user_id: c.user_id,
                        telegram_chat_id: c.telegram_chat_id,
                        fullname: c.fullname,
                        username: c.username,
                        reason: 'filial_binding'
                    }));
                }
                
                // Brendga biriktirilgan kassirlar
                const brandBoundCashiers = await db('debt_user_brands')
                    .join('users', 'debt_user_brands.user_id', 'users.id')
                    .where('debt_user_brands.brand_id', brand_id)
                    .whereIn('users.role', ['kassir', 'cashier'])
                    .where('users.status', 'active')
                    .select(
                        'debt_user_brands.user_id',
                        'users.telegram_chat_id',
                        'users.fullname',
                        'users.username'
                    )
                    .groupBy('debt_user_brands.user_id', 'users.telegram_chat_id', 'users.fullname', 'users.username');
                
                // Dublikatlarni olib tashlash
                const allCashiersMap = new Map();
                allCashiers.forEach(c => {
                    allCashiersMap.set(c.user_id, c);
                });
                brandBoundCashiers.forEach(c => {
                    if (!allCashiersMap.has(c.user_id)) {
                        allCashiersMap.set(c.user_id, {
                            user_id: c.user_id,
                            telegram_chat_id: c.telegram_chat_id,
                            fullname: c.fullname,
                            username: c.username,
                            reason: 'brend'
                        });
                    } else {
                        const existing = allCashiersMap.get(c.user_id);
                        existing.reason = existing.reason === 'filial_binding' ? 'filial_va_brend' : existing.reason;
                    }
                });
                
                allCashiers = Array.from(allCashiersMap.values());
                
                // So'rovga birinchi kassirni tayinlash (round-robin uchun) - faqat branch_id bo'lsa
                if (branch_id) {
                    const { assignCashierToRequest } = require('../../utils/cashierAssignment.js');
                    await assignCashierToRequest(branch_id, id);
                }
                
                // Barcha kassirlarga xabar yuborish
                let notifiedCashiersCount = 0;
                for (const cashierItem of allCashiers) {
                    if (cashierItem.telegram_chat_id) {
                        try {
                            const cashierUser = await db('users').where('id', cashierItem.user_id).first();
                            if (cashierUser && fullRequest) {
                                const { showRequestToCashier } = require('../../bot/debt-approval/handlers/cashier.js');
                                await showRequestToCashier(fullRequest, cashierItem.telegram_chat_id, cashierUser);
                                notifiedCashiersCount++;
                                log.info(`[WEB_REQUEST] ✅ Kassirga xabar yuborildi: CashierId=${cashierItem.user_id}, Name=${cashierItem.fullname}, Reason=${cashierItem.reason}, ChatId=${cashierItem.telegram_chat_id}`);
                            }
                        } catch (notifyError) {
                            log.error(`[WEB_REQUEST] ❌ Kassirga xabar yuborishda xatolik: CashierId=${cashierItem.user_id}, Error=${notifyError.message}`);
                        }
                    } else {
                        log.warn(`[WEB_REQUEST] ⚠️ Kassirning telegram_chat_id yo'q: CashierId=${cashierItem.user_id}, Name=${cashierItem.fullname}`);
                    }
                }
                
                log.info(`[WEB_REQUEST] 📊 Xabar yuborish natijasi: Jami=${allCashiers.length} ta, Yuborildi=${notifiedCashiersCount} ta, RequestId=${id}, RequestUID=${requestUID}`);
                
                if (allCashiers.length === 0) {
                    log.warn(`[WEB_REQUEST] ⚠️ Filial ${branch_id} yoki brend ${brand_id} uchun kassir topilmadi. So'rov PENDING_APPROVAL holatida saqlandi.`);
                }
            }
        } catch (botError) {
            log.error(`[WEB_REQUEST] ❌ Bot'ga xabar yuborishda xatolik: RequestId=${id}, Error=${botError.message}`, botError);
            // Xatolik bo'lsa ham so'rov yaratilgan, shuning uchun xatolikni log qilamiz lekin response'ni to'xtatmaymiz
        }
        
        // Reminder boshlash
        startReminder(id);
        
        res.json({ success: true, id, request_uid: requestUID });
    } catch (error) {
        log.error('So\'rov yaratishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// So'rov statusini yangilash
router.patch('/:requestId/status', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { status, performed_by, note } = req.body;
        
        const request = await db('debt_requests').where('id', requestId).first();
        if (!request) {
            return res.status(404).json({ error: 'So\'rov topilmadi' });
        }
        
        if (request.locked) {
            return res.status(400).json({ error: 'So\'rov yopilgan' });
        }
        
        const oldStatus = request.status;
        
        await db('debt_requests')
            .where('id', requestId)
            .update({
                status,
                updated_at: new Date().toISOString()
            });
        
        // Log yozish
        await db('debt_request_logs').insert({
            request_id: requestId,
            action: 'status_change',
            old_status: oldStatus,
            new_status: status,
            performed_by,
            note: note || null,
            created_at: new Date().toISOString()
        });
        
        // Status yangilanganda reminder'ni boshqarish
        const finalStatuses = ['CANCELLED', 'APPROVED_BY_OPERATOR', 'DEBT_FOUND', 'DIFFERENCE_FOUND'];
        if (finalStatuses.includes(status)) {
            stopReminder(requestId);
        } else {
            const pendingStatuses = ['PENDING_APPROVAL', 'SET_PENDING', 'APPROVED_BY_LEADER', 'APPROVED_BY_CASHIER'];
            if (pendingStatuses.includes(status)) {
                startReminder(requestId);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        log.error('Status yangilashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Preview message ID ni saqlash (bot uchun)
router.patch('/:requestId/preview-message', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { preview_message_id, preview_chat_id } = req.body;
        
        if (!preview_message_id || !preview_chat_id) {
            return res.status(400).json({ error: 'preview_message_id va preview_chat_id kerak' });
        }
        
        await db('debt_requests')
            .where('id', requestId)
            .update({
                preview_message_id: preview_message_id,
                preview_chat_id: preview_chat_id,
                updated_at: new Date().toISOString()
            });
        
        res.json({ success: true });
    } catch (error) {
        log.error('Preview message ID saqlashda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// So'rovni lock qilish
router.patch('/:requestId/lock', isAuthenticated, hasPermission('roles:manage'), async (req, res) => {
    try {
        const { requestId } = req.params;
        
        await db('debt_requests')
            .where('id', requestId)
            .update({
                locked: true,
                updated_at: new Date().toISOString()
            });
        
        res.json({ success: true });
    } catch (error) {
        log.error('So\'rovni lock qilishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// Statistika endpoint
router.get('/stats/summary', isAuthenticated, hasPermission(['roles:manage', 'debt:view_statistics', 'debt:view_own', 'debt:create']), async (req, res) => {
    try {
        const user = req.session.user;
        const { startDate, endDate } = req.query;
        
        // Menejer uchun faqat o'z so'rovlari, rahbar/admin uchun barcha
        let baseQuery = db('debt_requests');
        
        // Menejer yoki debt:view_own permission'ga ega foydalanuvchilar uchun faqat o'z so'rovlari
        const isManager = user.role === 'manager' || user.role === 'menejer';
        const hasViewOwnPermission = user.permissions && user.permissions.includes('debt:view_own');
        const hasViewAllPermission = user.permissions && (user.permissions.includes('debt:view_all') || user.permissions.includes('roles:manage'));
        const hasCreatePermission = user.permissions && user.permissions.includes('debt:create');
        
        // Agar menejer bo'lsa yoki faqat o'z so'rovlarini ko'rish huquqi bo'lsa (lekin barcha so'rovlarni ko'rish huquqi bo'lmasa)
        if (isManager || (hasViewOwnPermission && !hasViewAllPermission)) {
            baseQuery = baseQuery.where('created_by', user.id);
        }
        
        // Biriktirilgan filial/brend bo'yicha filtrlash
        const { getAllowedDebtBrands, getAllowedDebtBranches } = require('../../utils/debtAccessFilter.js');
        const allowedBrands = await getAllowedDebtBrands(user);
        const allowedBranches = await getAllowedDebtBranches(user);
        
        // Agar biriktirilgan brendlar bo'lsa, filtrlash
        if (allowedBrands !== null && allowedBrands.length > 0) {
            baseQuery = baseQuery.whereIn('debt_requests.brand_id', allowedBrands);
        }
        
        // Agar biriktirilgan filiallar bo'lsa, filtrlash
        if (allowedBranches !== null && allowedBranches.length > 0) {
            baseQuery = baseQuery.whereIn('debt_requests.branch_id', allowedBranches);
        }
        
        // Sana filtri
        if (startDate) {
            baseQuery = baseQuery.where('debt_requests.created_at', '>=', startDate);
        }
        if (endDate) {
            baseQuery = baseQuery.where('debt_requests.created_at', '<=', endDate + ' 23:59:59');
        }
        
        // Umumiy statistika
        const totalRequests = await baseQuery.clone().count('* as count').first();
        const pendingRequests = await baseQuery.clone().whereIn('status', ['PENDING_APPROVAL', 'SET_PENDING']).count('* as count').first();
        const approvedRequests = await baseQuery.clone().whereIn('status', ['APPROVED_BY_LEADER', 'APPROVED_BY_CASHIER', 'APPROVED_BY_OPERATOR']).count('* as count').first();
        const debtFoundRequests = await baseQuery.clone().where('status', 'DEBT_FOUND').count('* as count').first();
        const cancelledRequests = await baseQuery.clone().where('status', 'CANCELLED').count('* as count').first();
        
        // Status bo'yicha taqsimot
        const statusDistribution = await baseQuery.clone()
            .select('status')
            .count('* as count')
            .groupBy('status');
        
        // Tur bo'yicha taqsimot
        const typeDistribution = await baseQuery.clone()
            .select('type')
            .count('* as count')
            .groupBy('type');
        
        // Kunlik dinamika (oxirgi 7 kun)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        
        const dailyDynamics = await baseQuery.clone()
            .select(db.raw('DATE(created_at) as date'))
            .count('* as count')
            .where('created_at', '>=', sevenDaysAgo.toISOString())
            .groupBy(db.raw('DATE(created_at)'))
            .orderBy('date', 'asc');
        
        // Menejer bo'yicha statistika (faqat rahbar/admin uchun)
        // SVR holati bo'yicha: Tugallangan, Jarayonda, Yuborilmagan
        let managerStats = [];
        if (user.role !== 'manager') {
            // Har bir menejer uchun so'rovlar holati bo'yicha statistika
            const managers = await db('debt_requests')
                .join('users', 'debt_requests.created_by', 'users.id')
                .select('users.id as user_id', 'users.fullname', 'users.username')
                .groupBy('users.id', 'users.fullname', 'users.username')
                .orderByRaw('COUNT(debt_requests.id) DESC')
                .limit(10);
            
            for (const manager of managers) {
                // Tugallangan so'rovlar (FINAL_APPROVED yoki DEBT_FOUND)
                const completedResult = await db('debt_requests')
                    .where('created_by', manager.user_id)
                    .whereIn('status', ['FINAL_APPROVED', 'DEBT_FOUND'])
                    .count('* as count')
                    .first();
                
                // Jarayondagi so'rovlar (PENDING, SET_PENDING, APPROVED_BY_* va boshqalar)
                const inProgressResult = await db('debt_requests')
                    .where('created_by', manager.user_id)
                    .whereNotIn('status', ['FINAL_APPROVED', 'DEBT_FOUND', 'CANCELLED', 'REJECTED'])
                    .count('* as count')
                    .first();
                
                // Bekor qilingan so'rovlar
                const cancelledResult = await db('debt_requests')
                    .where('created_by', manager.user_id)
                    .whereIn('status', ['CANCELLED', 'REJECTED'])
                    .count('* as count')
                    .first();
                
                // Jami so'rovlar
                const totalResult = await db('debt_requests')
                    .where('created_by', manager.user_id)
                    .count('* as count')
                    .first();
                
                managerStats.push({
                    name: manager.fullname || manager.username,
                    completed: parseInt(completedResult.count) || 0,
                    inProgress: parseInt(inProgressResult.count) || 0,
                    notSubmitted: parseInt(cancelledResult.count) || 0, // Bekor qilinganlarni ham ko'rsatamiz
                    count: parseInt(totalResult.count) || 0
                });
            }
        }
        
        // Brend bo'yicha statistika
        const brandStats = await baseQuery.clone()
            .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
            .select('debt_brands.name as brand_name')
            .count('debt_requests.id as count')
            .groupBy('debt_brands.id', 'debt_brands.name')
            .orderBy('count', 'desc')
            .limit(10);
        
        res.json({
            summary: {
                total: parseInt(totalRequests.count) || 0,
                pending: parseInt(pendingRequests.count) || 0,
                approved: parseInt(approvedRequests.count) || 0,
                debtFound: parseInt(debtFoundRequests.count) || 0,
                cancelled: parseInt(cancelledRequests.count) || 0
            },
            statusDistribution: statusDistribution.map(s => ({
                status: s.status,
                count: parseInt(s.count) || 0
            })),
            typeDistribution: typeDistribution.map(t => ({
                type: t.type || 'ODDIY',
                count: parseInt(t.count) || 0
            })),
            dailyDynamics: dailyDynamics.map(d => ({
                date: d.date,
                count: parseInt(d.count) || 0
            })),
            managerStats: managerStats,
            brandStats: brandStats.map(b => ({
                brand: b.brand_name,
                count: parseInt(b.count) || 0
            }))
        });
    } catch (error) {
        log.error('Statistikani olishda xatolik:', error);
        res.status(500).json({ error: 'Server xatolik' });
    }
});

// So'rov tarixi (loglar) - /:requestId dan oldin bo'lishi kerak
router.get('/request-logs/:requestId', isAuthenticated, hasPermission(['debt:bot_activity', 'debt:view_all', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { requestId } = req.params;
        
        const logs = await db('debt_request_logs')
            .leftJoin('users', 'debt_request_logs.user_id', 'users.id')
            .where('debt_request_logs.request_id', requestId)
            .select(
                'debt_request_logs.*',
                'users.username',
                'users.fullname'
            )
            .orderBy('debt_request_logs.created_at', 'desc');
        
        res.json({
            success: true,
            data: logs.map(l => ({
                id: l.id,
                action: l.action,
                details: l.details,
                createdAt: l.created_at,
                user: {
                    id: l.user_id,
                    username: l.username,
                    fullname: l.fullname
                }
            }))
        });
    } catch (error) {
        log.error('So\'rov loglarini olishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Server xatolik' });
    }
});

// Web'dan tasdiqlash
router.post('/web-approve/:requestId', isAuthenticated, hasPermission(['debt:approve_leader', 'debt:approve_cashier', 'debt:approve_operator', 'debt:admin', 'roles:manage']), async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, note, debtAmount } = req.body; // action: 'approve', 'reject', 'mark_debt'
        const user = req.session.user;
        
        const request = await db('debt_requests').where({ id: requestId }).first();
        if (!request) {
            return res.status(404).json({ success: false, error: 'So\'rov topilmadi' });
        }
        
        const userHelper = require('../../bot/unified/userHelper.js');
        let approvalType = null;
        let newStatus = null;
        
        // Tasdiqlash turini aniqlash
        if (request.status === 'SET_PENDING' && await userHelper.hasPermission(user.id, 'debt:approve_leader')) {
            approvalType = 'leader';
            newStatus = action === 'approve' ? 'APPROVED_BY_LEADER' : (action === 'reject' ? 'REJECTED' : 'DEBT_FOUND');
        } else if ((request.status === 'APPROVED_BY_LEADER' || request.status === 'PENDING_APPROVAL') && await userHelper.hasPermission(user.id, 'debt:approve_cashier')) {
            approvalType = 'cashier';
            newStatus = action === 'approve' ? 'APPROVED_BY_CASHIER' : (action === 'reject' ? 'REJECTED' : 'DEBT_FOUND');
        } else if (request.status === 'APPROVED_BY_CASHIER' && await userHelper.hasPermission(user.id, 'debt:approve_operator')) {
            approvalType = 'operator';
            newStatus = action === 'approve' ? 'FINAL_APPROVED' : (action === 'reject' ? 'REJECTED' : 'DEBT_FOUND');
        } else if (await userHelper.hasPermission(user.id, 'debt:admin') || await userHelper.hasPermission(user.id, 'roles:manage')) {
            approvalType = 'admin';
            if (action === 'approve') {
                newStatus = 'FINAL_APPROVED';
            } else if (action === 'reject') {
                newStatus = 'REJECTED';
            } else {
                newStatus = 'DEBT_FOUND';
            }
        } else {
            return res.status(403).json({ success: false, error: 'Bu so\'rovni tasdiqlash huquqingiz yo\'q' });
        }
        
        // So'rovni yangilash
        await db('debt_requests').where({ id: requestId }).update({
            status: newStatus,
            updated_at: db.fn.now()
        });
        
        // Tasdiqlash yozuvini qo'shish
        await db('debt_request_approvals').insert({
            request_id: requestId,
            approver_id: user.id,
            approval_type: approvalType,
            status: action === 'approve' ? 'approved' : (action === 'reject' ? 'rejected' : 'debt_marked'),
            note: note || null,
            debt_amount: action === 'mark_debt' ? debtAmount : null,
            created_at: db.fn.now()
        });
        
        // Log qo'shish
        await db('debt_request_logs').insert({
            request_id: requestId,
            user_id: user.id,
            action: `WEB_${action.toUpperCase()}`,
            details: JSON.stringify({ approvalType, newStatus, note, debtAmount }),
            created_at: db.fn.now()
        });
        
        // Arxivlash - FINAL_APPROVED bo'lganda Excel ma'lumotlarini arxivlash
        if (newStatus === 'FINAL_APPROVED') {
            try {
                const { archiveAcceptedRequestData } = require('../../utils/debtDataArchiver.js');
                await archiveAcceptedRequestData(requestId);
            } catch (archiveError) {
                log.error(`[WEB_APPROVE] Arxivlashda xatolik: requestId=${requestId}`, archiveError);
                // Arxivlash xatosi so'rovni to'xtatmaydi
            }
        }
        
        res.json({
            success: true,
            message: action === 'approve' ? 'So\'rov tasdiqlandi' : (action === 'reject' ? 'So\'rov rad etildi' : 'Qarzdorlik belgilandi'),
            newStatus
        });
    } catch (error) {
        log.error('Web tasdiqlashda xatolik:', error);
        res.status(500).json({ success: false, error: 'Server xatolik' });
    }
});

module.exports = router;

