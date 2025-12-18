// Brands Module - Brendlarni boshqarish
import { safeFetch } from './api.js';
import { showToast, showConfirmDialog } from './utils.js';
import { state } from './state.js';

let currentBrandId = null;
let allBrands = [];

// Brendlar ro'yxatini yuklash
export async function loadBrands() {
    try {
        const res = await safeFetch('/api/brands');
        if (!res.ok) throw new Error('Brendlarni yuklashda xatolik');
        allBrands = await res.json();
        renderBrandsList();
    } catch (error) {
        console.error('Brendlarni yuklash xatosi:', error);
        showToast('Brendlarni yuklashda xatolik', 'error');
    }
}

// Brendlar ro'yxatini render qilish
function renderBrandsList() {
    const container = document.getElementById('brands-settings');
    if (!container) return;

    if (allBrands.length === 0) {
        container.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Brendlar yo\'q</p>';
        return;
    }

    container.innerHTML = allBrands.map(brand => {
        let locationsText;
        if (!brand.locations || brand.locations.length === 0) {
            locationsText = '<span style="color: rgba(255,255,255,0.4);">Filiallar biriktirilmagan</span>';
        } else if (brand.locations.length <= 3) {
            locationsText = brand.locations.join(', ');
        } else {
            locationsText = `${brand.locations.slice(0, 3).join(', ')} <span style="background: rgba(79,172,254,0.2); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">+${brand.locations.length - 3} ta</span>`;
        }
        
        const brandEmoji = brand.emoji || '🏢';
        const brandColor = brand.color || '#4facfe';
        
        return `
            <div class="brand-item" data-id="${brand.id}" style="
                position: relative;
                background: linear-gradient(135deg, ${brandColor}15, ${brandColor}05);
                border-radius: 12px;
                padding: 14px;
                margin-bottom: 10px;
                transition: all 0.3s ease;
                overflow: hidden;
            ">
                <div style="
                    position: absolute;
                    top: -2px;
                    left: -2px;
                    right: -2px;
                    bottom: -2px;
                    background: linear-gradient(45deg, ${brandColor}, ${brandColor}80, ${brandColor}40, ${brandColor}80, ${brandColor});
                    background-size: 300% 300%;
                    border-radius: 12px;
                    z-index: -1;
                    animation: gradientMove 4s ease infinite;
                    opacity: 0.6;
                "></div>
                <div style="
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: #1a1a2e;
                    border-radius: 11px;
                    z-index: 0;
                "></div>
                <div style="position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1; display: flex; gap: 12px; align-items: start;">
                        <div style="
                            font-size: 32px;
                            line-height: 1;
                            filter: drop-shadow(0 2px 4px ${brandColor}40);
                        ">${brandEmoji}</div>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px; color: ${brandColor};">
                                ${brand.name}
                            </div>
                            <div style="color: rgba(255,255,255,0.5); font-size: 12px;">
                                📍 ${locationsText}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn-icon edit-brand-btn" data-id="${brand.id}" title="Tahrirlash">
                            <i data-feather="edit-2"></i>
                        </button>
                        <button class="btn-icon delete-brand-btn" data-id="${brand.id}" title="O'chirish">
                            <i data-feather="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    feather.replace();
    attachBrandEventListeners();
}

// Event listenerlarni biriktirish
function attachBrandEventListeners() {
    // Tahrirlash tugmalari
    document.querySelectorAll('.edit-brand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const brandId = parseInt(btn.dataset.id);
            openBrandModal(brandId);
        });
    });

    // O'chirish tugmalari
    document.querySelectorAll('.delete-brand-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const brandId = parseInt(btn.dataset.id);
            const brand = allBrands.find(b => b.id === brandId);
            
            const confirmed = await showConfirmDialog({
                title: '🗑️ Brendni o\'chirish',
                message: `"${brand.name}" brendini o'chirmoqchimisiz? Ushbu brendga bog'langan barcha ma'lumotlar ham o'chiriladi!`,
                confirmText: 'O\'chirish',
                cancelText: 'Bekor qilish',
                type: 'danger',
                icon: 'trash-2'
            });
            
            if (confirmed) {
                await deleteBrand(brandId);
            }
        });
    });
}

// Brend modalini ochish
export function openBrandModal(brandId = null) {
    currentBrandId = brandId;
    const modal = document.getElementById('brand-modal');
    const title = document.getElementById('brand-modal-title');
    const nameInput = document.getElementById('brand-name-input');
    const colorInput = document.getElementById('brand-color-input');
    
    // Modal ramkasini rangini o'zgartirish funksiyasi
    const updateModalBorder = (color) => {
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) {
            const lighterColor = color + '80'; // 50% transparency
            const darkerColor = color + '40'; // 25% transparency
            modalContent.style.setProperty('--modal-gradient', `linear-gradient(45deg, ${color}, ${lighterColor}, ${darkerColor}, ${lighterColor}, ${color})`);
        }
    };
    
    // Rang o'zgarganda modal ramkasini yangilash
    colorInput.addEventListener('input', (e) => {
        updateModalBorder(e.target.value);
    });
    
    if (brandId) {
        // Tahrirlash rejimi
        const brand = allBrands.find(b => b.id === brandId);
        title.textContent = 'Brendni Tahrirlash';
        nameInput.value = brand.name;
        colorInput.value = brand.color || '#4facfe';
        updateModalBorder(brand.color || '#4facfe');
        renderLocationCheckboxes(brand.locations || []);
    } else {
        // Yangi brend rejimi
        title.textContent = 'Yangi Brend';
        nameInput.value = '';
        colorInput.value = '#4facfe';
        updateModalBorder('#4facfe');
        renderLocationCheckboxes([]);
    }
    
    modal.classList.remove('hidden');
    feather.replace();
}

// Filiallar checkboxlarini render qilish
function renderLocationCheckboxes(selectedLocations = []) {
    const container = document.getElementById('brand-locations-list');
    if (!container) return;

    const locations = state.settings.app_settings?.locations || [];
    
    if (locations.length === 0) {
        container.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center;">Avval filiallar yarating</p>';
        return;
    }

    const allChecked = locations.every(loc => selectedLocations.includes(loc));

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
            <input type="checkbox" id="select-all-locations" ${allChecked ? 'checked' : ''} 
                style="margin-right: 10px; width: 18px; height: 18px; cursor: pointer;">
            <span style="font-size: 14px; color: #4facfe;">✓ Barchasi</span>
        </label>
        <div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0;"></div>
    `;

    html += locations.map(loc => {
        const isChecked = selectedLocations.includes(loc);
        return `
            <label class="checkbox-item location-checkbox-label" style="
                display: flex;
                align-items: center;
                padding: 8px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.2s;
            ">
                <input type="checkbox" name="brand-location" value="${loc}" ${isChecked ? 'checked' : ''} 
                    class="location-checkbox" style="margin-right: 10px; width: 16px; height: 16px; cursor: pointer;">
                <span style="font-size: 14px;">${loc}</span>
            </label>
        `;
    }).join('');

    container.innerHTML = html;

    // Barchasi checkbox event listener
    const selectAllCheckbox = document.getElementById('select-all-locations');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.location-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
            });
        });
    }

    // Individual checkbox event listener
    const locationCheckboxes = document.querySelectorAll('.location-checkbox');
    locationCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(locationCheckboxes).every(checkbox => checkbox.checked);
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = allChecked;
            }
        });
    });

    // Hover effects
    document.querySelectorAll('.location-checkbox-label').forEach(label => {
        label.addEventListener('mouseenter', () => {
            label.style.background = 'rgba(255,255,255,0.05)';
        });
        label.addEventListener('mouseleave', () => {
            label.style.background = 'transparent';
        });
    });
}

// Brendni saqlash
export async function saveBrand() {
    const nameInput = document.getElementById('brand-name-input');
    const colorInput = document.getElementById('brand-color-input');
    
    const name = nameInput.value.trim();
    if (!name) {
        showToast('Brend nomini kiriting', 'error');
        return;
    }

    const selectedLocations = Array.from(
        document.querySelectorAll('input[name="brand-location"]:checked')
    ).map(cb => cb.value);

    const data = {
        name,
        color: colorInput.value || '#4facfe',
        locations: selectedLocations
    };

    try {
        let res;
        if (currentBrandId) {
            // Tahrirlash
            res = await safeFetch(`/api/brands/${currentBrandId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            // Yangi yaratish
            res = await safeFetch('/api/brands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        if (!res || !res.ok) {
            let errorMsg = 'Xatolik yuz berdi';
            if (res) {
                if (res.status === 403) {
                    errorMsg = 'Ruxsat yo\'q. Admin sozlamalarni tekshiring.';
                } else {
                    try {
                        const error = await res.json();
                        errorMsg = error.message || errorMsg;
                    } catch (e) {
                        errorMsg = `Server xatosi: ${res.status}`;
                    }
                }
            }
            throw new Error(errorMsg);
        }

        showToast(currentBrandId ? 'Brend yangilandi' : 'Brend yaratildi', 'success');
        closeBrandModal();
        await loadBrands();
    } catch (error) {
        console.error('Brendni saqlash xatosi:', error);
        showToast(error.message || 'Xatolik yuz berdi', 'error');
    }
}

// Brendni o'chirish
async function deleteBrand(brandId) {
    try {
        const res = await safeFetch(`/api/brands/${brandId}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message);
        }

        showToast('Brend o\'chirildi', 'success');
        await loadBrands();
    } catch (error) {
        console.error('Brendni o\'chirish xatosi:', error);
        showToast(error.message || 'Xatolik yuz berdi', 'error');
    }
}

// Modalni yopish
export function closeBrandModal() {
    const modal = document.getElementById('brand-modal');
    modal.classList.add('hidden');
    currentBrandId = null;
}

// Event listenerlarni sozlash
export function setupBrandsEventListeners() {
    const addBrandBtn = document.getElementById('add-brand-btn');
    const saveBrandBtn = document.getElementById('save-brand-btn');
    const cancelBrandBtn = document.getElementById('cancel-brand-btn');
    const closeBrandModalBtn = document.getElementById('close-brand-modal');

    if (addBrandBtn) {
        addBrandBtn.addEventListener('click', () => openBrandModal());
    }

    if (saveBrandBtn) {
        saveBrandBtn.addEventListener('click', saveBrand);
    }

    if (cancelBrandBtn) {
        cancelBrandBtn.addEventListener('click', closeBrandModal);
    }

    if (closeBrandModalBtn) {
        closeBrandModalBtn.addEventListener('click', closeBrandModal);
    }

    // Modal tashqarisiga bosish
    const modal = document.getElementById('brand-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeBrandModal();
            }
        });
    }
}
