const logger = require('../utils/logger');

/**
 * Basic In-Memory Cache implementation using standard Map.
 * Provides TTL (Time-to-Live) based expiration.
 */
class CacheService {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Set a value in the cache with a specific TTL
     * @param {string} key 
     * @param {any} value 
     * @param {number} ttlSeconds 
     */
    set(key, value, ttlSeconds = 1800) { // 30 minutes default
        const expiresAt = Date.now() + (ttlSeconds * 1000);
        this.cache.set(key, { value, expiresAt });
    }

    /**
     * Get a value from the cache, strictly if not expired.
     * If expired, removes it and returns null.
     * @param {string} key 
     * @returns {any} value or null
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    /**
     * Manually delete a key
     * @param {string} key 
     */
    delete(key) {
        this.cache.delete(key);
    }

    /**
     * Periodically wipe completely expired keys from Map to avoid memory leaks.
     * Can be called automatically by a setInterval if preferred.
     */
    cleanup() {
        let deletedCount = 0;
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.cache.delete(key);
                deletedCount++;
            }
        }
        if (deletedCount > 0) {
            logger.info('Cache cleanup completed', { deletedCount });
        }
    }
}

// Export as a singleton
const cacheService = new CacheService();

// Run cleanup every 15 minutes
setInterval(() => cacheService.cleanup(), 15 * 60 * 1000);

module.exports = cacheService;
