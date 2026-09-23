/**
 * The status strip's minimum display time.
 *
 * Nothing about a rendered strip says how long a message stayed up, so a
 * queue that painted immediately — the flash this exists to stop — would pass
 * every other test. Driven here with a fake clock, like the request pacer.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { StatusQueue } from "../core/ui/status-queue.js";

const MIN = 1500;
const LINGER = 6000;

/** A queue on a fake clock, recording what was painted and when. */
function harness() {
  let now = 0;
  let timers = [];
  let nextId = 1;
  const painted = [];
  const hidden = [];

  const queue = new StatusQueue({
    paint: ({ message, tone }) => painted.push({ at: now, message, tone }),
    hide: () => hidden.push(now),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
    minMs: MIN,
    lingerMs: LINGER,
  });

  /** Moves the clock forward, firing timers in order as they fall due. */
  const advance = async (ms) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > until) break;
      timers = timers.slice(1);
      now = due.at;
      due.fn();
      await Promise.resolve();
    }
    now = until;
    await Promise.resolve();
  };

  return { queue, painted, hidden, advance };
}

test("a second step is not painted before the first has had its minimum", async () => {
  const { queue, painted, advance } = harness();

  queue.enqueue("Starting sync…");
  queue.enqueue("Writing backup…");
  assert.deepEqual(painted.map((p) => p.message), ["Starting sync…"]);

  await advance(MIN - 1);
  assert.equal(painted.length, 1, "replaced before its minimum");

  await advance(1);
  assert.deepEqual(painted.at(-1), { at: MIN, message: "Writing backup…", tone: null });
});

test("quick steps are all shown, in order, each for its minimum", async () => {
  const { queue, painted, advance } = harness();

  queue.enqueue("A");
  queue.enqueue("B");
  queue.enqueue("C");
  await advance(10 * MIN);

  assert.deepEqual(
    painted.map(({ at, message }) => [at, message]),
    [[0, "A"], [MIN, "B"], [2 * MIN, "C"]],
  );
});

test("messages of one step replace each other at once, and share one minimum", async () => {
  // A platform narrating "(1/3)", "(2/3)" is one process; each tick waiting
  // its own 1.5 s would slow the strip far behind the work.
  const { queue, painted, advance } = harness();

  queue.enqueue("Checking AtCoder… (1/3)", { step: "atcoder" });
  await advance(200);
  queue.enqueue("Checking AtCoder… (2/3)", { step: "atcoder" });
  queue.enqueue("Checking AtCoder… (3/3)", { step: "atcoder" });
  assert.deepEqual(
    painted.map(({ at, message }) => [at, message]),
    [[0, "Checking AtCoder… (1/3)"], [200, "Checking AtCoder… (2/3)"], [200, "Checking AtCoder… (3/3)"]],
  );

  // The next step still waits for the minimum measured from the step's start.
  queue.enqueue("Updating your queue…");
  await advance(MIN - 201);
  assert.equal(painted.at(-1).message, "Checking AtCoder… (3/3)");
  await advance(1);
  assert.deepEqual(painted.at(-1), { at: MIN, message: "Updating your queue…", tone: null });
});

test("a step's messages that arrive while it is still queued update it in the queue", async () => {
  const { queue, painted, advance } = harness();

  queue.enqueue("Starting sync…");
  queue.enqueue("Checking CodeChef — 1 of 3…", { step: "codechef" });
  queue.enqueue("Checking CodeChef — 3 of 3…", { step: "codechef" });
  await advance(MIN);

  assert.deepEqual(painted.map((p) => p.message), ["Starting sync…", "Checking CodeChef — 3 of 3…"]);
});

test("extendLatest holds one message longer — the rating note", async () => {
  const { queue, painted, advance } = harness();

  queue.enqueue("Codeforces rating change detected (1223 → 1346). Queue reordered.");
  queue.extendLatest(3000);
  queue.enqueue("Writing backup…");

  await advance(MIN);
  assert.equal(painted.length, 1, "the note was replaced at the ordinary minimum");
  await advance(3000 - MIN);
  assert.equal(painted.at(-1).message, "Writing backup…");
});

test("finish resolves only once the last message has had its minimum", async () => {
  const { queue, advance } = harness();
  let done = false;

  queue.enqueue("Starting sync…");
  queue.enqueue("Writing backup…");
  queue.finish().then(() => { done = true; });

  await advance(2 * MIN - 1);
  assert.equal(done, false, "finished before the last message was shown long enough");
  await advance(1);
  assert.equal(done, true);
});

test("finish hides progress at its minimum, and a note after the linger", async () => {
  const progress = harness();
  progress.queue.enqueue("Writing backup…");
  progress.queue.finish();
  await progress.advance(MIN);
  assert.deepEqual(progress.hidden, [MIN]);

  const note = harness();
  note.queue.enqueue("Automatic backups are off.", { sticky: true, tone: "warning" });
  note.queue.finish();
  await note.advance(LINGER - 1);
  assert.deepEqual(note.hidden, []);
  await note.advance(1);
  assert.deepEqual(note.hidden, [LINGER]);
});

test("a message after a finish cancels the pending hide", async () => {
  // A new operation starting while the last one's note lingers must not have
  // its first message blanked by the old hide.
  const { queue, painted, hidden, advance } = harness();

  queue.enqueue("Sync failed.", { sticky: true });
  queue.finish();
  await advance(MIN);
  queue.enqueue("Starting sync…");
  await advance(LINGER);

  assert.deepEqual(hidden, []);
  assert.equal(painted.at(-1).message, "Starting sync…");
});
