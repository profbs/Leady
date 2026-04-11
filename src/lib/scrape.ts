import * as cheerio from "cheerio";
import { config } from "../config.js";
import type { PageDocument } from "../types.js";
import { fetchWithTimeout, normalizeWebsite, truncate } from "./utils.js";

const CONTACT_TOKENS = [
  "contact",
  "kontakt",
  "contatto",
  "contacto",
  "contactez",
  "contattaci",
  "about",
  "about-us",
  "aboutus",
  "impressum",
  "legal",
  "mentions-legales",
  "chi-siamo",
  "a-propos",
  "apropos",
  "sobre",
  "acerca",
  "team"
];

interface RankedLink {
  url: string;
  score: number;
}

export async function fetchRelevantPages(website: string): Promise<PageDocument[]> {
  const homepageUrl = normalizeWebsite(website);
  const homepageHtml = await fetchHtml(homepageUrl);
  const rankedLinks = rankContactLinks(homepageUrl, homepageHtml);
  const pages: PageDocument[] = [
    {
      url: homepageUrl,
      html: homepageHtml,
      source: "homepage"
    }
  ];

  for (const link of rankedLinks.slice(0, config.contactPageLimit)) {
    try {
      const html = await fetchHtml(link.url);
      pages.push({
        url: link.url,
        html,
        source: "contact page"
      });
    } catch {
      continue;
    }
  }

  return pages;
}

function rankContactLinks(baseUrl: string, html: string): RankedLink[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const scoredLinks = new Map<string, number>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const text = $(element).text().trim().toLowerCase();

    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }

    let target: URL;
    try {
      target = new URL(href, base);
    } catch {
      return;
    }

    if (target.origin !== base.origin) {
      return;
    }

    const combined = `${target.pathname} ${target.search} ${text}`.toLowerCase();
    let score = 0;

    for (const token of CONTACT_TOKENS) {
      if (combined.includes(token)) {
        score += 10;
      }
    }

    if (target.pathname.split("/").length <= 3) {
      score += 2;
    }

    if (score > 0) {
      const current = scoredLinks.get(target.toString()) ?? 0;
      scoredLinks.set(target.toString(), Math.max(current, score));
    }
  });

  return [...scoredLinks.entries()]
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score);
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    },
    config.fetchTimeoutMs
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Unsupported content type for ${url}: ${contentType}`);
  }

  const html = await response.text();
  return truncate(html, 120000);
}


export async function crawlSitePages(
  website: string,
  seedPages: PageDocument[],
  maxPages: number
): Promise<PageDocument[]> {
  const baseUrl = normalizeWebsite(website);
  if (!baseUrl) {
    return [];
  }

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const visited = new Set<string>();
  for (const page of seedPages) {
    const normalized = normalizeCrawlUrl(page.url);
    if (normalized) {
      visited.add(normalized);
    }
  }

  const queue: string[] = [];
  for (const page of seedPages) {
    for (const link of extractInternalLinks(page.html, page.url, base)) {
      if (!visited.has(link)) {
        queue.push(link);
      }
    }
  }

  const pages: PageDocument[] = [];
  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) {
      continue;
    }

    visited.add(url);

    try {
      const html = await fetchHtml(url);
      pages.push({
        url,
        html,
        source: "site crawl"
      });

      for (const link of extractInternalLinks(html, url, base)) {
        if (!visited.has(link)) {
          queue.push(link);
        }
      }
    } catch {
      continue;
    }
  }

  return pages;
}

function extractInternalLinks(html: string, baseUrl: string, base: URL): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const lower = href.toLowerCase();
    if (
      lower.startsWith("#") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("javascript:")
    ) {
      return;
    }

    let target: URL;
    try {
      target = new URL(href, baseUrl);
    } catch {
      return;
    }

    if (target.origin !== base.origin) {
      return;
    }

    target.hash = "";
    const normalized = normalizeCrawlUrl(target.toString());
    if (normalized) {
      links.add(normalized);
    }
  });

  return [...links];
}

function normalizeCrawlUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
