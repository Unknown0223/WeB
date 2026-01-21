// bot/unified/stateManager.js
// Global State Manager - barcha handler'lar uchun bitta state

const { createLogger } = require('../../utils/logger.js');

const log = createLogger('STATE_MGR');

// Global user states
// Format: { userId: { context, state, data, timestamp } }
const globalUserStates = {};

// Context types
const CONTEXTS = {
    REGISTRATION: 'registration',
    DEBT_APPROVAL: 'debt_approval',
    HISOBOT: 'hisobot',
    IDLE: 'idle'
};

// State timeout (30 daqiqa)
const STATE_TIMEOUT = 30 * 60 * 1000; // 30 daqiqa

// Timeout timer'lar
const timeoutTimers = {};

/**
 * Foydalanuvchi state'ini o'rnatish
 */
function setUserState(userId, context, state, data = {}) {
    const timestamp = Date.now();
    
    globalUserStates[userId] = {
        context: context,
        state: state,
        data: data,
        timestamp: timestamp
    };
    
    // Eski timeout'ni tozalash
    if (timeoutTimers[userId]) {
        clearTimeout(timeoutTimers[userId]);
    }
    
    // Yangi timeout o'rnatish
    timeoutTimers[userId] = setTimeout(() => {
        const currentState = globalUserStates[userId];
        // Agar state o'zgarmagan bo'lsa (timestamp bir xil), o'chirish
        if (currentState && currentState.timestamp === timestamp) {
            delete globalUserStates[userId];
            delete timeoutTimers[userId];
            log.info(`State timeout: userId=${userId}, context=${context}, state=${state}`);
        }
    }, STATE_TIMEOUT);
    
    log.debug(`State set: userId=${userId}, context=${context}, state=${state}`);
}

/**
 * Foydalanuvchi state'ini olish
 */
function getUserState(userId) {
    return globalUserStates[userId] || null;
}

/**
 * Foydalanuvchi state'ini tozalash
 */
function clearUserState(userId) {
    if (timeoutTimers[userId]) {
        clearTimeout(timeoutTimers[userId]);
        delete timeoutTimers[userId];
    }
    
    if (globalUserStates[userId]) {
        const state = globalUserStates[userId];
        log.debug(`State cleared: userId=${userId}, context=${state.context}, state=${state.state}`);
        delete globalUserStates[userId];
    }
}

/**
 * Foydalanuvchi context'ini olish
 */
function getUserContext(userId) {
    const state = globalUserStates[userId];
    return state ? state.context : CONTEXTS.IDLE;
}

/**
 * Foydalanuvchi state'ini yangilash (context o'zgarmasdan)
 */
function updateUserState(userId, state, data = null) {
    const currentState = globalUserStates[userId];
    if (!currentState) {
        log.warn(`Cannot update state: userId=${userId} - state not found`);
        return false;
    }
    
    currentState.state = state;
    currentState.timestamp = Date.now();
    
    if (data !== null) {
        currentState.data = { ...currentState.data, ...data };
    }
    
    // Timeout'ni qayta o'rnatish
    if (timeoutTimers[userId]) {
        clearTimeout(timeoutTimers[userId]);
    }
    
    timeoutTimers[userId] = setTimeout(() => {
        const state = globalUserStates[userId];
        if (state && state.timestamp === currentState.timestamp) {
            delete globalUserStates[userId];
            delete timeoutTimers[userId];
            log.info(`State timeout: userId=${userId}, context=${currentState.context}, state=${state}`);
        }
    }, STATE_TIMEOUT);
    
    log.debug(`State updated: userId=${userId}, context=${currentState.context}, state=${state}`);
    return true;
}

/**
 * Barcha state'larni olish (debug uchun)
 */
function getAllStates() {
    return { ...globalUserStates };
}

/**
 * State'ni tekshirish (context va state'ga qarab)
 */
function hasState(userId, context, state = null) {
    const userState = globalUserStates[userId];
    if (!userState) return false;
    
    if (userState.context !== context) return false;
    if (state !== null && userState.state !== state) return false;
    
    return true;
}

/**
 * Foydalanuvchi hozir qaysi bo'limda ishlayotganini tekshirish
 */
function isUserBusy(userId) {
    const state = getUserState(userId);
    if (!state) return false;
    
    // Agar foydalanuvchi biror bo'limda ishlamoqda bo'lsa
    return state.context !== CONTEXTS.IDLE;
}

/**
 * Foydalanuvchi boshqa bo'limga o'tishga harakat qilganda tekshirish
 */
function canSwitchContext(userId, newContext) {
    const state = getUserState(userId);
    if (!state) return true; // Hech qanday state yo'q, o'tish mumkin
    
    // Agar bir xil context bo'lsa, o'tish mumkin
    if (state.context === newContext) return true;
    
    // Agar IDLE bo'lsa, o'tish mumkin
    if (state.context === CONTEXTS.IDLE) return true;
    
    // Registration context'ga har doim o'tish mumkin (yangi ro'yxatdan o'tish)
    if (newContext === CONTEXTS.REGISTRATION) return true;
    
    // Aks holda, o'tish mumkin emas (boshqa bo'limda ishlamoqda)
    return false;
}

module.exports = {
    CONTEXTS,
    setUserState,
    getUserState,
    clearUserState,
    getUserContext,
    updateUserState,
    getAllStates,
    hasState,
    isUserBusy,
    canSwitchContext
};

