/**
 * Shared type-guard and string-coercion utilities used across server modules.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function stringFrom(value: unknown, fallback: string): string;
export function stringFrom(value: unknown, fallback: undefined): string | undefined;
export function stringFrom(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCompareText(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}
