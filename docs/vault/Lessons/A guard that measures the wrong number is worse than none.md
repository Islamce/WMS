---
type: lesson
date: 2026-09-14
cost: near-miss
caught-by: testing the guard itself
tags: [tests, guards, false-confidence]
---

# A guard that measures the wrong number is worse than none

## What happened

A ratchet test counted how many seeded permission labels disagreed with the
navigation name. It reported **11**. The real figure was **17**.

The extractor assumed the fields of a navigation item appeared in a fixed order
(`route, label, icon, permission`). They do not, everywhere. It silently matched
**28 of 39 routes** and never said it had skipped any.

Separately, a mutation test written to prove a different guard worked mutated the
key `dashboard` — which does not exist in `seed2.js`. It "passed" while testing
nothing at all.

## Why the reasoning was wrong

Both came from the same move: **the guard was trusted because it was written**,
not because it was tried. A passing test and a test that cannot fail look
identical from the outside. The baseline number looked plausible, and plausible
is exactly what a wrong number looks like.

The ratchet made it worse rather than better. A number that may only fall gives
real confidence — so a wrong one gives real confidence in nothing.

## What caught it

Deliberately re-reading the extractor against the file it parses, counting the
matches by hand, and finding 28 where there should have been 39.

## The control that now exists

Every guard in `tests/e2e/screen_naming_test.js` is **mutation-tested before it
is believed**: reintroduce the exact defect, watch the test fail, restore. Three
mutations are documented in the PR that added them.

Parse each item as a whole and pull fields by name —
`tests/e2e/screen_naming_test.js:112` carries the comment explaining why.

## Related

- [[I claimed the same thing was fixed, twice, and was wrong both times]]
- [[A test that grants a permission and never revokes it passes exactly once]]
