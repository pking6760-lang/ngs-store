import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone bundle of ONLY the NGS Partner app, for the Capacitor partner APK.
export default defineConfig({
  plugins: [react()],
  base: "",
  build: {
    outDir: "www-partner",
    emptyOutDir: true,
    rollupOptions: { input: { partner: "partner.html" } },
  },
});
