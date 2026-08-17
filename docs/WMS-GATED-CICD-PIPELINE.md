# KYNOX WMS Gated CI/CD Pipeline

**Status:** Repository workflow configured; production activation requires GitHub environment configuration and credentials.

## Purpose

The pipeline enforces automated validation for future WMS changes and allows production deployment only through a **manually dispatched**, **environment-approved** release. It does not deploy automatically on a merge to `main`.

> Production release is deliberately a human decision. The workflow is designed to prevent an unreviewed merge, a stale commit, missing deployment configuration, an invalid production environment, or an unverified backup from silently reaching the live WMS.

## Pipeline behavior

| Event                    | Workflow                   | Outcome                                                                                                                                                       |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request             | `CI`                       | Installs dependencies and runs syntax checks, lint, production dependency audit, full regression suite, bounded local load test, and browser smoke suite.     |
| Push to `main`           | `CI`                       | Re-runs the same validation on the merged main commit. It does **not** deploy.                                                                                |
| Explicit release request | `Gated production release` | Re-validates the exact entered main SHA, waits for GitHub `production` environment approval, then performs controlled Hostinger deployment and health checks. |

## One-time GitHub production environment setup

Create a GitHub Actions environment named **`production`** in `Islamce/WMS`, then configure the following controls before the release workflow is used.

| Setting             | Required configuration                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required reviewers  | Add the named business/operations approver(s) who can authorize a live WMS deployment.                                                                                               |
| Deployment branches | Restrict to the `main` branch.                                                                                                                                                       |
| Secrets             | Add `WMS_SSH_PRIVATE_KEY` and `WMS_SSH_KNOWN_HOSTS`. The SSH key must be limited to the production deployment account; `known_hosts` must contain the pinned Hostinger SSH host key. |
| Variables           | Add `WMS_DEPLOY_HOST`, `WMS_DEPLOY_USER`, `WMS_APP_DIR`, and `WMS_HEALTH_URL`.                                                                                                       |

The expected production values, without including secrets, are documented in the production runbook. The application path should be the existing Hostinger Node.js app root, and the health URL should be the existing HTTPS health endpoint. [1]

## Release procedure

1. Merge a reviewed pull request to `main`.
2. Confirm the `CI` run for that exact `main` commit succeeds.
3. In GitHub Actions, open **Gated production release** and select **Run workflow**.
4. Enter the full 40-character SHA of the current `main` tip.
5. Wait for GitHub `production` environment approval.
6. The workflow validates the SHA against current `main`, verifies non-secret production guardrails, takes and verifies an online SQLite backup, runs migrations, requests Passenger restart, and checks health remotely and publicly.
7. Verify login, critical dashboards, and the changed feature before declaring the release complete. [1]

## Deployment safety gates

| Gate                          | Workflow behavior                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Manual intent                 | The workflow has only `workflow_dispatch`; merging does not trigger deployment.                           |
| Environment approval          | The `production` environment pauses deployment until a configured reviewer approves it.                   |
| Fresh release target          | The entered SHA must exactly equal the current `main` SHA at run time.                                    |
| Clean production working tree | The remote deployment stops if tracked files have unexplained changes.                                    |
| Pinned runtime                | The remote deployment requires Hostinger Node.js `v20.19.4`.                                              |
| Production configuration      | The remote environment must retain the runbook’s production flags; auto-seeding remains disabled.         |
| Database safety               | The release takes an online backup and requires integrity/restore verification before migration.          |
| Health verification           | The workflow checks the service from the host and from the public HTTPS endpoint after Passenger restart. |
| Mutual exclusion              | Only one production release can run at a time.                                                            |

## Explicit limits and follow-up work

The workflow intentionally does **not** execute seed/reset commands, replace database/WAL/SHM files, import inventory data, or deploy a native `better-sqlite3` replacement. Native addon recovery remains a separate controlled procedure because it requires provenance, host ABI validation, and atomic rollback evidence. [1]

The workflow also does not implement automatic rollback. A failed release retains its remote command log in the GitHub Actions run; recovery must follow the documented incident and rollback process. Before enabling the first real release, perform a controlled rehearsal using a non-production target or an approved maintenance window.

## References

[1] [WMS Production Runbook](./WMS-PRODUCTION-RUNBOOK.md)

**Author:** Manus AI
