---
type: lesson
date: 2026-09-13
cost: four months of silent rot
caught-by: being asked "is KAAF actually used?"
tags: [tooling, ci, drift, kaaf]
amended: 2026-09-14
---

# Tooling that is not gated is already dead

## What happened

KAAF — the vendored architecture-context tooling in `scripts/architecture/` and
`.ai/` — had been **dead since August** while still describing a production host
that was retired on 2026-09-06. It was in the repository, it was documented, and
nothing ran it, so nothing noticed.

It surfaced only when a direct question was asked: *"was KAAF used during
implementation, or was it never consulted at all, and what is its role now?"*

A reported dependency cycle in it turned out to be a **stale manifest, not a
design defect** — `server/services/backup.js` had already been refactored to
remove the real cycle and says so in its own header. A second false edge came
from `require('../../package.json')`, changed to an `fs` read.

## Why the reasoning was wrong

"It is committed, therefore it is in use." Committed tooling decays exactly like
documentation, and faster, because its output *looks* authoritative while being
months stale. A stale generated artifact is more dangerous than a missing one: it
answers questions confidently and wrongly.

## What caught it

A question from the owner. Not a test, not a review, not CI.

## The control that now exists

Two CI steps, so it cannot rot silently again — verified as **actually running**,
not merely present, on the current `main`:

- *Architecture context is current (KAAF)* → `python3 scripts/architecture/generate.py --check`
- *Architecture manifests match the code (KAAF drift)* → fails on any
  error-severity finding in `.ai/drift.json`

## The general shape

**If it does not run in CI, assume it is stale until proved otherwise.** Applies
to generators, linters kept "for reference", scripts in `scripts/`, and any
document describing infrastructure.

Corollary: when a tool reports a defect, check whether the tool is describing the
*current* code before fixing the code.

## Amendment, 2026-09-14 — the gate's first catch, on a commit with no code in it

The two CI steps above were added on 2026-09-13. They fired for the first time
the next day, on the least likely change: commit `390460a`, which added
`docs/vault` — markdown notes and Obsidian settings, not a line of product code.
`python3 scripts/architecture/generate.py --check` failed with
`KAAF-E006-generated-output-stale` on all twelve generated artifacts. (Verified
by re-running the check in a worktree at `390460a`, not taken from the report.)

**Why a documentation commit broke it.** The `wms-runtime-entry` manifest
enumerates the repository's *files*, not its code — `.claude/agents/*.md` and
`docs/**` are in its `sourceFiles` list. Its `sourceFileCount` in
`.ai/architecture.json` went 75 → 94 — the vault's 18 new files plus the new
`wms-lessons` agent definition — and every
artifact carries an `inputDigest` over that inventory, so one added markdown file
invalidates all of them at once.

**Where the reasoning went wrong.** The change was judged safe by its *content* —
"documentation only, there is nothing here to break" — while the gate keys on the
*inventory*. Both halves of that sentence are true and the conclusion is still
wrong. The commit being protected was the one adding a vault whose stated pattern
is *believed because it was written down, rather than because it was run*.

**What caught it.** The gate itself, run locally straight after the commit —
which is exactly what it was added for. But it was run *after* `git push`, so a
commit CI would have failed reached the remote branch first. (That the push
preceded the check is stated in `cb93cdb`'s commit message; git keeps no push
timestamps, so the ordering is the author's account, not independently verified
here — **inference**.)

**The fix.** `cb93cdb` ran `scripts/architecture/generate.sh` and committed the
result. Never a hand-edit under `.ai/`, which the tool's own error text forbids
(`scripts/architecture/generate.py:139-140`). Drift stayed at 0 errors and
0 warnings.

**The shape, for next time.** *Any* commit that adds or removes a file —
documentation, an agent definition, a vault note — invalidates the generated
architecture context. The check to run **before** pushing is
`python3 scripts/architecture/generate.py --check`; the repair is always
`./scripts/architecture/generate.sh`. *Editing* an existing file does not trip it
— confirmed by running the check after amending this very note, which passed.

**No new control.** `.github/workflows/ci.yml:48-49` already catches this on the
remote and did its job. The only gap was running it after the push instead of
before, and that is a habit, not something a second script would fix — see
[[Merged is not deployed, and green is not correct]] for why a control that is
merely described is not a control.

## Second amendment, 2026-09-14 — it happened again five hours later

The amendment above was committed at 15:54 (`bd688a5`). It ends with the exact
instruction *"the check to run **before** pushing is
`python3 scripts/architecture/generate.py --check`"*.

At 21:29 the same day, commit `2dd0e45` changed module content the generated
context records, and `6a5e1e4` — committed **21 seconds later** — was a bare
regeneration to repair it. Its own commit message says so: *"Caught by the gate —
after the push this time, not before it, which is the same habit the vault note
on this tool already describes."* (As before, git records no push timestamps; the
ordering is the author's account in the commit message, not independently
verified — **inference**.)

**The lesson this adds, and it is not about KAAF.** Writing the habit down —
here, in this vault, in the note whose stated purpose is to stop it — did not
change the habit. Five and a half hours was not enough for a written note to
survive contact with a task. That is this vault's own standing pattern turned
back on itself: *believed because it was written down, rather than because it was
run.* A note is not a control.

**And no control was built for it.** There is still no pre-commit or pre-push
hook (`.git/hooks` holds only samples — checked) and the only place the check
runs is `.github/workflows/ci.yml:49`, on the remote, after the push. That was a
deliberate choice, not an oversight: the failure is cheap — a bare regeneration
commit, no product code involved, caught by CI every time. A local hook would
fire on every commit in a repository where most commits do not add files. The
honest position is that this costs one wasted commit each time it happens, and
the day it costs more than that is the day to build the hook.

**The shape, restated.** If a lesson's only enforcement is a person remembering
it, count on it failing, and decide deliberately whether that failure is cheap
enough to accept. Do not assume writing it down changed anything — this note is
the evidence that it does not.

## Related

- [[Merged is not deployed, and green is not correct]]
- [[Every gate passed because none of them could see the file]]
