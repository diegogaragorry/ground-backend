import { runDueExpenseReminders } from "./reminders.service";

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

let reminderInterval: NodeJS.Timeout | null = null;
let reminderRunInFlight = false;

async function runScheduledExpenseReminders() {
  if (reminderRunInFlight) return;
  reminderRunInFlight = true;
  try {
    const limit = readPositiveIntEnv("EXPENSE_REMINDERS_BATCH_SIZE", 100);
    const result = await runDueExpenseReminders(limit);
    if (result.sent > 0 || result.failed > 0) {
      console.log("[reminders] run", result);
    }
  } catch (error) {
    console.error("[reminders] scheduler failed", error);
  } finally {
    reminderRunInFlight = false;
  }
}

export function startExpenseReminderScheduler() {
  const enabled = readBooleanEnv("EXPENSE_REMINDERS_INTERNAL_SCHEDULER", process.env.NODE_ENV === "production");
  if (!enabled) return;
  if (reminderInterval) return;

  const intervalMinutes = readPositiveIntEnv("EXPENSE_REMINDERS_INTERVAL_MINUTES", 60);
  const initialDelayMs = readPositiveIntEnv("EXPENSE_REMINDERS_INITIAL_DELAY_MS", 30000);

  setTimeout(() => {
    void runScheduledExpenseReminders();
    reminderInterval = setInterval(() => {
      void runScheduledExpenseReminders();
    }, intervalMinutes * 60 * 1000);
  }, initialDelayMs);
}
