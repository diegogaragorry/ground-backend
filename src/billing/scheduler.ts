import { runDueMonthlyRenewals } from "./renewals.service";

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

let renewalInterval: NodeJS.Timeout | null = null;
let renewalRunInFlight = false;

async function runScheduledRenewals() {
  if (renewalRunInFlight) return;
  renewalRunInFlight = true;
  try {
    const limit = readPositiveIntEnv("BILLING_RENEWALS_BATCH_SIZE", 10);
    const result = await runDueMonthlyRenewals(limit);
    if (result.claimed > 0 || result.failed > 0) {
      console.log("[billing] renewal run", result);
    }
  } catch (error) {
    console.error("[billing] renewal scheduler failed", error);
  } finally {
    renewalRunInFlight = false;
  }
}

export function startBillingScheduler() {
  const enabled = readBooleanEnv("BILLING_RENEWALS_INTERNAL_SCHEDULER", process.env.NODE_ENV === "production");
  if (!enabled) return;
  if (renewalInterval) return;

  const intervalMinutes = readPositiveIntEnv("BILLING_RENEWALS_INTERVAL_MINUTES", 15);
  const initialDelayMs = readPositiveIntEnv("BILLING_RENEWALS_INITIAL_DELAY_MS", 15000);

  setTimeout(() => {
    void runScheduledRenewals();
    renewalInterval = setInterval(() => {
      void runScheduledRenewals();
    }, intervalMinutes * 60 * 1000);
  }, initialDelayMs);
}
