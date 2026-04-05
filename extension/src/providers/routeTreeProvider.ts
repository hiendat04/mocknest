import * as vscode from "vscode";
import { ParsedRoute } from "mocknest-core";

export class RouteItem extends vscode.TreeItem {
  constructor(public readonly route: ParsedRoute) {
    super(`${route.method} ${route.path}`, vscode.TreeItemCollapsibleState.None);

    // Keep method color mapping predictable in the sidebar.
    const color = methodColor(route.method);
    this.description = route.summary || "";
    this.tooltip = `${route.method} ${route.path} → ${route.statusCode}`;
    this.contextValue = "routeItem";
    this.command = {
      command: "mocknest.openApiTester",
      title: "Open in API Tester",
      arguments: [this],
    };

    this.iconPath = new vscode.ThemeIcon("circle-filled",
      new vscode.ThemeColor(color)
    );
  }
}

export class RouteTreeProvider implements vscode.TreeDataProvider<RouteItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private routes: ParsedRoute[] = [];

  getTreeItem(element: RouteItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RouteItem[] {
    return this.routes.map((r) => new RouteItem(r));
  }

  refresh(routes: ParsedRoute[]) {
    this.routes = routes;
    this._onDidChangeTreeData.fire();
  }

  clear() {
    this.routes = [];
    this._onDidChangeTreeData.fire();
  }

  getRoutes(): ParsedRoute[] {
    return [...this.routes];
  }
}

function methodColor(method: string): string {
  switch (method) {
    case "GET":    return "charts.blue";
    case "POST":   return "charts.green";
    case "PUT":    return "charts.yellow";
    case "DELETE": return "charts.red";
    default:       return "charts.purple";
  }
}