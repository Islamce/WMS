---
type: lesson
date: 2026-09-12
cost: near-miss
caught-by: tracing App.can() rather than trusting its name
tags: [permissions, editions, workflow]
---

# The edition is checked before the admin short-circuit

## The trap

`App.can()` evaluates the **tenant edition first**, and only then the "admin sees
everything" rule. A module absent from an edition profile is therefore invisible
**to administrators too**.

The natural assumption — "admin can always reach it, so a workflow can always be
completed by hand" — is false here. Remove a module from a profile and you can
dead-end a workflow for every user in the tenant, with no one able to unstick it
from the UI.

## Why this is easy to get wrong

Every other system trains the opposite instinct. And the failure is silent: the
screen is simply not in the menu, the router bounces to Home, and nothing says
*why*.

## The related trap, same family

Three screens that the collapsed contracting workflow routes past were
deliberately **not hidden**. A tenant switched between editions can have
in-flight requests stranded at exactly those steps. So they stay reachable and
**explain themselves** instead of disappearing.

The instinct "this step is no longer used, hide the screen" strands whatever is
already standing on it.

## The control that now exists

- `.claude/agents/wms-reviewer.md` carries this trap explicitly
- `tests/e2e/demo_tenant_test.py` exists partly because an admin account that
  cannot open every screen is a demo that dies in front of a buyer

## Related

- [[Fail open for licensing, fail closed for authority]]
- [[The first hour is not receive then issue]]
