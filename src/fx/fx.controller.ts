import { Response } from "express";
import type { AuthRequest } from "../middlewares/requireAuth";

const OPEN_API_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cache: { usdUyuRate: number; fetchedAt: number } | null = null;

function getFallbackRate(): number {
  const v = Number(process.env.DEFAULT_USD_UYU_RATE ?? 38);
  return Number.isFinite(v) && v > 0 ? v : 38;
}

export const getUsdUyuRate = async (req: AuthRequest, res: Response) => {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ usdUyuRate: cache.usdUyuRate });
  }

  try {
    const response = await fetch(OPEN_API_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ExchangeRate API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };

    if (data.result !== "success" || !data.rates || typeof data.rates.UYU !== "number") {
      throw new Error("Invalid response from ExchangeRate API");
    }

    const rate = Number(data.rates.UYU);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Invalid UYU rate");
    }

    cache = { usdUyuRate: rate, fetchedAt: now };
    res.json({ usdUyuRate: rate });
  } catch (err) {
    const fallback = getFallbackRate();
    if (!cache) {
      cache = { usdUyuRate: fallback, fetchedAt: now };
    }
    res.json({ usdUyuRate: cache.usdUyuRate });
  }
};
