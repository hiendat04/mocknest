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
      specPath = args[++i];
    } else if (arg === "--port" || arg === "-p") {
      options.port = parseInt(args[++i], 10);
    } else if (arg === "--stateful") {
      options.stateful = true;
    } else if (arg === "--state-path") {
      options.statePath = args[++i];
    } else if (arg === "--proxy-record") {
      options.proxyRecord = true;
    } else if (arg === "--chaos-latency") {
      options.delay = parseInt(args[++i], 10);
    } else if (arg === "--chaos-error-rate") {
      options.errorRate = parseFloat(args[++i]);
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
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
