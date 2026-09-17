# KYNOX WMS agent company

These project agents are the operating staff for this repository. They are not a
collection of generic personas and they are not a background service. Their value
is the project-specific knowledge in their briefs: incidents, escaped defects,
workflow invariants, commercial boundaries and field realities learned while
building this WMS.

The **Founder is the final decision authority**. The top-level Claude Code session
acts as the controller: it establishes the current repository state, invokes the
right specialists and passes their reports to `wms-chief-of-staff` when a
consolidated work order is needed. No subagent is allowed to silently turn itself
into the decision maker or implementer.

## Company structure

```text
Founder / final decisions
        |
Top-level Claude session (controller)
        |
WMS Chief of Staff
        |
        +-- Product & Commercial
        |     +-- wms-product
        |     +-- wms-market
        |     +-- wms-supply-chain
        |     +-- wms-first-impression
        |
        +-- Engineering & Architecture
        |     +-- wms-architecture
        |     +-- wms-reviewer
        |     +-- wms-security
        |     +-- wms-performance
        |     +-- wms-data-truth
        |     +-- wms-mobile
        |     +-- wms-qa
        |     +-- wms-ops
        |
        +-- Organizational memory
              +-- wms-lessons
```

`wms-lessons` is intentionally outside the review chain. It records a lesson only
after somebody else proved the defect/incident and never changes product code.

## The roles

| Agent | Company role | Question it owns |
|---|---|---|
| `wms-chief-of-staff` | Chief of Staff / portfolio coordinator | What changed, what matters now, who should review it, and what is the ordered work? |
| `wms-product` | Product Lead | Who has the problem, what outcome are we selling, and does this feature belong in WMS now? |
| `wms-market` | Commercial Lead | Will this win/retain a contractor customer, and what is the buyer comparing us against? |
| `wms-supply-chain` | Contracting/WMS domain lead | Would a real site storekeeper and project engineer actually work this way? |
| `wms-first-impression` | Customer experience lead | What does the user/buyer actually see in the first minutes and daily use? |
| `wms-architecture` | Principal Architect | Are boundaries, data authority, edition parity and system contracts coherent? |
| `wms-reviewer` | Senior engineering reviewer | Is this specific change correct and complete before merge/deploy? |
| `wms-security` | Security & authority reviewer | What can a user, script, stale agent or workflow reach that it should not? |
| `wms-data-truth` | Data/BI assurance lead | Do the numbers mean exactly what their labels claim? |
| `wms-performance` | Performance/capacity lead | Will this hold at the measured customer workload and growth path? |
| `wms-mobile` | Mobile/field operations lead | Does Flutter match API/web semantics and survive real site conditions? |
| `wms-qa` | Quality & UAT lead | Do the tests/UAT actually prove the customer behaviour being claimed? |
| `wms-ops` | SRE/release/recovery lead | Is it safe to migrate/deploy/backup/restore the live warehouse? |
| `wms-lessons` | Organizational memory | What did a paid-for failure teach, and where should that knowledge live? |

## Why these are project agents

Generic reviewers were tried. The findings that mattered came from briefs that
know THIS product: edition gating, the collapsed Contracting workflow, mandatory
OUT-movement references, subcontractor ownership, live SQLite recovery history,
quality-hold receiving, project attribution and the difference between a site
store and a distribution centre.

A reviewer that does not know those can inspect the same diff and miss the thing
that strands stock or loses a pilot.

## Dispatch: do not run the whole company on every change

The company is comprehensive; each review should still be narrow. The controller
selects the specialists whose question is raised by the change.

| Change/question | Minimum specialist set |
|---|---|
| Route/middleware/permission | `wms-reviewer` + `wms-security` |
| Workflow/state/allocation/receipt/issue/return | `wms-supply-chain` + `wms-reviewer` + `wms-qa` |
| Tenant profile/module/subscription | `wms-architecture` + `wms-security` + `wms-market` |
| Dashboard/KPI/report/analytics | `wms-data-truth` + `wms-performance` |
| Large query/import/list | `wms-performance` + `wms-qa` |
| Flutter/mobile change | `wms-mobile` + `wms-qa`; add domain/security when the action moves stock |
| Web wording/navigation/first-run | `wms-first-impression` + `wms-product` |
| Feature/roadmap proposal | `wms-product` + `wms-market` + relevant domain/architecture reviewer |
| Migration/deploy/backup/recovery | `wms-ops` + `wms-security` + `wms-qa` |
| Branch declared complete | `wms-reviewer` + specialists for the changed areas |
| Several specialist reports disagree | `wms-chief-of-staff` consolidates; Founder decides material scope conflicts |

Running all agents on a small rename is review theatre. Two precise reviews that
prove a finding are better than fourteen generic reports.

## Operating cadence

### On every material change

1. Deterministic CI/tests run first.
2. Controller maps changed paths/claims to the dispatch table.
3. Relevant specialists review independently and **report only**.
4. `wms-chief-of-staff` consolidates when there are several findings or a priority
   decision is needed.
5. Author/Codex fixes verified findings.
6. Reviewer/QA re-check the corrected candidate.
7. Founder accepts/rejects material product/scope decisions.

### Daily company pulse (read-only)

A daily run should NOT modify product code. It should:

1. capture current `main` SHA, changes/merged PRs since the previous pulse, CI and
   latest known production release evidence;
2. identify which domains changed;
3. run only the affected specialists plus `wms-chief-of-staff`;
4. report new P0/P1 items, stale agent knowledge, code-vs-doc-vs-commercial drift,
   and the next bounded work order;
5. say `NO MATERIAL CHANGE` when that is the truth.

Daily automation exists to catch drift early, not to manufacture a to-do list.

### Weekly company board

Once a week do a broader rotation even if no single PR asked for it:

- Product/Market/Domain: pilot value and scope creep.
- Architecture/Security: edition/API/web/mobile policy parity.
- Data/Performance: customer-facing truth and growth headroom.
- Mobile/QA/UX: field readiness and first-hour journey.
- Ops: backup/recovery/release controls.
- Lessons: only record lessons that were actually paid for.

The weekly board produces one ordered company backlog, not separate departmental
backlogs fighting for priority.

## Calibration: historical traps are regression checks, not current defects

Agent briefs contain failures that happened here. The code moves faster than the
briefs. Before repeating a concrete count, path, latency or statement that
something is broken, re-read current code and test it where possible.

If a historical defect is fixed, report `REGRESSION CHECK PASSED`; do not keep
filing it forever. If the fix changes the nature of the risk, update the agent
brief in a dedicated agent-maintenance PR. `wms-performance` and `wms-mobile`
explicitly follow this rule because both areas have moved quickly.

A stale reviewer is worse than no reviewer because its false confidence/noise
trains the team to ignore the next report.

## Using the agents in Claude Code

Example:

```text
Agent({ subagent_type: "wms-security", prompt: "Review this PR's new module gate and API route. Report only; verify bypasses." })
```

Or ask the top-level Claude session to review a branch; it should use this README
to pick the specialist set rather than calling everybody.

Agents are picked up from `.claude/agents/`. Editing an existing definition is
normally picked up quickly. The first creation of the directory in a session
that started without it may require restarting that Claude Code session.

All review agents use high effort deliberately. A fast skim that returns silence
is dangerous in a warehouse system because silence gets trusted.

## The independence rule

**Reviewers review; they do not edit.** This includes the Chief of Staff, Product
Lead, Architect and QA Lead. They may suggest a bounded fix or test but never
change product code, tests, configuration, merge state or production.

`wms-lessons` is the only writing exception and may write only under
`docs/vault`. It records what others proved; it never fixes what it records.

Implementation remains a separate role/session (for example Codex), so the agent
that certifies a fix is not the agent that authored it.

## What the company does not replace

It does not replace deterministic gates such as repository tests, smoke/load
checks, lint/security checks and CI. Those make objective claims repeatably.
Agents handle semantic/domain/commercial questions those checks cannot decide.

It also does not replace a human using the product on a real device/site. Camera,
gloves, sunlight, poor network, confusing wording and an annoying workflow need
field UAT. An agent can prove code; it cannot claim a storekeeper liked using it.

## The second brain

`docs/vault` is the durable organizational memory for lessons, not a duplicate
status system. `wms-lessons` reads its own rules before writing. Current
production state belongs in the repository's authoritative status/release records;
decisions and incidents belong in their existing authorities. The vault links to
those rather than copying facts that will go stale.
