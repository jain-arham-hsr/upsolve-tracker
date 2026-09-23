/**
 * The status strip's timing: every *step* stays up for a minimum, in order.
 *
 * Quick steps kept flashing — "Updating your queue…", "Writing backup…" — and
 * fixing them one message at a time only moved the flash to whichever quick
 * step came next. So the rule lives here, once: a step is not replaced until
 * it has been shown for its minimum, and no step is skipped.
 *
 * The minimum is per step, not per message. A step is one process — AtCoder's
 * whole sync, say, or every stage of one add — and may narrate itself in many
 * messages ("… (1/5)", "… (2/5)"). Those replace each other at once, in place,
 * because they are one thing happening; only moving on to a *different* step
 * waits for the minimum. A message names its step with `step`; one that names
 * none is a step of its own.
 *
 * The strip enforces it rather than the callers. About twenty places post
 * progress without awaiting it, across every platform; making each wait would
 * slow the work itself, whereas this only paces what is *shown*. The work runs
 * on, and the display never advances before its time.
 *
 * The clock and timers are injected so the timing can be tested in Node, the
 * same way the request pacer is.
 */
export const MIN_DISPLAY_MS = 1500;

/** How long a note or error stays up once the operation has finished. */
export const STICKY_LINGER_MS = 6000;

export class StatusQueue {
  constructor({
    paint,
    hide,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    minMs = MIN_DISPLAY_MS,
    lingerMs = STICKY_LINGER_MS,
  }) {
    Object.assign(this, { paint, hide, now, setTimer, clearTimer, minMs, lingerMs });
    this.queue = [];
    this.shown = null;
    this.seq = 0;
    this.finishTarget = null;
    this.waiters = [];
    this.pumpTimer = null;
    this.hideTimer = null;
  }

  /**
   * Adds a message. One from the same step as the newest replaces its text
   * in place — at once if it is on screen, without restarting its minimum —
   * and anything else queues behind the steps still waiting their turn.
   */
  enqueue(message, { sticky = false, tone = null, minMs = this.minMs, step = null } = {}) {
    // A new message means the strip is in use again: a pending hide from an
    // earlier operation must not blank it.
    this.cancelHide();

    const latest = this.queue.at(-1) ?? this.shown;
    if (step !== null && latest?.step === step && this.finishTarget !== latest.seq) {
      Object.assign(latest, { message, sticky, tone, minMs: Math.max(latest.minMs, minMs) });
      if (latest === this.shown) this.paint(this.shown);
      return;
    }

    this.queue.push({ seq: ++this.seq, message, sticky, tone, minMs, step });
    this.pump();
  }

  /**
   * Raises the minimum of the message most recently added — whether it is on
   * screen yet or still queued. How the rating note gets its longer hold.
   */
  extendLatest(ms) {
    const latest = this.queue.at(-1) ?? this.shown;
    if (!latest) return;
    latest.minMs = Math.max(latest.minMs, ms);
    this.pump();
  }

  /**
   * The operation is over. Resolves once its last message has been shown for
   * its minimum; the strip then hides, straight away for progress and after
   * the linger for a note or an error.
   */
  finish() {
    this.finishTarget = this.seq;
    const done = new Promise((resolve) => this.waiters.push({ target: this.seq, resolve }));
    this.pump();
    return done;
  }

  pump() {
    this.clearTimer(this.pumpTimer);
    this.pumpTimer = null;
    const now = this.now();

    while (this.queue.length > 0) {
      const left = this.remaining(now);
      if (left > 0) {
        this.pumpTimer = this.setTimer(() => this.pump(), left);
        break;
      }
      this.show(this.queue.shift(), now);
    }

    this.resolveWaiters(now);

    // Only the finish that covers the newest message may hide the strip; a
    // message added after it belongs to an operation still running.
    if (this.queue.length > 0 || this.finishTarget !== this.seq) return;

    const left = this.remaining(now);
    if (left > 0) {
      this.pumpTimer = this.setTimer(() => this.pump(), left);
      return;
    }
    this.scheduleHide(now);
  }

  show(entry, now) {
    this.shown = { ...entry, shownAt: now };
    this.paint(this.shown);
  }

  /** How long the message on screen still has to stay there. */
  remaining(now) {
    if (!this.shown) return 0;
    return this.shown.shownAt + this.shown.minMs - now;
  }

  resolveWaiters(now) {
    this.waiters = this.waiters.filter(({ target, resolve }) => {
      // A later message on screen means this one already had its minimum.
      const done =
        !this.shown ||
        target < this.shown.seq ||
        (target === this.shown.seq && this.remaining(now) <= 0);
      if (done) resolve();
      return !done;
    });
  }

  scheduleHide(now) {
    if (this.hideTimer !== null) return;
    const until = this.shown?.sticky
      ? this.shown.shownAt + Math.max(this.shown.minMs, this.lingerMs) - now
      : 0;
    if (until <= 0) {
      this.hideNow();
      return;
    }
    this.hideTimer = this.setTimer(() => this.hideNow(), until);
  }

  hideNow() {
    this.hideTimer = null;
    this.shown = null;
    this.hide();
  }

  cancelHide() {
    if (this.hideTimer === null) return;
    this.clearTimer(this.hideTimer);
    this.hideTimer = null;
  }
}
