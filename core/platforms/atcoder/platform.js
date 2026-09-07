import { Platform } from "../platform.js";
import { atcoder } from "./descriptor.js";
import * as identity from "./identity.js";
import * as problems from "./problems.js";
import * as submissions from "./submissions.js";
import * as estimator from "./estimator.js";
import { sources } from "./sources.js";

export class AtCoder extends Platform {
  static settingsSection = "atcoder";

  constructor() {
    super(atcoder);
    this.sources = sources;
  }

  buildSession(values) {
    return identity.createSessionFrom(values);
  }

  identify(session) {
    return identity.verifyIdentity(session);
  }

  fetchContest(args) {
    return problems.fetchContest(args);
  }

  fill(args) {
    return estimator.fill(args);
  }

  fetchAccepted(session, contests, onProgress) {
    return submissions.fetchAccepted(session, contests, onProgress);
  }

  syncMetadata(session, contests, onProgress) {
    return problems.syncMetadata(session, contests, onProgress);
  }
}
