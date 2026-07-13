# Deploying WMS on Hostinger

WMS is a **Node.js** app (Express + SQLite), not a PHP site, so it needs a
plan that can run Node.js. Two paths are supported — pick the one that matches
your Hostinger plan:

| Your Hostinger plan | Use | Difficulty |
|---------------------|-----|------------|
| **VPS** (KVM 1/2/…) | Path A — Docker **or** Path B — PM2 | recommended, full control |
| **Business / Cloud shared hosting** (has "Node.js" in hPanel) | Path C — hPanel Node.js app | easiest, some limitations |
| Premium / Single shared hosting (no Node.js) | ❌ not supported — Node.js can't run there | — |

> **Native module note:** WMS uses `better-sqlite3`, a compiled addon. It
> installs cleanly on a VPS. On shared Node.js hosting it usually works from
> prebuilt binaries; if `npm install` fails to build it, use a VPS instead.

Before you start, generate a real JWT secret (you'll paste it in below):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Path A — VPS with Docker (recommended)

1. In hPanel, create a **VPS** and choose the **Ubuntu 22.04 with Docker**
   template (or install Docker yourself). SSH in.
2. Clone the repo and enter it:
   ```bash
   git clone https://github.com/Islamce/WMS.git && cd WMS
   ```
3. Export your secret and start it:
   ```bash
   export JWT_SECRET="<paste the generated secret>"
   docker compose up -d --build
   docker compose run --rm wms npm run seed   # one time: default admin + sample data
   ```
4. The app now listens on port **3000**. Point Hostinger's firewall / a reverse
   proxy at it and add SSL (see **HTTPS** below).
5. Health check: `curl http://localhost:3000/healthz` → `{"status":"ok"}`.

Update later with `git pull && docker compose up -d --build` (your data lives in
the `wms-data` volume and is preserved).

---

## Path B — VPS with PM2 (no Docker)

1. SSH into the VPS. Install Node.js 20 LTS:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs build-essential python3
   ```
2. Clone, install, seed:
   ```bash
   git clone https://github.com/Islamce/WMS.git && cd WMS
   npm ci --omit=dev
   npm run setup            # creates + seeds data/wms.db
   ```
3. Set the secret and start under PM2:
   ```bash
   npm install -g pm2
   export JWT_SECRET="<paste the generated secret>"
   pm2 start ecosystem.config.js
   pm2 save && pm2 startup   # run the command it prints, to survive reboots
   ```
4. App is on port **3000**. Add a reverse proxy + SSL (below).

---

## Path C — Shared hosting, hPanel "Node.js" app

1. In hPanel: **Websites → your domain → Advanced → Node.js** (Business/Cloud
   plans). Click **Create application**.
2. Fill in:
   - **Node.js version:** 20.x (or the newest offered)
   - **Application root:** the folder you'll upload the code to (e.g. `wms`)
   - **Application URL:** your domain or subdomain
   - **Application startup file:** `app.js`  ← this repo's root shim
3. Upload the project into the application root (Git deploy, or the File
   Manager / SFTP). Don't upload `node_modules` or `data/`.
4. In the Node.js app panel, add **Environment variables**:
   - `NODE_ENV = production`
   - `JWT_SECRET = <paste the generated secret>`
   - `JWT_EXPIRES_IN = 8h`
   - `DB_PATH = ./data/wms.db`
   (Leave `PORT` unset — Passenger assigns it.)
5. Click **Run NPM Install**, then open the panel's terminal (or SSH) in the app
   root and seed once:
   ```bash
   npm run seed
   ```
6. **Restart** the application from the panel. Your domain now serves WMS.

> Passenger starts `app.js` for you and injects the port; the app already reads
> `process.env.PORT`. If the DB can't be written, make sure `data/` exists and
> is writable, or point `DB_PATH` at a writable location.

---

## HTTPS

- **Shared / hPanel Node.js:** SSL is handled by Hostinger — enable **SSL** for
  the domain in hPanel (free Let's Encrypt). Nothing to change in the app.
- **VPS:** terminate TLS at a reverse proxy in front of port 3000. Minimal Nginx:
  ```nginx
  server {
    server_name wms.example.com;
    location / {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
  ```
  Then `sudo certbot --nginx -d wms.example.com` for a free certificate. The app
  already sets `trust proxy`, so the login rate-limiter sees real client IPs.

---

## First login & hardening

1. Log in with the seeded admin: **`admin@example.com` / `Admin@123456`**.
2. **Immediately** change that password (or create a new admin and disable the
   default) from **Users Management**.
3. Confirm production guards are active: with `NODE_ENV=production` the server
   refuses to boot unless `JWT_SECRET` is a real ≥32-char secret. Login is
   rate-limited (10 failures / 15 min per IP+email), and `helmet` security
   headers are on.

## Backups

The whole database is the single file at `DB_PATH` (`data/wms.db`). Back it up
on a schedule, e.g. a daily cron:

```bash
sqlite3 /path/to/data/wms.db ".backup '/path/to/backups/wms-$(date +\%F).db'"
```

Keep the mobile app pointed at this server's public `https://` URL (set it under
**Server settings** in the app).
