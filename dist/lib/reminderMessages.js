"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExpenseReminderEmail = buildExpenseReminderEmail;
exports.buildExpenseReminderSms = buildExpenseReminderSms;
const preferredLanguage_1 = require("./preferredLanguage");
function formatDate(date, language) {
    if (!date)
        return language === "es" ? "pronto" : "soon";
    return new Intl.DateTimeFormat(language === "es" ? "es-UY" : "en-US", {
        day: "2-digit",
        month: "2-digit",
    }).format(date);
}
function summarizeLabels(labels, language, maxVisible) {
    const clean = [...new Set(labels.map((label) => String(label || "").trim()).filter(Boolean))];
    const visible = clean.slice(0, maxVisible);
    const hidden = clean.length - visible.length;
    if (hidden <= 0)
        return visible.join(", ");
    return language === "es"
        ? `${visible.join(", ")} y ${hidden} más`
        : `${visible.join(", ")} and ${hidden} more`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function sameUtcDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date))
        return false;
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
function earlierPendingSchedule(input) {
    if (!(input.triggeredDueDate instanceof Date))
        return [];
    return input.monthlySchedule.filter((item) => item.dueDate.getTime() < input.triggeredDueDate.getTime());
}
function summarizeDueDates(items, language, maxVisible) {
    const visible = items.slice(0, maxVisible).map((item) => formatDate(item.dueDate, language));
    const hidden = items.length - visible.length;
    if (hidden <= 0)
        return visible.join(", ");
    return language === "es"
        ? `${visible.join(", ")} y ${hidden} más`
        : `${visible.join(", ")} and ${hidden} more`;
}
function buildExpenseReminderEmail(input, language) {
    const resolved = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    const triggeredDueLabel = formatDate(input.triggeredDueDate, resolved);
    const outstandingDueLabel = formatDate(input.earliestOutstandingDueDate, resolved);
    const isSingle = input.count === 1;
    const triggeredSummary = summarizeLabels(input.triggeredLabels, resolved, 3);
    const earliestOutstandingSummary = summarizeLabels(input.earliestOutstandingLabels, resolved, 3);
    const earlierPending = earlierPendingSchedule(input);
    const hasEarlierPending = earlierPending.length > 0 && !sameUtcDay(input.triggeredDueDate, input.earliestOutstandingDueDate);
    const scheduleLines = input.monthlySchedule
        .filter((item) => item.labels.length > 0)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
        .map((item) => ({
        date: formatDate(item.dueDate, resolved),
        labels: summarizeLabels(item.labels, resolved, 6),
    }));
    const earlierPendingLines = earlierPending
        .filter((item) => item.labels.length > 0)
        .map((item) => ({
        date: formatDate(item.dueDate, resolved),
        labels: summarizeLabels(item.labels, resolved, 6),
    }));
    if (resolved === "es") {
        const subject = isSingle ? "Recordatorio de pago en Ground" : "Recordatorios de pagos en Ground";
        const text = [
            isSingle
                ? `Tenés 1 pago recurrente para revisar en Ground.`
                : `Tenés ${input.count} pagos recurrentes para revisar en Ground.`,
            hasEarlierPending
                ? (triggeredSummary
                    ? `Este recordatorio corresponde al vencimiento ${triggeredDueLabel}: ${triggeredSummary}.`
                    : `Este recordatorio corresponde al vencimiento ${triggeredDueLabel}.`)
                : (earliestOutstandingSummary
                    ? `Próximo vencimiento ${outstandingDueLabel}: ${earliestOutstandingSummary}.`
                    : `El próximo vence el ${outstandingDueLabel}.`),
            ...(hasEarlierPending
                ? [
                    earlierPendingLines.length > 0
                        ? `Además, seguís teniendo pendientes anteriores ya recordados: ${earlierPendingLines.map((item) => `${item.date}: ${item.labels}`).join("; ")}.`
                        : `Además, seguís teniendo pendientes anteriores desde ${summarizeDueDates(earlierPending, resolved, 3)}.`,
                ]
                : []),
            ...(scheduleLines.length > 0
                ? ["", "Vencimientos de este mes:", ...scheduleLines.map((item) => `- ${item.date}: ${item.labels}`)]
                : []),
            "",
            "Abrí la sección Gastos para revisar los borradores y confirmarlos:",
            "https://ground.finance/app/expenses",
        ].join("\n");
        const html = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Recordatorio de pagos en Ground</h2>
        <p style="margin: 0 0 10px;">
          ${isSingle ? "Tenés <strong>1 pago recurrente</strong>" : `Tenés <strong>${input.count} pagos recurrentes</strong>`}
          para revisar en Ground.
        </p>
        <p style="margin: 0 0 18px;">
          ${hasEarlierPending
            ? (triggeredSummary
                ? `Este recordatorio corresponde al vencimiento <strong>${escapeHtml(triggeredDueLabel)}</strong>: <strong>${escapeHtml(triggeredSummary)}</strong>.`
                : `Este recordatorio corresponde al vencimiento <strong>${escapeHtml(triggeredDueLabel)}</strong>.`)
            : (earliestOutstandingSummary
                ? `Próximo vencimiento <strong>${escapeHtml(outstandingDueLabel)}</strong>: <strong>${escapeHtml(earliestOutstandingSummary)}</strong>.`
                : `El próximo vence el <strong>${escapeHtml(outstandingDueLabel)}</strong>.`)}
        </p>
        ${hasEarlierPending
            ? `
        <p style="margin: 0 0 18px;">
          ${earlierPendingLines.length > 0
                ? `Además, seguís teniendo pendientes anteriores ya recordados: <strong>${earlierPendingLines.map((item) => `${escapeHtml(item.date)}: ${escapeHtml(item.labels)}`).join("; ")}</strong>.`
                : `Además, seguís teniendo pendientes anteriores desde <strong>${escapeHtml(summarizeDueDates(earlierPending, resolved, 3))}</strong>.`}
        </p>
        `
            : ""}
        ${scheduleLines.length > 0
            ? `
        <div style="margin: 0 0 18px;">
          <div style="font-weight: 700; margin-bottom: 8px;">Vencimientos de este mes</div>
          <ul style="margin: 0; padding-left: 18px;">
            ${scheduleLines.map((item) => `<li style="margin: 0 0 6px;"><strong>${escapeHtml(item.date)}</strong>: ${escapeHtml(item.labels)}</li>`).join("")}
          </ul>
        </div>
        `
            : ""}
        <p style="margin: 0 0 18px;">
          Abrí la sección <strong>Gastos</strong> para revisar los borradores y confirmarlos.
        </p>
        <p style="margin: 0 0 20px;">
          <a href="https://ground.finance/app/expenses" style="display: inline-block; background: #22c55e; color: white; text-decoration: none; padding: 10px 16px; border-radius: 999px; font-weight: 700;">Abrir Gastos</a>
        </p>
      </div>
    `.trim();
        return { subject, text, html };
    }
    const subject = isSingle ? "Payment reminder in Ground" : "Payment reminders in Ground";
    const text = [
        isSingle
            ? "You have 1 recurring payment to review in Ground."
            : `You have ${input.count} recurring payments to review in Ground.`,
        hasEarlierPending
            ? (triggeredSummary
                ? `This reminder is for the due date on ${triggeredDueLabel}: ${triggeredSummary}.`
                : `This reminder is for the due date on ${triggeredDueLabel}.`)
            : (earliestOutstandingSummary
                ? `Next due ${outstandingDueLabel}: ${earliestOutstandingSummary}.`
                : `The next one is due on ${outstandingDueLabel}.`),
        ...(hasEarlierPending
            ? [
                earlierPendingLines.length > 0
                    ? `You still have earlier pending due dates already reminded: ${earlierPendingLines.map((item) => `${item.date}: ${item.labels}`).join("; ")}.`
                    : `You still have earlier pending due dates starting on ${summarizeDueDates(earlierPending, resolved, 3)}.`,
            ]
            : []),
        ...(scheduleLines.length > 0
            ? ["", "This month's due dates:", ...scheduleLines.map((item) => `- ${item.date}: ${item.labels}`)]
            : []),
        "",
        "Open Expenses to review your drafts and confirm them:",
        "https://ground.finance/app/expenses",
    ].join("\n");
    const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Payment reminder in Ground</h2>
      <p style="margin: 0 0 10px;">
        ${isSingle ? "You have <strong>1 recurring payment</strong>" : `You have <strong>${input.count} recurring payments</strong>`}
        to review in Ground.
      </p>
      <p style="margin: 0 0 18px;">
        ${hasEarlierPending
        ? (triggeredSummary
            ? `This reminder is for the due date on <strong>${escapeHtml(triggeredDueLabel)}</strong>: <strong>${escapeHtml(triggeredSummary)}</strong>.`
            : `This reminder is for the due date on <strong>${escapeHtml(triggeredDueLabel)}</strong>.`)
        : (earliestOutstandingSummary
            ? `Next due <strong>${escapeHtml(outstandingDueLabel)}</strong>: <strong>${escapeHtml(earliestOutstandingSummary)}</strong>.`
            : `The next one is due on <strong>${escapeHtml(outstandingDueLabel)}</strong>.`)}
      </p>
      ${hasEarlierPending
        ? `
      <p style="margin: 0 0 18px;">
        ${earlierPendingLines.length > 0
            ? `You still have earlier pending due dates already reminded: <strong>${earlierPendingLines.map((item) => `${escapeHtml(item.date)}: ${escapeHtml(item.labels)}`).join("; ")}</strong>.`
            : `You still have earlier pending due dates starting on <strong>${escapeHtml(summarizeDueDates(earlierPending, resolved, 3))}</strong>.`}
      </p>
      `
        : ""}
      ${scheduleLines.length > 0
        ? `
      <div style="margin: 0 0 18px;">
        <div style="font-weight: 700; margin-bottom: 8px;">This month's due dates</div>
        <ul style="margin: 0; padding-left: 18px;">
        ${scheduleLines.map((item) => `<li style="margin: 0 0 6px;"><strong>${escapeHtml(item.date)}</strong>: ${escapeHtml(item.labels)}</li>`).join("")}
        </ul>
      </div>
      `
        : ""}
      <p style="margin: 0 0 18px;">
        Open <strong>Expenses</strong> to review your drafts and confirm them.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="https://ground.finance/app/expenses" style="display: inline-block; background: #22c55e; color: white; text-decoration: none; padding: 10px 16px; border-radius: 999px; font-weight: 700;">Open Expenses</a>
      </p>
    </div>
  `.trim();
    return { subject, text, html };
}
function buildExpenseReminderSms(input, language) {
    const resolved = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    const triggeredDueLabel = formatDate(input.triggeredDueDate, resolved);
    const outstandingDueLabel = formatDate(input.earliestOutstandingDueDate, resolved);
    const triggeredSummary = summarizeLabels(input.triggeredLabels, resolved, 3);
    const earliestOutstandingSummary = summarizeLabels(input.earliestOutstandingLabels, resolved, 3);
    const earlierPending = earlierPendingSchedule(input);
    const hasEarlierPending = earlierPending.length > 0 && !sameUtcDay(input.triggeredDueDate, input.earliestOutstandingDueDate);
    const earlierPendingDates = summarizeDueDates(earlierPending, resolved, 2);
    if (resolved === "es") {
        if (input.count === 1) {
            if (hasEarlierPending) {
                return triggeredSummary
                    ? `Ground: tenés 1 pago recurrente para revisar. Este recordatorio es por ${triggeredDueLabel}: ${triggeredSummary}. Tenés pendientes anteriores del ${earlierPendingDates}. Abrí Gastos: https://ground.finance/app/expenses`
                    : `Ground: tenés 1 pago recurrente para revisar. Este recordatorio es por ${triggeredDueLabel}. Tenés pendientes anteriores del ${earlierPendingDates}. Abrí Gastos: https://ground.finance/app/expenses`;
            }
            return earliestOutstandingSummary
                ? `Ground: tenés 1 pago recurrente para revisar. Próximo vencimiento ${outstandingDueLabel}: ${earliestOutstandingSummary}. Abrí Gastos: https://ground.finance/app/expenses`
                : `Ground: tenés 1 pago recurrente para revisar. Vence ${outstandingDueLabel}. Abrí Gastos: https://ground.finance/app/expenses`;
        }
        if (hasEarlierPending) {
            return triggeredSummary
                ? `Ground: tenés ${input.count} pagos recurrentes para revisar. Este recordatorio es por ${triggeredDueLabel}: ${triggeredSummary}. Tenés pendientes anteriores del ${earlierPendingDates}. Abrí Gastos: https://ground.finance/app/expenses`
                : `Ground: tenés ${input.count} pagos recurrentes para revisar. Este recordatorio es por ${triggeredDueLabel}. Tenés pendientes anteriores del ${earlierPendingDates}. Abrí Gastos: https://ground.finance/app/expenses`;
        }
        return earliestOutstandingSummary
            ? `Ground: tenés ${input.count} pagos recurrentes para revisar. Próximo vencimiento ${outstandingDueLabel}: ${earliestOutstandingSummary}. Abrí Gastos: https://ground.finance/app/expenses`
            : `Ground: tenés ${input.count} pagos recurrentes para revisar. Próximo vencimiento ${outstandingDueLabel}. Abrí Gastos: https://ground.finance/app/expenses`;
    }
    if (input.count === 1) {
        if (hasEarlierPending) {
            return triggeredSummary
                ? `Ground: you have 1 recurring payment to review. This reminder is for ${triggeredDueLabel}: ${triggeredSummary}. You still have earlier pending due dates from ${earlierPendingDates}. Open Expenses: https://ground.finance/app/expenses`
                : `Ground: you have 1 recurring payment to review. This reminder is for ${triggeredDueLabel}. You still have earlier pending due dates from ${earlierPendingDates}. Open Expenses: https://ground.finance/app/expenses`;
        }
        return earliestOutstandingSummary
            ? `Ground: you have 1 recurring payment to review. Next due ${outstandingDueLabel}: ${earliestOutstandingSummary}. Open Expenses: https://ground.finance/app/expenses`
            : `Ground: you have 1 recurring payment to review. Due ${outstandingDueLabel}. Open Expenses: https://ground.finance/app/expenses`;
    }
    if (hasEarlierPending) {
        return triggeredSummary
            ? `Ground: you have ${input.count} recurring payments to review. This reminder is for ${triggeredDueLabel}: ${triggeredSummary}. You still have earlier pending due dates from ${earlierPendingDates}. Open Expenses: https://ground.finance/app/expenses`
            : `Ground: you have ${input.count} recurring payments to review. This reminder is for ${triggeredDueLabel}. You still have earlier pending due dates from ${earlierPendingDates}. Open Expenses: https://ground.finance/app/expenses`;
    }
    return earliestOutstandingSummary
        ? `Ground: you have ${input.count} recurring payments to review. Next due ${outstandingDueLabel}: ${earliestOutstandingSummary}. Open Expenses: https://ground.finance/app/expenses`
        : `Ground: you have ${input.count} recurring payments to review. Next due ${outstandingDueLabel}. Open Expenses: https://ground.finance/app/expenses`;
}
