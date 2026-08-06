#!/usr/bin/env node
import {
  MockServer,
  evaluateContractGate,
  parseOpenApiFile,
  renderContractGateMarkdown,
  type ContractGatePolicy,
  type ContractGateResult,
} from "mocknest-core";
import * as fs from "fs";
import * as path from "path";

interface ServeOptions {
  port: number;
  stateful: boolean;
  strict: boolean;
  delay: number;
  errorRate: number;
  proxyRecord: boolean;
  statePath?: string;
}

type GateFormat = "text" | "json" | "markdown";

interface GateOptions {
  specPath: string;
  baselinePath?: string;
  outputPath?: string;
  format: GateFormat;
  policy: ContractGatePolicy;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "gate") {
    await runGate(args.slice(1));
    return;
  }

  await runServer(args);
}

async function runGate(args: string[]): Promise<void> {
  const options = parseGateOptions(args);
  const absoluteSpecPath = resolveExistingFile(options.specPath, "--spec");
  const absoluteBaselinePath = options.baselinePath
    ? resolveExistingFile(options.baselinePath, "--baseline")
    : undefined;

  try {
    const current = await parseOpenApiFile(absoluteSpecPath);
    const baseline = absoluteBaselinePath
      ? await parseOpenApiFile(absoluteBaselinePath)
      : undefined;
    const result = evaluateContractGate({
      currentRoutes: current.routes,
      baselineRoutes: baseline?.routes,
      policy: options.policy,
    });
    const report = formatGateResult(result, options.format, {
      currentSpecPath: absoluteSpecPath,
      baselineSpecPath: absoluteBaselinePath,
    });

    if (options.outputPath) {
      const absoluteOutputPath = path.resolve(options.outputPath);
      fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
      fs.writeFileSync(absoluteOutputPath, report, "utf8");
      console.log(`[MockNest Gate] Report written to ${absoluteOutputPath}`);
      console.log(renderGateDecision(result));
    } else {
      process.stdout.write(report);
    }

    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(`[MockNest Gate] ${formatError(error)}`);
    process.exitCode = 2;
  }
}

async function runServer(args: string[]): Promise<void> {
  const options: ServeOptions = {
    port: 3001,
    stateful: false,
    strict: false,
    delay: 20,
    errorRate: 0,
    proxyRecord: false,
  };
  let specPath = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--spec" || arg === "-s") {
      specPath = readOptionValue(args, ++index, arg);
    } else if (arg === "--port" || arg === "-p") {
      options.port = parseIntegerOption(
        readOptionValue(args, ++index, arg),
        arg,
        { min: 1, max: 65535 },
      );
    } else if (arg === "--stateful") {
      options.stateful = true;
    } else if (arg === "--state-path") {
      options.statePath = readOptionValue(args, ++index, arg);
    } else if (arg === "--proxy-record") {
      options.proxyRecord = true;
    } else if (arg === "--chaos-latency") {
      options.delay = parseIntegerOption(
        readOptionValue(args, ++index, arg),
        arg,
        { min: 0 },
      );
    } else if (arg === "--chaos-error-rate") {
      options.errorRate = parseNumberOption(
        readOptionValue(args, ++index, arg),
        arg,
        { min: 0, max: 1 },
      );
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    } else {
      failWithHelp(`Unknown option '${arg}'.`);
    }
  }

  if (!specPath) {
    failWithHelp("--spec <path> is required.");
  }

  const absoluteSpecPath = resolveExistingFile(specPath, "--spec");
  console.log(`\n[MockNest CLI] Parsing spec: ${absoluteSpecPath}...`);

  try {
    const { routes, api } = await parseOpenApiFile(absoluteSpecPath);
    const server = new MockServer({
      port: options.port,
      routes,
      api,
      delay: options.delay,
      errorRate: options.errorRate,
      stateful: options.stateful,
      statePath: options.statePath,
      proxyRecord: options.proxyRecord,
      strictValidation: options.strict,
      logging: {
        enabled: true,
        logHeaders: false,
        logBody: true,
        logResponseBody: true,
      },
    });

    console.log(`[MockNest CLI] Starting server on port ${options.port}...`);
    if (options.stateful) {
      console.log("[MockNest CLI] Stateful mode: ENABLED");
    }
    if (options.delay > 20) {
      console.log(`[MockNest CLI] Chaos Latency: ${options.delay}ms`);
    }
    if (options.errorRate > 0) {
      console.log(
        `[MockNest CLI] Chaos Error Rate: ${Math.round(options.errorRate * 100)}%`,
      );
    }

    await server.start();
    registerShutdownHandlers(server);
  } catch (error) {
    console.error("[MockNest CLI] Failed to start server:", error);
    process.exitCode = 1;
  }
}

function parseGateOptions(args: string[]): GateOptions {
  const options: GateOptions = {
    specPath: "",
    format: "text",
    policy: {
      minimumScore: 80,
      maxBlockingFindings: 0,
      maxBreakingChanges: 0,
    },
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--spec" || arg === "-s") {
      options.specPath = readOptionValue(args, ++index, arg);
    } else if (arg === "--baseline" || arg === "-b") {
      options.baselinePath = readOptionValue(args, ++index, arg);
    } else if (arg === "--min-score") {
      options.policy.minimumScore = parseIntegerOption(
        readOptionValue(args, ++index, arg),
        arg,
        { min: 0, max: 100 },
      );
    } else if (arg === "--max-blocking") {
      options.policy.maxBlockingFindings = parseIntegerOption(
        readOptionValue(args, ++index, arg),
        arg,
        { min: 0 },
      );
    } else if (arg === "--max-breaking") {
      options.policy.maxBreakingChanges = parseIntegerOption(
        readOptionValue(args, ++index, arg),
        arg,
        { min: 0 },
      );
    } else if (arg === "--format") {
      const format = readOptionValue(args, ++index, arg);
      if (!isGateFormat(format)) {
        failWithGateHelp("--format must be text, json, or markdown.");
      }
      options.format = format;
    } else if (arg === "--output" || arg === "-o") {
      options.outputPath = readOptionValue(args, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      printGateHelp();
      process.exit(0);
    } else {
      failWithGateHelp(`Unknown gate option '${arg}'.`);
    }
  }

  if (!options.specPath) {
    failWithGateHelp("--spec <path> is required.");
  }
  return options;
}

function formatGateResult(
  result: ContractGateResult,
  format: GateFormat,
  paths: {
    currentSpecPath: string;
    baselineSpecPath?: string;
  },
): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "markdown") {
    return renderContractGateMarkdown({
      result,
      currentSpecPath: paths.currentSpecPath,
      baselineSpecPath: paths.baselineSpecPath,
    });
  }

  const lines = [
    "MockNest API Quality Gate",
    renderGateDecision(result),
    `Quality score: ${result.quality.score}/100 (minimum ${result.policy.minimumScore})`,
    `Blocking findings: ${result.quality.blockingFindingCount} (maximum ${result.policy.maxBlockingFindings})`,
    `Breaking changes: ${result.breakingChanges.length} (maximum ${result.policy.maxBreakingChanges})`,
    `Routes analyzed: ${result.quality.routeCount}`,
  ];

  if (result.violations.length > 0) {
    lines.push(
      "",
      "Policy violations:",
      ...result.violations.map((violation) => `- ${violation.message}`),
    );
  }
  if (result.breakingChanges.length > 0) {
    lines.push(
      "",
      "Breaking changes:",
      ...result.breakingChanges.map(
        (change) => `- ${change.route}: ${change.message}`,
      ),
    );
  }

  const blockingFindings = result.quality.findings.filter(
    (finding) => finding.severity === "blocking",
  );
  if (blockingFindings.length > 0) {
    lines.push(
      "",
      "Blocking quality findings:",
      ...blockingFindings.map(
        (finding) => `- ${finding.route}: ${finding.message}`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderGateDecision(result: ContractGateResult): string {
  return `Decision: ${result.passed ? "PASS" : "FAIL"}`;
}

function registerShutdownHandlers(server: MockServer): void {
  const stop = async (signal: string) => {
    console.log(`\n[MockNest CLI] Received ${signal}. Stopping server...`);
    await server.stop();
  };

  process.once("SIGINT", () => {
    void stop("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM").finally(() => process.exit(0));
  });
}

function resolveExistingFile(filePath: string, optionName: string): string {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: ${optionName} file not found at ${absolutePath}`);
    process.exit(2);
  }
  if (!fs.statSync(absolutePath).isFile()) {
    console.error(`Error: ${optionName} must point to a file: ${absolutePath}`);
    process.exit(2);
  }
  return absolutePath;
}

function readOptionValue(
  args: string[],
  index: number,
  optionName: string,
): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    console.error(`Error: ${optionName} requires a value.`);
    process.exit(2);
  }
  return value;
}

function parseIntegerOption(
  value: string,
  optionName: string,
  range: { min?: number; max?: number } = {},
): number {
  if (!/^\d+$/.test(value)) {
    console.error(`Error: ${optionName} must be an integer.`);
    process.exit(2);
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    (range.min !== undefined && parsed < range.min) ||
    (range.max !== undefined && parsed > range.max)
  ) {
    console.error(
      `Error: ${optionName} must be ${formatRange("an integer", range)}.`,
    );
    process.exit(2);
  }
  return parsed;
}

function parseNumberOption(
  value: string,
  optionName: string,
  range: { min?: number; max?: number } = {},
): number {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (range.min !== undefined && parsed < range.min) ||
    (range.max !== undefined && parsed > range.max)
  ) {
    console.error(
      `Error: ${optionName} must be ${formatRange("a number", range)}.`,
    );
    process.exit(2);
  }
  return parsed;
}

function formatRange(
  label: string,
  range: { min?: number; max?: number },
): string {
  if (range.min !== undefined && range.max !== undefined) {
    return `${label} between ${range.min} and ${range.max}`;
  }
  if (range.min !== undefined) {
    return `${label} greater than or equal to ${range.min}`;
  }
  if (range.max !== undefined) {
    return `${label} less than or equal to ${range.max}`;
  }
  return label;
}

function isGateFormat(value: string): value is GateFormat {
  return value === "text" || value === "json" || value === "markdown";
}

function failWithHelp(message: string): never {
  console.error(`Error: ${message}`);
  printHelp();
  process.exit(2);
}

function failWithGateHelp(message: string): never {
  console.error(`Error: ${message}`);
  printGateHelp();
  process.exit(2);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printHelp(): void {
  console.log(`
MockNest CLI - Run local OpenAPI mocks and enforce API contract quality.

Usage:
  mocknest --spec <path> [server options]
  mocknest gate --spec <path> [gate options]

Server options:
  --spec, -s <path>        Path to OpenAPI spec file (required)
  --port, -p <number>      Port for the mock server (default: 3001)
  --stateful               Enable persistent CRUD state
  --state-path <path>      File used to persist state
  --proxy-record           Record successful proxied responses
  --chaos-latency <ms>     Global response latency (default: 20)
  --chaos-error-rate <0-1> Probability of simulated failures (default: 0)
  --strict                 Enable strict request validation
  --help, -h               Show this help message

Run "mocknest gate --help" for API quality gate options.
`);
}

function printGateHelp(): void {
  console.log(`
MockNest API Quality Gate - Score contract readiness and block breaking changes.

Usage:
  mocknest gate --spec <path> [options]

Options:
  --spec, -s <path>        Current OpenAPI spec (required)
  --baseline, -b <path>    Baseline OpenAPI spec for breaking-change detection
  --min-score <0-100>      Minimum contract quality score (default: 80)
  --max-blocking <count>   Allowed blocking quality findings (default: 0)
  --max-breaking <count>   Allowed breaking changes (default: 0)
  --format <format>        text, json, or markdown (default: text)
  --output, -o <path>      Write the report to a file
  --help, -h               Show this help message

Exit codes:
  0  Gate passed
  1  Gate policy failed
  2  Invalid input or analysis error
`);
}

void main();
