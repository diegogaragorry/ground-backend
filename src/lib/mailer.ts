import nodemailer from "nodemailer";
import { buildPasswordResetCodeEmail, buildSignupCodeEmail } from "./authMessages";
import { buildSpecialGuestCampaignEmail } from "./campaignMessages";
import type { PreferredLanguage } from "./preferredLanguage";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_CONNECTION_TIMEOUT_MS = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 8000);
const SMTP_GREETING_TIMEOUT_MS = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 8000);
const SMTP_SOCKET_TIMEOUT_MS = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 12000);

const smtpConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_FROM);
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // Keep SMTP failures short so fallback provider (Resend) can run quickly.
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    })
  : null;

function isNetworkError(msg: string): boolean {
  return (
    /timeout|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|Connection timeout/i.test(msg) || msg.includes("ECONNREFUSED")
  );
}

function sendViaResend(recipient: string, subject: string, html: string, text: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  // Dominio verificado ground.finance por defecto; si EMAIL_FROM es Gmail/Yahoo usar dominio de prueba
  const fromResend =
    EMAIL_FROM && !EMAIL_FROM.includes("gmail.com") && !EMAIL_FROM.includes("yahoo.")
      ? EMAIL_FROM
      : "Ground <no-reply@ground.finance>";
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: fromResend,
      to: [recipient],
      subject,
      html,
      text,
    }),
  }).then(async (res) => {
    const data = (await res.json()) as { message?: string };
    if (!res.ok) throw new Error(data.message || `Resend API ${res.status}`);
  });
}

async function sendEmailTemplate(recipient: string, subject: string, html: string, text: string) {
  if (transporter) {
    try {
      await transporter.sendMail({ from: EMAIL_FROM, to: recipient, subject, text, html });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isNetworkError(msg) && RESEND_API_KEY) {
        await sendViaResend(recipient, subject, html, text);
        return;
      }
      throw err;
    }
  }

  if (RESEND_API_KEY) {
    await sendViaResend(recipient, subject, html, text);
    return;
  }

  throw new Error(
    "No email config. Set SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM (Gmail) or RESEND_API_KEY (Resend)."
  );
}

/**
 * Envía el código de verificación por email.
 * Prioridad: 1) Gmail/SMTP si está configurado (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM).
 *            2) Si SMTP falla por red (ej. Railway bloquea puerto 587), usa Resend si RESEND_API_KEY está definida.
 *            3) Solo Resend si no hay SMTP.
 */
export async function sendSignupCodeEmail(to: string, code: string, language?: PreferredLanguage | string | null) {
  const recipient = String(to || "").trim();
  if (!recipient) throw new Error("Missing recipient email (to)");

  const { subject, text, html } = buildSignupCodeEmail(code, language);
  await sendEmailTemplate(recipient, subject, html, text);
}

/**
 * Envía el código para resetear contraseña (misma infra que signup).
 */
export async function sendPasswordResetCodeEmail(to: string, code: string, language?: PreferredLanguage | string | null) {
  const recipient = String(to || "").trim();
  if (!recipient) throw new Error("Missing recipient email (to)");

  const { subject, text, html } = buildPasswordResetCodeEmail(code, language);
  await sendEmailTemplate(recipient, subject, html, text);
}

export async function sendSpecialGuestCampaignEmail(
  to: string,
  language?: PreferredLanguage | string | null
) {
  const recipient = String(to || "").trim();
  if (!recipient) throw new Error("Missing recipient email (to)");

  const { subject, text, html } = buildSpecialGuestCampaignEmail(language);
  await sendEmailTemplate(recipient, subject, html, text);
}
