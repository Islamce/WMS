# KYNOX WMS V2 — Reality Gates

This document is the mandatory checkpoint for every V2 workstream. It exists to prevent speculative features, uncontrolled scope, and AI-generated changes that are not supported by the current product or operating environment.

## 1. Evidence before implementation

A feature may enter development only when all of the following are identified:

- Existing user or operational problem.
- Current screen, API, database table, or workflow that supplies the required data.
- User role and permission affected.
- Acceptance criteria that can be tested.
- Rollback path.

If any item is unknown, the feature remains discovery work and must not be presented as delivered.

## 2. Reuse before expansion

Use existing routes, APIs, permissions, and data models before adding new backend services. A new endpoint or table requires a documented gap that cannot be solved safely with the current architecture.

## 3. Production constraints

Every change must respect the deployed environment:

- Hostinger-managed Node application.
- SQLite production database and WAL operation.
- Existing Node/runtime compatibility.
- Mobile application compatibility.
- Current backup, notification, and deployment workflows.

Major framework or native dependency upgrades must be isolated in dedicated pull requests and tested separately.

## 4. Delivery gates

Each pull request must pass:

1. Repository and branch verification.
2. Small, reversible scope.
3. CI and security checks.
4. Permission and role validation.
5. Desktop and mobile validation when UI is affected.
6. Arabic/RTL validation when labels or layout are affected.
7. Production impact and rollback notes.
8. Owner UAT for operational behavior changes.

## 5. AI and analytics rule

No output may be labelled AI unless it uses a defined model or deterministic analytical method with traceable inputs and an explainable result. Rule-based calculations must be described as analytics or recommendations, not generative AI.

## 6. Roadmap control

The roadmap is reviewed before every phase. Items may be reduced, reordered, or removed when repository evidence, deployment constraints, or operational value do not support them.

## Current execution decision

The next increment will not introduce a new data platform or speculative digital twin. It will improve the existing dashboard into an operational command center by reusing `/api/dashboard` and `/api/kpi`, preserving all existing permissions and workflow logic.
