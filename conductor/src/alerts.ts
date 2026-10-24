// UTA's service alerts: which are in effect, and which are new. A new one is
// a fill in the drums at the end of the phrase (a cymbal swell where the
// drums are out); one on the trains holds the harmony's tension while it
// stands.
//
// UTA files an alert per route and direction, so one detour can be several
// entities with one headline: a headline is one thing going on, and its
// entities arriving together are one new alert.

import type { ServiceAlert } from "./gtfsrt.ts";

/** A route as routes.json lists it. */
export interface RouteInfo {
  id: string;
  short: string;
  name: string;
  type: number;
  kind: string;
}

/** [ms, kind (0 buses, 1 TRAX and the S-Line, 2 FrontRunner, 3 ski buses),
 * severe 0/1, the routes it names, its headline] */
export type AlertRow = [number, number, number, string, string];

/** How many headlines of each kind are in effect: buses, TRAX and the
 * S-Line, FrontRunner, ski buses. */
export type AlertCounts = [number, number, number, number];

const KIND: Record<string, number> = { trax: 1, sline: 1, frontrunner: 2, ski: 3 };
/** Which kind an alert naming several counts as: the trains first, since
 * what they're about matters most to the music, then the ski buses. */
const PRIORITY = [0, 2, 3, 1];
const topKind = (kinds: number[]): number => kinds.reduce((best, k) => (PRIORITY[k]! > PRIORITY[best]! ? k : best), 0);

/** gtfs-realtime's effects that take service away: NO_SERVICE,
 * REDUCED_SERVICE, SIGNIFICANT_DELAYS. UTA leaves the effect out, so the
 * headline is read too. */
const SEVERE_EFFECTS = new Set([1, 2, 3]);
const SEVERE_WORDS = /\b(suspend\w*|no service|not running|bus bridge|single[- ]track\w*|significant delays?|major delays?)\b/i;

/** An id not in the feed this long is forgotten (and would be new again). */
const FORGET_MS = 7 * 86_400_000;

export class Alerts {
  private routes = new Map<string, RouteInfo>();
  /** Entity ids seen, and when last; null until the first feed seeds it. */
  private seen: Map<string, number> | null = null;
  private current: ServiceAlert[] = [];
  stats = { inEffect: 0, rail: 0, new: 0, lastNew: null as string | null };

  setRoutes(routes: RouteInfo[]): void {
    this.routes = new Map(routes.map((r) => [r.id, r]));
  }

  private kindOf(group: ServiceAlert[]): number {
    return topKind(group.flatMap((a) => a.routeIds.map((id) => KIND[this.routes.get(id)?.kind ?? ""] ?? 0)));
  }

  /** The alerts in effect, by headline. */
  private byHeadline(alerts: ServiceAlert[]): Map<string, ServiceAlert[]> {
    const out = new Map<string, ServiceAlert[]>();
    for (const a of alerts) out.set(a.header, [...(out.get(a.header) ?? []), a]);
    return out;
  }

  private label(ids: Iterable<string>): string {
    const names = [...new Set([...ids].map((id) => this.routes.get(id)).filter((r) => r !== undefined).map((r) => (r.type === 3 ? r.short : r.name)))];
    if (!names.length) return "";
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  }

  /** Read a feed's alerts at `now`: the new ones as rows, one a headline.
   * The first feed only learns what's there; nothing in it is new. */
  ingest(alerts: ServiceAlert[], now: number): AlertRow[] {
    this.current = alerts;
    const first = this.seen === null;
    const seen = (this.seen ??= new Map());
    const fresh = this.byHeadline(alerts.filter((a) => !first && !seen.has(a.id)));
    for (const a of alerts) seen.set(a.id, now);
    for (const [id, at] of seen) if (now - at > FORGET_MS) seen.delete(id);
    const counts = this.counts();
    this.stats.inEffect = counts.reduce((a, b) => a + b, 0);
    this.stats.rail = counts[1] + counts[2];
    const rows: AlertRow[] = [];
    for (const [header, group] of fresh) {
      const severe = group.some((a) => SEVERE_EFFECTS.has(a.effect) || SEVERE_WORDS.test(a.header));
      rows.push([now, this.kindOf(group), severe ? 1 : 0, this.label(group.flatMap((a) => a.routeIds)), header.slice(0, 120)]);
    }
    this.stats.new += rows.length;
    if (rows.length) this.stats.lastNew = rows.at(-1)![4];
    return rows;
  }

  /** Headlines in effect, by kind. */
  counts(): AlertCounts {
    const out: AlertCounts = [0, 0, 0, 0];
    for (const group of this.byHeadline(this.current).values()) out[this.kindOf(group)]!++;
    return out;
  }

  /** What's in effect, for the page: each headline once, the trains first. */
  list(): { kind: number; routes: string; header: string }[] {
    return [...this.byHeadline(this.current)]
      .map(([header, group]) => ({ kind: this.kindOf(group), routes: this.label(group.flatMap((a) => a.routeIds)), header }))
      .sort((a, b) => PRIORITY[b.kind]! - PRIORITY[a.kind]! || a.header.localeCompare(b.header));
  }
}
