/**
 * Consistent error responses. Deliberate client errors (4xx set on the thrown
 * error's `status`) carry their message through to the user; anything else is
 * treated as an unexpected server fault — logged in full server-side, but
 * returned as a generic 500 so we never leak stack traces, SQL, or internals.
 */
function sendError(res, err, fallbackMessage = 'Internal server error.') {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error(err);
  const message = status < 500 && err && err.message ? err.message : fallbackMessage;
  return res.status(status).json({ error: message });
}

module.exports = { sendError };
