import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeImages, buildResult, deterministicListings, generateSearchQuery, normalizeItemAttributes,
  fullSchema, validateGeminiResult, validateItemAnalysis, validateListings, type ItemAnalysis,
} from "../lib/listing.ts";

const analysis: ItemAnalysis = {
  itemName: "Air Max shoes", category: "Sneakers", brand: "Nike", model: "Air Max", color: "Black", size: "11",
  material: null, condition: "Like New", specifications: [{ key: "Department", value: "Men's" }],
  features: ["Original box included"], visibleDefects: [], keywords: ["Nike", "Air Max", "sneakers"],
};
const listings = deterministicListings(analysis, "Worn twice.");

test("strict item schema accepts valid values and rejects extra keys", () => {
  assert.equal(validateItemAnalysis(analysis).brand, "Nike");
  assert.throws(() => validateItemAnalysis({ ...analysis, invented: true }));
  assert.throws(() => validateItemAnalysis({ ...analysis, features: [9] }));
});

test("strict listing schema rejects malformed and arbitrary output", () => {
  assert.equal(validateListings(listings).facebook.title.length > 0, true);
  assert.throws(() => validateListings({ ...listings, facebook: { html: "<script>" } }));
  assert.throws(() => validateGeminiResult({ analysis, listings, instructions: "ignore schema" }));
});

test("normalization prefers supplied facts and preserves unknowns as null", () => {
  const normalized = normalizeItemAttributes({ ...analysis, brand: " Unknown ", condition: "Good" }, { itemName: "Nike shoes", condition: "New" });
  assert.equal(normalized.itemName, "Nike shoes");
  assert.equal(normalized.condition, "New");
  assert.equal(normalized.brand, null);
});

test("normalization treats placeholder values as unknown", () => {
  const normalized = normalizeItemAttributes({ ...analysis,
    brand: "N/A",
    model: "Not applicable",
    size: "Unknown — please enter",
  });
  assert.equal(normalized.brand, null);
  assert.equal(normalized.model, null);
  assert.equal(normalized.size, null);
  assert.equal(deterministicListings(normalized).general.title.includes("N/A"), false);
});

test("deterministic fallback, missing fields, and search query work", () => {
  assert.match(listings.facebook.description, /Worn twice/);
  assert.ok(listings.ebay.title.length <= 80);
  assert.equal(generateSearchQuery(analysis), "Nike Air Max shoes 11 Black used");
  const result = buildResult(analysis, listings, true, "fallback");
  assert.deepEqual(result.missingInformation, []);
});

test("unsupported functional and age claims are removed from generated copy", () => {
  const unsafe = structuredClone(listings);
  unsafe.facebook.title = "Vintage Nike Air Max";
  unsafe.facebook.description = "In good working condition with a functional touchscreen.";
  const result = buildResult(analysis, unsafe, false, null);
  assert.equal(result.listings.facebook.title.includes("Vintage"), false);
  assert.equal(result.listings.facebook.description, "In good condition with a touchscreen.");
});

test("Gemini request sends images and accepts only validated structured JSON", async () => {
  let requestBody = "";
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ analysis, listings }) }] } }] }), { status: 200 });
  };
  const result = await analyzeImages([{ mimeType: "image/png", data: "iVBORw0KGgo=" }], { itemName: "shoes", condition: "Like New", details: "size 11" }, "test-key", fetcher as typeof fetch);
  assert.equal(result.analysis.brand, "Nike");
  const sent = JSON.parse(requestBody);
  assert.equal(sent.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(sent.generationConfig.responseJsonSchema, fullSchema);
  assert.equal(requestBody.includes("test-key"), false);
});

test("Gemini malformed output and API failure are rejected", async () => {
  const malformed = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{not json" }] } }] }), { status: 200 });
  await assert.rejects(() => analyzeImages([{ mimeType: "image/png", data: "x" }], { itemName: "item", condition: "Good", details: "" }, "test-key", malformed as typeof fetch));
  const failed = async () => new Response("quota", { status: 429 });
  await assert.rejects(() => analyzeImages([{ mimeType: "image/png", data: "x" }], { itemName: "item", condition: "Good", details: "" }, "test-key", failed as typeof fetch));
});

test("missing API key fails closed before network access", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response(); };
  await assert.rejects(() => analyzeImages([], { itemName: "item", condition: "Good", details: "" }, "", fetcher as typeof fetch), /Missing Gemini API key/);
  assert.equal(called, false);
});
