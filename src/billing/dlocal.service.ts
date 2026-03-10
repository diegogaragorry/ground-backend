import crypto from "crypto";

type CreateRedirectPaymentInput = {
  amount: number;
  currency: "USD";
  country: string;
  orderId: string;
  description: string;
  callbackUrl: string;
  notificationUrl: string;
  payer: {
    name: string;
    email: string;
    userReference: string;
  };
};

type DLocalPaymentResponse = {
  id?: string;
  payment_id?: string;
  status?: string;
  redirect_url?: string;
  order_id?: string;
  payment?: Record<string, unknown>;
  [key: string]: unknown;
};

function normalizeBaseUrl(raw: string, fallback: string) {
  const value = String(raw || "").trim();
  return value ? value.replace(/\/+$/, "") : fallback;
}

export function getDLocalConfig() {
  const xLogin = String(process.env.DLOCAL_X_LOGIN ?? "").trim();
  const xTransKey = String(process.env.DLOCAL_X_TRANS_KEY ?? "").trim();
  const secretKey = String(process.env.DLOCAL_SECRET_KEY ?? "").trim();
  const xVersion = String(process.env.DLOCAL_X_VERSION ?? "").trim() || "2.1";
  const userAgent = String(process.env.DLOCAL_USER_AGENT ?? "").trim() || "Ground/1.0";
  const apiBaseUrl = normalizeBaseUrl(
    process.env.DLOCAL_API_BASE_URL ?? "",
    process.env.NODE_ENV === "production" ? "https://api.dlocal.com" : "https://sandbox.dlocal.com"
  );
  const frontendBaseUrl = normalizeBaseUrl(
    process.env.FRONTEND_PUBLIC_URL ?? "",
    process.env.NODE_ENV === "production" ? "https://ground.finance" : "http://localhost:5173"
  );
  const backendBaseUrl = normalizeBaseUrl(
    process.env.BACKEND_PUBLIC_URL ?? "",
    process.env.NODE_ENV === "production" ? "https://ground-backend-production.up.railway.app" : "http://localhost:3000"
  );
  return {
    xLogin,
    xTransKey,
    secretKey,
    xVersion,
    userAgent,
    apiBaseUrl,
    frontendBaseUrl,
    backendBaseUrl,
    ready: !!(xLogin && xTransKey && secretKey),
  };
}

function extractSignature(headerValue: string | null | undefined) {
  const raw = String(headerValue ?? "");
  const match = raw.match(/Signature:\s*([A-Fa-f0-9]+)/);
  return match?.[1] ?? "";
}

function createRequestSignature(xLogin: string, xDate: string, bodyText: string, secretKey: string) {
  return crypto.createHmac("sha256", secretKey).update(`${xLogin}${xDate}${bodyText}`).digest("hex");
}

function currentXDate() {
  return new Date().toISOString();
}

function maybeObject(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readStringField(payload: unknown, paths: string[][]) {
  for (const path of paths) {
    let cursor: unknown = payload;
    for (const segment of path) {
      const current = maybeObject(cursor);
      cursor = current?.[segment];
    }
    const value = String(cursor ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function unwrapPaymentPayload(payload: unknown) {
  const root = maybeObject(payload);
  const nested = maybeObject(root?.payment);
  return nested ?? root ?? {};
}

function ensureReadyConfig() {
  const config = getDLocalConfig();
  if (!config.ready) {
    throw new Error("dLocal is not configured");
  }
  return config;
}

async function parseDLocalResponse(res: Response) {
  const text = await res.text();
  let json: DLocalPaymentResponse | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const errorText =
      (json && (String(json.message ?? json.error ?? json.detail ?? ""))) ||
      text ||
      `${res.status} ${res.statusText}`;
    throw new Error(errorText);
  }
  return json ?? {};
}

export async function createRedirectPayment(input: CreateRedirectPaymentInput) {
  const config = ensureReadyConfig();
  const payload = {
    amount: input.amount,
    currency: input.currency,
    country: input.country,
    payment_method_id: "CARD",
    payment_method_flow: "REDIRECT",
    payer: {
      name: input.payer.name,
      email: input.payer.email,
      user_reference: input.payer.userReference,
    },
    order_id: input.orderId,
    description: input.description,
    callback_url: input.callbackUrl,
    notification_url: input.notificationUrl,
  };
  const bodyText = JSON.stringify(payload);
  const xDate = currentXDate();
  const signature = createRequestSignature(config.xLogin, xDate, bodyText, config.secretKey);

  const res = await fetch(`${config.apiBaseUrl}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Date": xDate,
      "X-Login": config.xLogin,
      "X-Trans-Key": config.xTransKey,
      "X-Version": config.xVersion,
      "User-Agent": config.userAgent,
      Authorization: `V2-HMAC-SHA256, Signature: ${signature}`,
    },
    body: bodyText,
  });

  return parseDLocalResponse(res);
}

export function extractPaymentId(payload: unknown) {
  return readStringField(payload, [
    ["id"],
    ["payment_id"],
    ["paymentId"],
    ["payment", "id"],
    ["payment", "payment_id"],
    ["payment", "paymentId"],
  ]);
}

export function extractPaymentStatus(payload: unknown) {
  return readStringField(payload, [
    ["status"],
    ["payment_status"],
    ["payment", "status"],
    ["payment", "payment_status"],
  ]).toUpperCase();
}

export function extractRedirectUrl(payload: unknown) {
  return readStringField(payload, [["redirect_url"], ["payment", "redirect_url"]]);
}

export function extractOrderId(payload: unknown) {
  return readStringField(payload, [["order_id"], ["payment", "order_id"]]);
}

export function extractProviderCardId(payload: unknown) {
  return readStringField(payload, [["card_id"], ["card", "card_id"], ["payment", "card_id"], ["payment", "card", "card_id"]]);
}

export function extractProviderPaymentMethodId(payload: unknown) {
  return readStringField(payload, [
    ["payment_method_id"],
    ["payment_method", "id"],
    ["payment", "payment_method_id"],
    ["payment", "payment_method", "id"],
  ]);
}

export function extractProviderCustomerId(payload: unknown) {
  return readStringField(payload, [
    ["payer", "id"],
    ["payment", "payer", "id"],
  ]);
}

export async function getPaymentStatus(paymentId: string) {
  const config = ensureReadyConfig();
  const bodyText = "";
  const xDate = currentXDate();
  const signature = createRequestSignature(config.xLogin, xDate, bodyText, config.secretKey);

  const res = await fetch(`${config.apiBaseUrl}/payments/${encodeURIComponent(paymentId)}/status`, {
    method: "GET",
    headers: {
      "X-Date": xDate,
      "X-Login": config.xLogin,
      "X-Trans-Key": config.xTransKey,
      "X-Version": config.xVersion,
      "User-Agent": config.userAgent,
      Authorization: `V2-HMAC-SHA256, Signature: ${signature}`,
    },
  });

  return parseDLocalResponse(res);
}

export function verifyNotificationSignature(rawBody: string, authorizationHeader: string | undefined, xDate: string | undefined) {
  const config = getDLocalConfig();
  if (!config.ready) return false;
  const provided = extractSignature(authorizationHeader);
  if (!provided || !xDate) return false;
  const expected = createRequestSignature(config.xLogin, xDate, rawBody, config.secretKey);
  const a = Buffer.from(provided.toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyCallbackSignature(paymentId: string, status: string, date: string, signature: string) {
  const config = getDLocalConfig();
  if (!config.ready) return false;
  if (!paymentId || !status || !date || !signature) return false;
  const bodyText = `{status:${status},paymentId:${paymentId}}`;
  const expected = createRequestSignature(config.xLogin, date, bodyText, config.secretKey);
  const a = Buffer.from(signature.toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
