<!-- KAAF-GENERATED — do not edit by hand. Regenerate with scripts/architecture/generate.sh. -->

# Containers (C4 L2)

Every module and the dependencies between them. 7 module(s).

```mermaid
graph LR
  wms_api["wms-api<br/>server<br/>verified"]
  wms_kaaf_tooling["wms-kaaf-tooling<br/>scripts/architecture<br/>verified"]
  wms_mobile["wms-mobile<br/>wms flutter application<br/>verified"]
  wms_ops_scripts["wms-ops-scripts<br/>scripts<br/>verified"]
  wms_runtime_entry["wms-runtime-entry<br/>.<br/>verified"]
  wms_tests["wms-tests<br/>tests<br/>verified"]
  wms_web["wms-web<br/>public<br/>verified"]
  wms_ops_scripts --> wms_api
  wms_runtime_entry --> wms_api
  wms_tests --> wms_api
  wms_tests --> wms_ops_scripts
  style wms_api stroke-width:2px
  style wms_kaaf_tooling stroke-width:2px
  style wms_mobile stroke-width:2px
  style wms_ops_scripts stroke-width:2px
  style wms_runtime_entry stroke-width:2px
  style wms_tests stroke-width:2px
  style wms_web stroke-width:2px
```

**Reading this diagram**

- Solid arrow: a dependency declared in a `kaaf.module.json` manifest.
- Dotted arrow: a real import discovered in the source that no manifest declares — see `.ai/drift.json`.
- Node outline reflects confidence: solid = `verified`, dashed = `documented` or `derived`.
<!-- kaaf:bodyDigest=d5b81ec63c5fde89dcdb5686fde332619496f807af75a200bf451149ae16cfe4 -->
