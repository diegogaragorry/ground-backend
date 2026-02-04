"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toUsd = toUsd;
function toUsd(params) {
    const { amount, currencyId, usdUyuRate } = params;
    if (currencyId === "USD") {
        return { amountUsd: amount, usdUyuRate: null };
    }
    if (currencyId === "UYU") {
        if (typeof usdUyuRate !== "number" || !(usdUyuRate > 0)) {
            throw new Error("usdUyuRate is required and must be > 0 when currencyId is UYU (1 USD = X UYU)");
        }
        return { amountUsd: amount / usdUyuRate, usdUyuRate };
    }
    throw new Error("Unsupported currencyId");
}
