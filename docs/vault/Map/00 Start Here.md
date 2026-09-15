# Start Here

The second brain for KYNOX WMS. It owns **one** thing: how work on this product
actually failed, and what caught it. Everything else it links to.

> If a note here disagrees with the code, the code is right and the note is
> stale. See [[README]] for what belongs here and what does not.

## Read these first

New to the codebase, or about to change something risky:

1. [[Traps/Invariants that look like bugs]] — what not to "fix"
2. [[Merged is not deployed, and green is not correct]]
3. [[Fail open for licensing, fail closed for authority]]

## Lessons by what they protect

### Trusting your own verification
- [[A guard that measures the wrong number is worse than none]]
- [[A test that grants a permission and never revokes it passes exactly once]]
- [[I claimed the same thing was fixed, twice, and was wrong both times]]
- [[Tooling that is not gated is already dead]]

### Data integrity
- [[Counting rows to make an identifier issues the same number twice]]
- [[Fail open for licensing, fail closed for authority]]
- [[A fix that is right in the rare case and wrong on every ordinary day]] — and
  why the number a screen shows must not be quietly redefined

### What gets into the repository
- [[Every gate passed because none of them could see the file]]

### What the customer sees
- [[The first hour is not receive then issue]]
- [[A demo that cannot be performed is worse than no demo]]
- [[The edition is checked before the admin short-circuit]]

### Working habits
- [[git checkout is a delete]]
- [[Merged is not deployed, and green is not correct]]

## The pattern underneath most of them

Nearly every note here is the same failure in a different costume: **something
was believed because it was written down, rather than because it was run.** A
guard, a gate, a demo script, a generated manifest, a commit-message claim.

The counter-move is always the same and always cheap — *execute the thing you are
about to assert*. Three of these were found in under a minute of actually running
something.

## The authorities this vault does not replace

| For | Read |
|---|---|
| Production state | runtime evidence, then `docs/WMS-CURRENT-STATUS.md` |
| Rules and governance | `CLAUDE.md` |
| Decisions | `docs/WMS-DECISION-LOG.md` |
| Incidents | `docs/WMS-INCIDENT-LOG.md` |
| Who approves what | `docs/APPROVALS-AND-GATES.md` |
| The review team | `.claude/agents/README.md` |

## Adding a note

Use [[templates/Lesson]]. One lesson per note. Only after it was paid for — see
the rule in [[README]]. The `wms-lessons` agent proposes notes; a human decides
whether the lesson was real.
