import test from "node:test";
import assert from "node:assert/strict";
import { parseProspectingQuery } from "../src/lib/query.js";

test("parses the canonical demo query", () => {
  const parsed = parseProspectingQuery("Give me a list of restaurants in Basel with emails");

  assert.equal(parsed.category, "restaurants");
  assert.equal(parsed.location, "Basel");
  assert.equal(parsed.includedType, "restaurant");
});

test("supports a find phrasing", () => {
  const parsed = parseProspectingQuery("Find cafes in Zurich");

  assert.equal(parsed.category, "cafes");
  assert.equal(parsed.location, "Zurich");
  assert.equal(parsed.includedType, "cafe");
});

test("throws when the query is outside the hackathon scope", () => {
  assert.throws(() => parseProspectingQuery("restaurants Basel emails"));
});
