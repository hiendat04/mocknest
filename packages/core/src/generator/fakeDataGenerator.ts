import { faker, Faker } from "@faker-js/faker";
import { OpenAPIV3 } from "openapi-types";

export interface FakeDataOptions {
  random?: () => number;
  faker?: Faker;
}

// Recursively maps a schema tree into representative fake payloads.
export function generateFakeData(
  schema: OpenAPIV3.SchemaObject | any,
  context?: Record<string, any>,
  options?: FakeDataOptions,
): any {
  if (!schema) return {};

  const rng = options?.random ?? Math.random;
  const fakerInstance = options?.faker ?? faker;

  const resolvedType = resolveSchemaType(schema, rng, fakerInstance);
  if (resolvedType === "null") {
    return null;
  }

  // Randomly return null if nullable (10% chance)
  if (schema.nullable && rng() < 0.1) {
    return null;
  }

  // Handle composition keywords
  if (schema.allOf) {
    return schema.allOf.reduce((acc: any, subSchema: any) => {
      const generated = generateFakeData(subSchema, context, options);
      return typeof generated === "object" && generated !== null
        ? { ...acc, ...generated }
        : generated;
    }, {});
  }

  if (schema.oneOf || schema.anyOf) {
    const list = schema.oneOf || schema.anyOf;
    const selected = list[Math.floor(rng() * list.length)];
    return generateFakeData(selected, context, options);
  }

  if (resolvedType === "array") {
    let count;
    // Simple pagination support: look for limit-related parameters in context
    const requestedLimit =
      context?.limit || context?.per_page || context?.pageSize || context?.size;
    const parsedLimit = parseInt(requestedLimit, 10);

    if (!isNaN(parsedLimit) && parsedLimit >= 0) {
      count = Math.min(parsedLimit, 50); // Safety cap to avoid huge payloads
    } else {
      const min = schema.minItems ?? 2;
      const max = schema.maxItems ?? Math.max(min, 5);
      count = fakerInstance.number.int({ min, max });
    }

    if (schema.uniqueItems) {
      const result = new Set();
      let attempts = 0;
      const maxAttempts = count * 2;
      while (result.size < count && attempts < maxAttempts) {
        result.add(generateFakeData(schema.items, context, options));
        attempts += 1;
      }
      return Array.from(result);
    }

    return Array.from({ length: count }, () =>
      generateFakeData(schema.items, context, options),
    );
  }

  if (resolvedType === "object" || schema.properties) {
    const result: Record<string, any> = {};
    const propertyEntries = Object.entries(schema.properties || {});
    for (const [key, value] of propertyEntries) {
      const propSchema = value as OpenAPIV3.SchemaObject;
      
      // Respect writeOnly: true by skipping it in responses.
      if (propSchema.writeOnly === true) {
        continue;
      }

      result[key] = generateValueFromField(
        key,
        propSchema,
        context,
        rng,
        fakerInstance,
      );
    }

    const additionalSchema = schema.additionalProperties;
    if (additionalSchema) {
      const propCount = propertyEntries.length;
      const minAdditional = Math.max(
        0,
        (schema.minProperties ?? propCount) - propCount,
      );
      const maxAdditional = schema.maxProperties !== undefined
        ? Math.max(minAdditional, schema.maxProperties - propCount)
        : Math.max(minAdditional, 3);
      const additionalCount = fakerInstance.number.int({
        min: minAdditional,
        max: maxAdditional,
      });
      const additionalValueSchema =
        additionalSchema === true ? {} : additionalSchema;

      let counter = 1;
      while (Object.keys(result).length < propCount + additionalCount) {
        const key = `extraField${counter}`;
        counter += 1;
        if (result[key] !== undefined) continue;
        result[key] = generateFakeData(additionalValueSchema, context, options);
      }
    }
    return result;
  }

  return generateValueFromField("value", schema, context, rng, fakerInstance);
}

function generateValueFromField(
  fieldName: string,
  schema: OpenAPIV3.SchemaObject,
  context?: Record<string, any>,
  rng: () => number = Math.random,
  fakerInstance: Faker = faker,
): any {
  const resolvedType = resolveSchemaType(schema, rng, fakerInstance);
  if (resolvedType === "null") return null;
  if (schema.nullable && rng() < 0.1) return null;
  const schemaExtras = schema as Record<string, any>;
  if (schemaExtras.const !== undefined) return schemaExtras.const;
  if (Array.isArray(schemaExtras.examples) && schemaExtras.examples.length > 0)
    return schemaExtras.examples[0];
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  // Support custom x-faker extension
  const xFaker = (schema as any)["x-faker"];
  if (xFaker && typeof xFaker === "string") {
    try {
      const parts = xFaker.split(".");
      let generator: any = fakerInstance;
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
    if (resolvedType === "number" || resolvedType === "integer") {
      const num = Number(contextValue);
      if (!isNaN(num)) return num;
    } else if (resolvedType === "boolean") {
      if (contextValue === "true" || contextValue === true) return true;
      if (contextValue === "false" || contextValue === false) return false;
    } else if (resolvedType === "string" || !resolvedType) {
      return String(contextValue);
    }
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[Math.floor(rng() * schema.enum.length)];
  }

  const name = fieldName.toLowerCase();

  if (resolvedType === "string" && schema.pattern) {
    try {
      // Strip anchors if present, as Faker might include them literally.
      const pattern = schema.pattern.replace(/^\^/, "").replace(/\$$/, "");
      return fakerInstance.helpers.fromRegExp(new RegExp(pattern));
    } catch {
      // Fallback if pattern is invalid
    }
  }

  // Prefer 'format' for strings when available.
  if (resolvedType === "string" && schema.format) {
    switch (schema.format) {
      case "email":
        return fakerInstance.internet.email();
      case "uuid":
        return fakerInstance.string.uuid();
      case "date-time":
        return fakerInstance.date.recent().toISOString();
      case "date":
        return fakerInstance.date.recent().toISOString().split("T")[0];
      case "ipv4":
        return fakerInstance.internet.ipv4();
      case "ipv6":
        return fakerInstance.internet.ipv6();
      case "uri":
      case "url":
        return fakerInstance.internet.url();
      case "password":
        return fakerInstance.internet.password();
      case "hostname":
        return fakerInstance.internet.domainName();
      case "byte":
        return fakerInstance.string.alphanumeric(schema.minLength || 10);
      case "binary":
        return fakerInstance.string.alphanumeric(schema.minLength || 20);
    }
  }

  // Prefer semantic values when field names hint at domain meaning.
  if (name.includes("email")) return fakerInstance.internet.email();
  if (name.includes("name") && name.includes("first"))
    return fakerInstance.person.firstName();
  if (name.includes("name") && name.includes("last"))
    return fakerInstance.person.lastName();
  if (name.includes("name")) return fakerInstance.person.fullName();
  if (name.includes("phone")) return fakerInstance.phone.number();
  if (name.includes("address")) return fakerInstance.location.streetAddress();
  if (name.includes("city")) return fakerInstance.location.city();
  if (name.includes("zip") || name.includes("postcode"))
    return fakerInstance.location.zipCode();
  if (name.includes("country")) return fakerInstance.location.country();
  if (name.includes("company")) return fakerInstance.company.name();
  if (name.includes("job") || name.includes("title"))
    return fakerInstance.person.jobTitle();
  if (name.includes("avatar") || name.includes("portrait"))
    return fakerInstance.image.avatar();
  if (name.includes("password")) return fakerInstance.internet.password();
  if (name.includes("username") || name.includes("user_name"))
    return fakerInstance.internet.username();
  if (name.includes("url") || name.includes("image"))
    return fakerInstance.image.url();
  if (name.includes("date") || name.includes("time"))
    return fakerInstance.date.recent().toISOString();
  if (name.includes("id")) return fakerInstance.string.uuid();
  if (name.includes("price") || name.includes("amount"))
    return fakerInstance.number.float({
      min: schema.minimum ?? 1,
      max: schema.maximum ?? 999,
      fractionDigits: 2,
    });
  if (name.includes("description") || name.includes("bio"))
    return fakerInstance.lorem.sentence();

  switch (resolvedType) {
    case "string":
      if (schema.minLength !== undefined || schema.maxLength !== undefined) {
        return fakerInstance.string.alphanumeric({
          length: {
            min: schema.minLength ?? 1,
            max: schema.maxLength ?? Math.max(schema.minLength ?? 0, 20),
          },
        });
      }
      return fakerInstance.lorem.word();
    case "number":
    case "integer":
      const min = schema.minimum ?? 1;
      const max = schema.maximum ?? Math.max(min, 100);
      return resolvedType === "integer"
        ? fakerInstance.number.int({ min, max })
        : fakerInstance.number.float({ min, max, fractionDigits: 2 });
    case "boolean":
      return fakerInstance.datatype.boolean();
    default:
      return null;
  }
}

function resolveSchemaType(
  schema: OpenAPIV3.SchemaObject,
  rng: () => number = Math.random,
  fakerInstance: Faker = faker,
): string | undefined {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== "null");
    if (schema.type.includes("null") && rng() < 0.1) {
      return "null";
    }
    if (types.length > 0) {
      return fakerInstance.helpers.arrayElement(types);
    }
    return undefined;
  }

  return schema.type;
}
