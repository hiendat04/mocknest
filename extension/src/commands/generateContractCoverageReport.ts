import * as vscode from "vscode";
import type { ParsedRoute } from "mocknest-core";
import type { RequestLogEntry } from "../providers/requestLogProvider";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

interface CoverageRow {
  route: ParsedRoute;
  hits: RequestLogEntry[];
  matchingStatusHits: RequestLogEntry[];
  lastHit?: RequestLogEntry;
}

interface UnmatchedRequest {
  entry: RequestLogEntry;
}

const SPEC_PATH_STATE_KEY = "mocknest.specPath";

export async function generateContractCoverageReportCommand(
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

  const report = buildContractCoverageReport({
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

function buildContractCoverageReport(options: {
  routes: ParsedRoute[];
  requestLogEntries: RequestLogEntry[];
  specPath?: string;
  generatedAt: Date;
}): string {
  const coverageRows = options.routes.map((route) => {
    const hits = options.requestLogEntries.filter(
      (entry) =>
        entry.method.toUpperCase() === route.method.toUpperCase() &&
        matchesRoutePath(route.path, entry.path),
    );
    const matchingStatusHits = hits.filter((entry) =>
      route.responses.length > 0
        ? route.responses.some((response) =>
            responseStatusMatches(response.statusCode, entry.statusCode),
          )
        : entry.statusCode === route.statusCode,
    );
    return {
      route,
      hits,
      matchingStatusHits,
      lastHit: hits[0],
    };
  });

  const unmatchedRequests = options.requestLogEntries
    .filter(
      (entry) =>
        !options.routes.some(
          (route) =>
            entry.method.toUpperCase() === route.method.toUpperCase() &&
            matchesRoutePath(route.path, entry.path),
        ),
    )
    .map((entry) => ({ entry }));

  return renderMarkdownReport({
    coverageRows,
    unmatchedRequests,
    specPath: options.specPath,
    generatedAt: options.generatedAt,
    requestCount: options.requestLogEntries.length,
  });
}

function renderMarkdownReport(options: {
  coverageRows: CoverageRow[];
  unmatchedRequests: UnmatchedRequest[];
  specPath?: string;
  generatedAt: Date;
  requestCount: number;
}): string {
  const coveredRoutes = options.coverageRows.filter((row) => row.hits.length > 0);
  const statusMatchedRoutes = options.coverageRows.filter(
    (row) => row.matchingStatusHits.length > 0,
  );
  const uncoveredRoutes = options.coverageRows.filter((row) => row.hits.length === 0);
  const coveragePct = percentage(coveredRoutes.length, options.coverageRows.length);
  const statusMatchPct = percentage(
    statusMatchedRoutes.length,
    options.coverageRows.length,
  );

  const lines = [
    "# MockNest Contract Coverage Report",
    "",
    `Generated: ${options.generatedAt.toISOString()}`,
    options.specPath ? `Spec: ${options.specPath}` : "Spec: not selected",
    "",
    "## Summary",
    "",
    `- Routes in contract: ${options.coverageRows.length}`,
    `- Request log entries analyzed: ${options.requestCount}`,
    `- Routes exercised: ${coveredRoutes.length} (${coveragePct})`,
    `- Routes with documented status observed: ${statusMatchedRoutes.length} (${statusMatchPct})`,
    `- Unmatched requests: ${options.unmatchedRequests.length}`,
    "",
    "## Route Coverage",
    "",
    "| Route | Hits | Last Status | Contract Signal |",
    "| --- | ---: | --- | --- |",
    ...options.coverageRows.map(renderCoverageRow),
    "",
  ];

  if (uncoveredRoutes.length > 0) {
    lines.push(
      "## Uncovered Routes",
      "",
      ...uncoveredRoutes.map((row) => `- \`${row.route.method} ${row.route.path}\``),
      "",
    );
  }

  if (options.unmatchedRequests.length > 0) {
    lines.push(
      "## Unmatched Requests",
      "",
      "| Request | Status | Last Seen |",
      "| --- | ---: | --- |",
      ...options.unmatchedRequests.map(({ entry }) =>
        [
          codeCell(`${entry.method.toUpperCase()} ${entry.path}`),
          String(entry.statusCode),
          entry.timestamp,
        ].join(" | "),
      ),
      "",
    );
  }

  lines.push(
    "## How To Use This",
    "",
    "- Exercise uncovered routes from the API Tester.",
    "- Investigate routes where no documented OpenAPI response status has been observed.",
    "- Share this report with a pull request when changing API behavior.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function renderCoverageRow(row: CoverageRow): string {
  const lastStatus = row.lastHit ? String(row.lastHit.statusCode) : "-";
  const signal =
    row.hits.length === 0
      ? "Not exercised"
      : row.matchingStatusHits.length > 0
        ? "Documented status observed"
        : "No documented status observed";

  return [
    codeCell(`${row.route.method} ${row.route.path}`),
    String(row.hits.length),
    lastStatus,
    signal,
  ].join(" | ");
}

function codeCell(value: string): string {
  return `\`${escapeTableCell(value)}\``;
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

function percentage(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function responseStatusMatches(statusPattern: string, actualStatus: number): boolean {
  if (statusPattern === "default") return true;
  if (/^\dXX$/i.test(statusPattern)) {
    return Math.floor(actualStatus / 100) === Number(statusPattern[0]);
  }
  return Number(statusPattern) === actualStatus;
}

function matchesRoutePath(routePath: string, requestPath: string): boolean {
  const routeSegments = splitPath(routePath);
  const requestSegments = splitPath(requestPath);
  if (routeSegments.length !== requestSegments.length) return false;

  return routeSegments.every((segment, index) => {
    if (isExpressPathParameter(segment)) return requestSegments[index].length > 0;
    return segment === requestSegments[index];
  });
}

function splitPath(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function isExpressPathParameter(segment: string): boolean {
  return segment.startsWith(":");
}
