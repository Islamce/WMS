---
type: lesson
date: 2026-09-13
cost: would have looked like a broken product to every first customer
caught-by: writing the test for the first-run guide
tags: [onboarding, product, quality-hold]
---

# The first hour is not receive then issue

## What happened

The obvious first-run story is: receive material, request it, issue it. Written
as a test, it **ends with nothing pickable**.

A received batch lands on **QUALITY HOLD, in no bin**. Until both are handled —
released from hold, and put away into a bin — it cannot be allocated. A new
customer following the intuitive path reaches an empty picking screen and
concludes the product is broken.

## Why the reasoning was wrong

The workflow was designed from the *warehouse's* requirements, where quality hold
and putaway are obviously correct. The first hour was never walked from the
*customer's* side, where they are two invisible gates between "I received it" and
"where is it".

Nobody would have found this by reading the code. It was found by writing down
what a new tenant does, in order, and running it.

## What caught it

`tests/e2e/first_hour_test.py` — written to prove the first-run guide, and
producing the finding that mattered more than the guide.

## The control that now exists

The server-computed first-run guide names the next step **in the order the
product actually requires**, and warns explicitly that stock arrives on quality
hold. It disappears once material has been issued once, so it cannot become
permanent furniture.

Asserted in `tests/smoke/first_run_guide_browser.js`:
*"and warns that stock arrives on quality hold"*.

## The general shape

For anything a customer does for the first time: **write the sequence down and
execute it**. Do not reason about it. The gap between the designed path and the
intuitive path is where first impressions are lost.

## Related

- [[The edition is checked before the admin short-circuit]]
- [[A demo that cannot be performed is worse than no demo]]
