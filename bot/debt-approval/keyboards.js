// bot/debt-approval/keyboards.js

// Reply keyboard (asosiy menyu)
function mainMenuKeyboard(role) {
    if (role === 'manager') {
        return {
            keyboard: [
                [{ text: "➕ Yangi so'rov" }],
                [{ text: "📋 Mening so'rovlarim" }],
                [{ text: "🕓 Qaytgan so'rovlar" }]
            ],
            resize_keyboard: true
        };
    }
    
    return {
        keyboard: [],
        resize_keyboard: true
    };
}

// Inline keyboard (tasdiqlash)
function approvalKeyboard(requestId, type = 'default') {
    return {
        inline_keyboard: [
            [
                { text: "✅ Tasdiqlash", callback_data: `debt_approve:${requestId}` },
                { text: "⚠️ Qarzi bor", callback_data: `debt_debt:${requestId}` }
            ]
        ]
    };
}

// Preview keyboard
function previewKeyboard(requestId) {
    return {
        inline_keyboard: [
            [
                { text: "📤 Yuborish", callback_data: `debt_send:${requestId}` },
                { text: "❌ Bekor", callback_data: `debt_cancel:${requestId}` }
            ],
            [
                { text: "⬅️ Ortga", callback_data: 'debt_back_to_previous' }
            ]
        ]
    };
}

// Debt preview keyboard
function debtPreviewKeyboard(requestId) {
    return {
        inline_keyboard: [
            [
                { text: "📤 Yuborish", callback_data: `debt_send:${requestId}` },
                { text: "❌ Bekor", callback_data: `debt_cancel_debt:${requestId}` }
            ]
        ]
    };
}

// Kutilinayotgan so'rovlarni ko'rish knopkasi
function showPendingRequestsKeyboard(role, userId = null) {
    const callbackData = userId ? `show_pending_requests_${role}_${userId}` : `show_pending_requests_${role}`;
    return {
        inline_keyboard: [
            [
                { 
                    text: '📋 Kutilinayotgan so\'rovlar', 
                    callback_data: callbackData
                }
            ]
        ]
    };
}

module.exports = {
    mainMenuKeyboard,
    approvalKeyboard,
    previewKeyboard,
    debtPreviewKeyboard,
    showPendingRequestsKeyboard
};

