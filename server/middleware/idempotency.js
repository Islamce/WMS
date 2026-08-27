/**
 * Idempotency-key support for create endpoints that may be replayed from a
 * client-side offline queue (e.g. the mobile app's Goods Receipt, recorded
 * while offline and sent once connectivity returns).
 *
 * A network drop can leave the client unsure whether its request actually
 * landed — the request may have created the record and only the response was
 * lost. Replaying it blindly would create it twice. The client instead sends
 * a stable `idempotency_key` with the request; the first successful (2xx)
 * response is cached against that key, and any replay with the same key
 * returns the exact same response instead of re-running the handler.
 *
 * Only meaningful for the specific routes that opt in via `withIdempotency` —
 * it is not a general request cache. Keys are scoped per-route so the same
 * key on a different endpoint can't collide.
 */
const db = require('./../db/connection');

const getStmt = db.prepare(
  'SELECT status_code, response_body FROM idempotency_keys WHERE idempotency_key = ? AND route = ?'
);
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO idempotency_keys (idempotency_key, route, status_code, response_body)
  VALUES (?, ?, ?, ?)
`);

/**
 * Wrap a route handler so a request carrying `idempotency_key` in its body
 * is deduplicated per `route` (a short fixed label, not the raw URL, so it
 * stays stable across path params).
 */
function withIdempotency(route, handler) {
  return (req, res, next) => {
    const key = req.body && req.body.idempotency_key;
    if (typeof key !== 'string' || !key.trim()) return handler(req, res, next);

    const existing = getStmt.get(key, route);
    if (existing) {
      return res.status(existing.status_code).json(JSON.parse(existing.response_body));
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          insertStmt.run(key, route, res.statusCode, JSON.stringify(body));
        } catch (err) {
          console.error('idempotency store failed:', err.message);
        }
      }
      return originalJson(body);
    };
    return handler(req, res, next);
  };
}

module.exports = { withIdempotency };
