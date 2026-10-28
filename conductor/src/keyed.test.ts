import assert from "node:assert/strict";
import { test } from "node:test";
import { DOWNTOWN_SITES, LAKE_SITES, localHour, parseCurrent, parseForecast, parseSites, pickSite, valleyPm25 } from "./airnow.ts";
import { siriElements } from "./siri.ts";
import { parseAdvisory } from "./uac.ts";
import { Signs, Udot, canyonOf, canyonWind, heard, parseEvents, parseRoadForecast, parseSigns, plowsOut, traction, travelTimes } from "./udot.ts";

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

test("UDOT: a description's first line, and a station that stopped reporting", () => {
  const [e] = parseEvents([{ ID: 372, RoadwayName: "I-15", EventType: "roadwork", IsFullClosure: false, Latitude: 40.98, Longitude: -111.9, Description: "I-15 Shepard Lane Interchange Improved\n---\nTRAFFIC SHIFT – Northbound and southbound I-15 travel lanes are shifted." }]);
  assert.equal(e!.words, "I-15 Shepard Lane Interchange Improved");
  const now = Date.parse("2026-12-01T15:00:00Z");
  const w = canyonWind(
    [
      { StationName: "SR-210 @ Alta", WindSpeedAvg: "20", WindSpeedGust: "41", LastUpdated: now / 1000 - 600 },
      { StationName: "SR-190 @ Brighton", WindSpeedAvg: "60", WindSpeedGust: "90", LastUpdated: now / 1000 - 3 * 3600 },
    ],
    now,
  );
  assert.deepEqual(w?.stations, ["SR-210 @ Alta"]);
});

// Shaped like UDOT's documented messagesigns and futuredrivingconditions.
const SIGNS = [
  { Id: "UT--100107", Name: "I-80 WB @ Jeremy Ranch / MP 142.93, SU", Roadway: "I-80 WB", DirectionOfTravel: "Westbound", Messages: ["<MSG>MINUTES TO<BR/>SLC                 16<BR/>SLC AIRPORT    26</MSG>"], Latitude: 40.75082, Longitude: -111.565787, LastUpdated: 1686328502 },
  { Id: "UT--100200", Name: "I-15 SB @ 600 S, SLC", Roadway: "I-15 SB", DirectionOfTravel: "Southbound", Messages: ["<MSG>SLOW TRAFFIC<BR/>AHEAD</MSG><MSG>TRAVEL TIME TO<BR/>I-215   9 MIN<BR/>DRAPER  22 MIN</MSG>"], Latitude: 40.76, Longitude: -111.9, LastUpdated: 1686328502 },
  { Id: "UT--100082", Name: "I-15 NB @ Milepost 0.28, STG", Roadway: "I-15 NB", DirectionOfTravel: "Northbound", Messages: ["<MSG>ALL WATERCRAFT<BR/>MUST EXIT AT<BR/>PORT OF ENTRY</MSG>"], Latitude: 37.004178, Longitude: -113.618146, LastUpdated: 1686328502 },
  { Id: "UT--100300", Name: "SR-209 @ 9000 S", Roadway: "SR-209 EB", DirectionOfTravel: "Eastbound", Messages: ["<MSG>MINUTES TO<BR/>SNOWBIRD 35</MSG>"], Latitude: 40.58, Longitude: -111.85, LastUpdated: 1686328502 },
];

test("UDOT: the minutes the overhead signs show, on the valley's highways", () => {
  assert.deepEqual(travelTimes(SIGNS[0]!.Messages), [
    { to: "SLC", minutes: 16 },
    { to: "SLC AIRPORT", minutes: 26 },
  ]);
  assert.deepEqual(travelTimes(SIGNS[1]!.Messages), [
    { to: "I-215", minutes: 9 },
    { to: "DRAPER", minutes: 22 },
  ]);
  assert.deepEqual(travelTimes(SIGNS[2]!.Messages), []);
  assert.deepEqual(travelTimes(undefined), []);
  const signs = parseSigns(SIGNS);
  assert.deepEqual(
    signs.map((t) => [t.key, t.roadway, t.minutes]),
    [
      ["UT--100107|SLC", "I-80 WB", 16],
      ["UT--100107|SLC AIRPORT", "I-80 WB", 26],
      ["UT--100200|I-215", "I-15 SB", 9],
      ["UT--100200|DRAPER", "I-15 SB", 22],
    ],
    "St. George's sign is far away, and SR-209 isn't a highway the valley feels",
  );
});

test("UDOT: the signs' pace against their usual, learned hour by hour", () => {
  const s = new Signs(null);
  const t0 = Date.parse("2026-12-01T15:00:00Z"); // a Tuesday, 8 AM in Utah
  const HOUR = 3_600_000;
  const read = (hour: number, minutes: number) =>
    s.sample(
      [
        { key: "a|SLC", name: "a", roadway: "I-15 NB", to: "SLC", minutes, lat: 40.7, lon: -111.9 },
        { key: "a|DRAPER", name: "a", roadway: "I-15 NB", to: "DRAPER", minutes: minutes * 2, lat: 40.7, lon: -111.9 },
      ],
      hour + 600_000,
    );
  // Three Tuesdays at 8 AM: 10 minutes to SLC each.
  for (let week = 0; week < 3; week++) {
    const hour = t0 + week * 7 * 86_400_000;
    read(hour, 10);
    read(hour, 10);
    assert.equal(s.close(hour), null, "no usual yet");
  }
  assert.equal(s.usualFor("a|SLC", t0), 10);
  assert.equal(s.usualFor("a|SLC", t0 + HOUR), null, "9 AM hasn't been seen");
  // A fourth, crawling: 14 minutes, a pace well below zero.
  const slow = t0 + 3 * 7 * 86_400_000;
  read(slow, 14);
  read(slow, 15);
  assert.deepEqual(
    s.summary(slow + 600_000).map((x) => [x.to, x.minutes, x.usual]),
    [
      ["SLC", 15, 10],
      ["DRAPER", 30, 20],
    ],
  );
  const pace = s.close(slow)!;
  assert.ok(pace < -0.9 && pace >= -1, `pace ${pace}`);
  assert.equal(s.close(slow), null, "closed once");
  assert.equal(s.stats.pace, pace);
});

test("UDOT: the canyon roads' forecast, first timeframe only", () => {
  const f = parseRoadForecast([
    { Id: 1, Roadway: "US-89 From Jct. SR-193 to I-84", ForecastInfo: [{ Timeframe: "0 to 3 hours", Condition: "Yellow", ConditionReason: "Slushy roads" }] },
    { Id: 2, Roadway: "SR-210 Little Cottonwood Canyon", ForecastInfo: [{ Timeframe: "0 to 3 hours", Condition: "Red", ConditionReason: "Snow covered" }, { Timeframe: "3 to 6 hours", Condition: "Yellow", ConditionReason: "Patchy ice" }] },
    { Id: 3, Roadway: "I-80 Parleys Canyon", ForecastInfo: [] },
  ]);
  assert.deepEqual(f, [{ roadway: "SR-210 Little Cottonwood Canyon", timeframe: "0 to 3 hours", condition: "Red", reason: "Snow covered" }]);
});

// Shaped like AirNow's answers on Oct 28, 2026 (the web services that
// replaced the ones retired that September).
const DEQ = "Utah Department of Environmental Quality";
const CURRENT = [
  { dateObserved: "2026-10-28", hourObserved: "14:00", localTimeZone: "MDT", reportingAreaName: "Salt Lake City", siteID: "490353006", siteName: "Hawthorne", parameterName: "PM2.5", nowcastAQI: 52, aqiCategoryName: "Moderate", reportingAgency: DEQ },
  { dateObserved: "2026-10-28", hourObserved: "14:00", localTimeZone: "MDT", reportingAreaName: "Salt Lake City", siteID: "490353006", siteName: "Hawthorne", parameterName: "OZONE", nowcastAQI: 30, aqiCategoryName: "Good", reportingAgency: DEQ },
  { dateObserved: "2026-10-28", hourObserved: "14:00", localTimeZone: "MDT", reportingAreaName: "Salt Lake City", siteID: "490353006", siteName: "Hawthorne", parameterName: "PM10", nowcastAQI: 17, aqiCategoryName: "Good", reportingAgency: DEQ },
];
const row = (site: [string, string, number, number], utc: string, parameter: string, unit: string, value: number, raw: number, aqi: number) => ({
  Latitude: site[2],
  Longitude: site[3],
  UTC: utc,
  Parameter: parameter,
  Unit: unit,
  Value: value,
  RawConcentration: raw,
  AQI: aqi,
  Category: 1,
  SiteName: site[1],
  AgencyName: DEQ,
  FullAQSCode: site[0],
  IntlAQSCode: `840${site[0]}`.slice(-12),
});
const BEACH: [string, string, number, number] = ["490352004", "Beach", 40.735001, -112.210999];
const HAWTHORNE: [string, string, number, number] = ["490353006", "Hawthorne", 40.733501, -111.871696];
const MAGNA: [string, string, number, number] = ["840490351007", "MA", 40.712064, -112.111122];
const RED_BUTTE: [string, string, number, number] = ["840490353018", "Red Butte", 40.76652, -111.82835];
const DATA = [
  row(BEACH, "2026-10-28T18:00", "OZONE", "PPB", 35, 40, 32),
  row(BEACH, "2026-10-28T18:00", "PM2.5", "UG/M3", 3.1, 2.7, 17),
  row(BEACH, "2026-10-28T18:00", "NO2", "PPB", 1.5, 1.5, 1),
  row(HAWTHORNE, "2026-10-28T17:00", "PM2.5", "UG/M3", 9.5, 9.0, 40),
  row(HAWTHORNE, "2026-10-28T18:00", "PM2.5", "UG/M3", 10.4, 11.1, 43),
  row(HAWTHORNE, "2026-10-28T18:00", "PM10", "UG/M3", 24, 26, 22),
  row(HAWTHORNE, "2026-10-28T18:00", "OZONE", "PPB", 31, 34, 29),
  row(MAGNA, "2026-10-28T18:00", "PM2.5", "UG/M3", 3.4, -0.4, 19),
  // A site that measures ozone alone, and one whose reading is missing.
  row(RED_BUTTE, "2026-10-28T18:00", "OZONE", "PPB", 38, 41, 35),
  row(["490353010", "Rose Park", 40.7955, -111.9309], "2026-10-28T18:00", "PM2.5", "UG/M3", -999, -999, -999),
];
const FORECAST = [
  { dateIssue: "2026-10-28", dateValid: "2026-10-29", reportingArea: "Salt Lake City", reportingAreaCode: "ut001", stateCode: "UT", parameterName: "PM2.5", aqi: -1, forecastAgency: DEQ, categoryNumber: 1, categoryName: "Good", actionDay: false, discussion: "" },
  { dateIssue: "2026-10-28", dateValid: "2026-10-28", reportingArea: "Salt Lake City", reportingAreaCode: "ut001", stateCode: "UT", parameterName: "PM2.5", aqi: 55, forecastAgency: DEQ, categoryNumber: 2, categoryName: "Moderate", actionDay: true, discussion: "  An inversion holds\n  through Thursday. " },
];

test("AirNow: the reporting area's AQI, by pollutant, at the hour it was observed", () => {
  const a = parseCurrent(CURRENT);
  assert.ok(a);
  assert.equal(a.area, "Salt Lake City");
  assert.equal(a.aqi, 52);
  assert.equal(a.category, "Moderate");
  assert.equal(a.pollutant, "PM2.5");
  assert.deepEqual(
    a.pollutants.map((p) => [p.parameter, p.aqi]),
    [
      ["PM2.5", 52],
      ["ozone", 30],
      ["PM10", 17],
    ],
  );
  assert.equal(a.hour, Date.parse("2026-10-28T20:00:00Z"));
  assert.equal(localHour("2026-12-01", 8, "MST"), Date.parse("2026-12-01T15:00:00Z"));
  assert.equal(parseCurrent([]), null);
  assert.equal(parseCurrent({ WebServiceError: [{ Message: "Invalid Request." }] }), null);
});

test("AirNow: each monitor's latest hour, raw, and what each vantage hears", () => {
  const sites = parseSites(DATA);
  assert.deepEqual(
    sites.map((s) => s.name),
    ["Beach", "Hawthorne", "MA", "Red Butte", "Rose Park"],
  );
  const hawthorne = sites.find((s) => s.name === "Hawthorne")!;
  assert.equal(hawthorne.hour, Date.parse("2026-10-28T18:00:00Z"), "the latest hour, not the first");
  assert.equal(hawthorne.pm25, 11.1, "the raw hourly reading, not the NowCast value");
  assert.equal(hawthorne.pm10, 26);
  assert.equal(hawthorne.o3, 34);
  assert.ok(Number.isNaN(hawthorne.no2));
  assert.equal(hawthorne.aqi, 43);
  assert.ok(Number.isNaN(sites.find((s) => s.name === "Red Butte")!.pm25));
  assert.ok(Number.isNaN(sites.find((s) => s.name === "Rose Park")!.pm25), "-999 is missing");
  assert.equal(pickSite(sites, DOWNTOWN_SITES)?.name, "Hawthorne");
  assert.equal(pickSite(sites, LAKE_SITES)?.name, "Beach");
  assert.equal(pickSite(sites, ["490353010", "840490353018"]), null, "neither reported PM2.5");
  // Beach 2.7, Hawthorne 11.1, Magna −0.4 (drift: clean air): the median.
  assert.deepEqual(valleyPm25(sites), { pm25: 2.7, monitors: 3 });
  assert.deepEqual(valleyPm25([]), { pm25: Number.NaN, monitors: 0 });
  assert.deepEqual(parseSites({ WebServiceError: [] }), []);
});

test("AirNow: the forecast by day, with its action days", () => {
  const f = parseForecast(FORECAST);
  assert.ok(f);
  assert.equal(f.issued, "2026-10-28");
  assert.equal(f.area, "Salt Lake City");
  assert.deepEqual(
    f.days.map((d) => [d.date, d.category, d.actionDay, d.aqi]),
    [
      ["2026-10-28", "Moderate", true, 55],
      ["2026-10-29", "Good", false, Number.NaN],
    ],
  );
  assert.equal(f.days[0]!.discussion, "An inversion holds through Thursday.");
  assert.equal(parseForecast([]), null);
});

test("UTA's SIRI: the elements that matter, counted", () => {
  const xml = `<Siri version="1.3"><VehicleMonitoringDelivery><VehicleActivity><MonitoredVehicleJourney><MonitoredCall><VehicleAtStop>false</VehicleAtStop><Extensions><Distance>6368.0</Distance></Extensions></MonitoredCall></MonitoredVehicleJourney></VehicleActivity><VehicleActivity/></VehicleMonitoringDelivery></Siri>`;
  assert.deepEqual(siriElements(xml), { VehicleActivity: 1, MonitoredCall: 1, VehicleAtStop: 1, Distance: 1 });
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
