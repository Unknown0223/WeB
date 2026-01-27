// utils/messageTemplates.js
// Xabar shablonlari - barcha xabar turlari uchun standart formatlar

const { getPreviousMonthName } = require('./dateHelper.js');
const { formatExcelData } = require('./excelParser.js');

/**
 * Oddiy so'rov xabari (Menejer -> Kassir)
 */
function formatNormalRequestMessage(data) {
    const { brand_name, filial_name, svr_name, request_uid } = data;
    const month_name = getPreviousMonthName();
    
    let message = 'Assalomu aleykum\n\n';
    
    if (brand_name) {
        message += `Brend: ${brand_name}\n\n`;
    }
    
    message += `${filial_name} filial supervayzeri ${svr_name} ${month_name} oyi qarzlarini yopdi.\n`;
    message += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz`;
    
    if (request_uid) {
        message += `\n\nSo'rov ID: ${request_uid}`;
    }
    
    return message;
}

/**
 * SET so'rov xabari (Menejer -> Rahbarlar yoki Rahbar -> Kassir)
 */
function formatSetRequestMessage(data) {
    const { 
        brand_name, 
        filial_name, 
        svr_name, 
        extra_info, 
        request_uid,
        excel_data,
        excel_headers,
        excel_columns,
        excel_total,
        is_for_cashier = false, // Kassirga yuborilganda true
        is_for_operator = false, // Operatorga yuborilganda true
        is_for_leaders = false, // Rahbarlarga yuborilganda true
        approvals = [], // Tasdiqlash ma'lumotlari (rahbarlar guruhida ko'rsatish uchun)
        telegraph_url = null // Telegraph sahifa URL'i (rahbarlar guruhida qo'shish uchun)
    } = data;
    const month_name = getPreviousMonthName();
    
    let message = 'Assalomu aleykum\n\n';
    
    if (brand_name) {
        message += `Brend: ${brand_name}\n\n`;
    }
    
    message += `${filial_name} filial supervayzeri ${svr_name} ${month_name} oyi qarzlarini yopdi.\n`;
    
    // Hammaga bir xil format: Telegraph link ko'rsatish
    if (is_for_cashier || is_for_operator || is_for_leaders) {
        message += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz.\n`;
        
        // Hammaga bir xil: Telegraph link ko'rsatish
        // ✅ MUHIM: telegraph_url ni aniq tekshirish (null, undefined, empty string)
        const hasValidTelegraphUrl = telegraph_url && typeof telegraph_url === 'string' && telegraph_url.trim() !== '';
        
        if (hasValidTelegraphUrl) {
            message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `🔗 <a href="${telegraph_url}">📊 Qarzdorlik klientlar:</a>\n`;
        } else if (excel_data && excel_data.length > 0 && excel_columns) {
            // Debug log (faqat muammo bo'lganda)
            const log = require('./logger.js');
            log.warn(`[MESSAGE_TEMPLATES] [FORMAT_SET] ⚠️ Telegraph URL mavjud emas: requestUID=${request_uid}, isForCashier=${is_for_cashier}, isForOperator=${is_for_operator}, isForLeaders=${is_for_leaders}, telegraphUrlType=${typeof telegraph_url}, telegraphUrlValue=${telegraph_url ? telegraph_url.substring(0, 50) + '...' : 'null/undefined'}, excelDataLength=${excel_data?.length || 0}`);
            message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `⚠️ Qarzdorlik klientlar ro'yxati yuklanmoqda...\n`;
            message += `(Telegraph sahifa yaratilmoqda, biroz kuting)`;
        } else if (excel_total !== null && excel_total !== undefined) {
            message += `\n\nTOTAL: ${Math.abs(excel_total).toLocaleString('ru-RU')}`;
        }
        
        // Rahbarlar uchun tasdiqlashlar ro'yxati
        if (is_for_leaders && approvals && approvals.length > 0) {
            message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `✅ Tasdiqlashlar:\n\n`;
            approvals.forEach((approval, index) => {
                const { username, fullname, approval_type, created_at, timestamp } = approval;
                const approverName = fullname || username || 'Noma\'lum';
                const approverTag = username ? `@${username}` : '';
                const typeNames = {
                    'leader': 'Rahbar',
                    'cashier': 'Kassir',
                    'operator': 'Operator'
                };
                const typeName = typeNames[approval_type] || approval_type;
                
                message += `${index + 1}. ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
                
                const timeValue = created_at || timestamp;
                if (timeValue) {
                    const date = new Date(timeValue);
                    const formattedDate = date.toLocaleString('uz-UZ', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    message += ` - ${formattedDate}`;
                }
                message += '\n';
            });
        }
    } else {
        // Final guruh yoki boshqa holatlar uchun: Telegraph link ko'rsatish
        message += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz.\n`;
        
        // Final guruh uchun - HAR DOIM Telegraph link ishlatilishi kerak
        // Agar telegraph_url mavjud bo'lsa, excel_data null bo'lsa ham link ko'rsatish
        if (telegraph_url) {
            // Telegraph link mavjud bo'lsa, link ko'rsatish
            message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `🔗 <a href="${telegraph_url}">📊 Qarzdorlik klientlar:</a>\n`;
        } else if (excel_data && excel_data.length > 0 && excel_columns) {
            // Telegraph link mavjud emas, lekin Excel ma'lumotlari mavjud bo'lsa, xatolik xabari
            message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `⚠️ Qarzdorlik klientlar ro'yxati yuklanmoqda...\n`;
            message += `(Telegraph sahifa yaratilmoqda, biroz kuting)`;
        } else if (excel_total !== null && excel_total !== undefined) {
            // Agar Excel ma'lumotlari ko'rsatilmagan bo'lsa (masalan, faqat Telegraph link), TOTAL qo'shish
            message += `\n\nTOTAL: ${Math.abs(excel_total).toLocaleString('ru-RU')}`;
        }
    }
    
    if (extra_info) {
        message += `\n\nQo'shimcha ma'lumot: ${extra_info}`;
    }
    
    if (request_uid) {
        message += `\n\nSo'rov ID: ${request_uid}`;
    }
    
    return message;
}

/**
 * Qarzi bor javobi (Kassir/Operator -> Oldingi bosqich)
 */
function formatDebtResponseMessage(data) {
    const { request_uid, brand_name, filial_name, svr_name, debt_details, total_amount, excel_data, excel_headers, excel_columns, telegraph_url, is_for_cashier = false } = data;
    
    let message = '⚠️ Qarzdorlik topildi\n\n';
    
    if (request_uid) {
        message += `So'rov ID: ${request_uid}\n`;
    }
    
    // Filial, Brend va SVR ma'lumotlarini qo'shish
    if (brand_name) {
        message += `Brend: ${brand_name}\n`;
    }
    if (filial_name) {
        message += `Filial: ${filial_name}\n`;
    }
    if (svr_name) {
        message += `SVR: ${svr_name}\n`;
    }
    
    if (request_uid || brand_name || filial_name || svr_name) {
        message += '\n';
    }
    
    // Excel ma'lumotlari mavjud bo'lsa - hammaga bir xil: Telegraph link
    if (excel_data && excel_data.length > 0 && excel_columns) {
        if (telegraph_url) {
            message += `🔗 <a href="${telegraph_url}">📊 Qarzdorlik klientlar:</a>\n`;
        } else {
            message += `⚠️ Qarzdorlik klientlar ro'yxati yuklanmoqda...\n`;
            message += `(Telegraph sahifa yaratilmoqda, biroz kuting)`;
        }
    } else if (debt_details) {
        // Yozma ma'lumotlar
        message += debt_details;
    }
    
    return message;
}

/**
 * Tasdiqlash xabari (Har bir bosqich) - Faqat bitta tasdiqlovchi
 * @deprecated formatAllApprovalsMessage ishlatish tavsiya etiladi
 */
function formatApprovalMessage(data) {
    const { request_uid, username, fullname, approval_type, timestamp } = data;
    
    let message = '✅ Tasdiqlangan\n\n';
    
    if (request_uid) {
        message += `So'rov ID: ${request_uid}\n\n`;
    }
    
    const approverName = fullname || username || 'Noma\'lum';
    const approverTag = username ? `@${username}` : '';
    const typeNames = {
        'leader': 'Rahbar',
        'cashier': 'Kassir',
        'operator': 'Operator'
    };
    const typeName = typeNames[approval_type] || approval_type;
    
    message += `Tasdiqlagan: ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
    
    if (timestamp) {
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        message += `\nVaqt: ${formattedDate}`;
    }
    
    return message;
}

/**
 * Barcha tasdiqlashlarni ko'rsatish (requestId orqali)
 * @deprecated formatRequestMessageWithApprovals ishlatish tavsiya etiladi
 */
async function formatAllApprovalsMessage(requestId, db) {
    const approvals = await db('debt_request_approvals')
        .join('users', 'debt_request_approvals.approver_id', 'users.id')
        .where('debt_request_approvals.request_id', requestId)
        .where('debt_request_approvals.status', 'approved')
        .orderBy('debt_request_approvals.created_at', 'asc')
        .select(
            'users.username',
            'users.fullname',
            'debt_request_approvals.approval_type',
            'debt_request_approvals.created_at'
        );
    
    let message = '✅ Tasdiqlangan\n\n';
    
    if (approvals.length === 0) {
        return message + 'Tasdiqlashlar topilmadi.';
    }
    
    const typeNames = {
        'leader': 'Rahbar',
        'cashier': 'Kassir',
        'operator': 'Operator'
    };
    
    approvals.forEach((approval, index) => {
        const approverName = approval.fullname || approval.username || 'Noma\'lum';
        const approverTag = approval.username ? `@${approval.username}` : '';
        const typeName = typeNames[approval.approval_type] || approval.approval_type;
        
        message += `Tasdiqlagan: ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
        
        if (approval.created_at) {
            const date = new Date(approval.created_at);
            const formattedDate = date.toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            message += `\nVaqt: ${formattedDate}`;
        }
        
        if (index < approvals.length - 1) {
            message += '\n\n';
        }
    });
    
    return message;
}

/**
 * So'rov xabari + barcha tasdiqlashlar (request object orqali)
 * @param {Object} request - So'rov ma'lumotlari
 * @param {Object} db - Database instance
 * @param {string} forRole - Kim uchun format qilinayotgani: 'manager' (to'liq), 'cashier' (faqat avvalgilari), 'operator' (faqat avvalgilari)
 */
async function formatRequestMessageWithApprovals(request, db, forRole = 'manager', debtData = null) {
    // Original xabarni format qilish
    let originalMessage = '';
    
    if (request.type === 'SET' && request.excel_data) {
        // SET so'rov uchun formatSetRequestMessage
        let excelData = request.excel_data;
        let excelHeaders = request.excel_headers;
        let excelColumns = request.excel_columns;
        
        // Agar string bo'lsa, parse qilish
        if (typeof excelData === 'string' && excelData) {
            try {
                excelData = JSON.parse(excelData);
            } catch (e) {
                excelData = null;
            }
        }
        
        if (typeof excelHeaders === 'string' && excelHeaders) {
            try {
                excelHeaders = JSON.parse(excelHeaders);
            } catch (e) {
                excelHeaders = null;
            }
        }
        
        if (typeof excelColumns === 'string' && excelColumns) {
            try {
                excelColumns = JSON.parse(excelColumns);
            } catch (e) {
                excelColumns = null;
            }
        }
        
        // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
        // MUHIM: formatRequestMessageWithApprovals funksiyasida ham Telegraph link ishlatilishi kerak
        let telegraphUrl = null;
        
        // Teskari jarayon uchun debtData dan telegraphUrl olish
        if (request.status === 'reversed' && debtData && debtData.telegraph_url) {
            telegraphUrl = debtData.telegraph_url;
        } else if (request.telegraph_url) {
            telegraphUrl = request.telegraph_url;
        } else if (excelData && Array.isArray(excelData) && excelData.length > 0 && excelColumns) {
            // Agar request.telegraph_url mavjud bo'lmasa, yaratish
            try {
                const { createDebtDataPage } = require('./telegraph.js');
                const { getPreviousMonthName } = require('./dateHelper.js');
                telegraphUrl = await createDebtDataPage({
                    request_uid: request.request_uid,
                    brand_name: request.brand_name,
                    filial_name: request.filial_name,
                    svr_name: request.svr_name,
                    month_name: getPreviousMonthName(),
                    extra_info: request.extra_info,
                    excel_data: excelData,
                    excel_headers: excelHeaders,
                    excel_columns: excelColumns,
                    total_amount: request.excel_total
                });
                
                if (!telegraphUrl) {
                    const log = require('./logger.js');
                    log.warn(`[MESSAGE_TEMPLATES] [FORMAT_WITH_APPROVALS] Telegraph sahifa yaratilmadi (null qaytdi): requestUID=${request.request_uid}`);
                    // Qayta urinish
                    try {
                        telegraphUrl = await createDebtDataPage({
                            request_uid: request.request_uid,
                            brand_name: request.brand_name,
                            filial_name: request.filial_name,
                            svr_name: request.svr_name,
                            month_name: getPreviousMonthName(),
                            extra_info: request.extra_info,
                            excel_data: excelData,
                            excel_headers: excelHeaders,
                            excel_columns: excelColumns,
                            total_amount: request.excel_total
                        });
                    } catch (retryError) {
                        const log = require('./logger.js');
                        log.error(`[MESSAGE_TEMPLATES] [FORMAT_WITH_APPROVALS] Telegraph sahifa yaratishda qayta urinishda xatolik: requestUID=${request.request_uid}, error=${retryError.message}`);
                    }
                }
            } catch (telegraphError) {
                const log = require('./logger.js');
                log.error(`[MESSAGE_TEMPLATES] [FORMAT_WITH_APPROVALS] Telegraph sahifa yaratishda xatolik: requestUID=${request.request_uid}, error=${telegraphError.message}`);
                // Qayta urinish
                try {
                    const { createDebtDataPage } = require('./telegraph.js');
                    const { getPreviousMonthName } = require('./dateHelper.js');
                    telegraphUrl = await createDebtDataPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: excelData,
                        excel_headers: excelHeaders,
                        excel_columns: excelColumns,
                        total_amount: request.excel_total
                    });
                } catch (retryError) {
                    const log = require('./logger.js');
                    log.error(`[MESSAGE_TEMPLATES] [FORMAT_WITH_APPROVALS] Telegraph sahifa yaratishda qayta urinishda xatolik: requestUID=${request.request_uid}, error=${retryError.message}`);
                }
            }
        }
        
        // ✅ Teskari jarayon bo'lsa va debtData mavjud bo'lsa, qarzdorlik ma'lumotlarini ko'rsatish
        // MUHIM: Final guruh uchun (forRole === 'final') va teskari jarayon bo'lsa:
        // - Agar input_type === 'agent' bo'lsa, Telegraph link ko'rsatish (agent ro'yxati emas)
        // - Agar input_type === 'total' bo'lsa, Telegraph link ko'rsatish
        if (request.status === 'reversed' && debtData) {
            // Teskari jarayon uchun qarzdorlik ma'lumotlarini formatlash
            let debtExcelData = null;
            let debtExcelHeaders = null;
            let debtExcelColumns = null;
            let debtTotal = null;
            let useTelegraphForFinal = true; // Final guruh uchun har doim Telegraph link ishlatish
            
            // Teskari jarayon uchun telegraphUrl ni debtData dan olish yoki yaratish
            let debtTelegraphUrl = debtData.telegraph_url || null;
            if (!debtTelegraphUrl && debtData.excel_data && Array.isArray(debtData.excel_data) && debtData.excel_data.length > 0) {
                // Agar telegraphUrl mavjud bo'lmasa, debtData.excel_data dan yaratish
                try {
                    const { createDebtDataPage } = require('./telegraph.js');
                    const { getPreviousMonthName } = require('./dateHelper.js');
                    debtTelegraphUrl = await createDebtDataPage({
                        request_uid: request.request_uid,
                        brand_name: request.brand_name,
                        filial_name: request.filial_name,
                        svr_name: request.svr_name,
                        month_name: getPreviousMonthName(),
                        extra_info: request.extra_info,
                        excel_data: debtData.excel_data,
                        excel_headers: debtData.excel_headers || [],
                        excel_columns: debtData.excel_columns || {},
                        total_amount: debtData.total_amount
                    });
                } catch (telegraphError) {
                    const log = require('./logger.js');
                    log.error(`[MESSAGE_TEMPLATES] [FORMAT_WITH_APPROVALS] Teskari jarayon uchun Telegraph sahifa yaratishda xatolik: requestUID=${request.request_uid}, error=${telegraphError.message}`);
                }
            }
            
            // Teskari jarayon uchun telegraphUrl ni ishlatish
            if (debtTelegraphUrl) {
                telegraphUrl = debtTelegraphUrl;
            }
            
            if (debtData.input_type === 'agent' && debtData.excel_data && debtData.excel_data.length > 0) {
                // Agent bo'yicha: ma'lumotlarni saqlash, lekin final guruh uchun Telegraph link ko'rsatish
                debtExcelData = debtData.excel_data;
                debtExcelHeaders = debtData.excel_headers || ['Agent', 'Summa'];
                debtExcelColumns = debtData.excel_columns || { agent: 0, summa: 1 };
                debtTotal = debtData.total_amount;
                // Final guruh uchun Telegraph link ko'rsatish (agent ro'yxati emas)
                useTelegraphForFinal = true;
            } else if (debtData.input_type === 'total' && debtData.total_amount) {
                // Umumiy summa: SVR bo'yicha ko'rsatish
                debtExcelData = [{
                    'Agent': 'Umumiy',
                    'Summa': debtData.total_amount
                }];
                debtExcelHeaders = ['Agent', 'Summa'];
                debtExcelColumns = { agent: 0, summa: 1 };
                debtTotal = debtData.total_amount;
                // Final guruh uchun Telegraph link ko'rsatish
                useTelegraphForFinal = true;
            }
            
            // Menejer uchun: agent ro'yxatini to'g'ridan-to'g'ri habarda ko'rsatish
            // Final guruh uchun: har doim Telegraph link ko'rsatish (agent ro'yxati emas)
            const isForManager = forRole === 'manager';
            const isForFinal = forRole === 'final';
            // Final guruh uchun: har doim Telegraph link, menejer uchun agent ro'yxati
            const showAgentList = isForManager; // Final guruh uchun hech qachon agent ro'yxatini ko'rsatmaslik
            
            originalMessage = formatSetRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: isForFinal ? null : (debtExcelData || excelData), // Final guruh uchun excel_data null (faqat link)
                excel_headers: debtExcelHeaders || excelHeaders,
                excel_columns: debtExcelColumns || excelColumns,
                excel_total: debtTotal || request.excel_total,
                is_for_cashier: showAgentList, // Faqat menejer uchun agent ro'yxatini ko'rsatish
                approvals: [],
                telegraph_url: isForManager ? null : (isForFinal ? telegraphUrl : null) // Final uchun har doim link, menejer uchun null
            });
        } else {
            // Oddiy tasdiqlash: Final guruh uchun Telegraph link ko'rsatish
            // Menejer uchun: agent ro'yxatini to'g'ridan-to'g'ri habarda ko'rsatish
            const isForManager = forRole === 'manager';
            const isForFinal = forRole === 'final';
            const showAgentList = isForManager;
            
            // Final guruh uchun: agar kassir o'zgartirish qilmagan bo'lsa, original Excel ma'lumotlaridan Telegraph link ko'rsatish
            // Menejer uchun: agent ro'yxatini ko'rsatish
            // ✅ MUHIM: Final guruh uchun excel_data, excel_headers, excel_columns null bo'lishi kerak (faqat Telegraph link)
            originalMessage = formatSetRequestMessage({
                brand_name: request.brand_name,
                filial_name: request.filial_name,
                svr_name: request.svr_name,
                extra_info: request.extra_info,
                request_uid: request.request_uid,
                excel_data: isForFinal ? null : excelData, // Final guruh uchun excel_data null (faqat link, agent ro'yxati emas)
                excel_headers: isForFinal ? null : excelHeaders, // Final guruh uchun headers ham null
                excel_columns: isForFinal ? null : excelColumns, // Final guruh uchun columns ham null
                excel_total: request.excel_total,
                is_for_cashier: false, // Hammaga bir xil: Telegraph link (agent ro'yxati emas)
                is_for_operator: false, // Final guruh uchun operator emas
                is_for_leaders: false, // Final guruh uchun rahbarlar emas
                approvals: [],
                telegraph_url: isForFinal ? telegraphUrl : (showAgentList ? null : null) // Final uchun har doim link, menejer uchun link yo'q
            });
        }
    } else {
        // NORMAL so'rov uchun formatNormalRequestMessage
        originalMessage = formatNormalRequestMessage({
            brand_name: request.brand_name,
            filial_name: request.filial_name,
            svr_name: request.svr_name,
            request_uid: request.request_uid
        });
    }
    
    // Menejer ma'lumotlarini olish (so'rov yaratgan)
    const creator = await db('users')
        .where('id', request.created_by)
        .select('username', 'fullname', 'created_at')
        .first();
    
    // ✅ Barcha tasdiqlashlarni olish (approved va reversed)
    let approvals = await db('debt_request_approvals')
        .join('users', 'debt_request_approvals.approver_id', 'users.id')
        .where('debt_request_approvals.request_id', request.id)
        .whereIn('debt_request_approvals.status', ['approved', 'reversed'])
        .orderBy('debt_request_approvals.created_at', 'asc')
        .select(
            'users.username',
            'users.fullname',
            'debt_request_approvals.approval_type',
            'debt_request_approvals.status',
            'debt_request_approvals.created_at'
        );
    
    // Kassir va operator uchun: faqat avvalgilari (o'zlaridan oldin tasdiqlaganlar)
    // Menejer uchun: barcha tasdiqlashlar (avvalgilari va keyingilari)
    if (forRole === 'cashier') {
        // Kassir uchun: faqat o'zidan oldin tasdiqlaganlar (leader, menejer)
        approvals = approvals.filter(a => a.approval_type === 'leader' || a.approval_type === 'manager');
    } else if (forRole === 'operator') {
        // Operator uchun: faqat o'zidan oldin tasdiqlaganlar (leader, cashier, supervisor, menejer)
        approvals = approvals.filter(a => 
            a.approval_type === 'leader' || 
            a.approval_type === 'cashier' || 
            a.approval_type === 'supervisor' ||
            a.approval_type === 'manager'
        );
    }
    // Menejer uchun: barcha tasdiqlashlar (hech qanday filtrlash yo'q)
    
    // Tasdiqlashlar ro'yxatini format qilish
    let approvalsText = '';
    const typeNames = {
        'leader': 'Rahbar',
        'cashier': 'Kassir',
        'operator': 'Operator',
        'supervisor': 'Nazoratchi',
        'manager': 'Menejer'
    };
    
    // ✅ MUHIM: Vaqt hisoblash - menejer so'rov yaratib yuborilgandan keyin
    const requestCreatedAt = new Date(request.created_at);
    
    // Menejerni birinchi qo'shish (menejer va final guruh uchun)
    if ((forRole === 'manager' || forRole === 'final') && creator) {
        const creatorName = creator.fullname || creator.username || 'Noma\'lum';
        const creatorTag = creator.username ? `@${creator.username}` : '';
        const createdDate = new Date(request.created_at);
        const formattedDate = createdDate.toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        approvalsText += `1. ${creatorTag ? creatorTag + ' ' : ''}(${creatorName}) - Menejer`;
        approvalsText += `\nVaqt: ${formattedDate}`;
        // Menejerdan mustasno - u xabar yaratadi, vaqt hisoblanmaydi
    }
    
    // Boshqa tasdiqlashlarni qo'shish (approved va reversed)
    // ✅ MUHIM: Har bir tasdiqlash uchun vaqt hisoblash (menejerdan boshlab, daqiqa hisobida)
    let previousApprovalTime = requestCreatedAt; // Menejer so'rov yaratgan vaqt
    
    approvals.forEach((approval, index) => {
        const approverName = approval.fullname || approval.username || 'Noma\'lum';
        const approverTag = approval.username ? `@${approval.username}` : '';
        const typeName = typeNames[approval.approval_type] || approval.approval_type;
        const date = new Date(approval.created_at);
        const formattedDate = date.toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // ✅ Vaqt hisoblash (menejerdan boshlab, daqiqa hisobida)
        const timeDiffMs = date.getTime() - previousApprovalTime.getTime();
        const timeDiffMinutes = Math.round(timeDiffMs / (1000 * 60)); // Daqiqa hisobida
        
        if (approvalsText) {
            approvalsText += '\n\n';
        }
        const approvalNumber = ((forRole === 'manager' || forRole === 'final') && creator ? 2 : 1) + index;
        
        // ✅ Status bo'yicha formatlash
        if (approval.status === 'reversed') {
            approvalsText += `${approvalNumber}. ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
            approvalsText += `\nVaqt: ${formattedDate}`;
            // Vaqt ko'rsatish (final guruh uchun yoki forRole === 'manager' bo'lsa)
            if ((forRole === 'manager' || forRole === 'final') && timeDiffMinutes >= 0) {
                // Agar 60 daqiqadan ko'p bo'lsa, soat va daqiqa formatida ko'rsatish
                if (timeDiffMinutes >= 60) {
                    const hours = Math.floor(timeDiffMinutes / 60);
                    const minutes = timeDiffMinutes % 60;
                    if (minutes > 0) {
                        approvalsText += ` (${hours} soat ${minutes} daqiqa)`;
                    } else {
                        approvalsText += ` (${hours} soat)`;
                    }
                } else {
                    approvalsText += ` (${timeDiffMinutes} daqiqa)`;
                }
            }
            approvalsText += `🔄`; // Qaytarilgan holat uchun emoji
        } else {
            approvalsText += `${approvalNumber}. ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
            approvalsText += `\nVaqt: ${formattedDate}`;
            // ✅ Vaqt ko'rsatish (final guruh uchun yoki forRole === 'manager' bo'lsa)
            // Menejerdan mustasno - u xabar yaratadi, vaqt hisoblanmaydi
            if ((forRole === 'manager' || forRole === 'final') && timeDiffMinutes >= 0) {
                // Agar 60 daqiqadan ko'p bo'lsa, soat va daqiqa formatida ko'rsatish
                if (timeDiffMinutes >= 60) {
                    const hours = Math.floor(timeDiffMinutes / 60);
                    const minutes = timeDiffMinutes % 60;
                    if (minutes > 0) {
                        approvalsText += ` (${hours} soat ${minutes} daqiqa)`;
                    } else {
                        approvalsText += ` (${hours} soat)`;
                    }
                } else {
                    approvalsText += ` (${timeDiffMinutes} daqiqa)`;
                }
            }
            approvalsText += `✅`; // Tasdiqlangan holat uchun emoji
        }
        
        // Keyingi tasdiqlash uchun vaqtni yangilash
        previousApprovalTime = date;
    });
    
    // ✅ Qaytarilish sonini hisoblash (final guruh uchun yoki forRole === 'manager' bo'lsa)
    let reversalCount = 0;
    if (forRole === 'manager' || forRole === 'final') {
        try {
            const reversalRecords = await db('debt_request_approvals')
                .where('request_id', request.id)
                .where('status', 'reversed')
                .count('* as count')
                .first();
            
            reversalCount = reversalRecords ? parseInt(reversalRecords.count) || 0 : 0;
        } catch (error) {
            // Xatolik bo'lsa, 0 qaytaramiz
            reversalCount = 0;
        }
    }
    
    // Original xabar + tasdiqlashlar
    if (approvalsText) {
        originalMessage += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        originalMessage += `✅ <b>Tasdiqlanganlar:</b>\n\n`;
        originalMessage += approvalsText;
    }
    
    // ✅ Qaytarilish sonini ko'rsatish (agar qaytarilgan bo'lsa) - Final guruh uchun
    if ((forRole === 'manager' || forRole === 'final') && reversalCount > 0) {
        originalMessage += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        originalMessage += `🔄 <b>Qaytarilish soni:</b> <code>${reversalCount} marta</code>`;
    }
    
    // ✅ Teskari jarayon yoki bekor qilish holatini ko'rsatish (faqat menejer uchun)
    if (forRole === 'manager' && (request.status === 'reversed' || request.status === 'REJECTED')) {
        // Qaysi roldan qaytganini yoki bekor qilinganini aniqlash
        const reversedApproval = await db('debt_request_approvals')
            .where('request_id', request.id)
            .where('status', 'reversed')
            .orderBy('created_at', 'desc')
            .first();
        
        const rejectedApproval = await db('debt_request_approvals')
            .where('request_id', request.id)
            .where('status', 'rejected')
            .orderBy('created_at', 'desc')
            .first();
        
        // Tasdiqlash jarayonini format qilish
        let approvalFlow = '';
        
        if (request.type === 'SET') {
            // SET so'rov uchun jarayon
            const leaderApproved = approvals.some(a => a.approval_type === 'leader' && a.status === 'approved');
            const leaderRejected = rejectedApproval && rejectedApproval.approval_type === 'leader';
            const cashierReversed = reversedApproval && reversedApproval.approval_type === 'cashier';
            const operatorReversed = reversedApproval && reversedApproval.approval_type === 'operator';
            
            // Status bo'yicha holatni aniqlash
            let leaderStatus = '<code>kutilyabdi</code>';
            if (leaderRejected) {
                leaderStatus = '❌ <code>bekor qilingan</code>';
            } else if (leaderApproved) {
                leaderStatus = '✅ <code>tugallandi</code>';
            } else if (request.status === 'SET_PENDING') {
                leaderStatus = '<code>jarayonda</code>';
            }
            
            let cashierStatus = '<code>kutilyabdi</code>';
            if (cashierReversed) {
                cashierStatus = '🔄 <code>Qaytarilindi</code>';
            } else if (leaderApproved && !leaderRejected) {
                cashierStatus = '<code>jarayonda</code>';
            }
            
            let operatorStatus = '<code>kutilyabdi</code>';
            if (operatorReversed) {
                operatorStatus = '⚠️ <code>qaytarilindi</code>';
            } else if (leaderApproved && !leaderRejected && !cashierReversed) {
                operatorStatus = '<code>kutilyabdi</code>';
            }
            
            approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n`;
            approvalFlow += `1️⃣ <b>Rahbarlar guruhi</b> - ${leaderStatus}\n`;
            approvalFlow += `2️⃣ <b>Kassir</b> - ${cashierStatus}\n`;
            approvalFlow += `3️⃣ <b>Operator</b> - ${operatorStatus}\n`;
            approvalFlow += `4️⃣ <b>Final guruh</b> - <code>kutilyabdi</code>`;
        } else {
            // NORMAL so'rov uchun jarayon
            const cashierReversed = reversedApproval && reversedApproval.approval_type === 'cashier';
            const operatorReversed = reversedApproval && reversedApproval.approval_type === 'operator';
            
            let cashierStatus = '<code>jarayonda</code>';
            if (cashierReversed) {
                cashierStatus = '⚠️ <code>qaytarilindi</code>';
            }
            
            let operatorStatus = '<code>kutilyabdi</code>';
            if (operatorReversed) {
                operatorStatus = '⚠️ <code>qaytarilindi</code>';
            } else if (!cashierReversed) {
                operatorStatus = '<code>kutilyabdi</code>';
            }
            
            approvalFlow = `\n\n📋 <b>Tasdiqlash jarayoni:</b>\n`;
            approvalFlow += `1️⃣ <b>Kassir</b> - ${cashierStatus}\n`;
            approvalFlow += `2️⃣ <b>Operator</b> - ${operatorStatus}\n`;
            approvalFlow += `3️⃣ <b>Final guruh</b> - <code>kutilyabdi</code>`;
        }
        
        // ✅ "Tasdiqlash jarayoni" bo'limini faqat Menejer uchun ko'rsatish
        if (forRole === 'manager') {
            originalMessage += approvalFlow;
        }
    }
    
    return originalMessage;
}

/**
 * Preview xabari (Kassir/Operator uchun)
 */
function formatPreviewMessage(data) {
    const { request_uid, brand_name, filial_name, svr_name, month_name, debt_details } = data;
    
    let message = '📋 Preview\n\n';
    
    if (request_uid) {
        message += `So'rov ID: ${request_uid}\n`;
    }
    
    if (brand_name) {
        message += `Brend: ${brand_name}\n`;
    }
    if (filial_name) {
        message += `Filial: ${filial_name}\n`;
    }
    if (svr_name) {
        message += `SVR: ${svr_name}\n`;
    }
    if (month_name) {
        message += `Oy: ${month_name}\n`;
    }
    
    if (debt_details) {
        message += `\nQarzdorlik ma'lumotlari:\n${debt_details}`;
    }
    
    return message;
}

/**
 * Final guruh xabari (Barcha tasdiqlashlardan keyin)
 */
function formatFinalGroupMessage(data) {
    const {
        brand_name,
        filial_name,
        svr_name,
        request_uid,
        excel_data,
        excel_headers,
        excel_columns,
        total_amount,
        approvals = []
    } = data;
    
    const month_name = getPreviousMonthName();
    
    let message = 'Assalomu aleykum\n\n';
    
    if (brand_name) {
        message += `Brend: ${brand_name}\n\n`;
    }
    
    message += `${filial_name} filial supervayzeri ${svr_name} ${month_name} oyi qarzlarini yopdi.\n`;
    message += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz`;
    
    if (request_uid) {
        message += `\n\nSo'rov ID: ${request_uid}`;
    }
    
    // Excel ma'lumotlari mavjud bo'lsa
    if (excel_data && excel_data.length > 0 && excel_columns) {
        message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `📊 Qarzdorlik klientlar:\n\n`;
        
        let headers = excel_headers || [];
        let columns = excel_columns || {};
        
        if (typeof headers === 'string') {
            try {
                headers = JSON.parse(headers);
            } catch (e) {
                headers = [];
            }
        }
        
        if (typeof columns === 'string') {
            try {
                columns = JSON.parse(columns);
            } catch (e) {
                columns = {};
            }
        }
        
        let excelData = excel_data;
        if (typeof excel_data === 'string') {
            try {
                excelData = JSON.parse(excel_data);
            } catch (e) {
                excelData = [];
            }
        }
        
        const formattedData = formatExcelData(excelData, columns, headers, 10);
        message += formattedData;
    }
    
    // TOTAL summa (agar Excel ma'lumotlari bo'lsa, formatExcelData allaqachon qo'shgan)
    // Lekin agar faqat total_amount bo'lsa, uni ko'rsatish
    if (total_amount !== null && total_amount !== undefined && (!excel_data || excel_data.length === 0)) {
        message += `\n\nJami summa: ${Math.abs(total_amount).toLocaleString('ru-RU')}`;
    }
    
    // Tasdiqlashlar ro'yxati
    if (approvals && approvals.length > 0) {
        message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `✅ Tasdiqlashlar:\n\n`;
        approvals.forEach((approval, index) => {
            const { username, fullname, approval_type, created_at, timestamp } = approval;
            const approverName = fullname || username || 'Noma\'lum';
            const approverTag = username ? `@${username}` : '';
            const typeNames = {
                'leader': 'Rahbar',
                'cashier': 'Kassir',
                'operator': 'Operator'
            };
            const typeName = typeNames[approval_type] || approval_type;
            
            message += `${index + 1}. ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
            
            // created_at yoki timestamp dan vaqtni olish
            const timeValue = created_at || timestamp;
            if (timeValue) {
                const date = new Date(timeValue);
                const formattedDate = date.toLocaleString('uz-UZ', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                message += ` - ${formattedDate}`;
            }
            message += '\n';
        });
    }
    
    return message;
}

/**
 * Bekor qilish xabari (Rahbarlar uchun)
 */
function formatRejectionMessage(data) {
    const { request_uid, username, fullname, reason, timestamp } = data;
    
    let message = '❌ <b>Bekor qilindi</b>\n\n';
    
    if (request_uid) {
        message += `So'rov ID: ${request_uid}\n\n`;
    }
    
    const rejectorName = fullname || username || 'Noma\'lum';
    const rejectorTag = username ? `@${username}` : '';
    
    message += `Bekor qilgan: ${rejectorTag ? rejectorTag + ' ' : ''}(${rejectorName})\n`;
    
    if (timestamp) {
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        message += `Vaqt: ${formattedDate}\n`;
    }
    
    // Sabab ko'rsatish (agar bo'lsa, aks holda "sabab yo'q")
    if (reason && reason !== 'Sabab kiritilmadi') {
        message += `\nSabab: ${reason}`;
    } else {
        message += `\nSabab: sabab yo'q`;
    }
    
    return message;
}

module.exports = {
    formatNormalRequestMessage,
    formatSetRequestMessage,
    formatDebtResponseMessage,
    formatApprovalMessage,
    formatAllApprovalsMessage,
    formatRequestMessageWithApprovals,
    formatPreviewMessage,
    formatFinalGroupMessage,
    formatRejectionMessage
};
