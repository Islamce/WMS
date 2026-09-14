---
type: lesson
date: 2026-09-14
cost: near-miss
caught-by: CLAUDE.md, and checking rather than assuming
tags: [deploy, production, ci]
---

# Merged is not deployed, and green is not correct

## What happened

Two separate traps, one week apart.

**Merged is not deployed.** `main` sat ahead of production for days. Every
instinct says a merged pull request is live; nothing in the tooling says
otherwise, and the sentence "not deployed — merging this does not deploy it" had
to be written into a commit message by hand to stop the assumption.

**The approval gate did not exist.** A deployment workflow was documented as
requiring human approval on the `production` environment. It did not: the plan
run's deploy job started **three seconds** after validation, because no reviewers
are configured on that environment. A safety was described, believed, cited — and
was never there.

**Green is not correct.** CI was green on every one of the five naming tables. It
is green on a suite that cannot be run twice. Green means "the assertions we
wrote passed", and the defects that hurt are the ones nobody wrote an assertion
for.

## Why the reasoning was wrong

Treating the *description* of a control as evidence the control exists. A gate is
real when a run stops at it, not when a document says it does.

## What caught it

- `CLAUDE.md`: *"Never assume a merge has been deployed."*
- Reading the actual timestamps of the plan run's jobs instead of the workflow's
  header comment.

## The control that now exists

- `docs/APPROVALS-AND-GATES.md` — all 21 steps, each marked human-approval-required
  or not, **and technical vs strategic**. Five belong to the owner.
- The production environment's missing reviewers are recorded as a stated fact,
  not a gap someone might notice later.
- Deploy defaults to `plan_only`, with a verified backup, a recorded rollback
  target, row counts compared before and after, and automatic rollback — because
  the human gate is the one thing that is *not* there.

## Related

- [[I claimed the same thing was fixed, twice, and was wrong both times]]
- [[A test that grants a permission and never revokes it passes exactly once]]
- [[Tooling that is not gated is already dead]]
- [[A fix that is right in the rare case and wrong on every ordinary day]]
- [[Every gate passed because none of them could see the file]]
