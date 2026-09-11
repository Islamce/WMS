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

The WMS records **what was received, from whom, owned by whom, and what was
issued, to whom, against which approval**. Project management reconciles that
record against their own BOQ. Building a BOQ module here would duplicate — and
compete with — a system the customer already has, and would put the warehouse in
charge of numbers it does not own.

This decision removed roughly a month of planned work. Revisit it only if a
contractor states the opposite.

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

## 4. Open questions

- Does project-management approval on a return need to be a distinct approval
  stage, or can it reuse the existing quantity-approval path?
- Should a supply-and-execute subcontractor's consumption post differently from a
  supply-only one, or only present differently in the report?
