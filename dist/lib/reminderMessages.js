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
function buildExpenseReminderEmail(input, language) {
    const resolved = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    const dueLabel = formatDate(input.earliestDueDate, resolved);
    const isSingle = input.count === 1;
    const nextDueSummary = summarizeLabels(input.nextDueLabels, resolved, 3);
    const scheduleLines = input.monthlySchedule
        .filter((item) => item.labels.length > 0)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
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
            nextDueSummary ? `Próximo vencimiento ${dueLabel}: ${nextDueSummary}.` : `El próximo vence el ${dueLabel}.`,
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
          ${nextDueSummary
            ? `Próximo vencimiento <strong>${escapeHtml(dueLabel)}</strong>: <strong>${escapeHtml(nextDueSummary)}</strong>.`
            : `El próximo vence el <strong>${escapeHtml(dueLabel)}</strong>.`}
        </p>
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
        nextDueSummary ? `Next due ${dueLabel}: ${nextDueSummary}.` : `The next one is due on ${dueLabel}.`,
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
        ${nextDueSummary
        ? `Next due <strong>${escapeHtml(dueLabel)}</strong>: <strong>${escapeHtml(nextDueSummary)}</strong>.`
        : `The next one is due on <strong>${escapeHtml(dueLabel)}</strong>.`}
      </p>
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
    const dueLabel = formatDate(input.earliestDueDate, resolved);
    const nextDueSummary = summarizeLabels(input.nextDueLabels, resolved, 3);
    if (resolved === "es") {
        if (input.count === 1) {
            return nextDueSummary
                ? `Ground: tenés 1 pago recurrente para revisar. Próximo vencimiento ${dueLabel}: ${nextDueSummary}. Abrí Gastos: https://ground.finance/app/expenses`
                : `Ground: tenés 1 pago recurrente para revisar. Vence ${dueLabel}. Abrí Gastos: https://ground.finance/app/expenses`;
        }
        return nextDueSummary
            ? `Ground: tenés ${input.count} pagos recurrentes para revisar. Próximo vencimiento ${dueLabel}: ${nextDueSummary}. Abrí Gastos: https://ground.finance/app/expenses`
            : `Ground: tenés ${input.count} pagos recurrentes para revisar. Próximo vencimiento ${dueLabel}. Abrí Gastos: https://ground.finance/app/expenses`;
    }
    if (input.count === 1) {
        return nextDueSummary
            ? `Ground: you have 1 recurring payment to review. Next due ${dueLabel}: ${nextDueSummary}. Open Expenses: https://ground.finance/app/expenses`
            : `Ground: you have 1 recurring payment to review. Due ${dueLabel}. Open Expenses: https://ground.finance/app/expenses`;
    }
    return nextDueSummary
        ? `Ground: you have ${input.count} recurring payments to review. Next due ${dueLabel}: ${nextDueSummary}. Open Expenses: https://ground.finance/app/expenses`
        : `Ground: you have ${input.count} recurring payments to review. Next due ${dueLabel}. Open Expenses: https://ground.finance/app/expenses`;
}
