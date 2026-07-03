import * as vscode from "vscode";
import { RouteItem, RouteTreeProvider, ScenarioItem } from "./providers/routeTreeProvider";
import { startServerCommand } from "./commands/startServer";
import { stopServerCommand } from "./commands/stopServer";
import { exportRuntimeConfigCommand } from "./commands/exportRuntimeConfig";
import { importRuntimeConfigCommand } from "./commands/importRuntimeConfig";
import { analyzeContractDriftCommand } from "./commands/analyzeContractDrift";
import { generateContractCoverageReportCommand } from "./commands/generateContractCoverageReport";
import { generateContractTestSuiteCommand } from "./commands/generateContractTestSuite";
import {
  exportRequestLogScenariosCommand,
  recordRequestAsScenarioCommand,
} from "./commands/scenarioRecorder";
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
import { StateExplorerProvider, StateItem } from "./providers/stateExplorerProvider";
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
const SPEC_PATH_STATE_KEY = "mocknest.specPath";

export function activate(context: vscode.ExtensionContext) {
  const routeTreeProvider = new RouteTreeProvider();
  const requestLogProvider = new RequestLogProvider();
  const chaosControlProvider = new ChaosControlProvider();
  const stateExplorerProvider = new StateExplorerProvider();
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
  vscode.window.registerTreeDataProvider(
    "mocknest.stateExplorer",
    stateExplorerProvider,
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

  // Attempt auto-discovery if no spec is selected.
  void (async () => {
    const selectedSpec = context.workspaceState.get<string>(SPEC_PATH_STATE_KEY);
    if (!selectedSpec) {
      const files = await vscode.workspace.findFiles(
        "**/{openapi,swagger,api-spec}.{yaml,yml,json}",
        "**/node_modules/**",
      );

      if (files.length === 1) {
        const discovered = files[0].fsPath;
        try {
          const { routes } = await parseOpenApiFile(discovered);
          await context.workspaceState.update(SPEC_PATH_STATE_KEY, discovered);
          routeTreeProvider.refresh(routes);
          ApiTesterPanel.syncRoutes(routeTreeProvider);
          const relativePath = vscode.workspace.asRelativePath(discovered);
          vscode.window.showInformationMessage(
            `MockNest: Auto-selected OpenAPI spec found at ${relativePath}`,
          );
        } catch {
          // Silent failure for auto-discovery
        }
      }
    } else {
      // If we have a persisted spec, load it into the tree provider.
      try {
        const { routes } = await parseOpenApiFile(selectedSpec);
        routeTreeProvider.refresh(routes);
        ApiTesterPanel.syncRoutes(routeTreeProvider);
      } catch {
        // Persisted spec might be invalid or moved.
      }
    }
  })();

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
            void stateExplorerProvider.refresh();
            if (requestInfo) {
              requestLogProvider.append(
                requestInfo.method,
                requestInfo.path,
                requestInfo.statusCode,
                requestInfo.requestBody,
                requestInfo.responseBody,
                requestInfo.requestHeaders,
              );
              void stateExplorerProvider.refresh();
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
        stateExplorerProvider.clear();
        updateStatusBar(false);
      },
    ),

    vscode.commands.registerCommand("mocknest.selectSpec", async () => {
      const didSelectSpec = await selectSpecCommand(context, routeTreeProvider);
      if (didSelectSpec && mockServer?.isRunning()) {
        void vscode.commands.executeCommand(
          "mocknest.restartServer",
          "OpenAPI spec changed. Restarting MockNest server...",
        );
      }
    }),

    vscode.commands.registerCommand("mocknest.clearSelectedSpec", async () => {
      const current = context.workspaceState.get<string>(SPEC_PATH_STATE_KEY);
      if (!current) {
        vscode.window.showInformationMessage("No selected OpenAPI spec to clear.");
        return;
      }

      await context.workspaceState.update(SPEC_PATH_STATE_KEY, undefined);

      if (mockServer?.isRunning()) {
        await vscode.commands.executeCommand("mocknest.stopServer");
      } else {
        routeTreeProvider.clear();
        ApiTesterPanel.syncRoutes(routeTreeProvider);
      }

      vscode.window.showInformationMessage(
        "Cleared selected OpenAPI spec. Select a spec again before next start.",
      );
    }),

    vscode.commands.registerCommand("mocknest.openSelectedSpec", async () => {
      const selectedSpec = context.workspaceState.get<string>(SPEC_PATH_STATE_KEY);
      if (!selectedSpec) {
        vscode.window.showInformationMessage(
          "No selected OpenAPI spec found. Use Select OpenAPI Spec File first.",
        );
        return;
      }

      const specUri = vscode.Uri.file(selectedSpec);
      try {
        await vscode.workspace.fs.stat(specUri);
      } catch {
        vscode.window.showErrorMessage(
          "Selected OpenAPI spec file no longer exists. Clear and reselect your spec.",
        );
        return;
      }

      const doc = await vscode.workspace.openTextDocument(specUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    vscode.commands.registerCommand(
      "mocknest.openApiTester",
      (item?: any) => {
        const isRoute = item instanceof RouteItem;
        const isScenario = item instanceof ScenarioItem;
        
        ApiTesterPanel.open(
          context,
          routeTreeProvider,
          isRoute
            ? {
                method: item.route.method,
                path: item.route.path,
              }
            : isScenario
            ? {
                method: item.route.method,
                path: item.route.path,
                scenario: item.scenario,
              }
            : undefined,
        );
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.openInBrowser",
      async (item: any) => {
        if (!(item instanceof RouteItem)) {
          return;
        }
        const port = vscode.workspace
          .getConfiguration("mocknest")
          .get<number>("port", 3001);
        const url = `http://localhost:${port}${item.route.path}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
    ),

    vscode.commands.registerCommand("mocknest.clearRequestLog", () => {
      requestLogProvider.clear();
      void persistRequestLog(context, requestLogProvider);
      vscode.window.showInformationMessage("MockNest request log cleared.");
    }),

    vscode.commands.registerCommand(
      "mocknest.generateContractCoverageReport",
      async () => {
        await generateContractCoverageReportCommand(
          context,
          routeTreeProvider,
          requestLogProvider.getEntries(),
        );
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.analyzeContractDrift",
      async () => {
        await analyzeContractDriftCommand(
          context,
          routeTreeProvider,
          requestLogProvider.getEntries(),
        );
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.generateContractTestSuite",
      async () => {
        await generateContractTestSuiteCommand(routeTreeProvider);
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.recordRequestAsScenario",
      async (item?: RequestLogItem) => {
        await recordRequestAsScenarioCommand(
          item,
          routeTreeProvider,
          requestLogProvider.getLatestEntry(),
        );
      },
    ),

    vscode.commands.registerCommand(
      "mocknest.exportRequestLogScenarios",
      async () => {
        await exportRequestLogScenariosCommand(
          requestLogProvider.getEntries(),
          routeTreeProvider,
        );
      },
    ),

    vscode.commands.registerCommand("mocknest.copyBaseUrl", async () => {
      const port = vscode.workspace
        .getConfiguration("mocknest")
        .get<number>("port", 3001);
      const baseUrl = `http://localhost:${port}`;
      await vscode.env.clipboard.writeText(baseUrl);
      vscode.window.showInformationMessage(`Copied base URL: ${baseUrl}`);
    }),

    vscode.commands.registerCommand("mocknest.toggleChaosMode", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const delay = config.get<number>("delay", DEFAULT_DELAY_MS);
      const errorRate = config.get<number>("errorRate", DEFAULT_ERROR_RATE);
      const delayJitter = config.get<number>("delayJitter", 0);
      const isChaosEnabled =
        delay > DEFAULT_DELAY_MS || errorRate > DEFAULT_ERROR_RATE || delayJitter > 0;

      if (isChaosEnabled) {
        await config.update("delay", DEFAULT_DELAY_MS, vscode.ConfigurationTarget.Workspace);
        await config.update("errorRate", DEFAULT_ERROR_RATE, vscode.ConfigurationTarget.Workspace);
        await config.update("delayJitter", 0, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage("Chaos mode disabled.");
      } else {
        await config.update("delay", CHAOS_DELAY_MS, vscode.ConfigurationTarget.Workspace);
        await config.update("errorRate", CHAOS_ERROR_RATE, vscode.ConfigurationTarget.Workspace);
        await config.update("delayJitter", 0.5, vscode.ConfigurationTarget.Workspace);
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

    vscode.commands.registerCommand("mocknest.setChaosJitter", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<number>("delayJitter", 0);

      const input = await vscode.window.showInputBox({
        title: "Set Delay Jitter",
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
        "delayJitter",
        parsed,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
    }),

    vscode.commands.registerCommand("mocknest.setErrorStatusCodes", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<number[]>("errorStatusCodes", [500]);

      const input = await vscode.window.showInputBox({
        title: "Set Error Status Codes",
        prompt: "Comma-separated list of HTTP status codes (e.g. 500, 503, 429)",
        value: current.join(", "),
        validateInput: (value) => {
          const parts = value.split(",").map((p) => p.trim());
          if (parts.some((p) => isNaN(Number(p)) || !Number.isInteger(Number(p)) || Number(p) < 100 || Number(p) > 599)) {
            return "Enter a comma-separated list of valid HTTP status codes (100-599)";
          }
          return undefined;
        },
      });

      if (input === undefined) {
        return;
      }

      const parsed = input.split(",").map((p) => Number(p.trim())).filter((p) => p > 0);
      await config.update(
        "errorStatusCodes",
        parsed.length > 0 ? parsed : [500],
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
    }),

    vscode.commands.registerCommand("mocknest.resetChaosSettings", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      await config.update("delay", DEFAULT_DELAY_MS, vscode.ConfigurationTarget.Workspace);
      await config.update("errorRate", DEFAULT_ERROR_RATE, vscode.ConfigurationTarget.Workspace);
      await config.update("delayJitter", 0, vscode.ConfigurationTarget.Workspace);
      await config.update("errorStatusCodes", [500], vscode.ConfigurationTarget.Workspace);
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage("Chaos settings reset to defaults.");
    }),

    vscode.commands.registerCommand("mocknest.setProxyTarget", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<string>("proxyTarget", "");

      const input = await vscode.window.showInputBox({
        title: "Set Proxy Fallback Target",
        prompt: "Enter base URL to forward unhandled requests (e.g. http://api.staging.com) or leave empty to disable.",
        value: current,
        placeHolder: "http://localhost:8080",
      });

      if (input === undefined) {
        return;
      }

      await config.update(
        "proxyTarget",
        input.trim(),
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
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

    vscode.commands.registerCommand("mocknest.toggleStatefulMode", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<boolean>("stateful", false);
      const next = !current;
      await config.update(
        "stateful",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage(
        `Stateful mode ${next ? "enabled" : "disabled"}.`,
      );
    }),

    vscode.commands.registerCommand("mocknest.toggleProxyRecord", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const current = config.get<boolean>("proxyRecord", false);
      const next = !current;
      await config.update(
        "proxyRecord",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      chaosControlProvider.refresh();
      vscode.window.showInformationMessage(
        `Proxy recording ${next ? "enabled" : "disabled"}.`,
      );
    }),

    vscode.commands.registerCommand("mocknest.clearRecordedMocks", async () => {
      const config = vscode.workspace.getConfiguration("mocknest");
      const port = config.get<number>("port", 3001);
      
      try {
        const response = await fetch(`http://localhost:${port}/__mocknest/overrides`, {
          method: "DELETE",
        });
        if (response.ok) {
          vscode.window.showInformationMessage("All recorded mocks cleared.");
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to clear recorded mocks: ${error}`);
      }
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

        let command = `curl -i -X ${entry.method} http://localhost:${port}${entry.path}`;

        // Add headers (excluding some internal ones if necessary)
        if (entry.requestHeaders) {
          for (const [key, value] of Object.entries(entry.requestHeaders)) {
            // Skip common internal headers to keep curl clean
            if (
              ["host", "connection", "content-length", "accept-encoding"].includes(
                key.toLowerCase(),
              )
            ) {
              continue;
            }
            command += ` -H "${key}: ${value}"`;
          }
        }

        // Add body
        if (
          entry.requestBody &&
          ["POST", "PUT", "PATCH"].includes(entry.method.toUpperCase())
        ) {
          const bodyStr = JSON.stringify(entry.requestBody).replace(/"/g, '\\"');
          command += ` -d "${bodyStr}"`;
        }

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

    vscode.commands.registerCommand("mocknest.exportRuntimeConfig", async () => {
      await exportRuntimeConfigCommand();
    }),

    vscode.commands.registerCommand("mocknest.importRuntimeConfig", async () => {
      await importRuntimeConfigCommand(() => {
        stateExplorerProvider.refresh();
        chaosControlProvider.refresh();
      });
    }),

    vscode.commands.registerCommand("mocknest.refreshState", async () => {
      await stateExplorerProvider.refresh();
      vscode.window.showInformationMessage("MockNest state explorer refreshed.");
    }),

    vscode.commands.registerCommand("mocknest.openStateExplorer", () => {
      void vscode.commands.executeCommand("mocknest.stateExplorer.focus");
    }),

    vscode.commands.registerCommand("mocknest.clearStateCollection", async (item: StateItem) => {
      if (!item.collectionName) return;
      const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to clear the collection '${item.collectionName}'?`,
        { modal: true },
        "Clear All Items"
      );
      if (answer === "Clear All Items") {
        await stateExplorerProvider.clearCollection(item.collectionName);
        vscode.window.showInformationMessage(`Collection '${item.collectionName}' cleared.`);
      }
    }),

    vscode.commands.registerCommand("mocknest.deleteStateItem", async (item: StateItem) => {
      if (!item.collectionName || !item.data) return;
      const id = item.data.id || item.data._id;
      if (id === undefined) {
        vscode.window.showErrorMessage("Cannot delete item without an ID field.");
        return;
      }
      await stateExplorerProvider.deleteItem(item.collectionName, id);
      vscode.window.showInformationMessage(`Item '${id}' deleted.`);
    }),
  );

  // Watch for changes in the OpenAPI spec file and restart the server.
  context.subscriptions.push(
    watchOpenApiFile(async (uri) => {
      const selectedSpec = context.workspaceState.get<string>(SPEC_PATH_STATE_KEY);
      if (!selectedSpec) {
        return;
      }

      if (!isSameFilePath(uri.fsPath, selectedSpec)) {
        return;
      }

      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        await context.workspaceState.update(SPEC_PATH_STATE_KEY, undefined);
        routeTreeProvider.clear();
        ApiTesterPanel.syncRoutes(routeTreeProvider);
        await vscode.commands.executeCommand("mocknest.stopServer");
        vscode.window.showWarningMessage(
          "Selected OpenAPI spec was deleted. MockNest server stopped and selection cleared.",
        );
        return;
      }

      if (!mockServer?.isRunning()) {
        return;
      }

      void vscode.commands.executeCommand(
        "mocknest.restartServer",
        "Selected OpenAPI spec changed. Restarting MockNest server...",
      );
    }),
  );
  
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("mocknest.delay") ||
        e.affectsConfiguration("mocknest.delayJitter") ||
        e.affectsConfiguration("mocknest.errorRate") ||
        e.affectsConfiguration("mocknest.errorStatusCodes") ||
        e.affectsConfiguration("mocknest.strictValidation") ||
        e.affectsConfiguration("mocknest.stateful") ||
        e.affectsConfiguration("mocknest.proxyTarget")
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

async function selectSpecCommand(
  context: vscode.ExtensionContext,
  provider: RouteTreeProvider,
): Promise<boolean> {
  const files = await vscode.workspace.findFiles(
    "**/{openapi,swagger,api-spec}.{yaml,yml,json}",
    "**/node_modules/**",
  );
  if (files.length === 0) {
    vscode.window.showErrorMessage("No OpenAPI spec file found in workspace.");
    return false;
  }
  const picked = await vscode.window.showQuickPick(
    files.map((f) => f.fsPath),
    { placeHolder: "Select your OpenAPI spec file" },
  );
  if (!picked) {
    return false;
  }

  try {
    const { routes } = await parseOpenApiFile(picked);
    await context.workspaceState.update(SPEC_PATH_STATE_KEY, picked);
    provider.refresh(routes);
    ApiTesterPanel.syncRoutes(provider);
    const relativePath = vscode.workspace.asRelativePath(picked);
    vscode.window.showInformationMessage(
      `OpenAPI spec selected: ${relativePath}`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to parse OpenAPI spec: ${message}`);
    return false;
  }
}

function isSameFilePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  return normalize(left) === normalize(right);
}
