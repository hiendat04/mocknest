import { describe, it, expect } from "vitest";
import { parseOpenApiFile } from "./openApiParser";
import * as path from "path";
import * as fs from "fs";

describe("openApiParser", () => {
  it("should parse tags from operation", async () => {
    // Create a temporary OpenAPI file
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
    const tempFile = path.join(__dirname, "temp-spec.yaml");
    fs.writeFileSync(tempFile, spec);

    try {
      const routes = await parseOpenApiFile(tempFile);
      expect(routes).toHaveLength(1);
      expect(routes[0].tags).toEqual(["user", "profile"]);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
