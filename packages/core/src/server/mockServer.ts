import express, { Express, Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { OpenAPIV3 } from "openapi-types";
import { ParsedRoute } from "../parser/openApiParser";
import { generateFakeData } from "../generator/fakeDataGenerator";

export interface MockServerOptions {
  port: number;
  routes: ParsedRoute[];
  onRequest?: (method: string, path: string, statusCode: number) => void;
  delay?: number;
  errorRate?: number;
  strictValidation?: boolean;
}

export class MockServer {
  private app: Express;
  private server: Server | null = null;

  constructor(private options: MockServerOptions) {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.registerRoutes();
  }

  private registerRoutes() {
    for (const route of this.options.routes) {
      const method = route.method.toLowerCase() as keyof Express;

      // Dispatch handlers from the HTTP verb string in the parsed route.
      (this.app as any)[method](route.path, (req: Request, res: Response) => {
        const sendJson = (statusCode: number, payload: unknown): void => {
          setTimeout(() => {
            res.setHeader("Content-Type", "application/json");
            res.status(statusCode).send(JSON.stringify(payload, null, 2));
          }, this.options.delay ?? 20);
        };

        if (this.options.strictValidation) {
          const errors = validateRouteRequest(route, req);
          if (errors.length > 0) {
            this.options.onRequest?.(route.method, req.path, 400);
            sendJson(400, {
              error: "Request validation failed",
              details: errors,
            });
            return;
          }
        }

        const fakeBody = route.responseSchema
          ? generateFakeData(route.responseSchema)
          : {};

        // Chaos mode (error rate)
        if (this.options.errorRate && this.options.errorRate > 0) {
          const random = Math.random();
          if (random < this.options.errorRate) {
            this.options.onRequest?.(route.method, req.path, 500);
            sendJson(500, { error: "Internal Server Error (Simulated)" });
            return;
          }
        }

        this.options.onRequest?.(route.method, req.path, route.statusCode);

        // Artificial delay to simulate real network.
        sendJson(route.statusCode, fakeBody);
      });
    }

    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: "Route not mocked", path: req.path });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.options.port, () => {
        console.log(
          `MockNest running on http://localhost:${this.options.port}`,
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}

function validateRouteRequest(route: ParsedRoute, req: Request): string[] {
  const errors: string[] = [];

  for (const parameter of route.parameters ?? []) {
    const rawValue =
      parameter.in === "path"
        ? req.params[parameter.name]
        : req.query[parameter.name];

    const isMissing =
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim().length === 0);

    if (parameter.required && isMissing) {
      errors.push(`Missing required ${parameter.in} parameter '${parameter.name}'.`);
      continue;
    }

    if (isMissing || !parameter.schema || isReferenceObject(parameter.schema)) {
      continue;
    }

    errors.push(
      ...validateParameterValue(
        rawValue,
        parameter.schema,
        `${parameter.in}.${parameter.name}`,
      ),
    );
  }

  if (route.requestSchema && !isReferenceObject(route.requestSchema)) {
    const hasBody =
      req.body !== undefined &&
      req.body !== null &&
      !(typeof req.body === "string" && req.body.trim().length === 0);

    if (route.requestRequired && !hasBody) {
      errors.push("Missing required request body.");
    }

    if (hasBody) {
      errors.push(...validateSchemaValue(req.body, route.requestSchema, "body"));
    }
  }

  return errors;
}

function validateParameterValue(
  rawValue: unknown,
  schema: OpenAPIV3.SchemaObject,
  location: string,
): string[] {
  if (schema.type === "array") {
    const arrayValues = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string"
        ? rawValue.split(",").map((item) => item.trim())
        : [rawValue];

    if (schema.items && !isReferenceObject(schema.items)) {
      return arrayValues.flatMap((item, index) =>
        validateParameterValue(item, schema.items as OpenAPIV3.SchemaObject, `${location}[${index}]`),
      );
    }

    return [];
  }

  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const errors: string[] = [];

  if (schema.enum && !schema.enum.some((option) => String(option) === String(value))) {
    errors.push(
      `Invalid ${location}: expected one of [${schema.enum.join(", ")}], received '${String(value)}'.`,
    );
    return errors;
  }

  switch (schema.type) {
    case "integer": {
      const isInteger =
        typeof value === "number"
          ? Number.isInteger(value)
          : typeof value === "string" && /^-?\d+$/.test(value.trim());

      if (!isInteger) {
        errors.push(`Invalid ${location}: expected integer, received '${String(value)}'.`);
      }
      break;
    }
    case "number": {
      const parsed =
        typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(parsed)) {
        errors.push(`Invalid ${location}: expected number, received '${String(value)}'.`);
      }
      break;
    }
    case "boolean": {
      const asText = String(value).trim().toLowerCase();
      const validBoolean =
        typeof value === "boolean" || asText === "true" || asText === "false";
      if (!validBoolean) {
        errors.push(`Invalid ${location}: expected boolean, received '${String(value)}'.`);
      }
      break;
    }
    default:
      break;
  }

  return errors;
}

function validateSchemaValue(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  location: string,
): string[] {
  if (schema.nullable && value === null) {
    return [];
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    return [
      `Invalid ${location}: expected one of [${schema.enum.join(", ")}], received ${JSON.stringify(value)}.`,
    ];
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const matchedCount = schema.oneOf.filter((item) => {
      if (isReferenceObject(item)) {
        return true;
      }
      return validateSchemaValue(value, item, location).length === 0;
    }).length;

    if (matchedCount !== 1) {
      return [`Invalid ${location}: value must match exactly one schema variant.`];
    }
    return [];
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const matched = schema.anyOf.some((item) => {
      if (isReferenceObject(item)) {
        return true;
      }
      return validateSchemaValue(value, item, location).length === 0;
    });

    if (!matched) {
      return [`Invalid ${location}: value does not match any accepted schema variant.`];
    }
    return [];
  }

  if (schema.allOf && schema.allOf.length > 0) {
    return schema.allOf.flatMap((item) => {
      if (isReferenceObject(item)) {
        return [];
      }
      return validateSchemaValue(value, item, location);
    });
  }

  const inferredType = schema.type ?? inferSchemaType(schema);
  const errors: string[] = [];

  switch (inferredType) {
    case "object": {
      if (!isPlainObject(value)) {
        return [`Invalid ${location}: expected object.`];
      }

      for (const requiredKey of schema.required ?? []) {
        if (!(requiredKey in value)) {
          errors.push(`Missing required field ${location}.${requiredKey}.`);
        }
      }

      for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
        if (!(key in value) || isReferenceObject(propertySchema)) {
          continue;
        }

        errors.push(
          ...validateSchemaValue(
            (value as Record<string, unknown>)[key],
            propertySchema,
            `${location}.${key}`,
          ),
        );
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        return [`Invalid ${location}: expected array.`];
      }

      const arraySchema = asArraySchema(schema);
      if (!arraySchema) {
        return errors;
      }

      if (typeof arraySchema.minItems === "number" && value.length < arraySchema.minItems) {
        errors.push(`Invalid ${location}: expected at least ${arraySchema.minItems} items.`);
      }

      if (typeof arraySchema.maxItems === "number" && value.length > arraySchema.maxItems) {
        errors.push(`Invalid ${location}: expected at most ${arraySchema.maxItems} items.`);
      }

      if (arraySchema.items && !isReferenceObject(arraySchema.items)) {
        value.forEach((item, index) => {
          errors.push(...validateSchemaValue(item, arraySchema.items as OpenAPIV3.SchemaObject, `${location}[${index}]`));
        });
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        return [`Invalid ${location}: expected string.`];
      }

      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        errors.push(`Invalid ${location}: expected minimum length ${schema.minLength}.`);
      }

      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        errors.push(`Invalid ${location}: expected maximum length ${schema.maxLength}.`);
      }

      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push(`Invalid ${location}: value does not match required pattern.`);
        }
      }
      break;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return [`Invalid ${location}: expected integer.`];
      }

      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`Invalid ${location}: expected value >= ${schema.minimum}.`);
      }

      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`Invalid ${location}: expected value <= ${schema.maximum}.`);
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return [`Invalid ${location}: expected number.`];
      }

      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`Invalid ${location}: expected value >= ${schema.minimum}.`);
      }

      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`Invalid ${location}: expected value <= ${schema.maximum}.`);
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return [`Invalid ${location}: expected boolean.`];
      }
      break;
    }
    default:
      break;
  }

  return errors;
}

function inferSchemaType(schema: OpenAPIV3.SchemaObject): OpenAPIV3.NonArraySchemaObjectType | "array" | undefined {
  if (schema.properties || schema.required) {
    return "object";
  }
  if ("items" in schema) {
    return "array";
  }
  return undefined;
}

function asArraySchema(
  schema: OpenAPIV3.SchemaObject,
): OpenAPIV3.ArraySchemaObject | undefined {
  if (schema.type === "array" || "items" in schema) {
    return schema as OpenAPIV3.ArraySchemaObject;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenceObject(value: unknown): value is OpenAPIV3.ReferenceObject {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}
