import test from "node:test";
import assert from "node:assert/strict";
import { describeBackupProblem } from "../core/backup-validation.js";
import { countPendingTags } from "../core/tag-service.js";
import { byStartTimeDesc } from "../core/queue-order.js";

const contest = (over = {}) => ({
  id: "2193",
  platform: "codeforces-official",
  type: "OFFICIAL",
  problems: [{ index: "A", solved: false, rating: 1200, tags: ["dp"] }],
  ...over,
});

test("valid backups are accepted, including an empty queue", () => {
  assert.equal(describeBackupProblem({ trackedContests: [contest()] }), null);
  assert.equal(describeBackupProblem({ trackedContests: [] }), null);
});

test("non-backups are refused with a reason", () => {
  for (const junk of [null, undefined, "text", 42, [1, 2, 3]]) {
    assert.ok(describeBackupProblem(junk), `${JSON.stringify(junk)} slipped through`);
  }
  assert.ok(describeBackupProblem({ foo: "bar" }));
  assert.ok(describeBackupProblem({ trackedContests: { not: "an array" } }));
});

test("malformed contest entries are refused", () => {
  assert.ok(describeBackupProblem({ trackedContests: [{ problems: [] }] }));
  assert.ok(describeBackupProblem({ trackedContests: [{ id: "1" }] }));
});

test("a null entry is caught — it is falsy, so find() would have missed it", () => {
  assert.ok(describeBackupProblem({ trackedContests: [contest(), null] }));
});

test("tags are counted per problem occurrence, solved problems excluded", () => {
  const contests = [
    contest({
      problems: [
        { index: "A", solved: false, rating: 1000, tags: ["dp", "math"] },
        { index: "B", solved: false, rating: 1500, tags: ["dp"] },
        { index: "C", solved: true, rating: 1500, tags: ["counted-if-broken"] },
      ],
    }),
  ];

  assert.deepEqual(countPendingTags(contests), [
    { tag: "dp", count: 2 },
    { tag: "math", count: 1 },
  ]);
});

test("a rating range narrows the count and drops unrated problems", () => {
  const contests = [
    contest({
      problems: [
        { index: "A", solved: false, rating: 900, tags: ["easy"] },
        { index: "B", solved: false, rating: 1600, tags: ["hard"] },
        { index: "C", solved: false, rating: null, tags: ["unrated"] },
      ],
    }),
  ];

  assert.deepEqual(countPendingTags(contests, { min: 1500, max: 1700 }), [
    { tag: "hard", count: 1 },
  ]);
  // Without a range the unrated problem still contributes.
  assert.ok(countPendingTags(contests).some((t) => t.tag === "unrated"));
});

test("ties break by tag name so ordering is stable", () => {
  const contests = [
    contest({
      problems: [{ index: "A", solved: false, rating: 1000, tags: ["zebra", "alpha"] }],
    }),
  ];
  assert.deepEqual(
    countPendingTags(contests).map((t) => t.tag),
    ["alpha", "zebra"],
  );
});

test("contests sort newest first, with unknown dates last", () => {
  const sorted = [
    { id: "old", startTimeSeconds: 1000 },
    { id: "unknown" },
    { id: "new", startTimeSeconds: 3000 },
    { id: "mid", startTimeSeconds: 2000 },
  ].sort(byStartTimeDesc);

  assert.deepEqual(
    sorted.map((c) => c.id),
    ["new", "mid", "old", "unknown"],
  );
});

test("all-unknown dates compare equal rather than throwing", () => {
  const items = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(
    [...items].sort(byStartTimeDesc).map((c) => c.id),
    ["a", "b"],
  );
});

test("a backup whose contests omit their platform is refused", () => {
  // No read-time default any more, so an unlabelled record would key as
  // "undefined:1993" and render as an unknown platform. Refuse at the door.
  assert.match(
    describeBackupProblem({ trackedContests: [{ id: 1993, problems: [] }] }) ?? "",
    /platform|support/i,
  );
});

test("a backup from a newer version is refused, not imported and crashed later", () => {
  const problem = describeBackupProblem({
    trackedContests: [contest({ platform: "leetcode" })],
  });
  assert.ok(problem);
  assert.match(problem, /leetcode/);
});

test("a supported platform is accepted", () => {
  assert.equal(
    describeBackupProblem({ trackedContests: [contest({ platform: "atcoder" })] }),
    null,
  );
});

test("an explicit codeforces platform is accepted", () => {
  assert.equal(
    describeBackupProblem({ trackedContests: [contest({ platform: "codeforces-official" })] }),
    null,
  );
});

test("tag counts skip problems that can no longer be submitted", () => {
  // countPendingTags walks contests directly instead of going through
  // collectPendingProblems, so it has to repeat that filter — otherwise the
  // bars count problems the coverage line above them has already excluded.
  const contests = [
    {
      id: "START32C", platform: "codechef", type: "STARTERS", startTimeSeconds: 1,
      problems: [
        { index: "MAXTHEMIN", solved: false, rating: 1358, tags: ["stranded"], upsolvable: false },
        { index: "VOLCONTROL", solved: false, rating: 1200, tags: ["greedy"] },
      ],
    },
  ];

  assert.deepEqual(countPendingTags(contests).map((t) => t.tag), ["greedy"]);
});
