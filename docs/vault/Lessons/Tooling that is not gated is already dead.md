---
type: lesson
date: 2026-09-13
cost: four months of silent rot
caught-by: being asked "is KAAF actually used?"
tags: [tooling, ci, drift, kaaf]
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

## Related

- [[Merged is not deployed, and green is not correct]]
