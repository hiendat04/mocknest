import * as vscode from "vscode";
import type { ParsedParameter, ParsedRoute } from "mocknest-core";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

type FindingSeverity = "fail" | "warn" | "info";
type FindingCategory =
  | "Documentation"
  | "Parameters"
  | "Request Schema"
  | "Response Schema"
  | "Examples"
  | "Status Coverage";

interface RouteFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  message: string;
  recommendation: string;
  penalty: number;
}

interface RouteScore {
  route: ParsedRoute;
  score: number;
  grade: string;
  findings: RouteFinding[];
  hasErrorResponse: boolean;
  hasSuccessResponseSchema: boolean;
  hasExampleOrScenario: boolean;
  mutationSchemaReady: boolean;
  pathParametersReady: boolean;
}

interface StatefulGroup {
  resource: string;
  methods: string[];
  signal: string;
  routeCount: number;
}

type SchemaLike = Record<string, unknown>;

const SPEC_PATH_STATE_KEY = "mocknest.specPath";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH"]);

export async function generateSpecQualityScorecardCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
): Promise<void> {
  const routes = routeTreeProvider.getRoutes();
  if (routes.length === 0) {
    vscode.window.showInformationMessage(
      "No MockNest routes loaded. Select an OpenAPI spec or start the mock server first.",
    );
    return;
  }

  const report = buildSpecQualityScorecard({
    routes,
    specPath: context.workspaceState.get<string>(SPEC_PATH_STATE_KEY),
    generatedAt: new Date(),
  });

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: report,
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

export function buildSpecQualityScorecard(options: {
  routes: ParsedRoute[];
  specPath?: string;
  generatedAt: Date;
}): string {
  const routeScores = options.routes.map(analyzeRouteQuality);
  const score = calculateOverallScore(routeScores);
  const findings = routeScores.flatMap((row) => row.findings);
  const failures = findings.filter((finding) => finding.severity === "fail");
  const warnings = findings.filter((finding) => finding.severity === "warn");
  const infos = findings.filter((finding) => finding.severity === "info");
  const topFixes = selectTopFixes(routeScores);
  const statefulGroups = findStatefulGroups(options.routes);

  const lines = [
    "# MockNest Spec Quality Scorecard",
    "",
    `Generated: ${options.generatedAt.toISOString()}`,
    options.specPath ? `Spec: ${options.specPath}` : "Spec: not selected",
    "",
    "## Summary",
    "",
    `- Overall score: ${score}/100 (${gradeForScore(score)})`,
    `- Routes analyzed: ${routeScores.length}`,
    `- Blocking gaps: ${failures.length}`,
    `- Warnings: ${warnings.length}`,
    `- Improvement notes: ${infos.length}`,
    "",
    "## Readiness Gates",
    "",
    "| Gate | Result | Signal |",
    "| --- | --- | --- |",
    renderGate(
      "Success responses have schemas",
      countWhere(routeScores, (row) => row.hasSuccessResponseSchema),
      routeScores.length,
      "Mock responses and drift checks can validate payload shape.",
    ),
    renderGate(
      "Path parameters are documented",
      countWhere(routeScores, (row) => row.pathParametersReady),
      routeScores.length,
      "Generated tests can hydrate route paths safely.",
    ),
    renderGate(
      "Mutation requests have schemas",
      countWhere(routeScores, (row) => row.mutationSchemaReady),
      routeScores.length,
      "POST, PUT, and PATCH tests can send realistic bodies.",
    ),
    renderGate(
      "Error or default responses are documented",
      countWhere(routeScores, (row) => row.hasErrorResponse),
      routeScores.length,
      "Teams can mock failure paths before backend behavior exists.",
    ),
    renderGate(
      "Examples or scenarios are available",
      countWhere(routeScores, (row) => row.hasExampleOrScenario),
      routeScores.length,
      "MockNest can serve more product-like responses.",
    ),
    "",
  ];

  if (topFixes.length > 0) {
    lines.push(
      "## Top Fixes",
      "",
      ...topFixes.map(renderTopFix),
      "",
    );
  }

  lines.push(
    "## Route Scorecard",
    "",
    "| Route | Score | Grade | Main Gaps |",
    "| --- | ---: | --- | --- |",
    ...routeScores.map(renderRouteScoreRow),
    "",
  );

  if (statefulGroups.length > 0) {
    lines.push(
      "## Stateful Mock Candidates",
      "",
      "| Resource | Methods | Signal |",
      "| --- | --- | --- |",
      ...statefulGroups.map(renderStatefulGroupRow),
      "",
    );
  }

  lines.push(
    "## How To Use This",
    "",
    "- Fix blocking gaps before relying on generated tests or strict validation.",
    "- Add response examples or `x-mock-responses` for workflows that need stable product-like fixtures.",
    "- Prioritize error/default responses for endpoints used by frontend retry, empty-state, and permission flows.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function analyzeRouteQuality(route: ParsedRoute): RouteScore {
  const findings: RouteFinding[] = [];
  const method = route.method.toUpperCase();
  const parameters = route.parameters ?? [];

  collectDocumentationFindings(route, findings);
  collectParameterFindings(route, parameters, findings);
  collectRequestSchemaFindings(route, method, findings);
  collectResponseFindings(route, findings);

  const penalty = findings.reduce((sum, finding) => sum + finding.penalty, 0);
  const score = Math.max(0, 100 - penalty);

  return {
    route,
    score,
    grade: gradeForScore(score),
    findings,
    hasErrorResponse: hasErrorOrDefaultResponse(route),
    hasSuccessResponseSchema: hasSuccessSchema(route),
    hasExampleOrScenario: hasResponseExample(route) || hasScenarioOverride(route),
    mutationSchemaReady: !MUTATION_METHODS.has(method) || Boolean(route.requestSchema),
    pathParametersReady: pathParametersAreReady(route),
  };
}

function collectDocumentationFindings(
  route: ParsedRoute,
  findings: RouteFinding[],
): void {
  if (!route.summary && !route.description) {
    findings.push({
      severity: "info",
      category: "Documentation",
      message: "Operation has no summary or description.",
      recommendation: "Add a short operation summary so route lists and reports are easier to scan.",
      penalty: 3,
    });
  }

  if (!route.tags || route.tags.length === 0) {
    findings.push({
      severity: "info",
      category: "Documentation",
      message: "Operation is not tagged.",
      recommendation: "Add at least one tag so related mock routes stay grouped in the sidebar.",
      penalty: 2,
    });
  }
}

function collectParameterFindings(
  route: ParsedRoute,
  parameters: ParsedParameter[],
  findings: RouteFinding[],
): void {
  const declaredPathNames = new Set(
    parameters
      .filter((parameter) => parameter.in === "path")
      .map((parameter) => parameter.name),
  );
  const pathNames = extractPathParameterNames(route.path);

  for (const name of pathNames) {
    if (!declaredPathNames.has(name)) {
      findings.push({
        severity: "fail",
        category: "Parameters",
        message: `Path parameter \`${name}\` is used in the path but not documented.`,
        recommendation: "Add a required OpenAPI path parameter with a schema.",
        penalty: 14,
      });
    }
  }

  for (const parameter of parameters) {
    if (parameter.in === "path" && !pathNames.includes(parameter.name)) {
      findings.push({
        severity: "warn",
        category: "Parameters",
        message: `Path parameter \`${parameter.name}\` is documented but not used by the route path.`,
        recommendation: "Remove the unused parameter or align the route template.",
        penalty: 6,
      });
    }

    if (parameter.in === "path" && !parameter.required) {
      findings.push({
        severity: "warn",
        category: "Parameters",
        message: `Path parameter \`${parameter.name}\` is not marked as required.`,
        recommendation: "Mark OpenAPI path parameters as required.",
        penalty: 6,
      });
    }

    if (parameter.required && !parameter.schema) {
      findings.push({
        severity: "fail",
        category: "Parameters",
        message: `Required ${parameter.in} parameter \`${parameter.name}\` has no schema.`,
        recommendation: "Add a parameter schema so generated tests and strict validation can sample it.",
        penalty: 10,
      });
      continue;
    }

    if (parameter.schema && schemaIsWeak(parameter.schema)) {
      findings.push({
        severity: parameter.required ? "warn" : "info",
        category: "Parameters",
        message: `${capitalize(parameter.in)} parameter \`${parameter.name}\` has a weak schema.`,
        recommendation: "Add a type, format, enum, or bounded constraints for a more useful generated value.",
        penalty: parameter.required ? 5 : 2,
      });
    }
  }
}

function collectRequestSchemaFindings(
  route: ParsedRoute,
  method: string,
  findings: RouteFinding[],
): void {
  if (route.requestRequired && !route.requestSchema) {
    findings.push({
      severity: "fail",
      category: "Request Schema",
      message: "Required request body has no JSON schema.",
      recommendation: "Document the request body schema so tests, mocks, and validators can build payloads.",
      penalty: 18,
    });
    return;
  }

  if (MUTATION_METHODS.has(method) && !route.requestSchema) {
    findings.push({
      severity: "warn",
      category: "Request Schema",
      message: `${method} route has no JSON request schema.`,
      recommendation: "Add a request body schema unless this mutation intentionally has no body.",
      penalty: 10,
    });
    return;
  }

  if (route.requestSchema && schemaIsWeak(route.requestSchema)) {
    findings.push({
      severity: "warn",
      category: "Request Schema",
      message: "Request body schema is too broad for reliable mock data.",
      recommendation: "Add object properties, required fields, array items, or composition details.",
      penalty: 8,
    });
  }
}

function collectResponseFindings(
  route: ParsedRoute,
  findings: RouteFinding[],
): void {
  if (route.responses.length === 0) {
    findings.push({
      severity: "fail",
      category: "Status Coverage",
      message: "Route has no documented OpenAPI responses.",
      recommendation: "Add at least one success response and one error/default response.",
      penalty: 18,
    });
    return;
  }

  if (!hasExplicitSuccessResponse(route)) {
    findings.push({
      severity: "fail",
      category: "Status Coverage",
      message: "Route has no explicit 2xx response.",
      recommendation: "Document the primary success response instead of relying on MockNest defaults.",
      penalty: 14,
    });
  }

  if (!hasSuccessSchema(route)) {
    findings.push({
      severity: "fail",
      category: "Response Schema",
      message: "One or more non-204 success responses has no JSON schema.",
      recommendation: "Add a response schema so MockNest can generate and validate realistic payloads.",
      penalty: 16,
    });
  } else if (route.responseSchema && schemaIsWeak(route.responseSchema)) {
    findings.push({
      severity: "warn",
      category: "Response Schema",
      message: "Primary success response schema is too broad.",
      recommendation: "Add concrete properties, item schemas, enums, or required fields.",
      penalty: 8,
    });
  }

  if (!hasErrorOrDefaultResponse(route)) {
    findings.push({
      severity: "warn",
      category: "Status Coverage",
      message: "No error or default response is documented.",
      recommendation: "Add at least one 4xx, 5xx, or default response for failure-path testing.",
      penalty: 10,
    });
  }

  if (!hasResponseExample(route) && !hasScenarioOverride(route)) {
    findings.push({
      severity: "warn",
      category: "Examples",
      message: "No response example or replay scenario is available.",
      recommendation: "Add OpenAPI examples or `x-mock-responses` for stable demo and test fixtures.",
      penalty: 6,
    });
  }
}

function calculateOverallScore(routeScores: RouteScore[]): number {
  if (routeScores.length === 0) {
    return 0;
  }

  const total = routeScores.reduce((sum, row) => sum + row.score, 0);
  return Math.round(total / routeScores.length);
}

function selectTopFixes(routeScores: RouteScore[]): Array<{
  route: ParsedRoute;
  finding: RouteFinding;
}> {
  return routeScores
    .flatMap((row) =>
      row.findings.map((finding) => ({
        route: row.route,
        finding,
      })),
    )
    .sort((left, right) => {
      const severityDiff =
        severityRank(right.finding.severity) - severityRank(left.finding.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return right.finding.penalty - left.finding.penalty;
    })
    .slice(0, 8);
}

function findStatefulGroups(routes: ParsedRoute[]): StatefulGroup[] {
  const groups = new Map<string, ParsedRoute[]>();
  for (const route of routes) {
    const resource = normalizeResourcePath(route.path);
    if (!resource) {
      continue;
    }
    const existing = groups.get(resource) ?? [];
    existing.push(route);
    groups.set(resource, existing);
  }

  return [...groups.entries()]
    .map(([resource, resourceRoutes]) => {
      const methods = new Set(resourceRoutes.map((route) => route.method.toUpperCase()));
      const hasCollectionGet = resourceRoutes.some(
        (route) => route.method.toUpperCase() === "GET" && !isItemRoute(route.path),
      );
      const hasCreate = methods.has("POST");
      const hasItemGet = resourceRoutes.some(
        (route) => route.method.toUpperCase() === "GET" && isItemRoute(route.path),
      );
      const hasUpdate = methods.has("PUT") || methods.has("PATCH");
      const hasDelete = methods.has("DELETE");
      const signalCount = [
        hasCollectionGet,
        hasCreate,
        hasItemGet,
        hasUpdate,
        hasDelete,
      ].filter(Boolean).length;

      return {
        resource,
        methods: [...methods].sort(),
        signal:
          signalCount >= 4
            ? "Strong CRUD mock candidate"
            : signalCount >= 3
              ? "Partial stateful mock candidate"
              : "Light stateful signal",
        routeCount: resourceRoutes.length,
      };
    })
    .filter((group) => group.routeCount >= 2)
    .sort((left, right) => {
      const signalDiff = signalRank(right.signal) - signalRank(left.signal);
      if (signalDiff !== 0) {
        return signalDiff;
      }
      return right.routeCount - left.routeCount;
    })
    .slice(0, 8);
}

function hasExplicitSuccessResponse(route: ParsedRoute): boolean {
  return route.responses.some((response) => responseStatusFamily(response.statusCode) === 2);
}

function hasSuccessSchema(route: ParsedRoute): boolean {
  const successResponses = route.responses.filter(
    (response) => responseStatusFamily(response.statusCode) === 2,
  );
  if (successResponses.length === 0) {
    return false;
  }

  return successResponses.every(
    (response) => response.statusCode === "204" || Boolean(response.schema),
  );
}

function hasErrorOrDefaultResponse(route: ParsedRoute): boolean {
  return route.responses.some((response) => {
    if (response.statusCode === "default") {
      return true;
    }
    const family = responseStatusFamily(response.statusCode);
    return family === 4 || family === 5;
  });
}

function hasResponseExample(route: ParsedRoute): boolean {
  return (
    hasEntries(route.responseExamples) ||
    route.responses.some((response) => hasEntries(response.examples))
  );
}

function hasScenarioOverride(route: ParsedRoute): boolean {
  return Boolean(route.responseOverrides && route.responseOverrides.length > 0);
}

function pathParametersAreReady(route: ParsedRoute): boolean {
  const pathNames = extractPathParameterNames(route.path);
  if (pathNames.length === 0) {
    return true;
  }

  const parameters = route.parameters ?? [];
  return pathNames.every((name) =>
    parameters.some(
      (parameter) =>
        parameter.in === "path" &&
        parameter.name === name &&
        parameter.required &&
        Boolean(parameter.schema),
    ),
  );
}

function schemaIsWeak(schema: unknown): boolean {
  if (!schema || isReferenceObject(schema)) {
    return true;
  }

  const schemaObject = schema as SchemaLike;
  if (
    schemaObject.allOf ||
    schemaObject.anyOf ||
    schemaObject.oneOf ||
    schemaObject.enum ||
    schemaObject.const
  ) {
    return false;
  }

  const type = inferSchemaType(schemaObject);
  if (!type) {
    return true;
  }

  if (type === "object") {
    const properties = schemaObject.properties;
    return !isPlainObject(properties) || Object.keys(properties).length === 0;
  }

  if (type === "array") {
    return !schemaObject.items;
  }

  return false;
}

function inferSchemaType(schema: SchemaLike): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((type): type is string => typeof type === "string" && type !== "null");
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

function responseStatusFamily(statusCode: string): number | undefined {
  if (/^\dXX$/i.test(statusCode)) {
    return Number(statusCode[0]);
  }
  if (/^\d{3}$/.test(statusCode)) {
    return Math.floor(Number(statusCode) / 100);
  }
  return undefined;
}

function extractPathParameterNames(path: string): string[] {
  const matches = path.matchAll(/:("[^"]+"|[A-Za-z0-9_$]+)/g);
  return [...matches].map((match) => normalizeExpressParameterName(match[1]));
}

function normalizeExpressParameterName(rawName: string): string {
  if (rawName.startsWith('"') && rawName.endsWith('"')) {
    return rawName.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return rawName;
}

function normalizeResourcePath(path: string): string {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return "";
  }

  const baseSegments = isPathParameterSegment(segments[segments.length - 1])
    ? segments.slice(0, -1)
    : segments;
  return `/${baseSegments.join("/")}`;
}

function isItemRoute(path: string): boolean {
  const segments = splitPath(path);
  return segments.length > 0 && isPathParameterSegment(segments[segments.length - 1]);
}

function isPathParameterSegment(segment: string): boolean {
  return segment.startsWith(":");
}

function splitPath(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function renderGate(
  label: string,
  count: number,
  total: number,
  signal: string,
): string {
  const result = count === total ? "Pass" : `${count}/${total}`;
  return [escapeTableCell(label), result, escapeTableCell(signal)].join(" | ");
}

function renderTopFix(item: { route: ParsedRoute; finding: RouteFinding }): string {
  const routeName = `${item.route.method.toUpperCase()} ${item.route.path}`;
  return `- ${item.finding.severity.toUpperCase()} ${code(routeName)}: ${item.finding.message} ${item.finding.recommendation}`;
}

function renderRouteScoreRow(row: RouteScore): string {
  const routeName = `${row.route.method.toUpperCase()} ${row.route.path}`;
  const mainGaps = row.findings.length > 0
    ? row.findings
        .slice(0, 3)
        .map((finding) => `${finding.severity.toUpperCase()}: ${finding.category}`)
        .join(", ")
    : "Ready";

  return [
    codeCell(routeName),
    String(row.score),
    row.grade,
    escapeTableCell(mainGaps),
  ].join(" | ");
}

function renderStatefulGroupRow(group: StatefulGroup): string {
  return [
    codeCell(group.resource),
    escapeTableCell(group.methods.join(", ")),
    escapeTableCell(group.signal),
  ].join(" | ");
}

function countWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function gradeForScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "Needs work";
}

function severityRank(severity: FindingSeverity): number {
  switch (severity) {
    case "fail":
      return 3;
    case "warn":
      return 2;
    case "info":
      return 1;
  }
}

function signalRank(signal: string): number {
  if (signal.startsWith("Strong")) return 3;
  if (signal.startsWith("Partial")) return 2;
  return 1;
}

function code(value: string): string {
  return `\`${escapeBackticks(value)}\``;
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasEntries(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
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
