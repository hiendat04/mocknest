import * as vscode from "vscode";
import {
  evaluateContractGate,
  parseOpenApiFile,
  renderContractGateMarkdown,
  type ContractGatePolicy,
  type ParsedRoute,
} from "mocknest-core";
import type { RouteTreeProvider } from "../providers/routeTreeProvider";

const SPEC_PATH_STATE_KEY = "mocknest.specPath";

export async function runApiQualityGateCommand(
  context: vscode.ExtensionContext,
  routeTreeProvider: RouteTreeProvider,
): Promise<void> {
  const currentRoutes = routeTreeProvider.getRoutes();
  if (currentRoutes.length === 0) {
    vscode.window.showInformationMessage(
      "No MockNest routes loaded. Select an OpenAPI spec or start the mock server first.",
    );
    return;
  }

  const comparison = await vscode.window.showQuickPick(
    [
      {
        label: "$(shield) Check current contract",
        description: "Run readiness policy without a baseline",
        compareBaseline: false,
      },
      {
        label: "$(git-compare) Check against baseline",
        description: "Also detect consumer-breaking contract changes",
        compareBaseline: true,
      },
    ],
    {
      title: "Run MockNest API Quality Gate",
      placeHolder: "Choose the gate scope",
    },
  );
  if (!comparison) {
    return;
  }

  const currentSpecPath = context.workspaceState.get<string>(
    SPEC_PATH_STATE_KEY,
  );
  let baselineSpecPath: string | undefined;
  let baselineRoutes: ParsedRoute[] | undefined;

  if (comparison.compareBaseline) {
    const baselineUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: currentSpecPath
        ? vscode.Uri.file(currentSpecPath)
        : vscode.workspace.workspaceFolders?.[0]?.uri,
      filters: {
        "OpenAPI specs": ["yaml", "yml", "json"],
      },
      openLabel: "Run Gate",
      title: "Select Baseline OpenAPI Spec",
    });
    const baselineUri = baselineUris?.[0];
    if (!baselineUri) {
      return;
    }

    baselineSpecPath = baselineUri.fsPath;
    try {
      baselineRoutes = (await parseOpenApiFile(baselineSpecPath)).routes;
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to parse baseline OpenAPI spec: ${formatError(error)}`,
      );
      return;
    }
  }

  let result;
  try {
    result = evaluateContractGate({
      currentRoutes,
      baselineRoutes,
      policy: readGatePolicy(),
      generatedAt: new Date(),
    });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Unable to run API Quality Gate: ${formatError(error)}`,
    );
    return;
  }

  const report = renderContractGateMarkdown({
    result,
    currentSpecPath,
    baselineSpecPath,
  });
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: report,
  });
  await vscode.window.showTextDocument(document, { preview: false });

  const decision = result.passed ? "passed" : "failed";
  const message =
    `MockNest API Quality Gate ${decision}: score ${result.quality.score}, ` +
    `${result.quality.blockingFindingCount} blocking finding(s), ` +
    `${result.breakingChanges.length} breaking change(s).`;
  if (result.passed) {
    vscode.window.showInformationMessage(message);
  } else {
    vscode.window.showWarningMessage(message);
  }
}

function readGatePolicy(): ContractGatePolicy {
  const configuration = vscode.workspace.getConfiguration("mocknest.gate");
  return {
    minimumScore: configuration.get<number>("minimumScore", 80),
    maxBlockingFindings: configuration.get<number>(
      "maxBlockingFindings",
      0,
    ),
    maxBreakingChanges: configuration.get<number>("maxBreakingChanges", 0),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
