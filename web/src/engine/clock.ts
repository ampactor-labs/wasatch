// Wall-clock UTC, shared by every phone.
//
// A phone's own clock is usually NTP-synced to within tens of milliseconds,
// but not always. GitHub Pages can't run a /time endpoint, and the HTTP Date
// header has one-second resolution, so we watch for the moment it ticks:
// requests to our own origin every 80 ms until the header's second changes.
// The change happened between the two responses' server times, which pins
// the offset to about half the spacing plus half the round trip. A sanity
// check against the device clock keeps a bad measurement from winning.

export interface ClockEstimate {
  /** UTC ms = performance.now() + offset. */
  offset: number;
  /** Half-width of the uncertainty, ms. */
  uncertainty: number;
  /** "header" when measured from our server, "device" when trusting the phone. */
  source: "header" | "device";
}

let current: ClockEstimate = {
  offset: Date.now() - performance.now(),
  uncertainty: 250,
  source: "device",
};

/** UTC ms now. */
export function utcNow(): number {
  return performance.now() + current.offset;
}

/** UTC ms at a performance.now() time. */
export function utcAt(perfMs: number): number {
  return perfMs + current.offset;
}

export function clockEstimate(): ClockEstimate {
  return current;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Measure our server's UTC from Date-header edges. Resolves with the
 * estimate it settled on (and makes it current). */
export async function syncClock(url: string, tries = 36): Promise<ClockEstimate> {
  let prev: { mid: number; rtt: number; second: number } | null = null;
  const edges: { offset: number; width: number }[] = [];
  for (let i = 0; i < tries && edges.length < 2; i++) {
    const t0 = performance.now();
    let second: number;
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}clock=${Math.random().toString(36).slice(2)}`, {
        method: "HEAD",
        cache: "no-store",
      });
      const date = res.headers.get("date");
      if (!date) break;
      second = Date.parse(date);
    } catch {
      break;
    }
    const t1 = performance.now();
    const cur = { mid: (t0 + t1) / 2, rtt: t1 - t0, second };
    if (prev && cur.second > prev.second && cur.rtt < 600 && prev.rtt < 600) {
      // The server ticked over `cur.second` between the two responses.
      const lo = prev.mid - prev.rtt / 2;
      const hi = cur.mid + cur.rtt / 2;
      const at = (prev.mid + cur.mid) / 2;
      edges.push({ offset: cur.second - at, width: (hi - lo) / 2 });
    }
    prev = cur;
    await sleep(80);
  }
  if (edges.length === 0) return current;
  const best = edges.reduce((a, b) => (b.width < a.width ? b : a));
  const device = Date.now() - performance.now();
  // A phone clock within two seconds of the server is plausible; trust the
  // measurement then. Further off, the phone's clock is wrong and the
  // measurement still wins: everyone must share the server's time.
  const plausible = Math.abs(best.offset - device) < 120_000;
  if (plausible && best.width < 400) {
    current = { offset: best.offset, uncertainty: best.width, source: "header" };
  }
  return current;
}
