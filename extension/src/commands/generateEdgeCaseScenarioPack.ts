import * as vscode from "vscode";
import {
  generateFakeData,
  type ParsedRoute,
  type ResponseOverrideRule,
} from "mocknest-core";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

interface EdgeCaseScenarioPack {
  version: "1.0";
  timestamp: string;
  source: "edge-case-generator";
  metadata: {
    selectorHeader: string;
    routeCount: number;
    scenarioCount: number;
    generatedKinds: string[];
  };
  overrides: ResponseOverrideRule[];
  state: Record<string, never>;
}

type ParsedResponse = ParsedRoute["responses"][number];
type ScenarioKind = "documented-error" | "empty-state" | "slow-response" | "invalid-request";

const SELECTOR_HEADER = "x-mock-case";
const SLOW_RESPONSE_DELAY_MS = 1500;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH"]);

export async function generateEdgeCaseScenarioPackCommand(
  routeTreeProvider: RouteTreeProvider,
): Promise<void> {
  const routes = routeTreeProvider.getRoutes();
  if (routes.length === 0) {
    vscode.window.showInformationMessage(
      "No MockNest routes loaded. Select an OpenAPI spec or start the mock server first.",
    );
    return;
  }

  const pack = buildEdgeCaseScenarioPack({
    routes,
    generatedAt: new Date(),
  });

  if (pack.overrides.length === 0) {
    vscode.window.showInformationMessage(
      "No edge-case scenarios could be generated from the loaded spec. Add response schemas or documented error statuses first.",
    );
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = workspaceRoot
    ? vscode.Uri.joinPath(workspaceRoot, "mocknest-edge-cases.json")
    : undefined;

  const fileUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { JSON: ["json"] },
    title: "Generate MockNest Edge Case Scenario Pack",
  });

  if (!fileUri) {
    return;
  }

  await vscode.workspace.fs.writeFile(
    fileUri,
    Buffer.from(JSON.stringify(pack, null, 2), "utf-8"),
  );
  vscode.window.showInformationMessage(
    `Generated ${pack.overrides.length} edge-case scenario(s). Import the pack, then send ${SELECTOR_HEADER} to activate one.`,
  );
}

export function buildEdgeCaseScenarioPack(options: {
  routes: ParsedRoute[];
  generatedAt: Date;
}): EdgeCaseScenarioPack {
  const overrides = options.routes.flatMap(createRouteEdgeCases);
  const generatedKinds = Array.from(
    new Set(overrides.map((override) => classifyScenarioKind(override))),
  ).sort();

  return {
    version: "1.0",
    timestamp: options.generatedAt.toISOString(),
    source: "edge-case-generator",
    metadata: {
      selectorHeader: SELECTOR_HEADER,
      routeCount: options.routes.length,
      scenarioCount: overrides.length,
      generatedKinds,
    },
    overrides,
    state: {},
  };
}

function createRouteEdgeCases(route: ParsedRoute): ResponseOverrideRule[] {
  const scenarios: ResponseOverrideRule[] = [];
  scenarios.push(...createDocumentedErrorScenarios(route));

  const emptyState = createEmptyStateScenario(route);
  if (emptyState) {
    scenarios.push(emptyState);
  }

  const slowResponse = createSlowResponseScenario(route);
  if (slowResponse) {
    scenarios.push(slowResponse);
  }

  const invalidRequest = createInvalidRequestScenario(route);
  if (invalidRequest) {
    scenarios.push(invalidRequest);
  }

  return scenarios;
}

function createDocumentedErrorScenarios(route: ParsedRoute): ResponseOverrideRule[] {
  return route.responses
    .filter((response) => responseIsError(response))
    .map((response) => {
      const statusCode = normalizeStatusCode(response.statusCode, 500);
      const caseId = createCaseId(route, "error", response.statusCode);
      return createScenario({
        route,
        caseId,
        name: `Edge: ${route.method} ${route.path} documented ${response.statusCode}`,
        statusCode,
        body: createResponseBody(route, response, statusCode),
      });
    });
}

function createEmptyStateScenario(route: ParsedRoute): ResponseOverrideRule | undefined {
  if (route.method.toUpperCase() !== "GET") {
    return undefined;
  }

  const response = findPrimarySuccessResponse(route);
  if (!response || !response.schema || !schemaLooksLikeCollection(response.schema)) {
    return undefined;
  }

  const statusCode = normalizeStatusCode(response.statusCode, route.statusCode);
  const caseId = createCaseId(route, "empty", String(statusCode));
  return createScenario({
    route,
    caseId,
    name: `Edge: ${route.method} ${route.path} empty state`,
    statusCode,
    body: createEmptyBody(response.schema),
  });
}

function createSlowResponseScenario(route: ParsedRoute): ResponseOverrideRule | undefined {
  const response = findPrimarySuccessResponse(route);
  if (!response && route.statusCode === 204) {
    return createScenario({
      route,
      caseId: createCaseId(route, "slow", "204"),
      name: `Edge: ${route.method} ${route.path} slow 204`,
      statusCode: 204,
      delay: SLOW_RESPONSE_DELAY_MS,
    });
  }

  if (!response) {
    return undefined;
  }

  const statusCode = normalizeStatusCode(response.statusCode, route.statusCode);
  const caseId = createCaseId(route, "slow", String(statusCode));
  return createScenario({
    route,
    caseId,
    name: `Edge: ${route.method} ${route.path} slow response`,
    statusCode,
    delay: SLOW_RESPONSE_DELAY_MS,
    body: createResponseBody(route, response, statusCode),
  });
}

function createInvalidRequestScenario(route: ParsedRoute): ResponseOverrideRule | undefined {
  const method = route.method.toUpperCase();
  const hasRequiredParameter = (route.parameters ?? []).some(
    (parameter) => parameter.required,
  );
  if (!MUTATION_METHODS.has(method) && !hasRequiredParameter) {
    return undefined;
  }

  const caseId = createCaseId(route, "invalid-request", "400");
  return createScenario({
    route,
    caseId,
    name: `Edge: ${route.method} ${route.path} invalid request`,
    statusCode: 400,
    body: {
      error: "Invalid request",
      message: `Generated edge case for ${route.method} ${route.path}.`,
      caseId,
    },
  });
}

function createScenario(options: {
  route: ParsedRoute;
  caseId: string;
  name: string;
  statusCode: number;
  body?: unknown;
  delay?: number;
}): ResponseOverrideRule {
  const scenario: ResponseOverrideRule = {
    id: options.caseId,
    name: options.name,
    method: options.route.method.toUpperCase(),
    path: options.route.path,
    match: {
      headers: {
        [SELECTOR_HEADER]: options.caseId,
      },
    },
    response: {
      statusCode: options.statusCode,
    },
  };

  if (options.body !== undefined && options.statusCode !== 204) {
    scenario.response.body = options.body;
  }
  if (options.delay !== undefined) {
    scenario.response.delay = options.delay;
  }

  return scenario;
}

function findPrimarySuccessResponse(route: ParsedRoute): ParsedResponse | undefined {
  const explicit = route.responses.find(
    (response) => normalizeStatusCode(response.statusCode, 0) === route.statusCode,
  );
  if (explicit) {
    return explicit;
  }

  return route.responses.find((response) => responseStatusFamily(response.statusCode) === 2);
}

function createResponseBody(
  route: ParsedRoute,
  response: ParsedResponse | undefined,
  statusCode: number,
): unknown {
  const example = firstExample(response?.examples);
  if (example !== undefined) {
    return example;
  }

  if (response?.schema && !isReferenceObject(response.schema)) {
    try {
      return generateFakeData(response.schema, undefined, {
        random: () => 0.42,
      });
    } catch {
      // Fall through to generic body.
    }
  }

  return genericBodyForStatus(route, statusCode);
}

function createEmptyBody(schema: unknown): unknown {
  if (!schema || isReferenceObject(schema)) {
    return [];
  }

  const schemaObject = schema as Record<string, unknown>;
  if (inferSchemaType(schemaObject) === "array") {
    return [];
  }

  const properties = schemaObject.properties;
  if (isPlainObject(properties)) {
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        inferSchemaType(value as Record<string, unknown>) === "array" ? [] : null,
      ]),
    );
  }

  return [];
}

function genericBodyForStatus(route: ParsedRoute, statusCode: number): unknown {
  const messageByStatus: Record<number, string> = {
    400: "Invalid request",
    401: "Authentication required",
    403: "Permission denied",
    404: "Resource not found",
    409: "Conflict",
    422: "Validation failed",
    429: "Rate limit exceeded",
    500: "Internal server error",
    502: "Bad gateway",
    503: "Service unavailable",
  };

  return {
    error: messageByStatus[statusCode] ?? "Edge case response",
    statusCode,
    route: `${route.method.toUpperCase()} ${route.path}`,
  };
}

function firstExample(examples: Record<string, unknown> | undefined): unknown {
  if (!examples) {
    return undefined;
  }
  const firstKey = Object.keys(examples)[0];
  return firstKey ? examples[firstKey] : undefined;
}

function responseIsError(response: ParsedResponse): boolean {
  if (response.statusCode === "default") {
    return true;
  }
  const family = responseStatusFamily(response.statusCode);
  return family === 4 || family === 5;
}

function schemaLooksLikeCollection(schema: unknown): boolean {
  if (!schema || isReferenceObject(schema)) {
    return false;
  }

  const schemaObject = schema as Record<string, unknown>;
  if (inferSchemaType(schemaObject) === "array") {
    return true;
  }

  const properties = schemaObject.properties;
  return Boolean(
    isPlainObject(properties) &&
      Object.values(properties).some(
        (value) =>
          isPlainObject(value) &&
          inferSchemaType(value as Record<string, unknown>) === "array",
      ),
  );
}

function normalizeStatusCode(statusCode: string, fallback: number): number {
  if (statusCode === "default") {
    return fallback;
  }
  if (/^\dXX$/i.test(statusCode)) {
    return Number(`${statusCode[0]}00`);
  }
  const parsed = Number(statusCode);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function responseStatusFamily(statusCode: string): number | undefined {
  if (/^\dXX$/i.test(statusCode)) {
    return Number(statusCode[0]);
  }
  if (/^\d{3}$/.test(statusCode)) {
    return Math.floor(Number(statusCode) / 100);
  }
  return undefined;
}

function inferSchemaType(schema: Record<string, unknown>): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find(
      (type): type is string => typeof type === "string" && type !== "null",
    );
  }
  if (typeof schema.type === "string") {
    return schema.type;
  }
  if (schema.properties || schema.required) {
    return "object";
  }
  if (schema.items) {
    return "array";
  }
  return undefined;
}

function classifyScenarioKind(override: ResponseOverrideRule): ScenarioKind {
  const id = override.id ?? "";
  if (id.includes(":empty:")) return "empty-state";
  if (id.includes(":slow:")) return "slow-response";
  if (id.includes(":invalid-request:")) return "invalid-request";
  return "documented-error";
}

function createCaseId(route: ParsedRoute, kind: string, detail: string): string {
  return [
    "edge",
    route.method.toLowerCase(),
    slugify(route.path),
    kind,
    slugify(detail),
  ].join(":");
}

function slugify(value: string): string {
  return value
    .replace(/^\/+/, "")
    .replace(/:("[^"]+"|[A-Za-z0-9_$]+)/g, (_match, rawName: string) =>
      normalizeExpressParameterName(rawName),
    )
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "root";
}

function normalizeExpressParameterName(rawName: string): string {
  if (rawName.startsWith('"') && rawName.endsWith('"')) {
    return rawName.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return rawName;
}

function isReferenceObject(value: unknown): value is { $ref: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}
