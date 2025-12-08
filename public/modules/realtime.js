// Real-time Module
// WebSocket va real-time ma'lumotlar boshqaruvi

import { state } from './state.js';
import { updateDashboard } from './dashboard.js';
import { renderUsersByStatus } from './users.js';
import { showToast } from './utils.js';

let ws = null;
let reconnectInterval = null;
let autoRefreshInterval = null;
let currentUserId = null;

export function initRealTime() {
    console.log('🚀 [REALTIME] Real-time modul ishga tushmoqda...');
    
    // Joriy foydalanuvchi ID'ni olish - bir necha manbadan
    const checkUser = () => {
        // Avval state.currentUser'ni tekshirish
        if (state.currentUser) {
            currentUserId = state.currentUser.id;
            const username = state.currentUser.username || 'Noma\'lum';
            console.log(`✅ [REALTIME] Foydalanuvchi ID olingan (state.currentUser): ${currentUserId}, Username: ${username}`);
            return true;
        }
        
        // Agar mavjud bo'lmasa, window obyektidan olish
        if (window.currentUserId) {
            currentUserId = window.currentUserId;
            const username = window.currentUsername || 'Noma\'lum';
            console.log(`✅ [REALTIME] Foydalanuvchi ID olingan (window): ${currentUserId}, Username: ${username}`);
            return true;
        }
        
        return false;
    };
    
    // Agar hozir mavjud bo'lsa, ishlatish
    if (!checkUser()) {
        // Agar mavjud bo'lmasa, biroz kutib, qayta tekshirish
        setTimeout(() => {
            if (checkUser()) {
                console.log('✅ [REALTIME] Foydalanuvchi ma\'lumotlari keyinroq olingan');
            } else {
                console.warn('⚠️ [REALTIME] state.currentUser hali mavjud emas, lekin WebSocket ulanishi davom etadi');
            }
        }, 500);
    }
    
    // WebSocket ulanish
    connectWebSocket();
    
    // Auto-refresh (fallback agar WebSocket ishlamasa)
    startAutoRefresh();
    
    // Page visibility API - sahifa ko'rinishda bo'lsa refresh
    setupVisibilityListener();
    
    console.log('✅ [REALTIME] Real-time modul ishga tushirildi');
}

function connectWebSocket() {
    // WebSocket server manzili
    // Railway va boshqa cloud platformalar uchun WebSocket protokoli
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl;
    
    // Railway yoki boshqa cloud platformalar uchun
    if (window.location.hostname.includes('railway.app') || 
        window.location.hostname.includes('railway') ||
        window.location.protocol === 'https:') {
        // HTTPS bo'lsa, WSS ishlatish
        wsUrl = `wss://${window.location.host}/ws`;
    } else {
        // Development uchun
        wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    }
    
    try {
        console.log(`🔌 [WEBSOCKET] Ulanishga harakat qilinmoqda: ${wsUrl}`);
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('✅ [WEBSOCKET] Ulanish muvaffaqiyatli');
            if (reconnectInterval) {
                showToast('Real-time rejim yoqildi');
            }
            stopReconnecting();
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('❌ [WEBSOCKET] Xabar qayta ishlashda xatolik:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('❌ [WEBSOCKET] Xatolik:', error);
            console.error('❌ [WEBSOCKET] URL:', wsUrl);
        };
        
        ws.onclose = (event) => {
            console.log('❌ [WEBSOCKET] Ulanish yopildi. Code:', event.code, 'Reason:', event.reason);
            scheduleReconnect();
        };
    } catch (error) {
        // console.error('WebSocket connection failed:', error);
        scheduleReconnect();
    }
}

function handleWebSocketMessage(data) {
    const { type, payload } = data;
    
    switch(type) {
        case 'dashboard_update':
            // Dashboard yangilash
            if (document.getElementById('dashboard').classList.contains('active')) {
                updateDashboard(payload.date);
            }
            break;
            
        case 'user_status_changed':
            // Foydalanuvchi statusi o'zgardi
            const user = state.users.find(u => u.id === payload.userId);
            if (user) {
                user.is_online = payload.isOnline;
                if (document.getElementById('users').classList.contains('active')) {
                    const activeTab = document.querySelector('#user-tabs .active').dataset.status;
                    renderUsersByStatus(activeTab);
                }
            }
            showToast(`${payload.username} ${payload.isOnline ? 'online' : 'offline'}`);
            break;
            
        case 'new_report':
            // Yangi hisobot qo'shildi
            showToast('Yangi hisobot qo\'shildi!');
            if (document.getElementById('dashboard').classList.contains('active')) {
                refreshCurrentDashboard();
            }
            break;
            
        case 'report_edited':
            // Hisobot tahrirlandi
            showToast('Hisobot yangilandi');
            if (document.getElementById('dashboard').classList.contains('active')) {
                refreshCurrentDashboard();
            }
            break;
            
        case 'user_registered':
            // Yangi foydalanuvchi ro'yxatdan o'tdi
            showToast('Yangi registratsiya so\'rovi!');
            state.pendingUsers.push(payload.user);
            if (document.getElementById('requests').classList.contains('active')) {
                import('./users.js').then(module => {
                    module.renderPendingUsers();
                });
            }
            break;
            
        case 'new_notification':
            // Yangi bildirishnoma keldi
            handleNewNotification(payload);
            break;
            
        default:
            // console.log('Unknown message type:', type);
    }
}

// Yangi bildirishnoma kelganda ishlov berish
function handleNewNotification(payload) {
    console.log('🔔 [NOTIFICATION] Yangi bildirishnoma qabul qilindi:', payload);
    
    // Foydalanuvchi ID'ni tekshirish - bir necha manbadan olish
    let userId = currentUserId;
    let currentUsername = 'Noma\'lum';
    
    // Avval state.currentUser'ni tekshirish
    if (state.currentUser) {
        userId = state.currentUser.id;
        currentUsername = state.currentUser.username || 'Noma\'lum';
    }
    
    // Agar mavjud bo'lmasa, window obyektidan olish
    if (!userId) {
        userId = window.currentUserId;
        currentUsername = window.currentUsername || 'Noma\'lum';
    }
    
    // Agar hali ham mavjud bo'lmasa, DOM'dan olish
    if (!userId) {
        const currentUsernameEl = document.getElementById('current-username');
        if (currentUsernameEl) {
            currentUsername = currentUsernameEl.textContent.trim() || 'Noma\'lum';
        }
    }
    
    console.log('🔔 [NOTIFICATION] User ID tekshiruvi:', { 
        payload_user_id: payload.user_id, 
        current_user_id: userId,
        current_username: currentUsername,
        state_currentUser: !!state.currentUser,
        window_currentUserId: window.currentUserId,
        currentUserId_var: currentUserId
    });
    
    if (payload.user_id && userId && payload.user_id !== userId) {
        console.log('⚠️ [NOTIFICATION] Boshqa foydalanuvchiga tegishli bildirishnoma, e\'tiborsiz qoldirildi');
        return; // Boshqa foydalanuvchiga tegishli, e'tiborsiz qoldirish
    }
    
    // Operator tomonida bildirishnoma qabul qilindi
    if (payload.user_id === userId) {
        console.log(`✅ [NOTIFICATION] Operator ${currentUsername} (ID: ${userId}) uchun bildirishnoma qabul qilindi`);
    }
    
    const notification = payload.notification || payload;
    console.log('🔔 [NOTIFICATION] Notification ma\'lumotlari:', {
        type: notification.type,
        title: notification.title,
        message: notification.message,
        created_at: notification.created_at
    });
    
    // Bugungi sana tekshiruvi - faqat bugungi bildirishnomalarni ko'rsatish
    if (notification.created_at) {
        const notificationDate = new Date(notification.created_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        notificationDate.setHours(0, 0, 0, 0);
        
        if (notificationDate.getTime() !== today.getTime()) {
            console.log('⚠️ [NOTIFICATION] Eski bildirishnoma (bugungi emas), e\'tiborsiz qoldirildi:', notification.created_at);
            return; // Eski bildirishnoma, e'tiborsiz qoldirish
        }
    }
    
    // Agar comparison_difference turidagi bildirishnoma bo'lsa, maxsus modal ko'rsatish
    if (notification.type === 'comparison_difference') {
        const currentUsername = state.currentUser?.username || window.currentUsername || 'Noma\'lum';
        const userId = currentUserId || state.currentUser?.id || window.currentUserId;
        console.log(`✅ [NOTIFICATION] Operator ${currentUsername} (ID: ${userId}) uchun comparison difference bildirishnoma topildi`);
        console.log(`🚨 [NOTIFICATION] Operator ${currentUsername} uchun modal ochilmoqda...`);
        showComparisonAlertModal(notification);
        console.log(`🎉 [NOTIFICATION] Operator ${currentUsername} uchun modal ochildi`);
        // Comparison alert uchun avatar pulsatsiyasini olib tashlash
        return;
    }
    
    // Boshqa bildirishnomalar uchun avatar pulsatsiyasini olib tashlash
    // (chunki ular notifications modal orqali ko'rsatiladi)
    
    // Notification badge'ni yangilash
    updateNotificationBadge();
    
    // Modal oynani avtomatik ochish (agar yopiq bo'lsa)
    const modal = document.getElementById('notifications-modal');
    if (modal && modal.classList.contains('hidden')) {
        // Sahifani yoritish (highlight)
        document.body.classList.add('notification-highlight');
        
        // Modal oynani ochish
        modal.classList.remove('hidden');
        
        // Notification'larni yuklash
        if (window.loadNotifications) {
            window.loadNotifications();
        }
        
        // "Tushundim" tugmasi qo'shish
        addNotificationAcknowledgeButton(notification);
        
        // Feather iconlarni yangilash
        if (window.feather) {
            window.feather.replace();
        }
    } else if (modal && !modal.classList.contains('hidden')) {
        // Agar modal ochiq bo'lsa, faqat yangilash
        if (window.loadNotifications) {
            window.loadNotifications();
        }
    }
}

// Comparison farq bildirishnomasi uchun maxsus modal
function showComparisonAlertModal(notification) {
    const currentUsername = state.currentUser?.username || window.currentUsername || 'Noma\'lum';
    const userId = currentUserId || state.currentUser?.id || window.currentUserId;
    
    console.log(`🚨 [COMPARISON ALERT] Operator ${currentUsername} (ID: ${userId}) uchun modal ochilish jarayoni boshlandi`);
    console.log('🚨 [COMPARISON ALERT] Notification:', notification);
    
    const modal = document.getElementById('comparison-alert-modal');
    if (!modal) {
        console.error(`❌ [COMPARISON ALERT] Operator ${currentUsername} uchun modal element topilmadi!`);
        return;
    }
    console.log(`✅ [COMPARISON ALERT] Operator ${currentUsername} uchun modal element topildi`);
    
    const details = notification.details || {};
    console.log('📋 [COMPARISON ALERT] Details:', details);
    
    const messageEl = document.getElementById('comparison-alert-message');
    const detailsEl = document.getElementById('comparison-alert-details');
    const acknowledgeBtn = document.getElementById('comparison-alert-acknowledge-btn');
    
    console.log('🔍 [COMPARISON ALERT] Elementlar tekshiruvi:', {
        messageEl: !!messageEl,
        detailsEl: !!detailsEl,
        acknowledgeBtn: !!acknowledgeBtn
    });
    
    // Xabar matnini ko'rsatish
    if (messageEl) {
        messageEl.textContent = notification.message || 'Solishtirishda farqlar aniqlandi';
        console.log('✅ [COMPARISON ALERT] Xabar matni ko\'rsatildi:', messageEl.textContent);
    } else {
        console.error('❌ [COMPARISON ALERT] Message element topilmadi!');
    }
    
    // Batafsil ma'lumotlarni ko'rsatish
    if (detailsEl && details.differences && details.differences.length > 0) {
        console.log('📊 [COMPARISON ALERT] Batafsil ma\'lumotlar tayyorlanmoqda, farqlar soni:', details.differences.length);
        let detailsHtml = `
            <div class="alert-detail-item">
                <span class="detail-label">Sana:</span>
                <span class="detail-value">${details.date || 'Noma\'lum'}</span>
            </div>
            <div class="alert-detail-item">
                <span class="detail-label">Brend:</span>
                <span class="detail-value">${details.brand_name || 'Noma\'lum'}</span>
            </div>
            <div class="alert-detail-item">
                <span class="detail-label">Farqlar soni:</span>
                <span class="detail-value highlight">${details.total_differences || 0} ta filial</span>
            </div>
        `;
        
        if (details.differences.length > 0) {
            detailsHtml += '<div class="alert-differences-list">';
            detailsHtml += '<div class="alert-differences-header"><i data-feather="map-pin"></i><span>Filiallar:</span></div>';
            detailsHtml += '<div class="alert-differences-items">';
            
            details.differences.forEach(diff => {
                const operatorAmount = diff.operator_amount || 0;
                const comparisonAmount = diff.comparison_amount || 0;
                const diffValue = diff.difference || 0;
                const diffColor = diffValue > 0 ? 'var(--green-color)' : 'var(--red-color)';
                const diffSign = diffValue > 0 ? '+' : '';
                
                // 3 xonali format (bo'sh joy bilan)
                const formatAmount = (amount) => {
                    if (typeof amount !== 'number') return '0';
                    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                };
                
                detailsHtml += `
                    <div class="alert-difference-item">
                        <div class="alert-difference-location">
                            <i data-feather="map-pin"></i>
                            <span>${diff.location}</span>
                        </div>
                        <div class="alert-difference-details">
                            <div class="difference-row">
                                <span class="difference-label">Operator summa:</span>
                                <span class="difference-value operator-amount">${formatAmount(operatorAmount)} so'm</span>
                            </div>
                            <div class="difference-row">
                                <span class="difference-label">Solishtirish summa:</span>
                                <span class="difference-value comparison-amount">${formatAmount(comparisonAmount)} so'm</span>
                            </div>
                            <div class="difference-row">
                                <span class="difference-label">Farq:</span>
                                <span class="difference-value difference-amount" style="color: ${diffColor}; font-weight: 700;">
                                    ${diffSign}${formatAmount(Math.abs(diffValue))} so'm
                                </span>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            detailsHtml += '</div></div>';
        }
        
        detailsEl.innerHTML = detailsHtml;
        console.log('✅ [COMPARISON ALERT] Batafsil ma\'lumotlar ko\'rsatildi');
    } else {
        console.warn('⚠️ [COMPARISON ALERT] Details element yoki differences mavjud emas');
    }
    
    // "Tushundim" tugmasi event listener
    if (acknowledgeBtn) {
        acknowledgeBtn.onclick = () => {
            console.log('✅ [COMPARISON ALERT] "Tushundim" tugmasi bosildi');
            
            // Modal oynani yopish
            modal.classList.add('hidden');
            console.log('✅ [COMPARISON ALERT] Modal yopildi');
            
            // Sahifani yana aktivlashtirish
            document.body.classList.remove('comparison-alert-active');
            console.log('✅ [COMPARISON ALERT] Sahifa yana aktivlashtirildi');
            
            // Notification badge'ni yangilash
            updateNotificationBadge();
            
            // Feather iconlarni yangilash
            if (window.feather) {
                window.feather.replace();
            }
        };
        console.log('✅ [COMPARISON ALERT] "Tushundim" tugmasi event listener qo\'shildi');
    } else {
        console.error('❌ [COMPARISON ALERT] Acknowledge button topilmadi!');
    }
    
    // Sahifani qorong'ilashtirish
    document.body.classList.add('comparison-alert-active');
    console.log(`✅ [COMPARISON ALERT] Operator ${currentUsername} uchun sahifa qorong'ilashdi`);
    
    // Modal oynani ochish
    modal.classList.remove('hidden');
    console.log(`🎉 [COMPARISON ALERT] Operator ${currentUsername} (ID: ${userId}) uchun modal muvaffaqiyatli ochildi!`);
    console.log(`📱 [COMPARISON ALERT] Operator ${currentUsername} endi modal oynani ko'rmoqda`);
    
    // Feather iconlarni yangilash
    if (window.feather) {
        window.feather.replace();
        console.log(`✅ [COMPARISON ALERT] Operator ${currentUsername} uchun Feather iconlar yangilandi`);
    }
    
    console.log(`🎉 [COMPARISON ALERT] Operator ${currentUsername} uchun modal ochilish jarayoni yakunlandi`);
}

// Format number funksiyasi (3 xonali format - bo'sh joy bilan)
function formatNumber(num) {
    if (typeof num !== 'number') return '0';
    // 3 xonali format (bo'sh joy bilan, vergul emas)
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Notification badge'ni yangilash
async function updateNotificationBadge() {
    try {
        const res = await fetch('/api/notifications?unread_only=true');
        if (!res || !res.ok) return;
        
        const data = await res.json();
        const unreadCount = data.unread_count || 0;
        
        const notificationBadge = document.querySelector('#notifications-btn .notification-badge');
        if (notificationBadge) {
            if (unreadCount > 0) {
                notificationBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                notificationBadge.style.display = 'inline-block';
                notificationBadge.classList.add('pulse');
            } else {
                notificationBadge.style.display = 'none';
                notificationBadge.classList.remove('pulse');
            }
        }
    } catch (error) {
        // Silent error handling
    }
}

// "Tushundim" tugmasini qo'shish
function addNotificationAcknowledgeButton(notification) {
    const modal = document.getElementById('notifications-modal');
    if (!modal) return;
    
    // Eski tugmani olib tashlash
    const oldBtn = document.getElementById('notification-acknowledge-btn');
    if (oldBtn) oldBtn.remove();
    
    // Yangi tugma yaratish
    const acknowledgeBtn = document.createElement('button');
    acknowledgeBtn.id = 'notification-acknowledge-btn';
    acknowledgeBtn.className = 'btn btn-primary notification-acknowledge-btn';
    acknowledgeBtn.innerHTML = '<i data-feather="check"></i> Tushundim';
    acknowledgeBtn.onclick = () => {
        // Sahifani yoritishni olib tashlash
        document.body.classList.remove('notification-highlight');
        
        // Modal oynani yopish
        modal.classList.add('hidden');
        
        // Notification badge'ni yangilash
        updateNotificationBadge();
        
        // Feather iconlarni yangilash
        if (window.feather) {
            window.feather.replace();
        }
    };
    
    // Modal footer'ga qo'shish
    const modalBody = modal.querySelector('.notifications-modal-body');
    if (modalBody) {
        modalBody.appendChild(acknowledgeBtn);
    }
    
    if (window.feather) {
        window.feather.replace();
    }
}

function scheduleReconnect() {
    if (reconnectInterval) return;
    
    let attempts = 0;
    const maxAttempts = 5;
    const reconnectDelay = 3000; // 3 sekund
    
    reconnectInterval = setInterval(() => {
        attempts++;
        
        if (attempts > maxAttempts) {
            // console.log('Reconnect attempts exceeded. Switching to auto-refresh mode.');
            stopReconnecting();
            return;
        }
        
        // console.log(`Reconnecting... attempt ${attempts}`);
        connectWebSocket();
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            stopReconnecting();
        }
    }, reconnectDelay);
}

function stopReconnecting() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
}

function startAutoRefresh() {
    // Har 30 soniyada refresh (WebSocket ishlamasa fallback)
    autoRefreshInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            // console.log('Auto-refreshing (WebSocket offline)');
            refreshCurrentPage();
        }
    }, 30000); // 30 sekund
}

function refreshCurrentPage() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;
    
    const pageId = activePage.id;
    
    switch(pageId) {
        case 'dashboard':
            refreshCurrentDashboard();
            break;
        case 'users':
            const activeTab = document.querySelector('#user-tabs .active')?.dataset.status;
            if (activeTab) renderUsersByStatus(activeTab);
            break;
        // Boshqa sahifalar uchun ham qo'shiladi
    }
}

async function refreshCurrentDashboard() {
    const { dashboardDatePickerFP } = await import('./state.js');
    if (dashboardDatePickerFP && dashboardDatePickerFP.selectedDates[0]) {
        const date = flatpickr.formatDate(dashboardDatePickerFP.selectedDates[0], 'Y-m-d');
        updateDashboard(date);
    }
}

function setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Sahifa yashirin - WebSocket yopish
            // console.log('Page hidden - maintaining connection');
        } else {
            // Sahifa ko'rinishda - refresh
            // console.log('Page visible - refreshing');
            refreshCurrentPage();
            
            // Agar WebSocket yopilgan bo'lsa, qayta ulanish
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                connectWebSocket();
            }
        }
    });
}

export function sendWebSocketMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

export function closeWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
    }
    
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    stopReconnecting();
}

// Browser yopilganda WebSocket yopish
window.addEventListener('beforeunload', () => {
    closeWebSocket();
});
