// Comparison Module
// Filiallar bo'yicha operatorlar kiritgan summalarni solishtirish summasi bilan taqqoslash
// Yangi sxema: Bir kunlik sana + bitta brend

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast, hasPermission } from './utils.js';

let currentDate = null;
let currentBrandId = null;
let currentBrandName = null;
let comparisonData = [];
let isComparisonSetup = false; // Event listener'lar bir marta qo'shilishini ta'minlash
let isLoadingData = false; // Ma'lumotlar yuklanayotganini kuzatish

/**
 * Comparison bo'limini sozlash
 */
export function setupComparison() {
    if (!hasPermission(state.currentUser, 'comparison:view')) {
        return;
    }

    // Agar allaqachon sozlangan bo'lsa, faqat ma'lumotlarni yangilash
    if (isComparisonSetup) {
        loadBrands();
        return;
    }

    // Bugungi sanani default qilib o'rnatish
    const dateFilter = document.getElementById('comparison-date-filter');
    if (dateFilter) {
        const today = new Date().toISOString().split('T')[0];
        dateFilter.value = today;
        currentDate = today;
    }

    // Brendlar ro'yxatini yuklash
    loadBrands();

    // Event listener'lar
    const loadBtn = document.getElementById('comparison-load-btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', loadComparisonData);
    }

    const saveBtn = document.getElementById('comparison-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveComparisonData);
    }

    const exportBtn = document.getElementById('comparison-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportComparisonData);
    }

    const importBtn = document.getElementById('comparison-import-btn');
    const importFileInput = document.getElementById('comparison-import-file');
    if (importBtn && importFileInput) {
        // Import tugmasi bosilganda file dialogini ochish
        importBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Avval inputni tozalash (bir xil faylni qayta tanlash uchun)
            importFileInput.value = '';
            importFileInput.click();
        });
        
        // File tanlanganda
        importFileInput.addEventListener('change', (e) => {
            e.stopPropagation();
            handleImportFile(e);
        });
    }

    const templateBtn = document.getElementById('comparison-template-btn');
    if (templateBtn) {
        templateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadTemplate();
        });
    }

    // Sana o'zgarganda
    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => {
            currentDate = e.target.value;
        });
    }

    // Brend o'zgarganda
    const brandSelect = document.getElementById('comparison-brand-select');
    if (brandSelect) {
        brandSelect.addEventListener('change', (e) => {
            currentBrandId = e.target.value;
            const selectedOption = brandSelect.options[brandSelect.selectedIndex];
            currentBrandName = selectedOption.text;
            
            // Tanlangan brendni ko'rsatish
            const selectedBrandDiv = document.getElementById('comparison-selected-brand');
            const brandNameSpan = document.getElementById('comparison-brand-name');
            if (selectedBrandDiv && brandNameSpan) {
                if (currentBrandId) {
                    brandNameSpan.textContent = currentBrandName;
                    selectedBrandDiv.classList.add('show');
                } else {
                    selectedBrandDiv.classList.remove('show');
                }
            }
        });
    }

    // Setup tugallandi
    isComparisonSetup = true;
}

/**
 * Brendlar ro'yxatini yuklash
 */
async function loadBrands() {
    try {
        const res = await safeFetch('/api/brands');
        if (!res || !res.ok) return;

        const brands = await res.json();
        const select = document.getElementById('comparison-brand-select');
        if (!select) return;

        // Mavjud option'larni saqlash (birinchi "Brendni tanlang...")
        const firstOption = select.querySelector('option');
        select.innerHTML = '';
        if (firstOption) {
            select.appendChild(firstOption);
        }

        brands.forEach(brand => {
            const option = document.createElement('option');
            option.value = brand.id;
            option.textContent = brand.name;
            select.appendChild(option);
        });
    } catch (error) {
        // Silent error handling
    }
}

/**
 * Solishtirish ma'lumotlarini yuklash
 */
async function loadComparisonData() {
    // Agar allaqachon yuklanayotgan bo'lsa, kutish
    if (isLoadingData) {
        return;
    }

    const dateFilter = document.getElementById('comparison-date-filter');
    const brandSelect = document.getElementById('comparison-brand-select');
    const loadBtn = document.getElementById('comparison-load-btn');
    const table = document.getElementById('comparison-table');
    const emptyState = document.getElementById('comparison-empty-state');
    const saveBtn = document.getElementById('comparison-save-btn');
    const exportBtn = document.getElementById('comparison-export-btn');

    if (!dateFilter || !brandSelect) return;

    const date = dateFilter.value;
    const brandId = brandSelect.value;

    // Loading flag'ni o'rnatish
    isLoadingData = true;

    if (!date) {
        showToast('Iltimos, sanani tanlang', true);
        isLoadingData = false;
        return;
    }

    if (!brandId) {
        showToast('Iltimos, brendni tanlang', true);
        isLoadingData = false;
        return;
    }

    currentDate = date;
    currentBrandId = brandId;
    const selectedOption = brandSelect.options[brandSelect.selectedIndex];
    currentBrandName = selectedOption.text;

    try {
        if (loadBtn) {
            loadBtn.disabled = true;
            loadBtn.innerHTML = '<i data-feather="loader"></i> <span>Yuklanmoqda...</span>';
            if (window.feather) window.feather.replace();
        }

        const params = new URLSearchParams({ date, brandId });
        const url = `/api/comparison/data?${params.toString()}`;
        
        const res = await safeFetch(url);
        
        if (!res || !res.ok) {
            throw new Error('Ma\'lumotlarni yuklashda xatolik');
        }

        const data = await res.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Ma\'lumotlar topilmadi');
        }

        comparisonData = data.data || [];
        
        // Jadvalni ko'rsatish
        const tableWrapper = document.querySelector('.comparison-table-wrapper');
        if (tableWrapper) {
            tableWrapper.style.display = 'block';
        }
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        // Tugmalarni ko'rsatish
        const canEdit = hasPermission(state.currentUser, 'comparison:edit');
        const canView = hasPermission(state.currentUser, 'comparison:view');
        const canExport = hasPermission(state.currentUser, 'comparison:export');
        const isAdmin = state.currentUser?.role === 'admin';
        const isManager = state.currentUser?.role === 'manager';
        
        // Admin va Manager uchun barcha funksiyalarga ruxsat berish
        const shouldShowEdit = canEdit || isAdmin || isManager;
        const shouldShowView = canView || isAdmin || isManager;
        const shouldShowExport = canExport || isAdmin || isManager;
        
        // Saqlash tugmasi
        if (saveBtn) {
            if (shouldShowEdit) {
                saveBtn.style.display = 'inline-flex';
            } else {
                saveBtn.style.display = 'none';
            }
        }
        
        // Excel Import tugmasi
        const importBtn = document.getElementById('comparison-import-btn');
        if (importBtn) {
            importBtn.style.display = 'inline-flex';
            
            if (!shouldShowEdit) {
                importBtn.disabled = true;
                importBtn.title = 'Bu funksiya uchun comparison:edit permission kerak';
            } else {
                importBtn.disabled = false;
                importBtn.title = '';
            }
        }
        
        // Shablon tugmasi
        const templateBtn = document.getElementById('comparison-template-btn');
        if (templateBtn) {
            if (shouldShowView) {
                templateBtn.style.display = 'inline-flex';
            } else {
                templateBtn.style.display = 'none';
            }
        }
        
        // Export tugmasi
        if (exportBtn) {
            if (shouldShowExport) {
                exportBtn.style.display = 'inline-flex';
            } else {
                exportBtn.style.display = 'none';
            }
        }

        // Jadvalni to'ldirish
        renderTable(comparisonData);

    } catch (error) {
        showToast(error.message || 'Xatolik yuz berdi', true);
        
        const tableWrapper = document.querySelector('.comparison-table-wrapper');
        if (tableWrapper) {
            tableWrapper.style.display = 'none';
        }
        if (emptyState) {
            emptyState.style.display = 'block';
        }
    } finally {
        // Loading flag'ni tozalash
        isLoadingData = false;
        
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.innerHTML = '<i data-feather="search"></i> <span>Qidirish</span>';
            if (window.feather) window.feather.replace();
        }
    }
}

/**
 * Raqamni 3 xonali formatga o'tkazish (bo'sh joy bilan)
 */
function formatComparisonNumber(value) {
    if (!value || value === '' || value === '-') return '';
    const num = parseFloat(value.toString().replace(/\s/g, ''));
    if (isNaN(num)) return '';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Formatlangan raqamni oddiy raqamga o'tkazish
 */
function parseComparisonNumber(value) {
    if (!value || value === '') return 0;
    const cleaned = value.toString().replace(/\s/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/**
 * Input o'zgarganda hisob-kitoblarni yangilash
 */
function updateComparisonCalculations(inputElement, comparisonAmount) {
    const location = inputElement.getAttribute('data-location');
    const operatorAmount = parseFloat(inputElement.getAttribute('data-operator-amount')) || 0;
    
    // Farqni hisoblash
    const difference = operatorAmount - comparisonAmount;
    
    // Foizni hisoblash - to'g'ri formula: (operator / comparison) * 100
    let percentage = null;
    if (comparisonAmount > 0 && operatorAmount > 0) {
        percentage = ((operatorAmount / comparisonAmount) * 100).toFixed(2);
    }
    
    // Qatorni topish
    const row = inputElement.closest('tr');
    
    if (row) {
        // Farqni yangilash
        const differenceCell = row.querySelector('.comparison-difference');
        
        if (differenceCell) {
            let diffClass = 'neutral';
            let diffText = '-';
            
            if (comparisonAmount > 0) {
                if (difference > 0) {
                    diffClass = 'positive';
                } else if (difference < 0) {
                    diffClass = 'negative';
                } else {
                    diffClass = 'neutral';
                }
                diffText = `${difference >= 0 ? '+' : ''}${difference.toLocaleString('ru-RU')}`;
            }
            
            differenceCell.className = `comparison-difference ${diffClass}`;
            differenceCell.textContent = diffText;
        }
        
        // Foizni yangilash
        const percentageCell = row.querySelector('.comparison-percentage');
        
        if (percentageCell) {
            if (percentage !== null && !isNaN(parseFloat(percentage))) {
                let badgeClass = '';
                const pct = parseFloat(percentage);
                
                if (pct >= 90 && pct <= 110) {
                    badgeClass = 'normal';
                } else if ((pct >= 80 && pct < 90) || (pct > 110 && pct <= 120)) {
                    badgeClass = 'warning';
                } else {
                    badgeClass = 'danger';
                }
                percentageCell.className = `comparison-percentage ${badgeClass}`;
                percentageCell.textContent = `${percentage}%`;
            } else {
                percentageCell.className = '';
                percentageCell.innerHTML = '<span style="color: var(--text-secondary);">-</span>';
            }
        }
        
        // Holatni yangilash
        const statusCell = row.querySelector('.comparison-status');
        
        if (statusCell) {
            if (percentage !== null && !isNaN(parseFloat(percentage))) {
                const pct = parseFloat(percentage);
                let badgeClass = '';
                let icon = '';
                let text = '';
                
                if (pct >= 90 && pct <= 110) {
                    badgeClass = 'normal';
                    icon = '✅';
                    text = 'Normal';
                } else if ((pct >= 80 && pct < 90) || (pct > 110 && pct <= 120)) {
                    badgeClass = 'warning';
                    icon = '⚠️';
                    text = 'Ogohlantirish';
                } else {
                    badgeClass = 'danger';
                    icon = '🔴';
                    text = 'Xavfli';
                }
                
                statusCell.className = `comparison-status ${badgeClass}`;
                statusCell.innerHTML = `<span>${icon}</span> ${text}`;
            } else {
                statusCell.className = '';
                statusCell.innerHTML = '<span style="color: var(--text-secondary);">-</span>';
            }
        }
    }
}

/**
 * Jadvalni ko'rsatish
 */
function renderTable(data) {
    const tableBody = document.getElementById('comparison-table-body');
    if (!tableBody) {
        return;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    Ma'lumotlar topilmadi
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    for (const item of data) {
        const operatorAmount = item.operator_amount || 0;
        const comparisonAmount = item.comparison_amount;
        const difference = item.difference;
        const percentage = item.percentage;
        const currency = item.currency || 'UZS';

        // Rang kodini aniqlash
        let statusClass = '';
        let statusIcon = '';
        let statusText = '';
        let statusBadgeClass = '';
        
        if (percentage !== null) {
            if (percentage >= 90 && percentage <= 110) {
                statusClass = 'text-success';
                statusBadgeClass = 'normal';
                statusIcon = '✅';
                statusText = 'Normal';
            } else if (percentage >= 80 && percentage < 90 || percentage > 110 && percentage <= 120) {
                statusClass = 'text-warning';
                statusBadgeClass = 'warning';
                statusIcon = '⚠️';
                statusText = 'Ogohlantirish';
            } else {
                statusClass = 'text-danger';
                statusBadgeClass = 'danger';
                statusIcon = '🔴';
                statusText = 'Xavfli';
            }
        }

        // Input maydoni - har doim ko'rsatamiz, lekin permission bo'lmasa disabled
        const canEdit = hasPermission(state.currentUser, 'comparison:edit');
        const isAdmin = state.currentUser?.role === 'admin';
        const isManager = state.currentUser?.role === 'manager';
        
        // Admin va Manager uchun har doim enabled
        const shouldEnable = canEdit || isAdmin || isManager;
        
        // Input maydonini yaratish - text type (3 xonali format uchun)
        const formattedValue = comparisonAmount ? formatComparisonNumber(comparisonAmount) : '';
        const inputField = `<input type="text" 
                      class="form-control comparison-input" 
                      data-location="${item.location}"
                      data-operator-amount="${operatorAmount}"
                      value="${formattedValue}" 
                      placeholder="Kiritish..." 
                      inputmode="numeric"
                      id="comparison-input-${item.location.replace(/\s+/g, '-')}"
                      ${!shouldEnable ? 'disabled' : ''}
                      style="${!shouldEnable ? 'opacity: 0.6; cursor: not-allowed;' : ''}">`;

        // Farq va foiz ko'rinishi - ranglar bilan
        let differenceClass = 'neutral';
        let differenceText = '-';
        
        if (difference !== null && comparisonAmount !== null) {
            if (difference > 0) {
                differenceClass = 'positive'; // Yashil - plus
            } else if (difference < 0) {
                differenceClass = 'negative'; // Qizil - minus
            } else {
                differenceClass = 'neutral'; // Kulrang - nol
            }
            differenceText = `${difference >= 0 ? '+' : ''}${difference.toLocaleString('ru-RU')}`;
        }

        const percentageText = percentage !== null ? `${percentage.toFixed(2)}%` : '-';
        const percentageClass = percentage !== null ? statusBadgeClass : '';

        html += `
            <tr data-location="${item.location}">
                <td>
                    <strong style="font-size: 15px; color: var(--text-primary);">${item.location}</strong>
                </td>
                <td>
                    <div class="comparison-operator-amount">
                        <strong>${operatorAmount.toLocaleString('ru-RU')} ${currency}</strong>
                        <small>Avtomatik</small>
                    </div>
                </td>
                <td>${inputField}</td>
                <td>
                    <span class="comparison-difference ${differenceClass}">${differenceText}</span>
                </td>
                <td>
                    <span class="comparison-percentage ${percentageClass}">${percentageText}</span>
                </td>
                <td>
                    <span class="comparison-status ${statusBadgeClass}">${statusText ? `<span>${statusIcon}</span> ${statusText}` : '<span style="color: var(--text-secondary);">-</span>'}</span>
                </td>
            </tr>
        `;
    }

    tableBody.innerHTML = html;
    
    // Input maydonlariga real-time hisoblash event listener qo'shish
    const inputs = tableBody.querySelectorAll('.comparison-input');
    
    inputs.forEach((input) => {
        input.addEventListener('input', function(e) {
            if (this.disabled) {
                return;
            }
            
            // 3 xonali format qilish
            const cursorPosition = this.selectionStart || 0;
            let newValue = e.target.value;
            
            // Faqat raqamlar va bo'sh joylarni qabul qilish
            newValue = newValue.replace(/[^\d\s]/g, '');
            
            // Bo'sh bo'lsa, tozalash
            if (newValue.trim() === '') {
                this.value = '';
                const comparisonAmount = 0;
                // Hisoblashni yangilash
                updateComparisonCalculations(this, comparisonAmount);
                return;
            }
            
            // Raqamni parse qilish
            const parsedValue = parseComparisonNumber(newValue);
            
            // Format qilish
            const formattedValue = formatComparisonNumber(parsedValue);
            
            // Agar format o'zgarganda, yangilash
            if (formattedValue !== newValue) {
                this.value = formattedValue;
                // Cursor pozitsiyasini saqlash
                const lengthDiff = formattedValue.length - newValue.length;
                const newCursorPosition = Math.max(0, Math.min(cursorPosition + lengthDiff, formattedValue.length));
                setTimeout(() => {
                    this.setSelectionRange(newCursorPosition, newCursorPosition);
                }, 0);
            }
            
            // Hisoblashni yangilash
            updateComparisonCalculations(this, parsedValue);
            
        });
        
        // Focus va blur effektlari
        input.addEventListener('focus', function() {
            if (!this.disabled) {
                this.parentElement.parentElement.style.background = 'linear-gradient(90deg, rgba(0, 123, 255, 0.12), rgba(138, 43, 226, 0.08))';
            }
        });
        
        input.addEventListener('blur', function() {
            if (!this.disabled) {
                this.parentElement.parentElement.style.background = '';
            }
        });
    });
    
    // Feather iconlarni yangilash
    if (window.feather) {
        window.feather.replace();
    }
}

/**
 * Solishtirish ma'lumotlarini saqlash
 */
async function saveComparisonData() {
    const saveBtn = document.getElementById('comparison-save-btn');
    
    if (!currentDate || !currentBrandId) {
        showToast('Iltimos, avval ma\'lumotlarni yuklang', true);
        return;
    }

    // Barcha input maydonlarini olish
    const inputs = document.querySelectorAll('.comparison-input');
    const comparisons = [];

    for (const input of inputs) {
        const location = input.getAttribute('data-location');
        const value = input.value.trim();
        // Formatlangan qiymatni parse qilish (bo'sh joylarni olib tashlash)
        const cleanedValue = value.replace(/\s/g, '');
        const comparisonAmount = cleanedValue ? parseComparisonNumber(cleanedValue) : null;
        
        comparisons.push({
            location: location,
            comparison_amount: comparisonAmount
        });
    }

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i data-feather="loader"></i> <span>Saqlanmoqda...</span>';
            if (window.feather) window.feather.replace();
        }

        const res = await safeFetch('/api/comparison/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: currentDate,
                brandId: currentBrandId,
                comparisons: comparisons
            })
        });

        if (!res || !res.ok) {
            let errorMessage = 'Ma\'lumotlarni saqlashda xatolik';
            try {
                const errorData = await res.json();
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                if (res.status === 403) {
                    errorMessage = 'Bu amalni bajarish uchun sizda yetarli huquq yo\'q';
                } else if (res.status === 401) {
                    errorMessage = 'Avtorizatsiyadan o\'tmagansiz. Iltimos, qayta kiring.';
                }
            }
            throw new Error(errorMessage);
        }

        const data = await res.json();
        if (data.success) {
            showToast(`✅ ${data.saved_count + data.updated_count} ta ma'lumot saqlandi`, false);
            // Ma'lumotlarni qayta yuklash - bu input maydonlarini yangilaydi
            await loadComparisonData();
            
            // Input maydonlarini saqlangan qiymatlar bilan yangilash
            const inputs = document.querySelectorAll('.comparison-input');
            inputs.forEach((input) => {
                const location = input.getAttribute('data-location');
                const savedItem = comparisonData.find(item => item.location === location);
                if (savedItem && savedItem.comparison_amount !== null) {
                    const formattedValue = formatComparisonNumber(savedItem.comparison_amount);
                    input.value = formattedValue;
                }
            });
        } else {
            throw new Error(data.error || 'Xatolik yuz berdi');
        }

    } catch (error) {
        showToast(error.message || 'Xatolik yuz berdi', true);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-feather="save"></i> <span>Saqlash</span>';
            if (window.feather) window.feather.replace();
        }
    }
}

/**
 * Excel export
 */
async function exportComparisonData() {
    if (!currentDate || !currentBrandId) {
        showToast('Iltimos, avval ma\'lumotlarni yuklang', true);
        return;
    }

    try {
        const params = new URLSearchParams({ date: currentDate, brandId: currentBrandId });
        window.location.href = `/api/comparison/export?${params.toString()}`;
        showToast('Excel fayl yuklanmoqda...', false);
    } catch (error) {
        showToast('Export qilishda xatolik', true);
    }
}

/**
 * Excel import - fayl tanlanganda
 */
async function handleImportFile(event) {
    // Event'ni to'xtatish - ikki marta ishlamasligi uchun
    if (event) {
        event.stopPropagation();
    }
    
    const fileInput = event?.target || document.getElementById('comparison-import-file');
    if (!fileInput) return;
    
    const file = fileInput.files?.[0];
    if (!file) {
        // Agar fayl tanlanmagan bo'lsa, inputni tozalash
        fileInput.value = '';
        return;
    }

    // Fayl tipini tekshirish
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        showToast('Faqat Excel fayllarni (.xlsx, .xls) yuklash mumkin', true);
        fileInput.value = ''; // Inputni tozalash
        return;
    }

    if (!currentDate || !currentBrandId) {
        showToast('Iltimos, avval sana va brendni tanlang va ma\'lumotlarni yuklang', true);
        fileInput.value = '';
        return;
    }

    const importBtn = document.getElementById('comparison-import-btn');
    
    try {
        if (importBtn) {
            importBtn.disabled = true;
            importBtn.innerHTML = '<i data-feather="loader"></i> <span>Import qilinmoqda...</span>';
            if (window.feather) window.feather.replace();
        }

        // FormData yaratish
        const formData = new FormData();
        formData.append('file', file);
        formData.append('date', currentDate);
        formData.append('brandId', currentBrandId);

        const res = await safeFetch('/api/comparison/import', {
            method: 'POST',
            body: formData
        });

        if (!res || !res.ok) {
            let errorMessage = 'Import qilishda xatolik';
            try {
                const errorData = await res.json();
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                if (res.status === 403) {
                    errorMessage = 'Bu amalni bajarish uchun sizda yetarli huquq yo\'q';
                } else if (res.status === 401) {
                    errorMessage = 'Avtorizatsiyadan o\'tmagansiz. Iltimos, qayta kiring.';
                }
            }
            throw new Error(errorMessage);
        }

        const data = await res.json();
        
        if (data.success) {
            let message = `✅ ${data.total_imported} ta ma'lumot import qilindi`;
            if (data.saved_count > 0 || data.updated_count > 0) {
                message += ` (${data.saved_count} ta yangi, ${data.updated_count} ta yangilandi)`;
            }
            if (data.errors && data.errors.length > 0) {
                message += `. ${data.errors.length} ta xatolik topildi`;
            }
            showToast(message, false);
            
            // Ma'lumotlarni qayta yuklash
            await loadComparisonData();
        } else {
            throw new Error(data.error || 'Import qilishda xatolik');
        }

    } catch (error) {
        showToast(error.message || 'Import qilishda xatolik', true);
    } finally {
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.innerHTML = '<i data-feather="upload"></i> <span>Excel Import</span>';
            if (window.feather) window.feather.replace();
        }
        // Inputni tozalash - bu muhim, aks holda bir xil faylni qayta tanlash mumkin bo'lmaydi
        if (event.target) {
            event.target.value = '';
        }
        
        // File input elementini ham tozalash (qo'shimcha xavfsizlik)
        const importFileInput = document.getElementById('comparison-import-file');
        if (importFileInput) {
            importFileInput.value = '';
        }
    }
}

/**
 * Excel shablon faylini yuklab olish
 */
async function downloadTemplate() {
    try {
        const link = document.createElement('a');
        link.href = '/api/comparison/template';
        link.download = 'solishtirish_shablon.xlsx';
        link.style.display = 'none';
        document.body.appendChild(link);
        
        link.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        link.click();
        
        setTimeout(() => {
            if (link.parentNode) {
                document.body.removeChild(link);
            }
        }, 100);
        
        showToast('Shablon fayl yuklanmoqda...', false);
    } catch (error) {
        showToast('Shablon yuklab olishda xatolik', true);
    }
}
