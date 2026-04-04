import * as vscode from "vscode";
import { RouteItem, RouteTreeProvider } from "./providers/routeTreeProvider";
import { startServerCommand } from "./commands/startServer";
import { stopServerCommand } from "./commands/stopServer";
import { MockServer } from "mocknest-core";
import { parseOpenApiFile } from "mocknest-core";
import { watchOpenApiFile } from "./utils/fileWatcher";
import restartServerCommand from "./commands/restartServer";
import { ApiTesterPanel } from "./commands/openApiTester";
import {
  RequestLogEntry,
  RequestLogItem,
  RequestLogProvider,
} from "./providers/requestLogProvider";

// Keep one server instance for the extension lifecycle.
let mockServer: MockServer | null = null;
const REQUEST_LOG_STATE_KEY = "mocknest.requestLogEntries";

export function activate(context: vscode.ExtensionContext) {
  const routeTreeProvider = new RouteTreeProvider();
  const requestLogProvider = new RequestLogProvider();
  const persistedEntries = context.workspaceState.get<RequestLogEntry[]>(
    REQUEST_LOG_STATE_KEY,
    [],
  );
  requestLogProvider.restore(persistedEntries);
  vscode.window.registerTreeDataProvider(
    "mocknest.routeTree",
    routeTreeProvider,
  );
  vscode.window.registerTreeDataProvider(
    "mocknest.requestLog",
    requestLogProvider,
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.command = "mocknest.startServer";
  context.subscriptions.push(statusBar);

  const updateStatusBar = (running: boolean, port?: number) => {
    if (running && port) {
      statusBar.text = `$(zap) MockNest: ON :${port}`;
      statusBar.command = "mocknest.stopServer";
      statusBar.tooltip = "Click to stop the MockNest server";
    } else {
      statusBar.text = "$(circle-slash) MockNest: OFF";
      statusBar.command = "mocknest.startServer";
      statusBar.tooltip = "Click to start the MockNest server";
    }
    statusBar.show();
  };

  updateStatusBar(false);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mocknest.startServer",
      async (isRestart: boolean = false) => {
        await startServerCommand(
          context,
          routeTreeProvider,
          (server, port, requestInfo) => {
            mockServer = server;
            updateStatusBar(true, port);
            if (requestInfo) {
              requestLogProvider.append(
                requestInfo.method,
                requestInfo.path,
                requestInfo.statusCode,
              );
              void persistRequestLog(context, requestLogProvider);
            } else {
              ApiTesterPanel.syncRoutes(routeTreeProvider);
            }
          },
          isRestart,
        );
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.stopServer",
      async (isRestart: boolean = false) => {
        await stopServerCommand(mockServer, isRestart);
        mockServer = null;
        routeTreeProvider.clear();
        updateStatusBar(false);
      },
    ),

    vscode.commands.registerCommand("mocknest.selectSpec", () =>
      selectSpecCommand(routeTreeProvider),
    ),

    vscode.commands.registerCommand(
      "mocknest.openApiTester",
      (item?: RouteItem) => {
        ApiTesterPanel.open(
          context,
          routeTreeProvider,
          item
            ? {
                method: item.route.method,
                path: item.route.path,
              }
            : undefined,
        );
      },
    ),

    vscode.commands.registerCommand("mocknest.clearRequestLog", () => {
      requestLogProvider.clear();
      void persistRequestLog(context, requestLogProvider);
      vscode.window.showInformationMessage("MockNest request log cleared.");
    }),

    vscode.commands.registerCommand(
      "mocknest.openRequestLogEntry",
      async (item: RequestLogItem) => {
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: JSON.stringify(item.entry, null, 2),
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.copyRequestLogAsCurl",
      async (item?: RequestLogItem) => {
        const entry = item?.entry ?? requestLogProvider.getLatestEntry();
        if (!entry) {
          vscode.window.showInformationMessage(
            "No request log entries available.",
          );
          return;
        }

        const port = vscode.workspace
          .getConfiguration("mocknest")
          .get<number>("port", 3001);
        const command = `curl -i -X ${entry.method} http://localhost:${port}${entry.path}`;

        await vscode.env.clipboard.writeText(command);
        vscode.window.showInformationMessage("Copied cURL command.");
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.restartServer",
      async (informationMessage: string = "Restarting MockNest server...") => {
        await restartServerCommand(mockServer, informationMessage);
      },
    ),
  );

  // Watch for changes in the OpenAPI spec file and restart the server.
  context.subscriptions.push(
    watchOpenApiFile(() => {
      void vscode.commands.executeCommand(
        "mocknest.restartServer",
        "OpenAPI spec changed. Restarting MockNest server...",
      );
    }),
  );
  
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("mocknest.delay") ||
        e.affectsConfiguration("mocknest.errorRate")
      ) {
        if (mockServer?.isRunning()) {
          void vscode.commands.executeCommand(
            "mocknest.restartServer",
            "MockNest configuration changed. Restarting server...",
          );
        }
      }
    }),
  );
}

export async function deactivate() {
  if (mockServer?.isRunning()) {
    await mockServer.stop();
  }
}

async function persistRequestLog(
  context: vscode.ExtensionContext,
  requestLogProvider: RequestLogProvider,
): Promise<void> {
  await context.workspaceState.update(
    REQUEST_LOG_STATE_KEY,
    requestLogProvider.getEntries(),
  );
}

async function selectSpecCommand(provider: RouteTreeProvider) {
  const files = await vscode.workspace.findFiles("**/openapi.{yaml,yml,json}");
  if (files.length === 0) {
    vscode.window.showErrorMessage("No OpenAPI spec file found in workspace.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    files.map((f) => f.fsPath),
    { placeHolder: "Select your OpenAPI spec file" },
  );
  if (picked) {
    const routes = await parseOpenApiFile(picked);
    provider.refresh(routes);
    ApiTesterPanel.syncRoutes(provider);
  }
}
