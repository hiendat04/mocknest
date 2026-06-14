import * as vscode from "vscode";

export class StateItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly collectionName?: string,
    public readonly data?: any,
  ) {
    super(label, collapsibleState);
    
    if (contextValue === "collection") {
      this.iconPath = new vscode.ThemeIcon("database");
    } else {
      this.iconPath = new vscode.ThemeIcon("symbol-object");
      this.tooltip = JSON.stringify(data, null, 2);
    }
  }
}

export class StateExplorerProvider implements vscode.TreeDataProvider<StateItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | StateItem | StateItem[]>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private state: Record<string, any[]> = {};

  getTreeItem(element: StateItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StateItem): Promise<StateItem[]> {
    if (!element) {
      // Root: list collections
      return Object.keys(this.state).map(
        (collectionName) =>
          new StateItem(
            `${collectionName} (${this.state[collectionName].length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            "collection",
            collectionName,
            collectionName,
          ),
      );
    }

    if (element.contextValue === "collection") {
      const collectionName = element.data as string;
      const items = this.state[collectionName] || [];
      return items.map((item, index) => {
        const id = item.id || item._id || index;
        return new StateItem(
          `Item ${id}`,
          vscode.TreeItemCollapsibleState.None,
          "item",
          collectionName,
          item,
        );
      });
    }

    return [];
  }

  async refresh(): Promise<void> {
    const config = vscode.workspace.getConfiguration("mocknest");
    const port = config.get<number>("port", 3001);
    
    try {
      const response = await fetch(`http://localhost:${port}/__mocknest/state`);
      if (response.ok) {
        this.state = await response.json();
      } else {
        this.state = {};
      }
    } catch {
      this.state = {};
    }
    
    this.onDidChangeTreeDataEmitter.fire();
  }

  async clearCollection(collectionName: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("mocknest");
    const port = config.get<number>("port", 3001);
    
    try {
      const response = await fetch(`http://localhost:${port}/__mocknest/state/${collectionName}`, {
        method: "DELETE",
      });
      if (response.ok) {
        await this.refresh();
      }
    } catch {
      // Ignore
    }
  }

  async deleteItem(collectionName: string, id: any): Promise<void> {
    const config = vscode.workspace.getConfiguration("mocknest");
    const port = config.get<number>("port", 3001);
    
    try {
      const response = await fetch(`http://localhost:${port}/__mocknest/state/${collectionName}/${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        await this.refresh();
      }
    } catch {
      // Ignore
    }
  }

  clear(): void {
    this.state = {};
    this.onDidChangeTreeDataEmitter.fire();
  }
}
