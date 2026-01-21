// utils/dateHelper.js
// Sana va vaqt bilan ishlash uchun yordamchi funksiyalar

/**
 * O'tgan oy nomini lotincha qaytaradi
 * @returns {String} O'tgan oy nomi (Yanvar, Fevral, ...)
 */
function getPreviousMonthName() {
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
    const now = new Date();
    // Joriy oy 0 dan boshlanadi, shuning uchun -1 qilamiz
    let previousMonth = now.getMonth() - 1;
    
    // Agar yanvar bo'lsa, o'tgan oy dekabr bo'ladi
    if (previousMonth < 0) {
        previousMonth = 11; // Dekabr
    }
    
    return months[previousMonth];
}

/**
 * Berilgan sanadan o'tgan oy nomini qaytaradi
 * @param {Date} date - Sana obyekti
 * @returns {String} O'tgan oy nomi
 */
function getPreviousMonthNameFromDate(date) {
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
    const previousMonth = date.getMonth() - 1;
    
    if (previousMonth < 0) {
        return months[11]; // Dekabr
    }
    
    return months[previousMonth];
}

module.exports = {
    getPreviousMonthName,
    getPreviousMonthNameFromDate
};

