// User Permissions Module
import { state } from './state.js';

let currentSelectedUser = null;
let currentPermissionType = 'additional'; // 'additional' or 'restricted'

// Initialize User Permissions
export function initializeUserPermissions() {
    // console.log('✅ Initializing user permissions module...');
    setupUserPermissionTabs();
    setupUserPermissionTypes();
    setupSaveButton();
    
    // Birinchi tab va contentni aktiv qilish
    const firstTab = document.querySelector('.roles-tab[data-tab="roles-permissions"]');
    const firstContent = document.getElementById('roles-permissions-tab');
    // console.log('✅ First tab found:', firstTab);
    // console.log('✅ First content found:', firstContent);
    if (firstTab && firstContent) {
        firstTab.classList.add('active');
        firstContent.classList.add('active');
        // console.log('✅ First tab activated');
    } else {
        // console.error('❌ First tab or content not found!');
    }
}

// Setup Save Button Event Listener
function setupSaveButton() {
    // Event delegation yoki to'g'ridan-to'g'ri event listener
    document.addEventListener('click', (e) => {
        const saveBtn = e.target.closest('#save-user-permissions-btn');
        if (saveBtn) {
            e.preventDefault();
            window.saveUserPermissions(e);
        }
    });
}

// Setup Tab Navigation
function setupUserPermissionTabs() {
    const tabs = document.querySelectorAll('.roles-tab');
    // console.log('📑 Found roles tabs:', tabs.length);
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // console.log('📑 Tab clicked:', tab.getAttribute('data-tab'));
            // Remove active from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            // Hide all tab contents
            document.querySelectorAll('.roles-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // Activate clicked tab
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            const tabContent = document.getElementById(`${tabName}-tab`);
            // console.log('📑 Tab content element:', tabContent);
            if (tabContent) {
                tabContent.classList.add('active');
                // console.log('📑 Tab content activated:', tabName);
                
                // Load specific data for each tab
                if (tabName === 'user-permissions') {
                    // console.log('📑 Loading users for permissions...');
                    loadUsersForPermissions();
                } else if (tabName === 'permissions-overview') {
                    // console.log('📑 Loading permissions overview...');
                    loadPermissionsOverview();
                }
            } else {
                // console.error('❌ Tab content not found for:', tabName);
            }
        });
    });
}

// Setup Additional/Restricted Permission Types
function setupUserPermissionTypes() {
    const tabs = document.querySelectorAll('.user-perm-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active from all
            tabs.forEach(t => t.classList.remove('active'));
            // Activate clicked
            tab.classList.add('active');
            
            // Update current type
            currentPermissionType = tab.getAttribute('data-type');
            
            // Reload permissions for current user
            if (currentSelectedUser) {
                loadUserPermissions(currentSelectedUser.id);
            }
        });
    });
}

// Load All Users for Permissions
async function loadUsersForPermissions() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        
        // Super admin'ni faqat super admin o'zi ko'rsin
        const filteredUsers = users.filter(user => {
            if (user.role === 'super_admin' && state.currentUser?.role !== 'super_admin') {
                return false;
            }
            return true;
        });
        
        const usersList = document.getElementById('user-permissions-list');
        if (!usersList) return;
        
        usersList.innerHTML = filteredUsers.map(user => `
            <div class="user-permission-item" data-user-id="${user.id}" data-role="${user.role}">
                <div class="user-avatar">${(user.fullname || user.username || 'U').charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <h4>${user.fullname || user.username}</h4>
                    <p>@${user.username} • ${getRoleName(user.role)}</p>
                </div>
                <span class="user-permission-badge modified" style="display: none;">Modified</span>
            </div>
        `).join('');
        
        // Add click handlers
        document.querySelectorAll('.user-permission-item').forEach(item => {
            item.addEventListener('click', () => {
                const userId = item.getAttribute('data-user-id');
                const role = item.getAttribute('data-role');
                const fullname = item.querySelector('.user-info h4').textContent;
                const username = item.querySelector('.user-info p').textContent.split('•')[0].trim().substring(1);
                
                selectUser({ id: userId, role, fullname, username });
            });
        });
        
        // Search functionality
        const searchInput = document.querySelector('.user-permissions-search input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                document.querySelectorAll('.user-permission-item').forEach(item => {
                    const username = item.querySelector('.user-info h4').textContent.toLowerCase();
                    const role = item.querySelector('.user-info p').textContent.toLowerCase();
                    item.style.display = (username.includes(searchTerm) || role.includes(searchTerm)) ? 'flex' : 'none';
                });
            });
        }
        
    } catch (error) {
        // console.error('Error loading users:', error);
        alert('Foydalanuvchilarni yuklashda xatolik!');
    }
}

// Select a User
function selectUser(user) {
    currentSelectedUser = user;
    
    // Update active state
    document.querySelectorAll('.user-permission-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-user-id="${user.id}"]`).classList.add('active');
    
    // Update header
    const avatar = document.getElementById('selected-user-avatar');
    const name = document.getElementById('selected-user-name');
    const role = document.getElementById('selected-user-role');
    
    if (avatar) avatar.textContent = (user.fullname || user.username).charAt(0).toUpperCase();
    if (name) name.textContent = user.fullname || user.username;
    if (role) role.textContent = `@${user.username} • ${getRoleName(user.role)}`;
    
    // Load user permissions
    loadUserPermissions(user.id);
}

// Load User-Specific Permissions (Dual Panel Version)
async function loadUserPermissions(userId) {
    // console.log('📋 Loading permissions for user:', userId);
    try {
        const [userPermsResponse, allPermsResponse] = await Promise.all([
            fetch(`/api/users/${userId}/permissions`),
            fetch('/api/roles/permissions')
        ]);
        
        const userData = await userPermsResponse.json();
        const allPermissions = await allPermsResponse.json();
        
        // console.log('📋 User permissions data:', userData);
        // console.log('📋 All permissions:', allPermissions.length);
        
        // Get user's role permissions
        const rolePermsResponse = await fetch(`/api/roles`);
        const rolesData = await rolePermsResponse.json();
        const userRole = rolesData.roles.find(r => r.role_name === currentSelectedUser.role);
        const rolePermissions = userRole ? userRole.permissions : [];
        
        // console.log('📋 Role permissions:', rolePermissions);
        
        // Current type: additional or restricted
        const userPerms = currentPermissionType === 'additional' 
            ? (userData.additional || []) 
            : (userData.restricted || []);
        
        // Determine available and assigned permissions
        let availablePermissions, assignedPermissions;
        
        if (currentPermissionType === 'additional') {
            // Additional: assigned = user's additional, available = all except role permissions and additional
            assignedPermissions = allPermissions.filter(p => userPerms.includes(p.permission_key));
            availablePermissions = allPermissions.filter(p => 
                !rolePermissions.includes(p.permission_key) && 
                !userPerms.includes(p.permission_key)
            );
        } else {
            // Restricted: assigned = user's restricted, available = role permissions not restricted
            assignedPermissions = allPermissions.filter(p => userPerms.includes(p.permission_key));
            availablePermissions = allPermissions.filter(p => 
                rolePermissions.includes(p.permission_key) && 
                !userPerms.includes(p.permission_key)
            );
        }
        
        // console.log('📋 Available permissions:', availablePermissions.length);
        // console.log('📋 Assigned permissions:', assignedPermissions.length);
        
        // Render dual panels
        renderPermissionsPanel(availablePermissions, assignedPermissions);
        
        // Setup transfer buttons
        setupTransferButtons();
        
        // Setup filter functionality
        setupPermissionFilters();
        
        // Show footer
        document.getElementById('user-permissions-footer').style.display = 'flex';
        document.getElementById('reset-user-permissions-btn').style.display = 'inline-flex';
        
        // Update title
        const assignedTitle = document.getElementById('assigned-title');
        if (assignedTitle) {
            assignedTitle.textContent = currentPermissionType === 'additional' 
                ? 'Qo\'shimcha Huquqlar' 
                : 'Cheklangan Huquqlar';
        }
        
    } catch (error) {
        // console.error('Error loading user permissions:', error);
        alert('Foydalanuvchi huquqlarini yuklashda xatolik!');
    }
}

// Render Permissions Panels
function renderPermissionsPanel(available, assigned) {
    // console.log('🎨 Rendering dual panel');
    const availableList = document.getElementById('available-permissions-list');
    const assignedList = document.getElementById('assigned-permissions-list');
    
    if (!availableList || !assignedList) {
        // console.error('❌ Lists not found!');
        return;
    }
    
    // Group by category
    const groupByCategory = (perms) => {
        const grouped = {};
        perms.forEach(perm => {
            const cat = perm.category || 'Boshqa';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(perm);
        });
        return grouped;
    };
    
    const renderList = (permissions) => {
        if (permissions.length === 0) {
            return '<div class="empty-state"><svg>...</svg><p>Huquqlar yo\'q</p></div>';
        }
        
        const grouped = groupByCategory(permissions);
        return Object.entries(grouped).map(([category, perms]) => `
            <div class="permission-category-group collapsed">
                <div class="permission-category-header" onclick="toggleCategory(this)">
                    <div class="permission-category-title">
                        ${getCategoryIcon(category)} ${category}
                        <span class="permission-count">(${perms.length})</span>
                    </div>
                    <svg class="category-arrow" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transform: rotate(-90deg);">
                        <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                    </svg>
                </div>
                <div class="permission-category-content" style="max-height: 0;">
                    ${perms.map(perm => `
                        <div class="permission-item-card" data-permission="${perm.permission_key}">
                            <input type="checkbox" class="permission-item-checkbox" value="${perm.permission_key}">
                            <div class="permission-item-info">
                                <h5 class="permission-item-name">${perm.description}</h5>
                                <span class="permission-item-key">${perm.permission_key}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    };
    
    availableList.innerHTML = renderList(available);
    assignedList.innerHTML = renderList(assigned);
    
    // Populate filter dropdowns
    populateFilterDropdowns();
    
    // Update stats
    updatePermissionStats();
    
    // Add click handlers using event delegation
    [availableList, assignedList].forEach(list => {
        list.addEventListener('click', (e) => {
            const card = e.target.closest('.permission-item-card');
            if (!card) return;
            
            // Don't toggle if clicked directly on checkbox
            if (e.target.type === 'checkbox') {
                card.classList.toggle('selected', e.target.checked);
                return;
            }
            
            // Toggle checkbox if clicked on card
            const checkbox = card.querySelector('.permission-item-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                card.classList.toggle('selected', checkbox.checked);
            }
        });
    });
}

// Populate Filter Dropdowns
function populateFilterDropdowns() {
    const availableList = document.getElementById('available-permissions-list');
    const assignedList = document.getElementById('assigned-permissions-list');
    const availableFilter = document.getElementById('available-filter');
    const assignedFilter = document.getElementById('assigned-filter');
    
    // Get unique categories from available list
    if (availableList && availableFilter) {
        const categories = new Set();
        availableList.querySelectorAll('.permission-category-title').forEach(title => {
            const categoryText = title.textContent.replace(/\(\d+\)/, '').trim();
            categories.add(categoryText);
        });
        
        availableFilter.innerHTML = '<option value="">Barcha bo\'limlar</option>';
        Array.from(categories).sort().forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            availableFilter.appendChild(option);
        });
    }
    
    // Get unique categories from assigned list
    if (assignedList && assignedFilter) {
        const categories = new Set();
        assignedList.querySelectorAll('.permission-category-title').forEach(title => {
            const categoryText = title.textContent.replace(/\(\d+\)/, '').trim();
            categories.add(categoryText);
        });
        
        assignedFilter.innerHTML = '<option value="">Barcha bo\'limlar</option>';
        Array.from(categories).sort().forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            assignedFilter.appendChild(option);
        });
    }
}

// Update Permission Statistics
function updatePermissionStats() {
    const availableList = document.getElementById('available-permissions-list');
    const assignedList = document.getElementById('assigned-permissions-list');
    const availableStats = document.getElementById('available-stats');
    const assignedStats = document.getElementById('assigned-stats');
    
    if (availableList && availableStats) {
        const availableCount = availableList.querySelectorAll('.permission-item-card:not([style*="display: none"])').length;
        const availableCategories = availableList.querySelectorAll('.permission-category-group:not([style*="display: none"])').length;
        availableStats.textContent = `${availableCount} ta (${availableCategories} bo'lim)`;
    }
    
    if (assignedList && assignedStats) {
        const assignedCount = assignedList.querySelectorAll('.permission-item-card:not([style*="display: none"])').length;
        const assignedCategories = assignedList.querySelectorAll('.permission-category-group:not([style*="display: none"])').length;
        assignedStats.textContent = `${assignedCount} ta (${assignedCategories} bo'lim)`;
    }
}

// Get Category Icon
function getCategoryIcon(category) {
    const icons = {
        'Boshqaruv Paneli': '📊',
        'Hisobotlar': '📝',
        'KPI': '🎯',
        'Foydalanuvchilar': '👥',
        'Rollar va Huquqlar': '🔐',
        'Sozlamalar': '⚙️',
        'Tizim Jurnali': '📋',
        'Pivot Jadval': '📈',
        'Brendlar': '🏷️',
        'Tizim Boshqaruvi': '🔧'
    };
    return icons[category] || '🔒';
}

// Setup Transfer Buttons
function setupTransferButtons() {
    // console.log('⚡ Setting up transfer buttons');
    
    // Add selected
    document.getElementById('add-selected-perms-btn')?.addEventListener('click', () => {
        transferPermissions('available', 'assigned', true);
    });
    
    // Add all
    document.getElementById('add-all-perms-btn')?.addEventListener('click', () => {
        transferPermissions('available', 'assigned', false);
    });
    
    // Remove selected
    document.getElementById('remove-selected-perms-btn')?.addEventListener('click', () => {
        transferPermissions('assigned', 'available', true);
    });
    
    // Remove all
    document.getElementById('remove-all-perms-btn')?.addEventListener('click', () => {
        transferPermissions('assigned', 'available', false);
    });
}

// Transfer Permissions
function transferPermissions(from, to, onlySelected) {
    // console.log(`🔄 Transferring from ${from} to ${to}, selected only: ${onlySelected}`);
    
    const fromList = document.getElementById(`${from}-permissions-list`);
    const toList = document.getElementById(`${to}-permissions-list`);
    
    if (!fromList || !toList) return;
    
    // Get cards to transfer
    let cardsToTransfer = [];
    if (onlySelected) {
        // Find all checked checkboxes within permission cards
        const checkedBoxes = fromList.querySelectorAll('.permission-item-checkbox:checked');
        checkedBoxes.forEach(checkbox => {
            const card = checkbox.closest('.permission-item-card');
            if (card) cardsToTransfer.push(card);
        });
    } else {
        // Get all permission cards
        cardsToTransfer = Array.from(fromList.querySelectorAll('.permission-item-card'));
    }
    
    if (cardsToTransfer.length === 0) {
        // console.log('⚠️ No cards to transfer');
        return;
    }
    
    // console.log(`📦 Transferring ${cardsToTransfer.length} cards`);
    
    cardsToTransfer.forEach(card => {
        const checkbox = card.querySelector('.permission-item-checkbox');
        checkbox.checked = false;
        card.classList.remove('selected');
        
        // Move card
        const category = card.closest('.permission-category-group');
        if (!category) {
            // console.error('❌ Category not found for card:', card);
            return;
        }
        
        const categoryTitleEl = category.querySelector('.permission-category-title');
        if (!categoryTitleEl) {
            // console.error('❌ Category title not found');
            return;
        }
        
        const fullText = categoryTitleEl.textContent.trim();
        const categoryText = fullText.replace(/\(\d+\)/, '').trim();
        
        // Extract icon (emoji at start)
        const iconMatch = fullText.match(/^(\p{Emoji}|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F])\s*/u);
        const icon = iconMatch ? iconMatch[0].trim() : '📦';
        
        // Find or create category in target
        let targetCategory = Array.from(toList.querySelectorAll('.permission-category-title'))
            .find(t => t.textContent.replace(/\(\d+\)/, '').trim() === categoryText)?.closest('.permission-category-group');
        
        if (!targetCategory) {
            targetCategory = document.createElement('div');
            targetCategory.className = 'permission-category-group collapsed';
            targetCategory.innerHTML = `
                <div class="permission-category-header" onclick="toggleCategory(this)">
                    <div class="permission-category-title">
                        ${icon} ${categoryText.replace(icon, '').trim()}
                        <span class="permission-count">(0)</span>
                    </div>
                    <svg class="category-arrow" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transform: rotate(-90deg);">
                        <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                    </svg>
                </div>
                <div class="permission-category-content" style="max-height: 0;"></div>
            `;
            toList.appendChild(targetCategory);
        }
        
        const targetContent = targetCategory.querySelector('.permission-category-content');
        if (!targetContent) {
            // console.error('❌ Target content not found');
            return;
        }
        
        targetContent.appendChild(card);
        
        // Update count
        const count = targetContent.querySelectorAll('.permission-item-card').length;
        const countEl = targetCategory.querySelector('.permission-count');
        if (countEl) countEl.textContent = `(${count})`;
    });
    
    // Clean up empty categories and update counts
    fromList.querySelectorAll('.permission-category-group').forEach(cat => {
        const content = cat.querySelector('.permission-category-content');
        const cards = content ? content.querySelectorAll('.permission-item-card') : [];
        
        if (cards.length === 0) {
            cat.remove();
        } else {
            // Update count
            const countEl = cat.querySelector('.permission-count');
            if (countEl) countEl.textContent = `(${cards.length})`;
        }
    });
    
    // Show empty state if needed
    if (fromList.querySelectorAll('.permission-item-card').length === 0) {
        fromList.innerHTML = '<div class="empty-state"><p>Huquqlar yo\'q</p></div>';
    }
    
    // Mark as modified
    const userItem = document.querySelector(`[data-user-id="${currentSelectedUser.id}"]`);
    if (userItem) {
        const badge = userItem.querySelector('.user-permission-badge');
        if (badge) badge.style.display = 'inline-block';
    }
    
    // Update filter dropdowns
    populateFilterDropdowns();
    
    // Update stats
    updatePermissionStats();
}

// Setup Permission Filters
function setupPermissionFilters() {
    // console.log('🔍 Setting up filter functionality');
    
    // Available permissions filter
    const availableFilter = document.getElementById('available-filter');
    if (availableFilter) {
        availableFilter.addEventListener('change', (e) => {
            filterPermissionsByCategory('available-permissions-list', e.target.value);
        });
    }
    
    // Assigned permissions filter
    const assignedFilter = document.getElementById('assigned-filter');
    if (assignedFilter) {
        assignedFilter.addEventListener('change', (e) => {
            filterPermissionsByCategory('assigned-permissions-list', e.target.value);
        });
    }
}

// Filter Permissions by Category
function filterPermissionsByCategory(listId, selectedCategory) {
    const list = document.getElementById(listId);
    if (!list) return;
    
    const categories = list.querySelectorAll('.permission-category-group');
    
    categories.forEach(category => {
        const titleEl = category.querySelector('.permission-category-title');
        if (!titleEl) return;
        
        const categoryText = titleEl.textContent.replace(/\(\d+\)/, '').trim();
        
        if (!selectedCategory || categoryText === selectedCategory) {
            // Show category
            category.style.display = 'block';
            
            // Auto-expand if filtered
            if (selectedCategory) {
                const content = category.querySelector('.permission-category-content');
                category.classList.remove('collapsed');
                if (content) content.style.maxHeight = content.scrollHeight + 'px';
                const arrow = category.querySelector('.category-arrow');
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        } else {
            // Hide category
            category.style.display = 'none';
        }
    });
    
    // Update stats
    updatePermissionStats();
    
    // Show/hide empty state
    const emptyState = list.querySelector('.empty-state');
    const visibleCategories = list.querySelectorAll('.permission-category-group:not([style*="display: none"])');
    
    if (emptyState) {
        emptyState.style.display = visibleCategories.length > 0 ? 'none' : 'flex';
    }
}

// Toggle Category Accordion
window.toggleCategory = function(header) {
    const group = header.closest('.permission-category-group');
    const content = group.querySelector('.permission-category-content');
    const arrow = header.querySelector('.category-arrow');
    
    group.classList.toggle('collapsed');
    
    if (group.classList.contains('collapsed')) {
        content.style.maxHeight = '0';
        arrow.style.transform = 'rotate(-90deg)';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        arrow.style.transform = 'rotate(0deg)';
    }
};

// Toggle User Permission
window.toggleUserPermission = function(permissionKey, isChecked) {
    // console.log(`Toggle permission ${permissionKey}: ${isChecked}`);
    // Mark user as modified
    const userItem = document.querySelector(`[data-user-id="${currentSelectedUser.id}"]`);
    if (userItem) {
        const badge = userItem.querySelector('.user-permission-badge');
        if (badge) badge.style.display = 'inline-block';
    }
};

// Save User Permissions
window.saveUserPermissions = async function(event) {
    if (!currentSelectedUser) {
        alert('Iltimos, foydalanuvchini tanlang!');
        return;
    }
    
    // Event parametri bo'lmasa, button'ni to'g'ridan-to'g'ri topish
    let btn;
    if (event && event.target) {
        btn = event.target.closest('button') || event.target;
    } else {
        btn = document.getElementById('save-user-permissions-btn');
    }
    
    if (!btn) {
        console.error('Save button topilmadi!');
        return;
    }
    
    btn.disabled = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
    
    try {
        // Collect permissions from assigned panel
        const assignedList = document.getElementById('assigned-permissions-list');
        if (!assignedList) {
            throw new Error('Assigned permissions list topilmadi');
        }
        
        const permissionCards = assignedList.querySelectorAll('.permission-item-card');
        const permissions = Array.from(permissionCards).map(card => card.dataset.permission);
        
        console.log('💾 [USER PERMISSIONS] Saqlanmoqda:', {
            userId: currentSelectedUser.id,
            type: currentPermissionType,
            permissionsCount: permissions.length
        });
        
        const response = await fetch(`/api/users/${currentSelectedUser.id}/permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: currentPermissionType,
                permissions: permissions
            })
        });
        
        if (!response.ok) {
            let errorMessage = 'Huquqlarni saqlashda xatolik';
            try {
                const errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (e) {
                if (response.status === 403) {
                    errorMessage = 'Bu amalni bajarish uchun sizda yetarli huquq yo\'q';
                } else if (response.status === 401) {
                    errorMessage = 'Avtorizatsiyadan o\'tmagansiz. Iltimos, qayta kiring.';
                } else if (response.status === 404) {
                    errorMessage = 'Foydalanuvchi topilmadi';
                }
            }
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('✅ [USER PERMISSIONS] Saqlandi:', result);
        
        // Success
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg> Saqlandi!';
        
        setTimeout(() => {
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }, 2000);
        
        // Reload user to remove modified badge
        selectUser(currentSelectedUser);
        loadUsersForPermissions();
        
    } catch (error) {
        console.error('❌ [USER PERMISSIONS] Saqlashda xatolik:', error);
        alert(`Huquqlarni saqlashda xatolik: ${error.message}`);
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
};

// Reset User Permissions
window.resetUserPermissions = async function() {
    if (!currentSelectedUser) return;
    
    if (!await window.showConfirm('Ushbu foydalanuvchining barcha maxsus huquqlarini tiklaysizmi?', 'Huquqlarni tiklash')) return;
    
    try {
        const response = await fetch(`/api/users/${currentSelectedUser.id}/permissions`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to reset');
        
        alert('Huquqlar muvaffaqiyatli tiklandi!');
        loadUserPermissions(currentSelectedUser.id);
        loadUsersForPermissions();
        
    } catch (error) {
        // console.error('Error resetting permissions:', error);
        alert('Huquqlarni tiklashda xatolik!');
    }
};

// Load Permissions Overview
async function loadPermissionsOverview() {
    try {
        const response = await fetch('/api/roles/permissions');
        const permissions = await response.json();
        
        // console.log('📋 Loaded permissions for overview:', permissions);
        
        const container = document.getElementById('permissions-overview-tab');
        if (!container) return;
        
        // Group by category
        const grouped = {};
        permissions.forEach(perm => {
            const cat = perm.category || 'Boshqa';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(perm);
        });
        
        // Render grouped permissions
        container.innerHTML = `
            <div class="permissions-overview-container">
                <div class="permissions-overview-header">
                    <h3>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="3" x2="9" y2="21"></line>
                        </svg>
                        Barcha Huquqlar
                    </h3>
                    <span class="overview-stats">${permissions.length} ta huquq, ${Object.keys(grouped).length} ta bo'lim</span>
                </div>
                
                ${Object.entries(grouped).map(([category, perms]) => `
                    <div class="permission-overview-category collapsed">
                        <div class="permission-overview-category-header" onclick="toggleOverviewCategory(this)">
                            <div class="category-title-with-icon">
                                <span class="category-icon">${getCategoryIcon(category)}</span>
                                <h4>${category}</h4>
                                <span class="category-count">${perms.length} ta huquq</span>
                            </div>
                            <svg class="category-arrow" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style="transform: rotate(-90deg);">
                                <path d="M5.5 7.5l4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </div>
                        <div class="permission-overview-category-content" style="max-height: 0;">
                            ${perms.map((perm, index) => `
                                <div class="permission-overview-card" style="animation: fadeIn 0.3s ease ${index * 0.03}s both">
                                    <div class="permission-card-header">
                                        <div class="permission-icon">${getPermissionTypeIcon(perm.permission_key)}</div>
                                        <div class="permission-card-info">
                                            <h5>${perm.description}</h5>
                                            <code>${perm.permission_key}</code>
                                        </div>
                                    </div>
                                    <p class="permission-explanation">${getPermissionExplanation(perm.permission_key)}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
    } catch (error) {
        // console.error('Error loading permissions overview:', error);
    }
}

// Toggle Overview Category
window.toggleOverviewCategory = function(header) {
    const category = header.closest('.permission-overview-category');
    const content = category.querySelector('.permission-overview-category-content');
    const arrow = header.querySelector('.category-arrow');
    
    category.classList.toggle('collapsed');
    
    if (category.classList.contains('collapsed')) {
        content.style.maxHeight = '0';
        arrow.style.transform = 'rotate(-90deg)';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        arrow.style.transform = 'rotate(0deg)';
    }
};

// Get Permission Type Icon
function getPermissionTypeIcon(permKey) {
    const [module, action] = permKey.split(':');
    const actionIcons = {
        'view': '👁️',
        'view_all': '👁️',
        'view_own': '👤',
        'view_assigned': '📋',
        'view_statistics': '📊',
        'view_charts': '📈',
        'view_sessions': '🔐',
        'create': '➕',
        'edit': '✏️',
        'edit_all': '✏️',
        'edit_own': '📝',
        'edit_assigned': '📝',
        'edit_general': '⚙️',
        'edit_table': '📊',
        'edit_telegram': '📱',
        'delete': '🗑️',
        'delete_all': '🗑️',
        'delete_own': '🗑️',
        'export': '📤',
        'export_data': '💾',
        'customize': '🎨',
        'change_password': '🔑',
        'change_secret': '🔐',
        'set_secret_word': '🔐',
        'change_status': '🔄',
        'block': '🚫',
        'archive': '📦',
        'manage': '⚙️',
        'manage_sessions': '🔐',
        'terminate_sessions': '⛔',
        'connect_telegram': '📱',
        'assign_users': '👥',
        'import': '📥',
        'backup': '💾',
        'restore': '♻️'
    };
    
    return actionIcons[action] || '📌';
}

// Get Permission Explanation
function getPermissionExplanation(permKey) {
    const explanations = {
        'dashboard:view': 'Boshqaruv panelini ochish va umumiy ma\'lumotlarni ko\'rish imkoniyati',
        'dashboard:view_statistics': 'Statistika kartalarida ma\'lumotlarni ko\'rish (umumiy summa, hisobotlar soni, va h.k.)',
        'dashboard:view_charts': 'Grafik va diagrammalarni ko\'rish (donut chart, line chart va boshqalar)',
        'dashboard:export_data': 'Dashboard ma\'lumotlarini Excel yoki PDF formatida yuklab olish',
        'dashboard:customize': 'Dashboard widgetlarini qo\'shish, o\'chirish va tartibini o\'zgartirish',
        
        'reports:view_all': 'Tizimdagi barcha hisobotlarni ko\'rish (barcha filiallar va foydalanuvchilar)',
        'reports:view_assigned': 'Faqat o\'ziga biriktirilgan filial hisobotlarini ko\'rish',
        'reports:view_own': 'Faqat o\'zi yaratgan hisobotlarni ko\'rish',
        'reports:create': 'Yangi hisobot yaratish va ma\'lumotlarni kiritish',
        'reports:edit_all': 'Barcha hisobotlarni tahrirlash (barcha filiallar)',
        'reports:edit_assigned': 'Faqat biriktirilgan filial hisobotlarini tahrirlash',
        'reports:edit_own': 'Faqat o\'zi yaratgan hisobotlarni tahrirlash',
        'reports:delete': 'Hisobotlarni o\'chirish',
        'reports:delete_all': 'Barcha hisobotlarni o\'chirish (xavfli operatsiya)',
        'reports:delete_own': 'Faqat o\'z hisobotlarini o\'chirish',
        'reports:export': 'Hisobotlarni Excel/PDF formatida eksport qilish',
        
        'kpi:view': 'KPI ko\'rsatkichlarini ko\'rish',
        'kpi:manage': 'KPI maqsadlarini o\'rnatish va boshqarish',
        'kpi:view_team': 'Jamoaning KPI ko\'rsatkichlarini ko\'rish',
        'kpi:export': 'KPI ma\'lumotlarini eksport qilish',
        
        'users:view': 'Foydalanuvchilar ro\'yxatini ko\'rish',
        'users:create': 'Yangi foydalanuvchi qo\'shish va akkaunt yaratish',
        'users:edit': 'Foydalanuvchi ma\'lumotlarini tahrirlash (ism, rol, filial)',
        'users:delete': 'Foydalanuvchilarni tizimdan o\'chirish',
        'users:change_password': 'Boshqa foydalanuvchilarning parolini o\'zgartirish',
        'users:change_secret': 'Maxfiy so\'zni o\'zgartirish',
        'users:set_secret_word': 'Yangi maxfiy so\'z o\'rnatish',
        'users:change_status': 'Foydalanuvchini aktivlashtirish yoki deaktivlashtirish',
        'users:block': 'Foydalanuvchini vaqtincha bloklash',
        'users:archive': 'Foydalanuvchini arxivlash',
        'users:view_sessions': 'Faol sessiyalarni ko\'rish',
        'users:terminate_sessions': 'Sessiyalarni majburiy tugatish',
        'users:manage_sessions': 'Sessiyalarni boshqarish',
        'users:connect_telegram': 'Telegram botga ulash',
        
        'roles:view': 'Rollar ro\'yxatini ko\'rish',
        'roles:manage': 'Rollarni yaratish, tahrirlash va o\'chirish',
        'roles:assign': 'Foydalanuvchilarga rol biriktirish',
        'roles:view_permissions': 'Rol huquqlarini ko\'rish',
        'roles:edit_permissions': 'Rol huquqlarini o\'zgartirish',
        'roles:manage_user_permissions': 'Individual foydalanuvchi huquqlarini boshqarish',
        
        'settings:view': 'Tizim sozlamalarini ko\'rish',
        'settings:edit_general': 'Umumiy sozlamalarni o\'zgartirish',
        'settings:edit_table': 'Jadval sozlamalarini boshqarish',
        'settings:edit_telegram': 'Telegram bot sozlamalarini o\'zgartirish',
        'settings:manage_brands': 'Brendlarni boshqarish',
        'settings:manage_branches': 'Filiallarni boshqarish',
        'settings:backup': 'Tizim zaxira nusxasini olish',
        'settings:restore': 'Zaxira nusxadan tiklash',
        
        'audit:view': 'Tizim jurnalini ko\'rish',
        'audit:export': 'Audit loglarni eksport qilish',
        'audit:delete': 'Eski loglarni o\'chirish',
        
        'pivot:view': 'Pivot jadvallarni ko\'rish',
        'pivot:create': 'Yangi pivot tahlil yaratish',
        'pivot:export': 'Pivot ma\'lumotlarini eksport qilish',
        'pivot:configure': 'Pivot sozlamalarini o\'zgartirish',
        'pivot:save_templates': 'Pivot shablonlarini saqlash',
        
        'brands:view': 'Brendlar ro\'yxatini ko\'rish',
        'brands:create': 'Yangi brend qo\'shish',
        'brands:edit': 'Brend ma\'lumotlarini tahrirlash',
        'brands:delete': 'Brendlarni o\'chirish',
        'brands:assign_users': 'Brendlarga foydalanuvchi biriktirish',
        
        'admin:import': 'Ma\'lumotlarni import qilish',
        'admin:export': 'Ma\'lumotlarni eksport qilish',
        'admin:backup': 'Tizim zaxirasini olish',
        'admin:system_settings': 'Tizim sozlamalarini boshqarish',
        
        'comparison:view': 'Qiymatlarni solishtirish bo\'limini ko\'rish va operatorlar kiritgan qiymatlarni umumiy qiymatlar bilan solishtirish',
        'comparison:export': 'Solishtirish natijalarini Excel faylga eksport qilish',
        'comparison:notify': 'Farqlar haqida operatorlarga Telegram orqali bildirishnoma yuborish'
    };
    
    return explanations[permKey] || 'Bu huquq tizimda ma\'lum bir amalni bajarish imkoniyatini beradi.';
}

// Helper Functions
function getRoleName(role) {
    const names = {
        'admin': 'Administrator',
        'manager': 'Menejer',
        'operator': 'Operator'
    };
    return names[role] || role;
}

function getPermissionIcon(category) {
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
        'Brands': '🎨'
    };
    return icons[category] || '🔒';
}

// Export module initialization
export default {
    initialize: initializeUserPermissions
};
