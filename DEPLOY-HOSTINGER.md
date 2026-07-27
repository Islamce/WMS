# Deploying WMS on Hostinger

WMS is a **Node.js** app (Express + SQLite), not a PHP site, so it needs a
plan that can run Node.js. Two paths are supported — pick the one that matches
your Hostinger plan:

| Your Hostinger plan | Use | Difficulty |
|---------------------|-----|------------|
| **Business / Cloud** with the **Web Apps** deployer (Express is supported) | Path D — git-connected Web App | easiest, auto-deploys on push |
| **VPS** (KVM 1/2/…) | Path A — Docker **or** Path B — PM2 | recommended, full control |
| **Business / Cloud shared hosting** (older "Node.js" app in hPanel) | Path C — hPanel Node.js app | easy |
| Premium / Single shared hosting (no Node.js) | ❌ not supported — Node.js can't run there | — |

> **First-run bootstrap (opt-in):** the server always creates the schema. It
> will additionally seed the default admin, roles/permissions, warehouses/bins
> and demo data **only when you start it once with `ALLOW_AUTO_SEED=1`**.
> Otherwise an empty database is left untouched and a `[CRITICAL]` warning is
> logged. `npm run seed` remains the normal manual route.
>
> Seeding is opt-in on purpose. It writes a *default administrator*, so if it
> ever fired against a live-but-empty database it would mask data loss and reset
> the admin credentials. Making it depend on a variable being *present* (rather
> than on `NODE_ENV` being absent) means a missing environment fails safe.
> See `docs/WMS-INCIDENT-LOG.md` → `INC-2026-07-25-01`.

> ⚠️ **If your users/passwords "disappear" after a redeploy**, your `DB_PATH`
> points at ephemeral storage — the platform recreated the filesystem, and the
> SQLite file (with every account in it) went with it. Fix the storage first:
> put `DB_PATH` on a persistent disk/volume (e.g. `/var/lib/wms/wms.db` on a
> VPS). Then recover access instantly:
>
> ```bash
> npm run reset-admin                            # admin@example.com / Admin@123456
> npm run reset-admin -- you@company.com NewPass1
> ```
>
> This creates or force-resets an active admin (password change forced on first
> login) and never touches other data.

> **Native module note:** WMS uses `better-sqlite3`, a compiled addon. It
> installs cleanly on a VPS. On shared Node.js hosting it usually works from
> prebuilt binaries; if `npm install` fails to build it, use a VPS instead.

Before you start, generate a real JWT secret (you'll paste it in below):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Path D — Business/Cloud with the Web Apps deployer (git-connected)

If your plan shows the **Web Apps** deployer (framework list includes **Express**,
Node 18–24), this is the easiest path — it deploys straight from GitHub and
redeploys on every push.

1. hPanel → **Web Apps** (or **Websites → Create/Deploy → Web App**) → **Connect
   a Git repository** → authorize GitHub and pick **`Islamce/WMS`**, branch
   **`main`**.
2. When asked for build settings, use:
   - **Framework:** Express (auto-detected)
   - **Root directory:** `/` (the repo root — `package.json` is there)
   - **Node.js version:** `20.x`
   - **Package manager:** `npm`
   - **Install command:** `npm install`
   - **Build command:** *(leave empty — there is no build step)*
   - **Start command:** `npm start`  (= `node server/index.js`)
3. Add **environment variables**:
   - `NODE_ENV = production`
   - `JWT_SECRET = <paste the generated secret>`
   - `JWT_EXPIRES_IN = 8h`
   - `DB_PATH = ./data/wms.db`  (or a persistent-storage path — see the note below)
4. Deploy. On first boot the app **auto-creates and seeds** the database (default
   admin + demo data), so there's nothing else to run. Watch the deploy log for
   `Empty database detected — running first-run seed…`.
5. Enable **SSL** for the domain (free, in hPanel). Then open the site and log in.

> ⚠️ **Data persistence — check this.** SQLite stores everything in one file at
> `DB_PATH`. If Hostinger's Web App runtime uses **ephemeral** storage (a fresh
> filesystem on each redeploy), that file — and all warehouse data — resets on
> every deploy. Before relying on it for real data:
> - Look for a **Persistent storage / Disk / Volume** option in the Web App
>   settings and mount it (e.g. at `/data`), then set `DB_PATH=/data/wms.db`.
> - If there is **no** persistent-disk option, use **Path A/B (VPS)** for real
>   data, or ask me to migrate the app to the MySQL database included with your
>   Business plan (a larger change, but the durable answer for shared hosting).

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

## Real push notifications on the mobile app (optional)

By default the mobile app only shows notifications inside the app (a bell icon
with an unread badge, polled every 60s) — no Android tray/lock-screen alert
when the app is closed. Turning on **real device push** takes two one-time
steps; nothing about the server or app code needs to change.

1. **Create a Firebase project** (free) at https://console.firebase.google.com
   → *Add project*. Add an **Android app** to it with package name
   `com.wms.wms_mobile` (must match exactly).
2. Download the **`google-services.json`** file Firebase generates, then give
   it to the APK build as a **GitHub secret** (the file is a credential and is
   gitignored — never commit it):
   - GitHub → your repo → *Settings* → *Secrets and variables* → *Actions* →
     *New repository secret*.
   - Name: `GOOGLE_SERVICES_JSON` · Value: paste the **entire contents** of
     the downloaded file.
   - Re-run the **Build WMS Mobile APK** workflow (Actions tab → *Run
     workflow*). The build injects the secret automatically and the released
     APK has push enabled. (Building locally instead? Just place the file at
     `wms flutter application/android/app/google-services.json` and run
     `flutter build apk --release`.)
3. On the **server**, generate a service account key: Firebase Console →
   ⚙️ *Project settings* → *Service accounts* → *Generate new private key*
   (downloads a JSON file). Put its contents in one of:
   ```bash
   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'   # paste the whole file as one line
   # or
   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json      # path to the file on the server
   ```
   in the server's `.env`, then `pm2 restart wms`.

Until both are set, push is a no-op and the app behaves exactly as it does
today (in-app inbox only) — nothing breaks if you skip this section.

## Backups

The whole database is the single file at `DB_PATH` (`data/wms.db`). Back it up
on a schedule, e.g. a daily cron:

```bash
sqlite3 /path/to/data/wms.db ".backup '/path/to/backups/wms-$(date +\%F).db'"
```

Keep the mobile app pointed at this server's public `https://` URL (set it under
**Server settings** in the app).
