# Hostinger Shared Hosting → VPS Migration (2026-09-06)

**Status: IN PROGRESS. VPS purchased and base-configured. `wms.kynox.io` is restored, healthy, and publicly live over valid HTTPS on the VPS, including the verified 2026-09-05 SQLite backup. The other three sites remain undeployed/offline. Hostinger removed the operator's real business email (`islam@kynox.io`) with the cancelled hosting plan; all paid recovery paths were rejected, and the no-charge dispute is recorded in ticket `#20751159` — see §7.**

This document is the authoritative record of the account-level migration off Hostinger's shared "Cloud Startup" plan onto a Hostinger VPS. It exists separately from `WMS-CURRENT-STATUS.md` because it is an account/infrastructure-level change spanning four sites (`kynox.io`, `r4c.kynox.io`, `r4c-api.kynox.io`, `wms.kynox.io`), not a WMS-application-only change — but item 13 of `WMS-CURRENT-STATUS.md`'s "Known remaining work" (the Max Processes saga) is the direct origin of this migration and should be read alongside this doc for full context. A pointer has been added there and to `WMS-SESSION-LOG.md`.

**Read this before touching any of the four sites, their DNS, or the new VPS.**

## 1. Why this happened

Item 13 in `WMS-CURRENT-STATUS.md` documents the shared "Cloud Startup" plan (kynox.io account) repeatedly hitting its 200-process account-wide cap, which broke the WMS offsite-backup GitHub Actions workflow (SSH connections were refused when the cap was saturated). That item was marked **RESOLVED on 2026-09-04** by deleting two unused sites (`logix.kynox.io`, `analytics.kynox.io`), dropping the account from 7 sites / ~189–197 processes to 5 sites / 79 processes, and confirmed via a fully successful backup run.

That fix reduced the process count but did not remove the structural cause: a shared-hosting plan enforces one account-wide process cap regardless of how many always-on Node.js "Web Apps" share it (5 remained: `r4c`, `r4c-api`, `wms`, plus PHP sites `gate`/`kynox.io` at the time — `gate.kynox.io` has since also been removed from the account, see §2). The operator (Islam) decided to eliminate this entire class of recurring risk rather than keep firefighting it as app count or traffic grows, by moving off shared hosting entirely onto a Hostinger VPS (dedicated resources, no shared process cap, full root/Docker access). This session executed that decision end-to-end: refund negotiation → VPS purchase → provisioning. Deploying the four applications to the new VPS is separate, not-yet-started work (§6).

## 2. Refund negotiation (Hostinger support, hpanel "Agent" chat, thread "Migrate Cloud Startup to VPS")

The Cloud Startup subscription had been paid ~6 days past Hostinger's standard 30-day money-back window, so the fully-automated refund tool could not calculate anything outside that window. The operator directed a hard negotiation for either a full refund or a larger VPS discount before doing anything else, using the "only 6 days over" and "the underlying defect (process cap) is Hostinger's own fault" arguments.

Outcome, across several human specialists in the same chat thread (Amber → Ro → Myat → Kristaline → Shaskia):

- **Full refund: refused.** Myat confirmed in writing that Hostinger's refund policy is strictly the 30-day window with no exceptions for service-performance complaints, however justified.
- **Partial "goodwill exception" refund: approved as a human-calculated one-off.** Amount: **$133.82**, credited only to non-withdrawable Hostinger Balance (never cash/card), and this exception process **automatically and irreversibly cancels the Cloud Startup subscription the moment it is processed** — this was known and accepted before authorizing it.
- **Bigger VPS discount: refused.** Hostinger stated new VPS plans already carry the maximum available new-customer discount; a separately-offered "15% off your next renewal" was confirmed (after explicit clarification, since the wording was ambiguous) to apply **only** to renewing the plan being abandoned, not to a new VPS purchase — useless here and not used.
- Two official VPS coupon codes were issued and confirmed applicable to a new VPS purchase: `5PCT_12M_CSP6QSTS` (5%/12mo) and `10PCT_24M_CSBKONZX` (10%/24mo, used — see §4).
- External/affiliate coupon codes (`CNHOSTVPS`, `JKC10`, found via web search) were tried at actual checkout and **both were rejected/invalid** — no benefit over Hostinger's own codes.

The operator explicitly rejected the safer "buy VPS first at full price, request refund afterward" fallback (to avoid ever holding idle Hostinger Balance or paying full price up front) and chose refund-first, accepting the resulting brief-downtime risk in writing.

**Refund authorized and processed 2026-09-06, ~10:27–10:43 UTC.** Confirmed via: (a) Hostinger's own "Refund history" page showing Payment ID `H_47947817`, amount `$133.82`, status `REFUNDED`; (b) an automated email confirming the same; (c) a second automated email at 10:43 titled "Your hosting has been canceled" confirming **the Cloud Startup plan for `kynox.io`, `wms.kynox.io`, `r4c-api.kynox.io`, `r4c.kynox.io` has been canceled**, reason "refund request". This matches the accepted-in-advance behavior of the goodwill-exception process.

**Important, not previously expected:** the Hostinger Balance shown at checkout was **$170.82**, not the $133.82 refund alone — there was an additional ~$37 of pre-existing balance/credit on the account from an unidentified prior source. Confirmed directly on `hpanel.hostinger.com/billing/payment-methods` (top-right "Hostinger balance: $170.82"), not a display glitch. This meant a lower final VPS cost than originally planned (§4).

## 3. Current state of the four sites — OFFLINE

As of the cancellation email (2026-09-06, ~10:43 UTC), **all four sites that were on the Cloud Startup plan are offline**: `kynox.io`, `wms.kynox.io`, `r4c-api.kynox.io`, `r4c.kynox.io`. None of them have been redeployed anywhere yet. This is the expected, accepted-in-advance outcome of the refund path, not an incident — but it means **production is down right now** for all four, and stays down until each is redeployed to the new VPS or elsewhere (§6).

**wms.kynox.io test-vs-production question — RESOLVED 2026-09-06.** `WMS-CURRENT-STATUS.md` documented `wms.kynox.io` as of 2026-08-31 with `users=11`, `materials=9746`, which read as live production data and appeared to conflict with the operator's "all four sites are test-only" basis for accepting downtime. Asked directly; operator confirmed **only `islam@kynox.io` is a real account (his own) — the other accounts and the underlying data are test/demo, not real customer/business data.** Conclusion: `wms.kynox.io` can be redeployed the same way as the other three sites, no special production-safe migration protocol required. The already-downloaded `wms.db` (+ `-wal`/`-shm`, captured 2026-09-05 before cancellation) will simply be restored as-is on the VPS to preserve login/data continuity — this is a convenience choice, not a data-safety requirement.

`r4c.kynox.io` / `r4c-api.kynox.io` are noted elsewhere (`WMS-CURRENT-STATUS.md` item 13) as under active development by another agent — coordinate there before redeploying or reconfiguring them on the new VPS.

## 4. New VPS — purchased and live

Purchased and paid 2026-09-06, immediately after the refund was confirmed, per the operator's explicit "ابدأ ب KVM 2" (start with KVM 2) instruction.

| | |
|---|---|
| Hostinger VPS ID | `1959610` |
| Plan | KVM 2 — 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB bandwidth |
| Term | 24 months, auto-renewal on, expires 2028-09-06 (renews at $14.99/mo after) |
| OS | Ubuntu 24.04 LTS |
| Location | France (Paris) |
| Hostname | `srv1959610.hstgr.cloud` |
| **IPv4** | **`82.29.175.206`** |
| SSH username | `root` |
| Extras enabled | Malware scanner (free, Active), Docker manager (free) |
| Extras **not** enabled | Daily auto-backups (+$6/mo — add later via VPS dashboard if wanted) |

**Access:** SSH key-based (an ed25519 keypair was generated and its public key added via Hostinger's own "Add SSH key" step during provisioning — no root password was typed by the assisting session). A Hostinger-generated root password also exists as a fallback for the Web Console only. **Neither the private key nor the password are in this repository, per this repo's standing rule never to store secrets in it** — they are recorded in the operator's own private working notes from this session (not GitHub, not this repo). Whoever continues this work needs to either obtain that private key file from the operator, generate and register a new SSH keypair via `hpanel.hostinger.com/vps/1959610` → SSH key → Manage, or use the Hostinger Web Console (needs only Hostinger account login, no key) as a no-key fallback.

**Known limitation, confirmed and worked around 2026-09-06:** SSH from the cloud sandbox that did this session's work to `82.29.175.206:22` timed out (that sandbox's own outbound network egress rules block arbitrary TCP ports — this is a property of that ephemeral agent environment, not the VPS). Root-shell access was instead confirmed working via **Hostinger's browser-based Web Console** (VPS dashboard → "Web console" button) — it logs straight into a root shell with no password prompt (the hpanel session itself authorizes it), and is the reliable access path for any future agent session that also can't reach port 22 directly. The registered SSH key's end-to-end validity from a normal unrestricted machine is still unconfirmed, but is no longer blocking — the Web Console is a fully sufficient substitute for all administration done so far.

**Base VPS setup — done 2026-09-06 (via Web Console):** `apt update && apt upgrade -y` (system was already current); `ufw` firewall enabled with only 22/80/443 (tcp+v6) allowed, default deny incoming; Docker Engine 29.8.0 + Docker Compose v5.5.1 confirmed **already pre-installed** (came free with the "Docker manager" extra selected at purchase — no manual install was needed). Two additional ed25519 deploy-key pairs (`vps-deploy-r4c`, `vps-deploy-wms`) were generated directly on the VPS for cloning the private `Islamce/R4C` and `Islamce/WMS` GitHub repos read-only.

**Deploy keys — DONE 2026-09-06 (added by Codex, at the operator's direction).** Both public keys were added as read-only GitHub Deploy keys (`vps-deploy-r4c` on `Islamce/R4C`, `vps-deploy-wms` on `Islamce/WMS`, neither with write access) and verified: `ssh -T git@github-r4c` / `git@github-wms` from the VPS now authenticate successfully against the respective repos. No longer blocking §6 items 4/5.

**Reverse proxy base — done 2026-09-06:** Caddy (`caddy:2-alpine`) running via Docker Compose at `/opt/proxy` (`docker-compose.yml` + `Caddyfile`), bound to ports 80+443, on an external Docker network named `web` that future app containers should join so Caddy can `reverse_proxy` to them by container name. Currently the Caddyfile is just a placeholder (`:80 { respond "..." 200 }`, confirmed working via `curl` → HTTP 200) — no per-site blocks or Let's Encrypt TLS yet; those get added once each app is deployed and DNS points here, to avoid failed/rate-limited ACME attempts against a domain that doesn't resolve here yet. **Gotcha for whoever edits the Caddyfile next:** typing a literal Tab character into the Web Console terminal (e.g. via automated keystroke tools) gets mangled into a stray `.` character, corrupting Caddyfile directives — write config files with no leading tabs/indentation.

### Cost breakdown (24-month KVM 2 order)

| | |
|---|---|
| List price (24mo) | $587.76 |
| Discounted price (`10PCT_24M_CSBKONZX`, −10%) | $215.76 → $194.18 |
| Taxes & fees | $29.13 |
| Hostinger Balance applied | −$170.82 |
| **Total charged (Visa ••4528)** | **$52.49** |

## 5. What has NOT been done yet

- WMS is running and healthy on the VPS, but `r4c`, `r4c-api`, and `kynox.io` are not deployed yet. WMS remains inaccessible at its public hostname until the approved DNS/TLS cutover.
- `wms.kynox.io` now points at `82.29.175.206`; `kynox.io`, `r4c.kynox.io`, and `r4c-api.kynox.io` still resolve to (or reference) the cancelled shared-hosting setup.
- SSH access from a real, unrestricted machine has not been verified (§4).
- Reverse proxy: a Caddy container is running on the VPS (`/opt/proxy`, external Docker network `web`) but only serving a placeholder response — no per-site config or TLS certificates yet (§4, §6).
- No database has been provisioned or migrated on the VPS.
- No decision has been made on whether/when to delete the now-cancelled Cloud Startup subscription's remaining artifacts (domain, `Reach 100` email-marketing trial, etc.).
- **Correction to an earlier statement in this doc:** an earlier version of this section said the `Starter Business Email` subscription was "a separate line item, not touched by this migration." Hostinger has now confirmed it was connected to the Cloud Startup subscription and was removed when that hosting plan was cancelled — see §7.

## 6. Next steps

0. **PARKED BY OPERATOR — recover `islam@kynox.io` (§7).** Ticket `#20751159` exhausted the requested no-charge escalation for now: Dhita and Hani refused reinstatement, a complimentary entitlement, a 100% discount, and account credit, while confirming the backup is retained for only 30 days and admitting their records show no separate pre-cancellation warning that email would be deleted. The operator instructed to keep this aside and continue the site migration. Do not purchase an email plan or renew Cloud Startup; preserve the 30-day deadline for a later decision.
1. ~~Verify SSH/console access to `82.29.175.206`~~ — **done**, via Hostinger Web Console (§4).
2. ~~Resolve the wms.kynox.io "test-only" question~~ — **done**, see §3.
3. ~~Set up the VPS base~~ — **done**: firewall (`ufw`, 22/80/443 only), Docker + Docker Compose confirmed present, placeholder Caddy reverse proxy running (§4). Not done: unattended-upgrades/patch policy, a non-root deploy user (currently all work is as root via Web Console — acceptable for a single-operator VPS at this stage, revisit if that changes).
3a. ~~Add both GitHub deploy keys and push the 3 pending docs commits~~ — **done 2026-09-06 via Codex** (this session's git-proxy access excludes `Islamce/WMS`, so both tasks were handed off in a self-contained prompt + `git format-patch` for Codex to execute). Both deploy keys added read-only and verified working; the 3 commits were recreated with original authorship/messages via `git am` and pushed — `origin/main` HEAD is now `1ad86cc` (`docs: record VPS base setup, reverse proxy, and email cancellation discovery`). This local checkout has been synced to match (`git reset --hard origin/main`).
4. **r4c-api.kynox.io / r4c.kynox.io — RELEASE REVIEW GATE OPEN:** coordination with the active R4C development thread confirmed that repository `main` (`c68a183`) is stale and must not be deployed. The intended release candidate is PR #88 at exact commit `705b24f`; all substantive CI checks pass, but GitHub still reports `REVIEW_REQUIRED`/`BLOCKED` pending independent review from `sam41234`. No protection was bypassed and no R4C database, container, DNS record, or traffic was changed. Readiness-only work completed on the VPS in isolated `/opt/apps/r4c-rc-build`: cloned the exact RC commit through the read-only deploy key, validated `docker-compose.prod.yml` with the tracked production example, and successfully built both production images (`r4c-api`, `r4c-web`). Nothing was started. A 15-minute monitor in the active R4C thread will report the exact merged `main` SHA and final cautions; deployment begins only after that merge.
5. **wms.kynox.io — DONE / PUBLICLY LIVE:** located the 2026-09-05 `_data.zip` locally and confirmed it contains the exact `wms.db`/`-wal`/`-shm` triplet; transferred it over a dedicated VPS-only SSH key; matched local/remote SHA-256 (`68fb52080f2adc0e5a377e0bd3d05592b55243a82fd3a2fde38042ce1bc3fd6f`); and validated the restored database (`integrity=ok`, 47 tables). Located the real WMS environment file locally without exposing its 96-character JWT secret. Compose now bind-mounts `./data:/app/data` for auditable restore/backup access (commit `f38be68`), binds the diagnostic port only to VPS localhost, and joins `web`. The container is healthy, reports 20 migrations and 11 users. After explicit operator approval, created the `wms` A record with TTL 300 pointing to `82.29.175.206`, confirmed it through Hostinger authoritative DNS plus Cloudflare and Google, enabled Caddy automatic HTTPS, and verified public `/healthz` and `/` both return HTTP 200 with successful TLS verification.
6. **kynox.io**: no GitHub deployment — restore from the Hostinger-triggered backup ZIP (files + `u716763642_analytics` MySQL DB) captured before cancellation, not via git.
7. **DNS cutover**: point each site's DNS at `82.29.175.206` only once that site's containers are running and verified locally on the VPS (e.g. by IP + Host header) to minimize downtime duration, not before.
8. **TLS**: the reverse proxy itself is already running (§4) — add a per-site Caddyfile block (auto Let's Encrypt) for each hostname once that site's container is up on the `web` Docker network AND DNS for that hostname points here.
9. ~~Re-point/re-create the WMS offsite backup workflow~~ — **DONE 2026-09-06.** Added a host-visible `./backups:/app/backups` mount; retargeted the workflow and five SSH secrets to the VPS; and executes the tested scripts inside the production Node 20 container, eliminating the old Passenger binary/ABI path. Manual Docker backup verification passed, then GitHub Actions run `34047172529` completed every phase successfully in 49 seconds: pinned-host SSH, remote backup/restore verification, manifest selection, download, independent runner verification, S3-compatible encrypted upload, object-size verification, heartbeat, dry-run retention, and key scrubbing. See `docs/HOSTINGER-SCHEDULED-BACKUP.md`.
10. Once all four sites are confirmed healthy on the VPS, decide what (if anything) to do with the remaining Cloud Startup-adjacent subscriptions on the Hostinger account (§5) — not urgent, no cost/risk currently attached to leaving them as-is.

## 7. URGENT / ACTION REQUIRED — `islam@kynox.io` business email removed with hosting (discovered and confirmed 2026-09-06)

Not part of the original migration plan and **not yet resolved.** While the operator was checking his phone mail app (Gmail, IMAP re-sync prompt against `imap.hostinger.com`), he asked whether his email still worked. Checked directly in hPanel:

- `Billing > Subscriptions` shows **`Starter Business Email` (kynox.io) — status `Cancelled`**, renewal price `$38.16`, "Expires 2027-07-13" (i.e. prepaid term run through mid-2027, but marked cancelled today anyway).
- `hpanel.hostinger.com/emails` shows **no active mailbox management UI at all** — only the generic "buy an email plan" storefront page, which normally would not appear if `islam@kynox.io` were still an active, provisioned mailbox.

**This directly contradicts an earlier version of this document** (§5), which assumed — incorrectly — that only the Cloud Startup hosting plan was touched by the refund/cancellation and that email was a separate, untouched line item. Hostinger support has now confirmed the cause: the mailbox was connected to the Cloud Startup hosting subscription, so cancelling that hosting plan also removed the connected email service from hPanel.

**Initial Hostinger response (Aisha, 2026-09-06):** Aisha first instructed the operator to purchase an active Business Email plan, recreate the exact address `islam@kynox.io`, and then request human restoration. After that paid path was rejected, she suggested using a free Cloud Startup "Restore" option. A direct check of `Billing > Subscriptions` found no Restore control: the only action was a paid 12-month **Renew** at a listed `$311.88` before taxes. Neither paid option was selected.

**Operator decision and escalation (2026-09-06, ~13:10–13:13 Arabia Standard Time):** The operator explicitly instructed not to purchase anything and authorized continuing the dispute until the mailbox is restored free. The reply recorded that only one mailbox is involved; it disappeared immediately after the hosting refund/cancellation at approximately 10:43 UTC; cancellation of email was never knowingly authorized; and the email subscription had been shown as prepaid through 2027-07-13. The requested remedy is manual reinstatement of that entitlement and restoration of `islam@kynox.io` plus all previous mailbox data, at no charge, without restoring Cloud Startup or reversing the VPS migration/refund. Hostinger escalated this as **ticket `#20751159`**, category Emails. Human reviewer **Dhita** is currently reviewing it. No purchase, renewal, or charge has been authorized or made.

**Human-review outcome and formal complaint (2026-09-06, ~13:21–13:36 Arabia Standard Time):** Dhita confirmed Hostinger still has a recoverable backup for up to 30 days after deletion and identified two previous addresses (`islam@kynox.io`, the real user mailbox, and `no-reply@kynox.io`, apparently an application/system mailbox), but required a paid plan first. A supervisor-level complaint then argued that Hostinger marketed Cloud Startup for up to 50 websites while its process cap made the account unreliable at a tiny fraction of that capacity, forcing the VPS migration; that email deletion and the new-purchase recovery condition were not disclosed before the refund; and that Hostinger should provision a complimentary entitlement, 100% discount, or full credit. Reviewer Hani refused every no-charge remedy and repeated that an active paid destination mailbox is required. Importantly, Hani explicitly acknowledged that **Hostinger's available records do not show a separate pre-cancellation notice saying the bundled email service would be deleted**. Hostinger says the backup cannot be retained beyond 30 days. The operator still has not authorized or made any purchase.

**Operator disposition:** keep this issue aside for now and continue the remaining website migration. The unresolved data-retention deadline remains important: Hostinger says the mailbox backup expires 30 days after deletion. No further support message is being sent at this stage, and no purchase is authorized. If the operator reopens the dispute, the proposed final compromise is a temporary complimentary one-mailbox entitlement solely to restore/export `islam@kynox.io`, explicitly waiving `no-reply@kynox.io`.

## 8. Secrets — explicitly not in this repository

Per this repo's rule ("Never store passwords, private keys, tokens, service-account JSON, password hashes, personal database rows, or other secrets"), the following exist only in the operator's own private working notes from this session, **not** in this repo, not in any commit, and not summarized here beyond naming what exists:

- The new VPS's SSH private key and Hostinger-generated root password (§4).
- All previously-captured application env vars for the four sites (JWT secrets, the Supabase Postgres connection strings for `r4c-api.kynox.io`, S3/BIM placeholder credentials, `wms.kynox.io`'s JWT secret) captured during the earlier backup phase of this same migration effort, needed again when redeploying each app to the VPS.

Whoever continues this work will need the operator to supply these directly; do not attempt to reconstruct them from this repo or ask for them to be pasted into a chat/PR/issue.
