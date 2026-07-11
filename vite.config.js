import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // Two separate websites, one build:
        main: "index.html", //     customer storefront  →  /
        admin: "admin.html", //    admin dashboard      →  /admin.html
        partner: "partner.html", //  NGS Partner (staff)  →  /partner.html
      },
    },
  },
});
