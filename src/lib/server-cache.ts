type CacheEntry<T> = { value: T; expiresAt: number };

const STORE_KEY = "__km_server_cache__";

function getStore() {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[STORE_KEY];
  if (existing instanceof Map) return existing as Map<string, CacheEntry<unknown>>;
  const next = new Map<string, CacheEntry<unknown>>();
  g[STORE_KEY] = next;
  return next;
}

export function cacheGet<T>(key: string) {
  const store = getStore();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  const store = getStore();
  store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
}

export function cacheDelete(key: string) {
  const store = getStore();
  store.delete(key);
}

export function cacheDeleteByPrefix(prefix: string) {
  const store = getStore();
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
