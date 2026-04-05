import * as vscode from "vscode";

export const DEFAULT_DELAY_MS = 20;
export const DEFAULT_ERROR_RATE = 0;
export const CHAOS_DELAY_MS = 2000;
export const CHAOS_ERROR_RATE = 0.1;

class ChaosControlItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    commandId: string,
    contextValue: string,
    tooltip: string,
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = contextValue;
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = {
      command: commandId,
      title: label,
    };
  }
}

export class ChaosControlProvider
  implements vscode.TreeDataProvider<ChaosControlItem>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  getTreeItem(element: ChaosControlItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ChaosControlItem[] {
    const config = vscode.workspace.getConfiguration("mocknest");
    const delay = config.get<number>("delay", DEFAULT_DELAY_MS);
    const errorRate = config.get<number>("errorRate", DEFAULT_ERROR_RATE);
    const isChaosMode = delay > DEFAULT_DELAY_MS || errorRate > DEFAULT_ERROR_RATE;

    return [
      new ChaosControlItem(
        "Chaos Mode",
        isChaosMode ? "ON" : "OFF",
        "mocknest.toggleChaosMode",
        "mocknest.chaosToggle",
        "Toggle chaos defaults for latency and failure rate",
        isChaosMode ? "flame" : "shield",
      ),
      new ChaosControlItem(
        "Latency",
        `${delay} ms`,
        "mocknest.setChaosLatency",
        "mocknest.chaosLatency",
        "Set global latency for all mock responses",
        "clock",
      ),
      new ChaosControlItem(
        "Failure Rate",
        `${Math.round(errorRate * 100)}%`,
        "mocknest.setChaosErrorRate",
        "mocknest.chaosErrorRate",
        "Set percentage of simulated 500 responses",
        "pulse",
      ),
      new ChaosControlItem(
        "Reset Chaos",
        "Restore defaults",
        "mocknest.resetChaosSettings",
        "mocknest.chaosReset",
        "Reset latency and failure rate",
        "discard",
      ),
    ];
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }
}

export function parseFailureRateInput(input: string): number | undefined {
  const normalized = input.trim().replace("%", "");
  if (!normalized) {
    return undefined;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }

  if (value <= 1) {
    return value;
  }

  if (value <= 100) {
    return value / 100;
  }

  return undefined;
}
