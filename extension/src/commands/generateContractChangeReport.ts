import * as vscode from "vscode";
import {
  parseOpenApiFile,
  type ParsedParameter,
  type ParsedRoute,
} from "mocknest-core";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

type ChangeSeverity = "breaking" | "review" | "compatible";
type ChangeCategory =
  | "Route"
  | "Parameters"
  | "Request Schema"
  | "Response Status"
  | "Response Schema"
  | "Mock Behavior";

interface ContractChange {
  severity: ChangeSeverity;
  category: ChangeCategory;
  route: string;
  message: string;
  recommendation: string;
}

interface RoutePair {
  baseline: ParsedRoute;
  current: ParsedRoute;
}

type SchemaLike = Record<string, unknown>;

const SPEC_PATH_STATE_KEY = "mocknest.specPath";
const SCHEMA_METADATA_KEYS = new Set([
  "description",
  "example",
  "examples",
  "externalDocs",
  "title",
]);

export async function generateContractChangeReportCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
): Promise<void> {
  const currentRoutes = routeTreeProvider.getRoutes();
  if (currentRoutes.length === 0) {
    vscode.window.showInformationMessage(
      "No MockNest routes loaded. Select an OpenAPI spec or start the mock server first.",
    );
    return;
  }

  const currentSpecPath = context.workspaceState.get<string>(SPEC_PATH_STATE_KEY);
  const baselineUris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: currentSpecPath
      ? vscode.Uri.file(currentSpecPath)
      : vscode.workspace.workspaceFolders?.[0]?.uri,
    filters: {
      "OpenAPI specs": ["yaml", "yml", "json"],
    },
    openLabel: "Use as Baseline",
    title: "Select Baseline OpenAPI Spec",
  });

  const baselineUri = baselineUris?.[0];
  if (!baselineUri) {
    return;
  }

  let baselineRoutes: ParsedRoute[];
  try {
    const parsed = await parseOpenApiFile(baselineUri.fsPath);
    baselineRoutes = parsed.routes;
  } catch (error) {
    vscode.window.showErrorMessage(
      `Unable to parse baseline OpenAPI spec: ${formatErrorMessage(error)}`,
    );
    return;
  }

  const report = buildContractChangeReport({
    baselineRoutes,
    currentRoutes,
    baselineSpecPath: baselineUri.fsPath,
    currentSpecPath,
    generatedAt: new Date(),
  });

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: report,
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

export function buildContractChangeReport(options: {
  baselineRoutes: ParsedRoute[];
  currentRoutes: ParsedRoute[];
  baselineSpecPath?: string;
  currentSpecPath?: string;
  generatedAt: Date;
}): string {
  const baselineByKey = mapRoutesByKey(options.baselineRoutes);
  const currentByKey = mapRoutesByKey(options.currentRoutes);
  const changes: ContractChange[] = [];
  const allKeys = new Set([...baselineByKey.keys(), ...currentByKey.keys()]);

  for (const key of [...allKeys].sort()) {
    const baseline = baselineByKey.get(key);
    const current = currentByKey.get(key);

    if (baseline && !current) {
      changes.push({
        severity: "breaking",
        category: "Route",
        route: routeLabel(baseline),
        message: "Route was removed from the current contract.",
        recommendation:
          "Keep the route, provide a deprecation path, or update downstream mocks and contract tests.",
      });
      continue;
    }

    if (!baseline && current) {
      changes.push({
        severity: "compatible",
        category: "Route",
        route: routeLabel(current),
        message: "Route was added to the current contract.",
        recommendation:
          "Add examples, error responses, and coverage before relying on this route in frontend workflows.",
      });
      continue;
    }

    if (baseline && current) {
      changes.push(...compareRoutePair({ baseline, current }));
    }
  }

  return renderContractChangeReport({
    changes,
    baselineRouteCount: options.baselineRoutes.length,
    currentRouteCount: options.currentRoutes.length,
    baselineSpecPath: options.baselineSpecPath,
    currentSpecPath: options.currentSpecPath,
    generatedAt: options.generatedAt,
  });
}

function compareRoutePair(pair: RoutePair): ContractChange[] {
  const changes: ContractChange[] = [];
  changes.push(...compareParameters(pair));
  changes.push(...compareRequestSchema(pair));
  changes.push(...compareResponses(pair));
  changes.push(...compareMockBehavior(pair));
  return changes;
}

function compareParameters(pair: RoutePair): ContractChange[] {
  const changes: ContractChange[] = [];
  const baselineParameters = mapParametersByKey(pair.baseline.parameters);
  const currentParameters = mapParametersByKey(pair.current.parameters);
  const allKeys = new Set([...baselineParameters.keys(), ...currentParameters.keys()]);

  for (const key of allKeys) {
    const baseline = baselineParameters.get(key);
    const current = currentParameters.get(key);

    if (baseline && !current) {
      changes.push({
        severity: baseline.required ? "review" : "compatible",
        category: "Parameters",
        route: routeLabel(pair.current),
        message: `${describeParameter(baseline)} was removed.`,
        recommendation:
          "Confirm generated tests and clients no longer need this parameter.",
      });
      continue;
    }

    if (!baseline && current) {
      changes.push({
        severity: current.required ? "breaking" : "compatible",
        category: "Parameters",
        route: routeLabel(pair.current),
        message: `${describeParameter(current)} was added.`,
        recommendation: current.required
          ? "Avoid adding required request inputs without a versioning or migration plan."
          : "Add examples so generated requests can exercise the optional parameter when needed.",
      });
      continue;
    }

    if (!baseline || !current) {
      continue;
    }

    if (!baseline.required && current.required) {
      changes.push({
        severity: "breaking",
        category: "Parameters",
        route: routeLabel(pair.current),
        message: `${describeParameter(current)} changed from optional to required.`,
        recommendation:
          "Keep the parameter optional or coordinate a breaking contract change.",
      });
    } else if (baseline.required && !current.required) {
      changes.push({
        severity: "compatible",
        category: "Parameters",
        route: routeLabel(pair.current),
        message: `${describeParameter(current)} changed from required to optional.`,
        recommendation:
          "Update generated tests if they no longer need to send this parameter.",
      });
    }

    if (schemaFingerprint(baseline.schema) !== schemaFingerprint(current.schema)) {
      changes.push({
        severity: schemaTypeChanged(baseline.schema, current.schema)
          ? "breaking"
          : current.required
            ? "review"
            : "compatible",
        category: "Parameters",
        route: routeLabel(pair.current),
        message: `${describeParameter(current)} schema changed.`,
        recommendation:
          "Review generated sample values, strict validation behavior, and callers that send this parameter.",
      });
    }
  }

  return changes;
}

function compareRequestSchema(pair: RoutePair): ContractChange[] {
  const changes: ContractChange[] = [];
  const baseline = pair.baseline;
  const current = pair.current;

  if (!baseline.requestRequired && current.requestRequired) {
    changes.push({
      severity: "breaking",
      category: "Request Schema",
      route: routeLabel(current),
      message: "Request body changed from optional to required.",
      recommendation:
        "Keep the body optional or coordinate frontend and test fixture updates before merging.",
    });
  } else if (baseline.requestRequired && !current.requestRequired) {
    changes.push({
      severity: "compatible",
      category: "Request Schema",
      route: routeLabel(current),
      message: "Request body changed from required to optional.",
      recommendation:
        "Update generated contract tests if this route can now be called without a body.",
    });
  }

  if (!baseline.requestSchema && current.requestSchema) {
    changes.push({
      severity: current.requestRequired ? "breaking" : "compatible",
      category: "Request Schema",
      route: routeLabel(current),
      message: "Request body schema was added.",
      recommendation: current.requestRequired
        ? "Treat this as breaking unless all callers already send a matching body."
        : "Use the schema to improve generated smoke tests and mock fixtures.",
    });
    return changes;
  }

  if (baseline.requestSchema && !current.requestSchema) {
    changes.push({
      severity: "review",
      category: "Request Schema",
      route: routeLabel(current),
      message: "Request body schema was removed.",
      recommendation:
        "Confirm strict validation and generated request bodies are intentionally becoming less specific.",
    });
    return changes;
  }

  if (
    baseline.requestSchema &&
    current.requestSchema &&
    schemaFingerprint(baseline.requestSchema) !== schemaFingerprint(current.requestSchema)
  ) {
    const newRequired = addedRequiredProperties(
      baseline.requestSchema,
      current.requestSchema,
    );
    changes.push({
      severity:
        newRequired.length > 0 || schemaTypeChanged(baseline.requestSchema, current.requestSchema)
          ? "breaking"
          : "review",
      category: "Request Schema",
      route: routeLabel(current),
      message:
        newRequired.length > 0
          ? `Request schema added required field(s): ${newRequired.join(", ")}.`
          : "Request body schema changed.",
      recommendation:
        "Review generated request payloads, replay scenarios, and strict validation behavior.",
    });
  }

  return changes;
}

function compareResponses(pair: RoutePair): ContractChange[] {
  const changes: ContractChange[] = [];
  const baselineResponses = mapResponsesByStatus(pair.baseline);
  const currentResponses = mapResponsesByStatus(pair.current);
  const allStatuses = new Set([...baselineResponses.keys(), ...currentResponses.keys()]);

  for (const status of [...allStatuses].sort(sortStatusCodes)) {
    const baseline = baselineResponses.get(status);
    const current = currentResponses.get(status);

    if (baseline && !current) {
      changes.push({
        severity: responseStatusFamily(status) === 2 ? "breaking" : "review",
        category: "Response Status",
        route: routeLabel(pair.current),
        message: `Response status ${status} was removed.`,
        recommendation:
          "Update downstream expectations, generated tests, and scenario packs that assert this status.",
      });
      continue;
    }

    if (!baseline && current) {
      changes.push({
        severity: "compatible",
        category: "Response Status",
        route: routeLabel(pair.current),
        message: `Response status ${status} was added.`,
        recommendation:
          "Add an example or replay scenario if this status should be easy to test from MockNest.",
      });
      continue;
    }

    if (!baseline || !current) {
      continue;
    }

    if (schemaFingerprint(baseline.schema) !== schemaFingerprint(current.schema)) {
      const removedRequired = removedRequiredProperties(baseline.schema, current.schema);
      changes.push({
        severity:
          responseStatusFamily(status) === 2 &&
          (removedRequired.length > 0 || schemaTypeChanged(baseline.schema, current.schema))
            ? "breaking"
            : "review",
        category: "Response Schema",
        route: routeLabel(pair.current),
        message:
          removedRequired.length > 0
            ? `Response ${status} no longer guarantees field(s): ${removedRequired.join(", ")}.`
            : `Response ${status} schema changed.`,
        recommendation:
          "Review frontend consumers, drift reports, and generated mocks before merging this contract change.",
      });
    }

    const baselineHasExamples = hasEntries(baseline.examples);
    const currentHasExamples = hasEntries(current.examples);
    if (baselineHasExamples && !currentHasExamples) {
      changes.push({
        severity: "review",
        category: "Mock Behavior",
        route: routeLabel(pair.current),
        message: `Response ${status} examples were removed.`,
        recommendation:
          "Keep examples when product-like mock responses or stable demos depend on them.",
      });
    } else if (!baselineHasExamples && currentHasExamples) {
      changes.push({
        severity: "compatible",
        category: "Mock Behavior",
        route: routeLabel(pair.current),
        message: `Response ${status} examples were added.`,
        recommendation:
          "Use these examples in API Tester and replay scenarios for stable manual QA.",
      });
    }
  }

  return changes;
}

function compareMockBehavior(pair: RoutePair): ContractChange[] {
  const changes: ContractChange[] = [];
  const baseline = pair.baseline;
  const current = pair.current;

  if (baseline.statusCode !== current.statusCode) {
    changes.push({
      severity: "review",
      category: "Mock Behavior",
      route: routeLabel(current),
      message: `Default mock status changed from ${baseline.statusCode} to ${current.statusCode}.`,
      recommendation:
        "Confirm generated smoke tests and manual API Tester workflows should expect the new default status.",
    });
  }

  if (baseline.mockStatusCode !== current.mockStatusCode) {
    changes.push({
      severity: "review",
      category: "Mock Behavior",
      route: routeLabel(current),
      message: "Mock status override metadata changed.",
      recommendation:
        "Confirm `x-mock-status` changes are intentional because they alter local mock behavior.",
    });
  }

  if (baseline.mockDelay !== current.mockDelay) {
    changes.push({
      severity: "review",
      category: "Mock Behavior",
      route: routeLabel(current),
      message: "Mock delay metadata changed.",
      recommendation:
        "Confirm `x-mock-delay` changes are intentional for local latency simulation.",
    });
  }

  const baselineOverrideCount = baseline.responseOverrides?.length ?? 0;
  const currentOverrideCount = current.responseOverrides?.length ?? 0;
  if (baselineOverrideCount !== currentOverrideCount) {
    changes.push({
      severity: "review",
      category: "Mock Behavior",
      route: routeLabel(current),
      message: `Replay scenario count changed from ${baselineOverrideCount} to ${currentOverrideCount}.`,
      recommendation:
        "Review `x-mock-responses` changes because they affect reproducible scenario testing.",
    });
  }

  return changes;
}

function renderContractChangeReport(options: {
  changes: ContractChange[];
  baselineRouteCount: number;
  currentRouteCount: number;
  baselineSpecPath?: string;
  currentSpecPath?: string;
  generatedAt: Date;
}): string {
  const breaking = options.changes.filter((change) => change.severity === "breaking");
  const review = options.changes.filter((change) => change.severity === "review");
  const compatible = options.changes.filter(
    (change) => change.severity === "compatible",
  );
  const gate = breaking.length > 0
    ? "Block merge until breaking changes are reviewed"
    : review.length > 0
      ? "Review before merge"
      : "No blocking contract changes detected";

  const lines = [
    "# MockNest Contract Change Report",
    "",
    `Generated: ${options.generatedAt.toISOString()}`,
    options.baselineSpecPath
      ? `Baseline spec: ${options.baselineSpecPath}`
      : "Baseline spec: not selected",
    options.currentSpecPath
      ? `Current spec: ${options.currentSpecPath}`
      : "Current spec: loaded routes",
    "",
    "## Summary",
    "",
    `- Baseline routes: ${options.baselineRouteCount}`,
    `- Current routes: ${options.currentRouteCount}`,
    `- Breaking changes: ${breaking.length}`,
    `- Review warnings: ${review.length}`,
    `- Compatible additions: ${compatible.length}`,
    `- Merge signal: ${gate}`,
    "",
  ];

  appendChangeSection(lines, "Breaking Changes", breaking);
  appendChangeSection(lines, "Review Warnings", review);
  appendChangeSection(lines, "Compatible Additions", compatible);

  lines.push(
    "## How To Use This",
    "",
    "- Attach this report to API-facing pull requests when the OpenAPI spec changes.",
    "- Treat breaking changes as a release coordination signal, especially removed routes, new required inputs, and narrowed success responses.",
    "- Re-run the spec quality scorecard after reviewing changes to catch missing schemas, examples, and error responses in newly added routes.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function appendChangeSection(
  lines: string[],
  title: string,
  changes: ContractChange[],
): void {
  if (changes.length === 0) {
    lines.push(`## ${title}`, "", "No findings.", "");
    return;
  }

  lines.push(
    `## ${title}`,
    "",
    "| Category | Route | Change | Recommendation |",
    "| --- | --- | --- | --- |",
    ...changes.map(renderChangeRow),
    "",
  );
}

function renderChangeRow(change: ContractChange): string {
  return [
    escapeTableCell(change.category),
    codeCell(change.route),
    escapeTableCell(change.message),
    escapeTableCell(change.recommendation),
  ].join(" | ");
}

function mapRoutesByKey(routes: ParsedRoute[]): Map<string, ParsedRoute> {
  const mapped = new Map<string, ParsedRoute>();
  for (const route of routes) {
    mapped.set(routeKey(route), route);
  }
  return mapped;
}

function mapParametersByKey(
  parameters: ParsedParameter[] | undefined,
): Map<string, ParsedParameter> {
  const mapped = new Map<string, ParsedParameter>();
  for (const parameter of parameters ?? []) {
    mapped.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return mapped;
}

function mapResponsesByStatus(
  route: ParsedRoute,
): Map<string, ParsedRoute["responses"][number]> {
  const mapped = new Map<string, ParsedRoute["responses"][number]>();
  for (const response of route.responses) {
    mapped.set(response.statusCode, response);
  }
  return mapped;
}

function routeKey(route: ParsedRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function routeLabel(route: ParsedRoute): string {
  return routeKey(route);
}

function describeParameter(parameter: ParsedParameter): string {
  const required = parameter.required ? "required" : "optional";
  return `${required} ${parameter.in} parameter \`${parameter.name}\``;
}

function addedRequiredProperties(
  baselineSchema: unknown,
  currentSchema: unknown,
): string[] {
  const baseline = getObjectSchemaInfo(baselineSchema);
  const current = getObjectSchemaInfo(currentSchema);
  if (!current) {
    return [];
  }

  return [...current.required].filter(
    (name) => !baseline?.required.has(name) && current.properties.has(name),
  );
}

function removedRequiredProperties(
  baselineSchema: unknown,
  currentSchema: unknown,
): string[] {
  const baseline = getObjectSchemaInfo(baselineSchema);
  const current = getObjectSchemaInfo(currentSchema);
  if (!baseline) {
    return [];
  }

  return [...baseline.required].filter(
    (name) => !current?.required.has(name) || !current.properties.has(name),
  );
}

function getObjectSchemaInfo(
  schema: unknown,
): { required: Set<string>; properties: Set<string> } | undefined {
  if (!schema || isReferenceObject(schema)) {
    return undefined;
  }

  const schemaObject = schema as SchemaLike;
  if (Array.isArray(schemaObject.allOf)) {
    const parts = schemaObject.allOf
      .map(getObjectSchemaInfo)
      .filter((item): item is { required: Set<string>; properties: Set<string> } =>
        Boolean(item),
      );
    if (parts.length === 0) {
      return undefined;
    }

    return {
      required: mergeSets(parts.map((part) => part.required)),
      properties: mergeSets(parts.map((part) => part.properties)),
    };
  }

  const properties = schemaObject.properties;
  if (!isPlainObject(properties)) {
    return undefined;
  }

  const required = Array.isArray(schemaObject.required)
    ? schemaObject.required.filter((item): item is string => typeof item === "string")
    : [];

  return {
    required: new Set(required),
    properties: new Set(Object.keys(properties)),
  };
}

function schemaTypeChanged(left: unknown, right: unknown): boolean {
  const leftType = inferSchemaType(left);
  const rightType = inferSchemaType(right);
  return Boolean(leftType && rightType && leftType !== rightType);
}

function inferSchemaType(schema: unknown): string | undefined {
  if (!schema || isReferenceObject(schema)) {
    return undefined;
  }

  const schemaObject = schema as SchemaLike;
  if (Array.isArray(schemaObject.type)) {
    return schemaObject.type.find(
      (type): type is string => typeof type === "string" && type !== "null",
    );
  }
  if (typeof schemaObject.type === "string") {
    return schemaObject.type;
  }
  if (schemaObject.properties || schemaObject.required) {
    return "object";
  }
  if (schemaObject.items) {
    return "array";
  }
  return undefined;
}

function schemaFingerprint(schema: unknown): string {
  if (!schema) {
    return "";
  }

  return stableStringify(schema, new WeakSet<object>());
}

function stableStringify(value: unknown, seen: WeakSet<object>): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (seen.has(value)) {
    return '"[Circular]"';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item, seen));
    seen.delete(value);
    return `[${items.join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => !SCHEMA_METADATA_KEYS.has(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`);
  seen.delete(value);
  return `{${entries.join(",")}}`;
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

function sortStatusCodes(left: string, right: string): number {
  if (left === "default") return 1;
  if (right === "default") return -1;
  return Number(left.replace(/\D/g, "9")) - Number(right.replace(/\D/g, "9"));
}

function mergeSets(sets: Array<Set<string>>): Set<string> {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
}

function codeCell(value: string): string {
  return `\`${escapeTableCell(value)}\``;
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "\\`");
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
