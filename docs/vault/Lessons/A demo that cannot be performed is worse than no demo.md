---
type: lesson
date: 2026-09-14
cost: would have failed live in front of a buyer
caught-by: wms-first-impression
tags: [sales, demo, sod]
---

# A demo that cannot be performed is worse than no demo

## What happened

`scripts/create-demo-tenant.js` printed a ten-minute demo script ending with the
segregation-of-duties showpiece: *"approve as the demo account, then try to post
the issue as the storekeeper — and then the other way round, which is refused."*

The other way round is impossible. The storekeeper holds `gi_posting` but not
`approvals`, `material_requests` or `picking`. He does not get a refusal message;
**the screen is simply absent from his menu** and the router bounces him to Home
with no explanation.

A presenter following the printed instructions, live, in front of a buyer, hits
an empty menu at the exact moment they are demonstrating the product's main
selling point.

## Why the reasoning was wrong

The instruction was written from how the control *works* (SoD refuses the
approver) rather than from what the demo account can *reach*. Both true; only one
of them is what happens on screen.

And it was written into a `console.log`, where no test looks. Prose in output is
unreviewed code.

## What caught it

A review agent that reads what a user and a buyer actually see, rather than
whether the code is correct. Nothing else would have — every test passed, the
script works, the tenant is created correctly.

## The control that now exists

The printed script now says what the storekeeper holds and does **not** hold, and
warns explicitly not to expect a refusal message. `scripts/create-demo-tenant.js`.

## The general shape

Any instruction the product prints for a human to follow — demo scripts, runbook
steps, error messages suggesting a fix, onboarding guides — is **untested prose
that will be followed literally under pressure**. Walk it once.

## Related

- [[The first hour is not receive then issue]]
- [[The edition is checked before the admin short-circuit]]
