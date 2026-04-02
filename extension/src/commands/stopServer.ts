import * as vscode from "vscode";
import { MockServer } from "mocknest-core";

export async function stopServerCommand(
  server: MockServer | null,
  isRestart: boolean = false,
): Promise<void> {
  if (!server || !server.isRunning()) {
    vscode.window.showInformationMessage("MockNest server is not running.");
    return;
  }

  try {
    await server.stop();
    if (!isRestart) {
      vscode.window.showInformationMessage("MockNest server stopped.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to stop mock server: ${message}`);
  }
}
