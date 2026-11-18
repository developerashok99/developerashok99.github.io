/**
 * Opens the encrypted content (scripts/protect.mjs) with the site key that signed-in members get from Firebase
 * (src/client/account.ts saves it on this device next to the sign-in, and removes it on sign-out).
 * Pages: <main> holds <script data-sealed>; it's decrypted before the page's own code runs (app.ts) and, for
 * client-side navigation, before the new page is swapped in. Data files: { sealed }. Search files: raw bytes.
 */
export const SITE_KEY = "mls.siteKey";

let keyP: Promise<CryptoKey> | null = null;
let keyRaw = "";
function cryptoKey(): Promise<CryptoKey> | null {
  let raw = "";
  try {
    raw = localStorage.getItem(SITE_KEY) ?? "";
  } catch {
    /* storage blocked */
  }
  if (!raw) return null;
  if (raw !== keyRaw) {
    keyRaw = raw;
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    keyP = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
  }
  return keyP;
}

/** waits (up to `ms`) for the key to arrive, e.g. right after signing in on a fresh device */
async function waitForKey(ms = 15_000): Promise<CryptoKey> {
  const end = Date.now() + ms;
  for (;;) {
    const k = cryptoKey();
    if (k) return k;
    if (Date.now() > end) throw new Error("no site key");
    await new Promise((r) => setTimeout(r, 150));
  }
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function open(bytes: Uint8Array, inflate: boolean): Promise<ArrayBuffer> {
  const key = await waitForKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  if (!inflate) return plain;
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

/** Tells the page the content couldn't be opened (wrong or missing key), so account.ts can fetch the key again. */
function failed(e: unknown) {
  console.warn("could not open the content", e);
  document.dispatchEvent(new CustomEvent("mls:unseal-failed"));
}

/** Decrypts a page's <main> in place. Resolves when done (straight away if it isn't encrypted). */
export async function unsealDocument(doc: Document): Promise<boolean> {
  const box = doc.querySelector<HTMLScriptElement>("main script[data-sealed]");
  if (!box) return true;
  try {
    const html = new TextDecoder().decode(await open(fromB64(box.textContent ?? ""), true));
    const main = box.parentElement!;
    // a <template> keeps it inert while it's parsed; then the real nodes go in
    const t = doc.createElement("template");
    t.innerHTML = html;
    // the real tab title and description travel inside the encrypted part
    const title = t.content.querySelector("template[data-page-title]");
    const desc = t.content.querySelector("template[data-page-desc]");
    if (title) {
      doc.title = (title as HTMLTemplateElement).innerHTML.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      title.remove();
    }
    if (desc) {
      doc.querySelector('meta[name="description"]')?.setAttribute("content", (desc as HTMLTemplateElement).innerHTML);
      desc.remove();
    }
    main.replaceChildren(t.content);
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/** fetch() for the encrypted data files: interview.json, glossary.json, mcq.json */
export async function fetchSealedJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  const body = (await r.json()) as { sealed?: string } | T;
  if (!body || typeof body !== "object" || !("sealed" in (body as object))) return body as T;
  try {
    return JSON.parse(new TextDecoder().decode(await open(fromB64((body as { sealed: string }).sealed), true))) as T;
  } catch (e) {
    failed(e);
    throw e;
  }
}

/** Search (Pagefind) fetches its index and result files itself: decrypt those on the way in. */
let patched = false;
function patchFetch() {
  if (patched) return;
  patched = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await real(input, init);
    if (!res.ok || !/\/pagefind\/.*\.(pf_fragment|pf_index|pf_filter|pf_meta)(\?|$)/.test(url)) return res;
    const bytes = new Uint8Array(await res.arrayBuffer());
    try {
      return new Response(await open(bytes, false), { status: 200, headers: res.headers });
    } catch {
      // not encrypted (a development build): hand back what came
      return new Response(bytes, { status: 200, headers: res.headers });
    }
  };
}

/** Called once when the site's code starts. */
export function setupSeal() {
  patchFetch();
  // client-side navigation: decrypt the next page before it's swapped in, so its code sees the real content
  document.addEventListener("astro:before-preparation", (e) => {
    const ev = e as Event & { loader: () => Promise<void>; newDocument: Document };
    const load = ev.loader;
    ev.loader = async () => {
      await load();
      await unsealDocument(ev.newDocument);
    };
  });
}
