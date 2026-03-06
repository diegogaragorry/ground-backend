"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignupCodeEmail = buildSignupCodeEmail;
exports.buildPasswordResetCodeEmail = buildPasswordResetCodeEmail;
exports.buildVerificationSms = buildVerificationSms;
exports.buildRecoverySms = buildRecoverySms;
const preferredLanguage_1 = require("./preferredLanguage");
function wrapHtml(title, intro, code, footer) {
    return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.4">
      <h2 style="margin:0 0 12px">${title}</h2>
      <p style="margin:0 0 10px">${intro}</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:10px 0 18px">${code}</div>
      <p style="margin:0;color:#555">${footer}</p>
    </div>
  `;
}
function buildSignupCodeEmail(code, language) {
    const locale = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    if (locale === "es") {
        return {
            subject: "Tu codigo de verificacion de Ground",
            text: `Tu codigo de verificacion de Ground es: ${code}\n\nVence en 20 minutos.`,
            html: wrapHtml("Verifica tu email", "Tu codigo de verificacion de Ground es:", code, "Este codigo vence en 20 minutos."),
        };
    }
    return {
        subject: "Your Ground verification code",
        text: `Your Ground verification code is: ${code}\n\nIt expires in 20 minutes.`,
        html: wrapHtml("Verify your email", "Your Ground verification code is:", code, "This code expires in 20 minutes."),
    };
}
function buildPasswordResetCodeEmail(code, language) {
    const locale = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    if (locale === "es") {
        return {
            subject: "Restablece tu clave de Ground",
            text: `Tu codigo para restablecer la clave de Ground es: ${code}\n\nVence en 20 minutos. Si no lo pediste, puedes ignorar este email.`,
            html: wrapHtml("Restablece tu clave", "Tu codigo para restablecer la clave de Ground es:", code, "Este codigo vence en 20 minutos. Si no lo pediste, puedes ignorar este email."),
        };
    }
    return {
        subject: "Reset your Ground password",
        text: `Your password reset code is: ${code}\n\nIt expires in 20 minutes. If you didn't request this, you can ignore this email.`,
        html: wrapHtml("Reset your password", "Your password reset code is:", code, "This code expires in 20 minutes. If you didn't request this, you can ignore this email."),
    };
}
function buildVerificationSms(code, minutes, language) {
    const locale = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    if (locale === "es") {
        return `Tu codigo de verificacion de Ground es: ${code}. Vence en ${minutes} minutos.`;
    }
    return `Your Ground verification code is: ${code}. It expires in ${minutes} minutes.`;
}
function buildRecoverySms(code, minutes, language) {
    const locale = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    if (locale === "es") {
        return `Tu codigo de recuperacion de Ground es: ${code}. Vence en ${minutes} minutos.`;
    }
    return `Your Ground recovery code is: ${code}. It expires in ${minutes} minutes.`;
}
