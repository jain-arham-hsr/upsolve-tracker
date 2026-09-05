import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import fs from "fs";
import { listPlatforms } from "./core/platforms/registry.js";

// Fallback to chrome if no target is specified
const target = process.env.TARGET || "chrome";

// Dynamically point to the correct manifest based on the target
const manifestPath = resolve(__dirname, `targets/${target}/manifest.json`);

// Read and parse the manifest manually so we can feed it to the CRX plugin
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

// Which origins the extension may talk to is the sum of what its platforms
// need, so it is composed here rather than hand-listed in the manifest. Chrome
// requires these declared statically, but nothing requires a human to keep the
// list in step — and "remember to also edit the manifest" is exactly the kind
// of step that gets missed when a platform is added.
//
// Deduplicated, because two platforms can name one origin: Codeforces is
// `codeforces-official` and `codeforces-gyms`, both on codeforces.com. Chrome
// tolerates a repeat, but the composed list is diffed against the previous
// build to prove nothing drifted, and a duplicate would read as drift.
const origins = [...new Set(listPlatforms().flatMap((platform) => platform.hostPermissions))];

manifest.host_permissions = origins;

// The same list, as content script matches. A request issued from inside a page
// on the site is same-site, so the browser sends the user's cookies; one issued
// from the panel is cross-site and arrives anonymous. Composed here for the same
// reason host_permissions is: a new platform must not depend on someone
// remembering to also edit the manifest.
manifest.content_scripts = [
  {
    matches: origins,
    js: ["targets/chrome/content-script.js"],
    run_at: "document_idle",
  },
];

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
