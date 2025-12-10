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

export function renderRoles() {
    if (!state.roles || !state.allPermissions) return;
    
    // Super admin'ni ro'yxatdan olib tashlash
    const filteredRoles = state.roles.filter(role => role.role_name !== 'super_admin');
    
    DOM.rolesList.innerHTML = filteredRoles.map(role => {
        const isSuperAdmin = role.role_name === 'super_admin';
        const canEdit = !isSuperAdmin; // Faqat super_admin roli to'liq tahrirlash mumkin emas
        const canDelete = !isSuperAdmin; // Faqat super_admin roli o'chirish mumkin emas
        
        return `
            <li data-role="${role.role_name}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px; border-radius: 8px; margin-bottom: 5px; cursor: pointer; transition: background 0.2s;">
                <span style="flex: 1;" onclick="window.handleRoleSelection({target: this.closest('li')})">${role.role_name}</span>
                <div style="display: flex; gap: 5px; margin-left: 10px;" onclick="event.stopPropagation();">
                    ${canEdit ? `
                        <button class="btn-icon edit-role-btn" data-role="${role.role_name}" title="To'liq tahrirlash" style="padding: 5px 8px; background: rgba(79, 172, 254, 0.2); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 6px; color: #4facfe; cursor: pointer;">
                            <i data-feather="edit-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}
                    ${canDelete ? `
                        <button class="btn-icon delete-role-btn" data-role="${role.role_name}" title="O'chirish" style="padding: 5px 8px; background: rgba(255, 77, 77, 0.2); border: 1px solid rgba(255, 77, 77, 0.3); border-radius: 6px; color: #ff4d4d; cursor: pointer;">
                            <i data-feather="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}
                </div>
            </li>
        `;
    }).join('');
    
    // Event listenerlarni qo'shish
    DOM.rolesList.querySelectorAll('.edit-role-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const roleName = btn.dataset.role;
            openEditRoleModal(roleName);
        });
    });
    
    DOM.rolesList.querySelectorAll('.delete-role-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const roleName = btn.dataset.role;
            deleteRole(roleName);
        });
    });
    
    // Feather iconlarni yangilash
    if (window.feather) {
        window.feather.replace();
    }
    
    DOM.permissionsGrid.innerHTML = Object.entries(state.allPermissions).map(([category, perms]) => `
        <div class="permission-category">
            <h4 class="permission-category-title">${category}</h4>
            <div class="permission-list">
                ${perms.map(perm => `
                    <label class="permission-item">
                        <input type="checkbox" value="${perm.key}">
                        <span>${perm.description}</span>
                    </label>
                `).join('')}
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
    
    // Birinchi rolni default tanlash
    if (filteredRoles.length > 0 && state.roles && state.roles.length > 0) {
        // console.log('🔍 Roles module: Selecting first role...', filteredRoles[0]);
        const firstRole = filteredRoles[0];
        const firstRoleElement = DOM.rolesList.querySelector(`[data-role="${firstRole.role_name}"]`);
        // console.log('🔍 First role element found:', firstRoleElement);
        if (firstRoleElement) {
            // Click o'rniga to'g'ridan-to'g'ri handleRoleSelection ni chaqiramiz
            setTimeout(() => {
                // console.log('🔍 Simulating click on first role');
                handleRoleSelection({ target: firstRoleElement });
            }, 100);
        }
    }
}

export function handleRoleSelection(e) {
    // console.log('🎯 handleRoleSelection called', e);
    const li = e.target.closest('li');
    // console.log('🎯 Found li element:', li);
    if (!li) return;
    
    const roleName = li.dataset.role;
    // console.log('🎯 Selected role:', roleName);
    
    // state.roles mavjudligini tekshirish
    if (!state.roles || !Array.isArray(state.roles)) {
        console.warn('[ROLES] state.roles mavjud emas yoki array emas');
        return;
    }
    
    state.currentEditingRole = roleName;
    
    DOM.rolesList.querySelectorAll('li').forEach(item => item.classList.remove('active'));
    li.classList.add('active');
    
    DOM.currentRoleTitle.textContent = `"${roleName}" roli uchun huquqlar`;
    DOM.saveRolePermissionsBtn.classList.remove('hidden');
    
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
    
    // Faqat super_admin roli uchun huquqlarni o'zgartirish mumkin emas
    if (roleName === 'super_admin') {
        DOM.permissionsPanel.classList.add('disabled');
        DOM.saveRolePermissionsBtn.classList.add('hidden');
        // Xabar ko'rsatish
        const warningMsg = document.createElement('div');
        warningMsg.className = 'alert alert-warning';
        warningMsg.style.marginTop = '10px';
        warningMsg.textContent = 'Super admin rolining huquqlarini o\'zgartirish mumkin emas.';
        // Eski xabarni olib tashlash
        const oldWarning = DOM.permissionsPanel.querySelector('.alert-warning');
        if (oldWarning) oldWarning.remove();
        DOM.permissionsPanel.appendChild(warningMsg);
    } else {
        // Admin va boshqa barcha rollar uchun huquqlarni o'zgartirish mumkin
    DOM.permissionsPanel.classList.remove('disabled');
        DOM.saveRolePermissionsBtn.classList.remove('hidden');
        // Xabarni olib tashlash
        const warningMsg = DOM.permissionsPanel.querySelector('.alert-warning');
        if (warningMsg) warningMsg.remove();
    }
    // console.log('🎯 Role selection completed');
}

function showRoleRequirements(roleData) {
    // Super admin uchun shartlarni ko'rsatmaslik (to'liq dotup)
    if (!roleData || roleData.role_name === 'super_admin') {
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
        const roleIndex = state.roles.findIndex(r => r.role_name === state.currentEditingRole);
        if (roleIndex > -1) {
            state.roles[roleIndex].requires_locations = requiresLocations;
            state.roles[roleIndex].requires_brands = requiresBrands;
        }
        
        // UI'ni yangilash
        showRoleRequirements(state.roles[roleIndex]);
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

export async function saveRolePermissions() {
    if (!state.currentEditingRole) return;
    
    // Faqat super_admin roli uchun huquqlarni o'zgartirish mumkin emas
    if (state.currentEditingRole === 'super_admin') {
        showToast('Super admin rolining huquqlarini o\'zgartirish mumkin emas.', true);
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
        
        const roleIndex = state.roles.findIndex(r => r.role_name === state.currentEditingRole);
        if (roleIndex > -1) {
            state.roles[roleIndex].permissions = checkedPermissions;
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
        showToast("Baza nusxasi muvaffaqiyatli yuklab olindi.");
    } catch (error) {
        showToast(error.message, true);
    }
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
    const addRoleBtn = document.getElementById('add-new-role-btn');
    if (addRoleBtn) {
        addRoleBtn.addEventListener('click', openAddRoleModal);
    }
}

// Rol yaratish uchun tanlangan qiymatlar
let newRoleData = {
    role_name: '',
    requires_locations: null,
    requires_brands: null,
    selected_location: null,
    selected_brands: [],
    permissions: []
};

function openAddRoleModal() {
    // Reset data
    newRoleData = {
        role_name: '',
        requires_locations: null,
        requires_brands: null,
        selected_location: null,
        selected_brands: [],
        permissions: []
    };
    
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.id = 'add-role-modal';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" style="max-width: 800px; width: 95%;">
            <div class="modal-content">
                <div class="modal-header-enhanced">
                    <div class="modal-icon-wrapper">
                        <i data-feather="plus-circle"></i>
                    </div>
                    <div style="flex: 1;">
                        <h3 class="modal-title" style="margin: 0; display: flex; align-items: center; gap: 12px;">
                            <span>Yangi Rol Qo'shish</span>
                        </h3>
                        <p class="modal-subtitle">Rol nomi, talablar va dostuplarni belgilang</p>
                    </div>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                        <i data-feather="x"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label for="new-role-name" style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-primary);">Rol Nomi</label>
                        <input type="text" class="form-control" id="new-role-name" placeholder="masalan: operator, manager, kassir" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; transition: all 0.3s;">
                        <small class="form-text text-muted" style="display: block; margin-top: 6px; color: var(--text-secondary); font-size: 12px;">Faqat lotin harflari va pastki chiziq (_) ishlatiladi</small>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: 500; color: var(--text-primary);">Filiallar Talabi</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select class="form-control" id="new-role-requires-locations" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; transition: all 0.3s; cursor: pointer;">
                                <option value="null">Ixtiyoriy (tanlash shart emas)</option>
                                <option value="true">Majburiy (kamida 1 ta tanlash kerak)</option>
                                <option value="false">Ko'rsatilmaydi (umuman ko'rinmaydi)</option>
                                <option value="by_location">Filial bo'yicha brendlar ko'rsatish</option>
                            </select>
                            <button type="button" class="btn btn-secondary" id="select-location-btn" style="padding: 12px 20px; border-radius: 8px; display: none;" onclick="openSelectLocationModal()">
                                <i data-feather="map-pin"></i>
                                Filial Tanlash
                            </button>
                        </div>
                        <div id="selected-location-display" style="margin-top: 10px; padding: 10px; background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px; display: none;">
                            <span style="color: #4facfe; font-weight: 500;">Tanlangan filial: </span>
                            <span id="selected-location-name" style="color: var(--text-primary);"></span>
                            <button type="button" onclick="clearSelectedLocation()" style="margin-left: 10px; background: rgba(255,77,77,0.2); border: 1px solid rgba(255,77,77,0.3); color: #ff4d4d; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                                <i data-feather="x"></i> Olib tashlash
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: 500; color: var(--text-primary);">Brendlar Talabi</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select class="form-control" id="new-role-requires-brands" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; transition: all 0.3s; cursor: pointer;">
                                <option value="null">Ixtiyoriy (tanlash shart emas)</option>
                                <option value="true">Majburiy (kamida 1 ta tanlash kerak)</option>
                                <option value="false">Ko'rsatilmaydi (umuman ko'rinmaydi)</option>
                                <option value="by_brand">Brend bo'yicha filiallar ko'rsatish</option>
                            </select>
                            <button type="button" class="btn btn-secondary" id="select-brands-btn" style="padding: 12px 20px; border-radius: 8px; display: none;" onclick="openSelectBrandsModal()">
                                <i data-feather="tag"></i>
                                Brendlar Tanlash
                            </button>
                        </div>
                        <div id="selected-brands-display" style="margin-top: 10px; padding: 10px; background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px; display: none;">
                            <span style="color: #4facfe; font-weight: 500;">Tanlangan brendlar: </span>
                            <span id="selected-brands-names" style="color: var(--text-primary);"></span>
                            <button type="button" onclick="clearSelectedBrands()" style="margin-left: 10px; background: rgba(255,77,77,0.2); border: 1px solid rgba(255,77,77,0.3); color: #ff4d4d; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                                <i data-feather="x"></i> Olib tashlash
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: 500; color: var(--text-primary);">Dostuplar (Permissions)</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div style="flex: 1; padding: 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                                <span id="selected-permissions-count" style="color: var(--text-secondary);">0 ta dostup tanlangan</span>
                            </div>
                            <button type="button" class="btn btn-primary" id="select-permissions-btn" style="padding: 12px 20px; border-radius: 8px;" onclick="openSelectPermissionsModal()">
                                <i data-feather="shield"></i>
                                Dostuplar Tanlash
                            </button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px; font-weight: 500; transition: all 0.3s;">Bekor qilish</button>
                    <button type="button" class="btn btn-primary" id="create-role-btn" style="padding: 12px 24px; border-radius: 8px; font-weight: 500; transition: all 0.3s; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="check"></i>
                        Yaratish
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Feather iconlarni yangilash
    if (window.feather) {
        window.feather.replace();
    }
    
    // Event listenerlar
    document.getElementById('new-role-requires-locations').addEventListener('change', (e) => {
        const selectLocationBtn = document.getElementById('select-location-btn');
        const locationDisplay = document.getElementById('selected-location-display');
        if (e.target.value === 'by_location') {
            selectLocationBtn.style.display = 'block';
            locationDisplay.style.display = 'block';
        } else {
            selectLocationBtn.style.display = 'none';
            locationDisplay.style.display = 'none';
            newRoleData.selected_location = null;
        }
        newRoleData.requires_locations = e.target.value === 'null' ? null : e.target.value === 'true' ? true : e.target.value === 'false' ? false : 'by_location';
    });
    
    document.getElementById('new-role-requires-brands').addEventListener('change', (e) => {
        const selectBrandsBtn = document.getElementById('select-brands-btn');
        const brandsDisplay = document.getElementById('selected-brands-display');
        if (e.target.value === 'by_brand') {
            selectBrandsBtn.style.display = 'block';
            brandsDisplay.style.display = 'block';
        } else {
            selectBrandsBtn.style.display = 'none';
            brandsDisplay.style.display = 'none';
            newRoleData.selected_brands = [];
        }
        newRoleData.requires_brands = e.target.value === 'null' ? null : e.target.value === 'true' ? true : e.target.value === 'false' ? false : 'by_brand';
    });
    
    // Focus input
    setTimeout(() => {
        document.getElementById('new-role-name').focus();
    }, 100);
    
    // Create button handler
    document.getElementById('create-role-btn').addEventListener('click', createNewRole);
    
    // Update permissions count
    updatePermissionsCount();
}

// Filial tanlash modal
window.openSelectLocationModal = async function() {
    try {
        const settingsRes = await safeFetch('/api/settings');
        if (!settingsRes || !settingsRes.ok) {
            showToast('Filiallarni yuklashda xatolik!', 'error');
            return;
        }
        const settings = await settingsRes.json();
        const locations = settings.app_settings?.locations || [];
        
        if (locations.length === 0) {
            showToast('Tizimda filiallar mavjud emas!', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.id = 'select-location-modal';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 600px; width: 95%;">
                <div class="modal-content">
                    <div class="modal-header-enhanced">
                        <div class="modal-icon-wrapper">
                            <i data-feather="map-pin"></i>
                        </div>
                        <div style="flex: 1;">
                            <h3 class="modal-title" style="margin: 0;">Filial Tanlash</h3>
                            <p class="modal-subtitle">Rol uchun filial tanlang</p>
                        </div>
                        <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <div style="max-height: 400px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; background: rgba(0,0,0,0.2);">
                            ${locations.map(loc => `
                                <label style="display: flex; align-items: center; padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);" 
                                       onmouseover="this.style.background='rgba(79,172,254,0.15)'; this.style.borderColor='rgba(79,172,254,0.4)'" 
                                       onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                                    <input type="radio" name="select-location" value="${loc}" ${newRoleData.selected_location === loc ? 'checked' : ''} 
                                           style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 14px; color: var(--text-primary); flex: 1;">${loc}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px;">Bekor qilish</button>
                        <button type="button" class="btn btn-primary" onclick="saveSelectedLocation()" style="padding: 12px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                            <i data-feather="check"></i>
                            Tanlash
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        if (window.feather) window.feather.replace();
    } catch (error) {
        console.error('Filial tanlash modalida xatolik:', error);
        showToast('Filiallarni yuklashda xatolik!', 'error');
    }
};

// Filialni saqlash
window.saveSelectedLocation = function() {
    const selected = document.querySelector('input[name="select-location"]:checked');
    if (!selected) {
        showToast('Filial tanlang!', 'error');
        return;
    }
    
    newRoleData.selected_location = selected.value;
    document.getElementById('selected-location-name').textContent = selected.value;
    document.getElementById('selected-location-display').style.display = 'block';
    document.getElementById('select-location-modal').remove();
    if (window.feather) window.feather.replace();
};

// Filialni tozalash
window.clearSelectedLocation = function() {
    newRoleData.selected_location = null;
    document.getElementById('selected-location-display').style.display = 'none';
    const radio = document.querySelector('input[name="select-location"]:checked');
    if (radio) radio.checked = false;
};

// Brendlar tanlash modal
window.openSelectBrandsModal = async function() {
    try {
        const brandsRes = await safeFetch('/api/brands');
        if (!brandsRes || !brandsRes.ok) {
            showToast('Brendlarni yuklashda xatolik!', 'error');
            return;
        }
        const allBrands = await brandsRes.json();
        
        if (!Array.isArray(allBrands) || allBrands.length === 0) {
            showToast('Tizimda brendlar mavjud emas!', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.id = 'select-brands-modal';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 700px; width: 95%;">
                <div class="modal-content">
                    <div class="modal-header-enhanced">
                        <div class="modal-icon-wrapper">
                            <i data-feather="tag"></i>
                        </div>
                        <div style="flex: 1;">
                            <h3 class="modal-title" style="margin: 0;">Brendlar Tanlash</h3>
                            <p class="modal-subtitle">Rol uchun brendlar tanlang</p>
                        </div>
                        <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <div style="margin-bottom: 15px; display: flex; gap: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="selectAllBrands()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                                <i data-feather="check-square"></i> Barchasini tanlash
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="deselectAllBrands()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                                <i data-feather="square"></i> Barchasini bekor qilish
                            </button>
                        </div>
                        <div style="max-height: 400px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; background: rgba(0,0,0,0.2);">
                            ${allBrands.map(brand => {
                                const isChecked = newRoleData.selected_brands.includes(brand.id);
                                return `
                                    <label style="display: flex; align-items: center; padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);" 
                                           onmouseover="this.style.background='rgba(79,172,254,0.15)'; this.style.borderColor='rgba(79,172,254,0.4)'" 
                                           onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                                        <input type="checkbox" class="select-brand-checkbox" value="${brand.id}" ${isChecked ? 'checked' : ''} 
                                               style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                                        <span style="font-size: 20px; margin-right: 10px;">${brand.emoji || '🏢'}</span>
                                        <span style="font-size: 14px; color: var(--text-primary); flex: 1;">${brand.name}</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px;">Bekor qilish</button>
                        <button type="button" class="btn btn-primary" onclick="saveSelectedBrands()" style="padding: 12px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                            <i data-feather="check"></i>
                            Tanlash
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        if (window.feather) window.feather.replace();
    } catch (error) {
        console.error('Brendlar tanlash modalida xatolik:', error);
        showToast('Brendlarni yuklashda xatolik!', 'error');
    }
};

// Barcha brendlarni tanlash
window.selectAllBrands = function() {
    document.querySelectorAll('.select-brand-checkbox').forEach(cb => cb.checked = true);
};

// Barcha brendlarni bekor qilish
window.deselectAllBrands = function() {
    document.querySelectorAll('.select-brand-checkbox').forEach(cb => cb.checked = false);
};

// Brendlarni saqlash
window.saveSelectedBrands = function() {
    const selected = Array.from(document.querySelectorAll('.select-brand-checkbox:checked')).map(cb => parseInt(cb.value));
    newRoleData.selected_brands = selected;
    
    if (selected.length > 0) {
        // Brend nomlarini olish
        const brandNames = Array.from(document.querySelectorAll('.select-brand-checkbox:checked')).map(cb => {
            const label = cb.closest('label');
            return label.querySelector('span:last-child').textContent;
        });
        document.getElementById('selected-brands-names').textContent = brandNames.join(', ');
        document.getElementById('selected-brands-display').style.display = 'block';
    } else {
        document.getElementById('selected-brands-display').style.display = 'none';
    }
    
    document.getElementById('select-brands-modal').remove();
    if (window.feather) window.feather.replace();
};

// Brendlarni tozalash
window.clearSelectedBrands = function() {
    newRoleData.selected_brands = [];
    document.getElementById('selected-brands-display').style.display = 'none';
};

// Dostuplar tanlash modal
window.openSelectPermissionsModal = function() {
    if (!state.allPermissions) {
        showToast('Dostuplar yuklanmagan!', 'error');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.id = 'select-permissions-modal';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" style="max-width: 800px; width: 95%;">
            <div class="modal-content">
                <div class="modal-header-enhanced">
                    <div class="modal-icon-wrapper">
                        <i data-feather="shield"></i>
                    </div>
                    <div style="flex: 1;">
                        <h3 class="modal-title" style="margin: 0;">Dostuplar Tanlash</h3>
                        <p class="modal-subtitle">Rol uchun dostuplar tanlang</p>
                    </div>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                        <i data-feather="x"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="margin-bottom: 15px; display: flex; gap: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="selectAllPermissions()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                            <i data-feather="check-square"></i> Barchasini tanlash
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="deselectAllPermissions()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                            <i data-feather="square"></i> Barchasini bekor qilish
                        </button>
                    </div>
                    <div style="max-height: 500px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; background: rgba(0,0,0,0.2);">
                        ${Object.entries(state.allPermissions).map(([category, perms]) => `
                            <div style="margin-bottom: 25px;">
                                <h6 style="color: var(--text-primary); margin-bottom: 12px; font-weight: 600; font-size: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">${category}</h6>
                                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px;">
                                    ${perms.map(perm => {
                                        const isChecked = newRoleData.permissions.includes(perm.key);
                                        return `
                                            <label style="display: flex; align-items: center; padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);" 
                                                   onmouseover="this.style.background='rgba(79,172,254,0.15)'; this.style.borderColor='rgba(79,172,254,0.4)'" 
                                                   onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                                                <input type="checkbox" class="select-permission-checkbox" value="${perm.key}" ${isChecked ? 'checked' : ''} 
                                                       style="margin-right: 10px; width: 16px; height: 16px; cursor: pointer;">
                                                <span style="font-size: 13px; color: var(--text-primary);">${perm.description}</span>
                                            </label>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px;">Bekor qilish</button>
                    <button type="button" class="btn btn-primary" onclick="saveSelectedPermissions()" style="padding: 12px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="check"></i>
                        Tanlash
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    if (window.feather) window.feather.replace();
};

// Barcha dostuplarni tanlash
window.selectAllPermissions = function() {
    document.querySelectorAll('.select-permission-checkbox').forEach(cb => cb.checked = true);
};

// Barcha dostuplarni bekor qilish
window.deselectAllPermissions = function() {
    document.querySelectorAll('.select-permission-checkbox').forEach(cb => cb.checked = false);
};

// Dostuplarni saqlash
window.saveSelectedPermissions = function() {
    const selected = Array.from(document.querySelectorAll('.select-permission-checkbox:checked')).map(cb => cb.value);
    newRoleData.permissions = selected;
    updatePermissionsCount();
    document.getElementById('select-permissions-modal').remove();
    if (window.feather) window.feather.replace();
};

// Dostuplar sonini yangilash
function updatePermissionsCount() {
    const count = newRoleData.permissions.length;
    const countEl = document.getElementById('selected-permissions-count');
    if (countEl) {
        countEl.textContent = `${count} ta dostup tanlangan`;
        countEl.style.color = count > 0 ? '#4facfe' : 'var(--text-secondary)';
    }
}

// Edit role uchun alohida modallar

// Filial tanlash modal (Edit)
window.openEditSelectLocationModal = async function() {
    try {
        const settingsRes = await safeFetch('/api/settings');
        if (!settingsRes || !settingsRes.ok) {
            showToast('Filiallarni yuklashda xatolik!', 'error');
            return;
        }
        const settings = await settingsRes.json();
        const locations = settings.app_settings?.locations || [];
        
        if (locations.length === 0) {
            showToast('Tizimda filiallar mavjud emas!', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.id = 'edit-select-location-modal';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 600px; width: 95%;">
                <div class="modal-content">
                    <div class="modal-header-enhanced">
                        <div class="modal-icon-wrapper">
                            <i data-feather="map-pin"></i>
                        </div>
                        <div style="flex: 1;">
                            <h3 class="modal-title" style="margin: 0;">Filial Tanlash</h3>
                            <p class="modal-subtitle">Rol uchun filial tanlang</p>
                        </div>
                        <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <div style="max-height: 400px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; background: rgba(0,0,0,0.2);">
                            ${locations.map(loc => `
                                <label style="display: flex; align-items: center; padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);" 
                                       onmouseover="this.style.background='rgba(79,172,254,0.15)'; this.style.borderColor='rgba(79,172,254,0.4)'" 
                                       onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                                    <input type="radio" name="edit-select-location" value="${loc}" ${editRoleData.selected_location === loc ? 'checked' : ''} 
                                           style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 14px; color: var(--text-primary); flex: 1;">${loc}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px;">Bekor qilish</button>
                        <button type="button" class="btn btn-primary" onclick="saveEditSelectedLocation()" style="padding: 12px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                            <i data-feather="check"></i>
                            Tanlash
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        if (window.feather) window.feather.replace();
    } catch (error) {
        console.error('Filial tanlash modalida xatolik:', error);
        showToast('Filiallarni yuklashda xatolik!', 'error');
    }
};

// Filialni saqlash (Edit)
window.saveEditSelectedLocation = function() {
    const selected = document.querySelector('input[name="edit-select-location"]:checked');
    if (!selected) {
        showToast('Filial tanlang!', 'error');
        return;
    }
    
    editRoleData.selected_location = selected.value;
    document.getElementById('edit-selected-location-name').textContent = selected.value;
    document.getElementById('edit-selected-location-display').style.display = 'block';
    document.getElementById('edit-select-location-modal').remove();
    if (window.feather) window.feather.replace();
};

// Filialni tozalash (Edit)
window.clearEditSelectedLocation = function() {
    editRoleData.selected_location = null;
    document.getElementById('edit-selected-location-display').style.display = 'none';
    const radio = document.querySelector('input[name="edit-select-location"]:checked');
    if (radio) radio.checked = false;
};

// Brendlar tanlash modal (Edit)
window.openEditSelectBrandsModal = async function() {
    try {
        const brandsRes = await safeFetch('/api/brands');
        if (!brandsRes || !brandsRes.ok) {
            showToast('Brendlarni yuklashda xatolik!', 'error');
            return;
        }
        const allBrands = await brandsRes.json();
        
        if (!Array.isArray(allBrands) || allBrands.length === 0) {
            showToast('Tizimda brendlar mavjud emas!', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.id = 'edit-select-brands-modal';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 700px; width: 95%;">
                <div class="modal-content">
                    <div class="modal-header-enhanced">
                        <div class="modal-icon-wrapper">
                            <i data-feather="tag"></i>
                        </div>
                        <div style="flex: 1;">
                            <h3 class="modal-title" style="margin: 0;">Brendlar Tanlash</h3>
                            <p class="modal-subtitle">Rol uchun brendlar tanlang</p>
                        </div>
                        <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <div style="margin-bottom: 15px; display: flex; gap: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="selectAllEditBrands()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                                <i data-feather="check-square"></i> Barchasini tanlash
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="deselectAllEditBrands()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                                <i data-feather="square"></i> Barchasini bekor qilish
                            </button>
                        </div>
                        <div style="max-height: 400px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; background: rgba(0,0,0,0.2);">
                            ${allBrands.map(brand => {
                                const isChecked = editRoleData.selected_brands.includes(brand.id);
                                return `
                                    <label style="display: flex; align-items: center; padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);" 
                                           onmouseover="this.style.background='rgba(79,172,254,0.15)'; this.style.borderColor='rgba(79,172,254,0.4)'" 
                                           onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                                        <input type="checkbox" class="edit-select-brand-checkbox" value="${brand.id}" ${isChecked ? 'checked' : ''} 
                                               style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                                        <span style="font-size: 20px; margin-right: 10px;">${brand.emoji || '🏢'}</span>
                                        <span style="font-size: 14px; color: var(--text-primary); flex: 1;">${brand.name}</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px;">Bekor qilish</button>
                        <button type="button" class="btn btn-primary" onclick="saveEditSelectedBrands()" style="padding: 12px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                            <i data-feather="check"></i>
                            Tanlash
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        if (window.feather) window.feather.replace();
    } catch (error) {
        console.error('Brendlar tanlash modalida xatolik:', error);
        showToast('Brendlarni yuklashda xatolik!', 'error');
    }
};

// Barcha brendlarni tanlash (Edit)
window.selectAllEditBrands = function() {
    document.querySelectorAll('.edit-select-brand-checkbox').forEach(cb => cb.checked = true);
};

// Barcha brendlarni bekor qilish (Edit)
window.deselectAllEditBrands = function() {
    document.querySelectorAll('.edit-select-brand-checkbox').forEach(cb => cb.checked = false);
};

// Brendlarni saqlash (Edit)
window.saveEditSelectedBrands = function() {
    const selected = Array.from(document.querySelectorAll('.edit-select-brand-checkbox:checked')).map(cb => parseInt(cb.value));
    editRoleData.selected_brands = selected;
    
    if (selected.length > 0) {
        // Brend nomlarini olish
        const brandNames = Array.from(document.querySelectorAll('.edit-select-brand-checkbox:checked')).map(cb => {
            const label = cb.closest('label');
            return label.querySelector('span:last-child').textContent;
        });
        document.getElementById('edit-selected-brands-names').textContent = brandNames.join(', ');
        document.getElementById('edit-selected-brands-display').style.display = 'block';
    } else {
        document.getElementById('edit-selected-brands-display').style.display = 'none';
    }
    
    document.getElementById('edit-select-brands-modal').remove();
    if (window.feather) window.feather.replace();
};

// Brendlarni tozalash (Edit)
window.clearEditSelectedBrands = function() {
    editRoleData.selected_brands = [];
    document.getElementById('edit-selected-brands-display').style.display = 'none';
};

// Dostuplar tanlash modal (Edit)
window.openEditSelectPermissionsModal = function() {
    if (!state.allPermissions) {
        showToast('Dostuplar yuklanmagan!', 'error');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.id = 'edit-select-permissions-modal';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" style="max-width: 800px; width: 95%;">
            <div class="modal-content">
                <div class="modal-header-enhanced">
                    <div class="modal-icon-wrapper">
                        <i data-feather="shield"></i>
                    </div>
                    <div style="flex: 1;">
                        <h3 class="modal-title" style="margin: 0;">Dostuplar Tanlash</h3>
                        <p class="modal-subtitle">Rol uchun dostuplar tanlang</p>
                    </div>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                        <i data-feather="x"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="margin-bottom: 15px; display: flex; gap: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="selectAllEditPermissions()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                            <i data-feather="check-square"></i> Barchasini tanlash
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="deselectAllEditPermissions()" style="padding: 8px 16px; border-radius: 6px; font-size: 13px;">
                            <i data-feather="square"></i> Barchasini bekor qilish
                        </button>
                    </div>
                    <div style="max-height: 500px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; background: rgba(0,0,0,0.2);">
                        ${Object.entries(state.allPermissions).map(([category, perms]) => `
                            <div style="margin-bottom: 25px;">
                                <h6 style="color: var(--text-primary); margin-bottom: 12px; font-weight: 600; font-size: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">${category}</h6>
                                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px;">
                                    ${perms.map(perm => {
                                        const isChecked = editRoleData.permissions.includes(perm.key);
                                        return `
                                            <label style="display: flex; align-items: center; padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);" 
                                                   onmouseover="this.style.background='rgba(79,172,254,0.15)'; this.style.borderColor='rgba(79,172,254,0.4)'" 
                                                   onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                                                <input type="checkbox" class="edit-select-permission-checkbox" value="${perm.key}" ${isChecked ? 'checked' : ''} 
                                                       style="margin-right: 10px; width: 16px; height: 16px; cursor: pointer;">
                                                <span style="font-size: 13px; color: var(--text-primary);">${perm.description}</span>
                                            </label>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px;">Bekor qilish</button>
                    <button type="button" class="btn btn-primary" onclick="saveEditSelectedPermissions()" style="padding: 12px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="check"></i>
                        Tanlash
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    if (window.feather) window.feather.replace();
};

// Barcha dostuplarni tanlash (Edit)
window.selectAllEditPermissions = function() {
    document.querySelectorAll('.edit-select-permission-checkbox').forEach(cb => cb.checked = true);
};

// Barcha dostuplarni bekor qilish (Edit)
window.deselectAllEditPermissions = function() {
    document.querySelectorAll('.edit-select-permission-checkbox').forEach(cb => cb.checked = false);
};

// Dostuplarni saqlash (Edit)
window.saveEditSelectedPermissions = function() {
    const selected = Array.from(document.querySelectorAll('.edit-select-permission-checkbox:checked')).map(cb => cb.value);
    editRoleData.permissions = selected;
    updateEditPermissionsCount();
    document.getElementById('edit-select-permissions-modal').remove();
    if (window.feather) window.feather.replace();
};

// Dostuplar sonini yangilash (Edit)
function updateEditPermissionsCount() {
    const count = editRoleData.permissions.length;
    const countEl = document.getElementById('edit-selected-permissions-count');
    if (countEl) {
        countEl.textContent = `${count} ta dostup tanlangan`;
        countEl.style.color = count > 0 ? '#4facfe' : 'var(--text-secondary)';
    }
}

async function createNewRole() {
    const input = document.getElementById('new-role-name');
    const roleName = input.value.trim().toLowerCase();
    const requiresLocationsValue = document.getElementById('new-role-requires-locations').value;
    const requiresBrandsValue = document.getElementById('new-role-requires-brands').value;
    
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
    
    // Filial bo'yicha brendlar tanlangan bo'lsa, filial tanlanishi kerak
    if (requiresLocationsValue === 'by_location' && !newRoleData.selected_location) {
        showToast('Filial bo\'yicha brendlar tanlangan bo\'lsa, filial tanlanishi kerak!', 'error');
        return;
    }
    
    // Brend bo'yicha filiallar tanlangan bo'lsa, brendlar tanlanishi kerak
    if (requiresBrandsValue === 'by_brand' && (!newRoleData.selected_brands || newRoleData.selected_brands.length === 0)) {
        showToast('Brend bo\'yicha filiallar tanlangan bo\'lsa, kamida bitta brend tanlanishi kerak!', 'error');
        return;
    }
    
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
    
    // Requires locations va brands ni to'g'ri formatga o'tkazish
    let requiresLocations = null;
    if (requiresLocationsValue === 'true') requiresLocations = true;
    else if (requiresLocationsValue === 'false') requiresLocations = false;
    else if (requiresLocationsValue === 'by_location') requiresLocations = 'by_location';
    else requiresLocations = null;
    
    let requiresBrands = null;
    if (requiresBrandsValue === 'true') requiresBrands = true;
    else if (requiresBrandsValue === 'false') requiresBrands = false;
    else if (requiresBrandsValue === 'by_brand') requiresBrands = 'by_brand';
    else requiresBrands = null;
    
    try {
        const response = await safeFetch('/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                role_name: roleName,
                requires_locations: requiresLocations,
                requires_brands: requiresBrands,
                selected_location: newRoleData.selected_location,
                selected_brands: newRoleData.selected_brands,
                permissions: newRoleData.permissions
            })
        });
        
        if (!response || !response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create role');
        }
        
        showToast('Yangi rol muvaffaqiyatli yaratildi!', 'success');
        
        // Close modal
        const addRoleModal = document.getElementById('add-role-modal');
        if (addRoleModal) addRoleModal.remove();
        
        // Reload roles
        try {
            const rolesRes = await safeFetch('/api/roles');
            if (rolesRes && rolesRes.ok) {
                const rolesData = await rolesRes.json();
                if (rolesData && rolesData.roles) {
                    state.roles = rolesData.roles;
                    state.allPermissions = rolesData.all_permissions;
                    renderRoles();
                } else {
                    console.error('Roles data topilmadi');
                }
            } else {
                console.error('Roles yuklashda xatolik: response not ok');
            }
        } catch (error) {
            console.error('Roles yuklashda xatolik:', error);
        }
        
    } catch (error) {
        console.error('Create role error:', error);
        showToast(error.message || 'Rol yaratishda xatolik!', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i data-feather="check"></i> Yaratish';
        if (window.feather) window.feather.replace();
    }
}

// Rol tahrirlash uchun tanlangan qiymatlar
let editRoleData = {
    role_name: '',
    requires_locations: null,
    requires_brands: null,
    selected_location: null,
    selected_brands: [],
    permissions: []
};

// Rolni to'liq tahrirlash modal
function openEditRoleModal(roleName) {
    const role = state.roles.find(r => r.role_name === roleName);
    if (!role) {
        showToast('Rol topilmadi!', 'error');
        return;
    }
    
    // Faqat super_admin roli tahrirlash mumkin emas
    if (roleName === 'super_admin') {
        showToast('Bu rol to\'liq tahrirlash mumkin emas!', 'error');
        return;
    }
    
    // Edit role data ni to'ldirish
    editRoleData = {
        role_name: roleName,
        requires_locations: role.requires_locations,
        requires_brands: role.requires_brands,
        selected_location: role.selected_location || null,
        selected_brands: role.selected_brands || [],
        permissions: role.permissions || []
    };
    
    // requires_locations va requires_brands ni to'g'ri formatga o'tkazish
    const requiresLocationsValue = editRoleData.requires_locations === null ? 'null' : 
        editRoleData.requires_locations === true ? 'true' : 
        editRoleData.requires_locations === false ? 'false' : 
        editRoleData.requires_locations === 'by_location' ? 'by_location' : 'null';
    
    const requiresBrandsValue = editRoleData.requires_brands === null ? 'null' : 
        editRoleData.requires_brands === true ? 'true' : 
        editRoleData.requires_brands === false ? 'false' : 
        editRoleData.requires_brands === 'by_brand' ? 'by_brand' : 'null';
    
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.id = 'edit-role-modal';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" style="max-width: 800px; width: 95%;">
            <div class="modal-content">
                <div class="modal-header-enhanced">
                    <div class="modal-icon-wrapper">
                        <i data-feather="edit-2"></i>
                    </div>
                    <div style="flex: 1;">
                        <h3 class="modal-title" style="margin: 0; display: flex; align-items: center; gap: 12px;">
                            <span>"${roleName}" Rolini Tahrirlash</span>
                        </h3>
                        <p class="modal-subtitle">Rol nomi, talablar va dostuplarni belgilang</p>
                    </div>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="position: static; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                        <i data-feather="x"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label for="edit-role-name" style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-primary);">Rol Nomi</label>
                        <input type="text" class="form-control" id="edit-role-name" value="${roleName}" placeholder="masalan: operator, manager, kassir" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; transition: all 0.3s;">
                        <small class="form-text text-muted" style="display: block; margin-top: 6px; color: var(--text-secondary); font-size: 12px;">Faqat lotin harflari va pastki chiziq (_) ishlatiladi</small>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: 500; color: var(--text-primary);">Filiallar Talabi</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select class="form-control" id="edit-role-requires-locations" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; transition: all 0.3s; cursor: pointer;">
                                <option value="null" ${requiresLocationsValue === 'null' ? 'selected' : ''}>Ixtiyoriy (tanlash shart emas)</option>
                                <option value="true" ${requiresLocationsValue === 'true' ? 'selected' : ''}>Majburiy (kamida 1 ta tanlash kerak)</option>
                                <option value="false" ${requiresLocationsValue === 'false' ? 'selected' : ''}>Ko'rsatilmaydi (umuman ko'rinmaydi)</option>
                                <option value="by_location" ${requiresLocationsValue === 'by_location' ? 'selected' : ''}>Filial bo'yicha brendlar ko'rsatish</option>
                            </select>
                            <button type="button" class="btn btn-secondary" id="edit-select-location-btn" style="padding: 12px 20px; border-radius: 8px; display: ${requiresLocationsValue === 'by_location' ? 'block' : 'none'};" onclick="openEditSelectLocationModal()">
                                <i data-feather="map-pin"></i>
                                Filial Tanlash
                            </button>
                        </div>
                        <div id="edit-selected-location-display" style="margin-top: 10px; padding: 10px; background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px; display: ${editRoleData.selected_location ? 'block' : 'none'};">
                            <span style="color: #4facfe; font-weight: 500;">Tanlangan filial: </span>
                            <span id="edit-selected-location-name" style="color: var(--text-primary);">${editRoleData.selected_location || ''}</span>
                            <button type="button" onclick="clearEditSelectedLocation()" style="margin-left: 10px; background: rgba(255,77,77,0.2); border: 1px solid rgba(255,77,77,0.3); color: #ff4d4d; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                                <i data-feather="x"></i> Olib tashlash
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: 500; color: var(--text-primary);">Brendlar Talabi</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select class="form-control" id="edit-role-requires-brands" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; transition: all 0.3s; cursor: pointer;">
                                <option value="null" ${requiresBrandsValue === 'null' ? 'selected' : ''}>Ixtiyoriy (tanlash shart emas)</option>
                                <option value="true" ${requiresBrandsValue === 'true' ? 'selected' : ''}>Majburiy (kamida 1 ta tanlash kerak)</option>
                                <option value="false" ${requiresBrandsValue === 'false' ? 'selected' : ''}>Ko'rsatilmaydi (umuman ko'rinmaydi)</option>
                                <option value="by_brand" ${requiresBrandsValue === 'by_brand' ? 'selected' : ''}>Brend bo'yicha filiallar ko'rsatish</option>
                            </select>
                            <button type="button" class="btn btn-secondary" id="edit-select-brands-btn" style="padding: 12px 20px; border-radius: 8px; display: ${requiresBrandsValue === 'by_brand' ? 'block' : 'none'};" onclick="openEditSelectBrandsModal()">
                                <i data-feather="tag"></i>
                                Brendlar Tanlash
                            </button>
                        </div>
                        <div id="edit-selected-brands-display" style="margin-top: 10px; padding: 10px; background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px; display: ${editRoleData.selected_brands && editRoleData.selected_brands.length > 0 ? 'block' : 'none'};">
                            <span style="color: #4facfe; font-weight: 500;">Tanlangan brendlar: </span>
                            <span id="edit-selected-brands-names" style="color: var(--text-primary);">${editRoleData.selected_brands && editRoleData.selected_brands.length > 0 ? editRoleData.selected_brands.join(', ') : ''}</span>
                            <button type="button" onclick="clearEditSelectedBrands()" style="margin-left: 10px; background: rgba(255,77,77,0.2); border: 1px solid rgba(255,77,77,0.3); color: #ff4d4d; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                                <i data-feather="x"></i> Olib tashlash
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: 500; color: var(--text-primary);">Dostuplar (Permissions)</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div style="flex: 1; padding: 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                                <span id="edit-selected-permissions-count" style="color: var(--text-secondary);">${editRoleData.permissions.length} ta dostup tanlangan</span>
                            </div>
                            <button type="button" class="btn btn-primary" id="edit-select-permissions-btn" style="padding: 12px 20px; border-radius: 8px;" onclick="openEditSelectPermissionsModal()">
                                <i data-feather="shield"></i>
                                Dostuplar Tanlash
                            </button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 20px;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="padding: 12px 24px; border-radius: 8px; font-weight: 500; transition: all 0.3s;">Bekor qilish</button>
                    <button type="button" class="btn btn-primary" id="save-edit-role-btn" style="padding: 12px 24px; border-radius: 8px; font-weight: 500; transition: all 0.3s; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="save"></i>
                        Saqlash
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Feather iconlarni yangilash
    if (window.feather) {
        window.feather.replace();
    }
    
    // Event listenerlar
    document.getElementById('edit-role-requires-locations').addEventListener('change', (e) => {
        const selectLocationBtn = document.getElementById('edit-select-location-btn');
        const locationDisplay = document.getElementById('edit-selected-location-display');
        if (e.target.value === 'by_location') {
            selectLocationBtn.style.display = 'block';
            locationDisplay.style.display = 'block';
        } else {
            selectLocationBtn.style.display = 'none';
            locationDisplay.style.display = 'none';
            editRoleData.selected_location = null;
        }
        editRoleData.requires_locations = e.target.value === 'null' ? null : e.target.value === 'true' ? true : e.target.value === 'false' ? false : 'by_location';
    });
    
    document.getElementById('edit-role-requires-brands').addEventListener('change', (e) => {
        const selectBrandsBtn = document.getElementById('edit-select-brands-btn');
        const brandsDisplay = document.getElementById('edit-selected-brands-display');
        if (e.target.value === 'by_brand') {
            selectBrandsBtn.style.display = 'block';
            brandsDisplay.style.display = 'block';
        } else {
            selectBrandsBtn.style.display = 'none';
            brandsDisplay.style.display = 'none';
            editRoleData.selected_brands = [];
        }
        editRoleData.requires_brands = e.target.value === 'null' ? null : e.target.value === 'true' ? true : e.target.value === 'false' ? false : 'by_brand';
    });
    
    // Save button handler
    document.getElementById('save-edit-role-btn').addEventListener('click', () => saveEditRole(roleName));
    
    // Update permissions count
    updateEditPermissionsCount();
}

// Rolni to'liq saqlash
async function saveEditRole(oldRoleName) {
    const newRoleName = document.getElementById('edit-role-name').value.trim().toLowerCase();
    const requiresLocationsValue = document.getElementById('edit-role-requires-locations').value;
    const requiresBrandsValue = document.getElementById('edit-role-requires-brands').value;
    
    // Validation
    if (!newRoleName) {
        showToast('Rol nomini kiriting!', 'error');
        document.getElementById('edit-role-name').focus();
        return;
    }
    
    if (!/^[a-z_]+$/.test(newRoleName)) {
        showToast('Rol nomida faqat lotin harflari va pastki chiziq (_) bo\'lishi mumkin!', 'error');
        document.getElementById('edit-role-name').focus();
        return;
    }
    
    // Filial bo'yicha brendlar tanlangan bo'lsa, filial tanlanishi kerak
    if (requiresLocationsValue === 'by_location' && !editRoleData.selected_location) {
        showToast('Filial bo\'yicha brendlar tanlangan bo\'lsa, filial tanlanishi kerak!', 'error');
        return;
    }
    
    // Brend bo'yicha filiallar tanlangan bo'lsa, brendlar tanlanishi kerak
    if (requiresBrandsValue === 'by_brand' && (!editRoleData.selected_brands || editRoleData.selected_brands.length === 0)) {
        showToast('Brend bo\'yicha filiallar tanlangan bo\'lsa, kamida bitta brend tanlanishi kerak!', 'error');
        return;
    }
    
    // Requires locations va brands ni to'g'ri formatga o'tkazish
    let requiresLocations = null;
    if (requiresLocationsValue === 'true') requiresLocations = true;
    else if (requiresLocationsValue === 'false') requiresLocations = false;
    else if (requiresLocationsValue === 'by_location') requiresLocations = 'by_location';
    else requiresLocations = null;
    
    let requiresBrands = null;
    if (requiresBrandsValue === 'true') requiresBrands = true;
    else if (requiresBrandsValue === 'false') requiresBrands = false;
    else if (requiresBrandsValue === 'by_brand') requiresBrands = 'by_brand';
    else requiresBrands = null;
    
    const btn = document.getElementById('save-edit-role-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
    
    try {
        const response = await safeFetch(`/api/roles/${oldRoleName}/full`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                new_role_name: newRoleName !== oldRoleName ? newRoleName : undefined,
                requires_locations: requiresLocations,
                requires_brands: requiresBrands,
                selected_location: editRoleData.selected_location,
                selected_brands: editRoleData.selected_brands,
                permissions: editRoleData.permissions
            })
        });
        
        if (!response || !response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update role');
        }
        
        showToast('Rol muvaffaqiyatli yangilandi!', 'success');
        
        // Close modal
        const editRoleModal = document.getElementById('edit-role-modal');
        if (editRoleModal) editRoleModal.remove();
        
        // Reload roles
        try {
            const rolesRes = await safeFetch('/api/roles');
            if (rolesRes && rolesRes.ok) {
                const rolesData = await rolesRes.json();
                if (rolesData && rolesData.roles) {
                    state.roles = rolesData.roles;
                    state.allPermissions = rolesData.all_permissions;
                    renderRoles();
                } else {
                    console.error('Roles data topilmadi');
                }
            } else {
                console.error('Roles yuklashda xatolik: response not ok');
            }
        } catch (error) {
            console.error('Roles yuklashda xatolik:', error);
        }
        
    } catch (error) {
        console.error('Save edit role error:', error);
        showToast(error.message || 'Rolni yangilashda xatolik!', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i data-feather="save"></i> Saqlash';
        if (window.feather) window.feather.replace();
    }
}

// Rolni o'chirish
async function deleteRole(roleName) {
    // Faqat super_admin roli o'chirish mumkin emas
    if (roleName === 'super_admin') {
        showToast('Bu rol o\'chirish mumkin emas!', 'error');
        return;
    }
    
    const confirmed = await showConfirmDialog({
        title: '🗑️ Rolni O\'chirish',
        message: `"${roleName}" rolini o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi!`,
        confirmText: 'O\'chirish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'trash-2'
    });
    
    if (!confirmed) return;
    
    try {
        const response = await safeFetch(`/api/roles/${roleName}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to delete role');
        }
        
        showToast(`"${roleName}" roli muvaffaqiyatli o'chirildi!`, 'success');
        
        // Reload roles
        try {
            const rolesRes = await safeFetch('/api/roles');
            if (rolesRes && rolesRes.ok) {
                const rolesData = await rolesRes.json();
                if (rolesData && rolesData.roles) {
                    state.roles = rolesData.roles;
                    state.allPermissions = rolesData.all_permissions;
                    renderRoles();
                } else {
                    console.error('Roles data topilmadi');
                    // Xatolik bo'lsa ham sahifani yangilash
                    window.location.reload();
                }
            } else {
                console.error('Roles yuklashda xatolik: response not ok');
                // Xatolik bo'lsa ham sahifani yangilash
                window.location.reload();
            }
        } catch (error) {
            console.error('Roles yuklashda xatolik:', error);
            // Xatolik bo'lsa ham sahifani yangilash
            window.location.reload();
        }
        
    } catch (error) {
        console.error('Delete role error:', error);
        showToast(error.message || 'Rolni o\'chirishda xatolik!', 'error');
    }
}
