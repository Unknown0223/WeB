// Real-time Module
// WebSocket va real-time ma'lumotlar boshqaruvi

import { state } from './state.js';
import { updateDashboard } from './dashboard.js';
import { renderModernUsers } from './users.js';
import { showToast } from './utils.js';
import { fetchUsers } from './api.js';

let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
let autoRefreshInterval = null;
let lastNotificationId = null; // Oxirgi ko'rsatilgan notification ID
let notificationDebounceTimer = null; // Notification debounce timer
let isComparisonModalOpen = false; // Comparison modal ochiqligini kuzatish
let comparisonNotificationsQueue = []; // Bildirishnomalar navbatida

export function initRealTime() {
    // WebSocket ulanish
    connectWebSocket();
    
    // Auto-refresh (fallback agar WebSocket ishlamasa)
    startAutoRefresh();
    
    // Page visibility API - sahifa ko'rinishda bo'lsa refresh
    setupVisibilityListener();
}

function connectWebSocket() {
    // Agar allaqachon ulanish mavjud bo'lsa, uni yopish
    if (ws && ws.readyState === WebSocket.OPEN) {
        return;
    }
    
    if (ws && ws.readyState === WebSocket.CONNECTING) {
        return;
    }
    
    // Eski ulanishni yopish
    if (ws) {
        try {
            ws.close();
        } catch (e) {
            // Ignore
        }
    }
    
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
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            if (reconnectAttempts > 0) {
                showToast('Real-time rejim yoqildi', 'success');
            }
            stopReconnecting();
            reconnectAttempts = 0;
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
            // Xatolikda qayta ulanishni rejalashtirish
            if (ws.readyState === WebSocket.CLOSED) {
                scheduleReconnect();
            }
        };
        
        ws.onclose = (event) => {
            if (event.code !== 1000 && event.code !== 1001) {
                console.error('[WEBSOCKET] Ulanish yopildi. Code:', event.code, 'Reason:', event.reason || 'N/A');
            }
            
            // Faqat noqonuniy yopilish holatlarida qayta ulanish
            // 1000 - normal closure (qayta ulanish kerak emas)
            // 1001 - going away (qayta ulanish kerak emas)
            // 1006 - abnormal closure (qayta ulanish kerak)
            if (event.code !== 1000 && event.code !== 1001) {
                scheduleReconnect();
            }
        };
    } catch (error) {
        console.error('❌ [WEBSOCKET] Ulanish yaratishda xatolik:', error);
        scheduleReconnect();
    }
}

/**
 * Comparison alert modal'ni ko'rsatish (yangi versiya - bir nechta bildirishnomalar)
 */
function showComparisonAlertModal(notification) {
    // Notification ID'sini tekshirish (takrorlanmasligi uchun)
    const notificationId = notification?.details?.date + '_' + notification?.details?.brand_id + '_' + (notification?.details?.total_differences || 0);
    
    // Agar bu bildirishnoma allaqachon navbatda bo'lsa, qo'shmaslik
    if (comparisonNotificationsQueue.some(n => n.id === notificationId)) {
        return;
    }
    
    if (!notification?.details?.differences || !Array.isArray(notification.details.differences)) {
        console.error('[REALTIME] Differences array mavjud emas');
        return;
    }
    
    // Bildirishnomani navbatga qo'shish
    comparisonNotificationsQueue.push({
        id: notificationId,
        notification: notification,
        timestamp: Date.now()
    });
    
    
    // Modal'ni ochish va render qilish
    renderComparisonModal();
}

/**
 * Comparison modal'ni render qilish (barcha bildirishnomalarni ko'rsatish)
 */
function renderComparisonModal() {
    const modal = document.getElementById('comparison-alert-modal');
    const container = document.getElementById('comparison-alert-notifications-container');
    const acknowledgeBtn = document.getElementById('comparison-alert-acknowledge-btn');
    
    if (!modal || !container || !acknowledgeBtn) {
        console.error('❌ [REALTIME] Comparison alert modal elementlari topilmadi');
        return;
    }
    
    // Agar navbat bo'sh bo'lsa, modal'ni yopish
    if (comparisonNotificationsQueue.length === 0) {
        modal.classList.add('hidden');
        document.body.classList.remove('comparison-alert-active');
        isComparisonModalOpen = false;
        return;
    }
    
    // Modal ochiqligini belgilash
    isComparisonModalOpen = true;
    
    // Barcha bildirishnomalarni render qilish
    let notificationsHtml = '';
    
    comparisonNotificationsQueue.forEach((item, index) => {
        const notification = item.notification;
        const details = notification?.details || {};
        const message = notification?.message || 'Solishtirishda farqlar aniqlandi';
        
        let detailsHtml = '';
        
        if (details.brand_name || details.date) {
            detailsHtml = `
                <div class="alert-detail-item">
                    <span class="detail-label">Brend:</span>
                    <span class="detail-value">${details.brand_name || 'Noma\'lum'}</span>
                </div>
                <div class="alert-detail-item">
                    <span class="detail-label">Sana:</span>
                    <span class="detail-value">${details.date || 'Noma\'lum'}</span>
                </div>
                <div class="alert-detail-item">
                    <span class="detail-label">Farqlar soni:</span>
                    <span class="detail-value highlight">${details.total_differences || 0} ta filial</span>
                </div>
            `;
            
            // Farqlar ro'yxatini ko'rsatish
            if (details.differences && details.differences.length > 0) {
                detailsHtml += `
                    <div class="alert-differences-list">
                        <div class="alert-differences-header">
                            <i data-feather="map-pin"></i>
                            <span>Filiallar:</span>
                        </div>
                        <div class="alert-differences-items">
                            ${details.differences.map((diff) => {
                                const diffValue = diff.difference || 0;
                                const diffColor = diffValue > 0 ? 'var(--green-color)' : 'var(--red-color)';
                                const diffSign = diffValue > 0 ? '+' : '';
                                
                                // Operator amount va comparison amount'ni to'g'ri formatlash
                                const operatorAmount = diff.operator_amount !== null && diff.operator_amount !== undefined 
                                    ? Number(diff.operator_amount) 
                                    : 0;
                                const comparisonAmount = diff.comparison_amount !== null && diff.comparison_amount !== undefined 
                                    ? Number(diff.comparison_amount) 
                                    : 0;
                                
                                return `
                                    <div class="alert-difference-item">
                                        <div class="alert-difference-location">
                                            <i data-feather="map-pin"></i>
                                            <span>${diff.location || 'Noma\'lum'}</span>
                                        </div>
                                        <div class="alert-difference-details">
                                            <div class="difference-row">
                                                <span class="difference-label">Operator summa:</span>
                                                <span class="difference-value operator-amount">${operatorAmount.toLocaleString('ru-RU')} so'm</span>
                                            </div>
                                            <div class="difference-row">
                                                <span class="difference-label">Solishtirish summa:</span>
                                                <span class="difference-value comparison-amount">${comparisonAmount.toLocaleString('ru-RU')} so'm</span>
                                            </div>
                                            <div class="difference-row">
                                                <span class="difference-label">Farq:</span>
                                                <span class="difference-value difference-amount" style="color: ${diffColor};">${diffSign}${Math.abs(diffValue).toLocaleString('ru-RU')} so'm</span>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
        } else {
            detailsHtml = '<div class="empty-state">Batafsil ma\'lumotlar mavjud emas</div>';
        }
        
        notificationsHtml += `
            <div class="comparison-notification-item" data-notification-id="${item.id}">
                <div class="comparison-notification-header">
                    <div class="comparison-notification-icon">
                        <i data-feather="alert-triangle"></i>
                    </div>
                    <div class="comparison-notification-title">
                        <h3>Solishtirishda farqlar aniqlandi #${index + 1}</h3>
                        <p class="comparison-notification-message">${message}</p>
                    </div>
                </div>
                <div class="comparison-notification-details">
                    ${detailsHtml}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = notificationsHtml;
    
    // "Tushundim" tugmasi event listener
    acknowledgeBtn.onclick = () => {
        // Barcha bildirishnomalarni navbatdan olib tashlash
        comparisonNotificationsQueue = [];
        lastNotificationId = null;
        
        // Modal'ni yopish
        modal.classList.add('hidden');
        document.body.classList.remove('comparison-alert-active');
        isComparisonModalOpen = false;
        
        if (window.feather) {
            window.feather.replace();
        }
        
    };
    
    // Modal'ni ochish
    modal.classList.remove('hidden');
    document.body.classList.add('comparison-alert-active');
    
    // Feather iconlarni yangilash
    if (window.feather) {
        window.feather.replace();
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
            // Foydalanuvchi statusi o'zgardi (online/offline)
            
            const user = state.users?.find(u => u.id === payload.userId);
            if (user) {
                user.is_online = payload.isOnline;
                
                // Admin panelda yangilash (darhol)
                const usersPage = document.getElementById('users');
                if (usersPage && usersPage.classList.contains('active')) {
                    
                    // Modern render funksiyasini darhol chaqirish (immediate = true)
                    if (typeof renderModernUsers === 'function') {
                        renderModernUsers(true); // immediate = true
                    } else {
                        import('./users.js').then(module => {
                            if (module.renderModernUsers) {
                                module.renderModernUsers(true);
                            }
                        });
                    }
                }
                
                // Statistikalarni yangilash
                if (typeof updateUsersStatistics === 'function') {
                    updateUsersStatistics();
                } else {
                    import('./users.js').then(module => {
                        if (module.updateUsersStatistics) {
                            module.updateUsersStatistics();
                        }
                    });
                }
            } else {
                console.log('⚠️ [REALTIME] User topilmadi, yangi ma\'lumotlar yuklash kerak');
                // Agar user topilmasa, ma'lumotlarni qayta yuklash
                if (typeof fetchUsers === 'function') {
                    fetchUsers().then(users => {
                        if (users) {
                            state.users = users;
                            const usersPage = document.getElementById('users');
                            if (usersPage && usersPage.classList.contains('active')) {
                                if (typeof renderModernUsers === 'function') {
                                    renderModernUsers();
                                } else {
                                    import('./users.js').then(module => {
                                        if (module.renderModernUsers) {
                                            module.renderModernUsers();
                                        }
                                    });
                                }
                            }
                        }
                    });
                }
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'new_report':
            // Yangi hisobot qo'shildi
            
            // Dashboard yangilash
            const dashboardPage = document.getElementById('dashboard');
            if (dashboardPage && dashboardPage.classList.contains('active')) {
                console.log('🔄 [REALTIME] Dashboard aktiv, yangilanmoqda...');
                refreshCurrentDashboard();
            }
            
            // KPI sahifasini yangilash
            const kpiPage = document.getElementById('employee-statistics');
            if (kpiPage && kpiPage.classList.contains('active')) {
                console.log('🔄 [REALTIME] KPI sahifasi aktiv, yangilanmoqda...');
                import('./kpi.js').then(module => {
                    if (module.refreshKpiData) {
                        module.refreshKpiData();
                    }
                });
            }
            
            // Pivot sahifasini yangilash
            const pivotPage = document.getElementById('pivot-reports');
            if (pivotPage && pivotPage.classList.contains('active')) {
                console.log('🔄 [REALTIME] Pivot sahifasi aktiv, yangilanmoqda...');
                // Pivot jadvalini yangilash
                if (state.pivotGrid && typeof state.pivotGrid.refresh === 'function') {
                    state.pivotGrid.refresh();
                }
            }
            break;
            
        case 'report_edited':
            // Hisobot tahrirlandi
            
            // Dashboard yangilash
            const dashboardPageEdit = document.getElementById('dashboard');
            if (dashboardPageEdit && dashboardPageEdit.classList.contains('active')) {
                console.log('🔄 [REALTIME] Dashboard aktiv, yangilanmoqda...');
                refreshCurrentDashboard();
            }
            
            // KPI sahifasini yangilash
            const kpiPageEdit = document.getElementById('employee-statistics');
            if (kpiPageEdit && kpiPageEdit.classList.contains('active')) {
                console.log('🔄 [REALTIME] KPI sahifasi aktiv, yangilanmoqda...');
                import('./kpi.js').then(module => {
                    if (module.refreshKpiData) {
                        module.refreshKpiData();
                    }
                });
            }
            
            // Pivot sahifasini yangilash
            const pivotPageEdit = document.getElementById('pivot-reports');
            if (pivotPageEdit && pivotPageEdit.classList.contains('active')) {
                console.log('🔄 [REALTIME] Pivot sahifasi aktiv, yangilanmoqda...');
                if (state.pivotGrid && typeof state.pivotGrid.refresh === 'function') {
                    state.pivotGrid.refresh();
                }
            }
            break;
            
        case 'user_registered':
            // Yangi foydalanuvchi ro'yxatdan o'tdi
            
            // Pending users ro'yxatiga qo'shish
            if (!state.pendingUsers) {
                state.pendingUsers = [];
            }
            
            // Agar allaqachon mavjud bo'lmasa, qo'shish
            const existingPending = state.pendingUsers.find(u => u.id === payload.user?.id);
            if (!existingPending && payload.user) {
                state.pendingUsers.push(payload.user);
            }
            
            // Admin panelda yangilash
            const requestsPage = document.getElementById('requests');
            if (requestsPage && requestsPage.classList.contains('active')) {
                import('./users.js').then(module => {
                    if (module.renderPendingUsers) {
                        module.renderPendingUsers();
                    }
                });
            }
            
            // Users sahifasida ham statistikalarni yangilash
            const usersPage = document.getElementById('users');
            if (usersPage && usersPage.classList.contains('active')) {
                // Statistikalarni yangilash
                import('./users.js').then(module => {
                    if (module.renderModernUsers) {
                        // Avval users ro'yxatini yangilash
                        if (typeof fetchUsers === 'function') {
                            fetchUsers().then(users => {
                                if (users) {
                                    state.users = users;
                                    module.renderModernUsers();
                                }
                            });
                        } else {
                            module.renderModernUsers();
                        }
                    }
                });
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'account_status_changed':
            // Akkaunt statusi o'zgardi (active/blocked/archived)
            
            // Users ro'yxatini yangilash
            if (state.users) {
                const user = state.users.find(u => u.id === payload.userId);
                if (user) {
                    user.status = payload.status;
                    
                    // Admin panelda yangilash
                    const usersPage = document.getElementById('users');
                    if (usersPage && usersPage.classList.contains('active')) {
                        
                        // Modern render funksiyasini chaqirish
                        if (typeof renderModernUsers === 'function') {
                            renderModernUsers();
                        } else {
                            import('./users.js').then(module => {
                                if (module.renderModernUsers) {
                                    module.renderModernUsers();
                                }
                            });
                        }
                    }
                    
                    // Statistikalarni yangilash
                    import('./users.js').then(module => {
                        // updateUsersStatistics funksiyasi users.js ichida bo'lishi mumkin
                    });
                } else {
                    // Agar user topilmasa, ma'lumotlarni qayta yuklash
                    console.error('[REALTIME] User topilmadi, yangi ma\'lumotlar yuklash kerak');
                    if (typeof fetchUsers === 'function') {
                        fetchUsers().then(users => {
                            if (users) {
                                state.users = users;
                                const usersPage = document.getElementById('users');
                                if (usersPage && usersPage.classList.contains('active')) {
                                    if (typeof renderModernUsers === 'function') {
                                        renderModernUsers();
                                    } else {
                                        import('./users.js').then(module => {
                                            if (module.renderModernUsers) {
                                                module.renderModernUsers();
                                            }
                                        });
                                    }
                                }
                            }
                        });
                    }
                }
            }
            
            // Pending users ro'yxatini yangilash (agar status pending bo'lmasa)
            if (payload.status !== 'pending_approval' && payload.status !== 'pending_telegram_subscription') {
                if (state.pendingUsers) {
                    state.pendingUsers = state.pendingUsers.filter(u => u.id !== payload.userId);
                }
                
                const requestsPage = document.getElementById('requests');
                if (requestsPage && requestsPage.classList.contains('active')) {
                    import('./users.js').then(module => {
                        if (module.renderPendingUsers) {
                            module.renderPendingUsers();
                        }
                    });
                }
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'brand_updated':
            // Brend yangilandi (yaratildi/yangilandi/o'chirildi)
            
            // Settings sahifasini yangilash
            const settingsPage = document.getElementById('settings');
            if (settingsPage && settingsPage.classList.contains('active')) {
                import('./brands.js').then(module => {
                    if (module.loadBrands) {
                        module.loadBrands();
                    }
                });
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'role_updated':
        case 'role_deleted':
            // Rol yangilandi yoki o'chirildi
            
            // Roles sahifasini yangilash
            const rolesPage = document.getElementById('roles');
            if (rolesPage && rolesPage.classList.contains('active')) {
                Promise.all([
                    import('./api.js'),
                    import('./state.js'),
                    import('./roles.js')
                ]).then(([apiModule, stateModule, rolesModule]) => {
                    // Joriy tanlangan rolni saqlash
                    const currentRole = stateModule.state.currentEditingRole;
                    const roleNameFromPayload = payload?.role_name;
                    
                    if (apiModule.fetchRoles) {
                        apiModule.fetchRoles().then(rolesData => {
                            
                            if (rolesData && rolesData.roles && Array.isArray(rolesData.roles)) {
                                stateModule.state.roles = rolesData.roles;
                                stateModule.state.allPermissions = rolesData.all_permissions || [];
                                
                                if (rolesModule.renderRoles) {
                                    // Agar yangi rol yaratilgan bo'lsa (role_updated va action: 'created'), uni tanlash
                                    // Aks holda joriy tanlangan rolni saqlash
                                    const roleToSelect = (type === 'role_updated' && payload?.action === 'created' && roleNameFromPayload) 
                                        ? roleNameFromPayload 
                                        : currentRole;
                                    
                                    rolesModule.renderRoles(roleToSelect);
                                }
                            } else {
                                console.error('[REALTIME] Roles ma\'lumotlari to\'g\'ri formatda emas:', rolesData);
                            }
                        }).catch(error => {
                            console.error('❌ [REALTIME] Roles yuklashda xatolik:', error);
                        });
                    }
                });
            }
            
            // Users sahifasini ham yangilash (chunki rol o'zgarganda user ma'lumotlari ham o'zgarishi mumkin)
            const usersPageRole = document.getElementById('users');
            if (usersPageRole && usersPageRole.classList.contains('active')) {
                import('./users.js').then(module => {
                    if (module.renderModernUsers) {
                        module.renderModernUsers();
                    }
                });
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'settings_updated':
            // Sozlama yangilandi
            
            // Settings sahifasini yangilash
            const settingsPageUpdate = document.getElementById('settings');
            if (settingsPageUpdate && settingsPageUpdate.classList.contains('active')) {
                
                // Sozlamalarni qayta yuklash
                import('./api.js').then(module => {
                    if (module.fetchSettings) {
                        module.fetchSettings().then(settings => {
                            if (settings) {
                                state.settings = { ...state.settings, ...settings };
                                
                                // Sozlamalar modulini yangilash
                                import('./settings.js').then(settingsModule => {
                                    if (payload.key === 'app_settings' && settingsModule.renderTableSettings) {
                                        settingsModule.renderTableSettings();
                                    } else if (payload.key === 'telegram_bot_token' || payload.key === 'telegram_bot_username' || payload.key === 'telegram_admin_chat_id' || payload.key === 'telegram_group_id') {
                                        if (settingsModule.renderTelegramSettings) {
                                            settingsModule.renderTelegramSettings();
                                        }
                                    } else if (payload.key === 'pagination_limit' || payload.key === 'branding_settings' || payload.key === 'kpi_settings') {
                                        if (payload.key === 'branding_settings' && settingsModule.renderGeneralSettings) {
                                            settingsModule.renderGeneralSettings();
                                        }
                                        if (payload.key === 'kpi_settings' && settingsModule.renderKpiSettings) {
                                            settingsModule.renderKpiSettings();
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
            }
            
            // Dashboard yangilash (agar sozlamalar dashboard'ga ta'sir qilsa)
            if (payload.key === 'app_settings' || payload.key === 'pagination_limit') {
                const dashboardPageSettings = document.getElementById('dashboard');
                if (dashboardPageSettings && dashboardPageSettings.classList.contains('active')) {
                    refreshCurrentDashboard();
                }
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'report_deleted':
            // Hisobot o'chirildi
            
            // Dashboard yangilash
            const dashboardPageDelete = document.getElementById('dashboard');
            if (dashboardPageDelete && dashboardPageDelete.classList.contains('active')) {
                console.log('🔄 [REALTIME] Dashboard aktiv, yangilanmoqda...');
                refreshCurrentDashboard();
            }
            
            // Reports sahifasini yangilash
            const reportsPageDelete = document.getElementById('reports');
            if (reportsPageDelete && reportsPageDelete.classList.contains('active')) {
                import('./reports.js').then(module => {
                    if (module.fetchAndRenderReports) {
                        module.fetchAndRenderReports();
                    }
                });
            }
            
            // KPI sahifasini yangilash
            const kpiPageDelete = document.getElementById('employee-statistics');
            if (kpiPageDelete && kpiPageDelete.classList.contains('active')) {
                console.log('🔄 [REALTIME] KPI sahifasi aktiv, yangilanmoqda...');
                import('./kpi.js').then(module => {
                    if (module.refreshKpiData) {
                        module.refreshKpiData();
                    }
                });
            }
            
            // Pivot sahifasini yangilash
            const pivotPageDelete = document.getElementById('pivot-reports');
            if (pivotPageDelete && pivotPageDelete.classList.contains('active')) {
                if (state.pivotGrid && typeof state.pivotGrid.refresh === 'function') {
                    state.pivotGrid.refresh();
                }
            }
            break;
            
        case 'user_created':
            // Yangi foydalanuvchi yaratildi (admin tomonidan)
            
            // Users sahifasini yangilash
            const usersPageCreate = document.getElementById('users');
            if (usersPageCreate && usersPageCreate.classList.contains('active')) {
                console.log('🔄 [REALTIME] Users sahifasi aktiv, yangilanmoqda...');
                import('./users.js').then(module => {
                    if (module.renderModernUsers) {
                        // Avval users ro'yxatini yangilash
                        if (typeof fetchUsers === 'function') {
                            fetchUsers().then(users => {
                                if (users) {
                                    state.users = users;
                                    module.renderModernUsers();
                                }
                            });
                        } else {
                            module.renderModernUsers();
                        }
                    }
                });
            }
            break;
            
        case 'comparison_updated':
            // Solishtirish yangilandi
            
            // Comparison sahifasini yangilash
            const comparisonPage = document.getElementById('comparison');
            if (comparisonPage && comparisonPage.classList.contains('active')) {
                import('./comparison.js').then(module => {
                    if (module.loadComparisonData) {
                        module.loadComparisonData(payload.date, payload.brandId);
                    } else if (module.refreshComparison) {
                        module.refreshComparison();
                    }
                });
            }
            break;
            
        case 'audit_log_added':
            // Audit log qo'shildi
            
            // Audit log sahifasini yangilash
            const auditPage = document.getElementById('audit');
            if (auditPage && auditPage.classList.contains('active')) {
                import('./audit.js').then(module => {
                    if (module.loadAuditLogs) {
                        module.loadAuditLogs();
                    } else if (module.refreshAuditLogs) {
                        module.refreshAuditLogs();
                    }
                });
            }
            
            // Security sahifasini yangilash (agar login/logout event bo'lsa)
            if (payload.action === 'login_success' || payload.action === 'login_fail' || payload.action === 'logout' || payload.action === 'account_lock') {
                const securityPage = document.getElementById('security');
                if (securityPage && securityPage.classList.contains('active')) {
                    import('./security.js').then(module => {
                        if (module.loadSecurityData) {
                            module.loadSecurityData();
                        }
                    });
                }
            }
            break;
            
        case 'user_updated':
            // Foydalanuvchi yangilandi
            
            // Users sahifasini yangilash
            const usersPageUpdate = document.getElementById('users');
            if (usersPageUpdate && usersPageUpdate.classList.contains('active')) {
                console.log('🔄 [REALTIME] Users sahifasi aktiv, yangilanmoqda...');
                
                // Agar user state'da mavjud bo'lsa, uni yangilash (tezkor)
                if (state.users) {
                    const userIndex = state.users.findIndex(u => u.id === payload.userId);
                    if (userIndex !== -1) {
                        // User ma'lumotlarini yangilash
                        state.users[userIndex] = {
                            ...state.users[userIndex],
                            username: payload.username || state.users[userIndex].username,
                            fullname: payload.fullname || state.users[userIndex].fullname,
                            role: payload.role || state.users[userIndex].role,
                            status: payload.status || state.users[userIndex].status
                        };
                        
                        // Darhol render qilish (tezkor)
                        if (typeof renderModernUsers === 'function') {
                            renderModernUsers(true); // immediate = true
                        } else {
                            import('./users.js').then(module => {
                                if (module.renderModernUsers) {
                                    module.renderModernUsers(true);
                                }
                            });
                        }
                    } else {
                        // Agar user topilmasa, to'liq yuklash
                        if (typeof fetchUsers === 'function') {
                            fetchUsers().then(users => {
                                if (users) {
                                    state.users = users;
                                    if (typeof renderModernUsers === 'function') {
                                        renderModernUsers(true);
                                    }
                                }
                            });
                        }
                    }
                } else {
                    // Agar state.users yo'q bo'lsa, yuklash
                    if (typeof fetchUsers === 'function') {
                        fetchUsers().then(users => {
                            if (users) {
                                state.users = users;
                                if (typeof renderModernUsers === 'function') {
                                    renderModernUsers(true);
                                }
                            }
                        });
                    }
                }
            }
            break;
            
        case 'user_password_changed':
        case 'user_secret_word_changed':
            // Parol yoki maxfiy so'z o'zgartirildi
            
            // Users sahifasini yangilash (agar kerak bo'lsa)
            const usersPagePassword = document.getElementById('users');
            if (usersPagePassword && usersPagePassword.classList.contains('active')) {
                if (typeof fetchUsers === 'function') {
                    fetchUsers().then(users => {
                        if (users) {
                            state.users = users;
                            if (typeof renderModernUsers === 'function') {
                                renderModernUsers();
                            } else {
                                import('./users.js').then(module => {
                                    if (module.renderModernUsers) {
                                        module.renderModernUsers();
                                    }
                                });
                            }
                        }
                    });
                }
            }
            break;
            
        case 'user_permissions_updated':
        case 'user_permissions_reset':
            // Foydalanuvchi huquqlari o'zgartirildi
            
            // Users sahifasini yangilash
            const usersPagePerms = document.getElementById('users');
            if (usersPagePerms && usersPagePerms.classList.contains('active')) {
                if (typeof fetchUsers === 'function') {
                    fetchUsers().then(users => {
                        if (users) {
                            state.users = users;
                            if (typeof renderModernUsers === 'function') {
                                renderModernUsers();
                            } else {
                                import('./users.js').then(module => {
                                    if (module.renderModernUsers) {
                                        module.renderModernUsers();
                                    }
                                });
                            }
                        }
                    });
                }
            }
            break;
            
        case 'pivot_template_created':
        case 'pivot_template_updated':
        case 'pivot_template_deleted':
            // Pivot template yaratildi/yangilandi/o'chirildi
            
            // Pivot sahifasini yangilash
            const pivotPageTemplate = document.getElementById('pivot-reports');
            if (pivotPageTemplate && pivotPageTemplate.classList.contains('active')) {
                import('./pivot.js').then(module => {
                    if (module.loadTemplates) {
                        module.loadTemplates();
                    }
                });
            }
            break;
            
        case 'notification_read':
        case 'notifications_read_all':
            // Bildirishnoma o'qilgan deb belgilandi
            
            // Notification count'ni yangilash
            if (typeof window.checkUnreadNotifications === 'function') {
                window.checkUnreadNotifications();
            }
            
            // Notification modal ochiq bo'lsa, ro'yxatni yangilash
            const notificationModal = document.getElementById('notifications-modal');
            if (notificationModal && !notificationModal.classList.contains('hidden')) {
                if (typeof window.loadNotifications === 'function') {
                    window.loadNotifications();
                }
            }
            break;
            
        case 'exchange_rates_updated':
            // Valyuta kurslari yangilandi
            
            // Settings sahifasini yangilash (agar exchange rates ko'rsatilsa)
            const settingsPageRates = document.getElementById('settings');
            if (settingsPageRates && settingsPageRates.classList.contains('active')) {
                // Exchange rates yangilanishi kerak bo'lsa, bu yerda qo'shiladi
            }
            break;
            
        case 'comparison_difference':
            const currentUserId = state.currentUser?.id;
            if (payload.user_id && payload.user_id === currentUserId) {
                if (notificationDebounceTimer) {
                    clearTimeout(notificationDebounceTimer);
                }
                
                notificationDebounceTimer = setTimeout(() => {
                    showComparisonAlertModal(payload.notification);
                    
                    setTimeout(() => {
                        if (typeof window.checkUnreadNotifications === 'function') {
                            window.checkUnreadNotifications().catch(err => {
                                console.error('❌ [REALTIME] checkUnreadNotifications xatolik:', err);
                            });
                        }
                        
                        const modal = document.getElementById('notifications-modal');
                        if (modal && !modal.classList.contains('hidden')) {
                            if (typeof window.loadNotifications === 'function') {
                                window.loadNotifications().catch(err => {
                                    console.error('❌ [REALTIME] loadNotifications xatolik:', err);
                                });
                            }
                        }
                    }, 200);
                    
                    notificationDebounceTimer = null;
                }, 300);
            }
            break;
            
        default:
            console.error('[REALTIME] Noma\'lum xabar turi:', type, payload);
    }
}

function scheduleReconnect() {
    if (reconnectTimeout) {
        return;
    }
    
    const maxAttempts = 10; // 10 marta urinish
    const initialDelay = 1000; // 1 sekunddan boshlash
    const maxDelay = 10000; // Maksimal 10 sekund
    
    reconnectAttempts++;
    
    if (reconnectAttempts > maxAttempts) {
        console.error('[WEBSOCKET] Qayta ulanish urinishlari tugadi. Auto-refresh rejimiga o\'tildi.');
        stopReconnecting();
        return;
    }
    
    // Exponential backoff - har bir urinishda kechikish oshadi
    const delay = Math.min(initialDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);
    
    
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        
        // Agar allaqachon ulanish mavjud bo'lsa, to'xtatish
        if (ws && ws.readyState === WebSocket.OPEN) {
            stopReconnecting();
            return;
        }
        
        connectWebSocket();
    }, delay);
}

function stopReconnecting() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    reconnectAttempts = 0;
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
            if (typeof renderModernUsers === 'function') {
                renderModernUsers();
            } else {
                import('./users.js').then(module => {
                    if (module.renderModernUsers) {
                        module.renderModernUsers();
                    }
                });
            }
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
