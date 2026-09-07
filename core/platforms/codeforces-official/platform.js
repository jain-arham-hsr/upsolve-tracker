import { Platform } from "../platform.js";
import { codeforcesOfficial } from "./descriptor.js";
import * as identity from "./identity.js";
import * as problems from "./problems.js";
import * as submissions from "./submissions.js";
import * as estimator from "./estimator.js";

export class CodeforcesOfficial extends Platform {
  static settingsSection = "codeforces";

  constructor() {
    super(codeforcesOfficial);
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
