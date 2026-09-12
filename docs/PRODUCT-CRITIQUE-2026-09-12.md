# Adversarial product critique — 2026-09-12

Written against the product **as it stands today** (`main` at `f51259f`,
production at `76a1420`), not against an earlier version. Every number below was
measured from this repository on the date above; none is recalled or estimated.

The voice is deliberately hostile: a contractor who looked at this and did not
buy, and a competitor who would rather you kept shipping what you are shipping.
Read it as the argument you have to beat, not as a balanced assessment.

A fix plan follows in §6. §7 lists what NOT to build, which matters as much.

---

## 1. The objection that loses the sale

> "I have four people in my stores. You want me to hire a workflow."

| Measured | |
|---|---|
| States in one request's lifecycle | **40** |
| Distinct authorities that must act before material leaves | **6** |
| Default roles seeded | **9** |
| Screens | **43** |

Getting a bag of cement from "I need it" to "it left the store" passes through
manager approval, an ERP operator, bin/batch assignment, picker assignment,
picking, and goods-issue posting. Six people, or one person logging in and out of
six roles pretending to be six people.

This is an enterprise workflow wearing a small-business price tag. The target
customer stated in `docs/CONTRACTING-EDITION-REQUIREMENTS.md` is **small and
medium contractors**. A small contractor's store has a storekeeper and a site
engineer. The product as built cannot be operated by the customer it was
designed for.

**The competitor's version of this sentence:** "Request, approve, issue. Three
screens. You'll be running this afternoon."

This is the single most important finding in this document. Everything in §6
that does not address it is secondary.

## 2. The objection that stops the pilot

> "What do I have to do before it's useful?"

Nothing in the product answers this. There is no guided setup, no starter
dataset, no "import your material list and go". Production carries **9,746
materials and 3,274 batches**, which arrived through a bulk import somebody ran
by hand.

A prospect who signs up sees an empty system with 43 screens and no instruction
about which of them to fill first. The distance between "I said yes" and "I saw
value" is measured in days of data entry, and that is where pilots die.

**The competitor's version:** a CSV template, a 10-item demo warehouse, and a
first receipt posted in ten minutes.

## 3. The objection that kills it in this market

> "نص الشاشات إنجليزي."

| Measured | |
|---|---|
| Screens | 43 |
| Translation keys in `public/js/i18n.js` | **28** |

Fewer translation keys exist than there are screens. Arabic support is a toggle
over a mostly-English product. For a contractor in Egypt or the Gulf whose
storekeeper does not read English, this is not a polish item — it is a
disqualification, and it is the first thing they will notice.

The Contracting edition defines Arabic terminology (`label_ar`, and a
terminology map renaming Warehouse to Site Store) but the surrounding 43 screens
are not translated, so the edition speaks the customer's language in five places
and English everywhere else. That reads worse than not trying.

## 4. The objection you cannot answer at all

> "How do I pay you, and what stops me copying it?"

```
$ grep -rliE "subscription|billing|licen[cs]e|pricing|plan_tier" server/
(nothing)
```

There is no subscription, no billing, no licence, no expiry, no seat count, no
plan tier — **nothing**. The industry edition decides which modules a tenant
sees, and it is a row an administrator can edit. Provisioning creates a tenant
directory and a container; nothing records that anyone owes anything.

This is not a feature gap. It means the product **cannot currently be sold as a
product**, only delivered as a bespoke installation per customer, which does not
scale past the number of customers you can personally onboard.

## 5. Where the competitor is genuinely behind

Being fair, because a plan built only on weaknesses picks the wrong fights.

**Subcontractor-owned stock is a real moat.** Holding company material and
subcontractor material side by side in one store, with ownership that never
transfers, a return-to-owner movement under its own type, and reconciliation for
both — Odoo and Zoho Inventory do not do this. For a contractor it is an
everyday problem with no good answer on the market. It is now built, deployed,
and reachable.

**The audit and safety posture is unusually strong for this segment.** Four-eyes
approval, idempotent replay, atomic claims, re-validation at execution,
fail-closed permissions, an audit trail on every state change. Most products at
this price are far looser.

**Neither of these sells the product on its own**, because a buyer never reaches
them: they bounce off §1, §2 and §3 first. The moat is behind a wall you built
yourself.

---

## 6. Fix plan

Ordered by what unblocks a sale, not by what is interesting to build.

### Phase A — drop the SAP staging for Contracting (addresses §1)

**Corrected after owner input, 2026-09-12.** The first draft of this phase framed
the fix as a size rule — collapse steps for small tenants. That was the wrong
axis. Size is a weak proxy for the real distinction, which the owner named:

> The sequence is built on SAP. A worker requests, the manager approves, the
> operator raises a reservation, the store posts a goods issue. On sites and for
> contractors there is no such thing — a material request, the responsible
> engineer approves it, and the store issues it, with no GI and no reservation.

The reservation and the goods issue are **SAP documents**, present because SAP is
the system of record and this system feeds it. A contractor has neither. The
axis is therefore *is SAP the system of record*, which maps exactly onto the
edition concept that already exists.

**Done (first increment).** `erpStaging` on each profile: true for
Manufacturing, false for Contracting, and **true for an unconfigured install**,
so every existing deployment is unchanged. On Contracting, approval routes
straight to the store.

Three things this increment established that a plan alone would not have:

- `stock_transactions.reservation_number` is **required on every OUT movement**.
  Removing the reservation step without more would break the ledger. A locally
  generated issue number (`ISS-YYYY-NNNNN`) takes its place — the same principle
  as a delivery note standing in for a purchase order on material the company
  did not buy. The ledger keeps one shape and every existing report still works.
- The transition guard rejected `APPROVED → WAREHOUSE_ASSIGNED` until the edge
  was declared. That guard is the workflow's written form, so the edge is
  declared in `workflow/states.js` rather than bypassed: a path not in that
  table is a path nobody reviewed.
- Nothing is guessed. A request that cannot resolve a site store is refused with
  a message naming what to set. A tenant with one store resolves it without
  being asked; a tenant with several must say which.

**Still open in this phase:** the goods-issue posting step itself, and bin and
picker assignment. The GI step **cannot simply be deleted** — it is the call that
actually moves the stock. What can go is its ERP dressing. Bin and picker
assignment are not SAP artifacts and need their own justification, measured
against a real site rather than assumed.

The original framing is kept below because the collapse it describes is still
the right treatment for the steps that are *not* SAP artifacts.

The 40-state workflow is correct for a plant with segregated duties and wrong
for a four-person store. Do **not** delete it; make it collapsible.

- A tenant setting that collapses the chain: approval optional below a value
  threshold, ERP reservation skipped when no ERP exists, bin assignment skipped
  when the store has no bins, picker assignment skipped when the requester
  collects.
- The states stay in the schema so an enterprise tenant keeps the full chain and
  the audit trail keeps its shape. A collapsed step records who skipped it and
  why, rather than vanishing.
- Success test: a two-user tenant takes a request from raised to issued in
  **three screens**.

This is the phase that decides whether the product is sellable. Everything else
is easier.

### Phase B — first-hour onboarding (addresses §2)

- A starter dataset the provisioner can install: one site store, a handful of
  bins, ten common contracting materials, one subcontractor.
- A guided first-run that names the three things to do in order, rather than
  presenting 43 screens at once.
- CSV templates downloadable from the import screen, matching the importer that
  already exists.
- Success test: a brand-new tenant posts its first goods receipt in **ten
  minutes**, without being told what to do by a human.

### Phase C — finish the Arabic (addresses §3)

- Extract every user-facing string; measure coverage as a number and gate it in
  CI the way `edition_route_coverage_test.js` gates edition reachability.
- The terminology map already proves the mechanism works; it needs breadth, not
  a new design.
- Success test: a screen with an untranslated string **fails CI**.

### Phase D — make it sellable (addresses §4)

- A tenant record that carries plan, seat count, start and expiry.
- Enforcement that degrades honestly: read-only past expiry, never data loss,
  never a silent lockout of a warehouse mid-shift.
- Decide deliberately whether editions are licensing or configuration. Today
  they are configuration wearing a licensing costume.

### Phase E — then market the moat (§5)

Only once A–D are done. Subcontractor custody is the thing to lead with, and it
only lands on a prospect who got past the first hour.

---

## 7. What NOT to build

Discipline here is worth more than another feature.

- **Not Postgres.** Measured 2026-09-11: zero `SQLITE_BUSY` and zero failed
  writes at 200 concurrent writers, 560–830 writes/sec. None of the triggers in
  `docs/POSTGRES-MIGRATION.md` is met, and container-per-tenant makes the
  single-writer limit per tenant. See `docs/LOAD-TEST-BASELINE-2026-09-11.md`.
- **Not BOQ/WBS integration.** The contractor stated directly that a BOM/BOQ
  mapped to each WBS element is hard to establish on construction projects and
  harder to keep accurate. Every indicator the product reports is computable
  from receipt and issue quantities alone, and that is a feature. See
  `docs/CONTRACTING-EDITION-REQUIREMENTS.md` §1.2.
- **Not more screens.** 43 is already past what the target customer can absorb.
  A new capability should collapse a step, not add one.
- **Not a third vertical.** Contracting is not proven with a paying customer
  yet. A second vertical before the first one sells is how a product ends up
  shallow in three markets.

---

## 8. Status of the earlier critique

An adversarial critique was produced earlier in the 2026-09-11 session and was
**never written to a file**. Its fix plan existed only in conversation, which has
since been compacted twice. Of that plan, one item was approved and delivered:
the architectural unlock (tenants and editions) and the Contracting vertical
built on it — `docs/CONTRACTING-EDITION-REQUIREMENTS.md` §5, phases 1 through 4,
all complete and deployed.

The rest of that critique is not recoverable verbatim, which is exactly why this
document exists as a file. This is a fresh critique of the current product, not
a reconstruction of the old one — the product it examines has changed materially
since, having gained tenants, editions and the whole Contracting feature set.
