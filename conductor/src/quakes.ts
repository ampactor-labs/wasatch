// Which catalogued quakes have been played. USGS sometimes lists a quake
// well after it happened (a reviewed solution, a small one added late), so
// a quake is played when it first appears, up to six hours after it would
// have sounded; it goes into the next open window and keeps its own time
// for the caption. The ids are kept on disk, so a restart doesn't play the
// last six hours' quakes again.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** How late a quake may first appear and still be played. */
export const LATE_MS = 6 * 3_600_000;
const KEEP_MS = 3 * 86_400_000;

export class SeenQuakes {
  private seen = new Map<string, number>();
  private readonly path: string | null;
  /** False until the first catalog read, when nothing was kept: that read
   * only learns what's there (and plays what's due now), so a first start
   * doesn't play six hours at once. */
  private primed: boolean;

  constructor(path: string | null) {
    this.path = path;
    this.primed = false;
    if (!path || !existsSync(path)) return;
    try {
      for (const [id, ms] of Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, number>)) this.seen.set(id, ms);
      this.primed = true;
    } catch {
      // Unreadable: learn again.
    }
  }

  /** The quakes in a catalog read to play now (each once). */
  fresh<Q extends { id: string; ms: number }>(catalog: Q[], now: number): Q[] {
    const out: Q[] = [];
    for (const q of catalog) {
      if (this.seen.has(q.id)) continue;
      // On a first start, only the quakes due within the last ten minutes.
      const window = this.primed ? LATE_MS : 10 * 60_000;
      this.seen.set(q.id, q.ms);
      if (q.ms >= now - window) out.push(q);
    }
    this.primed = true;
    for (const [id, ms] of this.seen) if (now - ms > KEEP_MS) this.seen.delete(id);
    this.save();
    return out;
  }

  private save(): void {
    if (!this.path) return;
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(Object.fromEntries(this.seen)));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      // Kept in memory; the next read saves again.
    }
  }
}
