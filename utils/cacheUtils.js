const cacheManager = require('./cacheManager.js');

/**
 * Barcha user-related cache'larni tozalash
 * @param {number} userId - Foydalanuvchi ID
 */
function clearAllUserCaches(userId) {
    cacheManager.clearUserCache(userId);
    
    // User repository cache'larini tozalash
    const userRepository = require('../data/userRepository.js');
    if (userRepository.clearUserCache) {
        userRepository.clearUserCache(userId);
    }
    
    // User access filter cache'larini tozalash
    const userAccessFilter = require('./userAccessFilter.js');
    if (userAccessFilter.clearUserCache) {
        userAccessFilter.clearUserCache(userId);
    }
}

module.exports = {
    clearAllUserCaches
};

