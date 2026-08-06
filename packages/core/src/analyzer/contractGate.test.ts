import { describe, expect, it } from "vitest";
import type { ParsedRoute } from "../parser/openApiParser";
import {
  analyzeContractQuality,
  evaluateContractGate,
  findBreakingContractChanges,
  renderContractGateMarkdown,
} from "./contractGate";

describe("contract quality gate", () => {
  it("passes a well-documented contract", () => {
    const result = evaluateContractGate({
      currentRoutes: [readyRoute()],
      generatedAt: new Date("2026-07-24T12:00:00.000Z"),
    });

    expect(result.passed).toBe(true);
    expect(result.quality.score).toBe(100);
    expect(result.quality.blockingFindingCount).toBe(0);
    expect(result.breakingChanges).toEqual([]);
  });

  it("scores missing schemas and failure paths with explainable findings", () => {
    const route = readyRoute({
      summary: undefined,
      responses: [{ statusCode: "200" }],
      responseExamples: undefined,
    });

    const quality = analyzeContractQuality([route]);

    expect(quality.score).toBe(40);
    expect(quality.blockingFindingCount).toBe(1);
    expect(quality.warningFindingCount).toBe(3);
    expect(quality.findings.map((finding) => finding.code)).toEqual([
      "missing-success-schema",
      "missing-error-response",
      "missing-example-or-scenario",
      "missing-operation-documentation",
    ]);
  });

  it("detects consumer-breaking contract changes", () => {
    const baseline = [
      readyRoute({
        parameters: [
          {
            name: "trace",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        requestSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      }),
      readyRoute({ method: "DELETE", path: "/users/:id" }),
    ];
    const current = [
      readyRoute({
        parameters: [
          {
            name: "trace",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestRequired: true,
        requestSchema: {
          type: "object",
          required: ["name", "teamId"],
          properties: {
            name: { type: "string" },
            teamId: { type: "string" },
          },
        },
        responses: [
          {
            statusCode: "201",
            schema: {
              type: "object",
              properties: { id: { type: "string" } },
            },
          },
          { statusCode: "400", schema: { type: "object" } },
        ],
      }),
    ];

    const changes = findBreakingContractChanges(baseline, current);

    expect(changes.map((change) => change.code)).toEqual([
      "route-removed",
      "parameter-became-required",
      "request-body-became-required",
      "required-request-properties-added",
      "success-status-removed",
    ]);
  });

  it("does not classify additive optional inputs as breaking", () => {
    const baseline = readyRoute();
    const current = readyRoute({
      parameters: [
        {
          name: "cursor",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
    });

    expect(findBreakingContractChanges([baseline], [current])).toEqual([]);
  });

  it("enforces configurable policy thresholds", () => {
    const result = evaluateContractGate({
      currentRoutes: [
        readyRoute({
          summary: undefined,
          responses: [{ statusCode: "200" }],
          responseExamples: undefined,
        }),
      ],
      policy: {
        minimumScore: 50,
        maxBlockingFindings: 0,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.policy)).toEqual([
      "minimumScore",
      "maxBlockingFindings",
    ]);
  });

  it("renders a report suitable for pull requests and CI logs", () => {
    const result = evaluateContractGate({
      currentRoutes: [readyRoute()],
      generatedAt: new Date("2026-07-24T12:00:00.000Z"),
    });

    const markdown = renderContractGateMarkdown({
      result,
      currentSpecPath: "openapi.yaml",
    });

    expect(markdown).toContain("# MockNest API Quality Gate");
    expect(markdown).toContain("**PASS**");
    expect(markdown).toContain("Contract quality: 100/100");
    expect(markdown).toContain("mocknest gate --spec openapi.yaml");
  });
});

function readyRoute(overrides: Partial<ParsedRoute> = {}): ParsedRoute {
  return {
    method: "POST",
    path: "/users",
    summary: "Create a user",
    requestSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    },
    responseSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
    },
    responseExamples: {
      success: { id: "user-1" },
    },
    responses: [
      {
        statusCode: "200",
        schema: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
      },
      {
        statusCode: "400",
        schema: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    ],
    statusCode: 200,
    ...overrides,
  };
}
