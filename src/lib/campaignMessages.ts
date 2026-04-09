import { resolvePreferredLanguage, type PreferredLanguage } from "./preferredLanguage";

export type EmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

function getAccountUrl(): string {
  const base =
    String(process.env.FRONTEND_PUBLIC_URL || "").trim() ||
    (process.env.NODE_ENV === "production" ? "https://ground.finance" : "http://localhost:5173");
  return `${base.replace(/\/+$/, "")}/app/account`;
}

function wrapCampaignHtml(params: {
  eyebrow: string;
  title: string;
  intro: string;
  bodyLead: string;
  highlights: string[];
  recoveryTitle: string;
  recoveryBody: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}) {
  const { eyebrow, title, intro, bodyLead, highlights, recoveryTitle, recoveryBody, ctaLabel, ctaUrl, footer } = params;

  const highlightItems = highlights
    .map(
      (item) =>
        `<li style="margin:0 0 8px;color:#1c2740;font-size:15px;line-height:1.5">${item}</li>`
    )
    .join("");

  return `
    <div style="margin:0;padding:32px 16px;background:#f4f7fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#13203b">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe5f0;border-radius:24px;overflow:hidden">
        <div style="padding:32px 32px 20px;background:linear-gradient(135deg,#13203b 0%,#2d4666 100%);color:#ffffff">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.78">${eyebrow}</div>
          <h1 style="margin:14px 0 12px;font-size:32px;line-height:1.15;font-weight:800">${title}</h1>
          <p style="margin:0;font-size:16px;line-height:1.6;color:rgba(255,255,255,.9)">${intro}</p>
        </div>
        <div style="padding:28px 32px 32px">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#33415c">${bodyLead}</p>
          <div style="margin:0 0 24px;padding:20px 22px;background:#f6fbf8;border:1px solid #d6f2df;border-radius:18px">
            <div style="margin:0 0 12px;font-size:15px;font-weight:800;color:#166534">Ground en las ultimas semanas</div>
            <ul style="margin:0;padding-left:18px">
              ${highlightItems}
            </ul>
          </div>
          <div style="margin:0 0 28px;padding:20px 22px;background:#f8fafc;border:1px solid #dbe5f0;border-radius:18px">
            <div style="margin:0 0 10px;font-size:15px;font-weight:800;color:#13203b">${recoveryTitle}</div>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#33415c">${recoveryBody}</p>
          </div>
          <div style="margin:0 0 28px">
            <a href="${ctaUrl}" style="display:inline-block;padding:14px 22px;background:#22c55e;color:#062615;text-decoration:none;font-size:15px;font-weight:800;border-radius:999px">
              ${ctaLabel}
            </a>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${footer}</p>
        </div>
      </div>
    </div>
  `;
}

export function buildSpecialGuestCampaignEmail(language?: PreferredLanguage | string | null): EmailTemplate {
  const locale = resolvePreferredLanguage(language);
  const accountUrl = getAccountUrl();

  if (locale === "es") {
    return {
      subject: "Extendimos tu Early Stage a 4 meses",
      text: [
        "Hola,",
        "",
        "Queremos agradecerte por el feedback que nos vienes compartiendo. Nos esta ayudando a mejorar Ground mucho mas rapido.",
        "",
        "Por eso extendimos tu acceso Early Stage a 4 meses sin costo.",
        "",
        "En estas ultimas semanas sumamos mejoras importantes:",
        "- Cifrado E2EE",
        "- Resumen YTD en Presupuesto",
        "- Onboarding mejorado",
        "- Flujo de gestion de patrimonio mas simple",
        "",
        "Tambien te pedimos que entres en Cuenta y actualices Ubicacion y Telefono. Si alguna vez pierdes tu clave, estos datos son clave para recuperar el acceso. Con E2EE, si no tienes recovery bien configurado, podrias no poder recuperar tu informacion historica.",
        "",
        `Revisar mi cuenta: ${accountUrl}`,
        "",
        "Gracias por ayudarnos a construir Ground.",
      ].join("\n"),
      html: wrapCampaignHtml({
        eyebrow: "Special Guest",
        title: "Extendimos tu Early Stage a 4 meses",
        intro:
          "Gracias por todo el feedback que nos vienes compartiendo. Nos esta ayudando a mejorar Ground mucho mas rapido.",
        bodyLead:
          "Queremos devolverte ese acompanamiento extendiendo tu acceso Early Stage a 4 meses sin costo e invitarte a ver lo ultimo que fuimos sumando en el producto.",
        highlights: [
          "Cifrado E2EE para proteger mejor tu informacion.",
          "Resumen YTD en Presupuesto para seguir el ano acumulado mas facil.",
          "Onboarding mejorado para una primera experiencia mas clara y rapida.",
          "Flujo de patrimonio simplificado para actualizar cuentas, fondos y movimientos con menos friccion.",
        ],
        recoveryTitle: "Ayudanos a proteger tu historial",
        recoveryBody:
          "Entra en Cuenta y actualiza Ubicacion y Telefono. Si algun dia pierdes tu clave, estos datos son clave para recuperar el acceso. Con E2EE, si no tienes recovery bien configurado, podrias no poder recuperar tu informacion historica.",
        ctaLabel: "Revisar mi cuenta",
        ctaUrl: accountUrl,
        footer: "Gracias por ayudarnos a construir Ground desde temprano.",
      }),
    };
  }

  return {
    subject: "We extended your Early Stage access to 4 months",
    text: [
      "Hi,",
      "",
      "Thank you for the feedback you keep sharing with us. It is helping us improve Ground much faster.",
      "",
      "Because of that, we extended your Early Stage access to 4 months at no cost.",
      "",
      "Over the last few weeks we shipped important improvements:",
      "- E2EE encryption",
      "- YTD summary in Budget",
      "- Improved onboarding",
      "- Simpler net worth management flow",
      "",
      "We also ask you to go to Account and update your Location and Phone. If you ever lose your password, this information is important to recover access. With E2EE, if recovery is not fully configured, you may not be able to recover your historical information.",
      "",
      `Review my account: ${accountUrl}`,
      "",
      "Thank you for helping us build Ground.",
    ].join("\n"),
    html: wrapCampaignHtml({
      eyebrow: "Special Guest",
      title: "We extended your Early Stage access to 4 months",
      intro:
        "Thank you for the feedback you keep sharing with us. It is helping us improve Ground much faster.",
      bodyLead:
        "We wanted to give something back by extending your Early Stage access to 4 months at no cost and inviting you to explore the latest product improvements.",
      highlights: [
        "E2EE encryption to better protect your information.",
        "A YTD summary in Budget to track the year more clearly.",
        "Improved onboarding for a faster and clearer first experience.",
        "A simpler net worth flow to update accounts, funds, and movements with less friction.",
      ],
      recoveryTitle: "Help us protect your history",
      recoveryBody:
        "Go to Account and update your Location and Phone. If you ever lose your password, this information is important to recover access. With E2EE, if recovery is not fully configured, you may not be able to recover your historical information.",
      ctaLabel: "Review my account",
      ctaUrl: accountUrl,
      footer: "Thank you for helping us build Ground from the start.",
    }),
  };
}
