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
    const summary = {
      count: group.rows.length,
      earliestDueDate: earliestDueDate(group.rows),
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
