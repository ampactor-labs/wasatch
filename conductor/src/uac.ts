// The Utah Avalanche Center's forecast for the Salt Lake mountains
// (UAC_TOKEN): the day's danger, kept for the lowdown and the board. Off
// until the token is set; what it plays waits until its real forecasts have
// been seen.
//
// https://utahavalanchecenter.org/docs/api/forecast: issued between 5 and 8
// AM; they ask for a look every 15 minutes then, and no more.

const FORECAST = "https://utahavalanchecenter.org/forecast/salt-lake/json";
const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };

/** The danger scale's words, by the overall rating (1–5). */
export const DANGER = ["no rating", "low", "moderate", "considerable", "high", "extreme"];

export interface Advisory {
  /** The overall danger, 0 (no rating) to 5 (extreme): the rose's worst. */
  danger: number;
  /** The rose's 24 cells, 0–10 (UAC's scale). */
  rose: number[];
  issued: string;
  bottomLine: string;
}

type Json = Record<string, unknown>;

/** The first object anywhere in `body` that has `key`. */
function find(body: unknown, key: string): Json | null {
  if (Array.isArray(body)) {
    for (const x of body) {
      const f = find(x, key);
      if (f) return f;
    }
  } else if (body && typeof body === "object") {
    if (key in body) return body as Json;
    for (const v of Object.values(body)) {
      const f = find(v, key);
      if (f) return f;
    }
  }
  return null;
}

const text = (html: unknown) =>
  String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export function parseAdvisory(body: unknown): Advisory | null {
  const a = find(body, "overall_danger_rose");
  if (!a) return null;
  const raw = a.overall_danger_rose;
  const rose = (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map(Number).filter(Number.isFinite);
  // 2, 4, 6, 8, 10 are low to extreme; the odd values are "pockets of" the next.
  const worst = rose.length ? Math.max(...rose) : 0;
  return { danger: Math.ceil(worst / 2), rose, issued: text(a.date_issued), bottomLine: text(a.bottom_line).slice(0, 400) };
}

export class Uac {
  private readonly token: string | null;
  latest: Advisory | null = null;
  status: "missing" | "set" | "ok" | "error" = "missing";
  lastError: string | null = null;
  private lastRead = 0;

  constructor(token = process.env.UAC_TOKEN || null) {
    this.token = token;
    if (token) this.status = "set";
  }

  get on(): boolean {
    return this.token !== null;
  }

  /** Whether it's time for a look: once at start, then every 15 minutes
   * from 5 to 8 AM (and every 3 hours while there's no forecast at all). */
  due(now: number): boolean {
    if (!this.lastRead) return true;
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hourCycle: "h23" }).format(now));
    const since = now - this.lastRead;
    const morning = h >= 5 && h < 8 && since >= 15 * 60_000;
    const missing = this.latest === null && since >= 3 * 3_600_000;
    return morning || missing;
  }

  async poll(now = Date.now()): Promise<Advisory | null> {
    if (!this.token) throw new Error("UAC_TOKEN isn't set");
    this.lastRead = now;
    // The token goes both ways UAC's servers have taken one.
    const res = await fetch(`${FORECAST}?token=${encodeURIComponent(this.token)}`, {
      headers: { ...UA, Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      this.status = "error";
      this.lastError = `${res.status}`;
      throw new Error(`UAC ${res.status}`);
    }
    this.status = "ok";
    this.latest = parseAdvisory(await res.json());
    return this.latest;
  }
}
