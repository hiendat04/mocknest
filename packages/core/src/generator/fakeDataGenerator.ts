import { faker } from "@faker-js/faker";
import { OpenAPIV3 } from "openapi-types";

// Recursively maps a schema tree into representative fake payloads.
export function generateFakeData(
  schema: OpenAPIV3.SchemaObject | any,
  context?: Record<string, any>,
): any {
  if (!schema) return {};

  // Handle composition keywords
  if (schema.allOf) {
    return schema.allOf.reduce((acc: any, subSchema: any) => {
      const generated = generateFakeData(subSchema, context);
      return typeof generated === "object" && generated !== null
        ? { ...acc, ...generated }
        : generated;
    }, {});
  }

  if (schema.oneOf || schema.anyOf) {
    const list = schema.oneOf || schema.anyOf;
    const selected = list[Math.floor(Math.random() * list.length)];
    return generateFakeData(selected, context);
  }

  if (schema.type === "array") {
    const min = schema.minItems ?? 2;
    const max = schema.maxItems ?? Math.max(min, 5);
    const count = faker.number.int({ min, max });
    return Array.from({ length: count }, () =>
      generateFakeData(schema.items, context),
    );
  }

  if (schema.type === "object" || schema.properties) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(schema.properties || {})) {
      result[key] = generateValueFromField(
        key,
        value as OpenAPIV3.SchemaObject,
        context,
      );
    }
    return result;
  }

  return generateValueFromField("value", schema, context);
}

function generateValueFromField(
  fieldName: string,
  schema: OpenAPIV3.SchemaObject,
  context?: Record<string, any>,
): any {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  // Support custom x-faker extension
  const xFaker = (schema as any)["x-faker"];
  if (xFaker && typeof xFaker === "string") {
    try {
      const parts = xFaker.split(".");
      let generator: any = faker;
      for (const part of parts) {
        generator = generator[part];
      }
      if (typeof generator === "function") {
        return generator();
      }
    } catch {
      // Fallback
    }
  }

  // Use dynamic values from request context if field name matches.
  if (context && context[fieldName] !== undefined) {
    const contextValue = context[fieldName];
    // Basic type compatibility check to avoid putting strings in numbers, etc.
    if (schema.type === "number" || schema.type === "integer") {
      const num = Number(contextValue);
      if (!isNaN(num)) return num;
    } else if (schema.type === "boolean") {
      if (contextValue === "true" || contextValue === true) return true;
      if (contextValue === "false" || contextValue === false) return false;
    } else if (schema.type === "string" || !schema.type) {
      return String(contextValue);
    }
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[Math.floor(Math.random() * schema.enum.length)];
  }

  const name = fieldName.toLowerCase();

  if (schema.type === "string" && schema.pattern) {
    try {
      // Strip anchors if present, as Faker might include them literally.
      const pattern = schema.pattern.replace(/^\^/, "").replace(/\$$/, "");
      return faker.helpers.fromRegExp(new RegExp(pattern));
    } catch {
      // Fallback if pattern is invalid
    }
  }

  // Prefer 'format' for strings when available.
  if (schema.type === "string" && schema.format) {
    switch (schema.format) {
      case "email":
        return faker.internet.email();
      case "uuid":
        return faker.string.uuid();
      case "date-time":
        return faker.date.recent().toISOString();
      case "date":
        return faker.date.recent().toISOString().split("T")[0];
      case "ipv4":
        return faker.internet.ipv4();
      case "ipv6":
        return faker.internet.ipv6();
      case "uri":
      case "url":
        return faker.internet.url();
      case "password":
        return faker.internet.password();
      case "hostname":
        return faker.internet.domainName();
      case "byte":
        return faker.string.alphanumeric(schema.minLength || 10);
      case "binary":
        return faker.string.alphanumeric(schema.minLength || 20);
    }
  }

  // Prefer semantic values when field names hint at domain meaning.
  if (name.includes("email")) return faker.internet.email();
  if (name.includes("name") && name.includes("first"))
    return faker.person.firstName();
  if (name.includes("name") && name.includes("last"))
    return faker.person.lastName();
  if (name.includes("name")) return faker.person.fullName();
  if (name.includes("phone")) return faker.phone.number();
  if (name.includes("address")) return faker.location.streetAddress();
  if (name.includes("city")) return faker.location.city();
  if (name.includes("zip") || name.includes("postcode"))
    return faker.location.zipCode();
  if (name.includes("country")) return faker.location.country();
  if (name.includes("company")) return faker.company.name();
  if (name.includes("job") || name.includes("title"))
    return faker.person.jobTitle();
  if (name.includes("avatar") || name.includes("portrait"))
    return faker.image.avatar();
  if (name.includes("password")) return faker.internet.password();
  if (name.includes("username") || name.includes("user_name"))
    return faker.internet.username();
  if (name.includes("url") || name.includes("image")) return faker.image.url();
  if (name.includes("date") || name.includes("time"))
    return faker.date.recent().toISOString();
  if (name.includes("id")) return faker.string.uuid();
  if (name.includes("price") || name.includes("amount"))
    return faker.number.float({
      min: schema.minimum ?? 1,
      max: schema.maximum ?? 999,
      fractionDigits: 2,
    });
  if (name.includes("description") || name.includes("bio"))
    return faker.lorem.sentence();

  switch (schema.type) {
    case "string":
      if (schema.minLength !== undefined || schema.maxLength !== undefined) {
        return faker.string.alphanumeric({
          length: {
            min: schema.minLength ?? 1,
            max: schema.maxLength ?? Math.max(schema.minLength ?? 0, 20),
          },
        });
      }
      return faker.lorem.word();
    case "number":
    case "integer":
      const min = schema.minimum ?? 1;
      const max = schema.maximum ?? Math.max(min, 100);
      return schema.type === "integer"
        ? faker.number.int({ min, max })
        : faker.number.float({ min, max, fractionDigits: 2 });
    case "boolean":
      return faker.datatype.boolean();
    default:
      return null;
  }
}
