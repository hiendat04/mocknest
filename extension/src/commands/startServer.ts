import * as vscode from "vscode";
import { MockServer, type ParsedRoute, parseOpenApiFile } from "mocknest-core";
import { RouteTreeProvider } from "../providers/routeTreeProvider";

export async function startServerCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
  onStarted?: (
    server: MockServer,
    port: number,
    requestInfo?: {
      method: string;
      path: string;
      statusCode: number;
      requestBody?: any;
      responseBody?: any;
      requestHeaders?: Record<string, any>;
    },
  ) => void,
  isRestart: boolean = false,
): Promise<void> {
  const specPath = await resolveSpecPath(context);
  if (!specPath) {
    vscode.window.showErrorMessage("No OpenAPI spec file selected.");
    return;
  }

  const config = vscode.workspace.getConfiguration("mocknest");
  const port = config.get<number>("port", 3001);
  const proxyTarget = config.get<string>("proxyTarget", "");

  let parseResult: {
    routes: ParsedRoute[];
    api: any;
    securitySchemes: Record<string, any>;
  };
  try {
    parseResult = await parseOpenApiFile(specPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to parse OpenAPI spec: ${message}`);
    return;
  }

  const { routes, api, securitySchemes } = parseResult;
  routeTreeProvider.refresh(routes);

  const delay = config.get<number>("delay", 20);
  const delayJitter = config.get<number>("delayJitter", 0);
  const errorRate = config.get<number>("errorRate", 0);
  const errorStatusCodes = config.get<number[]>("errorStatusCodes", [500]);
  const strictValidation = config.get<boolean>("strictValidation", false);
  const simulateAuth = config.get<boolean>("simulateAuth", false);
  const stateful = config.get<boolean>("stateful", false);
  const statePathConfig = config.get<string>("statePath", ".mocknest/state.json");
  const proxyRecord = config.get<boolean>("proxyRecord", false);

  let statePath: string | undefined = undefined;
  if (stateful && statePathConfig) {
    if (require("path").isAbsolute(statePathConfig)) {
      statePath = statePathConfig;
    } else {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        statePath = require("path").join(workspaceRoot, statePathConfig);
      }
    }
  }

  const server = new MockServer({
    port,
    routes,
    api,
    proxyTarget: proxyTarget || undefined,
    delay,
    delayJitter,
    errorRate,
    errorStatusCodes,
    strictValidation,
    simulateAuth,
    securitySchemes,
    stateful,
    statePath,
    proxyRecord,
    onRequest: (
      method,
      path,
      statusCode,
      requestBody,
      responseBody,
      requestHeaders,
    ) => {
      onStarted?.(server, port, {
        method,
        path,
        statusCode,
        requestBody,
        responseBody,
        requestHeaders,
      });
      void vscode.commands.executeCommand("setContext", "mocknest.lastRequest", {
        method,
        path,
        statusCode,
      });
    },
  });

  try {
    await server.start();
    onStarted?.(server, port);
    if (!isRestart) {
      vscode.window.showInformationMessage(
        `MockNest running on http://localhost:${port}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to start mock server: ${message}`);
  }
}

async function resolveSpecPath(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const configured = context.workspaceState.get<string>("mocknest.specPath");
  if (configured) {
    return configured;
  }

  const files = await vscode.workspace.findFiles(
    "**/{openapi,swagger,api-spec}.{yaml,yml,json}",
    "**/node_modules/**",
  );
  if (files.length === 0) {
    return undefined;
  }

  if (files.length === 1) {
    const single = files[0].fsPath;
    await context.workspaceState.update("mocknest.specPath", single);
    return single;
  }

  const picked = await vscode.window.showQuickPick(
    files.map((file) => file.fsPath),
    {
      placeHolder: "Select your OpenAPI spec file",
    },
  );

  if (picked) {
    await context.workspaceState.update("mocknest.specPath", picked);
  }

  return picked;
}
