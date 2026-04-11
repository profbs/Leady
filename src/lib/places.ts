import { config } from "../config.js";
import type { BusinessCandidate, ParsedQuery } from "../types.js";
import { fetchWithTimeout } from "./utils.js";

interface PlacesSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    websiteUri?: string;
    nationalPhoneNumber?: string;
  }>;
}

export async function searchBusinesses(query: ParsedQuery): Promise<BusinessCandidate[]> {
  const response = await fetchWithTimeout(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.googleMapsApiKey ?? "",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber"
      },
      body: JSON.stringify({
        textQuery: `${query.category} in ${query.location}`,
        includedType: query.includedType,
        pageSize: config.resultLimit
      })
    },
    config.fetchTimeoutMs
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Places request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as PlacesSearchResponse;

  return (data.places ?? [])
    .filter((place) => place.id && place.displayName?.text && place.formattedAddress)
    .map((place) => ({
      id: place.id ?? "",
      name: place.displayName?.text ?? "Unknown",
      address: place.formattedAddress ?? "",
      website: place.websiteUri,
      phone: place.nationalPhoneNumber
    }));
}
