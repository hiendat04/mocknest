import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";

export interface ParsedParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}

export interface ParsedRoute {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters?: ParsedParameter[];
  requestSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  requestRequired?: boolean;
  responseSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  responseDescription?: string;
  statusCode: number;
}

export async function parseOpenApiFile(
  filePath: string,
): Promise<ParsedRoute[]> {
  // Dereference upfront so downstream logic can read concrete schemas.
  const api = (await SwaggerParser.dereference(filePath)) as OpenAPIV3.Document;

  const routes: ParsedRoute[] = [];

  for (const [path, pathItem] of Object.entries(api.paths || {})) {
    if (!pathItem) continue;

    const methods = ["get", "post", "put", "delete", "patch", "head"] as const;

    for (const method of methods) {
      const operation = pathItem[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) continue;

      const { statusCode, response } = pickSuccessResponse(operation.responses);
      const responseSchema = response?.content?.["application/json"]?.schema;

      const requestBody = operation.requestBody as
        | OpenAPIV3.RequestBodyObject
        | undefined;
      const requestSchema = requestBody?.content?.["application/json"]?.schema;

      const pathParameters = (pathItem.parameters || []) as OpenAPIV3.ParameterObject[];
      const operationParameters =
        (operation.parameters || []) as OpenAPIV3.ParameterObject[];
      const parameters = normalizeParameters([
        ...pathParameters,
        ...operationParameters,
      ]);

      routes.push({
        method: method.toUpperCase(),
        // Express expects :id while OpenAPI uses {id}.
        path: path.replace(/\{(\w+)\}/g, ":$1"),
        summary: operation.summary,
        description: operation.description,
        parameters,
        requestSchema,
        requestRequired: requestBody?.required,
        responseSchema,
        responseDescription: response?.description,
        statusCode,
      });
    }
  }

  return routes;
}

function pickSuccessResponse(
  responses: OpenAPIV3.ResponsesObject | undefined,
): { statusCode: number; response?: OpenAPIV3.ResponseObject } {
  if (!responses) {
    return { statusCode: 200 };
  }

  const preferredCodes = ["200", "201", "202", "204"];
  for (const code of preferredCodes) {
    const candidate = responses[code];
    if (candidate && !isReferenceObject(candidate)) {
      return {
        statusCode: Number(code),
        response: candidate,
      };
    }
  }

  const first2xx = Object.entries(responses)
    .filter(([code, value]) => /^2\d\d$/.test(code) && value)
    .sort(([left], [right]) => Number(left) - Number(right))[0];

  if (first2xx) {
    const [code, value] = first2xx;
    if (!isReferenceObject(value)) {
      return {
        statusCode: Number(code),
        response: value,
      };
    }
  }

  return { statusCode: 200 };
}

function normalizeParameters(
  parameters: OpenAPIV3.ParameterObject[],
): ParsedParameter[] | undefined {
  const deduped = new Map<string, ParsedParameter>();

  for (const parameter of parameters) {
    if (!parameter || isReferenceObject(parameter)) {
      continue;
    }

    if (parameter.in !== "path" && parameter.in !== "query") {
      continue;
    }

    const key = `${parameter.in}:${parameter.name}`;
    deduped.set(key, {
      name: parameter.name,
      in: parameter.in,
      required: Boolean(parameter.required),
      description: parameter.description,
      schema: parameter.schema,
    });
  }

  if (deduped.size === 0) {
    return undefined;
  }

  return [...deduped.values()];
}

function isReferenceObject(value: unknown): value is OpenAPIV3.ReferenceObject {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}
