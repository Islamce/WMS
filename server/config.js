require('dotenv').config();

const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  // WARNING: set a strong JWT_SECRET in production via .env
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'data', 'wms.db'),
};
