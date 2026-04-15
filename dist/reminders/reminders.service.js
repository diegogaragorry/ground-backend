"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDueExpenseReminders = runDueExpenseReminders;
const prisma_1 = require("../lib/prisma");
const mailer_1 = require("../lib/mailer");
const reminderMessages_1 = require("../lib/reminderMessages");
const preferredLanguage_1 = require("../lib/preferredLanguage");
const sms_1 = require("../lib/sms");
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
async function runDueExpenseReminders(limit = 100) {
    const now = new Date();
    const dueRows = await prisma_1.prisma.plannedExpense.findMany({
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
    const groups = groupRows(dueRows);
    let sent = 0;
    let failed = 0;
    for (const group of groups) {
        const first = group.rows[0];
        const language = (0, preferredLanguage_1.resolvePreferredLanguage)(first.user.preferredLanguage);
        const summary = {
            count: group.rows.length,
            earliestDueDate: earliestDueDate(group.rows),
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
