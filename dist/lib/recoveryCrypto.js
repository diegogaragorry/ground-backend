"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptRecoveryPackage = encryptRecoveryPackage;
exports.decryptRecoveryPackage = decryptRecoveryPackage;
const crypto_1 = __importDefault(require("crypto"));
const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
function getServerKey() {
    const raw = process.env.SERVER_RECOVERY_KEY;
    if (!raw || raw.length < 16) {
        throw new Error("SERVER_RECOVERY_KEY must be set (e.g. 44-char base64 or 64-char hex)");
    }
    try {
        const asBase64 = Buffer.from(raw, "base64");
        if (asBase64.length === KEY_LEN)
            return asBase64;
    }
    catch {
        // ignore
    }
    if (/^[0-9a-fA-F]{64}$/.test(raw))
        return Buffer.from(raw, "hex");
    return crypto_1.default.createHash("sha256").update(raw).digest();
}
/**
 * Encrypt the user's encryption key K (32 bytes) for storage.
 * Returns base64( IV || ciphertext || tag ).
 */
function encryptRecoveryPackage(plaintextBase64) {
    const key = getServerKey();
    if (key.length !== KEY_LEN) {
        throw new Error("SERVER_RECOVERY_KEY must decode to 32 bytes");
    }
    const plain = Buffer.from(plaintextBase64, "base64");
    if (plain.length !== KEY_LEN) {
        throw new Error("Recovery package must be 32 bytes (base64 decoded)");
    }
    const iv = crypto_1.default.randomBytes(IV_LEN);
    const cipher = crypto_1.default.createCipheriv(ALG, key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]).toString("base64");
}
/**
 * Decrypt the stored recovery package to get K (32 bytes).
 * Input: base64( IV || ciphertext || tag ).
 * Returns K as base64.
 */
function decryptRecoveryPackage(ciphertextBase64) {
    const key = getServerKey();
    const buf = Buffer.from(ciphertextBase64, "base64");
    if (buf.length < IV_LEN + TAG_LEN + 1) {
        throw new Error("Invalid recovery package");
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = crypto_1.default.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    return plain.toString("base64");
}
