// 🎨 ZAMONAVIY BRENDING MODULE
// Tizimning to'liq dizaynini boshqarish

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast, showPageLoader, hidePageLoader, updateLoaderType } from './utils.js';

// Hozirgi brending sozlamalari
let currentBranding = {
    logo: {
        text: 'MANUS',
        color: '#4CAF50',
        size: 32,
        animation: 'anim-glow-pulse',
        border: 'border-none'
    },
    colors: {
        primary: '#007bff',
        secondary: '#6c757d',
        success: '#28a745',
        danger: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8',
        light: '#f8f9fa',
        dark: '#343a40'
    },
    typography: {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: 14,
        lineHeight: 1.5,
        headingWeight: 600
    },
    animations: {
        easing: 'ease',
        duration: 0.3,
        hoverGlow: false,
        hoverRotate: false,
        hoverSlide: false,
        borderAnimation: 'none',
        hoverTransform: 'none'
    },
    components: {
        buttonRadius: 6,
        cardRadius: 12,
        inputRadius: 6,
        cardShadow: 3,
        buttonPadding: 12
    },
    spacing: {
        unit: 8,
        containerPadding: 30,
        sectionGap: 30
    },
    loader: {
        type: 'spinner',
        text: 'Yuklanmoqda...',
        showProgress: false,
        blurBackground: true
    }
};

/**
 * Brending bo'limini sozlash
 */
export function setupBrandingControls() {
    // Hozirgi sozlamalarni yuklash
    if (state.settings.branding_settings) {
        // Loader sozlamalarini chuqur merge qilish (nested object)
        if (state.settings.branding_settings.loader) {
            currentBranding.loader = {
                type: state.settings.branding_settings.loader.type || currentBranding.loader.type || 'spinner',
                text: state.settings.branding_settings.loader.text || currentBranding.loader.text || 'Yuklanmoqda...',
                showProgress: state.settings.branding_settings.loader.showProgress !== undefined 
                    ? state.settings.branding_settings.loader.showProgress 
                    : currentBranding.loader.showProgress !== undefined 
                        ? currentBranding.loader.showProgress 
                        : false,
                blurBackground: state.settings.branding_settings.loader.blurBackground !== undefined 
                    ? state.settings.branding_settings.loader.blurBackground 
                    : currentBranding.loader.blurBackground !== undefined 
                        ? currentBranding.loader.blurBackground 
                        : true
            };
            
            // sessionStorage'ga cache qilish (sahifa yuklanganda tezroq yuklanish uchun)
            try {
                sessionStorage.setItem('branding_settings_cache', JSON.stringify(currentBranding));
            } catch (e) {
                // Xatolikni e'tiborsiz qoldirish
            }
        }
        
        // Qolgan sozlamalarni merge qilish
        const { loader, ...otherSettings } = state.settings.branding_settings;
        currentBranding = { ...currentBranding, ...otherSettings };
    }
    
    // Tab navigationni sozlash
    setupBrandingTabs();
    
    // Har bir bo'lim uchun event listenerlar
    setupLogoTab();
    setupColorsTab();
    setupTypographyTab();
    setupAnimationsTab();
    setupComponentsTab();
    setupSpacingTab();
    setupLoaderTab();
    
    // Saqlash tugmasi
    const saveBrandingBtn = document.getElementById('save-branding-settings-btn');
    if (saveBrandingBtn) {
        saveBrandingBtn.addEventListener('click', saveBrandingSettings);
    }
    
    // Dastlabki sozlamalarni UI ga qo'llash
    applyBrandingToUI(currentBranding);
}

/**
 * Tab navigation
 */
function setupBrandingTabs() {
    const tabs = document.querySelectorAll('.branding-tab');
    const contents = document.querySelectorAll('.branding-tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            contents.forEach(c => c.classList.remove('active'));
            document.querySelector(`[data-content="${targetTab}"]`)?.classList.add('active');
            
            if (typeof feather !== 'undefined') feather.replace();
        });
    });
}

/**
 * LOGO TAB
 */
function setupLogoTab() {
    // Logo matni
    const logoTextInput = document.getElementById('logo-text-input');
    if (logoTextInput) {
        logoTextInput.value = currentBranding.logo?.text || 'MANUS';
        logoTextInput.addEventListener('input', (e) => {
            currentBranding.logo.text = e.target.value;
            updateLogoPreview();
        });
    }
    
    // Logo rangi
    const logoColorPicker = document.getElementById('logo-color-picker');
    const logoColorHex = document.getElementById('logo-color-hex');
    if (logoColorPicker) {
        logoColorPicker.value = currentBranding.logo?.color || '#4CAF50';
        if (logoColorHex) logoColorHex.value = logoColorPicker.value;
        
        logoColorPicker.addEventListener('input', (e) => {
            currentBranding.logo.color = e.target.value;
            if (logoColorHex) logoColorHex.value = e.target.value;
            updateLogoPreview();
        });
    }
    
    // Logo ranglar palitra
    const colorPalette = document.getElementById('logo-color-palette');
    if (colorPalette) {
        const colors = ['#4CAF50', '#007bff', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14', '#20c997', '#e83e8c', '#17a2b8', '#ffffff'];
        
        colorPalette.innerHTML = colors.map(c =>
            `<div class="color-box ${c === currentBranding.logo?.color ? 'active' : ''}" style="background-color: ${c}" data-color="${c}"></div>`
        ).join('');
        
        colorPalette.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-box')) {
                const color = e.target.dataset.color;
                currentBranding.logo.color = color;
                if (logoColorPicker) logoColorPicker.value = color;
                if (logoColorHex) logoColorHex.value = color;
                
                colorPalette.querySelectorAll('.color-box').forEach(box => {
                    box.classList.toggle('active', box.dataset.color === color);
                });
                
                updateLogoPreview();
            }
        });
    }
    
    // Logo o'lchami
    const logoSizeInput = document.getElementById('logo-size-input');
    const logoSizeValue = document.getElementById('logo-size-value');
    if (logoSizeInput) {
        logoSizeInput.value = currentBranding.logo?.size || 32;
        if (logoSizeValue) logoSizeValue.textContent = `${logoSizeInput.value}px`;
        
        logoSizeInput.addEventListener('input', (e) => {
            currentBranding.logo.size = parseInt(e.target.value);
            if (logoSizeValue) logoSizeValue.textContent = `${e.target.value}px`;
            updateLogoPreview();
        });
    }
    
    // Logo animatsiya
    const logoAnimationSelect = document.getElementById('logo-animation-select');
    if (logoAnimationSelect) {
        const animations = {
            'anim-none': '❌ Yo\'q',
            'anim-glow-pulse': '💫 Pulsatsiya',
            'anim-flicker': '⚡ Miltillash',
            'anim-scanner': '📡 Skaner',
            'anim-glitch': '🔮 Glitch (Kiber)',
            'anim-wave': '🌊 To\'lqin',
            'anim-particle': '✨ Zarrachalar',
            'anim-fire': '🔥 Olov',
            'anim-electric': '⚡ Elektr chaqmoq',
            'anim-rainbow': '🌈 Kamalak',
            'anim-radar': '📡 Radar',
            'anim-target': '🎯 Nishon',
            'anim-spiral': '🌀 Spiral',
            'anim-crystal': '💎 Billur',
            'anim-bounce': '⬆️ Sakrash',
            'anim-shake': '📳 Qaltiratish',
            'anim-zoom': '🔍 Kattalashtirish',
            'anim-neon': '💡 Neon',
            'anim-rotate3d': '🔄 3D Aylanish'
        };
        
        logoAnimationSelect.innerHTML = Object.entries(animations).map(([k, v]) =>
            `<option value="${k}" ${k === currentBranding.logo?.animation ? 'selected' : ''}>${v}</option>`
        ).join('');
        
        logoAnimationSelect.addEventListener('change', (e) => {
            currentBranding.logo.animation = e.target.value;
            updateLogoPreview();
        });
    }
    
    // Logo border effekt
    const logoBorderSelect = document.getElementById('logo-border-effect-select');
    if (logoBorderSelect) {
        const borders = {
            'border-none': '❌ Yo\'q',
            'border-glow': '✨ Yorqin Chegara',
            'border-dashed': '➖ Punktir',
            'border-line-grow': '📏 Chiziqli Animatsiya',
            'border-liquid': '🌊 Suyuq',
            'border-lightning': '⚡ Chaqmoq',
            'border-holographic': '🔮 Gologramma',
            'border-starburst': '🌟 Yulduz Portlash',
            'border-vortex': '🌀 Girdob',
            'border-hexagon': '⬡ Olti Burchak',
            'border-drip': '💧 Bo\'yoq Tomchi',
            'border-flame': '🔥 Alanga',
            'border-matrix': '🟢 Matrix',
            'border-cyberpunk': '🎮 Kiberpank'
        };
        
        logoBorderSelect.innerHTML = Object.entries(borders).map(([k, v]) =>
            `<option value="${k}" ${k === currentBranding.logo?.border ? 'selected' : ''}>${v}</option>`
        ).join('');
        
        logoBorderSelect.addEventListener('change', (e) => {
            currentBranding.logo.border = e.target.value;
            updateLogoPreview();
        });
    }
    
    // Save tugmasi
    const saveBtn = document.getElementById('save-branding-settings-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveBrandingSettings);
    }
    
    updateLogoPreview();
}

/**
 * Logo preview ni yangilash
 */
function updateLogoPreview() {
    const logoPreview = document.getElementById('logo-preview');
    const logoPreviewContainer = document.getElementById('logo-preview-container');
    
    if (logoPreview) {
        logoPreview.textContent = currentBranding.logo.text;
        logoPreview.style.setProperty('--glow-color', currentBranding.logo.color);
        logoPreview.style.fontSize = `${currentBranding.logo.size}px`;
        
        logoPreview.className = 'brand-logo';
        if (currentBranding.logo.animation !== 'anim-none') {
            logoPreview.classList.add(currentBranding.logo.animation);
        }
    }
    
    if (logoPreviewContainer) {
        logoPreviewContainer.className = 'logo-border-effect';
        if (currentBranding.logo.border !== 'border-none') {
            logoPreviewContainer.classList.add(currentBranding.logo.border);
        }
        logoPreviewContainer.style.setProperty('--glow-color', currentBranding.logo.color);
    }
}

/**
 * ANIMATSIYA TAB - Yangi funksiyalar
 */
export function setupAnimationsTab() {
    // Saqlangan sozlamalarni yuklash
    const easingSelect = document.getElementById('animation-easing');
    const hoverGlow = document.getElementById('enable-hover-glow');
    const hoverRotate = document.getElementById('enable-hover-rotate');
    const hoverSlide = document.getElementById('enable-hover-slide');
    const borderAnimation = document.getElementById('border-animation');
    const hoverTransform = document.getElementById('hover-transform');
    
    if (easingSelect && currentBranding.animations) {
        easingSelect.value = currentBranding.animations.easing || 'ease';
    }
    if (hoverGlow && currentBranding.animations) {
        hoverGlow.checked = currentBranding.animations.hoverGlow || false;
    }
    if (hoverRotate && currentBranding.animations) {
        hoverRotate.checked = currentBranding.animations.hoverRotate || false;
    }
    if (hoverSlide && currentBranding.animations) {
        hoverSlide.checked = currentBranding.animations.hoverSlide || false;
    }
    if (borderAnimation && currentBranding.animations) {
        borderAnimation.value = currentBranding.animations.borderAnimation || 'none';
    }
    if (hoverTransform && currentBranding.animations) {
        hoverTransform.value = currentBranding.animations.hoverTransform || 'none';
    }
    
    // Animatsiya easing
    if (easingSelect) {
        easingSelect.addEventListener('change', (e) => {
            currentBranding.animations.easing = e.target.value;
            const testBtns = document.querySelectorAll('.animation-test-btn, .animation-test-btn-2, .animation-test-btn-3');
            testBtns.forEach(btn => {
                btn.style.transition = `all 0.3s ${e.target.value}`;
            });
        });
    }
    
    // Hover effektlari
    if (hoverGlow) {
        hoverGlow.addEventListener('change', (e) => {
            currentBranding.animations.hoverGlow = e.target.checked;
            const testCards = document.querySelectorAll('.animation-test-card, .animation-test-card-2');
            testCards.forEach(card => {
                card.classList.toggle('hover-glow', e.target.checked);
            });
        });
    }
    
    if (hoverRotate) {
        hoverRotate.addEventListener('change', (e) => {
            currentBranding.animations.hoverRotate = e.target.checked;
            const testBtns = document.querySelectorAll('.animation-test-btn-2');
            testBtns.forEach(btn => {
                btn.classList.toggle('hover-rotate', e.target.checked);
            });
        });
    }
    
    if (hoverSlide) {
        hoverSlide.addEventListener('change', (e) => {
            currentBranding.animations.hoverSlide = e.target.checked;
            const testBtns = document.querySelectorAll('.animation-test-btn-3');
            testBtns.forEach(btn => {
                btn.classList.toggle('hover-slide', e.target.checked);
            });
        });
    }
    
    // Chegara effektlari
    if (borderAnimation) {
        borderAnimation.addEventListener('change', (e) => {
            currentBranding.animations.borderAnimation = e.target.value;
            const testCards = document.querySelectorAll('.animation-test-card, .animation-test-card-2');
            const borderClasses = ['gradient-border', 'animated-gradient', 'neon-glow', 'pulse-border', 'rotating-border', 'dashed-animated'];
            
            testCards.forEach(card => {
                borderClasses.forEach(cls => card.classList.remove(cls));
                if (e.target.value !== 'none' && e.target.value !== 'solid') {
                    card.classList.add(e.target.value);
                }
            });
        });
    }
    
    // Hover transform
    if (hoverTransform) {
        hoverTransform.addEventListener('change', (e) => {
            currentBranding.animations.hoverTransform = e.target.value;
            const testBtns = document.querySelectorAll('.animation-test-btn, .animation-test-btn-2, .animation-test-btn-3');
            const transformClasses = ['scale-up', 'scale-down', 'tilt-left', 'tilt-right', 'flip-3d', 'perspective', 'skew'];
            
            testBtns.forEach(btn => {
                transformClasses.forEach(cls => btn.classList.remove(cls));
                if (e.target.value !== 'none') {
                    btn.classList.add(e.target.value);
                }
            });
        });
    }
}

/**
 * Brendingni saqlash
 */
export async function saveBrandingSettings() {
    try {
        // Loader sozlamalarini to'liq saqlashni ta'minlash
        if (!currentBranding.loader) {
            currentBranding.loader = {};
        }
        
        // Agar loader sozlamalari to'liq emas bo'lsa, default qiymatlar qo'shish
        currentBranding.loader = {
            type: currentBranding.loader.type || 'spinner',
            text: currentBranding.loader.text || 'Yuklanmoqda...',
            showProgress: currentBranding.loader.showProgress !== undefined ? currentBranding.loader.showProgress : false,
            blurBackground: currentBranding.loader.blurBackground !== undefined ? currentBranding.loader.blurBackground : true
        };
        
        const res = await safeFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'branding_settings', value: currentBranding })
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'Xatolik yuz berdi');
        }
        
        // State'ni yangilash
        if (state.settings) {
            state.settings.branding_settings = currentBranding;
        }
        
        // sessionStorage'ga cache qilish (sahifa yuklanganda tezroq yuklanish uchun)
        try {
            sessionStorage.setItem('branding_settings_cache', JSON.stringify(currentBranding));
        } catch (e) {
            // Xatolikni e'tiborsiz qoldirish
        }
        
        showToast('✅ Brending sozlamalari saqlandi!');
        applyBranding(currentBranding);
    } catch (error) {
        showToast(`❌ ${error.message}`, true);
    }
}

/**
 * LOADER TAB - Yuklanish animatsiyasi
 */
export function setupLoaderTab() {
    const loaderTypeSelect = document.getElementById('loader-type');
    const loaderTextInput = document.getElementById('loader-text-input');
    const loaderShowProgress = document.getElementById('loader-show-progress');
    const loaderBlurBackground = document.getElementById('loader-blur-background');
    const testLoaderBtn = document.getElementById('test-loader-btn');
    
    const loaderPreviewAnimation = document.getElementById('loader-preview-animation');
    const loaderPreviewText = document.getElementById('loader-preview-text');
    const loaderPreviewProgress = document.getElementById('loader-preview-progress');
    
    // Saqlangan sozlamalarni yuklash
    if (currentBranding.loader) {
        const loaderType = currentBranding.loader.type || 'spinner';
        const loaderText = currentBranding.loader.text || 'Yuklanmoqda...';
        const showProgress = currentBranding.loader.showProgress || false;
        const blurBackground = currentBranding.loader.blurBackground !== undefined ? currentBranding.loader.blurBackground : true;
        
        if (loaderTypeSelect) {
            loaderTypeSelect.value = loaderType;
        }
        if (loaderTextInput) {
            loaderTextInput.value = loaderText;
        }
        if (loaderShowProgress) {
            loaderShowProgress.checked = showProgress;
        }
        if (loaderBlurBackground) {
            loaderBlurBackground.checked = blurBackground;
        }
        
        updateLoaderPreview(loaderType);
        if (loaderPreviewText) loaderPreviewText.textContent = loaderText;
        if (loaderPreviewProgress) loaderPreviewProgress.style.display = showProgress ? 'block' : 'none';
    }
    
    // Loader turini o'zgartirish
    if (loaderTypeSelect) {
        loaderTypeSelect.addEventListener('change', (e) => {
            const type = e.target.value;
            currentBranding.loader.type = type;
            updateLoaderPreview(type);
            updateLoaderType(type); // Global loaderni ham yangilash
        });
    }
    
    // Loader matnini o'zgartirish
    if (loaderTextInput) {
        loaderTextInput.addEventListener('input', (e) => {
            const text = e.target.value;
            currentBranding.loader.text = text;
            if (loaderPreviewText) {
                loaderPreviewText.textContent = text;
            }
        });
    }
    
    // Progress bar ko'rsatish/yashirish
    if (loaderShowProgress) {
        loaderShowProgress.addEventListener('change', (e) => {
            const show = e.target.checked;
            currentBranding.loader.showProgress = show;
            if (loaderPreviewProgress) {
                loaderPreviewProgress.style.display = show ? 'block' : 'none';
            }
        });
    }
    
    // Blur effekti
    if (loaderBlurBackground) {
        loaderBlurBackground.addEventListener('change', (e) => {
            const blur = e.target.checked;
            currentBranding.loader.blurBackground = blur;
        });
    }
    
    // Test tugmasi
    if (testLoaderBtn) {
        testLoaderBtn.addEventListener('click', () => {
            const loaderSettings = currentBranding.loader || {};
            const loaderType = loaderSettings.type || 'spinner';
            const loaderText = loaderSettings.text || 'Yuklanmoqda...';
            const showProgress = loaderSettings.showProgress || false;
            const blurBackground = loaderSettings.blurBackground !== undefined ? loaderSettings.blurBackground : true;
            
            // Loader turini o'rnatish
            updateLoaderType(loaderType);
            
            // Loader matnini o'rnatish
            const loaderTextEl = document.getElementById('loader-text');
            if (loaderTextEl) {
                loaderTextEl.textContent = loaderText;
            }
            
            // Progress bar
            const loaderProgress = document.getElementById('loader-progress');
            if (loaderProgress) {
                loaderProgress.style.display = showProgress ? 'block' : 'none';
            }
            
            // Blur effekti
            const pageLoader = document.getElementById('page-loader');
            if (pageLoader) {
                if (blurBackground) {
                    pageLoader.classList.add('blur-background');
                } else {
                    pageLoader.classList.remove('blur-background');
                }
            }
            
            showPageLoader(loaderText);
            
            setTimeout(() => {
                hidePageLoader();
            }, 3000);
        });
    }
}

/**
 * Loader previewni yangilash
 */
function updateLoaderPreview(type) {
    const loaderPreviewAnimation = document.getElementById('loader-preview-animation');
    if (!loaderPreviewAnimation) return;
    
    // Barcha loader klaslarini olib tashlash
    const loaderClasses = ['loader-spinner', 'loader-dots', 'loader-pulse', 'loader-gradient', 
                          'loader-bars', 'loader-circle-progress', 'loader-bounce', 
                          'loader-cube', 'loader-dna', 'loader-hexagon'];
    
    loaderClasses.forEach(cls => loaderPreviewAnimation.classList.remove(cls));
    
    // Yangi loader turini qo'llash
    switch(type) {
        case 'spinner':
            loaderPreviewAnimation.className = 'loader-spinner';
            loaderPreviewAnimation.innerHTML = '';
            break;
        case 'dots':
            loaderPreviewAnimation.className = 'loader-dots';
            loaderPreviewAnimation.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
            break;
        case 'pulse':
            loaderPreviewAnimation.className = 'loader-pulse';
            loaderPreviewAnimation.innerHTML = '';
            break;
        case 'gradient':
            loaderPreviewAnimation.className = 'loader-gradient';
            loaderPreviewAnimation.innerHTML = '';
            break;
        case 'bars':
            loaderPreviewAnimation.className = 'loader-bars';
            loaderPreviewAnimation.innerHTML = '<div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>';
            break;
        case 'progress':
            loaderPreviewAnimation.className = 'loader-circle-progress';
            loaderPreviewAnimation.innerHTML = '<svg width="60" height="60"><circle cx="30" cy="30" r="28"></circle></svg>';
            break;
        case 'bounce':
            loaderPreviewAnimation.className = 'loader-bounce';
            loaderPreviewAnimation.innerHTML = '<div class="ball"></div><div class="ball"></div><div class="ball"></div>';
            break;
        case 'cube':
            loaderPreviewAnimation.className = 'loader-cube';
            loaderPreviewAnimation.innerHTML = '<div class="face"></div>';
            break;
        case 'dna':
            loaderPreviewAnimation.className = 'loader-dna';
            loaderPreviewAnimation.innerHTML = '<div class="strand"></div><div class="strand"></div>';
            break;
        case 'hexagon':
            loaderPreviewAnimation.className = 'loader-hexagon';
            loaderPreviewAnimation.innerHTML = '';
            break;
    }
}

/**
 * Brendingni butun tizimga qo'llash
 */
export function applyBranding(settings) {
    if (settings) {
        currentBranding = { ...currentBranding, ...settings };
    }
    applyBrandingToUI(currentBranding);
}

/**
 * UI ga brendingni qo'llash
 */
function applyBrandingToUI(branding) {
    // Logo
    DOM.brandLogos?.forEach(logo => {
        logo.textContent = branding.logo?.text || 'MANUS';
        logo.className = 'brand-logo';
        if (branding.logo?.animation !== 'anim-none') {
            logo.classList.add(branding.logo.animation);
        }
        logo.style.setProperty('--glow-color', branding.logo?.color || '#4CAF50');
        logo.style.fontSize = `${branding.logo?.size || 32}px`;
    });
    
    DOM.logoBorderEffects?.forEach(container => {
        container.className = 'logo-border-effect';
        if (branding.logo?.border !== 'border-none') {
            container.classList.add(branding.logo.border);
        }
        container.style.setProperty('--glow-color', branding.logo?.color || '#4CAF50');
    });
    
    // Colors - Ranglar
    if (branding.colors) {
        Object.entries(branding.colors).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--${key}`, value);
        });
    }
    
    // Typography - Shriftlar
    if (branding.typography) {
        if (branding.typography.fontFamily) {
            document.body.style.fontFamily = branding.typography.fontFamily;
        }
        if (branding.typography.fontSize) {
            document.documentElement.style.setProperty('--font-size', `${branding.typography.fontSize}px`);
        }
        if (branding.typography.lineHeight) {
            document.documentElement.style.setProperty('--line-height', branding.typography.lineHeight);
        }
        if (branding.typography.headingWeight) {
            document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
                h.style.fontWeight = branding.typography.headingWeight;
            });
        }
    }
    
    // Components - Komponentlar
    if (branding.components) {
        if (branding.components.buttonRadius !== undefined) {
            document.querySelectorAll('button, .btn').forEach(btn => {
                btn.style.borderRadius = `${branding.components.buttonRadius}px`;
            });
        }
        if (branding.components.cardRadius !== undefined) {
            document.querySelectorAll('.card, .stat-card').forEach(card => {
                card.style.borderRadius = `${branding.components.cardRadius}px`;
            });
        }
        if (branding.components.inputRadius !== undefined) {
            document.querySelectorAll('input, textarea, select').forEach(input => {
                input.style.borderRadius = `${branding.components.inputRadius}px`;
            });
        }
        if (branding.components.cardShadow !== undefined) {
            const shadowValue = branding.components.cardShadow > 0 
                ? `0 2px ${branding.components.cardShadow * 2}px rgba(0,0,0,${0.05 * branding.components.cardShadow})` 
                : 'none';
            document.querySelectorAll('.card, .stat-card').forEach(card => {
                card.style.boxShadow = shadowValue;
            });
        }
        if (branding.components.buttonPadding !== undefined) {
            document.querySelectorAll('button, .btn').forEach(btn => {
                btn.style.padding = `${branding.components.buttonPadding}px ${branding.components.buttonPadding * 2}px`;
            });
        }
    }
    
    // Spacing - Masofalar
    if (branding.spacing) {
        if (branding.spacing.unit) {
            document.documentElement.style.setProperty('--spacing-unit', `${branding.spacing.unit}px`);
        }
        if (branding.spacing.containerPadding) {
            document.querySelectorAll('.main-content, .page').forEach(el => {
                el.style.padding = `${branding.spacing.containerPadding}px`;
            });
        }
        if (branding.spacing.sectionGap) {
            document.querySelectorAll('.stats-grid, .kpi-grid').forEach(grid => {
                grid.style.gap = `${branding.spacing.sectionGap}px`;
            });
        }
    }
    
    // Loader sozlamalarini qo'llash
    const loaderType = branding.loader?.type || 'spinner';
    const loaderText = branding.loader?.text || 'Yuklanmoqda...';
    const showProgress = branding.loader?.showProgress || false;
    const blurBackground = branding.loader?.blurBackground !== undefined ? branding.loader.blurBackground : true;
    
    updateLoaderType(loaderType);
    
    const loaderTextEl = document.getElementById('loader-text');
    const loaderProgress = document.getElementById('loader-progress');
    const pageLoader = document.getElementById('page-loader');
    
    if (loaderTextEl) {
        loaderTextEl.textContent = loaderText;
    }
    
    if (loaderProgress) {
        loaderProgress.style.display = showProgress ? 'block' : 'none';
    }
    
    if (pageLoader) {
        if (blurBackground) {
            pageLoader.classList.add('blur-background');
        } else {
            pageLoader.classList.remove('blur-background');
        }
    }
}

/**
 * Hex rangni RGB ga o'girish
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

/**
 * RGB ni Hex ga o'girish
 */
function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Tasodifiy rang generatori
 */
function generateRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
}

/**
 * Gradient yaratish (2 rangdan)
 */
function createGradient(color1, color2, angle = 90) {
    return `linear-gradient(${angle}deg, ${color1}, ${color2})`;
}

/**
 * COLORS TAB - Ranglar sozlamalari + RGB Sliders
 */
function setupColorsTab() {
    const colorInputs = {
        'primary-color': 'primary',
        'secondary-color': 'secondary',
        'success-color': 'success',
        'danger-color': 'danger',
        'warning-color': 'warning',
        'info-color': 'info'
    };
    
    Object.entries(colorInputs).forEach(([inputId, colorKey]) => {
        const input = document.getElementById(inputId);
        if (input && currentBranding.colors) {
            input.value = currentBranding.colors[colorKey] || '#007bff';
            
            input.addEventListener('input', (e) => {
                const hexColor = e.target.value;
                currentBranding.colors[colorKey] = hexColor;
                
                // Real-time preview - ranglarni qo'llash
                document.documentElement.style.setProperty(`--${colorKey}`, hexColor);
                
                // RGB sliderlarni yangilash (agar mavjud bo'lsa)
                updateRGBSliders(inputId, hexColor);
            });
        }
    });
    
    // RGB sliderlarni sozlash
    setupRGBSliders();
}

/**
 * RGB sliderlarni sozlash
 */
function setupRGBSliders() {
    const primaryColor = document.getElementById('primary-color');
    if (!primaryColor) return;
    
    const rgb = hexToRgb(primaryColor.value);
    
    // RGB slider HTMLlarini qo'shish
    const colorItem = primaryColor.closest('.color-item');
    if (!colorItem || colorItem.querySelector('.rgb-sliders')) return;
    
    const rgbSliders = document.createElement('div');
    rgbSliders.className = 'rgb-sliders';
    rgbSliders.style.cssText = 'margin-top: 10px; display: grid; gap: 8px;';
    rgbSliders.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: #ff4444; font-size: 12px; width: 15px;">R</span>
            <input type="range" id="primary-r" min="0" max="255" value="${rgb.r}" class="range-input" style="flex: 1;">
            <span id="primary-r-val" style="font-size: 11px; width: 30px; text-align: right;">${rgb.r}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: #44ff44; font-size: 12px; width: 15px;">G</span>
            <input type="range" id="primary-g" min="0" max="255" value="${rgb.g}" class="range-input" style="flex: 1;">
            <span id="primary-g-val" style="font-size: 11px; width: 30px; text-align: right;">${rgb.g}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: #4444ff; font-size: 12px; width: 15px;">B</span>
            <input type="range" id="primary-b" min="0" max="255" value="${rgb.b}" class="range-input" style="flex: 1;">
            <span id="primary-b-val" style="font-size: 11px; width: 30px; text-align: right;">${rgb.b}</span>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 5px;">
            <button class="btn btn-sm" onclick="randomizePrimaryColor()" style="flex: 1; padding: 4px 8px; font-size: 11px;">
                🎲 Tasodifiy
            </button>
        </div>
    `;
    
    colorItem.insertBefore(rgbSliders, colorItem.querySelector('.color-desc'));
    
    // RGB sliderlarni event listenerlar
    ['r', 'g', 'b'].forEach(channel => {
        const slider = document.getElementById(`primary-${channel}`);
        const value = document.getElementById(`primary-${channel}-val`);
        
        if (slider) {
            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                value.textContent = val;
                
                // RGB qiymatlarini olish
                const r = parseInt(document.getElementById('primary-r').value);
                const g = parseInt(document.getElementById('primary-g').value);
                const b = parseInt(document.getElementById('primary-b').value);
                
                // Hex ga o'girish
                const hex = rgbToHex(r, g, b);
                
                // Color pickerda yangilash
                primaryColor.value = hex;
                currentBranding.colors.primary = hex;
                document.documentElement.style.setProperty('--primary', hex);
            });
        }
    });
}

/**
 * RGB sliderlarni yangilash
 */
function updateRGBSliders(inputId, hexColor) {
    if (inputId !== 'primary-color') return;
    
    const rgb = hexToRgb(hexColor);
    
    ['r', 'g', 'b'].forEach(channel => {
        const slider = document.getElementById(`primary-${channel}`);
        const value = document.getElementById(`primary-${channel}-val`);
        
        if (slider && value) {
            slider.value = rgb[channel];
            value.textContent = rgb[channel];
        }
    });
}

/**
 * Tasodifiy rang (global function)
 */
window.randomizePrimaryColor = function() {
    const randomColor = generateRandomColor();
    const primaryColor = document.getElementById('primary-color');
    
    if (primaryColor) {
        primaryColor.value = randomColor;
        currentBranding.colors.primary = randomColor;
        document.documentElement.style.setProperty('--primary', randomColor);
        updateRGBSliders('primary-color', randomColor);
    }
}

/**
 * TYPOGRAPHY TAB - Shrift sozlamalari
 */
function setupTypographyTab() {
    const fontFamilySelect = document.getElementById('font-family-select');
    const fontSizeInput = document.getElementById('font-size-input');
    const lineHeightInput = document.getElementById('line-height-input');
    const headingWeightSelect = document.getElementById('heading-weight-select');
    
    if (fontFamilySelect && currentBranding.typography) {
        fontFamilySelect.value = currentBranding.typography.fontFamily || 'Segoe UI, Tahoma, sans-serif';
        fontFamilySelect.addEventListener('change', (e) => {
            currentBranding.typography.fontFamily = e.target.value;
            document.body.style.fontFamily = e.target.value;
        });
    }
    
    if (fontSizeInput && currentBranding.typography) {
        fontSizeInput.value = currentBranding.typography.fontSize || 14;
        fontSizeInput.addEventListener('input', (e) => {
            currentBranding.typography.fontSize = parseInt(e.target.value);
            document.documentElement.style.setProperty('--font-size', `${e.target.value}px`);
        });
    }
    
    if (lineHeightInput && currentBranding.typography) {
        lineHeightInput.value = currentBranding.typography.lineHeight || 1.5;
        lineHeightInput.addEventListener('input', (e) => {
            currentBranding.typography.lineHeight = parseFloat(e.target.value);
            document.documentElement.style.setProperty('--line-height', e.target.value);
        });
    }
    
    if (headingWeightSelect && currentBranding.typography) {
        headingWeightSelect.value = currentBranding.typography.headingWeight || 600;
        headingWeightSelect.addEventListener('change', (e) => {
            currentBranding.typography.headingWeight = parseInt(e.target.value);
            document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
                h.style.fontWeight = e.target.value;
            });
        });
    }
}

/**
 * COMPONENTS TAB - Komponentlar sozlamalari
 */
function setupComponentsTab() {
    const buttonRadiusInput = document.getElementById('button-radius');
    const buttonRadiusValue = document.getElementById('button-radius-value');
    const cardRadiusInput = document.getElementById('card-radius');
    const cardRadiusValue = document.getElementById('card-radius-value');
    const inputRadiusInput = document.getElementById('input-radius');
    const inputRadiusValue = document.getElementById('input-radius-value');
    const cardShadowInput = document.getElementById('card-shadow');
    const cardShadowValue = document.getElementById('card-shadow-value');
    const buttonPaddingInput = document.getElementById('button-padding');
    const buttonPaddingValue = document.getElementById('button-padding-value');
    
    // Button radius
    if (buttonRadiusInput && currentBranding.components) {
        buttonRadiusInput.value = currentBranding.components.buttonRadius || 6;
        if (buttonRadiusValue) buttonRadiusValue.textContent = `${buttonRadiusInput.value}px`;
        
        buttonRadiusInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.components.buttonRadius = value;
            if (buttonRadiusValue) buttonRadiusValue.textContent = `${value}px`;
            
            document.querySelectorAll('button, .btn, .component-preview-btn').forEach(btn => {
                btn.style.borderRadius = `${value}px`;
            });
        });
    }
    
    // Card radius
    if (cardRadiusInput && currentBranding.components) {
        cardRadiusInput.value = currentBranding.components.cardRadius || 12;
        if (cardRadiusValue) cardRadiusValue.textContent = `${cardRadiusInput.value}px`;
        
        cardRadiusInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.components.cardRadius = value;
            if (cardRadiusValue) cardRadiusValue.textContent = `${value}px`;
            
            document.querySelectorAll('.card, .stat-card, .component-preview-card').forEach(card => {
                card.style.borderRadius = `${value}px`;
            });
        });
    }
    
    // Input radius
    if (inputRadiusInput && currentBranding.components) {
        inputRadiusInput.value = currentBranding.components.inputRadius || 6;
        if (inputRadiusValue) inputRadiusValue.textContent = `${inputRadiusInput.value}px`;
        
        inputRadiusInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.components.inputRadius = value;
            if (inputRadiusValue) inputRadiusValue.textContent = `${value}px`;
            
            document.querySelectorAll('input, textarea, select, .component-preview-input').forEach(input => {
                input.style.borderRadius = `${value}px`;
            });
        });
    }
    
    // Card shadow
    if (cardShadowInput && currentBranding.components) {
        cardShadowInput.value = currentBranding.components.cardShadow || 3;
        if (cardShadowValue) cardShadowValue.textContent = cardShadowInput.value;
        
        cardShadowInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.components.cardShadow = value;
            if (cardShadowValue) cardShadowValue.textContent = value;
            
            const shadowValue = value > 0 ? `0 2px ${value * 2}px rgba(0,0,0,${0.05 * value})` : 'none';
            document.querySelectorAll('.card, .stat-card, .component-preview-card').forEach(card => {
                card.style.boxShadow = shadowValue;
            });
        });
    }
    
    // Button padding
    if (buttonPaddingInput && currentBranding.components) {
        buttonPaddingInput.value = currentBranding.components.buttonPadding || 12;
        if (buttonPaddingValue) buttonPaddingValue.textContent = `${buttonPaddingInput.value}px`;
        
        buttonPaddingInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.components.buttonPadding = value;
            if (buttonPaddingValue) buttonPaddingValue.textContent = `${value}px`;
            
            document.querySelectorAll('button, .btn, .component-preview-btn').forEach(btn => {
                btn.style.padding = `${value}px ${value * 2}px`;
            });
        });
    }
}

/**
 * SPACING TAB - Masofalar sozlamalari
 */
function setupSpacingTab() {
    const spacingUnitInput = document.getElementById('spacing-unit');
    const spacingUnitValue = document.getElementById('spacing-unit-value');
    const containerPaddingInput = document.getElementById('container-padding');
    const containerPaddingValue = document.getElementById('container-padding-value');
    const sectionGapInput = document.getElementById('section-gap');
    const sectionGapValue = document.getElementById('section-gap-value');
    
    // Spacing unit
    if (spacingUnitInput && currentBranding.spacing) {
        spacingUnitInput.value = currentBranding.spacing.unit || 8;
        if (spacingUnitValue) spacingUnitValue.textContent = `${spacingUnitInput.value}px`;
        
        spacingUnitInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.spacing.unit = value;
            if (spacingUnitValue) spacingUnitValue.textContent = `${value}px`;
            document.documentElement.style.setProperty('--spacing-unit', `${value}px`);
        });
    }
    
    // Container padding
    if (containerPaddingInput && currentBranding.spacing) {
        containerPaddingInput.value = currentBranding.spacing.containerPadding || 30;
        if (containerPaddingValue) containerPaddingValue.textContent = `${containerPaddingInput.value}px`;
        
        containerPaddingInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.spacing.containerPadding = value;
            if (containerPaddingValue) containerPaddingValue.textContent = `${value}px`;
            
            document.querySelectorAll('.main-content, .page').forEach(el => {
                el.style.padding = `${value}px`;
            });
        });
    }
    
    // Section gap
    if (sectionGapInput && currentBranding.spacing) {
        sectionGapInput.value = currentBranding.spacing.sectionGap || 30;
        if (sectionGapValue) sectionGapValue.textContent = `${sectionGapInput.value}px`;
        
        sectionGapInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            currentBranding.spacing.sectionGap = value;
            if (sectionGapValue) sectionGapValue.textContent = `${value}px`;
            
            document.querySelectorAll('.stats-grid, .kpi-grid').forEach(grid => {
                grid.style.gap = `${value}px`;
            });
        });
    }
}
