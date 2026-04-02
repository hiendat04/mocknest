import * as vscode from "vscode";
import { MockServer } from "mocknest-core";
import { RouteTreeProvider } from "../providers/routeTreeProvider";

export default async function restartServerCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
  mockServer: MockServer | null,
  informationMessage: string = "Restarting MockNest server...",
): Promise<void> {
  if (!mockServer || !mockServer.isRunning()) {
    vscode.window.showInformationMessage(
      "MockNest server is not running. Starting a new server...",
    );
    await vscode.commands.executeCommand("mocknest.startServer", false);
    return;
  }

  vscode.window.showInformationMessage(informationMessage);
  await vscode.commands.executeCommand("mocknest.stopServer", true);
  await vscode.commands.executeCommand("mocknest.startServer", true);
}
