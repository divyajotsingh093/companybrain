const MAX_KEYS = 50_000;

export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    allow(key) {
      const t = now();
      const current = windows.get(key);
      if (!current || t - current.start >= opts.windowMs) {
        windows.delete(key);
        windows.set(key, { start: t, count: 1 });
        if (windows.size > MAX_KEYS) windows.delete(windows.keys().next().value as string);
        return true;
      }
      current.count++;
      return current.count <= opts.limit;
    },
  };
}
