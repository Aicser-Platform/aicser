import hashlib
import json
import logging
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

import redis

logger = logging.getLogger(__name__)


def _json_serial_default(obj: Any) -> Any:
    """Convert date/datetime/Decimal/UUID to JSON-serializable form so cache values never fail."""
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _stable_context_hash(context: Optional[Dict[str, Any]]) -> str:
    """Stable hash of context for cache keys (same input => same hash across processes)."""
    if not context:
        return hashlib.sha256(b"{}").hexdigest()
    try:
        payload = json.dumps(context, sort_keys=True, default=_json_serial_default)
    except (TypeError, ValueError):
        payload = str(context)
    return hashlib.sha256(payload.encode()).hexdigest()


class RedisCache:
    """Redis-based cache with fallback to in-memory cache"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379", 
                 max_fallback_size: int = 1000, 
                 default_ttl: int = 3600):
        self.redis_url = redis_url
        self.max_fallback_size = max_fallback_size
        self.default_ttl = default_ttl
        self.redis_client = None
        self.fallback_cache = {}
        self.cache_stats = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'deletes': 0,
            'errors': 0
        }
        self._initialize_redis()
    
    def _initialize_redis(self):
        """Initialize Redis connection"""
        try:
            self.redis_client = redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
                health_check_interval=30
            )
            # Test connection
            self.redis_client.ping()
            logger.info("✅ Redis connection established")
            
        except Exception as e:
            logger.warning(f"⚠️ Redis connection failed: {e}")
            self.redis_client = None
    
    def get_ai_response(self, query: str, context: Optional[Dict[str, Any]] = None) -> Optional[Any]:
        """Get cached AI response for a query and context"""
        try:
            # Generate cache key from query and context
            cache_key = self._generate_key("ai_response", f"{query}:{_stable_context_hash(context)}")
            return self.get(cache_key)
        except Exception as e:
            logger.error(f"Error getting AI response from cache: {e}")
            return None
    
    def set_ai_response(self, query: str, response: Any, context: Optional[Dict[str, Any]] = None, ttl: Optional[int] = None) -> bool:
        """Set cached AI response for a query and context"""
        try:
            # Generate cache key from query and context
            cache_key = self._generate_key("ai_response", f"{query}:{_stable_context_hash(context)}")
            return self.set(cache_key, response, ttl)
        except Exception as e:
            logger.error(f"Error setting AI response in cache: {e}")
            return False

    def _scan_keys(self, pattern: str) -> List[str]:
        """Collect keys matching pattern using SCAN (O(1) per call, non-blocking)."""
        if not self.redis_client:
            return []
        keys = []
        cursor = 0
        while True:
            cursor, batch = self.redis_client.scan(cursor=cursor, match=pattern, count=100)
            keys.extend(batch)
            if cursor == 0:
                break
        return keys

    def clear_ai_cache(self):
        """Clear all AI response cache"""
        try:
            if self.redis_client:
                keys = self._scan_keys("ai_response:*")
                if keys:
                    self.redis_client.delete(*keys)
                    logger.info(f"🧹 Cleared {len(keys)} AI cache entries from Redis")
            
            # Clear fallback cache
            ai_keys = [k for k in self.fallback_cache.keys() if k.startswith("ai_response:")]
            for key in ai_keys:
                del self.fallback_cache[key]
            
            if ai_keys:
                logger.info(f"🧹 Cleared {len(ai_keys)} AI cache entries from fallback cache")
                
        except Exception as e:
            logger.error(f"Error clearing AI cache: {e}")

    def _generate_key(self, prefix: str, identifier: str) -> str:
        """Generate consistent cache key"""
        key_string = f"{prefix}:{identifier}"
        return hashlib.md5(key_string.encode()).hexdigest()
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get value from cache"""
        try:
            # Try Redis first
            if self.redis_client:
                value = self.redis_client.get(key)
                if value is not None:
                    self.cache_stats['hits'] += 1
                    return json.loads(value)
            
            # Fallback to in-memory cache
            if key in self.fallback_cache:
                item = self.fallback_cache[key]
                if time.time() < item['expires_at']:
                    self.cache_stats['hits'] += 1
                    return item['value']
                else:
                    # Expired, remove it
                    del self.fallback_cache[key]
            
            self.cache_stats['misses'] += 1
            return default
            
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            self.cache_stats['errors'] += 1
            return default
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set value in cache"""
        if ttl is None:
            ttl = self.default_ttl
        
        try:
            # Try Redis first
            if self.redis_client:
                serialized_value = json.dumps(value, default=_json_serial_default)
                self.redis_client.setex(key, ttl, serialized_value)
                self.cache_stats['sets'] += 1
                return True
            
            # Fallback to in-memory cache
            if len(self.fallback_cache) >= self.max_fallback_size:
                # Remove oldest items
                oldest_keys = sorted(
                    self.fallback_cache.keys(),
                    key=lambda k: self.fallback_cache[k]['created_at']
                )[:len(self.fallback_cache) // 4]
                for old_key in oldest_keys:
                    del self.fallback_cache[old_key]
            
            self.fallback_cache[key] = {
                'value': value,
                'created_at': time.time(),
                'expires_at': time.time() + ttl
            }
            self.cache_stats['sets'] += 1
            return True
            
        except Exception as e:
            logger.error(f"Cache set error: {e}")
            self.cache_stats['errors'] += 1
            return False
    
    def delete(self, key: str) -> bool:
        """Delete value from cache"""
        try:
            # Try Redis first
            if self.redis_client:
                self.redis_client.delete(key)
            
            # Remove from fallback cache
            if key in self.fallback_cache:
                del self.fallback_cache[key]
            
            self.cache_stats['deletes'] += 1
            return True
            
        except Exception as e:
            logger.error(f"Cache delete error: {e}")
            self.cache_stats['errors'] += 1
            return False
    
    def exists(self, key: str) -> bool:
        """Check if key exists in cache"""
        try:
            # Try Redis first
            if self.redis_client:
                return bool(self.redis_client.exists(key))
            
            # Check fallback cache
            if key in self.fallback_cache:
                item = self.fallback_cache[key]
                if time.time() < item['expires_at']:
                    return True
                else:
                    # Expired, remove it
                    del self.fallback_cache[key]
            
            return False
            
        except Exception as e:
            logger.error(f"Cache exists error: {e}")
            return False
    
    def ttl(self, key: str) -> int:
        """Get remaining TTL for key"""
        try:
            # Try Redis first
            if self.redis_client:
                ttl = self.redis_client.ttl(key)
                if ttl > 0:
                    return ttl
            
            # Check fallback cache
            if key in self.fallback_cache:
                item = self.fallback_cache[key]
                remaining = item['expires_at'] - time.time()
                return max(0, int(remaining))
            
            return -1
            
        except Exception as e:
            logger.error(f"Cache TTL error: {e}")
            return -1
    
    def increment(self, key: str, amount: int = 1) -> int:
        """Increment numeric value"""
        try:
            # Try Redis first
            if self.redis_client:
                return self.redis_client.incr(key, amount)
            
            # Fallback to in-memory
            current = self.get(key, 0)
            if isinstance(current, (int, float)):
                new_value: Union[int, float] = current + amount
                self.set(key, new_value)
                # Ensure int return type
                return int(new_value) if isinstance(new_value, float) else new_value
            
            return 0
            
        except Exception as e:
            logger.error(f"Cache increment error: {e}")
            return 0
    
    def expire(self, key: str, ttl: int) -> bool:
        """Set expiration for existing key"""
        try:
            # Try Redis first
            if self.redis_client:
                return bool(self.redis_client.expire(key, ttl))
            
            # Update fallback cache
            if key in self.fallback_cache:
                self.fallback_cache[key]['expires_at'] = time.time() + ttl
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Cache expire error: {e}")
            return False
    
    def get_many(self, keys: List[str]) -> Dict[str, Any]:
        """Get multiple values at once"""
        result = {}
        for key in keys:
            value = self.get(key)
            if value is not None:
                result[key] = value
        return result
    
    def set_many(self, data: Dict[str, Any], ttl: Optional[int] = None) -> bool:
        """Set multiple values at once"""
        success = True
        for key, value in data.items():
            if not self.set(key, value, ttl):
                success = False
        return success
    
    def clear_pattern(self, pattern: str) -> int:
        """Clear keys matching pattern"""
        cleared_count = 0
        
        try:
            # Try Redis first (use SCAN to avoid blocking)
            if self.redis_client:
                keys = self._scan_keys(pattern)
                if keys:
                    cleared_count += self.redis_client.delete(*keys)
            
            # Clear fallback cache
            keys_to_remove = [k for k in self.fallback_cache.keys() if pattern in k]
            for key in keys_to_remove:
                del self.fallback_cache[key]
                cleared_count += 1
            
            return cleared_count
            
        except Exception as e:
            logger.error(f"Cache clear pattern error: {e}")
            return 0
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get comprehensive cache statistics"""
        stats = self.cache_stats.copy()
        stats.update({
            'redis_connected': self.redis_client is not None,
            'fallback_cache_size': len(self.fallback_cache),
            'fallback_cache_max': self.max_fallback_size
        })
        
        # Add Redis info if available
        if self.redis_client:
            try:
                redis_info = self.redis_client.info()
                stats.update({
                    'redis_memory_used': redis_info.get('used_memory_human'),
                    'redis_connected_clients': redis_info.get('connected_clients'),
                    'redis_keyspace_hits': redis_info.get('keyspace_hits', 0),
                    'redis_keyspace_misses': redis_info.get('keyspace_misses', 0)
                })
            except Exception as e:
                logger.warning(f"Failed to get Redis info: {e}")
        
        return stats
    
    def clear_cache(self, pattern: Optional[str] = None):
        """Clear cache with optional pattern matching"""
        cleared_count = 0
        
        # Clear Redis (use SCAN when pattern given to avoid blocking)
        if self.redis_client:
            try:
                if pattern:
                    keys = self._scan_keys(pattern)
                    if keys:
                        cleared_count += self.redis_client.delete(*keys)
                else:
                    self.redis_client.flushdb()
                    cleared_count = -1  # All keys cleared
                    
            except Exception as e:
                logger.error(f"Failed to clear Redis cache: {e}")
        
        # Clear fallback cache
        if pattern:
            keys_to_remove = [k for k in self.fallback_cache.keys() if pattern in k]
            for key in keys_to_remove:
                del self.fallback_cache[key]
        else:
            self.fallback_cache.clear()
        
        logger.info(f"🧹 Cache cleared: {cleared_count} keys")
        return cleared_count
    
    async def health_check(self) -> Dict[str, Any]:
        """Perform cache health check"""
        health: Dict[str, Any] = {
            'redis_healthy': False,
            'fallback_healthy': True,
            'response_time_ms': None
        }
        
        if self.redis_client:
            try:
                start_time = time.time()
                self.redis_client.ping()
                health['response_time_ms'] = (time.time() - start_time) * 1000
                health['redis_healthy'] = True
                
            except Exception as e:
                logger.warning(f"Redis health check failed: {e}")
        
        return health

# Global cache instance - will be initialized with proper config
cache = None

def initialize_cache():
    """Initialize the global cache instance with proper configuration"""
    global cache
    from src.core.config import settings
    
    # Use Redis URL from environment or fallback to Docker service name
    redis_url = settings.REDIS_URL
    if redis_url == "redis://localhost:6379" or "localhost" in redis_url:
        # Fallback to Docker service name for containerized environments
        redis_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    
    cache = RedisCache(redis_url=redis_url)
    return cache

# Initialize cache when module is imported
try:
    initialize_cache()
except Exception as e:
    logger.warning(f"Failed to initialize cache with config: {e}")
    # Fallback to default localhost for development
    cache = RedisCache()