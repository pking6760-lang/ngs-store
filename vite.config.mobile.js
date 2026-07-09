import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build config for the Android admin app (packaged with Capacitor).
// Produces a standalone bundle of ONLY the admin dashboard into `www/`,
// with relative asset paths so it loads correctly inside the Android WebView.
export default defineConfig({
  plugins: [react()],
  base: "", // relative paths ("./assets/...") for the WebView
  build: {
    outDir: "www",
    emptyOutDir: true,
    rollupOptions: {
      input: { admin: "admin.html" },
    },
  },
});
