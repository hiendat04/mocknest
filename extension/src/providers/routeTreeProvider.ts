import * as vscode from "vscode";
import { ParsedRoute, ResponseOverrideRule } from "mocknest-core";

export class ScenarioItem extends vscode.TreeItem {
  constructor(public readonly route: ParsedRoute, public readonly scenario: ResponseOverrideRule) {
    const label = scenario.name || `Scenario (${scenario.response.statusCode})`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = scenario.response.statusCode ? `Status: ${scenario.response.statusCode}` : "";
    this.tooltip = `Matches: ${JSON.stringify(scenario.match || "Any")}`;
    this.contextValue = "scenarioItem";
    this.iconPath = new vscode.ThemeIcon("beaker");
    this.command = {
      command: "mocknest.openApiTester",
      title: "Open in API Tester",
      arguments: [this],
    };
  }
}

export class RouteItem extends vscode.TreeItem {
  constructor(public readonly route: ParsedRoute) {
    const hasScenarios = route.responseOverrides && route.responseOverrides.length > 0;
    super(
      `${route.method} ${route.path}`,
      hasScenarios ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );

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

type TreeElement = TagItem | RouteItem | ScenarioItem;

export class RouteTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private routes: ParsedRoute[] = [];

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] | Thenable<TreeElement[]> {
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

    if (element instanceof RouteItem) {
      return (element.route.responseOverrides || []).map(
        (scenario) => new ScenarioItem(element.route, scenario)
      );
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