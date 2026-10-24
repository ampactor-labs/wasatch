import { describe, expect, test } from "vitest";
import { FAMILY_TOPIC, STICKER_TOPIC, TOPICS, conditions, isTopic, withTerms, type LowdownCtx } from "./lowdown.ts";

describe("the lowdown", () => {
  test("the status lines' data words become buttons that explain them", () => {
    const html = withTerms("Saturday 12:35 PM · The day · 203 buses and 31 trains out");
    expect(html).toContain('<button type="button" class="term" data-topic="dayparts">The day</button>');
    expect(html).toContain('<button type="button" class="term" data-topic="buses">buses</button>');
    expect(html).toContain('<button type="button" class="term" data-topic="trains">trains</button>');
    expect(withTerms("Clean air · No new snow · Lake 4,190.0 ft")).toMatch(/data-topic="air">air<.*data-topic="snow">snow<.*data-topic="lake">Lake</);
    expect(withTerms("1 bus & <b>")).toBe('1 <button type="button" class="term" data-topic="buses">bus</button> &amp; &lt;b&gt;');
  });

  test("every card, sticker and topic points at something real", () => {
    for (const id of [...Object.values(FAMILY_TOPIC), ...Object.values(STICKER_TOPIC)]) expect(isTopic(id), id).toBe(true);
    const ids = TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOPICS) {
      expect(t.short.length, t.id).toBeGreaterThan(40);
      // A toast is read in a breath.
      expect(t.short.length, t.id).toBeLessThan(240);
    }
  });
});

describe("the conditions board", () => {
  test("shows every live reading, with its receipt, alerts first", () => {
    const t = Date.parse("2026-10-24T20:19:00Z");
    const ctx = {
      valley: {
        now: () => t,
        shift: 0,
        liveFleet: () => ({ t, trains: [], counts: { trains: 30, buses: 205 } }),
        lake: { value: { ft: 4189.84 }, observed: t, receipt: "live" },
        river: { value: { cfs: 131.2, position: 0.42 }, observed: t, receipt: "live" },
        snow: { value: { newIn: 0, ratio: 0.9 }, observed: t, receipt: "cached" },
        sky: { value: { pm25: 6.2, inversionC: 1, tempC: 12.8, description: "Mostly Cloudy", ridgeGustMs: 3.6, alerts: ["Wind Advisory"] }, observed: t, receipt: "live" },
        quakes: { value: [{}, {}], observed: t, receipt: "live" },
        ground: { levels: [0.2, 0.49, 0.3, 0.1] },
        bikes: { events: [{}] },
      },
      schedule: { transitAt: () => ({ buses: 150, trains: 25 }) },
      conductor: { lateness: () => ({ medianS: 75, n: 12 }) },
      bar: null,
      vantage: 0,
    } as unknown as LowdownCtx;
    const board = conditions(ctx).map((c) => `${c.label} ${c.value} (${c.receipt.split(" ")[0]})`);
    expect(board).toEqual([
      "Alert Wind Advisory (live)",
      "Trains 30 (live)",
      "Buses 205 (live)",
      "Running 1 min late (live)",
      "Lake 4,189.8 ft (live)",
      "Air PM2.5 6 (live)",
      "Sky Mostly Cloudy 55°F (live)",
      "Snow 0 in new (cached)",
      "Ridges 8 mph (live)",
      "River 131 cfs (live)",
      "Ground 49% (live)",
      "Quakes 2 in 2 days (live)",
      "Bikes 1 in 10 min (live)",
    ]);
  });
});
