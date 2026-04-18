import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import fs from "fs";

// Fallback to chrome if no target is specified
const target = process.env.TARGET || "chrome";

// Dynamically point to the correct manifest based on the target
const manifestPath = resolve(__dirname, `targets/${target}/manifest.json`);

// Read and parse the manifest manually so we can feed it to the CRX plugin
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      // Create a shortcut so you can import core files easily
      // Example: import fetcher from '@core/services/fetcher.js'
      "@core": resolve(__dirname, "core"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
    cors: true,
  },
  build: {
    // Output the build to a target-specific folder (e.g., dist/chrome)
    outDir: resolve(__dirname, `dist/${target}`),
    emptyOutDir: true,
  },
});
