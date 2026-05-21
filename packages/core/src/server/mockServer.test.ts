import { describe, it, expect, afterEach } from "vitest";
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
        },
      ],
    });

    await server.start();

    const response = await fetch("http://localhost:3002/test", {
      headers: { "x-mock-response-code": "403" },
    });
    expect(response.status).toBe(403);
  });

  it("should override delay via x-mock-delay header", async () => {
    server = new MockServer({
      port: 3003,
      routes: [
        {
          method: "GET",
          path: "/test",
          statusCode: 200,
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
});
