import * as vscode from "vscode";
import { MockServer } from "mocknest-core";

export async function exportRuntimeConfigCommand() {
  const config = vscode.workspace.getConfiguration("mocknest");
  const port = config.get<number>("port", 3001);

  try {
    // 1. Fetch recorded overrides
    const overridesResponse = await fetch(`http://localhost:${port}/__mocknest/overrides`);
    if (!overridesResponse.ok) {
      throw new Error("Could not fetch overrides from server.");
    }
    const overrides = await overridesResponse.json();

    // 2. Fetch current state if stateful
    let state = {};
    const stateful = config.get<boolean>("stateful", false);
    if (stateful) {
      const stateResponse = await fetch(`http://localhost:${port}/__mocknest/state`);
      if (stateResponse.ok) {
        state = await stateResponse.json();
      }
    }

    // 3. Construct bundle
    const bundle = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      config: {
        port,
        stateful,
        delay: config.get<number>("delay"),
        errorRate: config.get<number>("errorRate"),
        proxyTarget: config.get<string>("proxyTarget"),
      },
      overrides,
      state
    };

    // 4. Save to file
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceRoot 
      ? vscode.Uri.joinPath(workspaceRoot, "mocknest-runtime-export.json")
      : undefined;

    const fileUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "JSON": ["json"] },
      title: "Export MockNest Runtime Configuration"
    });

    if (fileUri) {
      const content = JSON.stringify(bundle, null, 2);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`Runtime configuration exported to ${fileUri.fsPath}`);
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to export runtime config: ${error}`);
  }
}
