import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPI, OpenAPIV3 } from "openapi-types";

export interface ParsedRoute {
  method: string; 
  path: string; 
  summary?: string; 
  responseSchema?: any; 
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

    const methods = ["get", "post", "put", "delete", "patch"] as const;

    for (const method of methods) {
      const operation = pathItem[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) continue;

      const successResponse =
        operation.responses?.["200"] ||
        operation.responses?.["201"] ||
        operation.responses?.["204"];

      const statusCode = operation.responses?.["200"]
        ? 200
        : operation.responses?.["201"]
          ? 201
          : 204;

      const responseSchema = (successResponse as OpenAPIV3.ResponseObject)
        ?.content?.["application/json"]?.schema;

      routes.push({
        method: method.toUpperCase(),
        // Express expects :id while OpenAPI uses {id}.
        path: path.replace(/\{(\w+)\}/g, ":$1"),
        summary: operation.summary,
        responseSchema,
        statusCode,
      });
    }
  }

  return routes;
}
