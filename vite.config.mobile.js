import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const OUT_DIR = "www";

// Build config for the Android admin app (packaged with Capacitor).
// Produces a standalone bundle of ONLY the admin dashboard into `www/`,
// with relative asset paths so it loads correctly inside the Android WebView.

// public/ngs.apk is a 25 MB copy of an older release kept for the website's
// direct-download link. Vite copies everything in public/ into the output, so
// without this it would be packaged INSIDE the native app too — tripling the
// download for a file the app can never use.
const dropBundledApk = {
  name: "drop-bundled-apk",
  apply: "build",
  generateBundle(_opts, bundle) {
    for (const name of Object.keys(bundle)) {
      if (name.toLowerCase().endsWith(".apk")) delete bundle[name];
    }
  },
  closeBundle() {
    const fs = require("node:fs"), path = require("node:path");
    const dir = path.resolve(OUT_DIR);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith(".apk")) fs.rmSync(path.join(dir, f), { force: true });
    }
  },
};

export default defineConfig({
  plugins: [react(), dropBundledApk],
  base: "", // relative paths ("./assets/...") for the WebView
  build: {
    outDir: "www",
    emptyOutDir: true,
    rollupOptions: {
      input: { admin: "admin.html" },
    },
  },
});
