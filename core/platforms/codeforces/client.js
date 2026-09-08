/**
 * How a request reaches Codeforces: two clients, and the signing.
 *
 * The signed JSON API and the one HTML page a hidden-standings gym reads are
 * different site surfaces with different rules — one works anonymously and is
 * never challenged, the other needs the session cookie, is Cloudflare-challenged,
 * and is throttled against the live site — so they are two clients. `sources.js`
 * reads through both; nothing else does.
 */
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

/**
 * The one client for every signed call, on both platforms.
 *
 * Through `services/site-client.js` like every other platform, with two
 * deliberate parameters: a direct `fetchImpl`, since the API works anonymously
 * and is never challenged, so routing it through a tab would add a dependency
 * it does not need; and `refusal: () => null`, since this API does not refuse
 * at the transport — a bad key comes back as a 200 with `status: "FAILED"`,
 * which `_callMethod` reads.
 *
 * `budget` rather than a bare pacer: two platforms each honouring a 2 s gap
 * would serve one request per second to codeforces.com. Naming a shared budget
 * makes every client on this host queue as one.
 */
export const ORIGIN = "https://codeforces.com";

/** The API publishes a rate limit; two seconds keeps every add inside it. */
const GAP_MS = 2000;

export const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: GAP_MS, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

/**
 * The second client, for the one page this platform still reads.
 *
 * Separate from `signed` because it is a different site surface with different
 * rules: it needs the session cookie and the page transport, Cloudflare
 * challenges it, and its throttling is tuned against the live HTML rather than
 * the API's published limit.
 *
 * **Do not shorten these delays when optimising.** `measureFrom: "end"` is
 * load-bearing for the same reason: it waits the full gap after each request
 * finishes rather than letting a slow page count towards the next gap.
 * `tests/request-pacer.test.js` fails if that is collapsed.
 */
/** Tuned against the live site; do not shorten when optimising. */
const PAGE_GAP_MS = [1000, 2500];
const COOLDOWN = { everyNth: 15, gapMs: [6000, 12000] };

const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

export const html = createSiteClient({
  // Routed through a Codeforces tab when one is open, so the request carries the
  // session and Cloudflare sees the user rather than a stranger. Falls back to a
  // direct fetch otherwise, which still reads anything public.
  site,
  pacer: {
    gapMs: PAGE_GAP_MS,
    measureFrom: "end",
    cooldown: COOLDOWN,
    onWait: ({ count, ms, isCooldown }) => {
      const seconds = (ms / 1000).toFixed(2);
      if (isCooldown) {
        // `info`, not `warn`. chrome://extensions collects warnings alongside
        // errors, so a normal add used to file a row there every 15 requests.
        console.info(`[Codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
      } else {
        console.log(`[Codeforces] Request ${count}: waiting ${seconds}s`);
      }
    },
  },

  /**
   * Cloudflare answers a challenge two ways, and both must be caught: a 403
   * with no useful body, or a 200 whose body is the interstitial. Measured
   * live — `cf-mitigated: challenge`, a page of scripts pointing at
   * challenges.cloudflare.com — so this is not a heuristic.
   *
   * Flagged rather than thrown bare. `contest-status.js` defines
   * `sourceUnreachable` as exactly this ("we failed to ask — network, 403,
   * anything"), but until the flag existed nothing converted the throw into
   * that status, so a challenge failed the add outright and was never retried.
   */
  refusal({ response, body }) {
    if (response.status !== 403 && !body.includes("Just a moment")) return null;
    return Object.assign(new Error(BLOCKED), { isSourceUnreachable: true });
  },
});

/**
 * The URL for one signed API call: `apiKey` and `time` appended, the query
 * sorted, and `apiSig` = six random digits + SHA-512 over
 * `rand/method?sortedParams#secret`. The secret signs the request and never
 * travels with it. `tests/platforms/codeforces/sources.test.js` pins the string
 * that is hashed, since a wrong signature comes back as an ordinary FAILED.
 */
export async function signedUrl({ apiKey, apiSecret }, methodName, params) {
  const time = Math.floor(Date.now() / 1000);
  const rand = Math.floor(100000 + Math.random() * 900000).toString();

  const authParams = { ...params, apiKey, time };
  const queryString = Object.keys(authParams)
    .sort()
    .map((key) => `${key}=${authParams[key]}`)
    .join("&");

  const apiSig = `${rand}${await sha512(`${rand}/${methodName}?${queryString}#${apiSecret}`)}`;
  return `${ORIGIN}/api/${methodName}?${queryString}&apiSig=${apiSig}`;
}

async function sha512(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
