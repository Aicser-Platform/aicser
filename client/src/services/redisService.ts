// Redis Service for Aiser World - Caching and Performance Optimization
import { environment } from '@/config/environment';

export interface RedisCacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string; // Key prefix for namespacing
}

export interface CacheResult<T> {
  data: T | null;
  fromCache: boolean;
  timestamp: number;
}

class RedisService {
  private isEnabled: boolean;
  private baseUrl: string;

  constructor() {
    this.isEnabled = false; // Disable Redis for now since it's not configured
    this.baseUrl = environment.api.baseUrl;
  }

  // Set cache with TTL
  async setCache<T>(key: string, data: T, options: RedisCacheOptions = {}): Promise<boolean> {
    if (!this.isEnabled) return false;

    try {
      const cacheKey = this.buildCacheKey(key, options.prefix);
      const cacheData = {
        data,
        timestamp: Date.now(),
        ttl: options.ttl || 3600 // Default 1 hour
      };

      const response = await fetch(`${this.baseUrl}/cache/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: cacheKey,
          data: cacheData,
          ttl: options.ttl || 3600
        }),
      });

      return response.ok;
    } catch (error) {
      console.warn('Redis cache set failed:', error);
      return false;
    }
  }

  // Get cache data
  async getCache<T>(key: string, options: RedisCacheOptions = {}): Promise<CacheResult<T> | null> {
    if (!this.isEnabled) return null;

    try {
      const cacheKey = this.buildCacheKey(key, options.prefix);
      
      const response = await fetch(`${this.baseUrl}/cache/get?key=${encodeURIComponent(cacheKey)}`);
      
      if (!response.ok) return null;

      const result = await response.json();
      
      if (result.success && result.data) {
        // Check if cache is expired
        const now = Date.now();
        const cacheAge = now - result.data.timestamp;
        const ttlMs = (result.data.ttl || 3600) * 1000;

        if (cacheAge < ttlMs) {
          return {
            data: result.data.data,
            fromCache: true,
            timestamp: result.data.timestamp
          };
        } else {
          // Cache expired, remove it
          await this.deleteCache(cacheKey);
          return null;
        }
      }

      return null;
    } catch (error) {
      console.warn('Redis cache get failed:', error);
      return null;
    }
  }

  // Delete cache
  async deleteCache(key: string, options: RedisCacheOptions = {}): Promise<boolean> {
    if (!this.isEnabled) return false;

    try {
      const cacheKey = this.buildCacheKey(key, options.prefix);
      
      const response = await fetch(`${this.baseUrl}/cache/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: cacheKey }),
      });

      return response.ok;
    } catch (error) {
      console.warn('Redis cache delete failed:', error);
      return false;
    }
  }

  // Clear all cache with prefix
  async clearCache(prefix?: string): Promise<boolean> {
    if (!this.isEnabled) return false;

    try {
      const response = await fetch(`${this.baseUrl}/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefix }),
      });

      return response.ok;
    } catch (error) {
      console.warn('Redis cache clear failed:', error);
      return false;
    }
  }

  // Get cache statistics
  async getCacheStats(): Promise<any> {
    if (!this.isEnabled) return null;

    try {
      const response = await fetch(`${this.baseUrl}/cache/stats`);
      
      if (response.ok) {
        return await response.json();
      }
      
      return null;
    } catch (error) {
      console.warn('Redis cache stats failed:', error);
      return null;
    }
  }

  // Cache with automatic fallback
  async cacheWithFallback<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: RedisCacheOptions = {}
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.getCache<T>(key, options);
    
    if (cached && cached.data) {
      return cached.data;
    }

    // Fetch fresh data
    const freshData = await fetchFunction();
    
    // Cache the fresh data
    await this.setCache(key, freshData, options);
    
    return freshData;
  }

  // Build cache key with prefix
  private buildCacheKey(key: string, prefix?: string): string {
    const baseKey = prefix ? `${prefix}:${key}` : key;
    return `aiser:${baseKey}`;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    if (!this.isEnabled) return false;

    try {
      const response = await fetch(`${this.baseUrl}/cache/health`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();

// Cache decorator for functions
export function cacheResult<T>(
  key: string,
  options: RedisCacheOptions = {}
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${key}:${JSON.stringify(args)}`;
      
      try {
        const cached = await redisService.getCache<T>(cacheKey, options);
        if (cached && cached.data) {
          return cached.data;
        }

        const result = await method.apply(this, args);
        await redisService.setCache(cacheKey, result, options);
        return result;
      } catch (error) {
        console.warn(`Cache decorator failed for ${propertyName}:`, error);
        return await method.apply(this, args);
      }
    };
  };
}
