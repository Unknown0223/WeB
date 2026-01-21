// Navigation Module
// Sahifalar orasida navigatsiya va permissions

import { state } from './state.js';
import { DOM } from './dom.js';
import { hasPermission, hidePageLoader } from './utils.js';
import { setupKpiPage } from './kpi.js';
import { setupPivot } from './pivot.js';
import { fetchAndRenderAuditLogs, renderAuditLogTable, renderAuditLogPagination } from './audit.js';
import { fetchAndRenderMySessions } from './security.js';

export function applyPermissions() {
    const userPermissions = state.currentUser.permissions || [];
    
    // Ruxsatlar mapping (tahrirlash ruxsati bo'lsa, ko'rish ruxsati ham beriladi)
    const permissionMapping = {
        'reports:edit_all': 'reports:view_all',
        'reports:edit_assigned': 'reports:view_assigned',
        'reports:edit_own': 'reports:view_own'
    };
    
    // Virtual permissions qo'shish (tahrirlash ruxsati bo'lsa, ko'rish ruxsati ham qo'shiladi)
    const virtualPermissions = [...userPermissions];
    userPermissions.forEach(perm => {
        if (permissionMapping[perm] && !virtualPermissions.includes(permissionMapping[perm])) {
            virtualPermissions.push(permissionMapping[perm]);
        }
    });
    
    document.querySelectorAll('[data-permission]').forEach(el => {
        const requiredPermissions = el.dataset.permission.split(',').map(p => p.trim());
        const hasRequiredPermission = requiredPermissions.some(p => virtualPermissions.includes(p));
        if (!hasRequiredPermission) {
            el.style.display = 'none';
        } else {
            el.style.display = '';
        }
    });
    
    // Xavfsizlik sahifasi har doim ko'rinadi
    const securityLink = document.querySelector('.nav-link[data-page="security"]');
    if (securityLink) {
        securityLink.style.display = 'flex';
    }
}

export async function navigateTo(pageId, hideLoaderAfter = false) {
    if (!pageId) pageId = 'dashboard';
    
    const targetPage = document.getElementById(pageId);
    const targetLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    
    if (targetPage && targetLink && (targetLink.style.display !== 'none')) {
        // Avval hamma sahifalarni yashiramiz (ko'rinmaslik uchun)
        // Animatsiyalarni to'xtatish uchun transition'ni o'chirish
        DOM.pages.forEach(p => {
            p.style.transition = 'none';
            p.classList.remove('active');
            // Transform'ni reset qilish
            p.style.transform = 'translateY(0)';
            p.style.opacity = '0';
        });
        
        // Kichik kechikish - DOM yangilanishi uchun
        requestAnimationFrame(() => {
            // Keyin kerakli sahifani ko'rsatamiz
            targetPage.style.transition = '';
            targetPage.style.display = 'block';
            targetPage.style.opacity = '1';
            targetPage.style.visibility = 'visible';
            targetPage.classList.add('active');
            
            // Linkni active qilamiz
            document.querySelectorAll('.nav-link.active').forEach(l => {
                l.classList.remove('active');
                // Transform'ni reset qilish
                l.style.transform = '';
            });
            targetLink.classList.add('active');
            
            window.location.hash = pageId;
        });
        
        // Sahifa-specific logikalar (sahifa ko'rsatilgandan keyin)
        setTimeout(() => {
            if (pageId === 'audit-log' && hasPermission(state.currentUser, 'audit:view')) {
                if (state.auditLog.initialLoad) {
                    renderAuditLogTable();
                    renderAuditLogPagination();
                }
            }
            
            if (pageId === 'pivot-reports' && !state.pivotGrid) {
                setupPivot();
            }
            
            if (pageId === 'comparison' && hasPermission(state.currentUser, 'comparison:view')) {
                (async () => {
                    try {
                        const { setupComparison } = await import('./comparison.js');
                        await setupComparison();
                    } catch (error) {
                        console.error('Comparison modulini yuklashda xatolik:', error);
                    }
                })();
            }
            
            if (pageId === 'security') {
                fetchAndRenderMySessions();
            }
            
            if (pageId === 'employee-statistics' && hasPermission(state.currentUser, 'dashboard:view')) {
                // Elementlarni ko'rsatish
                const statsGrid = document.getElementById('kpi-stats-grid');
                const topCard = document.getElementById('top-performers-card');
                const detailsView = document.getElementById('employee-details-view');
                
                if (statsGrid) statsGrid.style.display = 'grid';
                if (topCard && state.kpi.data.length >= 3) topCard.style.display = 'block';
                if (detailsView) detailsView.style.display = 'none';
                
                // Agar ma'lumotlar yo'q bo'lsa, yuklash
                if (!state.kpi.data || state.kpi.data.length === 0) {
                    setupKpiPage();
                }
            }
            
            if (pageId === 'debt-approval' && hasPermission(state.currentUser, 'roles:manage')) {
                (async () => {
                    try {
                        const { loadDebtApprovalPage } = await import('./debtApproval.js');
                        loadDebtApprovalPage();
                    } catch (error) {
                        console.error('Debt-approval sahifasini yuklashda xatolik:', error);
                    }
                })();
            }
            
            
            // Agar loader yashirilishi kerak bo'lsa
            if (hideLoaderAfter) {
                // Sahifa to'liq render bo'lguncha biroz kutish (100ms - tezroq)
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        hidePageLoader();
                    }, 100);
                });
            }
        }, 100);
    }
}

export function handleNavigation(e) {
    const link = e.target.closest('.nav-link');
    if (!link) return;
    e.preventDefault();
    navigateTo(link.dataset.page);
}
