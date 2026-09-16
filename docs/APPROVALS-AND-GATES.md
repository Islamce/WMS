> **Hosting supersession:** Shared-hosting / Passenger instructions in this document are historical. For the Docker Compose VPS deployment, see [the 2026-09-06 migration](HOSTINGER-VPS-MIGRATION-2026-09-06.md). Preserve the historical record; do not execute retired-host commands.

# Who approves what, and which gate catches what

Written 2026-09-14, after the release that deployed `5bd5549`. Two questions it
answers, because they get confused with each other and the confusion is
expensive:

1. **Which steps need a human to say yes, and is that human answering a
   TECHNICAL question or a STRATEGIC one?** A technical question has a right
   answer that evidence settles; anyone competent reaching the same evidence
   reaches the same answer, so it does not need the owner. A strategic question
   has no right answer — it is a choice about the business, and no amount of
   testing produces it.
2. **Which automated gate covers the step**, so the human is reviewing a
   judgement rather than re-checking something a machine already proved.

The failure this prevents: asking the owner to approve a technical detail he has
no way to evaluate, while a strategic decision slips through inside a commit
because it looked technical.

---

## The table

| # | Step | Human approval | Kind | Why it is that kind |
|---|---|---|---|---|
| 1 | Choose what to build next | **Required** | **Strategic** | Which objection to attack first is a bet on the market. Evidence narrows it; it does not decide it. |
| 2 | Design a change | Not required | Technical | The design follows from the requirement and the code. Where it does not, that is a hidden strategic question and step 1 applies. |
| 3 | Write the code and its tests | Not required | Technical | |
| 4 | Local checks: lint, unit and e2e suites, browser tests | Not required | Technical | Pass/fail is not a matter of opinion. |
| 5 | KAAF: context current, manifests match code | Not required | Technical | |
| 6 | Code review | Not required | Technical | A finding is either reproducible or it is not. |
| 7 | Security review | **Required if it finds anything above low severity** | Technical to diagnose, **strategic to accept** | Whether a residual risk is tolerable is a business call. Whether it exists is not. |
| 8 | Open the pull request | Not required | Technical | |
| 9 | CI on the pull request | Not required | Technical | |
| 10 | **Merge** | **Required** | **Strategic** | Merging is committing the business to the change. |
| 11 | Deployment plan written | Not required | Technical | |
| 12 | **Plan-only run against production** | **Required to dispatch** | Technical | Read-only. It changes nothing, and its output is facts. |
| 13 | **Read the plan output** | **Required** | Technical | Somebody must actually read the row counts and integrity result. |
| 14 | **User-visible change: who is affected** | **Required** | **Strategic** | No test can tell you whether someone at the customer relies on a thing you are removing. This release turned on exactly that question. |
| 15 | **Deploy** | **Required** | **Strategic** | There is no approval prompt in the pipeline. Dispatch is the point of no return. |
| 16 | Post-deploy verification, including looking at the screen | Not required | Technical | |
| 17 | Roll back on failure | Not required | Technical | Automatic. Waiting for a human here costs the outage. |
| 18 | **Restore the database from backup** | **Required** | **Strategic** | Only on data loss, and it discards everything written since the backup. |
| 19 | **Set an industry edition** on a live tenant | **Required** | **Strategic** | It hides screens from people who used them yesterday. |
| 20 | **Set or change a subscription** | **Required** | **Strategic** | It starts a clock that ends in read-only. Commercial, not technical. |
| 21 | **Assign a new authority to a role** | **Required** | **Strategic** | Who is allowed to approve what is an organisational decision. |

**Five of the twenty-one are genuinely the owner's**: what to build (1), merge
(10), who is affected (14), deploy (15), and the commercial acts (18–21). The
rest are technical and should not reach him — if they do, either a gate is
missing or somebody is asking him to rubber-stamp.

### The one that is easy to get wrong

**Step 14 is not a technical check and cannot be automated.** This release
renamed about thirty screens and removed the Arabic and French language pickers.
Every automated gate passed, because nothing was broken: the row counts were
identical, the tests were green, the architecture matched. The only way to know
whether removing the Arabic interface would cost a customer was to ask whether
anybody used it. The answer was no. Had it been yes, everything would still have
passed and a user would have lost something they relied on.

Any release that changes what a user sees needs this step, and the answer comes
from a person, not a pipeline.

---

## KAAF at each step

The architecture context is generated from the `kaaf.module.json` manifests and
gated in `.github/workflows/ci.yml`. Two checks, at step 5 above and again at
step 9 on every pull request:

| Check | Fails when |
|---|---|
| `generate.py --check` | the committed `.ai/` context no longer matches the manifests, or was hand-edited |
| the `.ai/drift.json` error count | the manifests and the code disagree — an undeclared dependency, or an import cycle |

**What to do when it fails, in the two cases that actually happen:**

- *"generated context does not match the manifests"* — you added, moved or
  deleted files. Run `python3 scripts/architecture/generate.py` and commit the
  result. This is expected on most changes and is not a warning about your code.
- *"undeclared dependency" or "dependency cycle"* — the manifests and the code
  disagree, and **the code is usually right**. Read the evidence the finding
  prints before editing anything. The cycle that blocked this repository for six
  weeks was a stale manifest describing a dependency the code had already
  removed, not a design defect.

Run both locally before pushing:

```bash
python3 scripts/architecture/generate.py --check
python3 -c "import json,sys; d=json.load(open('.ai/drift.json')); \
  e=[f for f in d['findings'] if f['severity']=='error']; \
  print(d['counts']); [print(' -', f['summary']) for f in e]; sys.exit(1 if e else 0)"
```

**Why it is gated rather than trusted.** It was not gated until 2026-09-14, and
it had been dead since 2026-08-01: the generator failed on a cycle, the context
was six weeks stale, and it described production as running under Passenger on a
host retired on 2026-09-06 — a description an agent reading it would have acted
on. Nobody knew, because nothing ran it. Generated context that nobody verifies
is worse than none, because it is believed.

---

## Demonstrations

`scripts/create-demo-tenant.js` creates a throwaway demo tenant with starter data
and one account that can open every screen and drive a request from raised to
issued alone. It refuses to touch a database that already exists, and refuses a
production path outright — an all-authorities account with a printed password
must never be creatable on a live system.

The demo account is an administrator deliberately: segregation of duties stops
the approver posting the goods issue, which is correct for a real warehouse and
would block a presenter working alone. Admins are exempt. Use
`--with-second-user` to demonstrate the control working rather than bypassing it
— for a contractor worried about material walking off site, it sells the product.
