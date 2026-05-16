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

  it("should call onRequest with bodies", async () => {
    let capturedReq: any = null;
    let capturedRes: any = null;

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
      onRequest: (_m, _p, _s, reqBody, resBody) => {
        capturedReq = reqBody;
        capturedRes = resBody;
      },
    });

    await server.start();

    const response = await fetch("http://localhost:3005/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-item" }),
    });

    expect(response.status).toBe(201);
    expect(capturedReq).toEqual({ name: "test-item" });
    expect(capturedRes).toEqual({ created: expect.any(Boolean) });
  });
});
