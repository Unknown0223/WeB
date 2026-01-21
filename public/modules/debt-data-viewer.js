// public/modules/debt-data-viewer.js
// Ma'lumotlarni ko'ruvchi - Brendlar, Filiallar, SVRlar ro'yxatlari

import { safeFetch } from './api.js';
import { showToast } from './utils.js';

const API_URL = '/api/debt-approval';

/**
 * Ma'lumotlarni ko'ruvchi modalini ko'rsatish
 */
export function showDataViewerModal(dataType) {
    const typeNames = {
        'brands': 'Brendlar',
        'branches': 'Filiallar',
        'svrs': 'SVRlar'
    };
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'data-viewer-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px;">
            <div class="modal-header">
                <h2>📋 ${typeNames[dataType] || 'Ma\'lumotlar'}</h2>
                <button class="modal-close" onclick="closeDataViewerModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="data-viewer-controls">
                    <div class="search-box">
                        <input type="text" id="data-search-input" placeholder="Qidirish..." class="form-control">
                    </div>
                    <div class="filter-box">
                        <select id="data-filter-select" class="form-control">
                            <option value="">Barchasi</option>
                        </select>
                    </div>
                    <div class="export-box">
                        <button class="btn btn-secondary" onclick="exportData('${dataType}')">📥 Export</button>
                    </div>
                </div>
                <div class="data-viewer-table-container">
                    <div id="data-viewer-table"></div>
                </div>
                <div class="data-viewer-pagination">
                    <span id="data-pagination-info"></span>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Ma'lumotlarni yuklash
    loadDataViewerData(dataType);
    
    // Event listener'lar
    setupDataViewerEvents(dataType);
}

/**
 * Ma'lumotlarni yuklash
 */
async function loadDataViewerData(dataType) {
    try {
        const endpoint = dataType === 'brands' ? '/brands' : 
                        dataType === 'branches' ? '/branches' : 
                        '/svrs';
        
        const res = await safeFetch(API_URL + endpoint);
        
        if (!res || !res.ok) {
            showToast('Ma\'lumotlarni yuklashda xatolik', 'error');
            return;
        }
        
        const data = await res.json();
        renderDataViewerTable(dataType, data);
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Ma\'lumotlarni yuklashda xatolik', 'error');
    }
}

/**
 * Jadvalni render qilish
 */
function renderDataViewerTable(dataType, data) {
    const tableContainer = document.getElementById('data-viewer-table');
    
    if (!data || data.length === 0) {
        tableContainer.innerHTML = '<p class="text-muted">Ma\'lumotlar topilmadi</p>';
        return;
    }
    
    let tableHTML = '<table class="data-viewer-table"><thead><tr>';
    
    if (dataType === 'brands') {
        tableHTML += '<th>ID</th><th>Nomi</th><th>Holat</th><th>Yaratilgan</th>';
    } else if (dataType === 'branches') {
        tableHTML += '<th>ID</th><th>Brend</th><th>Nomi</th><th>Holat</th><th>Yaratilgan</th>';
    } else if (dataType === 'svrs') {
        tableHTML += '<th>ID</th><th>Brend</th><th>Filial</th><th>Nomi</th><th>Holat</th><th>Yaratilgan</th>';
    }
    
    tableHTML += '</tr></thead><tbody>';
    
    data.forEach(item => {
        tableHTML += '<tr>';
        
        if (dataType === 'brands') {
            tableHTML += `<td>${item.id}</td>`;
            tableHTML += `<td>${escapeHtml(item.name || '')}</td>`;
            tableHTML += `<td>${escapeHtml(item.status || 'active')}</td>`;
            tableHTML += `<td>${formatDate(item.created_at)}</td>`;
        } else if (dataType === 'branches') {
            tableHTML += `<td>${item.id}</td>`;
            tableHTML += `<td>${escapeHtml(item.brand_name || '')}</td>`;
            tableHTML += `<td>${escapeHtml(item.name || '')}</td>`;
            tableHTML += `<td>${escapeHtml(item.status || 'active')}</td>`;
            tableHTML += `<td>${formatDate(item.created_at)}</td>`;
        } else if (dataType === 'svrs') {
            tableHTML += `<td>${item.id}</td>`;
            tableHTML += `<td>${escapeHtml(item.brand_name || '')}</td>`;
            tableHTML += `<td>${escapeHtml(item.filial_name || '')}</td>`;
            tableHTML += `<td>${escapeHtml(item.name || '')}</td>`;
            tableHTML += `<td>${escapeHtml(item.status || 'active')}</td>`;
            tableHTML += `<td>${formatDate(item.created_at)}</td>`;
        }
        
        tableHTML += '</tr>';
    });
    
    tableHTML += '</tbody></table>';
    
    // Pagination info
    document.getElementById('data-pagination-info').textContent = `Jami: ${data.length} ta`;
    
    tableContainer.innerHTML = tableHTML;
}

/**
 * Event listener'larni sozlash
 */
function setupDataViewerEvents(dataType) {
    const searchInput = document.getElementById('data-search-input');
    const filterSelect = document.getElementById('data-filter-select');
    
    // Search
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterTable(searchTerm, filterSelect.value);
    });
    
    // Filter
    filterSelect.addEventListener('change', (e) => {
        filterTable(searchInput.value.toLowerCase(), e.target.value);
    });
}

/**
 * Jadvalni filtrlash
 */
function filterTable(searchTerm, filterValue) {
    const table = document.querySelector('#data-viewer-table table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const matchesSearch = !searchTerm || text.includes(searchTerm);
        const matchesFilter = !filterValue || row.textContent.includes(filterValue);
        
        if (matchesSearch && matchesFilter) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    document.getElementById('data-pagination-info').textContent = `Ko'rsatilmoqda: ${visibleCount} ta`;
}

/**
 * Ma'lumotlarni export qilish
 */
async function exportData(dataType) {
    try {
        const endpoint = dataType === 'brands' ? '/brands' : 
                        dataType === 'branches' ? '/branches' : 
                        '/svrs';
        
        const res = await safeFetch(API_URL + endpoint);
        
        if (!res || !res.ok) {
            showToast('Export qilishda xatolik', 'error');
            return;
        }
        
        const data = await res.json();
        
        // CSV formatga o'tkazish
        let csv = '';
        
        if (dataType === 'brands') {
            csv = 'ID,Nomi,Holat,Yaratilgan\n';
            data.forEach(item => {
                csv += `${item.id},"${item.name || ''}",${item.status || 'active'},"${item.created_at || ''}"\n`;
            });
        } else if (dataType === 'branches') {
            csv = 'ID,Brend,Nomi,Holat,Yaratilgan\n';
            data.forEach(item => {
                csv += `${item.id},"${item.brand_name || ''}","${item.name || ''}",${item.status || 'active'},"${item.created_at || ''}"\n`;
            });
        } else if (dataType === 'svrs') {
            csv = 'ID,Brend,Filial,Nomi,Holat,Yaratilgan\n';
            data.forEach(item => {
                csv += `${item.id},"${item.brand_name || ''}","${item.filial_name || ''}","${item.name || ''}",${item.status || 'active'},"${item.created_at || ''}"\n`;
            });
        }
        
        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${dataType}_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast('Export muvaffaqiyatli', 'success');
    } catch (error) {
        console.error('Error exporting data:', error);
        showToast('Export qilishda xatolik', 'error');
    }
}

/**
 * Modalni yopish
 */
window.closeDataViewerModal = function() {
    const modal = document.getElementById('data-viewer-modal');
    if (modal) {
        modal.remove();
    }
};

/**
 * Date formatlash
 */
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('uz-UZ');
}

/**
 * HTML escape
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Global functions
window.showDataViewerModal = showDataViewerModal;
window.exportData = exportData;

