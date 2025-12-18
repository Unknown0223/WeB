// utils/roleFiltering.js
// Rol shartlari bo'yicha ma'lumotlarni filtrlash funksiyalari

const { db } = require('../db.js');
const { createLogger } = require('./logger.js');
const log = createLogger('ROLE_FILTER');

/**
 * Foydalanuvchi roliga qarab ko'rinadigan filiallarni aniqlash
 * @param {Object} user - Foydalanuvchi ma'lumotlari (session.user)
 * @returns {Promise<string[]>} - Ko'rinadigan filiallar ro'yxati
 */
async function getVisibleLocations(user) {
    // User va role tekshiruvi
    if (!user || !user.role) {
        log.warn('User yoki role topilmadi');
        return [];
    }
    
    // Superadmin barcha filiallarni ko'radi
    if (user.role === 'superadmin' || user.role === 'super_admin') {
        const allLocations = await db('reports')
            .distinct('location')
            .pluck('location');
        return allLocations;
    }
    
    // Foydalanuvchining o'z filiallarini olish (user_locations jadvalidan)
    const userLocations = await db('user_locations')
        .where('user_id', user.id)
        .pluck('location_name');
    
    // Agar foydalanuvchining o'z filiallari bo'lsa, ularni qaytaramiz
    if (userLocations.length > 0) {
        return userLocations;
    }
    
    // Agar foydalanuvchining o'z filiallari bo'lmasa, rol filiallarini tekshiramiz
    // Rol ma'lumotlarini olish
    const roleData = await db('roles').where('role_name', user.role).first();
    if (!roleData) {
        log.warn(`Rol topilmadi: ${user.role}`);
        return []; // Rol topilmasa, hech narsa ko'rinmaydi
    }
    
    // Rol uchun belgilangan filiallar
    const roleLocations = await db('role_locations')
        .where('role_name', user.role)
        .pluck('location_name');
    
    // Rol uchun belgilangan brendlar
    const roleBrands = await db('role_brands')
        .where('role_name', user.role)
        .pluck('brand_id');
    
    // Agar na filial, na brend belgilanmagan bo'lsa, hech narsa ko'rinmaydi
    if (roleLocations.length === 0 && roleBrands.length === 0) {
        return [];
    }
    
    // 1. Agar faqat filiallar belgilangan bo'lsa (brendlar belgilanmagan)
    if (roleLocations.length > 0 && roleBrands.length === 0) {
        return roleLocations;
    }
    
    // 2. Agar faqat brendlar belgilangan bo'lsa (filiallar belgilanmagan)
    if (roleLocations.length === 0 && roleBrands.length > 0) {
        // Shu brendga bog'langan barcha filiallarni olish
        const brandLocations = await db('brand_locations')
            .whereIn('brand_id', roleBrands)
            .distinct('location_name')
            .pluck('location_name');
        return brandLocations;
    }
    
    // 3. Agar ham filial, ham brend belgilangan bo'lsa
    if (roleLocations.length > 0 && roleBrands.length > 0) {
        // Aynan shu filiallarning shu brendlari
        const combinedLocations = await db('brand_locations')
            .whereIn('brand_id', roleBrands)
            .whereIn('location_name', roleLocations)
            .distinct('location_name')
            .pluck('location_name');
        return combinedLocations;
    }
    
    return [];
}

/**
 * Foydalanuvchi roliga qarab ko'rinadigan brendlarni aniqlash
 * @param {Object} user - Foydalanuvchi ma'lumotlari (session.user)
 * @returns {Promise<number[]>} - Ko'rinadigan brendlar ID ro'yxati
 */
async function getVisibleBrands(user) {
    // User va role tekshiruvi
    if (!user || !user.role) {
        log.warn('User yoki role topilmadi (getVisibleBrands)');
        return [];
    }
    
    // Superadmin barcha brendlarni ko'radi
    if (user.role === 'superadmin' || user.role === 'super_admin') {
        const allBrands = await db('brands').pluck('id');
        return allBrands;
    }
    
    // Foydalanuvchining o'z brendlarini olish (user_brands jadvalidan)
    const userBrands = await db('user_brands')
        .where('user_id', user.id)
        .pluck('brand_id');
    
    // Agar foydalanuvchining o'z brendlari bo'lsa, ularni qaytaramiz
    if (userBrands.length > 0) {
        return userBrands;
    }
    
    // Agar foydalanuvchining o'z brendlari bo'lmasa, rol brendlarini tekshiramiz
    // Rol ma'lumotlarini olish
    const roleData = await db('roles').where('role_name', user.role).first();
    if (!roleData) {
        log.warn(`Rol topilmadi (getVisibleBrands): ${user.role}`);
        return []; // Rol topilmasa, hech narsa ko'rinmaydi
    }
    
    // Foydalanuvchining o'z filiallarini olish
    const userLocations = await db('user_locations')
        .where('user_id', user.id)
        .pluck('location_name');
    
    // Rol uchun belgilangan filiallar
    const roleLocations = await db('role_locations')
        .where('role_name', user.role)
        .pluck('location_name');
    
    // Rol uchun belgilangan brendlar
    const roleBrands = await db('role_brands')
        .where('role_name', user.role)
        .pluck('brand_id');
    
    // Foydalanuvchining filiallari yoki rol filiallarini ishlatish
    const effectiveLocations = userLocations.length > 0 ? userLocations : roleLocations;
    
    // Agar na filial, na brend belgilanmagan bo'lsa, hech narsa ko'rinmaydi
    if (effectiveLocations.length === 0 && roleBrands.length === 0) {
        return [];
    }
    
    // 1. Agar faqat filiallar belgilangan bo'lsa (brendlar belgilanmagan)
    if (effectiveLocations.length > 0 && roleBrands.length === 0) {
        // Shu filialdagi barcha brendlarni olish
        const locationBrands = await db('brand_locations')
            .whereIn('location_name', effectiveLocations)
            .distinct('brand_id')
            .pluck('brand_id');
        return locationBrands;
    }
    
    // 2. Agar faqat brendlar belgilangan bo'lsa (filiallar belgilanmagan)
    if (effectiveLocations.length === 0 && roleBrands.length > 0) {
        return roleBrands;
    }
    
    // 3. Agar ham filial, ham brend belgilangan bo'lsa
    if (effectiveLocations.length > 0 && roleBrands.length > 0) {
        // Aynan shu filiallarning shu brendlari
        const combinedBrands = await db('brand_locations')
            .whereIn('brand_id', roleBrands)
            .whereIn('location_name', effectiveLocations)
            .distinct('brand_id')
            .pluck('brand_id');
        return combinedBrands;
    }
    
    return [];
}

/**
 * Reports query'ni foydalanuvchi roliga qarab filtrlash
 * @param {Object} query - Knex query object
 * @param {Object} user - Foydalanuvchi ma'lumotlari (session.user)
 * @returns {Promise<Object>} - Filtrlangan query
 */
async function filterReportsByRole(query, user) {
    try {
        // Query obyektini tekshirish
        if (!query || typeof query.whereRaw !== 'function') {
            log.error('Query obyekti to\'g\'ri emas:', typeof query);
            throw new Error('Query obyekti to\'g\'ri emas');
        }
        
        // User va role tekshiruvi
        if (!user || !user.role) {
            log.warn('User yoki role topilmadi');
            // Agar user yoki role yo'q bo'lsa, hech narsa qaytarmaslik
            query.whereRaw('1 = 0');
            // Query obyektini tekshirish
            if (query && typeof query.select === 'function') {
                return query;
            }
            // Agar query obyekti to'g'ri emas bo'lsa, xatolikni throw qilamiz
            throw new Error('Query obyekti to\'g\'ri emas - whereRaw dan keyin select metodi yo\'q');
        }
        
        // Superadmin uchun hech qanday filtr qo'llanmaydi
        if (user.role === 'superadmin' || user.role === 'super_admin') {
            return query;
        }
        
        const visibleLocations = await getVisibleLocations(user);
        const visibleBrands = await getVisibleBrands(user);
        
        // Agar hech narsa ko'rinmasa, bo'sh natija qaytarish
        if (visibleLocations.length === 0 && visibleBrands.length === 0) {
            // Query'ni hech narsa qaytarmasligi uchun imkonsiz shart qo'shamiz
            query.whereRaw('1 = 0');
            // Query obyektini tekshirish
            if (query && typeof query.select === 'function') {
                return query;
            }
            // Agar query obyekti to'g'ri emas bo'lsa, xatolikni throw qilamiz
            throw new Error('Query obyekti to\'g\'ri emas - whereRaw dan keyin select metodi yo\'q');
        }
        
        // Filiallar bo'yicha filtr
        if (visibleLocations.length > 0) {
            query.whereIn('r.location', visibleLocations);
        }
        
        // Brendlar bo'yicha filtr (agar reports jadvalida brand_id ustuni bo'lsa)
        if (visibleBrands.length > 0) {
            query.whereIn('r.brand_id', visibleBrands);
        }
        
        // Query obyektini tekshirish
        if (query && typeof query.select === 'function') {
            return query;
        }
        
        // Agar query obyekti to'g'ri emas bo'lsa, xatolikni throw qilamiz
        throw new Error('Query obyekti to\'g\'ri emas - select metodi yo\'q');
    } catch (error) {
        log.error('filterReportsByRole xatolik:', error.message);
        // Xatolik bo'lsa, hech narsa qaytarmaslik
        if (query && typeof query.whereRaw === 'function') {
            query.whereRaw('1 = 0');
            // Query obyektini tekshirish
            if (query && typeof query.select === 'function') {
                return query;
            }
        }
        // Agar query obyekti to'g'ri emas bo'lsa, xatolikni throw qilamiz
        throw error;
    }
}

/**
 * Brands query'ni foydalanuvchi roliga qarab filtrlash
 * @param {Object} query - Knex query object
 * @param {Object} user - Foydalanuvchi ma'lumotlari (session.user)
 * @returns {Promise<Object>} - Filtrlangan query
 */
async function filterBrandsByRole(query, user) {
    // Superadmin uchun hech qanday filtr qo'llanmaydi
    if (user.role === 'superadmin' || user.role === 'super_admin') {
        return query;
    }
    
    const visibleBrands = await getVisibleBrands(user);
    
    // Agar hech narsa ko'rinmasa, bo'sh natija qaytarish
    if (visibleBrands.length === 0) {
        return query.whereRaw('1 = 0');
    }
    
    return query.whereIn('brands.id', visibleBrands);
}

module.exports = {
    getVisibleLocations,
    getVisibleBrands,
    filterReportsByRole,
    filterBrandsByRole
};

