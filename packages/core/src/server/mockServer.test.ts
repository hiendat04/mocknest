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
});
