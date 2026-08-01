<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Generated diagrams

Generated from the same facts as `../architecture.json`. There is no separate
diagram source to keep in step — a module boundary change appears here in the
same commit that makes it.

| Diagram | Level |
|---|---|
| [component-wms-api.md](component-wms-api.md) | Component (L3) |
| [component-wms-kaaf-tooling.md](component-wms-kaaf-tooling.md) | Component (L3) |
| [component-wms-mobile.md](component-wms-mobile.md) | Component (L3) |
| [component-wms-ops-scripts.md](component-wms-ops-scripts.md) | Component (L3) |
| [component-wms-runtime-entry.md](component-wms-runtime-entry.md) | Component (L3) |
| [component-wms-tests.md](component-wms-tests.md) | Component (L3) |
| [component-wms-web.md](component-wms-web.md) | Component (L3) |
| [container.md](container.md) | Container (L2) |
| [context.md](context.md) | Context (L1) |

Diagrams are split above 20 nodes rather than shrunk
(docs/kaaf/STANDARDS.md §5). Code-level (L4) diagrams are generated on demand and
never committed.

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=0f2e484258096ae59d5660221cc06862521ba7af46226db0915ba2fe532ac08d -->
