import * as vscode from "vscode";

export async function importRuntimeConfigCommand(refreshAll: () => void) {
  const config = vscode.workspace.getConfiguration("mocknest");
  const port = config.get<number>("port", 3001);

  try {
    // 1. Select file
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: workspaceRoot,
      filters: { "JSON": ["json"] },
      title: "Select MockNest Runtime Configuration to Import"
    });

    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const fileUri = fileUris[0];
    const contentBuffer = await vscode.workspace.fs.readFile(fileUri);
    const content = JSON.parse(Buffer.from(contentBuffer).toString("utf-8"));

    if (content.version !== "1.0") {
      const proceed = await vscode.window.showWarningMessage(
        `Export version '${content.version}' may be incompatible. Proceed?`,
        "Yes", "No"
      );
      if (proceed !== "Yes") return;
    }

    // 2. Upload Overrides
    if (content.overrides && Array.isArray(content.overrides)) {
      const response = await fetch(`http://localhost:${port}/__mocknest/overrides/bulk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content.overrides)
      });
      if (!response.ok) {
        throw new Error("Failed to upload overrides to mock server.");
      }
    }

    // 3. Upload State
    if (content.state && typeof content.state === "object") {
      const response = await fetch(`http://localhost:${port}/__mocknest/state/bulk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content.state)
      });
      if (!response.ok) {
        throw new Error("Failed to upload state to mock server.");
      }
    }

    // 4. Refresh UI
    refreshAll();
    vscode.window.showInformationMessage(`Successfully imported configuration from ${fileUri.fsPath}`);

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to import configuration: ${error}`);
  }
}
