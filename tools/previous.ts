// A file of the previous build, from a directory or the deployed site. The
// daily build carries every archived day and sky forward from the site, a
// couple of hundred downloads, and fails rather than deploy a manifest with
// one missing; so a download that fails (a timeout, a 5xx, a 429, even a
// 404 while Pages swaps a deploy) is tried again before it counts as gone,
// and each failed try says why in the build's log.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PreviousOpts {
  /** Tries in all (default 4). */
  tries?: number;
  /** Before the second try, ms; doubled each time after (default 2000). */
  backoffMs?: number;
  /** Each try's limit, ms (default 30 000). */
  timeoutMs?: number;
}

export async function previousFile(src: string, name: string, opts: PreviousOpts = {}): Promise<string | null> {
  if (!/^https?:/.test(src)) {
    const path = join(src, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  const url = `${src.replace(/\/$/, "")}/${name}`;
  const tries = opts.tries ?? 4;
  let wait = opts.backoffMs ?? 2000;
  for (let t = 1; t <= tries; t++) {
    let why: string;
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      if (res.ok) return await res.text();
      why = `HTTP ${res.status}`;
    } catch (err) {
      why = err instanceof Error ? err.message : String(err);
    }
    console.warn(`${name}: try ${t} of ${tries} failed (${why})`);
    if (t < tries) {
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
  return null;
}
