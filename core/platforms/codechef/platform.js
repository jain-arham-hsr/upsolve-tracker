import { Platform } from "../platform.js";
import { codechef } from "./descriptor.js";
import * as identity from "./identity.js";
import * as problems from "./problems.js";
import * as submissions from "./submissions.js";
import { sources } from "./sources.js";

export class CodeChef extends Platform {
  static settingsSection = "codechef";

  constructor() {
    super(codechef);
    this.sources = sources;
  }

  buildSession(values) {
    return identity.createSessionFrom(values);
  }

  identify(session) {
    return identity.verifyIdentity(session);
  }

  describeIdentity(identity) {
    return `Signed in as ${identity.username}.`;
  }

  fetchContest(args) {
    return problems.fetchContest(args);
  }

  fetchAccepted(session, contests, onProgress) {
    return submissions.fetchAccepted(session, contests, onProgress);
  }

  syncMetadata(session, contests, onProgress) {
    return problems.syncMetadata(session, contests, onProgress);
  }
}
