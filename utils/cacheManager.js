const { createLogger } = require('./logger.js');
const log = createLogger('CACHE');

class CacheManager {
    constructor() {
        this.caches = new Map(); // { namespace: Map() }
        this.pageCaches = new Map(); // { userId_page: Map() }
        this.cleanupInterval = null;
        this.startCleanup();
    }

    // Namespace bo'yicha cache
    get(namespace, key) {
        if (!this.caches.has(namespace)) {
            this.caches.set(namespace, new Map());
        }
        const cache = this.caches.get(namespace);
        const item = cache.get(key);
        
        if (!item) return null;
        
        // TTL tekshirish
        if (Date.now() - item.timestamp > item.ttl) {
            cache.delete(key);
            return null;
        }
        
        return item.data;
    }

    set(namespace, key, data, ttl = 5 * 60 * 1000) {
        if (!this.caches.has(namespace)) {
            this.caches.set(namespace, new Map());
        }
        const cache = this.caches.get(namespace);
        cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    // Page-specific cache (sahifa o'zgarganda o'chiriladi)
    getPageCache(userId, page, key) {
        const pageKey = `${userId}_${page}`;
        if (!this.pageCaches.has(pageKey)) {
            this.pageCaches.set(pageKey, new Map());
        }
        const cache = this.pageCaches.get(pageKey);
        const item = cache.get(key);
        
        if (!item) return null;
        
        if (Date.now() - item.timestamp > item.ttl) {
            cache.delete(key);
            return null;
        }
        
        return item.data;
    }

    setPageCache(userId, page, key, data, ttl = 2 * 60 * 1000) {
        const pageKey = `${userId}_${page}`;
        if (!this.pageCaches.has(pageKey)) {
            this.pageCaches.set(pageKey, new Map());
        }
        const cache = this.pageCaches.get(pageKey);
        cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    // Sahifa o'zgarganda eski cache'larni o'chirish
    clearPageCache(userId, currentPage) {
        for (const [pageKey] of this.pageCaches.entries()) {
            if (pageKey.startsWith(`${userId}_`) && !pageKey.endsWith(`_${currentPage}`)) {
                this.pageCaches.delete(pageKey);
            }
        }
    }

    // User cache'larini tozalash
    clearUserCache(userId) {
        // Barcha namespace'lardan user cache'larini o'chirish
        for (const [namespace, cache] of this.caches.entries()) {
            for (const [key] of cache.entries()) {
                if (key.includes(`_${userId}_`) || key.includes(`user_${userId}`) || key.startsWith(`${userId}_`)) {
                    cache.delete(key);
                }
            }
        }
        
        // Page cache'larni o'chirish
        for (const [pageKey] of this.pageCaches.entries()) {
            if (pageKey.startsWith(`${userId}_`)) {
                this.pageCaches.delete(pageKey);
            }
        }
    }

    // Namespace bo'yicha tozalash
    clearNamespace(namespace) {
        this.caches.delete(namespace);
    }

    // Avtomatik cleanup (eski cache'larni o'chirish)
    startCleanup() {
        if (this.cleanupInterval) return;
        
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            
            // Global cache cleanup
            for (const [namespace, cache] of this.caches.entries()) {
                for (const [key, item] of cache.entries()) {
                    if (now - item.timestamp > item.ttl) {
                        cache.delete(key);
                    }
                }
            }
            
            // Page cache cleanup
            for (const [pageKey, cache] of this.pageCaches.entries()) {
                for (const [key, item] of cache.entries()) {
                    if (now - item.timestamp > item.ttl) {
                        cache.delete(key);
                    }
                }
            }
        }, 60 * 1000); // Har 1 daqiqada
    }

    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;

