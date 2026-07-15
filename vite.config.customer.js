import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build config for the native CUSTOMER app (Android + iOS via Capacitor).
// Produces a standalone bundle of the customer storefront into `www-customer/`
// with relative asset paths so it loads inside the native WebView. The app
// entry is index.html (customer), so no post-rename is needed.
export default defineConfig({
  plugins: [react()],
  base: "", // relative "./assets/..." for the WebView
  build: {
    outDir: "www-customer",
    emptyOutDir: true,
    rollupOptions: {
      input: { main: "index.html" },
    },
  },
});
