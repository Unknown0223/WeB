// bot/unified/messageRouter.js
// Message Router - context-based routing

const { getUserState, CONTEXTS } = require('./stateManager.js');
const { createLogger } = require('../../utils/logger.js');

const log = createLogger('MSG_ROUTER');

/**
 * Qarzdorlik tasdiqlash command'lari
 */
const DEBT_APPROVAL_COMMANDS = [
    "➕ Yangi so'rov",
    "📋 Mening so'rovlarim",
    "⏳ Jarayondagi so'rovlar",
    "✅ Tasdiqlangan so'rovlar",
    "🕓 Qaytgan so'rovlar",
    "✅ Tasdiqlash",
    "💾 SET (Muddat uzaytirish)",
    "🔄 Rolni o'zgartirish"
];

/**
 * Hisobot command'lari
 */
const HISOBOT_COMMANDS = [
    "📊 Hisobotlar",
    "📊 Hisobotlar ro'yxati",
    "➕ Yangi hisobot",
    "📈 Statistika"
];

/**
 * Xabar qaysi context'ga tegishli ekanligini aniqlash
 */
function routeMessage(msg, user, stateManager) {
    const userId = msg.from.id;
    const text = msg.text?.trim();
    const hasDocument = !!msg.document;
    
    // 1. Registration state tekshirish (eng yuqori prioritet)
    const state = stateManager.getUserState(userId);
    if (state && state.context === CONTEXTS.REGISTRATION) {
        log.info(`[MSG_ROUTER] Message routed to REGISTRATION: userId=${userId}, state=${state.state}, hasDocument=${hasDocument}`);
        return CONTEXTS.REGISTRATION;
    }
    
    // 2. Debt-approval state tekshirish
    if (state && state.context === CONTEXTS.DEBT_APPROVAL) {
        log.info(`[MSG_ROUTER] Message routed to DEBT_APPROVAL: userId=${userId}, state=${state.state}, hasDocument=${hasDocument}, requestId=${state.data?.request_id}`);
        return CONTEXTS.DEBT_APPROVAL;
    }
    
    // 3. Hisobot state tekshirish
    if (state && state.context === CONTEXTS.HISOBOT) {
        log.debug(`Message routed to HISOBOT: userId=${userId}, state=${state.state}`);
        return CONTEXTS.HISOBOT;
    }
    
    // 4. Command-based routing
    if (text) {
        // Debt-approval command tekshirish
        if (isDebtApprovalCommand(text)) {
            log.debug(`Message routed to DEBT_APPROVAL (command): userId=${userId}, text=${text}`);
            return CONTEXTS.DEBT_APPROVAL;
        }
        
        // Hisobot command tekshirish
        if (isHisobotCommand(text)) {
            log.debug(`Message routed to HISOBOT: userId=${userId}, text=${text}`);
            return CONTEXTS.HISOBOT;
        }
    }
    
    // 5. Default (IDLE)
    log.debug(`Message routed to IDLE: userId=${userId}`);
    return CONTEXTS.IDLE;
}

/**
 * Qarzdorlik tasdiqlash command'imi tekshirish
 */
function isDebtApprovalCommand(text) {
    if (!text) return false;
    
    return DEBT_APPROVAL_COMMANDS.some(cmd => 
        text === cmd || text.includes(cmd)
    );
}

/**
 * Hisobot command'imi tekshirish
 */
function isHisobotCommand(text) {
    if (!text) return false;
    
    return HISOBOT_COMMANDS.some(cmd => 
        text === cmd || text.includes(cmd)
    );
}

/**
 * Registration command'imi tekshirish
 */
function isRegistrationCommand(text) {
    if (!text) return false;
    
    const registrationCommands = [
        '/register',
        '/start',
        "ro'yxatdan o'tish",
        'register'
    ];
    
    return registrationCommands.some(cmd => 
        text.toLowerCase().includes(cmd.toLowerCase())
    );
}

module.exports = {
    routeMessage,
    isDebtApprovalCommand,
    isHisobotCommand,
    isRegistrationCommand,
    DEBT_APPROVAL_COMMANDS,
    HISOBOT_COMMANDS
};

