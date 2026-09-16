# Architecture tooling standards

This file documents the existing behavior of `scripts/architecture/`. It adds no
new policy. Section numbers preserve the tooling's existing citations.

## 1. Manifests and module boundaries

Module manifests declare entry points and dependencies. Discovery measures the
public surface at those entry points, rather than counting every internal file.
The validators report mismatches between declared dependencies and discovered
imports. Dependency cycles are errors. More than ten public symbols is an
advisory signal to consider splitting a module, not an automatic requirement.

## 4. Offline tooling

The Python architecture tooling uses the standard library. Repository-index
schema validation is implemented locally so generation and validation can run
without fetching a schema service or a third-party validation package.

## 5. Diagrams

Generated Mermaid diagrams provide system context, container/module relationships,
and module component views. Code-level diagrams are generated on demand and are
not committed. The renderer helpers cap diagrams at about twenty nodes, splitting
large graphs or eliding entry points with a pointer to the complete module data.
They do not reduce the font to fit an unreadable graph.

## 8. Determinism and context size

For unchanged inputs, generation produces identical bytes. JSON uses sorted keys,
two-space indentation, UTF-8, and one trailing newline. Paths are repository-relative
with forward slashes; traversal and diagram entries are sorted. Machine paths and
filesystem enumeration order must not affect the generated context.

The summary targets fewer than about two thousand words. It provides orientation;
module details remain in the JSON artifacts and should be loaded only as needed.
See [governance](GOVERNANCE.md) for regeneration and verification requirements.
