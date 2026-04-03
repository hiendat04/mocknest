import * as vscode from "vscode";

export interface RequestLogEntry {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  timestamp: string;
}

export class RequestLogItem extends vscode.TreeItem {
  constructor(public readonly entry: RequestLogEntry) {
    super(`${entry.method} ${entry.path}`, vscode.TreeItemCollapsibleState.None);

    const color = methodColor(entry.method);
    this.description = `${entry.statusCode} • ${formatTime(entry.timestamp)}`;
    this.tooltip = `${entry.method} ${entry.path} → ${entry.statusCode}\n${entry.timestamp}`;
    this.contextValue = "requestLogItem";
    this.iconPath = new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor(color),
    );
    this.command = {
      command: "mocknest.openRequestLogEntry",
      title: "Open Request Log Entry",
      arguments: [this],
    };
  }
}

export class RequestLogProvider
  implements vscode.TreeDataProvider<RequestLogItem>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private entries: RequestLogEntry[] = [];
  private nextId = 1;

  getTreeItem(element: RequestLogItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RequestLogItem[] {
    return this.entries.map((entry) => new RequestLogItem(entry));
  }

  append(method: string, path: string, statusCode: number): void {
    const entry: RequestLogEntry = {
      id: String(this.nextId++),
      method,
      path,
      statusCode,
      timestamp: new Date().toISOString(),
    };

    this.entries.unshift(entry);

    const maxEntries = vscode.workspace
      .getConfiguration("mocknest")
      .get<number>("maxLogEntries", 200);
    this.entries = this.entries.slice(0, maxEntries);
    this.onDidChangeTreeDataEmitter.fire();
  }

  clear(): void {
    this.entries = [];
    this.onDidChangeTreeDataEmitter.fire();
  }

  getLatestEntry(): RequestLogEntry | undefined {
    return this.entries[0];
  }
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "charts.blue";
    case "POST":
      return "charts.green";
    case "PUT":
      return "charts.yellow";
    case "DELETE":
      return "charts.red";
    default:
      return "charts.purple";
  }
}
