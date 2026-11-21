import { describe, expect, it } from "vitest";
import type { Caption } from "./captions.ts";
import { ANNOUNCE_MS, Feed, KEEP } from "./feed.ts";

const cap = (text: string, family: Caption["family"] = "trax", intro?: string): Caption => ({ text, family, intro, receipt: "scheduled", at: 0 });

describe("the feed", () => {
  it("keeps every card of the session, newest first", () => {
    const f = new Feed();
    for (let i = 0; i < 10; i++) f.add(cap(`c${i}`), i);
    expect(f.cards.map((c) => c.text)).toEqual(["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1", "c0"]);
    expect(f.latest()?.text).toBe("c9");
  });

  it("holds new cards while the reader is away from now, then puts them on top", () => {
    const f = new Feed();
    f.add(cap("a"), 0);
    expect(f.follow(false)).toEqual([]);
    const r = f.add(cap("b"), 1);
    f.add(cap("c"), 2);
    expect(r.shown).toBe(false);
    expect(f.cards.map((c) => c.text)).toEqual(["a"]);
    expect(f.waiting.map((c) => c.text)).toEqual(["c", "b"]);
    expect(f.follow(true).map((c) => c.text)).toEqual(["c", "b"]);
    expect(f.cards.map((c) => c.text)).toEqual(["c", "b", "a"]);
    expect(f.waiting).toEqual([]);
  });

  it("shows each family's intro once", () => {
    const f = new Feed();
    expect(f.add(cap("a", "trax", "Bells are trains"), 0).card.intro).toBe("Bells are trains");
    expect(f.add(cap("b", "trax", "Bells are trains"), 1).card.intro).toBeUndefined();
    expect(f.add(cap("c", "lake", "The drone is the lake"), 2).card.intro).toBe("The drone is the lake");
  });

  it("announces notable cards, at most one every half minute", () => {
    const f = new Feed();
    expect(f.add(cap("a TRAX bell"), 0).announce).toBeNull();
    expect(f.add(cap("M2.1 earthquake", "quake"), 0).announce).toBe("M2.1 earthquake");
    expect(f.add(cap("new key", "harmony"), ANNOUNCE_MS - 1).announce).toBeNull();
    expect(f.add(cap("new key", "harmony"), ANNOUNCE_MS).announce).toBe("new key");
  });

  it("keeps a session's worth and says which fell off the end", () => {
    const f = new Feed();
    for (let i = 0; i < KEEP + 3; i++) f.add(cap(`c${i}`), i);
    expect(f.cards).toHaveLength(KEEP);
    expect(f.takeDropped()).toEqual([1, 2, 3]);
    expect(f.takeDropped()).toEqual([]);
  });
});
