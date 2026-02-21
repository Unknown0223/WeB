// utils/specialRequestsExcel.js
// Maxsus so'rovlar uchun Excel ustun aniqlash va filtrlash (Консигнация=Да, Тип=Заказ)

const { createLogger } = require('./logger.js');
const log = createLogger('SPECIAL_REQUESTS_EXCEL');

/** Kerakli ustun nomlari (Cyrillic). Excel birinchi qatorida bo'lishi kerak. */
const REQUIRED_COLUMNS = [
    '№',
    'Тип',
    'Статус',
    'Клиент',
    'Ид клиента',
    'Сумма',
    'Склад',
    'Агент',
    'Код агента',
    'Экспедиторы',
    'Территория',
    'Консигнация',
    'Направление торговли'
];

/** Ba'zi ustunlar Excel da boshqa nomda bo'lishi mumkin: asosiy nom -> [muqobil nomlar] */
const COLUMN_ALIASES = {
    '№': ['заказ', 'id заказа', 'id', 'n ', 'no', 'номер', 'zakaz', 'order']
};

/**
 * Ustun nomini normalizatsiya (bo'shliq, register)
 * @param {string} h
 * @returns {string}
 */
function normalizeHeader(h) {
    if (h == null) return '';
    return String(h).trim().toLowerCase();
}

/**
 * Maxsus so'rov uchun ustunlarni aniqlash
 * @param {Array<string>} headers - Birinchi qator (ustun nomlari)
 * @returns {{ [key: string]: number } | null} columnKey -> index, yoki null agar barcha keraklilar topilmasa
 */
function detectSpecialRequestColumns(headers) {
    if (!headers || !Array.isArray(headers)) return null;
    const normalized = headers.map(h => normalizeHeader(h));
    const result = {};

    for (let i = 0; i < REQUIRED_COLUMNS.length; i++) {
        const colName = REQUIRED_COLUMNS[i];
        const need = normalizeHeader(colName);
        let idx = normalized.findIndex(n => n === need || (n && n.includes(need)) || (need && n && need.includes(n)));
        if (idx === -1 && COLUMN_ALIASES[colName]) {
            for (const alt of COLUMN_ALIASES[colName]) {
                idx = normalized.findIndex(n => n === alt || (n && n.includes(alt)) || (alt && n && n.includes(alt)));
                if (idx !== -1) break;
            }
        }
        if (idx === -1) {
            log.debug(`[SPECIAL_REQUESTS_EXCEL] Ustun topilmadi: "${colName}"`);
            return null;
        }
        result[colName] = idx;
    }
    return result;
}

/**
 * Kerakli ustunlar bormi va qaysi biri yo'q
 * @param {Array<string>} headers
 * @returns {{ ok: boolean, missing: string[] }}
 */
function validateSpecialRequestColumns(headers) {
    if (!headers || !Array.isArray(headers)) {
        return { ok: false, missing: [...REQUIRED_COLUMNS] };
    }
    const normalized = headers.map(h => normalizeHeader(h));
    const missing = [];
    const requiredLower = REQUIRED_COLUMNS.map(c => normalizeHeader(c));

    for (let i = 0; i < requiredLower.length; i++) {
        const colName = REQUIRED_COLUMNS[i];
        const need = requiredLower[i];
        let found = normalized.some(n => n === need || (n && n.includes(need)) || (need && n && need.includes(n)));
        if (!found && COLUMN_ALIASES[colName]) {
            found = COLUMN_ALIASES[colName].some(alt =>
                normalized.some(n => n === alt || (n && n.includes(alt)) || (alt && n && n.includes(alt)))
            );
        }
        if (!found) missing.push(colName);
    }
    return { ok: missing.length === 0, missing };
}

/**
 * Birinchi qator obyektidan "header nomi -> fayldagi haqiqiy kalit" xaritasini yasash.
 * sheet_to_json kalitlari bizning headers bilan belgi/bo'shliq jihatidan farq qilishi mumkin.
 * @param {Object} firstRow - sheet_to_json ning birinchi qator obyekti
 * @param {Array<string>} headers - bizning ustun nomlar ro'yxati (sarlavha qatoridan)
 * @returns {{ [headerName: string]: string }} headerName -> row dagi haqiqiy kalit
 */
function buildRowKeyMap(firstRow, headers) {
    const map = {};
    if (!firstRow || !headers) return map;
    const rowKeys = Object.keys(firstRow);
    for (const headerName of headers) {
        if (headerName == null || headerName === '') continue;
        const need = String(headerName).trim().toLowerCase();
        const found = rowKeys.find(k => String(k).trim().toLowerCase() === need);
        if (found !== undefined) map[headerName] = found;
        else map[headerName] = headerName;
    }
    return map;
}

/**
 * Bir qatordagi qiymatni ustun nomi orqali olish.
 * header: 1 bo'lganda qator massiv (row[colIndex]), aks holda obyekt (rowKeyMap orqali).
 */
function getCell(row, headers, colIndex, rowKeyMap) {
    if (colIndex == null || colIndex < 0) return '';
    // sheet_to_json(..., { header: 1 }) qatorlarni massiv qilib qaytaradi – indeks orqali olamiz
    if (Array.isArray(row)) {
        const v = row[colIndex];
        if (v == null || v === '') return '';
        if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
        return String(v).trim();
    }
    const headerName = headers[colIndex];
    if (headerName == null) return '';
    const actualKey = rowKeyMap && rowKeyMap[headerName] !== undefined ? rowKeyMap[headerName] : headerName;
    let v = row[actualKey];
    if (v == null && typeof row === 'object') {
        const need = String(headerName).trim().toLowerCase();
        for (const key of Object.keys(row)) {
            if (String(key).trim().toLowerCase() === need) {
                v = row[key];
                break;
            }
        }
    }
    if (v == null) return '';
    return String(v).trim();
}

/**
 * Qiymatni filtrlash uchun normallashtirish (trim + kichik harf)
 */
function normalizeFilterValue(val) {
    return String(val == null ? '' : val).trim().toLowerCase();
}

/** Консигнация ustunidagi qiymat "Да" hisoblanadimi (qabul qilinadigan variantlar) */
const KONSIGNATSIYA_YES = ['да', 'yes', '1', 'true', '+', 'д', 'ha', 'ja'];
/** Тип ustunidagi qiymat "Заказ" hisoblanadimi */
const TIP_ZAKAZ = ['заказ', 'order', 'zakaz'];

function matchesConsignatsiyaYes(normalized) {
    if (!normalized) return false;
    return KONSIGNATSIYA_YES.some(v => v === normalized || normalized.includes(v));
}

function matchesTipZakaz(normalized) {
    if (!normalized) return false;
    return TIP_ZAKAZ.some(v => v === normalized || normalized.includes(v));
}

/**
 * Сумма qiymatini raqamga aylantirish (bo'shliq, vergul/nuqta formatlari)
 * Qo'llab-quvvatlanadi: "10 000 000", "10,5", "10.5", "10.000.000" (nuqta ming ajratgich)
 */
function parseSummaValue(val) {
    if (val == null || val === '') return NaN;
    let s = String(val).replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        s = s.replace(/,/g, '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Filtrlash: Консигнация = "Да", Тип = "Заказ", ixtiyoriy Сумма sharti (teng / >= / <=)
 * Ustunlar faqat NOMI bo'yicha aniqlanadi (tartib o'zgarsa ham ishlaydi).
 * @param {Object} [sumFilter] - { type: 'eq'|'gte'|'lte', value: number }, bo'lmasa summa filtri qo'llanmaydi
 */
function filterSpecialRequestRows(data, columns, headers, rowKeyMap, sumFilter) {
    if (!data || !columns || !headers) return [];
    const filtered = [];
    const hasSumFilter = sumFilter && (sumFilter.type === 'eq' || sumFilter.type === 'gte' || sumFilter.type === 'lte') && Number.isFinite(sumFilter.value);
    const sampleRows = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rawKons = getCell(row, headers, columns['Консигнация'], rowKeyMap);
        const rawTip = getCell(row, headers, columns['Тип'], rowKeyMap);
        const konsignatsiya = normalizeFilterValue(rawKons);
        const tip = normalizeFilterValue(rawTip);
        if (i <= 5) {
            log.debug(`[SPECIAL_REQUESTS_EXCEL] Qator ${i}: Консигнация(raw)=${JSON.stringify(rawKons)} → norm="${konsignatsiya}", Тип(raw)=${JSON.stringify(rawTip)} → norm="${tip}"`);
        }
        if (!matchesConsignatsiyaYes(konsignatsiya)) continue;
        if (!matchesTipZakaz(tip)) continue;
        if (hasSumFilter) {
            const rawSum = getCell(row, headers, columns['Сумма'], rowKeyMap);
            const sumNum = parseSummaValue(rawSum);
            if (sumFilter.type === 'eq' && sumNum !== sumFilter.value) continue;
            if (sumFilter.type === 'gte' && !(sumNum >= sumFilter.value)) continue;
            if (sumFilter.type === 'lte' && !(sumNum <= sumFilter.value)) continue;
        }
        filtered.push(row);
    }
    const sumInfo = hasSumFilter ? `, Сумма ${sumFilter.type === 'eq' ? '=' : sumFilter.type === 'gte' ? '>=' : '<='} ${sumFilter.value}` : '';
    log.info(`[SPECIAL_REQUESTS_EXCEL] Filtr natija: jami ${Math.max(0, data.length - 1)} ma'lumot qatori, shartga mos ${filtered.length} ta (Консигнация=Да, Тип=Заказ${sumInfo})`);
    if (filtered.length === 0 && data.length > 1) {
        const sampleRows = [];
        for (let i = 1; i <= Math.min(5, data.length - 1); i++) {
            const row = data[i];
            const rawKons = getCell(row, headers, columns['Консигнация'], rowKeyMap);
            const rawTip = getCell(row, headers, columns['Тип'], rowKeyMap);
            const rawSum = getCell(row, headers, columns['Сумма'], rowKeyMap);
            const normKons = normalizeFilterValue(rawKons);
            const normTip = normalizeFilterValue(rawTip);
            const sumNum = parseSummaValue(rawSum);
            sampleRows.push({
                qator: i + 1,
                Консигнация: rawKons || '(bo\'sh)',
                normKons,
                okKons: matchesConsignatsiyaYes(normKons),
                Тип: rawTip || '(bo\'sh)',
                normTip,
                okTip: matchesTipZakaz(normTip),
                Сумма: rawSum || '(bo\'sh)',
                sumNum: Number.isFinite(sumNum) ? sumNum : null,
                okSum: !hasSumFilter || (sumFilter.type === 'gte' && sumNum >= sumFilter.value) || (sumFilter.type === 'lte' && sumNum <= sumFilter.value) || (sumFilter.type === 'eq' && sumNum === sumFilter.value)
            });
        }
        log.info(`[SPECIAL_REQUESTS_EXCEL] Shartga mos 0 qator. Birinchi 5 qator tahlili: ${JSON.stringify(sampleRows, null, 0)}`);
    }
    return filtered;
}

/**
 * Excel buffer/sheet dan ma'lumotlarni o'qish va filtrlash.
 * Sarlavha qatori 1, 2 yoki 3-qator bo'lishi mumkin (ustunlar NOMI bo'yicha aniqlanadi).
 */
function parseSpecialRequestWorkbook(workbook, sumFilter) {
    const xlsx = require('xlsx');
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        return { ok: false, missing: REQUIRED_COLUMNS };
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rawData || rawData.length < 2) {
        return { ok: false, missing: REQUIRED_COLUMNS };
    }
    let headerRowIndex = -1;
    let headers = [];
    let columns = null;
    for (let r = 0; r < Math.min(5, rawData.length); r++) {
        const candidateHeaders = (rawData[r] || []).map(c => c != null ? String(c).trim() : '');
        const validation = validateSpecialRequestColumns(candidateHeaders);
        if (validation.ok) {
            const cols = detectSpecialRequestColumns(candidateHeaders);
            if (cols) {
                headerRowIndex = r;
                headers = candidateHeaders;
                columns = cols;
                if (r > 0) log.info(`[SPECIAL_REQUESTS_EXCEL] Sarlavha qatori ${r + 1}-qator sifatida aniqlandi (ustunlar nomi bo'yicha).`);
                break;
            }
        }
    }
    if (headerRowIndex < 0 || !columns) {
        const firstRowHeaders = (rawData[0] || []).map(c => c != null ? String(c).trim() : '');
        const validation = validateSpecialRequestColumns(firstRowHeaders);
        log.warn(`[SPECIAL_REQUESTS_EXCEL] Kerakli ustunlar topilmadi. Yetishmayotgan: ${(validation.missing || []).join(', ')}. Birinchi qator sarlavhalar: ${JSON.stringify(firstRowHeaders)}`);
        return { ok: false, missing: validation.missing || REQUIRED_COLUMNS };
    }
    const data = [headers].concat(rawData.slice(headerRowIndex + 1));
    const rowKeyMap = data.length > 0 ? buildRowKeyMap(data[0], headers) : {};
    const idxKons = columns['Консигнация'];
    const idxTip = columns['Тип'];
    const idxSum = columns['Сумма'];
    log.info(`[SPECIAL_REQUESTS_EXCEL] Sarlavha qatori: ${headerRowIndex + 1}-qator. Ustun indekslari: Консигнация=${idxKons}, Тип=${idxTip}, Сумма=${idxSum}. Sarlavhalar (indeks→nomi): ${headers.map((h, i) => (h ? `${i}:${h}` : '')).filter(Boolean).slice(0, 20).join(', ')}${headers.length > 20 ? '...' : ''}`);
    if (data.length > 1) {
        const samples = [];
        for (let i = 1; i <= Math.min(3, data.length - 1); i++) {
            const row = data[i];
            const rawKons = getCell(row, headers, idxKons, rowKeyMap);
            const rawTip = getCell(row, headers, idxTip, rowKeyMap);
            const rawSum = getCell(row, headers, idxSum, rowKeyMap);
            samples.push({ qator: i + 1, Консигнация: rawKons, Тип: rawTip, Сумма: rawSum });
        }
        log.info(`[SPECIAL_REQUESTS_EXCEL] Birinchi 3 ma'lumot qatorida o'qilgan qiymatlar: ${JSON.stringify(samples)}`);
    }
    const filteredRows = filterSpecialRequestRows(data, columns, headers, rowKeyMap, sumFilter);
    const totalDataRows = Math.max(0, data.length - 1);
    log.info(`[SPECIAL_REQUESTS_EXCEL] Parse: jami ma'lumot qatorlari=${totalDataRows}, filtrlangan=${filteredRows.length}`);
    return { ok: true, columns, headers, filteredRows, rowKeyMap, totalDataRows };
}

/**
 * Buffer dan maxsus so'rov Excel ni parse qilish (bot fayl yuklaganda)
 * @param {Buffer} buffer
 * @param {{ type: 'eq'|'gte'|'lte', value: number }} [sumFilter] - Сумма bo'yicha shart (ixtiyoriy)
 */
function parseSpecialRequestFromBuffer(buffer, sumFilter) {
    const xlsx = require('xlsx');
    let workbook;
    try {
        workbook = xlsx.read(buffer, { type: 'buffer' });
    } catch (e) {
        log.error('[SPECIAL_REQUESTS_EXCEL] Excel o\'qishda xatolik:', e);
        return { ok: false, missing: REQUIRED_COLUMNS };
    }
    return parseSpecialRequestWorkbook(workbook, sumFilter);
}

module.exports = {
    REQUIRED_COLUMNS,
    detectSpecialRequestColumns,
    validateSpecialRequestColumns,
    filterSpecialRequestRows,
    parseSpecialRequestWorkbook,
    parseSpecialRequestFromBuffer,
    getCell
};
