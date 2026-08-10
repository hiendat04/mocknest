# Auth/Security-Scheme Simulation + Bug Fixes — Design

Date: 2026-08-07
Status: Approved

## Context

MockNest is a local OpenAPI mocking toolkit (`packages/core` runtime + `packages/cli` + a VS Code
extension). A codebase audit turned up five concrete bugs and one half-finished code path in
`packages/core`, and the project has no simulation of OpenAPI `security` requirements at all —
every mocked route responds as if it were public, regardless of what the spec declares. This spec
covers fixing the bugs and adding auth/security-scheme simulation as the one new feature for this
pass.

## Part 1 — Bug fixes

### Bug 1: Rejected requests still mutate stateful data
`packages/core/src/server/mockServer.ts`: in `registerRoutes()`, the stateful CRUD block
(`dataStore.addItem`/`updateItem`/`deleteItem`, ~lines 325-405) runs before the
`strictValidation` gate (~lines 441-454). A POST/PUT/PATCH/DELETE that fails contract validation
still gets written to the store before the `400` is returned.

**Fix:** move the `sendJson` closure definition and the validation gate to run *before* the
stateful CRUD block, so any request that fails validation (or, per Part 2, fails auth) returns
early without touching `dataStore`.

### Bug 2: Fake-data field-name heuristics ignore declared schema type
`packages/core/src/generator/fakeDataGenerator.ts`, `generateValueFromField()`: the semantic
name-based heuristics (`name.includes("id")`, `"date"`, `"url"`, etc., ~lines 245-277) run
unconditionally, unlike the `pattern`/`format` branches just above them which are guarded with
`resolvedType === "string"`. A `boolean` field named `isValid` or a `number` field named `width`
gets a UUID string because both contain the substring `"id"`.

**Fix:** wrap the semantic-heuristics block in the same `resolvedType === "string" || !resolvedType`
guard already used for `pattern`/`format`, so non-string fields fall through to the existing
type-based `switch` below.

### Bug 3: `isRunning()` never returns false after `stop()`
`packages/core/src/server/mockServer.ts`, `stop()`: `this.server` is never reset to `null` after a
successful close, so `isRunning()` (`this.server !== null`) reports `true` forever once the server
has started once.

**Fix:** set `this.server = null` after `server.close()` resolves.

### Bug 4: Extension file watcher misses `swagger.*`/`api-spec.*` specs
`extension/src/utils/fileWatcher.ts`: the live-reload watcher glob is
`**/openapi.{yaml,yml,json}`, but spec discovery/selection elsewhere in the extension uses
`**/{openapi,swagger,api-spec}.{yaml,yml,json}`. Editing a selected `swagger.yaml` never triggers
an auto-restart.

**Fix:** widen the watcher glob to match the same three basenames used everywhere else.

### Bug 5: Position-keyed `once` overrides misfire under override churn
`packages/core/src/server/mockServer.ts`, `getOverrideKey()`/`selectResponseOverride()`: overrides
created without an explicit `id` (both `POST /__mocknest/overrides` and proxy auto-recording) fall
back to a key derived from their position in the combined override list. Because new overrides are
`unshift`ed onto the front of that list, every existing override's position — and therefore its
key — shifts each time a new one is added, so a `once` override's hit-count can reset (re-firing)
or collide with an unrelated override.

**Fix:** assign a stable id (monotonic counter-based) to any override that arrives without one, at
the point it's added to `dynamicOverrides` (both call sites), instead of relying on list position.

### Bug 6 (half-finished): response-schema validation failures are invisible
`packages/core/src/server/mockServer.ts`, ~lines 491-501: when `strictValidation` is on and the
generated response body fails schema validation, the only signal is a `console.error` — nothing is
surfaced to the caller.

**Fix:** set a non-breaking `X-MockNest-Response-Validation: failed` response header in that case,
so it's visible to `curl -i`, tests, and tooling without changing the response body or status.

## Part 2 — Auth/security-scheme simulation

### Goal
When enabled, make the mock server behave like a real API with respect to `security`: routes that
require credentials return `401 Unauthorized` when the request doesn't present them (in the right
shape), and a dedicated header lets developers force a `403 Forbidden` to test permission-denied
UI paths. This is presence/format checking, not real token verification — MockNest has no identity
backend and isn't becoming one.

### Parser changes (`packages/core/src/parser/openApiParser.ts`)
- `ParseResult` gains `securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject>`, sourced
  from `document.components.securitySchemes` (already dereferenced upstream by `SwaggerParser`).
- `ParsedRoute` gains `security?: OpenAPIV3.SecurityRequirementObject[]`, resolved per-operation as:
  - `operation.security` if defined (including an explicit `[]`, which means "no auth required for
    this operation" even under a global requirement — this must be preserved, not treated as
    "unset").
  - else `document.security ?? []`.

### Server changes (`packages/core/src/server/mockServer.ts`)
- `MockServerOptions` gains `simulateAuth?: boolean` (default `false`, opt-in like
  `strictValidation`) and `securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject>`.
- New guard step added to the reordered guard block from Bug 1. Auth is checked **before**
  `strictValidation`, mirroring real APIs (401 before 400 — don't leak contract details to
  unauthenticated callers). The full per-request order becomes:
  1. `x-mock-auth: forbidden` short-circuit (only when the route has a non-empty security
     requirement and `simulateAuth` is on) → `403`.
  2. Auth requirement check (see algorithm below) → `401` if unsatisfied.
  3. `strictValidation` request check (unchanged logic, just moved earlier) → `400` if invalid.
  4. Stateful CRUD block.
  5. Everything else unchanged (overrides, fake body generation, templating, response-schema
     check + new header, chaos error injection, logging, send).

- Auth satisfaction algorithm: a route with `security` (non-empty) is authorized if **any** of its
  requirement alternatives is satisfied; an alternative (a set of scheme names) is satisfied if
  **all** its schemes are individually satisfied:
  - `apiKey`: the header/query/cookie named by `scheme.name`/`scheme.in` is present and non-empty.
  - `http` + `scheme: "bearer"`: `Authorization` header matches `/^Bearer\s+\S+/i`.
  - `http` + `scheme: "basic"`: `Authorization` header matches `/^Basic\s+\S+/i`.
  - `http` (other): `Authorization` header present.
  - `oauth2` / `openIdConnect`: `Authorization` header present (scopes are not checked).
  - An empty requirement alternative (`{}`) is always satisfied (this is how OpenAPI expresses "or
    no auth at all" as one of several alternatives).
  - A requirement referencing an unknown scheme name (not present in `securitySchemes`) is treated
    as unsatisfiable, so a malformed spec fails closed rather than silently allowing everything.
- On failure: `401 { error: "Unauthorized", details: [...] }`, where `details` lists, per
  alternative, which scheme(s) were missing (human-readable, e.g. `"apiKeyAuth (header
  'x-api-key')"`), plus a `WWW-Authenticate` response header derived from the first required
  scheme's type (`Bearer`, `Basic realm="mocknest"`, etc.).
- `x-mock-auth: forbidden` → `403 { error: "Forbidden", details: ["Forced via x-mock-auth header."] }`.
  Only honored on routes that actually declare a non-empty security requirement, so it can't be
  used to fabricate a 403 on a public route.

### CLI changes (`packages/cli/src/index.ts`)
- New `--simulate-auth` flag → `MockServerOptions.simulateAuth = true`.
- `parseOpenApiFile`'s returned `securitySchemes` passed through to `MockServer` alongside `routes`/`api`.
- `printHelp()` updated.

### Extension changes
- New setting `mocknest.simulateAuth` (boolean, default `false`) in `extension/package.json`,
  described consistently with `mocknest.strictValidation`.
- New command `mocknest.toggleAuthSimulation`, implemented identically to
  `mocknest.toggleStrictValidation` in `extension/src/extension.ts`.
- New "Security" row in `ChaosControlProvider`'s tree (`extension/src/providers/chaosControlProvider.ts`),
  mirroring the existing "Contract Validation" row.
- `startServerCommand` (`extension/src/commands/startServer.ts`) reads the setting and passes
  `simulateAuth`/`securitySchemes` into `MockServer`.
- The config-change listener in `extension.ts` (the block that currently checks
  `affectsConfiguration("mocknest.strictValidation")` etc. to trigger a restart) gets
  `mocknest.simulateAuth` added.

### Testing
- `packages/core/src/parser/openApiParser.test.ts`: security-scheme extraction; per-operation
  resolution (inherited global, operation override, explicit `[]` opt-out).
- `packages/core/src/server/mockServer.test.ts`: one test per scheme type (apiKey in
  header/query/cookie, bearer, basic, oauth2), OR-of-alternatives logic, missing-scheme-name
  fail-closed behavior, `x-mock-auth: forbidden`, and — importantly — that a request rejected by
  auth or strict validation never reaches `dataStore` (regression test for Bug 1, now serving both
  the bug fix and the new feature).
- Regression tests for bugs 2, 3, 5, 6 in their respective existing test files.
- No test scaffolding exists for the `extension` package; the wiring there (bug 4 fix, new
  setting/command/tree row) won't have automated coverage. Noted as a known gap, not addressed in
  this pass.

### Non-goals
- No real JWT/token signature verification.
- No OAuth2 flow simulation (authorization code exchange, token refresh, etc.).
- No scope/role-based authorization — a valid-shaped credential always passes (unless
  `x-mock-auth: forbidden` is used).
- No changes to the API Quality Gate / contract scoring in this pass.
