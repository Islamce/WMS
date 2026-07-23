# WMS Workflow Hardening — Phase 2

## Objective
Close the remaining workflow-integrity gaps identified after PR #32 by hardening duplicate submission, interruption recovery, and controlled concurrency behavior across critical write operations.

## Scope
1. Request submission
2. Allocation
3. Picking completion
4. Goods Issue recovery and replay evidence
5. Recovery from interrupted in-progress states
6. Focused concurrency and replay regression coverage

## Required controls
- Repeated successful requests return the existing result where safe.
- Concurrent requests cannot create duplicate tasks, allocations, stock movements, audit events, or notifications.
- In-progress claims fail closed with HTTP 409.
- Failed operations return the workflow to a retryable state.
- No new external dependency.
- No production load test.
- Existing API success contracts remain compatible; replay responses may add `idempotent: true`.

## Test gates
- Fresh isolated database for focused concurrency/recovery tests.
- Full E2E regression.
- ESLint and security checks.
- Production dependency audit.
- Local bounded load gate.
- Playwright browser smoke test.

## Explicitly deferred
- Real SAP write-back concurrency validation.
- Multi-process production-like test on UAT infrastructure.
- Large-volume queue benchmarking with production-scale datasets.
- Production maintenance-window load testing.

## Delivery sequence
1. Inspect current state transitions and transaction boundaries.
2. Add failing replay/concurrency regression tests.
3. Implement narrow guards and atomic claims.
4. Add interruption-recovery tests.
5. Run the complete CI gate.
6. Keep the pull request in draft until all checks pass.
