// State Management Module
// Barcha global holatlarni boshqarish

export const state = {
    settings: { 
        app_settings: { columns: [], rows: [], locations: [] }, 
        pagination_limit: 20,
        branding_settings: { text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' },
        telegram_bot_username: '',
        kpi_settings: { latePenalty: 0.5, editPenalty: 0.3 }
    },
    users: [],
    pendingUsers: [],
    roles: [],
    allPermissions: {},
    currentUser: null,
    pivotGrid: null,
    pivotTemplates: [],
    currentEditingRole: null,
    auditLog: {
        logs: [],
        pagination: { total: 0, pages: 1, currentPage: 1 },
        filters: { userId: '', startDate: '', endDate: '', actionType: '' },
        initialLoad: true
    },
    mySessions: [],
    kpi: {
        data: [],
        currentSort: {
            key: 'kpiScore',
            direction: 'desc'
        },
        selectedMonth: ''
    }
};

// Flatpickr va Chart.js instansiyalari
export let dashboardDatePickerFP = null;
export let auditDatePickerFP = null;
export let pivotDatePickerFP = null;
export let weeklyChartInstance = null;

export function setDashboardDatePicker(instance) {
    dashboardDatePickerFP = instance;
}

export function setAuditDatePicker(instance) {
    auditDatePickerFP = instance;
}

export function setPivotDatePicker(instance) {
    pivotDatePickerFP = instance;
}

export function setWeeklyChartInstance(instance) {
    weeklyChartInstance = instance;
}

export function getState() {
    return state;
}
