import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function encryptModelConfigSecret(value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptModelConfigSecret(value: string): string {
  const payload = Buffer.from(value, "base64");
  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function apiKeyLast4(value: string): string {
  return value.slice(-4);
}

function encryptionKey(): Buffer {
  const configured = config.modelConfigEncryptionKey.trim();
  const source =
    configured ||
    (config.nodeEnv === "production"
      ? missingProductionKey()
      : "toonflow-local-model-config-dev-key");
  return createHash("sha256").update(source).digest();
}

function missingProductionKey(): never {
  throw new Error("MODEL_CONFIG_ENCRYPTION_KEY is required in production.");
}
