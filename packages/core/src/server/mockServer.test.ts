import { describe, it, expect, afterEach, vi } from "vitest";
import { MockServer } from "./mockServer";

describe("MockServer", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("should start and respond to requests", async () => {
    server = new MockServer({
      port: 3001,
      routes: [
        {
          method: "GET",
          path: "/test",
          statusCode: 200,
          responseSchema: { type: "object", properties: { msg: { type: "string" } } },
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3001/test");
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body).toHaveProperty("msg");
  });

  it("should override status code via x-mock-response-code header", async () => {
    server = new MockServer({
      port: 3002,
      routes: [
        {
          method: "GET",
          path: "/test",
          statusCode: 200,
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3002/test", {
      headers: { "x-mock-response-code": "403" },
    });
    expect(response.status).toBe(403);
  });

  it("should ignore malformed mock status headers", async () => {
    server = new MockServer({
      port: 3030,
      routes: [
        {
          method: "GET",
          path: "/test",
          statusCode: 200,
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3030/test", {
      headers: { "x-mock-response-code": "404abc" },
    });

    expect(response.status).toBe(200);
  });

  it("should override delay via x-mock-delay header", async () => {
    server = new MockServer({
      port: 3003,
      routes: [
        {
          method: "GET",
          path: "/test",
          statusCode: 200,
          responses: [],
        },
      ],
      delay: 200,
    });

    await server.start();

    const start = Date.now();
    await fetch("http://localhost:3003/test", {
      headers: { "x-mock-delay": "10" },
    });
    const duration = Date.now() - start;
    
    // Should be around 10ms + overhead, definitely less than 200ms
    expect(duration).toBeLessThan(150);
  });

  it("should ignore malformed mock delay headers", async () => {
    server = new MockServer({
      port: 3031,
      routes: [
        {
          method: "GET",
          path: "/test",
          statusCode: 200,
          responses: [],
        },
      ],
      delay: 40,
    });

    await server.start();

    const start = Date.now();
    const response = await fetch("http://localhost:3031/test", {
      headers: { "x-mock-delay": "300abc" },
    });
    const duration = Date.now() - start;

    expect(response.status).toBe(200);
    expect(duration).toBeLessThan(200);
  });

  it("should use the correct schema for a requested status code", async () => {
    server = new MockServer({
      port: 3004,
      routes: [
        {
          method: "GET",
          path: "/multi",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [
            {
              statusCode: "200",
              schema: {
                type: "object",
                properties: { ok: { type: "boolean" } },
              },
            },
            {
              statusCode: "400",
              schema: {
                type: "object",
                properties: { error: { type: "string" } },
              },
            },
          ],
        },
      ],
    });

    await server.start();

    // Request 400
    const response400 = await fetch("http://localhost:3004/multi", {
      headers: { "x-mock-response-code": "400" },
    });
    expect(response400.status).toBe(400);
    const body400: any = await response400.json();
    expect(body400).toHaveProperty("error");
    expect(body400).not.toHaveProperty("ok");

    // Request default (200)
    const response200 = await fetch("http://localhost:3004/multi");
    expect(response200.status).toBe(200);
    const body200: any = await response200.json();
    expect(body200).toHaveProperty("ok");
    expect(body200).not.toHaveProperty("error");
  });

  it("should call onRequest with bodies and headers", async () => {
    let capturedReq: any = null;
    let capturedRes: any = null;
    let capturedHeaders: any = null;

    server = new MockServer({
      port: 3005,
      routes: [
        {
          method: "POST",
          path: "/log",
          statusCode: 201,
          responseSchema: {
            type: "object",
            properties: { created: { type: "boolean" } },
          },
          responses: [],
        },
      ],
      onRequest: (_m, _p, _s, reqBody, resBody, reqHeaders) => {
        capturedReq = reqBody;
        capturedRes = resBody;
        capturedHeaders = reqHeaders;
      },
    });

    await server.start();

    const response = await fetch("http://localhost:3005/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Header": "captured",
      },
      body: JSON.stringify({ name: "test-item" }),
    });

    expect(response.status).toBe(201);
    expect(capturedReq).toEqual({ name: "test-item" });
    expect(capturedRes).toEqual({ created: expect.any(Boolean) });
    expect(capturedHeaders["x-test-header"]).toBe("captured");
  });

  it("should validate required headers in strict mode", async () => {
    server = new MockServer({
      port: 3006,
      strictValidation: true,
      routes: [
        {
          method: "GET",
          path: "/headers",
          statusCode: 200,
          parameters: [
            {
              name: "X-Required-Token",
              in: "header",
              required: true,
              schema: { type: "string", pattern: "^token-" },
            },
          ],
          responses: [],
        },
      ],
    });

    await server.start();

    // 1. Missing header -> 400
    const res1 = await fetch("http://localhost:3006/headers");
    expect(res1.status).toBe(400);
    const body1: any = await res1.json();
    expect(body1.error).toContain("Request validation failed");
    expect(body1.details[0]).toContain("Missing required header parameter 'X-Required-Token'");

    // 2. Invalid header format -> 400
    const res2 = await fetch("http://localhost:3006/headers", {
      headers: { "X-Required-Token": "wrong-prefix" },
    });
    expect(res2.status).toBe(400);
    const body2: any = await res2.json();
    expect(body2.details[0]).toContain("Invalid header.X-Required-Token");

    // 3. Valid header -> 200
    const res3 = await fetch("http://localhost:3006/headers", {
      headers: { "X-Required-Token": "token-123" },
    });
    expect(res3.status).toBe(200);
  });

  it("should use request parameters in the response body if field names match", async () => {
    server = new MockServer({
      port: 3007,
      routes: [
        {
          method: "GET",
          path: "/users/:userId",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: {
              userId: { type: "string" },
              name: { type: "string" },
              page: { type: "integer" },
            },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3007/users/user-123?page=5");
    const body: any = await response.json();

    expect(body.userId).toBe("user-123");
    expect(body.page).toBe(5);
    expect(typeof body.name).toBe("string");
  });

  it("should return named examples via x-mock-example header", async () => {
    server = new MockServer({
      port: 3008,
      routes: [
        {
          method: "GET",
          path: "/examples",
          statusCode: 200,
          responseExamples: {
            standard: { id: 1, name: "Standard" },
            premium: { id: 2, name: "Premium" },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    // 1. Request 'standard'
    const res1 = await fetch("http://localhost:3008/examples", {
      headers: { "x-mock-example": "standard" },
    });
    const body1: any = await res1.json();
    expect(body1).toEqual({ id: 1, name: "Standard" });

    // 2. Request 'premium'
    const res2 = await fetch("http://localhost:3008/examples", {
      headers: { "x-mock-example": "premium" },
    });
    const body2: any = await res2.json();
    expect(body2).toEqual({ id: 2, name: "Premium" });

    // 3. Request unknown -> fall back to fake (which is {} here as no schema)
    const res3 = await fetch("http://localhost:3008/examples", {
      headers: { "x-mock-example": "unknown" },
    });
    const body3: any = await res3.json();
    expect(body3).toEqual({});
  });

  it("should return deterministic responses when enabled", async () => {
    server = new MockServer({
      port: 3012,
      deterministic: true,
      routes: [
        {
          method: "GET",
          path: "/deterministic",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
            },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const headers = { "X-Test-Header": "same-input" };
    const res1 = await fetch("http://localhost:3012/deterministic?user=1", {
      headers,
    });
    const body1: any = await res1.json();

    const res2 = await fetch("http://localhost:3012/deterministic?user=1", {
      headers,
    });
    const body2: any = await res2.json();

    expect(body1).toEqual(body2);
  });

  it("should vary deterministic output by x-mock-seed header", async () => {
    server = new MockServer({
      port: 3013,
      deterministic: true,
      routes: [
        {
          method: "GET",
          path: "/seeded",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              amount: { type: "number", minimum: 1, maximum: 100000 },
            },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const res1 = await fetch("http://localhost:3013/seeded", {
      headers: { "x-mock-seed": "alpha" },
    });
    const body1: any = await res1.json();

    const res2 = await fetch("http://localhost:3013/seeded", {
      headers: { "x-mock-seed": "beta" },
    });
    const body2: any = await res2.json();

    expect(body1).not.toEqual(body2);
  });

  it("should respect mockDelay and mockStatusCode from ParsedRoute", async () => {
    server = new MockServer({
      port: 3009,
      routes: [
        {
          method: "GET",
          path: "/route-extensions",
          statusCode: 200,
          mockDelay: 100,
          mockStatusCode: 202,
          responses: [
            {
              statusCode: "202",
              schema: { type: "object", properties: { status: { type: "string" } } },
            },
          ],
        },
      ],
    });

    await server.start();

    const start = Date.now();
    const response = await fetch("http://localhost:3009/route-extensions");
    const duration = Date.now() - start;

    expect(response.status).toBe(202);
    expect(duration).toBeGreaterThanOrEqual(100);
    const body: any = await response.json();
    expect(body).toHaveProperty("status");
  });

  it("should redact sensitive request data in logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    server = new MockServer({
      port: 3014,
      logging: {
        logHeaders: true,
        logBody: true,
        logResponseBody: true,
        redactHeaders: ["authorization"],
        redactFields: ["password"],
      },
      routes: [
        {
          method: "POST",
          path: "/log-redact",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    await fetch("http://localhost:3014/log-redact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer super-secret",
      },
      body: JSON.stringify({ password: "super-secret", name: "Alice" }),
    });

    const hasRedaction = logSpy.mock.calls.some((call) =>
      JSON.stringify(call).includes("[REDACTED]"),
    );
    const leakedSecret = logSpy.mock.calls.some((call) =>
      JSON.stringify(call).includes("super-secret"),
    );

    expect(hasRedaction).toBe(true);
    expect(leakedSecret).toBe(false);

    logSpy.mockRestore();
  });

  it("should record request history with limits and redaction", async () => {
    server = new MockServer({
      port: 3015,
      requestHistory: {
        enabled: true,
        limit: 1,
        includeHeaders: true,
        includeBody: true,
        includeResponseBody: true,
        redactHeaders: ["authorization"],
        redactFields: ["password"],
      },
      routes: [
        {
          method: "POST",
          path: "/history",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    await fetch("http://localhost:3015/history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-1",
      },
      body: JSON.stringify({ password: "secret-1" }),
    });

    await fetch("http://localhost:3015/history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-2",
      },
      body: JSON.stringify({ password: "secret-2" }),
    });

    const historyRes = await fetch("http://localhost:3015/__mocknest/requests");
    const history: any[] = await historyRes.json();

    expect(history).toHaveLength(1);
    expect(history[0].headers.authorization).toBe("[REDACTED]");
    expect(history[0].body.password).toBe("[REDACTED]");
    expect(history[0].responseBody).toBeDefined();
  });

  it("should clear request history via DELETE endpoint", async () => {
    server = new MockServer({
      port: 3016,
      requestHistory: {
        enabled: true,
        limit: 5,
      },
      routes: [
        {
          method: "GET",
          path: "/clearable",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    await fetch("http://localhost:3016/clearable");
    await fetch("http://localhost:3016/clearable");

    const beforeRes = await fetch("http://localhost:3016/__mocknest/requests");
    const before: any[] = await beforeRes.json();
    expect(before.length).toBe(2);

    await fetch("http://localhost:3016/__mocknest/requests", {
      method: "DELETE",
    });

    const afterRes = await fetch("http://localhost:3016/__mocknest/requests");
    const after: any[] = await afterRes.json();
    expect(after.length).toBe(0);
  });

  it("should omit headers and bodies when history options are disabled", async () => {
    server = new MockServer({
      port: 3017,
      requestHistory: {
        enabled: true,
        includeHeaders: false,
        includeBody: false,
        includeResponseBody: false,
      },
      routes: [
        {
          method: "POST",
          path: "/history-omit",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    await fetch("http://localhost:3017/history-omit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "data" }),
    });

    const historyRes = await fetch("http://localhost:3017/__mocknest/requests");
    const history: any[] = await historyRes.json();

    expect(history).toHaveLength(1);
    expect(history[0].headers).toBeUndefined();
    expect(history[0].body).toBeUndefined();
    expect(history[0].responseBody).toBeUndefined();
  });

  it("should suppress request/response logs when logging is disabled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    server = new MockServer({
      port: 3018,
      logging: {
        enabled: false,
      },
      routes: [
        {
          method: "GET",
          path: "/no-logs",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();
    await fetch("http://localhost:3018/no-logs");

    const hasRequestLog = logSpy.mock.calls.some((call) =>
      JSON.stringify(call).includes("Request"),
    );
    const hasResponseLog = logSpy.mock.calls.some((call) =>
      JSON.stringify(call).includes("Response"),
    );

    expect(hasRequestLog).toBe(false);
    expect(hasResponseLog).toBe(false);

    logSpy.mockRestore();
  });

  it("should apply response overrides based on headers", async () => {
    server = new MockServer({
      port: 3019,
      responseOverrides: [
        {
          id: "special-override",
          method: "GET",
          path: "/override",
          match: {
            headers: { "x-variant": "special" },
          },
          response: {
            statusCode: 418,
            headers: { "x-override": "1" },
            body: { special: true },
          },
        },
      ],
      routes: [
        {
          method: "GET",
          path: "/override",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const res1 = await fetch("http://localhost:3019/override", {
      headers: { "x-variant": "special" },
    });
    const body1: any = await res1.json();
    expect(res1.status).toBe(418);
    expect(res1.headers.get("x-override")).toBe("1");
    expect(body1).toEqual({ special: true });

    const res2 = await fetch("http://localhost:3019/override");
    const body2: any = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2).toHaveProperty("ok");
  });

  it("should apply once overrides only once", async () => {
    server = new MockServer({
      port: 3020,
      responseOverrides: [
        {
          method: "GET",
          path: "/once",
          match: {
            query: { mode: "first" },
          },
          response: {
            statusCode: 409,
            body: { once: true },
          },
          once: true,
        },
      ],
      routes: [
        {
          method: "GET",
          path: "/once",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
      ],
    });

    await server.start();

    const res1 = await fetch("http://localhost:3020/once?mode=first");
    const body1: any = await res1.json();
    expect(res1.status).toBe(409);
    expect(body1).toEqual({ once: true });

    const res2 = await fetch("http://localhost:3020/once?mode=first");
    const body2: any = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2).toHaveProperty("ok");
  });

  it("should apply delay jitter in chaos mode", async () => {
    const baseDelay = 50;
    server = new MockServer({
      port: 3021,
      delay: baseDelay,
      delayJitter: 1.0, // Max jitter up to +100%
      routes: [
        {
          method: "GET",
          path: "/jitter",
          statusCode: 200,
          responses: [],
        },
      ],
    });

    await server.start();

    // With jitter=1.0 and delay=50, actual delay should be in [50, 100]ms range.
    // We'll sample a few times.
    const durations = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await fetch("http://localhost:3021/jitter");
      durations.push(Date.now() - start);
    }

    const hasJitter = durations.some(d => d > baseDelay + 5);
    expect(hasJitter).toBe(true);
    expect(Math.max(...durations)).toBeGreaterThan(baseDelay);
  });

  it("should return varied error status codes in chaos mode", async () => {
    const errorStatusCodes = [429, 503];
    server = new MockServer({
      port: 3022,
      errorRate: 1.0, // 100% error rate for testing
      errorStatusCodes,
      routes: [
        {
          method: "GET",
          path: "/chaos-errors",
          statusCode: 200,
          responses: [],
        },
      ],
    });

    await server.start();

    const statuses = new Set();
    for (let i = 0; i < 10; i++) {
      const res = await fetch("http://localhost:3022/chaos-errors");
      statuses.add(res.status);
    }

    expect(statuses.has(429) || statuses.has(503)).toBe(true);
    expect(statuses.has(200)).toBe(false);
  });

  it("should persist and reload stateful data", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const tempStateFile = path.join(__dirname, `temp-state-${Date.now()}.json`);

    try {
      // 1. Start server, add item, then stop
      server = new MockServer({
        port: 3023,
        stateful: true,
        statePath: tempStateFile,
        routes: [
          {
            method: "POST",
            path: "/items",
            statusCode: 201,
            responseSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
            responses: [],
          },
          {
            method: "GET",
            path: "/items",
            statusCode: 200,
            responses: [],
          }
        ],
      });
      await server.start();
      await fetch("http://localhost:3023/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "persistent-item" }),
      });
      await server.stop();
      server = null;

      // Verify file was created
      expect(fs.existsSync(tempStateFile)).toBe(true);

      // 2. Restart server with same state file and check if item exists
      server = new MockServer({
        port: 3024,
        stateful: true,
        statePath: tempStateFile,
        routes: [
          {
            method: "GET",
            path: "/items",
            statusCode: 200,
            responses: [],
          }
        ],
      });
      await server.start();
      const res = await fetch("http://localhost:3024/items");
      const items: any[] = await res.json();
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe("persistent-item");

    } finally {
      if (fs.existsSync(tempStateFile)) {
        fs.unlinkSync(tempStateFile);
      }
    }
  });

  it("should match x-mock-responses scenarios from ParsedRoute", async () => {
    server = new MockServer({
      port: 3025,
      routes: [
        {
          method: "GET",
          path: "/scenarios",
          statusCode: 200,
          responseSchema: { type: "object", properties: { default: { type: "boolean" } } },
          responses: [],
          responseOverrides: [
            {
              match: { query: { scenario: "error" } },
              response: { statusCode: 500, body: { error: "scenario-failed" } }
            },
            {
              match: { headers: { "x-scenario": "empty" } },
              response: { statusCode: 200, body: [] }
            }
          ]
        },
      ],
    });

    await server.start();

    // 1. Match query scenario
    const res1 = await fetch("http://localhost:3025/scenarios?scenario=error");
    expect(res1.status).toBe(500);
    expect(await res1.json()).toEqual({ error: "scenario-failed" });

    // 2. Match header scenario
    const res2 = await fetch("http://localhost:3025/scenarios", {
      headers: { "x-scenario": "empty" }
    });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual([]);

    // 3. Default response
    const res3 = await fetch("http://localhost:3025/scenarios");
    expect(res3.status).toBe(200);
    const body3: any = await res3.json();
    expect(body3.default).toBeDefined();
  });

  it("should apply response templates using request data and faker", async () => {
    server = new MockServer({
      port: 3026,
      routes: [
        {
          method: "POST",
          path: "/template",
          statusCode: 200,
          responseSchema: { type: "object", properties: { 
            echo: { type: "string" },
            query: { type: "string" },
            header: { type: "string" },
            nested: { type: "string" },
            name: { type: "string" }
          } },
          responses: [],
          responseOverrides: [
            {
              response: {
                statusCode: 200,
                headers: { "X-Echo": "{{req.headers.x-test}}" },
                body: {
                  echo: "Hello {{req.body.name}}!",
                  query: "Limit is {{req.query.limit}}",
                  header: "Auth: {{req.headers.authorization}}",
                  nested: "First item: {{req.body.items[0].val}}",
                  name: "{{faker.person.firstName}}"
                }
              }
            }
          ]
        },
      ],
    });

    await server.start();

    const res = await fetch("http://localhost:3026/template?limit=50", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": "Bearer token123",
        "X-Test": "header-val"
      },
      body: JSON.stringify({ 
        name: "Alice",
        items: [{ val: "nested-1" }]
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-echo")).toBe("header-val");
    
    const body: any = await res.json();
    expect(body.echo).toBe("Hello Alice!");
    expect(body.query).toBe("Limit is 50");
    expect(body.header).toBe("Auth: Bearer token123");
    expect(body.nested).toBe("First item: nested-1");
    expect(typeof body.name).toBe("string");
    expect(body.name).not.toBe("{{faker.person.firstName}}");
  });

  it("should validate additionalProperties: false in strict mode", async () => {
    server = new MockServer({
      port: 3027,
      strictValidation: true,
      routes: [
        {
          method: "POST",
          path: "/users",
          statusCode: 200,
          requestSchema: {
            type: "object",
            properties: {
              name: { type: "string" }
            },
            additionalProperties: false
          },
          responses: []
        }
      ]
    });

    await server.start();

    // 1. Send extra property -> 400
    const res1 = await fetch("http://localhost:3027/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", extra: "field" })
    });
    expect(res1.status).toBe(400);
    const body1 = await res1.json() as any;
    expect(body1.error).toContain("Request validation failed");
    expect(body1.details[0]).toContain("additional property 'extra' is not allowed");

    // 2. Send correct schema -> 200
    const res2 = await fetch("http://localhost:3027/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob" })
    });
    expect(res2.status).toBe(200);
  });

  it("should validate uniqueItems constraint in request bodies in strict mode", async () => {
    server = new MockServer({
      port: 3028,
      strictValidation: true,
      routes: [
        {
          method: "POST",
          path: "/tags",
          statusCode: 200,
          requestSchema: {
            type: "array",
            uniqueItems: true,
            items: { type: "string" }
          },
          responses: []
        }
      ]
    });

    await server.start();

    // 1. Send duplicate items -> 400
    const res1 = await fetch("http://localhost:3028/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["red", "red"])
    });
    expect(res1.status).toBe(400);
    const body1 = await res1.json() as any;
    expect(body1.details[0]).toContain("array items must be unique, duplicate found");

    // 2. Send unique items -> 200
    const res2 = await fetch("http://localhost:3028/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["red", "blue"])
    });
    expect(res2.status).toBe(200);
  });

  it("should validate and coerce query arrays with uniqueItems and minItems", async () => {
    server = new MockServer({
      port: 3029,
      strictValidation: true,
      routes: [
        {
          method: "GET",
          path: "/search",
          statusCode: 200,
          parameters: [
            {
              name: "ids",
              in: "query",
              required: true,
              schema: {
                type: "array",
                minItems: 2,
                uniqueItems: true,
                items: { type: "integer" }
              }
            }
          ],
          responses: []
        }
      ]
    });

    await server.start();

    // 1. Too few items (1 item) -> 400
    const res1 = await fetch("http://localhost:3029/search?ids=1");
    expect(res1.status).toBe(400);
    const body1 = await res1.json() as any;
    expect(body1.details[0]).toContain("expected at least 2 items");

    // 2. Non-integer item -> 400
    const res2 = await fetch("http://localhost:3029/search?ids=1,abc");
    expect(res2.status).toBe(400);
    const body2 = await res2.json() as any;
    expect(body2.details[0]).toContain("expected integer");

    // 3. Duplicate item -> 400
    const res3 = await fetch("http://localhost:3029/search?ids=1,1");
    expect(res3.status).toBe(400);
    const body3 = await res3.json() as any;
    expect(body3.details[0]).toContain("array items must be unique");

    // 4. Valid array parameters -> 200
    const res4 = await fetch("http://localhost:3029/search?ids=1,2");
    expect(res4.status).toBe(200);
  });

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

  it("should not consume a once override on a request rejected by auth simulation", async () => {
    server = new MockServer({
      port: 3109,
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
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responseOverrides: [
            {
              once: true,
              response: { statusCode: 200, body: { code: "ONCE" } },
            },
          ],
          responses: [],
        },
      ],
    });

    await server.start();

    const rejected = await fetch("http://localhost:3109/secret");
    expect(rejected.status).toBe(401);

    // The override was never delivered, so it must still be pending.
    const authorized = await fetch("http://localhost:3109/secret", {
      headers: { "x-api-key": "key-123" },
    });
    expect(authorized.status).toBe(200);
    expect((await authorized.json() as any).code).toBe("ONCE");
  });

  it("should not consume a once override on a request rejected by strict validation", async () => {
    server = new MockServer({
      port: 3110,
      strictValidation: true,
      routes: [
        {
          method: "GET",
          path: "/report",
          statusCode: 200,
          parameters: [
            { name: "since", in: "query", required: true, schema: { type: "string" } },
          ],
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responseOverrides: [
            {
              once: true,
              response: { statusCode: 200, body: { code: "ONCE" } },
            },
          ],
          responses: [],
        },
      ],
    });

    await server.start();

    const rejected = await fetch("http://localhost:3110/report");
    expect(rejected.status).toBe(400);

    const accepted = await fetch("http://localhost:3110/report?since=2020-01-01");
    expect(accepted.status).toBe(200);
    expect((await accepted.json() as any).code).toBe("ONCE");
  });

  it("should keep a stable identity for static once overrides when dynamic overrides are added on top", async () => {
    server = new MockServer({
      port: 3111,
      responseOverrides: [
        {
          method: "GET",
          path: "/global-coupon",
          once: true,
          response: { statusCode: 200, body: { code: "GLOBAL" } },
        },
      ],
      routes: [
        {
          method: "GET",
          path: "/global-coupon",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responses: [],
        },
        {
          method: "GET",
          path: "/route-coupon",
          statusCode: 200,
          responseSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          responseOverrides: [
            {
              once: true,
              response: { statusCode: 200, body: { code: "ROUTE" } },
            },
          ],
          responses: [],
        },
      ],
    });

    await server.start();

    expect((await (await fetch("http://localhost:3111/global-coupon")).json() as any).code)
      .toBe("GLOBAL");
    expect((await (await fetch("http://localhost:3111/route-coupon")).json() as any).code)
      .toBe("ROUTE");

    // Registering a dynamic override unshifts onto the front of the combined
    // list, shifting every static override's position by one.
    await fetch("http://localhost:3111/__mocknest/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        match: { headers: { "x-never-sent": "x" } },
        response: { statusCode: 200, body: { code: "UNRELATED" } },
      }),
    });

    const globalSecond = await (await fetch("http://localhost:3111/global-coupon")).json() as any;
    expect(globalSecond.code).not.toBe("GLOBAL");
    expect(globalSecond).toHaveProperty("ok");

    const routeSecond = await (await fetch("http://localhost:3111/route-coupon")).json() as any;
    expect(routeSecond.code).not.toBe("ROUTE");
    expect(routeSecond).toHaveProperty("ok");
  });

  it("should authorize a cookie-based apiKey security scheme from the Cookie header", async () => {
    server = new MockServer({
      port: 3112,
      simulateAuth: true,
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "session" },
      },
      routes: [
        {
          method: "GET",
          path: "/secret",
          statusCode: 200,
          security: [{ cookieAuth: [] }],
          responses: [],
        },
      ],
    });

    await server.start();

    const authorized = await fetch("http://localhost:3112/secret", {
      headers: { Cookie: "theme=dark; session=abc123; locale=en" },
    });
    expect(authorized.status).toBe(200);

    const missingCookie = await fetch("http://localhost:3112/secret", {
      headers: { Cookie: "theme=dark; locale=en" },
    });
    expect(missingCookie.status).toBe(401);

    const noCookieHeader = await fetch("http://localhost:3112/secret");
    expect(noCookieHeader.status).toBe(401);
  });

  it("should read required cookie parameters from the Cookie header in strict mode", async () => {
    server = new MockServer({
      port: 3113,
      strictValidation: true,
      routes: [
        {
          method: "GET",
          path: "/prefs",
          statusCode: 200,
          parameters: [
            { name: "sid", in: "cookie", required: true, schema: { type: "string" } },
          ],
          responses: [],
        },
      ],
    });

    await server.start();

    const withCookie = await fetch("http://localhost:3113/prefs", {
      headers: { Cookie: "sid=session-value" },
    });
    expect(withCookie.status).toBe(200);

    const withoutCookie = await fetch("http://localhost:3113/prefs");
    expect(withoutCookie.status).toBe(400);
  });
});
