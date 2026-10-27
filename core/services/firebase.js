/**
 * The one module that loads Firebase, and the small interface everything else
 * reaches it through.
 *
 * Nothing outside this file imports a Firebase SDK. Callers get a handful of
 * operations on documents addressed by path — `get`, `list`, `commit` — plus
 * the sign-in calls, and every test injects a fake of exactly that shape. So
 * the SDK is never loaded in Node, and the code that decides *what* to sync is
 * tested without anything standing in for Google.
 *
 * Documents hold their payload as a JSON string (`{json, updatedAt}`), not as
 * Firestore maps. Stored records are whatever `chrome.storage.local` held, and
 * Firestore refuses shapes JSON allows — nested arrays, `undefined` — so a
 * string is the encoding that cannot fail on a record the extension already
 * considers valid. The 1 MiB document limit applies to it either way.
 *
 * Loaded lazily, and Firestore — ~580 KB of ~680 — only on first use, which in
 * practice means once someone is signed in. A signed-out page never loads it.
 */

// Vite replaces these at build time from `.env`; under Node they are undefined.
// None is a secret — a Firebase web config is meant to ship in the client, and
// `firestore.rules` is what protects the data.
const env = import.meta.env ?? {};
export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** Firestore caps a batch at 500 writes; this stays clear of it. */
const BATCH_LIMIT = 400;

let loaded = null;

/**
 * @returns {Promise<{
 *   currentUser(): Promise<{uid: string, email: string|null}|null>,
 *   signInWithGoogleToken(token: string): Promise<void>,
 *   signOut(): Promise<void>,
 *   onAuthChange(callback: () => void): () => void,
 *   get(path: string): Promise<object|null>,
 *   list(collectionPath: string): Promise<{id: string, data: object}[]>,
 *   commit(ops: ({set: string, data: object}|{remove: string})[]): Promise<void>,
 * }>}
 */
export function getFirebase(config = FIREBASE_CONFIG) {
  loaded ??= load(config);
  return loaded;
}

async function load(config) {
  const [{ initializeApp }, auth] = await Promise.all([
    import("firebase/app"),
    // The Manifest V3 entry point: the default one loads helper code from
    // Google at runtime for popup sign-in, which an extension may not do.
    import("firebase/auth/web-extension"),
  ]);
  const app = initializeApp(config);
  const a = auth.getAuth(app);

  let firestore = null;
  const db = async () => {
    firestore ??= import("firebase/firestore").then((store) => ({
      store,
      db: store.getFirestore(app),
    }));
    return firestore;
  };

  return {
    async currentUser() {
      await a.authStateReady();
      const user = a.currentUser;
      return user ? { uid: user.uid, email: user.email ?? null } : null;
    },
    async signInWithGoogleToken(token) {
      await auth.signInWithCredential(a, auth.GoogleAuthProvider.credential(null, token));
    },
    signOut: () => auth.signOut(a),
    // Fires once at once, then on every change — including one made on
    // another extension page, which Firebase notices through the IndexedDB
    // it persists the session in.
    onAuthChange: (callback) => auth.onAuthStateChanged(a, () => callback()),

    async get(path) {
      const { store, db: d } = await db();
      const snapshot = await store.getDoc(store.doc(d, path));
      return snapshot.exists() ? snapshot.data() : null;
    },
    async list(collectionPath) {
      const { store, db: d } = await db();
      const snapshot = await store.getDocs(store.collection(d, collectionPath));
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async commit(ops) {
      const { store, db: d } = await db();
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = store.writeBatch(d);
        for (const op of ops.slice(i, i + BATCH_LIMIT)) {
          if (op.remove) batch.delete(store.doc(d, op.remove));
          else batch.set(store.doc(d, op.set), op.data);
        }
        await batch.commit();
      }
    },
  };
}

/** A document's payload, encoded the one way every writer uses. */
export function encodeDoc(value, now = Date.now()) {
  return { json: JSON.stringify(value), updatedAt: now };
}

/** The inverse of `encodeDoc`. */
export function decodeDoc(data) {
  return data ? JSON.parse(data.json) : null;
}

/**
 * A short fingerprint of a value, to tell whether a document needs writing.
 *
 * This is what keeps a sync inside the free tier's 20,000 writes a day:
 * comparing against what was last written means a refresh that changed three
 * contests writes three documents, not one per tracked contest. FNV-1a over
 * the JSON; a collision would skip one write until the record next changes,
 * which is a cost of a few hours' staleness, not of data.
 */
export function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`;
}

/** Device-local bookkeeping lives under this prefix and never syncs or exports into another install. */
export const CLOUD_KEY_PREFIX = "upsolve_tracker.cloud.";
