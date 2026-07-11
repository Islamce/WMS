/**
 * Login rate limiter — dependency-free, in-memory.
 *
 * Counts FAILED login attempts per (client IP + email). After MAX_FAILURES
 * within WINDOW_MS the pair is blocked until the window expires (HTTP 429).
 * A successful login clears the counter. In-memory state is appropriate for
 * the current single-process deployment; swap for a shared store (Redis)
 * when running multiple instances.
 */
const WINDOW_MS = 15 * 60 * 1000;  // 15 minutes
const MAX_FAILURES = 10;

const attempts = new Map(); // key -> { count, firstAt }

function keyFor(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  return `${ip}|${email}`;
}

function prune(now) {
  for (const [k, v] of attempts) {
    if (now - v.firstAt > WINDOW_MS) attempts.delete(k);
  }
}

/** Express middleware: reject when the failure budget is exhausted. */
function loginRateLimit(req, res, next) {
  const now = Date.now();
  if (attempts.size > 10000) prune(now); // bound memory under abuse
  const entry = attempts.get(keyFor(req));
  if (entry && now - entry.firstAt <= WINDOW_MS && entry.count >= MAX_FAILURES) {
    const retryMin = Math.ceil((entry.firstAt + WINDOW_MS - now) / 60000);
    return res.status(429).json({
      error: `Too many failed login attempts. Try again in ~${retryMin} minute(s).`,
    });
  }
  next();
}

/** Call on a failed login to consume one attempt from the budget. */
function recordLoginFailure(req) {
  const now = Date.now();
  const key = keyFor(req);
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

/** Call on a successful login to clear the counter for this key. */
function clearLoginFailures(req) {
  attempts.delete(keyFor(req));
}

module.exports = { loginRateLimit, recordLoginFailure, clearLoginFailures, WINDOW_MS, MAX_FAILURES };
