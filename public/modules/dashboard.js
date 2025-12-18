// Dashboard Module
// Dashboard statistika va grafiklar (Real-time + Animated)

import { state, setWeeklyChartInstance, weeklyChartInstance, setDashboardDatePicker } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { hasPermission, showToast } from './utils.js';

// Barcha mavjud statistikalar ro'yxati
const availableStats = {
    totalUsers: { label: 'Jami Foydalanuvchilar', icon: 'users', color: '#007bff', key: 'totalUsers' },
    totalLocations: { label: 'Jami Filiallar', icon: 'briefcase', color: '#17a2b8', key: 'totalLocations' },
    dailySubmitted: { label: 'Bugun Topshirildi', icon: 'check-circle', color: '#28a745', key: 'dailySubmitted' },
    totalReports: { label: 'Jami Hisobotlar', icon: 'file-text', color: '#6f42c1', key: 'totalReports' },
    editedReports: { label: 'Tahrirlangan Hisobotlar', icon: 'edit-3', color: '#17a2b8', key: 'editedReports' },
    lateReports: { label: 'Kechikkan Hisobotlar', icon: 'clock', color: '#ffc107', key: 'lateReports' },
    onTimeReports: { label: 'O\'z Vaqtida Topshirilgan', icon: 'check', color: '#28a745', key: 'onTimeReports' },
    activeUsers: { label: 'Aktiv Foydalanuvchilar', icon: 'user-check', color: '#28a745', key: 'activeUsers' },
    pendingUsers: { label: 'Kutilayotgan So\'rovlar', icon: 'user-plus', color: '#ffc107', key: 'pendingUsers' },
    notSubmitted: { label: 'Topshirilmagan', icon: 'x-circle', color: '#dc3545', key: 'notSubmitted' }
};

// Default statistikalar
const defaultSelectedStats = ['totalUsers', 'totalLocations', 'dailySubmitted'];

// LocalStorage'dan sozlamalarni olish
function getSelectedStats() {
    const saved = localStorage.getItem('dashboardSelectedStats');
    return saved ? JSON.parse(saved) : defaultSelectedStats;
}

// LocalStorage'ga saqlash
function saveSelectedStats(selected) {
    localStorage.setItem('dashboardSelectedStats', JSON.stringify(selected));
}

// Barcha mavjud grafiklar ro'yxati
const availableCharts = {
    weekly: { 
        label: 'Haftalik Dinamika', 
        description: '7 kunlik hisobotlar soni',
        type: 'line',
        color: '#007bff'
    },
    monthly: { 
        label: 'Oylik Dinamika', 
        description: '30 kunlik hisobotlar soni',
        type: 'line',
        color: '#17a2b8'
    },
    by_brand: { 
        label: 'Brendlar Bo\'yicha', 
        description: 'Bugungi hisobotlar brendlar kesimida',
        type: 'bar',
        color: '#4facfe'
    },
    by_user: { 
        label: 'Foydalanuvchilar Bo\'yicha', 
        description: 'Top 10 faol foydalanuvchilar',
        type: 'bar',
        color: '#6f42c1'
    },
    late_vs_ontime: { 
        label: 'Kechikkan vs O\'z Vaqtida', 
        description: 'Bugungi hisobotlar tahlili',
        type: 'doughnut',
        color: '#ffc107'
    },
    edited_reports: { 
        label: 'Tahrirlangan Hisobotlar', 
        description: '7 kunlik tahrirlangan hisobotlar',
        type: 'bar',
        color: '#17a2b8'
    }
};

// Default grafiklar
const defaultSelectedCharts = ['weekly', 'by_brand'];

// LocalStorage'dan grafik sozlamalarini olish
function getSelectedCharts() {
    const saved = localStorage.getItem('dashboardSelectedCharts');
    // Eski localStorage'da by_location bo'lsa, by_brand ga almashtiramiz
    if (saved) {
        let arr = JSON.parse(saved);
        arr = arr.map(c => c === 'by_location' ? 'by_brand' : c);
        return arr;
    }
    return defaultSelectedCharts;
}

// LocalStorage'ga saqlash
function saveSelectedCharts(selected) {
    localStorage.setItem('dashboardSelectedCharts', JSON.stringify(selected));
}

// Grafik instansiyalarini saqlash
const chartInstances = {};

// Animated counter funksiyasi
function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16); // 60 FPS
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.round(current);
    }, 16);
}

export function setupDashboard() {
    if (!hasPermission(state.currentUser, 'dashboard:view')) return;
    
    if (DOM.dashboardDatePicker) {
        const fpInstance = flatpickr(DOM.dashboardDatePicker, {
            defaultDate: "today", 
            dateFormat: "Y-m-d", 
            locale: "uz",
            onChange: (selectedDates) => updateDashboard(
                selectedDates[0] ? flatpickr.formatDate(selectedDates[0], 'Y-m-d') : ''
            )
        });
        setDashboardDatePicker(fpInstance);
        updateDashboard(flatpickr.formatDate(new Date(), 'Y-m-d'));
    }
    
    // Statistikalarni sozlash tugmasi
    const customizeBtn = document.getElementById('customize-stats-btn');
    if (customizeBtn) {
        customizeBtn.addEventListener('click', openStatsConfigModal);
    }
    
    // Grafiklarni sozlash tugmasi
    const customizeChartsBtn = document.getElementById('customize-charts-btn');
    if (customizeChartsBtn) {
        customizeChartsBtn.addEventListener('click', openChartsConfigModal);
    }
    
    // Filiallar tanlash
    const locationFilter = document.getElementById('location-filter');
    
    if (locationFilter) {
        locationFilter.addEventListener('change', () => {
            filterLocations();
        });
    }
    
    // Filter tugmalari
    const filterButtons = document.querySelectorAll('#location-filters .filter-btn');
    filterButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterLocations();
        });
    });
    
    // View toggle
    const viewButtons = document.querySelectorAll('.view-toggle .view-btn');
    viewButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            viewButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            toggleView(btn.dataset.view);
        });
    });
    
    // Feather ikonlarni darhol render qilish
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
}

function openStatsConfigModal() {
    const modal = document.getElementById('stats-config-modal');
    const optionsGrid = document.getElementById('stats-options-grid');
    const selectedStats = getSelectedStats();
    
    optionsGrid.innerHTML = Object.entries(availableStats).map(([key, stat]) => `
        <label class="stat-option">
            <input type="checkbox" name="stat-option" value="${key}" ${selectedStats.includes(key) ? 'checked' : ''}>
            <div class="stat-option-card">
                <i data-feather="${stat.icon}" style="color: ${stat.color};"></i>
                <span>${stat.label}</span>
            </div>
        </label>
    `).join('');
    
    feather.replace();
    modal.classList.remove('hidden');
    
    // Saqlash tugmasi
    const saveBtn = document.getElementById('save-stats-config-btn');
    saveBtn.onclick = saveStatsConfig;
    
    // Yopish tugmalari
    modal.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => modal.classList.add('hidden');
    });
    
    // Maksimal 6 ta tanlash cheklovi
    optionsGrid.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const checkedCount = optionsGrid.querySelectorAll('input[type="checkbox"]:checked').length;
            if (checkedCount > 6) {
                e.target.checked = false;
                showToast('Maksimal 6 ta statistika tanlashingiz mumkin!', true);
            }
        });
    });
}

function saveStatsConfig() {
    const optionsGrid = document.getElementById('stats-options-grid');
    const selected = Array.from(optionsGrid.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    
    if (selected.length === 0) {
        showToast('Kamida bitta statistika tanlang!', true);
        return;
    }
    
    saveSelectedStats(selected);
    document.getElementById('stats-config-modal').classList.add('hidden');
    
    // Dashboard'ni yangilash
    const datePickerFP = state.dashboardDatePickerFP || flatpickr('#dashboard-date-picker');
    if (datePickerFP && datePickerFP.selectedDates[0]) {
        updateDashboard(flatpickr.formatDate(datePickerFP.selectedDates[0], 'Y-m-d'));
    }
    
    showToast('Sozlamalar saqlandi!');
}

function openChartsConfigModal() {
    const modal = document.getElementById('charts-config-modal');
    const optionsGrid = document.getElementById('charts-options-grid');
    const selectedCharts = getSelectedCharts();
    
    optionsGrid.innerHTML = Object.entries(availableCharts).map(([key, chart]) => `
        <label class="chart-option">
            <input type="checkbox" name="chart-option" value="${key}" ${selectedCharts.includes(key) ? 'checked' : ''}>
            <div class="chart-option-card">
                <div class="chart-option-header">
                    <i data-feather="bar-chart-2" style="color: ${chart.color};"></i>
                    <span class="chart-option-title">${chart.label}</span>
                </div>
                <p class="chart-option-desc">${chart.description}</p>
            </div>
        </label>
    `).join('');
    
    feather.replace();
    modal.classList.remove('hidden');
    
    // Saqlash tugmasi
    const saveBtn = document.getElementById('save-charts-config-btn');
    saveBtn.onclick = saveChartsConfig;
    
    // Yopish tugmalari
    modal.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => modal.classList.add('hidden');
    });
    
    // Maksimal 3 ta tanlash cheklovi
    optionsGrid.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const checkedCount = optionsGrid.querySelectorAll('input[type="checkbox"]:checked').length;
            if (checkedCount > 3) {
                e.target.checked = false;
                showToast('Maksimal 3 ta grafik tanlashingiz mumkin!', true);
            }
        });
    });
}

function saveChartsConfig() {
    const optionsGrid = document.getElementById('charts-options-grid');
    const selected = Array.from(optionsGrid.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    
    if (selected.length === 0) {
        showToast('Kamida bitta grafik tanlang!', true);
        return;
    }
    
    saveSelectedCharts(selected);
    document.getElementById('charts-config-modal').classList.add('hidden');
    
    // Dashboard'ni yangilash
    const datePickerFP = state.dashboardDatePickerFP || flatpickr('#dashboard-date-picker');
    if (datePickerFP && datePickerFP.selectedDates[0]) {
        updateDashboard(flatpickr.formatDate(datePickerFP.selectedDates[0], 'Y-m-d'));
    }
    
    showToast('Grafik sozlamalari saqlandi!');
}

async function renderCharts(date) {
    const selectedCharts = getSelectedCharts();
    const chartsContainer = document.getElementById('charts-container');
    
    if (!chartsContainer) return;
    
    // Eski grafiklarni tozalash
    Object.values(chartInstances).forEach(chart => chart?.destroy());
    
    // Grid class qo'shish
    const gridClass = selectedCharts.length === 1 ? 'single' : 
                      selectedCharts.length === 2 ? 'double' : 'triple';
    chartsContainer.className = `charts-grid ${gridClass}`;
    
    // Container'ni yangilash
    const isSingle = selectedCharts.length === 1;
    chartsContainer.innerHTML = selectedCharts.map((chartKey, index) => {
        const expandHint = !isSingle ? '<span class="chart-expand-hint"><i data-feather="maximize-2"></i> Kattalashtirish</span>' : '';
        return `
            <div id="chart-${index}" class="chart-wrapper ${isSingle ? 'single-chart' : ''}" data-chart-key="${chartKey}" style="height: 300px; position: relative;">
                <h4 class="chart-subtitle">
                    ${availableCharts[chartKey].label}
                    ${expandHint}
                </h4>
                <canvas id="canvas-${chartKey}"></canvas>
            </div>
        `;
    }).join('');
    
    // Har bir grafik uchun ma'lumotlarni yuklash va chizish
    for (const chartKey of selectedCharts) {
        try {
            const res = await safeFetch(`/api/dashboard/chart-data?type=${chartKey}&date=${date}`);
            if (!res || !res.ok) continue;
            
            const chartData = await res.json();
            renderSingleChart(chartKey, chartData.data);
        } catch (error) {
            console.error(`${chartKey} grafikini yuklashda xatolik:`, error);
        }
    }
    
    // Feather ikonlarini yangilash
    feather.replace();
    
    // Chart wrapper'larga click event qo'shish (faqat 2 yoki 3 ta bo'lsa)
    if (selectedCharts.length > 1) {
        document.querySelectorAll('.chart-wrapper:not(.single-chart)').forEach(wrapper => {
            wrapper.addEventListener('click', () => {
                const chartKey = wrapper.dataset.chartKey;
                openChartFullscreen(chartKey);
            });
        });
    }
}

function renderSingleChart(chartKey, data) {
    const canvas = document.getElementById(`canvas-${chartKey}`);
    if (!canvas) return;
    
    const chartConfig = availableCharts[chartKey];
    const ctx = canvas.getContext('2d');
    
    let chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { 
                display: chartConfig.type === 'doughnut',
                position: 'bottom',
                labels: { color: '#a0a0a0', font: { size: 12 } }
            },
            tooltip: {
                backgroundColor: '#1a1c23',
                titleFont: { size: 14, weight: 'bold' },
                bodyFont: { size: 12 },
                padding: 10,
                cornerRadius: 8
            }
        }
    };
    
    let chartData = {};
    
    switch(chartKey) {
        case 'weekly':
        case 'monthly':
        case 'edited_reports':
            chartData = {
                labels: data.map(d => new Date(d.date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })),
                datasets: [{
                    label: chartConfig.label,
                    data: data.map(d => d.count),
                    fill: chartConfig.type === 'line',
                    backgroundColor: chartConfig.type === 'line' 
                        ? chartConfig.color + '33' 
                        : chartConfig.color,
                    borderColor: chartConfig.color,
                    tension: 0.3,
                    pointBackgroundColor: chartConfig.color,
                    pointBorderColor: '#fff',
                    pointHoverRadius: 7,
                }]
            };
            chartOptions.scales = {
                y: { 
                    beginAtZero: true, 
                    ticks: { color: '#a0a0a0', stepSize: 1 }, 
                    grid: { color: '#3a3d4a' } 
                },
                x: { 
                    ticks: { color: '#a0a0a0' }, 
                    grid: { display: false } 
                }
            };
            break;
            
        case 'by_brand':
            chartData = {
                labels: data.map(d => d.brand),
                datasets: [{
                    label: chartConfig.label,
                    data: data.map(d => d.count),
                    backgroundColor: data.map(d => d.color),
                    borderColor: data.map(d => d.color),
                    borderWidth: 1
                }]
            };
            chartOptions.scales = {
                y: { 
                    beginAtZero: true, 
                    ticks: { color: '#a0a0a0', stepSize: 1 }, 
                    grid: { color: '#3a3d4a' } 
                },
                x: { 
                    ticks: { color: '#a0a0a0', maxRotation: 45, minRotation: 45 }, 
                    grid: { display: false } 
                }
            };
            break;
            
        case 'late_vs_ontime':
            chartData = {
                labels: ['O\'z Vaqtida', 'Kechikkan'],
                datasets: [{
                    data: [data.onTime, data.late],
                    backgroundColor: ['#28a745', '#ffc107'],
                    borderWidth: 2,
                    borderColor: '#1a1c23'
                }]
            };
            break;
    }
    
    const chart = new Chart(ctx, {
        type: chartConfig.type,
        data: chartData,
        options: chartOptions
    });
    
    chartInstances[chartKey] = chart;
}

function filterLocations() {
    const locationFilter = document.getElementById('location-filter');
    const selectedLocation = locationFilter?.value || 'all';
    const activeFilter = document.querySelector('#location-filters .filter-btn.active')?.dataset.filter || 'all';
    const cards = document.querySelectorAll('#daily-status-grid .status-card');
    
    let visibleCount = 0;
    let submittedCount = 0;
    let notSubmittedCount = 0;
    let editedCount = 0;
    
    cards.forEach(card => {
        // Filial nomini olish
        const locationNameEl = card.querySelector('.location-name');
        const locationName = locationNameEl ? locationNameEl.textContent.trim() : '';
        
        const matchesLocation = selectedLocation === 'all' || locationName === selectedLocation;
        
        let matchesFilter = true;
        if (activeFilter === 'submitted') {
            matchesFilter = card.classList.contains('submitted') && !card.classList.contains('edited');
        } else if (activeFilter === 'not-submitted') {
            matchesFilter = card.classList.contains('not-submitted');
        } else if (activeFilter === 'edited') {
            matchesFilter = card.classList.contains('edited');
        }
        
        if (matchesLocation && matchesFilter) {
            card.classList.remove('hidden');
            card.style.display = ''; // CSS display ni to'g'rilash
            visibleCount++;
        } else {
            card.classList.add('hidden');
            card.style.display = 'none'; // Majburiy yashirish
        }
        
        // Hisoblash
        if (card.classList.contains('submitted') && !card.classList.contains('edited')) submittedCount++;
        if (card.classList.contains('not-submitted')) notSubmittedCount++;
        if (card.classList.contains('edited')) editedCount++;
    });
    
    // Summaryni yangilash
    updateLocationsSummary(submittedCount, notSubmittedCount, editedCount, visibleCount);
}

function updateLocationsSummary(submitted, notSubmitted, edited, visible) {
    const summary = document.getElementById('locations-summary');
    if (!summary) return;
    
    const total = submitted + notSubmitted;
    
    summary.innerHTML = `
        <div class="summary-item" style="color: var(--text-secondary);">
            <i data-feather="grid"></i>
            <span>Jami:</span>
            <span class="count">${total}</span>
        </div>
        <div class="summary-item" style="color: var(--green-color);">
            <i data-feather="check-circle"></i>
            <span>Topshirilgan:</span>
            <span class="count">${submitted}</span>
        </div>
        <div class="summary-item" style="color: var(--red-color);">
            <i data-feather="x-circle"></i>
            <span>Topshirilmagan:</span>
            <span class="count">${notSubmitted}</span>
        </div>
        <div class="summary-item" style="color: var(--cyan-color);">
            <i data-feather="edit-3"></i>
            <span>Tahrirlangan:</span>
            <span class="count">${edited}</span>
        </div>
        ${visible < total ? `
        <div class="summary-item" style="color: var(--blue-color);">
            <i data-feather="filter"></i>
            <span>Ko'rsatilmoqda:</span>
            <span class="count">${visible}</span>
        </div>
        ` : ''}
    `;
    
    feather.replace();
}

function toggleView(view) {
    const grid = document.getElementById('daily-status-grid');
    if (!grid) return;
    
    if (view === 'list') {
        grid.classList.add('list-view');
    } else {
        grid.classList.remove('list-view');
    }
}

// Fullscreen chart instance
let fullscreenChartInstance = null;

async function openChartFullscreen(chartKey) {
    const modal = document.getElementById('chart-fullscreen-modal');
    const title = document.getElementById('fullscreen-chart-title');
    const canvas = document.getElementById('fullscreen-chart-canvas');
    
    if (!modal || !canvas) return;
    
    // Modal'ni ochish
    modal.classList.remove('hidden');
    title.textContent = availableCharts[chartKey].label;
    
    // Eski grafikni tozalash
    if (fullscreenChartInstance) {
        fullscreenChartInstance.destroy();
    }
    
    // Ma'lumotlarni olish
    try {
        const datePickerFP = state.dashboardDatePickerFP || flatpickr('#dashboard-date-picker');
        const date = datePickerFP && datePickerFP.selectedDates[0] 
            ? flatpickr.formatDate(datePickerFP.selectedDates[0], 'Y-m-d')
            : flatpickr.formatDate(new Date(), 'Y-m-d');
        
        const res = await safeFetch(`/api/dashboard/chart-data?type=${chartKey}&date=${date}`);
        if (!res || !res.ok) return;
        
        const chartData = await res.json();
        
        // Fullscreen grafikni chizish
        const chartConfig = availableCharts[chartKey];
        const ctx = canvas.getContext('2d');
        
        let chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: chartConfig.type === 'doughnut',
                    position: 'bottom',
                    labels: { color: '#a0a0a0', font: { size: 14 } }
                },
                tooltip: {
                    backgroundColor: '#1a1c23',
                    titleFont: { size: 16, weight: 'bold' },
                    bodyFont: { size: 14 },
                    padding: 12,
                    cornerRadius: 8
                }
            }
        };
        
        let data = chartData.data;
        let finalChartData = {};
        
        switch(chartKey) {
            case 'weekly':
            case 'monthly':
            case 'edited_reports':
                finalChartData = {
                    labels: data.map(d => new Date(d.date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })),
                    datasets: [{
                        label: chartConfig.label,
                        data: data.map(d => d.count),
                        fill: chartConfig.type === 'line',
                        backgroundColor: chartConfig.type === 'line' 
                            ? chartConfig.color + '33' 
                            : chartConfig.color,
                        borderColor: chartConfig.color,
                        tension: 0.3,
                        pointBackgroundColor: chartConfig.color,
                        pointBorderColor: '#fff',
                        pointHoverRadius: 9,
                        pointRadius: 5,
                        borderWidth: 3
                    }]
                };
                chartOptions.scales = {
                    y: { 
                        beginAtZero: true, 
                        ticks: { color: '#a0a0a0', stepSize: 1, font: { size: 12 } }, 
                        grid: { color: '#3a3d4a' } 
                    },
                    x: { 
                        ticks: { color: '#a0a0a0', font: { size: 12 } }, 
                        grid: { display: false } 
                    }
                };
                break;
                
            case 'by_brand':
                finalChartData = {
                    labels: data.map(d => d.brand),
                    datasets: [{
                        label: chartConfig.label,
                        data: data.map(d => d.count),
                        backgroundColor: data.map(d => d.color),
                        borderColor: data.map(d => d.color),
                        borderWidth: 2
                    }]
                };
                chartOptions.scales = {
                    y: { 
                        beginAtZero: true, 
                        ticks: { color: '#a0a0a0', stepSize: 1, font: { size: 12 } }, 
                        grid: { color: '#3a3d4a' } 
                    },
                    x: { 
                        ticks: { color: '#a0a0a0', maxRotation: 45, minRotation: 45, font: { size: 12 } }, 
                        grid: { display: false } 
                    }
                };
                break;
                
            case 'late_vs_ontime':
                finalChartData = {
                    labels: ['O\'z Vaqtida', 'Kechikkan'],
                    datasets: [{
                        data: [data.onTime, data.late],
                        backgroundColor: ['#28a745', '#ffc107'],
                        borderWidth: 3,
                        borderColor: '#1a1c23'
                    }]
                };
                break;
        }
        
        fullscreenChartInstance = new Chart(ctx, {
            type: chartConfig.type,
            data: finalChartData,
            options: chartOptions
        });
        
    } catch (error) {
        console.error('Fullscreen grafikni yuklashda xatolik:', error);
        showToast('Grafikni yuklashda xatolik', true);
    }
}

function closeChartFullscreen() {
    const modal = document.getElementById('chart-fullscreen-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    if (fullscreenChartInstance) {
        fullscreenChartInstance.destroy();
        fullscreenChartInstance = null;
    }
}

// Modal yopish tugmasi
document.getElementById('close-chart-fullscreen')?.addEventListener('click', closeChartFullscreen);

// Modal tashqarisiga click qilganda yopish
document.getElementById('chart-fullscreen-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'chart-fullscreen-modal') {
        closeChartFullscreen();
    }
});

// ESC tugmasi bilan yopish
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('chart-fullscreen-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeChartFullscreen();
        }
    }
});

export async function updateDashboard(date) {
    if (!hasPermission(state.currentUser, 'dashboard:view') || !date) return;
    
    DOM.statsGrid.innerHTML = Array(3).fill('<div class="skeleton-item" style="height: 80px;"></div>').join('');
    DOM.dailyStatusGrid.innerHTML = '<div class="skeleton-item" style="grid-column: 1 / -1; height: 100px;"></div>';
    
    if (DOM.dashboardSelectedDate) {
        DOM.dashboardSelectedDate.textContent = new Date(date).toLocaleDateString('uz-UZ', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        });
    }
    
    try {
        const res = await safeFetch(`/api/dashboard/stats?date=${date}`);
        if (!res || !res.ok) throw new Error('Statusni yuklab bo\'lmadi');
        const data = await res.json();
        
        const { totalUsers, totalLocations } = data.generalStats;
        const { submittedCount } = data.dailyStatus;
        const additional = data.additionalStats || {};
        
        // Tanlangan statistikalarni olish
        const selectedStats = getSelectedStats();
        
        // Ma'lumotlar mapping
        const statsData = {
            totalUsers: totalUsers,
            totalLocations: totalLocations,
            dailySubmitted: submittedCount,
            totalReports: additional.totalReports || 0,
            editedReports: additional.editedReports || 0,
            lateReports: additional.lateReports || 0,
            onTimeReports: additional.onTimeReports || 0,
            activeUsers: additional.activeUsers || 0,
            pendingUsers: additional.pendingUsers || 0,
            notSubmitted: additional.notSubmittedCount || 0
        };
        
        // Statistika kartalarini render qilish (tanlangan statistikalar asosida)
        DOM.statsGrid.innerHTML = selectedStats.map((key, index) => {
            const stat = availableStats[key];
            if (!stat) return '';
            
            const value = statsData[key] || 0;
            const delay = index * 0.1;
            
            // Maxsus stil va qo'shimcha ma'lumot
            let extraInfo = '';
            if (key === 'dailySubmitted' && totalLocations > 0) {
                const percent = ((value / totalLocations) * 100).toFixed(1);
                extraInfo = `<span class="stat-percent" style="color: var(--green-color); font-size: 14px; margin-left: 8px;">(${percent}%)</span>`;
            }
            
            const bgColor = stat.color + '1a'; // Add transparency
            
            return `
                <div class="stat-card" style="animation: slideInUp 0.5s ease-out ${delay}s; animation-fill-mode: both;">
                    <div class="stat-icon" style="background-color: ${bgColor};">
                        <i data-feather="${stat.icon}" style="color: ${stat.color};"></i>
                    </div>
                    <div class="stat-info">
                        <span class="stat-label">${stat.label}</span>
                        <span class="stat-value" data-value="${value}">0</span>
                        ${extraInfo}
                    </div>
                </div>
            `;
        }).join('');
        
        // Animated counters
        setTimeout(() => {
            document.querySelectorAll('.stat-value[data-value]').forEach(el => {
                const targetValue = parseInt(el.dataset.value);
                animateValue(el, 0, targetValue, 1000);
            });
        }, 100);
        
        // Filiallar filterini to'ldirish
        const locationFilter = document.getElementById('location-filter');
        if (locationFilter && data.dailyStatus.statusData) {
            const currentValue = locationFilter.value;
            const locations = data.dailyStatus.statusData.map(item => item.name).sort();
            locationFilter.innerHTML = '<option value="all">Barcha filiallar</option>' + 
                locations.map(name => `<option value="${name}">${name}</option>`).join('');
            // Avvalgi tanlovni saqlash
            if (currentValue && locations.includes(currentValue)) {
                locationFilter.value = currentValue;
            }
        }
        
        // Kunlik status gridini render qilish
        DOM.dailyStatusGrid.innerHTML = data.dailyStatus.statusData.map(item => {
            let cardClass = item.submitted ? 'submitted' : 'not-submitted';
            let statusIcon = item.submitted ? 'check-circle' : 'x-circle';
            let statusText = item.submitted ? 'Topshirilgan' : 'Topshirilmagan';
            let statusColor = item.submitted ? 'var(--green-color)' : 'var(--red-color)';
            let tooltipHtml = '';
            
            if (item.is_edited && item.edit_info) {
                cardClass = 'edited';
                statusIcon = 'edit-3';
                statusText = 'Tahrirlangan';
                statusColor = 'var(--cyan-color)';
                tooltipHtml = `
                    <div class="tooltip">
                        <div class="tooltip-row"><span>Tahrirlangan:</span> <span>${item.edit_info.count} marta</span></div>
                        <div class="tooltip-row"><span>Oxirgi tahrir:</span> <span>${item.edit_info.last_by || 'N/A'}</span></div>
                        <div class="tooltip-row"><span>Vaqti:</span> <span>${new Date(item.edit_info.last_at).toLocaleString('uz-UZ')}</span></div>
                    </div>`;
            } else if (item.submitted) {
                tooltipHtml = `<div class="tooltip"><div class="tooltip-row"><span>Topshirdi:</span> <span>${item.creator || 'N/A'}</span></div></div>`;
            }
            
            if (item.late_comment) {
                if (tooltipHtml && tooltipHtml.includes('tooltip-row')) {
                    tooltipHtml = tooltipHtml.replace('</div></div>', 
                        `<div class="tooltip-row"><span>Kechikish sababi:</span> <span>${item.late_comment}</span></div></div></div>`);
                } else {
                    tooltipHtml = `<div class="tooltip"><div class="tooltip-row"><span>Kechikish sababi:</span> <span>${item.late_comment}</span></div></div>`;
                }
            }
            
            return `
                <div class="status-card ${cardClass}">
                    <div class="location-name">${item.name}</div>
                    <div class="location-badge ${cardClass}">
                        <i data-feather="${statusIcon}"></i>
                        <span>${statusText}</span>
                    </div>
                    ${tooltipHtml}
                </div>`;
        }).join('');
        
        // Statistikani yangilash va filtrni qo'llash
        feather.replace();
        
        // Filtrni qo'llash (dropdown tanlangan bo'lsa)
        filterLocations();
        
        // Grafiklarni render qilish
        await renderCharts(date);
        
    } catch (error) {
        const errorMessage = `<div class="empty-state error" style="grid-column: 1 / -1;">${error.message || 'Dashboard ma\'lumotlarini yuklashda xatolik.'}</div>`;
        DOM.statsGrid.innerHTML = errorMessage;
        DOM.dailyStatusGrid.innerHTML = errorMessage;
    }
}
