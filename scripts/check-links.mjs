#!/usr/bin/env node
/**
 * Checks the built site (dist/) for broken internal links, missing assets and missing #anchors,
 * and for root-relative URLs that forgot the GitHub Pages base path.
 * Usage: npm run test:links   (after npm run build)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const BASE = (process.env.SITE_BASE ?? "/mule-learning-web").replace(/\/?$/, "/");
if (!fs.existsSync(DIST)) {
  console.error("dist/ not found — run npm run build first");
  process.exit(2);
}

// pages are encrypted (scripts/protect.mjs): open them with whichever key built them, so their links get checked too
const KEYS = [process.env.SITE_KEY, fs.existsSync(path.join(ROOT, ".site-key")) ? fs.readFileSync(path.join(ROOT, ".site-key"), "utf8") : "", "dGVzdC1zaXRlLWtleS1mb3ItZTJlLXRlc3RzLW9ubHk="]
  .filter(Boolean).map((k) => Buffer.from(k.trim(), "base64"));
function unseal(b64) {
  const bytes = Buffer.from(b64, "base64");
  for (const key of KEYS) {
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      d.setAuthTag(bytes.subarray(bytes.length - 16));
      return zlib.inflateRawSync(Buffer.concat([d.update(bytes.subarray(12, bytes.length - 16)), d.final()])).toString("utf8");
    } catch {
      /* try the next key */
    }
  }
  throw new Error("an encrypted page could not be opened with any known key");
}
function readHtml(file) {
  const html = fs.readFileSync(file, "utf8");
  return html.replace(/<script type="application\/octet-stream" data-sealed>([^<]*)<\/script>/, (_, b64) => unseal(b64));
}

const htmlFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!["pagefind", "notes-assets", "_astro"].includes(e.name)) walk(p);
    } else if (e.name.endsWith(".html")) htmlFiles.push(p);
  }
})(DIST);

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readHtml(file);
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decodeEntities(m[1]))));
  }
  return idCache.get(file);
}
const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x3C;|&lt;/g, "<").replace(/&gt;/g, ">");

function targetFile(urlPath) {
  let rel = decodeURIComponent(urlPath.slice(BASE.length));
  const p = path.join(DIST, rel);
  if (rel === "" || rel.endsWith("/")) return path.join(p, "index.html");
  return p;
}

const problems = [];
let checked = 0;
for (const file of htmlFiles) {
  const html = readHtml(file);
  const page = "/" + path.relative(DIST, file).replace(/index\.html$/, "").replace(/\\/g, "/");
  for (const m of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    const raw = decodeEntities(m[2]);
    if (!raw || /^(https?:|mailto:|data:|javascript:|blob:|\/\/)/i.test(raw)) continue;
    checked++;
    const [pathPart, hash] = raw.split("#");
    if (raw.startsWith("#")) {
      if (hash && !idsOf(file).has(decodeURIComponent(hash))) problems.push(`${page}: missing anchor ${raw}`);
      continue;
    }
    if (!pathPart.startsWith("/")) {
      problems.push(`${page}: relative URL ${raw} (use base-prefixed URLs)`);
      continue;
    }
    if (!pathPart.startsWith(BASE)) {
      problems.push(`${page}: URL without base path ${raw}`);
      continue;
    }
    const target = targetFile(pathPart.split("?")[0]);
    if (!fs.existsSync(target)) {
      problems.push(`${page}: broken ${m[1]} ${raw}`);
      continue;
    }
    if (hash && target.endsWith(".html") && !idsOf(target).has(decodeURIComponent(hash))) problems.push(`${page}: missing anchor ${raw}`);
  }
}

const unique = [...new Set(problems)];
console.log(`checked ${checked} internal URLs in ${htmlFiles.length} pages`);
if (unique.length) {
  console.log(`${unique.length} problem(s):`);
  for (const p of unique.slice(0, 200)) console.log("  " + p);
  process.exit(1);
}
console.log("no broken internal links");
