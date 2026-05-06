import { faker } from "@faker-js/faker";
import { OpenAPIV3 } from "openapi-types";

// Recursively maps a schema tree into representative fake payloads.
export function generateFakeData(schema: OpenAPIV3.SchemaObject | any): any {
  if (!schema) return {};

  if (schema.type === "array") {
    const count = faker.number.int({ min: 2, max: 5 });
    return Array.from({ length: count }, () => generateFakeData(schema.items));
  }

  if (schema.type === "object" || schema.properties) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(schema.properties || {})) {
      result[key] = generateValueFromField(
        key,
        value as OpenAPIV3.SchemaObject,
      );
    }
    return result;
  }

  return generateValueFromField("value", schema);
}

function generateValueFromField(
  fieldName: string,
  schema: OpenAPIV3.SchemaObject,
): any {
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[Math.floor(Math.random() * schema.enum.length)];
  }

  const name = fieldName.toLowerCase();

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
  if (name.includes("url") || name.includes("image")) return faker.image.url();
  if (name.includes("date") || name.includes("time"))
    return faker.date.recent().toISOString();
  if (name.includes("id")) return faker.string.uuid();
  if (name.includes("price") || name.includes("amount"))
    return faker.number.float({ min: 1, max: 999, fractionDigits: 2 });
  if (name.includes("description") || name.includes("bio"))
    return faker.lorem.sentence();

  switch (schema.type) {
    case "string":
      return faker.lorem.word();
    case "number":
    case "integer":
      return faker.number.int({ min: 1, max: 100 });
    case "boolean":
      return faker.datatype.boolean();
    default:
      return null;
  }
}
