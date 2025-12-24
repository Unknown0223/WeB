// Universal Modal System
// Barcha modal'lar uchun umumiy tizim

import { createLogger } from './utils.js';

const log = createLogger('MODAL');

/**
 * Modal instance - har bir modal uchun alohida instance
 */
class ModalInstance {
    constructor(modalElement, config = {}) {
        this.modal = modalElement;
        this.config = {
            closeOnBackdrop: config.closeOnBackdrop !== false, // Default: true
            closeOnEscape: config.closeOnEscape !== false, // Default: true
            animationDuration: config.animationDuration || 300,
            onOpen: config.onOpen || null,
            onClose: config.onClose || null,
            ...config
        };
        
        this.isOpen = false;
        this.isOpening = false;
        this.isClosing = false;
        this.listeners = [];
        this.timeouts = [];
        
        this.init();
    }
    
    init() {
        if (!this.modal) {
            log.error('Modal element topilmadi');
            return;
        }
        
        // Modal yopish handler'larini sozlash
        this.setupCloseHandlers();
    }
    
    /**
     * Modal ochish
     */
    async open(data = {}) {
        // Agar modal allaqachon ochilmoqda yoki ochiq bo'lsa, qayta ochmaslik
        if (this.isOpening) {
            log.debug('Modal ochilmoqda, qayta ochilmaydi');
            return;
        }
        
        // Agar modal allaqachon ochiq bo'lsa, faqat ma'lumotlarni yangilash
        if (this.isOpen) {
            log.debug('Modal allaqachon ochiq, ma\'lumotlar yangilanmoqda');
            if (this.config.onOpen) {
                await this.config.onOpen(data, this);
            }
            return;
        }
        
        this.isOpening = true;
        
        try {
            // onOpen callback chaqirish
            if (this.config.onOpen) {
                await this.config.onOpen(data, this);
            }
            
            // Modal'ni ko'rsatish
            this.modal.classList.remove('hidden');
            this.modal.style.display = 'flex';
            
            // Animation
            setTimeout(() => {
                this.modal.classList.add('show');
            }, 10);
            
            this.isOpen = true;
            this.isOpening = false;
            
            // ESC tugmasi listener
            if (this.config.closeOnEscape) {
                // Eski ESC listener'ni olib tashlash
                const oldEscListener = this.listeners.find(l => l.type === 'keydown' && l.element === document);
                if (oldEscListener) {
                    document.removeEventListener('keydown', oldEscListener.handler);
                    this.listeners = this.listeners.filter(l => l !== oldEscListener);
                }
                
                const escHandler = (e) => {
                    if (e.key === 'Escape' && this.isOpen) {
                        this.close();
                    }
                };
                document.addEventListener('keydown', escHandler);
                this.listeners.push({ type: 'keydown', handler: escHandler, element: document });
            }
            
            log.debug('Modal ochildi');
        } catch (error) {
            log.error('Modal ochishda xatolik:', error);
            this.isOpening = false;
            this.isOpen = false;
        }
    }
    
    /**
     * Modal yopish
     */
    async close() {
        if (this.isClosing || !this.isOpen) {
            return;
        }
        
        this.isClosing = true;
        
        try {
            // Animation
            this.modal.classList.remove('show');
            
            const timeout = setTimeout(async () => {
                this.modal.classList.add('hidden');
                this.modal.style.display = 'none';
                this.isOpen = false;
                this.isClosing = false;
                
                // onClose callback chaqirish (yopilgandan keyin)
                if (this.config.onClose) {
                    await this.config.onClose(this);
                }
                
                log.debug('Modal yopildi');
            }, this.config.animationDuration);
            
            this.timeouts.push(timeout);
        } catch (error) {
            log.error('Modal yopishda xatolik:', error);
            this.isClosing = false;
        }
    }
    
    /**
     * Modal yopish handler'larini sozlash
     */
    setupCloseHandlers() {
        if (!this.modal) return;
        
        // Eski listener'larni olib tashlash
        this.cleanup();
        
        // Backdrop click handler
        if (this.config.closeOnBackdrop) {
            const backdropHandler = (e) => {
                if (e.target === this.modal) {
                    this.close();
                }
            };
            this.modal.addEventListener('click', backdropHandler);
            this.listeners.push({ type: 'click', handler: backdropHandler, element: this.modal });
        }
        
        // Close button handler
        const closeButtons = this.modal.querySelectorAll('.close-modal-btn, .close-sessions-modal-btn, [data-close-modal]');
        closeButtons.forEach(btn => {
            const closeHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            };
            btn.addEventListener('click', closeHandler);
            this.listeners.push({ type: 'click', handler: closeHandler, element: btn });
        });
    }
    
    /**
     * Barcha listener'larni olib tashlash
     */
    cleanup() {
        // Event listener'larni olib tashlash
        this.listeners.forEach(({ type, handler, element }) => {
            element.removeEventListener(type, handler);
        });
        this.listeners = [];
        
        // Timeout'larni tozalash
        this.timeouts.forEach(timeout => clearTimeout(timeout));
        this.timeouts = [];
    }
    
    /**
     * Modal'ni to'liq yo'q qilish
     */
    destroy() {
        this.cleanup();
        this.isOpen = false;
        this.isOpening = false;
        this.isClosing = false;
    }
    
    /**
     * Modal ma'lumotlarini yangilash
     */
    updateData(data) {
        if (this.config.onUpdate) {
            this.config.onUpdate(data, this);
        }
    }
}

/**
 * Modal Manager - barcha modal'larni boshqarish
 */
class ModalManager {
    constructor() {
        this.modals = new Map(); // modalId -> ModalInstance
    }
    
    /**
     * Modal yaratish yoki olish
     */
    get(modalId, config = {}) {
        if (this.modals.has(modalId)) {
            return this.modals.get(modalId);
        }
        
        const modalElement = document.getElementById(modalId);
        if (!modalElement) {
            log.error(`Modal element topilmadi: ${modalId}`);
            return null;
        }
        
        const instance = new ModalInstance(modalElement, config);
        this.modals.set(modalId, instance);
        
        return instance;
    }
    
    /**
     * Modal ochish
     */
    async open(modalId, data = {}) {
        const instance = this.get(modalId);
        if (instance) {
            await instance.open(data);
        }
    }
    
    /**
     * Modal yopish
     */
    async close(modalId) {
        const instance = this.modals.get(modalId);
        if (instance) {
            await instance.close();
        }
    }
    
    /**
     * Barcha modal'larni yopish
     */
    closeAll() {
        this.modals.forEach(instance => {
            instance.close();
        });
    }
    
    /**
     * Modal'ni yo'q qilish
     */
    destroy(modalId) {
        const instance = this.modals.get(modalId);
        if (instance) {
            instance.destroy();
            this.modals.delete(modalId);
        }
    }
    
    /**
     * Barcha modal'larni yo'q qilish
     */
    destroyAll() {
        this.modals.forEach(instance => instance.destroy());
        this.modals.clear();
    }
}

// Global modal manager instance
export const modalManager = new ModalManager();

/**
 * Qisqa funksiyalar
 */
export function openModal(modalId, data = {}) {
    return modalManager.open(modalId, data);
}

export function closeModal(modalId) {
    return modalManager.close(modalId);
}

export function getModal(modalId, config = {}) {
    return modalManager.get(modalId, config);
}

