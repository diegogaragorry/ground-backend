import { resolvePreferredLanguage, type PreferredLanguage } from "./preferredLanguage";

type ReminderSummaryInput = {
  count: number;
  earliestDueDate: Date | null;
};

function formatDate(date: Date | null, language: PreferredLanguage) {
  if (!date) return language === "es" ? "pronto" : "soon";
  return new Intl.DateTimeFormat(language === "es" ? "es-UY" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function buildExpenseReminderEmail(
  input: ReminderSummaryInput,
  language?: PreferredLanguage | string | null
) {
  const resolved = resolvePreferredLanguage(language);
  const dueLabel = formatDate(input.earliestDueDate, resolved);
  const isSingle = input.count === 1;

  if (resolved === "es") {
    const subject = isSingle ? "Recordatorio de pago en Ground" : "Recordatorios de pagos en Ground";
    const text = [
      isSingle
        ? `Tenés 1 pago recurrente para revisar en Ground.`
        : `Tenés ${input.count} pagos recurrentes para revisar en Ground.`,
      `El próximo vence el ${dueLabel}.`,
      "",
      "Abrí la sección Gastos para revisar los borradores y confirmarlos:",
      "https://ground.finance/app/expenses",
      "",
      "Por privacidad, el detalle sensible se mantiene cifrado dentro de la app.",
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Recordatorio de pagos en Ground</h2>
        <p style="margin: 0 0 10px;">
          ${isSingle ? "Tenés <strong>1 pago recurrente</strong>" : `Tenés <strong>${input.count} pagos recurrentes</strong>`}
          para revisar en Ground.
        </p>
        <p style="margin: 0 0 18px;">El próximo vence el <strong>${dueLabel}</strong>.</p>
        <p style="margin: 0 0 18px;">
          Abrí la sección <strong>Gastos</strong> para revisar los borradores y confirmarlos.
        </p>
        <p style="margin: 0 0 20px;">
          <a href="https://ground.finance/app/expenses" style="display: inline-block; background: #22c55e; color: white; text-decoration: none; padding: 10px 16px; border-radius: 999px; font-weight: 700;">Abrir Gastos</a>
        </p>
        <p style="margin: 0; color: rgba(15, 23, 42, 0.7); font-size: 14px;">
          Por privacidad, el detalle sensible se mantiene cifrado dentro de la app.
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
    `The next one is due on ${dueLabel}.`,
    "",
    "Open Expenses to review your drafts and confirm them:",
    "https://ground.finance/app/expenses",
    "",
    "For privacy, sensitive details stay encrypted inside the app.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Payment reminder in Ground</h2>
      <p style="margin: 0 0 10px;">
        ${isSingle ? "You have <strong>1 recurring payment</strong>" : `You have <strong>${input.count} recurring payments</strong>`}
        to review in Ground.
      </p>
      <p style="margin: 0 0 18px;">The next one is due on <strong>${dueLabel}</strong>.</p>
      <p style="margin: 0 0 18px;">
        Open <strong>Expenses</strong> to review your drafts and confirm them.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="https://ground.finance/app/expenses" style="display: inline-block; background: #22c55e; color: white; text-decoration: none; padding: 10px 16px; border-radius: 999px; font-weight: 700;">Open Expenses</a>
      </p>
      <p style="margin: 0; color: rgba(15, 23, 42, 0.7); font-size: 14px;">
        For privacy, sensitive details stay encrypted inside the app.
      </p>
    </div>
  `.trim();
  return { subject, text, html };
}

export function buildExpenseReminderSms(
  input: ReminderSummaryInput,
  language?: PreferredLanguage | string | null
) {
  const resolved = resolvePreferredLanguage(language);
  const dueLabel = formatDate(input.earliestDueDate, resolved);
  if (resolved === "es") {
    return input.count === 1
      ? `Ground: tenés 1 pago recurrente para revisar. Vence ${dueLabel}. Abrí Gastos: https://ground.finance/app/expenses`
      : `Ground: tenés ${input.count} pagos recurrentes para revisar. Próximo vencimiento ${dueLabel}. Abrí Gastos: https://ground.finance/app/expenses`;
  }
  return input.count === 1
    ? `Ground: you have 1 recurring payment to review. Due ${dueLabel}. Open Expenses: https://ground.finance/app/expenses`
    : `Ground: you have ${input.count} recurring payments to review. Next due ${dueLabel}. Open Expenses: https://ground.finance/app/expenses`;
}
