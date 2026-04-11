import { config } from "../config.js";
import type { LeadRow } from "../types.js";
import { fetchWithTimeout, formatConfidence, signJwt } from "./utils.js";

export interface SheetWriteResult {
  sheetName: string;
  sheetUrl: string;
}

export async function exportLeadsToSheet(rows: LeadRow[]): Promise<SheetWriteResult> {
  const accessToken = await getGoogleAccessToken();
  const spreadsheetId = config.spreadsheetId ?? "";
  const sheetName = `${config.sheetPrefix}_${timestampSuffix()}`;

  const createSheetResponse = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      })
    },
    config.fetchTimeoutMs
  );

  if (!createSheetResponse.ok) {
    const body = await createSheetResponse.text();
    throw new Error(`Failed to create Google Sheet tab (${createSheetResponse.status}): ${body}`);
  }

  const metadata = (await createSheetResponse.json()) as {
    replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }>;
  };
  const sheetId = metadata.replies?.[0]?.addSheet?.properties?.sheetId;

  const values = [
    [
      "Business name",
      "Address",
      "Website",
      "Phone",
      "Contact email",
      "Email source",
      "Confidence"
    ],
    ...rows.map((row) => [
      row.businessName,
      row.address,
      row.website,
      row.phone,
      row.contactEmail,
      row.emailSource,
      formatConfidence(row.confidence)
    ])
  ];

  const updateResponse = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A1:G${rows.length + 1}`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        values
      })
    },
    config.fetchTimeoutMs
  );

  if (!updateResponse.ok) {
    const body = await updateResponse.text();
    throw new Error(`Failed to write sheet values (${updateResponse.status}): ${body}`);
  }

  return {
    sheetName,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId ?? 0}`
  };
}

async function getGoogleAccessToken(): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: config.serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: issuedAt + 3600,
    iat: issuedAt
  };

  const assertion = signJwt(payload, config.serviceAccountPrivateKey ?? "");
  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    },
    config.fetchTimeoutMs
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to obtain Google access token (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google access token response did not include an access token.");
  }

  return data.access_token;
}

function timestampSuffix(): string {
  const date = new Date();
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0")
  ];

  return parts.join("");
}
