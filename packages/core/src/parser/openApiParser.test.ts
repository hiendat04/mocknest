import { describe, it, expect } from "vitest";
import { parseOpenApiFile } from "./openApiParser";
import * as path from "path";
import * as fs from "fs";

describe("openApiParser", () => {
  it("should parse tags from operation", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /test:
    get:
      tags:
        - user
        - profile
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-tags.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(1);
      expect(routes[0].tags).toEqual(["user", "profile"]);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse x-mock-delay and x-mock-status extensions", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test Extensions API
  version: 1.0.0
paths:
  /extensions:
    post:
      x-mock-delay: 500
      x-mock-status: 201
      responses:
        '200':
          description: OK
        '201':
          description: Created
`;
    const tempFile = path.join(__dirname, "temp-spec-extensions.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(1);
      expect(routes[0].mockDelay).toBe(500);
      expect(routes[0].mockStatusCode).toBe(201);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should convert OpenAPI path parameters to Express format", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users/{userId}/posts/{postId}:
    get:
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-paths.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe("/users/:userId/posts/:postId");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should quote OpenAPI path parameters that are not simple identifiers", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users/{user-id}/orders/{order.id}:
    get:
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-quoted-paths.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/users/:"user-id"/orders/:"order.id"');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse all HTTP methods", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    get:
      responses:
        '200':
          description: OK
    post:
      responses:
        '201':
          description: Created
    put:
      responses:
        '200':
          description: OK
    delete:
      responses:
        '204':
          description: No Content
    patch:
      responses:
        '200':
          description: OK
    head:
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-methods.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(6);
      expect(routes.map(r => r.method).sort()).toEqual(["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"]);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse path and query parameters", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users/{userId}:
    get:
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
        - name: filter
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-params.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(1);
      expect(routes[0].parameters).toBeDefined();
      expect(routes[0].parameters).toHaveLength(2);
      const pathParam = routes[0].parameters!.find(p => p.name === "userId");
      const queryParam = routes[0].parameters!.find(p => p.name === "filter");
      expect(pathParam).toEqual({ name: "userId", in: "path", required: true, schema: { type: "string" } });
      expect(queryParam).toEqual({ name: "filter", in: "query", required: false, schema: { type: "string" } });
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse header and cookie parameters", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    get:
      parameters:
        - name: X-Token
          in: header
          required: true
          schema:
            type: string
        - name: session
          in: cookie
          required: false
          schema:
            type: string
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-header-cookie.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].parameters).toHaveLength(2);
      const headerParam = routes[0].parameters!.find(p => p.name === "X-Token");
      const cookieParam = routes[0].parameters!.find(p => p.name === "session");
      expect(headerParam?.in).toBe("header");
      expect(cookieParam?.in).toBe("cookie");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse request body schema", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                email:
                  type: string
      responses:
        '201':
          description: Created
`;
    const tempFile = path.join(__dirname, "temp-spec-request.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].requestSchema).toBeDefined();
      expect(routes[0].requestRequired).toBe(true);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should pick the first success response (2xx) as default", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /test:
    get:
      responses:
        '400':
          description: Bad Request
        '201':
          description: Created
        '200':
          description: OK
        '500':
          description: Internal Server Error
`;
    const tempFile = path.join(__dirname, "temp-spec-statuscode.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      // Should prefer 200 over 201
      expect(routes[0].statusCode).toBe(200);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should prefer 200 status code when available", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    post:
      responses:
        '201':
          description: Created
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-prefer-200.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].statusCode).toBe(200);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should handle multiple response schemas", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    get:
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
        '400':
          description: Bad Request
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: string
`;
    const tempFile = path.join(__dirname, "temp-spec-multi-responses.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].responses).toHaveLength(2);
      expect(routes[0].responses.map(r => r.statusCode)).toContain("200");
      expect(routes[0].responses.map(r => r.statusCode)).toContain("400");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse response examples", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              examples:
                standard:
                  value:
                    id: 123
                    name: Example
                premium:
                  value:
                    id: 456
                    name: Premium Example
`;
    const tempFile = path.join(__dirname, "temp-spec-examples.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].responseExamples).toBeDefined();
      expect(routes[0].responseExamples?.standard).toEqual({ id: 123, name: "Example" });
      expect(routes[0].responseExamples?.premium).toEqual({ id: 456, name: "Premium Example" });
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse summary and description", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    get:
      summary: Get a resource
      description: Retrieves a single resource by ID
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-summary-desc.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].summary).toBe("Get a resource");
      expect(routes[0].description).toBe("Retrieves a single resource by ID");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should parse response headers", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /resource:
    get:
      responses:
        '200':
          description: OK
          headers:
            X-Rate-Limit:
              example: '100'
            X-Rate-Limit-Remaining:
              example: '99'
`;
    const tempFile = path.join(__dirname, "temp-spec-resp-headers.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      expect(routes[0].responseHeaders).toBeDefined();
      expect(routes[0].responseHeaders?.["X-Rate-Limit"]).toBe("100");
      expect(routes[0].responseHeaders?.["X-Rate-Limit-Remaining"]).toBe("99");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should deduplicate parameters from path and operation levels", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users/{userId}:
    parameters:
      - name: userId
        in: path
        required: true
        schema:
          type: string
    get:
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-dedup-params.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes } = await parseOpenApiFile(tempFile);
      // Should deduplicate the userId parameter
      expect(routes[0].parameters).toHaveLength(1);
      expect(routes[0].parameters?.[0].name).toBe("userId");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should handle spec with no paths", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Empty API
  version: 1.0.0
paths: {}
`;
    const tempFile = path.join(__dirname, "temp-spec-empty-paths.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { routes, api } = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(0);
      expect(api.info.title).toBe("Empty API");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("should return API document in parse result", async () => {
    const spec = `
openapi: 3.0.0
info:
  title: Test API
  version: 2.0.0
  description: A test API
paths:
  /test:
    get:
      responses:
        '200':
          description: OK
`;
    const tempFile = path.join(__dirname, "temp-spec-api.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const { api } = await parseOpenApiFile(tempFile);
      expect(api.info.title).toBe("Test API");
      expect(api.info.version).toBe("2.0.0");
      expect(api.info.description).toBe("A test API");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
