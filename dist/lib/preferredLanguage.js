"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePreferredLanguage = normalizePreferredLanguage;
exports.getRequestPreferredLanguage = getRequestPreferredLanguage;
exports.resolvePreferredLanguage = resolvePreferredLanguage;
function normalizePreferredLanguage(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw)
        return null;
    if (raw.startsWith("es"))
        return "es";
    if (raw.startsWith("en"))
        return "en";
    return null;
}
function firstHeaderValue(value) {
    if (Array.isArray(value))
        return value[0] ?? "";
    return value ?? "";
}
function getRequestPreferredLanguage(req) {
    const body = (req.body ?? {});
    return (normalizePreferredLanguage(body.preferredLanguage) ??
        normalizePreferredLanguage(body.language) ??
        normalizePreferredLanguage(firstHeaderValue(req.headers["x-app-language"])) ??
        normalizePreferredLanguage(firstHeaderValue(req.headers["accept-language"])));
}
function resolvePreferredLanguage(...values) {
    for (const value of values) {
        const normalized = normalizePreferredLanguage(value);
        if (normalized)
            return normalized;
    }
    return "en";
}
