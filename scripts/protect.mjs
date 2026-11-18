#!/usr/bin/env node
/**
 * Members only, for real: after the build, every page's content (<main>), the JSON data (questions, glossary) and the
 * search index are encrypted with the site key (AES-256-GCM, compressed first). Only the sign-in page stays readable.
 * Signed-in members get the key from Firebase (Firestore config/site, readable only when signed in), and
 * src/client/seal.ts decrypts in the browser. Without it, the published files hold nothing readable.
 *
 *   node scripts/protect.mjs dist
 *
 * The key (32 random bytes, base64): env SITE_KEY, else the gitignored file .site-key. The test build uses a fixed
 * test key (tests/e2e/site-key.ts). With no key this fails, so an unprotected site is never published.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const TEST_SITE_KEY = "dGVzdC1zaXRlLWtleS1mb3ItZTJlLXRlc3RzLW9ubHk="; // "test-site-key-for-e2e-tests-only"

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/protect.mjs <built site folder>");
  process.exit(1);
}
const keyB64 = (process.env.SITE_KEY || (fs.existsSync(".site-key") ? fs.readFileSync(".site-key", "utf8") : "")).trim();
if (!keyB64) {
  console.error("protect: no site key. Set SITE_KEY (GitHub secret) or create .site-key; see CLAUDE.md, 'Protected content'.");
  process.exit(1);
}
const key = Buffer.from(keyB64, "base64");
if (key.length !== 32) {
  console.error("protect: the site key must be 32 bytes, base64-encoded");
  process.exit(1);
}

/** compress (unless already compressed), then AES-256-GCM: iv (12 bytes) + ciphertext + tag, the layout WebCrypto expects */
function seal(bytes, compress = true) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(compress ? zlib.deflateRawSync(bytes, { level: 9 }) : bytes), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}

// pages that must stay readable without signing in
const OPEN = new Set(["account/index.html", "404.html"]);
const MAIN = /(<main\b[^>]*>)([\s\S]*?)(<\/main>)/;
const stats = { pages: 0, json: 0, search: 0 };

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else handle(p, path.relative(dir, p).split(path.sep).join("/"));
  }
}

function handle(file, rel) {
  if (rel.endsWith(".html")) {
    if (OPEN.has(rel)) return;
    const html = fs.readFileSync(file, "utf8");
    const m = html.match(MAIN);
    if (!m || m[2].includes("data-sealed")) return;
    // the tab title and description name the lesson: they go inside too, and come back when the page opens
    const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
    const inner = `<template data-page-title>${title}</template><template data-page-desc>${desc}</template>${m[2]}`;
    const sealed = seal(Buffer.from(inner, "utf8")).toString("base64");
    const out = html
      .replace(MAIN, `$1<script type="application/octet-stream" data-sealed>${sealed}</script>$3`)
      .replace(/<title>[\s\S]*?<\/title>/, "<title>Mule Learning Hub</title>")
      .replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="Members only."');
    fs.writeFileSync(file, out);
    stats.pages++;
  } else if (/^(interview|glossary|mcq)\.json$/.test(rel)) {
    const sealed = seal(fs.readFileSync(file)).toString("base64");
    fs.writeFileSync(file, JSON.stringify({ sealed }));
    stats.json++;
  } else if (/^pagefind\/.*\.(pf_fragment|pf_index|pf_filter|pf_meta)$/.test(rel)) {
    // already gzip-compressed by pagefind
    fs.writeFileSync(file, seal(fs.readFileSync(file), false));
    stats.search++;
  }
}

walk(dir);
if (!stats.pages) {
  console.error("protect: no pages were encrypted; is this the right folder?");
  process.exit(1);
}
console.log(`protect: encrypted ${stats.pages} pages, ${stats.json} data files and ${stats.search} search files in ${dir}`);
