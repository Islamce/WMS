---
type: lesson
date: 2026-09-14
cost: near-miss
caught-by: wms-first-impression, then wms-reviewer, then wms-first-impression again
tags: [claims, scope, naming, review-agents]
---

# I claimed the same thing was fixed, twice, and was wrong both times

## What happened

"One name per screen" was asserted in a commit message. There were **five**
tables naming screens:

1. `MODULES` in `public/js/app.js` — the sidebar
2. a second table in `navigation-v2.js` — deleted
3. `ROUTE_PAGES.title` — the breadcrumb. **19 screens showed two names at once**
4. `permissions.label` — rendered on Roles & Permissions, **17 clashes**
5. the `<h3>` each page prints for itself — **12 screens**

Each was found only after the previous one was declared the last. Table 4 was
found by a review agent *added in the same change that claimed to have fixed the
problem*, pointing at that change's own commit message.

## Why the reasoning was wrong

Fixing where a name is *stored* and assuming that is where it is *rendered*. The
question that finds every table is not "where are the names kept" but **"on this
screen right now, how many strings claim to be its name, and where did each come
from?"** Asked that way, the breadcrumb and the `<h3>` 30px below it are
obviously two sources. Asked the other way, they are invisible.

The second failure mode: **the guard was scoped to the file that had been
fixed.** `permissions.js` was checked for raw labels; `users.js` renders the same
column and was not. So the guard could not have caught the defect that shipped
past it.

## What caught it

Three independent reviewers on the merged diff, before deployment. Two found the
same two defects without seeing each other's work — which is the strongest
evidence the review team is real and not agreeing with the author.

Nothing in CI caught any of it. Every table was green.

## The control that now exists

- Guards walk **all of `public/js`**, not the file that was fixed —
  `tests/e2e/screen_naming_test.js`
- A guard per table, each mutation-tested
- Review agents run against the diff **before deploy**, not only before merge

## The claim discipline this produced

Do not write "X is now the single source" in a commit message. Write "X is the
single source for A and B; C still has its own and is out of scope." The first
sentence is a claim a reviewer will falsify. The second is a map.

## Related

- [[A guard that measures the wrong number is worse than none]]
- [[Merged is not deployed, and green is not correct]]
