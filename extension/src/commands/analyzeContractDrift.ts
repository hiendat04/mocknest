import * as vscode from "vscode";
import type { ParsedRoute } from "mocknest-core";
import type { RequestLogEntry } from "../providers/requestLogProvider";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

interface DriftFinding {
  entry: RequestLogEntry;
  route?: ParsedRoute;
  severity: "pass" | "warn" | "fail";
  signals: string[];
  details: string[];
}

interface SchemaIssue {
  path: string;
  message: string;
}

type SchemaLike = Record<string, any>;
type ParsedResponse = ParsedRoute["responses"][number];

const SPEC_PATH_STATE_KEY = "mocknest.specPath";

export async function analyzeContractDriftCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
  requestLogEntries: RequestLogEntry[],
): Promise<void> {
  const routes = routeTreeProvider.getRoutes();
  if (routes.length === 0) {
    vscode.window.showInformationMessage(
      "No MockNest routes loaded. Select an OpenAPI spec or start the mock server first.",
    );
    return;
  }

  if (requestLogEntries.length === 0) {
    vscode.window.showInformationMessage(
      "No request log entries available. Send traffic through MockNest first.",
    );
    return;
  }

  const report = buildContractDriftReport({
    routes,
    requestLogEntries,
    specPath: context.workspaceState.get<string>(SPEC_PATH_STATE_KEY),
    generatedAt: new Date(),
  });

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: report,
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

export function buildContractDriftReport(options: {
  routes: ParsedRoute[];
  requestLogEntries: RequestLogEntry[];
  specPath?: string;
  generatedAt: Date;
}): string {
  const findings = options.requestLogEntries.map((entry) =>
    analyzeEntry(entry, options.routes),
  );
  const failures = findings.filter((finding) => finding.severity === "fail");
  const warnings = findings.filter((finding) => finding.severity === "warn");
  const passes = findings.filter((finding) => finding.severity === "pass");
  const unmatched = findings.filter((finding) => !finding.route);
  const schemaIssues = findings.reduce(
    (count, finding) =>
      count + finding.details.filter((detail) => detail.includes("schema")).length,
    0,
  );

  const lines = [
    "# MockNest Contract Drift Report",
    "",
    `Generated: ${options.generatedAt.toISOString()}`,
    options.specPath ? `Spec: ${options.specPath}` : "Spec: not selected",
    "",
    "## Summary",
    "",
    `- Request log entries analyzed: ${findings.length}`,
    `- Passing entries: ${passes.length}`,
    `- Warnings: ${warnings.length}`,
    `- Failures: ${failures.length}`,
    `- Unmatched requests: ${unmatched.length}`,
    `- Schema issue count: ${schemaIssues}`,
    "",
    "## Findings",
    "",
    "| Signal | Request | Status | Contract Route | Details |",
    "| --- | --- | ---: | --- | --- |",
    ...findings.map(renderFindingRow),
    "",
  ];

  if (failures.length > 0) {
    lines.push(
      "## High Priority Failures",
      "",
      ...failures.map(renderFindingListItem),
      "",
    );
  }

  if (warnings.length > 0) {
    lines.push(
      "## Warnings",
      "",
      ...warnings.map(renderFindingListItem),
      "",
    );
  }

  lines.push(
    "## How To Use This",
    "",
    "- Treat failures as contract drift before merging API-facing changes.",
    "- Investigate warnings where MockNest could not validate a schema because the OpenAPI response is not documented.",
    "- Generate replay scenarios from suspicious request-log entries when you need a reproducible bug fixture.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function analyzeEntry(entry: RequestLogEntry, routes: ParsedRoute[]): DriftFinding {
  const route = routes.find(
    (candidate) =>
      candidate.method.toUpperCase() === entry.method.toUpperCase() &&
      matchesRoutePath(candidate.path, entry.path),
  );

  if (!route) {
    return {
      entry,
      severity: "fail",
      signals: ["Route missing"],
      details: ["No OpenAPI route matched this request path and method."],
    };
  }

  const signals: string[] = [];
  const details: string[] = [];
  const documentedResponse = findDocumentedResponse(route, entry.statusCode);
  if (!documentedResponse) {
    signals.push("Undocumented status");
    details.push(
      `Status ${entry.statusCode} is not documented for ${route.method} ${route.path}.`,
    );
  }

  const requestIssues =
    entry.requestBody !== undefined && requestCanHaveBody(entry.method)
      ? validateSchemaValue(entry.requestBody, route.requestSchema, "request.body")
      : [];
  if (requestIssues.length > 0) {
    signals.push("Request schema drift");
    details.push(...requestIssues.map(formatSchemaIssue));
  }

  const responseSchema =
    documentedResponse?.schema ??
    (entry.statusCode === route.statusCode ? route.responseSchema : undefined);
  if (responseSchema && entry.responseBody !== undefined) {
    const responseIssues = validateSchemaValue(
      entry.responseBody,
      responseSchema,
      "response.body",
    );
    if (responseIssues.length > 0) {
      signals.push("Response schema drift");
      details.push(...responseIssues.map(formatSchemaIssue));
    }
  } else if (!responseSchema && entry.responseBody !== undefined) {
    signals.push("Response schema missing");
    details.push("OpenAPI has no response schema for this observed response.");
  }

  if (signals.length === 0) {
    signals.push("Contract aligned");
    details.push("Route, status, and available schemas matched the observed traffic.");
  }

  return {
    entry,
    route,
    severity: signals.some((signal) => signal.includes("drift") || signal.includes("Undocumented"))
      ? "fail"
      : signals.some((signal) => signal.includes("missing"))
        ? "warn"
        : "pass",
    signals,
    details,
  };
}

function renderFindingRow(finding: DriftFinding): string {
  const signal = finding.severity.toUpperCase();
  const request = `${finding.entry.method.toUpperCase()} ${finding.entry.path}`;
  const route = finding.route
    ? `${finding.route.method} ${finding.route.path}`
    : "No match";
  return [
    signal,
    codeCell(request),
    String(finding.entry.statusCode),
    codeCell(route),
    escapeTableCell(finding.signals.join(", ")),
  ].join(" | ");
}

function renderFindingListItem(finding: DriftFinding): string {
  const request = `${finding.entry.method.toUpperCase()} ${finding.entry.path}`;
  const detail = finding.details.join(" ");
  return `- \`${escapeBackticks(request)}\`: ${detail}`;
}

function findDocumentedResponse(
  route: ParsedRoute,
  actualStatus: number,
): ParsedResponse | undefined {
  return route.responses.find((response) =>
    responseStatusMatches(response.statusCode, actualStatus),
  );
}

function responseStatusMatches(statusPattern: string, actualStatus: number): boolean {
  if (statusPattern === "default") return true;
  if (/^\dXX$/i.test(statusPattern)) {
    return Math.floor(actualStatus / 100) === Number(statusPattern[0]);
  }
  return Number(statusPattern) === actualStatus;
}

function validateSchemaValue(
  value: unknown,
  schema: unknown,
  path: string,
): SchemaIssue[] {
  if (!schema || isReferenceObject(schema)) {
    return [];
  }

  const schemaObject = schema as SchemaLike;
  if (value === null && schemaObject.nullable) {
    return [];
  }

  if (Array.isArray(schemaObject.allOf)) {
    return schemaObject.allOf.flatMap((item: unknown) =>
      validateSchemaValue(value, item, path),
    );
  }

  const alternatives = schemaObject.oneOf ?? schemaObject.anyOf;
  if (Array.isArray(alternatives)) {
    const hasMatch = alternatives.some(
      (item: unknown) => validateSchemaValue(value, item, path).length === 0,
    );
    return hasMatch
      ? []
      : [{ path, message: "value does not match any allowed schema" }];
  }

  if (schemaObject.const !== undefined && !deepEqual(value, schemaObject.const)) {
    return [{ path, message: `expected constant ${JSON.stringify(schemaObject.const)}` }];
  }

  if (Array.isArray(schemaObject.enum) && !schemaObject.enum.some((item: unknown) => deepEqual(item, value))) {
    return [{ path, message: `expected one of ${JSON.stringify(schemaObject.enum)}` }];
  }

  const expectedType = inferSchemaType(schemaObject);
  const typeIssue = validateType(value, expectedType, path);
  if (typeIssue) {
    return [typeIssue];
  }

  if (expectedType === "object") {
    return validateObjectValue(value, schemaObject, path);
  }

  if (expectedType === "array") {
    return validateArrayValue(value, schemaObject, path);
  }

  return [];
}

function validateObjectValue(
  value: unknown,
  schema: SchemaLike,
  path: string,
): SchemaIssue[] {
  if (!isPlainObject(value)) {
    return [{ path, message: "expected object" }];
  }

  const issues: SchemaIssue[] = [];
  const record = value as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const propertyName of required) {
    if (record[propertyName] === undefined) {
      issues.push({
        path: `${path}.${propertyName}`,
        message: "missing required property",
      });
    }
  }

  const properties = isPlainObject(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    if (record[propertyName] === undefined) {
      continue;
    }
    issues.push(
      ...validateSchemaValue(
        record[propertyName],
        propertySchema,
        `${path}.${propertyName}`,
      ),
    );
  }

  if (schema.additionalProperties === false) {
    for (const propertyName of Object.keys(record)) {
      if (properties[propertyName] === undefined) {
        issues.push({
          path: `${path}.${propertyName}`,
          message: "additional property is not allowed by schema",
        });
      }
    }
  }

  return issues;
}

function validateArrayValue(
  value: unknown,
  schema: SchemaLike,
  path: string,
): SchemaIssue[] {
  if (!Array.isArray(value)) {
    return [{ path, message: "expected array" }];
  }

  const issues: SchemaIssue[] = [];
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    issues.push({ path, message: `expected at least ${schema.minItems} items` });
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    issues.push({ path, message: `expected at most ${schema.maxItems} items` });
  }
  if (schema.items) {
    value.forEach((item, index) => {
      issues.push(...validateSchemaValue(item, schema.items, `${path}[${index}]`));
    });
  }
  return issues;
}

function validateType(
  value: unknown,
  expectedType: string | undefined,
  path: string,
): SchemaIssue | undefined {
  if (!expectedType) {
    return undefined;
  }

  if (value === null) {
    return { path, message: `expected ${expectedType}, got null` };
  }

  if (expectedType === "integer") {
    return typeof value === "number" && Number.isInteger(value)
      ? undefined
      : { path, message: `expected integer, got ${describeType(value)}` };
  }

  if (expectedType === "array") {
    return Array.isArray(value)
      ? undefined
      : { path, message: `expected array, got ${describeType(value)}` };
  }

  if (expectedType === "object") {
    return isPlainObject(value)
      ? undefined
      : { path, message: `expected object, got ${describeType(value)}` };
  }

  return typeof value === expectedType
    ? undefined
    : { path, message: `expected ${expectedType}, got ${describeType(value)}` };
}

function inferSchemaType(schema: SchemaLike): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((type: string) => type !== "null");
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

function matchesRoutePath(routePath: string, requestPath: string): boolean {
  const routeSegments = splitPath(routePath);
  const requestSegments = splitPath(requestPath);
  if (routeSegments.length !== requestSegments.length) return false;

  return routeSegments.every((segment, index) => {
    if (segment.startsWith(":")) return requestSegments[index].length > 0;
    return segment === requestSegments[index];
  });
}

function splitPath(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function requestCanHaveBody(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function formatSchemaIssue(issue: SchemaIssue): string {
  return `${issue.path} schema: ${issue.message}.`;
}

function codeCell(value: string): string {
  return `\`${escapeTableCell(value)}\``;
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

function escapeBackticks(value: string): string {
  return value.replace(/`/g, "\\`");
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function isReferenceObject(value: unknown): value is { $ref: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
