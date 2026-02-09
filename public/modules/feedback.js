export class FeedbackManager {
    constructor() {
        this.tableBody = document.getElementById('feedback-table-body');
        this.typeFilter = document.getElementById('feedback-type-filter');
        this.datePicker = document.getElementById('feedback-date-picker');
        this.limitSelect = document.getElementById('feedback-limit-select');
        this.paginationContainer = document.getElementById('feedback-pagination');
        this.exportBtn = document.getElementById('export-feedback-btn');

        this.currentPage = 1;
        this.currentData = [];
        this.pagination = { total: 0, pages: 1, currentPage: 1, limit: 20 };

        this.setupEventListeners();
    }

    setupEventListeners() {
        if (this.typeFilter && !this.typeFilter.dataset.listener) {
            this.typeFilter.addEventListener('change', () => {
                this.currentPage = 1;
                this.fetchFeedback();
            });
            this.typeFilter.dataset.listener = 'true';
        }

        if (this.limitSelect && !this.limitSelect.dataset.listener) {
            this.limitSelect.addEventListener('change', () => {
                this.currentPage = 1;
                this.fetchFeedback();
            });
            this.limitSelect.dataset.listener = 'true';
        }

        if (this.exportBtn && !this.exportBtn.dataset.listener) {
            this.exportBtn.addEventListener('click', () => this.exportToExcel());
            this.exportBtn.dataset.listener = 'true';
        }

        if (this.datePicker && !this.datePicker._flatpickr) {
            flatpickr(this.datePicker, {
                mode: "range",
                dateFormat: "Y-m-d",
                onChange: (selectedDates) => {
                    if (selectedDates.length === 2) {
                        this.currentPage = 1;
                        this.fetchFeedback();
                    }
                }
            });
        }
    }

    async fetchFeedback() {
        try {
            const typeValue = this.typeFilter ? this.typeFilter.value : '';
            const limitValue = this.limitSelect ? this.limitSelect.value : 20;
            let url = `/api/feedback?type=${typeValue}&page=${this.currentPage}&limit=${limitValue}`;

            if (this.datePicker && this.datePicker._flatpickr && this.datePicker._flatpickr.selectedDates.length === 2) {
                const dates = this.datePicker._flatpickr.selectedDates;
                const start = dates[0].toISOString().split('T')[0];
                const end = dates[1].toISOString().split('T')[0];
                url += `&startDate=${start}&endDate=${end}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            this.currentData = data.feedbacks;
            this.pagination = data.pagination;
            this.renderFeedback(data.feedbacks);
            this.renderPagination();
        } catch (error) {
            console.error('Feedback fetch error:', error);
            if (this.tableBody) {
                this.tableBody.innerHTML = '<tr><td colspan="7" class="text-danger">Murojaatlarni yuklashda xatolik yuz berdi.</td></tr>';
            }
        }
    }

    renderFeedback(feedbacks) {
        if (!this.tableBody) return;

        if (!feedbacks || feedbacks.length === 0) {
            this.tableBody.innerHTML = '<tr><td colspan="7" class="text-secondary text-center">Murojaatlar topilmadi.</td></tr>';
            return;
        }

        const html = feedbacks.map((fb, index) => {
            const date = fb.created_at ? new Date(fb.created_at).toLocaleString('uz-UZ') : 'Noma\'lum';
            const typeBadge = fb.type === 'shikoyat' ?
                '<span class="badge badge-danger">Shikoyat</span>' :
                '<span class="badge badge-primary">Taklif</span>';

            const statusBadge = fb.status === 'new' ?
                '<span class="badge badge-warning">Yangi</span>' :
                '<span class="badge badge-success">O\'qildi</span>';

            // Global index bo'yicha tartib raqami
            const globalIndex = (this.pagination.currentPage - 1) * this.pagination.limit + index + 1;

            return `
                <tr class="feedback-row">
                    <td><span class="serial-num">${globalIndex}</span></td>
                    <td class="date-cell">${date}</td>
                    <td class="user-cell">
                        <div class="user-info">
                            <span class="fullname">${this.escapeHtml(fb.fullname || 'Anonim')}</span>
                            <span class="username">@${this.escapeHtml(fb.username || '-')}</span>
                        </div>
                    </td>
                    <td>${typeBadge}</td>
                    <td class="feedback-message-cell">
                        <div class="message-content" title="${this.escapeHtml(fb.message)}">
                            ${this.escapeHtml(fb.message)}
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn feedback-status-btn" data-id="${fb.id}" title="O'qildi deb belgilash">
                                <i data-feather="check-circle"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        this.tableBody.innerHTML = html;

        // Add event listeners to buttons
        this.tableBody.querySelectorAll('.feedback-status-btn').forEach(btn => {
            btn.onclick = () => this.updateStatus(btn.dataset.id, 'read');
        });

        if (window.feather) feather.replace();
    }

    renderPagination() {
        if (!this.paginationContainer) return;
        const { pages, currentPage } = this.pagination;

        if (pages <= 1) {
            this.paginationContainer.innerHTML = '';
            return;
        }

        let html = `
            <div class="feedback-pagination-controls">
                <button class="pagination-nav-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="state.feedbackManager.goToPage(${currentPage - 1})">
                    <i data-feather="chevron-left"></i>
                </button>
                <div class="pagination-pages-info">
                    <span class="current-page">${currentPage}</span>
                    <span class="page-divider">/</span>
                    <span class="total-pages">${pages}</span>
                </div>
                <button class="pagination-nav-btn" ${currentPage === pages ? 'disabled' : ''} onclick="state.feedbackManager.goToPage(${currentPage + 1})">
                    <i data-feather="chevron-right"></i>
                </button>
            </div>
        `;
        this.paginationContainer.innerHTML = html;
        if (window.feather) feather.replace();
    }

    goToPage(page) {
        if (page < 1 || page > this.pagination.pages) return;
        this.currentPage = page;
        this.fetchFeedback();
    }

    async updateStatus(id, status) {
        try {
            const response = await fetch('/api/feedback/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status })
            });

            if (response.ok) {
                this.fetchFeedback();
            }
        } catch (error) {
            console.error('Status update error:', error);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    exportToExcel() {
        if (!this.currentData || this.currentData.length === 0) {
            alert('Eksport qilish uchun ma\'lumotlar mavjud emas.');
            return;
        }

        const dataToExport = this.currentData.map((fb, index) => ({
            '#': (this.pagination.currentPage - 1) * this.pagination.limit + index + 1,
            'Sana': fb.created_at ? new Date(fb.created_at).toLocaleString('uz-UZ') : 'Noma\'lum',
            'Foydalanuvchi': fb.fullname || 'Anonim',
            'Username': fb.username ? `@${fb.username}` : '-',
            'Turi': fb.type === 'shikoyat' ? 'Shikoyat' : 'Taklif',
            'Xabar': fb.message,
            'Holati': fb.status === 'new' ? 'Yangi' : 'O\'qildi'
        }));

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Murojaatlar");

        // Ustun kengliklarini sozlash
        const wscols = [
            { wch: 5 },  // #
            { wch: 20 }, // Sana
            { wch: 25 }, // Foydalanuvchi
            { wch: 20 }, // Username
            { wch: 15 }, // Turi
            { wch: 50 }, // Xabar
            { wch: 15 }  // Holati
        ];
        worksheet['!cols'] = wscols;

        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(workbook, `Murojaatlar_${dateStr}.xlsx`);
    }
}
