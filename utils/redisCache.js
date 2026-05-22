const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
let redisClient;
let useRedis = false;
const memoryCache = new Map();

try {
  const { createClient } = require('redis');
  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (err) => {
    console.error('Redis Client Error', err);
  });
  useRedis = true;
} catch (error) {
  console.warn('Redis package not installed or unavailable. Falling back to in-memory cache.');
}

async function initRedis() {
  if (!useRedis) return;
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

async function getCache(key) {
  if (useRedis) {
    await initRedis();
    const cache = await redisClient.get(key);
    return cache ? JSON.parse(cache) : null;
  }

  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expire) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

async function setCache(key, value, ttlSeconds = 60) {
  if (useRedis) {
    await initRedis();
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return;
  }

  memoryCache.set(key, {
    value,
    expire: Date.now() + ttlSeconds * 1000,
  });
}

module.exports = {
  getCache,
  setCache,
  redisClient,
};
