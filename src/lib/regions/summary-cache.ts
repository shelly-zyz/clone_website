/** Share pending work as well as completed summaries; failures remain retryable. */
export function createSummaryCache<T>(ttlMs: number, maxEntries = 128) {
  const cached = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();
  return (key: string, calculate: () => Promise<T>): Promise<T> => {
    const entry = cached.get(key);
    if (entry && entry.expiresAt > Date.now()) return Promise.resolve(entry.value);
    cached.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(calculate).then((value) => {
      cached.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (cached.size > maxEntries) cached.delete(cached.keys().next().value!);
      return value;
    }).finally(() => { pending.delete(key); });
    pending.set(key, request);
    return request;
  };
}
