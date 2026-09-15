---
type: lesson
date: 2026-09-14
cost: near-miss — caught on the branch, never merged, never deployed
caught-by: an adversarial reviewer running the real endpoint against real data
tags: [reporting, semantics, replenishment, review-agents, scope]
---

# A fix that is right in the rare case and wrong on every ordinary day

## What happened

A real, measured defect: `server/services/analytics.js` summed every
company-owned batch into `current_stock`, including batches on `QUALITY_HOLD`
and batches flagged `is_blocked`. Allocation will never hand those out —
`server/services/allocation.js:23-24` takes `quality_status = 'RELEASED' AND
is_blocked = 0` only. So stock nobody could draw sat inside the reorder
calculation and suppressed a replenishment signal on the stock they could.

The fix excluded held and blocked stock from `current_stock`. It was wrong, and
worse than the defect it corrected.

`server/routes/receiving.js:133` writes `'QUALITY_HOLD'` on **every** batch it
creates. There is no other value on that path. So the window between a delivery
arriving and somebody clicking release — the ordinary state of every delivery,
every day — is exactly the window in which the fix was active. In it, a material
that had just been unloaded read as empty and fired a CRITICAL "replenish now"
alert. A rare suppressed signal had been traded for a false one on every receipt.

It was worse than mislabelling. `current_stock` of zero with no issue events
classifies the material `INACTIVE` (`server/services/analytics.js:237`), and
`fullReport()` filters `INACTIVE` out before it builds anything
(`server/services/analytics.js:366`), and that filtered list is what the report
returns as `items` (`server/services/analytics.js:384`). The material was
**deleted from the report** — and the compensating `held_stock` figure went with
it, since it travels on the item that was dropped.

## Why the reasoning was wrong

Three separate moves, each of which repeats:

1. **The fix was judged against the case that prompted it, and never against the
   ordinary case.** The motivating scenario — a small holdback quietly
   suppressing a reorder — is rare. The scenario the change actually ran in —
   a fresh delivery awaiting inspection — is the default state of the system, and
   was never simulated. The question that would have found it in seconds is *"how
   does a batch get into this state, and how often?"*, which is one `grep` away
   from `receiving.js`.

2. **An existing number was given a new meaning in place.** `current_stock` was
   already read by other screens and by `stock_value`. Redefining it to answer a
   different question ("what could a picker be handed right now") silently
   changed every existing answer. The correct move, taken in the end, was to give
   the new question **its own field** — `issuable_stock` — and leave the old
   number alone.

3. **A downstream filter was not traced.** The change was reasoned about at the
   point the number is computed. Its real damage happened two hundred lines
   later, where a zero becomes a classification and a classification becomes a
   deletion. Changing a value means following it to every place it is branched on.

A fourth thing is the vault's standing pattern in a new costume: the code comment
written alongside the fix asserted the held figure was *"reported alongside, not
dropped"*, and the commit message asserted *"no existing deployment sees a figure
move"*. Both were false — `summary.total_stock_value` and every per-material
`stock_value` derive from `current_stock`. The claims were written, not run.

## What caught it

An adversarial review agent, running the real endpoint against real data — not
reading the diff. It reproduced the receive-then-report sequence and read what
the screen actually said. Nothing in CI failed; the branch was green throughout.

Worth saying plainly: the defect the fix was *for* had itself been found by
execution one commit earlier. The same method found the fix wrong. Reading was
0 for 2 here.

## The resolution

`current_stock` keeps its original meaning and value — held stock is **pending**,
not lost: it is ours, on site, and becomes issuable the moment quality releases
it, which is precisely what a replenishment decision should count. The new
question got the new field. Subcontractor-owned stock stays out of both, because
that is not pending — it is not ours.

## The control that now exists

`tests/e2e/analytics_truth_test.py` builds a stock position whose correct answers
are worked out by hand and asks each screen:

- `tests/e2e/analytics_truth_test.py:203` — current stock still counts held stock
- `tests/e2e/analytics_truth_test.py:205` — issuable is its own figure
- `tests/e2e/analytics_truth_test.py:209` — **a material whose stock is entirely
  held still appears in the report**, which is the assertion that would have
  failed on the bad fix
- `tests/e2e/analytics_truth_test.py:191` — the four dashboard tiles must account
  for every unit on hand, so no quantity can fall into no bucket

Run on 2026-09-14 at `1476921`: 26 passed, 0 failed.

`tests/e2e/subcontractor_report_test.py:134-139` additionally asserts `held_stock`
and `issuable_stock` are **subsets** of `current_stock`, not siblings of it — the
shape the bad fix broke.

## The general shape

Any field with a name a person would understand — `current_stock`, `available`,
`active_users`, `total` — is already being read by somebody. When a new question
appears, the temptation is to sharpen the existing field, because the new
definition is *more correct*. It is also a silent change to every existing
reader. **Add the field; do not redefine the field.**

And before shipping a stricter filter, ask what fraction of rows are in the
excluded state on a normal day. If the answer is "all of them, for a while", the
filter is not a refinement, it is an outage.

## Related

- [[Traps/Invariants that look like bugs]]
- [[I claimed the same thing was fixed, twice, and was wrong both times]]
- [[A guard that measures the wrong number is worse than none]]
- [[Merged is not deployed, and green is not correct]]
