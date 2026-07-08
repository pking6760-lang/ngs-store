import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The admin app lives in this subfolder but shares the root node_modules and the
// ../shared code with the customer app. `fs.allow` lets Vite serve those parents.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [".."] },
  },
});
