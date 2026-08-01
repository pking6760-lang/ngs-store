#!/usr/bin/env node
// Keep catalog images off Supabase egress. New product/category photos upload to
// Supabase Storage (which serves no-cache on the Free plan). This mirrors any
// not-yet-mirrored image into the repo, pushes, and repoints products/categories
// image_url at jsDelivr's CDN (1-year immutable cache, pinned to the commit SHA).
//
// Run it after adding products:  SERVICE_KEY=... SUPABASE_URL=... node scripts/mirror-images.mjs
//
// Existing jsDelivr URLs keep working — each is pinned to its own SHA (immutable),
// so only the still-on-Supabase rows are repointed each run.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const REPO = "pking6760-lang/ngs-store";
const BUCKET = "product-images";
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SERVICE_KEY;
if (!URL_ || !KEY) { console.error("set SUPABASE_URL and SERVICE_KEY"); process.exit(1); }

const h = { Authorization: `Bearer ${KEY}`, apikey: KEY };
const git = (c) => execSync(`git ${c}`, { encoding: "utf8" }).trim();
const OLD_PREFIX = `${URL_}/storage/v1/object/public/${BUCKET}/`;

// List every object in the bucket (one page per folder; product photos are flat).
async function listAll(prefix = "") {
  const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: "POST", headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 2000, sortBy: { column: "name", order: "asc" } }),
  });
  const rows = await r.json();
  const out = [];
  for (const o of rows || []) {
    if (o.id === null) out.push(...await listAll(`${prefix}${o.name}/`)); // folder → recurse
    else out.push(`${prefix}${o.name}`);
  }
  return out;
}

const names = await listAll();
let fetched = 0;
for (const name of names) {
  if (existsSync(`img/${name}`)) continue;
  const r = await fetch(`${OLD_PREFIX}${name}`);
  if (!r.ok) { console.error(`skip ${name}: ${r.status}`); continue; }
  mkdirSync(dirname(`img/${name}`), { recursive: true });
  writeFileSync(`img/${name}`, Buffer.from(await r.arrayBuffer()));
  fetched++;
}
console.log(`mirrored ${fetched} new image(s)`);

git("add -f img/");
try { git(`commit -q -m "Mirror new catalog images for jsDelivr"`); }
catch { console.log("no new images to commit"); }
git("push origin HEAD");
const sha = git("rev-parse HEAD");
const NEW_PREFIX = `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/img/`;

// Repoint only rows still on Supabase (existing jsDelivr rows stay valid).
const sql = `update public.products set image_url = replace(image_url, '${OLD_PREFIX}', '${NEW_PREFIX}') where image_url like '${OLD_PREFIX}%';
update public.categories set image_url = replace(image_url, '${OLD_PREFIX}', '${NEW_PREFIX}') where image_url like '${OLD_PREFIX}%';`;
console.log("\nRepoint the DB by running this SQL (service role):\n\n" + sql);
