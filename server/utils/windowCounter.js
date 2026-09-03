/**
 * Minimal fixed-window bucket counter keyed by an arbitrary string. Both
 * in-memory rate limiters (`middleware/rateLimit.js` for login failures,
 * `middleware/apiRateLimit.js` for the global API ceiling) were duplicating
 * this exact bucket-map + prune bookkeeping; this is just that shared part —
 * not a general cache, and not a place to add unrelated behavior.
 *
 * In-memory state suits the current single-process deployment; swap for a
 * shared store (Redis) if the app ever runs multiple instances.
 */
class WindowCounter {
  constructor() {
    this.buckets = new Map(); // key -> { count, windowStart }
  }

  /** Get (or start) the bucket for `key`, resetting it if its window elapsed. */
  bucket(key, windowMs, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b || now - b.windowStart >= windowMs) {
      b = { count: 0, windowStart: now };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Drop buckets whose window has fully elapsed, to bound memory under abuse. */
  prune(windowMs, now = Date.now()) {
    for (const [k, v] of this.buckets) {
      if (now - v.windowStart >= windowMs) this.buckets.delete(k);
    }
  }

  get size() {
    return this.buckets.size;
  }
}

module.exports = { WindowCounter };
