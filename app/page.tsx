"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type Pair = { key: string; value: string };
type ItemAnalysis = {
  itemName: string | null; category: string | null; brand: string | null; model: string | null;
  color: string | null; size: string | null; material: string | null; condition: string | null;
  specifications: Pair[]; features: string[]; visibleDefects: string[]; keywords: string[];
};
type Listing = { title: string; description: string; condition: string; keyDetails: string[] };
type ListingResult = {
  analysis: ItemAnalysis;
  listings: { general: Listing; facebook: Listing; ebay: Listing & { itemSpecifics: Pair[] }; offerup: Listing };
  searchQuery: string; missingInformation: string[]; fallback: boolean; warning: string | null;
};
type UploadImage = { id: string; file: File; preview: string };

const CONDITIONS = ["New", "Open Box", "Like New", "Good", "Fair", "For Parts / Not Working", "Not Sure"];
type EditableAttribute = keyof Pick<ItemAnalysis, "itemName" | "category" | "brand" | "model" | "color" | "size" | "material" | "condition">;
type CorrectionField = { source: "attribute"; key: EditableAttribute; label: string } | { source: "specification"; key: string; label: string };

function correctionFields(analysis: ItemAnalysis): CorrectionField[] {
  const subject = `${analysis.category || ""} ${analysis.itemName || ""}`.toLowerCase();
  const attributes = (values: Array<[EditableAttribute, string]>): CorrectionField[] => values.map(([key, label]) => ({ source: "attribute", key, label }));
  const specifications = (labels: string[]): CorrectionField[] => labels.map((label) => ({ source: "specification", key: label, label }));
  const core = attributes([["itemName", "Item"], ["category", "Category"], ["condition", "Overall condition"]]);
  let relevant: CorrectionField[];
  if (/vinyl|record|music|media|\bcd\b|dvd|blu-ray|book/.test(subject)) {
    relevant = specifications(["Artist", "Album / Title", "Format", "Label", "Edition", "Catalog Number", "Record Size", "Media Condition", "Sleeve Condition"]);
  } else if (/shoe|sneaker|boot|footwear/.test(subject)) {
    relevant = [...attributes([["brand", "Brand"], ["model", "Model / Style"], ["size", "Size"], ["color", "Color"], ["material", "Material"]]), ...specifications(["Department", "US Shoe Size", "Width", "Closure"] )];
  } else if (/clothing|apparel|shirt|jacket|coat|pants|jeans|dress|sweater|hoodie|hat/.test(subject)) {
    relevant = [...attributes([["brand", "Brand"], ["size", "Size"], ["color", "Color"], ["material", "Material"]]), ...specifications(["Type", "Department", "Size Type", "Style", "Pattern", "Closure"] )];
  } else if (/electronic|phone|laptop|tablet|camera|headphone|speaker|console|television|\btv\b|monitor|watch/.test(subject)) {
    relevant = [...attributes([["brand", "Brand"], ["model", "Model"], ["color", "Color"]]), ...specifications(["Storage Capacity", "Connectivity", "Screen Size", "Included Accessories", "Carrier / Compatibility"] )];
  } else if (/furniture|chair|table|sofa|couch|desk|dresser|cabinet|shelf|bed frame/.test(subject)) {
    relevant = [...attributes([["brand", "Brand"], ["color", "Color"], ["material", "Material"]]), ...specifications(["Item Type", "Style", "Dimensions", "Assembly", "Room"] )];
  } else {
    relevant = attributes([["brand", "Brand"], ["model", "Model"], ["size", "Size"], ["color", "Color"], ["material", "Material"]]);
  }
  const included = new Set(relevant.filter((field) => field.source === "specification").map((field) => field.key.toLowerCase()));
  const detected = analysis.specifications.filter((pair) => !included.has(pair.key.toLowerCase())).map((pair): CorrectionField => ({ source: "specification", key: pair.key, label: pair.key }));
  return [...core, ...relevant, ...detected];
}
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
function makeId() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${Date.now()}-${bytes[0].toString(36)}${bytes[1].toString(36)}`;
}

async function optimizeImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare this image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.76));
  if (!blob) throw new Error("Your browser could not prepare this image.");
  if (blob.size > 700_000) {
    const smaller = document.createElement("canvas");
    const smallerScale = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
    smaller.width = Math.max(1, Math.round(canvas.width * smallerScale));
    smaller.height = Math.max(1, Math.round(canvas.height * smallerScale));
    const smallerContext = smaller.getContext("2d");
    if (!smallerContext) throw new Error("Your browser could not prepare this image.");
    smallerContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    blob = await new Promise<Blob | null>((resolve) => smaller.toBlob(resolve, "image/webp", 0.66));
    if (!blob) throw new Error("Your browser could not prepare this image.");
  }
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}

function listingToText(label: string, listing: Listing, specifics?: Pair[]) {
  const lines = [label, listing.title, "", listing.description, "", `Condition: ${listing.condition}`];
  if (listing.keyDetails.length) lines.push("", ...listing.keyDetails.map((detail) => `• ${detail}`));
  if (specifics?.length) lines.push("", "Item specifics", ...specifics.map((item) => `${item.key}: ${item.value}`));
  return lines.join("\n");
}

export default function Home() {
  const [images, setImages] = useState<UploadImage[]>([]);
  const [itemName, setItemName] = useState("");
  const [condition, setCondition] = useState("Not Sure");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<ListingResult | null>(null);
  const [activeTab, setActiveTab] = useState<"facebook" | "ebay" | "offerup" | "general">("facebook");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [copied, setCopied] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const currentListing = result?.listings[activeTab];
  const allText = useMemo(() => result ? [
    listingToText("GENERAL LISTING", result.listings.general),
    listingToText("FACEBOOK MARKETPLACE", result.listings.facebook),
    listingToText("EBAY", result.listings.ebay, result.listings.ebay.itemSpecifics),
    listingToText("OFFERUP / CRAIGSLIST", result.listings.offerup),
    `PRICE RESEARCH\n${result.searchQuery}`,
  ].join("\n\n--------------------\n\n") : "", [result]);

  async function addFiles(files: File[]) {
    setUploadError("");
    const available = 5 - images.length;
    if (available <= 0) return setUploadError("You can upload up to 5 photos.");
    const accepted: UploadImage[] = [];
    for (const file of files.slice(0, available)) {
      if (!ACCEPTED.has(file.type)) { setUploadError("Use JPG, PNG, or WEBP images only."); continue; }
      if (file.size > MAX_FILE_SIZE) { setUploadError("Each photo must be 10 MB or smaller."); continue; }
      accepted.push({ id: makeId(), file, preview: URL.createObjectURL(file) });
    }
    if (files.length > available) setUploadError("Only the first 5 photos were added.");
    setImages((current) => [...current, ...accepted]);
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }
  function removeImage(id: string) {
    setImages((current) => {
      const image = current.find((entry) => entry.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      return current.filter((entry) => entry.id !== id);
    });
  }

  async function generate() {
    if (!images.length) return setUploadError("Add at least one photo to continue.");
    setBusy(true); setError(""); setCopied("");
    try {
      const form = new FormData();
      const optimized = await Promise.all(images.map((image) => optimizeImage(image.file)));
      if (optimized.reduce((total, file) => total + file.size, 0) > 4_000_000) throw new Error("These photos are still too large together. Remove one photo or choose smaller images.");
      optimized.forEach((file) => form.append("images", file));
      form.append("itemName", itemName); form.append("condition", condition); form.append("details", details);
      const response = await fetch("/api/generate", { method: "POST", body: form });
      const data = await response.json() as ListingResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "We couldn't generate this listing.");
      setResult(data); setActiveTab("facebook");
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "We couldn't generate this listing. Please try again."); }
    finally { setBusy(false); }
  }

  function updateAttribute(key: keyof ItemAnalysis, value: string) {
    if (!result || (typeof result.analysis[key] !== "string" && result.analysis[key] !== null)) return;
    setResult({ ...result, analysis: { ...result.analysis, [key]: value || null } });
  }

  function updateSpecification(key: string, value: string) {
    if (!result) return;
    const index = result.analysis.specifications.findIndex((pair) => pair.key.toLowerCase() === key.toLowerCase());
    const specifications = [...result.analysis.specifications];
    if (!value.trim()) {
      if (index >= 0) specifications.splice(index, 1);
    } else if (index >= 0) {
      specifications[index] = { key: specifications[index].key, value };
    } else {
      specifications.push({ key, value });
    }
    setResult({ ...result, analysis: { ...result.analysis, specifications } });
  }

  async function regenerate() {
    if (!result) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/regenerate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis: result.analysis, details }) });
      const data = await response.json() as ListingResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "We couldn't update the listing.");
      setResult(data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "We couldn't update the listing."); }
    finally { setBusy(false); }
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((current) => current === key ? "" : current), 1500); }
    catch { setError("Copy failed. Select the text and copy it manually."); }
  }

  function reset() {
    images.forEach((image) => URL.revokeObjectURL(image.preview));
    setImages([]); setItemName(""); setCondition("Not Sure"); setDetails(""); setResult(null);
    setError(""); setUploadError(""); setCopied(""); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const searchLinks = result ? [
    ["Google", `https://www.google.com/search?q=${encodeURIComponent(result.searchQuery)}`],
    ["eBay", `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(result.searchQuery)}`],
    ["Facebook", `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(result.searchQuery)}`],
  ] : [];

  return <main>
    <header className="topbar"><a href="#top" className="wordmark">SellThis<span>.</span></a><span className="quiet-badge">Private by design</span></header>
    <section id="top" className="hero"><p className="eyebrow">LIST LESS. SELL FASTER.</p><h1>Turn photos into marketplace listings <em>in seconds.</em></h1><p className="subhead">Upload your item, add a few details, and get ready-to-copy listings for every major marketplace.</p></section>

    <section className="generator" aria-label="Listing generator">
      <div className="step-label"><span>01</span> Add photos</div>
      <div className="dropzone" onDrop={onDrop} onDragOver={(event) => event.preventDefault()} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFiles} aria-label="Choose item photos" />
        <div className="camera-mark" aria-hidden="true">+</div><strong>Drop item photos here</strong><span>or choose up to 5 photos</span>
        <button type="button" className="secondary-button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>Choose photos</button>
      </div>
      {images.length > 0 && <div className="previews" aria-label={`${images.length} selected photos`}>
        {images.map((image, index) => <figure key={image.id} className="preview"><img src={image.preview} alt={`Selected item photo ${index + 1}`} /><button type="button" onClick={() => removeImage(image.id)} aria-label={`Remove photo ${index + 1}`}>×</button>{index === 0 && <figcaption>Main photo</figcaption>}</figure>)}
        {images.length < 5 && <button className="add-more" type="button" onClick={() => fileInput.current?.click()}>+ Add</button>}
      </div>}
      {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
      <p className="privacy-note"><span>✓</span> Photos are processed to generate your listing and are not saved by SellThis.</p>

      <div className="step-label second"><span>02</span> Tell us what you know</div>
      <div className="form-grid">
        <label className="wide">What are you selling? <small>Optional</small><input value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={160} placeholder="Example: Nike Air Max men's shoes" /></label>
        <label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}>{CONDITIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label className="wide">Additional details <small>Optional</small><textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} placeholder="Example: Men's size 11. Worn twice. Includes original box." /></label>
      </div>
      <button className="primary-button" type="button" disabled={busy} onClick={generate}>{busy ? <><span className="spinner" /> Working on your listing…</> : <>Generate my listing <span>→</span></>}</button>
      {error && <div className="error-box" role="alert"><strong>Something went wrong</strong><span>{error}</span></div>}
    </section>

    {result && <section className="results" ref={resultsRef}>
      <div className="results-heading"><div><p className="eyebrow">YOUR LISTING IS READY</p><h2>Review, copy, and sell.</h2></div><div className="heading-actions"><button className="copy-all" onClick={() => copy(allText, "all")}>{copied === "all" ? "✓ Copied!" : "Copy everything"}</button><button className="text-button" onClick={reset}>Start another item</button></div></div>
      {result.warning && <div className="warning"><strong>{result.fallback ? "Basic listing mode" : "Note"}</strong><span>{result.warning}</span></div>}
      <div className="summary-card"><img src={images[0]?.preview} alt="Main uploaded item" /><div className="summary-content"><span className="summary-kicker">Detected item</span><h3>{result.analysis.itemName || "Unknown item"}</h3><p>{[result.analysis.brand, result.analysis.model, ...result.analysis.specifications.filter((pair) => /^(?:artist|album|title|format)$/i.test(pair.key)).map((pair) => pair.value), result.analysis.color].filter(Boolean).slice(0, 4).join(" · ") || "Review the fields below and add what you know."}</p><span className="condition-pill">{result.analysis.condition || "Condition unknown"}</span></div></div>
      <div className="edit-card">
        <div className="card-title"><div><p className="eyebrow">ITEM DETAILS</p><h3>Check what we found</h3></div><p>Edit anything that’s missing or wrong, then regenerate. Leave fields blank when they do not apply.</p></div>
        <div className="attribute-grid">{correctionFields(result.analysis).map((field) => {
          const value = field.source === "attribute" ? ((result.analysis[field.key] as string | null) ?? "") : (result.analysis.specifications.find((pair) => pair.key.toLowerCase() === field.key.toLowerCase())?.value ?? "");
          return <label key={`${field.source}-${field.key}`}>{field.label}<input value={value} onChange={(event) => field.source === "attribute" ? updateAttribute(field.key, event.target.value) : updateSpecification(field.key, event.target.value)} placeholder="Unknown / not applicable" /></label>;
        })}</div>
        {result.missingInformation.length > 0 && <p className="missing-note">Missing: {result.missingInformation.join(", ")}. Unknown is better than a guess.</p>}
        <button className="update-button" type="button" onClick={regenerate} disabled={busy}>{busy ? "Updating…" : "Regenerate from corrections"}</button>
      </div>
      <div className="listing-card">
        <div className="tabs" role="tablist" aria-label="Marketplace listing versions">{(["facebook", "ebay", "offerup", "general"] as const).map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab === "offerup" ? "OfferUp / Craigslist" : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
        {currentListing && <div className="listing-body">
          <div className="field-block"><div className="field-heading"><span>Title</span><button onClick={() => copy(currentListing.title, "title")}>{copied === "title" ? "✓ Copied" : "Copy"}</button></div><p className="listing-title">{currentListing.title}</p></div>
          <div className="field-block"><div className="field-heading"><span>Description</span><button onClick={() => copy(currentListing.description, "description")}>{copied === "description" ? "✓ Copied" : "Copy"}</button></div><p className="listing-description">{currentListing.description}</p></div>
          {currentListing.keyDetails.length > 0 && <div className="field-block"><div className="field-heading"><span>Key details</span><button onClick={() => copy(currentListing.keyDetails.join("\n"), "details")}>{copied === "details" ? "✓ Copied" : "Copy"}</button></div><ul>{currentListing.keyDetails.map((detail) => <li key={detail}>{detail}</li>)}</ul></div>}
          {activeTab === "ebay" && result.listings.ebay.itemSpecifics.length > 0 && <div className="field-block"><div className="field-heading"><span>Item specifics</span><button onClick={() => copy(result.listings.ebay.itemSpecifics.map((item) => `${item.key}: ${item.value}`).join("\n"), "specifics")}>{copied === "specifics" ? "✓ Copied" : "Copy"}</button></div><dl>{result.listings.ebay.itemSpecifics.map((item) => <div key={item.key}><dt>{item.key}</dt><dd>{item.value}</dd></div>)}</dl></div>}
          <button className="copy-listing" onClick={() => copy(listingToText(activeTab.toUpperCase(), currentListing, activeTab === "ebay" ? result.listings.ebay.itemSpecifics : undefined), "listing")}>{copied === "listing" ? "✓ Listing copied" : "Copy full listing"}</button>
        </div>}
      </div>
      <div className="price-card"><div><p className="eyebrow">PRICE RESEARCH</p><h3>Check what it’s selling for</h3><p>We don’t invent prices. Use this focused search to compare similar listings.</p><code>{result.searchQuery}</code></div><div className="search-actions">{searchLinks.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer">Search {label} <span>↗</span></a>)}</div></div>
      <div className="bottom-action"><button className="primary-button" onClick={reset}>Start another item <span>→</span></button></div>
    </section>}
    <footer><span>SellThis.</span><p>Photos in. Listings out. Nothing saved.</p></footer>
  </main>;
}
