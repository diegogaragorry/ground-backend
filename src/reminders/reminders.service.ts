import { prisma } from "../lib/prisma";
import { sendExpenseReminderEmail } from "../lib/mailer";
import { buildExpenseReminderSms } from "../lib/reminderMessages";
import { resolvePreferredLanguage } from "../lib/preferredLanguage";
import { sendSms } from "../lib/sms";

type ReminderRow = {
  id: string;
  userId: string;
  reminderChannel: "EMAIL" | "SMS";
  dueDate: Date | null;
  reminderLabel: string | null;
  description: string;
  user: {
    email: string;
    phone: string | null;
    phoneVerifiedAt: Date | null;
    preferredLanguage: string | null;
  };
};

type ReminderGroup = {
  userId: string;
  channel: "EMAIL" | "SMS";
  rows: ReminderRow[];
};

function isEncryptedPlaceholder(value: unknown) {
  return typeof value === "string" && /^\(encrypted(?:-[a-z0-9]{8})?\)$/i.test(String(value).trim());
}

function resolveReminderLabel(row: Pick<ReminderRow, "reminderLabel" | "description">) {
  const explicit = String(row.reminderLabel ?? "").trim();
  if (explicit) return explicit;
  const fallback = String(row.description ?? "").trim();
  return fallback && !isEncryptedPlaceholder(fallback) ? fallback : null;
}

function groupRows(rows: ReminderRow[]) {
  const map = new Map<string, ReminderGroup>();
  for (const row of rows) {
    const key = `${row.userId}:${row.reminderChannel}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    map.set(key, {
      userId: row.userId,
      channel: row.reminderChannel,
      rows: [row],
    });
  }
  return [...map.values()];
}

function earliestDueDate(rows: ReminderRow[]) {
  const dates = rows.map((row) => row.dueDate).filter((value): value is Date => value instanceof Date);
  if (dates.length === 0) return null;
  return dates.sort((a, b) => a.getTime() - b.getTime())[0];
}

function monthBounds(referenceDate: Date) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
  return { start, end };
}

async function loadMonthlySchedule(
  userId: string,
  channel: "EMAIL" | "SMS",
  referenceDate: Date
) {
  const { start, end } = monthBounds(referenceDate);
  const rows = await prisma.plannedExpense.findMany({
    where: {
      userId,
      isConfirmed: false,
      reminderResolvedAt: null,
      reminderChannel: channel,
      dueDate: { gte: start, lt: end },
      OR: [{ templateId: null }, { template: { showInExpenses: true } }],
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: {
      dueDate: true,
      reminderLabel: true,
      description: true,
    },
  });

  const grouped = new Map<string, { dueDate: Date; labels: string[] }>();
  for (const row of rows) {
    if (!(row.dueDate instanceof Date)) continue;
    const label = resolveReminderLabel(row);
    if (!label) continue;
    const key = row.dueDate.toISOString().slice(0, 10);
    const existing = grouped.get(key);
    if (existing) {
      existing.labels.push(label);
      continue;
    }
    grouped.set(key, { dueDate: row.dueDate, labels: [label] });
  }

  return {
    count: rows.length,
    schedule: [...grouped.values()].map((item) => ({
      dueDate: item.dueDate,
      labels: [...new Set(item.labels)],
    })),
  };
}

export async function runDueExpenseReminders(limit = 100) {
  const now = new Date();

  const dueRows = await prisma.plannedExpense.findMany({
    where: {
      isConfirmed: false,
      reminderResolvedAt: null,
      reminderChannel: { in: ["EMAIL", "SMS"] },
      remindAt: { not: null, lte: now },
      AND: [
        {
          OR: [
            { reminderChannel: "EMAIL", emailReminderSentAt: null },
            { reminderChannel: "SMS", smsReminderSentAt: null },
          ],
        },
        {
          OR: [{ templateId: null }, { template: { showInExpenses: true } }],
        },
      ],
    },
    orderBy: [{ remindAt: "asc" }],
    take: limit,
    select: {
      id: true,
      userId: true,
      reminderChannel: true,
      dueDate: true,
      reminderLabel: true,
      description: true,
      user: {
        select: {
          email: true,
          phone: true,
          phoneVerifiedAt: true,
          preferredLanguage: true,
        },
      },
    },
  });

  const groups = groupRows(dueRows as ReminderRow[]);
  let sent = 0;
  let failed = 0;

  for (const group of groups) {
    const first = group.rows[0];
    const language = resolvePreferredLanguage(first.user.preferredLanguage);
    const referenceDate = earliestDueDate(group.rows) ?? now;
    const monthlyOverview = await loadMonthlySchedule(group.userId, group.channel, referenceDate);
    const monthlySchedule = monthlyOverview.schedule;
    const nextDueKey = referenceDate.toISOString().slice(0, 10);
    const nextDueLabels =
      monthlySchedule.find((item) => item.dueDate.toISOString().slice(0, 10) === nextDueKey)?.labels ??
      [...new Set(
        group.rows
          .filter((row) => row.dueDate instanceof Date && row.dueDate.toISOString().slice(0, 10) === nextDueKey)
          .map((row) => resolveReminderLabel(row))
          .filter((value): value is string => Boolean(value))
      )];
    const summary = {
      count: Math.max(monthlyOverview.count, group.rows.length),
      earliestDueDate: referenceDate,
      nextDueLabels,
      monthlySchedule,
    };

    try {
      if (group.channel === "EMAIL") {
        await sendExpenseReminderEmail(first.user.email, summary, language);
        await prisma.plannedExpense.updateMany({
          where: { id: { in: group.rows.map((row) => row.id) }, emailReminderSentAt: null },
          data: { emailReminderSentAt: now },
        });
      } else {
        if (!first.user.phone || !first.user.phoneVerifiedAt) {
          continue;
        }
        const body = buildExpenseReminderSms(summary, language);
        await sendSms(first.user.phone, body);
        await prisma.plannedExpense.updateMany({
          where: { id: { in: group.rows.map((row) => row.id) }, smsReminderSentAt: null },
          data: { smsReminderSentAt: now },
        });
      }
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("[reminders] failed to send reminder batch", {
        userId: group.userId,
        channel: group.channel,
        count: group.rows.length,
        error,
      });
    }
  }

  return {
    due: dueRows.length,
    groups: groups.length,
    sent,
    failed,
  };
}
