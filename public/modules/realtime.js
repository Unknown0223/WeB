// Real-time Module
// WebSocket va real-time ma'lumotlar boshqaruvi

import { state } from './state.js';
import { updateDashboard } from './dashboard.js';
import { renderUsersByStatus } from './users.js';
import { showToast } from './utils.js';

let ws = null;
let reconnectInterval = null;
let autoRefreshInterval = null;

export function initRealTime() {
    // WebSocket ulanish
    connectWebSocket();
    
    // Auto-refresh (fallback agar WebSocket ishlamasa)
    startAutoRefresh();
    
    // Page visibility API - sahifa ko'rinishda bo'lsa refresh
    setupVisibilityListener();
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
            
        case 'comparison_difference':
            // Solishtirishda farqlar aniqlandi
            console.log('🔔 [REALTIME] Comparison difference notification qabul qilindi:', payload);
            
            // Faqat operatorlar uchun ko'rsatish
            const currentUserId = state.currentUser?.id;
            if (payload.user_id && payload.user_id === currentUserId) {
                console.log('🔔 [REALTIME] Notification joriy foydalanuvchiga tegishli');
                
                // Toast ko'rsatish
                const message = payload.notification?.message || 'Solishtirishda farqlar aniqlandi';
                showToast(`⚠️ ${message}`, false);
                
                // Notification'larni yangilash (agar modal ochiq bo'lsa)
                if (typeof window.checkUnreadNotifications === 'function') {
                    console.log('🔔 [REALTIME] Notification ro\'yxatini yangilash...');
                    window.checkUnreadNotifications();
                } else {
                    console.log('⚠️ [REALTIME] checkUnreadNotifications funksiyasi topilmadi');
                }
                
                // Avatar'ni yangilash - checkUnreadNotifications ichida updateAvatarNotificationState chaqiriladi
                // Shuning uchun faqat checkUnreadNotifications ni chaqirish kifoya
            } else {
                console.log(`ℹ️ [REALTIME] Notification boshqa foydalanuvchiga tegishli (user_id: ${payload.user_id}, current: ${currentUserId})`);
            }
            break;
            
        default:
            console.log('ℹ️ [REALTIME] Noma\'lum xabar turi:', type, payload);
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
