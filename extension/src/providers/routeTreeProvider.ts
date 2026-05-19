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

export class TagItem extends vscode.TreeItem {
  constructor(public readonly tagName: string, public readonly routes: ParsedRoute[]) {
    super(tagName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "tagItem";
    this.iconPath = new vscode.ThemeIcon("tag");
    this.tooltip = `${routes.length} endpoint(s)`;
  }
}

type TreeElement = TagItem | RouteItem;

export class RouteTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private routes: ParsedRoute[] = [];

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      // Root level: Group routes by tags
      const tagMap = new Map<string, ParsedRoute[]>();
      const untagged: ParsedRoute[] = [];

      for (const route of this.routes) {
        if (route.tags && route.tags.length > 0) {
          for (const tag of route.tags) {
            if (!tagMap.has(tag)) {
              tagMap.set(tag, []);
            }
            tagMap.get(tag)!.push(route);
          }
        } else {
          untagged.push(route);
        }
      }

      const items: TreeElement[] = [];
      
      // Sort tags alphabetically
      const sortedTags = Array.from(tagMap.keys()).sort();
      for (const tag of sortedTags) {
        items.push(new TagItem(tag, tagMap.get(tag)!));
      }

      if (untagged.length > 0) {
        if (items.length > 0) {
           items.push(new TagItem("default", untagged));
        } else {
           // If everything is untagged and no tags exist, just show the list at root?
           // Actually, it's cleaner to just show them as routes if there are NO tags at all.
           return untagged.map(r => new RouteItem(r));
        }
      }

      return items;
    }

    if (element instanceof TagItem) {
      return element.routes.map((r) => new RouteItem(r));
    }

    return [];
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