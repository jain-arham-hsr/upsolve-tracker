/**
 * One instance per platform. This and `registry.js` are the only modules that
 * enumerate platforms; everything else asks.
 *
 * Kept apart from `registry.js` on purpose: the registry is pure — URLs,
 * identity, capabilities — and is imported by things like backup-validation
 * that must not drag the network stack in. Only the orchestrators need this.
 */
import { CodeforcesOfficial } from "./codeforces/official/platform.js";
import { CodeforcesGyms } from "./codeforces/gyms/platform.js";
import { AtCoder } from "./atcoder/platform.js";
import { CodeChef } from "./codechef/platform.js";

const INSTANCES = [
  new CodeforcesOfficial(),
  new CodeforcesGyms(),
  new AtCoder(),
  new CodeChef(),
];

const BY_ID = new Map(INSTANCES.map((platform) => [platform.id, platform]));

/** @returns {import("./platform.js").Platform|null} */
export function getAdapter(platformId) {
  return BY_ID.get(platformId) ?? null;
}
