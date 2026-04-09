import type { Response } from "express";
import { prisma } from "../lib/prisma";
import { buildSpecialGuestCampaignEmail } from "../lib/campaignMessages";
import { sendSpecialGuestCampaignEmail } from "../lib/mailer";
import { resolvePreferredLanguage } from "../lib/preferredLanguage";
import type { AuthRequest } from "../middlewares/requireAuth";

type AudienceType = "user" | "group";
type GroupId = "special_guest";

function normalizeAudienceType(value: unknown): AudienceType | null {
  return value === "user" || value === "group" ? value : null;
}

function normalizeGroupId(value: unknown): GroupId | null {
  return value === "special_guest" ? value : null;
}

function normalizeEmail(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase();
}

async function sendWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<{ email: string; language: "es" | "en" }>
) {
  const sentLanguages = { es: 0, en: 0 };
  const failures: Array<{ email: string; error: string }> = [];
  let sentCount = 0;

  for (let i = 0; i < items.length; i += 10) {
    const chunk = items.slice(i, i + 10);
    const results = await Promise.allSettled(chunk.map((item) => worker(item)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        sentCount += 1;
        sentLanguages[result.value.language] += 1;
      } else {
        const reason = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        failures.push({
          email: "unknown",
          error: reason.message || "Unknown error",
        });
      }
    }
  }

  return { sentCount, failedCount: failures.length, failures, sentLanguages };
}

type CampaignRecipient = {
  id: string;
  email: string;
  preferredLanguage: string | null;
};

async function sendRecipients(recipients: CampaignRecipient[]) {
  const deduped = Array.from(
    new Map(
      recipients
        .map((row) => ({ ...row, email: normalizeEmail(row.email) }))
        .filter((row) => row.email)
        .map((row) => [row.email, row])
    ).values()
  );

  const sentLanguages = { es: 0, en: 0 };
  const failures: Array<{ email: string; error: string }> = [];
  let sentCount = 0;

  for (let i = 0; i < deduped.length; i += 10) {
    const chunk = deduped.slice(i, i + 10);
    const results = await Promise.allSettled(
      chunk.map(async (row) => {
        const language = resolvePreferredLanguage(row.preferredLanguage);
        await sendSpecialGuestCampaignEmail(row.email, language);
        return { email: row.email, language };
      })
    );

    results.forEach((result, index) => {
      const email = chunk[index]?.email ?? "unknown";
      if (result.status === "fulfilled") {
        sentCount += 1;
        sentLanguages[result.value.language] += 1;
      } else {
        const reason = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        failures.push({ email, error: reason.message || "Unknown error" });
      }
    });
  }

  return {
    requestedCount: deduped.length,
    sentCount,
    failedCount: failures.length,
    failures,
    sentLanguages,
  };
}

// GET /admin/campaigns/special-guest/preview?language=es|en
export async function previewSpecialGuestCampaign(req: AuthRequest, res: Response) {
  const language = resolvePreferredLanguage(req.query.language);
  const template = buildSpecialGuestCampaignEmail(language);
  res.json({
    campaignId: "special_guest_extension",
    language,
    ...template,
  });
}

// POST /admin/campaigns/special-guest/send
export async function sendSpecialGuestCampaign(req: AuthRequest, res: Response) {
  const audienceType = normalizeAudienceType(req.body?.audienceType);
  if (!audienceType) return res.status(400).json({ error: "Invalid audienceType" });

  let recipients: CampaignRecipient[] = [];
  let audienceLabel = "";

  if (audienceType === "user") {
    const userId = String(req.body?.userId ?? "").trim();
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, preferredLanguage: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    recipients = [user];
    audienceLabel = user.email;
  } else {
    const groupId = normalizeGroupId(req.body?.groupId);
    if (!groupId) return res.status(400).json({ error: "Invalid groupId" });

    if (groupId === "special_guest") {
      recipients = await prisma.user.findMany({
        where: {
          role: "USER",
          specialGuest: true,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, preferredLanguage: true },
      });
      audienceLabel = "special_guest";
    }
  }

  if (recipients.length === 0) {
    return res.status(400).json({ error: "No recipients found" });
  }

  const result = await sendRecipients(recipients);
  return res.json({
    campaignId: "special_guest_extension",
    audienceType,
    audienceLabel,
    ...result,
  });
}
