import type { ParsedQuery } from "../types.js";

const CATEGORY_TO_PLACE_TYPE: Record<string, string> = {
  restaurant: "restaurant",
  restaurants: "restaurant",
  cafe: "cafe",
  cafes: "cafe",
  coffee: "cafe",
  "coffee shops": "cafe",
  hotel: "hotel",
  hotels: "hotel"
};

export function parseProspectingQuery(query: string): ParsedQuery {
  const normalized = query.trim().replace(/\s+/g, " ");

  const patterns = [
    /(?:give me\s+(?:a\s+)?)?list of (?<category>.+?) in (?<location>.+?)(?: with .+)?$/i,
    /find (?<category>.+?) in (?<location>.+?)(?: with .+)?$/i,
    /show me (?<category>.+?) in (?<location>.+?)(?: with .+)?$/i,
    /prospect (?<category>.+?) in (?<location>.+?)(?: with .+)?$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match?.groups?.category && match.groups.location) {
      const category = cleanCategory(match.groups.category);
      const location = cleanLocation(match.groups.location);

      return {
        rawQuery: query,
        category,
        location,
        includedType: inferPlaceType(category)
      };
    }
  }

  throw new Error(
    "Could not parse the query. Use a format like 'Give me a list of restaurants in Basel with emails'."
  );
}

function cleanCategory(category: string): string {
  return category
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\bwith emails?\b/gi, "")
    .trim();
}

function cleanLocation(location: string): string {
  return location
    .replace(/\bwith emails?\b/gi, "")
    .replace(/[?.!]+$/g, "")
    .trim();
}

function inferPlaceType(category: string): string | undefined {
  const direct = CATEGORY_TO_PLACE_TYPE[category.toLowerCase()];

  if (direct) {
    return direct;
  }

  if (category.toLowerCase().includes("restaurant")) {
    return "restaurant";
  }

  if (category.toLowerCase().includes("cafe") || category.toLowerCase().includes("coffee")) {
    return "cafe";
  }

  if (category.toLowerCase().includes("hotel")) {
    return "hotel";
  }

  return undefined;
}
