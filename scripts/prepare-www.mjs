// After building the admin bundle, Vite emits `www/admin.html`.
// Capacitor loads `index.html` as the app entry point, so rename it.
import { rename, access } from "node:fs/promises";
import { constants } from "node:fs";

const from = new URL("../www/admin.html", import.meta.url);
const to = new URL("../www/index.html", import.meta.url);

try {
  await access(from, constants.F_OK);
  await rename(from, to);
  console.log("prepare-www: www/admin.html -> www/index.html");
} catch (err) {
  console.error("prepare-www: expected www/admin.html to exist:", err.message);
  process.exit(1);
}
