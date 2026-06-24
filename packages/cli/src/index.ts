#!/usr/bin/env node
import { MockServer, parseOpenApiFile } from "mocknest-core";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  const options: any = {
    port: 3001,
    stateful: false,
    strict: false,
    delay: 20,
    errorRate: 0,
    proxyRecord: false,
  };

  let specPath = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--spec" || arg === "-s") {
      specPath = readOptionValue(args, ++i, arg);
    } else if (arg === "--port" || arg === "-p") {
      options.port = parseIntegerOption(readOptionValue(args, ++i, arg), arg, {
        min: 1,
        max: 65535,
      });
    } else if (arg === "--stateful") {
      options.stateful = true;
    } else if (arg === "--state-path") {
      options.statePath = readOptionValue(args, ++i, arg);
    } else if (arg === "--proxy-record") {
      options.proxyRecord = true;
    } else if (arg === "--chaos-latency") {
      options.delay = parseIntegerOption(readOptionValue(args, ++i, arg), arg, {
        min: 0,
      });
    } else if (arg === "--chaos-error-rate") {
      options.errorRate = parseNumberOption(readOptionValue(args, ++i, arg), arg, {
        min: 0,
        max: 1,
      });
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    } else {
      console.error(`Error: Unknown option '${arg}'.`);
      printHelp();
      process.exit(1);
    }
  }

  if (!specPath) {
    console.error("Error: --spec <path> is required.");
    printHelp();
    process.exit(1);
  }

  const absoluteSpecPath = path.resolve(specPath);
  if (!fs.existsSync(absoluteSpecPath)) {
    console.error(`Error: Spec file not found at ${absoluteSpecPath}`);
    process.exit(1);
  }

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
      }
    });

    console.log(`[MockNest CLI] Starting server on port ${options.port}...`);
    if (options.stateful) console.log(`[MockNest CLI] Stateful mode: ENABLED`);
    if (options.delay > 20) console.log(`[MockNest CLI] Chaos Latency: ${options.delay}ms`);
    if (options.errorRate > 0) console.log(`[MockNest CLI] Chaos Error Rate: ${Math.round(options.errorRate * 100)}%`);

    await server.start();
    
    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\n[MockNest CLI] Stopping server...");
      await server.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n[MockNest CLI] Stopping server...");
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error("[MockNest CLI] Failed to start server:", error);
    process.exit(1);
  }
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    console.error(`Error: ${optionName} requires a value.`);
    printHelp();
    process.exit(1);
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
    process.exit(1);
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
    process.exit(1);
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
    process.exit(1);
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

function printHelp() {
  console.log(`
MockNest CLI - Instantly spin up a local mock API server from your OpenAPI spec.

Usage:
  mocknest --spec <path> [options]

Options:
  --spec, -s <path>        Path to OpenAPI spec file (required)
  --port, -p <number>      Port to run the server on (default: 3001)
  --stateful               Enable stateful mocking (persistent CRUD)
  --state-path <path>      Path to persist state data (default: .mocknest/state.json)
  --proxy-record           Automatically record successful proxied responses
  --chaos-latency <ms>     Global latency for all responses (default: 20)
  --chaos-error-rate <0-1> Probability of simulated failures (default: 0)
  --strict                 Enable strict request validation
  --help, -h               Show this help message
  `);
}

main();
