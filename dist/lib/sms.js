"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSms = sendSms;
/**
 * Send SMS (e.g. OTP). Uses Twilio if configured; otherwise logs the code (dev).
 */
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
async function sendSms(to, body) {
    const normalized = String(to || "").trim().replace(/\s/g, "");
    if (!normalized)
        throw new Error("Missing SMS recipient (phone)");
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE) {
        const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${auth}`,
            },
            body: new URLSearchParams({
                To: normalized.startsWith("+") ? normalized : `+${normalized}`,
                From: TWILIO_PHONE,
                Body: body,
            }).toString(),
        });
        if (!res.ok) {
            const err = (await res.json());
            throw new Error(err.message || `Twilio ${res.status}`);
        }
        return;
    }
    // Dev: log so tests/local can see the code
    console.log("[SMS dev] To:", normalized, "Body:", body);
}
