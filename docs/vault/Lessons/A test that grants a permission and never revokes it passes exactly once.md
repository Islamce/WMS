---
type: lesson
date: 2026-09-14
cost: near-miss
caught-by: running the suite a second time
tags: [tests, state, flakiness]
---

# A test that grants a permission and never revokes it passes exactly once

## What happened

`tests/smoke/subcontractor_ownership_browser.js` asserts that an approver is
warned about a missing authority, then **grants that authority** to the manager
role to prove the grant works — and never takes it back. The browser suites
share one local database.

So: first run green, second run two failures, and on a *completely fresh*
database it fails differently again (a 409, because it depends on data an
earlier suite in the chain leaves behind).

It is green in CI, which always starts from a clean checkout and runs the chain
in order. So the defect is invisible exactly where anyone would look for it.

## Why the reasoning was wrong

"CI is green" was being read as "the tests are sound". CI proves the suite passes
**once, in order, from clean**. It says nothing about whether a test can be run
twice, run alone, or run after a colleague's work.

The deeper error: a test that *changes authorisation state* is not a test, it is
a migration with assertions attached.

## What caught it

Re-running the suite while investigating an unrelated failure, and noticing the
result changed with no code change in between. Then `git stash` → same failure on
unmodified `main`, which proved it was not the change under review.

## The control that now exists

None yet — deliberately. It was recorded as a `DRIFT:` note on the PR rather than
fixed inside a change about screen names. Per `CLAUDE.md`, a validator is built
when a pattern **repeats** in real work, not on first sighting.

The technique is the control: **when a test result changes and the code did not,
stash and re-run on the unmodified base before blaming the change.**

## Related

- [[A guard that measures the wrong number is worse than none]]
- [[Merged is not deployed, and green is not correct]]
