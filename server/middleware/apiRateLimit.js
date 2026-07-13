/**
 * Global API rate limiter — dependency-free, in-memory, fixed-window per IP.
 *
 * Complements the stricter per-email login limiter: this is a coarse ceiling on
 * total API calls from one client so a single source can't hammer the whole
 * surface. Defaults are generous (2000 requests / 60s) and configurable via
 * API_RATE_LIMIT / API_RATE_WINDOW_MS. Set API_RATE_LIMIT=0 to disable.
 *
 * In-memory state suits the single-process deployment; move to a shared store
 * (Redis) when running multiple instances. The pure `check()` is exported so
 * the limiting logic is unit-testable without issuing thousands of requests.
 */
const buckets = new Map(); // key -> { count, windowStart }

function limitFromEnv() {
  const v = process.env.API_RATE_LIMIT;
  return v === undefined ? 2000 : Number(v);
}
function windowFromEnv() {
  return Number(process.env.API_RATE_WINDOW_MS) || 60000;
}

/**
 * Record a hit for `key` and decide if it's allowed.
 * Returns { allowed, remaining, retryAfterMs }.
 */
function check(key, max, windowMs, now = Date.now()) {
  if (!max || max <= 0) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  b.count += 1;
  const allowed = b.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - b.count),
    retryAfterMs: allowed ? 0 : b.windowStart + windowMs - now,
  };
}

function prune(now, windowMs) {
  for (const [k, v] of buckets) {
    if (now - v.windowStart >= windowMs) buckets.delete(k);
  }
}

/** Express middleware. */
function apiRateLimit(req, res, next) {
  const max = limitFromEnv();
  if (!max || max <= 0) return next();
  const windowMs = windowFromEnv();
  const now = Date.now();
  if (buckets.size > 20000) prune(now, windowMs);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const r = check(ip, max, windowMs, now);
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(r.remaining === Infinity ? max : r.remaining));
  if (!r.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
  }
  next();
}

module.exports = { apiRateLimit, check, _buckets: buckets };
