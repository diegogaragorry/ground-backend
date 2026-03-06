import type { Request } from "express";

export type PreferredLanguage = "es" | "en";

export function normalizePreferredLanguage(value: unknown): PreferredLanguage | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("es")) return "es";
  if (raw.startsWith("en")) return "en";
  return null;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function getRequestPreferredLanguage(req: Request): PreferredLanguage | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return (
    normalizePreferredLanguage(body.preferredLanguage) ??
    normalizePreferredLanguage(body.language) ??
    normalizePreferredLanguage(firstHeaderValue(req.headers["x-app-language"])) ??
    normalizePreferredLanguage(firstHeaderValue(req.headers["accept-language"]))
  );
}

export function resolvePreferredLanguage(...values: unknown[]): PreferredLanguage {
  for (const value of values) {
    const normalized = normalizePreferredLanguage(value);
    if (normalized) return normalized;
  }
  return "en";
}
