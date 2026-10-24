import { describe, expect, test } from "vitest";
import { alertLevel, altimeterHpa, atHourStart, obsFromMetar, obsSlot, overnight, percentile, season, skyFrom, type Metar } from "./feeds.ts";

const at = (iso: string) => Date.parse(iso);

describe("the plan's sky slots", () => {
  test("slot H takes the report made in the quarter hour before H:00", () => {
    expect(obsSlot(at("2026-10-24T01:54:00Z"))).toBe(at("2026-10-24T02:00:00Z"));
    expect(obsSlot(at("2026-10-24T01:45:00Z"))).toBe(at("2026-10-24T02:00:00Z"));
    expect(obsSlot(at("2026-10-24T01:59:59Z"))).toBe(at("2026-10-24T02:00:00Z"));
  });

  test("reports later in the hour never touch a slot already in use", () => {
    expect(obsSlot(at("2026-10-24T02:00:00Z"))).toBeNull();
    expect(obsSlot(at("2026-10-24T02:12:00Z"))).toBeNull();
    expect(obsSlot(at("2026-10-24T01:44:59Z"))).toBeNull();
  });

  test("alerts push by how serious they are", () => {
    expect(alertLevel("Winter Storm Warning")).toBe(1);
    expect(alertLevel("High Wind Warning")).toBe(1);
    expect(alertLevel("Winter Weather Advisory")).toBe(0.5);
    expect(alertLevel("Air Quality Alert")).toBe(0.3);
    expect(alertLevel("Red Flag Warning")).toBe(0.2);
  });
});

describe("readings as of the top of the hour", () => {
  const pts = [
    { t: at("2026-10-24T01:30:00Z"), v: 1 },
    { t: at("2026-10-24T01:45:00Z"), v: 2 },
    { t: at("2026-10-24T02:00:00Z"), v: 3 },
    { t: at("2026-10-24T02:15:00Z"), v: 4 },
  ];
  test("the last point at or before the hour", () => {
    expect(atHourStart(pts, at("2026-10-24T02:40:00Z"))).toEqual(pts[2]);
    expect(atHourStart(pts, at("2026-10-24T01:59:00Z"))).toBeNull();
    expect(atHourStart(pts, at("2026-10-24T03:10:00Z"))).toEqual(pts[3]);
  });
  test("missing values are skipped", () => {
    expect(atHourStart([{ t: at("2026-10-24T01:00:00Z"), v: Number.NaN }], at("2026-10-24T02:00:00Z"))).toBeNull();
  });
});

describe("the season", () => {
  test("ski season is winter; summer isn't", () => {
    expect(season(at("2027-01-15T12:00:00Z"))).toBe(1);
    expect(season(at("2027-07-04T12:00:00Z"))).toBe(0);
    expect(season(at("2026-11-26T12:00:00Z"))).toBe(1);
  });
  test("it ramps in and out", () => {
    const fall = season(at("2026-11-15T12:00:00Z"));
    const spring = season(at("2027-04-12T12:00:00Z"));
    expect(fall).toBeGreaterThan(0);
    expect(fall).toBeLessThan(1);
    expect(spring).toBeGreaterThan(0);
    expect(spring).toBeLessThan(1);
  });
});

describe("the pressure, and a storm on its way", () => {
  test("the altimeter setting from a report's A group, hPa to the tenth", () => {
    expect(altimeterHpa("KSLC 160054Z VRB03KT 10SM FEW095 30/07 A3016 RMK AO2 SLP162")).toBe(1021.3);
    expect(altimeterHpa("KSLC 122210Z 32018G27KT 6SM -RA BR BKN045 16/12 A2990 RMK AO2 P0004")).toBe(1012.5);
    expect(altimeterHpa("KSLC 122210Z AUTO")).toBeNull();
  });

  test("each slot's three-hour change, where both slots were reported", () => {
    const metar = (iso: string, inHg: number): Metar => ({
      obsTime: Date.parse(iso) / 1000,
      clouds: [],
      wxString: null,
      temp: 4,
      wspd: 5,
      wgst: null,
      precip: null,
      rawOb: `KSLC 000000Z 18005KT 10SM CLR 04/M02 A${Math.round(inHg * 100)} RMK AO2`,
    });
    // Falling a hundredth of an inch an hour, then a report without one.
    const obs = [0, 1, 2, 3, 4, 5].map((h) => obsFromMetar(metar(`2026-10-20T0${h}:54:00Z`, 30.2 - 0.01 * h)));
    obs.push({ ...obsFromMetar(metar("2026-10-20T06:54:00Z", 30)), pressureHpa: null });
    const { value } = skyFrom({ obs: obs.reverse(), latest: null, alerts: { features: [] }, slc: null, alta: null, air: null }, at("2026-10-20T07:10:00Z"));
    const tend = (iso: string) => value.hours.find((h) => h.at === at(iso))?.pressureTend;
    expect(tend("2026-10-20T03:00:00Z")).toBeUndefined();
    expect(tend("2026-10-20T04:00:00Z")).toBe(-1);
    expect(tend("2026-10-20T06:00:00Z")).toBe(-1);
    expect(tend("2026-10-20T07:00:00Z")).toBeUndefined();
    expect(value.pressureTend).toBe(-1);
  });
});

describe("the gauges and the snow stations", () => {
  test("a flow's place in the day's percentiles", () => {
    const vals = [1.1, 1.31, 2.17, 6.23, 10.4, 22.4, 41];
    const pcts = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
    expect(percentile(6.23, vals, pcts)).toBe(0.5);
    expect(percentile(8.315, vals, pcts)).toBeCloseTo(0.625, 6);
    expect(percentile(73.9, vals, pcts)).toBe(0.97);
    expect(percentile(0.5, vals, pcts)).toBe(0.05);
  });

  test("a station's night: new snow, how wet it is, and the air up there", () => {
    // SNOTEL's clock is Pacific Standard Time.
    const hours = (from: number, values: number[]) => values.map((value, i) => ({ date: `2026-10-20 ${String(from + i).padStart(2, "0")}:00`, value }));
    const series = [
      { stationElement: { elementCode: "SNWD" }, values: hours(0, [30, 30, 31, 33, 36, 38, 39]) },
      { stationElement: { elementCode: "WTEQ" }, values: hours(0, [10, 10, 10.1, 10.3, 10.6, 10.8, 10.9]) },
      { stationElement: { elementCode: "TOBS" }, values: hours(0, [19, 20, 21, 22, 23, 24, 25]) },
    ];
    const n = overnight(series);
    expect(n.newIn).toBe(9);
    expect(n.densityPct).toBeCloseTo(10, 6);
    expect(n.upHighF).toBe(25);
    expect(overnight([]).t).toBeNull();
  });
});
