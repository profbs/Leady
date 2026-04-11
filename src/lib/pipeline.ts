import { assertPipelineConfig } from "../config.js";
import type { BusinessCandidate, LeadRow, PageDocument, PipelineResult } from "../types.js";
import { getCacheStore } from "./cache.js";
import { extractContactEmail } from "./extract.js";
import { searchBusinesses } from "./places.js";
import { parseProspectingQuery } from "./query.js";
import { fetchRelevantPages } from "./scrape.js";
import { exportLeadsToSheet } from "./sheets.js";
import { clamp, normalizeWebsite, sha1 } from "./utils.js";

const PLACE_CACHE_TTL_SECONDS = 60 * 30;
const PAGE_CACHE_TTL_SECONDS = 60 * 60 * 6;
const CONCURRENCY_LIMIT = 4;

export async function runProspectingPipeline(
  rawQuery: string,
  log: (message: string) => void
): Promise<PipelineResult> {
  assertPipelineConfig();

  const startedAt = Date.now();
  const parsedQuery = parseProspectingQuery(rawQuery);
  log(`Parsed query: ${parsedQuery.category} in ${parsedQuery.location}`);

  const cache = await getCacheStore();
  const placeCacheKey = `places:${parsedQuery.category}:${parsedQuery.location}`;
  let businesses = await cache.get<BusinessCandidate[]>(placeCacheKey);

  if (businesses) {
    log(`Cache hit for Places lookup. Loaded ${businesses.length} businesses.`);
  } else {
    log("Fetching businesses from Google Places...");
    businesses = await searchBusinesses(parsedQuery);
    await cache.set(placeCacheKey, businesses, PLACE_CACHE_TTL_SECONDS);
    log(`Google Places returned ${businesses.length} businesses.`);
  }

  const rows = await mapWithConcurrency(businesses, CONCURRENCY_LIMIT, async (business) => {
    return processBusiness(business, cache, log);
  });

  const emailsFound = rows.filter((row) => row.contactEmail).length;
  log(`Exporting ${rows.length} rows to Google Sheets...`);
  const sheet = await exportLeadsToSheet(rows);
  log(`Google Sheet updated: ${sheet.sheetName}`);

  return {
    rows,
    stats: {
      query: parsedQuery,
      totalBusinesses: rows.length,
      emailsFound,
      runtimeMs: Date.now() - startedAt,
      sheetUrl: sheet.sheetUrl,
      sheetName: sheet.sheetName
    }
  };
}

async function processBusiness(
  business: BusinessCandidate,
  cache: Awaited<ReturnType<typeof getCacheStore>>,
  log: (message: string) => void
): Promise<LeadRow> {
  log(`Processing ${business.name}...`);

  if (!business.website) {
    return buildNotFoundLead(business);
  }

  try {
    const normalizedWebsite = normalizeWebsite(business.website);
    const pageCacheKey = `pages:${sha1(normalizedWebsite)}`;
    let pages = await cache.get<PageDocument[]>(pageCacheKey);

    if (!pages) {
      pages = await fetchRelevantPages(normalizedWebsite);
      await cache.set(pageCacheKey, pages, PAGE_CACHE_TTL_SECONDS);
    }

    let bestMatch: {
      email: string;
      source: "homepage" | "contact page";
      confidence: number;
    } | null = null;

    for (const page of pages) {
      log(`Extracting email from ${page.source} for ${business.name}...`);
      const extracted = await extractContactEmail(page);

      if (!extracted.email) {
        continue;
      }

      const pageBoost = page.source === "contact page" ? 0.08 : 0.03;
      const confidence = clamp(extracted.confidence + pageBoost, 0, 0.99);

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          email: extracted.email,
          source: page.source,
          confidence
        };
      }

      if (page.source === "contact page" && confidence >= 0.82) {
        break;
      }
    }

    if (!bestMatch) {
      return buildNotFoundLead(business);
    }

    return {
      businessName: business.name,
      address: business.address,
      website: normalizedWebsite,
      phone: business.phone ?? "",
      contactEmail: bestMatch.email,
      emailSource: bestMatch.source,
      confidence: bestMatch.confidence
    };
  } catch (error) {
    log(`Falling back to not found for ${business.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
    return buildNotFoundLead(business);
  }
}

function buildNotFoundLead(business: BusinessCandidate): LeadRow {
  return {
    businessName: business.name,
    address: business.address,
    website: normalizeWebsite(business.website),
    phone: business.phone ?? "",
    contactEmail: "",
    emailSource: "not found",
    confidence: 0.08
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}
