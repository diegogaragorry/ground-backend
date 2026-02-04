import nodemailer from "nodemailer";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Ground <onboarding@resend.dev>";

// SMTP (solo si no usamos Resend)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const transporter =
  SMTP_HOST && SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

/**
 * Envía el código de verificación por email.
 * Si RESEND_API_KEY está definida, usa Resend (API HTTP, funciona en Railway).
 * Si no, usa SMTP (puede fallar por bloqueo de puertos en cloud).
 */
export async function sendSignupCodeEmail(to: string, code: string) {
  const recipient = String(to || "").trim();
  if (!recipient) throw new Error("Missing recipient email (to)");

  const subject = "Your Ground verification code";
  const text = `Your Ground verification code is: ${code}\n\nIt expires in 10 minutes.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.4">
      <h2 style="margin:0 0 12px">Verify your email</h2>
      <p style="margin:0 0 10px">Your Ground verification code is:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:10px 0 18px">${code}</div>
      <p style="margin:0;color:#555">This code expires in 10 minutes.</p>
    </div>
  `;

  if (RESEND_API_KEY) {
    // Resend solo permite "from" verificado: usar dominio de prueba o dominio propio verificado en resend.com/domains
    const fromResend = EMAIL_FROM.includes("resend.dev") ? EMAIL_FROM : "Ground <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
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
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (!res.ok) {
      throw new Error(data.message || `Resend API ${res.status}`);
    }
    return;
  }

  if (transporter) {
    await transporter.sendMail({ from: EMAIL_FROM, to: recipient, subject, text, html });
    return;
  }

  throw new Error(
    "No email config. Set RESEND_API_KEY (recommended on Railway) or SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM."
  );
}