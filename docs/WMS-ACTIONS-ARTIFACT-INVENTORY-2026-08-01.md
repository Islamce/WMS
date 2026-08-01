# GitHub Actions Artifact Retention Inventory — 2026-08-01

## Executive summary

This began as a read-only classification of the 39 active GitHub Actions
artifacts in `Islamce/WMS`. On 2026-08-01, the repository owner explicitly
approved deletion of the exact 35-artifact evidence-supported cleanup pool
recorded below, totaling **2,069,364,217 bytes**. All 35 exact IDs were deleted
individually through the GitHub API; no wildcard or repository-wide deletion
was used. Post-deletion API verification found none of those IDs and confirmed
that only the four approved retention IDs remain active. No workflow was rerun.

Deletion is not recoverable through the GitHub Actions artifact API or UI.
GitHub quota accounting may take 6–12 hours to recalculate.

- Active artifact storage: **2,357,708,525 bytes (2.195787 GiB)**.
- Proposed `RETAIN`: 4 artifacts, **288,344,308 bytes (0.268542 GiB)**.
- Evidence-supported `DELETE` pool: 35 artifacts,
  **2,069,364,217 bytes (1.927246 GiB)**.
- Recommended minimum set, assuming a 500 MiB account ceiling and reserving
  50 MiB for the native artifact: 31 artifacts,
  **1,902,434,380 bytes (1.771780 GiB)**. It leaves 455,274,145 bytes active.
- Optional extended set: 4 artifacts, **166,929,837 bytes (0.155466 GiB)**.

**Execution result:** 35 deleted; 4 retained; active storage after deletion is
**288,344,308 bytes (0.268542 GiB)**. Retained IDs: `8447368682`,
`8447506723`, `8462156227`, and `8576609631`.

**Post-cleanup native build:** Run `30667893534` attempt 3 subsequently passed
and retained artifact `8822465615`, exact SHA-named recovery artifact size
1,092,375 bytes, expiring 2026-08-08T18:38:39Z. The current active total is
five artifacts and 289,436,683 bytes. This artifact is mandatory to retain
pending independent inspection and the governed recovery procedure.

Local independent inspection subsequently passed for the exact four-file set,
binary checksum, provenance manifest, normalized source lockfile checksum,
ELF64 x86-64 identity, GLIBC evidence checksum, and GLIBC 2.28 ceiling. Retain
artifact `8822465615` through the governed recovery; the mandatory staged host
preflight and all production gates remain outstanding.

The account billing endpoint could not confirm the actual quota without adding
the unrelated `user` OAuth scope. Therefore the minimum-set capacity statement
is explicitly conditional on the common 500 MiB ceiling. The deletion
classification itself does not depend on that assumption.

## Evidence and classification method

Sources were the GitHub Actions artifacts and workflow-run APIs, commit-to-PR
API, Git tags and Releases APIs, `.github/workflows/flutter-apk.yml`,
`.github/workflows/mobile-ci.yml`, `docs/ANDROID-UAT-V1.0.md`,
`docs/WMS-V1.0-EXECUTION-PLAN.md`, `docs/OPS-RUNBOOK.md`, and current project
memory.

Important evidence:

- Eight current GitHub Releases contain permanent Release assets with distinct
  release-asset IDs. No Release metadata references any Actions artifact ID.
- The release workflow uploads the same build outputs separately to Actions and
  to GitHub Releases on `main`; old Actions copies are therefore not required to
  keep those Releases downloadable.
- The operational runbook tells operators to install APKs from GitHub Releases,
  not from Actions artifacts. No active artifact is referenced by a database
  backup, restore, or server rollback procedure.
- Physical Android notification UAT is recorded as passed on 2026-07-20, but
  the UAT form's build version, commit, and APK checksum are blank. Artifacts
  `8447368682`, `8447506723`, and `8462156227` are all plausible PR #25/UAT
  inputs and therefore default to `RETAIN`.
- Artifact `8576609631` is the newest verified `main` build and corresponds to
  the latest Release tag `mobile-v1.5.0-8-48`; it is retained as the current
  supported release-channel build.

`MB` below is decimal MB (`bytes / 1,000,000`). All run attempts are `1`.

## Full active-artifact inventory

| ID / exact name | Bytes / MB | Created → expires (UTC) | Workflow / path | Run · attempt · event · branch | Exact source SHA / association | Newer equivalent | Classification / action | Evidence-based rationale |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `8259932943` `wms-mobile-apk` | 49,711,162 / 49.711 | 2026-07-12T12:22:22Z → 2026-10-10T12:13:24Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29192242572` · 1 · push · `claude/warehouse-management-system-t8zidg` | `00c8d098c95675a5ce37edd42b07b98affdbc92d`; merged PR #5; v1.0.0+1 | `8260106922`, then later Releases | superseded / **DELETE** | PR build is followed by merged-main build of the same version and later permanent Releases; no UAT/deployment reference. |
| `8260106922` `wms-mobile-apk` | 49,711,146 / 49.711 | 2026-07-12T12:40:40Z → 2026-10-10T12:33:37Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29192835424` · 1 · push · `main` | `408799b8a3c19f61bb8a7e047fd327efaaf2f84f`; merged PR #5; v1.0.0+1 | v1.1.2 and later Release builds | superseded / **DELETE** | No current Release/tag/UAT reference; later versioned Release assets are permanent. |
| `8271366344` `wms-mobile-apk` | 50,422,114 / 50.422 | 2026-07-13T06:59:38Z → 2026-10-11T06:52:44Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29230267686` · 1 · push · `claude/warehouse-management-system-t8zidg` | `1f4da8a926684cfa0a6d6073146e0084b2b89e43`; merged PR #6; v1.1.0+2 | `8277484762`; later v1.1.2 Release | superseded / **DELETE** | PR build was followed by merged-main same-version build and later release version. |
| `8277484762` `wms-mobile-apk` | 50,422,092 / 50.422 | 2026-07-13T11:27:19Z → 2026-10-11T11:19:37Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29245856377` · 1 · push · `main` | `6eebbf7f6953d4bfbf9273076969653c60546214`; merged PR #6; v1.1.0+2 | v1.1.2 Release build `8315452096` | superseded / **DELETE** | Untagged main build; no UAT/deployment reference; later released version exists. |
| `8302679330` `wms-mobile-apk` | 50,422,133 / 50.422 | 2026-07-14T06:52:24Z → 2026-10-12T06:45:15Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29312315034` · 1 · push · `dependabot/github_actions/actions/setup-java-5` | `9c9e393456373688a2c4b33aa461e2ced8bf057a`; no merged PR/release; v1.1.0+2 | v1.1.2 Release and newer | unreferenced / **DELETE** | Dependency-automation branch build; no Release, merged PR, UAT, deployment, or rollback reference. |
| `8302681979` `wms-mobile-apk` | 50,422,092 / 50.422 | 2026-07-14T06:52:30Z → 2026-10-12T06:45:23Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29312322737` · 1 · push · `dependabot/github_actions/actions/upload-artifact-7` | `ba6cddc960ed581ccfb8c715209f6a0460910e08`; no merged PR/release; v1.1.0+2 | v1.1.2 Release and newer | unreferenced / **DELETE** | Dependency-automation branch build with no operational or release reference. |
| `8302690406` `wms-mobile-apk` | 50,422,115 / 50.422 | 2026-07-14T06:52:52Z → 2026-10-12T06:45:21Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29312320623` · 1 · push · `dependabot/github_actions/actions/checkout-7` | `9fd7f61e38c0d9a8bc41d48d191172bea33d5de9`; no merged PR/release; v1.1.0+2 | v1.1.2 Release and newer | unreferenced / **DELETE** | Dependency-automation branch build with no operational or release reference. |
| `8302745082` `wms-mobile-apk` | 50,422,097 / 50.422 | 2026-07-14T06:55:18Z → 2026-10-12T06:47:43Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29312442336` · 1 · push · `claude/warehouse-management-system-t8zidg` | `e0ad3908dad48afd3400eb82704ceb0b23fe320e`; merged PR #17; v1.1.1+3 | PR/main v1.1.2 builds | superseded / **DELETE** | Intermediate PR build superseded within the same merged workstream. |
| `8302976663` `wms-mobile-apk` | 50,537,197 / 50.537 | 2026-07-14T07:06:19Z → 2026-10-12T06:59:20Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29313060831` · 1 · push · `claude/warehouse-management-system-t8zidg` | `b3004b810dc0142d0a73520c2163d1198d5e1d28`; merged PR #17; v1.1.2+4 | `8303160570`, then Release `8315452096` | superseded / **DELETE** | PR build followed by same-version main and Release builds. |
| `8303160570` `wms-mobile-apk` | 50,537,197 / 50.537 | 2026-07-14T07:15:17Z → 2026-10-12T07:07:43Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29313530409` · 1 · push · `main` | `2f857289e59c2ad97a994889c66f0c19f0fb2601`; merged PR #17; v1.1.2+4 | tagged Release build `8315452096` | superseded / **DELETE** | Same version was rebuilt and published with permanent Release assets. |
| `8315231245` `wms-mobile-apk` | 50,537,213 / 50.537 | 2026-07-14T15:08:07Z → 2026-10-12T15:00:29Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29343391325` · 1 · push · `claude/warehouse-management-system-t8zidg` | `89efca58095255694298286bae11ee7dfaccc207`; merged PR #18; v1.1.2+4 | `8315452096` | superseded / **DELETE** | PR build followed by tagged main Release build. |
| `8315452096` `wms-mobile-apk` | 50,537,196 / 50.537 | 2026-07-14T15:15:17Z → 2026-10-12T15:08:59Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29344051939` · 1 · push · `main` | `5f7198e7a1e1d7bc59bebc6a8762976093b29d1c`; PR #18; Release `mobile-v1.1.2-4-12` | newer Releases through v1.5.0 | superseded / **DELETE** | Release remains protected by four permanent Release assets; Release metadata does not reference this Actions artifact ID. |
| `8315547110` `wms-mobile-apk` | 50,537,168 / 50.537 | 2026-07-14T15:18:25Z → 2026-10-12T15:10:59Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29344200124` · 1 · push · `dependabot/github_actions/actions/upload-artifact-7` | `bd764614c27f2a4d4e03061e6025086fe7bf285f`; no merged PR/release; v1.1.2+4 | tagged main build `8315452096` | unreferenced / **DELETE** | Dependency-automation build; no operational reference and same-version Release exists. |
| `8366816522` `wms-mobile-apk` | 50,713,572 / 50.714 | 2026-07-16T06:26:07Z → 2026-10-14T06:18:15Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29476311448` · 1 · push · `claude/warehouse-management-system-t8zidg` | `649d8d4007c8530ecc13bd2a97f6b39895f45736`; PR #19; v1.2.0+5 | `8367051759`, then `8367247817` | superseded / **DELETE** | Intermediate PR/UAT-feedback build followed by newer PR and tagged-main builds; no active UAT reference. |
| `8367051759` `wms-mobile-apk` | 50,739,637 / 50.740 | 2026-07-16T06:38:57Z → 2026-10-14T06:32:27Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29477009279` · 1 · push · `claude/warehouse-management-system-t8zidg` | `b6bea438ef2f424125a72db944fe5e744eefea33`; PR #19; v1.2.0+5 | tagged main build `8367247817` | superseded / **DELETE** | PR build followed by tagged main Release with permanent assets. |
| `8367247817` `wms-mobile-apk` | 50,739,635 / 50.740 | 2026-07-16T06:49:00Z → 2026-10-14T06:41:21Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29477460197` · 1 · push · `main` | `7034ea34c4a4c15e66d905ba2499a4d0eaed3993`; PR #19; Release `mobile-v1.2.0-5-16` | later permanent Releases | superseded / **DELETE** | Permanent v1.2 Release assets remain; artifact ID is not referenced by Release or operations. |
| `8367301291` `wms-mobile-apk` | 50,739,599 / 50.740 | 2026-07-16T06:51:32Z → 2026-10-14T06:44:14Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29477606748` · 1 · push · `dependabot/npm_and_yarn/dev-dependencies-92b5af297b` | `5a15d16d797adebb5329ab828b655e2cf16c7c58`; no merged PR/release; v1.2.0+5 | tagged main build `8367247817` | unreferenced / **DELETE** | Dependency-automation build; permanent same-version Release assets exist. |
| `8385095572` `wms-mobile-apk` | 70,403,904 / 70.404 | 2026-07-16T17:59:33Z → 2026-10-14T17:49:30Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29521365095` · 1 · push · `claude/warehouse-management-system-t8zidg` | `0f84da99cb7bb87fca5ed8641b3092bd50dc178d`; PR #20; v1.3.0+6 | tagged main build `8385520391` | superseded / **DELETE** | PR build followed by tagged main Release with permanent assets. |
| `8385520391` `wms-mobile-apk` | 70,403,911 / 70.404 | 2026-07-16T18:15:06Z → 2026-10-14T18:03:58Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29522393789` · 1 · push · `main` | `b56e642bf027e7c8e58c271e104f54479983f3c3`; PR #20; Release `mobile-v1.3.0-6-20` | later permanent Releases | superseded / **DELETE** | Permanent v1.3 Release assets remain; no Actions-ID reference. |
| `8392668082` `wms-mobile-apk` | 71,020,607 / 71.021 | 2026-07-16T23:24:47Z → 2026-10-14T23:14:53Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29541708244` · 1 · push · `claude/warehouse-management-system-t8zidg` | `d519e20f7fd775b89406219d2a616bc648676496`; PR #21; v1.4.0+7 | tagged main v1.4 builds | superseded / **DELETE** | PR build followed by multiple tagged main Release builds. |
| `8408841390` `wms-mobile-apk` | 71,020,605 / 71.021 | 2026-07-17T13:51:42Z → 2026-10-15T13:41:14Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29584920537` · 1 · push · `main` | `9d10b4a06cbbc1bef84de7ebb29ae4031e9da0d8`; PR #21; Release `mobile-v1.4.0-7-22` | later v1.4 Releases `8430370723`, `8430620397` | superseded / **DELETE** | Permanent Release assets exist and later same-version releases supersede this Actions copy. |
| `8408919260` `wms-mobile-apk` | 71,020,620 / 71.021 | 2026-07-17T13:54:30Z → 2026-10-15T13:43:56Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29585097086` · 1 · push · `dependabot/npm_and_yarn/dev-dependencies-92b5af297b` | `963cf2a68bbb0ceadf62497f70317057342ff41c`; no merged PR/release; v1.4.0+7 | tagged main v1.4 builds | unreferenced / **DELETE** | Dependency-automation artifact; no operational reference. |
| `8429805798` `wms-mobile-apk` | 71,020,599 / 71.021 | 2026-07-18T12:53:02Z → 2026-10-16T12:42:04Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29644801818` · 1 · push · `claude/warehouse-management-system-t8zidg` | `2fa8db30fc34964fa62543b8f8fe6f5359955f39`; PR #23; v1.4.0+7 | tagged main builds `8430370723`, `8430620397` | superseded / **DELETE** | PR build followed by tagged same-version main Releases. |
| `8430370723` `wms-mobile-apk` | 71,020,642 / 71.021 | 2026-07-18T13:58:43Z → 2026-10-16T13:48:29Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29646828124` · 1 · workflow_dispatch · `main` | `9d10b4a06cbbc1bef84de7ebb29ae4031e9da0d8`; PR #21; Release `mobile-v1.4.0-7-25` | later v1.4 Release `8430620397` | superseded / **DELETE** | Permanent Release assets exist; later same-version tagged build supersedes this workflow artifact. |
| `8430620397` `wms-mobile-apk` | 71,021,281 / 71.021 | 2026-07-18T14:26:51Z → 2026-10-16T14:15:36Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29647698311` · 1 · push · `main` | `bb35bef2490819cd863d019bfbe622e3b651ff78`; PR #23; Release `mobile-v1.4.0-7-26` | v1.5 Releases | superseded / **DELETE** | Permanent v1.4 Release assets remain; current channel is v1.5. |
| `8447368682` `wms-mobile-apk` | 71,937,887 / 71.938 | 2026-07-19T21:20:47Z → 2026-10-17T21:09:34Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29703852715` · 1 · push · `claude/warehouse-management-system-t8zidg` | `1644899c2f3ac9be940f155b7ac3984a7b282b8c`; PR #25; v1.5.0+8 | later PR/main builds exist | active UAT / **RETAIN** | Plausible input to the 2026-07-20 physical-device UAT; the UAT record omitted commit/checksum, so purpose cannot be conclusively excluded. |
| `8447506723` `wms-mobile-apk` | 71,937,842 / 71.938 | 2026-07-19T21:36:05Z → 2026-10-17T21:28:27Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29704416880` · 1 · push · `claude/warehouse-management-system-t8zidg` | `2b1e93864071d70b033e7c1077c76e4381b9dd62`; PR #25; v1.5.0+8 | `8462156227`, later latest build | active UAT / **RETAIN** | Newest pre-merge PR #25 build and plausible physical-device UAT input; incomplete UAT provenance forces retention. |
| `8462156227` `wms-mobile-apk` | 71,938,297 / 71.938 | 2026-07-20T13:14:34Z → 2026-10-18T13:04:01Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29744659899` · 1 · push · `main` | `4602dad028c5051840c4bc49ade5722e6f5bbcae`; PR #25; Release `mobile-v1.5.0-8-30`; UAT sign-off date | latest build `8576609631` | active UAT / **RETAIN** | Same date as recorded UAT sign-off and a current Release; exact tested checksum/commit is absent, so retain. |
| `8462280250` `wms-mobile-apk` | 71,937,127 / 71.937 | 2026-07-20T13:18:42Z → 2026-10-18T13:07:08Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29744872169` · 1 · push · `dependabot/npm_and_yarn/dev-dependencies-92b5af297b` | `3bc991c2b00a5a8c08f8afcaedc3a7c3e617ff5b`; no merged PR/release; v1.5.0+8 | tagged main build `8462156227`, latest `8576609631` | unreferenced / **DELETE** | Dependency-automation build created after the tagged main build; no UAT/deployment/release association. |
| `8483952944` `wms-mobile-apk` | 71,937,155 / 71.937 | 2026-07-21T04:35:43Z → 2026-10-19T04:24:07Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29801146367` · 1 · push · `dependabot/github_actions/softprops/action-gh-release-3` | `3bf1f2af427acf8ff760a1b330782833c4502e70`; no merged PR/release; v1.5.0+8 | latest main build `8576609631` | unreferenced / **DELETE** | Dependency-automation build; not a Release despite branch name and no operational reference. |
| `8483956323` `wms-mobile-apk` | 71,937,129 / 71.937 | 2026-07-21T04:35:56Z → 2026-10-19T04:25:00Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `29801185495` · 1 · push · `dependabot/npm_and_yarn/production-dependencies-d6ce146427` | `dacca520124579eafd14617263fcf49374f46b77`; no merged PR/release; v1.5.0+8 | latest main build `8576609631` | unreferenced / **DELETE** | Dependency-automation build; no Release/UAT/deployment reference. |
| `8565398832` `wms-mobile-apk` | 71,974,268 / 71.974 | 2026-07-23T13:35:54Z → 2026-10-21T13:25:28Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `30011134619` · 1 · push · `feat/workflow-concurrency-recovery` | `2ec962633e12253fd774d33593420643e9945b66`; PR #33; v1.5.0+8 | later PR #33/main builds | superseded / **DELETE** | Intermediate merged-PR build; later verified builds and latest Release exist. |
| `8565563175` `wms-mobile-apk` | 71,974,298 / 71.974 | 2026-07-23T13:40:59Z → 2026-10-21T13:29:49Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `30011449464` · 1 · push · `feat/workflow-concurrency-recovery` | `117887af2126c6d0b028eccb84ef966`; PR #33; v1.5.0+8 | later PR #33/main builds | superseded / **DELETE** | Intermediate PR #33 build; no separate UAT/deployment reference. |
| `8575639198` `wms-mobile-apk` | 72,530,629 / 72.531 | 2026-07-23T19:12:01Z → 2026-10-21T19:00:33Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `30036180592` · 1 · push · `feat/workflow-concurrency-recovery` | `0970c664dc6034ba789bcf71cfc11023a5f330ac`; PR #33; v1.5.0+8 | `8576134282`, `8576140025`, `8576609631` | superseded / **DELETE** | PR build superseded before merge and by latest main Release. |
| `8575648606` `wms-mobile-apk-5035d795232e2db750bd6ddd911c4ff32468b13e` | 33,753,852 / 33.754 | 2026-07-23T19:12:21Z → 2026-08-06T19:12:17Z | Mobile CI · `.github/workflows/mobile-ci.yml` | `30036207831` · 1 · pull_request · `feat/workflow-concurrency-recovery` | checked-out PR merge `5035d795232e2db750bd6ddd911c4ff32468b13e`; head `70b6fc54ddad6732f27e23aadc1811b9297849d`; PR #33; v1.5.0+8 | later PR/main APKs, especially `8576609631` | superseded / **DELETE** | SHA-specific PR validation artifact; PR merged, main Release build passed, and no UAT/deployment reference exists. |
| `8576134282` `wms-mobile-apk` | 72,530,252 / 72.530 | 2026-07-23T19:30:21Z → 2026-10-21T19:18:43Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `30037436495` · 1 · push · `feat/workflow-concurrency-recovery` | `a617dd72030759ab420183fe1a02a86462b05316`; PR #33; v1.5.0+8 | latest main `8576609631` | superseded / **DELETE** | PR build superseded by merged main Release. |
| `8576140025` `wms-mobile-apk` | 72,530,296 / 72.530 | 2026-07-23T19:30:34Z → 2026-10-21T19:18:32Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `30037423597` · 1 · push · `feat/workflow-concurrency-recovery` | `9851b1f8712f28a6acffe6974e6674774d616eb1`; PR #33; v1.5.0+8 | latest main `8576609631` | superseded / **DELETE** | PR build superseded by merged main Release. |
| `8576147263` `wms-mobile-apk-e1441c8ad8cf5d0fd2346ae8d9d35c637ce76555` | 33,753,677 / 33.754 | 2026-07-23T19:30:50Z → 2026-08-06T19:30:45Z | Mobile CI · `.github/workflows/mobile-ci.yml` | `30037439123` · 1 · pull_request · `feat/workflow-concurrency-recovery` | checked-out PR merge `e1441c8ad8cf5d0fd2346ae8d9d35c637ce76555`; head `a617dd72030759ab420183fe1a02a86462b05316`; PR #33; v1.5.0+8 | latest main `8576609631` | superseded / **DELETE** | SHA-specific PR validation artifact; PR merged and current Release supersedes it. |
| `8576609631` `wms-mobile-apk` | 72,530,282 / 72.530 | 2026-07-23T19:48:07Z → 2026-10-21T19:36:29Z | Build WMS Mobile APK · `.github/workflows/flutter-apk.yml` | `30038658923` · 1 · push · `main` | `9867b808f61abebfcb614075cf08f1cd899555f6`; PR #33; latest Release `mobile-v1.5.0-8-48` | none | latest verified build / **RETAIN** | Newest verified artifact for the current release channel and exact source of the latest permanent GitHub Release. |

## Exact proposed deletion list

The evidence-supported deletion pool is every active artifact except
`8447368682`, `8447506723`, `8462156227`, and `8576609631`.

### Recommended minimum set

Assumption: 500 MiB quota, with a 50 MiB reservation for native artifact upload.
This set reclaims **1,902,434,380 bytes (1.771780 GiB)** and leaves
**455,274,145 bytes** active.

| Artifact ID | Name | Bytes | Run ID |
| ---: | --- | ---: | ---: |
| 8271366344 | wms-mobile-apk | 50,422,114 | 29230267686 |
| 8277484762 | wms-mobile-apk | 50,422,092 | 29245856377 |
| 8302679330 | wms-mobile-apk | 50,422,133 | 29312315034 |
| 8302681979 | wms-mobile-apk | 50,422,092 | 29312322737 |
| 8302690406 | wms-mobile-apk | 50,422,115 | 29312320623 |
| 8302745082 | wms-mobile-apk | 50,422,097 | 29312442336 |
| 8302976663 | wms-mobile-apk | 50,537,197 | 29313060831 |
| 8303160570 | wms-mobile-apk | 50,537,197 | 29313530409 |
| 8315231245 | wms-mobile-apk | 50,537,213 | 29343391325 |
| 8315452096 | wms-mobile-apk | 50,537,196 | 29344051939 |
| 8315547110 | wms-mobile-apk | 50,537,168 | 29344200124 |
| 8366816522 | wms-mobile-apk | 50,713,572 | 29476311448 |
| 8367051759 | wms-mobile-apk | 50,739,637 | 29477009279 |
| 8367247817 | wms-mobile-apk | 50,739,635 | 29477460197 |
| 8367301291 | wms-mobile-apk | 50,739,599 | 29477606748 |
| 8385095572 | wms-mobile-apk | 70,403,904 | 29521365095 |
| 8385520391 | wms-mobile-apk | 70,403,911 | 29522393789 |
| 8392668082 | wms-mobile-apk | 71,020,607 | 29541708244 |
| 8408841390 | wms-mobile-apk | 71,020,605 | 29584920537 |
| 8408919260 | wms-mobile-apk | 71,020,620 | 29585097086 |
| 8429805798 | wms-mobile-apk | 71,020,599 | 29644801818 |
| 8430370723 | wms-mobile-apk | 71,020,642 | 29646828124 |
| 8430620397 | wms-mobile-apk | 71,021,281 | 29647698311 |
| 8462280250 | wms-mobile-apk | 71,937,127 | 29744872169 |
| 8483952944 | wms-mobile-apk | 71,937,155 | 29801146367 |
| 8483956323 | wms-mobile-apk | 71,937,129 | 29801185495 |
| 8565398832 | wms-mobile-apk | 71,974,268 | 30011134619 |
| 8565563175 | wms-mobile-apk | 71,974,298 | 30011449464 |
| 8575639198 | wms-mobile-apk | 72,530,629 | 30036180592 |
| 8576134282 | wms-mobile-apk | 72,530,252 | 30037436495 |
| 8576140025 | wms-mobile-apk | 72,530,296 | 30037423597 |

### Optional extended-cleanup set

After the minimum set, these four additional demonstrably superseded artifacts
reclaim **166,929,837 bytes (0.155466 GiB)**:

| Artifact ID | Name | Bytes | Run ID |
| ---: | --- | ---: | ---: |
| 8259932943 | wms-mobile-apk | 49,711,162 | 29192242572 |
| 8260106922 | wms-mobile-apk | 49,711,146 | 29192835424 |
| 8575648606 | wms-mobile-apk-5035d795232e2db750bd6ddd911c4ff32468b13e | 33,753,852 | 30036207831 |
| 8576147263 | wms-mobile-apk-e1441c8ad8cf5d0fd2346ae8d9d35c637ce76555 | 33,753,677 | 30037439123 |

## Exact retention list

| Artifact ID | Bytes | Classification | Rationale |
| ---: | ---: | --- | --- |
| 8447368682 | 71,937,887 | active UAT | Possible PR #25 physical-device UAT build; UAT commit/checksum not recorded. |
| 8447506723 | 71,937,842 | active UAT | Newest pre-merge PR #25 build; cannot exclude it as the signed-off device build. |
| 8462156227 | 71,938,297 | active UAT | Main build and Release created on the recorded UAT sign-off date. |
| 8576609631 | 72,530,282 | latest verified build | Newest main artifact and source of latest Release `mobile-v1.5.0-8-48`. |

## Artifacts that cannot be conclusively classified as deletable

The four retention rows above are the only active artifacts whose deletion
safety is not conclusively established. They remain `RETAIN`. No active Actions
artifact is classified as `mandatory release` or `rollback/restore`, because
current Releases and operational procedures reference permanent Release assets,
not Actions artifact IDs.

## Retention-policy recommendation

1. Set `retention-days: 7` for generic branch/PR APK workflow artifacts and
   `retention-days: 14` for the newest main artifact.
2. Keep permanent supported binaries as GitHub Release assets; do not also keep
   90-day generic Actions copies.
3. Add concurrency cancellation for repeated branch APK builds.
4. Include version, source SHA, event, and run ID in every artifact name.
5. Record the exact artifact ID, commit, APK checksum, and Release tag in every
   device-UAT sign-off. Until that exists, UAT artifacts cannot be cleaned
   conservatively.
6. Add a scheduled read-only storage report and an approval-gated cleanup
   process; never perform wildcard, age-only, workflow-wide, or repository-wide
   deletion.
