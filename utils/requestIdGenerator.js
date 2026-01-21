// utils/requestIdGenerator.js
// So'rov ID generator - har bir so'rov uchun unique ID

/**
 * So'rov UID yaratish
 * Format: REQ-YYYYMMDD-HHMMSS-XXXX
 * XXXX - random 4 raqam
 */
function generateRequestUID() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    // Random 4 raqam
    const random = Math.floor(1000 + Math.random() * 9000);
    
    return `REQ-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
}

/**
 * So'rov UID'ni validatsiya qilish
 */
function isValidRequestUID(uid) {
    if (!uid || typeof uid !== 'string') {
        return false;
    }
    
    const pattern = /^REQ-\d{8}-\d{6}-\d{4}$/;
    return pattern.test(uid);
}

module.exports = {
    generateRequestUID,
    isValidRequestUID
};

