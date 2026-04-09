"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSpecialGuestCampaignEmail = buildSpecialGuestCampaignEmail;
const preferredLanguage_1 = require("./preferredLanguage");
function getAccountUrl() {
    const base = String(process.env.FRONTEND_PUBLIC_URL || "").trim() ||
        (process.env.NODE_ENV === "production" ? "https://ground.finance" : "http://localhost:5173");
    return `${base.replace(/\/+$/, "")}/app/account`;
}
function wrapCampaignHtml(params) {
    const { eyebrow, title, intro, bodyLead, highlightsTitle, highlights, recoveryTitle, recoveryBody, ctaLabel, ctaUrl, footer, } = params;
    const highlightItems = highlights
        .map((item) => `<li style="margin:0 0 8px;color:#1c2740;font-size:15px;line-height:1.5">${item}</li>`)
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
            <div style="margin:0 0 12px;font-size:15px;font-weight:800;color:#166534">${highlightsTitle}</div>
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
function buildSpecialGuestCampaignEmail(language) {
    const locale = (0, preferredLanguage_1.resolvePreferredLanguage)(language);
    const accountUrl = getAccountUrl();
    if (locale === "es") {
        return {
            subject: "Extendimos tu Early Stage a 4 meses!",
            text: [
                "Hola,",
                "",
                "Gracias!",
                "",
                "Venís acompañando Ground desde una etapa muy temprana, y todo el feedback que nos compartís nos está ayudando muchísimo a mejorar el producto más rápido y con mejor foco.",
                "",
                "Como entraste a Early Stage antes del 10 de abril de 2026, te catalogamos como Special Guest. Por eso extendimos tu período gratis a 4 meses.",
                "",
                "Además, en estas últimas semanas sumamos mejoras importantes:",
                "- Cifrado de extremo a extremo (E2EE): lo que guardás queda cifrado de forma que solo vos podés descifrarlo. Ni nosotros ni alguien con acceso a la base puede leer tu información.",
                "- Resumen YTD en Presupuesto: ahora podés ver el acumulado del año hasta la fecha sin tener que reconstruirlo mes a mes.",
                "- Onboarding mejorado: el alta inicial es más clara, más rápida y con menos fricción.",
                "- Flujo de patrimonio más simple: actualizar cuentas, fondos y movimientos es más directo y consistente.",
                "",
                "También te pedimos que entres en Cuenta y actualices Ubicación y Teléfono. Si alguna vez perdés tu clave, estos datos son claves para recuperar el acceso. Con E2EE, si no tenés recovery bien configurado, podrías no poder recuperar tu información histórica.",
                "",
                `Revisar mi cuenta: ${accountUrl}`,
                "",
                "Gracias por ayudarnos a construir Ground desde tan temprano.",
            ].join("\n"),
            html: wrapCampaignHtml({
                eyebrow: "Special Guest",
                title: "Extendimos tu Early Stage a 4 meses!",
                intro: "Gracias. Venís acompañando Ground desde una etapa muy temprana, y todo el feedback que nos compartís nos está ayudando muchísimo a mejorar el producto más rápido y con mejor foco.",
                bodyLead: "Como entraste a Early Stage antes del 10 de abril de 2026, te catalogamos como Special Guest. Por eso extendimos tu período gratis a 4 meses y queríamos contártelo con un enorme gracias de por medio.",
                highlightsTitle: "Esto es parte de lo último que sumamos en Ground",
                highlights: [
                    "Cifrado de extremo a extremo (E2EE): lo que guardás queda cifrado de forma que solo vos podés descifrarlo. Ni nosotros ni alguien con acceso a la base puede leer tu información.",
                    "Resumen YTD en Presupuesto: ahora podés ver el acumulado del año hasta la fecha sin tener que reconstruirlo mes a mes.",
                    "Onboarding mejorado para una primera experiencia más clara, más ágil y con menos fricción.",
                    "Flujo de patrimonio más simple para actualizar cuentas, fondos y movimientos de forma más directa y consistente.",
                ],
                recoveryTitle: "Ayúdanos a proteger tu historial",
                recoveryBody: "Entrá en Cuenta y actualizá Ubicación y Teléfono. Si algún día perdés tu clave, estos datos son claves para recuperar el acceso. Con E2EE, si no tenés recovery bien configurado, podrías no poder recuperar tu información histórica.",
                ctaLabel: "Revisar mi cuenta",
                ctaUrl: accountUrl,
                footer: "Gracias por ayudarnos a construir Ground desde tan temprano.",
            }),
        };
    }
    return {
        subject: "Your Early Stage access is now 4 months!",
        text: [
            "Hi,",
            "",
            "Thank you!",
            "",
            "You have been with Ground from a very early stage, and the feedback you keep sharing with us is helping us improve the product much faster and with better focus.",
            "",
            "Because you joined Early Stage before April 10, 2026, we marked your account as Special Guest. That is why we extended your free period to 4 months.",
            "",
            "Over the last few weeks we also shipped important improvements:",
            "- End-to-end encryption (E2EE): the data you store is encrypted in a way that only you can decrypt. Not even we, or someone with database access, can read your information.",
            "- A YTD summary in Budget: you can now see the year-to-date view without rebuilding it month by month.",
            "- Improved onboarding: the initial setup is clearer, faster, and has less friction.",
            "- A simpler net worth flow: updating accounts, funds, and movements is now more direct and consistent.",
            "",
            "We also ask you to go to Account and update your Location and Phone. If you ever lose your password, this information is important to recover access. With E2EE, if recovery is not fully configured, you may not be able to recover your historical information.",
            "",
            `Review my account: ${accountUrl}`,
            "",
            "Thank you for helping us build Ground.",
        ].join("\n"),
        html: wrapCampaignHtml({
            eyebrow: "Special Guest",
            title: "Your Early Stage access is now 4 months!",
            intro: "Thank you! You have been with Ground from a very early stage, and the feedback you keep sharing with us is helping us improve the product much faster and with better focus.",
            bodyLead: "Because you joined Early Stage before April 10, 2026, we marked your account as Special Guest. That is why we extended your free period to 4 months, and we wanted to share that with a big thank you.",
            highlightsTitle: "Here is some of what we shipped recently",
            highlights: [
                "End-to-end encryption (E2EE): the data you store is encrypted in a way that only you can decrypt. Not even we, or someone with database access, can read your information.",
                "A YTD summary in Budget so you can see the year-to-date view without rebuilding it month by month.",
                "Improved onboarding for a clearer, faster first experience with less friction.",
                "A simpler net worth flow to update accounts, funds, and movements more directly and consistently.",
            ],
            recoveryTitle: "Help us protect your history",
            recoveryBody: "Go to Account and update your Location and Phone. If you ever lose your password, this information is important to recover access. With E2EE, if recovery is not fully configured, you may not be able to recover your historical information.",
            ctaLabel: "Review my account",
            ctaUrl: accountUrl,
            footer: "Thank you for helping us build Ground from the start.",
        }),
    };
}
