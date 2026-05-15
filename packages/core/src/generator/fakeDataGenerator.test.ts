import { describe, it, expect } from "vitest";
import { generateFakeData } from "./fakeDataGenerator";

describe("fakeDataGenerator", () => {
  it("should generate a string for a string type", () => {
    const schema = { type: "string" };
    const result = generateFakeData(schema);
    expect(typeof result).toBe("string");
  });

  it("should generate a number for a number type", () => {
    const schema = { type: "number" };
    const result = generateFakeData(schema);
    expect(typeof result).toBe("number");
  });

  it("should generate a boolean for a boolean type", () => {
    const schema = { type: "boolean" };
    const result = generateFakeData(schema);
    expect(typeof result).toBe("boolean");
  });

  it("should generate an object with properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    };
    const result = generateFakeData(schema);
    expect(result).toHaveProperty("name");
    expect(typeof result.name).toBe("string");
    expect(result).toHaveProperty("age");
    expect(typeof result.age).toBe("number");
  });

  it("should generate an array of items", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
    };
    const result = generateFakeData(schema);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(5);
    result.forEach((item: any) => {
      expect(typeof item).toBe("string");
    });
  });

  it("should use semantic generators based on field name", () => {
    const schema = {
      type: "object",
      properties: {
        email: { type: "string" },
        id: { type: "string" },
        zipCode: { type: "string" },
        country: { type: "string" },
        avatar: { type: "string" },
      },
    };
    const result = generateFakeData(schema);
    expect(result.email).toContain("@");
    // UUID check (simple regex)
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.zipCode).toBeDefined();
    expect(result.country).toBeDefined();
    expect(result.avatar).toContain("http");
  });

  it("should handle enum values", () => {
    const schema = {
      type: "string",
      enum: ["red", "green", "blue"],
    };
    const result = generateFakeData(schema);
    expect(["red", "green", "blue"]).toContain(result);
  });

  it("should use 'example' value if provided", () => {
    const schema = {
      type: "string",
      example: "custom-example",
    };
    const result = generateFakeData(schema);
    expect(result).toBe("custom-example");
  });

  it("should use 'default' value if provided and no example", () => {
    const schema = {
      type: "string",
      default: "default-value",
    };
    const result = generateFakeData(schema);
    expect(result).toBe("default-value");
  });

  it("should respect 'format' property for strings", () => {
    const schemas = [
      { type: "string", format: "email" },
      { type: "string", format: "uuid" },
      { type: "string", format: "date-time" },
      { type: "string", format: "ipv4" },
    ];

    expect(generateFakeData(schemas[0])).toContain("@");
    expect(generateFakeData(schemas[1])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(new Date(generateFakeData(schemas[2])).toString()).not.toBe(
      "Invalid Date",
    );
    expect(generateFakeData(schemas[3])).toMatch(
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    );
  });

  it("should prefer 'format' over field name heuristics", () => {
    const objSchema = {
      type: "object",
      properties: {
        email_address: { type: "string", format: "uuid" },
      },
    };
    const result = generateFakeData(objSchema);
    expect(result.email_address).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
