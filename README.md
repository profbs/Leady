# Leady

Leady is a hackathon prototype that turns a natural-language request like `Give me a list of restaurants in Basel with emails` into a Google Sheet of outreach-ready local business leads.

## What this repo includes

- A minimal web UI for entering a query
- Query parsing for one category + one location
- Google Places lookup for business name, address, website, and phone
- Homepage fetch plus multilingual contact-page discovery
- OpenAI-based email extraction with structured output
- Google Sheets export
- In-memory caching by default, with optional Redis support when `REDIS_URL` is set
- Job polling so the demo can show parse -> Places -> fetch -> extract -> export progress

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in:
   - `GOOGLE_MAPS_API_KEY`
   - `OPENAI_API_KEY`
   - `GOOGLE_SHEETS_SPREADSHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
3. Share the destination spreadsheet with the service account email as an editor
4. Install deps with `npm install`
5. Start the app with `npm run dev`
6. Open `http://localhost:3000`

## Environment variables

- `PORT`: web server port
- `GOOGLE_MAPS_API_KEY`: Google Places API key
- `OPENAI_API_KEY`: OpenAI API key used for HTML email extraction
- `OPENAI_MODEL`: extraction model, defaults to `gpt-4.1-mini`
- `GOOGLE_SHEETS_SPREADSHEET_ID`: existing spreadsheet ID to write into
- `GOOGLE_SHEETS_SHEET_PREFIX`: new tab prefix for each run
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: service account email with edit access to the spreadsheet
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: private key for the service account
- `REDIS_URL`: optional Redis connection string
- `RESULT_LIMIT`: max businesses to request from Places per run
- `CONTACT_PAGE_LIMIT`: max discovered contact-like pages to fetch per site
- `FETCH_TIMEOUT_MS`: timeout for website fetches
- `USER_AGENT`: user agent for HTTP fetches

## Demo flow

1. Enter the canonical query
2. Watch the live job log as Leady parses, calls Places, scrapes sites, extracts emails, and exports
3. Open the generated sheet tab from the result card

## Notes

- Rows without an email are preserved and exported as `not found`
- JS-heavy sites and anti-bot pages will still fail sometimes, which is expected for the prototype
- The parser is intentionally scoped to one location and one category per query
