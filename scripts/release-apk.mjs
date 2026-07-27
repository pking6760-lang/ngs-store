#!/usr/bin/env node
// Publish a built APK: upload it, point the apps at it, and delete the old ones.
//
// The last step is the point. Every release used to leave its APK in storage
// forever — 47 files and 1.45 GB had accumulated, past the 1 GB the free plan
// includes, for builds nobody could install any more. Keeping the current
// release plus one rollback is all that is ever needed, and doing it here means
// it cannot be forgotten.
//
//   SUPABASE_URL=... SERVICE_KEY=... node scripts/release-apk.mjs \
//     --app customer --version 3.6 --code 28 --file path/to/app-release.apk \
//     --notes "What changed"
//
// KEEP is per app, so releasing the customer app never touches the partner's.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const KEEP = 2;
const NAME = { customer: "NGS-Customer", partner: "NGS-Partner", admin: "NGS-Admin" };
const BUCKET = "app-releases";

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

const h = { Authorization: `Bearer ${KEY}`, apikey: KEY };
const api = async (path, init = {}) => {
  const r = await fetch(`${URL_}${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
};

const objectName = `${NAME[app]}-v${version}.apk`;
const bytes = await readFile(file);
console.log(`uploading ${basename(file)} as ${objectName} (${(bytes.length / 1048576).toFixed(1)} MB)`);

await api(`/storage/v1/object/${BUCKET}/${objectName}`, {
  method: "POST",
  headers: { "content-type": "application/vnd.android.package-archive", "x-upsert": "true" },
  body: bytes,
});

const apkUrl = `${URL_}/storage/v1/object/public/${BUCKET}/${objectName}`;
await api(`/rest/v1/rpc/admin_publish_app_version`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ p_app: app, p_version_name: version, p_version_code: code,
                         p_apk_url: apkUrl, p_notes: notes }),
}).catch(async () => {
  // The RPC is admin-gated; with the service key, write the row directly.
  await api(`/rest/v1/app_versions?on_conflict=app`, {
    method: "POST",
    headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ app, version_name: version, version_code: code,
                           apk_url: apkUrl, release_notes: notes,
                           updated_at: new Date().toISOString() }),
  });
});
console.log(`published ${app} ${version} (${code})`);

// Prune: keep the newest KEEP builds of THIS app only.
const list = await api(`/storage/v1/object/list/${BUCKET}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prefix: "", limit: 1000, sortBy: { column: "created_at", order: "desc" } }),
});
// Order by the VERSION in the filename, not by when it was uploaded. Re-uploading
// an old build (a rollback, a re-signed file) would otherwise make it look like
// the newest and get the real latest release deleted.
const verOf = (n) => (n.match(/-v([\d.]+)\.apk$/)?.[1] || "0")
  .split(".").map(Number).reduce((a, x) => a * 1000 + x, 0);
const mine = (list || []).filter((o) => o.name.startsWith(`${NAME[app]}-v`))
  .sort((a, b) => verOf(b.name) - verOf(a.name));
// Never prune the build the apps are currently pointed at, whatever the sort
// order says. Deleting that would break every update link at once.
const live = (await api(`/rest/v1/app_versions?app=eq.${app}&select=apk_url`))?.[0]?.apk_url || "";
const stale = mine.slice(KEEP).filter((o) => !live.endsWith(`/${o.name}`));
if (stale.length) {
  await api(`/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefixes: stale.map((o) => o.name) }),
  });
  const mb = stale.reduce((s, o) => s + (o.metadata?.size || 0), 0) / 1048576;
  console.log(`removed ${stale.length} old build(s), ${mb.toFixed(0)} MB: ${stale.map((o) => o.name).join(", ")}`);
} else {
  console.log("nothing to prune");
}
