<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — wms-tests (C4 L3)

`wms-tests` at `tests` — confidence `verified`. 1 declared public entry point(s), 2 dependency(ies), 0 dependent(s).

```mermaid
graph TB
  subgraph wms_tests_box["wms-tests"]
    ep_tests["tests/"]
  end
  wms_api["wms-api<br/>server<br/>verified"]
  wms_tests_box --> wms_api
  wms_ops_scripts["wms-ops-scripts<br/>scripts<br/>verified"]
  wms_tests_box --> wms_ops_scripts
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=2594d41194df0f44443e20dc47622dab1925299ecf64f96524fc3737c32e06f4 -->
