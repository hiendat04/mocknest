import * as vscode from "vscode";
import { MockServer, type ParsedRoute, parseOpenApiFile } from "mocknest-core";
import { RouteTreeProvider } from "../providers/routeTreeProvider";

export async function startServerCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
  onStarted?: (
    server: MockServer,
    port: number,
    requestInfo?: { method: string; path: string; statusCode: number },
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

  let routes: ParsedRoute[];
  try {
    routes = await parseOpenApiFile(specPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to parse OpenAPI spec: ${message}`);
    return;
  }

  routeTreeProvider.refresh(routes);

  const delay = config.get<number>("delay", 20);
  const errorRate = config.get<number>("errorRate", 0);
  const strictValidation = config.get<boolean>("strictValidation", false);

  const server = new MockServer({
    port,
    routes,
    delay,
    errorRate,
    strictValidation,
    onRequest: (method, path, statusCode) => {
      onStarted?.(server, port, { method, path, statusCode });
      void vscode.commands.executeCommand(
        "setContext",
        "mocknest.lastRequest",
        {
          method,
          path,
          statusCode,
        },
      );
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

  const files = await vscode.workspace.findFiles("**/openapi.{yaml,yml,json}");
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
