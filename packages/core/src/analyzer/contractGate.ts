import type { ParsedParameter, ParsedRoute } from "../parser/openApiParser";

export type ContractGateFindingSeverity = "blocking" | "warning";
export type ContractGateFindingCategory =
  | "documentation"
  | "parameters"
  | "request-schema"
  | "response-schema"
  | "status-coverage"
  | "examples";

export interface ContractGateFinding {
  severity: ContractGateFindingSeverity;
  category: ContractGateFindingCategory;
  code: string;
  route: string;
  message: string;
}

export type ContractChangeCategory =
  | "route"
  | "parameters"
  | "request-schema"
  | "response-status"
  | "response-schema";

export interface BreakingContractChange {
  category: ContractChangeCategory;
  code: string;
  route: string;
  message: string;
}

export interface RouteQualityScore {
  route: string;
  score: number;
  findings: ContractGateFinding[];
  checks: {
    successSchema: boolean;
    pathParameters: boolean;
    requestSchema: boolean;
    errorResponses: boolean;
    examplesOrScenarios: boolean;
    documentation: boolean;
  };
}

export interface ContractQualityAnalysis {
  score: number;
  routeCount: number;
  blockingFindingCount: number;
  warningFindingCount: number;
  routeScores: RouteQualityScore[];
  findings: ContractGateFinding[];
}

export interface ContractGatePolicy {
  minimumScore: number;
  maxBlockingFindings: number;
  maxBreakingChanges: number;
}

export interface ContractGateViolation {
  policy: keyof ContractGatePolicy;
  expected: string;
  actual: number;
  message: string;
}

export interface ContractGateResult {
  version: "1.0";
  generatedAt: string;
  passed: boolean;
  policy: ContractGatePolicy;
  quality: ContractQualityAnalysis;
  baselineCompared: boolean;
  breakingChanges: BreakingContractChange[];
  violations: ContractGateViolation[];
}

export interface EvaluateContractGateOptions {
  currentRoutes: ParsedRoute[];
  baselineRoutes?: ParsedRoute[];
  policy?: Partial<ContractGatePolicy>;
  generatedAt?: Date;
}

type SchemaLike = Record<string, unknown>;

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH"]);
const SCHEMA_METADATA_KEYS = new Set([
  "description",
  "example",
  "examples",
  "externalDocs",
  "title",
]);

export const DEFAULT_CONTRACT_GATE_POLICY: ContractGatePolicy = {
  minimumScore: 80,
  maxBlockingFindings: 0,
  maxBreakingChanges: 0,
};

export function evaluateContractGate(
  options: EvaluateContractGateOptions,
): ContractGateResult {
  const policy = normalizePolicy(options.policy);
  const quality = analyzeContractQuality(options.currentRoutes);
  const breakingChanges = options.baselineRoutes
    ? findBreakingContractChanges(options.baselineRoutes, options.currentRoutes)
    : [];
  const violations: ContractGateViolation[] = [];

  if (quality.score < policy.minimumScore) {
    violations.push({
      policy: "minimumScore",
      expected: `>= ${policy.minimumScore}`,
      actual: quality.score,
      message: `Contract quality score ${quality.score} is below the required ${policy.minimumScore}.`,
    });
  }

  if (quality.blockingFindingCount > policy.maxBlockingFindings) {
    violations.push({
      policy: "maxBlockingFindings",
      expected: `<= ${policy.maxBlockingFindings}`,
      actual: quality.blockingFindingCount,
      message:
        `${quality.blockingFindingCount} blocking quality finding(s) exceed the allowed ` +
        `${policy.maxBlockingFindings}.`,
    });
  }

  if (breakingChanges.length > policy.maxBreakingChanges) {
    violations.push({
      policy: "maxBreakingChanges",
      expected: `<= ${policy.maxBreakingChanges}`,
      actual: breakingChanges.length,
      message:
        `${breakingChanges.length} breaking contract change(s) exceed the allowed ` +
        `${policy.maxBreakingChanges}.`,
    });
  }

  return {
    version: "1.0",
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    passed: violations.length === 0,
    policy,
    quality,
    baselineCompared: options.baselineRoutes !== undefined,
    breakingChanges,
    violations,
  };
}

export function analyzeContractQuality(
  routes: ParsedRoute[],
): ContractQualityAnalysis {
  const routeScores = routes.map(analyzeRouteQuality);
  const findings = routeScores.flatMap((route) => route.findings);
  const score =
    routeScores.length === 0
      ? 0
      : Math.round(
          routeScores.reduce((total, route) => total + route.score, 0) /
            routeScores.length,
        );

  return {
    score,
    routeCount: routeScores.length,
    blockingFindingCount: findings.filter(
      (finding) => finding.severity === "blocking",
    ).length,
    warningFindingCount: findings.filter(
      (finding) => finding.severity === "warning",
    ).length,
    routeScores,
    findings,
  };
}

export function findBreakingContractChanges(
  baselineRoutes: ParsedRoute[],
  currentRoutes: ParsedRoute[],
): BreakingContractChange[] {
  const baselineByKey = mapRoutesByKey(baselineRoutes);
  const currentByKey = mapRoutesByKey(currentRoutes);
  const changes: BreakingContractChange[] = [];

  for (const [key, baseline] of baselineByKey) {
    const current = currentByKey.get(key);
    if (!current) {
      changes.push({
        category: "route",
        code: "route-removed",
        route: key,
        message: "Route was removed from the contract.",
      });
      continue;
    }

    changes.push(...compareRequiredParameters(baseline, current));
    changes.push(...compareRequestSchemas(baseline, current));
    changes.push(...compareSuccessResponses(baseline, current));
  }

  return changes.sort((left, right) => {
    const routeDifference = left.route.localeCompare(right.route);
    return routeDifference !== 0
      ? routeDifference
      : left.code.localeCompare(right.code);
  });
}

export function renderContractGateMarkdown(options: {
  result: ContractGateResult;
  currentSpecPath?: string;
  baselineSpecPath?: string;
}): string {
  const { result } = options;
  const lines = [
    "# MockNest API Quality Gate",
    "",
    `Generated: ${result.generatedAt}`,
    options.currentSpecPath
      ? `Current spec: ${options.currentSpecPath}`
      : "Current spec: loaded routes",
    result.baselineCompared
      ? `Baseline spec: ${options.baselineSpecPath ?? "provided routes"}`
      : "Baseline spec: not compared",
    "",
    "## Decision",
    "",
    `**${result.passed ? "PASS" : "FAIL"}**`,
    "",
    `- Contract quality: ${result.quality.score}/100 (minimum ${result.policy.minimumScore})`,
    `- Blocking findings: ${result.quality.blockingFindingCount} (maximum ${result.policy.maxBlockingFindings})`,
    `- Breaking changes: ${result.breakingChanges.length} (maximum ${result.policy.maxBreakingChanges})`,
    `- Routes analyzed: ${result.quality.routeCount}`,
    "",
  ];

  if (result.violations.length > 0) {
    lines.push(
      "## Policy Violations",
      "",
      ...result.violations.map((violation) => `- ${violation.message}`),
      "",
    );
  }

  appendBreakingChanges(lines, result.breakingChanges);
  appendQualityFindings(lines, result.quality.findings);

  lines.push(
    "## Route Scores",
    "",
    "| Route | Score | Main signal |",
    "| --- | ---: | --- |",
    ...result.quality.routeScores.map((route) => {
      const signal =
        route.findings.length === 0
          ? "Ready"
          : route.findings
              .slice(0, 3)
              .map((finding) => `${finding.severity}: ${finding.code}`)
              .join(", ");
      return [
        codeCell(route.route),
        String(route.score),
        escapeTableCell(signal),
      ].join(" | ");
    }),
    "",
    "## CI Usage",
    "",
    "Run the same policy in automation and block the pull request when the command exits with code 1:",
    "",
    "```bash",
    "mocknest gate --spec openapi.yaml --baseline openapi.baseline.yaml",
    "```",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function analyzeRouteQuality(route: ParsedRoute): RouteQualityScore {
  const label = routeKey(route);
  const findings: ContractGateFinding[] = [];
  const pathParameters = pathParametersAreReady(route, findings);
  const requestSchema = requestSchemaIsReady(route, findings);
  const successSchema = successResponsesHaveSchemas(route, findings);
  const errorResponses = hasErrorOrDefaultResponse(route);
  const examplesOrScenarios = hasExampleOrScenario(route);
  const documentation = Boolean(route.summary || route.description);

  if (!errorResponses) {
    findings.push({
      severity: "warning",
      category: "status-coverage",
      code: "missing-error-response",
      route: label,
      message: "No 4xx, 5xx, or default response is documented.",
    });
  }
  if (!examplesOrScenarios) {
    findings.push({
      severity: "warning",
      category: "examples",
      code: "missing-example-or-scenario",
      route: label,
      message: "No response example or x-mock-responses scenario is available.",
    });
  }
  if (!documentation) {
    findings.push({
      severity: "warning",
      category: "documentation",
      code: "missing-operation-documentation",
      route: label,
      message: "Operation has no summary or description.",
    });
  }

  const score =
    (successSchema ? 30 : 0) +
    (pathParameters ? 20 : 0) +
    (requestSchema ? 20 : 0) +
    (errorResponses ? 15 : 0) +
    (examplesOrScenarios ? 10 : 0) +
    (documentation ? 5 : 0);

  return {
    route: label,
    score,
    findings,
    checks: {
      successSchema,
      pathParameters,
      requestSchema,
      errorResponses,
      examplesOrScenarios,
      documentation,
    },
  };
}

function successResponsesHaveSchemas(
  route: ParsedRoute,
  findings: ContractGateFinding[],
): boolean {
  const successResponses = route.responses.filter(
    (response) => responseStatusFamily(response.statusCode) === 2,
  );
  const missingSchema = successResponses.filter(
    (response) => response.statusCode !== "204" && !response.schema,
  );

  if (successResponses.length === 0) {
    findings.push({
      severity: "blocking",
      category: "status-coverage",
      code: "missing-success-response",
      route: routeKey(route),
      message: "No explicit 2xx response is documented.",
    });
    return false;
  }

  if (missingSchema.length > 0) {
    findings.push({
      severity: "blocking",
      category: "response-schema",
      code: "missing-success-schema",
      route: routeKey(route),
      message: `Success response(s) ${missingSchema
        .map((response) => response.statusCode)
        .join(", ")} have no JSON schema.`,
    });
    return false;
  }

  return true;
}

function pathParametersAreReady(
  route: ParsedRoute,
  findings: ContractGateFinding[],
): boolean {
  const pathNames = extractPathParameterNames(route.path);
  if (pathNames.length === 0) {
    return true;
  }

  const parameters = route.parameters ?? [];
  const missing = pathNames.filter(
    (name) =>
      !parameters.some(
        (parameter) =>
          parameter.in === "path" &&
          parameter.name === name &&
          parameter.required &&
          Boolean(parameter.schema),
      ),
  );
  if (missing.length === 0) {
    return true;
  }

  findings.push({
    severity: "blocking",
    category: "parameters",
    code: "invalid-path-parameter",
    route: routeKey(route),
    message: `Path parameter(s) ${missing.join(
      ", ",
    )} must be declared, required, and have a schema.`,
  });
  return false;
}

function requestSchemaIsReady(
  route: ParsedRoute,
  findings: ContractGateFinding[],
): boolean {
  const method = route.method.toUpperCase();
  const missingRequiredParameterSchemas = (route.parameters ?? []).filter(
    (parameter) => parameter.required && !parameter.schema,
  );

  if (missingRequiredParameterSchemas.length > 0) {
    findings.push({
      severity: "blocking",
      category: "parameters",
      code: "required-parameter-without-schema",
      route: routeKey(route),
      message: `Required parameter(s) ${missingRequiredParameterSchemas
        .map((parameter) => `${parameter.in}:${parameter.name}`)
        .join(", ")} have no schema.`,
    });
    return false;
  }

  if (route.requestRequired && !route.requestSchema) {
    findings.push({
      severity: "blocking",
      category: "request-schema",
      code: "required-body-without-schema",
      route: routeKey(route),
      message: "Required request body has no JSON schema.",
    });
    return false;
  }

  if (MUTATION_METHODS.has(method) && !route.requestSchema) {
    findings.push({
      severity: "warning",
      category: "request-schema",
      code: "mutation-without-request-schema",
      route: routeKey(route),
      message: `${method} operation has no JSON request schema.`,
    });
    return false;
  }

  return true;
}

function compareRequiredParameters(
  baseline: ParsedRoute,
  current: ParsedRoute,
): BreakingContractChange[] {
  const baselineParameters = mapParametersByKey(baseline.parameters);
  const currentParameters = mapParametersByKey(current.parameters);
  const changes: BreakingContractChange[] = [];

  for (const [key, parameter] of currentParameters) {
    const previous = baselineParameters.get(key);
    if (parameter.required && !previous) {
      changes.push({
        category: "parameters",
        code: "required-parameter-added",
        route: routeKey(current),
        message: `Required ${parameter.in} parameter '${parameter.name}' was added.`,
      });
    } else if (parameter.required && previous && !previous.required) {
      changes.push({
        category: "parameters",
        code: "parameter-became-required",
        route: routeKey(current),
        message: `${parameter.in} parameter '${parameter.name}' changed from optional to required.`,
      });
    } else if (
      previous &&
      parameter.required &&
      schemaType(previous.schema) &&
      schemaType(parameter.schema) &&
      schemaType(previous.schema) !== schemaType(parameter.schema)
    ) {
      changes.push({
        category: "parameters",
        code: "required-parameter-type-changed",
        route: routeKey(current),
        message: `Required ${parameter.in} parameter '${parameter.name}' changed type.`,
      });
    }
  }

  return changes;
}

function compareRequestSchemas(
  baseline: ParsedRoute,
  current: ParsedRoute,
): BreakingContractChange[] {
  const changes: BreakingContractChange[] = [];

  if (!baseline.requestRequired && current.requestRequired) {
    changes.push({
      category: "request-schema",
      code: "request-body-became-required",
      route: routeKey(current),
      message: "Request body changed from optional to required.",
    });
  }

  const addedRequired = requiredProperties(current.requestSchema).filter(
    (name) => !requiredProperties(baseline.requestSchema).includes(name),
  );
  if (addedRequired.length > 0) {
    changes.push({
      category: "request-schema",
      code: "required-request-properties-added",
      route: routeKey(current),
      message: `Request schema added required field(s): ${addedRequired.join(", ")}.`,
    });
  }

  const baselineType = schemaType(baseline.requestSchema);
  const currentType = schemaType(current.requestSchema);
  if (baselineType && currentType && baselineType !== currentType) {
    changes.push({
      category: "request-schema",
      code: "request-schema-type-changed",
      route: routeKey(current),
      message: `Request schema type changed from ${baselineType} to ${currentType}.`,
    });
  }

  return changes;
}

function compareSuccessResponses(
  baseline: ParsedRoute,
  current: ParsedRoute,
): BreakingContractChange[] {
  const changes: BreakingContractChange[] = [];
  const currentResponses = new Map(
    current.responses.map((response) => [response.statusCode, response]),
  );

  for (const baselineResponse of baseline.responses.filter(
    (response) => responseStatusFamily(response.statusCode) === 2,
  )) {
    const currentResponse = currentResponses.get(baselineResponse.statusCode);
    if (!currentResponse) {
      changes.push({
        category: "response-status",
        code: "success-status-removed",
        route: routeKey(current),
        message: `Success response ${baselineResponse.statusCode} was removed.`,
      });
      continue;
    }

    const baselineType = schemaType(baselineResponse.schema);
    const currentType = schemaType(currentResponse.schema);
    if (baselineType && currentType && baselineType !== currentType) {
      changes.push({
        category: "response-schema",
        code: "success-response-type-changed",
        route: routeKey(current),
        message: `Response ${baselineResponse.statusCode} type changed from ${baselineType} to ${currentType}.`,
      });
    }

    const removedRequired = requiredProperties(baselineResponse.schema).filter(
      (name) => !requiredProperties(currentResponse.schema).includes(name),
    );
    if (removedRequired.length > 0) {
      changes.push({
        category: "response-schema",
        code: "required-response-properties-removed",
        route: routeKey(current),
        message: `Response ${baselineResponse.statusCode} no longer guarantees field(s): ${removedRequired.join(
          ", ",
        )}.`,
      });
    }

    if (
      schemaFingerprint(baselineResponse.schema) &&
      !schemaFingerprint(currentResponse.schema)
    ) {
      changes.push({
        category: "response-schema",
        code: "success-response-schema-removed",
        route: routeKey(current),
        message: `Response ${baselineResponse.statusCode} schema was removed.`,
      });
    }
  }

  return changes;
}

function normalizePolicy(
  policy: Partial<ContractGatePolicy> | undefined,
): ContractGatePolicy {
  const normalized = {
    ...DEFAULT_CONTRACT_GATE_POLICY,
    ...policy,
  };

  assertIntegerInRange(normalized.minimumScore, "minimumScore", 0, 100);
  assertIntegerInRange(
    normalized.maxBlockingFindings,
    "maxBlockingFindings",
    0,
  );
  assertIntegerInRange(
    normalized.maxBreakingChanges,
    "maxBreakingChanges",
    0,
  );
  return normalized;
}

function assertIntegerInRange(
  value: number,
  name: string,
  minimum: number,
  maximum?: number,
): void {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    const range =
      maximum === undefined
        ? `greater than or equal to ${minimum}`
        : `between ${minimum} and ${maximum}`;
    throw new Error(`${name} must be an integer ${range}.`);
  }
}

function appendBreakingChanges(
  lines: string[],
  changes: BreakingContractChange[],
): void {
  lines.push("## Breaking Changes", "");
  if (changes.length === 0) {
    lines.push("No breaking changes detected.", "");
    return;
  }

  lines.push(
    "| Category | Route | Change |",
    "| --- | --- | --- |",
    ...changes.map((change) =>
      [
        escapeTableCell(change.category),
        codeCell(change.route),
        escapeTableCell(change.message),
      ].join(" | "),
    ),
    "",
  );
}

function appendQualityFindings(
  lines: string[],
  findings: ContractGateFinding[],
): void {
  lines.push("## Quality Findings", "");
  if (findings.length === 0) {
    lines.push("No quality findings.", "");
    return;
  }

  lines.push(
    "| Severity | Route | Finding |",
    "| --- | --- | --- |",
    ...findings.map((finding) =>
      [
        finding.severity.toUpperCase(),
        codeCell(finding.route),
        escapeTableCell(finding.message),
      ].join(" | "),
    ),
    "",
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

function hasExampleOrScenario(route: ParsedRoute): boolean {
  return (
    hasEntries(route.responseExamples) ||
    route.responses.some((response) => hasEntries(response.examples)) ||
    Boolean(route.responseOverrides?.length)
  );
}

function mapRoutesByKey(routes: ParsedRoute[]): Map<string, ParsedRoute> {
  return new Map(routes.map((route) => [routeKey(route), route]));
}

function mapParametersByKey(
  parameters: ParsedParameter[] | undefined,
): Map<string, ParsedParameter> {
  return new Map(
    (parameters ?? []).map((parameter) => [
      `${parameter.in}:${parameter.name}`,
      parameter,
    ]),
  );
}

function routeKey(route: ParsedRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`;
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
    return rawName
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return rawName;
}

function requiredProperties(schema: unknown): string[] {
  if (!schema || isReferenceObject(schema)) {
    return [];
  }
  const schemaObject = schema as SchemaLike;
  if (Array.isArray(schemaObject.allOf)) {
    return [
      ...new Set(schemaObject.allOf.flatMap((part) => requiredProperties(part))),
    ];
  }
  return Array.isArray(schemaObject.required)
    ? schemaObject.required.filter(
        (name): name is string => typeof name === "string",
      )
    : [];
}

function schemaType(schema: unknown): string | undefined {
  if (!schema || isReferenceObject(schema)) {
    return undefined;
  }
  const schemaObject = schema as SchemaLike;
  if (Array.isArray(schemaObject.type)) {
    return schemaObject.type.find(
      (type): type is string =>
        typeof type === "string" && type !== "null",
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
  return schema ? stableStringify(schema, new WeakSet<object>()) : "";
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
    const serialized = `[${value
      .map((item) => stableStringify(item, seen))
      .join(",")}]`;
    seen.delete(value);
    return serialized;
  }

  const record = value as Record<string, unknown>;
  const serialized = `{${Object.keys(record)
    .filter((key) => !SCHEMA_METADATA_KEYS.has(key))
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`,
    )
    .join(",")}}`;
  seen.delete(value);
  return serialized;
}

function hasEntries(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" && Object.keys(value).length > 0,
  );
}

function isReferenceObject(value: unknown): value is { $ref: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}

function codeCell(value: string): string {
  return `\`${escapeTableCell(value)}\``;
}

function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`");
}
