// public/modules/excel-import.js
// Excel import moduli - admin uchun

import { safeFetch } from './api.js';
import { showToast } from './utils.js';

const API_URL = '/api/debt-approval/excel-import';

let currentData = null;
let currentHeaders = null;
let currentDetectedColumns = null;

/**
 * Excel import modalini ko'rsatish
 */
export function showExcelImportModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'excel-import-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px;">
            <div class="modal-header">
                <h2>📊 Excel Import</h2>
                <button class="modal-close" onclick="closeExcelImportModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="excel-import-section">
                    <h3>1. Excel fayl yuklash</h3>
                    <div class="file-upload-area" id="excel-upload-area">
                        <input type="file" id="excel-file-input" accept=".xlsx,.xls" style="display: none;">
                        <div class="upload-dropzone" id="excel-dropzone">
                            <p>📎 Excel faylni bu yerga tashlang yoki <button class="btn-link" onclick="document.getElementById('excel-file-input').click()">yuklab oling</button></p>
                            <p class="text-muted">Qo'llab-quvvatlanadigan formatlar: .xlsx, .xls</p>
                        </div>
                    </div>
                </div>
                
                <div class="excel-import-section" id="excel-preview-section" style="display: none;">
                    <h3>2. Ma'lumotlarni ko'rish</h3>
                    <div class="excel-preview-container">
                        <div id="excel-preview-table"></div>
                    </div>
                    <div class="excel-actions">
                        <button class="btn btn-secondary" onclick="clearExcelData()">🗑️ Ma'lumotlarni tozalash</button>
                        <button class="btn btn-primary" onclick="importExcelData()">✅ Import qilish</button>
                    </div>
                </div>
                
                <div class="excel-import-section" id="excel-column-mapping-section" style="display: none;">
                    <h3>3. Ustunlarni tanlash</h3>
                    <div id="excel-column-mapping"></div>
                    <div class="excel-actions">
                        <button class="btn btn-primary" onclick="confirmColumnMapping()">✅ Tasdiqlash</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listener'lar
    setupExcelImportEvents();
}

/**
 * Excel import event listener'larni sozlash
 */
function setupExcelImportEvents() {
    const fileInput = document.getElementById('excel-file-input');
    const dropzone = document.getElementById('excel-dropzone');
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleExcelFile(e.target.files[0]);
        }
    });
    
    // Drag and drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        
        if (e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                handleExcelFile(file);
            } else {
                showToast('Faqat Excel fayllar qabul qilinadi (.xlsx, .xls)', 'error');
            }
        }
    });
}

/**
 * Excel faylni qayta ishlash
 */
async function handleExcelFile(file) {
    try {
        showToast('Excel fayl yuklanmoqda...', 'info');
        
        const formData = new FormData();
        formData.append('excel', file);
        
        const res = await safeFetch(API_URL + '/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            showToast(error.message || 'Excel faylni yuklashda xatolik', 'error');
            return;
        }
        
        const result = await res.json();
        
        if (!result.success) {
            showToast(result.message || 'Excel faylni qayta ishlashda xatolik', 'error');
            return;
        }
        
        currentData = result.data;
        currentHeaders = result.headers;
        currentDetectedColumns = result.detectedColumns;
        
        // Preview ko'rsatish
        showExcelPreview(result.data, result.headers, result.detectedColumns);
        
        showToast('Excel fayl muvaffaqiyatli yuklandi', 'success');
    } catch (error) {
        console.error('Error handling Excel file:', error);
        showToast('Excel faylni qayta ishlashda xatolik', 'error');
    }
}

/**
 * Excel preview ko'rsatish
 */
function showExcelPreview(data, headers, detectedColumns) {
    const previewSection = document.getElementById('excel-preview-section');
    const previewTable = document.getElementById('excel-preview-table');
    
    // Agar kerakli ustunlar topilmasa, ustun tanlash ko'rsatish
    if (detectedColumns.brand === null || detectedColumns.branch === null || detectedColumns.svr === null) {
        showColumnMapping(headers, detectedColumns);
        return;
    }
    
    // Preview jadval yaratish
    let tableHTML = '<table class="excel-preview-table"><thead><tr>';
    headers.forEach(header => {
        tableHTML += `<th>${escapeHtml(header || '')}</th>`;
    });
    tableHTML += '</tr></thead><tbody>';
    
    // Faqat birinchi 50 qatorni ko'rsatish
    const rowsToShow = data.slice(0, 50);
    rowsToShow.forEach(row => {
        tableHTML += '<tr>';
        headers.forEach(header => {
            const value = row[header] !== undefined ? row[header] : '';
            tableHTML += `<td>${escapeHtml(String(value))}</td>`;
        });
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';
    
    if (data.length > 50) {
        tableHTML += `<p class="text-muted">... va yana ${data.length - 50} ta qator</p>`;
    }
    
    tableHTML += `<p class="text-info">Jami: ${data.length} ta qator</p>`;
    
    previewTable.innerHTML = tableHTML;
    previewSection.style.display = 'block';
}

/**
 * Ustun tanlash ko'rsatish
 */
function showColumnMapping(headers, detectedColumns) {
    const mappingSection = document.getElementById('excel-column-mapping-section');
    const mappingContainer = document.getElementById('excel-column-mapping');
    
    let mappingHTML = '<div class="column-mapping-form">';
    
    // Brend ustuni
    mappingHTML += '<div class="form-group">';
    mappingHTML += '<label>Brend ustuni:</label>';
    mappingHTML += '<select id="column-brand" class="form-control">';
    mappingHTML += '<option value="">Tanlang...</option>';
    headers.forEach((header, index) => {
        const selected = detectedColumns.brand === index ? 'selected' : '';
        mappingHTML += `<option value="${index}" ${selected}>${escapeHtml(header || '')}</option>`;
    });
    mappingHTML += '</select>';
    mappingHTML += '</div>';
    
    // Filial ustuni
    mappingHTML += '<div class="form-group">';
    mappingHTML += '<label>Filial ustuni:</label>';
    mappingHTML += '<select id="column-branch" class="form-control">';
    mappingHTML += '<option value="">Tanlang...</option>';
    headers.forEach((header, index) => {
        const selected = detectedColumns.branch === index ? 'selected' : '';
        mappingHTML += `<option value="${index}" ${selected}>${escapeHtml(header || '')}</option>`;
    });
    mappingHTML += '</select>';
    mappingHTML += '</div>';
    
    // SVR ustuni
    mappingHTML += '<div class="form-group">';
    mappingHTML += '<label>SVR FISH ustuni:</label>';
    mappingHTML += '<select id="column-svr" class="form-control">';
    mappingHTML += '<option value="">Tanlang...</option>';
    headers.forEach((header, index) => {
        const selected = detectedColumns.svr === index ? 'selected' : '';
        mappingHTML += `<option value="${index}" ${selected}>${escapeHtml(header || '')}</option>`;
    });
    mappingHTML += '</select>';
    mappingHTML += '</div>';
    
    mappingHTML += '</div>';
    
    mappingContainer.innerHTML = mappingHTML;
    mappingSection.style.display = 'block';
}

/**
 * Ustun mapping'ni tasdiqlash
 */
async function confirmColumnMapping() {
    const brandColumn = document.getElementById('column-brand').value;
    const branchColumn = document.getElementById('column-branch').value;
    const svrColumn = document.getElementById('column-svr').value;
    
    if (!brandColumn || !branchColumn || !svrColumn) {
        showToast('Barcha kerakli ustunlarni tanlang', 'error');
        return;
    }
    
    currentDetectedColumns = {
        brand: parseInt(brandColumn),
        branch: parseInt(branchColumn),
        svr: parseInt(svrColumn),
        id: null,
        name: null,
        summa: null
    };
    
    // Preview ko'rsatish
    showExcelPreview(currentData, currentHeaders, currentDetectedColumns);
    
    // Mapping section'ni yashirish
    document.getElementById('excel-column-mapping-section').style.display = 'none';
}

/**
 * Excel ma'lumotlarini import qilish
 */
async function importExcelData() {
    try {
        if (!currentData || currentData.length === 0) {
            showToast('Import qilish uchun ma\'lumotlar yo\'q', 'error');
            return;
        }
        
        const clearExisting = confirm('Mavjud ma\'lumotlarni tozalashni xohlaysizmi?');
        
        showToast('Import qilinmoqda...', 'info');
        
        // Column mapping yaratish
        const columnMapping = {
            brand: currentHeaders[currentDetectedColumns.brand],
            branch: currentHeaders[currentDetectedColumns.branch],
            svr: currentHeaders[currentDetectedColumns.svr]
        };
        
        const res = await safeFetch(API_URL + '/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: currentData,
                clearExisting: clearExisting,
                columnMapping: columnMapping
            })
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            showToast(error.message || 'Import qilishda xatolik', 'error');
            return;
        }
        
        const result = await res.json();
        
        if (result.success) {
            showToast(`Muvaffaqiyatli import qilindi: ${result.imported} ta, o'tkazib yuborilgan: ${result.skipped} ta`, 'success');
            closeExcelImportModal();
            
            // Sahifani yangilash
            if (window.loadDebtApprovalPage) {
                await window.loadDebtApprovalPage();
            }
        } else {
            showToast(result.message || 'Import qilishda xatolik', 'error');
        }
    } catch (error) {
        console.error('Error importing Excel data:', error);
        showToast('Import qilishda xatolik', 'error');
    }
}

/**
 * Excel ma'lumotlarini tozalash
 */
async function clearExcelData() {
    if (!confirm('Haqiqatan ham barcha ma\'lumotlarni tozalashni xohlaysizmi?')) {
        return;
    }
    
    try {
        const res = await safeFetch(API_URL + '/clear', {
            method: 'POST'
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            showToast(error.message || 'Tozalashda xatolik', 'error');
            return;
        }
        
        const result = await res.json();
        
        if (result.success) {
            showToast('Ma\'lumotlar tozalandi', 'success');
            currentData = null;
            currentHeaders = null;
            currentDetectedColumns = null;
            
            document.getElementById('excel-preview-section').style.display = 'none';
            document.getElementById('excel-column-mapping-section').style.display = 'none';
        }
    } catch (error) {
        console.error('Error clearing Excel data:', error);
        showToast('Tozalashda xatolik', 'error');
    }
}

/**
 * Modalni yopish
 */
window.closeExcelImportModal = function() {
    const modal = document.getElementById('excel-import-modal');
    if (modal) {
        modal.remove();
    }
    currentData = null;
    currentHeaders = null;
    currentDetectedColumns = null;
};

/**
 * HTML escape
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

