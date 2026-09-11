# Contracting Edition — material ownership requirements

**Status:** requirements captured, design proposed, NOT implemented.
**Source:** a working contractor, answering direct discovery questions (2026-09-11).
**Why this file exists:** these facts came from a domain expert, not from the code
or from inference. CLAUDE.md's authority rules make product/workflow intent
authoritative for what the system *should* do, and require recording the gap when
intent and implementation differ. That gap is large here, and the answers are not
recoverable from the repository.

---

## 1. What the contractor stated (product intent)

Quoted intent, not inference:

1. **Material is stored by receipt, quantity and subcontractor** — whether it is
   the subcontractor's own material, or the company's material that the company's
   own labour will install. Both sit in the same physical store.
2. **Incoming material is inspected by the company** on receipt from the
   subcontractor, to verify conformance to specifications and approved submittals.
3. **Issue happens on the subcontractor's request, approved by project management
   on the quantities** — not by the warehouse.
4. **Leftover material returns to the subcontractor after project-management
   approval.** Ownership does not change hands; the movement is physical.
5. **A subcontractor may supply materials only, or materials plus execution.** The
   settlement differs, and runs against the bill of quantities / line item.
6. Low-stock alerting on this material would be useful.
7. **Required quantities and progress are determined by project management and
   design, NOT by the warehouse.**

### 1.1 What point 7 rules OUT — deliberately

The bill of quantities does **not** belong in this system. An earlier draft of
this work assumed the WMS would need to hold BOQ line items and measure
consumption against them. Point 7 contradicts that: the warehouse neither sets
required quantities nor determines progress.

The contractor stated the boundary exactly:

> The store is only receipt and issue of materials. It has nothing to do with
> execution or the subcontractor's progress rate. It measures received
> quantities, issued quantities, and some indicators derived from those.

So the WMS records **what was received, from whom, owned by whom, and what was
issued, to whom, against which approval** — plus indicators derived from those
two quantities. Project management reconciles that record against their own BOQ.

### 1.2 Why the "ideal" integration is the wrong target

The same contractor described the textbook ideal and then explained why it does
not survive contact with a construction site:

> Ideally it would be tied to project progress and execution, and linked to
> planning software like Primavera. But that requires a BOM and BOQ mapped to
> every WBS element, and that is hard to achieve on construction projects, and
> very hard to keep tracked.

This is the important part, and it is a stronger statement than "BOQ is out of
scope". A BOQ/BOM-to-WBS mapping is not merely absent — on real construction work
it is **expensive to establish and harder still to keep accurate as the job
changes**. Any warehouse feature whose value depends on that mapping being
complete and current will therefore be dead weight in the field, however good it
looks in a demo.

That makes the constraint a product advantage rather than a limitation: this
system must deliver its value from **receipt and issue quantities alone**, with
no BOQ/WBS prerequisite. A competitor that requires the mapping before the
customer sees anything useful has a much harder sale and a much worse first
90 days.

Revisit this only if a contractor states the opposite — and specifically, only if
one says they *do* keep a BOQ-to-WBS mapping accurate in practice.

---

## 2. What the code actually does today (verified 2026-09-11)

| Requirement | Current state |
|---|---|
| Ownership of stock | **Absent.** `batches` has `supplier_code`/`supplier_name` — who *delivered* it, not who *owns* it while it is held. No owner column anywhere. |
| Issue attributed to a subcontractor | **Absent.** `subcontractor_consumptions` records `warehouse_code, description, category_id, uom, quantity_issued, reference` — there is no `subcontractor_id`. Issued material cannot be attributed. |
| Subcontractor material in real inventory | **No.** The subcontractor module is a parallel ledger keyed on free-text `description`, never `material_id`. It never writes `batches` and never calls `recordMovement()`. |
| Return to owner | **Absent.** No return-to-subcontractor movement exists. |
| Supply-only vs supply-and-execute | **Absent.** `subcontractors` does not distinguish the two. |
| Incoming inspection | **Present.** `subcontractor_delivery_lines` carries `quality_status`, `quantity_approved`, `inspected_by`. |
| Low-stock alerting | **Present for owned stock only** (reorder-point analytics), and therefore blind to subcontractor material, which is not in the inventory it reads. |

### 2.1 The consequence

Subcontractor material gets none of what this system is good at: FIFO/FEFO,
bin locations, QR labels, expiry, reorder alerts, stock-count reconciliation.
Two separate ledgers describe one physical store, which is precisely the
condition that makes a site closeout hard to reconcile.

---

## 3. Proposed design (not built)

**One inventory, with an owner dimension.** Subcontractor material becomes real
stock — real `batches`, real movements — carrying an owner.

| Material | Owner | Issued to |
|---|---|---|
| Rebar | Company | Company labour, or a subcontractor on approval |
| Block | Subcontractor A | Subcontractor A |
| Cement | Subcontractor B | Subcontractor B |

What this buys, all of it falling out of the same change:
- Subcontractor material gets FIFO, bins, QR, expiry like any other stock.
- **Reorder alerts start covering it** (requirement 6) because it is finally in
  the inventory the analytics read.
- One consumption report per project/subcontractor for project management to
  reconcile against their BOQ (requirement 7's actual deliverable).
- One physical count closes the site, not two.
- **Every indicator stays computable from receipt and issue quantities alone**
  (§1.2): received vs issued vs on hand, per owner, per project, per material.
  None of it needs a BOQ/WBS mapping to exist, which is what lets the system be
  useful on day one instead of after a mapping exercise that may never finish.

Scope, derived from the answers above:
- Add owner to stock; default every existing row to the company, so the live
  deployment is unchanged by the migration.
- Add `subcontractor_id` to issues, so material is attributable (requirement 3).
- Route subcontractor requests through the existing approval workflow with
  **project management** as the approving authority on quantities, not the
  warehouse (requirement 3).
- Add a return-to-owner movement, gated by the same approval (requirement 4).
  Ownership is never transferred — only possession moves.
- Mark a subcontractor as supply-only or supply-and-execute (requirement 5), so
  the consumption report can present each correctly. Settlement itself stays out
  of this system, per §1.1.

Migration must preserve existing subcontractor ledger rows by converting them to
owned stock rather than discarding them.

**Estimate: 2–3 weeks.**

### 3.1 Why this is commercially interesting

Holding owned stock and custody stock side by side in one store, with movements
and reconciliation for both, is not something Odoo or Zoho Inventory do. For a
contractor it is an everyday problem. It is a stronger differentiator than
anything else currently in the Contracting edition.

---

## 4. Answered design questions

Both were put to the contractor and answered (2026-09-11). Both answers reduce
the work rather than expanding it.

### 4.1 Return to owner — a distinct approval stage, then a real issue

> A separate stage, after which the approved quantity is issued out of inventory
> under a distinctive movement number.

So a return is **not** a soft flag or a report-only adjustment. It is:

1. a **separate approval stage** — project management approves the quantity to be
   returned, distinct from the approval that authorises a normal issue;
2. followed by a **real outbound stock movement** that removes the approved
   quantity from inventory, carrying its **own movement type** so a return is
   never confused with consumption in any report or reconciliation.

The approved quantity — not the requested one — is what moves. Ownership is
untouched throughout: the material was always the subcontractor's; only
possession changes.

### 4.2 Supply-and-execute — same postings, different colour

> Normal supply and withdrawal movements are recorded; in the same report, just
> give it a different colour to distinguish it.

No separate posting path. A supply-and-execute subcontractor's material moves
through exactly the same receipt and issue transactions as a supply-only one.
The distinction is **presentational**: one report, with the engagement type
visually distinguished.

This matters more than it looks. It means the engagement type is a single
attribute on the subcontractor record plus a rendering rule — not a second set of
transactions, a second reconciliation, or a branch through the movement logic.
Settlement differences live outside this system, per §1.1.

## 5. Implementation phases

- **Phase 1 — schema foundation.** Owner on stock (defaulting every existing row
  to the company, so a live deployment is unchanged), subcontractor attribution
  on issues, engagement type on the subcontractor record, and the return movement
  type. Additive; no behaviour change.
- **Phase 2 — workflow.** *Done.* Subcontractor requests routed through approval
  with project management as the approving authority on quantities
  (`project_management_approval`, gating both the decision and any change to an
  approved quantity — but deliberately not rejection); the separate
  return-approval stage and its outbound movement under type 542 (§4.1).
  Both authorities are seeded granted to no role, so an existing install is
  unchanged until an administrator assigns them. Server-side only so far: no
  screen yet exposes either, which is the first thing phase 3 needs.
- **Phase 3 — reporting.** One consumption report per project/subcontractor,
  engagement type distinguished (§4.2), and reorder alerts extended to cover
  owned-by-subcontractor stock now that it is real inventory.
