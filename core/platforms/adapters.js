/**
 * Composes each platform's modules into the adapter the orchestrators consume.
 *
 * Kept separate from registry.js on purpose. The registry is pure — URLs,
 * identity, capabilities — and is imported by things like backup-validation
 * that must not drag the network stack in with them. Only the orchestrators
 * need this module.
 *
 * Every platform supplies the same three modules and, where it has one, an
 * estimator. `pipeline.js` owns what is identical across all of them; the rest
 * of the file is a manifest you can read in one glance to see which platform
 * provides what. A platform missing a piece fails here, at import, rather than
 * at some later call — which is why no separate validator is needed.
 */
import { buildAdapter } from "./pipeline.js";
import { codeforces } from "./codeforces/descriptor.js";
import { atcoder } from "./atcoder/descriptor.js";
import { codechef } from "./codechef/descriptor.js";

import * as cfProblems from "./codeforces/problems.js";
import * as cfSubmissions from "./codeforces/submissions.js";
import * as cfIdentity from "./codeforces/identity.js";
import * as cfEstimator from "./codeforces/estimator.js";

import * as acProblems from "./atcoder/problems.js";
import * as acSubmissions from "./atcoder/submissions.js";
import * as acIdentity from "./atcoder/identity.js";
import * as acEstimator from "./atcoder/estimator.js";

import * as ccProblems from "./codechef/problems.js";
import * as ccSubmissions from "./codechef/submissions.js";
import * as ccIdentity from "./codechef/identity.js";

const ADAPTERS = {
  codeforces: buildAdapter(codeforces, {
    problems: cfProblems,
    submissions: cfSubmissions,
    identity: cfIdentity,
    estimator: cfEstimator,
  }),

  // AtCoder publishes no difficulty at all, so every rating here is fitted
  // locally from the contest's own standings.
  atcoder: buildAdapter(atcoder, {
    problems: acProblems,
    submissions: acSubmissions,
    identity: acIdentity,
    estimator: acEstimator,
  }),

  // No estimator: CodeChef publishes `difficulty_rating`, and promptly.
  codechef: buildAdapter(codechef, {
    problems: ccProblems,
    submissions: ccSubmissions,
    identity: ccIdentity,
  }),
};

export function getAdapter(platformId) {
  return ADAPTERS[platformId] ?? null;
}
