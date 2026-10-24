// Planes over the valley, from ADS-B: adsb.lol's open feed of what its
// volunteers' receivers hear (no key, ODbL), or a receiver of our own
// (ADSB_URL: readsb's aircraft.json, the same fields). A plane climbing out
// of SLC or coming down to it is a slow swell of brass and strings, placed
// where it is; airline flights are named, private aircraft never are.
//
// Movements are spaced like a runway's: at most one into the windows every
// 20 s, the rest queued, so a bank of departures becomes a slow procession
// rather than a pile-up.

export interface Aircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  category?: string;
  alt_baro?: number | "ground";
  baro_rate?: number;
  geom_rate?: number;
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
  /** Seconds since its position was heard. */
  seen_pos?: number;
  seen?: number;
}

/** [ms, lat, lon, kind 0 departing / 1 landing, size 1–5 (0 unknown), ft
 * above sea level, an airline's 0/1, its name ("Delta 1784"; "" when
 * private)] */
export type PlaneRow = [number, number, number, number, number, number, number, string];

/** A plane on the map: [lat, lon, track °, ground speed kt, ft, ft/min,
 * name or null] as of `t`. */
export type PlaneDot = [number, number, number, number, number, number, string | null];

export const KSLC = { lat: 40.7884, lon: -111.9778, ft: 4227 };
/** The area read, nm around the field. */
export const RADIUS_NM = 25;
const SPACING_MS = 20_000;
const STALE_MS = 4 * 60_000;
/** One sound a plane a leg: it isn't heard again for this long. */
const LEG_MS = 90 * 60_000;

/** Airlines by ICAO prefix: the ones seen at SLC, and the big ones. */
export const AIRLINES: Record<string, string> = {
  AAL: "American",
  AAY: "Allegiant",
  ACA: "Air Canada",
  AMX: "Aeroméxico",
  ASA: "Alaska",
  ASH: "Mesa",
  BAW: "British Airways",
  CPZ: "Compass",
  DAL: "Delta",
  EDV: "Endeavor",
  ENY: "Envoy",
  FDX: "FedEx",
  FFT: "Frontier",
  GTI: "Atlas",
  JBU: "JetBlue",
  JIA: "PSA",
  KLM: "KLM",
  NKS: "Spirit",
  QXE: "Horizon",
  RPA: "Republic",
  SCX: "Sun Country",
  SKW: "SkyWest",
  SWA: "Southwest",
  UAL: "United",
  UPS: "UPS",
  VOI: "Volaris",
  VXP: "Avelo",
  WJA: "WestJet",
  AFR: "Air France",
  KAL: "Korean Air",
  ABX: "ABX Air",
  AJT: "Amerijet",
  ATN: "Air Transport International",
};

/** An airline flight's name ("Delta 1784"), or null: a private aircraft,
 * or a callsign that names no airline. */
export function airlineName(callsign: string | undefined): string | null {
  const c = (callsign ?? "").trim().toUpperCase();
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(c);
  if (!m) return null;
  const airline = AIRLINES[m[1]!];
  return airline ? `${airline} ${m[2]!.replace(/^0+/, "")}` : null;
}

/** Size from ADS-B's emitter category: A1 light to A5 heavy; a rotorcraft
 * or a glider is light. */
export function sizeOf(category: string | undefined): number {
  const m = /^A([1-7])$/.exec(category ?? "");
  if (!m) return category ? 1 : 0;
  const n = Number(m[1]);
  return n <= 5 ? n : 1;
}

const NM_M = 1852;
const R_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance in nm and the bearing (°) from (lat1, lon1) to (lat2, lon2). */
export function rangeBearing(lat1: number, lon1: number, lat2: number, lon2: number): { nm: number; bearing: number } {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const nm = (2 * R_M * Math.asin(Math.min(1, Math.sqrt(a)))) / NM_M;
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return { nm, bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

const angle = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Where a plane will be `dtS` seconds on, by its track and speed. */
function ahead(lat: number, lon: number, track: number, gsKt: number, dtS: number): [number, number] {
  const m = (gsKt * NM_M * dtS) / 3600;
  return [lat + (m * Math.cos(rad(track))) / 111_320, lon + (m * Math.sin(rad(track))) / (111_320 * Math.cos(rad(lat)))];
}

/** A plane's movement at SLC, if it's making one: climbing away from the
 * field, or coming down toward it. */
export function movement(a: Aircraft): 0 | 1 | null {
  if (typeof a.alt_baro !== "number" || a.lat === undefined || a.lon === undefined) return null;
  const rate = a.baro_rate ?? a.geom_rate;
  if (rate === undefined) return null;
  const { nm, bearing } = rangeBearing(KSLC.lat, KSLC.lon, a.lat, a.lon);
  if (nm > RADIUS_NM || a.alt_baro > 18_000 || a.alt_baro < KSLC.ft + 200) return null;
  const track = a.track ?? Number.NaN;
  // Departing: climbing, and heading away (or still close in, turning out).
  if (rate >= 500 && (nm < 4 || !Number.isFinite(track) || angle(track, bearing) < 90)) return 0;
  // Landing: coming down, low enough to be on its way in, and toward it.
  if (rate <= -400 && a.alt_baro < 14_000 && (nm < 4 || (Number.isFinite(track) && angle(track, (bearing + 180) % 360) < 60))) return 1;
  return null;
}

/** A movement waiting its turn: as heard, and how it was moving. */
interface Queued {
  row: PlaneRow;
  track: number;
  gs: number;
  rate: number;
}

export class Planes {
  private queue: Queued[] = [];
  private legs = new Map<string, number>();
  private lastOut = 0;
  private dots: PlaneDot[] = [];
  private dotsAt = 0;
  stats = { heard: 0, airborne: 0, departures: 0, arrivals: 0, queued: 0, lastName: null as string | null };

  /** Read what the receivers heard at `now`: queue each new movement. */
  ingest(aircraft: Aircraft[], now: number): void {
    const dots: PlaneDot[] = [];
    this.stats.heard = aircraft.length;
    for (const a of aircraft) {
      if (typeof a.alt_baro !== "number" || a.lat === undefined || a.lon === undefined) continue;
      const age = a.seen_pos ?? a.seen ?? 0;
      if (age > 60) continue;
      const name = airlineName(a.flight);
      dots.push([round4(a.lat), round4(a.lon), Math.round(a.track ?? 0), Math.round(a.gs ?? 0), Math.round(a.alt_baro), Math.round(a.baro_rate ?? a.geom_rate ?? 0), name]);
      const kind = movement(a);
      if (kind === null) continue;
      const key = `${a.hex}|${kind}`;
      if (now - (this.legs.get(key) ?? -Infinity) < LEG_MS) continue;
      this.legs.set(key, now);
      this.queue.push({
        row: [now - age * 1000, a.lat, a.lon, kind, sizeOf(a.category), a.alt_baro, name ? 1 : 0, name ?? ""],
        track: a.track ?? Number.NaN,
        gs: a.gs ?? 0,
        rate: a.baro_rate ?? a.geom_rate ?? 0,
      });
      if (kind === 0) this.stats.departures++;
      else this.stats.arrivals++;
    }
    for (const [k, at] of this.legs) if (now - at > LEG_MS) this.legs.delete(k);
    this.dots = dots;
    this.dotsAt = now;
    this.stats.airborne = dots.length;
    this.stats.queued = this.queue.length;
  }

  /** The next movement due into the windows at `now`, if one is: placed
   * where the plane has got to since it was heard. */
  release(now: number): PlaneRow | null {
    if (now - this.lastOut < SPACING_MS) return null;
    while (this.queue.length && now - this.queue[0]!.row[0] > STALE_MS) this.queue.shift();
    const next = this.queue.shift();
    this.stats.queued = this.queue.length;
    if (!next) return null;
    this.lastOut = now;
    const { row } = next;
    const dt = Math.min(120, (now - row[0]) / 1000);
    let [, lat, lon] = row;
    let ft = row[5];
    if (Number.isFinite(next.track) && dt > 0) {
      [lat, lon] = ahead(lat, lon, next.track, next.gs, dt);
      ft = Math.max(KSLC.ft, ft + (next.rate * dt) / 60);
    }
    if (row[7]) this.stats.lastName = row[7];
    return [now, round4(lat), round4(lon), row[3], row[4], Math.round(ft), row[6], row[7]];
  }

  /** The planes in the air near SLC, for the map. */
  snapshot(): { t: number; planes: PlaneDot[] } {
    return { t: this.dotsAt, planes: this.dots };
  }
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
