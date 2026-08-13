import test from "node:test";
import assert from "node:assert/strict";
import { POST as generate } from "../app/api/generate/route.ts";
import { POST as regenerate } from "../app/api/regenerate/route.ts";

const pngBytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
function image(name = "item.png") { return new File([pngBytes], name, { type: "image/png" }); }
function request(count: number, itemName = "Desk lamp") {
  const form = new FormData();
  for (let index = 0; index < count; index++) form.append("images", image(`item-${index}.png`));
  form.append("itemName", itemName); form.append("condition", "Good"); form.append("details", "Small black lamp");
  return new Request("http://local/api/generate", { method: "POST", body: form });
}

test("generate accepts one image and returns deterministic fallback without a key", async () => {
  delete process.env.GEMINI_API_KEY;
  const response = await generate(request(1));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.fallback, true);
  assert.equal(body.analysis.itemName, "Desk lamp");
  assert.match(body.listings.facebook.title, /Desk lamp/);
});

test("generate accepts five images and rejects six", async () => {
  assert.equal((await generate(request(5))).status, 200);
  assert.equal((await generate(request(6))).status, 400);
});

test("generate rejects invalid files and image-only fallback", async () => {
  const bad = new FormData(); bad.append("images", new File(["not an image"], "bad.png", { type: "image/png" })); bad.append("itemName", "Lamp");
  assert.equal((await generate(new Request("http://local/api/generate", { method: "POST", body: bad }))).status, 400);
  assert.equal((await generate(request(1, ""))).status, 200);
  const blank = new FormData(); blank.append("images", image()); blank.append("condition", "Not Sure");
  assert.equal((await generate(new Request("http://local/api/generate", { method: "POST", body: blank }))).status, 503);
});

test("corrected attributes regenerate without another image upload", async () => {
  const analysis = { itemName: "Floor lamp", category: "Lighting", brand: null, model: null, color: "Black", size: null, material: "Metal", condition: "Good", specifications: [], features: ["Adjustable head"], visibleDefects: [], keywords: ["lamp"] };
  const response = await regenerate(new Request("http://local/api/regenerate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis, details: "Works well" }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.listings.general.title, /Floor lamp/);
  assert.equal(body.analysis.material, "Metal");
  assert.equal(body.fallback, true);
});

test("regenerate rejects malformed analysis", async () => {
  const response = await regenerate(new Request("http://local/api/regenerate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis: { itemName: "Lamp", extra: "bad" } }) }));
  assert.equal(response.status, 400);
});
