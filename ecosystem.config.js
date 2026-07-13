// PM2 process manager config — for running WMS on a Hostinger VPS without
// Docker. Usage:
//   npm ci --omit=dev && npm run setup      # install + create/seed the DB once
//   pm2 start ecosystem.config.js           # start under PM2
//   pm2 save && pm2 startup                 # keep it running after reboot
module.exports = {
  apps: [
    {
      name: 'wms',
      script: 'server/index.js',
      instances: 1, // SQLite is single-writer — do NOT run cluster mode.
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        JWT_EXPIRES_IN: '8h',
        // Set the real secret via the panel / shell, not in git:
        //   pm2 set ... or export JWT_SECRET=... before `pm2 start`.
        // JWT_SECRET is intentionally omitted here so it is never committed.
        DB_PATH: './data/wms.db',
      },
    },
  ],
};
