---
type: lesson
date: 2026-09-13
cost: design decision, held under review pressure
caught-by: asking what a lost row does to a warehouse
tags: [design, safety, subscription, permissions]
---

# Fail open for licensing, fail closed for authority

## The rule

- **No `tenant_subscription` row → no restriction.** No `tenant_profile` row →
  no edition restriction.
- **No permission → no access.** No authentication → no access. Segregation of
  duties refuses by default.

Opposite defaults, deliberately, in the same product.

## Why

A licence check that fails *closed* turns a lost row, a half-restored backup or a
botched migration into **a stopped warehouse** — lorries waiting at a gate
because a billing table is empty. The commercial loss from a few days of
unlicensed use is a rounding error next to that.

An authority check that fails *open* hands a storekeeper the ability to approve
his own goods issue. That is the one control a small contractor actually buys the
product for.

So the question is never "should this be strict?" but **"what does the failure of
this check cost, in each direction?"**

## The trap this creates for reviewers

A security reviewer seeing `if (!subscription) return { writable: true }` will
report it as a vulnerability every time, correctly by generic rules and wrongly
here. `.claude/agents/wms-security.md` states it explicitly, and instructs the
agent to report the *opposite* case — anything that makes permissions,
authentication or SoD fail open.

Expiry is a **ramp, not a switch**: warnings → grace period that still writes →
read-only that still reads. Nobody is ever locked out of seeing their own stock.

## Related

- [[The edition is checked before the admin short-circuit]]
- [[Counting rows to make an identifier issues the same number twice]]
