// Real-time Module
// WebSocket va real-time ma'lumotlar boshqaruvi

import { state } from './state.js';
import { updateDashboard } from './dashboard.js';
import { renderUsersByStatus } from './users.js';
import { showToast } from './utils.js';
import { fetchUsers } from './api.js';

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

/**
 * Comparison alert modal'ni ko'rsatish
 */
function showComparisonAlertModal(notification) {
    console.log('🔔 [REALTIME] Comparison alert modal ochilmoqda...');
    
    const modal = document.getElementById('comparison-alert-modal');
    const messageEl = document.getElementById('comparison-alert-message');
    const detailsEl = document.getElementById('comparison-alert-details');
    const acknowledgeBtn = document.getElementById('comparison-alert-acknowledge-btn');
    
    if (!modal || !messageEl || !detailsEl || !acknowledgeBtn) {
        console.error('❌ [REALTIME] Comparison alert modal elementlari topilmadi');
        return;
    }
    
    // Xabarni ko'rsatish
    const message = notification?.message || 'Solishtirishda farqlar aniqlandi';
    messageEl.textContent = message;
    
    // Batafsil ma'lumotlarni ko'rsatish
    const details = notification?.details || {};
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
                        ${details.differences.map(diff => {
                            const diffValue = diff.difference || 0;
                            const diffColor = diffValue > 0 ? 'var(--green-color)' : 'var(--red-color)';
                            const diffSign = diffValue > 0 ? '+' : '';
                            
                            return `
                                <div class="alert-difference-item">
                                    <div class="alert-difference-location">
                                        <i data-feather="map-pin"></i>
                                        <span>${diff.location || 'Noma\'lum'}</span>
                                    </div>
                                    <div class="alert-difference-details">
                                        <div class="difference-row">
                                            <span class="difference-label">Operator summa:</span>
                                            <span class="difference-value operator-amount">${(diff.operator_amount || 0).toLocaleString('ru-RU')} so'm</span>
                                        </div>
                                        <div class="difference-row">
                                            <span class="difference-label">Solishtirish summa:</span>
                                            <span class="difference-value comparison-amount">${(diff.comparison_amount || 0).toLocaleString('ru-RU')} so'm</span>
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
    
    detailsEl.innerHTML = detailsHtml;
    
    // "Tushundim" tugmasi event listener
    acknowledgeBtn.onclick = () => {
        console.log('✅ [REALTIME] Comparison alert modal yopilmoqda...');
        modal.classList.add('hidden');
        document.body.classList.remove('comparison-alert-active');
        
        // Feather iconlarni yangilash
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
    
    console.log('✅ [REALTIME] Comparison alert modal ochildi');
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
            console.log('🔔 [REALTIME] User status o\'zgardi:', payload);
            
            const user = state.users?.find(u => u.id === payload.userId);
            if (user) {
                user.is_online = payload.isOnline;
                
                // Admin panelda yangilash
                const usersPage = document.getElementById('users');
                if (usersPage && usersPage.classList.contains('active')) {
                    console.log('🔄 [REALTIME] Users sahifasi aktiv, yangilanmoqda...');
                    
                    // Modern render funksiyasini chaqirish
                    if (typeof renderUsersByStatus === 'function') {
                        const activeTab = document.querySelector('#user-tabs .active')?.dataset.status || 'all';
                        renderUsersByStatus(activeTab);
                    } else {
                        // Agar renderModernUsers mavjud bo'lsa
                        import('./users.js').then(module => {
                            if (module.renderModernUsers) {
                                module.renderModernUsers();
                            }
                        });
                    }
                }
                
                // Statistikalarni yangilash
                if (typeof updateUsersStatistics === 'function') {
                    updateUsersStatistics();
                } else {
                    import('./users.js').then(module => {
                        // updateUsersStatistics funksiyasi users.js ichida bo'lishi mumkin
                        // Lekin u export qilinmagan bo'lishi mumkin
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
                                const activeTab = document.querySelector('#user-tabs .active')?.dataset.status || 'all';
                                renderUsersByStatus(activeTab);
                            }
                        }
                    });
                }
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'new_report':
            // Yangi hisobot qo'shildi
            console.log('🔔 [REALTIME] Yangi hisobot qo\'shildi:', payload);
            
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
            console.log('🔔 [REALTIME] Hisobot tahrirlandi:', payload);
            
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
            console.log('🔔 [REALTIME] Yangi foydalanuvchi ro\'yxatdan o\'tdi:', payload);
            
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
                console.log('🔄 [REALTIME] Requests sahifasi aktiv, yangilanmoqda...');
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
            console.log('🔔 [REALTIME] Account status o\'zgardi:', payload);
            
            // Users ro'yxatini yangilash
            if (state.users) {
                const user = state.users.find(u => u.id === payload.userId);
                if (user) {
                    user.status = payload.status;
                    
                    // Admin panelda yangilash
                    const usersPage = document.getElementById('users');
                    if (usersPage && usersPage.classList.contains('active')) {
                        console.log('🔄 [REALTIME] Users sahifasi aktiv, yangilanmoqda...');
                        
                        // Modern render funksiyasini chaqirish
                        if (typeof renderUsersByStatus === 'function') {
                            const activeTab = document.querySelector('#user-tabs .active')?.dataset.status || 'all';
                            renderUsersByStatus(activeTab);
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
                    console.log('⚠️ [REALTIME] User topilmadi, yangi ma\'lumotlar yuklash kerak');
                    if (typeof fetchUsers === 'function') {
                        fetchUsers().then(users => {
                            if (users) {
                                state.users = users;
                                const usersPage = document.getElementById('users');
                                if (usersPage && usersPage.classList.contains('active')) {
                                    const activeTab = document.querySelector('#user-tabs .active')?.dataset.status || 'all';
                                    renderUsersByStatus(activeTab);
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
            console.log('🔔 [REALTIME] Brend yangilandi:', payload);
            
            // Settings sahifasini yangilash
            const settingsPage = document.getElementById('settings');
            if (settingsPage && settingsPage.classList.contains('active')) {
                console.log('🔄 [REALTIME] Settings sahifasi aktiv, brendlar yangilanmoqda...');
                import('./brands.js').then(module => {
                    if (module.loadBrands) {
                        module.loadBrands();
                    }
                });
            }
            
            // Faqat ma'lumotlarni yangilash, toast ko'rsatilmaydi
            break;
            
        case 'role_updated':
            // Rol yangilandi
            console.log('🔔 [REALTIME] Rol yangilandi:', payload);
            
            // Roles sahifasini yangilash
            const rolesPage = document.getElementById('roles');
            if (rolesPage && rolesPage.classList.contains('active')) {
                console.log('🔄 [REALTIME] Roles sahifasi aktiv, yangilanmoqda...');
                import('./roles.js').then(module => {
                    if (module.renderRoles) {
                        module.renderRoles();
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
            console.log('🔔 [REALTIME] Sozlama yangilandi:', payload);
            
            // Settings sahifasini yangilash
            const settingsPageUpdate = document.getElementById('settings');
            if (settingsPageUpdate && settingsPageUpdate.classList.contains('active')) {
                console.log('🔄 [REALTIME] Settings sahifasi aktiv, yangilanmoqda...');
                
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
            
        case 'audit_log_added':
            // Audit log qo'shildi
            console.log('🔔 [REALTIME] Audit log qo\'shildi:', payload);
            
            // Audit log sahifasini yangilash
            const auditPage = document.getElementById('audit');
            if (auditPage && auditPage.classList.contains('active')) {
                console.log('🔄 [REALTIME] Audit log sahifasi aktiv, yangilanmoqda...');
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
                    console.log('🔄 [REALTIME] Security sahifasi aktiv, yangilanmoqda...');
                    import('./security.js').then(module => {
                        if (module.loadSecurityData) {
                            module.loadSecurityData();
                        }
                    });
                }
            }
            break;
            
        case 'comparison_difference':
            // Solishtirishda farqlar aniqlandi
            console.log('🔔 [REALTIME] Comparison difference notification qabul qilindi:', payload);
            
            // Faqat operatorlar uchun ko'rsatish
            const currentUserId = state.currentUser?.id;
            if (payload.user_id && payload.user_id === currentUserId) {
                console.log('🔔 [REALTIME] Notification joriy foydalanuvchiga tegishli');
                
                // Modal oynada bildirishnoma ko'rsatish
                showComparisonAlertModal(payload.notification);
                
                // Notification'larni yangilash
                setTimeout(() => {
                    console.log('🔔 [REALTIME] Notification yangilash boshlandi...');
                    
                    // Unread count'ni yangilash va avatar'ni yangilash
                    if (typeof window.checkUnreadNotifications === 'function') {
                        console.log('🔔 [REALTIME] checkUnreadNotifications chaqirilmoqda...');
                        window.checkUnreadNotifications()
                            .then(() => {
                                console.log('✅ [REALTIME] checkUnreadNotifications muvaffaqiyatli bajarildi');
                            })
                            .catch(err => {
                                console.error('❌ [REALTIME] checkUnreadNotifications xatolik:', err);
                            });
                    } else {
                        console.warn('⚠️ [REALTIME] window.checkUnreadNotifications funksiyasi topilmadi');
                    }
                    
                    // Agar notification modal ochiq bo'lsa, ro'yxatni yangilash
                    const modal = document.getElementById('notifications-modal');
                    if (modal && !modal.classList.contains('hidden')) {
                        console.log('🔔 [REALTIME] Notification modal ochiq, ro\'yxat yangilanmoqda...');
                        if (typeof window.loadNotifications === 'function') {
                            window.loadNotifications()
                                .then(() => {
                                    console.log('✅ [REALTIME] Notification ro\'yxati yangilandi');
                                })
                                .catch(err => {
                                    console.error('❌ [REALTIME] loadNotifications xatolik:', err);
                                });
                        } else {
                            console.warn('⚠️ [REALTIME] window.loadNotifications funksiyasi topilmadi');
                        }
                    } else {
                        console.log('ℹ️ [REALTIME] Notification modal yopiq, ro\'yxat yangilanmaydi');
                    }
                }, 200); // DOM tayyor bo'lishi uchun kichik kechikish
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
