import { describe, expect, test } from "vitest";
import { FAMILY_TOPIC, STICKER_TOPIC, TOPICS, isTopic, withTerms } from "./lowdown.ts";

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
