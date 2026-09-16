# KAAF architecture context — governance

This document is what the vendored tooling under `scripts/architecture/` cites when it
refuses something. It was cited from eight places, including the generated
`.ai/ai-context.json` itself, for as long as the tooling has been in this repository,
and it did not exist: the pointer led to a 404 and the reader improvised. Every rule
below is one the tooling already enforces; this file states them in one place so the
citations resolve. It introduces no new rule.

## 1. Scope

`.ai/` is machine-generated context for AI agents and humans: a summary, an index, one
manifest per module, and diagrams. It is derived from `kaaf.module.json` (the
repository-level manifest), the per-module manifests it references, and the code
those manifests point at. It is read first and trusted, which is exactly why it must
never be wrong about what production is.

## 2. Inputs

The only inputs are the manifests and the repository tree at the commit being
generated. Nothing is read from the network, the environment, or the clock.

## 3. Drift

`scanners/drift.py` compares what the manifests declare with what the code contains.
Each disagreement is a finding with a stable type, a severity, evidence and a
recommendation. Errors block CI; warnings and information do not.

## 4. Severity

An **error** is a claim in a manifest that the code contradicts, or code with no owning
manifest where one is required. A **warning** is an undeclared-but-harmless gap. An
**info** finding is advisory.

## 5. Confidence

A module's effective confidence is *computed* from evidence, never taken from its
manifest. Declaration alone is `documented`; declaration corroborated by discovered
code is `verified`; code with no declaration is `derived`. A manifest can never talk
its way up: `confidence` in a manifest is an input to this calculation, never the
output.

## 6. Generated files

Every file under `.ai/` is generated. Each one carries a provenance marker stating
that it is generated, which generator version produced it, and which inputs it came
from (`utils/provenance.py`). Two runs over the same inputs produce byte-identical
output; anything that would vary for unchanged inputs — wall-clock time, a commit SHA,
a publication timestamp — is deliberately absent, and `inputDigest` identifies the
inputs instead. Files under `.ai/` are never hand-edited. A file under `.ai/` that no
module manifest produces is a hand-edit and fails validation.

## 7. Regeneration

`./scripts/architecture/generate.sh` regenerates `.ai/` from the inputs. Adding or
removing **any** tracked file — documentation and tests included — changes the inputs
and therefore the output, so the context is stale until regenerated. The pre-push
hook and CI both refuse a stale context; the fix is always to regenerate and commit,
never to edit the output.

## 8. Verification

CI regenerates `.ai/` and diffs it against the committed copy. A non-empty diff means
the committed context is either stale (inputs changed, nobody regenerated) or
hand-edited (output changed, inputs did not), and either fails the build. This is what
lets the generated context be trusted: it is provably the function of the inputs, not
of whoever last touched it.
