#!/usr/bin/env node
// Assert a built APK actually contains what it needs to run.
//
//   node scripts/check-apk.mjs android/app/build/outputs/apk/release/app-release.apk
//
// WHY THIS EXISTS. A Cordova plugin is two halves: Java compiled into the app,
// and a JavaScript shim injected into the WebView that talks to it. Capacitor
// generates that second half — cordova.js, cordova_plugins.js and
// public/plugins/** — into android/app/src/main/assets/public when you run
// `cap sync`. That directory is in .gitignore, so those files exist ONLY as a
// build product.
//
// Building by hand with
//
//     rm -rf android/app/src/main/assets/public/* && cp -r www/* .../public/
//
// deletes them and never puts them back, because they are not in www/. The APK
// then compiles, installs and runs perfectly — with window.bluetoothSerial
// undefined, so every thermal print fails with "Bluetooth not available on this
// device" and nothing in the build says a word about it.
//
// That is the exact failure this file exists to make impossible. Build the
// admin app with `npm run sync:android`, not by copying www/ over the assets.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const apk = process.argv[2];
if (!apk || !existsSync(apk)) {
  console.error("usage: node scripts/check-apk.mjs <path-to.apk>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const cordovaPlugins = Object.keys(pkg.dependencies || {}).filter((d) => d.startsWith("cordova-"));

const listing = execSync(`unzip -l ${JSON.stringify(apk)}`, { encoding: "utf8" });
const has = (p) => listing.includes(p);

const problems = [];

// Which app is this? Read it out of the APK rather than guessing from the path.
// (A first version of this check looked for Java package names in the zip's FILE
// LISTING, where they can never appear — so it passed the very build it was
// written to catch. Hence: read a fact, don't pattern-match a filename.)
let appId = "";
try {
  appId = JSON.parse(execSync(`unzip -p ${JSON.stringify(apk)} assets/capacitor.config.json`,
    { encoding: "utf8" })).appId || "";
} catch { /* reported below as a missing config */ }

// Only the admin app ships a Cordova plugin. Customer and partner use Capacitor
// plugins only, which ride inside the JS bundle and need no injected shim.
const CORDOVA_APPS = ["com.ngsstore.admin"];

if (cordovaPlugins.length) {
  if (CORDOVA_APPS.includes(appId)) {
    for (const f of ["assets/public/cordova.js", "assets/public/cordova_plugins.js"]) {
      if (!has(f)) problems.push(`missing ${f} — run 'npm run sync:android', not a manual copy of www/`);
    }
    for (const p of cordovaPlugins) {
      if (!has(`assets/public/plugins/${p}/`)) {
        problems.push(`missing assets/public/plugins/${p}/ — the plugin's JS shim is absent, so its window.* global will be undefined at runtime`);
      }
    }
  }
}

// The web app itself must be in there.
if (!has("assets/public/index.html")) problems.push("missing assets/public/index.html — no web app in this APK");
if (!has("assets/capacitor.config.json")) problems.push("missing assets/capacitor.config.json");

if (problems.length) {
  console.error("APK CHECK FAILED\n" + problems.map((p) => "  ✗ " + p).join("\n"));
  process.exit(1);
}
console.log(`APK check passed: ${apk}  (${appId || "unknown appId"})`);
if (cordovaPlugins.length && CORDOVA_APPS.includes(appId)) {
  console.log(`  cordova bridge present for: ${cordovaPlugins.join(", ")}`);
}
