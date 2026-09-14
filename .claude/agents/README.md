# The team, checked in

Nine agent definitions that travel with this repository — a small company's worth
of specialists: engineering, operations, the trade itself, and the commercial
side. Eight review; one keeps the record. Any Claude Code
session opened here can invoke them by name; they are not a running service and
nothing keeps them alive between sessions. What is permanent is the KNOWLEDGE in
them, not a process.

| Agent | Use it | It exists because |
|---|---|---|
| `wms-reviewer` | Before merging or deploying any change | It was written from the defects that reached a branch: a document number that could be issued twice, and a third table naming screens |
| `wms-security` | When routes, middleware, permissions, database scripts or workflows change | It found a line that would have misled an operator trying to get a warehouse out of read-only, and 46 committed bytecode files |
| `wms-first-impression` | After any change to `public/js`, and before showing the product to a customer | It found nineteen screens showing the user two different names at the same moment, on a change whose author had just declared the problem solved |
| `wms-lessons` | After a review finds something, after a defect escapes, after an incident | The reviewers find the same *class* of defect repeatedly, because nothing was written down between one session and the next. It writes to `docs/vault` |
| `wms-data-truth` | After any change to a dashboard, KPI, report, chart or analytics query | Twelve reporting defects in one sitting — three screens answering "how much stock is there" with three different numbers, none of them labelled, and a 30-day chart with two points on it |
| `wms-ops` | Before a deploy or a migration; any change touching the VPS or the live database | A deploy workflow sat dispatchable and pointed at a host retired weeks earlier, and an approval gate that was documented, cited, and did not exist |
| `wms-supply-chain` | When a workflow, movement, reservation, allocation, receipt, issue or return changes | The product is sold to contractors, and the failure that costs a pilot is designing for somebody else's warehouse — racked aisles for a store that is two yard areas and three racks |
| `wms-performance` | When a query, list screen, report or import changes, or a table will grow | One SQLite file, one writer at a time. A slow report does not just feel slow — it holds a lock while a storekeeper is posting a goods issue |
| `wms-market` | Before a demo or a sales conversation; when a feature is proposed to win customers | The alternative a contractor is really comparing against is Excel and a paper book, and features that win the meeting are not the ones that get renewed |
| `wms-mobile` | When the Flutter app changes, or the web product changes and the app must follow | The app carries its own screen-name table and already disagrees with the web on eight screens — drift is its normal state, not an exception |

## How they divide the work

Each owns one question nobody else asks:

| | |
|---|---|
| `wms-reviewer` | Is the change correct? |
| `wms-data-truth` | Do the numbers mean what the labels say? |
| `wms-security` | What can a warehouse employee, or a mistyped command, reach? |
| `wms-performance` | Does it hold on a real day's data? |
| `wms-ops` | Is it safe to put in front of a live warehouse? |
| `wms-supply-chain` | Would a site storekeeper actually work this way? |
| `wms-first-impression` | What does a user, and a buyer, see? |
| `wms-market` | Does it win or keep a customer? |
| `wms-lessons` | What did this teach, and where is it written down? |

Do not run all nine on every change. Run the two or three whose question the
change actually raises — a naming fix needs `first-impression` and `reviewer`; a
report needs `data-truth`; a deploy needs `ops` and `security`. Running the whole
team on a small change is how a review team becomes noise that gets skipped.

## Why these are project agents rather than a general-purpose collection

Generic reviewer agents are available and were tried. The findings that mattered
came from briefs that named THIS codebase's traps — that the edition is checked
before the admin short-circuit, that `reservation_number` is required on every
outbound movement, that production is an unconfigured install where every
migration must be inert. A reviewer that does not know those looks at the same
diff and sees nothing wrong.

So each definition carries a list of things that actually went wrong here. When a
new class of defect gets through, add it to the relevant agent rather than
remembering it; that is the whole point of them being files.

## Using them

`Agent({ subagent_type: "wms-reviewer", prompt: "..." })`, or ask Claude to
review a branch and it will pick the right one from the descriptions.

They are picked up from disk without a restart, EXCEPT the first time a
`.claude/agents/` directory is created in a session that started without one —
that case needs the session restarted. Editing a definition afterwards takes
effect within seconds.

Each is set to `effort: high` deliberately. The findings that mattered came from
reading the surrounding code and testing a hypothesis, not from a skim, and a
reviewer that skims is worse than none because its silence gets trusted.

## The rule that makes them worth having

**The reviewers review, they never edit.** Each of the three definitions says so.
A reviewer that fixes what it finds stops being independent, and its next report
becomes a description of its own work.

`wms-lessons` is the deliberate exception and the only one that writes. It is
allowed to, because it writes **only** under `docs/vault` — never product code,
tests or configuration. It records what the reviewers found; it does not act on
it. Keeping those two jobs in separate agents is what stops the record from
becoming an account of the recorder's own work.

They are also worth most on work whose author is confident. The single most
valuable finding so far came from asking a reviewer to check claims an author had
written in a pull request body — three of the four were true, and the fourth had
shipped.

## What they do NOT replace

The deterministic gates in `tests/run.sh`, `npm run test:smoke`, `npx eslint` and
the two KAAF checks in CI. Those decide pass or fail without judgement and run on
every push. The agents are for the questions those cannot answer.

Nor do they replace a person using the product for a day. No agent has ever
noticed that a screen is annoying to use.

## The second brain

`docs/vault` is an Obsidian vault committed to the repository, owning one thing:
**how work on this product actually failed, and what caught it.** It links to
`CLAUDE.md`, the decision log and the incident log rather than restating them.

Open it with Obsidian → *Open folder as vault* → `docs/vault`, and start at
`Map/00 Start Here.md`. `wms-lessons` proposes the notes; a human decides whether
the lesson was real. The bar is deliberately high — a lesson must have been paid
for. A vault of forty notes gets read; a vault of four hundred is where the four
that mattered go to be lost.
