# MockNest

MockNest is a local API mocking toolkit built around OpenAPI.

The project has two parts:
- a reusable core package that parses an OpenAPI document and serves mocked endpoints
- a VS Code extension that makes the workflow accessible from the editor

The goal is straightforward: reduce dependency on backend readiness during development and make API-first collaboration faster and less fragile.

## What is implemented today

Current repository state includes:
- monorepo setup with npm workspaces and Turborepo task orchestration
- `mocknest-core` package with OpenAPI parsing, fake data generation, and Express-based mock server runtime
- VS Code extension with route browsing, API testing, request logging, state inspection, chaos controls, and contract coverage reporting
- shared API Quality Gate for VS Code and CI with readiness scoring, semantic breaking-change detection, policy thresholds, and machine-readable results
- spec quality scorecard generation for OpenAPI mockability, schema coverage, examples, and error-path readiness
- OpenAPI contract change reporting for PR review against a selected baseline spec
- contract smoke test generation for dependency-free local or CI validation
- traffic replay test generation that turns captured request logs into repeatable regression tests
- edge-case scenario pack generation for documented errors, empty states, slow responses, and invalid requests
- contract drift analysis for observed request-log traffic, statuses, and response body schemas
- traffic-to-mock scenario recording that turns request log entries into replayable mock overrides
- baseline TypeScript build and lint workflow across packages

This is an active foundation. The project is usable for local experimentation and is structured for incremental feature delivery.

## Usage

### VS Code Extension
Install the MockNest extension and click the "MockNest" icon in the Activity Bar. You can start the server, browse routes, and explore state directly from VS Code.

Use the Request Log to record an observed request as a replay scenario, or export the full log as `mocknest-scenarios.json` for later import through the runtime configuration workflow.

Use the Request Log drift report to compare observed traffic against the OpenAPI contract before sharing a PR or debugging an integration issue.

Use the Request Log replay test generator to turn a manual API session or bug reproduction into `mocknest.replay.test.js`, a dependency-free Node regression suite.

Use the Route Tree scorecard to find OpenAPI gaps that weaken generated mocks, contract tests, strict validation, or stateful mock workflows.

Use the Route Tree API Quality Gate to enforce a minimum readiness score and optionally compare the loaded contract with a baseline for consumer-breaking changes. Configure thresholds with `mocknest.gate.minimumScore`, `mocknest.gate.maxBlockingFindings`, and `mocknest.gate.maxBreakingChanges`.

Use the Route Tree change report to compare the loaded spec against a baseline OpenAPI file before merging API-facing pull requests.

Use the Route Tree edge-case pack generator to create importable scenarios, then send the generated `x-mock-case` header to activate a specific error, empty, slow, or invalid-request response.

Use the Route Tree to generate `mocknest.contract.test.js`, a dependency-free Node test suite that can run against MockNest locally or any target API through `MOCKNEST_BASE_URL`.

### CLI (Standalone)
You can also run MockNest directly from your terminal using the built-in CLI:

```bash
# Run using npx (from workspace root)
npx mocknest --spec ./path/to/openapi.yaml --port 3001 --stateful
```

**Options:**
- `--spec, -s <path>`: Path to OpenAPI spec file (required)
- `--port, -p <number>`: Port to run the server on (default: 3001)
- `--stateful`: Enable stateful mocking (persistent CRUD)
- `--state-path <path>`: Path to persist state data
- `--chaos-latency <ms>`: Global latency for all responses
- `--chaos-error-rate <0-1>`: Probability of simulated failures
- `--strict`: Enable strict request validation
- `--simulate-auth`: Return 401/403 for routes whose OpenAPI security requirements aren't met by the request

### API Quality Gate

Run the same contract policy used by the VS Code extension in local scripts or CI:

```bash
npx mocknest gate \
  --spec ./openapi.yaml \
  --baseline ./openapi.baseline.yaml \
  --min-score 80 \
  --max-blocking 0 \
  --max-breaking 0
```

The command exits with `0` when the policy passes, `1` when the contract violates policy, and `2` for invalid input or analysis errors. Use `--format json` for machine-readable output or `--format markdown --output mocknest-gate.md` for a pull-request artifact.

## Architecture

### Core package (`packages/core`)
- reads and dereferences OpenAPI specs
- extracts route metadata and response schema hints
- scores contract readiness and detects consumer-breaking API changes through a reusable policy engine
- spins up a local mock server from parsed routes
- generates representative fake payloads from schema structure

### VS Code extension (`extension`)
- activates from workspace OpenAPI files
- exposes commands to start and stop the mock server
- displays parsed routes in the sidebar tree view
- grades loaded specs with a mockability and production-readiness scorecard
- compares loaded specs against baseline contracts for PR-ready change impact reports
- analyzes request-log traffic for contract drift
- generates runnable contract smoke tests from parsed routes
- converts captured request-log traffic into runnable replay regression tests
- generates importable edge-case scenario packs from parsed OpenAPI routes
- records API Tester and mock-server traffic as reusable replay scenarios
- bridges editor actions to core runtime behavior
- runs the shared API Quality Gate from the Route Tree while the CLI enforces the same decision in CI

## Getting started

### Prerequisites
- Node.js 20+
- npm 10+
- VS Code 1.85+

### Install dependencies

```bash
npm install
```

### Build all packages

```bash
npm run build
```

### Run development tasks

```bash
npm run dev
```

### Lint/type-check

```bash
npm run lint
```

## Repository scripts

Root scripts are orchestrated through Turborepo:
- `npm run build` runs package builds in dependency order
- `npm run dev` runs package development tasks
- `npm run lint` runs TypeScript no-emit checks
- `npm run test` is reserved for package test pipelines

## Contributing

Contributions are welcome.

### Suggested workflow
1. Create a branch from `main`.
2. Keep changes scoped to one concern (feature, fix, or refactor).
3. Run `npm run build` and `npm run lint` before opening a PR.
4. Add or update documentation when behavior changes.
5. Open a pull request with a short problem statement and implementation notes.

### Contribution standards
- prefer small, reviewable pull requests
- preserve existing architecture boundaries between core and extension layers
- avoid unrelated formatting churn
- document trade-offs when introducing new dependencies

## Roadmap

Near-term priorities:
- improve spec file selection and auto-reload behavior
- add request logging surface in the extension
- strengthen schema coverage for response generation
- introduce automated tests for parser and server behavior

Mid-term direction:
- dashboard integration for runtime observability
- richer mock behavior controls (delays, error simulation, scenario profiles)
- packaging and release workflow for extension distribution

## Why this project matters

MockNest is designed to improve day-to-day engineering flow:
- frontend teams can progress against realistic API contracts before backend endpoints are deployed
- backend teams can validate and iterate API shape with immediate local feedback
- teams gain a shared contract-centered workflow that reduces integration surprises

## License

MIT
