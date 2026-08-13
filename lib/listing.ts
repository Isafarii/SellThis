export type Pair = { key: string; value: string };
export type ItemAnalysis = {
  itemName: string | null; category: string | null; brand: string | null; model: string | null;
  color: string | null; size: string | null; material: string | null; condition: string | null;
  specifications: Pair[]; features: string[]; visibleDefects: string[]; keywords: string[];
};
export type Listing = { title: string; description: string; condition: string; keyDetails: string[] };
export type Listings = { general: Listing; facebook: Listing; ebay: Listing & { itemSpecifics: Pair[] }; offerup: Listing };
export type ListingResult = { analysis: ItemAnalysis; listings: Listings; searchQuery: string; missingInformation: string[]; fallback: boolean; warning: string | null };
export type ImageInput = { mimeType: string; data: string };

const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: { type: "string" }, maxItems: 16 };
const pairSchema = { type: "object", additionalProperties: false, properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] };
const listingSchema = { type: "object", additionalProperties: false, properties: { title: { type: "string" }, description: { type: "string" }, condition: { type: "string" }, keyDetails: stringArray }, required: ["title", "description", "condition", "keyDetails"] };
const ebaySchema = { type: "object", additionalProperties: false, properties: { ...listingSchema.properties, itemSpecifics: { type: "array", items: pairSchema, maxItems: 16 } }, required: [...listingSchema.required, "itemSpecifics"] };
const analysisSchema = {
  type: "object", additionalProperties: false,
  properties: {
    itemName: nullableString, category: nullableString, brand: nullableString, model: nullableString, color: nullableString,
    size: nullableString, material: nullableString, condition: nullableString,
    specifications: { type: "array", items: pairSchema, maxItems: 16 }, features: stringArray, visibleDefects: stringArray, keywords: stringArray,
  },
  required: ["itemName", "category", "brand", "model", "color", "size", "material", "condition", "specifications", "features", "visibleDefects", "keywords"],
};
const listingsSchema = { type: "object", additionalProperties: false, properties: { general: listingSchema, facebook: listingSchema, ebay: ebaySchema, offerup: listingSchema }, required: ["general", "facebook", "ebay", "offerup"] };
const fullSchema = { type: "object", additionalProperties: false, properties: { analysis: analysisSchema, listings: listingsSchema }, required: ["analysis", "listings"] };

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as object);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function validString(value: unknown, max = 1600): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function validNullable(value: unknown): value is string | null { return value === null || (typeof value === "string" && value.length <= 240); }
function validStrings(value: unknown, max = 16): value is string[] { return Array.isArray(value) && value.length <= max && value.every((item) => validString(item, 240)); }
function validPairs(value: unknown): value is Pair[] {
  return Array.isArray(value) && value.length <= 16 && value.every((item) => exactObject(item, ["key", "value"]) && validString(item.key, 80) && validString(item.value, 240));
}
function validListing(value: unknown, ebay = false): value is Listing & { itemSpecifics?: Pair[] } {
  const keys = ebay ? ["title", "description", "condition", "keyDetails", "itemSpecifics"] : ["title", "description", "condition", "keyDetails"];
  return exactObject(value, keys) && validString(value.title, 160) && validString(value.description, 4000) && validString(value.condition, 240) && validStrings(value.keyDetails) && (!ebay || validPairs(value.itemSpecifics));
}

export function validateItemAnalysis(value: unknown): ItemAnalysis {
  const keys = ["itemName", "category", "brand", "model", "color", "size", "material", "condition", "specifications", "features", "visibleDefects", "keywords"];
  if (!exactObject(value, keys)) throw new Error("Invalid item analysis shape");
  for (const key of keys.slice(0, 8)) if (!validNullable(value[key])) throw new Error(`Invalid ${key}`);
  if (!validPairs(value.specifications) || !validStrings(value.features) || !validStrings(value.visibleDefects) || !validStrings(value.keywords)) throw new Error("Invalid item analysis values");
  return value as ItemAnalysis;
}

export function validateListings(value: unknown): Listings {
  if (!exactObject(value, ["general", "facebook", "ebay", "offerup"]) || !validListing(value.general) || !validListing(value.facebook) || !validListing(value.ebay, true) || !validListing(value.offerup)) throw new Error("Invalid listing output");
  return value as Listings;
}

export function validateGeminiResult(value: unknown): { analysis: ItemAnalysis; listings: Listings } {
  if (!exactObject(value, ["analysis", "listings"])) throw new Error("Invalid Gemini response shape");
  return { analysis: validateItemAnalysis(value.analysis), listings: validateListings(value.listings) };
}

function clean(value: string | null) {
  const result = value?.replace(/\s+/g, " ").trim();
  return result && !/^(?:unknown|n\/?a|none|not applicable|not available)(?:\s*[—-].*)?$/i.test(result) ? result : null;
}
function unique(values: string[]) { return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))]; }

export function normalizeItemAttributes(analysis: ItemAnalysis, supplied: { itemName?: string; condition?: string } = {}): ItemAnalysis {
  const normalized: ItemAnalysis = {
    itemName: clean(supplied.itemName || analysis.itemName), category: clean(analysis.category), brand: clean(analysis.brand), model: clean(analysis.model),
    color: clean(analysis.color), size: clean(analysis.size), material: clean(analysis.material),
    condition: clean(supplied.condition && supplied.condition !== "Not Sure" ? supplied.condition : analysis.condition),
    specifications: analysis.specifications.map((pair) => ({ key: pair.key.trim(), value: pair.value.trim() })).filter((pair) => pair.key && pair.value),
    features: unique(analysis.features), visibleDefects: unique(analysis.visibleDefects), keywords: unique(analysis.keywords),
  };
  return validateItemAnalysis(normalized);
}

export function generateSearchQuery(analysis: ItemAnalysis) {
  const query = unique([analysis.brand, analysis.model, analysis.itemName, analysis.size, analysis.color, analysis.condition === "New" ? "new" : "used"].filter((value): value is string => Boolean(value))).join(" ");
  return query || "used item comparable listings";
}

function trimTitle(parts: Array<string | null>, limit: number) {
  const title = unique(parts.filter((part): part is string => Boolean(part))).join(" ");
  if (title.length <= limit) return title;
  return title.slice(0, limit - 1).replace(/\s+\S*$/, "").trim() + "…";
}

export function deterministicListings(analysis: ItemAnalysis, notes = ""): Listings {
  const item = analysis.itemName || analysis.category || "Item";
  const condition = analysis.condition || "Condition not specified";
  const title = trimTitle([analysis.brand, analysis.model, item, analysis.size, analysis.color, condition], 80);
  const details = unique([
    analysis.brand && `Brand: ${analysis.brand}`, analysis.model && `Model: ${analysis.model}`, analysis.size && `Size: ${analysis.size}`,
    analysis.color && `Color: ${analysis.color}`, analysis.material && `Material: ${analysis.material}`,
    ...analysis.specifications.map((pair) => `${pair.key}: ${pair.value}`), ...analysis.features,
  ].filter((value): value is string => Boolean(value)));
  const defectText = analysis.visibleDefects.length ? `Visible condition notes: ${analysis.visibleDefects.join(", ")}.` : "Please review the photos for condition.";
  const noteText = notes.trim() ? ` ${notes.trim()}` : "";
  const generalDescription = `${item} in ${condition.toLowerCase()} condition.${noteText} ${defectText}`.replace(/\s+/g, " ").trim();
  return {
    general: { title, description: generalDescription, condition, keyDetails: details },
    facebook: { title, description: `${generalDescription} Message me if you have any questions.`, condition, keyDetails: details.slice(0, 7) },
    ebay: { title, description: `${generalDescription}\n\nIncluded details are based on the photos and seller-provided information. Please review all photos before purchasing.`, condition, keyDetails: details, itemSpecifics: details.map((entry) => { const [key, ...rest] = entry.split(": "); return { key, value: rest.join(": ") || "Yes" }; }) },
    offerup: { title: trimTitle([analysis.brand, analysis.model, item, analysis.size], 70), description: `${generalDescription} Local pickup or delivery details can be discussed.`, condition, keyDetails: details.slice(0, 5) },
  };
}

function promptFor(itemName: string, condition: string, details: string) {
  return `You create truthful used-item marketplace listings from photos and seller-provided facts.
Seller item name: ${itemName || "Not supplied"}
Seller condition: ${condition || "Not Sure"}
Seller notes: ${details || "Not supplied"}

Analyze the same physical item across all images, then produce the required JSON. User-supplied facts take priority. Use null when an attribute is not visible or supplied. Never infer or fabricate a model number, authenticity, exact dimensions, material, age, warranty, technical specification, history, original retail price, or hidden condition. Only describe visible defects actually visible in the images or explicitly provided. Descriptive language must be restrained and factual.

Write natural seller copy, not corporate marketing. Keep the general and Facebook titles concise. Keep the eBay title at 80 characters or fewer. Facebook should be concise and conversational. eBay should be detailed and structured. OfferUp should be shortest. Item specifics must include only relevant, supported facts. Never suggest a dollar price.`;
}

async function callGemini(input: Array<Record<string, unknown>>, schema: object, apiKey: string, fetcher: typeof fetch) {
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: input }], generationConfig: { thinkingConfig: { thinkingLevel: "minimal" }, responseMimeType: "application/json", responseJsonSchema: schema } }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Gemini request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no structured output");
  return JSON.parse(text) as unknown;
}

export async function analyzeImages(images: ImageInput[], input: { itemName: string; condition: string; details: string }, apiKey = process.env.GEMINI_API_KEY || "", fetcher: typeof fetch = fetch) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const parts: Array<Record<string, unknown>> = [{ text: promptFor(input.itemName, input.condition, input.details) }, ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))];
  return validateGeminiResult(await callGemini(parts, fullSchema, apiKey, fetcher));
}

export async function generateMarketplaceListings(analysis: ItemAnalysis, details: string, apiKey = process.env.GEMINI_API_KEY || "", fetcher: typeof fetch = fetch) {
  if (!apiKey) return deterministicListings(analysis, details);
  const prompt = `Rewrite marketplace listings using only this validated item data: ${JSON.stringify(analysis)}. Seller notes: ${details || "None"}. Do not add facts. Use the required JSON schema. Keep the eBay title at 80 characters or fewer. Do not suggest a price.`;
  const output = await callGemini([{ text: prompt }], listingsSchema, apiKey, fetcher);
  return validateListings(output);
}

export function buildResult(analysis: ItemAnalysis, listings: Listings, fallback: boolean, warning: string | null): ListingResult {
  const subject = `${analysis.category || ""} ${analysis.itemName || ""}`.toLowerCase();
  const relevant = /shoe|sneaker|boot|clothing|apparel|shirt|jacket|pants|dress/.test(subject)
    ? (["itemName", "brand", "size", "color"] as const)
    : /electronic|phone|laptop|tablet|camera|headphone|console|television|\btv\b/.test(subject)
      ? (["itemName", "brand", "model"] as const)
      : /furniture|chair|table|sofa|desk/.test(subject)
        ? (["itemName", "material", "color"] as const)
        : (["itemName"] as const);
  const labels = { itemName: "item name", brand: "brand", model: "model", size: "size", color: "color", material: "material" } as const;
  const missingInformation = relevant.filter((key) => !analysis[key]).map((key) => labels[key]);
  return { analysis, listings, searchQuery: generateSearchQuery(analysis), missingInformation, fallback, warning };
}

export { fullSchema, listingsSchema };
