---
type: lesson
date: 2026-09-14
cost: near-miss — branch only, never merged; cost a history rewrite and a credential rotation
caught-by: a security review agent reading the whole diff
tags: [secrets, ci, gates, git, blind-spots]
---

# Every gate passed because none of them could see the file

## What happened

A commit on a feature branch was staged with `git add -A`. It swept in **eleven
`.probe-*` scratch files** — throwaway diagnostic scripts left in the repository
root by review agents that had been run earlier — none of which had been opened
before being committed.

They carried **two plaintext credentials**. One of them, `.probe-setup.js`,
created working logins against a database that already held data: no existence
check, no production-path guard, no dry run, no confirmation. The reviewed
scripts under `scripts/` refuse exactly that —
`scripts/install-starter-data.js:110-114` prints `REFUSED: this database already
holds master data` and exits 1, and `scripts/provision-tenant.js:258-260` refuses
when the database file already exists (both verified by reading them here). The
probe script had no such guard. (What it did when run — row counts before and
after — is recorded in commit `19bffaf`'s message from the reviewer's run; it was
not re-run to write this note.)

Every gate in the repository passed:

- **`ls` does not show them.** They are dot-prefixed, so nothing in a routine
  look at the working tree lists them.
- **ESLint does not read them.** `npm run lint` is `eslint . --ext .js`
  (`package.json:18`), and ESLint 8.57.0 ignores dotfiles by default. Verified by
  running it: two identical files with the same syntax error, one named
  `probe-vaultcheck.js` and one `.probe-vaultcheck.js` — the first is reported as
  an error, the second is not reported at all, and naming it explicitly on the
  command line only produces `File ignored by default`.
- **The CI syntax check does not look there.** It runs
  `find server public/js index.js tests/load -name '*.js'`
  (`.github/workflows/ci.yml:32`). The repository root is not in that list.

## Why the reasoning was wrong

**"CI is green" was read as "the commit was reviewed."** Every gate in this
repository is an *allowlist of paths* or an extension filter. A green run says
"nothing inside the paths we look at is broken." It says nothing whatsoever about
a file outside them. The only thing standing between an unread file and the
repository is a human or an agent reading the file list — and `git add -A` is
specifically the command that removes the step where you would have read it.

The second error is quieter: **the files were treated as belonging to the
session, not to the repository.** They were scratch, they were temporary, they
were going to be deleted. That framing is what made staging everything feel safe.
A file in the working tree has no idea it is temporary.

## This is the second time, in the same shape

The same blind spot put **46 `.pyc` files** into the tree — verified by counting
them at `5bd5549` — where they survived review for the same reason: produced by
tooling, never opened, swept in by a bulk stage, invisible to every linter. A
hash-based `.pyc` executes without Python ever reading the `.py` beside it, and
nobody reads bytecode in a review.

Two occurrences, different file types, identical mechanism. That is what makes
this a note rather than an embarrassment.

## What caught it

A **security review agent pointed at the whole diff** — not at the code that was
being changed. Per the commit record it did not describe the files, it executed
them: it ran `.probe-setup.js` against a populated database, recorded what
happened to the row counts, and ran the reviewed scripts beside it to show they
refused. Same method as everything else in this vault that worked.

No gate fired. Had the reviewer been scoped to "review the reporting changes",
which is what the commit was actually about, the files would have merged.

## What was done about it

The three affected commits were **rewritten out of the branch's history** rather
than the files being deleted in a follow-up commit. Deleting them forward leaves
the content — and the credentials — readable in the branch's history forever.
Main and production were never affected: the commit carrying them is now
unreachable from any ref (verified with `git branch -a --contains`).

Credential handling is not this vault's to record. The rule is in `CLAUDE.md`
(never store secrets) and the disposition is in the commit that removed them.

## The control that now exists — and what it does not cover

`.gitignore` now carries both shapes, each with a comment saying why rather than
just what:

- `.gitignore:17` — `*.pyc`
- `.gitignore:21` — `.probe-*`

**Be clear about what that is.** It is a denylist of two shapes that have already
gone wrong. A third shape — a `.env.local`, a `debug-dump.json`, a notebook
checkpoint — passes exactly as these did. No gate was built that sees unfamiliar
files entering the repository root, and none is proposed here: the cheap and
sufficient control is the habit below, and a gate nobody asked for is a gate
nobody maintains.

## The general shape

**Before committing, read the list of files, not the diff of the files you
changed.** `git status` and `git diff --cached --name-only` take two seconds and
are the only step in the whole pipeline that sees a file the tools are blind to.

And when an agent or a script leaves artifacts behind, they are now repository
state. Clean them in the same breath that created them, or add the pattern to
`.gitignore` before the run, not after it goes wrong.

## Related

- [[Tooling that is not gated is already dead]]
- [[Merged is not deployed, and green is not correct]]
- [[git checkout is a delete]]
