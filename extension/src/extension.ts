import * as vscode from "vscode";
import { RouteTreeProvider } from "./providers/routeTreeProvider";
import { startServerCommand } from "./commands/startServer";
import { stopServerCommand } from "./commands/stopServer";
import { MockServer } from "mocknest-core";
import { parseOpenApiFile } from "mocknest-core";

// Keep one server instance for the extension lifecycle.
let mockServer: MockServer | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log("MockNest is now active!");

  const routeTreeProvider = new RouteTreeProvider();
  vscode.window.registerTreeDataProvider("mocknest.routeTree", routeTreeProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand("mocknest.startServer", () =>
      startServerCommand(context, routeTreeProvider, (server) => {
        mockServer = server;
      })
    ),

    vscode.commands.registerCommand("mocknest.stopServer", async () => {
      await stopServerCommand(mockServer);
      mockServer = null;
      routeTreeProvider.clear();
    }),

    vscode.commands.registerCommand("mocknest.selectSpec", () =>
      selectSpecCommand(routeTreeProvider)
    )
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = "$(circle-slash) MockNest: OFF";
  statusBar.command = "mocknest.startServer";
  statusBar.show();
  context.subscriptions.push(statusBar);
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