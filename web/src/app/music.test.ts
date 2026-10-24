import { describe, expect, test } from "vitest";
import { changedNote, dialLabels, homePos, keyName, noteName, push } from "./music.ts";

describe("spelling", () => {
  test("circle positions name the notes the way the engine does", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(noteName)).toEqual(["C", "G", "D", "A", "E", "B", "F♯"]);
    expect([-1, -2, -3, -4, -5, -6, -7].map(noteName)).toEqual(["F", "B♭", "E♭", "A♭", "D♭", "G♭", "C♭"]);
    expect(noteName(12)).toBe("B♯");
    expect(noteName(13)).toBe("F♯♯");
    expect(noteName(-8)).toBe("F♭");
  });

  test("keys are home plus a mode", () => {
    expect(keyName({ c: 0, r: 1 })).toBe("C major");
    expect(keyName({ c: 0, r: 4 })).toBe("A minor");
    expect(keyName({ c: 2, r: 3 })).toBe("E Dorian");
    expect(keyName({ c: 0, r: 0 })).toBe("F Lydian");
    expect(keyName({ c: -4, r: 2 })).toBe("E♭ Mixolydian");
    expect(homePos({ c: 5, r: 4 })).toBe(8);
    expect(keyName({ c: 5, r: 4 })).toBe("G♯ minor");
  });

  test("one changed note is named, entering then leaving", () => {
    expect(changedNote({ c: 0, r: 1 }, { c: 1, r: 1 })).toEqual(["F♯", "F"]);
    expect(changedNote({ c: -4, r: 4 }, { c: -5, r: 4 })).toEqual(["G♭", "G"]);
    // Across the bottom of the circle, G♭ major to B major.
    expect(changedNote({ c: -6, r: 4 }, { c: 5, r: 4 })).toEqual(["E", "F"]);
    expect(changedNote({ c: 0, r: 1 }, { c: 0, r: 3 })).toBeNull();
    expect(changedNote({ c: 0, r: 1 }, { c: 2, r: 1 })).toBeNull();
  });

  test("the dial spells the notes in play as the key does, the rest plainly", () => {
    const flat = dialLabels({ c: -5, r: 4 });
    expect(flat).toEqual(["C", "G", "D", "A", "E", "B", "G♭", "D♭", "A♭", "E♭", "B♭", "F"]);
    const sharp = dialLabels({ c: 5, r: 4 });
    expect(sharp).toEqual(["C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯", "F"]);
    // C major, spelled around the arc's middle (D): two sharps, three flats.
    expect(dialLabels({ c: 0, r: 1 })).toEqual(["C", "G", "D", "A", "E", "B", "F♯", "C♯", "A♭", "E♭", "B♭", "F"]);
  });

  test("the push is the shorter way around the circle", () => {
    expect(push({ c: 0, r: 1 }, { c: 1, r: 1 })).toBe(1);
    expect(push({ c: 0, r: 1 }, { c: -1, r: 1 })).toBe(-1);
    expect(push({ c: -6, r: 1 }, { c: 5, r: 1 })).toBe(-1);
    expect(push({ c: 6, r: 1 }, { c: -5, r: 1 })).toBe(1);
    expect(push({ c: 2, r: 1 }, { c: 2, r: 3 })).toBe(0);
  });
});
