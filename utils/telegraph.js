// utils/telegraph.js
// Telegraph (telegra.ph) sahifa yaratish

const axios = require('axios');
const { createLogger } = require('./logger.js');

const log = createLogger('TELEGRAPH');

/**
 * Telegraph sahifasini yaratish
 * @param {Object} data - Sahifa ma'lumotlari
 * @param {string} data.title - Sahifa sarlavhasi
 * @param {string} data.content - Sahifa kontenti (HTML formatida)
 * @param {string} data.author_name - Muallif nomi (ixtiyoriy)
 * @param {string} data.author_url - Muallif URL (ixtiyoriy)
 * @returns {Promise<string|null>} - Telegraph sahifa URL'i yoki null
 */
async function createTelegraphPage(data) {
    try {
        const { title, content, author_name = 'Debt Approval System', author_url } = data;
        
        if (!title || !content) {
            log.error('[TELEGRAPH] Title yoki content mavjud emas');
            return null;
        }
        
        log.info(`[TELEGRAPH] Telegraph API'ga so'rov yuborilmoqda: title="${title}", contentNodes=${Array.isArray(content) ? content.length : 'not array'}`);
        
        // Telegraph API endpoint
        const apiUrl = 'https://api.telegra.ph/createPage';
        
        // Request data - faqat mavjud field'larni qo'shamiz
        const requestData = {
            title: title,
            content: content // Node array formatida
        };
        
        // author_name faqat mavjud bo'lsa qo'shamiz
        if (author_name && author_name.trim() !== '') {
            requestData.author_name = author_name;
        }
        
        // author_url faqat mavjud va to'g'ri URL bo'lsa qo'shamiz
        if (author_url && author_url.trim() !== '') {
            requestData.author_url = author_url;
        }
        
        log.info(`[TELEGRAPH] Request data: title="${title}", author_name="${requestData.author_name || 'none'}", contentType=${Array.isArray(content) ? 'array' : typeof content}, contentLength=${Array.isArray(content) ? content.length : 'N/A'}`);
        
        const response = await axios.post(apiUrl, requestData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 soniya timeout
        });
        
        if (response.data && response.data.ok && response.data.result) {
            const pageUrl = `https://telegra.ph/${response.data.result.path}`;
            log.info(`[TELEGRAPH] ✅ Sahifa yaratildi: URL=${pageUrl}`);
            return pageUrl;
        } else {
            log.error(`[TELEGRAPH] ❌ Sahifa yaratishda xatolik:`, response.data);
            return null;
        }
    } catch (error) {
        if (error.response && error.response.data) {
            log.error(`[TELEGRAPH] ❌ API xatolik:`, error.response.data);
        } else {
            log.error(`[TELEGRAPH] ❌ Sahifa yaratishda xatolik:`, error.message);
        }
        return null;
    }
}

/**
 * Qarzdorlik ma'lumotlarini Telegraph HTML formatiga o'tkazish
 * @param {Object} data - Qarzdorlik ma'lumotlari
 * @returns {string} - HTML kontent
 */
function formatDebtDataToHTML(data) {
    const {
        request_uid,
        brand_name,
        filial_name,
        svr_name,
        month_name,
        extra_info,
        excel_data,
        excel_headers,
        excel_columns,
        total_amount
    } = data;
    
    let html = '';
    
    // Sarlavha
    html += `<h1>📊 Qarzdorlik ma'lumotlari</h1>\n\n`;
    
    // So'rov ma'lumotlari
    html += `<p><strong>So'rov ID:</strong> ${request_uid || 'N/A'}</p>\n`;
    
    if (brand_name) {
        html += `<p><strong>Brend:</strong> ${brand_name}</p>\n`;
    }
    
    html += `<p><strong>Filial:</strong> ${filial_name || 'N/A'}</p>\n`;
    html += `<p><strong>SVR:</strong> ${svr_name || 'N/A'}</p>\n`;
    
    if (month_name) {
        html += `<p><strong>Oy:</strong> ${month_name}</p>\n`;
    }
    
    if (extra_info) {
        html += `<p><strong>Qo'shimcha ma'lumot:</strong> ${extra_info}</p>\n`;
    }
    
    html += `<hr>\n\n`;
    
    // Excel ma'lumotlari
    if (excel_data && excel_data.length > 0 && excel_columns) {
        html += `<h2>📋 Qarzdorlik klientlar ro'yxati</h2>\n\n`;
        
        // Jadval boshlang'ichi
        html += `<table>\n<thead>\n<tr>\n`;
        
        // Header'lar
        if (excel_columns.id !== undefined) {
            const idHeader = excel_headers && excel_headers[excel_columns.id] ? excel_headers[excel_columns.id] : 'ID клиента';
            html += `<th>${idHeader}</th>\n`;
        }
        if (excel_columns.name !== undefined) {
            const nameHeader = excel_headers && excel_headers[excel_columns.name] ? excel_headers[excel_columns.name] : 'Клиент';
            html += `<th>${nameHeader}</th>\n`;
        }
        if (excel_columns.summa !== undefined) {
            const summaHeader = excel_headers && excel_headers[excel_columns.summa] ? excel_headers[excel_columns.summa] : 'Общий';
            html += `<th>${summaHeader}</th>\n`;
        }
        
        html += `</tr>\n</thead>\n<tbody>\n`;
        
        // Qatorlar
        excel_data.forEach(row => {
            html += `<tr>\n`;
            if (excel_columns.id !== undefined) {
                const idHeader = excel_headers && excel_headers[excel_columns.id] ? excel_headers[excel_columns.id] : 'ID клиента';
                const idValue = row[idHeader] !== undefined ? String(row[idHeader]) : '';
                html += `<td>${escapeHtml(idValue)}</td>\n`;
            }
            if (excel_columns.name !== undefined) {
                const nameHeader = excel_headers && excel_headers[excel_columns.name] ? excel_headers[excel_columns.name] : 'Клиент';
                const nameValue = row[nameHeader] !== undefined ? String(row[nameHeader]) : '';
                html += `<td>${escapeHtml(nameValue)}</td>\n`;
            }
            if (excel_columns.summa !== undefined) {
                const summaHeader = excel_headers && excel_headers[excel_columns.summa] ? excel_headers[excel_columns.summa] : 'Общий';
                const summaValue = row[summaHeader] !== undefined ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) : 0;
                html += `<td>${summaValue.toLocaleString('ru-RU')}</td>\n`;
            }
            html += `</tr>\n`;
        });
        
        html += `</tbody>\n</table>\n\n`;
        
        // Jami summa
        if (total_amount !== null && total_amount !== undefined) {
            html += `<p><strong>Jami summa:</strong> ${Math.abs(total_amount).toLocaleString('ru-RU')}</p>\n`;
        }
    } else if (total_amount !== null && total_amount !== undefined) {
        html += `<p><strong>Jami summa:</strong> ${Math.abs(total_amount).toLocaleString('ru-RU')}</p>\n`;
    }
    
    return html;
}

/**
 * HTML'ni escape qilish (xavfsizlik uchun)
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Qarzdorlik ma'lumotlarini Telegraph Node array formatiga o'tkazish
 * Telegraph API content sifatida Node array kutadi
 * Node format: [{tag: 'p', children: ['text']}, {tag: 'h3', children: ['text']}]
 */
function formatDebtDataToTelegraphNodes(data) {
    const {
        request_uid,
        brand_name,
        filial_name,
        svr_name,
        month_name,
        extra_info,
        excel_data,
        excel_headers,
        excel_columns,
        total_amount
    } = data;
    
    const nodes = [];
    
    // Sarlavha
    nodes.push({ tag: 'h3', children: ['📊 Qarzdorlik ma\'lumotlari'] });
    nodes.push({ tag: 'br' });
    
    // So'rov ma'lumotlari
    if (request_uid) {
        nodes.push({ tag: 'p', children: [`So'rov ID: ${request_uid}`] });
    }
    
    if (brand_name) {
        nodes.push({ tag: 'p', children: [`Brend: ${brand_name}`] });
    }
    
    if (filial_name) {
        nodes.push({ tag: 'p', children: [`Filial: ${filial_name}`] });
    }
    
    if (svr_name) {
        nodes.push({ tag: 'p', children: [`SVR: ${svr_name}`] });
    }
    
    if (month_name) {
        nodes.push({ tag: 'p', children: [`Oy: ${month_name}`] });
    }
    
    if (extra_info) {
        nodes.push({ tag: 'p', children: [`Qo'shimcha ma'lumot: ${extra_info}`] });
    }
    
    nodes.push({ tag: 'hr' });
    
    // Excel ma'lumotlari
    if (excel_data && excel_data.length > 0 && excel_columns) {
        nodes.push({ tag: 'h4', children: ['📋 Muddat uzaytirilishi kerak bo\'lgan klientlar'] });
        nodes.push({ tag: 'br' });
        
        // Header'lar
        const idHeader = excel_headers && excel_headers[excel_columns.id] ? excel_headers[excel_columns.id] : 'ID клиента';
        const nameHeader = excel_headers && excel_headers[excel_columns.name] ? excel_headers[excel_columns.name] : 'Клиент';
        const summaHeader = excel_headers && excel_headers[excel_columns.summa] ? excel_headers[excel_columns.summa] : 'Общий';
        
        // Jadval boshlang'ichi (telegraph'da jadval oddiy formatda ko'rsatiladi)
        excel_data.forEach((row, index) => {
            const idValue = row[idHeader] !== undefined ? String(row[idHeader]) : '';
            const nameValue = row[nameHeader] !== undefined ? String(row[nameHeader]) : '';
            const summaValue = row[summaHeader] !== undefined ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) : 0;
            
            nodes.push({ tag: 'p', children: [`${index + 1}. ${idValue} - ${nameValue}: ${summaValue.toLocaleString('ru-RU')}`] });
        });
        
        nodes.push({ tag: 'br' });
        
        // Jami summa
        if (total_amount !== null && total_amount !== undefined) {
            nodes.push({ tag: 'p', children: [`Jami summa: ${Math.abs(total_amount).toLocaleString('ru-RU')}`] });
        }
    } else if (total_amount !== null && total_amount !== undefined) {
        nodes.push({ tag: 'p', children: [`Jami summa: ${Math.abs(total_amount).toLocaleString('ru-RU')}`] });
    }
    
    return nodes;
}

/**
 * Qarzdorlik ma'lumotlarini Telegraph sahifasiga yuborish
 * @param {Object} data - Qarzdorlik ma'lumotlari
 * @returns {Promise<string|null>} - Telegraph sahifa URL'i yoki null
 */
async function createDebtDataPage(data) {
    try {
        const title = `Muddat uzaytirilishi kerak bo'lgan klientlar - ${data.request_uid || 'N/A'}`;
        log.info(`[TELEGRAPH] Qarzdorlik sahifasini yaratish boshlanmoqda: requestUID=${data.request_uid}, excelDataLength=${data.excel_data?.length || 0}`);
        
        // Telegraph Node array formatiga o'tkazish
        const telegraphContent = formatDebtDataToTelegraphNodes(data);
        log.info(`[TELEGRAPH] Telegraph Node array formatiga o'tkazildi: nodesCount=${telegraphContent.length}`);
        
        const pageUrl = await createTelegraphPage({
            title: title,
            content: telegraphContent,
            author_name: 'Debt Approval System'
        });
        
        if (pageUrl) {
            log.info(`[TELEGRAPH] ✅ Qarzdorlik sahifasi muvaffaqiyatli yaratildi: requestUID=${data.request_uid}, URL=${pageUrl}`);
        } else {
            log.warn(`[TELEGRAPH] ⚠️ Qarzdorlik sahifasi yaratilmadi (URL null): requestUID=${data.request_uid}`);
        }
        
        return pageUrl;
    } catch (error) {
        log.error(`[TELEGRAPH] Qarzdorlik sahifasini yaratishda xatolik: requestUID=${data.request_uid}`, error);
        return null;
    }
}

/**
 * HTML'ni Telegraph Node array formatiga o'tkazish
 * Telegraph API content sifatida Node array kutadi
 * Node format: [{tag: 'p', children: ['text']}, {tag: 'h1', children: ['text']}]
 */
function htmlToTelegraphNodes(html) {
    // Oddiy HTML'ni Telegraph Node formatiga o'tkazish
    // Bu oddiy versiya - faqat asosiy HTML elementlarni qo'llab-quvvatlaydi
    
    // Eng oson yo'li - HTML'ni string sifatida yuborish va Telegraph API'ga tushunishga ruxsat berish
    // Lekin Telegraph API Node array kutadi
    
    // Temporary solution - HTML'ni paragraph'larga bo'lish
    const lines = html.split('\n').filter(line => line.trim());
    const nodes = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // HTML tag'larni aniqlash
        if (trimmed.startsWith('<h1>')) {
            const text = trimmed.replace(/<h1>(.*?)<\/h1>/, '$1');
            nodes.push({ tag: 'h3', children: [text] }); // Telegraph'da h1 emas, h3
        } else if (trimmed.startsWith('<h2>')) {
            const text = trimmed.replace(/<h2>(.*?)<\/h2>/, '$1');
            nodes.push({ tag: 'h4', children: [text] }); // Telegraph'da h2 emas, h4
        } else if (trimmed.startsWith('<p>')) {
            const text = trimmed.replace(/<p>(.*?)<\/p>/, '$1');
            // HTML'ni tozalash
            const cleanText = text.replace(/<strong>(.*?)<\/strong>/g, '$1');
            nodes.push({ tag: 'p', children: [cleanText] });
        } else if (trimmed.startsWith('<table>')) {
            // Jadval - keyingi qatorda ishlatamiz
            continue;
        } else if (trimmed.startsWith('<tr>')) {
            // Qator - keyingi qatorda ishlatamiz
            continue;
        } else if (trimmed.startsWith('<th>') || trimmed.startsWith('<td>')) {
            // Cell - keyingi qatorda ishlatamiz
            continue;
        } else if (trimmed === '<hr>') {
            nodes.push({ tag: 'hr' });
        } else if (trimmed.startsWith('<tbody>') || trimmed.startsWith('</tbody>') || 
                   trimmed.startsWith('<thead>') || trimmed.startsWith('</thead>') ||
                   trimmed.startsWith('</table>')) {
            // Ignore
            continue;
        } else {
            // Oddiy matn
            nodes.push({ tag: 'p', children: [trimmed] });
        }
    }
    
    return nodes;
}

module.exports = {
    createTelegraphPage,
    createDebtDataPage,
    formatDebtDataToHTML,
    formatDebtDataToTelegraphNodes
};

