import { buildResult, deterministicListings, generateMarketplaceListings, normalizeItemAttributes, validateItemAnalysis } from "../../../lib/listing.ts";

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Invalid request." }, { status: 415 });
    const body = await request.json() as { analysis?: unknown; details?: unknown };
    const analysis = normalizeItemAttributes(validateItemAnalysis(body.analysis));
    if (!analysis.itemName && !analysis.category) return Response.json({ error: "Enter an item name before regenerating." }, { status: 400 });
    const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
    try {
      const listings = await generateMarketplaceListings(analysis, details);
      return Response.json(buildResult(analysis, listings, !process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY ? null : "AI is unavailable, so the updated listing was generated from your corrected details."));
    } catch {
      return Response.json(buildResult(analysis, deterministicListings(analysis, details), true, "AI is temporarily unavailable, so the updated listing was generated from your corrected details."));
    }
  } catch { return Response.json({ error: "The corrected item details were invalid." }, { status: 400 }); }
}
