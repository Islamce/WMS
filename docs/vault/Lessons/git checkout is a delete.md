---
type: lesson
date: 2026-09-13
cost: lost work, recovered from a scratch copy
caught-by: noticing the edit was gone
tags: [git, destructive, habits]
---

# git checkout is a delete

## What happened

`git checkout <file>` was run to discard an unrelated change. It destroyed an
**uncommitted edit to `navigation-v2.js`** made minutes earlier. Recovered only
because a copy happened to exist in a scratch directory.

## Why the reasoning was wrong

`checkout` reads as *navigation* — switching to something. Applied to a path it
is **overwrite from HEAD with no confirmation, no reflog entry, and no undo**.
Uncommitted work has never been in git's care; there is nothing to recover it
from.

## The control that now exists

Habit, not tooling:

- `git stash` instead of `git checkout <file>` — reversible, and it says what it
  did
- `git status` before any discard, and read it
- commit early on a branch; a commit is the cheapest possible backup

## The general shape

The dangerous commands here are the ones that are *quiet*: `checkout <path>`,
`reset --hard`, `rm -f`, and anything with `--force`. Loud commands get checked.

Note the same instinct is protected at the production level by `CLAUDE.md`:
deleting or replacing `data/wms.db`, `-wal` or `-shm` is forbidden outright, and
the sandbox permission system refused exactly that shape of command during this
work — correctly.

## Related

- [[Merged is not deployed, and green is not correct]]
- [[Every gate passed because none of them could see the file]]
