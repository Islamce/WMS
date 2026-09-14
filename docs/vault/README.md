# KYNOX WMS — Second Brain

An Obsidian vault, committed to the repository so it exists on every machine
that has the code and cannot be lost with a container, a laptop or a session.

## Opening it

Obsidian → **Open folder as vault** → choose `docs/vault`. Nothing to install;
the `.obsidian` folder here carries the settings. Start at
[[Map/00 Start Here]].

## What belongs here, and what does not

This vault is **not** a new authority and must never become one. `CLAUDE.md`
governs where facts live, and it forbids copying the same current-state
statement into several files. So:

| Fact | Lives in | This vault |
|---|---|---|
| Current production state | runtime evidence, `docs/WMS-CURRENT-STATUS.md` | links, never restates |
| Architecture / governance decisions | `docs/WMS-DECISION-LOG.md`, `docs/WMS-UNIFIED-AI-HANDOFF.md` | links, never restates |
| Incidents | `docs/WMS-INCIDENT-LOG.md` | links, never restates |
| Implemented behaviour | the code, the tests | links to `file:line` |
| **How we got it wrong, and what caught it** | **here** | **owns this** |

The one thing this vault owns is the record of *how work actually failed and
what caught it*. That has no home in the other documents: the decision log says
what was decided, the incident log says what broke in production, neither says
"this reasoning was wrong twice in a row and here is the shape of it."

A note here is stale the moment it restates a fact it does not own. If a note
and the code disagree, the code wins and the note is wrong.

## The rule that makes it useful

**One lesson per note, written only after the lesson was paid for.**

Not "things to remember". Not a checklist copied from elsewhere. A note earns
its place when a real defect got through, or nearly did, and something specific
caught it. If it never cost anything, it is advice, and advice belongs in a
skill or a review agent where it actually runs — not here.

See [[Map/00 Start Here]] for the index and [[templates/Lesson]] for the shape.
