// Roles Module
// Rollar va huquqlarni boshqarish

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast, showConfirmDialog } from './utils.js';

const permissionExclusionGroups = {
    view: ['reports:view_all', 'reports:view_assigned', 'reports:view_own'],
    edit: ['reports:edit_all', 'reports:edit_assigned', 'reports:edit_own']
};

// Category iconlarini qaytarish
function getCategoryIcon(category) {
    const icons = {
        'Boshqaruv Paneli': '📊',
        'Dashboard': '📊',
        'Hisobotlar': '📝',
        'Reports': '📝',
        'Foydalanuvchilar': '👥',
        'Users': '👥',
        'Rollar': '🔐',
        'Roles': '🔐',
        'Sozlamalar': '⚙️',
        'Settings': '⚙️',
        'Audit': '📋',
        'Tizim Jurnali': '📋',
        'Export': '📤',
        'Import': '📥',
        'KPI': '📈',
        'Filiallar': '🏢',
        'Brendlar': '🏷️',
        'Brands': '🏷️'
    };
    return icons[category] || '🔒';
}

// Category'ni kengaytirish/yig'ish funksiyasi
window.toggleRoleCategory = function(header) {
    const group = header.closest('.permission-category-group');
    if (!group) return;
    
    group.classList.toggle('collapsed');
    
    const content = group.querySelector('.permission-category-content');
    const arrow = header.querySelector('.category-arrow');
    
    if (group.classList.contains('collapsed')) {
        content.style.maxHeight = '0';
        if (arrow) arrow.style.transform = 'rotate(-90deg)';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }
};

export function renderRoles(autoSelectRole = null) {
    console.log('🔄 [ROLES] renderRoles chaqirildi:', { 
        autoSelectRole, 
        currentEditingRole: state.currentEditingRole,
        rolesCount: state.roles?.length || 0,
        hasPermissions: !!state.allPermissions
    });
    
    if (!state.roles || !state.allPermissions) {
        console.warn('⚠️ [ROLES] renderRoles: state.roles yoki state.allPermissions mavjud emas');
        return;
    }
    
    // Joriy tanlangan rolni saqlash
    const currentSelectedRole = autoSelectRole || state.currentEditingRole;
    console.log('📌 [ROLES] Tanlash uchun rol:', currentSelectedRole);
    
    // Superadmin'ni ro'yxatdan olib tashlash (super_admin va superadmin)
    const filteredRoles = state.roles.filter(role => 
        role.role_name !== 'super_admin' && role.role_name !== 'superadmin'
    );
    console.log('📋 [ROLES] Filtrlangan rollar soni:', filteredRoles.length);
    
    DOM.rolesList.innerHTML = filteredRoles.map(role => 
        `<li data-role="${role.role_name}" class="role-list-item">
            <span class="role-name" onclick="handleRoleItemClick(event, '${role.role_name}')">${role.role_name}</span>
            <div class="role-actions">
                <button class="role-action-btn role-edit-btn" onclick="event.stopPropagation(); editRole('${role.role_name}')" title="Tahrirlash">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="role-action-btn role-delete-btn" onclick="event.stopPropagation(); deleteRole('${role.role_name}')" title="O'chirish">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
            </div>
        </li>`
    ).join('');
    
    // Event listeners
    setupRoleListEventListeners();
    
    DOM.permissionsGrid.innerHTML = Object.entries(state.allPermissions).map(([category, perms]) => `
        <div class="permission-category-group collapsed">
            <div class="permission-category-header" onclick="toggleRoleCategory(this)">
                <div class="permission-category-title">
                    ${getCategoryIcon(category)} ${category}
                    <span class="permission-count">(${perms.length})</span>
                </div>
                <svg class="category-arrow" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transform: rotate(-90deg);">
                    <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                </svg>
            </div>
            <div class="permission-category-content" style="max-height: 0;">
                <div class="permission-list">
                    ${perms.map(perm => `
                        <label class="permission-item">
                            <input type="checkbox" value="${perm.key}">
                            <span>${perm.description}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('');

    // Oldingi listenerlarni tozalash va yangidan biriktirish
    DOM.permissionsGrid.removeEventListener('change', handlePermissionChange);
    DOM.permissionsGrid.addEventListener('change', handlePermissionChange);

    // "Barchasini belgilash" va "tozalash" tugmalari uchun handlerlar
    const selectAllBtn = document.getElementById('select-all-permissions-btn');
    const deselectAllBtn = document.getElementById('deselect-all-permissions-btn');

    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            const checkboxes = DOM.permissionsGrid.querySelectorAll('input[type=\"checkbox\"]');
            checkboxes.forEach(cb => {
                cb.checked = true;
            });
            applyAllPermissionExclusions();
        };
    }

    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            const checkboxes = DOM.permissionsGrid.querySelectorAll('input[type=\"checkbox\"]');
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            applyAllPermissionExclusions();
        };
    }
    
    // Rolni tanlash: avval joriy tanlangan rolni, keyin yangi yaratilgan rolni, oxirida birinchi rolni
    if (filteredRoles.length > 0) {
        let roleToSelect = null;
        
        // 1. Agar autoSelectRole berilgan bo'lsa, uni tanlash
        if (autoSelectRole) {
            roleToSelect = filteredRoles.find(r => r.role_name === autoSelectRole);
        }
        
        // 2. Agar joriy tanlangan rol mavjud bo'lsa va hali tanlanmagan bo'lsa, uni tanlash
        if (!roleToSelect && currentSelectedRole) {
            roleToSelect = filteredRoles.find(r => r.role_name === currentSelectedRole);
        }
        
        // 3. Agar hech narsa topilmasa, birinchi rolni tanlash
        if (!roleToSelect) {
            roleToSelect = filteredRoles[0];
        }
        
        const roleElement = DOM.rolesList.querySelector(`[data-role="${roleToSelect.role_name}"]`);
        console.log('🎯 [ROLES] Tanlash uchun rol elementi:', { 
            roleName: roleToSelect.role_name, 
            elementFound: !!roleElement 
        });
        
        if (roleElement) {
            // requestAnimationFrame va setTimeout kombinatsiyasi - DOM to'liq tayyor bo'lishi uchun
            requestAnimationFrame(() => {
                setTimeout(() => {
                    console.log('✅ [ROLES] Rol tanlanmoqda:', roleToSelect.role_name);
                    const element = DOM.rolesList.querySelector(`[data-role="${roleToSelect.role_name}"]`);
                    if (element) {
                        handleRoleSelection({ target: element });
                    } else {
                        console.error('❌ [ROLES] Rol elementi topilmadi tanlash vaqtida:', roleToSelect.role_name);
                    }
                }, 150); // 100ms dan 150ms ga oshirildi
            });
        } else {
            console.error('❌ [ROLES] Rol elementi topilmadi:', roleToSelect.role_name);
        }
    } else {
        // Agar hech qanday rol bo'lmasa (faqat superadmin bo'lsa), hech narsa ko'rsatmaslik
        DOM.currentRoleTitle.textContent = 'Rol tanlang';
        DOM.saveRolePermissionsBtn.classList.add('hidden');
    }
}

// Role list item click handler
window.handleRoleItemClick = function(event, roleName) {
    const li = event.target.closest('li');
    if (!li) return;
    handleRoleSelection({ target: li });
};

// Setup role list event listeners
function setupRoleListEventListeners() {
    // Click handlers are already set via onclick in HTML
}

// Edit role function
window.editRole = async function(roleName) {
    if (!state.roles || !Array.isArray(state.roles)) {
        console.warn('[ROLES] state.roles mavjud emas yoki array emas');
        showToast('Rollar yuklanmagan. Iltimos, sahifani yangilang.', 'error');
        return;
    }
    
    const roleData = state.roles.find(r => r.role_name === roleName);
    if (!roleData) {
        showToast('Rol topilmadi!', 'error');
        return;
    }
    
    // Open edit modal (reuse create modal structure)
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                            <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/>
                        </svg>
                        Rolni Tahrirlash: ${roleName}
                    </h5>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()"></button>
                </div>
                <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                    <div class="form-group">
                        <label>Filiallar belgilanishi shart</label>
                        <label style="display: flex; align-items: center; margin-top: 8px;">
                            <input type="checkbox" id="edit-role-requires-locations" style="margin-right: 8px;" ${roleData.requires_locations ? 'checked' : ''}>
                            <span>Filiallar belgilanishi shart</span>
                        </label>
                        <small class="form-text text-muted" style="display: block; margin-top: 5px;">
                            Bu rol uchun foydalanuvchi tasdiqlanganda filiallar tanlanishi majburiy bo'ladi
                        </small>
                    </div>
                    <div class="form-group">
                        <label>Brendlar belgilanishi shart</label>
                        <label style="display: flex; align-items: center; margin-top: 8px;">
                            <input type="checkbox" id="edit-role-requires-brands" style="margin-right: 8px;" ${roleData.requires_brands ? 'checked' : ''}>
                            <span>Brendlar belgilanishi shart</span>
                        </label>
                        <small class="form-text text-muted" style="display: block; margin-top: 5px;">
                            Bu rol uchun foydalanuvchi tasdiqlanganda brendlar tanlanishi majburiy bo'ladi
                        </small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Bekor qilish</button>
                    <button type="button" class="btn btn-primary" id="update-role-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/>
                        </svg>
                        Saqlash
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Feather icons
    if (window.feather) {
        window.feather.replace();
    }
    
    // Update button handler
    document.getElementById('update-role-btn').addEventListener('click', async () => {
        const requiresLocations = document.getElementById('edit-role-requires-locations').checked;
        const requiresBrands = document.getElementById('edit-role-requires-brands').checked;
        
        const btn = document.getElementById('update-role-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
        
        try {
            const response = await safeFetch(`/api/roles/${roleName}/requirements`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requires_locations: requiresLocations,
                    requires_brands: requiresBrands
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update role');
            }
            
            showToast('Rol muvaffaqiyatli yangilandi!', 'success');
            modal.remove();
            
            // Reload roles
            const rolesData = await safeFetch('/api/roles');
            state.roles = rolesData.roles;
            state.allPermissions = rolesData.all_permissions;
            renderRoles();
            
            // Re-select the role
            setTimeout(() => {
                const roleElement = DOM.rolesList.querySelector(`[data-role="${roleName}"]`);
                if (roleElement) {
                    handleRoleSelection({ target: roleElement });
                }
            }, 100);
            
        } catch (error) {
            console.error('Update role error:', error);
            showToast(error.message || 'Rolni yangilashda xatolik!', 'error');
            btn.disabled = false;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg> Saqlash';
        }
    });
};

// Delete role function
window.deleteRole = async function(roleName) {
    const confirmed = await showConfirmDialog({
        title: '⚠️ Rolni O\'chirish',
        message: `"${roleName}" rolini o'chirishni xohlaysizmi? Bu amalni qaytarib bo'lmaydi.`,
        confirmText: 'Ha, o\'chirish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'alert-triangle'
    });
    
    if (!confirmed) return;
    
    try {
        const response = await safeFetch(`/api/roles/${roleName}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to delete role');
        }
        
        showToast('Rol muvaffaqiyatli o\'chirildi!', 'success');
        
        // Reload roles
        const rolesData = await safeFetch('/api/roles');
        state.roles = rolesData.roles;
        state.allPermissions = rolesData.all_permissions;
        renderRoles();
        
        // Clear selection
        DOM.currentRoleTitle.textContent = 'Rol tanlang';
        DOM.saveRolePermissionsBtn.classList.add('hidden');
        DOM.permissionsGrid.innerHTML = '';
        
    } catch (error) {
        console.error('Delete role error:', error);
        showToast(error.message || 'Rolni o\'chirishda xatolik!', 'error');
    }
};

export function handleRoleSelection(e) {
    console.log('🎯 [ROLES] handleRoleSelection chaqirildi:', { 
        target: e.target, 
        closest: e.target?.closest('li') 
    });
    
    const li = e.target.closest('li');
    if (!li) {
        console.error('❌ [ROLES] handleRoleSelection: li elementi topilmadi');
        return;
    }
    
    const roleName = li.dataset.role;
    console.log('✅ [ROLES] Rol tanlandi:', roleName);
    state.currentEditingRole = roleName;
    
    DOM.rolesList.querySelectorAll('li').forEach(item => item.classList.remove('active'));
    li.classList.add('active');
    
    DOM.currentRoleTitle.textContent = `"${roleName}" roli uchun huquqlar`;
    DOM.saveRolePermissionsBtn.classList.remove('hidden');
    
    // state.roles mavjudligini tekshirish
    if (!state.roles || !Array.isArray(state.roles)) {
        console.warn('[ROLES] state.roles mavjud emas yoki array emas, roleData olinmadi');
        const rolePermissions = [];
        const roleData = null;
        
        // Checkboxlarni tozalash
        const checkboxes = DOM.permissionsGrid.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
        
        applyAllPermissionExclusions();
        showRoleRequirements(roleData);
        
        // Faqat superadmin roli uchun huquqlarni o'zgartirish mumkin emas
        if (roleName === 'superadmin' || roleName === 'super_admin') {
            DOM.permissionsPanel.classList.add('disabled');
            DOM.saveRolePermissionsBtn.classList.add('hidden');
        } else {
            DOM.permissionsPanel.classList.remove('disabled');
        }
        return;
    }
    
    const roleData = state.roles.find(r => r.role_name === roleName);
    const rolePermissions = roleData ? roleData.permissions : [];
    // console.log('🎯 Role permissions:', rolePermissions);
    
    const checkboxes = DOM.permissionsGrid.querySelectorAll('input[type="checkbox"]');
    // console.log('🎯 Found checkboxes:', checkboxes.length);
    checkboxes.forEach(cb => {
        cb.checked = rolePermissions.includes(cb.value);
    });
    
    applyAllPermissionExclusions();
    
    // Rol talablarini ko'rsatish va tahrirlash imkoniyatini qo'shish
    showRoleRequirements(roleData);
    
    // Faqat superadmin roli uchun huquqlarni o'zgartirish mumkin emas
    if (roleName === 'superadmin' || roleName === 'super_admin') {
        DOM.permissionsPanel.classList.add('disabled');
        DOM.saveRolePermissionsBtn.classList.add('hidden');
        // Xabar ko'rsatish
        const warningMsg = document.createElement('div');
        warningMsg.className = 'alert alert-warning';
        warningMsg.style.marginTop = '10px';
        warningMsg.textContent = 'Superadmin rolining huquqlarini o\'zgartirish mumkin emas.';
        // Eski xabarni olib tashlash
        const oldWarning = DOM.permissionsPanel.querySelector('.alert-warning');
        if (oldWarning) oldWarning.remove();
        DOM.permissionsPanel.appendChild(warningMsg);
    } else {
        // Boshqa barcha rollar uchun huquqlarni o'zgartirish mumkin
        DOM.permissionsPanel.classList.remove('disabled');
        DOM.saveRolePermissionsBtn.classList.remove('hidden');
        // Xabarni olib tashlash
        const warningMsg = DOM.permissionsPanel.querySelector('.alert-warning');
        if (warningMsg) warningMsg.remove();
    }
    // console.log('🎯 Role selection completed');
}

function showRoleRequirements(roleData) {
    // Superadmin uchun shartlarni ko'rsatmaslik (to'liq dostup)
    if (!roleData || roleData.role_name === 'superadmin' || roleData.role_name === 'super_admin') {
        const existingPanel = document.getElementById('role-requirements-panel');
        if (existingPanel) {
            existingPanel.remove();
        }
        return;
    }
    
    // Admin roli uchun shartlarni ko'rsatish (ixtiyoriy)
    // Admin roli uchun huquqlarni o'zgartirish mumkin emas, lekin shartlarni o'zgartirish mumkin
    
    // Rol talablarini ko'rsatish uchun panel yaratish yoki yangilash
    let requirementsPanel = document.getElementById('role-requirements-panel');
    
    if (!requirementsPanel) {
        // Panel yaratish
        requirementsPanel = document.createElement('div');
        requirementsPanel.id = 'role-requirements-panel';
        requirementsPanel.className = 'card';
        requirementsPanel.style.marginTop = '20px';
        requirementsPanel.innerHTML = `
            <div class="card-header">
                <h4>
                    <i data-feather="settings"></i>
                    <span>Rol Talablari</span>
                </h4>
            </div>
            <div class="card-body">
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="role-requires-locations">
                        Filiallar belgilanishi shart
                    </label>
                    <small class="form-text text-muted">
                        Bu rol uchun foydalanuvchi tasdiqlanganda filiallar tanlanishi majburiy bo'ladi
                    </small>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="role-requires-brands">
                        Brendlar belgilanishi shart
                    </label>
                    <small class="form-text text-muted">
                        Bu rol uchun foydalanuvchi tasdiqlanganda brendlar tanlanishi majburiy bo'ladi
                    </small>
                </div>
                <button id="save-role-requirements-btn" class="btn btn-primary">
                    <i data-feather="save"></i>
                    <span>Talablarni Saqlash</span>
                </button>
            </div>
        `;
        
        // Permissions panel'dan keyin qo'shish
        const permissionsPanel = document.querySelector('.permissions-panel');
        if (permissionsPanel && permissionsPanel.parentNode) {
            permissionsPanel.parentNode.insertBefore(requirementsPanel, permissionsPanel.nextSibling);
        }
        
        // Save button event listener
        document.getElementById('save-role-requirements-btn').addEventListener('click', saveRoleRequirements);
        
        feather.replace();
    }
    
    // Rol talablarini ko'rsatish
    if (roleData) {
        document.getElementById('role-requires-locations').checked = roleData.requires_locations || false;
        document.getElementById('role-requires-brands').checked = roleData.requires_brands || false;
    } else {
        document.getElementById('role-requires-locations').checked = false;
        document.getElementById('role-requires-brands').checked = false;
    }
    
    requirementsPanel.style.display = 'block';
}

async function saveRoleRequirements() {
    if (!state.currentEditingRole) return;
    
    const requiresLocations = document.getElementById('role-requires-locations').checked;
    const requiresBrands = document.getElementById('role-requires-brands').checked;
    
    // Validatsiya: kamida bitta shart tanlanishi kerak
    if (!requiresLocations && !requiresBrands) {
        showToast('⚠️ Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar). Agar ikkalasi ham tanlanmagan bo\'lsa, foydalanuvchi hech qanday ma\'lumot ko\'ra olmaydi.', true);
        return;
    }
    
    const btn = document.getElementById('save-role-requirements-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
    
    try {
        const res = await safeFetch(`/api/roles/${state.currentEditingRole}/requirements`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requires_locations: requiresLocations,
                requires_brands: requiresBrands
            })
        });
        
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        const result = await res.json();
        showToast(result.message);
        
        // State'ni yangilash
        if (state.roles && Array.isArray(state.roles)) {
            const roleIndex = state.roles.findIndex(r => r.role_name === state.currentEditingRole);
            if (roleIndex > -1) {
                state.roles[roleIndex].requires_locations = requiresLocations;
                state.roles[roleIndex].requires_brands = requiresBrands;
                
                // UI'ni yangilash
                showRoleRequirements(state.roles[roleIndex]);
            }
        }
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

export async function saveRolePermissions() {
    if (!state.currentEditingRole) return;
    
    // Faqat superadmin roli uchun huquqlarni o'zgartirish mumkin emas
    if (state.currentEditingRole === 'superadmin' || state.currentEditingRole === 'super_admin') {
        showToast('Superadmin rolining huquqlarini o\'zgartirish mumkin emas.', true);
        return;
    }
    
    const checkedPermissions = Array.from(DOM.permissionsGrid.querySelectorAll('input:checked'))
        .map(cb => cb.value);
    
    try {
        const res = await safeFetch(`/api/roles/${state.currentEditingRole}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: checkedPermissions })
        });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        const result = await res.json();
        showToast(result.message);
        
        if (state.roles && Array.isArray(state.roles)) {
            const roleIndex = state.roles.findIndex(r => r.role_name === state.currentEditingRole);
            if (roleIndex > -1) {
                state.roles[roleIndex].permissions = checkedPermissions;
            }
        }
    } catch (error) {
        showToast(error.message, true);
    }
}

function handlePermissionChange(event) {
    const changedCheckbox = event.target;
    if (changedCheckbox.tagName !== 'INPUT' || changedCheckbox.type !== 'checkbox') return;
    
    const changedPermission = changedCheckbox.value;
    
    for (const groupName in permissionExclusionGroups) {
        const group = permissionExclusionGroups[groupName];
        if (group.includes(changedPermission)) {
            if (changedCheckbox.checked) {
                group.forEach(permKey => {
                    if (permKey !== changedPermission) {
                        const checkbox = DOM.permissionsGrid.querySelector(`input[value="${permKey}"]`);
                        if (checkbox) checkbox.checked = false;
                    }
                });
            }
            applyPermissionExclusionsForGroup(group);
            break;
        }
    }
}

function applyPermissionExclusionsForGroup(group) {
    let checkedPermission = null;
    
    for (const permKey of group) {
        const checkbox = DOM.permissionsGrid.querySelector(`input[value="${permKey}"]`);
        if (checkbox && checkbox.checked) {
            checkedPermission = permKey;
            break;
        }
    }
    
    group.forEach(permKey => {
        const checkbox = DOM.permissionsGrid.querySelector(`input[value="${permKey}"]`);
        if (checkbox) {
            const item = checkbox.closest('.permission-item');
            const shouldBeDisabled = checkedPermission && permKey !== checkedPermission;
            checkbox.disabled = shouldBeDisabled;
            if (item) item.classList.toggle('disabled', shouldBeDisabled);
        }
    });
}

function applyAllPermissionExclusions() {
    for (const groupName in permissionExclusionGroups) {
        applyPermissionExclusionsForGroup(permissionExclusionGroups[groupName]);
    }
}

export async function handleBackupDb() {
    const confirmed = await showConfirmDialog({
        title: '💾 Ma\'lumotlar bazasi nusxasi',
        message: "Rostdan ham ma'lumotlar bazasining to'liq nusxasini yuklab olmoqchimisiz?",
        confirmText: 'Yuklab olish',
        cancelText: 'Bekor qilish',
        type: 'info',
        icon: 'database'
    });
    
    if (!confirmed) return;
    
    try {
        showToast('📥 Database yuklab olinmoqda...');
        const response = await safeFetch('/api/admin/backup-db');
        if (!response || !response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Baza nusxasini olib bo\'lmadi');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        const disposition = response.headers.get('content-disposition');
        let fileName = `database_backup_${new Date().toISOString().split('T')[0]}.db`;
        if (disposition && disposition.indexOf('attachment') !== -1) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(disposition);
            if (matches != null && matches[1]) { 
                fileName = matches[1].replace(/['"]/g, '');
            }
        }
        
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast("✅ Baza nusxasi muvaffaqiyatli yuklab olindi.");
    } catch (error) {
        showToast(error.message, true);
    }
}

// Database restore funksiyasi (YANGI)
export async function handleRestoreDb() {
    const confirmed = await showConfirmDialog({
        title: '⚠️ DIQQAT! Database Restore',
        message: "Bu amal hozirgi database'ni to'liq almashtiradi. Eski database avtomatik backup qilinadi, lekin server'ni qayta ishga tushirish kerak bo'ladi. Davom etasizmi?",
        confirmText: 'Ha, restore qilish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'alert-triangle'
    });
    
    if (!confirmed) return;
    
    // File input yaratish
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db';
    input.style.display = 'none';
    
    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.db')) {
            showToast('❌ Faqat .db fayllarni yuklash mumkin!', true);
            return;
        }
        
        const finalConfirm = await showConfirmDialog({
            title: '⚠️ OXIRGI TASDIQLASH',
            message: `"${file.name}" faylini restore qilmoqchimisiz? Bu hozirgi barcha ma'lumotlarni o'zgartiradi!`,
            confirmText: 'Ha, restore qilish',
            cancelText: 'Bekor qilish',
            type: 'danger',
            icon: 'alert-triangle'
        });
        
        if (!finalConfirm) return;
        
        try {
            showToast('📤 Database restore qilinmoqda...');
            
            const formData = new FormData();
            formData.append('database', file);
            
            const response = await fetch('/api/admin/restore-db', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Database restore qilishda xatolik');
            }
            
            const result = await response.json();
            
            showToast(`✅ ${result.message}`, false, 10000);
            
            // Warning ko'rsatish
            setTimeout(() => {
                showToast('⚠️ Serverni qayta ishga tushiring (restart)!', true, 15000);
            }, 2000);
            
        } catch (error) {
            showToast(`❌ ${error.message}`, true);
        } finally {
            input.remove();
        }
    });
    
    document.body.appendChild(input);
    input.click();
}

export async function handleClearSessions() {
    const confirmed = await showConfirmDialog({
        title: '⚠️ DIQQAT! Barcha sessiyalarni tozalash',
        message: "Bu amal o'zingizdan tashqari barcha foydalanuvchilarni tizimdan chiqarib yuboradi. Davom etasizmi?",
        confirmText: 'Ha, tozalash',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'alert-triangle'
    });
    
    if (!confirmed) return;
    
    try {
        const res = await safeFetch('/api/admin/clear-sessions', { method: 'POST' });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        const result = await res.json();
        showToast(result.message);
    } catch (error) {
        showToast(error.message, true);
    }
}

/* ===================================================== */
/* === 💾 TO'LIQ DATABASE EXPORT/IMPORT === */
/* ===================================================== */

/**
 * To'liq ma'lumotlar bazasini export qilish
 */
export async function exportFullDatabase() {
    const confirmed = await showConfirmDialog({
        title: '📥 To\'liq Database Export',
        message: 'Barcha ma\'lumotlar (foydalanuvchilar, hisobotlar, tarix, sozlamalar) JSON faylda yuklab olinadi. Davom etasizmi?',
        confirmText: 'Ha, yuklab olish',
        cancelText: 'Bekor qilish',
        type: 'info',
        icon: 'download-cloud'
    });
    
    if (!confirmed) return;
    
    try {
        showProgress('📥 Export jarayoni boshlandi...', 10);
        showToast('📥 Ma\'lumotlar bazasi yuklab olinmoqda...');
        
        showProgress('🔍 Ma\'lumotlarni yig\'ish...', 40);
        
        const response = await safeFetch('/api/admin/export-full-db');
        if (!response || !response.ok) {
            throw new Error('Export qilishda xatolik');
        }
        
        showProgress('💾 Fayl tayyorlanmoqda...', 70);
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Fayl nomini response header dan olish
        let fileName = `full_database_export_${new Date().toISOString().split('T')[0]}.json`;
        const disposition = response.headers.get('content-disposition');
        if (disposition) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (matches && matches[1]) {
                fileName = matches[1].replace(/['"]/g, '');
            }
        }
        
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        
        showProgress('✅ Export muvaffaqiyatli!', 100);
        
        setTimeout(() => {
            hideProgress();
            showToast('✅ Ma\'lumotlar bazasi muvaffaqiyatli yuklab olindi!');
            document.getElementById('export-info').classList.remove('hidden');
        }, 500);
        
    } catch (error) {
        hideProgress();
        // console.error('Export xatolik:', error);
        showToast('❌ Export qilishda xatolik: ' + error.message, true);
    }
}

// Import uchun global o'zgaruvchilar
let currentImportData = null;
let currentImportFile = null;

/**
 * Jadval nomlarini o'zbek tiliga tarjima qilish
 */
function getTableDisplayName(tableName) {
    const translations = {
        'users': '👥 Foydalanuvchilar',
        'roles': '🎭 Rollar',
        'permissions': '🔐 Huquqlar',
        'role_permissions': '🔗 Rol-Huquq Bog\'lanishlari',
        'user_permissions': '👤 Foydalanuvchi Huquqlari',
        'user_locations': '📍 Foydalanuvchi Filiallari',
        'user_brands': '🏷️ Foydalanuvchi Brendlari',
        'reports': '📊 Hisobotlar',
        'report_history': '📜 Hisobot Tarixi',
        'settings': '⚙️ Sozlamalar',
        'brands': '🏢 Brendlar',
        'brand_locations': '📍 Brend Filiallari',
        'pending_registrations': '⏳ Kutilayotgan Ro\'yxatdan O\'tishlar',
        'audit_logs': '📋 Audit Jurnallari',
        'password_change_requests': '🔑 Parol O\'zgartirish So\'rovlari',
        'pivot_templates': '📐 Pivot Shablonlari',
        'magic_links': '🔗 Magic Linklar',
        'exchange_rates': '💱 Valyuta Kurslari',
        'comparisons': '📈 Solishtirishlar',
        'notifications': '🔔 Bildirishnomalar',
        'branches': '🏪 Filiallar',
        'products': '📦 Mahsulotlar',
        'stocks': '📊 Ostatki',
        'sales': '💰 Sotuvlar',
        'ostatki_analysis': '📊 Ostatki Tahlili',
        'ostatki_imports': '📥 Ostatki Importlari',
        'blocked_filials': '🚫 Bloklangan Filiallar',
        'imports_log': '📝 Import Jurnallari'
    };
    return translations[tableName] || `📋 ${tableName}`;
}

/**
 * Jadval kategoriyalarini aniqlash
 */
function getTableCategory(tableName) {
    if (['users', 'roles', 'permissions', 'role_permissions', 'user_permissions', 'user_locations', 'user_brands'].includes(tableName)) {
        return 'Foydalanuvchilar va Huquqlar';
    }
    if (['reports', 'report_history', 'pivot_templates'].includes(tableName)) {
        return 'Hisobotlar';
    }
    if (['settings', 'brands', 'brand_locations'].includes(tableName)) {
        return 'Sozlamalar va Brendlar';
    }
    if (['audit_logs', 'password_change_requests', 'magic_links'].includes(tableName)) {
        return 'Xavfsizlik va Audit';
    }
    if (['exchange_rates', 'comparisons', 'notifications'].includes(tableName)) {
        return 'Qo\'shimcha Funksiyalar';
    }
    if (['branches', 'products', 'stocks', 'sales', 'ostatki_analysis', 'ostatki_imports', 'blocked_filials', 'imports_log'].includes(tableName)) {
        return 'Filiallar va Mahsulotlar';
    }
    if (['pending_registrations'].includes(tableName)) {
        return 'Ro\'yxatdan O\'tish';
    }
    return 'Boshqa';
}

/**
 * Import modal oynasini ko'rsatish
 */
function showImportTablesModal(importData, fileName) {
    currentImportData = importData;
    currentImportFile = fileName;
    
    const modal = document.getElementById('import-tables-modal');
    const fileNameEl = document.getElementById('import-file-name');
    const tablesListEl = document.getElementById('import-tables-list');
    
    if (!modal || !fileNameEl || !tablesListEl) {
        console.error('Import modal elementlari topilmadi');
        return;
    }
    
    fileNameEl.textContent = fileName;
    
    // Jadvallarni kategoriyalar bo'yicha guruhlash
    const categories = {};
    Object.keys(importData.data || {}).forEach(tableName => {
        const category = getTableCategory(tableName);
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category].push(tableName);
    });
    
    // Modal ichini to'ldirish
    tablesListEl.innerHTML = '';
    
    Object.keys(categories).sort().forEach(category => {
        const categoryDiv = document.createElement('div');
        categoryDiv.style.gridColumn = '1 / -1';
        categoryDiv.style.marginTop = '20px';
        categoryDiv.style.marginBottom = '10px';
        
        const categoryTitle = document.createElement('h4');
        categoryTitle.style.color = '#667eea';
        categoryTitle.style.fontSize = '16px';
        categoryTitle.style.marginBottom = '12px';
        categoryTitle.style.paddingBottom = '8px';
        categoryTitle.style.borderBottom = '2px solid rgba(102, 126, 234, 0.3)';
        categoryTitle.textContent = category;
        categoryDiv.appendChild(categoryTitle);
        
        const categoryGrid = document.createElement('div');
        categoryGrid.style.display = 'grid';
        categoryGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        categoryGrid.style.gap = '12px';
        
        categories[category].sort().forEach(tableName => {
            const count = Array.isArray(importData.data[tableName]) ? importData.data[tableName].length : 0;
            
            const tableCard = document.createElement('label');
            tableCard.style.display = 'flex';
            tableCard.style.alignItems = 'center';
            tableCard.style.padding = '15px';
            tableCard.style.background = 'rgba(255, 255, 255, 0.03)';
            tableCard.style.border = '2px solid rgba(255, 255, 255, 0.1)';
            tableCard.style.borderRadius = '10px';
            tableCard.style.cursor = 'pointer';
            tableCard.style.transition = 'all 0.2s';
            tableCard.style.position = 'relative';
            
            tableCard.addEventListener('mouseenter', () => {
                tableCard.style.background = 'rgba(102, 126, 234, 0.1)';
                tableCard.style.borderColor = 'rgba(102, 126, 234, 0.5)';
            });
            
            tableCard.addEventListener('mouseleave', () => {
                const checkbox = tableCard.querySelector('input[type="checkbox"]');
                if (!checkbox.checked) {
                    tableCard.style.background = 'rgba(255, 255, 255, 0.03)';
                    tableCard.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }
            });
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'import-table';
            checkbox.value = tableName;
            checkbox.checked = true; // Barchasi default tanlangan
            checkbox.style.width = '20px';
            checkbox.style.height = '20px';
            checkbox.style.marginRight = '12px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.accentColor = '#667eea';
            
            checkbox.addEventListener('change', () => {
                updateSelectedCount();
                if (checkbox.checked) {
                    tableCard.style.background = 'rgba(102, 126, 234, 0.15)';
                    tableCard.style.borderColor = '#667eea';
                } else {
                    tableCard.style.background = 'rgba(255, 255, 255, 0.03)';
                    tableCard.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }
            });
            
            const tableInfo = document.createElement('div');
            tableInfo.style.flex = '1';
            
            const tableNameEl = document.createElement('div');
            tableNameEl.style.color = '#fff';
            tableNameEl.style.fontWeight = '600';
            tableNameEl.style.marginBottom = '4px';
            tableNameEl.textContent = getTableDisplayName(tableName);
            
            const tableCountEl = document.createElement('div');
            tableCountEl.style.color = 'rgba(255, 255, 255, 0.6)';
            tableCountEl.style.fontSize = '13px';
            tableCountEl.textContent = `${count} ta yozuv`;
            
            tableInfo.appendChild(tableNameEl);
            tableInfo.appendChild(tableCountEl);
            
            tableCard.appendChild(checkbox);
            tableCard.appendChild(tableInfo);
            
            categoryGrid.appendChild(tableCard);
        });
        
        categoryDiv.appendChild(categoryGrid);
        tablesListEl.appendChild(categoryDiv);
    });
    
    // Modal oynani ko'rsatish
    modal.classList.remove('hidden');
    if (window.feather) {
        window.feather.replace();
    }
    
    updateSelectedCount();
}

/**
 * Tanlangan jadvallar sonini yangilash
 */
function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('input[name="import-table"]:checked');
    const countEl = document.getElementById('selected-tables-count');
    if (countEl) {
        const total = document.querySelectorAll('input[name="import-table"]').length;
        countEl.textContent = `${checkboxes.length} / ${total} jadval tanlangan`;
    }
}

/**
 * To'liq ma'lumotlar bazasini import qilish
 */
export async function importFullDatabase(file) {
    if (!file) {
        showToast('❌ Fayl tanlanmagan!', true);
        return;
    }
    
    if (!file.name.endsWith('.json')) {
        showToast('❌ Faqat JSON fayllarni import qilish mumkin!', true);
        return;
    }
    
    try {
        // Faylni o'qish
        showToast('📄 Fayl o\'qilmoqda...');
        const fileText = await file.text();
        const importData = JSON.parse(fileText);
        
        // Validatsiya
        if (!importData.data) {
            throw new Error('Noto\'g\'ri fayl formati! "data" maydoni topilmadi.');
        }
        
        // Modal oynani ko'rsatish
        showImportTablesModal(importData, file.name);
        
    } catch (error) {
        showToast('❌ Faylni o\'qishda xatolik: ' + error.message, true);
    }
}

/**
 * Tanlangan jadvallarni import qilish
 */
export async function confirmImportSelectedTables() {
    if (!currentImportData) {
        showToast('❌ Import ma\'lumotlari topilmadi!', true);
        return;
    }
    
    const checkboxes = document.querySelectorAll('input[name="import-table"]:checked');
    const selectedTables = Array.from(checkboxes).map(cb => cb.value);
    
    // Agar hech narsa tanlanmagan bo'lsa, barchasini import qilish
    const tablesToImport = selectedTables.length > 0 ? selectedTables : Object.keys(currentImportData.data || {});
    
    const confirmed = await showConfirmDialog({
        title: '⚠️ DIQQAT! Database Import',
        message: `
            <strong style="color: #e74c3c;">Bu amal tanlangan jadvallardagi hozirgi ma'lumotlarni o'chiradi!</strong><br><br>
            Import qilinadigan jadvallar: <strong>${tablesToImport.length} ta</strong><br>
            <ul style="margin-top: 10px; padding-left: 20px;">
                ${tablesToImport.map(table => `<li>${getTableDisplayName(table)}</li>`).join('')}
            </ul>
            <br>
            Davom etasizmi?
        `,
        confirmText: 'Ha, import qilish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'alert-triangle'
    });
    
    if (!confirmed) return;
    
    // Modal oynani yopish
    const modal = document.getElementById('import-tables-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    try {
        showProgress('📤 Import jarayoni boshlandi...', 10);
        showToast('📤 Ma\'lumotlar bazasi import qilinmoqda...');
        
        // Tanlangan jadvallarni filtrlash
        const filteredData = {
            ...currentImportData,
            data: {}
        };
        
        tablesToImport.forEach(tableName => {
            if (currentImportData.data[tableName]) {
                filteredData.data[tableName] = currentImportData.data[tableName];
            }
        });
        
        showProgress('🔄 Ma\'lumotlar bazasiga yuklash...', 50);
        
        // Backend ga yuborish
        const response = await safeFetch('/api/admin/import-full-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filteredData)
        });
        
        if (!response || !response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Import qilishda xatolik');
        }
        
        showProgress('✅ Import muvaffaqiyatli!', 100);
        
        const result = await response.json();
        console.log('✅ [ROLES] Import muvaffaqiyatli:', result);
        
        // Import qilinganda rollar yangilanishi kerak
        // Avval rollarni yangilash, keyin sahifani reload qilish
        try {
            console.log('🔄 [ROLES] Import qilingandan keyin rollar yangilanmoqda...');
            const { fetchRoles } = await import('./api.js');
            const { state } = await import('./state.js');
            const rolesData = await fetchRoles();
            
            if (rolesData && rolesData.roles && Array.isArray(rolesData.roles)) {
                state.roles = rolesData.roles;
                state.allPermissions = rolesData.all_permissions || [];
                console.log('✅ [ROLES] Import qilingandan keyin state yangilandi:', {
                    rolesCount: state.roles.length
                });
                
                // Rollarni render qilish
                const { renderRoles } = await import('./roles.js');
                if (renderRoles) {
                    // Birinchi rolni tanlash
                    const firstRole = state.roles.find(r => 
                        r.role_name !== 'super_admin' && r.role_name !== 'superadmin'
                    );
                    if (firstRole) {
                        console.log('✅ [ROLES] Import qilingandan keyin birinchi rol tanlanmoqda:', firstRole.role_name);
                        renderRoles(firstRole.role_name);
                    }
                }
            }
        } catch (error) {
            console.error('❌ [ROLES] Import qilingandan keyin rollar yangilashda xatolik:', error);
        }
        
        setTimeout(() => {
            hideProgress();
            showToast('✅ Ma\'lumotlar bazasi muvaffaqiyatli import qilindi! Sahifa qayta yuklanadi...');
            
            // 2 soniyadan keyin sahifani yangilash
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        }, 500);
        
    } catch (error) {
        hideProgress();
        showToast('❌ Import qilishda xatolik: ' + error.message, true);
    }
}

/**
 * Progress bar ko'rsatish
 */
function showProgress(text, percent) {
    const container = document.getElementById('db-operation-progress');
    const progressFill = container.querySelector('.progress-fill');
    const progressText = container.querySelector('.progress-text');
    const progressPercentage = container.querySelector('.progress-percentage');
    
    container.classList.remove('hidden');
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
    
    if (progressPercentage) {
        progressPercentage.textContent = `${percent}%`;
    }
}

/**
 * Progress bar yashirish
 */
function hideProgress() {
    const container = document.getElementById('db-operation-progress');
    container.classList.add('hidden');
}

/**
 * Event listener'larni ulash
 */
export function initExportImport() {
    // Export tugmasi
    const exportBtn = document.getElementById('export-full-db-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportFullDatabase);
    }
    
    // Import tugmasi
    const importBtn = document.getElementById('import-full-db-btn');
    const fileInput = document.getElementById('import-file-input');
    const selectedFileInfo = document.getElementById('selected-file-info');
    
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // Fayl nomini ko'rsatish
                if (selectedFileInfo) {
                    const fileName = selectedFileInfo.querySelector('.file-name');
                    if (fileName) {
                        fileName.textContent = file.name;
                    }
                    selectedFileInfo.classList.remove('hidden');
                }
                
                document.getElementById('import-info').classList.remove('hidden');
                importFullDatabase(file);
                // Input ni tozalash (qayta bir xil faylni tanlash mumkin bo'lishi uchun)
                fileInput.value = '';
                
                // 3 soniyadan keyin fayl nomini yashirish
                setTimeout(() => {
                    if (selectedFileInfo) {
                        selectedFileInfo.classList.add('hidden');
                    }
                }, 3000);
            }
        });
    }
    
    // Import modal oyna event listenerlari
    const importModal = document.getElementById('import-tables-modal');
    if (importModal) {
        // Modal yopish
        const cancelBtn = document.getElementById('cancel-import-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                importModal.classList.add('hidden');
                currentImportData = null;
                currentImportFile = null;
            });
        }
        
        // Modal yopish (X tugmasi)
        const closeBtn = importModal.querySelector('[data-target="import-tables-modal"]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                importModal.classList.add('hidden');
                currentImportData = null;
                currentImportFile = null;
            });
        }
        
        // Tasdiqlash tugmasi
        const confirmBtn = document.getElementById('confirm-import-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', confirmImportSelectedTables);
        }
        
        // Barchasini tanlash
        const selectAllBtn = document.getElementById('select-all-tables-btn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('input[name="import-table"]');
                checkboxes.forEach(cb => {
                    cb.checked = true;
                    const card = cb.closest('label');
                    if (card) {
                        card.style.background = 'rgba(102, 126, 234, 0.15)';
                        card.style.borderColor = '#667eea';
                    }
                });
                updateSelectedCount();
            });
        }
        
        // Barchasini bekor qilish
        const deselectAllBtn = document.getElementById('deselect-all-tables-btn');
        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('input[name="import-table"]');
                checkboxes.forEach(cb => {
                    cb.checked = false;
                    const card = cb.closest('label');
                    if (card) {
                        card.style.background = 'rgba(255, 255, 255, 0.03)';
                        card.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                });
                updateSelectedCount();
            });
        }
    }
}

// Add New Role Functionality
export function setupAddNewRole() {
    // Header'dagi tugma (eski)
    const addRoleBtn = document.getElementById('add-new-role-btn');
    if (addRoleBtn) {
        addRoleBtn.addEventListener('click', openAddRoleModal);
    }
    
    // Inline tugma (yangi - roles list panel ichida)
    const addRoleInlineBtn = document.getElementById('add-new-role-inline-btn');
    if (addRoleInlineBtn) {
        addRoleInlineBtn.addEventListener('click', openAddRoleModal);
    }
}

function openAddRoleModal() {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.id = 'add-role-modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                        </svg>
                        Yangi Rol Qo'shish
                    </h5>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()"></button>
                </div>
                <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                    <div class="form-group">
                        <label for="new-role-name">Rol Nomi</label>
                        <input type="text" class="form-control" id="new-role-name" placeholder="masalan: viewer, editor">
                        <small class="form-text text-muted">Faqat lotin harflari va pastki chiziq (_) ishlatiladi</small>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="new-role-requires-locations" style="margin-right: 8px;">
                            Filiallar belgilanishi shart
                        </label>
                        <small class="form-text text-muted" style="display: block; margin-top: 5px;">
                            Bu rol uchun foydalanuvchi tasdiqlanganda filiallar tanlanishi majburiy bo'ladi
                        </small>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="new-role-requires-brands" style="margin-right: 8px;">
                            Brendlar belgilanishi shart
                        </label>
                        <small class="form-text text-muted" style="display: block; margin-top: 5px;">
                            Bu rol uchun foydalanuvchi tasdiqlanganda brendlar tanlanishi majburiy bo'ladi
                        </small>
                    </div>
                    <hr style="margin: 20px 0; border-color: rgba(255,255,255,0.1);">
                    <div class="form-group">
                        <label style="font-weight: 600; margin-bottom: 10px; display: block;">
                            <i data-feather="shield"></i>
                            Huquqlar (Ixtiyoriy)
                        </label>
                        <small class="form-text text-muted" style="display: block; margin-bottom: 15px;">
                            Rol yaratilgandan keyin huquqlarni biriktirishingiz mumkin. Yoki keyinroq huquqlarni sozlashingiz mumkin.
                        </small>
                        <div id="new-role-permissions-container" style="max-height: 300px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; background: rgba(255,255,255,0.02);">
                            <div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">
                                Huquqlar yuklanmoqda...
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Bekor qilish</button>
                    <button type="button" class="btn btn-primary" id="create-role-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/>
                        </svg>
                        Yaratish
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Feather icons
    if (window.feather) {
        window.feather.replace();
    }
    
    // Load permissions for selection
    loadPermissionsForNewRole();
    
    // Focus input
    setTimeout(() => {
        document.getElementById('new-role-name').focus();
    }, 100);
    
    // Create button handler
    document.getElementById('create-role-btn').addEventListener('click', createNewRole);
}

// Load permissions for new role modal
function loadPermissionsForNewRole() {
    const container = document.getElementById('new-role-permissions-container');
    if (!container || !state.allPermissions) {
        if (container) {
            container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Huquqlar mavjud emas</div>';
        }
        return;
    }
    
    container.innerHTML = Object.entries(state.allPermissions).map(([category, perms]) => `
        <div class="permission-category-group collapsed" style="margin-bottom: 12px;">
            <div class="permission-category-header" onclick="toggleRoleCategory(this)" style="cursor: pointer;">
                <div class="permission-category-title">
                    ${getCategoryIcon(category)} ${category}
                    <span class="permission-count">(${perms.length})</span>
                </div>
                <svg class="category-arrow" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transform: rotate(-90deg);">
                    <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                </svg>
            </div>
            <div class="permission-category-content" style="max-height: 0;">
                <div class="permission-list" style="padding: 10px 0;">
                    ${perms.map(perm => `
                        <label class="permission-item" style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer;">
                            <input type="checkbox" class="new-role-permission-checkbox" value="${perm.key}" style="cursor: pointer;">
                            <span style="font-size: 13px;">${perm.description}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

async function createNewRole() {
    const input = document.getElementById('new-role-name');
    const roleName = input.value.trim().toLowerCase();
    const requiresLocations = document.getElementById('new-role-requires-locations').checked;
    const requiresBrands = document.getElementById('new-role-requires-brands').checked;
    
    // Get selected permissions
    const selectedPermissions = Array.from(document.querySelectorAll('.new-role-permission-checkbox:checked'))
        .map(cb => cb.value);
    
    // Validation
    if (!roleName) {
        showToast('Rol nomini kiriting!', 'error');
        input.focus();
        return;
    }
    
    if (!/^[a-z_]+$/.test(roleName)) {
        showToast('Rol nomida faqat lotin harflari va pastki chiziq (_) bo\'lishi mumkin!', 'error');
        input.focus();
        return;
    }
    
    // Shartlar ixtiyoriy - null, true yoki false bo'lishi mumkin
    // Backend null qiymatni qo'llab-quvvatlaydi
    
    // state.roles mavjudligini tekshirish
    if (!state.roles || !Array.isArray(state.roles)) {
        console.warn('[ROLES] state.roles mavjud emas yoki array emas, validatsiya o\'tkazib yuborildi');
    } else if (state.roles.some(r => r.role_name === roleName)) {
        showToast('Bu rol allaqachon mavjud!', 'error');
        input.focus();
        return;
    }
    
    const btn = document.getElementById('create-role-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Yaratilmoqda...';
    
    try {
        // Create role
        // null, true yoki false qiymatlarni yuborish
        const response = await safeFetch('/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                role_name: roleName,
                requires_locations: requiresLocations ? true : null,
                requires_brands: requiresBrands ? true : null
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to create role');
        }
        
        // If permissions are selected, assign them
        if (selectedPermissions.length > 0) {
            const permissionsResponse = await safeFetch(`/api/roles/${roleName}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissions: selectedPermissions })
            });
            
            if (!permissionsResponse.ok) {
                console.warn('Rol yaratildi, lekin huquqlarni biriktirishda xatolik');
            }
        }
        
        showToast('Yangi rol muvaffaqiyatli yaratildi!', 'success');
        
        // Close modal - aniq modalni topish
        const modal = document.getElementById('add-role-modal') || input.closest('.modal');
        if (modal) {
            modal.remove();
        }
        
        // Reload roles va yangi yaratilgan rolni tanlash
        console.log('🔄 [ROLES] Yangi rol yaratilgandan keyin rollar yangilanmoqda...');
        const rolesResponse = await safeFetch('/api/roles');
        if (rolesResponse && rolesResponse.ok) {
            const rolesData = await rolesResponse.json();
            console.log('📥 [ROLES] API javob:', { 
                rolesCount: rolesData?.roles?.length || 0,
                hasPermissions: !!rolesData?.all_permissions 
            });
            
            if (rolesData && rolesData.roles && Array.isArray(rolesData.roles)) {
                state.roles = rolesData.roles;
                state.allPermissions = rolesData.all_permissions || [];
                console.log('✅ [ROLES] State yangilandi, yangi rolni tanlash:', roleName);
                // Yangi yaratilgan rolni avtomatik tanlash
                renderRoles(roleName);
            } else {
                console.warn('⚠️ [ROLES] Roles ma\'lumotlari to\'g\'ri formatda emas:', rolesData);
            }
        } else {
            console.error('❌ [ROLES] Roles API javob xatolik:', rolesResponse?.status);
        }
        
    } catch (error) {
        console.error('Create role error:', error);
        showToast(error.message || 'Rol yaratishda xatolik!', 'error');
        btn.disabled = false;
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg> Yaratish';
    }
}
