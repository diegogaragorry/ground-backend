"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSignupCodeEmail = sendSignupCodeEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;
const transporter = nodemailer_1.default.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
});
async function sendSignupCodeEmail(to, code) {
    const recipient = String(to || "").trim();
    if (!recipient) {
        throw new Error("Missing recipient email (to)");
    }
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
    await transporter.sendMail({ from: EMAIL_FROM, to: recipient, subject, text, html });
}
