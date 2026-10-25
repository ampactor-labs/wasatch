import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAirNow, pm25FromAqi } from "./airnow.ts";
import { parseAdvisory } from "./uac.ts";
import { Udot, canyonOf, canyonWind, heard, parseEvents, plowsOut, traction } from "./udot.ts";

// Shaped like UDOT's documented responses (api/v2/get/<x>?format=json).
const EVENTS = [
  { ID: "1", RoadwayName: "I-15", EventType: "accidentsAndIncidents", IsFullClosure: false, Latitude: 40.7608, Longitude: -111.9, Description: "Crash on I-15 NB at 600 S, right lane blocked" },
  { ID: "2", RoadwayName: "SR-210", EventType: "closures", IsFullClosure: true, Latitude: 40.575, Longitude: -111.69, Description: "SR-210 closed for avalanche control work" },
  { ID: "3", RoadwayName: "I-80", EventType: "roadwork", IsFullClosure: false, Latitude: 40.72, Longitude: -111.85, Description: "Night lane closures for paving" },
  { ID: "4", RoadwayName: "I-15", EventType: "accidentsAndIncidents", IsFullClosure: false, Latitude: 41.2, Longitude: -111.97, Description: "Crash in Ogden" },
  { ID: "5", RoadwayName: "Bangerter Hwy", EventType: "closures", IsFullClosure: true, Latitude: 40.6, Longitude: -111.98, Description: "Bangerter closed at 9000 S" },
  { Id: "", RoadwayName: "nowhere" },
];

test("UDOT: incidents on the valley's highways and avalanche control up the canyons", () => {
  const events = parseEvents(EVENTS);
  assert.equal(events.length, 5);
  assert.deepEqual(
    events.map((e) => heard(e)),
    [{ kind: "incident", road: 0 }, { kind: "avalanche", road: 1 }, null, null, { kind: "incident", road: 0 }],
  );
  assert.equal(canyonOf("SR-190"), 2);
  assert.equal(canyonOf("UT 210"), 1);
  assert.equal(canyonOf("I-15"), 0);
});

test("UDOT: an incident opening, then clearing; the first read only learns", async () => {
  const u = new Udot("k");
  let body: unknown = EVENTS;
  u.get = async () => body;
  assert.deepEqual(await u.pollEvents(1000), []);
  assert.equal(u.state.closures, 2);
  body = [...EVENTS.slice(1), { ID: "9", RoadwayName: "I-215", EventType: "accidentsAndIncidents", Latitude: 40.69, Longitude: -111.83, Description: "Crash on I-215 at 3300 S" }];
  const rows = await u.pollEvents(2000);
  assert.deepEqual(
    rows.map((r) => [r[1], r[2], r[5]]),
    [
      [0, 0, "I-215"],
      [1, 0, "I-15"],
    ],
  );
});

test("UDOT: traction law, plows and the canyons' wind", () => {
  assert.deepEqual(
    traction([
      { RoadwayName: "SR-210 Little Cottonwood Canyon", RoadCondition: "Snow", Restriction: "Traction Law in effect: 4WD/AWD or chains" },
      { RoadwayName: "SR-190 Big Cottonwood Canyon", RoadCondition: "Wet", Restriction: "None" },
      { RoadwayName: "I-80 Parleys", Restriction: "Chains required" },
    ]),
    [1, 0],
  );
  const now = Date.parse("2026-12-01T15:00:00Z");
  assert.equal(
    plowsOut(
      [
        { Id: 1, Latitude: 40.7, Longitude: -111.9, LastUpdated: now / 1000 - 120 },
        { Id: 2, Latitude: 40.6, Longitude: -111.95, LastUpdated: new Date(now - 300_000).toISOString() },
        { Id: 3, Latitude: 40.6, Longitude: -111.95, LastUpdated: now / 1000 - 3600 },
        { Id: 4, Latitude: 41.2, Longitude: -111.95, LastUpdated: now / 1000 },
      ],
      now,
    ),
    2,
  );
  const w = canyonWind([
    { StationName: "SR-210 @ Alta", WindSpeedAvg: 20, WindSpeedGust: 41 },
    { StationName: "SR-190 @ Big Cottonwood mouth", WindSpeedAvg: 6, WindSpeedGust: 12 },
    { StationName: "I-15 @ 600 S", WindSpeedAvg: 3, WindSpeedGust: 9 },
  ]);
  assert.ok(w);
  assert.ok(Math.abs(w.ms - 13 * 0.44704) < 1e-9);
  assert.ok(Math.abs(w.gustMs - 41 * 0.44704) < 1e-9);
  assert.equal(w.stations.length, 2);
});

test("AirNow: PM2.5 from the AQI, at the hour it was observed", () => {
  assert.equal(pm25FromAqi(0), 0);
  assert.equal(pm25FromAqi(50), 9);
  assert.equal(pm25FromAqi(100), 35.4);
  assert.equal(pm25FromAqi(75), 22);
  const a = parseAirNow([
    { DateObserved: "2026-12-01 ", HourObserved: 8, LocalTimeZone: "MST", ReportingArea: "Salt Lake City", ParameterName: "O3", AQI: 30, Category: { Number: 1, Name: "Good" } },
    { DateObserved: "2026-12-01 ", HourObserved: 8, LocalTimeZone: "MST", ReportingArea: "Salt Lake City", ParameterName: "PM2.5", AQI: 112, Category: { Number: 3, Name: "Unhealthy for Sensitive Groups" } },
  ]);
  assert.ok(a);
  assert.equal(a.aqi, 112);
  assert.equal(a.pm25, 40);
  assert.equal(a.hour, Date.parse("2026-12-01T15:00:00Z"));
  assert.equal(parseAirNow([]), null);
});

test("UAC: the day's danger from the overall rose", () => {
  const a = parseAdvisory({
    advisories: [{ advisory: { date_issued: "Saturday, December 5, 2026 - 7:16am", overall_danger_rose: "6,6,6,6,6,6,6,6,4,4,4,4,4,4,4,4,4,4,4,2,2,2,4,4", bottom_line: "<p>CONSIDERABLE danger on&nbsp;upper north aspects.</p>" } }],
  });
  assert.ok(a);
  assert.equal(a.danger, 3);
  assert.equal(a.rose.length, 24);
  assert.equal(a.bottomLine, "CONSIDERABLE danger on upper north aspects.");
  assert.equal(parseAdvisory({ nothing: true }), null);
});
