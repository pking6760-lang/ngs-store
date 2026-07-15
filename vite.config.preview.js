import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the CUSTOMER storefront into a single self-contained index.html
// (all JS + CSS inlined) for a shareable preview.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "preview",
    emptyOutDir: true,
    rollupOptions: {
      input: { index: "index.html" },
    },
  },
});
