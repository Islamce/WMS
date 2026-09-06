# Hostinger Shared Hosting → VPS Migration (2026-09-06)

**Status: IN PROGRESS. VPS purchased and provisioned; no application has been deployed to it yet; all four sites previously on the shared plan are currently OFFLINE.**

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

**Caution for whoever does the wms.kynox.io redeploy specifically:** the operator's stated basis for accepting downtime was that "all current site data is test-only with no real users," explicitly confirmed for `r4c.kynox.io` and `r4c-api.kynox.io`. `WMS-CURRENT-STATUS.md`, however, documents `wms.kynox.io` as of 2026-08-31 with real recorded production data (`users=11`, `materials=9746`, full incident/recovery history going back to 2026-07-25) and treats it throughout as a live production system, not a test instance. **This is a potential conflict, not yet reconciled.** Before treating the `wms.kynox.io` downtime as low-stakes or rushing its redeploy, confirm directly with the operator whether the "test-only" characterization was meant to cover `wms.kynox.io` too, or only the R4C pair. Do not assume either way.

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

**Known limitation:** SSH from the cloud sandbox that did this session's work to `82.29.175.206:22` timed out (that sandbox's own outbound network egress rules block arbitrary TCP ports — this is a property of that ephemeral agent environment, not the VPS). The key's validity has **not** been end-to-end verified yet. First real task on the VPS should be confirming SSH access works from an unrestricted machine/session before anything else.

### Cost breakdown (24-month KVM 2 order)

| | |
|---|---|
| List price (24mo) | $587.76 |
| Discounted price (`10PCT_24M_CSBKONZX`, −10%) | $215.76 → $194.18 |
| Taxes & fees | $29.13 |
| Hostinger Balance applied | −$170.82 |
| **Total charged (Visa ••4528)** | **$52.49** |

## 5. What has NOT been done yet

- No application has been deployed to the VPS. It is a bare Ubuntu 24.04 server with Docker manager and the malware scanner enabled, nothing else.
- No DNS records point at `82.29.175.206` yet. `kynox.io`, `wms.kynox.io`, `r4c.kynox.io`, `r4c-api.kynox.io` all still resolve to (or reference) the now-cancelled shared-hosting setup.
- SSH access from a real, unrestricted machine has not been verified (§4).
- No Nginx/reverse-proxy or TLS/SSL setup exists on the VPS.
- No database has been provisioned or migrated on the VPS.
- No decision has been made on whether/when to delete the now-cancelled Cloud Startup subscription's remaining artifacts (domain, mailbox trial, etc. — the `.IO Domain`, `Starter Business Email Trial`, and `Reach 100` subscriptions on the account are separate line items and were not touched by this migration; only the Cloud Startup hosting plan itself was cancelled).

## 6. Next steps (in a sensible order — not started)

1. **Verify SSH access** to `82.29.175.206` from a normal machine/session with the registered key (see §4's known limitation). Confirm the Hostinger Web Console works as a fallback.
2. **Resolve the wms.kynox.io "test-only" question (§3)** with the operator before touching it, since real user/material data may be at stake.
3. **Set up the VPS base**: firewall (`ufw`), unattended-upgrades or a patch policy, a non-root deploy user if desired, Docker + Docker Compose (Hostinger's "Docker manager" extra can help here, or install the Docker Engine directly).
4. **r4c-api.kynox.io / r4c.kynox.io**: both repos already ship `docker-compose.yml` / `docker-compose.prod.yml` / `Dockerfile` (per this session's earlier captured notes — not re-verified here) — coordinate with whichever agent/session is actively developing them before redeploying, per item 13's standing caution.
5. **wms.kynox.io**: also ships `docker-compose.yml` + `Dockerfile`, plus `DEPLOY-HOSTINGER.md` and `HOSTINGER-NATIVE-RECOVERY.md` in this repo — read both before redeploying, since they document the prior (Passenger/managed-Node) deployment model that will now change to a VPS/Docker model. Its production database was SQLite on local disk (`data/wms.db`, WAL mode) under the old shared-hosting setup; **decide and document explicitly whether to keep SQLite-on-VPS-disk or migrate to a managed/external database** (r4c-api already uses an external Supabase Postgres — same pattern could apply here) before cutting over, given the WAL-mode/backup implications already documented in `HOSTINGER-SCHEDULED-BACKUP.md` and the incident history in `WMS-INCIDENT-LOG.md`.
6. **DNS cutover**: point each site's DNS at `82.29.175.206` only once that site's containers are running and verified locally on the VPS (e.g. by IP + Host header) to minimize downtime duration, not before.
7. **TLS**: set up a reverse proxy (Nginx or Caddy) with certificates (Let's Encrypt) for all four hostnames once DNS has propagated.
8. **Re-point/re-create the offsite backup workflow** (`.github/workflows/production-backup.yml`) for the new VPS target once `wms.kynox.io` is redeployed — its current design assumes the old shared-hosting SSH path (`REMOTE_APP_DIR`, Node 20 ABI constraint for `better-sqlite3`, etc., per `HOSTINGER-SCHEDULED-BACKUP.md`) and needs review against whatever the VPS/Docker deployment actually looks like.
9. Once all four sites are confirmed healthy on the VPS, decide what (if anything) to do with the remaining Cloud Startup-adjacent subscriptions on the Hostinger account (§5) — not urgent, no cost/risk currently attached to leaving them as-is.

## 7. Secrets — explicitly not in this repository

Per this repo's rule ("Never store passwords, private keys, tokens, service-account JSON, password hashes, personal database rows, or other secrets"), the following exist only in the operator's own private working notes from this session, **not** in this repo, not in any commit, and not summarized here beyond naming what exists:

- The new VPS's SSH private key and Hostinger-generated root password (§4).
- All previously-captured application env vars for the four sites (JWT secrets, the Supabase Postgres connection strings for `r4c-api.kynox.io`, S3/BIM placeholder credentials, `wms.kynox.io`'s JWT secret) captured during the earlier backup phase of this same migration effort, needed again when redeploying each app to the VPS.

Whoever continues this work will need the operator to supply these directly; do not attempt to reconstruct them from this repo or ask for them to be pasted into a chat/PR/issue.
