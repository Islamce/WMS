# WMS Corrective Reconciliation — 2026-08-11

## Evidence matrix

| Area | Classification | Evidence / disposition |
|---|---|---|
| Canonical downstream request context | KEEP | Shared serializer is attached across request, ERP, warehouse, picking, and GI routes; web and Flutter render the operational identifiers. |
| Append-only analytical history | KEEP | Migration 013 extends the protected history tables; analytical import remains separate from batches, reservations, location balances, and the operational ledger. |
| Movement semantics | KEEP + ADAPT | ISSUE/RETURN/REVERSAL netting and transfer/adjustment exclusion retained; free-text operational classification remains a documented follow-up risk. |
| Coverage gating | ADAPT | Imported declared ranges are not trusted as continuous evidence; RETURN/REVERSAL-only and unmatched/sparse files cannot enable global DEAD classification. |
| Import provenance | ADAPT | Period chronology/containment and immutable multi-chunk configuration are enforced. Client-provided checksums remain provenance labels, not server-verified file hashes. |
| Dedupe | ADAPT | Row fingerprint gains cost/WBS/actor/description/unit/file discriminators; cross-ledger reference comparison is exact. A governed source-specific business key remains preferable. |
| Main operational documentation | ALREADY PRESENT | Current backup and native-addon recovery history from main was retained during reconciliation. |
| PR #59 lean context control | ALREADY PRESENT / NON-OVERLAPPING | Draft PR #59 at `999d99d` was clean with green CI and changes only `CLAUDE.md`; no duplicate work was added. |

## Validation evidence

| Check | Result |
|---|---|
| Git preservation checkpoint | PASS — `a97f07f` |
| Current-main reconciliation | PASS — based on `3350d2b` |
| JavaScript syntax (`node --check`) | PASS |
| Python test compilation | PASS |
| `git diff --check` | PASS |
| Runtime/e2e suite | BLOCKED — clean worktree lacks installed dependencies and bundled runtime has no npm executable; Draft PR CI required |

## Remaining defects / risks

| ID | Severity | Area | Description | Current state | Recommended action |
|---|---|---|---|---|---|
| WMS-COR-001 | P1 | Analytics | Operational movement categories are inferred from note prefixes. | Open | Persist an enumerated category and explicit reversal/original-event link in the operational ledger, then backfill auditable history. |
| WMS-COR-002 | P1 | Coverage | Imported files cannot prove governed population-wide completeness without a source manifest/attestation. | Mitigated | Keep DEAD disabled from imported ranges; add an audited scope manifest before enabling material-scoped imported completeness. |
| WMS-COR-003 | P2 | Provenance | Source checksum is supplied by the client rather than computed from uploaded bytes. | Open | Accept a file upload or canonical payload and hash it server-side. |
| WMS-COR-004 | P2 | Authorization | Existing operational/analytics permissions can authorize movement-history import. | Open | Add separate preview/read/finalize analytical-import permissions. |
| WMS-COR-005 | P2 | Lifecycle context | Downstream context lacks a stable event chronology and full lifecycle timestamps. | Open | Add a lifecycle-event API/object and verify web/mobile parity. |
| WMS-COR-006 | P2 | Validation | Full runtime/e2e evidence is not available locally. | Open | Require successful Draft PR CI before review or merge. |

No production action is authorized by this report.
