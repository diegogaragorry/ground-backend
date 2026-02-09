"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSignupCodeEmail = sendSignupCodeEmail;
exports.sendPasswordResetCodeEmail = sendPasswordResetCodeEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "";
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const smtpConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_FROM);
const transporter = smtpConfigured
    ? nodemailer_1.default.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
    : null;
function isNetworkError(msg) {
    return (/timeout|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|Connection timeout/i.test(msg) || msg.includes("ECONNREFUSED"));
}
function sendViaResend(recipient, subject, html, text) {
    if (!RESEND_API_KEY)
        throw new Error("RESEND_API_KEY not set");
    // Dominio verificado ground.finance por defecto; si EMAIL_FROM es Gmail/Yahoo usar dominio de prueba
    const fromResend = EMAIL_FROM && !EMAIL_FROM.includes("gmail.com") && !EMAIL_FROM.includes("yahoo.")
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
        const data = (await res.json());
        if (!res.ok)
            throw new Error(data.message || `Resend API ${res.status}`);
    });
}
/**
 * Envía el código de verificación por email.
 * Prioridad: 1) Gmail/SMTP si está configurado (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM).
 *            2) Si SMTP falla por red (ej. Railway bloquea puerto 587), usa Resend si RESEND_API_KEY está definida.
 *            3) Solo Resend si no hay SMTP.
 */
async function sendSignupCodeEmail(to, code) {
    const recipient = String(to || "").trim();
    if (!recipient)
        throw new Error("Missing recipient email (to)");
    const subject = "Your Ground verification code";
    const text = `Your Ground verification code is: ${code}\n\nIt expires in 20 minutes.`;
    const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.4">
      <h2 style="margin:0 0 12px">Verify your email</h2>
      <p style="margin:0 0 10px">Your Ground verification code is:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:10px 0 18px">${code}</div>
      <p style="margin:0;color:#555">This code expires in 20 minutes.</p>
    </div>
  `;
    if (transporter) {
        try {
            await transporter.sendMail({ from: EMAIL_FROM, to: recipient, subject, text, html });
            return;
        }
        catch (err) {
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
    throw new Error("No email config. Set SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM (Gmail) or RESEND_API_KEY (Resend).");
}
/**
 * Envía el código para resetear contraseña (misma infra que signup).
 */
async function sendPasswordResetCodeEmail(to, code) {
    const recipient = String(to || "").trim();
    if (!recipient)
        throw new Error("Missing recipient email (to)");
    const subject = "Reset your Ground password";
    const text = `Your password reset code is: ${code}\n\nIt expires in 20 minutes.`;
    const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.4">
      <h2 style="margin:0 0 12px">Reset your password</h2>
      <p style="margin:0 0 10px">Your password reset code is:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:10px 0 18px">${code}</div>
      <p style="margin:0;color:#555">This code expires in 20 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `;
    if (transporter) {
        try {
            await transporter.sendMail({ from: EMAIL_FROM, to: recipient, subject, text, html });
            return;
        }
        catch (err) {
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
    throw new Error("No email config. Set SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM (Gmail) or RESEND_API_KEY (Resend).");
}
