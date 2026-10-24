// Key names, spelled the way the engine spells them (engine/src/music.rs):
// a key is the notes in play (a major collection's circle position) plus home
// (a brightness rung, 0 Lydian … 4 Aeolian).

const LETTERS = ["F", "C", "G", "D", "A", "E", "B"];

/** The note at a circle-of-fifths position: 0 C, 1 G, −1 F, 6 F♯, −6 G♭. */
export function noteName(pos: number): string {
  const letter = LETTERS[(((pos + 1) % 7) + 7) % 7] ?? "C";
  const acc = Math.floor((pos + 1) / 7);
  return letter + (acc > 0 ? "♯".repeat(acc) : "♭".repeat(-acc));
}

export const MODES = ["Lydian", "Ionian", "Mixolydian", "Dorian", "Aeolian"] as const;
const MODE_WORDS = ["Lydian", "major", "Mixolydian", "Dorian", "minor"] as const;

export interface Key {
  /** Circle position of the collection's major tonic, −6…6. */
  c: number;
  /** Brightness rung of home, 0 Lydian … 4 Aeolian. */
  r: number;
}

export function homePos(k: Key): number {
  return k.c - 1 + k.r;
}

/** "E Dorian", "G major". */
export function keyName(k: Key): string {
  return `${noteName(homePos(k))} ${MODE_WORDS[k.r] ?? "major"}`;
}

/** The pitch classes in play, as circle positions c−1 … c+5. */
export function positions(k: Key): number[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => k.c - 1 + i);
}

/** When exactly one note changed between keys: [entered, left]. */
export function changedNote(from: Key, to: Key): [string, string] | null {
  const a = new Set(positions(from).map((p) => ((p % 12) + 12) % 12));
  const b = new Set(positions(to).map((p) => ((p % 12) + 12) % 12));
  const entered = positions(to).filter((p) => !a.has(((p % 12) + 12) % 12));
  const left = positions(from).filter((p) => !b.has(((p % 12) + 12) % 12));
  if (entered.length !== 1 || left.length !== 1) return null;
  return [noteName(entered[0]!), noteName(left[0]!)];
}

const mod12 = (p: number) => ((p % 12) + 12) % 12;
const accidentals = (p: number) => Math.abs(Math.floor((p + 1) / 7));

/** Twelve dial labels by position mod 12. The notes in play are spelled as
 * the key spells them; the other five as plainly as possible (E, not F♭),
 * leaning toward the key's side of the circle when a sharp or flat is
 * unavoidable. */
export function dialLabels(k: Key): string[] {
  const labels: string[] = new Array<string>(12).fill("");
  for (const p of positions(k)) labels[mod12(p)] = noteName(p);
  const center = k.c + 2;
  for (let m = 0; m < 12; m++) {
    if (labels[m]) continue;
    let best = m;
    let bestScore = Infinity;
    for (let p = m - 24; p <= m + 24; p += 12) {
      const score = accidentals(p) * 100 + Math.abs(p - center);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    labels[m] = noteName(best);
  }
  return labels;
}

/** Which way the valley is pushing: toward the next section's notes. */
export function push(from: Key, to: Key): -1 | 0 | 1 {
  let d = to.c - from.c;
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** MIDI note to a name with octave, for the mappings view. */
export function midiName(m: number): string {
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return `${names[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
