// utils/roleFiltering.js
// Rol shartlari bo'yicha ma'lumotlarni filtrlash funksiyalari

const { db } = require('../db.js');

/**
 * Foydalanuvchi roliga qarab ko'rinadigan filiallarni aniqlash
 * @param {Object} user - Foydalanuvchi ma'lumotlari (session.user)
 * @returns {Promise<string[]>} - Ko'rinadigan filiallar ro'yxati
 */
async function getVisibleLocations(user) {
    // User va role tekshiruvi
    if (!user || !user.role) {
        console.warn('[roleFiltering] User yoki role topilmadi:', user);
        return [];
    }
    
    // Superadmin barcha filiallarni ko'radi
    if (user.role === 'superadmin' || user.role === 'super_admin') {
        const allLocations = await db('reports')
            .distinct('location')
            .pluck('location');
        return allLocations;
    }
    
    // Rol ma'lumotlarini olish
    const roleData = await db('roles').where('role_name', user.role).first();
    if (!roleData) {
        console.warn(`[roleFiltering] Rol topilmadi: ${user.role}`);
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
        console.warn('[roleFiltering] User yoki role topilmadi (getVisibleBrands):', user);
        return [];
    }
    
    // Superadmin barcha brendlarni ko'radi
    if (user.role === 'superadmin' || user.role === 'super_admin') {
        const allBrands = await db('brands').pluck('id');
        return allBrands;
    }
    
    // Rol ma'lumotlarini olish
    const roleData = await db('roles').where('role_name', user.role).first();
    if (!roleData) {
        console.warn(`[roleFiltering] Rol topilmadi (getVisibleBrands): ${user.role}`);
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
        // Shu filialdagi barcha brendlarni olish
        const locationBrands = await db('brand_locations')
            .whereIn('location_name', roleLocations)
            .distinct('brand_id')
            .pluck('brand_id');
        return locationBrands;
    }
    
    // 2. Agar faqat brendlar belgilangan bo'lsa (filiallar belgilanmagan)
    if (roleLocations.length === 0 && roleBrands.length > 0) {
        return roleBrands;
    }
    
    // 3. Agar ham filial, ham brend belgilangan bo'lsa
    if (roleLocations.length > 0 && roleBrands.length > 0) {
        // Aynan shu filiallarning shu brendlari
        const combinedBrands = await db('brand_locations')
            .whereIn('brand_id', roleBrands)
            .whereIn('location_name', roleLocations)
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
        // User va role tekshiruvi
        if (!user || !user.role) {
            console.warn('[filterReportsByRole] User yoki role topilmadi:', user);
            // Agar user yoki role yo'q bo'lsa, hech narsa qaytarmaslik
            return query.whereRaw('1 = 0');
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
            return query.whereRaw('1 = 0');
        }
        
        // Filiallar bo'yicha filtr
        if (visibleLocations.length > 0) {
            query.whereIn('r.location', visibleLocations);
        }
        
        // Brendlar bo'yicha filtr (agar reports jadvalida brand_id ustuni bo'lsa)
        if (visibleBrands.length > 0) {
            query.whereIn('r.brand_id', visibleBrands);
        }
        
        return query;
    } catch (error) {
        console.error('[filterReportsByRole] Xatolik:', error);
        // Xatolik bo'lsa, hech narsa qaytarmaslik
        return query.whereRaw('1 = 0');
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

