---
type: trap
tags: [invariants, review]
---

# Invariants that look like bugs

Things a competent reviewer will flag as defects, which are correct and must not
be "fixed". Each is stated in the code or an agent definition; this note exists
so the list can be read in one place.

| Looks wrong | Is correct because |
|---|---|
| Missing subscription row → full write access | A licence check failing closed stops a warehouse. See [[Fail open for licensing, fail closed for authority]] |
| Missing tenant profile → no edition restriction | Same reason; keeps every existing deployment behaving as before |
| `sod.js` exempts admins (`server/services/sod.js:30`) | By design. A single-person contractor must be able to finish a request |
| Screens the collapsed workflow routes past are still reachable | A tenant switched between editions can have requests stranded there. See [[The edition is checked before the admin short-circuit]] |
| `server/routes/setup.js` has no permission check | It returns only `done: <count> > 0` — booleans, never quantities or names. **If that ever changes it becomes an unprivileged inventory oracle and must be gated** |
| `i18n.js` `t()` is an identity function | English-only by decision; there is no `en` dictionary. New code writes English directly |
| `analytics.js` `current_stock` counts `QUALITY_HOLD` and blocked batches that allocation would refuse | Deliberate, and it was tried the other way. Held stock is *pending*, not lost. Every batch is received on hold (`server/routes/receiving.js:133`), so excluding it makes every fresh delivery read as empty. Use `issuable_stock` for "what a picker could be handed now". See [[A fix that is right in the rare case and wrong on every ordinary day]] |

## Hard invariants — breaking these corrupts data

- **`stock_transactions.reservation_number` is required on every OUT movement.**
  Removing a staging document without accounting for it breaks the ledger.
- **`server/workflow/states.js` holds the allowed-edge table.** A transition not
  in it is a transition nobody reviewed. New edges are *declared*, never
  bypassed.
- **No identifier derived from `COUNT(*)` or `MAX(id)`.** See
  [[Counting rows to make an identifier issues the same number twice]].

## Production, non-negotiable

`CLAUDE.md` owns this and is the authority — not this note. In summary only:
production is `/opt/apps/wms` on a Hostinger VPS under Docker Compose, database
`/opt/apps/wms/data/wms.db`. Seeding, resetting and deleting database files are
forbidden. Always re-read `CLAUDE.md` before a production operation.
