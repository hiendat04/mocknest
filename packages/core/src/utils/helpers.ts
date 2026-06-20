import { OpenAPIV3 } from "openapi-types";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isReferenceObject(value: unknown): value is OpenAPIV3.ReferenceObject {
  return Boolean(
    value &&
      typeof value === "object" &&
      "$ref" in (value as Record<string, unknown>),
  );
}

export function stableStringify(value: unknown): string {
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
