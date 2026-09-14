# Vendored from Islamce/KAAF

This directory is a copy of the KAAF architecture tooling. **Do not edit it here.**

| | |
|---|---|
| Source | `Islamce/KAAF` — `scripts/architecture/` |
| Generator version | `0.7.0` |
| Vendored at commit | `d28018f72c6e71ef7930f1f7bdbc0f40906bde29` |
| Runtime | Python 3.11+, standard library only — no dependencies to install |

## Why vendored rather than installed

KAAF ships no package. Copying keeps this repository buildable with nothing but Python,
which is what makes the CI gates cheap enough to run on every pull request.

## The gates, and why they exist

`.github/workflows/ci.yml` runs two checks on every pull request:

| Check | Fails when |
|---|---|
| `generate.py --check` | the committed `.ai/` context no longer matches the manifests, or was hand-edited |
| a read of `.ai/drift.json` | the manifests and the code disagree — an undeclared dependency, or an import cycle |

They were added on 2026-09-14, after this file had described them for weeks
without either existing. Nothing ran the tooling, so nobody noticed that the
generator had been failing on a dependency cycle since early August, that the
context was six weeks stale, or that it still described production as running
under Passenger on a host retired on 2026-09-06 — a description an agent reading
it would have acted on.

That is the argument for the gates rather than for the tooling: generated
context nobody verifies is worse than none, because it is believed.

## What was deliberately left out

- `tests/` and `run-tests.sh` — they test the tooling itself, which is verified in KAAF's
  own CI. This repository consumes the tooling; it does not develop it.
- `validators/validate-structure.sh` — it asserts the layout of the KAAF repository
  itself (its governance documents, execution prompts and agent files) and does not apply
  to an adopting repository.

## Fixing a defect

Fix it in `Islamce/KAAF`, let its CI verify it, then re-vendor here and update this file.
A local patch will be silently overwritten by the next re-vendor and makes this copy
diverge from every other adopter's.

## Re-vendoring

```bash
# from a KAAF checkout, into this repository
for d in scanners generators utils validators; do
  mkdir -p scripts/architecture/$d
  cp <kaaf>/scripts/architecture/$d/*.py scripts/architecture/$d/
done
cp <kaaf>/scripts/architecture/{generate.py,generate.sh,aggregate.py,compat.py} scripts/architecture/
rm -f scripts/architecture/validators/validate-structure.sh
./scripts/architecture/generate.sh
```
