export interface CachedEventStats {
  kpi: Record<string, unknown>;
  top_networks: Array<{ label: string; value: number }>;
  top_countries: Array<{ label: string; value: number }>;
  expiresAt: number;
}

const TTL_MS = 60_000; // 60 seconds
const MAX_ENTRIES = 50;

const globalCache = globalThis as unknown as {
  eventsStatsCache?: Map<string, CachedEventStats>;
};

function getCacheMap(): Map<string, CachedEventStats> {
  if (!globalCache.eventsStatsCache) {
    globalCache.eventsStatsCache = new Map();
  }
  return globalCache.eventsStatsCache;
}

export function getCachedEventStats(key: string): CachedEventStats | null {
  const map = getCacheMap();
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry;
}

export function setCachedEventStats(
  key: string,
  stats: Omit<CachedEventStats, "expiresAt">
): void {
  const map = getCacheMap();
  if (map.size >= MAX_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, {
    ...stats,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function invalidateEventsStatsCache(): void {
  getCacheMap().clear();
}
