// UTA's SIRI API (UTA_TOKEN): the realtime UTA hands developers a token
// for, documented at developer.rideuta.com from 2011 to 2016: VehicleMonitor
// by route (each vehicle with whether it's at its stop, the distance to the
// next one, an estimated departure and a lateness class, which the public
// GTFS-realtime feeds don't carry) and StopMonitor by stop. On Oct 28, 2026
// the documented host answered with the UTA website's 404 page and the
// developer site no longer resolved, so nothing is built on it yet. This
// probes it, so `npm run keys:check` says the moment it answers; UTA_SIRI
// points it at another host if UTA names one.
//
//   http://api.rideuta.com/SIRI/SIRI.svc/VehicleMonitor/ByRoute?route={route}&onwardcalls={bool}&usertoken={token}
//   http://api.rideuta.com/SIRI/SIRI.svc/StopMonitor?stopid={stop}&minutesout={n}&onwardcalls={bool}&filterroute=&usertoken={token}

const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };

export const DEFAULT_SIRI = "https://api.rideuta.com/SIRI/SIRI.svc";

/** The Red Line's route number, and Salt Lake Central's stop id. */
const PROBE_ROUTE = "703";
const PROBE_STOP = "21771";

export interface SiriProbe {
  /** The URL asked, with the token left out. */
  url: string;
  /** null when nothing answered. */
  status: number | null;
  type: string;
  /** Whether the body is a SIRI document. */
  siri: boolean;
  /** What came back: a redirect's target, the SIRI elements counted, or the error. */
  note: string;
}

/** The SIRI elements that matter to the music, counted. */
export function siriElements(xml: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tag of ["VehicleActivity", "MonitoredStopVisit", "MonitoredCall", "VehicleAtStop", "Distance", "EstimatedDepartureTime", "ProgressRate", "Speed", "Bearing", "OnwardCall", "LastGPSFix", "Delay", "Occupancy"]) {
    const n = xml.split(`<${tag}>`).length - 1;
    if (n) out[tag] = n;
  }
  return out;
}

/** Ask the documented calls with `token`, at `base` and over plain http
 * too, and say what each answered. The token never appears in the result. */
export async function probeSiri(token: string, base = process.env.UTA_SIRI || DEFAULT_SIRI): Promise<SiriProbe[]> {
  const bases = [...new Set([base.replace(/\/$/, ""), base.replace(/\/$/, "").replace(/^https:/, "http:")])];
  const calls = [`VehicleMonitor/ByRoute?route=${PROBE_ROUTE}&onwardcalls=true`, `StopMonitor?stopid=${PROBE_STOP}&minutesout=60&onwardcalls=true&filterroute=`];
  const hide = (s: string) => s.split(token).join("<token>");
  const out: SiriProbe[] = [];
  for (const b of bases) {
    for (const call of calls) {
      const url = `${b}/${call}`;
      try {
        const res = await fetch(`${url}&usertoken=${encodeURIComponent(token)}`, { headers: UA, redirect: "manual", signal: AbortSignal.timeout(15_000) });
        const text = await res.text();
        const siri = /<Siri[\s>]/i.test(text);
        const location = res.headers.get("location");
        const note = siri ? JSON.stringify(siriElements(text)) : location ? `redirected to ${hide(location)}` : hide(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120));
        out.push({ url, status: res.status, type: res.headers.get("content-type") ?? "", siri, note });
      } catch (err) {
        out.push({ url, status: null, type: "", siri: false, note: hide(err instanceof Error ? err.message : String(err)) });
      }
    }
  }
  return out;
}
