import type { Store } from "./store.ts";

export interface RateLimiter {
  allow(key: string): Promise<boolean>;
}

export function createRateLimiter(opts: { store: Store; limit: number; windowMs: number }): RateLimiter {
  return {
    async allow(key) {
      return (await opts.store.hit(key, opts.windowMs)) <= opts.limit;
    },
  };
}
