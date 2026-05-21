import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";

export interface ParsedParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description?: string;
  schema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}

export interface ParsedResponse {
  statusCode: string;
  description?: string;
  schema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  headers?: Record<string, string>;
  examples?: Record<string, any>;
}

export interface ParsedRoute {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParsedParameter[];
  requestSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  requestRequired?: boolean;
  responseSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  responseDescription?: string;
  responseHeaders?: Record<string, string>;
  responseExamples?: Record<string, any>;
  responses: ParsedResponse[];
  statusCode: number;
  mockDelay?: number;
  mockStatusCode?: number;
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

      const mockDelay = (operation as any)["x-mock-delay"];
      const mockStatusCode = (operation as any)["x-mock-status"];

      const { statusCode, response } = pickSuccessResponse(operation.responses);
      const responseSchema = response?.content?.["application/json"]?.schema;
      const responseHeaders: Record<string, string> = {};

      if (response?.headers) {
        for (const [name, header] of Object.entries(response.headers)) {
          if (!isReferenceObject(header) && header.example) {
            responseHeaders[name] = String(header.example);
          }
        }
      }

      const responseExamples: Record<string, any> = {};
      const primaryExamples = response?.content?.["application/json"]?.examples;
      if (primaryExamples) {
        for (const [eName, eValue] of Object.entries(primaryExamples)) {
          if (!isReferenceObject(eValue)) {
            responseExamples[eName] = eValue.value;
          }
        }
      }

      const allResponses: ParsedResponse[] = [];
      if (operation.responses) {
        for (const [code, resp] of Object.entries(operation.responses)) {
          if (isReferenceObject(resp)) continue;

          const headers: Record<string, string> = {};
          if (resp.headers) {
            for (const [hName, hValue] of Object.entries(resp.headers)) {
              if (!isReferenceObject(hValue) && hValue.example) {
                headers[hName] = String(hValue.example);
              }
            }
          }

          const examples: Record<string, any> = {};
          const exampleMap = resp.content?.["application/json"]?.examples;
          if (exampleMap) {
            for (const [eName, eValue] of Object.entries(exampleMap)) {
              if (!isReferenceObject(eValue)) {
                examples[eName] = eValue.value;
              }
            }
          }

          allResponses.push({
            statusCode: code,
            description: resp.description,
            schema: resp.content?.["application/json"]?.schema,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            examples: Object.keys(examples).length > 0 ? examples : undefined,
          });
        }
      }

      const requestBody = operation.requestBody as
        | OpenAPIV3.RequestBodyObject
        | undefined;
      const requestSchema = requestBody?.content?.["application/json"]?.schema;

      const pathParameters = (pathItem.parameters ||
        []) as OpenAPIV3.ParameterObject[];
      const operationParameters = (operation.parameters ||
        []) as OpenAPIV3.ParameterObject[];
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
        tags: operation.tags,
        parameters,
        requestSchema,
        requestRequired: requestBody?.required,
        responseSchema,
        responseDescription: response?.description,
        responseHeaders:
          Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
        responseExamples:
          Object.keys(responseExamples).length > 0 ? responseExamples : undefined,
        responses: allResponses,
        statusCode,
        mockDelay: typeof mockDelay === "number" ? mockDelay : undefined,
        mockStatusCode: typeof mockStatusCode === "number" ? mockStatusCode : undefined,
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

    if (
      parameter.in !== "path" &&
      parameter.in !== "query" &&
      parameter.in !== "header" &&
      parameter.in !== "cookie"
    ) {
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
