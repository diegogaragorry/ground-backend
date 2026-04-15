"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startExpenseReminderScheduler = startExpenseReminderScheduler;
const reminders_service_1 = require("./reminders.service");
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
let reminderInterval = null;
let reminderRunInFlight = false;
async function runScheduledExpenseReminders() {
    if (reminderRunInFlight)
        return;
    reminderRunInFlight = true;
    try {
        const limit = readPositiveIntEnv("EXPENSE_REMINDERS_BATCH_SIZE", 100);
        const result = await (0, reminders_service_1.runDueExpenseReminders)(limit);
        if (result.sent > 0 || result.failed > 0) {
            console.log("[reminders] run", result);
        }
    }
    catch (error) {
        console.error("[reminders] scheduler failed", error);
    }
    finally {
        reminderRunInFlight = false;
    }
}
function startExpenseReminderScheduler() {
    const enabled = readBooleanEnv("EXPENSE_REMINDERS_INTERNAL_SCHEDULER", process.env.NODE_ENV === "production");
    if (!enabled)
        return;
    if (reminderInterval)
        return;
    const intervalMinutes = readPositiveIntEnv("EXPENSE_REMINDERS_INTERVAL_MINUTES", 60);
    const initialDelayMs = readPositiveIntEnv("EXPENSE_REMINDERS_INITIAL_DELAY_MS", 30000);
    setTimeout(() => {
        void runScheduledExpenseReminders();
        reminderInterval = setInterval(() => {
            void runScheduledExpenseReminders();
        }, intervalMinutes * 60 * 1000);
    }, initialDelayMs);
}
