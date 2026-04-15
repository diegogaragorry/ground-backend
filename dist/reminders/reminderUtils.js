"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReminderChannel = parseReminderChannel;
exports.parseDueDayOfMonth = parseDueDayOfMonth;
exports.parseRemindDaysBefore = parseRemindDaysBefore;
exports.buildReminderDateUtc = buildReminderDateUtc;
exports.parseReminderDateInput = parseReminderDateInput;
exports.ymdFromReminderDate = ymdFromReminderDate;
exports.materializeReminderForMonth = materializeReminderForMonth;
exports.applyDueDateOverride = applyDueDateOverride;
exports.summarizeReminderConfig = summarizeReminderConfig;
const REMINDER_HOUR_UTC = 12;
function parseReminderChannel(value) {
    if (value === "NONE")
        return "NONE";
    if (value === "EMAIL")
        return "EMAIL";
    if (value === "SMS")
        return "SMS";
    return null;
}
function parseDueDayOfMonth(value) {
    if (value == null || value === "")
        return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 31)
        return null;
    return n;
}
function parseRemindDaysBefore(value, fallback = 0) {
    if (value == null || value === "")
        return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 31)
        return fallback;
    return n;
}
function daysInMonthUtc(year, month) {
    return new Date(Date.UTC(year, month, 0, REMINDER_HOUR_UTC, 0, 0)).getUTCDate();
}
function buildReminderDateUtc(year, month, day) {
    const clampedDay = Math.min(day, daysInMonthUtc(year, month));
    return new Date(Date.UTC(year, month - 1, clampedDay, REMINDER_HOUR_UTC, 0, 0));
}
function parseReminderDateInput(value, year, month) {
    const raw = String(value ?? "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match)
        return null;
    const parsedYear = Number(match[1]);
    const parsedMonth = Number(match[2]);
    const parsedDay = Number(match[3]);
    if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth) || !Number.isInteger(parsedDay))
        return null;
    if (parsedYear !== year || parsedMonth !== month)
        return null;
    return buildReminderDateUtc(parsedYear, parsedMonth, parsedDay);
}
function ymdFromReminderDate(date) {
    if (!date)
        return "";
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function materializeReminderForMonth(args) {
    const reminderChannel = args.reminderChannel;
    const dueDayOfMonth = args.dueDayOfMonth;
    const remindDaysBefore = Math.max(0, args.remindDaysBefore);
    if (reminderChannel === "NONE" || dueDayOfMonth == null) {
        return {
            reminderChannel: "NONE",
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
function applyDueDateOverride(args) {
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
function summarizeReminderConfig(config) {
    if (config.reminderChannel === "NONE" || config.dueDayOfMonth == null) {
        return null;
    }
    return {
        reminderChannel: config.reminderChannel,
        dueDayOfMonth: config.dueDayOfMonth,
        remindDaysBefore: Math.max(0, Number(config.remindDaysBefore ?? 0)),
    };
}
