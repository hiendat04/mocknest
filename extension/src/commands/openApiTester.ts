import * as vscode from "vscode";
import {
  ParsedParameter,
  ParsedRoute,
  generateFakeData,
} from "mocknest-core";
import { RouteTreeProvider } from "../providers/routeTreeProvider";

interface RouteParameterInfo {
  name: string;
  in: "path" | "query";
  required: boolean;
  type: string;
}

interface RouteOption {
  method: string;
  path: string;
  examplePath: string;
  summary?: string;
  description?: string;
  expectedStatus: number;
  requestRequired?: boolean;
  responseDescription?: string;
  parameters: RouteParameterInfo[];
  requestExample?: unknown;
  responseExample?: unknown;
}

interface SendRequestPayload {
  baseUrl: string;
  method: string;
  path: string;
  headers: string;
  body: string;
}

interface PresetRoute {
  method: string;
  path: string;
}

export class ApiTesterPanel {
  private static currentPanel: ApiTesterPanel | undefined;
  private static readonly viewType = "mocknest.apiTester";

  static open(
    _context: vscode.ExtensionContext,
    routeTreeProvider: RouteTreeProvider,
    presetRoute?: PresetRoute,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (ApiTesterPanel.currentPanel) {
      ApiTesterPanel.currentPanel.panel.reveal(column);
      ApiTesterPanel.currentPanel.postRoutes();
      if (presetRoute) {
        ApiTesterPanel.currentPanel.postPresetRoute(presetRoute);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ApiTesterPanel.viewType,
      "MockNest API Tester",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    ApiTesterPanel.currentPanel = new ApiTesterPanel(panel, routeTreeProvider);
    ApiTesterPanel.currentPanel.postRoutes();
    if (presetRoute) {
      ApiTesterPanel.currentPanel.postPresetRoute(presetRoute);
    }
  }

  static syncRoutes(routeTreeProvider: RouteTreeProvider): void {
    if (!ApiTesterPanel.currentPanel) {
      return;
    }

    ApiTesterPanel.currentPanel.routeTreeProvider = routeTreeProvider;
    ApiTesterPanel.currentPanel.postRoutes();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private routeTreeProvider: RouteTreeProvider,
  ) {
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => {
      ApiTesterPanel.currentPanel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }

    const typedMessage = message as { type?: string; payload?: unknown };
    switch (typedMessage.type) {
      case "requestRoutes":
        this.postRoutes();
        break;
      case "sendRequest":
        await this.handleSendRequest(typedMessage.payload as SendRequestPayload);
        break;
      default:
        break;
    }
  }

  private postRoutes(): void {
    const routes: RouteOption[] = this.routeTreeProvider
      .getRoutes()
      .map((route) => createRouteOption(route));

    const port = vscode.workspace
      .getConfiguration("mocknest")
      .get<number>("port", 3001);

    void this.panel.webview.postMessage({
      type: "routes",
      payload: {
        routes,
        defaultBaseUrl: `http://localhost:${port}`,
      },
    });
  }

  private postPresetRoute(route: PresetRoute): void {
    void this.panel.webview.postMessage({
      type: "presetRoute",
      payload: route,
    });
  }

  private async handleSendRequest(payload: SendRequestPayload): Promise<void> {
    const startedAt = Date.now();

    let headers: Record<string, string> = {};
    const headersInput = payload.headers.trim();
    if (headersInput.length > 0) {
      try {
        const parsed = JSON.parse(headersInput);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Headers must be a JSON object.");
        }
        headers = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value)]),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.postError(`Invalid headers JSON: ${message}`);
        return;
      }
    }

    const method = payload.method.toUpperCase();
    const url = buildUrl(payload.baseUrl, payload.path);
    const bodyInput = payload.body.trim();

    let requestBody: string | undefined;
    if (bodyInput.length > 0 && method !== "GET" && method !== "HEAD") {
      try {
        requestBody = JSON.stringify(JSON.parse(bodyInput));
        if (!headers["Content-Type"]) {
          headers["Content-Type"] = "application/json";
        }
      } catch {
        requestBody = bodyInput;
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
      });

      const durationMs = Date.now() - startedAt;
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const rawBody = await response.text();
      const responseBody = parseResponseBody(rawBody);

      void this.panel.webview.postMessage({
        type: "response",
        payload: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          headers: responseHeaders,
          body: responseBody,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postError(message);
    }
  }

  private postError(message: string): void {
    void this.panel.webview.postMessage({
      type: "error",
      payload: {
        message,
      },
    });
  }

  private getHtml(): string {
    const nonce = createNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${this.panel.webview.cspSource} https:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MockNest API Tester</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      margin: 0;
      padding: 16px;
      background: var(--vscode-editor-background);
    }

    .layout {
      display: grid;
      gap: 12px;
    }

    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-sideBar-background);
    }

    .label {
      font-size: 12px;
      margin-bottom: 6px;
      color: var(--vscode-descriptionForeground);
    }

    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .row {
      display: grid;
      gap: 10px;
      grid-template-columns: 160px 1fr;
    }

    .row-1 {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr;
    }

    .row-2 {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr 1fr;
    }

    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      background: var(--vscode-editor-background);
    }

    input,
    select,
    textarea,
    button {
      font: inherit;
      color: inherit;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      width: 100%;
      box-sizing: border-box;
    }

    textarea {
      min-height: 110px;
      resize: vertical;
      font-family: var(--vscode-editor-font-family, monospace);
      line-height: 1.4;
    }

    button {
      cursor: pointer;
      width: auto;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      font-weight: 600;
      padding: 8px 14px;
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .status-badge {
      font-weight: 700;
      border-radius: 999px;
      padding: 2px 10px;
      border: 1px solid transparent;
    }

    .status-ok {
      color: #3fb950;
      border-color: #3fb95066;
      background: #3fb9501f;
    }

    .status-error {
      color: #f85149;
      border-color: #f8514966;
      background: #f851491f;
    }

    .contract-pass {
      color: #3fb950;
      border-color: #3fb95066;
      background: #3fb9501f;
    }

    .contract-warn {
      color: #f0883e;
      border-color: #f0883e66;
      background: #f0883e1f;
    }

    .mono {
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editor-background);
      padding: 10px;
      margin: 0;
      min-height: 50px;
    }

    .json-key { color: #79c0ff; }
    .json-string { color: #a5d6ff; }
    .json-number { color: #ffab70; }
    .json-boolean { color: #d2a8ff; }
    .json-null { color: #8b949e; }
  </style>
</head>
<body>
  <div class="layout">
    <section class="card">
      <div class="row-1">
        <div>
          <div class="label">Preset Route</div>
          <select id="routeSelect">
            <option value="">Custom route...</option>
          </select>
        </div>
      </div>

      <div class="row" style="margin-top: 10px;">
        <div>
          <div class="label">Method</div>
          <select id="method">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
            <option>HEAD</option>
            <option>OPTIONS</option>
          </select>
        </div>
        <div>
          <div class="label">Base URL</div>
          <input id="baseUrl" value="http://localhost:3001" />
        </div>
      </div>

      <div class="row-1" style="margin-top: 10px;">
        <div>
          <div class="label">Path</div>
          <input id="path" value="/health" />
        </div>
      </div>

      <div class="row" style="margin-top: 10px;">
        <div>
          <div class="label">Headers (JSON)</div>
          <textarea id="headers" placeholder='{"Authorization":"Bearer token"}'></textarea>
        </div>
        <div>
          <div class="label">Body (JSON or raw text)</div>
          <textarea id="body" placeholder='{"name":"Alice"}'></textarea>
        </div>
      </div>

      <div class="actions" style="margin-top: 10px;">
        <button id="sendButton">Send Request</button>
        <button id="refreshButton" class="secondary">Refresh Routes</button>
      </div>
      <p class="muted" style="margin-bottom: 0;">Tip: start MockNest server first, then send requests from this panel.</p>
    </section>

    <section class="card">
      <div class="label">Endpoint Insight</div>
      <div class="muted" id="endpointSummary">Select a route to see useful contract details.</div>

      <div class="row-2" style="margin-top: 10px;">
        <div>
          <div class="label">Expected Status</div>
          <div id="endpointStatus" class="mono">-</div>
        </div>
        <div>
          <div class="label">Response Description</div>
          <div id="endpointResponseDescription" class="mono">-</div>
        </div>
      </div>

      <div class="label" style="margin-top: 10px;">Path Parameters</div>
      <div id="pathParamList" class="chip-list"><span class="muted">None</span></div>

      <div class="label" style="margin-top: 10px;">Query Parameters</div>
      <div id="queryParamList" class="chip-list"><span class="muted">None</span></div>

      <div class="row-2" style="margin-top: 10px;">
        <div>
          <div class="label" id="requestExampleLabel">Sample Request Body</div>
          <pre id="requestExample" class="mono">(No request body schema)</pre>
        </div>
        <div>
          <div class="label">Expected Response Body</div>
          <pre id="responseExample" class="mono">(No JSON response schema)</pre>
        </div>
      </div>

      <div class="label" style="margin-top: 10px;">Contract Check</div>
      <div id="contractCheck" class="mono">Select a route and send a request to validate contract behavior.</div>
    </section>

    <section class="card">
      <div class="status">
        <span id="statusBadge" class="status-badge">No response yet</span>
        <span id="meta"></span>
      </div>

      <div class="label">Response Headers</div>
      <pre id="responseHeaders" class="mono">{}</pre>

      <div class="label" style="margin-top: 10px;">Response Body</div>
      <pre id="responseBody" class="mono">(empty)</pre>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const routeSelect = document.getElementById("routeSelect");
    const methodInput = document.getElementById("method");
    const baseUrlInput = document.getElementById("baseUrl");
    const pathInput = document.getElementById("path");
    const headersInput = document.getElementById("headers");
    const bodyInput = document.getElementById("body");
    const sendButton = document.getElementById("sendButton");
    const refreshButton = document.getElementById("refreshButton");

    const endpointSummary = document.getElementById("endpointSummary");
    const endpointStatus = document.getElementById("endpointStatus");
    const endpointResponseDescription = document.getElementById("endpointResponseDescription");
    const pathParamList = document.getElementById("pathParamList");
    const queryParamList = document.getElementById("queryParamList");
    const requestExampleLabel = document.getElementById("requestExampleLabel");
    const requestExample = document.getElementById("requestExample");
    const responseExample = document.getElementById("responseExample");
    const contractCheck = document.getElementById("contractCheck");

    const statusBadge = document.getElementById("statusBadge");
    const meta = document.getElementById("meta");
    const responseHeaders = document.getElementById("responseHeaders");
    const responseBody = document.getElementById("responseBody");

    let routeOptions = [];

    refreshButton.addEventListener("click", () => {
      vscode.postMessage({ type: "requestRoutes" });
    });

    routeSelect.addEventListener("change", () => {
      const index = Number(routeSelect.value);
      const selected = Number.isNaN(index) ? undefined : routeOptions[index];
      if (!selected) {
        renderRouteInsight(undefined);
        return;
      }
      applyRoute(selected, true);
    });

    sendButton.addEventListener("click", () => {
      const payload = {
        baseUrl: baseUrlInput.value.trim(),
        method: methodInput.value.trim(),
        path: pathInput.value.trim(),
        headers: headersInput.value,
        body: bodyInput.value,
      };

      const selectedRoute = getSelectedRoute();
      const validationMessage = validateBeforeSend(selectedRoute, payload);
      if (validationMessage) {
        statusBadge.className = "status-badge status-error";
        statusBadge.textContent = "Blocked";
        meta.textContent = "";
        contractCheck.className = "mono contract-warn";
        contractCheck.textContent = validationMessage;
        return;
      }

      statusBadge.className = "status-badge";
      statusBadge.textContent = "Sending...";
      meta.textContent = "";

      vscode.postMessage({ type: "sendRequest", payload });
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || !message.type) {
        return;
      }

      if (message.type === "routes") {
        const payload = message.payload || {};
        const routes = Array.isArray(payload.routes) ? payload.routes : [];
        routeOptions = routes;
        if (typeof payload.defaultBaseUrl === "string" && payload.defaultBaseUrl.length > 0) {
          baseUrlInput.value = payload.defaultBaseUrl;
        }

        routeSelect.innerHTML = "";
        const firstOption = document.createElement("option");
        firstOption.value = "";
        firstOption.textContent = "Custom route...";
        routeSelect.appendChild(firstOption);

        routes.forEach((route, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = route.summary
            ? route.method + " " + route.path + " - " + route.summary
            : route.method + " " + route.path;
          routeSelect.appendChild(option);
        });

        if (routes.length > 0 && routeSelect.value === "") {
          routeSelect.value = "0";
          applyRoute(routes[0], false);
        }
        return;
      }

      if (message.type === "presetRoute") {
        const payload = message.payload || {};
        const method = payload.method ? String(payload.method).toUpperCase() : "";
        const path = payload.path ? String(payload.path) : "";
        const matchingIndex = routeOptions.findIndex((route) => {
          return route.method === method && route.path === path;
        });

        if (matchingIndex >= 0) {
          routeSelect.value = String(matchingIndex);
          applyRoute(routeOptions[matchingIndex], true);
          return;
        }

        if (method) {
          methodInput.value = method;
        }
        if (path) {
          pathInput.value = path;
        }
        return;
      }

      if (message.type === "response") {
        const payload = message.payload || {};
        const isOk = Boolean(payload.ok);
        statusBadge.className = "status-badge " + (isOk ? "status-ok" : "status-error");
        statusBadge.textContent = (String(payload.status) + " " + String(payload.statusText || "")).trim();
        meta.textContent = String(payload.durationMs) + " ms";

        const headersJson = JSON.stringify(payload.headers || {}, null, 2);
        responseHeaders.innerHTML = syntaxHighlight(headersJson);

        const body = payload.body || { kind: "empty" };
        if (body.kind === "json") {
          responseBody.innerHTML = syntaxHighlight(JSON.stringify(body.value, null, 2));
        } else if (body.kind === "text") {
          responseBody.textContent = String(body.value || "");
        } else {
          responseBody.textContent = "(empty)";
        }

        updateContractCheck(getSelectedRoute(), Number(payload.status));
        return;
      }

      if (message.type === "error") {
        statusBadge.className = "status-badge status-error";
        statusBadge.textContent = "Request failed";
        meta.textContent = "";
        responseHeaders.textContent = "{}";
        responseBody.textContent = message.payload && message.payload.message
          ? message.payload.message
          : "Unknown error";
      }
    });

    function applyRoute(route, shouldFillBody) {
      methodInput.value = route.method;
      pathInput.value = route.examplePath || route.path;
      renderRouteInsight(route);

      if (!shouldFillBody) {
        return;
      }

      const method = String(route.method || "").toUpperCase();
      const allowsBody = method !== "GET" && method !== "HEAD";

      if (allowsBody && route.requestExample) {
        bodyInput.value = JSON.stringify(route.requestExample, null, 2);
      } else {
        bodyInput.value = "";
      }
    }

    function renderRouteInsight(route) {
      if (!route) {
        endpointSummary.textContent = "Select a route to see useful contract details.";
        endpointStatus.textContent = "-";
        endpointResponseDescription.textContent = "-";
        pathParamList.innerHTML = '<span class="muted">None</span>';
        queryParamList.innerHTML = '<span class="muted">None</span>';
        requestExampleLabel.textContent = "Sample Request Body";
        requestExample.textContent = "(No request body schema)";
        responseExample.textContent = "(No JSON response schema)";
        contractCheck.className = "mono";
        contractCheck.textContent = "Select a route and send a request to validate contract behavior.";
        return;
      }

      endpointSummary.textContent = route.summary || route.description || "No endpoint summary available.";
      endpointStatus.textContent = String(route.expectedStatus || "-");
      endpointResponseDescription.textContent = route.responseDescription || "No response description provided.";

      renderParameterList(pathParamList, route.parameters, "path");
      renderParameterList(queryParamList, route.parameters, "query");

      if (route.requestRequired) {
        requestExampleLabel.textContent = "Sample Request Body (required)";
      } else {
        requestExampleLabel.textContent = "Sample Request Body";
      }

      if (route.requestExample) {
        requestExample.innerHTML = syntaxHighlight(JSON.stringify(route.requestExample, null, 2));
      } else {
        requestExample.textContent = "(No request body schema)";
      }

      if (route.responseExample) {
        responseExample.innerHTML = syntaxHighlight(JSON.stringify(route.responseExample, null, 2));
      } else {
        responseExample.textContent = "(No JSON response schema)";
      }

      contractCheck.className = "mono";
      contractCheck.textContent = "Expected status from OpenAPI: " + String(route.expectedStatus);
    }

    function getSelectedRoute() {
      const index = Number(routeSelect.value);
      if (Number.isNaN(index)) {
        return undefined;
      }
      return routeOptions[index];
    }

    function validateBeforeSend(route, payload) {
      if (!route) {
        return undefined;
      }

      const method = String(payload.method || "").toUpperCase();
      const body = String(payload.body || "").trim();
      const allowsBody = method !== "GET" && method !== "HEAD";

      if (route.requestRequired && allowsBody && body.length === 0) {
        return "OpenAPI marks this request body as required. Provide a payload before sending.";
      }

      const unresolvedPathParam = /:[a-zA-Z0-9_]+/.test(String(payload.path || ""));
      if (unresolvedPathParam) {
        return "Path contains unresolved parameter tokens (for example :id). Replace them with actual values.";
      }

      const requiredQueryParams = Array.isArray(route.parameters)
        ? route.parameters.filter((parameter) => parameter.in === "query" && parameter.required)
        : [];

      if (requiredQueryParams.length > 0) {
        const queryString = String(payload.path || "").split("?")[1] || "";
        const searchParams = new URLSearchParams(queryString);
        const missing = requiredQueryParams
          .map((parameter) => parameter.name)
          .filter((name) => !searchParams.has(name));

        if (missing.length > 0) {
          return "Missing required query parameter(s): " + missing.join(", ");
        }
      }

      return undefined;
    }

    function updateContractCheck(route, actualStatus) {
      if (!route || !Number.isFinite(actualStatus)) {
        contractCheck.className = "mono";
        contractCheck.textContent = "No contract route selected for validation.";
        return;
      }

      if (Number(route.expectedStatus) === Number(actualStatus)) {
        contractCheck.className = "mono contract-pass";
        contractCheck.textContent = "Contract PASS: expected " + String(route.expectedStatus) + ", got " + String(actualStatus) + ".";
        return;
      }

      contractCheck.className = "mono contract-warn";
      contractCheck.textContent = "Contract WARN: expected " + String(route.expectedStatus) + ", got " + String(actualStatus) + ".";
    }

    function renderParameterList(target, allParams, location) {
      const params = Array.isArray(allParams)
        ? allParams.filter((param) => param.in === location)
        : [];

      if (params.length === 0) {
        target.innerHTML = '<span class="muted">None</span>';
        return;
      }

      target.innerHTML = "";
      params.forEach((param) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = param.name + " (" + param.type + ")" + (param.required ? " *" : "");
        target.appendChild(chip);
      });
    }

    function syntaxHighlight(jsonText) {
      const escaped = escapeHtml(jsonText);
      return escaped.replace(
        /(\"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\\"])*\"\s*:?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
        (match, stringPart, boolPart, nullPart, numberPart) => {
          if (stringPart) {
            if (stringPart.endsWith(":")) {
              return '<span class="json-key">' + stringPart + "</span>";
            }
            return '<span class="json-string">' + stringPart + "</span>";
          }
          if (boolPart) {
            return '<span class="json-boolean">' + boolPart + "</span>";
          }
          if (nullPart) {
            return '<span class="json-null">' + nullPart + "</span>";
          }
          return '<span class="json-number">' + numberPart + "</span>";
        }
      );
    }

    function escapeHtml(value) {
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    vscode.postMessage({ type: "requestRoutes" });
  </script>
</body>
</html>`;
  }
}

function createRouteOption(route: ParsedRoute): RouteOption {
  return {
    method: route.method,
    path: route.path,
    examplePath: hydratePath(route.path, route.parameters || []),
    summary: route.summary,
    description: route.description,
    expectedStatus: route.statusCode,
    requestRequired: route.requestRequired,
    responseDescription: route.responseDescription,
    parameters: (route.parameters || []).map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      type: inferParameterType(parameter),
    })),
    requestExample: createExample(route.requestSchema),
    responseExample: createExample(route.responseSchema),
  };
}

function createExample(
  schema: ParsedRoute["requestSchema"] | ParsedRoute["responseSchema"],
): unknown | undefined {
  if (!schema || isReferenceObject(schema)) {
    return undefined;
  }

  try {
    return generateFakeData(schema);
  } catch {
    return undefined;
  }
}

function inferParameterType(parameter: ParsedParameter): string {
  const schema = parameter.schema;
  if (!schema || isReferenceObject(schema)) {
    return "string";
  }

  return typeof schema.type === "string" ? schema.type : "string";
}

function hydratePath(path: string, parameters: ParsedParameter[]): string {
  const pathParameters = parameters.filter((parameter) => parameter.in === "path");
  if (pathParameters.length === 0) {
    return path;
  }

  return path.replace(/:([a-zA-Z0-9_]+)/g, (_match, name: string) => {
    const parameter = pathParameters.find((item) => item.name === name);
    return sampleParameterValue(parameter ?? { name, in: "path", required: true });
  });
}

function sampleParameterValue(parameter: Partial<ParsedParameter>): string {
  const schema = parameter.schema;
  if (schema && !isReferenceObject(schema)) {
    if (schema.type === "integer" || schema.type === "number") {
      return "1";
    }
    if (schema.type === "boolean") {
      return "true";
    }
  }

  if (parameter.name?.toLowerCase().includes("id")) {
    return "sample-id";
  }

  return "sample";
}

function parseResponseBody(rawBody: string):
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "empty" } {
  if (rawBody.trim().length === 0) {
    return { kind: "empty" };
  }

  try {
    return {
      kind: "json",
      value: JSON.parse(rawBody),
    };
  } catch {
    return {
      kind: "text",
      value: rawBody,
    };
  }
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isReferenceObject(value: unknown): value is { $ref: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
