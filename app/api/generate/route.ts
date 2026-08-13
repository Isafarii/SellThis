import { analyzeImages, buildResult, deterministicListings, normalizeItemAttributes, type ImageInput, type ItemAnalysis } from "../../../lib/listing.ts";

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE = 1_500_000;
const MAX_TOTAL = 4_000_000;
const CONDITIONS = new Set(["New", "Open Box", "Like New", "Good", "Fair", "For Parts / Not Working", "Not Sure"]);

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}
function matchesMagic(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.slice(0, 8).every((value, index) => value === [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a][index]);
  if (mime === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}
function fallbackAnalysis(itemName: string, condition: string, details: string): ItemAnalysis {
  const size = details.match(/\bsize\s*[:#-]?\s*([0-9]{1,2}(?:\.[05])?)\b/i)?.[1] || null;
  return { itemName: itemName || null, category: null, brand: null, model: null, color: null, size, material: null, condition: condition === "Not Sure" ? null : condition, specifications: [], features: [], visibleDefects: [], keywords: itemName ? itemName.split(/\s+/).slice(0, 8) : [] };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("images").filter((value): value is File => value instanceof File);
    if (files.length < 1 || files.length > 5) return Response.json({ error: "Upload between 1 and 5 photos." }, { status: 400 });
    if (files.some((file) => !ACCEPTED.has(file.type) || file.size <= 0 || file.size > MAX_FILE) || files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) return Response.json({ error: "The prepared photos must be no larger than 1.5 MB each and 4 MB total." }, { status: 400 });
    const itemName = text(form, "itemName", 160);
    const conditionValue = text(form, "condition", 40);
    const condition = CONDITIONS.has(conditionValue) ? conditionValue : "Not Sure";
    const details = text(form, "details", 1000);
    const images: ImageInput[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!matchesMagic(bytes, file.type)) return Response.json({ error: "One of the uploaded files is not a valid image." }, { status: 400 });
      images.push({ mimeType: file.type, data: bytesToBase64(bytes) });
    }
    try {
      const generated = await analyzeImages(images, { itemName, condition, details });
      const analysis = normalizeItemAttributes(generated.analysis, { itemName, condition });
      return Response.json(buildResult(analysis, generated.listings, false, null));
    } catch {
      if (!itemName && !details) return Response.json({ error: "We couldn't analyze the photos right now. Add the item name or a few details and try again." }, { status: 503 });
      const analysis = normalizeItemAttributes(fallbackAnalysis(itemName, condition, details), { itemName, condition });
      return Response.json(buildResult(analysis, deterministicListings(analysis, details), true, "AI image analysis is temporarily unavailable. This basic listing uses only the details you entered."));
    }
  } catch { return Response.json({ error: "The upload could not be processed. Please try again." }, { status: 400 }); }
}
