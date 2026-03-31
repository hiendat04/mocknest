import * as vscode from "vscode";

export function watchOpenApiFile(onChange: (uri: vscode.Uri) => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher("**/openapi.{yaml,yml,json}");

  const onDidChange = watcher.onDidChange((uri) => onChange(uri));
  const onDidCreate = watcher.onDidCreate((uri) => onChange(uri));
  const onDidDelete = watcher.onDidDelete((uri) => onChange(uri));

  return vscode.Disposable.from(watcher, onDidChange, onDidCreate, onDidDelete);
}
