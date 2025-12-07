// Users Module (MODERNIZED)
// Foydalanuvchilarni boshqarish (CRUD, sessions, credentials, telegram)

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch, fetchUsers, fetchPendingUsers } from './api.js';
import { showToast, parseUserAgent, showConfirmDialog } from './utils.js';

// Selected users for bulk actions
let selectedUsers = new Set();

// Current filters
let currentFilters = {
    search: '',
    role: '',
    accountStatus: '',  // active, pending, inactive
    onlineStatus: ''     // online, offline
};

// Brendlarni yuklash va render qilish
async function loadBrandsForUser(userId = null) {
    try {
        // Barcha brendlarni olish
        const res = await safeFetch('/api/brands');
        if (!res.ok) throw new Error('Brendlarni yuklashda xatolik');
        const allBrands = await res.json();
        
        // Agar userId berilgan bo'lsa, foydalanuvchining brendlarini olish
        let userBrands = [];
        if (userId) {
            const userBrandsRes = await safeFetch(`/api/brands/user/${userId}`);
            if (userBrandsRes.ok) {
                const data = await userBrandsRes.json();
                userBrands = data.brands || [];
            }
        }
        
        // Brendlar ro'yxatini render qilish - user-brands-list yoki approval-brands-list
        const container = document.getElementById('user-brands-list') || document.getElementById('approval-brands-list');
        if (!container) return;
        
        if (allBrands.length === 0) {
            container.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center;">Avval brendlar yarating</p>';
            return;
        }
        
        const allChecked = allBrands.every(brand => userBrands.some(ub => ub.id === brand.id));
        
        let html = `
            <label class="checkbox-item" style="
                display: flex;
                align-items: center;
                padding: 10px;
                border-radius: 6px;
                cursor: pointer;
                background: rgba(79, 172, 254, 0.1);
                border: 1px solid rgba(79, 172, 254, 0.3);
                margin-bottom: 10px;
                font-weight: 600;
            ">
                <input type="checkbox" class="select-all-brands-checkbox" ${allChecked ? 'checked' : ''} 
                    style="margin-right: 10px; width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 14px; color: #4facfe;">✓ Barchasi</span>
            </label>
            <div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0;"></div>
        `;
        
        html += allBrands.map(brand => {
            const isChecked = userBrands.some(ub => ub.id === brand.id);
            const brandEmoji = brand.emoji || '🏢';
            const brandColor = brand.color || '#4facfe';
            
            return `
                <label class="checkbox-item brand-checkbox-label" style="
                    display: flex;
                    align-items: center;
                    padding: 8px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    <input type="checkbox" name="user-brand" value="${brand.id}" ${isChecked ? 'checked' : ''} 
                        class="brand-checkbox" style="margin-right: 10px; width: 16px; height: 16px; cursor: pointer;">
                    <span style="font-size: 20px; margin-right: 8px;">${brandEmoji}</span>
                    <span style="font-size: 14px; color: ${brandColor};">${brand.name}</span>
                </label>
            `;
        }).join('');
        
        container.innerHTML = html;
        
        // Barchasi checkbox event listener
        const selectAllCheckbox = container.querySelector('.select-all-brands-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                const checkboxes = container.querySelectorAll('.brand-checkbox');
                checkboxes.forEach(cb => {
                    cb.checked = e.target.checked;
                });
            });
        }
        
        // Individual checkbox event listener
        const brandCheckboxes = container.querySelectorAll('.brand-checkbox');
        brandCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const allChecked = Array.from(brandCheckboxes).every(checkbox => checkbox.checked);
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = allChecked;
                }
            });
        });
        
        // Hover effects
        container.querySelectorAll('.brand-checkbox-label').forEach(label => {
            label.addEventListener('mouseenter', () => {
                label.style.background = 'rgba(255,255,255,0.05)';
            });
            label.addEventListener('mouseleave', () => {
                label.style.background = 'transparent';
            });
        });
    } catch (error) {
        // console.error('Brendlarni yuklash xatosi:', error);
        showToast('Brendlarni yuklashda xatolik', 'error');
    }
}

// Modern render function with filters
export function renderModernUsers() {
    if (!state.users || !DOM.userListContainer) return;

    // Apply filters
    let filteredUsers = state.users.filter(user => {
        // Super admin'ni faqat super admin o'zi ko'rsin
        if (user.role === 'super_admin' && state.currentUser?.role !== 'super_admin') {
            return false;
        }
        
        // Role filter
        if (currentFilters.role && user.role !== currentFilters.role) return false;

        // Account Status filter
        if (currentFilters.accountStatus) {
            if (currentFilters.accountStatus === 'active' && user.status !== 'active') return false;
            if (currentFilters.accountStatus === 'pending' && !user.status.startsWith('pending')) return false;
            if (currentFilters.accountStatus === 'inactive' && user.status !== 'blocked' && user.status !== 'archived') return false;
        }

        // Online Status filter
        if (currentFilters.onlineStatus) {
            if (currentFilters.onlineStatus === 'online' && !user.is_online) return false;
            if (currentFilters.onlineStatus === 'offline' && user.is_online) return false;
        }

        return true;
    });

    // Update statistics
    updateUsersStatistics();

    // Render
    if (filteredUsers.length === 0) {
        DOM.userListContainer.innerHTML = '<div class="empty-state"><i data-feather="users"></i><p>Foydalanuvchilar topilmadi</p></div>';
        feather.replace();
        return;
    }

    DOM.userListContainer.innerHTML = filteredUsers.map(user => renderModernUserCard(user)).join('');
    feather.replace();
}

// Render single modern user card
function renderModernUserCard(user) {
    const isOnline = user.is_online;
    const statusIndicator = isOnline ? 'online' : 'offline';
    
    // Get initials
    const initials = (user.fullname || user.username || 'U')
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    // Status badge
    const userStatus = user.status === 'blocked' || user.status === 'archived' ? 'inactive' : 
                      user.status.startsWith('pending') ? 'pending' : 'active';

    return `
        <div class="user-card" data-user-id="${user.id}">
            <div class="user-card-header">
                <input type="checkbox" class="user-card-checkbox" 
                       data-user-id="${user.id}"
                       onchange="window.toggleUserSelection(${user.id}, this)">
                
                <div class="user-card-avatar">
                    ${initials}
                    <div class="user-card-status-indicator ${statusIndicator}"></div>
                </div>

                <div class="user-card-info">
                    <div class="user-card-name">
                        ${user.fullname || user.username}
                    </div>
                    <div class="user-card-username">@${user.username}</div>
                    <div class="user-card-badges">
                        <span class="user-badge user-badge-${user.role}">
                            <i data-feather="${user.role === 'admin' ? 'shield' : 'user'}"></i>
                            ${user.role}
                        </span>
                        <span class="user-badge user-badge-${userStatus}">
                            <i data-feather="${userStatus === 'active' ? 'check-circle' : userStatus === 'pending' ? 'clock' : 'x-circle'}"></i>
                            ${userStatus === 'active' ? 'Aktiv' : userStatus === 'pending' ? 'Kutmoqda' : 'Noaktiv'}
                        </span>
                    </div>
                </div>
            </div>

            <div class="user-card-details">
                ${user.email ? `
                <div class="user-card-detail-item">
                    <i data-feather="mail"></i>
                    <span>${user.email}</span>
                </div>
                ` : ''}
                ${user.phone ? `
                <div class="user-card-detail-item">
                    <i data-feather="phone"></i>
                    <span>${user.phone}</span>
                </div>
                ` : ''}
                <div class="user-card-detail-item">
                    <i data-feather="calendar"></i>
                    <span>Ro'yxatdan o'tgan: ${new Date(user.created_at).toLocaleDateString('uz-UZ')}</span>
                </div>
                <div class="user-card-detail-item">
                    <i data-feather="activity"></i>
                    <span>Sessiyalar: <strong>${user.active_sessions_count || 0}</strong></span>
                </div>
                ${user.telegram_username ? `
                <div class="user-card-detail-item">
                    <i data-feather="send"></i>
                    <span>Telegram: <strong>@${user.telegram_username}</strong></span>
                </div>
                ` : ''}
            </div>

            <div class="user-card-actions">
                <button class="user-card-action-btn edit-user-btn" data-id="${user.id}" title="Tahrirlash" data-permission="users:edit">
                    <i data-feather="edit-2"></i>
                    Tahrirlash
                </button>
                <button class="user-card-action-btn manage-sessions-btn" data-id="${user.id}" data-username="${user.username}" title="Sessiyalar" data-permission="users:manage_sessions">
                    <i data-feather="monitor"></i>
                    Sessiyalar
                </button>
                ${state.currentUser.id !== user.id ? `
                <button class="user-card-action-btn danger ${user.status === 'active' ? 'deactivate-user-btn' : 'activate-user-btn'}" 
                        data-id="${user.id}" 
                        title="${user.status === 'active' ? 'Bloklash' : 'Aktivlashtirish'}" 
                        data-permission="users:change_status">
                    <i data-feather="${user.status === 'active' ? 'eye-off' : 'eye'}"></i>
                    ${user.status === 'active' ? 'Bloklash' : 'Aktivlashtirish'}
                </button>
                ` : ''}
            </div>
        </div>
    `;
}

// Update statistics cards
function updateUsersStatistics() {
    if (!state.users) return;

    const totalUsers = state.users.length;
    const activeUsers = state.users.filter(u => u.status === 'active').length;
    const pendingUsers = state.users.filter(u => u.status.startsWith('pending')).length;
    const inactiveUsers = state.users.filter(u => u.status === 'blocked' || u.status === 'archived').length;

    const activePercent = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
    const inactivePercent = totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0;

    // Update DOM
    document.getElementById('total-users-count').textContent = totalUsers;
    document.getElementById('active-users-count').textContent = activeUsers;
    document.getElementById('pending-users-count').textContent = pendingUsers;
    document.getElementById('inactive-users-count').textContent = inactiveUsers;
    
    document.getElementById('active-users-percent').textContent = `${activePercent}%`;
    document.getElementById('inactive-users-percent').textContent = `${inactivePercent}%`;

    // Update role counts
    const roleCounts = {};
    state.users.forEach(user => {
        const role = user.role || 'user';
        roleCounts[role] = (roleCounts[role] || 0) + 1;
    });

    // Update role count badges
    const roleCountAll = document.getElementById('role-count-all');
    if (roleCountAll) roleCountAll.textContent = totalUsers;

    Object.keys(roleCounts).forEach(role => {
        const countEl = document.getElementById(`role-count-${role}`);
        if (countEl) countEl.textContent = roleCounts[role];
    });

    // Update account status count badges
    const accountStatusCountAll = document.getElementById('account-status-count-all');
    if (accountStatusCountAll) accountStatusCountAll.textContent = totalUsers;
    
    const accountStatusCountActive = document.getElementById('account-status-count-active');
    if (accountStatusCountActive) accountStatusCountActive.textContent = activeUsers;
    
    const accountStatusCountPending = document.getElementById('account-status-count-pending');
    if (accountStatusCountPending) accountStatusCountPending.textContent = pendingUsers;
    
    const accountStatusCountInactive = document.getElementById('account-status-count-inactive');
    if (accountStatusCountInactive) accountStatusCountInactive.textContent = inactiveUsers;

    // Update online status count badges
    const onlineUsers = state.users.filter(u => u.is_online).length;
    const offlineUsers = totalUsers - onlineUsers;
    
    const onlineStatusCountAll = document.getElementById('online-status-count-all');
    if (onlineStatusCountAll) onlineStatusCountAll.textContent = totalUsers;
    
    const onlineStatusCountOnline = document.getElementById('online-status-count-online');
    if (onlineStatusCountOnline) onlineStatusCountOnline.textContent = onlineUsers;
    
    const onlineStatusCountOffline = document.getElementById('online-status-count-offline');
    if (onlineStatusCountOffline) onlineStatusCountOffline.textContent = offlineUsers;
}

// OLD FUNCTION (kept for compatibility)
export function renderUsersByStatus(status) {
    // Use new modern render with status filter
    currentFilters.status = status === 'active' ? 'active' : 
                            status === 'pending' ? 'pending' : 
                            status === 'inactive' ? 'inactive' : '';
    renderModernUsers();
}



export function renderPendingUsers() {
    // Check if modern requests section exists
    const modernContainer = document.getElementById('pending-users-list');
    if (modernContainer && modernContainer.classList.contains('requests-grid')) {
        // Use modern rendering
        renderModernRequests();
        return;
    }
    
    // Legacy rendering (old style)
    if (!DOM.pendingUsersList || !state.pendingUsers) return;

    if (DOM.requestsCountBadge) {
        const count = state.pendingUsers.length;
        DOM.requestsCountBadge.textContent = count;
        DOM.requestsCountBadge.classList.toggle('hidden', count === 0);
    }

    if (state.pendingUsers.length === 0) {
        DOM.pendingUsersList.innerHTML = '<div class="empty-state">Tasdiqlanishini kutayotgan so\'rovlar yo\'q.</div>';
        return;
    }

    DOM.pendingUsersList.innerHTML = state.pendingUsers.map(user => {
        const isInProcess = user.status === 'status_in_process';
        const statusText = user.status === 'pending_telegram_subscription'
            ? '<span style="color: var(--yellow-color);">Botga obuna bo\'lishini kutmoqda</span>'
            : isInProcess
                ? '<span style="color: var(--orange-color);">Bot orqali tasdiqlanmoqda...</span>'
                : '<span style="color: var(--cyan-color);">Admin tasdig\'ini kutmoqda</span>';

        return `
        <div class="user-item">
            <div class="user-avatar"><i data-feather="user-plus"></i></div>
            <div class="user-details">
                <div class="username">${user.fullname || 'Nomsiz'} (@${user.username})</div>
                <div class="user-meta">
                    <span>${statusText}</span> |
                    <span>Sana: ${new Date(user.created_at).toLocaleDateString('uz-UZ')}</span>
                </div>
            </div>
            <div class="item-actions">
                ${!isInProcess ? `
                    <button class="btn btn-success btn-sm approve-user-btn" data-id="${user.id}" data-username="${user.username}" title="Tasdiqlash"><i data-feather="check"></i> Tasdiqlash</button>
                    <button class="btn btn-danger btn-sm reject-user-btn" data-id="${user.id}" title="Rad etish"><i data-feather="x"></i> Rad etish</button>
                ` : ''}
            </div>
        </div>
    `;
    }).join('');
    feather.replace();
}

export function toggleLocationVisibilityForUserForm() {
    const role = DOM.userRoleSelect?.value;
    
    // Sozlamalar bo'limini ko'rsatish (faqat rol tanlanganda)
    if (DOM.userSettingsGroup) {
        DOM.userSettingsGroup.style.display = role ? 'block' : 'none';
    }
    
    // User-specific sozlamalarni olish
    const requiresLocations = DOM.userRequiresLocations?.value;
    const requiresBrands = DOM.userRequiresBrands?.value;
    
    // Agar user-specific sozlamalar belgilanmagan bo'lsa, rol sozlamalariga qarab
    let locationsDisplay = 'none';
    let brandsDisplay = 'none';
    
    if (requiresLocations === 'true') {
        locationsDisplay = 'block';
    } else if (requiresLocations === 'false') {
        locationsDisplay = 'none';
    } else if (requiresLocations === 'null') {
        locationsDisplay = 'block';
    } else {
        // Rol sozlamalariga qarab
        locationsDisplay = (role === 'operator' || role === 'manager') ? 'block' : 'none';
    }
    
    if (requiresBrands === 'true') {
        brandsDisplay = 'block';
    } else if (requiresBrands === 'false') {
        brandsDisplay = 'none';
    } else if (requiresBrands === 'null') {
        brandsDisplay = 'block';
    } else {
        // Rol sozlamalariga qarab
        brandsDisplay = (role === 'manager') ? 'block' : 'none';
    }
    
    if (DOM.userLocationsGroup) DOM.userLocationsGroup.style.display = locationsDisplay;
    if (DOM.userBrandsGroup) DOM.userBrandsGroup.style.display = brandsDisplay;
    
    if (brandsDisplay === 'block') {
        loadBrandsForUser();
    }
}

// Event listener qo'shilganligini tekshirish uchun flag
let approvalRoleSelectListenerAdded = false;

export async function toggleLocationVisibilityForApprovalForm() {
    console.log('🔄 ========================================');
    console.log('🔄 [ROL TANLASH] toggleLocationVisibilityForApprovalForm boshlandi');
    console.log('🔄 ========================================');
    
    const role = DOM.approvalRoleSelect?.value;
    
    console.log(`🔄 [ROL TANLASH] 1. Rol tanlandi: ${role}`);
    
    // Agar rol tanlanmagan bo'lsa, hech narsa qilmaymiz
    if (!role) {
        console.log(`⚠️ [ROL TANLASH] Rol tanlanmagan, funksiya to'xtatilmoqda`);
        return;
    }
    
    // Rol talablarini state'dan olish
    console.log(`🔄 [ROL TANLASH] 2. State'dan rol ma'lumotlarini olish...`);
    console.log(`   - State.roles soni: ${state.roles?.length || 0}`);
    const roleData = state.roles.find(r => r.role_name === role);
    console.log(`   - RoleData topildi: ${roleData ? 'HA' : 'YO\'Q'}`);
    if (roleData) {
        console.log(`   - RoleData:`, JSON.stringify(roleData, null, 2));
    }
    
    // Rol shartlarini tekshirish
    // null = belgilanmagan, true = majburiy, false = kerak emas
    console.log(`🔄 [ROL TANLASH] 3. Rol shartlarini tekshirish...`);
    console.log(`   - roleData.requires_locations: ${roleData?.requires_locations} (type: ${typeof roleData?.requires_locations})`);
    console.log(`   - roleData.requires_brands: ${roleData?.requires_brands} (type: ${typeof roleData?.requires_brands})`);
    
    const requiresLocations = roleData ? (roleData.requires_locations !== undefined && roleData.requires_locations !== null ? roleData.requires_locations : null) : null;
    const requiresBrands = roleData ? (roleData.requires_brands !== undefined && roleData.requires_brands !== null ? roleData.requires_brands : null) : null;
    
    console.log(`   - requires_locations (hisoblangan): ${requiresLocations} (type: ${typeof requiresLocations})`);
    console.log(`   - requires_brands (hisoblangan): ${requiresBrands} (type: ${typeof requiresBrands})`);
    console.log(`   - requires_locations === null: ${requiresLocations === null}`);
    console.log(`   - requires_locations === undefined: ${requiresLocations === undefined}`);
    console.log(`   - requires_brands === null: ${requiresBrands === null}`);
    console.log(`   - requires_brands === undefined: ${requiresBrands === undefined}`);
    
    // Agar shartlar belgilanmagan bo'lsa (null), filiallar va brendlarni yashirish
    // Agar kamida bitta shart null yoki undefined bo'lsa, shartlar belgilanmagan deb hisoblanadi
    const isLocationsUndefined = (requiresLocations === null || requiresLocations === undefined);
    const isBrandsUndefined = (requiresBrands === null || requiresBrands === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    console.log(`   - isLocationsUndefined: ${isLocationsUndefined}`);
    console.log(`   - isBrandsUndefined: ${isBrandsUndefined}`);
    console.log(`   - isRequirementsUndefined: ${isRequirementsUndefined} (kamida bitta shart null/undefined bo'lsa true)`);
    
    const approvalRoleRequirementsGroup = document.getElementById('approval-role-requirements-group');
    const approvalBrandsGroup = document.getElementById('approval-brands-group');
    const submitBtn = document.querySelector('#approval-modal .modal-footer button[form="approval-form"]') || 
                      document.querySelector('#approval-modal .modal-footer button[type="submit"]');
    
    console.log(`🔄 [ROL TANLASH] 4. DOM elementlarini topish...`);
    console.log(`   - approvalRoleRequirementsGroup: ${approvalRoleRequirementsGroup ? 'TOPILDI' : 'TOPILMADI'}`);
    console.log(`   - approvalBrandsGroup: ${approvalBrandsGroup ? 'TOPILDI' : 'TOPILMADI'}`);
    console.log(`   - submitBtn: ${submitBtn ? 'TOPILDI' : 'TOPILMADI'}`);
    console.log(`   - DOM.approvalLocationsGroup: ${DOM.approvalLocationsGroup ? 'TOPILDI' : 'TOPILMADI'}`);
    
    if (isRequirementsUndefined) {
        console.log(`⚠️ [ROL TANLASH] 5. Shartlar belgilanmagan! UI o'zgartirilmoqda...`);
        // Shartlar belgilanmagan - filiallar va brendlarni yashirish
        if (DOM.approvalLocationsGroup) {
            DOM.approvalLocationsGroup.style.display = 'none';
            console.log(`   ✅ Filiallar yashirildi`);
        }
        if (approvalBrandsGroup) {
            approvalBrandsGroup.style.display = 'none';
            console.log(`   ✅ Brendlar yashirildi`);
        }
        if (approvalRoleRequirementsGroup) {
            approvalRoleRequirementsGroup.style.display = 'block';
            console.log(`   ✅ "Rol Shartini Kiritish" ko'rsatildi`);
        }
        if (submitBtn) {
            submitBtn.style.display = 'none';
            console.log(`   ✅ Tasdiqlash tugmasi yashirildi`);
        }
        
        // Tugma event listener - modal ochish
        const setRequirementsBtn = document.getElementById('set-role-requirements-btn');
        if (setRequirementsBtn) {
            setRequirementsBtn.onclick = () => {
                console.log(`🔧 [ROL TANLASH] "Rol Shartini Kiritish" tugmasi bosildi`);
                openRoleRequirementsModal(role, roleData);
            };
            feather.replace();
            console.log(`   ✅ "Rol Shartini Kiritish" tugmasi event listener qo'shildi`);
        } else {
            console.warn(`   ⚠️ "Rol Shartini Kiritish" tugmasi topilmadi!`);
        }
    } else {
        console.log(`✅ [ROL TANLASH] 5. Shartlar belgilangan! UI o'zgartirilmoqda...`);
        // Shartlar belgilangan - filiallar va brendlarni ko'rsatish
        if (approvalRoleRequirementsGroup) {
            approvalRoleRequirementsGroup.style.display = 'none';
            console.log(`   ✅ "Rol Shartini Kiritish" yashirildi`);
        }
        if (submitBtn) {
            submitBtn.style.display = 'block';
            console.log(`   ✅ Tasdiqlash tugmasi ko'rsatildi`);
        }
        
        // Qaysi shartlar belgilanganligiga qarab ko'rsatish
        // true = majburiy, null = ixtiyoriy (ko'rsatiladi), false = kerak emas (yashiriladi)
        console.log(`🔄 [ROL TANLASH] 6. Filiallar ko'rsatish tekshirilmoqda...`);
        if (requiresLocations === true) {
            // Majburiy - ko'rsatish
            if (DOM.approvalLocationsGroup) {
                DOM.approvalLocationsGroup.style.display = 'block';
                console.log(`   ✅ Filiallar ko'rsatildi (majburiy)`);
            }
        } else if (requiresLocations === null) {
            // Ixtiyoriy - ko'rsatish
            if (DOM.approvalLocationsGroup) {
                DOM.approvalLocationsGroup.style.display = 'block';
                console.log(`   ✅ Filiallar ko'rsatildi (ixtiyoriy)`);
            }
        } else {
            // false - kerak emas - yashirish
            if (DOM.approvalLocationsGroup) {
                DOM.approvalLocationsGroup.style.display = 'none';
                console.log(`   ✅ Filiallar yashirildi (kerak emas)`);
            }
        }
        
        console.log(`🔄 [ROL TANLASH] 7. Brendlar ko'rsatish tekshirilmoqda...`);
        if (requiresBrands === true) {
            // Majburiy - ko'rsatish
            if (approvalBrandsGroup) {
                approvalBrandsGroup.style.display = 'block';
                console.log(`   ✅ Brendlar ko'rsatildi (majburiy)`);
            }
        } else if (requiresBrands === null) {
            // Ixtiyoriy - ko'rsatish
            if (approvalBrandsGroup) {
                approvalBrandsGroup.style.display = 'block';
                console.log(`   ✅ Brendlar ko'rsatildi (ixtiyoriy)`);
            }
        } else {
            // false - kerak emas - yashirish
            if (approvalBrandsGroup) {
                approvalBrandsGroup.style.display = 'none';
                console.log(`   ✅ Brendlar yashirildi (kerak emas)`);
            }
        }
    }
    
    // "O'tkazib yuborish" tugmalarini yashirish (olib tashlandi)
    const skipLocationsBtn = document.getElementById('skip-locations-btn');
    const skipBrandsBtn = document.getElementById('skip-brands-btn');
    const skipAllBtn = document.getElementById('skip-all-btn');
    const backToRoleBtn = document.getElementById('back-to-role-btn');
    const backToLocationsBtn = document.getElementById('back-to-locations-btn');
    
    // Tugmalarni yashirish
    if (skipLocationsBtn) skipLocationsBtn.style.display = 'none';
    if (skipBrandsBtn) skipBrandsBtn.style.display = 'none';
    if (skipAllBtn) skipAllBtn.style.display = 'none';
    if (backToRoleBtn) backToRoleBtn.style.display = 'none';
    if (backToLocationsBtn) backToLocationsBtn.style.display = 'none';
    
    // Agar shartlar belgilangan bo'lsa, filiallar va brendlarni yuklash
    console.log(`🔄 [ROL TANLASH] 8. Ma'lumotlarni yuklash...`);
    if (!isRequirementsUndefined) {
        console.log(`📥 [ROL TANLASH] Shartlar belgilangan, filiallar va brendlar yuklanmoqda...`);
        await loadLocationsForApproval();
        await loadBrandsForApproval();
    } else {
        console.log('📋 [ROL TANLASH] Rol shartlari belgilanmagan. Filiallar va brendlar yuklanmaydi.');
    }
    
    // State'ga saqlash (submitUserApproval uchun)
    window.approvalSkipLocations = false;
    window.approvalSkipBrands = false;
    
    console.log(`✅ [ROL TANLASH] 9. Rol sozlamalari yangilandi.`);
    console.log(`   - State: skipLocations=${window.approvalSkipLocations}, skipBrands=${window.approvalSkipBrands}`);
    console.log('✅ ========================================');
    console.log('✅ [ROL TANLASH] Jarayon yakunlandi');
    console.log('✅ ========================================');
}

async function loadLocationsForApproval() {
    try {
        console.log('📍 [WEB] Filiallarni yuklashga harakat qilinmoqda...');
        const settingsRes = await safeFetch('/api/settings');
        if (!settingsRes.ok) {
            console.error('❌ [WEB] Settings API xatolik. Status:', settingsRes.status);
            throw new Error('Sozlamalarni yuklashda xatolik');
        }
        const settings = await settingsRes.json();
        console.log('✅ [WEB] Settings olingan:', settings);
        console.log('🔍 [WEB] app_settings:', settings.app_settings);
        const locations = settings.app_settings?.locations || [];
        console.log('📍 [WEB] Filiallar ro\'yxati. Umumiy soni:', locations.length, locations);
        
        if (DOM.approvalLocationsCheckboxList) {
            if (locations.length === 0) {
                DOM.approvalLocationsCheckboxList.innerHTML = '<p style="color: #ff6b6b; padding: 10px;">⚠️ Tizimda filiallar mavjud emas. Avval filiallar yarating.</p>';
                console.warn('⚠️ [WEB] Filiallar ro\'yxati bo\'sh');
            } else {
                DOM.approvalLocationsCheckboxList.innerHTML = locations.map(loc => `
                    <label class="checkbox-item">
                        <input type="checkbox" value="${loc}" name="approval-location">
                        <span>${loc}</span>
                    </label>
                `).join('');
                console.log('✅ [WEB] Filiallar ro\'yxati render qilindi. Filiallar soni:', locations.length);
            }
        } else {
            console.warn('⚠️ [WEB] approval-locations-checkbox-list elementi topilmadi');
        }
    } catch (error) {
        console.error('❌ [WEB] Filiallarni yuklashda xatolik:', error);
        console.error('❌ [WEB] Error stack:', error.stack);
        if (DOM.approvalLocationsCheckboxList) {
            DOM.approvalLocationsCheckboxList.innerHTML = `<p style="color: #ff6b6b; padding: 10px;">⚠️ Xatolik: ${error.message}</p>`;
        }
    }
}

async function loadBrandsForApproval() {
    try {
        console.log('🏷️ [WEB] Brendlarni yuklashga harakat qilinmoqda...');
        const res = await safeFetch('/api/brands');
        console.log('🔍 [WEB] Brendlar API javob. Status:', res.status, 'OK:', res.ok);
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ [WEB] Brendlar API xatolik. Status:', res.status, 'Response:', errorText);
            throw new Error(`Brendlarni yuklashda xatolik: ${res.status}`);
        }
        
        const allBrands = await res.json();
        console.log('✅ [WEB] Brendlar olingan. Soni:', Array.isArray(allBrands) ? allBrands.length : 'not array', 'Type:', typeof allBrands);
        
        if (!Array.isArray(allBrands)) {
            console.error('❌ [WEB] Brendlar array emas! Type:', typeof allBrands, 'Value:', allBrands);
            throw new Error('Brendlar array formatida emas');
        }
        
        if (allBrands.length === 0) {
            console.warn('⚠️ [WEB] Brendlar ro\'yxati bo\'sh');
        } else {
            console.log('🏷️ [WEB] Brendlar ro\'yxati:', allBrands.map(b => `${b.id}: ${b.name}`).join(', '));
        }
        
        const approvalBrandsList = document.getElementById('approval-brands-list');
        if (approvalBrandsList) {
            if (allBrands.length === 0) {
                approvalBrandsList.innerHTML = '<p style="color: #ff6b6b; padding: 10px;">⚠️ Tizimda brendlar mavjud emas. Avval brendlar yarating.</p>';
            } else {
                // Grid ko'rinishda brendlar
                approvalBrandsList.className = 'checkbox-grid';
                approvalBrandsList.style.display = 'flex';
                approvalBrandsList.style.flexWrap = 'wrap';
                approvalBrandsList.style.gap = '10px';
                approvalBrandsList.style.padding = '10px';
                
                approvalBrandsList.innerHTML = allBrands.map(brand => `
                    <label class="checkbox-item" style="
                        display: flex;
                        align-items: center;
                        padding: 10px 15px;
                        border-radius: 8px;
                        cursor: pointer;
                        background: rgba(255, 255, 255, 0.05);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        transition: all 0.2s ease;
                        min-width: 120px;
                        flex: 0 1 auto;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='rgba(102,126,234,0.5)';" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)';">
                        <input type="checkbox" value="${brand.id}" name="approval-brand" 
                            style="margin-right: 8px; width: 18px; height: 18px; cursor: pointer;">
                        <span style="font-size: 18px; margin-right: 6px;">${brand.emoji || '🏷️'}</span>
                        <span style="font-size: 14px; color: #fff;">${brand.name}</span>
                    </label>
                `).join('');
            }
            console.log('✅ [WEB] Brendlar ro\'yxati render qilindi. Brendlar soni:', allBrands.length);
        } else {
            console.warn('⚠️ [WEB] approval-brands-list elementi topilmadi');
        }
    } catch (error) {
        console.error('❌ [WEB] Brendlarni yuklashda xatolik:', error);
        console.error('❌ [WEB] Error stack:', error.stack);
        const approvalBrandsList = document.getElementById('approval-brands-list');
        if (approvalBrandsList) {
            approvalBrandsList.innerHTML = `<p style="color: #ff6b6b; padding: 10px;">⚠️ Xatolik: ${error.message}</p>`;
        }
    }
}

export function openUserModalForAdd() {
    DOM.userForm?.reset();
    if (DOM.editUserIdInput) DOM.editUserIdInput.value = '';
    if (DOM.userModalTitle) DOM.userModalTitle.textContent = 'Yangi Foydalanuvchi Qo\'shish';
    if (DOM.passwordGroup) DOM.passwordGroup.style.display = 'block';
    if (DOM.passwordInput) DOM.passwordInput.required = true;
    if (DOM.userRoleSelect) {
        DOM.userRoleSelect.innerHTML = state.roles
            .filter(r => r.role_name !== 'admin' && r.role_name !== 'super_admin') // Admin va super admin yaratish mumkin emas
            .map(r => 
                `<option value="${r.role_name}">${r.role_name}</option>`
            ).join('');
    }
    
    // Sozlamalarni tozalash
    if (DOM.userRequiresLocations) DOM.userRequiresLocations.value = '';
    if (DOM.userRequiresBrands) DOM.userRequiresBrands.value = '';
    
    // Rol tanlanganda sozlamalar bo'limini ko'rsatish
    if (DOM.userRoleSelect) {
        // Eski event listenerlarni olib tashlash
        const newSelect = DOM.userRoleSelect.cloneNode(true);
        DOM.userRoleSelect.parentNode.replaceChild(newSelect, DOM.userRoleSelect);
        DOM.userRoleSelect = newSelect;
        
        DOM.userRoleSelect.addEventListener('change', toggleLocationVisibilityForUserForm);
    }
    
    toggleLocationVisibilityForUserForm();
    DOM.userFormModal?.classList.remove('hidden');
}

export async function openUserModalForEdit(userId) {
    const user = state.users.find(u => u.id == userId);
    if (!user || !DOM.userForm) return;
    
    DOM.userForm.reset();
    DOM.editUserIdInput.value = user.id;
    DOM.userModalTitle.textContent = `"${user.username}"ni Tahrirlash`;
    DOM.usernameInput.value = user.username;
    DOM.fullnameInput.value = user.fullname || '';
    DOM.passwordGroup.style.display = 'none';
    DOM.passwordInput.required = false;
    DOM.userRoleSelect.innerHTML = state.roles
        .filter(r => r.role_name !== 'admin' && r.role_name !== 'super_admin') // Admin va super admin yaratish mumkin emas
        .map(r => 
            `<option value="${r.role_name}" ${user.role === r.role_name ? 'selected' : ''}>${r.role_name}</option>`
        ).join('');
    DOM.deviceLimitInput.value = user.device_limit;
    
    // User-specific sozlamalarni yuklash
    try {
        const settingsRes = await safeFetch(`/api/users/${userId}/settings`);
        if (settingsRes && settingsRes.ok) {
            const settings = await settingsRes.json();
            if (DOM.userRequiresLocations) {
                DOM.userRequiresLocations.value = settings.requires_locations === null ? 'null' : 
                    settings.requires_locations === true ? 'true' : 
                    settings.requires_locations === false ? 'false' : '';
            }
            if (DOM.userRequiresBrands) {
                DOM.userRequiresBrands.value = settings.requires_brands === null ? 'null' : 
                    settings.requires_brands === true ? 'true' : 
                    settings.requires_brands === false ? 'false' : '';
            }
        }
    } catch (error) {
        console.warn('User settings yuklanmadi:', error);
        // Default qiymatlar
        if (DOM.userRequiresLocations) DOM.userRequiresLocations.value = '';
        if (DOM.userRequiresBrands) DOM.userRequiresBrands.value = '';
    }
    
    document.querySelectorAll('#locations-checkbox-list input').forEach(cb => {
        cb.checked = user.locations.includes(cb.value);
    });
    
    // Rol tanlanganda sozlamalar bo'limini ko'rsatish
    if (DOM.userRoleSelect) {
        DOM.userRoleSelect.addEventListener('change', toggleLocationVisibilityForUserForm);
    }
    
    toggleLocationVisibilityForUserForm();
    
    // Brendlarni yuklash (agar kerak bo'lsa)
    if (DOM.userBrandsGroup && DOM.userBrandsGroup.style.display === 'block') {
        await loadBrandsForUser(userId);
    }
    
    DOM.userFormModal.classList.remove('hidden');
}

export async function handleUserFormSubmit(e) {
    e.preventDefault();
    const userId = DOM.editUserIdInput.value;
    const isEditing = !!userId;
    
    const data = {
        username: DOM.usernameInput.value.trim(),
        fullname: DOM.fullnameInput.value.trim(),
        role: DOM.userRoleSelect.value,
        device_limit: parseInt(DOM.deviceLimitInput.value) || 1,
        locations: Array.from(document.querySelectorAll('#locations-checkbox-list input:checked'))
            .map(cb => cb.value)
    };
    
    if (!isEditing && DOM.passwordInput.value) {
        data.password = DOM.passwordInput.value;
    }
    
    // Manager uchun brendlarni saqlash
    if (data.role === 'manager') {
        data.brands = Array.from(document.querySelectorAll('#user-brands-list input:checked'))
            .map(cb => parseInt(cb.value));
    }
    
    // User-specific sozlamalarni qo'shish
    const requiresLocations = DOM.userRequiresLocations?.value;
    const requiresBrands = DOM.userRequiresBrands?.value;
    
    if (requiresLocations || requiresBrands) {
        data.user_settings = {
            requires_locations: requiresLocations === 'true' ? true : 
                requiresLocations === 'false' ? false : 
                requiresLocations === 'null' ? null : undefined,
            requires_brands: requiresBrands === 'true' ? true : 
                requiresBrands === 'false' ? false : 
                requiresBrands === 'null' ? null : undefined
        };
    }
    
    const url = isEditing ? `/api/users/${userId}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';
    
    try {
        const res = await safeFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        const result = await res.json();
        showToast(result.message);
        
        // Super admin yaratilganda avtomatik login qilish
        if (result.autoLogin && result.loginData) {
            // Login qilish
            const loginRes = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: result.loginData.username,
                    password: result.loginData.password
                })
            });
            
            if (loginRes.ok) {
                const loginResult = await loginRes.json();
                showToast("Super admin tizimga muvaffaqiyatli kirildi.", false);
                setTimeout(() => {
                    window.location.href = result.redirectUrl || '/admin';
                }, 1000);
                return;
            }
        }
        
        const usersRes = await fetchUsers();
        if (usersRes) {
            state.users = usersRes;
            const activeTab = DOM.userTabs.querySelector('.active').dataset.status;
            renderUsersByStatus(activeTab);
        }
        
        DOM.userFormModal.classList.add('hidden');
    } catch (error) {
        showToast(error.message, true);
    }
}

export async function handleUserActions(e) {
    const button = e.target.closest('button');
    if (!button) return;
    
    const userId = button.dataset.id;
    
    if (button.classList.contains('edit-user-btn')) {
        openUserModalForEdit(userId);
    } else if (button.classList.contains('deactivate-user-btn') || button.classList.contains('activate-user-btn')) {
        const status = button.classList.contains('activate-user-btn') ? 'active' : 'blocked';
        const confirmed = await showConfirmDialog({
            title: status === 'active' ? '✅ Faollashtirish' : '🚫 Bloklash',
            message: `Rostdan ham bu foydalanuvchini ${status === 'active' ? 'aktivlashtirmoqchimisiz' : 'bloklamoqchimisiz'}?`,
            confirmText: status === 'active' ? 'Faollashtirish' : 'Bloklash',
            cancelText: 'Bekor qilish',
            type: status === 'active' ? 'success' : 'danger',
            icon: status === 'active' ? 'user-check' : 'user-x'
        });
        
        if (confirmed) {
            try {
                const res = await safeFetch(`/api/users/${userId}/status`, { 
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status })
                });
                if (!res || !res.ok) throw new Error((await res.json()).message);
                
                const result = await res.json();
                showToast(result.message);
                
                const usersRes = await fetchUsers();
                if (usersRes) {
                    state.users = usersRes;
                    const activeTab = DOM.userTabs.querySelector('.active').dataset.status;
                    renderUsersByStatus(activeTab);
                }
            } catch (error) { 
                showToast(error.message, true); 
            }
        }
    } else if (button.classList.contains('manage-sessions-btn')) {
        const username = button.dataset.username;
        await openSessionsModal(userId, username);
    } else if (button.classList.contains('change-password-btn')) {
        openCredentialsModal(userId, 'password');
    } else if (button.classList.contains('set-secret-word-btn')) {
        openCredentialsModal(userId, 'secret-word');
    } else if (button.classList.contains('connect-telegram-btn')) {
        openTelegramConnectModal(userId);
    }
}

async function openSessionsModal(userId, username) {
    DOM.sessionsModalTitle.textContent = `"${username}"ning Aktiv Sessiyalari`;
    DOM.sessionsListContainer.innerHTML = '<div class="skeleton-item"></div>';
    DOM.sessionsModal.classList.remove('hidden');
    
    try {
        const res = await safeFetch(`/api/users/${userId}/sessions`);
        if (!res || !res.ok) throw new Error('Sessiyalarni yuklab bo\'lmadi');
        const sessions = await res.json();
        
        DOM.sessionsListContainer.innerHTML = sessions.length > 0 ? sessions.map(s => `
            <div class="session-item ${s.is_current ? 'current' : ''}">
                <div class="session-details">
                    <div><strong>IP Manzil:</strong> ${s.ip_address || 'Noma\'lum'}</div>
                    <div><strong>Qurilma:</strong> ${s.user_agent || 'Noma\'lum'}</div>
                    <div><strong>Oxirgi faollik:</strong> ${new Date(s.last_activity).toLocaleString()}</div>
                </div>
                ${!s.is_current 
                    ? `<button class="btn btn-danger btn-sm terminate-session-btn" data-sid="${s.sid}">Tugatish</button>` 
                    : '<span class="badge" style="background-color: var(--green-color);">Joriy</span>'}
            </div>
        `).join('') : '<div class="empty-state">Aktiv sessiyalar topilmadi.</div>';
    } catch (error) {
        DOM.sessionsListContainer.innerHTML = `<div class="empty-state error">${error.message}</div>`;
    }
}

function openCredentialsModal(userId, type) {
    DOM.credentialsForm.reset();
    DOM.credentialsUserIdInput.value = userId;
    DOM.credentialsForm.dataset.type = type;
    
    if (type === 'password') {
        DOM.credentialsModalTitle.textContent = "Parolni O'zgartirish";
        DOM.credentialsInputLabel.textContent = "Yangi Parol";
        DOM.credentialsInput.type = 'password';
        DOM.credentialsInput.minLength = 8;
    } else {
        DOM.credentialsModalTitle.textContent = "Maxfiy So'zni O'rnatish";
        DOM.credentialsInputLabel.textContent = "Yangi Maxfiy So'z";
        DOM.credentialsInput.type = 'text';
        DOM.credentialsInput.minLength = 6;
    }
    
    DOM.credentialsModal.classList.remove('hidden');
}

export async function handleCredentialsFormSubmit(e) {
    e.preventDefault();
    const userId = DOM.credentialsUserIdInput.value;
    const type = DOM.credentialsForm.dataset.type;
    const value = DOM.credentialsInput.value;
    const url = `/api/users/${userId}/${type}`;
    const body = type === 'password' ? { newPassword: value } : { secretWord: value };
    
    try {
        const res = await safeFetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        const result = await res.json();
        showToast(result.message);
        DOM.credentialsModal.classList.add('hidden');
    } catch (error) {
        showToast(error.message, true);
    }
}

function openTelegramConnectModal(userId) {
    const randomToken = Math.random().toString(36).substring(2, 10);
    const connectCode = `connect_${userId}_${randomToken}`;
    const botUsername = state.settings.telegram_bot_username;
    
    if (!botUsername) {
        return showToast("Iltimos, avval Sozlamalar bo'limida Bot Username'ni kiriting!", true);
    }
    
    const connectLink = `https://t.me/${botUsername}?start=${connectCode}`;
    DOM.telegramConnectLinkInput.value = connectLink;
    DOM.telegramConnectModal.classList.remove('hidden');
}

export function copyTelegramLink() {
    DOM.telegramConnectLinkInput.select();
    document.execCommand('copy');
    showToast("Havola nusxalandi!");
}

// Pending users uchun funksiyalar
export async function openApprovalModal(userId, username) {
    console.log('🚪 ========================================');
    console.log('🚪 [MODAL OCHISH] openApprovalModal boshlandi');
    console.log('🚪 ========================================');
    console.log(`🚪 [MODAL OCHISH] 1. Parametrlar: userId=${userId}, username=${username}`);
    
    DOM.approvalForm.reset();
    DOM.approvalUserIdInput.value = userId;
    DOM.approvalUsernameSpan.textContent = username;
    console.log(`🚪 [MODAL OCHISH] 2. Form tozalandi va ma'lumotlar kiritildi`);
    
    // Super admin'dan tashqari barcha rollarni ko'rsatish
    console.log(`🚪 [MODAL OCHISH] 3. Rollarni yuklash...`);
    console.log(`   - State.roles soni: ${state.roles?.length || 0}`);
    DOM.approvalRoleSelect.innerHTML = state.roles
        .filter(r => r.role_name !== 'super_admin') // Super admin yaratish mumkin emas
        .map(r => {
            // Rol nomlarini o'zbek tiliga tarjima qilish
            const roleNames = {
                'admin': 'Admin',
                'manager': 'Menejer',
                'operator': 'Operator'
            };
            const displayName = roleNames[r.role_name] || r.role_name.charAt(0).toUpperCase() + r.role_name.slice(1);
            return `<option value="${r.role_name}">${displayName}</option>`;
        }).join('');
    console.log(`   ✅ Rollar yuklandi`);
    
    // Birinchi bosqich: faqat rol tanlash, boshqa narsalar yashiriladi
    console.log(`🚪 [MODAL OCHISH] 4. UI elementlarini yashirish...`);
    if (DOM.approvalLocationsGroup) {
        DOM.approvalLocationsGroup.style.display = 'none';
        console.log(`   ✅ Filiallar yashirildi`);
    }
    const approvalBrandsGroup = document.getElementById('approval-brands-group');
    if (approvalBrandsGroup) {
        approvalBrandsGroup.style.display = 'none';
        console.log(`   ✅ Brendlar yashirildi`);
    }
    const approvalRoleRequirementsGroup = document.getElementById('approval-role-requirements-group');
    if (approvalRoleRequirementsGroup) {
        approvalRoleRequirementsGroup.style.display = 'none';
        console.log(`   ✅ "Rol Shartini Kiritish" yashirildi`);
    }
    
    // Tasdiqlash tugmasini yashirish (rol tanlanguncha)
    const submitBtn = document.querySelector('#approval-modal .modal-footer button[form="approval-form"]') || 
                      document.querySelector('#approval-modal .modal-footer button[type="submit"]');
    if (submitBtn) {
        submitBtn.style.display = 'none';
        console.log(`   ✅ Tasdiqlash tugmasi yashirildi`);
    } else {
        console.warn(`   ⚠️ Tasdiqlash tugmasi topilmadi!`);
        // Qo'shimcha tekshirish
        const modalFooter = document.querySelector('#approval-modal .modal-footer');
        console.warn(`   - Modal footer topildi: ${modalFooter ? 'HA' : 'YO\'Q'}`);
        if (modalFooter) {
            const allButtons = modalFooter.querySelectorAll('button');
            console.warn(`   - Modal footer'dagi tugmalar soni: ${allButtons.length}`);
            allButtons.forEach((btn, idx) => {
                console.warn(`     - Tugma ${idx}: type=${btn.type}, form=${btn.getAttribute('form')}`);
            });
        }
    }
    
    // Event listenerlarni qo'shish
    console.log(`🚪 [MODAL OCHISH] 5. Event listenerlarni qo'shish...`);
    setupApprovalSkipButtons();
    
    // Rol tanlash event listener - eski listenerlarni olib tashlash
    if (DOM.approvalRoleSelect) {
        console.log(`   - Rol tanlash select elementi topildi`);
        // Eski event listenerlarni olib tashlash (barcha 'change' event listenerlarni)
        const newSelect = DOM.approvalRoleSelect.cloneNode(true);
        DOM.approvalRoleSelect.parentNode.replaceChild(newSelect, DOM.approvalRoleSelect);
        // DOM elementini yangilash - id o'zgarmaydi, shuning uchun to'g'ri id bilan qidirish
        const updatedSelect = document.getElementById('approval-role');
        if (updatedSelect) {
            // DOM.approvalRoleSelect ni yangilash
            DOM.approvalRoleSelect = updatedSelect;
            updatedSelect.addEventListener('change', async () => {
                console.log(`🔄 [MODAL] Rol tanlash o'zgardi, toggleLocationVisibilityForApprovalForm chaqirilmoqda...`);
                await toggleLocationVisibilityForApprovalForm();
            }, { once: false });
            console.log(`   ✅ Rol tanlash event listener qo'shildi`);
        } else {
            console.warn(`   ⚠️ Yangilangan select elementi topilmadi!`);
            // Qo'shimcha tekshirish
            const allSelects = document.querySelectorAll('#approval-modal select');
            console.warn(`   - Modal ichidagi barcha select elementlar: ${allSelects.length}`);
            allSelects.forEach((sel, idx) => {
                console.warn(`     - Select ${idx}: id=${sel.id}, value=${sel.value}`);
            });
        }
    } else {
        console.warn(`   ⚠️ Rol tanlash select elementi topilmadi!`);
    }
    
    console.log(`🚪 [MODAL OCHISH] 6. Modal ochilmoqda...`);
    DOM.approvalModal.classList.remove('hidden');
    feather.replace();
    
    console.log('✅ ========================================');
    console.log('✅ [MODAL OCHISH] Modal ochildi');
    console.log('✅ ========================================');
}

function setupApprovalSkipButtons() {
    // Skip locations button
    const skipLocationsBtn = document.getElementById('skip-locations-btn');
    if (skipLocationsBtn) {
        skipLocationsBtn.onclick = () => {
            console.log(`⏭️ [WEB] "Filiallarni o'tkazib yuborish" tugmasi bosildi`);
            window.approvalSkipLocations = true;
            // Barcha checkboxlarni o'chirish
            const checkboxes = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            console.log(`✅ [WEB] ${checkboxes.length} ta filial checkbox o'chirildi`);
            skipLocationsBtn.style.opacity = '0.5';
            skipLocationsBtn.innerHTML = '<i data-feather="check"></i> O\'tkazib yuborildi';
            if (window.feather) window.feather.replace();
        };
    }
    
    // Skip brands button
    const skipBrandsBtn = document.getElementById('skip-brands-btn');
    if (skipBrandsBtn) {
        skipBrandsBtn.onclick = () => {
            console.log(`⏭️ [WEB] "Brendlarni o'tkazib yuborish" tugmasi bosildi`);
            window.approvalSkipBrands = true;
            // Barcha checkboxlarni o'chirish
            const checkboxes = document.querySelectorAll('#approval-brands-list input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            console.log(`✅ [WEB] ${checkboxes.length} ta brend checkbox o'chirildi`);
            skipBrandsBtn.style.opacity = '0.5';
            skipBrandsBtn.innerHTML = '<i data-feather="check"></i> O\'tkazib yuborildi';
            if (window.feather) window.feather.replace();
        };
    }
    
    // Skip all button
    const skipAllBtn = document.getElementById('skip-all-btn');
    if (skipAllBtn) {
        skipAllBtn.onclick = async () => {
            console.log(`⏭️ [WEB] "Filial va Brendlarni O'tkazib Yuborish" tugmasi bosildi`);
            window.approvalSkipLocations = true;
            window.approvalSkipBrands = true;
            // Barcha checkboxlarni o'chirish
            const locationCheckboxes = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]');
            const brandCheckboxes = document.querySelectorAll('#approval-brands-list input[type="checkbox"]');
            locationCheckboxes.forEach(cb => {
                cb.checked = false;
            });
            brandCheckboxes.forEach(cb => {
                cb.checked = false;
            });
            console.log(`✅ [WEB] ${locationCheckboxes.length} ta filial va ${brandCheckboxes.length} ta brend checkbox o'chirildi`);
            
            // Submit qilish
            const form = document.getElementById('approval-form');
            if (form) {
                console.log(`📤 [WEB] Form avtomatik yuborilmoqda...`);
                const event = new Event('submit', { bubbles: true, cancelable: true });
                form.dispatchEvent(event);
            }
        };
    }
    
    // Orqaga qaytarish - Rol tanlashga
    const backToRoleBtn = document.getElementById('back-to-role-btn');
    if (backToRoleBtn) {
        backToRoleBtn.onclick = () => {
            console.log(`⬅️ [WEB] "Orqaga (Rol tanlash)" tugmasi bosildi`);
            // Filiallar va brendlarni yashirish
            const locationsGroup = document.getElementById('approval-locations-group');
            const brandsGroup = document.getElementById('approval-brands-group');
            if (locationsGroup) locationsGroup.style.display = 'none';
            if (brandsGroup) brandsGroup.style.display = 'none';
            
            // Rol select'ni reset qilish
            const roleSelect = document.getElementById('approval-role');
            if (roleSelect) {
                roleSelect.value = '';
                console.log(`✅ [WEB] Rol select reset qilindi`);
            }
            
            // State'ni tozalash
            window.approvalSkipLocations = false;
            window.approvalSkipBrands = false;
            
            // Checkboxlarni tozalash
            document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            document.querySelectorAll('#approval-brands-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            
            console.log(`✅ [WEB] Orqaga qaytarildi: Rol tanlash bosqichiga`);
        };
    }
    
    // Orqaga qaytarish - Filiallar tanlashga
    const backToLocationsBtn = document.getElementById('back-to-locations-btn');
    if (backToLocationsBtn) {
        backToLocationsBtn.onclick = () => {
            console.log(`⬅️ [WEB] "Orqaga (Filiallar)" tugmasi bosildi`);
            // Brendlarni yashirish
            const brandsGroup = document.getElementById('approval-brands-group');
            if (brandsGroup) brandsGroup.style.display = 'none';
            
            // Filiallarni ko'rsatish
            const locationsGroup = document.getElementById('approval-locations-group');
            if (locationsGroup) locationsGroup.style.display = 'block';
            
            // State'ni tozalash
            window.approvalSkipBrands = false;
            
            // Brend checkboxlarni tozalash
            document.querySelectorAll('#approval-brands-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            
            console.log(`✅ [WEB] Orqaga qaytarildi: Filiallar tanlash bosqichiga`);
        };
    }
}

export async function submitUserApproval(e) {
    console.log('🚀 ========================================');
    console.log('🚀 [TASDIQLASH] Boshlanish - submitUserApproval');
    console.log('🚀 ========================================');
    
    e.preventDefault();
    
    const userId = DOM.approvalUserIdInput?.value;
    const role = DOM.approvalRoleSelect?.value;
    
    console.log(`📝 [TASDIQLASH] 1. Form ma\'lumotlari olingan:`);
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Role: ${role}`);
    console.log(`   - DOM.approvalUserIdInput: ${DOM.approvalUserIdInput ? 'MAVJUD' : 'YO\'Q'}`);
    console.log(`   - DOM.approvalRoleSelect: ${DOM.approvalRoleSelect ? 'MAVJUD' : 'YO\'Q'}`);
    if (DOM.approvalRoleSelect) {
        console.log(`   - DOM.approvalRoleSelect.value: "${DOM.approvalRoleSelect.value}"`);
        console.log(`   - DOM.approvalRoleSelect.selectedIndex: ${DOM.approvalRoleSelect.selectedIndex}`);
        console.log(`   - DOM.approvalRoleSelect.options.length: ${DOM.approvalRoleSelect.options.length}`);
    }
    
    // Validatsiya: User ID va Role mavjudligini tekshirish
    if (!userId || userId.trim() === '') {
        console.error(`❌ [TASDIQLASH] User ID topilmadi yoki bo'sh!`);
        showToast('Foydalanuvchi ID topilmadi', true);
        return;
    }
    
    if (!role || role.trim() === '' || role === 'null' || role === 'undefined') {
        console.error(`❌ [TASDIQLASH] Rol tanlanmagan!`);
        console.error(`   - Role qiymati: "${role}"`);
        console.error(`   - Role type: ${typeof role}`);
        showToast('Iltimos, avval rolni tanlang', true);
        return;
    }
    
    // Rol talablarini state'dan olish
    console.log(`📋 [TASDIQLASH] 2. State'dan rol ma'lumotlarini olish...`);
    console.log(`   - State.roles soni: ${state.roles?.length || 0}`);
    const roleData = state.roles.find(r => r.role_name === role);
    console.log(`   - RoleData topildi: ${roleData ? 'HA' : 'YO\'Q'}`);
    if (roleData) {
        console.log(`   - RoleData to'liq ma'lumot:`, JSON.stringify(roleData, null, 2));
    }
    
    // Belgilanmagan yoki belgilangan holatni aniqlash
    console.log(`🔍 [TASDIQLASH] 3. Rol shartlarini tekshirish...`);
    
    const isLocationsRequired = roleData 
        ? (roleData.requires_locations !== undefined && roleData.requires_locations !== null 
            ? roleData.requires_locations 
            : null)  // null = belgilanmagan
        : null;
    
    const isBrandsRequired = roleData 
        ? (roleData.requires_brands !== undefined && roleData.requires_brands !== null 
            ? roleData.requires_brands 
            : null)  // null = belgilanmagan
        : null;
    
    console.log(`   - requires_locations: ${isLocationsRequired} (type: ${typeof isLocationsRequired})`);
    console.log(`   - requires_brands: ${isBrandsRequired} (type: ${typeof isBrandsRequired})`);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    const isLocationsUndefined = (isLocationsRequired === null || isLocationsRequired === undefined);
    const isBrandsUndefined = (isBrandsRequired === null || isBrandsRequired === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    console.log(`🔍 [TASDIQLASH] 4. Shartlar belgilanmaganligini tekshirish:`);
    console.log(`   - isRequirementsUndefined: ${isRequirementsUndefined}`);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    if (isRequirementsUndefined) {
        console.log(`❌ [TASDIQLASH] 5. XATOLIK: Rol shartlari belgilanmagan!`);
        console.log(`   - Role: ${role}`);
        console.log(`   - requires_locations: ${roleData?.requires_locations}`);
        console.log(`   - requires_brands: ${roleData?.requires_brands}`);
        showToast(`"${role}" roli uchun shartlar belgilanmagan. Avval shart belgilanishi kerak.`, true);
        return;
    }
    
    console.log(`✅ [TASDIQLASH] 5. Rol shartlari belgilangan. Validatsiyaga o'tilmoqda...`);
    
    // Data obyektini yaratish
    console.log(`📦 [TASDIQLASH] 6. Data obyektini yaratish...`);
    const data = {
        role: role,
        locations: [],
        brands: []
    };
    
    // FILIALLAR VALIDATSIYASI
    console.log(`📍 [TASDIQLASH] 7. Filiallar validatsiyasi...`);
    console.log(`   - isLocationsRequired: ${isLocationsRequired} (type: ${typeof isLocationsRequired})`);
    
    if (isLocationsRequired === true) {
        // Majburiy - filiallar tanlash kerak
        const locationCheckboxes = document.querySelectorAll('#approval-locations-checkbox-list input:checked');
        const selectedLocations = Array.from(locationCheckboxes).map(cb => cb.value);
        data.locations = selectedLocations;
        
        console.log(`   - Tanlangan filiallar soni: ${selectedLocations.length}`);
        
        if (data.locations.length === 0) {
            console.log(`   ❌ XATOLIK: Filiallar majburiy, lekin tanlanmagan!`);
            showToast(`"${role}" roli uchun kamida bitta filial tanlanishi shart.`, true);
            return;
        }
        console.log(`   ✅ Filiallar validatsiyasi o'tdi`);
    } else {
        // false - filiallar kerak emas
        console.log(`   ✅ Filiallar kerak emas (false)`);
    }
    
    // BRENDLAR VALIDATSIYASI
    console.log(`🏷️ [TASDIQLASH] 8. Brendlar validatsiyasi...`);
    console.log(`   - isBrandsRequired: ${isBrandsRequired} (type: ${typeof isBrandsRequired})`);
    
    if (isBrandsRequired === true) {
        // Majburiy - brendlar tanlash kerak
        const brandCheckboxes = document.querySelectorAll('#approval-brands-list input:checked');
        const selectedBrands = Array.from(brandCheckboxes).map(cb => parseInt(cb.value));
        data.brands = selectedBrands;
        
        console.log(`   - Tanlangan brendlar soni: ${selectedBrands.length}`);
        
        if (data.brands.length === 0) {
            console.log(`   ❌ XATOLIK: Brendlar majburiy, lekin tanlanmagan!`);
            showToast(`"${role}" roli uchun kamida bitta brend tanlanishi shart.`, true);
            return;
        }
        console.log(`   ✅ Brendlar validatsiyasi o'tdi`);
    } else {
        // false - brendlar kerak emas
        console.log(`   ✅ Brendlar kerak emas (false)`);
    }
    
    console.log(`📤 [TASDIQLASH] 9. Barcha validatsiyalar o'tdi. API'ga yuborilmoqda...`);
    console.log(`   - Data:`, JSON.stringify(data, null, 2));

    try {
        console.log(`🌐 [TASDIQLASH] 10. API so'rovini yuborish...`);
        console.log(`   - URL: /api/users/${userId}/approve`);
        console.log(`   - Method: PUT`);
        
        const res = await safeFetch(`/api/users/${userId}/approve`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        console.log(`📥 [TASDIQLASH] 11. API javob olingan:`);
        console.log(`   - Status: ${res?.status}`);
        console.log(`   - OK: ${res?.ok}`);
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            console.error(`   ❌ API xatolik:`, errorData);
            throw new Error(errorData.message);
        }
        
        const result = await res.json();
        console.log(`✅ [TASDIQLASH] 12. Muvaffaqiyatli tasdiqlandi!`);
        console.log(`   - Result:`, result);
        showToast(result.message);
        
        const [pendingRes, usersRes] = await Promise.all([
            fetchPendingUsers(),
            fetchUsers()
        ]);

        if (pendingRes) {
            state.pendingUsers = pendingRes;
            renderPendingUsers();
        }
        if (usersRes) {
            state.users = usersRes;
            // Faqat userTabs mavjud bo'lsa, render qilish
            if (DOM.userTabs) {
                const activeTab = DOM.userTabs.querySelector('.active')?.dataset.status;
                if (activeTab) renderUsersByStatus(activeTab);
            }
        }
        
        // State'ni tozalash
        window.approvalSkipLocations = false;
        window.approvalSkipBrands = false;
        
        // Modal yopish
        if (DOM.approvalModal) {
            DOM.approvalModal.classList.add('hidden');
        }
        
        // So'rovlar bo'limini yangilash
        console.log(`🔄 [TASDIQLASH] 13. UI yangilanmoqda...`);
        renderModernRequests();
        updateRequestsStatistics();
        
        console.log('✅ ========================================');
        console.log('✅ [TASDIQLASH] Jarayon muvaffaqiyatli yakunlandi!');
        console.log('✅ ========================================');
    } catch (error) {
        console.error('❌ ========================================');
        console.error(`❌ [TASDIQLASH] XATOLIK YUZ BERDI!`);
        console.error(`❌ [TASDIQLASH] Xatolik:`, error);
        console.error(`❌ [TASDIQLASH] Xatolik stack:`, error.stack);
        console.error('❌ ========================================');
        showToast(error.message, true);
    }
}

export async function handleUserRejection(userId) {
    try {
        const res = await safeFetch(`/api/users/${userId}/reject`, { method: 'PUT' });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        const result = await res.json();
        showToast(result.message);
        
        state.pendingUsers = state.pendingUsers.filter(u => u.id != userId);
        renderPendingUsers();
    } catch (error) {
        showToast(error.message, true);
    }
}

export async function handlePendingUserActions(e) {
    const button = e.target.closest('button');
    if (!button) return;
    
    const userId = button.dataset.id;
    
    if (button.classList.contains('approve-user-btn')) {
        const username = button.dataset.username;
        openApprovalModal(userId, username);
    } else if (button.classList.contains('reject-user-btn')) {
        const confirmed = await showConfirmDialog({
            title: '❌ So\'rovni rad etish',
            message: "Rostdan ham bu foydalanuvchining so'rovini rad etmoqchimisiz?",
            confirmText: 'Rad etish',
            cancelText: 'Bekor qilish',
            type: 'danger',
            icon: 'user-x'
        });
        
        if (confirmed) {
            handleUserRejection(userId);
        }
    }
}

export async function handleSessionTermination(e) {
    const button = e.target.closest('.terminate-session-btn');
    if (!button) return;
    
    const sid = button.dataset.sid;
    const confirmed = await showConfirmDialog({
        title: '🔒 Sessiyani tugatish',
        message: 'Rostdan ham bu sessiyani tugatmoqchimisiz?',
        confirmText: 'Tugatish',
        cancelText: 'Bekor qilish',
        type: 'warning',
        icon: 'log-out'
    });
    
    if (confirmed) {
        try {
            const res = await safeFetch(`/api/sessions/${sid}`, { method: 'DELETE' });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            
            const result = await res.json();
            showToast(result.message);
            
            if (DOM.securityPage.classList.contains('active')) {
                const { fetchAndRenderMySessions } = await import('./security.js');
                fetchAndRenderMySessions();
            } else if (!DOM.sessionsModal.classList.contains('hidden')) {
                button.closest('.session-item').remove();
            }
        } catch (error) {
            showToast(error.message, true);
        }
    }
}

/* ===================================================== */
/* === 👥 YANGI ADMIN FUNKSIYALARI === */
/* ===================================================== */

/**
 * Avatar yaratish (ismdan birinchi harf)
 */
export function createAvatar(fullName) {
    if (!fullName) return '';
    
    const initials = fullName
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    
    // Rang generatsiya (ismga qarab)
    const colors = [
        '#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8',
        '#6f42c1', '#fd7e14', '#e83e8c', '#20c997', '#6610f2'
    ];
    
    const charCode = fullName.charCodeAt(0) + fullName.charCodeAt(fullName.length - 1);
    const colorIndex = charCode % colors.length;
    const backgroundColor = colors[colorIndex];
    
    return `<div class="user-avatar" style="background: ${backgroundColor}">${initials}</div>`;
}

/**
 * Status badge yaratish
 */
export function createStatusBadge(status) {
    const statusMap = {
        'active': { class: 'active', text: 'Faol', icon: '🟢' },
        'pending': { class: 'pending', text: 'Kutilmoqda', icon: '🟡' },
        'inactive': { class: 'inactive', text: 'Nofaol', icon: '🔴' }
    };
    
    const statusInfo = statusMap[status] || statusMap['inactive'];
    
    return `
        <span class="status-badge ${statusInfo.class}">
            <span class="status-dot"></span>
            ${statusInfo.text}
        </span>
    `;
}

/**
 * Quick actions tugmalari
 */
export function createQuickActions(userId) {
    return `
        <div class="quick-actions">
            <button class="action-btn view" onclick="window.viewUserQuick(${userId})" title="Ko'rish">
                <i data-feather="eye"></i>
            </button>
            <button class="action-btn edit" onclick="window.editUserQuick(${userId})" title="Tahrirlash">
                <i data-feather="edit-2"></i>
            </button>
            <button class="action-btn delete" onclick="window.deleteUserQuick(${userId})" title="O'chirish">
                <i data-feather="trash-2"></i>
            </button>
        </div>
    `;
}

/**
 * Telegram status badge
 */
export function createTelegramStatus(telegramId, telegramUsername) {
    const isConnected = telegramId && telegramUsername;
    
    if (isConnected) {
        return `
            <span class="telegram-status connected" title="Telegram ulangan">
                <i data-feather="check-circle" style="width: 12px; height: 12px;"></i>
                @${telegramUsername}
            </span>
        `;
    } else {
        return `
            <span class="telegram-status disconnected" title="Telegram ulanmagan">
                <i data-feather="x-circle" style="width: 12px; height: 12px;"></i>
                Ulanmagan
            </span>
        `;
    }
}

/**
 * Bulk selection barini ko'rsatish
 */
export function toggleUserSelection(userId, checkbox) {
    if (checkbox.checked) {
        selectedUsers.add(userId);
    } else {
        selectedUsers.delete(userId);
    }
    
    updateBulkActionsBar();
}

// Global funktsiya qilish
window.toggleUserSelection = toggleUserSelection;

/**
 * Foydalanuvchi tezkor ko'rish
 */
window.viewUserQuick = async function(userId) {
    const user = state.users.find(u => u.id === userId);
    if (!user) return;
    
    // Modal yaratish
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="user-quick-view">
            <div class="user-quick-view-header">
                ${createAvatar(user.full_name)}
                <div class="user-quick-view-info">
                    <h3>${user.full_name}</h3>
                    ${createStatusBadge(user.status)}
                    ${createTelegramStatus(user.telegram_id, user.telegram_username)}
                </div>
            </div>
            <div class="user-quick-view-body">
                <div class="user-quick-view-stat">
                    <span class="label">👤 Foydalanuvchi nomi:</span>
                    <span class="value">${user.username}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">🎭 Rol:</span>
                    <span class="value">${user.role_name || 'Yo\'q'}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">📍 Joylashuv:</span>
                    <span class="value">${user.location_name || 'Yo\'q'}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">📅 Ro'yxatdan o'tgan:</span>
                    <span class="value">${new Date(user.created_at).toLocaleDateString('uz-UZ')}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">⏰ Oxirgi faollik:</span>
                    <span class="value">${user.last_active ? new Date(user.last_active).toLocaleString('uz-UZ') : 'Hech qachon'}</span>
                </div>
            </div>
            <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                    Yopish
                </button>
                <button class="btn btn-primary" onclick="window.editUserQuick(${userId}); this.closest('.modal-overlay').remove();">
                    Tahrirlash
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    feather.replace();
    
    // Click tashqarida yopish
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

/**
 * Global functions for bulk operations
 */
window.clearSelection = function() {
    selectedUsers.clear();
    document.querySelectorAll('.bulk-select-checkbox').forEach(cb => cb.checked = false);
    updateBulkActionsBar();
}

window.bulkChangeStatus = async function() {
    if (selectedUsers.size === 0) return;
    
    const newStatus = prompt('Yangi holat (active/inactive):');
    if (!newStatus || !['active', 'inactive'].includes(newStatus)) return;
    
    try {
        for (const userId of selectedUsers) {
            await safeFetch(`/api/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchi holati o'zgartirildi`);
        window.clearSelection();
        await fetchUsers();
        renderUsersByStatus();
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, true);
    }
}

window.bulkAssignRole = async function() {
    if (selectedUsers.size === 0) return;
    
    const roleId = prompt('Rol ID raqamini kiriting:');
    if (!roleId) return;
    
    try {
        for (const userId of selectedUsers) {
            await safeFetch(`/api/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role_id: parseInt(roleId) })
            });
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchiga rol berildi`);
        window.clearSelection();
        await fetchUsers();
        renderUsersByStatus();
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, true);
    }
}

window.bulkDeleteUsers = async function() {
    if (selectedUsers.size === 0) return;
    
    const confirmed = await showConfirmDialog({
        title: '🗑️ Ko\'plab foydalanuvchilarni o\'chirish',
        message: `${selectedUsers.size} ta foydalanuvchini o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi!`,
        confirmText: `${selectedUsers.size} ta o'chirish`,
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'trash-2'
    });
    
    if (!confirmed) return;
    
    try {
        for (const userId of selectedUsers) {
            await safeFetch(`/api/users/${userId}`, { method: 'DELETE' });
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchi o'chirildi`);
        window.clearSelection();
        await fetchUsers();
        renderUsersByStatus();
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, true);
    }
}

window.editUserQuick = function(userId) {
    // Mavjud edit funksiyasini chaqirish
    const user = state.users.find(u => u.id === userId);
    if (user) {
        // User form modalni ochish va ma'lumotlarni to'ldirish
        const editBtn = document.querySelector(`button[onclick*="handleUserActions"][onclick*="'edit'"][onclick*="${userId}"]`);
        if (editBtn) editBtn.click();
    }
}

window.deleteUserQuick = async function(userId) {
    const confirmed = await showConfirmDialog({
        title: '🗑️ Foydalanuvchini o\'chirish',
        message: 'Foydalanuvchini o\'chirmoqchimisiz? Bu amalni qaytarib bo\'lmaydi!',
        confirmText: 'O\'chirish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'trash-2'
    });
    
    if (!confirmed) return;
    
    try {
        const res = await safeFetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        showToast('✅ Foydalanuvchi o\'chirildi');
        await fetchUsers();
        renderUsersByStatus();
    } catch (error) {
        showToast(`❌ ${error.message}`, true);
    }
}

// ===== MODERN USERS MODULE - EVENT LISTENERS =====

// Initialize modern users page
export function initModernUsersPage() {
    // console.log('🔄 Initializing Modern Users Page...');
    
    // Setup filters
    setupUsersFilters();
    
    // Load users
    fetchUsers().then(() => {
        renderModernUsers();
    });
    
    // Setup refresh button
    const refreshBtn = document.getElementById('refresh-users-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.innerHTML = '<i data-feather="refresh-cw" class="spin"></i><span>Yangilanmoqda...</span>';
            await fetchUsers();
            renderModernUsers();
            refreshBtn.innerHTML = '<i data-feather="refresh-cw"></i><span>Yangilash</span>';
            feather.replace();
            showToast('✅ Ma\'lumotlar yangilandi');
        });
    }
}

// Load role filter badges dynamically
function loadRoleFilterBadges() {
    const roleBadgesContainer = document.getElementById('users-role-badges');
    if (!roleBadgesContainer || !state.roles) return;

    // Count users by role
    const roleCounts = {};
    let totalUsers = 0;
    
    if (state.users) {
        totalUsers = state.users.length;
        state.users.forEach(user => {
            const role = user.role || 'user';
            roleCounts[role] = (roleCounts[role] || 0) + 1;
        });
    }

    // Get ONLY existing roles (with count > 0)
    const existingRoles = Object.keys(roleCounts).filter(role => roleCounts[role] > 0);

    // Role icons and colors
    const roleConfig = {
        'admin': { icon: 'shield', color: 'danger', label: 'Admin' },
        'manager': { icon: 'briefcase', color: 'warning', label: 'Manager' },
        'operator': { icon: 'user-check', color: 'info', label: 'Operator' },
        'user': { icon: 'user', color: 'success', label: 'User' },
        'viewer': { icon: 'eye', color: 'info', label: 'Viewer' }
    };

    // Build badges HTML - start with "Barchasi"
    let badgesHTML = `
        <button class="filter-badge filter-badge-primary active" data-role="">
            <i data-feather="users"></i>
            <span>Barchasi <span class="badge-count" id="role-count-all">${totalUsers}</span></span>
        </button>
    `;

    // Add only existing roles
    existingRoles.forEach(role => {
        const config = roleConfig[role] || { icon: 'user', color: 'info', label: role.charAt(0).toUpperCase() + role.slice(1) };
        const count = roleCounts[role];
        
        badgesHTML += `
            <button class="filter-badge filter-badge-${config.color}" data-role="${role}">
                <i data-feather="${config.icon}"></i>
                <span>${config.label} <span class="badge-count" id="role-count-${role}">${count}</span></span>
            </button>
        `;
    });

    roleBadgesContainer.innerHTML = badgesHTML;
    feather.replace();

    // Setup click handlers
    const roleBadges = roleBadgesContainer.querySelectorAll('.filter-badge');
    roleBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            // Remove active from all
            roleBadges.forEach(b => b.classList.remove('active'));
            
            // Add active to clicked
            badge.classList.add('active');
            
            // Update filter
            currentFilters.role = badge.dataset.role || '';
            
            // Re-render
            renderModernUsers();
        });
    });
}

// Setup all filters
function setupUsersFilters() {
    // Load and setup role filter badges dynamically
    loadRoleFilterBadges();
    
    // Account Status filter badges
    const accountStatusBadges = document.querySelectorAll('#users-account-status-badges .filter-badge');
    accountStatusBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            accountStatusBadges.forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
            currentFilters.accountStatus = badge.dataset.accountStatus || '';
            renderModernUsers();
        });
    });

    // Online Status filter badges
    const onlineStatusBadges = document.querySelectorAll('#users-online-status-badges .filter-badge');
    onlineStatusBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            onlineStatusBadges.forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
            currentFilters.onlineStatus = badge.dataset.onlineStatus || '';
            renderModernUsers();
        });
    });
    
    // Bulk actions
    setupBulkActions();
}

// Setup bulk actions
function setupBulkActions() {
    const bulkActivateBtn = document.getElementById('bulk-activate-btn');
    const bulkDeactivateBtn = document.getElementById('bulk-deactivate-btn');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    
    if (bulkActivateBtn) {
        bulkActivateBtn.addEventListener('click', () => bulkAction('activate'));
    }
    
    if (bulkDeactivateBtn) {
        bulkDeactivateBtn.addEventListener('click', () => bulkAction('deactivate'));
    }
    
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', () => bulkAction('delete'));
    }
}

// Bulk action handler
async function bulkAction(action) {
    if (selectedUsers.size === 0) {
        showToast('❌ Foydalanuvchi tanlanmagan', 'error');
        return;
    }
    
    const actionText = action === 'activate' ? 'faollashtirish' : 
                      action === 'deactivate' ? 'deaktiv qilish' : 
                      'o\'chirish';
    
    const confirmed = await showConfirmDialog({
        title: `${selectedUsers.size} ta foydalanuvchini ${actionText}`,
        message: `Tanlangan foydalanuvchilarni ${actionText}ni tasdiqlaysizmi?`,
        confirmText: 'Tasdiqlash',
        cancelText: 'Bekor qilish',
        type: action === 'delete' ? 'danger' : 'warning'
    });
    
    if (!confirmed) return;
    
    try {
        const userIds = Array.from(selectedUsers);
        
        for (const userId of userIds) {
            if (action === 'activate') {
                await safeFetch(`/api/users/${userId}/activate`, { method: 'POST' });
            } else if (action === 'deactivate') {
                await safeFetch(`/api/users/${userId}/deactivate`, { method: 'POST' });
            } else if (action === 'delete') {
                await safeFetch(`/api/users/${userId}`, { method: 'DELETE' });
            }
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchi ${actionText}ildi`);
        
        // Clear selection
        selectedUsers.clear();
        updateBulkActionsBar();
        
        // Reload
        await fetchUsers();
        renderModernUsers();
        
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, 'error');
    }
}

// Update bulk actions bar visibility
function updateBulkActionsBar() {
    const bulkContainer = document.getElementById('bulk-actions-container');
    const selectedCountEl = document.getElementById('selected-count');
    
    if (bulkContainer && selectedCountEl) {
        bulkContainer.style.display = selectedUsers.size > 0 ? 'flex' : 'none';
        selectedCountEl.textContent = selectedUsers.size;
    }
    
    // Update checkboxes state
    document.querySelectorAll('.user-card-checkbox').forEach(checkbox => {
        const userId = parseInt(checkbox.dataset.userId);
        checkbox.checked = selectedUsers.has(userId);
    });
}

// ============================================
// REQUESTS SECTION - MODERN DESIGN
// ============================================

// Helper function to update element text
function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

// Helper function to get initials from name
function getInitials(name) {
    if (!name) return '??';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
        return words[0].substring(0, 2).toUpperCase();
    }
    return (words[0][0] + (words[1] ? words[1][0] : words[0][1])).toUpperCase();
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// State for requests section
let selectedRequests = new Set();
let currentRequestsFilter = {
    status: '',
    sort: 'newest'
};

// Render modern requests cards
function renderModernRequests() {
    const container = document.getElementById('pending-users-list');
    if (!container) return;

    // Get pending users (requests) - use state.pendingUsers if available, otherwise filter state.users
    let requests = [];
    
    if (state.pendingUsers && state.pendingUsers.length > 0) {
        // Use dedicated pending users array
        requests = [...state.pendingUsers];
    } else if (state.users && state.users.length > 0) {
        // Fallback: filter from all users
        requests = state.users.filter(u => u.status === 'pending' || u.status === 'pending_approval' || u.status === 'pending_telegram_subscription' || u.status === 'status_in_process');
    }

    // Apply status filter
    if (currentRequestsFilter.status) {
        if (currentRequestsFilter.status === 'pending_telegram_subscription') {
            // Telegram kutmoqda - null, undefined yoki pending_subscription
            requests = requests.filter(r => !r.telegram_connection_status || r.telegram_connection_status === 'pending_subscription' || r.telegram_connection_status === 'not_connected');
        } else if (currentRequestsFilter.status === 'pending_admin_approval') {
            // Admin tasdiq - telegram ulanish tugallangan, lekin admin tasdiqlashi kerak
            requests = requests.filter(r => r.telegram_connection_status === 'subscribed' || r.telegram_connection_status === 'connected' || r.telegram_connection_status === 'pending_admin_approval');
        } else if (currentRequestsFilter.status === 'status_in_process') {
            // Jarayonda
            requests = requests.filter(r => r.telegram_connection_status === 'in_process');
        }
    }

    // Apply sorting
    if (currentRequestsFilter.sort === 'newest') {
        requests.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } else if (currentRequestsFilter.sort === 'oldest') {
        requests.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } else if (currentRequestsFilter.sort === 'name') {
        requests.sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || ''));
    }

    // Empty state
    if (requests.length === 0) {
        container.innerHTML = `
            <div class="requests-empty-state">
                <i data-feather="inbox"></i>
                <h3>So'rovlar yo'q</h3>
                <p>Hozircha tasdiqlash uchun kutayotgan so'rovlar mavjud emas</p>
            </div>
        `;
        feather.replace();
        return;
    }

    // Render cards
    container.innerHTML = requests.map(request => {
        const initials = getInitials(request.full_name || request.fullname || request.username);
        const statusBadge = getRequestStatusBadge(request);
        // Aniq vaqt ko'rsatish
        const createdDate = request.created_at ? formatDateTime(request.created_at) : 'Noma\'lum';
        const fullName = request.full_name || request.fullname || 'Noma\'lum';
        const username = request.username || 'noname';
        const telegramId = request.telegram_id || request.telegram_chat_id;
        const telegramUsername = request.telegram_username;
        
        return `
            <div class="request-card" data-request-id="${request.id}">
                <div class="request-card-header">
                    <div class="request-card-checkbox">
                        <input type="checkbox" 
                               class="request-checkbox" 
                               data-request-id="${request.id}"
                               ${selectedRequests.has(request.id) ? 'checked' : ''}>
                    </div>
                    <div class="request-avatar">${initials}</div>
                    <div class="request-card-info">
                        <h3 class="request-card-name">${escapeHtml(fullName)}</h3>
                        <p class="request-card-username">@${escapeHtml(username)}</p>
                    </div>
                    ${statusBadge}
                </div>
                
                <div class="request-card-details">
                    ${telegramId ? `
                        <div class="request-detail-item">
                            <i data-feather="send"></i>
                            <span>Telegram ID: <strong>${telegramId}</strong></span>
                        </div>
                    ` : ''}
                    ${telegramUsername ? `
                        <div class="request-detail-item">
                            <i data-feather="user"></i>
                            <span>Telegram: <strong>@${escapeHtml(telegramUsername)}</strong></span>
                        </div>
                    ` : ''}
                    ${request.status ? `
                        <div class="request-detail-item">
                            <i data-feather="info"></i>
                            <span>Holat: <strong>${getStatusText(request.status)}</strong></span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="request-timeline">
                    <i data-feather="clock"></i>
                    <span class="request-timeline-text">
                        So'rov yuborilgan: <span class="request-timeline-date">${createdDate}</span>
                    </span>
                </div>
                
                <div class="request-card-actions">
                    <button class="btn btn-success" onclick="window.approveRequest(${request.id})">
                        <i data-feather="check"></i>
                        <span>Tasdiqlash</span>
                    </button>
                    <button class="btn btn-danger" onclick="window.rejectRequest(${request.id})">
                        <i data-feather="x"></i>
                        <span>Rad etish</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    feather.replace();
    setupRequestCheckboxes();
    
    // Update sidebar badge count
    if (DOM.requestsCountBadge) {
        const count = requests.length;
        DOM.requestsCountBadge.textContent = count;
        DOM.requestsCountBadge.classList.toggle('hidden', count === 0);
    }
    
    // Update statistics
    updateRequestsStatistics();
}

// Get request status badge HTML
function getRequestStatusBadge(request) {
    // console.log('📋 Request badge for:', request.username, 'telegram_connection_status:', request.telegram_connection_status);
    
    // If telegram_id exists but telegram_connection_status is null/undefined, user needs admin approval
    if (request.telegram_id && (!request.telegram_connection_status || request.telegram_connection_status === 'pending_admin_approval')) {
        return `
            <div class="request-status-badge status-admin">
                <i data-feather="user-check"></i>
                <span>Admin</span>
            </div>
        `;
    }
    
    if (!request.telegram_connection_status || request.telegram_connection_status === 'pending_subscription' || request.telegram_connection_status === 'not_connected') {
        return `
            <div class="request-status-badge status-telegram">
                <i data-feather="send"></i>
                <span>Telegram</span>
            </div>
        `;
    } else if (request.telegram_connection_status === 'subscribed' || request.telegram_connection_status === 'connected') {
        return `
            <div class="request-status-badge status-admin">
                <i data-feather="user-check"></i>
                <span>Admin</span>
            </div>
        `;
    } else if (request.telegram_connection_status === 'in_process') {
        return `
            <div class="request-status-badge status-process">
                <i data-feather="loader"></i>
                <span>Jarayonda</span>
            </div>
        `;
    }
    return '';
}

// Update requests statistics
function updateRequestsStatistics() {
    // Use state.pendingUsers if available, otherwise filter state.users
    let pendingUsers = [];
    if (state.pendingUsers && state.pendingUsers.length > 0) {
        pendingUsers = state.pendingUsers;
    } else if (state.users && state.users.length > 0) {
        pendingUsers = state.users.filter(u => u.status === 'pending');
    }
    
    // Count by status
    // Telegram kutmoqda - null, undefined yoki pending_subscription
    const telegramPending = pendingUsers.filter(u => !u.telegram_connection_status || u.telegram_connection_status === 'pending_subscription' || u.telegram_connection_status === 'not_connected').length;
    
    // Admin tasdiq - telegram_id bor lekin connection_status null yoki pending_admin_approval
    const adminPending = pendingUsers.filter(u => 
        (u.telegram_id && (!u.telegram_connection_status || u.telegram_connection_status === 'pending_admin_approval')) ||
        u.telegram_connection_status === 'subscribed' || 
        u.telegram_connection_status === 'connected'
    ).length;
    
    const inProcess = pendingUsers.filter(u => u.telegram_connection_status === 'in_process').length;
    
    // Count today's requests
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRequests = pendingUsers.filter(u => {
        const created = new Date(u.created_at);
        return created >= today;
    }).length;
    
    // Mock data for approved/rejected (real data would come from history)
    const approvedToday = 0; // TODO: Get from history table
    const rejectedToday = 0; // TODO: Get from history table
    const totalToday = todayRequests + approvedToday + rejectedToday;
    const approvalRate = totalToday > 0 ? Math.round((approvedToday / totalToday) * 100) : 0;
    const rejectionRate = totalToday > 0 ? Math.round((rejectedToday / totalToday) * 100) : 0;
    
    // Update DOM
    updateElement('pending-requests-count', pendingUsers.length);
    updateElement('today-requests-count', todayRequests);
    updateElement('approved-today-count', approvedToday);
    updateElement('rejected-today-count', rejectedToday);
    updateElement('approval-rate', `${approvalRate}%`);
    updateElement('rejection-rate', `${rejectionRate}%`);
    
    // Update filter badges
    updateElement('request-status-count-all', pendingUsers.length);
    updateElement('request-status-count-telegram', telegramPending);
    // Admin tasdiq va Jarayonda sanogichlari olib tashlandi
    
    // Update pending text
    const pendingText = pendingUsers.length === 0 ? 'Hammasi tasdiqlangan' : 
                       pendingUsers.length === 1 ? '1 ta so\'rov' : 
                       `${pendingUsers.length} ta so'rov`;
    updateElement('pending-requests-text', pendingText);
    
    // Update sidebar badge count
    if (DOM.requestsCountBadge) {
        const count = pendingUsers.length;
        DOM.requestsCountBadge.textContent = count;
        DOM.requestsCountBadge.classList.toggle('hidden', count === 0);
    }
    
    // Show/hide bulk approve button
    const bulkApproveBtn = document.getElementById('bulk-approve-all-btn');
    if (bulkApproveBtn) {
        bulkApproveBtn.style.display = pendingUsers.length > 0 ? 'flex' : 'none';
    }
}

// Setup request checkboxes
function setupRequestCheckboxes() {
    document.querySelectorAll('.request-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const requestId = parseInt(e.target.dataset.requestId);
            if (e.target.checked) {
                selectedRequests.add(requestId);
            } else {
                selectedRequests.delete(requestId);
            }
            updateRequestsBulkActions();
        });
    });
}

// Update requests bulk actions visibility
function updateRequestsBulkActions() {
    const bulkContainer = document.getElementById('requests-bulk-actions');
    const selectedCountEl = document.getElementById('requests-selected-count');
    
    if (bulkContainer && selectedCountEl) {
        bulkContainer.style.display = selectedRequests.size > 0 ? 'flex' : 'none';
        selectedCountEl.textContent = selectedRequests.size;
    }
    
    // Update checkboxes state
    document.querySelectorAll('.request-checkbox').forEach(checkbox => {
        const requestId = parseInt(checkbox.dataset.requestId);
        checkbox.checked = selectedRequests.has(requestId);
    });
}

// Setup requests filters
function setupRequestsFilters() {
    // Status filter badges
    document.querySelectorAll('#requests-status-badges .filter-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            const status = e.currentTarget.dataset.requestStatus;
            
            // Update active state
            document.querySelectorAll('#requests-status-badges .filter-badge').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            // Update filter and render
            currentRequestsFilter.status = status;
            renderModernRequests();
        });
    });
    
    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sort = e.currentTarget.dataset.sort;
            
            // Update active state
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            // Update filter and render
            currentRequestsFilter.sort = sort;
            renderModernRequests();
        });
    });
    
    // Refresh button
    const refreshBtn = document.getElementById('refresh-requests-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i data-feather="loader"></i><span>Yuklanmoqda...</span>';
            feather.replace();
            
            await fetchUsers();
            renderModernRequests();
            updateRequestsStatistics();
            
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i data-feather="refresh-cw"></i><span>Yangilash</span>';
            feather.replace();
            showToast('So\'rovlar yangilandi', 'success');
        });
    }
    
    // Bulk approve all button
    const bulkApproveAllBtn = document.getElementById('bulk-approve-all-btn');
    if (bulkApproveAllBtn) {
        bulkApproveAllBtn.addEventListener('click', async () => {
            const pendingUsers = state.users.filter(u => u.status === 'pending');
            if (pendingUsers.length === 0) return;
            
            const confirmed = await showConfirmDialog({
                title: 'Barchani tasdiqlash',
                message: `Barcha ${pendingUsers.length} ta so'rovni tasdiqlashni xohlaysizmi?`,
                confirmText: 'Ha, tasdiqlash',
                cancelText: 'Bekor qilish',
                type: 'warning',
                icon: 'check-circle'
            });
            if (!confirmed) return;
            
            try {
                for (const user of pendingUsers) {
                    await api.post('/api/admin/users/approve', { userId: user.id });
                }
                
                showToast('Barcha so\'rovlar tasdiqlandi', 'success');
                await fetchUsers();
                renderModernRequests();
                updateRequestsStatistics();
            } catch (error) {
                showToast(`Xatolik: ${error.message}`, 'error');
            }
        });
    }
    
    // Bulk actions for selected requests
    const bulkApproveBtn = document.getElementById('requests-bulk-approve-btn');
    if (bulkApproveBtn) {
        bulkApproveBtn.addEventListener('click', async () => {
            if (selectedRequests.size === 0) return;
            
            const confirmed = await showConfirmDialog({
                title: 'Tanlanganlarni tasdiqlash',
                message: `Tanlangan ${selectedRequests.size} ta so'rovni tasdiqlashni xohlaysizmi?`,
                confirmText: 'Ha, tasdiqlash',
                cancelText: 'Bekor qilish',
                type: 'warning',
                icon: 'check-circle'
            });
            if (!confirmed) return;
            
            try {
                console.log('✅ [BULK APPROVE] Tanlangan so\'rovlar tasdiqlanmoqda. Count:', selectedRequests.size);
                
                for (const userId of selectedRequests) {
                    console.log('📤 [BULK APPROVE] User ID tasdiqlanmoqda:', userId);
                    const res = await safeFetch(`/api/users/${userId}/approve`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            role: 'operator',
                            locations: [],
                            brands: []
                        })
                    });
                    
                    if (!res || !res.ok) {
                        const errorData = await res.json();
                        console.error('❌ [BULK APPROVE] Xatolik User ID:', userId, errorData);
                        throw new Error(errorData?.message || `User ID ${userId} tasdiqlashda xatolik`);
                    }
                    
                    console.log('✅ [BULK APPROVE] User ID tasdiqlandi:', userId);
                }
                
                showToast('Tanlangan so\'rovlar tasdiqlandi', 'success');
                selectedRequests.clear();
                
                const [pendingRes, usersRes] = await Promise.all([
                    fetchPendingUsers(),
                    fetchUsers()
                ]);
                
                if (pendingRes) {
                    state.pendingUsers = pendingRes;
                }
                if (usersRes) {
                    state.users = usersRes;
                }
                
                renderModernRequests();
                updateRequestsStatistics();
                updateRequestsBulkActions();
                
                console.log('✅ [BULK APPROVE] Barcha ma\'lumotlar yangilandi');
            } catch (error) {
                console.error('❌ [BULK APPROVE] Xatolik:', error);
                showToast(`Xatolik: ${error.message}`, 'error');
            }
        });
    }
    
    const bulkRejectBtn = document.getElementById('requests-bulk-reject-btn');
    if (bulkRejectBtn) {
        bulkRejectBtn.addEventListener('click', async () => {
            if (selectedRequests.size === 0) return;
            
            const confirmed = await showConfirmDialog({
                title: 'Tanlanganlarni rad etish',
                message: `Tanlangan ${selectedRequests.size} ta so'rovni rad etishni xohlaysizmi?`,
                confirmText: 'Ha, rad etish',
                cancelText: 'Bekor qilish',
                type: 'danger',
                icon: 'x-circle'
            });
            if (!confirmed) return;
            
            try {
                console.log('❌ [BULK REJECT] Tanlangan so\'rovlar rad etilmoqda. Count:', selectedRequests.size);
                
                for (const userId of selectedRequests) {
                    console.log('📤 [BULK REJECT] User ID rad etilmoqda:', userId);
                    const res = await safeFetch(`/api/users/${userId}/reject`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (!res || !res.ok) {
                        const errorData = await res.json();
                        console.error('❌ [BULK REJECT] Xatolik User ID:', userId, errorData);
                        throw new Error(errorData?.message || `User ID ${userId} rad etishda xatolik`);
                    }
                    
                    console.log('✅ [BULK REJECT] User ID rad etildi:', userId);
                }
                
                showToast('Tanlangan so\'rovlar rad etildi', 'success');
                selectedRequests.clear();
                
                const [pendingRes, usersRes] = await Promise.all([
                    fetchPendingUsers(),
                    fetchUsers()
                ]);
                
                if (pendingRes) {
                    state.pendingUsers = pendingRes;
                }
                if (usersRes) {
                    state.users = usersRes;
                }
                
                renderModernRequests();
                updateRequestsStatistics();
                updateRequestsBulkActions();
                
                console.log('✅ [BULK REJECT] Barcha ma\'lumotlar yangilandi');
            } catch (error) {
                console.error('❌ [BULK REJECT] Xatolik:', error);
                showToast(`Xatolik: ${error.message}`, 'error');
            }
        });
    }
}

// Global functions for buttons (onclick handlers)
window.approveRequest = async function(userId) {
    console.log('✅ [APPROVE] Tasdiqlash so\'rovi boshlandi. User ID:', userId);
    
    // Foydalanuvchi ma'lumotlarini topish
    let user = null;
    if (state.pendingUsers && state.pendingUsers.length > 0) {
        user = state.pendingUsers.find(u => u.id === userId);
    }
    if (!user && state.users && state.users.length > 0) {
        user = state.users.find(u => u.id === userId);
    }
    
    const username = user?.username || user?.fullname || `User ${userId}`;
    
    console.log('📋 [APPROVE] Foydalanuvchi ma\'lumotlari:', { userId, username, user });
    
    // Modal ochish - rol va rol shartlarini so'rash
    try {
        await openApprovalModal(userId, username);
        console.log('✅ [APPROVE] Modal ochildi. Foydalanuvchi rol va shartlarni tanlaydi.');
    } catch (error) {
        console.error('❌ [APPROVE] Modal ochishda xatolik:', error);
        showToast(`Xatolik: ${error.message}`, 'error');
    }
};

window.rejectRequest = async function(userId) {
    console.log('❌ [REJECT] Rad etish so\'rovi boshlandi. User ID:', userId);
    
    const confirmed = await showConfirmDialog({
        title: 'So\'rovni rad etish',
        message: 'Ushbu so\'rovni rad etishni xohlaysizmi?',
        confirmText: 'Ha, rad etish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'x-circle'
    });
    
    if (!confirmed) {
        console.log('🚫 [REJECT] Foydalanuvchi bekor qildi');
        return;
    }
    
    try {
        const res = await safeFetch(`/api/users/${userId}/reject`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('📤 [REJECT] API javob:', res);
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            console.error('❌ [REJECT] API xatolik:', errorData);
            throw new Error(errorData?.message || 'Rad etishda xatolik');
        }
        
        const result = await res.json();
        console.log('✅ [REJECT] Muvaffaqiyatli rad etildi. Result:', result);
        
        showToast(result.message || 'So\'rov rad etildi', 'success');
        
        // Ma'lumotlarni yangilash
        const [pendingRes, usersRes] = await Promise.all([
            fetchPendingUsers(),
            fetchUsers()
        ]);
        
        if (pendingRes) {
            state.pendingUsers = pendingRes;
        }
        if (usersRes) {
            state.users = usersRes;
        }
        
        renderModernRequests();
        updateRequestsStatistics();
        
        console.log('✅ [REJECT] Barcha ma\'lumotlar yangilandi');
    } catch (error) {
        console.error('❌ [REJECT] Xatolik:', error);
        showToast(`Xatolik: ${error.message}`, 'error');
    }
};

// viewRequestDetails function removed - modal deleted

// Format relative time
function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Hozirgina';
    if (diffMins < 60) return `${diffMins} daqiqa oldin`;
    if (diffHours < 24) return `${diffHours} soat oldin`;
    if (diffDays < 7) return `${diffDays} kun oldin`;
    
    return date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Format date and time (aniq vaqt) - Toshkent vaqti (+5) bilan hisoblanadi
function formatDateTime(timestamp) {
    // Timestamp'ni to'g'ri parse qilish
    // Agar timestamp string formatida bo'lsa (masalan: "2025-12-07 09:49:37")
    // uni ISO formatiga o'tkazish kerak
    let date;
    
    if (typeof timestamp === 'string') {
        // SQLite formatini ISO formatiga o'tkazish
        // "2025-12-07 09:49:37" -> "2025-12-07T09:49:37"
        const isoString = timestamp.replace(' ', 'T');
        // Agar timezone yo'q bo'lsa, UTC sifatida qabul qilamiz
        // Keyin Toshkent vaqtiga konvertatsiya qilamiz
        date = new Date(isoString + 'Z'); // Z qo'shish UTC ekanligini bildiradi
    } else {
        date = new Date(timestamp);
    }
    
    console.log('🕐 [formatDateTime] Original timestamp:', timestamp);
    console.log('🕐 [formatDateTime] Parsed date object:', date);
    console.log('🕐 [formatDateTime] UTC time:', date.toISOString());
    
    // Toshkent vaqti (UTC+5) - Intl.DateTimeFormat ishlatish
    // Vaqt Toshkent mintaqasida hisoblanadi, lekin "+5 Toshkent" yozuvi ko'rsatilmaydi
    const formatter = new Intl.DateTimeFormat('uz-UZ', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    // Format qilish va tozalash
    const parts = formatter.formatToParts(date);
    const day = parts.find(p => p.type === 'day').value;
    const month = parts.find(p => p.type === 'month').value;
    const year = parts.find(p => p.type === 'year').value;
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const second = parts.find(p => p.type === 'second').value;
    
    const formattedTime = `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
    
    console.log('🕐 [formatDateTime] Toshkent time parts:', { day, month, year, hour, minute, second });
    console.log('🕐 [formatDateTime] Formatted result:', formattedTime);
    
    // "+5 Toshkent" yozuvini olib tashlash, faqat vaqt ko'rsatiladi
    return formattedTime;
}

// Rol shartlarini belgilash modalini ochish
function openRoleRequirementsModal(roleName, roleData) {
    console.log(`🔧 [WEB] Rol shartlarini belgilash modal'i ochilmoqda. Role: ${roleName}`);
    
    // Modal yaratish
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" style="max-width: 600px;">
            <div class="modal-content" style="background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <h5 class="modal-title" style="color: #fff; display: flex; align-items: center; gap: 10px;">
                        <i data-feather="settings" style="width: 24px; height: 24px;"></i>
                        <span>Rol Shartlarini Belgilash</span>
                    </h5>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="filter: invert(1);"></button>
                </div>
                <div class="modal-body" style="padding: 25px;">
                    <div style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0;">
                            <strong style="color: #ffc107;">"${roleName}"</strong> roli uchun shartlar belgilanmagan. 
                            Shartlar belgilanmasa, foydalanuvchiga bu rolni berib bo'lmaydi.
                        </p>
                    </div>
                    <form id="role-requirements-form">
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 10px; color: #fff; font-size: 14px; margin-bottom: 10px; cursor: pointer;">
                                <input type="checkbox" id="modal-requires-locations" style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Filiallar belgilanishi shart</span>
                            </label>
                            <small style="display: block; color: rgba(255,255,255,0.6); font-size: 12px; margin-left: 28px; margin-top: 5px;">
                                Bu rol uchun foydalanuvchi tasdiqlanganda filiallar tanlanishi majburiy bo'ladi
                            </small>
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 10px; color: #fff; font-size: 14px; margin-bottom: 10px; cursor: pointer;">
                                <input type="checkbox" id="modal-requires-brands" style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Brendlar belgilanishi shart</span>
                            </label>
                            <small style="display: block; color: rgba(255,255,255,0.6); font-size: 12px; margin-left: 28px; margin-top: 5px;">
                                Bu rol uchun foydalanuvchi tasdiqlanganda brendlar tanlanishi majburiy bo'ladi
                            </small>
                        </div>
                        <div style="background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px; padding: 12px; margin-top: 15px;">
                            <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 0;">
                                <i data-feather="info" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 5px;"></i>
                                Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar yoki ikkalasi ham)
                            </p>
                        </div>
                    </form>
                </div>
                <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.1); padding: 15px 25px;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff;">
                        Bekor qilish
                    </button>
                    <button type="button" id="save-role-requirements-modal-btn" class="btn btn-primary" style="background: #4facfe; border: none; color: #fff;">
                        <i data-feather="save" style="width: 16px; height: 16px;"></i>
                        Shartlarni Saqlash va Davom Etish
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    feather.replace();
    
    // Saqlash tugmasi event listener
    const saveBtn = document.getElementById('save-role-requirements-modal-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const requiresLocations = document.getElementById('modal-requires-locations').checked;
            const requiresBrands = document.getElementById('modal-requires-brands').checked;
            
            // Validatsiya: kamida bitta shart tanlanishi kerak
            if (!requiresLocations && !requiresBrands) {
                showToast('Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar)', true);
                return;
            }
            
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
            
            try {
                const res = await safeFetch(`/api/roles/${roleName}/requirements`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requires_locations: requiresLocations,
                        requires_brands: requiresBrands
                    })
                });
                
                if (!res || !res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData?.message || 'Rol shartlarini saqlashda xatolik');
                }
                
                const result = await res.json();
                console.log('✅ [WEB] Rol shartlari saqlandi:', result);
                
                // State'ni yangilash
                const roleIndex = state.roles.findIndex(r => r.role_name === roleName);
                if (roleIndex > -1) {
                    state.roles[roleIndex].requires_locations = requiresLocations;
                    state.roles[roleIndex].requires_brands = requiresBrands;
                }
                
                // Modal yopish
                modal.remove();
                
                // Tasdiqlash modal'ini yangilash
                await toggleLocationVisibilityForApprovalForm();
                
                showToast('Rol shartlari saqlandi. Endi filiallar va brendlarni tanlashingiz mumkin.', 'success');
                
            } catch (error) {
                console.error('❌ [WEB] Rol shartlarini saqlashda xatolik:', error);
                showToast(error.message, true);
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i data-feather="save" style="width: 16px; height: 16px;"></i> Shartlarni Saqlash va Davom Etish';
                feather.replace();
            }
        };
    }
}

// Get status text in Uzbek
function getStatusText(status) {
    const statusMap = {
        'pending_telegram_subscription': 'Botga obuna bo\'lishni kutmoqda',
        'pending_approval': 'Admin tasdiqlashini kutmoqda',
        'status_in_process': 'Jarayonda'
    };
    return statusMap[status] || status;
}

// Initialize requests section
export function initModernRequestsPage() {
    setupRequestsFilters();
    renderModernRequests();
    updateRequestsStatistics();
}
