---
type: lesson
date: 2026-09-13
cost: near-miss
caught-by: executing it, not reading it
tags: [data-integrity, numbering, sqlite]
---

# Counting rows to make an identifier issues the same number twice

## What happened

Document numbers were minted as `COUNT(*) + 1`. Proved by execution in three
steps: mint three numbers, delete the second, mint a fourth — and the fourth
comes back as `ISS-2026-00003`, a number already issued and still printed on a
document.

## Why the reasoning was wrong

`COUNT(*)` answers "how many rows are there", which is only the next identifier
if **nothing is ever deleted and nothing ever runs concurrently**. Both
assumptions are invisible in the line of code that makes them.

## What caught it

Running it. Reading it had not, on at least two prior passes over the same file.
The three-step reproduction took under a minute and is the entire reason this is
a near-miss and not an incident with two goods issues sharing a number.

## The control that now exists

`server/services/documentNumber.js` — an atomic counter table with
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, so the number is *reserved*, not
counted. Migration `027_document_sequences` seeds it **from the highest number
already issued**, so existing tenants never re-issue.

`tests/e2e/document_number_test.js` — 7 assertions, including the delete case.

## The general shape

Any identifier derived from the current state of a table rather than from a
counter that only moves forward. `MAX(id) + 1` is the same defect wearing a
different hat.

## Related

- [[Fail open for licensing, fail closed for authority]]
