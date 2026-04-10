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
import {
  CHAOS_DELAY_MS,
  CHAOS_ERROR_RATE,
  ChaosControlProvider,
  DEFAULT_DELAY_MS,
  DEFAULT_ERROR_RATE,
  parseFailureRateInput,
} from "./providers/chaosControlProvider";

// Keep one server instance for the extension lifecycle.
let mockServer: MockServer | null = null;
const REQUEST_LOG_STATE_KEY = "mocknest.requestLogEntries";

export function activate(context: vscode.ExtensionContext) {
  const routeTreeProvider = new RouteTreeProvider();
  const requestLogProvider = new RequestLogProvider();
  const chaosControlProvider = new ChaosControlProvider();
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
  vscode.window.registerTreeDataProvider(
    "mocknest.chaosControls",
    chaosControlProvider,
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

    vscode.commands.registerCommand("mocknest.copyBaseUrl", async () => {
      const port = vscode.workspace
        .getConfiguration("mocknest")
        .get<number>("port", 3001);
      const baseUrl = `http://localhost:${port}`;
      await vscode.env.clipboard.writeText(baseUrl);
      vscode.window.showInformationMessage(`Copied base URL: ${baseUrl}`);
    }),

    vscode.commands.registerCommand("mocknest.exportRuntimeConfig", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const runtimeConfig = {
        port: config.get<number>("port", 3001),
        autoStart: config.get<boolean>("autoStart", false),
        delay: config.get<number>("delay", DEFAULT_DELAY_MS),
        errorRate: config.get<number>("errorRate", DEFAULT_ERROR_RATE),
        strictValidation: config.get<boolean>("strictValidation", false),
        specPath: context.workspaceState.get<string>("mocknest.specPath"),
        serverRunning: mockServer?.isRunning() ?? false,
      };

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, "mocknest-runtime-config.json")
        : undefined;

      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: "Export Runtime Config",
        filters: {
          "JSON Files": ["json"],
        },
      });

      if (!saveUri) {
        return;
      }

      await vscode.workspace.fs.writeFile(
        saveUri,
        Buffer.from(JSON.stringify(runtimeConfig, null, 2), "utf8"),
      );

      vscode.window.showInformationMessage(
        `Exported runtime config to ${saveUri.fsPath}`,
      );
    }),

    vscode.commands.registerCommand("mocknest.toggleChaosMode", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const delay = config.get<number>("delay", DEFAULT_DELAY_MS);
      const errorRate = config.get<number>("errorRate", DEFAULT_ERROR_RATE);
      const isChaosEnabled =
        delay > DEFAULT_DELAY_MS || errorRate > DEFAULT_ERROR_RATE;

      if (isChaosEnabled) {
        await config.update("delay", DEFAULT_DELAY_MS, vscode.ConfigurationTarget.Workspace);
        await config.update("errorRate", DEFAULT_ERROR_RATE, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage("Chaos mode disabled.");
      } else {
        await config.update("delay", CHAOS_DELAY_MS, vscode.ConfigurationTarget.Workspace);
        await config.update("errorRate", CHAOS_ERROR_RATE, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage("Chaos mode enabled.");
      }

      chaosControlProvider.refresh();
    }),

    vscode.commands.registerCommand("mocknest.setChaosLatency", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<number>("delay", DEFAULT_DELAY_MS);

      const input = await vscode.window.showInputBox({
        title: "Set Global Latency",
        prompt: "Latency in milliseconds",
        value: String(current),
        validateInput: (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
            return "Enter a whole number >= 0";
          }
          return undefined;
        },
      });

      if (!input) {
        return;
      }

      await config.update(
        "delay",
        Number(input),
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
    }),

    vscode.commands.registerCommand("mocknest.setChaosErrorRate", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<number>("errorRate", DEFAULT_ERROR_RATE);

      const input = await vscode.window.showInputBox({
        title: "Set Failure Rate",
        prompt: "Enter decimal (0-1) or percentage (0-100)",
        value: String(current),
        validateInput: (value) => {
          const parsed = parseFailureRateInput(value);
          if (parsed === undefined) {
            return "Enter value in range 0-1 or 0-100%";
          }
          return undefined;
        },
      });

      if (!input) {
        return;
      }

      const parsed = parseFailureRateInput(input);
      if (parsed === undefined) {
        return;
      }

      await config.update(
        "errorRate",
        parsed,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
    }),

    vscode.commands.registerCommand("mocknest.resetChaosSettings", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      await config.update("delay", DEFAULT_DELAY_MS, vscode.ConfigurationTarget.Workspace);
      await config.update("errorRate", DEFAULT_ERROR_RATE, vscode.ConfigurationTarget.Workspace);
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage("Chaos settings reset to defaults.");
    }),

    vscode.commands.registerCommand("mocknest.toggleStrictValidation", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<boolean>("strictValidation", false);
      const next = !current;
      await config.update(
        "strictValidation",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage(
        `Contract validation ${next ? "enabled" : "disabled"}.`,
      );
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
        e.affectsConfiguration("mocknest.errorRate") ||
        e.affectsConfiguration("mocknest.strictValidation")
      ) {
        chaosControlProvider.refresh();
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
