const { db } = require('../db.js');

/**
 * Universal foydalanuvchi access filter
 * Foydalanuvchining filiallari va brendlariga qarab, qaysi ma'lumotlarni ko'rsatish kerakligini aniqlaydi
 * 
 * Logika:
 * 1. Faqat filiallar belgilansa → shu filiallardagi barcha brendlar
 * 2. Faqat brendlar belgilansa → shu brendlar mavjud bo'lgan filiallar (faqat shu brendlar)
 * 3. Ham filiallar, ham brendlar belgilansa → kesishma (belgilangan filialdagi belgilangan brendlar)
 * 
 * @param {Object} user - Foydalanuvchi ma'lumotlari (req.session.user)
 * @returns {Object} { allowedLocations: [], allowedBrandIds: [] }
 */
async function getUserAccessFilter(user) {
    // Super admin uchun cheklov yo'q
    if (user.role === 'super_admin') {
        return {
            allowedLocations: null, // null = barcha filiallar
            allowedBrandIds: null   // null = barcha brendlar
        };
    }

    // Foydalanuvchining filiallarini olish
    const userLocations = await db('user_locations')
        .where('user_id', user.id)
        .pluck('location_name');
    
    // Foydalanuvchining brendlarini olish
    const userBrands = await db('user_brands')
        .where('user_id', user.id)
        .pluck('brand_id');

    // Rol shartlarini olish
    const roleData = await db('roles')
        .where('role_name', user.role)
        .first();
    
    if (!roleData) {
        // Agar rol topilmasa, hech narsa ko'rsatilmaydi
        return {
            allowedLocations: [],
            allowedBrandIds: []
        };
    }

    const roleRequiresLocations = roleData.requires_locations;
    const roleRequiresBrands = roleData.requires_brands;

    // Rol uchun belgilangan filial va brendlarni olish
    const roleLocations = await db('role_locations')
        .where('role_name', user.role)
        .pluck('location_name');
    
    const roleBrands = await db('role_brands')
        .where('role_name', user.role)
        .pluck('brand_id');

    // User-specific sozlamalarni olish (agar mavjud bo'lsa)
    const userSettings = await db('user_specific_settings')
        .where('user_id', user.id)
        .where('role', user.role)
        .first();

    // Qaysi shartlar ishlatiladi: user-specific yoki role-specific
    const effectiveRequiresLocations = userSettings?.requires_locations !== null && userSettings?.requires_locations !== undefined
        ? userSettings.requires_locations
        : roleRequiresLocations;
    
    const effectiveRequiresBrands = userSettings?.requires_brands !== null && userSettings?.requires_brands !== undefined
        ? userSettings.requires_brands
        : roleRequiresBrands;

    let allowedLocations = null; // null = barcha filiallar
    let allowedBrandIds = null;  // null = barcha brendlar

    // === LOGIKA 1: Faqat filiallar belgilangan ===
    if (userLocations.length > 0 && userBrands.length === 0) {
        // Foydalanuvchiga faqat filiallar biriktirilgan, brendlar yo'q
        allowedLocations = userLocations;
        
        // Shu filiallardagi barcha brendlarni olish
        const brandsInLocations = await db('brand_locations')
            .whereIn('location_name', userLocations)
            .distinct('brand_id')
            .pluck('brand_id');
        
        allowedBrandIds = brandsInLocations;
    }
    // === LOGIKA 2: Faqat brendlar belgilangan ===
    else if (userLocations.length === 0 && userBrands.length > 0) {
        // Foydalanuvchiga faqat brendlar biriktirilgan, filiallar yo'q
        allowedBrandIds = userBrands;
        
        // Shu brendlar mavjud bo'lgan filiallarni olish
        const locationsForBrands = await db('brand_locations')
            .whereIn('brand_id', userBrands)
            .distinct('location_name')
            .pluck('location_name');
        
        allowedLocations = locationsForBrands;
    }
    // === LOGIKA 3: Ham filiallar, ham brendlar belgilangan ===
    else if (userLocations.length > 0 && userBrands.length > 0) {
        // Kesishma: faqat belgilangan filialdagi belgilangan brendlar
        allowedLocations = userLocations;
        allowedBrandIds = userBrands;
        
        // Tekshirish: belgilangan filiallarda belgilangan brendlar mavjudmi?
        const validBrandLocations = await db('brand_locations')
            .whereIn('location_name', userLocations)
            .whereIn('brand_id', userBrands)
            .select('brand_id', 'location_name');
        
        // Faqat valid brand-location juftliklarini qoldiramiz
        const validBrandIds = [...new Set(validBrandLocations.map(bl => bl.brand_id))];
        const validLocationNames = [...new Set(validBrandLocations.map(bl => bl.location_name))];
        
        allowedBrandIds = validBrandIds;
        allowedLocations = validLocationNames;
    }
    // === LOGIKA 4: Hech narsa belgilanmagan ===
    else {
        // Agar hech narsa belgilanmagan bo'lsa, rol shartlariga qarab
        if (effectiveRequiresLocations === 'by_location' && roleLocations.length > 0) {
            // Rol uchun filial belgilangan
            allowedLocations = roleLocations;
            
            // Shu filiallardagi barcha brendlarni olish
            const brandsInRoleLocations = await db('brand_locations')
                .whereIn('location_name', roleLocations)
                .distinct('brand_id')
                .pluck('brand_id');
            
            allowedBrandIds = brandsInRoleLocations;
        } else if (effectiveRequiresBrands === 'by_brand' && roleBrands.length > 0) {
            // Rol uchun brendlar belgilangan
            allowedBrandIds = roleBrands;
            
            // Shu brendlar mavjud bo'lgan filiallarni olish
            const locationsForRoleBrands = await db('brand_locations')
                .whereIn('brand_id', roleBrands)
                .distinct('location_name')
                .pluck('location_name');
            
            allowedLocations = locationsForRoleBrands;
        } else {
            // Hech qanday cheklov yo'q
            allowedLocations = null;
            allowedBrandIds = null;
        }
    }

    return {
        allowedLocations,
        allowedBrandIds
    };
}

/**
 * Reports query'ga filter qo'shish
 * @param {Object} query - Knex query object
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {string} locationColumn - Location column nomi (default: 'r.location')
 * @param {string} brandIdColumn - Brand ID column nomi (default: 'r.brand_id')
 */
async function applyReportsFilter(query, user, locationColumn = 'r.location', brandIdColumn = 'r.brand_id') {
    const filter = await getUserAccessFilter(user);
    
    if (filter.allowedLocations !== null && filter.allowedLocations.length > 0) {
        query.whereIn(locationColumn, filter.allowedLocations);
    } else if (filter.allowedLocations !== null && filter.allowedLocations.length === 0) {
        // Agar hech qanday filialga ruxsat yo'q bo'lsa, bo'sh natija qaytarish
        query.whereRaw('1 = 0'); // Hech qanday natija qaytarmaslik uchun
        return;
    }
    
    if (filter.allowedBrandIds !== null && filter.allowedBrandIds.length > 0) {
        query.whereIn(brandIdColumn, filter.allowedBrandIds);
    } else if (filter.allowedBrandIds !== null && filter.allowedBrandIds.length === 0) {
        // Agar hech qanday brendga ruxsat yo'q bo'lsa, bo'sh natija qaytarish
        query.whereRaw('1 = 0'); // Hech qanday natija qaytarmaslik uchun
        return;
    }
}

/**
 * Brands query'ga filter qo'shish
 * @param {Object} query - Knex query object
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 */
async function applyBrandsFilter(query, user) {
    const filter = await getUserAccessFilter(user);
    
    if (filter.allowedBrandIds !== null && filter.allowedBrandIds.length > 0) {
        query.whereIn('brands.id', filter.allowedBrandIds);
    } else if (filter.allowedBrandIds !== null && filter.allowedBrandIds.length === 0) {
        query.whereRaw('1 = 0');
        return;
    }
    
    // Agar filiallar belgilangan bo'lsa, faqat shu filiallardagi brendlarni ko'rsatish
    if (filter.allowedLocations !== null && filter.allowedLocations.length > 0) {
        query.join('brand_locations', 'brands.id', 'brand_locations.brand_id')
            .whereIn('brand_locations.location_name', filter.allowedLocations)
            .distinct('brands.*');
    }
}

/**
 * Locations ro'yxatini filter qilish
 * @param {Object} user - Foydalanuvchi ma'lumotlari
 * @param {Array} allLocations - Barcha filiallar ro'yxati
 * @returns {Array} Ruxsat etilgan filiallar ro'yxati
 */
async function getFilteredLocations(user, allLocations) {
    const filter = await getUserAccessFilter(user);
    
    if (filter.allowedLocations === null) {
        return allLocations; // Barcha filiallar
    }
    
    if (filter.allowedLocations.length === 0) {
        return []; // Hech qanday filialga ruxsat yo'q
    }
    
    // Faqat ruxsat etilgan filiallarni qaytarish
    return allLocations.filter(loc => filter.allowedLocations.includes(loc));
}

module.exports = {
    getUserAccessFilter,
    applyReportsFilter,
    applyBrandsFilter,
    getFilteredLocations
};

