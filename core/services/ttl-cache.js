/**
 * Reuse a response for a short window, then ask again.
 *
 * Two platforms had grown the same eleven lines independently — the same
 * `{body, at}` entry, the same `Date.now() - at < ttl` predicate, the same
 * `60 * 1000`, and the same clear-for-tests seam. CodeChef keyed its by contest
 * code, Codeforces held a single slot, which is the same thing with one key.
 *
 * **Deliberately short, and deliberately not a general cache.** Both callers
 * want the same thing: one add reads a payload two or three times, and paying
 * for it twice is waste, while holding it beyond the add would make a *stale*
 * answer outlive the question. Codeforces' is a publication check, where a
 * stale "not published yet" strands a contest for the length of the window.
 *
 * It does **not** dedupe in-flight requests. Two concurrent misses both fetch,
 * which is what the previous hand-rolled copies did; nothing here is called
 * concurrently, and pretending otherwise would need a promise cache whose
 * failure handling is a different question.
 */

/**
 * @param {(key: string, ...rest: any[]) => Promise<any>} load - fetches a fresh
 *   value. Anything after the key is forwarded untouched and takes **no** part
 *   in the caching, which is how an instance method is cached across instances:
 *   Codeforces caches one problemset for every service, and passes the service
 *   that happens to be asking so `load` can sign the call.
 * @param {{ttlMs: number}} options
 * @returns {((key?: string, ...rest: any[]) => Promise<any>) & {clear: () => void}}
 *   the cached reader, with a `clear` seam. Callers with nothing to key on pass
 *   no key and get a single slot.
 */
export function withTtlCache(load, { ttlMs }) {
  const entries = new Map();

  const read = async (key = "", ...rest) => {
    const cached = entries.get(key);
    if (cached && Date.now() - cached.at < ttlMs) return cached.body;

    const body = await load(key, ...rest);
    entries.set(key, { body, at: Date.now() });
    return body;
  };

  read.clear = () => entries.clear();
  return read;
}
