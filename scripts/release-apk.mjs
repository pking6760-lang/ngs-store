#!/usr/bin/env node
// Publish a built APK by hosting it on jsDelivr's CDN (served from this repo),
// NOT Supabase Storage — so app downloads never count against the Supabase
// egress quota. Commits the APK into apk/, pushes, and points app_versions at
// the immutable jsDelivr URL pinned to that commit's SHA.
//
//   SERVICE_KEY=... SUPABASE_URL=... node scripts/release-apk.mjs \
//     --app customer --version 5.45 --code 87 --file path/to/app-release.apk \
//     --notes "What changed"
//
// KEEP is per app: releasing the customer app never prunes the partner's files.
// Old jsDelivr URLs keep working because each is pinned to its own commit SHA
// (immutable), so pruning a file from the working tree can't break past links.

import { readFileSync, copyFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const REPO = "pking6760-lang/ngs-store";
const KEEP = 2;
const NAME = { customer: "NGS-Customer", partner: "NGS-Partner", admin: "NGS-Admin" };

const arg = (k, req = true) => {
  const i = process.argv.indexOf(`--${k}`);
  if (i < 0 || !process.argv[i + 1]) {
    if (req) { console.error(`missing --${k}`); process.exit(1); }
    return null;
  }
  return process.argv[i + 1];
};

const URL_ = process.env.SUPABASE_URL, KEY = process.env.SERVICE_KEY;
if (!URL_ || !KEY) { console.error("set SUPABASE_URL and SERVICE_KEY"); process.exit(1); }

const app = arg("app"), version = arg("version"), code = Number(arg("code"));
const file = arg("file"), notes = arg("notes", false);
if (!NAME[app]) { console.error(`--app must be one of ${Object.keys(NAME)}`); process.exit(1); }
if (!(code > 0)) { console.error("--code must be a positive number"); process.exit(1); }
if (!existsSync(file)) { console.error(`file not found: ${file}`); process.exit(1); }

const git = (c) => execSync(`git ${c}`, { encoding: "utf8" }).trim();
const verOf = (n) => (n.match(/-v([\d.]+)\.apk$/)?.[1] || "0")
  .split(".").map(Number).reduce((a, x) => a * 1000 + x, 0);

// 1) Drop the APK into apk/ and prune old builds of THIS app beyond KEEP.
mkdirSync("apk", { recursive: true });
const objectName = `${NAME[app]}-v${version}.apk`;
copyFileSync(file, `apk/${objectName}`);
console.log(`staged apk/${objectName} (${(readFileSync(file).length / 1048576).toFixed(1)} MB)`);

const mine = readdirSync("apk").filter((n) => n.startsWith(`${NAME[app]}-v`))
  .sort((a, b) => verOf(b) - verOf(a));
const pruned = mine.slice(KEEP);
pruned.forEach((n) => rmSync(`apk/${n}`));
if (pruned.length) console.log(`pruned old build(s): ${pruned.join(", ")}`);

// 2) Commit + push. The commit SHA pins an immutable jsDelivr URL.
git("add -f apk/");
try { git(`commit -q -m "Release ${app} ${version} (${code}) APK"`); }
catch { console.log("nothing to commit (identical file?) — continuing"); }
git("push origin HEAD");
const sha = git("rev-parse HEAD");
const apkUrl = `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/apk/${objectName}`;
console.log(`jsDelivr URL: ${apkUrl}`);

// 3) Point the app at it (admin RPC, or direct upsert with the service key).
const h = { Authorization: `Bearer ${KEY}`, apikey: KEY };
const api = async (path, init = {}) => {
  const r = await fetch(`${URL_}${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
};
await api(`/rest/v1/rpc/admin_publish_app_version`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ p_app: app, p_version_name: version, p_version_code: code,
                         p_apk_url: apkUrl, p_notes: notes }),
}).catch(async () => {
  await api(`/rest/v1/app_versions?on_conflict=app`, {
    method: "POST", headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ app, version_name: version, version_code: code,
                           apk_url: apkUrl, release_notes: notes, updated_at: new Date().toISOString() }),
  });
});
console.log(`published ${app} ${version} (${code}) → jsDelivr`);
