# KYNOX WMS Manual CI/CD Pipeline

**Status:** A manually dispatched release workflow is configured. The GitHub plan does not support required reviewer or wait-timer protection rules, so production approval is a documented operator control rather than a platform-enforced gate.

## Purpose

The pipeline validates future WMS changes automatically and permits production release only through an explicit manual workflow dispatch. Merging to `main` **never** deploys production automatically.

> The reduced-control model was explicitly approved because GitHub rejected deployment-environment reviewer and wait-timer rules for this repository plan. Manual intent, exact-main-SHA verification, CI, production backups, migration, Passenger restart, and health checks remain mandatory safeguards.

## Pipeline behavior

| Event                  | Workflow                    | Outcome                                                                                                                                                                                                                      |
| ---------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request           | `CI`                        | Installs dependencies and runs syntax checks, lint, production dependency audit, full regression suite, bounded local load test, and browser smoke suite.                                                                    |
| Push to `main`         | `CI`                        | Re-runs the same validation on the merged main commit. It does **not** deploy.                                                                                                                                               |
| Manual release request | `Manual production release` | Validates the exact entered `main` SHA, reruns CI, checks existing Hostinger credentials, takes and verifies an online SQLite backup, runs reviewed migrations, restarts Passenger, and checks health remotely and publicly. |

## Existing credential convention

The manual release workflow reuses the existing repository-level Hostinger secret names already used by the successful offsite-backup workflow. Secret values remain unavailable to the workflow source and must never be committed or shared in chat.

| Secret                      | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `HOSTINGER_SSH_PRIVATE_KEY` | Dedicated SSH private key for the Hostinger deployment account. |
| `HOSTINGER_KNOWN_HOSTS`     | Pinned Hostinger host keys.                                     |
| `HOSTINGER_HOST`            | SSH host.                                                       |
| `HOSTINGER_USERNAME`        | SSH account name.                                               |
| `HOSTINGER_PORT`            | SSH port.                                                       |

The workflow targets the verified Passenger release symlink and persistent database/backup paths that the existing offsite-backup workflow uses. [1]

## Release procedure

1. Merge a reviewed pull request to `main`.
2. Confirm the `CI` run for the exact `main` commit succeeds.
3. In GitHub Actions, open **Manual production release** and select **Run workflow**.
4. Enter the full 40-character SHA of the current `main` tip.
5. Treat the dispatch itself as the explicit business approval for this reduced-control model.
6. The workflow revalidates the SHA, reruns CI, confirms Hostinger access, runs a production backup and restore/integrity check, updates the active release checkout, runs reviewed migrations, requests Passenger restart, and checks health.
7. Verify login, critical dashboards, and the changed feature before declaring the release complete. [2]

## Deployment safety gates

| Gate                          | Workflow behavior                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Manual intent                 | The workflow has only `workflow_dispatch`; a merge does not deploy.                                                         |
| Fresh release target          | The entered SHA must exactly equal the current `main` SHA at run time.                                                      |
| CI before release             | The same reusable CI validation suite must pass before the deploy job begins.                                               |
| Clean production working tree | The remote deployment stops if tracked files have unexplained changes.                                                      |
| Pinned runtime                | The remote deployment requires Hostinger Node.js `v20.19.4`.                                                                |
| Production configuration      | The remote environment must retain the production flags; auto-seeding remains disabled.                                     |
| Database safety               | The workflow creates an online backup and requires integrity and restore verification before migration.                     |
| Native dependency boundary    | A change to `package.json` or `package-lock.json` blocks release; native-addon handling remains a separate audited process. |
| Health verification           | The workflow checks the service from the host and from the public HTTPS endpoint after Passenger restart.                   |
| Mutual exclusion              | Only one release run can execute at a time.                                                                                 |

## Control limitation

The GitHub plan currently cannot enforce a reviewer approval or a deployment branch policy on the `production` environment. Therefore, the person who dispatches the workflow is responsible for confirming that the current `main` SHA has appropriate business approval. The workflow still rejects any SHA that is not current `main`.

## Explicit exclusions

The workflow never runs seed/reset commands, replaces SQLite database/WAL/SHM files, imports inventory data, or deploys a native `better-sqlite3` replacement. It does not automatically roll back a failed post-restart health check; recovery must follow the documented incident procedure. [2]

## References

[1] [Hostinger Scheduled Backup](./HOSTINGER-SCHEDULED-BACKUP.md)

[2] [WMS Production Runbook](./WMS-PRODUCTION-RUNBOOK.md)

**Author:** Manus AI
