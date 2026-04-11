import { createClient } from "redis";
import { config } from "../config.js";

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  disconnect(): Promise<void>;
}

type RedisClient = ReturnType<typeof createClient>;
type CacheStoreKind = "redis" | "memory";

class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  async disconnect(): Promise<void> {}
}

class RedisBackedCacheStore implements CacheStore {
  constructor(private readonly client: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), {
      EX: ttlSeconds
    });
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

let cacheStorePromise: Promise<CacheStore> | null = null;
let cacheStoreKind: CacheStoreKind | null = null;

export function getCacheStore(): Promise<CacheStore> {
  if (!cacheStorePromise) {
    cacheStorePromise = createCacheStore();
  }

  return cacheStorePromise;
}

export function getCacheStoreKind(): CacheStoreKind | null {
  return cacheStoreKind;
}

async function createCacheStore(): Promise<CacheStore> {
  if (!config.redisUrl) {
    cacheStoreKind = "memory";
    return new MemoryCacheStore();
  }

  try {
    const client = createClient({
      url: config.redisUrl
    });

    client.on("error", (error) => {
      console.error("Redis client error:", error);
    });

    await client.connect();
    cacheStoreKind = "redis";
    return new RedisBackedCacheStore(client);
  } catch (error) {
    console.warn("Falling back to memory cache because Redis could not connect.", error);
    cacheStoreKind = "memory";
    return new MemoryCacheStore();
  }
}
