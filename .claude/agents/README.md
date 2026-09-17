# KYNOX WMS agent company

These project agents are the operating staff for this repository. Their value is
the project-specific knowledge in their briefs: incidents, escaped defects,
workflow invariants, commercial boundaries and field realities learned while
building this WMS.

## Governance first

**KAAF is the architecture authority.** No reasoning agent is allowed to bypass a
failed KAAF freshness/drift gate, deterministic CI failure, production safety
rule or Founder decision gate.

The **Founder remains the final decision authority for material product/scope
choices**. The runtime coordinates work; a model/provider does not become an
approver merely because it generated a review.

## Runtime independence

The files in `.claude/agents/` remain Claude Code compatible, but **Claude Code is
an adapter, not the company controller**. The canonical runtime contract is
`.agent-company/registry.json` and the controller is `agent-company-runtime`.
The same specialist brief can be executed by any configured reasoning provider.

Current provider order is defined in the registry and is intentionally
replaceable. A provider outage, token/quota limit or missing credential must not
stop deterministic company work. The reasoning runtime checkpoints completed and
pending agents and continues with another available provider. If no reasoning
provider is available, deterministic checks finish and semantic work remains
queued for resume.

Never commit provider API keys. Providers read credentials from environment/
secret stores only.

## Company structure

```text
Founder / final decisions
        |
Agent Company Runtime
        |
WMS Chief of Staff
        |
        +-- Product & Commercial
        |     +-- wms-product
        |     +-- wms-market
        |     +-- wms-customer-success
        |     +-- wms-first-impression
        |
        +-- Domain
        |     +-- wms-supply-chain
        |
        +-- Engineering, Data & Risk
        |     +-- wms-architecture
        |     +-- wms-reviewer
        |     +-- wms-security
        |     +-- wms-data-truth
        |     +-- wms-data-integration
        |     +-- wms-performance
        |     +-- wms-mobile
        |     +-- wms-qa
        |     +-- wms-ops
        |
        +-- Organizational memory
              +-- wms-lessons
```

`wms-lessons` is intentionally outside the review chain. It records a lesson only
after evidence proves the defect/incident and may write only under `docs/vault`.

## Roles

| Agent | Company role | Question it owns |
|---|---|---|
| `wms-chief-of-staff` | Chief of Staff | What changed, what matters now, and what is the ordered work? |
| `wms-product` | Product Lead | Who has the problem, what outcome are we selling, and does it belong in WMS? |
| `wms-market` | Commercial Lead | Will this win/retain the target contractor customer? |
| `wms-customer-success` | Customer Success / Pilot Lead | Can a customer onboard, adopt and prove value without the builder present? |
| `wms-supply-chain` | Contracting/WMS Domain Lead | Would a real site storekeeper and project engineer actually work this way? |
| `wms-first-impression` | Customer Experience Lead | What does the user/buyer see in first minutes and daily use? |
| `wms-architecture` | Principal Architect | Are boundaries, data authority and web/API/mobile/edition contracts coherent? |
| `wms-reviewer` | Senior Engineering Reviewer | Is this specific change correct and complete before merge/deploy? |
| `wms-security` | Security & Authority Reviewer | What can a user, script, stale agent or workflow reach that it should not? |
| `wms-data-truth` | Data/BI Assurance Lead | Do customer-facing numbers mean exactly what their labels claim? |
| `wms-data-integration` | Data & Integration Lead | Are imports, mappings, APIs, UOMs and source-system boundaries safe/replayable? |
| `wms-performance` | Performance/Capacity Lead | Will this hold at measured workload and growth path? |
| `wms-mobile` | Mobile/Field Operations Lead | Does Flutter match API/web semantics and survive site conditions? |
| `wms-qa` | Quality & UAT Lead | Does the evidence actually prove the claimed customer behaviour? |
| `wms-ops` | SRE/Release/Recovery Lead | Is it safe to migrate/deploy/backup/restore the live warehouse? |
| `wms-lessons` | Organizational Memory | What did a paid-for failure teach and where should that knowledge live? |

## Two operating tracks

### Track A — deterministic company (no LLM)

`scripts/agent-company/run-deterministic.js` is the non-LLM operating layer. It
validates the agent registry, enforces KAAF freshness/drift, scans tracked text
for high-confidence secret patterns, runs objective quality gates, checks known
policy regressions and produces Markdown/JSON reports.

Deterministic facts outrank model opinion. A reasoning agent cannot turn a failed
KAAF/test/security gate into a pass.

### Track B — reasoning company (provider independent)

`scripts/agent-company/run-reasoning.js` loads these same specialist briefs and
runs them through configured providers. It writes a checkpoint after each agent.
Provider limits/errors trigger fallback to the next provider; unfinished agents
stay pending and resume later rather than restarting completed work.

Reasoning agents report. They do not mutate production or silently become code
authors. Implementation remains a separate role/session/process.

## Dispatch: do not run the whole company on every change

| Change/question | Minimum specialist set |
|---|---|
| Route/middleware/permission | `wms-reviewer` + `wms-security` |
| Workflow/state/allocation/receipt/issue/return | `wms-supply-chain` + `wms-reviewer` + `wms-qa` |
| Tenant profile/module/subscription | `wms-architecture` + `wms-security` + `wms-market` |
| Dashboard/KPI/report/analytics | `wms-data-truth` + `wms-performance` |
| Import/mapping/API/ERP sync/UOM | `wms-data-integration` + `wms-data-truth`; add architecture/security when authority changes |
| Large query/import/list | `wms-performance` + `wms-qa` |
| Flutter/mobile change | `wms-mobile` + `wms-qa`; add domain/security when stock/authority moves |
| Web wording/navigation/first-run | `wms-first-impression` + `wms-product` |
| Pilot/onboarding/customer feedback | `wms-customer-success` + `wms-product` + relevant specialist |
| Feature/roadmap proposal | `wms-product` + `wms-market` + relevant domain/architecture reviewer |
| Migration/deploy/backup/recovery | `wms-ops` + `wms-security` + `wms-qa` |
| Branch declared complete | `wms-reviewer` + specialists for changed areas |
| Several specialist reports disagree | `wms-chief-of-staff` consolidates; Founder decides material scope conflicts |

Running all agents on a small rename is review theatre. Precise evidence-backed
reviews are better than a large pile of generic reports.

## Operating cadence

### On every material change

1. KAAF/deterministic gates run first.
2. Runtime maps changed paths/claims to the dispatch table.
3. Relevant specialists review independently and report only.
4. `wms-chief-of-staff` consolidates conflicts/priorities.
5. Separate implementation role fixes verified findings.
6. Reviewer/QA re-check the candidate.
7. Founder accepts/rejects material product/scope decisions.

### Daily company pulse

The daily run is read-only with respect to product/production data. It captures
current SHA, relevant PR/CI/release evidence, KAAF status, deterministic findings,
changed domains and queued reasoning work. It reports `NO MATERIAL CHANGE` when
that is true.

### Weekly board

Rotate deeper checks across product/market/domain, architecture/security,
data/performance/integration, mobile/QA/UX, ops/recovery and agent calibration.
The board produces one ordered backlog, not independent departmental wish lists.

## Calibration rule

Historical traps are regression checks, not permanent defects. Re-read current
code/test evidence before repeating any concrete count, path, latency or failure.
If a historical issue is fixed, report `REGRESSION CHECK PASSED` and calibrate the
brief in a dedicated maintenance change.

## Independence rule

Reviewers review; they do not edit product code. `wms-lessons` is the only
writing exception and may write only under `docs/vault`. Production mutation by
agents is forbidden by the registry.

## What the company does not replace

It does not replace KAAF, deterministic tests, real-device UAT, customer pilots or
human scope decisions. Camera behaviour, gloves, sunlight, poor network and
customer adoption require field evidence. A model cannot certify them from prose.
