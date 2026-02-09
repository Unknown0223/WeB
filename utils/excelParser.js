// utils/excelParser.js
// Excel fayllarni o'qish va tahlil qilish uchun yordamchi funksiyalar

const { createLogger } = require('./logger.js');
const log = createLogger('EXCEL_PARSER');

/**
 * Qisman moslik tekshiruvi (fuzzy matching)
 * SVR nomlarida qavslar va qo'shimcha ma'lumotlar bo'lishi mumkin
 * Masalan: "Axmadjonov Mashxurbek (JSAN 2)" va "Axmadjonov Mashxurbek" mos keladi
 * @param {String} text1 - Birinchi matn (Excel fayldan)
 * @param {String} text2 - Ikkinchi matn (So'rovdan)
 * @returns {Boolean} Mos keladi yoki yo'q
 */
function checkPartialMatch(text1, text2) {
    if (!text1 || !text2) return false;
    
    const t1 = text1.toLowerCase().trim();
    const t2 = text2.toLowerCase().trim();
    
    // To'liq moslik
    if (t1 === t2) {
        return true;
    }
    
    // Bir matn ikkinchisini o'z ichiga oladi
    if (t1.includes(t2) || t2.includes(t1)) {
        return true;
    }
    
    // Qavslar va qo'shimcha ma'lumotlarni olib tashlash
    const clean1 = t1.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const clean2 = t2.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    
    // Tozalangan matnlar mos keladi
    if (clean1 === clean2) {
        return true;
    }
    
    // Tozalangan matnlardan biri ikkinchisini o'z ichiga oladi
    if (clean1.includes(clean2) || clean2.includes(clean1)) {
        return true;
    }
    
    // So'zlarni ajratib, asosiy so'zlarni solishtirish
    const words1 = clean1.split(/\s+/).filter(w => w.length > 2);
    const words2 = clean2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) {
        return false;
    }
    
    // Agar asosiy so'zlarning 70% mos kelsa, qabul qilish
    const matchingWords = words1.filter(w1 => words2.some(w2 => w1 === w2 || w1.includes(w2) || w2.includes(w1)));
    const matchRatio = matchingWords.length / Math.max(words1.length, words2.length);
    
    if (matchRatio >= 0.7) {
        log.debug(`[FUZZY] Qisman moslik: "${text1}" va "${text2}" (${(matchRatio * 100).toFixed(0)}%)`);
        return true;
    }
    
    return false;
}

/**
 * Ustun nomlarini avtomatik aniqlash
 * @param {Array} headers - Excel fayldagi ustun nomlari ro'yxati
 * @returns {Object} Aniqlangan ustunlar {id, name, summa, svr, brand}
 */
function detectColumns(headers) {
    const detected = {
        id: null,
        name: null,
        summa: null,
        svr: null,
        brand: null,
        agent: null, // ✅ Qo'shilgan: Агент ustuni
        agent_code: null // ✅ Qo'shilgan: Код агента ustuni
    };
    
    // ID ustuni variantlari
    const idVariants = [
        'ид клиента', 'id клиента', 'client id', 'id', 'id_klienta',
        'client_id', 'clientid', 'клиент id', 'клиент_id'
    ];
    
    // Name ustuni variantlari
    const nameVariants = [
        'клиент', 'client', 'name', 'klient', 'клиент name',
        'client name', 'clientname', 'mijoz', 'mijoz nomi'
    ];
    
    // Summa ustuni variantlari
    const summaVariants = [
        'общий', 'total', 'summa', 'dolg_sum', 'amount', 'сумма',
        'sum', 'jami', 'jami summa', 'общая сумма', 'qarz', 'qarz summa'
    ];
    
    // SVR ustuni variantlari
    const svrVariants = [
        'супервайзер', 'supervisor', 'svr', 'supervayzer', 'supervisor name',
        'svr name', 'supervayzer nomi', 'supervisor nomi'
    ];
    
    // Brend ustuni variantlari
    const brandVariants = [
        'направление торговли', 'trade direction', 'brend', 'brand',
        'brand name', 'brend nomi', 'brand nomi', 'направление',
        'trade_direction', 'tradedirection'
    ];
    
    // ✅ Агент ustuni variantlari
    const agentVariants = [
        'агент', 'agent', 'agent name', 'agent_name', 'agentname',
        'агент name', 'агент_name', 'agent nomi'
    ];
    
    // ✅ Код агента ustuni variantlari
    const agentCodeVariants = [
        'код агента', 'agent code', 'agent_code', 'agentcode',
        'код_агента', 'agent id', 'agent_id', 'agentid',
        'код агента', 'agent kod', 'agent_kod'
    ];
    
    // Har bir ustunni tekshirish
    headers.forEach((header, index) => {
        if (!header) return;
        
        const headerLower = String(header).toLowerCase().trim();
        
        // ID ustuni
        if (!detected.id && idVariants.some(variant => headerLower.includes(variant))) {
            detected.id = index;
            log.debug(`[DETECT] ID ustuni topildi: "${header}" (index: ${index})`);
        }
        
        // Name ustuni
        if (!detected.name && nameVariants.some(variant => headerLower.includes(variant))) {
            detected.name = index;
            log.debug(`[DETECT] Name ustuni topildi: "${header}" (index: ${index})`);
        }
        
        // Summa ustuni
        if (!detected.summa && summaVariants.some(variant => headerLower.includes(variant))) {
            detected.summa = index;
            log.debug(`[DETECT] Summa ustuni topildi: "${header}" (index: ${index})`);
        }
        
        // SVR ustuni
        if (!detected.svr && svrVariants.some(variant => headerLower.includes(variant))) {
            detected.svr = index;
            log.debug(`[DETECT] SVR ustuni topildi: "${header}" (index: ${index})`);
        }
        
        // Brend ustuni
        if (!detected.brand && brandVariants.some(variant => headerLower.includes(variant))) {
            detected.brand = index;
            log.debug(`[DETECT] Brend ustuni topildi: "${header}" (index: ${index})`);
        }
        
        // ✅ Агент ustuni
        if (!detected.agent && agentVariants.some(variant => headerLower.includes(variant))) {
            detected.agent = index;
            log.debug(`[DETECT] Агент ustuni topildi: "${header}" (index: ${index})`);
        }
        
        // ✅ Код агента ustuni
        if (!detected.agent_code && agentCodeVariants.some(variant => headerLower.includes(variant))) {
            detected.agent_code = index;
            log.debug(`[DETECT] Код агента ustuni topildi: "${header}" (index: ${index})`);
        }
    });
    
    log.debug(`[DETECT] Ustunlar aniqlandi:`, detected);
    return detected;
}

/**
 * Qatorlarni moslik bo'yicha filtrlash
 * @param {Array} data - Excel ma'lumotlari (qatorlar ro'yxati)
 * @param {Object} columns - Tanlangan ustunlar {id, name, summa, svr, brand}
 * @param {Object} requestData - So'rov ma'lumotlari {svr_name, brand_name}
 * @returns {Object} {filtered: Array, stats: Object} - Filtrlangan qatorlar va statistika
 */
function validateAndFilterRows(data, columns, requestData, headers = []) {
    if (!data || data.length === 0) {
        log.warn('[VALIDATE] Ma\'lumotlar bo\'sh');
        return { filtered: [], stats: { total: 0, svrMatches: 0, brandMatches: 0, svrMismatches: [], brandMismatches: [] } };
    }
    
    const filtered = [];
    let svrMatchCount = 0;
    let brandMatchCount = 0;
    const svrMismatches = new Set(); // Unique SVR nomlari
    const brandMismatches = new Set(); // Unique Brend nomlari
    
    data.forEach((row, index) => {
        let shouldInclude = true;
        
        // SVR mosligini tekshirish (agar ustun mavjud bo'lsa)
        if (columns.svr !== null && requestData.svr_name) {
            // Headers ro'yxatidan ustun nomini olish
            // columns.svr - bu index, headers[columns.svr] - bu header nomi
            const svrHeaderName = headers[columns.svr];
            const rowSvr = row[svrHeaderName] !== undefined && row[svrHeaderName] !== null 
                ? String(row[svrHeaderName]).trim() 
                : '';
            const requestSvr = String(requestData.svr_name).trim();
            
            // Birinchi mos kelgan va mos kelmagan holatlarni log qilish
            if (svrMatchCount === 0 && svrMismatches.size === 0 && index < 5) {
                log.debug(`[VALIDATE] SVR solishtirish: Excel="${rowSvr}" vs DB="${requestSvr}"`);
            }
            
            // Agar qator bo'sh bo'lsa, o'tkazib yuborish
            if (!rowSvr) {
                shouldInclude = false;
                // Bo'sh qatorlarni log qilmaslik (juda ko'p bo'lishi mumkin)
            } else {
                // Qisman moslik tekshiruvi (fuzzy matching)
                const isMatch = checkPartialMatch(rowSvr, requestSvr);
                
                if (!isMatch) {
                    shouldInclude = false;
                    svrMismatches.add(rowSvr);
                    // Keraksiz loglarni olib tashlash
                } else {
                    svrMatchCount++;
                    if (svrMatchCount === 1) {
                        log.debug(`[VALIDATE] ✅ Birinchi SVR mos kelgan: Excel="${rowSvr}" = DB="${requestSvr}"`);
                    }
                    // Keraksiz loglarni olib tashlash
                }
            }
        }
        
        // Brend mosligini tekshirish (agar ustun mavjud bo'lsa)
        if (shouldInclude && columns.brand !== null && requestData.brand_name) {
            // Headers ro'yxatidan ustun nomini olish
            const brandHeaderName = headers[columns.brand];
            const rowBrand = row[brandHeaderName] !== undefined && row[brandHeaderName] !== null 
                ? String(row[brandHeaderName]).trim() 
                : '';
            const requestBrand = String(requestData.brand_name).trim();
            
            // Agar qator bo'sh bo'lsa, o'tkazib yuborish
            if (!rowBrand) {
                shouldInclude = false;
                // Bo'sh qatorlarni log qilmaslik
            } else {
                // Qisman moslik tekshiruvi (fuzzy matching)
                const isMatch = checkPartialMatch(rowBrand, requestBrand);
                
                if (!isMatch) {
                    shouldInclude = false;
                    brandMismatches.add(rowBrand);
                    // Keraksiz loglarni olib tashlash
                } else {
                    brandMatchCount++;
                    // Keraksiz loglarni olib tashlash
                }
            }
        }
        
        if (shouldInclude) {
            filtered.push(row);
        }
    });
    
    const stats = {
        total: data.length,
        filtered: filtered.length,
        svrMatches: svrMatchCount,
        brandMatches: brandMatchCount,
        svrMismatches: Array.from(svrMismatches),
        brandMismatches: Array.from(brandMismatches)
    };
    
    log.debug(`[VALIDATE] Filtrlash natijasi: ${filtered.length}/${data.length} qator mos keldi`);
    if (columns.svr !== null && requestData.svr_name) {
        log.debug(`[VALIDATE] SVR mosligi: ${svrMatchCount} ta, mos kelmaganlar: ${stats.svrMismatches.length} ta`);
        log.debug(`[VALIDATE] DB SVR nomi: "${requestData.svr_name}"`);
        if (stats.svrMismatches.length > 0 && stats.svrMismatches.length <= 10) {
            log.debug(`[VALIDATE] Excel'dagi SVR nomlari (misol): ${stats.svrMismatches.slice(0, 5).map(s => `"${s}"`).join(', ')}`);
        }
    }
    if (columns.brand !== null && requestData.brand_name) {
        log.debug(`[VALIDATE] Brend mosligi: ${brandMatchCount} ta, mos kelmaganlar: ${stats.brandMismatches.length} ta`);
        log.debug(`[VALIDATE] DB Brend nomi: "${requestData.brand_name}"`);
    }
    
    return { filtered, stats };
}

/**
 * Excel ma'lumotlarini formatlash
 * @param {Array} rows - Filtrlangan qatorlar
 * @param {Object} columns - Tanlangan ustunlar {id, name, summa}
 * @param {Array} headers - Excel fayldagi ustun nomlari ro'yxati
 * @param {Number} maxRows - Maksimal ko'rsatiladigan qatorlar soni (default: 10)
 * @returns {String} Formatlangan matn
 */
function formatExcelData(rows, columns, headers = [], maxRows = 10) {
    if (!rows || rows.length === 0) {
        return 'Ma\'lumotlar topilmadi.\n';
    }
    
    if (columns.id === null || columns.name === null || columns.summa === null) {
        log.error('[FORMAT] Kerakli ustunlar topilmadi');
        return 'Xatolik: Kerakli ustunlar topilmadi.\n';
    }
    
    // Header nomlarini olish
    const idHeader = headers[columns.id] || '';
    const nameHeader = headers[columns.name] || '';
    const summaHeader = headers[columns.summa] || '';
    
    if (!summaHeader) {
        log.error(`[FORMAT] Summa header topilmadi. columns.summa=${columns.summa}, headers=${JSON.stringify(headers)}`);
        return 'Xatolik: Summa ustuni topilmadi.\n';
    }
    
    let formatted = '';
    let total = 0;
    
    // Barcha qatorlardan jami summani hisoblash
    rows.forEach((row, index) => {
        const summaValue = row[summaHeader];
        const summa = summaValue !== undefined && summaValue !== null 
            ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.')) 
            : 0;
        const validSumma = isNaN(summa) ? 0 : summa;
        total += validSumma;
        
        // Debug loglarni olib tashlash (keraksiz)
    });
    
    // Faqat birinchi maxRows ta qatorni formatlash
    const rowsToShow = rows.slice(0, maxRows);
    const remainingRows = rows.length - maxRows;
    
    rowsToShow.forEach((row) => {
        // Header nomlari orqali qiymatlarni olish
        const id = row[idHeader] !== undefined && row[idHeader] !== null 
            ? String(row[idHeader]).trim() 
            : '';
        const name = row[nameHeader] !== undefined && row[nameHeader] !== null 
            ? String(row[nameHeader]).trim() 
            : '';
        const summaValue = row[summaHeader];
        const summa = summaValue !== undefined && summaValue !== null 
            ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.')) 
            : 0;
        
        if (id && name) {
            formatted += `${id} - ${name} - ${summa.toLocaleString('ru-RU')}\n`;
        }
    });
    
    // Qolgan qatorlar haqida ma'lumot
    if (remainingRows > 0) {
        formatted += `\n... va yana ${remainingRows} ta klient\n`;
    }
    
    formatted += `\nTOTAL: ${Math.abs(total).toLocaleString('ru-RU')}`;
    
    log.debug(`[EXCEL_PARSER] Formatlandi: ${rows.length} ta qator (${rowsToShow.length} ta ko'rsatildi), jami: ${Math.abs(total).toLocaleString('ru-RU')}`);
    return formatted;
}

/**
 * Excel fayldan ma'lumotlarni o'qish va tahlil qilish
 * @param {String} filePath - Excel fayl yo'li
 * @param {Object} requestData - So'rov ma'lumotlari {svr_name, brand_name}
 * @returns {Object} {headers, data, columns, filteredData, formatted}
 */
async function parseExcelFile(filePath, requestData = {}) {
    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('Excel faylda varaqlar topilmadi');
        }
        
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        
        // Birinchi qatorni sarlavha sifatida olish
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const headers = [];
        
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            const cell = sheet[cellAddress];
            headers.push(cell ? String(cell.v).trim() : '');
        }
        
        // Ma'lumotlarni o'qish
        const data = XLSX.utils.sheet_to_json(sheet, { header: headers });
        
        // Ustunlarni aniqlash
        const columns = detectColumns(headers);
        
        // Moslik tekshiruvi va filtrlash
        const validationResult = validateAndFilterRows(data, columns, requestData, headers);
        const filteredData = validationResult.filtered;
        const validationStats = validationResult.stats;
        
        // Formatlash
        const formatted = formatExcelData(filteredData, columns, headers);
        
        // Jami summani hisoblash (header nomlari orqali)
        const summaHeader = headers[columns.summa] || '';
        const total = filteredData.reduce((sum, row) => {
            const summaValue = row[summaHeader];
            const summa = summaValue !== undefined && summaValue !== null 
                ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.')) 
                : 0;
            return sum + (isNaN(summa) ? 0 : summa);
        }, 0);
        
        return {
            headers,
            data,
            columns,
            filteredData,
            formatted,
            validationStats,
            total
        };
        
    } catch (error) {
        log.error('[PARSE] Excel faylni o\'qishda xatolik:', error);
        throw error;
    }
}

/**
 * Excel ma'lumotlaridan jami summani hisoblash
 * @param {Array} rows - Excel qatorlari
 * @param {Object} columns - Tanlangan ustunlar {id, name, summa}
 * @param {Array} headers - Excel fayldagi ustun nomlari ro'yxati
 * @returns {Number} Jami summa
 */
function calculateTotalFromExcel(rows, columns, headers = []) {
    if (!rows || rows.length === 0) {
        return 0;
    }
    
    if (columns.summa === null || columns.summa === undefined) {
        log.warn('[CALCULATE] Summa ustuni topilmadi');
        return 0;
    }
    
    const summaHeader = headers[columns.summa] || '';
    if (!summaHeader) {
        log.warn('[CALCULATE] Summa header nomi topilmadi');
        return 0;
    }
    
    let total = 0;
    rows.forEach((row) => {
        const summaValue = row[summaHeader];
        const summa = summaValue !== undefined && summaValue !== null 
            ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.')) 
            : 0;
        total += isNaN(summa) ? 0 : summa;
    });
    
    log.debug(`[CALCULATE] Jami summa hisoblandi: ${total.toLocaleString('ru-RU')} (${rows.length} ta qator)`);
    return total;
}

module.exports = {
    detectColumns,
    validateAndFilterRows,
    formatExcelData,
    parseExcelFile,
    calculateTotalFromExcel
};

