# The review team, checked in

Three reviewer definitions that travel with this repository. Any Claude Code
session opened here can invoke them by name; they are not a running service and
nothing keeps them alive between sessions. What is permanent is the KNOWLEDGE in
them, not a process.

| Agent | Use it | It exists because |
|---|---|---|
| `wms-reviewer` | Before merging or deploying any change | It was written from the defects that reached a branch: a document number that could be issued twice, and a third table naming screens |
| `wms-security` | When routes, middleware, permissions, database scripts or workflows change | It found a line that would have misled an operator trying to get a warehouse out of read-only, and 46 committed bytecode files |
| `wms-first-impression` | After any change to `public/js`, and before showing the product to a customer | It found nineteen screens showing the user two different names at the same moment, on a change whose author had just declared the problem solved |

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

**They review, they never edit.** Every definition says so. A reviewer that fixes
what it finds stops being independent, and its next report becomes a description
of its own work.

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
