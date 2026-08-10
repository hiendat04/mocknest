# Auth Simulation + Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six concrete bugs in `packages/core` and add OpenAPI security-scheme simulation (realistic 401/403 responses for protected routes) across the core mock server, CLI, and VS Code extension.

**Architecture:** All new logic lives in `packages/core` (parser extraction of `security`/`securitySchemes`, a new auth guard in `MockServer`'s request pipeline) and is threaded through unchanged interfaces into `packages/cli` and `extension/`. No new packages, no new runtime dependencies.

**Tech Stack:** TypeScript, Express 5, Vitest (core package tests), esbuild (extension bundling), VS Code Extension API.

## Global Constraints

- `simulateAuth` defaults to `false` — opt-in, matching the existing `strictValidation` option.
- No new npm dependencies; implement with existing `express`/`openapi-types` primitives only.
- New request header is `x-mock-auth`, following the codebase's existing `x-mock-*` header convention (`x-mock-delay`, `x-mock-status-code`, `x-mock-example`, `x-mock-seed`).
- Auth simulation is presence/format checking only — no real JWT/token verification, no OAuth flow simulation, no scope/role enforcement.
- `extension/` has no test scaffolding today. Its tasks are verified with `npm run build` / `npm run lint`, not automated tests — this is a known, accepted gap, not something to fix as a side quest.
- Reference spec: `docs/superpowers/specs/2026-08-07-auth-simulation-and-bugfixes-design.md`.

---

## Task 1: Fix `isRunning()` staying `true` after `stop()`

**Files:**
- Modify: `packages/core/src/server/mockServer.ts` (`stop()` method)
- Test: `packages/core/src/server/mockServer.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MockServer.stop()` now leaves `isRunning()` returning `false` after it resolves — relied on by `extension/src/extension.ts`'s `deactivate()` and `restartServer` gating (no code change needed there, just fixes their existing assumption).

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("MockServer", ...)` block in `packages/core/src/server/mockServer.test.ts`, immediately before the file's final `});`:

```ts
  it("should report isRunning() as false after stop() resolves", async () => {
    server = new MockServer({
      port: 3100,
      routes: [],
    });

    await server.start();
    expect(server.isRunning()).toBe(true);

    await server.stop();
    expect(server.isRunning()).toBe(false);
  });
});
```

(The trailing `});` closes the outer `describe` block — replace the file's existing final `});` with the block above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run -t "isRunning"`
Expected: FAIL — `expect(server.isRunning()).toBe(false)` receives `true`.

- [ ] **Step 3: Fix `stop()`**

In `packages/core/src/server/mockServer.ts`, replace:

```ts
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
```

with:

```ts
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        this.server = null;
        resolve();
      });
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run -t "isRunning"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/mockServer.ts packages/core/src/server/mockServer.test.ts
git commit -m "fix: reset MockServer.stop() state so isRunning() reports false"
```

---

## Task 2: Fix fake-data type mismatches from ungated name heuristics

**Files:**
- Modify: `packages/core/src/generator/fakeDataGenerator.ts`
- Test: `packages/core/src/generator/fakeDataGenerator.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes — `generateValueFromField` behavior only.

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("fakeDataGenerator", ...)` in `packages/core/src/generator/fakeDataGenerator.test.ts`, immediately before the file's final `});`:

```ts
  it("should not apply string name heuristics to non-string fields", () => {
    const schema = {
      type: "object",
      properties: {
        isValid: { type: "boolean" },
        width: { type: "number" },
        id: { type: "string" },
      },
    } as any;

    const result = generateFakeData(schema);

    expect(typeof result.isValid).toBe("boolean");
    expect(typeof result.width).toBe("number");
    expect(typeof result.id).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run -t "string name heuristics"`
Expected: FAIL — `typeof result.isValid` and/or `typeof result.width` is `"string"` (a UUID), not `"boolean"`/`"number"`.

- [ ] **Step 3: Guard the semantic heuristics block by type**

In `packages/core/src/generator/fakeDataGenerator.ts`, replace:

```ts
  // Prefer semantic values when field names hint at domain meaning.
  if (name.includes("email")) return fakerInstance.internet.email();
  if (name.includes("name") && name.includes("first"))
    return fakerInstance.person.firstName();
  if (name.includes("name") && name.includes("last"))
    return fakerInstance.person.lastName();
  if (name.includes("name")) return fakerInstance.person.fullName();
  if (name.includes("phone")) return fakerInstance.phone.number();
  if (name.includes("address")) return fakerInstance.location.streetAddress();
  if (name.includes("city")) return fakerInstance.location.city();
  if (name.includes("zip") || name.includes("postcode"))
    return fakerInstance.location.zipCode();
  if (name.includes("country")) return fakerInstance.location.country();
  if (name.includes("company")) return fakerInstance.company.name();
  if (name.includes("job") || name.includes("title"))
    return fakerInstance.person.jobTitle();
  if (name.includes("avatar") || name.includes("portrait"))
    return fakerInstance.image.avatar();
  if (name.includes("password")) return fakerInstance.internet.password();
  if (name.includes("username") || name.includes("user_name"))
    return fakerInstance.internet.username();
  if (name.includes("url") || name.includes("image"))
    return fakerInstance.image.url();
  if (name.includes("date") || name.includes("time"))
    return fakerInstance.date.recent().toISOString();
  if (name.includes("id")) return fakerInstance.string.uuid();
  if (name.includes("price") || name.includes("amount"))
    return fakerInstance.number.float({
      min: schema.minimum ?? 1,
      max: schema.maximum ?? 999,
      fractionDigits: 2,
    });
  if (name.includes("description") || name.includes("bio"))
    return fakerInstance.lorem.sentence();
```

with:

```ts
  // Prefer semantic values when field names hint at domain meaning.
  // Only applies to string-typed fields — a boolean/number field named
  // "isValid" or "width" must not be coerced into a UUID just because its
  // name happens to contain "id".
  if (resolvedType === "string" || !resolvedType) {
    if (name.includes("email")) return fakerInstance.internet.email();
    if (name.includes("name") && name.includes("first"))
      return fakerInstance.person.firstName();
    if (name.includes("name") && name.includes("last"))
      return fakerInstance.person.lastName();
    if (name.includes("name")) return fakerInstance.person.fullName();
    if (name.includes("phone")) return fakerInstance.phone.number();
    if (name.includes("address")) return fakerInstance.location.streetAddress();
    if (name.includes("city")) return fakerInstance.location.city();
    if (name.includes("zip") || name.includes("postcode"))
      return fakerInstance.location.zipCode();
    if (name.includes("country")) return fakerInstance.location.country();
    if (name.includes("company")) return fakerInstance.company.name();
    if (name.includes("job") || name.includes("title"))
      return fakerInstance.person.jobTitle();
    if (name.includes("avatar") || name.includes("portrait"))
      return fakerInstance.image.avatar();
    if (name.includes("password")) return fakerInstance.internet.password();
    if (name.includes("username") || name.includes("user_name"))
      return fakerInstance.internet.username();
    if (name.includes("url") || name.includes("image"))
      return fakerInstance.image.url();
    if (name.includes("date") || name.includes("time"))
      return fakerInstance.date.recent().toISOString();
    if (name.includes("id")) return fakerInstance.string.uuid();
    if (name.includes("price") || name.includes("amount"))
      return fakerInstance.number.float({
        min: schema.minimum ?? 1,
        max: schema.maximum ?? 999,
        fractionDigits: 2,
      });
    if (name.includes("description") || name.includes("bio"))
      return fakerInstance.lorem.sentence();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run -t "string name heuristics"`
Expected: PASS

- [ ] **Step 5: Run the full fakeDataGenerator suite to confirm no regressions**

Run: `cd packages/core && npx vitest run fakeDataGenerator`
Expected: all tests in that file PASS (this heuristics block is exercised heavily by existing tests — e.g. `email`, `firstName` fields — so a broken guard would show up immediately).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generator/fakeDataGenerator.ts packages/core/src/generator/fakeDataGenerator.test.ts
git commit -m "fix: only apply semantic field-name heuristics to string-typed fields"
```

---

## Task 3: Fix `once`-override misfires from position-based keys

**Files:**
- Modify: `packages/core/src/server/mockServer.ts`
- Test: `packages/core/src/server/mockServer.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: a new private `MockServer.ensureOverrideId(override: ResponseOverrideRule): ResponseOverrideRule` method (used only internally by this task — no other task depends on it).

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("MockServer", ...)` in `packages/core/src/server/mockServer.test.ts`, immediately before the file's final `});`:

```ts
  it("should keep a stable identity for a once override even after new overrides are recorded on top", async () => {
    server = new MockServer({
      port: 3101,
      routes: [
        {
          method: "GET",
          path: "/coupon",
          statusCode: 200,
          responses: [],
        },
      ],
    });

    await server.start();

    await fetch("http://localhost:3101/__mocknest/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        once: true,
        response: { statusCode: 200, body: { code: "FIRST" } },
      }),
    });

    const first = await fetch("http://localhost:3101/coupon");
    expect((await first.json() as any).code).toBe("FIRST");

    // Registering a second, unrelated override shifts list positions — this
    // used to reset the first override's position-derived key and let it
    // fire again.
    await fetch("http://localhost:3101/__mocknest/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        match: { headers: { "x-never-sent": "x" } },
        response: { statusCode: 200, body: { code: "UNRELATED" } },
      }),
    });

    const second = await fetch("http://localhost:3101/coupon");
    const secondBody = await second.json() as any;
    expect(secondBody.code).not.toBe("FIRST");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run -t "stable identity for a once override"`
Expected: FAIL — `secondBody.code` is `"FIRST"` again.

- [ ] **Step 3: Add a stable-id counter and helper method**

In `packages/core/src/server/mockServer.ts`, replace:

```ts
  private overrideHitCounts: Map<string, number> = new Map();
  private dynamicOverrides: ResponseOverrideRule[] = [];
```

with:

```ts
  private overrideHitCounts: Map<string, number> = new Map();
  private dynamicOverrides: ResponseOverrideRule[] = [];
  private overrideIdCounter = 0;
```

- [ ] **Step 4: Add the `ensureOverrideId` method**

In the same file, replace:

```ts
  private selectResponseOverride(
    req: Request,
    route: ParsedRoute,
  ): ResponseOverrideRule | undefined {
    const overrides = collectOverrides(route, this.options.responseOverrides, this.dynamicOverrides);
    if (overrides.length === 0) return undefined;

    for (let index = 0; index < overrides.length; index += 1) {
      const override = overrides[index];
      if (!matchesOverrideContext(route, override)) continue;
      if (!matchesOverride(req, override.match)) continue;

      const overrideKey = getOverrideKey(override, index, route);
      const hitCount = this.overrideHitCounts.get(overrideKey) ?? 0;
      if (override.once && hitCount > 0) {
        continue;
      }

      this.overrideHitCounts.set(overrideKey, hitCount + 1);
      return override;
    }

    return undefined;
  }
}
```

with:

```ts
  private selectResponseOverride(
    req: Request,
    route: ParsedRoute,
  ): ResponseOverrideRule | undefined {
    const overrides = collectOverrides(route, this.options.responseOverrides, this.dynamicOverrides);
    if (overrides.length === 0) return undefined;

    for (let index = 0; index < overrides.length; index += 1) {
      const override = overrides[index];
      if (!matchesOverrideContext(route, override)) continue;
      if (!matchesOverride(req, override.match)) continue;

      const overrideKey = getOverrideKey(override, index, route);
      const hitCount = this.overrideHitCounts.get(overrideKey) ?? 0;
      if (override.once && hitCount > 0) {
        continue;
      }

      this.overrideHitCounts.set(overrideKey, hitCount + 1);
      return override;
    }

    return undefined;
  }

  private ensureOverrideId(override: ResponseOverrideRule): ResponseOverrideRule {
    if (override.id) return override;
    this.overrideIdCounter += 1;
    return { ...override, id: `auto-${this.overrideIdCounter}` };
  }
}
```

- [ ] **Step 5: Assign ids at every place an override without one can be created**

In the same file, replace:

```ts
    this.app.post("/__mocknest/overrides", (req, res) => {
      const override = req.body as ResponseOverrideRule;
      if (!override || !override.response) {
        res.status(400).json({ error: "Invalid override format" });
        return;
      }
      this.dynamicOverrides.unshift(override);
      res.json({ ok: true, count: this.dynamicOverrides.length });
    });
```

with:

```ts
    this.app.post("/__mocknest/overrides", (req, res) => {
      const override = req.body as ResponseOverrideRule;
      if (!override || !override.response) {
        res.status(400).json({ error: "Invalid override format" });
        return;
      }
      this.dynamicOverrides.unshift(this.ensureOverrideId(override));
      res.json({ ok: true, count: this.dynamicOverrides.length });
    });
```

Then replace:

```ts
    this.app.put("/__mocknest/overrides/bulk", (req, res) => {
      const overrides = req.body;
      if (!Array.isArray(overrides)) {
        res.status(400).json({ error: "Invalid overrides format (must be an array)" });
        return;
      }
      this.dynamicOverrides = overrides;
      res.json({ ok: true, count: this.dynamicOverrides.length });
    });
```

with:

```ts
    this.app.put("/__mocknest/overrides/bulk", (req, res) => {
      const overrides = req.body;
      if (!Array.isArray(overrides)) {
        res.status(400).json({ error: "Invalid overrides format (must be an array)" });
        return;
      }
      this.dynamicOverrides = overrides.map((override) => this.ensureOverrideId(override));
      res.json({ ok: true, count: this.dynamicOverrides.length });
    });
```

Then replace:

```ts
          if (this.options.proxyRecord && proxyRes.status >= 200 && proxyRes.status < 300) {
            console.log(`[MockNest] Recording proxied response for ${req.method} ${req.path}`);
            this.dynamicOverrides.unshift({
              name: `Recorded: ${req.method} ${req.path}`,
              method: req.method,
              path: req.path,
              match: {
                query: Object.keys(req.query).length > 0 ? { ...req.query } as any : undefined,
                headers: { ...req.headers } as any, // Might want to be more selective here later
              },
              response: {
                statusCode: proxyRes.status,
                body: responseBody,
              }
            });
          }
```

with:

```ts
          if (this.options.proxyRecord && proxyRes.status >= 200 && proxyRes.status < 300) {
            console.log(`[MockNest] Recording proxied response for ${req.method} ${req.path}`);
            this.dynamicOverrides.unshift(this.ensureOverrideId({
              name: `Recorded: ${req.method} ${req.path}`,
              method: req.method,
              path: req.path,
              match: {
                query: Object.keys(req.query).length > 0 ? { ...req.query } as any : undefined,
                headers: { ...req.headers } as any, // Might want to be more selective here later
              },
              response: {
                statusCode: proxyRes.status,
                body: responseBody,
              }
            }));
          }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/core && npx vitest run -t "stable identity for a once override"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/server/mockServer.ts packages/core/src/server/mockServer.test.ts
git commit -m "fix: assign stable ids to dynamic overrides instead of keying by list position"
```

---

## Task 4: Fix extension live-reload watcher missing `swagger.*`/`api-spec.*` specs

**Files:**
- Modify: `extension/src/utils/fileWatcher.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes.

- [ ] **Step 1: Confirm the current glob mismatch**

Run: `grep -rn "openapi,swagger,api-spec\|openapi\\.{yaml" extension/src`
Expected: `extension/src/extension.ts` and `extension/src/commands/startServer.ts` both use `**/{openapi,swagger,api-spec}.{yaml,yml,json}`, while `extension/src/utils/fileWatcher.ts` uses only `**/openapi.{yaml,yml,json}`.

- [ ] **Step 2: Widen the watcher glob**

In `extension/src/utils/fileWatcher.ts`, replace:

```ts
  const watcher = vscode.workspace.createFileSystemWatcher("**/openapi.{yaml,yml,json}");
```

with:

```ts
  const watcher = vscode.workspace.createFileSystemWatcher("**/{openapi,swagger,api-spec}.{yaml,yml,json}");
```

- [ ] **Step 3: Verify the extension still builds and type-checks**

Run: `cd extension && npm run lint && npm run build`
Expected: both succeed with no errors (this package has no automated tests — build/lint is the available verification).

- [ ] **Step 4: Commit**

```bash
git add extension/src/utils/fileWatcher.ts
git commit -m "fix: watch swagger.* and api-spec.* files for live-reload, not just openapi.*"
```

---

## Task 5: Parser — extract security schemes and per-route security requirements

**Files:**
- Modify: `packages/core/src/parser/openApiParser.ts`
- Test: `packages/core/src/parser/openApiParser.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ParsedRoute.security?: OpenAPIV3.SecurityRequirementObject[]` — used by Task 6.
  - `ParseResult.securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject>` — used by Task 6 (via CLI/extension wiring in Tasks 7–8).

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("openApiParser", ...)` in `packages/core/src/parser/openApiParser.test.ts`, immediately before the file's final `});`:

```ts
  it("should extract security schemes and per-route security requirements", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test Security API
  version: 1.0.0
security:
  - bearerAuth: []
components:
  securitySchemes:
    apiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key
    bearerAuth:
      type: http
      scheme: bearer
paths:
  /public:
    get:
      security: []
      responses:
        '200':
          description: OK
  /protected:
    get:
      security:
        - apiKeyAuth: []
        - bearerAuth: []
      responses:
        '200':
          description: OK
  /inherited:
    get:
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-security.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes, securitySchemes } = await parseOpenApiFile(tempFile);

      expect(securitySchemes.apiKeyAuth).toEqual({ type: "apiKey", in: "header", name: "x-api-key" });
      expect(securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });

      const publicRoute = routes.find((r) => r.path === "/public")!;
      expect(publicRoute.security).toEqual([]);

      const protectedRoute = routes.find((r) => r.path === "/protected")!;
      expect(protectedRoute.security).toEqual([
        { apiKeyAuth: [] },
        { bearerAuth: [] },
      ]);

      const inheritedRoute = routes.find((r) => r.path === "/inherited")!;
      expect(inheritedRoute.security).toEqual([{ bearerAuth: [] }]);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run -t "security schemes and per-route"`
Expected: FAIL — `securitySchemes` is `undefined` on the parse result (TypeScript compile error would also occur once Step 3's types are absent — the test won't type-check yet, which is expected at this point).

- [ ] **Step 3: Add the new fields to `ParsedRoute` and `ParseResult`**

In `packages/core/src/parser/openApiParser.ts`, replace:

```ts
export interface ParsedRoute {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParsedParameter[];
  requestSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  requestRequired?: boolean;
  responseSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  responseDescription?: string;
  responseHeaders?: Record<string, string>;
  responseExamples?: Record<string, any>;
  responses: ParsedResponse[];
  statusCode: number;
  mockDelay?: number;
  mockStatusCode?: number;
  responseOverrides?: ResponseOverrideRule[];
}

export interface ParseResult {
  routes: ParsedRoute[];
  api: OpenAPIV3.Document;
}
```

with:

```ts
export interface ParsedRoute {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParsedParameter[];
  requestSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  requestRequired?: boolean;
  responseSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  responseDescription?: string;
  responseHeaders?: Record<string, string>;
  responseExamples?: Record<string, any>;
  responses: ParsedResponse[];
  statusCode: number;
  mockDelay?: number;
  mockStatusCode?: number;
  responseOverrides?: ResponseOverrideRule[];
  security?: OpenAPIV3.SecurityRequirementObject[];
}

export interface ParseResult {
  routes: ParsedRoute[];
  api: OpenAPIV3.Document;
  securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject>;
}
```

- [ ] **Step 4: Extract security schemes up front**

In the same file, replace:

```ts
export async function parseOpenApiFile(
  filePath: string,
): Promise<ParseResult> {
  // Dereference upfront so downstream logic can read concrete schemas.
  const api = (await SwaggerParser.dereference(filePath)) as OpenAPIV3.Document;

  const routes: ParsedRoute[] = [];
```

with:

```ts
export async function parseOpenApiFile(
  filePath: string,
): Promise<ParseResult> {
  // Dereference upfront so downstream logic can read concrete schemas.
  const api = (await SwaggerParser.dereference(filePath)) as OpenAPIV3.Document;
  const securitySchemes = extractSecuritySchemes(api);

  const routes: ParsedRoute[] = [];
```

- [ ] **Step 5: Resolve and attach per-route security, and return `securitySchemes`**

In the same file, replace:

```ts
      routes.push({
        method: method.toUpperCase(),
        // Express expects :id while OpenAPI uses {id}.
        path: convertOpenApiPathToExpress(path),
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags,
        parameters,
        requestSchema,
        requestRequired: requestBody?.required,
        responseSchema,
        responseDescription: response?.description,
        responseHeaders:
          Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
        responseExamples:
          Object.keys(responseExamples).length > 0 ? responseExamples : undefined,
        responses: allResponses,
        statusCode,
        mockDelay: typeof mockDelay === "number" ? mockDelay : undefined,
        mockStatusCode: typeof mockStatusCode === "number" ? mockStatusCode : undefined,
        responseOverrides: responseOverrides.length > 0 ? responseOverrides : undefined,
      });
    }
  }

  return { routes, api };
}
```

with:

```ts
      routes.push({
        method: method.toUpperCase(),
        // Express expects :id while OpenAPI uses {id}.
        path: convertOpenApiPathToExpress(path),
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags,
        parameters,
        requestSchema,
        requestRequired: requestBody?.required,
        responseSchema,
        responseDescription: response?.description,
        responseHeaders:
          Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
        responseExamples:
          Object.keys(responseExamples).length > 0 ? responseExamples : undefined,
        responses: allResponses,
        statusCode,
        mockDelay: typeof mockDelay === "number" ? mockDelay : undefined,
        mockStatusCode: typeof mockStatusCode === "number" ? mockStatusCode : undefined,
        responseOverrides: responseOverrides.length > 0 ? responseOverrides : undefined,
        security: resolveOperationSecurity(operation, api),
      });
    }
  }

  return { routes, api, securitySchemes };
}

function extractSecuritySchemes(
  api: OpenAPIV3.Document,
): Record<string, OpenAPIV3.SecuritySchemeObject> {
  const schemes = api.components?.securitySchemes;
  if (!schemes) return {};

  const resolved: Record<string, OpenAPIV3.SecuritySchemeObject> = {};
  for (const [name, scheme] of Object.entries(schemes)) {
    if (!isReferenceObject(scheme)) {
      resolved[name] = scheme;
    }
  }
  return resolved;
}

function resolveOperationSecurity(
  operation: OpenAPIV3.OperationObject,
  api: OpenAPIV3.Document,
): OpenAPIV3.SecurityRequirementObject[] | undefined {
  // An operation's own `security` (including an explicit `[]`, meaning "no
  // auth for this operation") always wins over the document-level default.
  if (operation.security !== undefined) {
    return operation.security;
  }
  return api.security;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/core && npx vitest run -t "security schemes and per-route"`
Expected: PASS

- [ ] **Step 7: Run the full parser suite to confirm no regressions**

Run: `cd packages/core && npx vitest run openApiParser`
Expected: all tests in that file PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/parser/openApiParser.ts packages/core/src/parser/openApiParser.test.ts
git commit -m "feat: extract OpenAPI securitySchemes and per-route security requirements"
```

---

## Task 6: Server — fix rejected-request mutation, surface response-validation failures, and add auth simulation

This is the core of the feature. It reorders the request-handling pipeline so validation-like
guards (strict validation, and the new auth check) run *before* the stateful CRUD block — fixing
Bug 1 (rejected requests silently mutating stored data) as a side effect of adding the new guard —
and it adds the `simulateAuth` option itself.

**Files:**
- Modify: `packages/core/src/server/mockServer.ts`
- Test: `packages/core/src/server/mockServer.test.ts`

**Interfaces:**
- Consumes: `ParsedRoute.security` and `ParseResult.securitySchemes` from Task 5.
- Produces:
  - `MockServerOptions.simulateAuth?: boolean` and `MockServerOptions.securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject>` — consumed by Task 7 (CLI) and Task 8 (extension).
  - Request header `x-mock-auth: forbidden` forces a `403` on routes with a non-empty security requirement when `simulateAuth` is on.
  - `401` responses carry `{ error: "Unauthorized", details: string[] }` and a `WWW-Authenticate` header.
  - `403` responses carry `{ error: "Forbidden", details: string[] }`.
  - Response header `X-MockNest-Response-Validation: failed` is set when `strictValidation` catches a response-schema mismatch (previously silent).

- [ ] **Step 1: Write the failing tests**

Add these seven tests inside `describe("MockServer", ...)` in `packages/core/src/server/mockServer.test.ts`, immediately before the file's final `});`:

```ts
  it("should not persist a request to the data store when strict validation rejects it", async () => {
    server = new MockServer({
      port: 3102,
      stateful: true,
      strictValidation: true,
      routes: [
        {
          method: "POST",
          path: "/users",
          statusCode: 201,
          requestSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
          responseSchema: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const rejected = await fetch("http://localhost:3102/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bogusField: "no name here" }),
    });
    expect(rejected.status).toBe(400);

    const state = await fetch("http://localhost:3102/__mocknest/state");
    const stateBody = await state.json() as any;
    expect(stateBody.users ?? []).toHaveLength(0);
  });

  it("should set X-MockNest-Response-Validation header when the generated response fails schema validation", async () => {
    server = new MockServer({
      port: 3103,
      strictValidation: true,
      routes: [
        {
          method: "GET",
          path: "/broken",
          statusCode: 200,
          responseSchema: {
            type: "object",
            required: ["count"],
            properties: { count: { type: "number" } },
          },
          responseOverrides: [
            {
              response: { statusCode: 200, body: { count: "not-a-number" } },
            },
          ],
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3103/broken");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-mocknest-response-validation")).toBe("failed");
  });

  it("should allow requests to routes without a security requirement even when simulateAuth is enabled", async () => {
    server = new MockServer({
      port: 3104,
      simulateAuth: true,
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      routes: [
        {
          method: "GET",
          path: "/health",
          statusCode: 200,
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3104/health");
    expect(response.status).toBe(200);
  });

  it("should return 401 when simulateAuth is enabled and no credentials are provided for a protected route", async () => {
    server = new MockServer({
      port: 3105,
      simulateAuth: true,
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      routes: [
        {
          method: "GET",
          path: "/secret",
          statusCode: 200,
          security: [{ apiKeyAuth: [] }],
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3105/secret");
    expect(response.status).toBe(401);
    const body = await response.json() as any;
    expect(body.error).toBe("Unauthorized");
    expect(body.details[0]).toContain("apiKeyAuth");
    expect(response.headers.get("www-authenticate")).toBeTruthy();
  });

  it("should authorize a request that satisfies one of several security alternatives", async () => {
    server = new MockServer({
      port: 3106,
      simulateAuth: true,
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      routes: [
        {
          method: "GET",
          path: "/secret",
          statusCode: 200,
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3106/secret", {
      headers: { Authorization: "Bearer some-token" },
    });
    expect(response.status).toBe(200);
  });

  it("should return 403 when x-mock-auth: forbidden is sent for a protected route", async () => {
    server = new MockServer({
      port: 3107,
      simulateAuth: true,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      routes: [
        {
          method: "GET",
          path: "/secret",
          statusCode: 200,
          security: [{ bearerAuth: [] }],
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3107/secret", {
      headers: {
        Authorization: "Bearer valid-looking-token",
        "x-mock-auth": "forbidden",
      },
    });
    expect(response.status).toBe(403);
    const body = await response.json() as any;
    expect(body.error).toBe("Forbidden");
  });

  it("should not persist stateful data when a request is rejected by auth simulation", async () => {
    server = new MockServer({
      port: 3108,
      stateful: true,
      simulateAuth: true,
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      routes: [
        {
          method: "POST",
          path: "/orders",
          statusCode: 201,
          security: [{ apiKeyAuth: [] }],
          responseSchema: {
            type: "object",
            properties: { id: { type: "string" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const rejected = await fetch("http://localhost:3108/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: "widget" }),
    });
    expect(rejected.status).toBe(401);

    const state = await fetch("http://localhost:3108/__mocknest/state");
    const stateBody = await state.json() as any;
    expect(stateBody.orders ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run mockServer`
Expected: the 7 new tests FAIL (some with TypeScript errors, since `simulateAuth`/`securitySchemes`/`security` don't exist on the option/route types yet — that's expected at this point). The other pre-existing tests in the file still pass.

- [ ] **Step 3: Add `simulateAuth` and `securitySchemes` to `MockServerOptions`**

In `packages/core/src/server/mockServer.ts`, replace:

```ts
export interface MockServerOptions {
  port: number;
  routes: ParsedRoute[];
  api?: OpenAPIV3.Document;
  proxyTarget?: string;
  onRequest?: (
    method: string,
    path: string,
    statusCode: number,
    requestBody?: any,
    responseBody?: any,
    requestHeaders?: Record<string, any>,
  ) => void;
  delay?: number;
  delayJitter?: number;
  errorRate?: number;
  errorStatusCodes?: number[];
  strictValidation?: boolean;
  stateful?: boolean;
  statePath?: string;
  deterministic?: boolean | DeterministicOptions;
  proxyRecord?: boolean;
  logging?: MockServerLogOptions;
  requestHistory?: boolean | RequestHistoryOptions;
  responseOverrides?: ResponseOverrideRule[];
}
```

with:

```ts
export interface MockServerOptions {
  port: number;
  routes: ParsedRoute[];
  api?: OpenAPIV3.Document;
  proxyTarget?: string;
  onRequest?: (
    method: string,
    path: string,
    statusCode: number,
    requestBody?: any,
    responseBody?: any,
    requestHeaders?: Record<string, any>,
  ) => void;
  delay?: number;
  delayJitter?: number;
  errorRate?: number;
  errorStatusCodes?: number[];
  strictValidation?: boolean;
  simulateAuth?: boolean;
  securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject>;
  stateful?: boolean;
  statePath?: string;
  deterministic?: boolean | DeterministicOptions;
  proxyRecord?: boolean;
  logging?: MockServerLogOptions;
  requestHistory?: boolean | RequestHistoryOptions;
  responseOverrides?: ResponseOverrideRule[];
}
```

- [ ] **Step 4: Reorder the guard block and add the auth check**

In the same file, find the block starting at `let fakeBody: any = undefined;` (immediately after the `exampleValue` block) and ending at the route handler's closing `});`. Replace the entire block:

```ts
        let fakeBody: any = undefined;
        const pathInfo = this.options.stateful ? parsePathInfo(route.path) : undefined;

        if (this.options.stateful && pathInfo && exampleValue === undefined) {
          const collection = pathInfo.collection;
          const idParam = (pathInfo as any).paramName;

          if (pathInfo.type === "collection") {
            if (route.method === "GET") {
              const data = this.dataStore.getCollection(collection);
              if (data.length === 0 && responseSchema) {
                // Initial seed
                const seed = generateFakeData(
                  responseSchema,
                  { ...req.query },
                  fakeDataOptions,
                );
                const seedArray = Array.isArray(seed) ? seed : [seed];
                this.dataStore.setCollection(collection, seedArray);
                fakeBody = seedArray;
              } else {
                fakeBody = data;
              }
            } else if (route.method === "POST") {
              const newItem = req.body && Object.keys(req.body).length > 0
                ? req.body
                : responseSchema
                  ? generateFakeData(responseSchema, undefined, fakeDataOptions)
                  : {};
              
              const idField = determineIdField(collection, undefined, responseSchema, this.dataStore);

              // Ensure it has an ID if it's an object
              if (isPlainObject(newItem) && !newItem[idField] && !newItem.id && !newItem._id) {
                const idRandom = deterministicRandom ?? Math.random;
                newItem[idField] = idRandom().toString(36).substring(7);
              }
              this.dataStore.addItem(collection, newItem);
              fakeBody = newItem;
            }
          } else if (pathInfo.type === "item" && idParam) {
            const idValue = req.params[idParam];
            const idField = determineIdField(collection, idParam, responseSchema, this.dataStore);

            if (route.method === "GET") {
              fakeBody = this.dataStore.findItem(collection, idField, idValue);
              if (!fakeBody && responseSchema) {
                fakeBody = generateFakeData(
                  responseSchema,
                  { ...req.query, ...req.params },
                  fakeDataOptions,
                );
                if (isPlainObject(fakeBody)) {
                  fakeBody[idField] = idValue;
                  this.dataStore.addItem(collection, fakeBody);
                }
              }
            } else if (route.method === "PUT" || route.method === "PATCH") {
              const updates = req.body || {};
              const success = this.dataStore.updateItem(collection, idField, idValue, updates);
              if (success) {
                fakeBody = this.dataStore.findItem(collection, idField, idValue);
              } else if (responseSchema) {
                // Create if not exists for PUT/PATCH (upsert-ish)
                fakeBody = {
                  ...generateFakeData(
                    responseSchema,
                    undefined,
                    fakeDataOptions,
                  ),
                  ...updates,
                  [idField]: idValue,
                };
                this.dataStore.addItem(collection, fakeBody);
              }
            } else if (route.method === "DELETE") {
              this.dataStore.deleteItem(collection, idField, idValue);
              fakeBody = { message: "Deleted successfully" };
            }
          }
        }

        const sendJson = (
          sCode: number,
          payload: unknown,
          sHeaders?: Record<string, string>,
        ): void => {
          this.options.onRequest?.(
            route.method,
            req.path,
            sCode,
            req.body,
            payload,
            req.headers,
          );
          this.recordRequest(
            buildRequestHistoryEntry(
              req,
              route.method,
              sCode,
              payload,
              historyOptions,
              this.requestIdCounter + 1,
            ),
          );
          setTimeout(() => {
            if (sHeaders) {
              for (const [name, value] of Object.entries(sHeaders)) {
                res.setHeader(name, value);
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.status(sCode).send(JSON.stringify(payload, null, 2));
          }, delay);
        };

        if (this.options.strictValidation) {
          const errors = validateRouteRequest(route, req);
          if (errors.length > 0) {
            console.warn(
              `[MockNest] Request validation failed for ${route.method} ${req.path}:`,
              errors,
            );
            sendJson(400, {
              error: "Request validation failed",
              details: errors,
            });
            return;
          }
        }

        if (override?.response.body !== undefined) {
          fakeBody = override.response.body;
        }

        if (fakeBody === undefined) {
          fakeBody =
            exampleValue !== undefined
              ? exampleValue
              : responseSchema
                ? generateFakeData(
                    responseSchema,
                    { ...req.query, ...req.params },
                    fakeDataOptions,
                  )
                : {};
        }

        // Apply response templating
        const templateContext = {
          req: {
            body: req.body,
            query: req.query,
            params: req.params,
            headers: req.headers,
          },
          faker: deterministicFaker ?? faker,
        };

        fakeBody = processResponseTemplates(fakeBody, templateContext);

        const templatedHeaders = processResponseTemplates(
          mergeHeaders(responseHeaders, override?.response.headers),
          templateContext
        );

        if (this.options.strictValidation && responseSchema && !isReferenceObject(responseSchema)) {
          const responseErrors = validateSchemaValue(fakeBody, responseSchema, "response");
          if (responseErrors.length > 0) {
            console.error(
              `[MockNest] Generated response failed validation for ${route.method} ${req.path}:`,
              responseErrors,
            );
            // We still send the response, but we could optionally add a header or log it specially.
            // For now, let's just log it to console.
          }
        }

        // Chaos mode (error rate)
        if (this.options.errorRate && this.options.errorRate > 0) {
          const random = (deterministicRandom ?? Math.random)();
          if (random < this.options.errorRate) {
            const errorCodes = this.options.errorStatusCodes && this.options.errorStatusCodes.length > 0
              ? this.options.errorStatusCodes
              : [500];
            const errorRandom = (deterministicRandom ?? Math.random)();
            const errorCode = errorCodes[Math.floor(errorRandom * errorCodes.length)];
            
            console.error(
              `[MockNest] Simulated ${errorCode} Error for ${route.method} ${req.path}`,
            );
            sendJson(errorCode, { error: `Internal Server Error (Simulated: ${errorCode})` });
            return;
          }
        }

        if (loggingOptions.enabled) {
          if (loggingOptions.logResponseBody) {
            const responseLog = buildResponseLog(fakeBody, loggingOptions);
            console.log(
              `[MockNest] Response ${route.method} ${req.path} -> ${statusCode}`,
              responseLog,
            );
          } else {
            console.log(`[MockNest] ${route.method} ${req.path} -> ${statusCode}`);
          }
        }

        // Artificial delay to simulate real network.
        sendJson(statusCode, fakeBody, templatedHeaders);
      });
```

with:

```ts
        const sendJson = (
          sCode: number,
          payload: unknown,
          sHeaders?: Record<string, string>,
        ): void => {
          this.options.onRequest?.(
            route.method,
            req.path,
            sCode,
            req.body,
            payload,
            req.headers,
          );
          this.recordRequest(
            buildRequestHistoryEntry(
              req,
              route.method,
              sCode,
              payload,
              historyOptions,
              this.requestIdCounter + 1,
            ),
          );
          setTimeout(() => {
            if (sHeaders) {
              for (const [name, value] of Object.entries(sHeaders)) {
                res.setHeader(name, value);
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.status(sCode).send(JSON.stringify(payload, null, 2));
          }, delay);
        };

        // Auth and request-validation guards run before any stateful CRUD
        // side effect, so a rejected request never mutates the data store.
        if (this.options.simulateAuth && route.security && route.security.length > 0) {
          if (req.header("x-mock-auth") === "forbidden") {
            sendJson(403, {
              error: "Forbidden",
              details: ["Forced via x-mock-auth header."],
            });
            return;
          }

          const authResult = evaluateRouteSecurity(
            req,
            route.security,
            this.options.securitySchemes ?? {},
          );
          if (!authResult.authorized) {
            res.setHeader("WWW-Authenticate", authResult.challenge);
            sendJson(401, {
              error: "Unauthorized",
              details: authResult.details,
            });
            return;
          }
        }

        if (this.options.strictValidation) {
          const errors = validateRouteRequest(route, req);
          if (errors.length > 0) {
            console.warn(
              `[MockNest] Request validation failed for ${route.method} ${req.path}:`,
              errors,
            );
            sendJson(400, {
              error: "Request validation failed",
              details: errors,
            });
            return;
          }
        }

        let fakeBody: any = undefined;
        const pathInfo = this.options.stateful ? parsePathInfo(route.path) : undefined;

        if (this.options.stateful && pathInfo && exampleValue === undefined) {
          const collection = pathInfo.collection;
          const idParam = (pathInfo as any).paramName;

          if (pathInfo.type === "collection") {
            if (route.method === "GET") {
              const data = this.dataStore.getCollection(collection);
              if (data.length === 0 && responseSchema) {
                // Initial seed
                const seed = generateFakeData(
                  responseSchema,
                  { ...req.query },
                  fakeDataOptions,
                );
                const seedArray = Array.isArray(seed) ? seed : [seed];
                this.dataStore.setCollection(collection, seedArray);
                fakeBody = seedArray;
              } else {
                fakeBody = data;
              }
            } else if (route.method === "POST") {
              const newItem = req.body && Object.keys(req.body).length > 0
                ? req.body
                : responseSchema
                  ? generateFakeData(responseSchema, undefined, fakeDataOptions)
                  : {};
              
              const idField = determineIdField(collection, undefined, responseSchema, this.dataStore);

              // Ensure it has an ID if it's an object
              if (isPlainObject(newItem) && !newItem[idField] && !newItem.id && !newItem._id) {
                const idRandom = deterministicRandom ?? Math.random;
                newItem[idField] = idRandom().toString(36).substring(7);
              }
              this.dataStore.addItem(collection, newItem);
              fakeBody = newItem;
            }
          } else if (pathInfo.type === "item" && idParam) {
            const idValue = req.params[idParam];
            const idField = determineIdField(collection, idParam, responseSchema, this.dataStore);

            if (route.method === "GET") {
              fakeBody = this.dataStore.findItem(collection, idField, idValue);
              if (!fakeBody && responseSchema) {
                fakeBody = generateFakeData(
                  responseSchema,
                  { ...req.query, ...req.params },
                  fakeDataOptions,
                );
                if (isPlainObject(fakeBody)) {
                  fakeBody[idField] = idValue;
                  this.dataStore.addItem(collection, fakeBody);
                }
              }
            } else if (route.method === "PUT" || route.method === "PATCH") {
              const updates = req.body || {};
              const success = this.dataStore.updateItem(collection, idField, idValue, updates);
              if (success) {
                fakeBody = this.dataStore.findItem(collection, idField, idValue);
              } else if (responseSchema) {
                // Create if not exists for PUT/PATCH (upsert-ish)
                fakeBody = {
                  ...generateFakeData(
                    responseSchema,
                    undefined,
                    fakeDataOptions,
                  ),
                  ...updates,
                  [idField]: idValue,
                };
                this.dataStore.addItem(collection, fakeBody);
              }
            } else if (route.method === "DELETE") {
              this.dataStore.deleteItem(collection, idField, idValue);
              fakeBody = { message: "Deleted successfully" };
            }
          }
        }

        if (override?.response.body !== undefined) {
          fakeBody = override.response.body;
        }

        if (fakeBody === undefined) {
          fakeBody =
            exampleValue !== undefined
              ? exampleValue
              : responseSchema
                ? generateFakeData(
                    responseSchema,
                    { ...req.query, ...req.params },
                    fakeDataOptions,
                  )
                : {};
        }

        // Apply response templating
        const templateContext = {
          req: {
            body: req.body,
            query: req.query,
            params: req.params,
            headers: req.headers,
          },
          faker: deterministicFaker ?? faker,
        };

        fakeBody = processResponseTemplates(fakeBody, templateContext);

        let templatedHeaders = processResponseTemplates(
          mergeHeaders(responseHeaders, override?.response.headers),
          templateContext
        );

        if (this.options.strictValidation && responseSchema && !isReferenceObject(responseSchema)) {
          const responseErrors = validateSchemaValue(fakeBody, responseSchema, "response");
          if (responseErrors.length > 0) {
            console.error(
              `[MockNest] Generated response failed validation for ${route.method} ${req.path}:`,
              responseErrors,
            );
            templatedHeaders = {
              ...(templatedHeaders ?? {}),
              "X-MockNest-Response-Validation": "failed",
            };
          }
        }

        // Chaos mode (error rate)
        if (this.options.errorRate && this.options.errorRate > 0) {
          const random = (deterministicRandom ?? Math.random)();
          if (random < this.options.errorRate) {
            const errorCodes = this.options.errorStatusCodes && this.options.errorStatusCodes.length > 0
              ? this.options.errorStatusCodes
              : [500];
            const errorRandom = (deterministicRandom ?? Math.random)();
            const errorCode = errorCodes[Math.floor(errorRandom * errorCodes.length)];
            
            console.error(
              `[MockNest] Simulated ${errorCode} Error for ${route.method} ${req.path}`,
            );
            sendJson(errorCode, { error: `Internal Server Error (Simulated: ${errorCode})` });
            return;
          }
        }

        if (loggingOptions.enabled) {
          if (loggingOptions.logResponseBody) {
            const responseLog = buildResponseLog(fakeBody, loggingOptions);
            console.log(
              `[MockNest] Response ${route.method} ${req.path} -> ${statusCode}`,
              responseLog,
            );
          } else {
            console.log(`[MockNest] ${route.method} ${req.path} -> ${statusCode}`);
          }
        }

        // Artificial delay to simulate real network.
        sendJson(statusCode, fakeBody, templatedHeaders);
      });
```

- [ ] **Step 5: Add the auth-evaluation helper functions**

In the same file, find `function validateRouteRequest(route: ParsedRoute, req: Request): string[] {` and insert the following immediately before it:

```ts
interface SecurityAuthResult {
  authorized: boolean;
  details: string[];
  challenge: string;
}

function evaluateRouteSecurity(
  req: Request,
  security: OpenAPIV3.SecurityRequirementObject[],
  securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject>,
): SecurityAuthResult {
  const missingByAlternative: string[] = [];
  let firstChallenge: string | undefined;

  for (const requirement of security) {
    const schemeNames = Object.keys(requirement);
    if (schemeNames.length === 0) {
      // An empty requirement object is OpenAPI's way of saying "or no auth
      // at all" when offered as one of several alternatives.
      return { authorized: true, details: [], challenge: "" };
    }

    const missing: string[] = [];
    for (const schemeName of schemeNames) {
      const scheme = securitySchemes[schemeName];
      if (firstChallenge === undefined) {
        firstChallenge = describeChallenge(scheme);
      }
      if (!isSecuritySchemeSatisfied(req, scheme)) {
        missing.push(describeScheme(schemeName, scheme));
      }
    }

    if (missing.length === 0) {
      return { authorized: true, details: [], challenge: "" };
    }
    missingByAlternative.push(missing.join(" AND "));
  }

  return {
    authorized: false,
    details: missingByAlternative.map((alt) => `Missing credentials for: ${alt}`),
    challenge: firstChallenge ?? "Bearer",
  };
}

function isSecuritySchemeSatisfied(
  req: Request,
  scheme: OpenAPIV3.SecuritySchemeObject | undefined,
): boolean {
  // An unresolvable scheme name (not present in securitySchemes) fails
  // closed rather than silently allowing the request through.
  if (!scheme) return false;

  if (scheme.type === "apiKey") {
    let value: unknown;
    if (scheme.in === "header") value = req.header(scheme.name);
    else if (scheme.in === "query") value = req.query[scheme.name];
    else if (scheme.in === "cookie") value = (req as any).cookies?.[scheme.name];
    return typeof value === "string" && value.trim().length > 0;
  }

  if (scheme.type === "http") {
    const authorization = req.header("authorization");
    if (!authorization) return false;
    const httpScheme = (scheme.scheme || "").toLowerCase();
    if (httpScheme === "bearer") return /^Bearer\s+\S+/i.test(authorization);
    if (httpScheme === "basic") return /^Basic\s+\S+/i.test(authorization);
    return authorization.trim().length > 0;
  }

  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
    const authorization = req.header("authorization");
    return typeof authorization === "string" && authorization.trim().length > 0;
  }

  return false;
}

function describeScheme(
  name: string,
  scheme: OpenAPIV3.SecuritySchemeObject | undefined,
): string {
  if (!scheme) return `${name} (unrecognized security scheme)`;
  if (scheme.type === "apiKey") return `${name} (${scheme.in} '${scheme.name}')`;
  if (scheme.type === "http") return `${name} (Authorization: ${scheme.scheme ?? "http"})`;
  return `${name} (${scheme.type})`;
}

function describeChallenge(scheme: OpenAPIV3.SecuritySchemeObject | undefined): string {
  if (scheme?.type === "http" && (scheme.scheme || "").toLowerCase() === "basic") {
    return 'Basic realm="mocknest"';
  }
  return "Bearer";
}

```

- [ ] **Step 6: Run the full mockServer suite**

Run: `cd packages/core && npx vitest run mockServer`
Expected: every test in the file PASSES, including the 7 new ones and all pre-existing tests (this confirms the reorder didn't change behavior for `strictValidation`, stateful CRUD, overrides, chaos mode, or logging when `simulateAuth` is off).

- [ ] **Step 7: Run the full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: all test files PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/server/mockServer.ts packages/core/src/server/mockServer.test.ts
git commit -m "feat: add OpenAPI auth simulation and fix rejected requests mutating stateful data"
```

---

## Task 7: CLI — `--simulate-auth` flag

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `MockServerOptions.simulateAuth`/`securitySchemes` (Task 6), `ParseResult.securitySchemes` (Task 5).
- Produces: no new exports — CLI is a leaf.

There is no test harness for `packages/cli` (confirmed: no `*.test.ts` files and no `test` script in `packages/cli/package.json`). Verification for this task is build + manual smoke test.

- [ ] **Step 1: Add `simulateAuth` to `ServeOptions`**

In `packages/cli/src/index.ts`, replace:

```ts
interface ServeOptions {
  port: number;
  stateful: boolean;
  strict: boolean;
  delay: number;
  errorRate: number;
  proxyRecord: boolean;
  statePath?: string;
}
```

with:

```ts
interface ServeOptions {
  port: number;
  stateful: boolean;
  strict: boolean;
  simulateAuth: boolean;
  delay: number;
  errorRate: number;
  proxyRecord: boolean;
  statePath?: string;
}
```

- [ ] **Step 2: Initialize the option and parse the flag**

In the same file, replace:

```ts
  const options: ServeOptions = {
    port: 3001,
    stateful: false,
    strict: false,
    delay: 20,
    errorRate: 0,
    proxyRecord: false,
  };
```

with:

```ts
  const options: ServeOptions = {
    port: 3001,
    stateful: false,
    strict: false,
    simulateAuth: false,
    delay: 20,
    errorRate: 0,
    proxyRecord: false,
  };
```

Then replace:

```ts
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--help" || arg === "-h") {
```

with:

```ts
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--simulate-auth") {
      options.simulateAuth = true;
    } else if (arg === "--help" || arg === "-h") {
```

- [ ] **Step 3: Wire the option and `securitySchemes` into `MockServer`**

In the same file, replace:

```ts
  try {
    const { routes, api } = await parseOpenApiFile(absoluteSpecPath);
    const server = new MockServer({
      port: options.port,
      routes,
      api,
      delay: options.delay,
      errorRate: options.errorRate,
      stateful: options.stateful,
      statePath: options.statePath,
      proxyRecord: options.proxyRecord,
      strictValidation: options.strict,
      logging: {
        enabled: true,
        logHeaders: false,
        logBody: true,
        logResponseBody: true,
      },
    });

    console.log(`[MockNest CLI] Starting server on port ${options.port}...`);
    if (options.stateful) {
      console.log("[MockNest CLI] Stateful mode: ENABLED");
    }
    if (options.delay > 20) {
      console.log(`[MockNest CLI] Chaos Latency: ${options.delay}ms`);
    }
    if (options.errorRate > 0) {
      console.log(
        `[MockNest CLI] Chaos Error Rate: ${Math.round(options.errorRate * 100)}%`,
      );
    }
```

with:

```ts
  try {
    const { routes, api, securitySchemes } = await parseOpenApiFile(absoluteSpecPath);
    const server = new MockServer({
      port: options.port,
      routes,
      api,
      delay: options.delay,
      errorRate: options.errorRate,
      stateful: options.stateful,
      statePath: options.statePath,
      proxyRecord: options.proxyRecord,
      strictValidation: options.strict,
      simulateAuth: options.simulateAuth,
      securitySchemes,
      logging: {
        enabled: true,
        logHeaders: false,
        logBody: true,
        logResponseBody: true,
      },
    });

    console.log(`[MockNest CLI] Starting server on port ${options.port}...`);
    if (options.stateful) {
      console.log("[MockNest CLI] Stateful mode: ENABLED");
    }
    if (options.simulateAuth) {
      console.log("[MockNest CLI] Auth simulation: ENABLED");
    }
    if (options.delay > 20) {
      console.log(`[MockNest CLI] Chaos Latency: ${options.delay}ms`);
    }
    if (options.errorRate > 0) {
      console.log(
        `[MockNest CLI] Chaos Error Rate: ${Math.round(options.errorRate * 100)}%`,
      );
    }
```

- [ ] **Step 4: Update `printHelp()`**

In the same file, replace:

```
Server options:
  --spec, -s <path>        Path to OpenAPI spec file (required)
  --port, -p <number>      Port for the mock server (default: 3001)
  --stateful               Enable persistent CRUD state
  --state-path <path>      File used to persist state
  --proxy-record           Record successful proxied responses
  --chaos-latency <ms>     Global response latency (default: 20)
  --chaos-error-rate <0-1> Probability of simulated failures (default: 0)
  --strict                 Enable strict request validation
  --help, -h               Show this help message
```

with:

```
Server options:
  --spec, -s <path>        Path to OpenAPI spec file (required)
  --port, -p <number>      Port for the mock server (default: 3001)
  --stateful               Enable persistent CRUD state
  --state-path <path>      File used to persist state
  --proxy-record           Record successful proxied responses
  --chaos-latency <ms>     Global response latency (default: 20)
  --chaos-error-rate <0-1> Probability of simulated failures (default: 0)
  --strict                 Enable strict request validation
  --simulate-auth          Return 401/403 for routes whose OpenAPI security
                            requirements aren't met by the request
  --help, -h               Show this help message
```

- [ ] **Step 5: Build and type-check**

Run: `cd packages/cli && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Manual smoke test**

```bash
cat > /tmp/mocknest-auth-smoke.yaml <<'EOF'
openapi: 3.0.0
info:
  title: Smoke Test API
  version: 1.0.0
security:
  - apiKeyAuth: []
components:
  securitySchemes:
    apiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key
paths:
  /secret:
    get:
      responses:
        '200':
          description: OK
EOF

node packages/cli/dist/index.js --spec /tmp/mocknest-auth-smoke.yaml --port 3999 --simulate-auth &
sleep 1
curl -i http://localhost:3999/secret            # expect 401
curl -i http://localhost:3999/secret -H "x-api-key: test-key"  # expect 200
kill %1
rm /tmp/mocknest-auth-smoke.yaml
```

Expected: first `curl` returns `401` with `{"error":"Unauthorized",...}`; second returns `200`.

- [ ] **Step 7: Document the flag in README.md**

In `README.md`, find the CLI `**Options:**` list:

```
**Options:**
- `--spec, -s <path>`: Path to OpenAPI spec file (required)
- `--port, -p <number>`: Port to run the server on (default: 3001)
- `--stateful`: Enable stateful mocking (persistent CRUD)
- `--state-path <path>`: Path to persist state data
- `--chaos-latency <ms>`: Global latency for all responses
- `--chaos-error-rate <0-1>`: Probability of simulated failures
- `--strict`: Enable strict request validation
```

Replace with:

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
```

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/index.ts README.md
git commit -m "feat: add --simulate-auth flag to the MockNest CLI"
```

---

## Task 8: VS Code extension — auth simulation setting, toggle command, and wiring

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/src/providers/chaosControlProvider.ts`
- Modify: `extension/src/extension.ts`
- Modify: `extension/src/commands/startServer.ts`
- Modify: `README.md`
- Modify: `TESTING.md`

**Interfaces:**
- Consumes: `MockServerOptions.simulateAuth`/`securitySchemes` (Task 6), `ParseResult.securitySchemes` (Task 5).
- Produces: new command `mocknest.toggleAuthSimulation`, new setting `mocknest.simulateAuth`. No other extension file depends on these beyond what's wired here.

No automated test harness exists for `extension/` — verification is `npm run build` / `npm run lint`.

- [ ] **Step 1: Add the `mocknest.simulateAuth` setting**

In `extension/package.json`, replace:

```json
        "mocknest.strictValidation": {
          "type": "boolean",
          "default": false,
          "description": "Validate incoming request path/query/body against the OpenAPI contract and return 400 with details when invalid."
        },
```

with:

```json
        "mocknest.strictValidation": {
          "type": "boolean",
          "default": false,
          "description": "Validate incoming request path/query/body against the OpenAPI contract and return 400 with details when invalid."
        },
        "mocknest.simulateAuth": {
          "type": "boolean",
          "default": false,
          "description": "Return 401/403 for routes whose OpenAPI security requirements aren't met by the request (missing/malformed credentials, or forced via the x-mock-auth header)."
        },
```

- [ ] **Step 2: Register the `mocknest.toggleAuthSimulation` command**

In `extension/package.json`, replace:

```json
      {
        "command": "mocknest.toggleStrictValidation",
        "title": "MockNest: Toggle Contract Validation",
        "icon": "$(shield)"
      },
```

with:

```json
      {
        "command": "mocknest.toggleStrictValidation",
        "title": "MockNest: Toggle Contract Validation",
        "icon": "$(shield)"
      },
      {
        "command": "mocknest.toggleAuthSimulation",
        "title": "MockNest: Toggle Auth Simulation",
        "icon": "$(key)"
      },
```

- [ ] **Step 3: Add a "Security" row to the Chaos Controls tree**

In `extension/src/providers/chaosControlProvider.ts`, replace:

```ts
    const strictValidation = config.get<boolean>("strictValidation", false);
    const stateful = config.get<boolean>("stateful", false);
```

with:

```ts
    const strictValidation = config.get<boolean>("strictValidation", false);
    const simulateAuth = config.get<boolean>("simulateAuth", false);
    const stateful = config.get<boolean>("stateful", false);
```

Then replace:

```ts
      new ChaosControlItem(
        "Contract Validation",
        strictValidation ? "ON" : "OFF",
        "mocknest.toggleStrictValidation",
        "mocknest.strictValidation",
        "Toggle strict request validation against your OpenAPI contract",
        strictValidation ? "shield" : "circle-slash",
      ),
      new ChaosControlItem(
        "Reset Controls",
```

with:

```ts
      new ChaosControlItem(
        "Contract Validation",
        strictValidation ? "ON" : "OFF",
        "mocknest.toggleStrictValidation",
        "mocknest.strictValidation",
        "Toggle strict request validation against your OpenAPI contract",
        strictValidation ? "shield" : "circle-slash",
      ),
      new ChaosControlItem(
        "Auth Simulation",
        simulateAuth ? "ON" : "OFF",
        "mocknest.toggleAuthSimulation",
        "mocknest.simulateAuth",
        "Toggle 401/403 simulation for routes with OpenAPI security requirements",
        simulateAuth ? "key" : "circle-slash",
      ),
      new ChaosControlItem(
        "Reset Controls",
```

- [ ] **Step 4: Add the toggle command in `extension.ts`**

In `extension/src/extension.ts`, replace:

```ts
    vscode.commands.registerCommand("mocknest.toggleStrictValidation", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<boolean>("strictValidation", false);
      const next = !current;
      await config.update(
        "strictValidation",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage(
        `Contract validation ${next ? "enabled" : "disabled"}.`,
      );
    }),

    vscode.commands.registerCommand("mocknest.toggleStatefulMode", async () => {
```

with:

```ts
    vscode.commands.registerCommand("mocknest.toggleStrictValidation", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<boolean>("strictValidation", false);
      const next = !current;
      await config.update(
        "strictValidation",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage(
        `Contract validation ${next ? "enabled" : "disabled"}.`,
      );
    }),

    vscode.commands.registerCommand("mocknest.toggleAuthSimulation", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<boolean>("simulateAuth", false);
      const next = !current;
      await config.update(
        "simulateAuth",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage(
        `Auth simulation ${next ? "enabled" : "disabled"}.`,
      );
    }),

    vscode.commands.registerCommand("mocknest.toggleStatefulMode", async () => {
```

- [ ] **Step 5: Restart the server when the setting changes**

In the same file, replace:

```ts
      if (
        e.affectsConfiguration("mocknest.delay") ||
        e.affectsConfiguration("mocknest.delayJitter") ||
        e.affectsConfiguration("mocknest.errorRate") ||
        e.affectsConfiguration("mocknest.errorStatusCodes") ||
        e.affectsConfiguration("mocknest.strictValidation") ||
        e.affectsConfiguration("mocknest.stateful") ||
        e.affectsConfiguration("mocknest.proxyTarget")
      ) {
```

with:

```ts
      if (
        e.affectsConfiguration("mocknest.delay") ||
        e.affectsConfiguration("mocknest.delayJitter") ||
        e.affectsConfiguration("mocknest.errorRate") ||
        e.affectsConfiguration("mocknest.errorStatusCodes") ||
        e.affectsConfiguration("mocknest.strictValidation") ||
        e.affectsConfiguration("mocknest.simulateAuth") ||
        e.affectsConfiguration("mocknest.stateful") ||
        e.affectsConfiguration("mocknest.proxyTarget")
      ) {
```

- [ ] **Step 6: Read the setting and pass it (with `securitySchemes`) into `MockServer`**

In `extension/src/commands/startServer.ts`, replace:

```ts
  let parseResult: { routes: ParsedRoute[]; api: any };
  try {
    parseResult = await parseOpenApiFile(specPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to parse OpenAPI spec: ${message}`);
    return;
  }

  const { routes, api } = parseResult;
  routeTreeProvider.refresh(routes);

  const delay = config.get<number>("delay", 20);
  const delayJitter = config.get<number>("delayJitter", 0);
  const errorRate = config.get<number>("errorRate", 0);
  const errorStatusCodes = config.get<number[]>("errorStatusCodes", [500]);
  const strictValidation = config.get<boolean>("strictValidation", false);
  const stateful = config.get<boolean>("stateful", false);
```

with:

```ts
  let parseResult: {
    routes: ParsedRoute[];
    api: any;
    securitySchemes: Record<string, any>;
  };
  try {
    parseResult = await parseOpenApiFile(specPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to parse OpenAPI spec: ${message}`);
    return;
  }

  const { routes, api, securitySchemes } = parseResult;
  routeTreeProvider.refresh(routes);

  const delay = config.get<number>("delay", 20);
  const delayJitter = config.get<number>("delayJitter", 0);
  const errorRate = config.get<number>("errorRate", 0);
  const errorStatusCodes = config.get<number[]>("errorStatusCodes", [500]);
  const strictValidation = config.get<boolean>("strictValidation", false);
  const simulateAuth = config.get<boolean>("simulateAuth", false);
  const stateful = config.get<boolean>("stateful", false);
```

Then, in the same file, replace:

```ts
  const server = new MockServer({
    port,
    routes,
    api,
    proxyTarget: proxyTarget || undefined,
    delay,
    delayJitter,
    errorRate,
    errorStatusCodes,
    strictValidation,
    stateful,
    statePath,
    proxyRecord,
```

with:

```ts
  const server = new MockServer({
    port,
    routes,
    api,
    proxyTarget: proxyTarget || undefined,
    delay,
    delayJitter,
    errorRate,
    errorStatusCodes,
    strictValidation,
    simulateAuth,
    securitySchemes,
    stateful,
    statePath,
    proxyRecord,
```

- [ ] **Step 7: Build and lint the extension**

Run: `cd extension && npm run lint && npm run build`
Expected: both succeed with no TypeScript errors.

- [ ] **Step 8: Document the feature**

In `README.md`, find the "What is implemented today" bullet list and, immediately after the `shared API Quality Gate` bullet, add:

```
- OpenAPI security-scheme simulation: realistic 401/403 responses for routes with unmet auth requirements, toggleable from the CLI, VS Code settings, or the Chaos Controls view
```

In `TESTING.md`, after section "5. Command: `MockNest: Stop Mock Server`" (the file's last section), add:

```
### 6. Command: `MockNest: Toggle Auth Simulation`

-   **Feature:** Returns `401`/`403` for routes whose OpenAPI `security` requirement isn't met by the request, once enabled.
-   **Test Steps:**
    1.  Ensure `openapi.yaml` in your test workspace declares a `securitySchemes` entry and at least one operation with a `security` requirement (add one if the sample spec doesn't have it).
    2.  Open the Command Palette and select `MockNest: Toggle Auth Simulation`. Confirm the "Auth Simulation" row in the Chaos Controls view flips to `ON`.
    3.  `curl -i` the protected route with no credentials.
    4.  `curl -i` the same route with the header/credential the spec requires (e.g. `-H "x-api-key: test"`).
-   **Expected Result:**
    1.  Step 3 returns `401` with a JSON body `{ "error": "Unauthorized", "details": [...] }`.
    2.  Step 4 returns the normal mocked response.
    3.  Repeating step 3 with an added `-H "x-mock-auth: forbidden"` header returns `403` with `{ "error": "Forbidden", ... }` instead.
```

- [ ] **Step 9: Commit**

```bash
git add extension/package.json extension/src/providers/chaosControlProvider.ts extension/src/extension.ts extension/src/commands/startServer.ts README.md TESTING.md
git commit -m "feat: wire auth simulation setting and toggle command into the VS Code extension"
```

---

## Task 9: Full-workspace verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Clean build from repo root**

Run: `rm -rf packages/core/dist packages/cli/dist extension/out .turbo packages/core/.turbo packages/cli/.turbo extension/.turbo && npm run build`
Expected: `3 successful, 3 total`.

- [ ] **Step 2: Lint from repo root**

Run: `npm run lint`
Expected: `3 successful, 3 total`.

- [ ] **Step 3: Full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: all test files pass; total test count is 121 (baseline) + 11 (added across Tasks 1, 2, 3, 5, 6) = 132 passing tests.

- [ ] **Step 4: Confirm working tree is clean**

Run: `git status`
Expected: nothing to commit (every task already committed its own changes).

- [ ] **Step 5: If any step above fails**

Do not proceed — fix the root cause in the task that introduced it, re-run that task's own tests, then re-run Steps 1–4 of this task from the top.
