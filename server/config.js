require('dotenv').config();

const path = require('path');

// In production a real JWT secret is mandatory — with the dev fallback anyone
// could forge admin tokens. Fail fast at startup rather than run insecurely.
const PLACEHOLDER_SECRETS = ['change-me-to-a-long-random-string', 'dev-insecure-secret-change-me'];
if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 ||
     PLACEHOLDER_SECRETS.includes(process.env.JWT_SECRET))) {
  throw new Error(
    'FATAL: JWT_SECRET must be set (>= 32 chars) when NODE_ENV=production. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

module.exports = {
  port: process.env.PORT || 3000,
  // Dev-only fallback; production is guarded above.
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'data', 'wms.db'),
};
