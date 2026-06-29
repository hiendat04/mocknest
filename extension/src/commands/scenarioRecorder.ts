import * as vscode from "vscode";
import type { ParsedRoute, ResponseOverrideRule } from "mocknest-core";
import type { RequestLogEntry, RequestLogItem } from "../providers/requestLogProvider";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

interface RouteMatch {
  route: ParsedRoute;
  params: Record<string, string>;
}

interface ScenarioPack {
  version: "1.0";
  timestamp: string;
  source: "request-log";
  overrides: ResponseOverrideRule[];
  state: Record<string, never>;
}

const INTERNAL_HEADER_NAMES = new Set([
  "accept-encoding",
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "set-cookie",
  "user-agent",
  "x-api-key",
]);

export async function recordRequestAsScenarioCommand(
  item: RequestLogItem | undefined,
  routeTreeProvider: RouteTreeProvider,
  latestEntry: RequestLogEntry | undefined,
): Promise<void> {
  const entry = item?.entry ?? latestEntry;
  if (!entry) {
    vscode.window.showInformationMessage("No request log entries available.");
    return;
  }

  const scenario = buildScenarioFromRequestLogEntry(
    entry,
    routeTreeProvider.getRoutes(),
  );
  const port = vscode.workspace
    .getConfiguration("mocknest")
    .get<number>("port", 3001);

  try {
    const response = await fetch(`http://localhost:${port}/__mocknest/overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario),
    });

    if (!response.ok) {
      throw new Error(`Mock server returned ${response.status}`);
    }

    const action = await vscode.window.showInformationMessage(
      `Recorded replay scenario: ${scenario.name}`,
      "Open JSON",
    );
    if (action === "Open JSON") {
      await openScenarioDocument(scenario);
    }
  } catch (error) {
    await openScenarioDocument(scenario);
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(
      `Could not apply scenario to the running server: ${message}. Opened JSON instead.`,
    );
  }
}

export async function exportRequestLogScenariosCommand(
  entries: RequestLogEntry[],
  routeTreeProvider: RouteTreeProvider,
): Promise<void> {
  if (entries.length === 0) {
    vscode.window.showInformationMessage("No request log entries available.");
    return;
  }

  const pack = buildScenarioPack(entries, routeTreeProvider.getRoutes());
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = workspaceRoot
    ? vscode.Uri.joinPath(workspaceRoot, "mocknest-scenarios.json")
    : undefined;

  const fileUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { JSON: ["json"] },
    title: "Export MockNest Scenario Pack",
  });

  if (!fileUri) {
    return;
  }

  const content = JSON.stringify(pack, null, 2);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf-8"));
  vscode.window.showInformationMessage(
    `Exported ${pack.overrides.length} replay scenario(s) to ${fileUri.fsPath}`,
  );
}

export function buildScenarioPack(
  entries: RequestLogEntry[],
  routes: ParsedRoute[],
): ScenarioPack {
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    source: "request-log",
    overrides: entries.map((entry) =>
      buildScenarioFromRequestLogEntry(entry, routes),
    ),
    state: {},
  };
}

export function buildScenarioFromRequestLogEntry(
  entry: RequestLogEntry,
  routes: ParsedRoute[],
): ResponseOverrideRule {
  const method = entry.method.toUpperCase();
  const path = stripQuery(entry.path);
  const query = parseQuery(entry.path);
  const routeMatch = findMatchingRoute(method, path, routes);
  const match: NonNullable<ResponseOverrideRule["match"]> = {};
  const requestHeaders = normalizeReplayHeaders(entry.requestHeaders);

  if (routeMatch && Object.keys(routeMatch.params).length > 0) {
    match.params = routeMatch.params;
  }
  if (Object.keys(query).length > 0) {
    match.query = query;
  }
  if (hasBody(entry.requestBody) && requestCanHaveBody(method)) {
    match.body = entry.requestBody;
  }
  if (Object.keys(requestHeaders).length > 0) {
    match.headers = requestHeaders;
  }

  const scenarioPath = routeMatch?.route.path ?? path;
  const scenario: ResponseOverrideRule = {
    id: createScenarioId(entry),
    name: `Replay ${method} ${path} -> ${entry.statusCode}`,
    method,
    path: scenarioPath,
    response: {
      statusCode: entry.statusCode,
    },
  };

  if (Object.keys(match).length > 0) {
    scenario.match = match;
  }
  if (entry.responseBody !== undefined) {
    scenario.response.body = entry.responseBody;
  }

  return scenario;
}

async function openScenarioDocument(scenario: ResponseOverrideRule): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify(scenario, null, 2),
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

function findMatchingRoute(
  method: string,
  requestPath: string,
  routes: ParsedRoute[],
): RouteMatch | undefined {
  for (const route of routes) {
    if (route.method.toUpperCase() !== method) {
      continue;
    }

    const params = matchPath(route.path, requestPath);
    if (params) {
      return { route, params };
    }
  }

  return undefined;
}

function matchPath(
  routePath: string,
  requestPath: string,
): Record<string, string> | undefined {
  const routeSegments = splitPath(routePath);
  const requestSegments = splitPath(requestPath);
  if (routeSegments.length !== requestSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const requestSegment = requestSegments[index];
    const parameterName = getExpressParameterName(routeSegment);
    if (parameterName) {
      params[parameterName] = decodeURIComponent(requestSegment);
      continue;
    }
    if (routeSegment !== requestSegment) {
      return undefined;
    }
  }

  return params;
}

function getExpressParameterName(segment: string): string | undefined {
  if (!segment.startsWith(":")) {
    return undefined;
  }

  if (segment.startsWith(':"') && segment.endsWith('"')) {
    return segment.slice(2, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return segment.slice(1);
}

function normalizeReplayHeaders(
  headers: RequestLogEntry["requestHeaders"],
): Record<string, string> {
  if (!headers) {
    return {};
  }

  const replayHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (INTERNAL_HEADER_NAMES.has(normalizedKey)) {
      continue;
    }
    if (normalizedKey.startsWith("x-mock-")) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    replayHeaders[key] = Array.isArray(value) ? value.map(String).join(", ") : String(value);
  }
  return replayHeaders;
}

function parseQuery(path: string): Record<string, string | string[]> {
  const queryString = path.split("?")[1];
  if (!queryString) {
    return {};
  }

  const params = new URLSearchParams(queryString);
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }
  return query;
}

function stripQuery(path: string): string {
  return path.split("?")[0] || "/";
}

function splitPath(path: string): string[] {
  return stripQuery(path).split("/").filter(Boolean);
}

function hasBody(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function requestCanHaveBody(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function createScenarioId(entry: RequestLogEntry): string {
  const timestamp = entry.timestamp.replace(/[^0-9A-Za-z]+/g, "-");
  const path = stripQuery(entry.path)
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `replay-${entry.method.toLowerCase()}-${path || "root"}-${entry.statusCode}-${timestamp}`;
}
