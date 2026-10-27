import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "hrig-dev-csp",
      apply: "serve",
      transformIndexHtml(html) {
        // React Fast Refresh injects a module preamble only during development.
        return html.replace(
          "script-src 'self'",
          "script-src 'self' 'unsafe-inline'",
        );
      },
    },
  ],
  base: "./",
  server: { host: "127.0.0.1", port: 5179, strictPort: true },
  build: { outDir: "dist" },
});
