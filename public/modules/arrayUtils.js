/**
 * Frontend Array Utilities
 * Dublikat kodlarni optimallashtirish uchun utility funksiyalar
 */

import { createLogger } from './utils.js';

const logger = createLogger('ARRAY_UTILS');

/**
 * Array'dan dublikatlarni olib tashlash (ID bo'yicha)
 * @param {Array} array - Dublikatlar bo'lishi mumkin bo'lgan array
 * @param {string} keyField - Unique key field nomi (default: 'id')
 * @param {Object} options - Qo'shimcha sozlamalar
 * @param {boolean} options.warnOnDuplicate - Dublikat topilganda warning log qilish
 * @param {string} options.context - Log context (qaysi funksiya chaqirgan)
 * @param {Function} options.sortFn - Sort funksiyasi (optional)
 * @returns {Array} - Unique array
 */
export function removeDuplicatesById(array, keyField = 'id', options = {}) {
    const {
        warnOnDuplicate = false,
        context = '',
        sortFn = null
    } = options;
    
    if (!Array.isArray(array) || array.length === 0) {
        return array;
    }
    
    const uniqueMap = new Map();
    const duplicateIds = [];
    
    array.forEach(item => {
        const key = item[keyField];
        
        if (key === undefined || key === null) {
            // Key yo'q bo'lsa, o'tkazib yuborish
            return;
        }
        
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, item);
        } else {
            duplicateIds.push(key);
            if (warnOnDuplicate) {
                const itemName = item.name || item[keyField] || 'N/A';
                logger.warn(`[${context}] Dublikat topildi: ${keyField}=${key}, Name=${itemName}`);
            }
        }
    });
    
    let result = Array.from(uniqueMap.values());
    
    // Sort qilish (agar berilgan bo'lsa)
    if (sortFn && typeof sortFn === 'function') {
        result = result.sort(sortFn);
    } else if (result[0] && result[0].name) {
        // Default: name bo'yicha sort
        result = result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    
    // Dublikatlar haqida ma'lumot
    if (duplicateIds.length > 0 && warnOnDuplicate) {
        const uniqueIds = [...new Set(duplicateIds)];
        logger.warn(`[${context}] Dublikatlar: Original=${array.length}, Unique=${result.length}, Dublikatlar=${duplicateIds.length}, Unique IDs=${uniqueIds.join(', ')}`);
    }
    
    return result;
}

/**
 * Array'dan dublikatlarni olib tashlash (bir nechta field bo'yicha)
 * @param {Array} array - Dublikatlar bo'lishi mumkin bo'lgan array
 * @param {string[]} keyFields - Unique key field nomlari
 * @param {Object} options - Qo'shimcha sozlamalar
 * @returns {Array} - Unique array
 */
export function removeDuplicatesByKeys(array, keyFields = [], options = {}) {
    const {
        warnOnDuplicate = false,
        context = '',
        sortFn = null
    } = options;
    
    if (!Array.isArray(array) || array.length === 0 || keyFields.length === 0) {
        return array;
    }
    
    const uniqueMap = new Map();
    const duplicateKeys = [];
    
    array.forEach(item => {
        // Composite key yaratish
        const compositeKey = keyFields.map(field => item[field]).join('|');
        
        if (!uniqueMap.has(compositeKey)) {
            uniqueMap.set(compositeKey, item);
        } else {
            duplicateKeys.push(compositeKey);
            if (warnOnDuplicate) {
                const keyValues = keyFields.map(f => `${f}=${item[f]}`).join(', ');
                logger.warn(`[${context}] Dublikat topildi: ${keyValues}`);
            }
        }
    });
    
    let result = Array.from(uniqueMap.values());
    
    // Sort qilish (agar berilgan bo'lsa)
    if (sortFn && typeof sortFn === 'function') {
        result = result.sort(sortFn);
    }
    
    // Dublikatlar haqida ma'lumot
    if (duplicateKeys.length > 0 && warnOnDuplicate) {
        logger.warn(`[${context}] Dublikatlar: Original=${array.length}, Unique=${result.length}, Dublikatlar=${duplicateKeys.length}`);
    }
    
    return result;
}

/**
 * Array'ni guruhlash (group by)
 * @param {Array} array - Guruhlash kerak bo'lgan array
 * @param {string} keyField - Group by field nomi
 * @returns {Object} - Guruhlangan object (key -> array)
 */
export function groupBy(array, keyField) {
    if (!Array.isArray(array) || array.length === 0) {
        return {};
    }
    
    const grouped = {};
    
    array.forEach(item => {
        const key = item[keyField];
        if (key !== undefined && key !== null) {
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(item);
        }
    });
    
    return grouped;
}

/**
 * Array'ni filter qilish va unique qilish (bir vaqtning o'zida)
 * @param {Array} array - Filter qilish kerak bo'lgan array
 * @param {Function} filterFn - Filter funksiyasi
 * @param {string} keyField - Unique key field nomi
 * @returns {Array} - Filtered va unique array
 */
export function filterAndUnique(array, filterFn, keyField = 'id') {
    if (!Array.isArray(array) || array.length === 0) {
        return array;
    }
    
    const filtered = filterFn ? array.filter(filterFn) : array;
    return removeDuplicatesById(filtered, keyField);
}

