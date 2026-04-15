export type ReminderChannel = "NONE" | "EMAIL" | "SMS";

const REMINDER_HOUR_UTC = 12;

export function parseReminderChannel(value: unknown): ReminderChannel | null {
  if (value === "NONE") return "NONE";
  if (value === "EMAIL") return "EMAIL";
  if (value === "SMS") return "SMS";
  return null;
}

export function parseDueDayOfMonth(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

export function parseRemindDaysBefore(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 31) return fallback;
  return n;
}

function daysInMonthUtc(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, REMINDER_HOUR_UTC, 0, 0)).getUTCDate();
}

export function buildReminderDateUtc(year: number, month: number, day: number) {
  const clampedDay = Math.min(day, daysInMonthUtc(year, month));
  return new Date(Date.UTC(year, month - 1, clampedDay, REMINDER_HOUR_UTC, 0, 0));
}

export function parseReminderDateInput(value: unknown, year: number, month: number): Date | null {
  const raw = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const parsedYear = Number(match[1]);
  const parsedMonth = Number(match[2]);
  const parsedDay = Number(match[3]);
  if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth) || !Number.isInteger(parsedDay)) return null;
  if (parsedYear !== year || parsedMonth !== month) return null;

  return buildReminderDateUtc(parsedYear, parsedMonth, parsedDay);
}

export function ymdFromReminderDate(date: Date | null | undefined) {
  if (!date) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function materializeReminderForMonth(args: {
  year: number;
  month: number;
  reminderChannel: ReminderChannel;
  dueDayOfMonth: number | null;
  remindDaysBefore: number;
}) {
  const reminderChannel = args.reminderChannel;
  const dueDayOfMonth = args.dueDayOfMonth;
  const remindDaysBefore = Math.max(0, args.remindDaysBefore);

  if (reminderChannel === "NONE" || dueDayOfMonth == null) {
    return {
      reminderChannel: "NONE" as ReminderChannel,
      dueDate: null,
      remindAt: null,
      remindDaysBefore: 0,
      reminderOverridden: false,
      emailReminderSentAt: null,
      smsReminderSentAt: null,
      reminderResolvedAt: null,
    };
  }

  const dueDate = buildReminderDateUtc(args.year, args.month, dueDayOfMonth);
  const remindAt = new Date(dueDate.getTime() - remindDaysBefore * 24 * 60 * 60 * 1000);

  return {
    reminderChannel,
    dueDate,
    remindAt,
    remindDaysBefore,
    reminderOverridden: false,
    emailReminderSentAt: null,
    smsReminderSentAt: null,
    reminderResolvedAt: null,
  };
}

export function applyDueDateOverride(args: {
  dueDate: Date;
  reminderChannel: ReminderChannel;
  remindDaysBefore: number;
}) {
  if (args.reminderChannel === "NONE") {
    return {
      dueDate: null,
      remindAt: null,
      reminderOverridden: true,
      emailReminderSentAt: null,
      smsReminderSentAt: null,
      reminderResolvedAt: null,
    };
  }

  const remindAt = new Date(args.dueDate.getTime() - Math.max(0, args.remindDaysBefore) * 24 * 60 * 60 * 1000);
  return {
    dueDate: args.dueDate,
    remindAt,
    reminderOverridden: true,
    emailReminderSentAt: null,
    smsReminderSentAt: null,
    reminderResolvedAt: null,
  };
}

export function summarizeReminderConfig(config: {
  reminderChannel: ReminderChannel;
  dueDayOfMonth: number | null | undefined;
  remindDaysBefore: number | null | undefined;
}) {
  if (config.reminderChannel === "NONE" || config.dueDayOfMonth == null) {
    return null;
  }
  return {
    reminderChannel: config.reminderChannel,
    dueDayOfMonth: config.dueDayOfMonth,
    remindDaysBefore: Math.max(0, Number(config.remindDaysBefore ?? 0)),
  };
}
