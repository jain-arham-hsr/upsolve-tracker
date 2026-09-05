/**
 * The rating models, pinned against the implementation they were ported from.
 *
 * `fixtures/rasch-reference.json` holds 60 fields with expected difficulties
 * computed by running AtCoder Problems' own `estimator/main.py` — the Python
 * verbatim, not a paraphrase. That makes this a *port* test rather than a
 * behaviour test: any disagreement is a porting bug, which is a far sharper
 * signal than the Codeforces estimator's accuracy suite, where 200-point gaps
 * against published ratings are expected and documented.
 *
 * 11 of the 60 fit to a **negative** difficulty on purpose. AtCoder difficulty
 * is unbounded below — 931 rated problems sit under zero and ABC471-A is −817 —
 * and negative territory is where a Python-to-JavaScript port is most likely to
 * drift, because `//` floors while `Math.trunc` rounds toward zero.
 *
 * (Measured while porting: the search reaches a midpoint where those two
 * disagree in 48 of 300 random fields, 251 times in total, and the final answer
 * agreed every time — bisection converges on a unique boundary point either
 * way. `Math.floor` is kept for fidelity to the source, not for safety.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fitDifficulty, solveProbability, expectedSolves } from "../core/rating-models/rasch.js";
import { fitWithUpperAsymptote } from "../core/rating-models/rasch-upper-asymptote.js";

const { cases } = JSON.parse(
  readFileSync(new URL("./fixtures/rasch-reference.json", import.meta.url), "utf8"),
);

const ATCODER = { base: 6, divisor: 400, lo: -10000, hi: 10000 };
const weighted = (ratings) => ratings.map((rating) => ({ rating, weight: 1 }));

test("difficulty is the ability at which the solve chance is exactly a half", () => {
  for (const difficulty of [-817, 0, 654, 2400]) {
    const p = solveProbability({ ability: difficulty, difficulty, ...ATCODER });
    assert.equal(p, 0.5);
  }
});

test("expected solves weight each ability by the field it represents", () => {
  // A sampled stratum of one standing for ten must contribute as ten would.
  const one = expectedSolves({ abilities: [{ rating: 1600, weight: 10 }], difficulty: 1600, ...ATCODER });
  const ten = expectedSolves({ abilities: weighted(Array(10).fill(1600)), difficulty: 1600, ...ATCODER });
  assert.equal(one, ten);
});

test("the Rasch fit reproduces AtCoder Problems' own numbers exactly", () => {
  const mismatches = [];
  for (const [i, c] of cases.entries()) {
    const got = fitDifficulty({
      abilities: weighted(c.abilities),
      solveCount: c.responses.reduce((a, b) => a + b, 0),
      ...ATCODER,
      integer: true,
    });
    if (got !== c.oneParam) mismatches.push(`#${i}: got ${got}, reference ${c.oneParam}`);
  }
  assert.deepEqual(mismatches, [], "a difference here is a porting bug, not model error");
});

test("negative difficulties are reproduced, not floored away", () => {
  // The regression that matters most: applying the Codeforces estimator's
  // `Math.max(800, …)` floor here would silently destroy a third of AtCoder's
  // easy problems, and they would still look like plausible ratings.
  const negatives = cases.filter((c) => c.oneParam < 0);
  assert.ok(negatives.length >= 5, "fixture must exercise negative territory");

  for (const c of negatives) {
    const got = fitDifficulty({
      abilities: weighted(c.abilities),
      solveCount: c.responses.reduce((a, b) => a + b, 0),
      ...ATCODER,
      integer: true,
    });
    assert.equal(got, c.oneParam);
    assert.ok(got < 0);
  }
});

test("the upper-asymptote fit reproduces the source, difficulty and rate alike", () => {
  const mismatches = [];
  for (const [i, c] of cases.entries()) {
    const { difficulty, retreatProbability } = fitWithUpperAsymptote({
      abilities: weighted(c.abilities),
      responses: c.responses,
      ...ATCODER,
    });
    if (difficulty !== c.upperAsym) mismatches.push(`#${i} difficulty: ${difficulty} vs ${c.upperAsym}`);
    if (Math.abs(retreatProbability - c.retreat) > 1e-9) {
      mismatches.push(`#${i} retreat: ${retreatProbability} vs ${c.retreat}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test("allowing for non-attempts can only make a problem read easier", () => {
  // The direction is worth pinning because it is easy to get backwards, and a
  // sign error would still produce plausible ratings. Treating a fraction `r`
  // of the field as absent means the solves we saw came from only `(1 − r)` of
  // it, so the fit is handed the *inflated* target `solves / (1 − r)`. Expected
  // solves fall as difficulty rises, so a larger target always resolves to a
  // lower difficulty — never a higher one.
  //
  // Note the bracket floor is reachable: when `solves / (1 − r)` exceeds the
  // field size no difficulty can produce that many expected solves, and the fit
  // pins at `lo`. That is faithful — the reference does the same, and the grid's
  // log-likelihood is what discards those steps in favour of a better `r`.
  for (const c of cases) {
    const abilities = weighted(c.abilities);
    const plain = fitDifficulty({
      abilities,
      solveCount: c.responses.reduce((a, b) => a + b, 0),
      ...ATCODER,
      integer: true,
    });
    const { difficulty } = fitWithUpperAsymptote({ abilities, responses: c.responses, ...ATCODER });
    assert.ok(difficulty <= plain, `${difficulty} > ${plain}`);
  }
});
