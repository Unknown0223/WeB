// KPI Module
// Xodimlar statistikasi va KPI hisobotlari

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast } from './utils.js';

let kpiInitialized = false;

// Raqamlarni 3 xonali formatga o'tkazish (bo'sh joy bilan)
function formatNumber(value) {
    if (!value || value === '-') return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Ism va familiyaning birinchi harflarini olish (faqat birinchi 2 ta so'z)
function getInitials(fullname) {
    if (!fullname) return '??';
    const words = fullname.trim().split(/\s+/);
    if (words.length === 0) return '??';
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    
    // Faqat birinchi va ikkinchi so'zning birinchi harflarini olish
    const firstLetter = words[0].charAt(0).toUpperCase();
    const secondLetter = words[1].charAt(0).toUpperCase();
    return firstLetter + secondLetter;
}

// Tahrirlangan sonini formatlash
function formatEditedCount(value) {
    if (value === null || value === undefined) return 0;
    
    // Agar string bo'lsa, faqat raqamlarni olish
    let num = 0;
    if (typeof value === 'string') {
        // Faqat raqamlarni olish (boshqa belgilar olib tashlanadi)
        const numStr = value.toString().replace(/[^0-9]/g, '');
        num = parseInt(numStr) || 0;
    } else if (typeof value === 'number') {
        num = Math.floor(value) || 0;
    } else {
        num = parseInt(value) || 0;
    }
    
    // Faqat musbat raqamlarni qaytaramiz
    if (num < 0) {
        num = 0;
    }
    
    return num;
}

export function setupKpiPage() {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    state.kpi.selectedMonth = `${year}-${month}`;

    // Event listeners faqat bir marta qo'shish
    if (!kpiInitialized) {
        setupKpiFilters();
        setupModernMonthSelector();
        kpiInitialized = true;
    }
    
    updateMonthDisplay();
    loadSimpleKpiData();
}

// Realtime yangilanish uchun funksiya
export function refreshKpiData() {
    console.log('🔄 [KPI] KPI ma\'lumotlari yangilanmoqda...');
    loadSimpleKpiData();
}

// Zamonaviy oy tanlash funksiyalari
function setupModernMonthSelector() {
    const monthDisplayBtn = document.getElementById('month-display-btn');
    const monthDropdown = document.getElementById('month-dropdown');
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');
    const prevYearBtn = document.getElementById('prev-year-btn');
    const nextYearBtn = document.getElementById('next-year-btn');
    const monthsGrid = document.getElementById('months-grid');
    
    // Oylar ro'yxati
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
    let currentYear = new Date().getFullYear();
    let currentMonth = new Date().getMonth();
    
    // Dropdown ni ko'rsatish/yashirish
    monthDisplayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        monthDropdown.classList.toggle('hidden');
        if (!monthDropdown.classList.contains('hidden')) {
            renderMonthsGrid();
            feather.replace();
        }
    });
    
    // Tashqariga bosilganda yopish
    document.addEventListener('click', (e) => {
        if (!monthDropdown.contains(e.target) && !monthDisplayBtn.contains(e.target)) {
            monthDropdown.classList.add('hidden');
        }
    });
    
    // Oldingi oy
    prevMonthBtn.addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        updateSelectedMonth();
    });
    
    // Keyingi oy
    nextMonthBtn.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        updateSelectedMonth();
    });
    
    // Oldingi yil
    prevYearBtn.addEventListener('click', () => {
        currentYear--;
        document.getElementById('dropdown-year').textContent = currentYear;
        renderMonthsGrid();
    });
    
    // Keyingi yil
    nextYearBtn.addEventListener('click', () => {
        currentYear++;
        document.getElementById('dropdown-year').textContent = currentYear;
        renderMonthsGrid();
    });
    
    // Oylar gridini render qilish
    function renderMonthsGrid() {
        const [selectedYear, selectedMonth] = state.kpi.selectedMonth.split('-');
        monthsGrid.innerHTML = months.map((monthName, index) => {
            const isSelected = currentYear === parseInt(selectedYear) && index === parseInt(selectedMonth) - 1;
            return `
                <div class="month-item ${isSelected ? 'selected' : ''}" data-month="${index}">
                    ${monthName}
                </div>
            `;
        }).join('');
        
        // Oy tanlash
        monthsGrid.querySelectorAll('.month-item').forEach(item => {
            item.addEventListener('click', () => {
                currentMonth = parseInt(item.dataset.month);
                updateSelectedMonth();
                monthDropdown.classList.add('hidden');
            });
        });
    }
    
    // Tanlangan oyni yangilash
    function updateSelectedMonth() {
        const monthStr = (currentMonth + 1).toString().padStart(2, '0');
        state.kpi.selectedMonth = `${currentYear}-${monthStr}`;
        updateMonthDisplay();
        loadSimpleKpiData();
    }
    
    // Dastlabki qiymatlar
    const [initialYear, initialMonth] = state.kpi.selectedMonth.split('-');
    currentYear = parseInt(initialYear);
    currentMonth = parseInt(initialMonth) - 1;
}

// Oy displeyini yangilash
function updateMonthDisplay() {
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
    const [year, month] = state.kpi.selectedMonth.split('-');
    const monthName = months[parseInt(month) - 1];
    
    const currentMonthText = document.getElementById('current-month-text');
    const dropdownYear = document.getElementById('dropdown-year');
    
    if (currentMonthText) {
        currentMonthText.textContent = `${monthName} ${year}`;
    }
    if (dropdownYear) {
        dropdownYear.textContent = year;
    }
}

// Qidiruv va filtrlash
function setupKpiFilters() {
    const searchInput = document.getElementById('kpi-search');
    
    if (searchInput) {
        searchInput.addEventListener('input', () => filterKpiTable());
    }
}

// Ma'lumot yuklash
async function loadSimpleKpiData() {
    
    if (!state.kpi.selectedMonth) {
        // console.error('❌ Oy tanlanmagan!');
        return;
    }
    
    DOM.kpiTableBody.innerHTML = `<tr><td colspan="8">Yuklanmoqda...</td></tr>`;
    
    try {
        // Sozlamalardan filtrlarni olish (endpoint o'zi sozlamalardan oladi)
        const url = `/api/statistics/employees?month=${state.kpi.selectedMonth}`;
        // console.log('🌐 API URL:', url);
        
        const res = await safeFetch(url);
        // console.log('📥 Response:', res);
        
        if (!res || !res.ok) throw new Error('Ma\'lumot yuklanmadi');
        
        const data = await res.json();
        // console.log('✅ QADAM 3: Ma\'lumot olindi:', data);
        
        state.kpi.data = data;
        renderSimpleTable(data);
        
    } catch (error) {
        DOM.kpiTableBody.innerHTML = `<tr><td colspan="8" style="color: red;">Xatolik: ${error.message}</td></tr>`;
    }
}

// QADAM 3: Statistika kartalari - zamonaviy dizayn
function renderStatsCards(data) {
    const statsDiv = document.getElementById('kpi-stats-cards');
    if (!statsDiv || !data || data.length === 0) return;
    
    const totalEmployees = data.length;
    const totalReports = data.reduce((sum, emp) => sum + emp.totalSubmitted, 0);
    const avgScore = data.reduce((sum, emp) => sum + emp.kpiScore, 0) / totalEmployees;
    
    statsDiv.innerHTML = `
        <div class="kpi-stat-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <div class="stat-icon" style="background: rgba(255,255,255,0.2); width: 45px; height: 45px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 10px;">
                👥
            </div>
            <div class="stat-label" style="font-size: 13px; opacity: 0.9; margin-bottom: 5px;">Jami Xodimlar</div>
            <div class="stat-value" style="font-size: 28px; font-weight: 700; line-height: 1;">${totalEmployees}</div>
            <div class="stat-trend" style="font-size: 11px; opacity: 0.8; margin-top: 5px;">
                📊 Aktiv xodimlar
            </div>
        </div>
        <div class="kpi-stat-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
            <div class="stat-icon" style="background: rgba(255,255,255,0.2); width: 45px; height: 45px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 10px;">
                📝
            </div>
            <div class="stat-label" style="font-size: 13px; opacity: 0.9; margin-bottom: 5px;">Jami Hisobotlar</div>
            <div class="stat-value" style="font-size: 28px; font-weight: 700; line-height: 1;">${totalReports}</div>
            <div class="stat-trend" style="font-size: 11px; opacity: 0.8; margin-top: 5px;">
                ✅ Topshirilgan
            </div>
        </div>
        <div class="kpi-stat-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
            <div class="stat-icon" style="background: rgba(255,255,255,0.2); width: 45px; height: 45px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 10px;">
                📈
            </div>
            <div class="stat-label" style="font-size: 13px; opacity: 0.9; margin-bottom: 5px;">O'rtacha KPI</div>
            <div class="stat-value" style="font-size: 28px; font-weight: 700; line-height: 1;">${avgScore.toFixed(1)}%</div>
            <div class="stat-trend" style="font-size: 11px; opacity: 0.8; margin-top: 5px;">
                ${avgScore >= 80 ? '🎯 Yaxshi natija' : avgScore >= 60 ? '⚡ O\'rta daraja' : '📉 Yaxshilash kerak'}
            </div>
        </div>
    `;
}

// Jadval render
function renderSimpleTable(data) {
    
    if (!data || data.length === 0) {
        DOM.kpiTableBody.innerHTML = `<tr><td colspan="8">Ma\'lumot yo\'q</td></tr>`;
        return;
    }
    
    // KPI ball bo'yicha sort qilish (eng yuqoridan pastga)
    const sortedData = [...data].sort((a, b) => {
        // Avval KPI ball bo'yicha
        if (b.kpiScore !== a.kpiScore) {
            return b.kpiScore - a.kpiScore;
        }
        // Agar KPI ball teng bo'lsa, o'z vaqtida topshirilganlar soni bo'yicha
        if (b.onTimeCount !== a.onTimeCount) {
            return b.onTimeCount - a.onTimeCount;
        }
        // Agar ular ham teng bo'lsa, jami topshirilganlar soni bo'yicha
        return b.totalSubmitted - a.totalSubmitted;
    });
    
    // Statistika kartalarini render qilish
    renderStatsCards(sortedData);
    
    // Filiallar filtrini populate qilish
    populateKpiLocationFilter(sortedData);
    
    // Jadval render - zamonaviy dizayn
    DOM.kpiTableBody.innerHTML = sortedData.map((emp, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
        
        // Filiallar ko'rsatish - 2 tadan ortiq bo'lsa, faqat son ko'rsatish
        const locations = emp.locations && emp.locations.length > 0 ? emp.locations : [];
        let locationsDisplay = '';
        
        if (locations.length === 0) {
            locationsDisplay = '<span style="background: rgba(79, 172, 254, 0.1); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #4facfe;">-</span>';
        } else if (locations.length <= 2) {
            // 2 tadan kam yoki teng bo'lsa, barchasini ko'rsatish
            locationsDisplay = `<span style="background: rgba(79, 172, 254, 0.1); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #4facfe;">${locations.join(', ')}</span>`;
        } else {
            // 2 tadan ortiq bo'lsa, faqat son ko'rsatish (bosilganda modal ochiladi)
            locationsDisplay = `
                <span class="kpi-items-count-badge" 
                      data-type="locations" 
                      data-items='${JSON.stringify(locations)}'
                      data-title="Filiallar"
                      style="background: rgba(79, 172, 254, 0.2); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #4facfe; cursor: pointer; transition: all 0.2s; display: inline-block;"
                      onmouseover="this.style.background='rgba(79, 172, 254, 0.3)'; this.style.transform='scale(1.05)'"
                      onmouseout="this.style.background='rgba(79, 172, 254, 0.2)'; this.style.transform='scale(1)'"
                      title="Barcha filiallarni ko'rish uchun bosing">
                    ${locations.length} ta
                </span>
            `;
        }
        
        // Brendlar ko'rsatish (agar mavjud bo'lsa)
        const brands = emp.brands && emp.brands.length > 0 ? emp.brands : [];
        let brandsDisplay = '';
        
        if (brands.length > 0) {
            if (brands.length <= 2) {
                const brandNames = brands.map(b => typeof b === 'object' ? b.name : b).join(', ');
                brandsDisplay = `<span style="background: rgba(155, 89, 182, 0.1); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #9b59b6; margin-left: 6px;">${brandNames}</span>`;
            } else {
                brandsDisplay = `
                    <span class="kpi-items-count-badge" 
                          data-type="brands" 
                          data-items='${JSON.stringify(brands.map(b => typeof b === 'object' ? b.name : b))}'
                          data-title="Brendlar"
                          style="background: rgba(155, 89, 182, 0.2); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #9b59b6; cursor: pointer; transition: all 0.2s; display: inline-block; margin-left: 6px;"
                          onmouseover="this.style.background='rgba(155, 89, 182, 0.3)'; this.style.transform='scale(1.05)'"
                          onmouseout="this.style.background='rgba(155, 89, 182, 0.2)'; this.style.transform='scale(1)'"
                          title="Barcha brendlarni ko'rish uchun bosing">
                        ${brands.length} ta
                    </span>
                `;
            }
        }
        
        // KPI rangi
        let kpiColor = '#52c41a'; // yashil
        if (emp.kpiScore < 60) kpiColor = '#ff4d4f'; // qizil
        else if (emp.kpiScore < 80) kpiColor = '#faad14'; // sariq
        
        // Top 3 uchun maxsus stil
        const isTopThree = rank <= 3;
        const rowBg = isTopThree ? 'background: rgba(255, 215, 0, 0.05);' : '';
        
        return `
        <tr class="kpi-row" data-user-id="${emp.userId}" 
            style="cursor: pointer; transition: all 0.3s ease; ${rowBg} animation: fadeIn 0.5s ease-out ${index * 0.05}s both;">
            <td style="font-weight: bold; font-size: 14px; width: 50px; min-width: 50px; max-width: 50px; text-align: center; vertical-align: middle; padding: 8px 4px;">${medal} ${rank}</td>
            <td style="vertical-align: middle; padding: 8px 12px; min-width: 200px;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div style="width: 36px; height: 36px; min-width: 36px; min-height: 36px; max-width: 36px; max-height: 36px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; flex-shrink: 0; flex-grow: 0; overflow: hidden; box-sizing: border-box;">
                        ${getInitials(emp.fullname || emp.username)}
                    </div>
                    <span style="color: #4facfe; font-weight: 600; font-size: 15px; line-height: 1.4; word-wrap: break-word; flex: 1; min-width: 150px;">${emp.fullname || emp.username}</span>
                </div>
            </td>
            <td style="vertical-align: middle; padding: 8px 12px;">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 32px;">
                    ${locationsDisplay}${brandsDisplay}
                </div>
            </td>
            <td style="vertical-align: middle; padding: 8px 12px;">
                <div style="position: relative; display: inline-flex; align-items: center; gap: 8px;">
                    <span style="background: ${kpiColor}; padding: 8px 16px; border-radius: 20px; font-weight: bold; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: transform 0.2s;">
                        ${emp.kpiScore.toFixed(1)}%
                    </span>
                    ${emp.kpiScore >= 90 ? '<span style="font-size: 18px;">🔥</span>' : ''}
                </div>
            </td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span style="background: linear-gradient(135deg, #4facfe, #00f2fe); color: white; padding: 6px 12px; border-radius: 12px; font-weight: 600; font-size: 14px;">${emp.totalSubmitted || 0}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span style="color: #52c41a; font-weight: 600; font-size: 15px;">✓ ${emp.onTimeCount || 0}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span style="color: #ff4d4f; font-weight: 600; font-size: 15px;">⚠ ${emp.lateCount || 0}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span style="color: #faad14; font-weight: 600; font-size: 15px;">✎ ${formatEditedCount(emp.totalEdited)}</span></td>
        </tr>
    `;
    }).join('');
    
    // Qatorga bosilganda modal kalendar ochish - zamonaviy effektlar
    document.querySelectorAll('.kpi-row').forEach(row => {
        row.addEventListener('click', (e) => {
            // Agar count badge bosilgan bo'lsa, modal ochish
            if (e.target.closest('.kpi-items-count-badge')) {
                e.stopPropagation();
                return;
            }
            
            const userId = row.dataset.userId;
            const user = data.find(u => u.userId == userId);
            if (user) {
                showCalendar(userId, user.fullname || user.username);
                // Feather iconlarni yangilash
                setTimeout(() => {
                    if (typeof feather !== 'undefined') feather.replace();
                }, 100);
            }
        });
        
        row.addEventListener('mouseenter', () => {
            row.style.backgroundColor = 'rgba(79, 172, 254, 0.1)';
            row.style.transform = 'translateX(5px) scale(1.01)';
            row.style.boxShadow = '0 4px 20px rgba(79, 172, 254, 0.2)';
        });
        
        row.addEventListener('mouseleave', () => {
            row.style.backgroundColor = '';
            row.style.transform = '';
            row.style.boxShadow = '';
        });
    });
    
    // Count badge'larga bosilganda modal ochish
    document.querySelectorAll('.kpi-items-count-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const items = JSON.parse(badge.dataset.items || '[]');
            const title = badge.dataset.title || 'Ro\'yxat';
            showItemsModal(title, items);
        });
    });
}

// Kichik modal - filiallar yoki brendlar ro'yxatini ko'rsatish
function showItemsModal(title, items) {
    // Modal mavjudligini tekshirish yoki yaratish
    let modal = document.getElementById('kpi-items-modal');
    
    if (!modal) {
        // Modal yaratish
        modal = document.createElement('div');
        modal.id = 'kpi-items-modal';
        modal.className = 'modal hidden';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(5px);
        `;
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px; max-height: 80vh; background: linear-gradient(135deg, rgba(30, 30, 46, 0.98), rgba(20, 20, 35, 0.98)); border-radius: 16px; padding: 0; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); position: relative;">
                <div style="background: linear-gradient(135deg, #4facfe, #00f2fe); padding: 20px; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; color: white; font-size: 18px; font-weight: 600;">${title}</h3>
                    <button id="close-items-modal" style="background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" 
                            onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'"
                            onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
                        <i data-feather="x"></i>
                    </button>
                </div>
                <div id="items-modal-content" style="padding: 20px; max-height: calc(80vh - 80px); overflow-y: auto;">
                    <!-- Items will be inserted here -->
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Yopish funksiyalari
        const closeBtn = document.getElementById('close-items-modal');
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
        });
        
        // Feather iconlarni yangilash
        setTimeout(() => {
            if (typeof feather !== 'undefined') feather.replace();
        }, 100);
    }
    
    // Modal sarlavhasini yangilash
    const modalTitle = modal.querySelector('h3');
    const modalHeader = modal.querySelector('.modal-content > div:first-child');
    if (modalTitle) {
        modalTitle.textContent = title;
    }
    
    // Header rangini title'ga qarab o'zgartirish
    if (modalHeader) {
        const isBrands = title === 'Brendlar';
        modalHeader.style.background = isBrands 
            ? 'linear-gradient(135deg, #9b59b6, #8e44ad)' 
            : 'linear-gradient(135deg, #4facfe, #00f2fe)';
    }
    
    // Modal kontentini to'ldirish
    const content = document.getElementById('items-modal-content');
    if (items.length === 0) {
        content.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 40px;">Ro\'yxat bo\'sh</p>';
    } else {
        // Rangni title'ga qarab o'zgartirish
        const isBrands = title === 'Brendlar';
        const badgeColor = isBrands ? 'rgba(155, 89, 182, 0.1)' : 'rgba(79, 172, 254, 0.1)';
        const borderColor = isBrands ? 'rgba(155, 89, 182, 0.2)' : 'rgba(79, 172, 254, 0.2)';
        const hoverBg = isBrands ? 'rgba(155, 89, 182, 0.2)' : 'rgba(79, 172, 254, 0.2)';
        const hoverBorder = isBrands ? 'rgba(155, 89, 182, 0.4)' : 'rgba(79, 172, 254, 0.4)';
        const textColor = isBrands ? '#9b59b6' : '#4facfe';
        const gradientColor = isBrands ? 'linear-gradient(135deg, #9b59b6, #8e44ad)' : 'linear-gradient(135deg, #4facfe, #00f2fe)';
        
        content.innerHTML = items.map((item, index) => `
            <div style="
                background: ${badgeColor};
                border: 1px solid ${borderColor};
                border-radius: 10px;
                padding: 12px 16px;
                margin-bottom: ${index === items.length - 1 ? '0' : '10px'};
                display: flex;
                align-items: center;
                gap: 12px;
                transition: all 0.2s;
                animation: fadeIn 0.3s ease-out ${index * 0.05}s both;
            " 
            onmouseover="this.style.background='${hoverBg}'; this.style.borderColor='${hoverBorder}'; this.style.transform='translateX(5px)'"
            onmouseout="this.style.background='${badgeColor}'; this.style.borderColor='${borderColor}'; this.style.transform='translateX(0)'">
                <div style="
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: ${gradientColor};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 14px;
                    flex-shrink: 0;
                ">${index + 1}</div>
                <span style="color: ${textColor}; font-weight: 500; font-size: 15px;">${item}</span>
            </div>
        `).join('');
    }
    
    // Modalni ko'rsatish
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    
    // Feather iconlarni yangilash
    setTimeout(() => {
        if (typeof feather !== 'undefined') feather.replace();
    }, 100);
}

// QADAM 5: Modal kalendar ko'rsatish
async function showCalendar(userId, fullname) {
    const modal = document.getElementById('kpi-calendar-modal');
    const modalGrid = document.getElementById('modal-calendar-grid');
    const employeeName = document.getElementById('calendar-employee-name');
    const avatar = document.getElementById('calendar-avatar');
    const monthLabel = document.getElementById('calendar-month-label');
    const statsDiv = document.getElementById('calendar-stats');
    const closeBtn = document.getElementById('close-calendar-modal');
    
    if (!modal || !modalGrid) return;
    
    // Modal ochish
    modal.classList.remove('hidden');
    employeeName.textContent = fullname;
    avatar.textContent = getInitials(fullname);
    
    // Oy labelini o'rnatish
    const [year, month] = state.kpi.selectedMonth.split('-');
    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    monthLabel.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
    
    // Loading holatini ko'rsatish
    modalGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #4facfe;">Yuklanmoqda...</div>';
    statsDiv.innerHTML = '';
    
    // Kalendar ma'lumotlarini yuklash
    try {
        const response = await fetch(`/api/statistics/employee/${userId}?month=${year}-${month}`);
        
        if (!response.ok) {
            throw new Error('Kalendar ma\'lumotlari yuklanmadi');
        }
        
        const data = await response.json();
        
        // Statistikani hisoblash
        const onTimeCount = data.filter(d => d.status === 'on_time').length;
        const lateCount = data.filter(d => d.status === 'late').length;
        const totalEdits = data.filter(d => d.isEdited).length;
        const totalReports = data.filter(d => d.status !== 'not_submitted').length;
        
        // Statistika kartalarini render qilish
        statsDiv.innerHTML = `
            <div style="background: linear-gradient(135deg, #52c41a, #389e0d); padding: 15px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: bold;">${onTimeCount}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">✓ O'z vaqtida</div>
            </div>
            <div style="background: linear-gradient(135deg, #faad14, #d48806); padding: 15px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: bold;">${lateCount}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">⚠ Kechikkan</div>
            </div>
            <div style="background: linear-gradient(135deg, #1890ff, #096dd9); padding: 15px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: bold;">${totalEdits}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">✎ Tahrirlangan</div>
            </div>
            <div style="background: linear-gradient(135deg, #722ed1, #531dab); padding: 15px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: bold;">${totalReports}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">📊 Jami</div>
            </div>
        `;
        
        renderModalCalendar(data, year, month);
        
    } catch (error) {
        showToast('Kalendar yuklanmadi', 'error');
        modalGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ff4d4f;">Ma\'lumot yuklanmadi</div>';
    }
    
    // Modal yopish
    closeBtn.onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    };
}

// QADAM 6: Kalendar render - to'liq zamonaviy dizayn
function renderCalendar(data, year, month) {
    const calendarGrid = document.getElementById('calendar-grid');
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    
    // Haftaning kunlari
    const weekDays = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
    let html = weekDays.map(day => `
        <div class="calendar-day-header" style="
            font-weight: 600; 
            text-align: center; 
            padding: 15px 10px; 
            background: linear-gradient(135deg, rgba(79, 172, 254, 0.15), rgba(0, 242, 254, 0.15));
            border-radius: 8px;
            font-size: 13px;
            color: #4facfe;
            text-transform: uppercase;
            letter-spacing: 0.5px;">
            ${day}
        </div>
    `).join('');
    
    // Bo'sh kunlar
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) {
        html += '<div class="calendar-day empty" style="padding: 15px; background: rgba(255,255,255,0.01); border-radius: 8px;"></div>';
    }
    
    // Kunlar - rangli va interaktiv
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayData = data.find(d => d.date === dateStr);
        
        let bgColor = 'rgba(255,255,255,0.03)';
        let borderColor = 'rgba(255,255,255,0.1)';
        let statusIcon = '';
        let statusText = '';
        let statusColor = '#666';
        let tooltip = '';
        
        if (dayData) {
            if (dayData.status === 'on_time') {
                bgColor = 'linear-gradient(135deg, rgba(82, 196, 26, 0.25), rgba(82, 196, 26, 0.15))';
                borderColor = '#52c41a';
                statusIcon = '✓';
                statusText = "O'z vaqtida";
                statusColor = '#52c41a';
                tooltip = 'Hisobot o\'z vaqtida topshirilgan';
            } else if (dayData.status === 'late') {
                bgColor = 'linear-gradient(135deg, rgba(250, 173, 20, 0.25), rgba(250, 173, 20, 0.15))';
                borderColor = '#faad14';
                statusIcon = '⚠';
                statusText = 'Kechikkan';
                statusColor = '#faad14';
                tooltip = 'Hisobot kechikkan';
            }
            
            if (dayData.editCount > 0) {
                tooltip += ` | ${dayData.editCount} marta tahrirlangan`;
            }
        }
        
        const editBadge = dayData && dayData.editCount > 0 
            ? `<div style="
                position: absolute; 
                top: 8px; 
                right: 8px; 
                background: linear-gradient(135deg, #1890ff, #0050b3);
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 10px;
                font-weight: bold;
                box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
            ">✎ ${dayData.editCount}</div>` 
            : '';
        
        html += `
        <div class="calendar-day ${dayData ? 'has-data' : ''}" 
             data-date="${dateStr}"
             title="${tooltip}"
             style="
                position: relative;
                padding: 16px;
                background: ${bgColor};
                border-radius: 12px;
                min-height: 100px;
                border: 2px solid ${borderColor};
                transition: all 0.3s ease;
                cursor: ${dayData ? 'pointer' : 'default'};
                animation: fadeIn 0.4s ease-out ${day * 0.02}s both;
            "
            onmouseenter="this.style.transform='translateY(-5px) scale(1.05)'; this.style.boxShadow='0 8px 24px ${borderColor}40';"
            onmouseleave="this.style.transform=''; this.style.boxShadow='';">
            
            ${editBadge}
            
            <div style="font-weight: bold; font-size: 20px; margin-bottom: 12px; color: #fff;">${day}</div>
            
            ${dayData ? `
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: rgba(0, 0, 0, 0.2);
                    padding: 8px 10px;
                    border-radius: 8px;
                    margin-bottom: 6px;
                ">
                    <span style="font-size: 16px;">${statusIcon}</span>
                    <span style="font-size: 12px; color: ${statusColor}; font-weight: 600;">${statusText}</span>
                </div>
            ` : `
                <div style="
                    text-align: center;
                    padding: 20px 0;
                    color: rgba(255,255,255,0.3);
                    font-size: 12px;
                ">Ma'lumot yo'q</div>
            `}
        </div>`;
    }
    
    calendarGrid.innerHTML = html;
    
    // Hover tooltiplar uchun event listener
    document.querySelectorAll('.calendar-day.has-data').forEach(day => {
        day.addEventListener('click', (e) => {
            const date = e.currentTarget.dataset.date;
            // Kelajakda batafsil ma'lumot ko'rsatish mumkin
        });
    });
}

// Modal kalendar render - ixcham va zamonaviy
function renderModalCalendar(data, year, month) {
    const modalGrid = document.getElementById('modal-calendar-grid');
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    
    let html = '';
    
    // Bo'sh kunlar
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) {
        html += '<div style="background: rgba(255,255,255,0.02); border-radius: 8px; min-height: 70px;"></div>';
    }
    
    // Kunlar - ixcham dizayn, har bir status uchun alohida rang
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayData = data.find(d => d.date === dateStr);
        
        let bgColor = 'rgba(255,255,255,0.03)';
        let borderColor = 'rgba(255,255,255,0.1)';
        let statusIcon = '';
        let statusColor = '#666';
        let statusText = '';
        let hoverEffect = '';
        
        if (dayData && dayData.status !== 'not_submitted') {
            hoverEffect = 'cursor: pointer; transition: all 0.3s ease;';
            
            // Kombinatsiyalangan statuslar - aniq ranglar
            if (dayData.status === 'on_time' && dayData.isEdited) {
                // O'z vaqtida + Tahrirlangan - yashil-sariq gradient
                bgColor = 'linear-gradient(135deg, rgba(82, 196, 26, 0.4) 0%, rgba(250, 173, 20, 0.4) 100%)';
                borderColor = '#52c41a';
                statusIcon = '✓✎';
                statusColor = '#52c41a';
                statusText = 'VAQTIDA + TAHRIR';
            } else if (dayData.status === 'late' && dayData.isEdited) {
                // Kechikkan + Tahrirlangan - qizil-sariq gradient
                bgColor = 'linear-gradient(135deg, rgba(255, 77, 79, 0.4) 0%, rgba(250, 173, 20, 0.4) 100%)';
                borderColor = '#ff4d4f';
                statusIcon = '⚠✎';
                statusColor = '#ff4d4f';
                statusText = 'KECH + TAHRIR';
            } else if (dayData.status === 'on_time') {
                // Faqat o'z vaqtida - yashil
                bgColor = 'rgba(82, 196, 26, 0.4)';
                borderColor = '#52c41a';
                statusIcon = '✓';
                statusColor = '#52c41a';
                statusText = 'VAQTIDA';
            } else if (dayData.status === 'late') {
                // Faqat kechikkan - qizil
                bgColor = 'rgba(255, 77, 79, 0.4)';
                borderColor = '#ff4d4f';
                statusIcon = '⚠';
                statusColor = '#ff4d4f';
                statusText = 'KECHIKKAN';
            }
        }
        
        const editBadge = dayData && dayData.isEdited 
            ? `<span style="position: absolute; top: 5px; right: 5px; background: #faad14; color: white; padding: 3px 7px; border-radius: 8px; font-size: 10px; font-weight: bold; box-shadow: 0 2px 6px rgba(250, 173, 20, 0.4);">✎</span>` 
            : '';
        
        const hasReport = dayData && dayData.status !== 'not_submitted';
        
        html += `
        <div class="modal-calendar-day ${hasReport ? 'has-report' : ''}" 
             data-date="${dateStr}"
             style="
                position: relative;
                background: ${bgColor};
                border: 2px solid ${borderColor};
                border-radius: 8px;
                padding: 10px;
                min-height: 70px;
                text-align: center;
                ${hoverEffect}
                animation: fadeIn 0.3s ease-out ${day * 0.01}s both;
                overflow: hidden;
            "
            onmouseenter="${hasReport ? `this.style.borderWidth='3px'; this.style.boxShadow='0 4px 12px ${borderColor}80';` : ''}"
            onmouseleave="${hasReport ? `this.style.borderWidth='2px'; this.style.boxShadow='';` : ''}">
            ${editBadge}
            <div style="font-weight: bold; font-size: 18px; margin-bottom: 8px; color: #fff;">${day}</div>
            ${hasReport ? `
                <div style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    background: ${borderColor}30;
                    padding: 6px 8px;
                    border-radius: 6px;
                    margin-top: 4px;
                ">
                    <span style="font-size: 16px;">${statusIcon}</span>
                    <span style="font-size: 8px; color: ${statusColor}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;">
                        ${statusText}
                    </span>
                </div>
            ` : ''}
        </div>`;
    }
    
    modalGrid.innerHTML = html;
    
    // Click hodisalarini qo'shish - kun bosilganda batafsil modal
    document.querySelectorAll('.modal-calendar-day.has-report').forEach(day => {
        day.addEventListener('click', () => {
            const date = day.dataset.date;
            const dayInfo = data.find(d => d.date === date);
            if (dayInfo) {
                showDayDetails(dayInfo);
            }
        });
    });
}

// Kun batafsil ma'lumotlarini ko'rsatish
async function showDayDetails(dayInfo) {
    const modal = document.getElementById('day-details-modal');
    const title = document.getElementById('day-details-title');
    const content = document.getElementById('day-details-content');
    const closeBtn = document.getElementById('close-day-details-modal');
    
    if (!modal || !content) return;
    
    // Sanani formatlash - bosh harf bilan
    const dateObj = new Date(dayInfo.date);
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    const formattedDate = dateObj.toLocaleDateString('uz-UZ', options);
    
    // Bosh harfni katta qilish
    const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
    title.textContent = capitalizedDate;
    title.style.textAlign = 'center';
    title.style.padding = '15px 20px';
    
    // Status rang va matn
    let statusBg = '';
    let statusText = '';
    let statusIcon = '';
    
    if (dayInfo.status === 'on_time' && dayInfo.isEdited) {
        statusBg = 'linear-gradient(135deg, #52c41a, #faad14)';
        statusText = "O'z vaqtida topshirilgan + Tahrirlangan";
        statusIcon = '✓✎';
    } else if (dayInfo.status === 'late' && dayInfo.isEdited) {
        statusBg = 'linear-gradient(135deg, #ff4d4f, #faad14)';
        statusText = 'Kechikkan + Tahrirlangan';
        statusIcon = '⚠✎';
    } else if (dayInfo.status === 'on_time') {
        statusBg = '#52c41a';
        statusText = "O'z vaqtida topshirilgan";
        statusIcon = '✓';
    } else if (dayInfo.status === 'late') {
        statusBg = '#ff4d4f';
        statusText = 'Kechikkan';
        statusIcon = '⚠';
    }
    
    // Report ma'lumotlarini yuklash (agar reportId bo'lsa)
    let reportDetails = null;
    let reportData = null;
    let reportSettings = null;
    if (dayInfo.reportId) {
        try {
            const response = await fetch(`/api/reports?startDate=${dayInfo.date}&endDate=${dayInfo.date}`);
            if (response.ok) {
                const data = await response.json();
                if (data.reports && data.reports[dayInfo.reportId]) {
                    reportDetails = data.reports[dayInfo.reportId];
                    reportData = reportDetails.data || {};
                    reportSettings = reportDetails.settings || {};
                }
            }
        } catch (error) {
            console.error('Report ma\'lumotlarini yuklashda xatolik:', error);
        }
    }
    
    // Kechikish vaqtini hisoblash
    let lateTime = null;
    if (dayInfo.status === 'late' && reportDetails && reportDetails.created_at) {
        const deadline = new Date(dayInfo.date);
        deadline.setDate(deadline.getDate() + 1);
        deadline.setHours(9, 0, 0, 0);
        const createdAt = new Date(reportDetails.created_at);
        const diffMs = createdAt - deadline;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        lateTime = `${diffHours} soat ${diffMinutes} daqiqa`;
    }
    
    // Report ma'lumotlarini brendlar bo'yicha guruhlab, umumiy summalarni hisoblash
    let reportTableHtml = '';
    if (reportData && Object.keys(reportData).length > 0) {
        // Brendlar ro'yxatini yuklash
        let brandsMap = {};
        try {
            const brandsResponse = await fetch('/api/brands');
            if (brandsResponse.ok) {
                const brandsData = await brandsResponse.json();
                if (Array.isArray(brandsData)) {
                    brandsData.forEach(brand => {
                        brandsMap[brand.id] = brand.name;
                    });
                }
            }
        } catch (error) {
            console.error('Brendlar ro\'yxatini yuklashda xatolik:', error);
        }
        
        // Brendlar bo'yicha umumiy summalarni hisoblash
        const brandTotals = {};
        let locationTotal = 0; // Filial bo'yicha umumiy summa
        
        // Formatlash funksiyasi (vergul o'rniga bo'sh joy, 3 talik)
        const formatNumber = (num) => {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        };
        
        // Barcha ma'lumotlarni ko'rib chiqish
        Object.entries(reportData).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                // Agar value obyekt bo'lsa, ichidagi barcha qiymatlarni yig'ish
                Object.entries(value).forEach(([subKey, subValue]) => {
                    // Brend raqamini aniqlash (masalan: "10_Naqd" -> "10")
                    const brandMatch = key.match(/^(\d+)_/);
                    if (brandMatch) {
                        const brandId = brandMatch[1];
                        if (!brandTotals[brandId]) {
                            brandTotals[brandId] = 0;
                        }
                        const numValue = typeof subValue === 'number' ? subValue : (parseFloat(subValue) || 0);
                        brandTotals[brandId] += numValue;
                        locationTotal += numValue;
                    } else {
                        // Agar brend raqami bo'lmasa, barcha qiymatlarni yig'ish
                        const numValue = typeof subValue === 'number' ? subValue : (parseFloat(subValue) || 0);
                        locationTotal += numValue;
                    }
                });
            } else {
                // Agar value raqam bo'lsa, to'g'ridan-to'g'ri qo'shish
                const numValue = typeof value === 'number' ? value : (parseFloat(value) || 0);
                if (numValue > 0) {
                    const brandMatch = key.match(/^(\d+)_/);
                    if (brandMatch) {
                        const brandId = brandMatch[1];
                        if (!brandTotals[brandId]) {
                            brandTotals[brandId] = 0;
                        }
                        brandTotals[brandId] += numValue;
                        locationTotal += numValue;
                    } else {
                        locationTotal += numValue;
                    }
                }
            }
        });
        
        // Brendlar ro'yxatini tartiblash (raqamlar bo'yicha)
        const sortedBrands = Object.keys(brandTotals).sort((a, b) => {
            return parseInt(a) - parseInt(b);
        });
        
        // Jadval HTML yaratish
        if (sortedBrands.length > 0) {
            const currencyText = reportDetails?.currency ? (reportDetails.currency === 'UZS' ? 'so\'m' : reportDetails.currency) : 'so\'m';
            
            reportTableHtml = `
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(79, 172, 254, 0.2); overflow-x: auto;">
                    <h4 style="margin: 0 0 15px 0; color: #4facfe; font-size: 16px; display: flex; align-items: center; gap: 8px; font-weight: 700;">
                        <span>📊</span> Brendlar bo'yicha umumiy summalar
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; color: rgba(255,255,255,0.9); font-size: 14px;">
                        <thead>
                            <tr style="background: rgba(79, 172, 254, 0.2); border-bottom: 2px solid rgba(79, 172, 254, 0.4);">
                                <th style="padding: 10px; text-align: left; font-weight: 600; color: #4facfe; border-right: 1px solid rgba(255,255,255,0.1); font-size: 13px;">Brend</th>
                                <th style="padding: 10px; text-align: right; font-weight: 600; color: #4facfe; font-size: 13px;">Summa</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedBrands.map((brandId, index) => {
                                const total = brandTotals[brandId];
                                const brandName = brandsMap[brandId] || `Brend ${brandId}`;
                                return `
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" 
                                        onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                                        onmouseout="this.style.background=''">
                                        <td style="padding: 10px; border-right: 1px solid rgba(255,255,255,0.1); font-weight: 500; color: rgba(255,255,255,0.9); font-size: 13px;">
                                            ${brandName}
                                        </td>
                                        <td style="padding: 10px; text-align: right; font-weight: 600; color: #4facfe; font-size: 13px;">
                                            ${formatNumber(total)} ${currencyText}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                            <tr style="border-top: 2px solid rgba(79, 172, 254, 0.4); background: rgba(250, 173, 20, 0.1);">
                                <td style="padding: 10px; border-right: 1px solid rgba(255,255,255,0.1); font-weight: 700; color: #faad14; font-size: 13px;">
                                    📍 ${reportDetails?.location || 'Filial'} jami
                                </td>
                                <td style="padding: 10px; text-align: right; font-weight: 700; color: #faad14; font-size: 13px;">
                                    ${formatNumber(locationTotal)} ${currencyText}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        }
    }
    
    content.innerHTML = `
        <!-- Status kartasi -->
        <div style="background: ${statusBg}; padding: 25px; border-radius: 16px; color: white; text-align: center; margin-bottom: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
            <div style="font-size: 64px; margin-bottom: 15px;">${statusIcon}</div>
            <div style="font-size: 22px; font-weight: 700; margin-bottom: 8px;">${statusText}</div>
            ${lateTime ? `<div style="font-size: 14px; opacity: 0.9; margin-top: 8px;">⏱️ Kechikish: ${lateTime}</div>` : ''}
        </div>
        
        <!-- Asosiy layout: Chap tomonda ma'lumotlar, o'ng tomonda jadval -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <!-- Chap tomonda: Asosiy ma'lumotlar ustma-ustun -->
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <!-- Hisobot ID -->
                <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(79, 172, 254, 0.2);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: rgba(255,255,255,0.7); font-size: 14px;">Hisobot ID:</span>
                        <span style="font-weight: 700; color: #4facfe; font-size: 18px;">#${dayInfo.reportId || 'N/A'}</span>
                    </div>
                </div>
                
                <!-- Sana -->
                <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: rgba(255,255,255,0.7); font-size: 14px;">📅 Sana:</span>
                        <span style="font-weight: 600; font-size: 15px;">${dayInfo.date}</span>
                    </div>
                </div>
                
                <!-- Kun -->
                <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: rgba(255,255,255,0.7); font-size: 14px;">🔢 Kun:</span>
                        <span style="font-weight: 600; font-size: 15px;">${dayInfo.day}</span>
                    </div>
                </div>
                
                <!-- Tahrirlangan -->
                <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: ${dayInfo.isEdited && dayInfo.editorUsername ? '12px' : '0'}; ${dayInfo.isEdited && dayInfo.editorUsername ? 'padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1);' : ''}">
                        <span style="color: rgba(255,255,255,0.7); font-size: 14px;">✏️ Tahrirlangan:</span>
                        <span style="font-weight: 600; color: ${dayInfo.isEdited ? '#faad14' : '#52c41a'}; font-size: 15px;">
                            ${dayInfo.isEdited ? 'Ha' : 'Yo\'q'}
                        </span>
                    </div>
                    ${dayInfo.isEdited && dayInfo.editorUsername ? `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: rgba(255,255,255,0.7); font-size: 14px;">👤 Tahrirlagan:</span>
                            <span style="font-weight: 600; color: #1890ff; font-size: 15px;">${dayInfo.editorUsername}</span>
                        </div>
                    ` : ''}
                </div>
                
                ${reportDetails ? `
                    ${reportDetails.created_by_username ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.7); font-size: 14px;">👨‍💼 Yaratuvchi:</span>
                                <span style="font-weight: 600; color: #52c41a; font-size: 15px;">${reportDetails.created_by_username}</span>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${reportDetails.location ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.7); font-size: 14px;">📍 Filial:</span>
                                <span style="font-weight: 600; color: #722ed1; font-size: 15px;">${reportDetails.location}</span>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${reportDetails.brand_name ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.7); font-size: 14px;">🏷️ Brend:</span>
                                <span style="font-weight: 600; color: #fa8c16; font-size: 15px;">${reportDetails.brand_name}</span>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${reportDetails.created_at ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.7); font-size: 14px;">🕐 Yaratilgan:</span>
                                <span style="font-weight: 600; color: #13c2c2; font-size: 13px;">${new Date(reportDetails.created_at).toLocaleString('uz-UZ')}</span>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${dayInfo.isEdited && dayInfo.editedAt ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.7); font-size: 14px;">🔄 Tahrir vaqti:</span>
                                <span style="font-weight: 600; color: #faad14; font-size: 13px;">${new Date(dayInfo.editedAt).toLocaleString('uz-UZ')}</span>
                            </div>
                        </div>
                    ` : ''}
                ` : ''}
            </div>
            
            <!-- O'ng tomonda: Brendlar jadvali (ixchamlashtirilgan) -->
            <div>
                ${reportTableHtml ? reportTableHtml.replace('padding: 25px', 'padding: 20px').replace('font-size: 18px', 'font-size: 16px').replace('padding: 12px', 'padding: 10px') : ''}
            </div>
        </div>
        
        <!-- O'zgarishlar tarixi (agar tahrirlangan bo'lsa) -->
        ${dayInfo.isEdited && dayInfo.reportId ? `
            <div id="edit-history-section" style="background: rgba(255,255,255,0.05); padding: 25px; border-radius: 12px; display: flex; flex-direction: column; max-height: 500px; border: 1px solid rgba(79, 172, 254, 0.2);">
                <h4 style="margin: 0 0 20px 0; color: #4facfe; font-size: 18px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; font-weight: 700;">
                    <span>📝</span> O'zgarishlar tarixi
                </h4>
                <div id="edit-history-content" style="
                    color: #4facfe; 
                    text-align: center; 
                    padding: 20px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    max-height: 400px;
                    flex: 1;
                ">
                    Yuklanmoqda...
                </div>
            </div>
        ` : ''}
    `;
    
    // Modalni ochish
    modal.classList.remove('hidden');
    
    // Feather iconlarni yangilash
    setTimeout(() => {
        if (typeof feather !== 'undefined') feather.replace();
    }, 100);
    
    // Agar tahrirlangan bo'lsa, tahrir tarixini yuklash
    if (dayInfo.isEdited && dayInfo.reportId) {
        loadEditHistory(dayInfo.reportId);
    }
    
    // Yopish
    closeBtn.onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    };
}

// Tahrir tarixini yuklash
async function loadEditHistory(reportId) {
    const historyContent = document.getElementById('edit-history-content');
    if (!historyContent) return;
    
    // console.log('📊 Tahrir tarixi yuklanmoqda, reportId:', reportId);
    
    try {
        const response = await fetch(`/api/statistics/report/${reportId}/history`);
        
        // console.log('📥 Response status:', response.status);
        
        if (!response.ok) {
            throw new Error('Tahrir tarixi yuklanmadi');
        }
        
        let history = await response.json();
        // console.log('📋 Kelgan history:', history);
        
        if (!history || history.length === 0) {
            historyContent.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center;">O\'zgarishlar topilmadi</p>';
            return;
        }
        
        // console.log('📊 Filtrlashdan oldin:', history.length, 'ta yozuv');
        
        // Faqat haqiqatan o'zgargan maydonlarni filtrlash
        history = history.filter(edit => {
            const oldVal = String(edit.old_value || '').trim();
            const newVal = String(edit.new_value || '').trim();
            const isChanged = oldVal !== newVal && oldVal !== '' && newVal !== '';
            // console.log(`🔍 ${edit.field_name}: "${oldVal}" -> "${newVal}" = ${isChanged}`);
            return isChanged;
        });
        
        // console.log('✅ O\'zgargan maydonlar:', history.length, 'ta');
        
        if (history.length === 0) {
            historyContent.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center;">O\'zgarishlar topilmadi</p>';
            return;
        }
        
        // Takroriy o'zgarishlarni olib tashlash (bir xil field + old_value + new_value)
        const uniqueHistory = [];
        const seen = new Set();
        
        history.forEach(edit => {
            const key = `${edit.field_name}_${edit.old_value}_${edit.new_value}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueHistory.push(edit);
            }
        });
        
        history = uniqueHistory;
        // console.log('🎯 Takrorlar olib tashlangandan keyin:', history.length, 'ta');
        
        // Maydon nomlarini o'zbekchaga tarjima qilish
        const fieldNames = {
            'location': 'Filial',
            'driver_name': 'Haydovchi',
            'car_number': 'Mashina raqami',
            'trip_count': 'Reys soni',
            'distance': 'Masofa',
            'fuel_given': 'Berilgan yoqilg\'i',
            'fuel_used': 'Sarflangan yoqilg\'i',
            'balance': 'Qoldiq',
            'notes': 'Izohlar'
        };
        
        historyContent.innerHTML = history.map((edit, index) => {
            const changedAt = new Date(edit.changed_at).toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const fieldLabel = fieldNames[edit.field_name] || edit.field_name;
            const changedBy = edit.changed_by_fullname || edit.changed_by_username;
            
            return `
                <div style="
                    background: rgba(0,0,0,0.2);
                    padding: 15px;
                    border-radius: 10px;
                    margin-bottom: ${index === history.length - 1 ? '0' : '12px'};
                    border-left: 3px solid #faad14;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div>
                            <div style="color: #faad14; font-weight: 600; font-size: 14px; margin-bottom: 4px;">
                                ${fieldLabel}
                            </div>
                            <div style="font-size: 11px; color: rgba(255,255,255,0.5);">
                                ${changedAt} | ${changedBy}
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; margin-top: 10px;">
                        <div style="
                            background: rgba(255, 77, 79, 0.2);
                            padding: 8px 12px;
                            border-radius: 8px;
                            border: 1px solid rgba(255, 77, 79, 0.3);
                            text-align: center;
                        ">
                            <div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">ESKI</div>
                            <div style="color: #ff4d4f; font-weight: 600; word-break: break-word;">${formatNumber(edit.old_value)}</div>
                        </div>
                        
                        <div style="color: #4facfe; font-size: 20px;">→</div>
                        
                        <div style="
                            background: rgba(82, 196, 26, 0.2);
                            padding: 8px 12px;
                            border-radius: 8px;
                            border: 1px solid rgba(82, 196, 26, 0.3);
                            text-align: center;
                        ">
                            <div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">YANGI</div>
                            <div style="color: #52c41a; font-weight: 600; word-break: break-word;">${formatNumber(edit.new_value)}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        historyContent.innerHTML = '<p style="color: #ff4d4f; text-align: center;">Tahrir tarixi yuklanmadi</p>';
    }
}

// Filiallar filtrini populate qilish
function populateKpiLocationFilter(data) {
    const locationFilter = document.getElementById('kpi-location-filter');
    if (!locationFilter) return;
    
    const locations = new Set();
    data.forEach(emp => {
        if (emp.locations && emp.locations.length > 0) {
            emp.locations.forEach(loc => locations.add(loc));
        }
    });
    
    const currentValue = locationFilter.value;
    locationFilter.innerHTML = '<option value="">Barcha filiallar</option>';
    
    Array.from(locations).sort().forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        option.textContent = loc;
        locationFilter.appendChild(option);
    });
    
    if (currentValue && Array.from(locations).includes(currentValue)) {
        locationFilter.value = currentValue;
    }
}

async function fetchAndRenderKpiData() {
    if (!state.kpi.selectedMonth) return;
    DOM.kpiTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">Yuklanmoqda...</td></tr>`;
    
    try {
        const res = await safeFetch(`/api/statistics/employees?month=${state.kpi.selectedMonth}`);
        if (!res || !res.ok) throw new Error('Statistika yuklanmadi');
        state.kpi.data = await res.json();
        
        // Elementlarni ko'rsatish (agar yashiringan bo'lsa)
        const statsGrid = document.getElementById('kpi-stats-grid');
        const topCard = document.getElementById('top-performers-card');
        const mainCards = document.querySelectorAll('#employee-statistics .card');
        
        if (statsGrid) statsGrid.style.display = 'grid';
        if (topCard) topCard.style.display = 'block';
        mainCards.forEach(card => card.style.display = 'block');
        DOM.employeeDetailsView.style.display = 'none';
        
        // Statistikalarni render qilish
        renderKpiStats();
        
        // Podiumni render qilish
        renderTopPerformers();
        
        // Filiallar filterini to'ldirish
        populateLocationFilter();
        
        // Jadvalni render qilish
        renderKpiTable();
    } catch (error) {
        DOM.kpiTableBody.innerHTML = `<tr><td colspan="8" class="empty-state error">${error.message}</td></tr>`;
    }
}

function renderKpiStats() {
    const statsGrid = document.getElementById('kpi-stats-grid');
    if (!statsGrid || !state.kpi.data || state.kpi.data.length === 0) return;
    
    // Statistikalarni hisoblash
    const totalEmployees = state.kpi.data.length;
    const totalReports = state.kpi.data.reduce((sum, emp) => sum + emp.totalSubmitted, 0);
    const avgScore = state.kpi.data.reduce((sum, emp) => sum + emp.kpiScore, 0) / totalEmployees;
    const topPerformer = state.kpi.data.reduce((max, emp) => emp.kpiScore > max.kpiScore ? emp : max, state.kpi.data[0]);
    
    const statsHTML = `
        <div class="kpi-stat-card">
            <div class="kpi-stat-icon" style="background: rgba(52, 152, 219, 0.1);">
                <i data-feather="users" style="color: var(--blue-color);"></i>
            </div>
            <div class="kpi-stat-info">
                <span class="kpi-stat-label">Jami Xodimlar</span>
                <span class="kpi-stat-value">${totalEmployees}</span>
            </div>
        </div>
        
        <div class="kpi-stat-card">
            <div class="kpi-stat-icon" style="background: rgba(46, 204, 113, 0.1);">
                <i data-feather="file-text" style="color: var(--green-color);"></i>
            </div>
            <div class="kpi-stat-info">
                <span class="kpi-stat-label">Jami Hisobotlar</span>
                <span class="kpi-stat-value">${totalReports}</span>
            </div>
        </div>
        
        <div class="kpi-stat-card">
            <div class="kpi-stat-icon" style="background: rgba(155, 89, 182, 0.1);">
                <i data-feather="trending-up" style="color: var(--purple-color);"></i>
            </div>
            <div class="kpi-stat-info">
                <span class="kpi-stat-label">O'rtacha KPI</span>
                <span class="kpi-stat-value">${avgScore.toFixed(1)}%</span>
            </div>
        </div>
        
        <div class="kpi-stat-card">
            <div class="kpi-stat-icon" style="background: rgba(241, 196, 15, 0.1);">
                <i data-feather="award" style="color: var(--yellow-color);"></i>
            </div>
            <div class="kpi-stat-info">
                <span class="kpi-stat-label">Eng Yaxshi</span>
                <span class="kpi-stat-value" style="font-size: 14px;">${topPerformer.fullname || topPerformer.username}</span>
                <span class="kpi-stat-sub" style="font-size: 12px; color: var(--yellow-color);">${topPerformer.kpiScore.toFixed(1)}%</span>
            </div>
        </div>
    `;
    
    statsGrid.innerHTML = statsHTML;
    feather.replace();
}

function renderTopPerformers() {
    const podiumCard = document.getElementById('top-performers-card');
    const podiumContainer = document.getElementById('podium-container');
    
    if (!podiumContainer || !state.kpi.data || state.kpi.data.length === 0) return;
    
    // Top 3 ni olish
    const sortedData = [...state.kpi.data].sort((a, b) => b.kpiScore - a.kpiScore);
    const top3 = sortedData.slice(0, 3);
    
    if (top3.length < 3) {
        podiumCard.style.display = 'none';
        return;
    }
    
    podiumCard.style.display = 'block';
    
    // Podium tartibini o'zgartirish: 2-chi, 1-chi, 3-chi
    const podiumOrder = top3.length >= 2 ? [top3[1], top3[0], top3[2] || null] : [null, top3[0], null];
    
    podiumContainer.innerHTML = podiumOrder.map((emp, index) => {
        if (!emp) return '<div class="podium-placeholder"></div>';
        
        const position = index === 1 ? 1 : index === 0 ? 2 : 3;
        const medals = ['🥇', '🥈', '🥉'];
        const colors = ['#FFD700', '#C0C0C0', '#CD7F32'];
        const heights = ['180px', '220px', '150px'];
        
        return `
            <div class="podium-item podium-rank-${position}">
                <div class="podium-person\">
                    <div class="podium-avatar\" style=\"background: ${colors[index]};\">
                        <span style=\"font-size: 32px;\">${medals[position - 1]}</span>
                    </div>
                    <div class=\"podium-name\">${emp.fullname || emp.username}</div>
                    <div class=\"podium-score\">${emp.kpiScore.toFixed(1)}%</div>
                </div>
                <div class=\"podium-stand\" style=\"height: ${heights[index]}; background: linear-gradient(135deg, ${colors[index]}dd, ${colors[index]}88);\">
                    <div class=\"podium-rank\">${position}</div>
                </div>
            </div>
        `;
    }).join('');
}

function populateLocationFilter() {
    const locationFilter = document.getElementById('kpi-location-filter');
    if (!locationFilter || !state.kpi.data) return;
    
    // Barcha filiallarni to'plash
    const allLocations = new Set();
    state.kpi.data.forEach(emp => {
        if (emp.locations && Array.isArray(emp.locations)) {
            emp.locations.forEach(loc => allLocations.add(loc));
        }
    });
    
    const sortedLocations = Array.from(allLocations).sort();
    locationFilter.innerHTML = '<option value="all">Barcha filiallar</option>' + 
        sortedLocations.map(loc => `<option value="${loc}">${loc}</option>`).join('');
}

function renderKpiTable() {
    const { key, direction } = state.kpi.currentSort;

    let sortedData = [...state.kpi.data].sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    if (sortedData.length === 0) {
        DOM.kpiTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">Bu oy uchun ma'lumotlar topilmadi.</td></tr>`;
        return;
    }

    DOM.kpiTableBody.innerHTML = sortedData.map((emp, index) => {
        // Filiallar ro'yxatini formatlash - 2 tadan ortiq bo'lsa, faqat son ko'rsatish
        const locations = emp.locations && emp.locations.length > 0 ? emp.locations : [];
        let locationsDisplay = '';
        
        if (locations.length === 0) {
            locationsDisplay = '<span class="kpi-locations-badge">Biriktirilmagan</span>';
        } else if (locations.length <= 2) {
            // 2 tadan kam yoki teng bo'lsa, barchasini ko'rsatish
            locationsDisplay = `<span class="kpi-locations-badge">${locations.join(', ')}</span>`;
        } else {
            // 2 tadan ortiq bo'lsa, faqat son ko'rsatish (bosilganda modal ochiladi)
            locationsDisplay = `
                <span class="kpi-items-count-badge" 
                      data-type="locations" 
                      data-items='${JSON.stringify(locations)}'
                      data-title="Filiallar"
                      style="background: rgba(79, 172, 254, 0.2); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #4facfe; cursor: pointer; transition: all 0.2s; display: inline-block;"
                      onmouseover="this.style.background='rgba(79, 172, 254, 0.3)'; this.style.transform='scale(1.05)'"
                      onmouseout="this.style.background='rgba(79, 172, 254, 0.2)'; this.style.transform='scale(1)'"
                      title="Barcha filiallarni ko'rish uchun bosing">
                    ${locations.length} ta
                </span>
            `;
        }
        
        // Brendlar ko'rsatish (agar mavjud bo'lsa)
        const brands = emp.brands && emp.brands.length > 0 ? emp.brands : [];
        let brandsDisplay = '';
        
        if (brands.length > 0) {
            if (brands.length <= 2) {
                const brandNames = brands.map(b => typeof b === 'object' ? b.name : b).join(', ');
                brandsDisplay = `<span class="kpi-brands-badge" style="background: rgba(155, 89, 182, 0.1); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #9b59b6; margin-left: 6px;">${brandNames}</span>`;
            } else {
                brandsDisplay = `
                    <span class="kpi-items-count-badge" 
                          data-type="brands" 
                          data-items='${JSON.stringify(brands.map(b => typeof b === 'object' ? b.name : b))}'
                          data-title="Brendlar"
                          style="background: rgba(155, 89, 182, 0.2); padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #9b59b6; cursor: pointer; transition: all 0.2s; display: inline-block; margin-left: 6px;"
                          onmouseover="this.style.background='rgba(155, 89, 182, 0.3)'; this.style.transform='scale(1.05)'"
                          onmouseout="this.style.background='rgba(155, 89, 182, 0.2)'; this.style.transform='scale(1)'"
                          title="Barcha brendlarni ko'rish uchun bosing">
                        ${brands.length} ta
                    </span>
                `;
            }
        }
        
        const scoreColor = emp.kpiScore > 80 
            ? 'var(--green-color)' 
            : emp.kpiScore > 50 
                ? 'var(--yellow-color)' 
                : 'var(--red-color)';
        
        const rank = index + 1;
        let rankBadge = '';
        if (rank === 1) rankBadge = '🥇';
        else if (rank === 2) rankBadge = '🥈';
        else if (rank === 3) rankBadge = '🥉';

        return `
        <tr class="kpi-main-row" data-user-id="${emp.userId}" data-locations="${emp.locations ? emp.locations.join('|') : ''}" data-fullname="${emp.fullname || emp.username}">
            <td class="kpi-rank-cell" style="width: 50px; min-width: 50px; max-width: 50px; text-align: center; vertical-align: middle; padding: 8px 4px;"><span class="kpi-rank" style="font-size: 14px;">${rankBadge} ${rank}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px; min-width: 200px;">
                <div class="employee-cell" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div style="width: 36px; height: 36px; min-width: 36px; min-height: 36px; max-width: 36px; max-height: 36px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; flex-shrink: 0; flex-grow: 0; overflow: hidden; box-sizing: border-box;">
                        ${getInitials(emp.fullname || emp.username)}
                    </div>
                    <span class="employee-name-clickable" title="Oylik kalendar ko'rish uchun bosing" style="flex: 1; min-width: 150px; line-height: 1.4; word-wrap: break-word;">${emp.fullname || emp.username}</span>
                    <button class="btn-icon toggle-kpi-details-btn" title="Tezkor ma'lumot" style="flex-shrink: 0;">
                        <i data-feather="chevron-down"></i>
                    </button>
                </div>
            </td>
            <td style="vertical-align: middle; padding: 8px 12px;">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 32px;">
                    ${locationsDisplay}${brandsDisplay}
                </div>
            </td>
            <td class="kpi-score-cell" style="vertical-align: middle; padding: 8px 12px;">
                <div class="kpi-score-bar" style="--score-color: ${scoreColor}; --score-width: ${emp.kpiScore}%;">
                    <span>${emp.kpiScore.toFixed(1)}%</span>
                </div>
            </td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span class="kpi-count-badge">${emp.totalSubmitted}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span class="kpi-count-badge success">${emp.onTimeCount || 0}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span class="kpi-count-badge danger">${emp.lateCount || 0}</span></td>
            <td style="vertical-align: middle; padding: 8px 12px;"><span class="kpi-count-badge warning">${formatEditedCount(emp.totalEdited)}</span></td>
        </tr>
        <tr class="kpi-details-row hidden" data-details-for="${emp.userId}">
            <td colspan="8">
                <div class="kpi-details-content">
                    <div class="kpi-bar-wrapper" title="O'z vaqtida: ${emp.onTimePercentage.toFixed(1)}%">
                        <div class="kpi-bar on-time" style="width: ${emp.onTimePercentage}%;">
                            <span>${emp.onTimeCount || 0} dona (${emp.onTimePercentage.toFixed(1)}%)</span>
                        </div>
                    </div>
                    <div class="kpi-bar-wrapper" title="Kechikkan: ${emp.latePercentage.toFixed(1)}%">
                        <div class="kpi-bar late" style="width: ${emp.latePercentage}%;">
                            <span>${emp.lateCount || 0} dona (${emp.latePercentage.toFixed(1)}%)</span>
                        </div>
                    </div>
                    <div class="kpi-bar-wrapper" title="Tahrirlangan hisobotlar soni: ${emp.totalEdited}">
                        <div class="kpi-bar edited" style="width: ${emp.editedPercentage > 100 ? 100 : emp.editedPercentage}%;">
                            <span>${emp.totalEdited} dona tahrirlangan</span>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `;
    }).join('');
    
    const headers = document.querySelectorAll('.kpi-table th');
    headers.forEach(th => {
        th.classList.remove('sorted', 'asc', 'desc');
        const sortIcon = th.querySelector('.sort-icon');
        if (sortIcon) sortIcon.remove();

        if (th.dataset.sort === key) {
            th.classList.add('sorted', direction);
            th.innerHTML += `<span class="sort-icon">${direction === 'asc' ? '▲' : '▼'}</span>`;
        }
    });
    
    feather.replace();
    
    // Count badge'larga bosilganda modal ochish
    document.querySelectorAll('.kpi-items-count-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const items = JSON.parse(badge.dataset.items || '[]');
            const title = badge.dataset.title || 'Ro\'yxat';
            showItemsModal(title, items);
        });
    });
    
    filterKpiTable(); // Filtrni qo'llash
}

function handleKpiSort(e) {
    const header = e.target.closest('th');
    if (!header || !header.dataset.sort) return;

    const sortKey = header.dataset.sort;
    const { key, direction } = state.kpi.currentSort;

    if (key === sortKey) {
        state.kpi.currentSort.direction = direction === 'asc' ? 'desc' : 'asc';
    } else {
        state.kpi.currentSort.key = sortKey;
        state.kpi.currentSort.direction = 'desc';
    }
    renderKpiTable();
}

function filterKpiTable() {
    const searchValue = document.getElementById('kpi-search')?.value.toLowerCase() || '';
    const selectedLocation = document.getElementById('kpi-location-filter')?.value || 'all';
    const rows = document.querySelectorAll('.kpi-main-row');
    
    let visibleCount = 0;
    
    rows.forEach(row => {
        const fullname = row.dataset.fullname?.toLowerCase() || '';
        const locations = row.dataset.locations?.split('|') || [];
        
        const matchesSearch = fullname.includes(searchValue);
        const matchesLocation = selectedLocation === 'all' || locations.includes(selectedLocation);
        
        if (matchesSearch && matchesLocation) {
            row.style.display = '';
            // Tegishli details qatorini ham ko'rsatish/yashirish
            const userId = row.dataset.userId;
            const detailsRow = document.querySelector(`.kpi-details-row[data-details-for="${userId}"]`);
            if (detailsRow && !detailsRow.classList.contains('hidden')) {
                detailsRow.style.display = '';
            }
            visibleCount++;
        } else {
            row.style.display = 'none';
            // Tegishli details qatorini ham yashirish
            const userId = row.dataset.userId;
            const detailsRow = document.querySelector(`.kpi-details-row[data-details-for="${userId}"]`);
            if (detailsRow) {
                detailsRow.style.display = 'none';
            }
        }
    });
    
    // Agar hech narsa topilmasa
    if (visibleCount === 0 && rows.length > 0) {
        if (!document.querySelector('.kpi-no-results')) {
            DOM.kpiTableBody.innerHTML += `<tr class="kpi-no-results"><td colspan="8" class="empty-state">Hech narsa topilmadi.</td></tr>`;
        }
    } else {
        const noResults = document.querySelector('.kpi-no-results');
        if (noResults) noResults.remove();
    }
}

function exportKpiToExcel() {
    if (!state.kpi.data || state.kpi.data.length === 0) {
        showToast('Export qilish uchun ma\'lumot yo\'q', true);
        return;
    }
    
    // CSV formatida export
    const headers = ['#', 'Xodim', 'Filiallar', 'KPI Ball (%)', 'Topshirilgan', 'O\'z vaqtida', 'Kechikkan', 'Tahrirlangan'];
    const rows = state.kpi.data.map((emp, index) => [
        index + 1,
        emp.fullname || emp.username,
        emp.locations ? emp.locations.join('; ') : 'Biriktirilmagan',
        emp.kpiScore.toFixed(1),
        emp.totalSubmitted,
        emp.onTimeCount || 0,
        emp.lateCount || 0,
        emp.totalEdited || 0
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `KPI_Statistika_${state.kpi.selectedMonth}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('KPI statistika muvaffaqiyatli yuklandi');
}

export async function showEmployeeDetails(userId, fullname) {
    DOM.detailsViewTitle.textContent = `"${fullname}" uchun ${state.kpi.selectedMonth} oyi statistikasi`;
    DOM.detailsCalendarGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Yuklanmoqda...</div>';
    
    // Barcha kartalarni yashirish
    const cards = document.querySelectorAll('#employee-statistics .card');
    cards.forEach(card => {
        card.style.display = 'none';
    });
    
    const statsGrid = document.getElementById('kpi-stats-grid');
    const topCard = document.getElementById('top-performers-card');
    
    if (statsGrid) statsGrid.style.display = 'none';
    if (topCard) topCard.style.display = 'none';
    
    DOM.employeeDetailsView.style.display = 'block';

    try {
        const res = await safeFetch(`/api/statistics/employee/${userId}?month=${state.kpi.selectedMonth}`);
        if (!res || !res.ok) throw new Error('Batafsil statistika yuklanmadi');
        const dailyData = await res.json();
        
        const firstDayOfMonth = new Date(dailyData[0].date).getDay();
        const offset = (firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1);

        let calendarHtml = '';
        for (let i = 0; i < offset; i++) {
            calendarHtml += '<div class="calendar-day disabled"></div>';
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        calendarHtml += dailyData.map(day => {
            const dayDate = new Date(day.date);
            let statusClass = day.status;
            let tooltipHtml = '';

            if (dayDate > today) {
                statusClass = 'future';
            }

            const editIcon = day.isEdited ? `<i class="edit-indicator" data-feather="edit-2"></i>` : '';
            if (day.isEdited) {
                tooltipHtml = `
                    <div class="kpi-tooltip">
                        <div class="kpi-tooltip-row">
                            <span>Tahrirladi:</span>
                            <span>${day.editorUsername || 'N/A'}</span>
                        </div>
                        <div class="kpi-tooltip-row">
                            <span>Vaqti:</span>
                            <span>${new Date(day.editedAt).toLocaleString('uz-UZ')}</span>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="calendar-day ${statusClass}" 
                     data-report-id="${day.reportId || ''}" 
                     title="${day.date}">
                    <div class="day-number">${day.day}</div>
                    ${editIcon}
                    ${tooltipHtml}
                </div>
            `;
        }).join('');

        DOM.detailsCalendarGrid.innerHTML = calendarHtml;
        feather.replace();

    } catch (error) {
        DOM.detailsCalendarGrid.innerHTML = `<div class="empty-state error" style="grid-column: 1 / -1;">${error.message}</div>`;
    }
}

export function setupKpiEventListeners() {
    // KPI jadvalidagi qator bosilishi
    if (DOM.kpiTableBody) {
        DOM.kpiTableBody.addEventListener('click', (e) => {
            // Agar empty-state (hech narsa topilmadi) ga bosilsa, hech narsa qilmaslik
            if (e.target.closest('.empty-state, .kpi-no-results')) {
                return;
            }
            
            // Agar toggle tugma bosilgan bo'lsa - faqat kichik ma'lumotni ko'rsatish/yashirish
            const toggleBtn = e.target.closest('.toggle-kpi-details-btn');
            if (toggleBtn) {
                // console.log('Toggle button clicked');
                e.stopPropagation();
                const mainRow = toggleBtn.closest('.kpi-main-row');
                const userId = mainRow.dataset.userId;
                const detailsRow = DOM.kpiTableBody.querySelector(`.kpi-details-row[data-details-for="${userId}"]`);
                
                if (detailsRow) {
                    mainRow.classList.toggle('details-open');
                    detailsRow.classList.toggle('hidden');
                    
                    const icon = toggleBtn.querySelector('i');
                    if (icon) {
                        const isHidden = detailsRow.classList.contains('hidden');
                        icon.setAttribute('data-feather', isHidden ? 'chevron-down' : 'chevron-up');
                        feather.replace();
                    }
                }
                return;
            }

            // Agar xodim nomiga bosilgan bo'lsa - to'liq kalendar sahifasini ochish
            const employeeName = e.target.closest('.employee-name-clickable');
            if (employeeName) {
                const row = e.target.closest('.kpi-main-row');
                if (row) {
                    const userId = row.dataset.userId;
                    const user = state.kpi.data.find(u => u.userId == userId);
                    if (user) {
                        showEmployeeDetails(userId, user.fullname || user.username);
                    }
                }
                return;
            }
            
            // Yoki butun qatorga bosilsa (badge va boshqa elementlardan tashqari)
            const row = e.target.closest('.kpi-main-row');
            if (row && !e.target.closest('.kpi-count-badge, .kpi-score-bar, .kpi-locations-badge, .kpi-brands-badge, .kpi-items-count-badge')) {
                const userId = row.dataset.userId;
                const user = state.kpi.data.find(u => u.userId == userId);
                if (user) {
                    showEmployeeDetails(userId, user.fullname || user.username);
                }
            }
            
            // Count badge bosilganda modal ochish
            const countBadge = e.target.closest('.kpi-items-count-badge');
            if (countBadge) {
                e.stopPropagation();
                const items = JSON.parse(countBadge.dataset.items || '[]');
                const title = countBadge.dataset.title || 'Ro\'yxat';
                showItemsModal(title, items);
            }
        });
    }
    
    // Kalendar kunlariga bosilganda hisobotni ochish
    if (DOM.detailsCalendarGrid) {
        DOM.detailsCalendarGrid.addEventListener('click', (e) => {
            const day = e.target.closest('.calendar-day');
            if (day && day.dataset.reportId) {
                window.open(`/?report=${day.dataset.reportId}`, '_blank');
            }
        });
    }
}
