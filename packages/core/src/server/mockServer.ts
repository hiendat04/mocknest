import express, { Express, Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { OpenAPIV3 } from "openapi-types";
import { Faker, en, faker } from "@faker-js/faker";
import {
  ParsedRoute,
  ParsedResponse,
  ResponseOverrideRule,
  ResponseOverrideMatch,
} from "../parser/openApiParser";
import { generateFakeData } from "../generator/fakeDataGenerator";
import { DataStore } from "./dataStore";

export interface DeterministicOptions {
  seed?: string;
  includeHeaders?: boolean;
}

export interface MockServerLogOptions {
  enabled?: boolean;
  logHeaders?: boolean;
  logBody?: boolean;
  logResponseBody?: boolean;
  redactHeaders?: string[];
  redactFields?: string[];
}

export interface RequestHistoryOptions {
  enabled?: boolean;
  limit?: number;
  includeHeaders?: boolean;
  includeBody?: boolean;
  includeResponseBody?: boolean;
  redactHeaders?: string[];
  redactFields?: string[];
}

export interface RequestLogEntry {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  body?: unknown;
  responseBody?: unknown;
}

const DEFAULT_REDACT_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
];

const DEFAULT_REDACT_FIELDS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
];

export interface MockServerOptions {
  port: number;
  routes: ParsedRoute[];
  api?: OpenAPIV3.Document;
  proxyTarget?: string;
  onRequest?: (
    method: string,
    path: string,
    statusCode: number,
    requestBody?: any,
    responseBody?: any,
    requestHeaders?: Record<string, any>,
  ) => void;
  delay?: number;
  delayJitter?: number;
  errorRate?: number;
  errorStatusCodes?: number[];
  strictValidation?: boolean;
  stateful?: boolean;
  statePath?: string;
  deterministic?: boolean | DeterministicOptions;
  proxyRecord?: boolean;
  logging?: MockServerLogOptions;
  requestHistory?: boolean | RequestHistoryOptions;
  responseOverrides?: ResponseOverrideRule[];
}

export class MockServer {
  private app: Express;
  private server: Server | null = null;
  private dataStore: DataStore;
  private requestHistory: RequestLogEntry[] = [];
  private requestIdCounter = 0;
  private requestHistoryOptions: Required<RequestHistoryOptions>;
  private overrideHitCounts: Map<string, number> = new Map();
  private dynamicOverrides: ResponseOverrideRule[] = [];

  constructor(private options: MockServerOptions) {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.dataStore = new DataStore(this.options.statePath);
    this.requestHistoryOptions = normalizeRequestHistoryOptions(
      this.options.requestHistory,
    );
    this.registerInternalRoutes();
    this.registerRoutes();
  }

  private registerInternalRoutes() {
    if (this.options.api) {
      this.app.get("/__mocknest/spec.json", (req, res) => {
        res.json(this.options.api);
      });

      this.app.get("/__mocknest/docs", (req, res) => {
        res.send(this.getSwaggerUiHtml());
      });

      console.log(`[MockNest] API Explorer available at http://localhost:${this.options.port}/__mocknest/docs`);
    }

    if (this.requestHistoryOptions.enabled) {
      this.app.get("/__mocknest/requests", (req, res) => {
        res.json(this.requestHistory);
      });

      this.app.delete("/__mocknest/requests", (req, res) => {
        this.requestHistory = [];
        res.json({ ok: true });
      });
    }

    this.app.get("/__mocknest/state", (req, res) => {
      res.json(this.dataStore.getAll());
    });

    this.app.put("/__mocknest/state/bulk", (req, res) => {
      const state = req.body;
      if (typeof state !== "object" || state === null) {
        res.status(400).json({ error: "Invalid state format" });
        return;
      }
      this.dataStore.setAll(state);
      res.json({ ok: true });
    });

    this.app.delete("/__mocknest/state/:collection", (req, res) => {
      this.dataStore.clearCollection(req.params.collection);
      res.json({ ok: true });
    });

    this.app.delete("/__mocknest/state/:collection/:id", (req, res) => {
      const { collection, id } = req.params;
      this.dataStore.deleteItem(collection, "id", id);
      res.json({ ok: true });
    });

    this.app.get("/__mocknest/overrides", (req, res) => {
      res.json(this.dynamicOverrides);
    });

    this.app.post("/__mocknest/overrides", (req, res) => {
      const override = req.body as ResponseOverrideRule;
      if (!override || !override.response) {
        res.status(400).json({ error: "Invalid override format" });
        return;
      }
      this.dynamicOverrides.unshift(override);
      res.json({ ok: true, count: this.dynamicOverrides.length });
    });

    this.app.delete("/__mocknest/overrides", (req, res) => {
      this.dynamicOverrides = [];
      res.json({ ok: true });
    });

    this.app.put("/__mocknest/overrides/bulk", (req, res) => {
      const overrides = req.body;
      if (!Array.isArray(overrides)) {
        res.status(400).json({ error: "Invalid overrides format (must be an array)" });
        return;
      }
      this.dynamicOverrides = overrides;
      res.json({ ok: true, count: this.dynamicOverrides.length });
    });
  }

  private getSwaggerUiHtml(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MockNest API Explorer</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" >
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin:0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"> </script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"> </script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "/__mocknest/spec.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;
  }

  private registerRoutes() {
    for (const route of this.options.routes) {
      const method = route.method.toLowerCase() as keyof Express;

      // Dispatch handlers from the HTTP verb string in the parsed route.
      (this.app as any)[method](route.path, async (req: Request, res: Response) => {
        const loggingOptions = normalizeLoggingOptions(this.options.logging);
        const historyOptions = this.requestHistoryOptions;

        const headerDelay = req.header("x-mock-delay");
        const baseDelay = headerDelay
          ? parseInt(headerDelay, 10)
          : (route.mockDelay ?? this.options.delay ?? 20);

        const headerStatusCode =
          req.header("x-mock-response-code") ||
          req.header("x-mock-status-code");
        const baseStatusCode = headerStatusCode
          ? parseInt(headerStatusCode, 10)
          : (route.mockStatusCode ?? route.statusCode);

        const override = this.selectResponseOverride(req, route);
        const statusCode = override?.response.statusCode ?? baseStatusCode;

        const deterministicOptions = normalizeDeterministicOptions(
          this.options.deterministic,
        );
        const deterministicSeed = deterministicOptions
          ? computeDeterministicSeed(
              req,
              route,
              statusCode,
              deterministicOptions,
            )
          : undefined;
        const deterministicRandom = deterministicSeed !== undefined
          ? createSeededRandom(deterministicSeed)
          : undefined;
        const deterministicFaker = deterministicSeed !== undefined
          ? createSeededFaker(deterministicSeed)
          : undefined;
        const fakeDataOptions = deterministicRandom && deterministicFaker
          ? { random: deterministicRandom, faker: deterministicFaker }
          : undefined;

        const baseDelayValue = override?.response.delay ?? baseDelay;
        
        let delay = baseDelayValue;
        if (this.options.delayJitter && this.options.delayJitter > 0) {
          const jitterRandom = (deterministicRandom ?? Math.random)();
          const jitterAmount = Math.floor(jitterRandom * baseDelayValue * this.options.delayJitter);
          delay = baseDelayValue + jitterAmount;
        }

        const bestResponse = findBestResponse(route, statusCode);

        const requestLog = buildRequestLog(req, route.method, loggingOptions);
        if (requestLog) {
          console.log(
            `[MockNest] Request ${route.method} ${req.path}`,
            requestLog,
          );
        }

        const responseSchema =
          bestResponse?.schema ||
          (statusCode === route.statusCode ? route.responseSchema : undefined);
        const responseHeaders =
          bestResponse?.headers ||
          (statusCode === route.statusCode ? route.responseHeaders : undefined);

        const exampleKey = req.header("x-mock-example");
        let exampleValue: any = undefined;
        if (exampleKey) {
          const examples =
            bestResponse?.examples ||
            (statusCode === route.statusCode
              ? route.responseExamples
              : undefined);
          if (examples && examples[exampleKey] !== undefined) {
            exampleValue = examples[exampleKey];
          }
        }

        let fakeBody: any = undefined;
        const pathInfo = this.options.stateful ? parsePathInfo(route.path) : undefined;

        if (this.options.stateful && pathInfo && exampleValue === undefined) {
          const collection = pathInfo.collection;
          const idParam = (pathInfo as any).paramName;

          if (pathInfo.type === "collection") {
            if (route.method === "GET") {
              const data = this.dataStore.getCollection(collection);
              if (data.length === 0 && responseSchema) {
                // Initial seed
                const seed = generateFakeData(
                  responseSchema,
                  { ...req.query },
                  fakeDataOptions,
                );
                const seedArray = Array.isArray(seed) ? seed : [seed];
                this.dataStore.setCollection(collection, seedArray);
                fakeBody = seedArray;
              } else {
                fakeBody = data;
              }
            } else if (route.method === "POST") {
              const newItem = req.body && Object.keys(req.body).length > 0
                ? req.body
                : responseSchema
                  ? generateFakeData(responseSchema, undefined, fakeDataOptions)
                  : {};
              
              // Ensure it has an ID if it's an object
              if (isPlainObject(newItem) && !newItem.id && !newItem._id) {
                const idRandom = deterministicRandom ?? Math.random;
                newItem.id = idRandom().toString(36).substring(7);
              }
              this.dataStore.addItem(collection, newItem);
              fakeBody = newItem;
            }
          } else if (pathInfo.type === "item" && idParam) {
            const idValue = req.params[idParam];
            const idField = "id"; // Defaulting to 'id'

            if (route.method === "GET") {
              fakeBody = this.dataStore.findItem(collection, idField, idValue);
              if (!fakeBody && responseSchema) {
                fakeBody = generateFakeData(
                  responseSchema,
                  { ...req.query, ...req.params },
                  fakeDataOptions,
                );
                if (isPlainObject(fakeBody)) {
                  fakeBody[idField] = idValue;
                  this.dataStore.addItem(collection, fakeBody);
                }
              }
            } else if (route.method === "PUT" || route.method === "PATCH") {
              const updates = req.body || {};
              const success = this.dataStore.updateItem(collection, idField, idValue, updates);
              if (success) {
                fakeBody = this.dataStore.findItem(collection, idField, idValue);
              } else if (responseSchema) {
                // Create if not exists for PUT/PATCH (upsert-ish)
                fakeBody = {
                  ...generateFakeData(
                    responseSchema,
                    undefined,
                    fakeDataOptions,
                  ),
                  ...updates,
                  [idField]: idValue,
                };
                this.dataStore.addItem(collection, fakeBody);
              }
            } else if (route.method === "DELETE") {
              this.dataStore.deleteItem(collection, idField, idValue);
              fakeBody = { message: "Deleted successfully" };
            }
          }
        }

        const sendJson = (
          sCode: number,
          payload: unknown,
          sHeaders?: Record<string, string>,
        ): void => {
          this.options.onRequest?.(
            route.method,
            req.path,
            sCode,
            req.body,
            payload,
            req.headers,
          );
          this.recordRequest(
            buildRequestHistoryEntry(
              req,
              route.method,
              sCode,
              payload,
              historyOptions,
              this.requestIdCounter + 1,
            ),
          );
          setTimeout(() => {
            if (sHeaders) {
              for (const [name, value] of Object.entries(sHeaders)) {
                res.setHeader(name, value);
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.status(sCode).send(JSON.stringify(payload, null, 2));
          }, delay);
        };

        if (this.options.strictValidation) {
          const errors = validateRouteRequest(route, req);
          if (errors.length > 0) {
            console.warn(
              `[MockNest] Request validation failed for ${route.method} ${req.path}:`,
              errors,
            );
            sendJson(400, {
              error: "Request validation failed",
              details: errors,
            });
            return;
          }
        }

        if (override?.response.body !== undefined) {
          fakeBody = override.response.body;
        }

        if (fakeBody === undefined) {
          fakeBody =
            exampleValue !== undefined
              ? exampleValue
              : responseSchema
                ? generateFakeData(
                    responseSchema,
                    { ...req.query, ...req.params },
                    fakeDataOptions,
                  )
                : {};
        }

        // Apply response templating
        const templateContext = {
          req: {
            body: req.body,
            query: req.query,
            params: req.params,
            headers: req.headers,
          },
          faker: deterministicFaker ?? faker,
        };

        fakeBody = processResponseTemplates(fakeBody, templateContext);

        const templatedHeaders = processResponseTemplates(
          mergeHeaders(responseHeaders, override?.response.headers),
          templateContext
        );

        if (this.options.strictValidation && responseSchema && !isReferenceObject(responseSchema)) {
          const responseErrors = validateSchemaValue(fakeBody, responseSchema, "response");
          if (responseErrors.length > 0) {
            console.error(
              `[MockNest] Generated response failed validation for ${route.method} ${req.path}:`,
              responseErrors,
            );
            // We still send the response, but we could optionally add a header or log it specially.
            // For now, let's just log it to console.
          }
        }

        // Chaos mode (error rate)
        if (this.options.errorRate && this.options.errorRate > 0) {
          const random = (deterministicRandom ?? Math.random)();
          if (random < this.options.errorRate) {
            const errorCodes = this.options.errorStatusCodes && this.options.errorStatusCodes.length > 0
              ? this.options.errorStatusCodes
              : [500];
            const errorRandom = (deterministicRandom ?? Math.random)();
            const errorCode = errorCodes[Math.floor(errorRandom * errorCodes.length)];
            
            console.error(
              `[MockNest] Simulated ${errorCode} Error for ${route.method} ${req.path}`,
            );
            sendJson(errorCode, { error: `Internal Server Error (Simulated: ${errorCode})` });
            return;
          }
        }

        if (loggingOptions.enabled) {
          if (loggingOptions.logResponseBody) {
            const responseLog = buildResponseLog(fakeBody, loggingOptions);
            console.log(
              `[MockNest] Response ${route.method} ${req.path} -> ${statusCode}`,
              responseLog,
            );
          } else {
            console.log(`[MockNest] ${route.method} ${req.path} -> ${statusCode}`);
          }
        }

        // Artificial delay to simulate real network.
        sendJson(statusCode, fakeBody, templatedHeaders);
      });
    }

    this.app.use(async (req: Request, res: Response) => {
      const historyOptions = this.requestHistoryOptions;

      if (this.options.proxyTarget) {
        const targetUrl = `${this.options.proxyTarget.replace(/\/+$/, "")}${req.url}`;
        console.log(`[MockNest] Proxying to ${targetUrl}`);

        const startedAt = Date.now();
        try {
          const proxyRes = await fetch(targetUrl, {
            method: req.method,
            headers: req.headers as any,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
          });

          const durationMs = Date.now() - startedAt;
          const data = await proxyRes.text();
          
          let responseBody: any;
          try {
            responseBody = JSON.parse(data);
          } catch {
            responseBody = data;
          }

          this.options.onRequest?.(
            req.method,
            req.path,
            proxyRes.status,
            req.body,
            responseBody,
            req.headers,
          );

          this.recordRequest(
            buildRequestHistoryEntry(
              req,
              req.method,
              proxyRes.status,
              responseBody,
              historyOptions,
              this.requestIdCounter + 1,
            ),
          );

          // Copy headers back
          proxyRes.headers.forEach((value, key) => {
            if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
              res.setHeader(key, value);
            }
          });

          if (this.options.proxyRecord && proxyRes.status >= 200 && proxyRes.status < 300) {
            console.log(`[MockNest] Recording proxied response for ${req.method} ${req.path}`);
            this.dynamicOverrides.unshift({
              name: `Recorded: ${req.method} ${req.path}`,
              method: req.method,
              path: req.path,
              match: {
                query: Object.keys(req.query).length > 0 ? { ...req.query } as any : undefined,
                headers: { ...req.headers } as any, // Might want to be more selective here later
              },
              response: {
                statusCode: proxyRes.status,
                body: responseBody,
              }
            });
          }

          res.status(proxyRes.status).send(data);
          return;
        } catch (error) {
          console.error(`[MockNest] Proxy error:`, error);
          res.status(502).json({ error: "Proxy error", details: String(error) });
          return;
        }
      }

      console.warn(`[MockNest] 404 Not Found: ${req.method} ${req.path}`);
      res.status(404).json({ error: "Route not mocked", path: req.path });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.options.port, () => {
        console.log(
          `MockNest running on http://localhost:${this.options.port}`,
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  private recordRequest(entry: RequestLogEntry | undefined): void {
    if (!entry || !this.requestHistoryOptions.enabled) return;
    this.requestHistory.push(entry);
    this.requestIdCounter = entry.id;
    const limit = this.requestHistoryOptions.limit;
    if (limit > 0 && this.requestHistory.length > limit) {
      this.requestHistory.splice(0, this.requestHistory.length - limit);
    }
  }

  private selectResponseOverride(
    req: Request,
    route: ParsedRoute,
  ): ResponseOverrideRule | undefined {
    const overrides = collectOverrides(route, this.options.responseOverrides, this.dynamicOverrides);
    if (overrides.length === 0) return undefined;

    for (let index = 0; index < overrides.length; index += 1) {
      const override = overrides[index];
      if (!matchesOverrideContext(route, override)) continue;
      if (!matchesOverride(req, override.match)) continue;

      const overrideKey = getOverrideKey(override, index, route);
      const hitCount = this.overrideHitCounts.get(overrideKey) ?? 0;
      if (override.once && hitCount > 0) {
        continue;
      }

      this.overrideHitCounts.set(overrideKey, hitCount + 1);
      return override;
    }

    return undefined;
  }
}

function collectOverrides(
  route: ParsedRoute,
  globalOverrides?: ResponseOverrideRule[],
  dynamicOverrides?: ResponseOverrideRule[],
): ResponseOverrideRule[] {
  const routeOverrides = route.responseOverrides ?? [];
  const combined = [] as ResponseOverrideRule[];
  if (dynamicOverrides && dynamicOverrides.length > 0) combined.push(...dynamicOverrides);
  if (routeOverrides.length > 0) combined.push(...routeOverrides);
  if (globalOverrides) combined.push(...globalOverrides);
  return combined;
}

function matchesOverrideContext(
  route: ParsedRoute,
  override: ResponseOverrideRule,
): boolean {
  if (override.method && override.method.toUpperCase() !== route.method) {
    return false;
  }
  if (override.path && override.path !== route.path) {
    return false;
  }
  return true;
}

function matchesOverride(
  req: Request,
  match: ResponseOverrideMatch | undefined,
): boolean {
  if (!match) return true;

  if (match.headers && !matchesHeaderConditions(req.headers, match.headers)) {
    return false;
  }

  if (match.query && !matchesRecordConditions(req.query, match.query)) {
    return false;
  }

  if (match.params && !matchesRecordConditions(req.params, match.params)) {
    return false;
  }

  if (match.body && !matchesBodyConditions(req.body, match.body)) {
    return false;
  }

  return true;
}

function matchesHeaderConditions(
  headers: Request["headers"],
  expected: Record<string, string | number | boolean | string[]>,
): boolean {
  const normalized = normalizeHeaders(headers);
  return Object.entries(expected).every(([key, value]) => {
    const actual = normalized[key.toLowerCase()];
    if (!actual) return false;
    return matchesStringArray(actual, value);
  });
}

function matchesRecordConditions(
  actualRecord: Record<string, any>,
  expectedRecord: Record<string, string | number | boolean | string[]>,
): boolean {
  return Object.entries(expectedRecord).every(([key, value]) => {
    const actualValue = actualRecord[key];
    if (actualValue === undefined) return false;
    return matchesStringArray(actualValue, value);
  });
}

function matchesBodyConditions(actual: unknown, expected: unknown): boolean {
  return deepPartialMatch(expected, actual);
}

function matchesStringArray(
  actual: string | string[] | number | boolean,
  expected: string | string[] | number | boolean,
): boolean {
  const actualValues = Array.isArray(actual) ? actual.map(String) : [String(actual)];
  const expectedValues = Array.isArray(expected) ? expected.map(String) : [String(expected)];
  return expectedValues.every((value) => actualValues.includes(value));
}

function deepPartialMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return false;
    }
    return expected.every((value, index) => deepPartialMatch(value, actual[index]));
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      deepPartialMatch(value, (actual as Record<string, unknown>)[key]),
    );
  }

  return expected === actual;
}

function getOverrideKey(
  override: ResponseOverrideRule,
  index: number,
  route: ParsedRoute,
): string {
  if (override.id) return override.id;
  const method = override.method ?? route.method;
  const path = override.path ?? route.path;
  return `${method}:${path}:${index}`;
}

function processResponseTemplates(data: any, context: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return data.replace(/\{\{(.+?)\}\}/g, (_, path) => {
      const trimmedPath = path.trim();
      const parts = trimmedPath.split(".");
      let value: any = context;
      for (const part of parts) {
        if (value === null || value === undefined) {
          break;
        }
        // Handle array indexing like body.items[0]
        const arrayMatch = part.match(/(.+)\[(\d+)\]/);
        if (arrayMatch) {
           const [_, key, index] = arrayMatch;
           value = value[key]?.[parseInt(index, 10)];
        } else {
           value = value[part];
        }
      }

      if (typeof value === "function" && trimmedPath.startsWith("faker")) {
        return value();
      }

      return value !== undefined ? String(value) : `{{${trimmedPath}}}`;
    });
  }

  if (Array.isArray(data)) {
    return data.map((item) => processResponseTemplates(item, context));
  }

  if (typeof data === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = processResponseTemplates(value, context);
    }
    return result;
  }

  return data;
}

function mergeHeaders(
  baseHeaders?: Record<string, string>,
  overrideHeaders?: Record<string, string>,
): Record<string, string> | undefined {
  if (!baseHeaders && !overrideHeaders) return undefined;
  return { ...(baseHeaders ?? {}), ...(overrideHeaders ?? {}) };
}

function normalizeDeterministicOptions(
  value: MockServerOptions["deterministic"],
): DeterministicOptions | undefined {
  if (!value) return undefined;
  if (value === true) {
    return { includeHeaders: true };
  }
  return {
    seed: value.seed,
    includeHeaders: value.includeHeaders ?? true,
  };
}

function normalizeLoggingOptions(
  value: MockServerOptions["logging"],
): Required<MockServerLogOptions> {
  return {
    enabled: value?.enabled ?? true,
    logHeaders: value?.logHeaders ?? false,
    logBody: value?.logBody ?? true,
    logResponseBody: value?.logResponseBody ?? false,
    redactHeaders: (value?.redactHeaders ?? DEFAULT_REDACT_HEADERS).map((h) =>
      h.toLowerCase(),
    ),
    redactFields: (value?.redactFields ?? DEFAULT_REDACT_FIELDS).map((f) =>
      f.toLowerCase(),
    ),
  };
}

function normalizeRequestHistoryOptions(
  value: MockServerOptions["requestHistory"],
): Required<RequestHistoryOptions> {
  if (value === true) {
    return {
      enabled: true,
      limit: 100,
      includeHeaders: false,
      includeBody: true,
      includeResponseBody: false,
      redactHeaders: DEFAULT_REDACT_HEADERS.map((h: string) => h.toLowerCase()),
      redactFields: DEFAULT_REDACT_FIELDS.map((f: string) => f.toLowerCase()),
    };
  }

  if (!value) {
    return {
      enabled: false,
      limit: 100,
      includeHeaders: false,
      includeBody: true,
      includeResponseBody: false,
      redactHeaders: DEFAULT_REDACT_HEADERS.map((h: string) => h.toLowerCase()),
      redactFields: DEFAULT_REDACT_FIELDS.map((f: string) => f.toLowerCase()),
    };
  }

  return {
    enabled: value.enabled ?? false,
    limit: value.limit ?? 100,
    includeHeaders: value.includeHeaders ?? false,
    includeBody: value.includeBody ?? true,
    includeResponseBody: value.includeResponseBody ?? false,
    redactHeaders: (value.redactHeaders ?? DEFAULT_REDACT_HEADERS).map((h: string) =>
      h.toLowerCase(),
    ),
    redactFields: (value.redactFields ?? DEFAULT_REDACT_FIELDS).map((f: string) =>
      f.toLowerCase(),
    ),
  };
}

function buildRequestLog(
  req: Request,
  method: string,
  options: Required<MockServerLogOptions>,
): Record<string, unknown> | undefined {
  if (!options.enabled) return undefined;

  const payload: Record<string, unknown> = {};

  if (options.logHeaders) {
    payload.headers = redactHeaders(req.headers, options.redactHeaders);
  }

  if (
    options.logBody &&
    method !== "GET" &&
    req.body &&
    Object.keys(req.body).length > 0
  ) {
    payload.body = redactValue(req.body, options.redactFields);
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function buildResponseLog(
  body: unknown,
  options: Required<MockServerLogOptions>,
): Record<string, unknown> | undefined {
  if (!options.enabled || !options.logResponseBody) return undefined;
  return { body: redactValue(body, options.redactFields) };
}

function buildRequestHistoryEntry(
  req: Request,
  method: string,
  statusCode: number,
  responseBody: unknown,
  options: Required<RequestHistoryOptions>,
  id: number,
): RequestLogEntry | undefined {
  if (!options.enabled) return undefined;

  const entry: RequestLogEntry = {
    id,
    timestamp: new Date().toISOString(),
    method,
    path: req.path,
    statusCode,
    query: redactValue(req.query, options.redactFields) as Record<string, unknown>,
    params: redactValue(req.params, options.redactFields) as Record<string, unknown>,
  };

  if (options.includeHeaders) {
    entry.headers = redactHeaders(req.headers, options.redactHeaders);
  }

  if (
    options.includeBody &&
    req.body &&
    Object.keys(req.body).length > 0
  ) {
    entry.body = redactValue(req.body, options.redactFields);
  }

  if (options.includeResponseBody) {
    entry.responseBody = redactValue(responseBody, options.redactFields);
  }

  return entry;
}

function redactHeaders(
  headers: Request["headers"],
  redactList: string[],
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === "string" || Array.isArray(value)) {
      result[lowerKey] = redactList.includes(lowerKey) ? "[REDACTED]" : value;
    }
  }
  return result;
}

function redactValue(value: unknown, redactFields: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactFields));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (redactFields.includes(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactValue(entryValue, redactFields);
      }
    }
    return result;
  }

  return value;
}

function computeDeterministicSeed(
  req: Request,
  route: ParsedRoute,
  statusCode: number,
  options: DeterministicOptions,
): number {
  const headerData = options.includeHeaders
    ? normalizeHeaders(req.headers)
    : undefined;
  const requestSeed = req.header("x-mock-seed");
  const payload = {
    method: route.method,
    path: req.path,
    statusCode,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: headerData,
    requestSeed: requestSeed ?? "",
    seed: options.seed ?? "",
  };
  return hashStringToSeed(stableStringify(payload));
}

function normalizeHeaders(
  headers: Request["headers"],
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" || Array.isArray(value)) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

function createSeededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededFaker(seed: number): Faker {
  const seeded = new Faker({ locale: [en] });
  seeded.seed(seed);
  return seeded;
}

function hashStringToSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const entryValue = stableStringify(
        (value as Record<string, unknown>)[key],
      );
      return `${JSON.stringify(key)}:${entryValue}`;
    });
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function validateRouteRequest(route: ParsedRoute, req: Request): string[] {
  const errors: string[] = [];

  for (const parameter of route.parameters ?? []) {
    let rawValue: any;

    switch (parameter.in) {
      case "path":
        rawValue = req.params[parameter.name];
        break;
      case "query":
        rawValue = req.query[parameter.name];
        break;
      case "header":
        rawValue = req.header(parameter.name);
        break;
      case "cookie":
        rawValue = (req as any).cookies?.[parameter.name];
        break;
    }

    const isMissing =
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim().length === 0);

    if (parameter.required && isMissing) {
      errors.push(`Missing required ${parameter.in} parameter '${parameter.name}'.`);
      continue;
    }

    if (isMissing || !parameter.schema || isReferenceObject(parameter.schema)) {
      continue;
    }

    errors.push(
      ...validateParameterValue(
        rawValue,
        parameter.schema,
        `${parameter.in}.${parameter.name}`,
      ),
    );
  }

  if (route.requestSchema && !isReferenceObject(route.requestSchema)) {
    const hasBody =
      req.body !== undefined &&
      req.body !== null &&
      !(typeof req.body === "string" && req.body.trim().length === 0);

    if (route.requestRequired && !hasBody) {
      errors.push("Missing required request body.");
    }

    if (hasBody) {
      errors.push(...validateSchemaValue(req.body, route.requestSchema, "body"));
    }
  }

  return errors;
}

function validateParameterValue(
  rawValue: unknown,
  schema: OpenAPIV3.SchemaObject,
  location: string,
): string[] {
  if (schema.type === "array") {
    const arrayValues = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string"
        ? rawValue.split(",").map((item) => item.trim())
        : [rawValue];

    if (schema.items && !isReferenceObject(schema.items)) {
      return arrayValues.flatMap((item, index) =>
        validateParameterValue(
          item,
          schema.items as OpenAPIV3.SchemaObject,
          `${location}[${index}]`,
        ),
      );
    }

    return [];
  }

  let value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  // Coerce parameter values to their expected types for schema validation.
  if (typeof value === "string") {
    if (schema.type === "integer" || schema.type === "number") {
      const coerced = Number(value);
      if (!isNaN(coerced) && value.trim() !== "") {
        value = coerced;
      }
    } else if (schema.type === "boolean") {
      const lower = value.toLowerCase();
      if (lower === "true") value = true;
      else if (lower === "false") value = false;
    }
  }

  return validateSchemaValue(value, schema, location);
}


function validateSchemaValue(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  location: string,
): string[] {
  if (schema.nullable && value === null) {
    return [];
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    return [
      `Invalid ${location}: expected one of [${schema.enum.join(", ")}], received ${JSON.stringify(value)}.`,
    ];
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const matchedCount = schema.oneOf.filter((item) => {
      if (isReferenceObject(item)) {
        return true;
      }
      return validateSchemaValue(value, item, location).length === 0;
    }).length;

    if (matchedCount !== 1) {
      return [`Invalid ${location}: value must match exactly one schema variant.`];
    }
    return [];
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const matched = schema.anyOf.some((item) => {
      if (isReferenceObject(item)) {
        return true;
      }
      return validateSchemaValue(value, item, location).length === 0;
    });

    if (!matched) {
      return [`Invalid ${location}: value does not match any accepted schema variant.`];
    }
    return [];
  }

  if (schema.allOf && schema.allOf.length > 0) {
    return schema.allOf.flatMap((item) => {
      if (isReferenceObject(item)) {
        return [];
      }
      return validateSchemaValue(value, item, location);
    });
  }

  const inferredType = schema.type ?? inferSchemaType(schema);
  const errors: string[] = [];

  switch (inferredType) {
    case "object": {
      if (!isPlainObject(value)) {
        return [`Invalid ${location}: expected object.`];
      }

      for (const requiredKey of schema.required ?? []) {
        if (!(requiredKey in value)) {
          errors.push(`Missing required field ${location}.${requiredKey}.`);
        }
      }

      for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
        if (!(key in value) || isReferenceObject(propertySchema)) {
          continue;
        }

        errors.push(
          ...validateSchemaValue(
            (value as Record<string, unknown>)[key],
            propertySchema,
            `${location}.${key}`,
          ),
        );
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        return [`Invalid ${location}: expected array.`];
      }

      const arraySchema = asArraySchema(schema);
      if (!arraySchema) {
        return errors;
      }

      if (typeof arraySchema.minItems === "number" && value.length < arraySchema.minItems) {
        errors.push(`Invalid ${location}: expected at least ${arraySchema.minItems} items.`);
      }

      if (typeof arraySchema.maxItems === "number" && value.length > arraySchema.maxItems) {
        errors.push(`Invalid ${location}: expected at most ${arraySchema.maxItems} items.`);
      }

      if (arraySchema.items && !isReferenceObject(arraySchema.items)) {
        value.forEach((item, index) => {
          errors.push(...validateSchemaValue(item, arraySchema.items as OpenAPIV3.SchemaObject, `${location}[${index}]`));
        });
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        return [`Invalid ${location}: expected string.`];
      }

      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        errors.push(`Invalid ${location}: expected minimum length ${schema.minLength}.`);
      }

      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        errors.push(`Invalid ${location}: expected maximum length ${schema.maxLength}.`);
      }

      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push(`Invalid ${location}: value does not match required pattern.`);
        }
      }
      break;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return [`Invalid ${location}: expected integer.`];
      }

      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`Invalid ${location}: expected value >= ${schema.minimum}.`);
      }

      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`Invalid ${location}: expected value <= ${schema.maximum}.`);
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return [`Invalid ${location}: expected number.`];
      }

      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`Invalid ${location}: expected value >= ${schema.minimum}.`);
      }

      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`Invalid ${location}: expected value <= ${schema.maximum}.`);
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return [`Invalid ${location}: expected boolean.`];
      }
      break;
    }
    default:
      break;
  }

  return errors;
}

function inferSchemaType(schema: OpenAPIV3.SchemaObject): OpenAPIV3.NonArraySchemaObjectType | "array" | undefined {
  if (schema.properties || schema.required) {
    return "object";
  }
  if ("items" in schema) {
    return "array";
  }
  return undefined;
}

function asArraySchema(
  schema: OpenAPIV3.SchemaObject,
): OpenAPIV3.ArraySchemaObject | undefined {
  if (schema.type === "array" || "items" in schema) {
    return schema as OpenAPIV3.ArraySchemaObject;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenceObject(value: unknown): value is OpenAPIV3.ReferenceObject {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}

function findBestResponse(
  route: ParsedRoute,
  statusCode: number,
): ParsedResponse | undefined {
  const codeStr = String(statusCode);
  const responses = route.responses || [];

  // 1. Exact match
  let match = responses.find((r) => r.statusCode === codeStr);
  if (match) return match;

  // 2. Wildcard match (e.g. 2XX, 4XX)
  const wildcard = codeStr[0] + "XX";
  match = responses.find((r) => r.statusCode === wildcard);
  if (match) return match;

  // 3. "default" response
  match = responses.find((r) => r.statusCode === "default");
  if (match) return match;

  return undefined;
}

function parsePathInfo(path: string) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const lastSegment = segments[segments.length - 1];
  const isParam = lastSegment.startsWith(":");

  if (isParam) {
    if (segments.length < 2) return undefined;
    return {
      type: "item" as const,
      collection: segments[segments.length - 2],
      paramName: lastSegment.substring(1),
    };
  } else {
    return {
      type: "collection" as const,
      collection: lastSegment,
    };
  }
}
