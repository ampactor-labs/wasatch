import assert from "node:assert/strict";
import { test } from "node:test";
import { problems, theme } from "./build.ts";

test("the art's crest and the engine's theme agree with the measured profile", () => {
  assert.deepEqual(problems(), []);
});

test("the theme's contour: a murmur, the leap at the Cottonwoods, Nebo highest", () => {
  const t = theme();
  assert.deepEqual(
    t.summits.map((s) => s.step),
    [1, 1, 2, 0, 0, 8, 6, 8, 6, 2, 5, 4, 9],
  );
  assert.equal(t.summits.at(-1)?.name, "Mount Nebo");
  assert.equal(Math.max(...t.summits.map((s) => t.elevFt[s.i]!)), t.elevFt[t.summits.at(-1)!.i]);
});
