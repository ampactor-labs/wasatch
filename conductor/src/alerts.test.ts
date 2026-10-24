import assert from "node:assert/strict";
import { test } from "node:test";
import { Alerts } from "./alerts.ts";
import type { ServiceAlert } from "./gtfsrt.ts";

const routes = [
  { id: "93610", short: "126", name: "12600 SOUTH", type: 3, kind: "bus" },
  { id: "5907", short: "701", name: "Blue Line", type: 0, kind: "trax" },
  { id: "41065", short: "750", name: "FrontRunner", type: 2, kind: "frontrunner" },
  { id: "994", short: "994", name: "Snowbird / Alta", type: 3, kind: "ski" },
];
const alert = (id: string, routeIds: string[], header: string, effect = 8): ServiceAlert => ({ id, routeIds, stopIds: [], periods: [], cause: 2, effect, header, description: "" });

test("the first feed only learns; a new headline is one alert, however many entities", () => {
  const a = new Alerts();
  a.setRoutes(routes);
  const standing = [alert("1_93610", ["93610"], "Pioneer Road Closure"), alert("2_93610", ["93610"], "Pioneer Road Closure")];
  assert.deepEqual(a.ingest(standing, 1000), []);
  assert.deepEqual(a.counts(), [1, 0, 0, 0]);
  // Both directions of a new TRAX alert, and a bus one, arrive together.
  const rows = a.ingest(
    [...standing, alert("3_5907", ["5907"], "Blue Line single-tracking at Gallivan"), alert("4_5907", ["5907"], "Blue Line single-tracking at Gallivan"), alert("5_93610", ["93610"], "Gas Line Repair")],
    2000,
  );
  assert.deepEqual(rows, [
    [2000, 1, 1, "Blue Line", "Blue Line single-tracking at Gallivan"],
    [2000, 0, 0, "126", "Gas Line Repair"],
  ]);
  assert.deepEqual(a.counts(), [2, 1, 0, 0]);
  // Seen once, never new again.
  assert.deepEqual(a.ingest([...standing, alert("3_5907", ["5907"], "Blue Line single-tracking at Gallivan")], 3000), []);
  assert.equal(a.stats.rail, 1);
});

test("an alert naming several kinds counts as the trains', then the ski buses'", () => {
  const a = new Alerts();
  a.setRoutes(routes);
  a.ingest([], 0);
  const [row] = a.ingest([alert("9", ["93610", "994", "41065"], "Bus bridge between Murray and Draper", 1)], 1);
  assert.equal(row![1], 2, "FrontRunner's");
  assert.equal(row![2], 1, "no service is severe");
  assert.equal(row![3], "126, 994, FrontRunner");
  const [ski] = a.ingest([alert("10", ["93610", "994"], "Canyon closed")], 2);
  assert.equal(ski![1], 3);
  assert.deepEqual(a.list()[0], { kind: 3, routes: "126, 994", header: "Canyon closed" });
});
