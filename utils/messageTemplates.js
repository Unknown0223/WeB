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
        approvals = [], // Tasdiqlash ma'lumotlari (rahbarlar guruhida ko'rsatish uchun)
        telegraph_url = null // Telegraph sahifa URL'i (rahbarlar guruhida qo'shish uchun)
    } = data;
    const month_name = getPreviousMonthName();
    
    let message = 'Assalomu aleykum\n\n';
    
    if (brand_name) {
        message += `Brend: ${brand_name}\n\n`;
    }
    
    message += `${filial_name} filial supervayzeri ${svr_name} ${month_name} oyi qarzlarini yopdi.\n`;
    
    // Agar kassirga yuborilayotgan bo'lsa, boshqa matn
    if (is_for_cashier) {
        message += `Tekshirib chiqib tugri bulsa tasdiqlab bersangiz.\n`;
        
        // Kassirga yuborilganda Excel ma'lumotlarini ko'rsatish
        if (excel_data && excel_data.length > 0 && excel_columns) {
            message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `📊 Qarzdorlik klientlar:\n\n`;
            
            // Headers va columns ni to'g'ri olish (agar JSON string bo'lsa, parse qilish)
            let headers = excel_headers || [];
            let columns = excel_columns || {};
            
            // Agar headers string bo'lsa, parse qilish
            if (typeof headers === 'string') {
                try {
                    headers = JSON.parse(headers);
                } catch (e) {
                    headers = [];
                }
            }
            
            // Agar columns string bo'lsa, parse qilish
            if (typeof columns === 'string') {
                try {
                    columns = JSON.parse(columns);
                } catch (e) {
                    columns = {};
                }
            }
            
            // Agar excel_data string bo'lsa, parse qilish
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
    } else {
        // Rahbarlarga yuborilganda - Telegraph link yoki matn (SET so'rovlar uchun doim ko'rsatiladi)
        if (telegraph_url) {
            message += `\n\n🔗 <a href="${telegraph_url}">Muddat uzaytirilishi kerak bo'lgan klientlar</a>\n`;
        } else {
            // Agar Telegraph sahifa yaratilmagan bo'lsa, matn ko'rsatish
            message += `\n\nMuddat uzaytirilishi kerak bo'lgan klientlar ro'yxati tashlanmoqda. Shuni uzaytirish ruxsat berilishi so'raladi. Shundan boshqa qarzdorlik yo'qligi tasdiqlanishi va konsignatsiyani ochilishiga ruxsat so'raladi.\n`;
        }
    }
    
    if (extra_info) {
        message += `\n${extra_info}`;
    }
    
    if (request_uid) {
        message += `\n\nSo'rov ID: ${request_uid}`;
    }
    
    // Tasdiqlash ma'lumotlari (rahbarlar guruhida ko'rsatish uchun)
    if (approvals && approvals.length > 0) {
        message += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `✅ <b>Tasdiqlanganlar:</b>\n`;
        approvals.forEach((approval, index) => {
            const approverName = approval.fullname || approval.username || 'Noma\'lum';
            const approverTag = approval.username ? `@${approval.username}` : '';
            const typeNames = {
                'leader': 'Rahbar',
                'cashier': 'Kassir',
                'operator': 'Operator'
            };
            const typeName = typeNames[approval.approval_type] || approval.approval_type;
            
            message += `${index + 1}. ${approverTag ? approverTag + ' ' : ''}(${approverName}) - ${typeName}`;
            
            if (approval.timestamp || approval.created_at) {
                const date = new Date(approval.timestamp || approval.created_at);
                const formattedDate = date.toLocaleString('uz-UZ', {
                    day: '2-digit',
                    month: '2-digit',
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
 * Qarzi bor javobi (Kassir/Operator -> Oldingi bosqich)
 */
function formatDebtResponseMessage(data) {
    const { request_uid, brand_name, filial_name, svr_name, debt_details, total_amount, excel_data, excel_headers, excel_columns } = data;
    
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
    
    // Excel ma'lumotlari mavjud bo'lsa
    if (excel_data && excel_data.length > 0 && excel_columns) {
        const formattedData = formatExcelData(excel_data, excel_columns, excel_headers || [], 10);
        message += formattedData;
    } else if (debt_details) {
        // Yozma ma'lumotlar
        message += debt_details;
    }
    
    if (total_amount !== null && total_amount !== undefined) {
        message += `\n\nTOTAL: ${Math.abs(total_amount).toLocaleString('ru-RU')}`;
    }
    
    return message;
}

/**
 * Tasdiqlash xabari (Har bir bosqich)
 */
function formatApprovalMessage(data) {
    const { username, fullname, timestamp, approval_type } = data;
    
    let message = '✅ Tasdiqlangan\n\n';
    
    if (username || fullname) {
        const approverName = fullname || username || 'Noma\'lum';
        const approverTag = username ? `@${username}` : '';
        message += `Tasdiqlagan: ${approverTag ? approverTag + ' ' : ''}(${approverName})`;
        
        if (approval_type) {
            const typeNames = {
                'leader': 'Rahbar',
                'cashier': 'Kassir',
                'operator': 'Operator'
            };
            message += ` - ${typeNames[approval_type] || approval_type}`;
        }
        message += '\n';
    }
    
    if (timestamp) {
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        message += `Vaqt: ${formattedDate}`;
    }
    
    return message;
}

/**
 * Preview xabari (Kassir/Operator uchun)
 */
function formatPreviewMessage(data) {
    const { request_uid, brand_name, filial_name, svr_name, month_name, debt_details } = data;
    
    let message = '📋 So\'rov ko\'rinishi\n\n';
    
    if (request_uid) {
        message += `So'rov ID: ${request_uid}\n`;
    }
    
    if (brand_name) {
        message += `Brend: ${brand_name}\n`;
    }
    
    message += `Filial: ${filial_name}\n`;
    message += `SVR: ${svr_name}\n`;
    
    if (month_name) {
        message += `Oy: ${month_name}\n`;
    }
    
    if (debt_details) {
        message += `\n${debt_details}`;
    }
    
    return message;
}

/**
 * Final guruh xabari (Barcha tasdiqlashlardan keyin)
 */
function formatFinalGroupMessage(data) {
    const { 
        request_uid, 
        brand_name, 
        filial_name, 
        svr_name, 
        month_name, 
        extra_info,
        approvals,
        total_amount,
        excel_data,
        excel_headers,
        excel_columns,
        telegraph_url
    } = data;
    
    let message = '✅ <b>SO\'ROV YAKUNIY TASDIQLANDI</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += '📋 <b>Jarayon mutlaqo tugadi</b>\n\n';
    
    if (request_uid) {
        message += `📝 <b>So'rov ID:</b> ${request_uid}\n`;
    }
    
    message += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    if (brand_name) {
        message += `📌 <b>Brend:</b> ${brand_name}\n`;
    }
    
    message += `📍 <b>Filial:</b> ${filial_name}\n`;
    message += `👤 <b>SVR:</b> ${svr_name}\n`;
    
    if (month_name) {
        message += `📅 <b>Oy:</b> ${month_name}\n`;
    }
    
    if (extra_info) {
        message += `\n📝 <b>Qo'shimcha ma'lumot:</b> ${extra_info}\n`;
    }
    
    // Excel ma'lumotlari (qarzdorlik ma'lumotlari)
    if (excel_data && excel_data.length > 0 && excel_columns) {
        message += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `📊 Qarzdorlik klientlar:\n\n`;
        const formattedData = formatExcelData(excel_data, excel_columns, excel_headers || [], 10);
        message += formattedData;
        
        // Telegraph sahifa linki (agar mavjud bo'lsa)
        if (data.telegraph_url) {
            message += `\n\n🔗 <a href="${data.telegraph_url}">To'liq ma'lumotlarni ko'rish</a>`;
        }
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
    
    let message = '❌ So\'rov bekor qilindi\n\n';
    
    if (request_uid) {
        message += `So'rov ID: ${request_uid}\n`;
    }
    
    if (username || fullname) {
        const rejectorName = fullname || username || 'Noma\'lum';
        const rejectorTag = username ? `@${username}` : '';
        message += `Bekor qilgan: ${rejectorTag ? rejectorTag + ' ' : ''}(${rejectorName})\n`;
    }
    
    if (reason) {
        message += `Sabab: ${reason}\n`;
    }
    
    if (timestamp) {
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        message += `Vaqt: ${formattedDate}`;
    }
    
    return message;
}

module.exports = {
    formatNormalRequestMessage,
    formatSetRequestMessage,
    formatDebtResponseMessage,
    formatApprovalMessage,
    formatPreviewMessage,
    formatFinalGroupMessage,
    formatRejectionMessage
};

