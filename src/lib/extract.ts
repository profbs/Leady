import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import type { ExtractionResult, PageDocument } from "../types.js";
import { clamp, stripHtml, truncate } from "./utils.js";

const extractionSchema = z.object({
  email: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string()
});

const regexEmailPattern = /\b[A-Z0-9._%+-]+(?:\s*(?:@|\(at\)|\[at\]| at )\s*)[A-Z0-9.-]+(?:\s*(?:\.|\(dot\)|\[dot\]| dot )\s*)[A-Z]{2,}\b/gi;

let openaiClient: OpenAI | null = null;

export async function extractContactEmail(page: PageDocument): Promise<ExtractionResult> {
  const regexCandidate = findRegexEmail(page.html);
  const textPayload = buildExtractionPayload(page);

  if (!config.openAiApiKey) {
    return {
      email: regexCandidate,
      confidence: regexCandidate ? 0.65 : 0.08,
      rationale: regexCandidate
        ? "Regex fallback found an email-like string without model verification."
        : "No API key configured for model extraction and no regex match was found."
    };
  }

  const client = getOpenAiClient();
  const response = await client.responses.parse({
    model: config.openAiModel,
    instructions:
      "Extract a single public-facing business contact email from the provided page content. Return JSON only. Prefer generic contact addresses like info@ or reservation@ over personal emails when both are present.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: textPayload
          }
        ]
      }
    ],
    text: {
      format: zodTextFormat(extractionSchema, "email_extraction")
    }
  });

  const parsed = response.output_parsed;
  if (!parsed) {
    return {
      email: regexCandidate,
      confidence: regexCandidate ? 0.55 : 0.08,
      rationale: regexCandidate
        ? "The model response was not parseable, so a regex fallback match was used."
        : "The model response was not parseable and no fallback email was found."
    };
  }

  const normalizedEmail = normalizeExtractedEmail(parsed.email);
  const confidenceBoost = regexCandidate && normalizedEmail === regexCandidate ? 0.08 : 0;

  return {
    email: normalizedEmail,
    confidence: clamp(parsed.confidence + confidenceBoost, 0, 0.99),
    rationale: parsed.rationale
  };
}

function getOpenAiClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openAiApiKey
    });
  }

  return openaiClient;
}

function buildExtractionPayload(page: PageDocument): string {
  const text = stripHtml(page.html);
  return [
    `Page source: ${page.source}`,
    `Page URL: ${page.url}`,
    "Return the best public contact email for this business page if one exists.",
    "If there is no email, return null.",
    "",
    truncate(text, 20000)
  ].join("\n");
}

function findRegexEmail(input: string): string | null {
  const matches = input.match(regexEmailPattern);

  if (!matches || matches.length === 0) {
    return null;
  }

  for (const match of matches) {
    const normalized = normalizeExtractedEmail(match);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeExtractedEmail(email: string | null): string | null {
  if (!email) {
    return null;
  }

  const normalized = email
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\(at\)|\[at\]| at /g, "@")
    .replace(/\(dot\)|\[dot\]| dot /g, ".")
    .replace(/^mailto:/, "");

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) {
    return null;
  }

  return normalized;
}
