// Table Module
// Jadval qurish, hisob-kitoblar va ma'lumotlarni yangilash

import { DOM } from './dom.js';
import { state } from './state.js';
import { formatNumber, parseNumber } from './utils.js';

export async function buildTable() {
    const { columns = [] } = state.settings?.app_settings || {};
    
    if (!DOM.tableHead || !DOM.tableBody || !DOM.tableFoot) {
        console.error('❌ DOM elementlari topilmadi!');
        return;
    }
    
    // Tanlangan filialga qarab brendlarni yuklash
    let brands = [];
    try {
        const selectedLocation = DOM.locationSelect?.value;
        
        let url = '/api/brands';
        if (selectedLocation) {
            url += `?location=${encodeURIComponent(selectedLocation)}`;
        }
        
        const res = await fetch(url);
        if (res.ok) {
            brands = await res.json();
        } else {
            console.error('❌ Brendlar yuklanmadi, status:', res.status);
        }
    } catch (error) {
        console.error('❌ Brendlarni yuklash xatosi:', error);
    }
    
    if (columns.length === 0) {
        DOM.tableBody.innerHTML = '<tr><td colspan="100%"><div class="empty-state">Jadval sozlanmagan. Administrator panelidan ustunlarni qo\'shing.</div></td></tr>';
        DOM.tableHead.innerHTML = ''; 
        DOM.tableFoot.innerHTML = ''; 
        return;
    }
    
    if (brands.length === 0) {
        const selectedLocation = DOM.locationSelect?.value;
        const message = selectedLocation 
            ? `${selectedLocation} fililiga tegishli brendlar topilmadi. Administrator panelidan brendlarni qo'shing.`
            : 'Brendlar topilmadi. Administrator panelidan brendlarni qo\'shing.';
        DOM.tableBody.innerHTML = `<tr><td colspan="100%"><div class="empty-state">${message}</div></td></tr>`;
        DOM.tableHead.innerHTML = ''; 
        DOM.tableFoot.innerHTML = ''; 
        return;
    }

    // Ranglar ro'yxati (takrorlanmas, pastel va ko'zga yoqimli)
    const autoColors = [
        '#4facfe', '#43e97b', '#fa709a', '#f7971e', '#30cfd0', '#667eea', '#f857a6', '#76b852', '#e100ff', '#f7971e',
        '#11998e', '#ee0979', '#ff6a00', '#00c3ff', '#f953c6', '#43cea2', '#ffb347', '#ff5f6d', '#36d1c4', '#f7797d'
    ];
    let colorIdx = 0;
    const usedColors = new Set();

    DOM.tableHead.innerHTML = `<tr><th>Brend</th>${columns.map(c => `<th>${c}</th>`).join('')}<th>Jami</th></tr>`;
    
    DOM.tableBody.innerHTML = brands.map((brand, idx) => {
        // Rang tanlanmagan bo'lsa, avtomatik va takrorlanmas rang beriladi
        let color = brand.color && brand.color !== '#4facfe' ? brand.color : null;
        if (!color) {
            // Takrorlanmas rang tanlash
            while (usedColors.has(autoColors[colorIdx % autoColors.length])) colorIdx++;
            color = autoColors[colorIdx % autoColors.length];
            usedColors.add(color);
            colorIdx++;
        }
        
        return `
        <tr>
            <td data-label="Brend" style="color: ${color}; font-weight: 600;">${brand.name}</td>
            ${columns.map(colName => `<td data-label="${colName}"><input type="text" class="form-control numeric-input" data-key="${brand.id}_${colName}" placeholder="0"></td>`).join('')}
            <td data-label="Jami" class="row-total">0</td>
        </tr>`;
    }).join('');
    
    DOM.tableFoot.innerHTML = `<tr><td>Jami</td>${columns.map(c => `<td class="col-total" data-col="${c}">0</td>`).join('')}<td id="grand-total">0</td></tr>`;
    
    // Event listener'larni qo'shish
    setupTableEventListeners();
}

function setupTableEventListeners() {
    if (!DOM.tableBody) return;
    
    // Input o'zgarganda hisob-kitoblarni yangilash
    DOM.tableBody.addEventListener('input', (e) => {
        if (e.target.classList.contains('numeric-input')) {
            // Format qilish
            const value = parseNumber(e.target.value);
            e.target.value = value > 0 ? formatNumber(value) : '';
            updateCalculations();
        }
    });
}

export function updateTableValues(reportData = {}) {
    if (!DOM.tableBody) return;
    
    const allInputs = DOM.tableBody.querySelectorAll('.numeric-input');
    
    allInputs.forEach((input) => {
        const key = input.dataset.key;
        const value = reportData[key];
        
        // value 0 bo'lsa ham to'ldirish kerak
        if (value !== undefined && value !== null) {
            input.value = formatNumber(value);
        } else {
            input.value = '';
        }
    });
    
    updateCalculations();
}

export function updateCalculations() {
    let grandTotal = 0;
    const columns = state.settings?.app_settings?.columns || [];
    const columnTotals = columns.reduce((acc, col) => ({ ...acc, [col]: 0 }), {});

    if (DOM.tableBody) DOM.tableBody.querySelectorAll('tr').forEach(row => {
        let rowTotal = 0;
        row.querySelectorAll('.numeric-input').forEach(input => {
            const value = parseNumber(input.value);
            rowTotal += value;
            const colName = input.parentElement.dataset.label;
            if (columnTotals.hasOwnProperty(colName)) {
                columnTotals[colName] += value;
            }
        });
        const rowTotalCell = row.querySelector('.row-total');
        if (rowTotalCell) rowTotalCell.textContent = formatNumber(rowTotal);
        grandTotal += rowTotal;
    });

    if (DOM.tableFoot) {
        DOM.tableFoot.querySelectorAll('.col-total').forEach(cell => {
            cell.textContent = formatNumber(columnTotals[cell.dataset.col]);
        });
        const grandTotalCell = document.getElementById('grand-total');
        if (grandTotalCell) grandTotalCell.textContent = formatNumber(grandTotal);
    }
    renderSummary();
}

function renderSummary() {
    const summaryList = document.getElementById('summary-list');
    const summaryWrapper = document.getElementById('summary-wrapper');
    const summaryTotal = document.getElementById('summary-total');
    
    if (!summaryList || !summaryWrapper || !summaryTotal) return;
    
    summaryList.innerHTML = '';
    let hasData = false;
    
    if (DOM.tableBody) DOM.tableBody.querySelectorAll('tr').forEach(row => {
        const rowName = row.cells[0]?.textContent;
        const rowTotal = parseNumber(row.querySelector('.row-total')?.textContent);
        if (rowTotal > 0) {
            hasData = true;
            summaryList.innerHTML += `<div class="summary-item"><span>${rowName}</span><span>${formatNumber(rowTotal)} so'm</span></div>`;
        }
    });
    
    const grandTotalText = document.getElementById('grand-total')?.textContent;
    if (hasData) {
        summaryTotal.textContent = `Umumiy summa: ${grandTotalText} so'm`;
        summaryWrapper.classList.remove('hidden');
    } else {
        summaryWrapper.classList.add('hidden');
    }
}

