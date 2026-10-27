/**
 * An in-memory stand-in for the interface `services/firebase.js` exposes —
 * documents by path, a signed-in user, and a log of every write, so a test can
 * assert not just what ended up stored but how many writes it took. The write
 * count is the point for sync: the free tier allows 20,000 a day.
 */
export function fakeFirebase({ user = { uid: "u1", email: "a@b.c" }, docs = {}, owner = null } = {}) {
  const store = new Map(Object.entries(docs));
  if (owner) store.set("config/owner", { uid: owner });
  const writes = [];
  let current = user;
  let failing = null;

  return {
    store,
    writes,
    fail(error) { failing = error; },
    signInAs(next) { current = next; },

    async currentUser() { return current; },
    async signInWithGoogleToken() {},
    async signOut() { current = null; },
    async get(path) {
      if (failing) throw failing;
      return store.has(path) ? structuredClone(store.get(path)) : null;
    },
    async list(collectionPath) {
      if (failing) throw failing;
      const prefix = `${collectionPath}/`;
      return [...store.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: structuredClone(data) }));
    },
    async commit(ops) {
      if (failing) throw failing;
      for (const op of ops) {
        writes.push(op.remove ? `remove ${op.remove}` : `set ${op.set}`);
        if (op.remove) store.delete(op.remove);
        else store.set(op.set, structuredClone(op.data));
      }
    },
  };
}

/** chrome.storage.local, in memory, with the `remove` the sync needs. */
export function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(query) {
      if (query == null) return structuredClone(data);
      if (typeof query === "string") return { [query]: structuredClone(data[query]) };
      if (Array.isArray(query)) return Object.fromEntries(query.map((k) => [k, structuredClone(data[k])]));
      return Object.fromEntries(
        Object.entries(query).map(([k, fallback]) => [k, k in data ? structuredClone(data[k]) : fallback]),
      );
    },
    async set(patch) { Object.assign(data, structuredClone(patch)); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
  };
}

/** Options that make `account.js` treat the build as configured. */
export const CONFIGURED = {
  config: { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" },
  manifest: { oauth2: { client_id: "c" } },
};
