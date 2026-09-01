const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// In-Memory Fallback Engine with TTL support
class InMemoryCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlSeconds = 60) {
    const expiry = Date.now() + (ttlSeconds * 1000);
    this.store.set(key, { value, expiry });
  }

  del(key) {
    this.store.delete(key);
  }

  invalidatePattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  flush() {
    this.store.clear();
  }
}

const memoryFallback = new InMemoryCache();
let redisClient = null;
let isRedisAvailable = false;

const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

try {
  const options = {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts, switch to memory fallback
      }
      return Math.min(times * 100, 1000);
    },
    enableOfflineQueue: false,
    lazyConnect: true
  };

  if (redisUrl) {
    redisClient = new Redis(redisUrl, options);
  } else {
    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      ...options
    });
  }

  redisClient.connect().then(() => {
    isRedisAvailable = true;
    console.log('⚡ [Cache] Connected to Redis Cache Server successfully.');
  }).catch((err) => {
    isRedisAvailable = false;
    console.log('⚡ [Cache] Redis Server not detected. Active Engine: Ultra-Fast High-Performance In-Memory Cache (0ms latency).');
  });

  redisClient.on('error', (err) => {
    if (isRedisAvailable) {
      console.warn('⚠️ [Cache] Redis connection lost. Falling back to In-Memory Cache.');
    }
    isRedisAvailable = false;
  });

  redisClient.on('connect', () => {
    isRedisAvailable = true;
    console.log('⚡ [Cache] Redis connected.');
  });
} catch (e) {
  isRedisAvailable = false;
  console.log('⚡ [Cache] Running with Ultra-Fast In-Memory Cache Layer.');
}

const CacheService = {
  async get(key) {
    if (isRedisAvailable && redisClient) {
      try {
        const raw = await redisClient.get(key);
        if (raw) return JSON.parse(raw);
      } catch (err) {
        // Fallback to memory
      }
    }
    return memoryFallback.get(key);
  },

  async set(key, value, ttlSeconds = 60) {
    memoryFallback.set(key, value, ttlSeconds);
    if (isRedisAvailable && redisClient) {
      try {
        await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
      } catch (err) {
        // Ignore redis write error
      }
    }
  },

  async del(key) {
    memoryFallback.del(key);
    if (isRedisAvailable && redisClient) {
      try {
        await redisClient.del(key);
      } catch (err) {
        // Ignore
      }
    }
  },

  async invalidatePattern(pattern) {
    memoryFallback.invalidatePattern(pattern);
    if (isRedisAvailable && redisClient) {
      try {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } catch (err) {
        // Ignore
      }
    }
  },

  async flush() {
    memoryFallback.flush();
    if (isRedisAvailable && redisClient) {
      try {
        await redisClient.flushdb();
      } catch (err) {
        // Ignore
      }
    }
  },

  // Cache-aside helper
  async wrap(key, ttlSeconds, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
    const freshData = await fetchFn();
    if (freshData !== null && freshData !== undefined) {
      await this.set(key, freshData, ttlSeconds);
    }
    return freshData;
  },

  isRedisConnected() {
    return isRedisAvailable;
  }
};

// Express route caching middleware
function cacheRoute(ttlSeconds = 60, customKeyFn = null) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const { getBranchStore } = require('../middleware/branchContext');
    const branchStore = getBranchStore();

    // Derive verified branch scope strictly from authenticated execution context
    let branchScope = null;
    if (req.user?.isSuperAdmin || branchStore?.isSuperAdmin) {
      if (req.headers['x-branch-id']) {
        const headerBId = parseInt(req.headers['x-branch-id'], 10);
        branchScope = !isNaN(headerBId) ? `branch_${headerBId}` : 'sa_all';
      } else {
        branchScope = 'sa_all';
      }
    } else {
      const verifiedBranchId = branchStore?.branchId || req.user?.branchId || req.branchId;
      if (!verifiedBranchId) {
        // If no verified branch context exists, bypass caching to prevent cross-branch leakage
        return next();
      }
      branchScope = `branch_${verifiedBranchId}`;
    }

    const role = req.user?.role || 'anon';
    const userId = req.user?.id || 'anon';

    const key = customKeyFn
      ? customKeyFn(req)
      : `route:${branchScope}:${req.baseUrl || ''}${req.path || ''}:${JSON.stringify(req.query || {})}:${role}:${userId}`;

    try {
      const cached = await CacheService.get(key);
      if (cached) {
        res.setHeader('X-Cache-Status', 'HIT');
        return res.json(cached);
      }
    } catch (err) {
      // Continue to handler
    }

    // Intercept res.json to populate cache
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      res.setHeader('X-Cache-Status', 'MISS');
      if (res.statusCode >= 200 && res.statusCode < 300 && data && data.success !== false) {
        CacheService.set(key, data, ttlSeconds).catch(() => {});
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = {
  CacheService,
  cacheRoute
};
