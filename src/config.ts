import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_SHEET_PREFIX: z.string().default("Leady"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  AGENT_MEMORY_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  AGENT_MEMORY_MAX_ENTRIES: z.coerce.number().int().positive().max(100).default(24),
  RESULT_LIMIT: z.coerce.number().int().positive().max(50).default(20),
  CONTACT_PAGE_LIMIT: z.coerce.number().int().positive().max(10).default(3),
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  USER_AGENT: z.string().default("LeadyHackathonBot/0.1 (+https://plantime.example)")
});

const env = envSchema.parse(process.env);

const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const serviceAccountPrivateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

export const config = {
  port: env.PORT,
  googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
  openAiApiKey: env.OPENAI_API_KEY,
  openAiModel: env.OPENAI_MODEL,
  spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
  sheetPrefix: env.GOOGLE_SHEETS_SHEET_PREFIX,
  serviceAccountEmail,
  serviceAccountPrivateKey: serviceAccountPrivateKey?.replace(/\\n/g, "\n"),
  redisUrl: env.REDIS_URL,
  agentMemoryTtlSeconds: env.AGENT_MEMORY_TTL_SECONDS,
  agentMemoryMaxEntries: env.AGENT_MEMORY_MAX_ENTRIES,
  resultLimit: env.RESULT_LIMIT,
  contactPageLimit: env.CONTACT_PAGE_LIMIT,
  fetchTimeoutMs: env.FETCH_TIMEOUT_MS,
  userAgent: env.USER_AGENT
};

export function assertPipelineConfig(): void {
  const missing = [
    !config.googleMapsApiKey && "GOOGLE_MAPS_API_KEY",
    !config.openAiApiKey && "OPENAI_API_KEY",
    !config.spreadsheetId && "GOOGLE_SHEETS_SPREADSHEET_ID",
    !config.serviceAccountEmail && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    !config.serviceAccountPrivateKey && "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
