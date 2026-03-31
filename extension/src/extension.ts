import * as vscode from "vscode";
import { RouteTreeProvider } from "./providers/routeTreeProvider";
import { startServerCommand } from "./commands/startServer";
import { stopServerCommand } from "./commands/stopServer";
import { MockServer } from "mocknest-core";
import { parseOpenApiFile } from "mocknest-core";

// Keep one server instance for the extension lifecycle.
let mockServer: MockServer | null = null;

export function activate(context: vscode.ExtensionContext) {
  const routeTreeProvider = new RouteTreeProvider();
  vscode.window.registerTreeDataProvider("mocknest.routeTree", routeTreeProvider);

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
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
    vscode.commands.registerCommand("mocknest.startServer", () =>
      startServerCommand(context, routeTreeProvider, (server, port) => {
        mockServer = server;
        updateStatusBar(true, port);
      })
    ),

    vscode.commands.registerCommand("mocknest.stopServer", async () => {
      await stopServerCommand(mockServer);
      mockServer = null;
      routeTreeProvider.clear();
      updateStatusBar(false);
    }),

    vscode.commands.registerCommand("mocknest.selectSpec", () =>
      selectSpecCommand(routeTreeProvider)
    )
  );
}

export async function deactivate() {
  if (mockServer?.isRunning()) {
    await mockServer.stop();
  }
}

async function selectSpecCommand(provider: RouteTreeProvider) {
  const files = await vscode.workspace.findFiles("**/openapi.{yaml,yml,json}");
  if (files.length === 0) {
    vscode.window.showErrorMessage("No OpenAPI spec file found in workspace.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    files.map((f) => f.fsPath),
    { placeHolder: "Select your OpenAPI spec file" }
  );
  if (picked) {
    const routes = await parseOpenApiFile(picked);
    provider.refresh(routes);
  }
}