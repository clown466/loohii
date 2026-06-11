import dotenv from "dotenv";

dotenv.config();

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function csvFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value?.trim()) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  port: intFromEnv("PORT", 3001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  corsOrigins: csvFromEnv("CORS_ORIGINS", [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://loohii.com",
  ]),
  jwtSecret: requireSecret("JWT_SECRET", nodeEnv),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openAiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
  textModelTimeoutMs: intFromEnv("TEXT_MODEL_TIMEOUT_MS", 240000),
  textModelMaxAttempts: intFromEnv("TEXT_MODEL_MAX_ATTEMPTS", 2),
  textModelRetryDelayMs: intFromEnv("TEXT_MODEL_RETRY_DELAY_MS", 1200),
  hermesAgent: {
    enabled: process.env.HERMES_AGENT_ENABLED === "true",
    url: process.env.HERMES_AGENT_URL ?? "",
    command: process.env.HERMES_AGENT_COMMAND ?? "",
    timeoutMs: intFromEnv("HERMES_AGENT_TIMEOUT_MS", 90000),
    honchoBaseUrl: process.env.HONCHO_BASE_URL ?? "",
    honchoApiKeyConfigured: Boolean(process.env.HONCHO_API_KEY),
    honchoMemoryConfigured: Boolean(process.env.HONCHO_API_KEY || process.env.HONCHO_BASE_URL),
    honchoProjectPrefix: process.env.HONCHO_PROJECT_PREFIX ?? "loohii",
  },
  jimengApi: {
    baseUrl: process.env.JIMENG_API_BASE_URL ?? "http://127.0.0.1:5100",
    timeoutMs: intFromEnv("JIMENG_API_TIMEOUT_MS", 900000),
  },
  modelConfigEncryptionKey: process.env.MODEL_CONFIG_ENCRYPTION_KEY ?? "",
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET_NAME ?? "",
    publicBaseUrl: process.env.R2_PUBLIC_URL ?? "",
  },
};

export function requireDatabaseUrl() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not configured. Add it before using database-backed API routes.");
  }
}

function requireSecret(envName: string, env: string): string {
  const value = process.env[envName];
  if (value && value.trim()) return value.trim();
  if (env === "production") {
    throw new Error(`${envName} must be set in production.`);
  }
  return "loohii-dev-secret-do-not-use-in-production";
}
