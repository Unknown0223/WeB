// Bot bog'lash sahifasi JavaScript (interaktiv va tushunarli)

let currentToken = null;
let checkInterval = null;
let botSubscriptionLink = null;
let isChecking = false;

// Hex rangni RGB ga o'tkazish funksiyasi
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// --- Brending sozlamalarini qo'llash uchun funksiyalar ---
const BRANDING_DEFAULTS = {
    logo: {
        text: 'MANUS',
        color: '#4CAF50',
        animation: 'anim-glow-pulse',
        border: 'border-none',
        size: 32
    }
};

function applyBrandingToLogo(settings) {
    // Eski va yangi formatlarni qo'llab-quvvatlash
    const logoData = settings?.logo || settings || BRANDING_DEFAULTS.logo;
    const text = logoData.text || 'MANUS';
    const color = logoData.color || '#4CAF50';
    const animation = logoData.animation || 'anim-glow-pulse';
    const border = logoData.border || 'border-none';
    const size = logoData.size || 32;
    
    const logo = document.querySelector('.brand-logo');
    const container = logo?.closest('.logo-border-effect');
    
    if (logo) {
        logo.textContent = text;
        
        // CSS variable va to'g'ridan-to'g'ri color o'rnatish
        logo.style.setProperty('--glow-color', color);
        logo.style.color = color; // Inline CSS'dan ustun kelish uchun
        
        if (size) {
            logo.style.fontSize = `${size}px`;
        }
        
        logo.className = 'brand-logo';
        if (animation && animation !== 'anim-none') {
            logo.classList.add(animation);
            // Animatsiya uchun text-shadow ham o'rnatish
            if (color) {
                // RGB konvertatsiya
                const rgb = hexToRgb(color);
                if (rgb) {
                    logo.style.textShadow = `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8), 0 0 40px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`;
                }
            }
        } else if (color) {
            const rgb = hexToRgb(color);
            if (rgb) {
                logo.style.textShadow = `0 0 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`;
            } else {
                logo.style.textShadow = `0 0 8px ${color}`;
            }
        }
    }
    
    if (container) {
        // Container className'ni to'g'ri yangilash
        let newContainerClassName = container.className
            .split(' ')
            .filter(cls => {
                // logo-border-effect klassini saqlash
                if (cls === 'logo-border-effect') {
                    return true;
                }
                // Boshqa border- bilan boshlanadigan klasslarni olib tashlash
                return !cls.startsWith('border-');
            })
            .join(' ')
            .trim();
        
        // Agar logo-border-effect yo'q bo'lsa, qo'shish
        if (!newContainerClassName.includes('logo-border-effect')) {
            newContainerClassName = 'logo-border-effect' + (newContainerClassName ? ' ' + newContainerClassName : '');
        }
        
        container.className = newContainerClassName;
        
        if (border && border !== 'border-none') {
            container.classList.add(border);
        }
        container.style.setProperty('--glow-color', color);
    }
}

// Sahifa yuklanganda sozlamalarni olish
async function fetchAndApplyBranding() {
    try {
        // Cache'ni tozalash - har safar yangi sozlamalarni olish uchun
        try {
            sessionStorage.removeItem('branding_settings_cache');
        } catch (e) {
            // Xatolikni e'tiborsiz qoldirish
        }
        
        // Cache-busting: timestamp qo'shish
        const timestamp = Date.now();
        const res = await fetch(`/api/auth/public/settings/branding?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        
        if (res.ok) {
            const brandingSettings = await res.json();
            applyBrandingToLogo(brandingSettings);
        } else {
            applyBrandingToLogo(); // Xatolik bo'lsa, standartni qo'llash
        }
    } catch (error) {
        applyBrandingToLogo(); // Xatolik bo'lsa, standartni qo'llash
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Brendingni yuklash
    await fetchAndApplyBranding();
    // Elementlar
    const warningSection = document.getElementById('warning-section');
    const messageArea = document.getElementById('message-area');
    const botSubscriptionSection = document.getElementById('bot-subscription-section');
    const botSubscriptionButton = document.getElementById('bot-subscription-button');
    const buttonText = document.getElementById('button-text');
    const loadingSection = document.getElementById('loading-section');
    const successSection = document.getElementById('success-section');

    // Avval bot obunasi holatini tekshirish va login yuklash
    await initializePage();

    // Bot obunasi knopkasi bosilganda
    botSubscriptionButton.addEventListener('click', async (e) => {
        e.preventDefault();
        
        if (!botSubscriptionLink) {
            showMessage('Bot havolasi topilmadi. Iltimos, qayta urinib ko\'ring.', 'error');
            await initializePage();
            return;
        }

        // Knopka holatini yangilash
        buttonText.textContent = 'Bot ochilmoqda...';
        botSubscriptionButton.style.opacity = '0.7';
        botSubscriptionButton.style.pointerEvents = 'none';

        // Bot havolasini yangi oynada ochish
        const botWindow = window.open(botSubscriptionLink, '_blank');
        
        // Agar oyna yopilsa yoki ochilmasa
        setTimeout(() => {
            if (!botWindow || botWindow.closed) {
                buttonText.textContent = 'Botga obuna bo\'lish';
                botSubscriptionButton.style.opacity = '1';
                botSubscriptionButton.style.pointerEvents = 'auto';
                showMessage('Bot oynasi yopildi. Iltimos, qayta urinib ko\'ring.', 'error');
            } else {
                buttonText.textContent = 'Botga obuna bo\'lish';
                botSubscriptionButton.style.opacity = '1';
                botSubscriptionButton.style.pointerEvents = 'auto';
                showMessage('Botga ulanib, /start buyrug\'ini bosing. Bog\'lanish avtomatik tekshiriladi...', 'success');
                startAutoCheck();
            }
        }, 1000);
    });

    // Sahifani boshlash
    async function initializePage() {
        try {
            loadingSection.style.display = 'block';
            warningSection.style.display = 'none';
            botSubscriptionSection.style.display = 'none';
            messageArea.style.display = 'none';
            successSection.style.display = 'none';
            
            const response = await fetch('/api/auth/bot-connect/status');
            
            if (response.status === 401) {
                // Sessiya yo'q - login sahifasiga o'tish
                showMessage('Sessiya tugagan. Qayta kirib ko\'ring...', 'error');
                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 2000);
                return;
            }

            const data = await response.json();

            if (data.isTelegramConnected && !data.requiresBotConnection) {
                // Bot allaqachon bog'langan - dashboardga o'tish
                showSuccessAndRedirect();
                return;
            }

            // Bot obunasi kerak
            if (data.username) {
                // Ogohlantirish ko'rsatish
                warningSection.style.display = 'block';
                
                // Bot obunasi havolasini olish
                await generateBotSubscriptionLink(data.username);
            } else {
                // Username topilmadi - login sahifasiga o'tish
                showMessage('Login topilmadi. Qayta kirib ko\'ring...', 'error');
                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 2000);
            }

        } catch (error) {
            console.error('Sahifani boshlash xatoligi:', error);
            showMessage('Tizimda xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.', 'error');
        } finally {
            loadingSection.style.display = 'none';
        }
    }

    // Bot obunasi havolasini yaratish
    async function generateBotSubscriptionLink(username) {
        try {
            const response = await fetch('/api/auth/bot-connect/generate-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Bot havolasi yaratishda xatolik yuz berdi');
            }

            // Token va havolani saqlash
            currentToken = data.token;
            botSubscriptionLink = data.botLink;
            
            // Bot obunasi knopkasini ko'rsatish
            botSubscriptionButton.href = botSubscriptionLink;
            botSubscriptionSection.style.display = 'block';
            
            // Ikonkalarni yangilash
            feather.replace();

        } catch (error) {
            console.error('Bot havolasi yaratish xatoligi:', error);
            showMessage(error.message || 'Bot havolasi yaratishda xatolik yuz berdi.', 'error');
        }
    }

    // Avtomatik tekshirishni boshlash
    function startAutoCheck() {
        if (isChecking) {
            return; // Allaqachon tekshirilmoqda
        }

        isChecking = true;
        
        if (checkInterval) {
            clearInterval(checkInterval);
        }

        // Xabar ko'rsatish
        showMessage('Botga ulanib, /start buyrug\'ini bosing. Bog\'lanish avtomatik tekshiriladi...', 'success');

        // Har 3 soniyada tekshirish
        checkInterval = setInterval(async () => {
            await verifyBotConnection();
        }, 3000);

        // Birinchi marta darhol tekshirish
        setTimeout(() => {
            verifyBotConnection();
        }, 1000);
    }

    // Bot bog'lanishini tekshirish
    async function verifyBotConnection() {
        if (!currentToken || !isChecking) {
            return;
        }

        try {
            const response = await fetch('/api/auth/bot-connect/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: currentToken })
            });

            const data = await response.json();

            if (data.success) {
                // Muvaffaqiyatli bog'lanish
                isChecking = false;
                
                if (checkInterval) {
                    clearInterval(checkInterval);
                }
                
                showSuccessAndRedirect();
            }
        } catch (error) {
            console.error('Bog\'lanishni tekshirish xatoligi:', error);
            // Xatolik bo'lsa ham davom etish
        }
    }

    // Muvaffaqiyatli bog'lanish va redirect
    function showSuccessAndRedirect() {
        // Barcha bo'limlarni yashirish
        warningSection.style.display = 'none';
        botSubscriptionSection.style.display = 'none';
        messageArea.style.display = 'none';
        loadingSection.style.display = 'none';
        
        // Muvaffaqiyat xabari
        successSection.style.display = 'block';
        
        // 2 soniyadan keyin dashboardga o'tish
        setTimeout(() => {
            window.location.href = '/admin';
        }, 2000);
    }

    // Xabar ko'rsatish funksiyasi
    function showMessage(message, type = 'success') {
        messageArea.textContent = message;
        messageArea.className = `message-text ${type}`;
        messageArea.style.display = 'block';
        
        // Xatolik bo'lsa, 5 soniyadan keyin yashirish
        if (type === 'error') {
            setTimeout(() => {
                messageArea.style.display = 'none';
            }, 5000);
        }
    }
});
