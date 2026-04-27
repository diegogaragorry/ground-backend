"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDueExpenseReminders = runDueExpenseReminders;
const prisma_1 = require("../lib/prisma");
const mailer_1 = require("../lib/mailer");
const reminderMessages_1 = require("../lib/reminderMessages");
const preferredLanguage_1 = require("../lib/preferredLanguage");
const plannedVisibility_1 = require("../lib/plannedVisibility");
const sms_1 = require("../lib/sms");
function isEncryptedPlaceholder(value) {
    return typeof value === "string" && /^\(encrypted(?:-[a-z0-9]{8})?\)$/i.test(String(value).trim());
}
function resolveReminderLabel(row) {
    const explicit = String(row.reminderLabel ?? "").trim();
    if (explicit)
        return explicit;
    const fallback = String(row.description ?? "").trim();
    return fallback && !isEncryptedPlaceholder(fallback) ? fallback : null;
}
function groupRows(rows) {
    const map = new Map();
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
function earliestDueDate(rows) {
    const dates = rows.map((row) => row.dueDate).filter((value) => value instanceof Date);
    if (dates.length === 0)
        return null;
    return dates.sort((a, b) => a.getTime() - b.getTime())[0];
}
function sameUtcDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date))
        return false;
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
function shouldSendRowToday(row, now) {
    const mode = row.user.expenseReminderSendMode ?? "ONCE";
    const sentAt = row.reminderChannel === "EMAIL" ? row.emailReminderSentAt : row.smsReminderSentAt;
    if (!(sentAt instanceof Date))
        return true;
    if (mode === "DAILY_UNTIL_PAID")
        return !sameUtcDay(sentAt, now);
    return false;
}
function labelsForDueDate(schedule, targetDate, fallbackRows) {
    if (!(targetDate instanceof Date))
        return [];
    const key = targetDate.toISOString().slice(0, 10);
    const fromSchedule = schedule.find((item) => item.dueDate.toISOString().slice(0, 10) === key)?.labels ?? [];
    if (fromSchedule.length > 0)
        return fromSchedule;
    return [
        ...new Set(fallbackRows
            .filter((row) => row.dueDate instanceof Date && row.dueDate.toISOString().slice(0, 10) === key)
            .map((row) => resolveReminderLabel(row))
            .filter((value) => Boolean(value))),
    ];
}
function monthBounds(referenceDate) {
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
    return { start, end };
}
async function loadMonthlySchedule(userId, channel, referenceDate) {
    const { start, end } = monthBounds(referenceDate);
    const rawRows = await prisma_1.prisma.plannedExpense.findMany({
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
            templateId: true,
            isConfirmed: true,
            expenseType: true,
            categoryId: true,
            dueDate: true,
            reminderLabel: true,
            description: true,
        },
    });
    const rows = await (0, plannedVisibility_1.filterVisiblePlannedRows)(userId, rawRows);
    const grouped = new Map();
    for (const row of rows) {
        if (!(row.dueDate instanceof Date))
            continue;
        const label = resolveReminderLabel(row);
        if (!label)
            continue;
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
        schedule: [...grouped.values()]
            .map((item) => ({
            dueDate: item.dueDate,
            labels: [...new Set(item.labels)],
        }))
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
    };
}
async function runDueExpenseReminders(limit = 100) {
    const now = new Date();
    const dueRowsRaw = await prisma_1.prisma.plannedExpense.findMany({
        where: {
            isConfirmed: false,
            reminderResolvedAt: null,
            reminderChannel: { in: ["EMAIL", "SMS"] },
            remindAt: { not: null, lte: now },
            OR: [{ templateId: null }, { template: { showInExpenses: true } }],
        },
        orderBy: [{ remindAt: "asc" }],
        take: limit * 5,
        select: {
            id: true,
            userId: true,
            templateId: true,
            isConfirmed: true,
            expenseType: true,
            categoryId: true,
            reminderChannel: true,
            dueDate: true,
            reminderLabel: true,
            description: true,
            emailReminderSentAt: true,
            smsReminderSentAt: true,
            user: {
                select: {
                    email: true,
                    phone: true,
                    phoneVerifiedAt: true,
                    preferredLanguage: true,
                    expenseReminderSendMode: true,
                },
            },
        },
    });
    const visibleDueRows = await Promise.all([...new Set(dueRowsRaw.map((row) => row.userId))].map(async (userId) => (0, plannedVisibility_1.filterVisiblePlannedRows)(userId, dueRowsRaw.filter((row) => row.userId === userId))));
    const dueRows = visibleDueRows.flat().filter((row) => shouldSendRowToday(row, now)).slice(0, limit);
    const groups = groupRows(dueRows);
    let sent = 0;
    let failed = 0;
    for (const group of groups) {
        const first = group.rows[0];
        const language = (0, preferredLanguage_1.resolvePreferredLanguage)(first.user.preferredLanguage);
        const triggeredDueDate = earliestDueDate(group.rows) ?? now;
        const monthlyOverview = await loadMonthlySchedule(group.userId, group.channel, triggeredDueDate);
        const monthlySchedule = monthlyOverview.schedule;
        const earliestOutstandingDueDate = monthlySchedule[0]?.dueDate ?? triggeredDueDate;
        const triggeredLabels = labelsForDueDate(monthlySchedule, triggeredDueDate, group.rows);
        const earliestOutstandingLabels = labelsForDueDate(monthlySchedule, earliestOutstandingDueDate, group.rows);
        const summary = {
            count: Math.max(monthlyOverview.count, group.rows.length),
            triggeredDueDate,
            triggeredLabels,
            earliestOutstandingDueDate,
            earliestOutstandingLabels,
            monthlySchedule,
        };
        try {
            if (group.channel === "EMAIL") {
                await (0, mailer_1.sendExpenseReminderEmail)(first.user.email, summary, language);
                await prisma_1.prisma.plannedExpense.updateMany({
                    where: { id: { in: group.rows.map((row) => row.id) }, emailReminderSentAt: null },
                    data: { emailReminderSentAt: now },
                });
            }
            else {
                if (!first.user.phone || !first.user.phoneVerifiedAt) {
                    continue;
                }
                const body = (0, reminderMessages_1.buildExpenseReminderSms)(summary, language);
                await (0, sms_1.sendSms)(first.user.phone, body);
                await prisma_1.prisma.plannedExpense.updateMany({
                    where: { id: { in: group.rows.map((row) => row.id) }, smsReminderSentAt: null },
                    data: { smsReminderSentAt: now },
                });
            }
            sent += 1;
        }
        catch (error) {
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
