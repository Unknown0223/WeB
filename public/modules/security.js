// Security & Sessions Module - Enhanced
// Xavfsizlik va sessiyalar boshqaruvi

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { parseUserAgent, showConfirmDialog } from './utils.js';

let securityRefreshInterval = null;

// Initialize Enhanced Security Module
export function initEnhancedSecurity() {
    // console.log('🔒 Initializing Enhanced Security Module...');
    
    setupSecurityTabs();
    setupSecurityButtons();
    
    // Load my sessions first, then load statistics
    fetchAndRenderMySessions().then(() => {
        loadSecurityStatistics();
    });
    
    // Auto-refresh every 30 seconds
    securityRefreshInterval = setInterval(() => {
        refreshSecurityData();
    }, 30000);
}

export async function fetchAndRenderMySessions() {
    if (!DOM.mySessionsList) return;
    
    DOM.mySessionsList.innerHTML = '<div class="skeleton-item" style="height: 100px;"></div>';
    
    try {
        const res = await safeFetch('/api/users/me/sessions');
        if (!res || !res.ok) throw new Error('Sessiyalarni yuklab bo\'lmadi');
        state.mySessions = await res.json();
        renderMySessions();
    } catch (error) {
        DOM.mySessionsList.innerHTML = `<div class="empty-state error">${error.message}</div>`;
    }
}

function renderMySessions() {
    if (!DOM.mySessionsList) return;
    
    if (state.mySessions.length === 0) {
        DOM.mySessionsList.innerHTML = '<div class="empty-state">Aktiv sessiyalar topilmadi.</div>';
        return;
    }
    
    // Update count badge
    const countBadge = document.getElementById('my-sessions-count');
    if (countBadge) {
        countBadge.textContent = `${state.mySessions.length} ta sessiya`;
    }
    
    // Render as table like all sessions
    DOM.mySessionsList.innerHTML = `
        <div style="overflow-x: auto;">
            <table class="sessions-table">
                <thead>
                    <tr>
                        <th style="min-width: 140px;">
                            <i data-feather="monitor"></i> Qurilma
                        </th>
                        <th style="min-width: 140px;">
                            <i data-feather="globe"></i> Brauzer
                        </th>
                        <th style="min-width: 120px;">
                            <i data-feather="wifi"></i> IP Manzil
                        </th>
                        <th style="min-width: 200px;">
                            <i data-feather="map-pin"></i> Joylashuv
                        </th>
                        <th style="min-width: 160px;">
                            <i data-feather="clock"></i> Oxirgi Faollik
                        </th>
                        <th style="min-width: 100px;">
                            <i data-feather="activity"></i> Holat
                        </th>
                        <th style="min-width: 120px;">
                            <i data-feather="more-horizontal"></i> Amallar
                        </th>
                    </tr>
                </thead>
                <tbody>
                    ${state.mySessions.map(session => renderMySessionRow(session)).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    feather.replace();
}

// Render My Session Row (without username column)
function renderMySessionRow(session) {
    const ua = parseUserAgent(session.user_agent);
    const location = session.location || {};
    const locationText = location.city && location.countryName 
        ? `${location.city}, ${location.countryName}` 
        : (location.countryName || 'Noma\'lum');
    
    return `
        <tr class="session-row ${session.is_current ? 'current-session-row' : ''}" data-sid="${session.sid}">
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="session-device-icon" style="font-size: 24px;">${ua.deviceIcon}</span>
                    <div>
                        <strong style="display: block; font-size: 13px;">${ua.osFull}</strong>
                        <span style="font-size: 11px; color: #a0aec0;">${ua.device === 'mobile' ? 'Mobil' : ua.device === 'tablet' ? 'Planshet' : 'Kompyuter'}</span>
                    </div>
                </div>
            </td>
            <td>
                <div class="browser-info" title="${ua.raw || ''}">
                    <strong style="display: block; font-size: 13px;">${ua.browserFull}</strong>
                    <span style="font-size: 11px; color: #a0aec0;">${ua.browser}</span>
                </div>
            </td>
            <td>
                <code style="background: rgba(102, 126, 234, 0.1); padding: 4px 8px; border-radius: 4px; font-size: 12px;">${session.ip_address}</code>
            </td>
            <td>
                <div>
                    <strong style="display: block; font-size: 13px;">📍 ${locationText}</strong>
                    ${location.timezone ? `<span style="font-size: 11px; color: #a0aec0;">${location.timezone}</span>` : ''}
                </div>
            </td>
            <td>${formatDateTime(session.last_activity)}</td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="session-status-badge session-status-active">Aktiv</span>
                    ${session.is_current ? '<span class="session-current-badge">Joriy</span>' : ''}
                </div>
            </td>
            <td>
                ${!session.is_current ? `
                    <button class="btn btn-sm btn-danger terminate-session-btn" data-sid="${session.sid}" title="Bu sessiyani tugatish">
                        <i data-feather="log-out"></i>
                        Tugatish
                    </button>
                ` : '<span style="color: #10B981; font-weight: 500;">✓ Faol</span>'}
            </td>
        </tr>
    `;
}

// ==================== ENHANCED SECURITY FUNCTIONS ====================

// Setup Security Tabs
function setupSecurityTabs() {
    const tabs = document.querySelectorAll('.security-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.security-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            const tabContent = document.getElementById(`${tabName}-tab`);
            if (tabContent) {
                tabContent.classList.add('active');
                
                if (tabName === 'my-sessions') fetchAndRenderMySessions();
                else if (tabName === 'all-sessions') loadAllSessions();
                else if (tabName === 'security-logs') loadSecurityLogs();
                else if (tabName === 'security-settings') loadSecuritySettings();
            }
        });
    });
}

// Setup Buttons
function setupSecurityButtons() {
    document.getElementById('refresh-security-btn')?.addEventListener('click', refreshSecurityData);
    document.getElementById('terminate-all-btn')?.addEventListener('click', terminateAllSessions);
    document.getElementById('save-security-settings-btn')?.addEventListener('click', saveSecuritySettings);
    
    // Terminate individual sessions (event delegation)
    document.body.addEventListener('click', async (e) => {
        const terminateBtn = e.target.closest('.terminate-session-btn');
        if (terminateBtn) {
            const sid = terminateBtn.getAttribute('data-sid');
            if (!sid) return;
            
            const confirmed = await showConfirmDialog({
                title: 'Sessiyani tugatish',
                message: 'Bu sessiyani tugatishni xohlaysizmi?',
                confirmText: 'Ha, tugatish',
                cancelText: 'Bekor qilish',
                type: 'warning',
                icon: 'log-out'
            });
            if (!confirmed) return;
            
            try {
                const response = await safeFetch(`/api/sessions/${sid}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    throw new Error('Failed to terminate session');
                }
                
                const result = await response.json();
                alert('✅ ' + result.message);
                
                // Refresh data
                refreshSecurityData();
                
            } catch (error) {
                // console.error('Error terminating session:', error);
                alert('❌ Sessiyani tugatishda xatolik!');
            }
        }
    });
}

// Load Security Statistics
async function loadSecurityStatistics() {
    try {
        // Get my sessions count
        const mySessionsCount = state.mySessions?.length || 0;
        
        // Calculate unique devices
        const uniqueDevices = new Set();
        state.mySessions?.forEach(session => {
            const ua = parseUserAgent(session.user_agent);
            uniqueDevices.add(ua.device);
        });
        
        // Get last login time from sessions
        let lastLoginTime = '--:--';
        if (state.mySessions && state.mySessions.length > 0) {
            const sortedSessions = [...state.mySessions].sort((a, b) => 
                new Date(b.last_activity) - new Date(a.last_activity)
            );
            const lastSession = sortedSessions[0];
            if (lastSession && !lastSession.is_current) {
                const date = new Date(lastSession.last_activity);
                lastLoginTime = formatRelativeTime(lastSession.last_activity);
            } else if (sortedSessions[1]) {
                lastLoginTime = formatRelativeTime(sortedSessions[1].last_activity);
            }
        }
        
        // Calculate security level (based on session count and settings)
        let securityLevel = 'O\'rtacha';
        if (mySessionsCount <= 2) {
            securityLevel = 'Yuqori';
        } else if (mySessionsCount <= 4) {
            securityLevel = 'O\'rtacha';
        } else {
            securityLevel = 'Past';
        }
        
        // Update DOM
        document.getElementById('my-sessions-count').textContent = mySessionsCount;
        document.getElementById('active-devices-count').textContent = uniqueDevices.size || 0;
        document.getElementById('last-login-time').textContent = lastLoginTime;
        document.getElementById('security-level').textContent = securityLevel;
        
        // Update security level color
        const securityLevelEl = document.getElementById('security-level');
        if (securityLevelEl) {
            securityLevelEl.style.color = securityLevel === 'Yuqori' ? '#10B981' : 
                                          securityLevel === 'O\'rtacha' ? '#F59E0B' : '#EF4444';
        }
        
    } catch (error) {
        // console.error('Error loading security statistics:', error);
        document.getElementById('my-sessions-count').textContent = '0';
        document.getElementById('active-devices-count').textContent = '0';
        document.getElementById('last-login-time').textContent = '--:--';
        document.getElementById('security-level').textContent = '--';
    }
}

// Load All Sessions (Admin)
async function loadAllSessions() {
    const container = document.getElementById('all-sessions-list');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">Yuklanmoqda...</div>';
    
    try {
        const response = await safeFetch('/api/sessions/all');
        if (!response.ok) {
            throw new Error('Failed to fetch all sessions');
        }
        
        const sessions = await response.json();
        
        // Update admin statistics
        updateAdminStatistics(sessions);
        
        if (sessions.length === 0) {
            container.innerHTML = '<p style="text-align: center; padding: 40px; color: #a0aec0;">Faol sessiyalar yo\'q</p>';
            return;
        }
        
        container.innerHTML = `
            <div style="overflow-x: auto;">
                <table class="sessions-table">
                    <thead>
                        <tr>
                            <th style="min-width: 180px;">
                                <i data-feather="user"></i> Foydalanuvchi
                            </th>
                            <th style="min-width: 140px;">
                                <i data-feather="monitor"></i> Operatsion Tizim
                            </th>
                            <th style="min-width: 140px;">
                                <i data-feather="globe"></i> Brauzer
                            </th>
                            <th style="min-width: 120px;">
                                <i data-feather="wifi"></i> IP Manzil
                            </th>
                            <th style="min-width: 200px;">
                                <i data-feather="map-pin"></i> Joylashuv
                            </th>
                            <th style="min-width: 160px;">
                                <i data-feather="clock"></i> Oxirgi Faollik
                            </th>
                            <th style="min-width: 100px;">
                                <i data-feather="activity"></i> Holat
                            </th>
                            <th style="min-width: 120px;">
                                <i data-feather="more-horizontal"></i> Amallar
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sessions.map(session => renderTableSessionRow(session)).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        feather.replace();
        
    } catch (error) {
        // console.error('Error loading all sessions:', error);
        container.innerHTML = '<div class="error">Xatolik yuz berdi</div>';
    }
}

// Render Session as Table Row
function renderTableSessionRow(session) {
    const ua = parseUserAgent(session.user_agent);
    const location = session.location || {};
    const locationText = location.city && location.countryName 
        ? `${location.city}, ${location.countryName}` 
        : (location.countryName || 'Noma\'lum');
    
    return `
        <tr class="session-row" data-sid="${session.sid}">
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="session-device-icon" style="font-size: 24px;">${ua.deviceIcon}</span>
                    <div>
                        <strong style="display: block; font-size: 14px;">${session.full_name || session.username}</strong>
                        <span style="font-size: 12px; color: #a0aec0;">@${session.username}</span>
                    </div>
                </div>
            </td>
            <td>
                <div>
                    <strong style="display: block; font-size: 13px;">${ua.osFull}</strong>
                    <span style="font-size: 11px; color: #a0aec0;">${ua.device === 'mobile' ? 'Mobil' : ua.device === 'tablet' ? 'Planshet' : 'Kompyuter'}</span>
                </div>
            </td>
            <td>
                <div class="browser-info" title="${ua.raw || ''}">
                    <strong style="display: block; font-size: 13px;">${ua.browserFull}</strong>
                    <span style="font-size: 11px; color: #a0aec0;">${ua.browser}</span>
                </div>
            </td>
            <td>
                <code style="background: rgba(102, 126, 234, 0.1); padding: 4px 8px; border-radius: 4px; font-size: 12px;">${session.ip_address}</code>
            </td>
            <td>
                <div>
                    <strong style="display: block; font-size: 13px;">📍 ${locationText}</strong>
                    ${location.timezone ? `<span style="font-size: 11px; color: #a0aec0;">${location.timezone}</span>` : ''}
                </div>
            </td>
            <td>${formatDateTime(session.last_activity)}</td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="session-status-badge session-status-active">Aktiv</span>
                    ${session.is_current ? '<span class="session-current-badge">Joriy</span>' : ''}
                </div>
            </td>
            <td>
                ${!session.is_current ? `
                    <button class="btn btn-sm btn-danger terminate-session-btn" data-sid="${session.sid}" title="Bu sessiyani tugatish">
                        <i data-feather="log-out"></i>
                        Tugatish
                    </button>
                ` : '<span style="color: #10B981; font-weight: 500;">✓ Faol</span>'}
            </td>
        </tr>
    `;
}

// Load Security Logs
async function loadSecurityLogs() {
    const container = document.getElementById('security-logs-list');
    if (!container) return;
    
    container.innerHTML = '<div class="loading" style="text-align: center; padding: 60px; color: #a0aec0;"><i data-feather="loader" class="spin"></i><br>Yuklanmoqda...</div>';
    feather.replace();
    
    try {
        // Get active filter badge
        const activeBadge = document.querySelector('.filter-badge.active');
        const selectedType = activeBadge?.getAttribute('data-type') || '';
        
        // Get active date range
        const activeDateBtn = document.querySelector('.date-filter-btn.active');
        const dateRange = activeDateBtn?.getAttribute('data-range') || 'today';
        const customDate = document.getElementById('log-date-filter')?.value || '';
        
        // Build query string
        let url = '/api/security/logs?limit=100';
        
        // Add type filter
        if (selectedType) {
            url += `&type=${selectedType}`;
        }
        
        // Add date filter
        if (dateRange === 'custom' && customDate) {
            url += `&date=${customDate}`;
        } else if (dateRange !== 'custom') {
            // Calculate date based on range
            const today = new Date();
            let fromDate;
            
            switch (dateRange) {
                case 'today':
                    fromDate = new Date(today.setHours(0, 0, 0, 0));
                    break;
                case 'yesterday':
                    fromDate = new Date(today.setDate(today.getDate() - 1));
                    fromDate.setHours(0, 0, 0, 0);
                    break;
                case 'week':
                    fromDate = new Date(today.setDate(today.getDate() - 7));
                    break;
                case 'month':
                    fromDate = new Date(today.setMonth(today.getMonth() - 1));
                    break;
            }
            
            if (fromDate) {
                url += `&date=${fromDate.toISOString().split('T')[0]}`;
            }
        }
        
        const response = await safeFetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch security logs');
        }
        
        const logs = await response.json();
        
        // Update badge counts
        updateLogBadgeCounts(logs);
        
        if (logs.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px;">
                    <i data-feather="inbox" style="width: 64px; height: 64px; color: #4b5563; margin-bottom: 16px;"></i>
                    <p style="color: #6b7280; font-size: 16px; font-weight: 500;">Xavfsizlik hodisalari topilmadi</p>
                    <p style="color: #4b5563; font-size: 13px;">Boshqa filterni tanlang yoki sanani o'zgartiring</p>
                </div>
            `;
            feather.replace();
            return;
        }
        
        container.innerHTML = logs.map(log => renderLogItem(log)).join('');
        feather.replace();
        
        // Setup filters after rendering
        setupLogFilters();
        
    } catch (error) {
        // console.error('Error loading security logs:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 60px;">
                <i data-feather="alert-circle" style="width: 64px; height: 64px; color: #ef4444; margin-bottom: 16px;"></i>
                <p style="color: #ef4444; font-size: 16px; font-weight: 500;">Xatolik yuz berdi</p>
                <p style="color: #6b7280; font-size: 13px;">Loglarni yuklashda muammo yuz berdi</p>
            </div>
        `;
        feather.replace();
    }
}

// Update badge counts based on logs
function updateLogBadgeCounts(logs) {
    const counts = {
        all: logs.length,
        login: logs.filter(l => l.type === 'login').length,
        logout: logs.filter(l => l.type === 'logout').length,
        failed: logs.filter(l => l.type === 'failed').length,
        blocked: logs.filter(l => l.type === 'blocked').length,
        suspicious: logs.filter(l => l.type === 'suspicious').length
    };
    
    // Update badge count elements
    Object.keys(counts).forEach(type => {
        const countEl = document.getElementById(`count-${type}`);
        if (countEl) {
            countEl.textContent = counts[type];
        }
    });
}

// Setup Modern Log Filters
function setupLogFilters() {
    // Filter badges click handlers
    const filterBadges = document.querySelectorAll('.filter-badge[data-type]');
    filterBadges.forEach(badge => {
        badge.addEventListener('click', function() {
            // Remove active from all badges
            filterBadges.forEach(b => b.classList.remove('active'));
            // Add active to clicked badge
            this.classList.add('active');
            // Reload logs with selected type
            loadSecurityLogs();
        });
    });
    
    // Date range buttons
    const dateButtons = document.querySelectorAll('.date-filter-btn[data-range]');
    const dateInput = document.getElementById('log-date-filter');
    
    dateButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            dateButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const range = this.getAttribute('data-range');
            if (range === 'custom') {
                dateInput.style.display = 'block';
                dateInput.focus();
            } else {
                dateInput.style.display = 'none';
                // Auto-load logs with date range
                loadSecurityLogs();
            }
        });
    });
    
    // Date input change
    if (dateInput) {
        dateInput.addEventListener('change', () => {
            loadSecurityLogs();
        });
    }
    
    // Search input
    const searchInput = document.getElementById('log-search-input');
    const searchClear = document.getElementById('log-search-clear');
    
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            if (searchInput.value) {
                searchClear.style.display = 'block';
            } else {
                searchClear.style.display = 'none';
            }
            filterLogsLocally();
        }, 300));
    }
    
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.style.display = 'none';
            filterLogsLocally();
        });
    }
}

// Filter logs locally (client-side search)
function filterLogsLocally() {
    const searchTerm = document.getElementById('log-search-input')?.value.toLowerCase() || '';
    const logItems = document.querySelectorAll('.log-item');
    
    logItems.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Toggle log details on click
window.toggleLogDetails = function(element) {
    element.classList.toggle('expanded');
    feather.replace();
}

// Debounce helper
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// Update Admin Statistics
async function updateAdminStatistics(sessions) {
    try {
        // Total sessions count
        const totalSessions = sessions.length;
        
        // Unique active users
        const uniqueUsers = new Set(sessions.map(s => s.user_id)).size;
        
        // Get login stats from API
        const statsResponse = await safeFetch('/api/security/statistics');
        let loginToday = 0;
        let failedAttempts = 0;
        
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            loginToday = stats.successful_logins || 0;
            failedAttempts = stats.failed_logins || 0;
        }
        
        // Update DOM
        const totalSessionsEl = document.getElementById('total-sessions-count');
        const activeUsersEl = document.getElementById('active-users-count');
        const loginTodayEl = document.getElementById('login-today-count');
        const failedAttemptsEl = document.getElementById('failed-attempts-count');
        
        if (totalSessionsEl) totalSessionsEl.textContent = totalSessions;
        if (activeUsersEl) activeUsersEl.textContent = uniqueUsers;
        if (loginTodayEl) loginTodayEl.textContent = loginToday;
        if (failedAttemptsEl) failedAttemptsEl.textContent = failedAttempts;
        
    } catch (error) {
        // console.error('Error updating admin statistics:', error);
    }
}

// Render Log Item (Modern Timeline Style)
function renderLogItem(log) {
    const logClass = `log-item log-item-${log.type}`;
    const icon = getLogIcon(log.type);
    const date = new Date(log.timestamp);
    const time = date.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short' });
    
    return `
        <div class="${logClass}" data-log-id="${log.id}" onclick="toggleLogDetails(this)">
            <div class="log-icon">${icon}</div>
            <div class="log-content">
                <p class="log-message">${log.message}</p>
                <div class="log-meta">
                    <div class="log-meta-item">
                        <i data-feather="user"></i>
                        <strong>${log.username}</strong>
                        ${log.full_name ? `<span style="color: #6b7280;">(${log.full_name})</span>` : ''}
                    </div>
                    <div class="log-meta-item">
                        <i data-feather="wifi"></i>
                        ${log.ip_address}
                    </div>
                </div>
                
                <!-- Expanded Details (hidden by default) -->
                <div class="log-details">
                    <div class="log-details-grid">
                        <div class="log-detail-item">
                            <div class="log-detail-label">Foydalanuvchi</div>
                            <div class="log-detail-value">${log.username} ${log.full_name ? `(${log.full_name})` : ''}</div>
                        </div>
                        <div class="log-detail-item">
                            <div class="log-detail-label">IP Manzil</div>
                            <div class="log-detail-value">${log.ip_address}</div>
                        </div>
                        <div class="log-detail-item">
                            <div class="log-detail-label">Vaqt</div>
                            <div class="log-detail-value">${formatDateTime(log.timestamp)}</div>
                        </div>
                        <div class="log-detail-item">
                            <div class="log-detail-label">Hodisa ID</div>
                            <div class="log-detail-value">#${log.id}</div>
                        </div>
                        ${log.details ? `
                        <div class="log-detail-item" style="grid-column: 1 / -1;">
                            <div class="log-detail-label">Qo'shimcha Ma'lumot</div>
                            <div class="log-detail-value">${log.details}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            <div class="log-timestamp">
                <div class="log-time">${time}</div>
                <div class="log-date">${dateStr}</div>
            </div>
        </div>
    `;
}

// Load Security Settings
async function loadSecuritySettings() {
    try {
        const response = await safeFetch('/api/security/settings');
        if (!response.ok) {
            throw new Error('Failed to fetch security settings');
        }
        
        const settings = await response.json();
        
        document.getElementById('session-timeout').value = settings.session_timeout || 60;
        document.getElementById('max-sessions').value = settings.max_sessions || 5;
        document.getElementById('remember-me-enabled').checked = settings.remember_me !== false;
        document.getElementById('force-2fa').checked = settings.force_2fa || false;
        document.getElementById('block-multiple-logins').checked = settings.block_multiple_logins || false;
        document.getElementById('failed-login-limit').value = settings.failed_login_limit || 5;
        document.getElementById('block-duration').value = settings.block_duration || 30;
        document.getElementById('notify-new-login').checked = settings.notify_new_login !== false;
        document.getElementById('notify-failed-login').checked = settings.notify_failed_login !== false;
        document.getElementById('notify-telegram').checked = settings.notify_telegram || false;
        
    } catch (error) {
        // console.error('Error loading security settings:', error);
        // Use default values on error
        document.getElementById('session-timeout').value = 60;
        document.getElementById('max-sessions').value = 5;
        document.getElementById('remember-me-enabled').checked = true;
        document.getElementById('force-2fa').checked = false;
        document.getElementById('block-multiple-logins').checked = false;
        document.getElementById('failed-login-limit').value = 5;
        document.getElementById('block-duration').value = 30;
        document.getElementById('notify-new-login').checked = true;
        document.getElementById('notify-failed-login').checked = true;
        document.getElementById('notify-telegram').checked = false;
    }
}

// Save Security Settings
async function saveSecuritySettings() {
    try {
        const settings = {
            session_timeout: parseInt(document.getElementById('session-timeout').value),
            max_sessions: parseInt(document.getElementById('max-sessions').value),
            remember_me: document.getElementById('remember-me-enabled').checked,
            force_2fa: document.getElementById('force-2fa').checked,
            block_multiple_logins: document.getElementById('block-multiple-logins').checked,
            failed_login_limit: parseInt(document.getElementById('failed-login-limit').value),
            block_duration: parseInt(document.getElementById('block-duration').value),
            notify_new_login: document.getElementById('notify-new-login').checked,
            notify_failed_login: document.getElementById('notify-failed-login').checked,
            notify_telegram: document.getElementById('notify-telegram').checked
        };
        
        const response = await safeFetch('/api/security/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save security settings');
        }
        
        const result = await response.json();
        alert('✅ ' + result.message);
        
    } catch (error) {
        // console.error('Error saving security settings:', error);
        alert('❌ Sozlamalarni saqlashda xatolik!');
    }
}

// Terminate All Sessions
async function terminateAllSessions() {
    const confirmed = await showConfirmDialog({
        title: 'Barcha sessiyalarni tugatish',
        message: 'Barcha sessiyalarni tugatishni xohlaysizmi? (Joriy sessiya bundan mustasno)',
        confirmText: 'Ha, tugatish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'alert-triangle'
    });
    if (!confirmed) return;
    
    try {
        const response = await safeFetch('/api/sessions/terminate-all', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('Failed to terminate sessions');
        }
        
        const result = await response.json();
        alert('✅ ' + result.message);
        
        // Refresh data
        refreshSecurityData();
        
    } catch (error) {
        // console.error('Error terminating all sessions:', error);
        alert('❌ Sessiyalarni tugatishda xatolik!');
    }
}

// Realtime yangilanish uchun funksiya
export function loadSecurityData() {
    console.log('🔄 [SECURITY] Security ma\'lumotlari yangilanmoqda...');
    refreshSecurityData();
}

// Refresh Security Data
function refreshSecurityData() {
    // console.log('🔄 Refreshing security data...');
    
    const activeTab = document.querySelector('.security-tab.active');
    if (activeTab) {
        const tabName = activeTab.getAttribute('data-tab');
        if (tabName === 'my-sessions') {
            fetchAndRenderMySessions().then(() => {
                loadSecurityStatistics();
            });
        } else if (tabName === 'all-sessions') {
            loadAllSessions();
        } else if (tabName === 'security-logs') {
            loadSecurityLogs();
        }
    } else {
        // If no active tab, just refresh my sessions and stats
        fetchAndRenderMySessions().then(() => {
            loadSecurityStatistics();
        });
    }
}

// Helper Functions
function getLogIcon(type) {
    const icons = {
        'login': '✅',
        'logout': '👋',
        'failed_login': '❌',
        'blocked': '🚫',
        'suspicious': '⚠️'
    };
    return icons[type] || '📝';
}

function formatRelativeTime(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    let diff = Math.floor((now - time) / 1000);
    
    // Handle invalid or future dates
    if (isNaN(diff) || diff < 0) {
        return 'Hozir';
    }
    
    // Seconds
    if (diff < 60) {
        return `${diff} soniya oldin`;
    }
    
    // Minutes
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) {
        return `${minutes} daqiqa oldin`;
    }
    
    // Hours (with minutes)
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const remainingMinutes = minutes % 60;
        if (remainingMinutes > 0) {
            return `${hours} soat ${remainingMinutes} daqiqa oldin`;
        }
        return `${hours} soat oldin`;
    }
    
    // Days
    const days = Math.floor(hours / 24);
    if (days < 30) {
        return `${days} kun oldin`;
    }
    
    // Months
    const months = Math.floor(days / 30);
    if (months < 12) {
        return `${months} oy oldin`;
    }
    
    // Years
    const years = Math.floor(months / 12);
    return `${years} yil oldin`;
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('uz-UZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
