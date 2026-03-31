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
- VS Code extension skeleton with command registration, route tree provider, and start/stop server commands
- baseline TypeScript build and lint workflow across packages

This is an active foundation. The project is usable for local experimentation and is structured for incremental feature delivery.

## Architecture

### Core package (`packages/core`)
- reads and dereferences OpenAPI specs
- extracts route metadata and response schema hints
- spins up a local mock server from parsed routes
- generates representative fake payloads from schema structure

### VS Code extension (`extension`)
- activates from workspace OpenAPI files
- exposes commands to start and stop the mock server
- displays parsed routes in the sidebar tree view
- bridges editor actions to core runtime behavior

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