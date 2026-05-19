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

  it("should respect minItems and maxItems for arrays", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
      minItems: 10,
      maxItems: 10,
    };
    const result = generateFakeData(schema);
    expect(result).toHaveLength(10);
  });

  it("should respect minimum and maximum for numbers", () => {
    const schema = {
      type: "number",
      minimum: 50,
      maximum: 55,
    };
    const result = generateFakeData(schema);
    expect(result).toBeGreaterThanOrEqual(50);
    expect(result).toBeLessThanOrEqual(55);
  });

  it("should respect minLength and maxLength for strings", () => {
    const schema = {
      type: "string",
      minLength: 50,
      maxLength: 60,
    };
    const result = generateFakeData(schema);
    expect(result.length).toBeGreaterThanOrEqual(50);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it("should respect pattern for strings", () => {
    const schema = {
      type: "string",
      pattern: "^[0-9]{3}-[A-Z]{3}$",
    };
    const result = generateFakeData(schema);
    expect(result).toMatch(/^[0-9]{3}-[A-Z]{3}$/);
  });

  it("should handle allOf by merging schemas", () => {
    const schema = {
      allOf: [
        {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
        },
        { type: "object", properties: { name: { type: "string" } } },
      ],
    };
    const result = generateFakeData(schema);
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("name");
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should handle oneOf by picking one schema", () => {
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", example: "cat" },
            meow: { type: "boolean" },
          },
        },
        {
          type: "object",
          properties: {
            type: { type: "string", example: "dog" },
            bark: { type: "boolean" },
          },
        },
      ],
    };
    const result = generateFakeData(schema);
    if (result.type === "cat") {
      expect(result).toHaveProperty("meow");
    } else {
      expect(result).toHaveProperty("bark");
    }
  });

  it("should handle x-faker extension for custom generators", () => {
    const schema = {
      type: "object",
      properties: {
        customEmail: { type: "string", "x-faker": "internet.email" },
        fullName: { type: "string", "x-faker": "person.fullName" },
      },
    };
    const result = generateFakeData(schema);
    expect(result.customEmail).toContain("@");
    expect(result.fullName).toContain(" ");
  });

  it("should respect pagination limit from context", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
    };
    const result = generateFakeData(schema, { limit: 10 });
    expect(result).toHaveLength(10);

    const result2 = generateFakeData(schema, { per_page: 3 });
    expect(result2).toHaveLength(3);
  });
});
