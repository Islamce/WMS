<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Component — wms-ops-scripts (C4 L3)

`wms-ops-scripts` at `scripts` — confidence `verified`. 1 declared public entry point(s), 1 dependency(ies), 1 dependent(s).

```mermaid
graph TB
  subgraph wms_ops_scripts_box["wms-ops-scripts"]
    ep_scripts["scripts/"]
  end
  wms_api["wms-api<br/>server<br/>verified"]
  wms_ops_scripts_box --> wms_api
  wms_tests["wms-tests<br/>tests<br/>verified"]
  wms_tests --> wms_ops_scripts_box
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=9486605d8ad564d2bf495d004174e5062eba53b90cbb731c0de0be9e98147953 -->
