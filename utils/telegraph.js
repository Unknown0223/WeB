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
        
        
        // Telegraph API endpoint
        const apiUrl = 'https://api.telegra.ph/createPage';
        
        // Request data
        const requestData = {
            title: title,
            content: content // Node array formatida
        };
        
        // Access token qo'shish (agar mavjud bo'lsa)
        const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
        if (accessToken) {
            requestData.access_token = accessToken;
        }
        
        // author_name faqat mavjud bo'lsa qo'shamiz
        if (author_name && author_name.trim() !== '') {
            requestData.author_name = author_name;
        }
        
        // author_url faqat mavjud va to'g'ri URL bo'lsa qo'shamiz
        if (author_url && author_url.trim() !== '') {
            requestData.author_url = author_url;
        }
        
        
        const response = await axios.post(apiUrl, requestData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 soniya timeout (Telegraph API ba'zan sekin javob beradi)
        });
        
        if (response.data && response.data.ok && response.data.result) {
            const pageUrl = `https://telegra.ph/${response.data.result.path}`;
            return pageUrl;
        } else {
            // Telegraph API xatoliklarini silent qilish (ixtiyoriy xizmat)
            const errorMsg = response.data?.error || 'Noma\'lum xatolik';
            if (errorMsg === 'ACCESS_TOKEN_INVALID' || errorMsg.includes('ACCESS_TOKEN')) {
                // ACCESS_TOKEN xatolari - Telegraph API muammosi, debug level'da log qilamiz
                log.debug(`[TELEGRAPH] Telegraph API access token muammosi (ixtiyoriy xizmat, workflow davom etadi)`);
            } else {
                // Boshqa xatolar - debug level'da log qilamiz
                log.debug(`[TELEGRAPH] Telegraph API xatolik (ixtiyoriy): ${errorMsg}`);
            }
            return null;
        }
    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            // Timeout - debug level'da log qilamiz (ixtiyoriy xizmat)
            log.debug(`[TELEGRAPH] Telegraph API timeout (ixtiyoriy xizmat, workflow davom etadi)`);
        } else if (error.response && error.response.data) {
            const errorData = error.response.data;
            const errorMsg = errorData.error || 'Noma\'lum xatolik';
            if (errorMsg === 'ACCESS_TOKEN_INVALID' || errorMsg.includes('ACCESS_TOKEN')) {
                // ACCESS_TOKEN xatolari - debug level'da log qilamiz
                log.debug(`[TELEGRAPH] Telegraph API access token muammosi (ixtiyoriy xizmat, workflow davom etadi)`);
            } else {
                // Boshqa xatolar - debug level'da log qilamiz
                log.debug(`[TELEGRAPH] Telegraph API xatolik (ixtiyoriy): ${errorMsg}`);
            }
        } else {
            // Network yoki boshqa xatolar - debug level'da log qilamiz
            log.debug(`[TELEGRAPH] Telegraph API xatolik (ixtiyoriy): ${error.message}`);
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
        total_amount,
        isForCashier = false // ✅ Qo'shilgan: Kassir uchun maxsus format
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
        // ✅ MUHIM: Agar kassir uchun bo'lsa, "Агент" ustuni bo'yicha guruhlash
        if (isForCashier && excel_columns.agent !== undefined && excel_columns.agent !== null) {
            // Kassir uchun: Agent bo'yicha guruhlash
            nodes.push({ tag: 'h4', children: ['📋 Agentlar bo\'yicha qarzdorlik ma\'lumotlari'] });
            nodes.push({ tag: 'br' });
            
            // Agent ustunini aniqlash (faqat "Агент" ustuni)
            const agentHeader = excel_headers && excel_headers[excel_columns.agent] 
                ? excel_headers[excel_columns.agent] 
                : 'Агент';
            const summaHeader = excel_headers && excel_headers[excel_columns.summa] 
                ? excel_headers[excel_columns.summa] 
                : 'Общий';
            
            // Agent bo'yicha guruhlash
            const agentMap = new Map(); // { agentName: { agentName, totalSumma, count } }
            
            excel_data.forEach(row => {
                // Agent nomini olish (faqat "Агент" ustuni)
                const agentName = row[agentHeader] !== undefined && row[agentHeader] !== null
                    ? String(row[agentHeader]).trim() 
                    : 'Noma\'lum';
                
                // Summani olish
                const summaValue = row[summaHeader] !== undefined 
                    ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) 
                    : 0;
                
                // Agent key yaratish (faqat nom)
                const agentKey = agentName;
                
                if (!agentMap.has(agentKey)) {
                    agentMap.set(agentKey, {
                        agentName: agentName,
                        totalSumma: 0,
                        count: 0
                    });
                }
                
                const agentData = agentMap.get(agentKey);
                agentData.totalSumma += (isNaN(summaValue) ? 0 : summaValue);
                agentData.count += 1;
            });
            
            // Agentlar ro'yxatini ko'rsatish
            let currentIndex = 0;
            let grandTotal = 0;
            
            // Agentlar ro'yxatini tartibga solish (nom bo'yicha)
            const sortedAgents = Array.from(agentMap.entries()).sort((a, b) => {
                return a[1].agentName.localeCompare(b[1].agentName);
            });
            
            sortedAgents.forEach(([agentKey, agentData]) => {
                currentIndex++;
                grandTotal += agentData.totalSumma;
                
                // Format: "1. Агент nomi: Umumiy summa" (faqat agent nomi)
                // ✅ Summani ajratib ko'rsatish (bold va separator)
                nodes.push({ 
                    tag: 'p', 
                    children: [
                        `${currentIndex}. ${agentData.agentName}: `,
                        { tag: 'b', children: [`${Math.abs(agentData.totalSumma).toLocaleString('ru-RU')}`] }
                    ] 
                });
            });
            
            nodes.push({ tag: 'br' });
            nodes.push({ tag: 'hr' });
            
            // ✅ Jami summa (bold formatda)
            nodes.push({ 
                tag: 'p', 
                children: [
                    '📊 ',
                    { tag: 'b', children: ['Jami summa:'] },
                    ' ',
                    { tag: 'b', children: [`${Math.abs(grandTotal).toLocaleString('ru-RU')}`] }
                ] 
            });
        } else {
            // Boshqa rollar uchun: Eski format (ID, nom, summa)
            nodes.push({ tag: 'h4', children: ['📋 Muddat uzaytirilishi kerak bo\'lgan klientlar'] });
            nodes.push({ tag: 'br' });
            
            // Header'lar
            const idHeader = excel_headers && excel_headers[excel_columns.id] ? excel_headers[excel_columns.id] : 'ID клиента';
            const nameHeader = excel_headers && excel_headers[excel_columns.name] ? excel_headers[excel_columns.name] : 'Клиент';
            const summaHeader = excel_headers && excel_headers[excel_columns.summa] ? excel_headers[excel_columns.summa] : 'Общий';
            
            // Jadval boshlang'ichi (telegraph'da jadval oddiy formatda ko'rsatiladi)
            // Telegraph API 64KB gacha ma'lumotni qabul qiladi, shuning uchun ma'lumotlarni cheklaymiz (maksimal 1000 qator)
            const MAX_ROWS = 1000;
            const limitedData = excel_data.slice(0, MAX_ROWS);
            
            limitedData.forEach((row, index) => {
                const idValue = row[idHeader] !== undefined ? String(row[idHeader]) : '';
                const nameValue = row[nameHeader] !== undefined ? String(row[nameHeader]) : '';
                const summaValue = row[summaHeader] !== undefined ? parseFloat(String(row[summaHeader]).replace(/\s/g, '').replace(/,/g, '.')) : 0;
                
                nodes.push({ tag: 'p', children: [`${index + 1}. ${idValue} - ${nameValue}: ${summaValue.toLocaleString('ru-RU')}`] });
            });
            
            // Agar ma'lumotlar cheklangan bo'lsa, xabar qo'shish
            if (excel_data.length > MAX_ROWS) {
                nodes.push({ tag: 'br' });
                nodes.push({ tag: 'p', children: [`... va yana ${excel_data.length - MAX_ROWS} ta klient`] });
            }
            
            nodes.push({ tag: 'br' });
            
            // Jami summa
            if (total_amount !== null && total_amount !== undefined) {
                nodes.push({ tag: 'p', children: [`Jami summa: ${Math.abs(total_amount).toLocaleString('ru-RU')}`] });
            }
        }
    } else if (total_amount !== null && total_amount !== undefined) {
        nodes.push({ tag: 'p', children: [`Jami summa: ${Math.abs(total_amount).toLocaleString('ru-RU')}`] });
    }
    
    return nodes;
}

/**
 * Farqlarni Telegraph Node array formatiga o'tkazish
 * @param {Object} data - Farqlar ma'lumotlari
 * @param {Array} data.differences - Farqlar ro'yxati
 * @param {string} data.request_uid - So'rov UID
 * @param {string} data.brand_name - Brend nomi
 * @param {string} data.filial_name - Filial nomi
 * @param {string} data.svr_name - SVR nomi
 * @param {string} data.month_name - Oy nomi
 * @returns {Array} - Telegraph Node array
 */
function formatDifferencesToTelegraphNodes(data) {
    const {
        differences,
        request_uid,
        brand_name,
        filial_name,
        svr_name,
        month_name,
        input_type // 'agent', 'total' yoki 'client'
    } = data;
    
    const nodes = [];
    
    // Agar umumiy summa bo'lsa, SVR bo'yicha farqni ko'rsatish
    if (input_type === 'total' && differences && differences.length > 0) {
        const totalDiff = differences.find(diff => diff.type === 'total');
        if (totalDiff) {
            const originalSumma = Math.abs(totalDiff.original_summa || 0);
            const newSumma = Math.abs(totalDiff.new_summa || 0);
            const difference = totalDiff.difference || 0;
            
            // Formatlash: faqat bo'shliqlar bilan (vergul bo'lmasligi uchun)
            const formattedOriginal = originalSumma.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            const formattedNew = newSumma.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            const formattedDiff = Math.abs(difference).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            
            nodes.push({ tag: 'p', children: [`<b>${svr_name || 'SVR'}</b> || ${formattedOriginal} || ${formattedNew} || Farq: ${difference > 0 ? '+' : '-'}${formattedDiff}`] });
            
            return nodes;
        }
    }
    
    // Agent bo'yicha farqlar (yoki oddiy farqlar)
    if (differences && differences.length > 0) {
        // Agent bo'yicha: faqat agent nomi bo'lgan farqlarni ko'rsatish
        // Client bo'yicha: faqat klient ID va nomi bo'lgan farqlarni ko'rsatish
        let filteredDiffs = differences;
        if (input_type === 'agent') {
            // Faqat agent nomi bo'lgan farqlarni ko'rsatish
            filteredDiffs = differences.filter(diff => diff.agent_name || diff.agent);
        } else if (input_type === 'client') {
            // Faqat klient ID va nomi bo'lgan farqlarni ko'rsatish
            filteredDiffs = differences.filter(diff => diff.id || diff.name);
        }
        
        if (filteredDiffs.length === 0) {
            nodes.push({ tag: 'p', children: ['Farqlar topilmadi.'] });
            return nodes;
        }
        
        // Sarlavha: input_type bo'yicha
        let sectionTitle = '📋 Farq qilgan klientlar';
        if (input_type === 'agent') {
            sectionTitle = '📋 Farq qilgan agentlar';
        } else if (input_type === 'client') {
            sectionTitle = '📋 Farq qilgan klientlar';
        }
        nodes.push({ tag: 'h4', children: [sectionTitle] });
        nodes.push({ tag: 'br' });
        
        // Farqlarni turiga qarab guruhlash va filtrlash
        // ✅ MUHIM: Faqat kattaroq yoki yangi bo'lganlar ko'rsatiladi
        const changedDiffs = filteredDiffs.filter(diff => {
            if (diff.type === 'changed') {
                const originalSumma = Math.abs(diff.original_summa || 0);
                const newSumma = Math.abs(diff.new_summa || 0);
                return newSumma > originalSumma;
            }
            return false;
        });
        
        // Yangilar: hammasi ko'rsatiladi
        const newDiffs = filteredDiffs.filter(diff => diff.type === 'new');
        
        // Telegraph API 64KB gacha ma'lumotni qabul qiladi, shuning uchun ma'lumotlarni cheklaymiz (maksimal 1000 qator)
        const MAX_ROWS = 1000;
        let currentIndex = 0;
        
        // 1. Avval o'zgarganlar (changed) - faqat kattaroq bo'lganlar
        const limitedChanged = changedDiffs.slice(0, MAX_ROWS);
        limitedChanged.forEach((diff) => {
            currentIndex++;
            const originalSumma = Math.abs(diff.original_summa || 0);
            const newSumma = Math.abs(diff.new_summa || 0);
            const difference = diff.difference || 0;
            
            // Agent bo'yicha: Agent nomi || Menejer summa || Kassir summa || Farq
            if (input_type === 'agent') {
                const agentName = diff.agent_name || diff.agent || 'Noma\'lum agent';
                // Formatlash: faqat bo'shliqlar bilan (vergul bo'lmasligi uchun)
                const formattedOriginal = originalSumma.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                const formattedNew = newSumma.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                const formattedDiff = Math.abs(difference).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                nodes.push({ 
                    tag: 'p', 
                    children: [`${currentIndex}. <b>${agentName}</b> || ${formattedOriginal} || ${formattedNew} || Farq: ${difference > 0 ? '+' : '-'}${formattedDiff}`] 
                });
            } else {
                // Client yoki oddiy: ID - Nomi || Menejer summa || Operator/Kassir summa || Farq
                // Formatlash: faqat bo'shliqlar bilan (vergul bo'lmasligi uchun)
                const formattedOriginal = originalSumma.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                const formattedNew = newSumma.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                const formattedDiff = Math.abs(difference).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                nodes.push({ 
                    tag: 'p', 
                    children: [`${currentIndex}. ${diff.id || 'N/A'} - ${diff.name || 'N/A'} || ${formattedOriginal} || ${formattedNew} || Farq: ${difference > 0 ? '+' : '-'}${formattedDiff}`] 
                });
            }
        });
        
        // 2. Keyin yangilar (new)
        const remainingRows = MAX_ROWS - limitedChanged.length;
        const limitedNew = newDiffs.slice(0, remainingRows);
        limitedNew.forEach((diff) => {
            currentIndex++;
            const summa = Math.abs(diff.summa || 0);
            
            // Agent bo'yicha: Agent nomi || Summa
            if (input_type === 'agent') {
                const agentName = diff.agent_name || diff.agent || 'Noma\'lum agent';
                // Formatlash: faqat bo'shliqlar bilan (vergul bo'lmasligi uchun)
                const formattedSumma = summa.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                nodes.push({ 
                    tag: 'p', 
                    children: [`${currentIndex}. ➕ <b>${agentName}</b> || ${formattedSumma}`] 
                });
            } else {
                // Client yoki oddiy: ID - Nomi || Summa
                // Formatlash: faqat bo'shliqlar bilan (vergul bo'lmasligi uchun)
                const formattedSumma = summa.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                nodes.push({ 
                    tag: 'p', 
                    children: [`${currentIndex}. ➕ ${diff.id || 'N/A'} - ${diff.name || 'N/A'} || ${formattedSumma}`] 
                });
            }
        });
        
        // Agar ma'lumotlar cheklangan bo'lsa, xabar qo'shish
        const totalShown = limitedChanged.length + limitedNew.length;
        const totalFiltered = changedDiffs.length + newDiffs.length;
        if (totalFiltered > totalShown) {
            nodes.push({ tag: 'br' });
            nodes.push({ tag: 'p', children: [`... va yana ${totalFiltered - totalShown} ta farq`] });
        }
    } else {
        nodes.push({ tag: 'p', children: ['Farqlar topilmadi.'] });
    }
    
    return nodes;
}

/**
 * Farqlar uchun Telegraph sahifa yaratish
 * @param {Object} data - Farqlar ma'lumotlari
 * @returns {Promise<string|null>} - Telegraph sahifa URL'i yoki null
 */
async function createDifferencesPage(data) {
    try {
        const title = `Farqlar - ${data.request_uid || 'N/A'}`;
        log.debug(`[TELEGRAPH] Farqlar sahifasini yaratish boshlanmoqda: requestUID=${data.request_uid}, differencesCount=${data.differences?.length || 0}`);
        
        // Telegraph Node array formatiga o'tkazish
        const telegraphContent = formatDifferencesToTelegraphNodes(data);
        
        const pageUrl = await createTelegraphPage({
            title: title,
            content: telegraphContent,
            author_name: 'Debt Approval System'
        });
        
        if (pageUrl) {
            log.debug(`[TELEGRAPH] ✅ Farqlar sahifasi muvaffaqiyatli yaratildi: requestUID=${data.request_uid}, URL=${pageUrl}`);
        }
        
        return pageUrl;
    } catch (error) {
        log.error(`[TELEGRAPH] Farqlar sahifasini yaratishda xatolik: ${error.message}`);
        return null;
    }
}

/**
 * Qarzdorlik ma'lumotlarini Telegraph sahifasiga yuborish
 * @param {Object} data - Qarzdorlik ma'lumotlari
 * @param {number} data.request_id - So'rov ID (ixtiyoriy, mavjud URL'ni tekshirish uchun)
 * @param {string} data.request_uid - So'rov UID
 * @returns {Promise<string|null>} - Telegraph sahifa URL'i yoki null
 */
async function createDebtDataPage(data) {
    try {
        const { request_id, request_uid, isForCashier = false, logContext } = data;
        const sahifaFormati = isForCashier ? 'agent_boyicha' : 'klient_boyicha';
        
        // [REJA_2] Kassir uchun agent bo'yicha sahifa – batafsil log
        if (isForCashier || logContext === 'cashier_reversed_link1_agent') {
            log.info(`[TELEGRAPH] [REJA_2] createDebtDataPage: kassir uchun agent bo'yicha sahifa. request_uid=${request_uid || 'n/a'}, request_id=${request_id ?? 'n/a'}, sahifa_formati=${sahifaFormati}, logContext=${logContext || 'n/a'}`);
        }
        
        const title = `Muddat uzaytirilishi kerak bo'lgan klientlar - ${request_uid || 'N/A'}`;
        
        // Telegraph Node array formatiga o'tkazish
        const telegraphContent = formatDebtDataToTelegraphNodes(data);
        
        const pageUrl = await createTelegraphPage({
            title: title,
            content: telegraphContent,
            author_name: 'Debt Approval System'
        });
        
        // Batafsil log: link qanday ro'yxat (agent/klient) va kim uchun yaratilgani
        log.debug(`[LINK_SAHIFA] createDebtDataPage: kim_uchun=${logContext || 'nomalum'}, request_uid=${request_uid || 'n/a'}, request_id=${request_id ?? 'n/a'}, sahifa_formati=${sahifaFormati}, url=${pageUrl ? pageUrl.substring(0, 55) + '...' : 'null'}`);
        if (isForCashier && pageUrl) {
            log.info(`[TELEGRAPH] [REJA_2] Agent bo'yicha sahifa yaratildi (kassir Link 1). request_uid=${request_uid || 'n/a'}, url_mavjud=true`);
        }
        
        // Kassir uchun agent sahifasi – DB ga yozilmasin (boshqalar klient bo'yicha URL ishlatadi)
        const skipDbUpdate = logContext === 'cashier_reversed_link1_agent';
        if (pageUrl && request_id && !skipDbUpdate) {
            // ✅ MUHIM: Yangi yaratilgan URL'ni database'ga saqlash
            try {
                const db = require('../db.js').db;
                await db('debt_requests')
                    .where('id', request_id)
                    .update({ telegraph_url: pageUrl });
            } catch (dbError) {
                // Database xatoliklarini silent qilamiz (ixtiyoriy)
                log.debug(`[TELEGRAPH] Database'ga URL saqlashda xatolik (ignored): ${dbError.message}`);
            }
        } else if (skipDbUpdate && pageUrl) {
            log.debug(`[TELEGRAPH] [REJA_2] Kassir agent sahifasi DB ga yozilmadi (faqat kassir xabarida ishlatiladi). request_id=${request_id}`);
        }
        // Agar sahifa yaratilmagan bo'lsa, log qilmaymiz (ixtiyoriy xizmat)
        
        return pageUrl;
    } catch (error) {
        // Xatoliklarni silent qilamiz (ixtiyoriy xizmat)
        log.debug(`[TELEGRAPH] Qarzdorlik sahifasini yaratishda xatolik (ixtiyoriy xizmat): requestUID=${data.request_uid}`);
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
    createDifferencesPage,
    formatDebtDataToHTML,
    formatDebtDataToTelegraphNodes,
    formatDifferencesToTelegraphNodes
};

