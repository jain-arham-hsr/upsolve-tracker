/**
 * Maps a platform id to its adapter: how to authenticate, fetch a contest and
 * read solved history for that site.
 *
 * Kept separate from registry.js on purpose. The registry is pure — URLs,
 * identity, capabilities — and is imported by things like backup-validation
 * that must not drag the network stack in with them. Only the orchestrators
 * need this module.
 */
import * as codeforces from "./codeforces/adapter.js";

const ADAPTERS = { codeforces };

export function getAdapter(platformId) {
  return ADAPTERS[platformId] ?? null;
}
