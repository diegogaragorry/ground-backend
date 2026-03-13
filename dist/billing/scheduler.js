"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBillingScheduler = startBillingScheduler;
const renewals_service_1 = require("./renewals.service");
function readBooleanEnv(name, fallback) {
    const raw = process.env[name];
    if (raw == null)
        return fallback;
    const normalized = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
        return true;
    if (["0", "false", "no", "off"].includes(normalized))
        return false;
    return fallback;
}
function readPositiveIntEnv(name, fallback) {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}
let renewalInterval = null;
let renewalRunInFlight = false;
async function runScheduledRenewals() {
    if (renewalRunInFlight)
        return;
    renewalRunInFlight = true;
    try {
        const limit = readPositiveIntEnv("BILLING_RENEWALS_BATCH_SIZE", 10);
        const result = await (0, renewals_service_1.runDueMonthlyRenewals)(limit);
        if (result.claimed > 0 || result.failed > 0) {
            console.log("[billing] renewal run", result);
        }
    }
    catch (error) {
        console.error("[billing] renewal scheduler failed", error);
    }
    finally {
        renewalRunInFlight = false;
    }
}
function startBillingScheduler() {
    const enabled = readBooleanEnv("BILLING_RENEWALS_INTERNAL_SCHEDULER", process.env.NODE_ENV === "production");
    if (!enabled)
        return;
    if (renewalInterval)
        return;
    const intervalMinutes = readPositiveIntEnv("BILLING_RENEWALS_INTERVAL_MINUTES", 15);
    const initialDelayMs = readPositiveIntEnv("BILLING_RENEWALS_INITIAL_DELAY_MS", 15000);
    setTimeout(() => {
        void runScheduledRenewals();
        renewalInterval = setInterval(() => {
            void runScheduledRenewals();
        }, intervalMinutes * 60 * 1000);
    }, initialDelayMs);
}
