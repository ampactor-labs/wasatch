// GTFS-realtime, decoded by hand: the protobuf wire format is small, and
// the conductor needs only trip updates and vehicle positions. Field
// numbers follow gtfs-realtime.proto (https://gtfs.org/realtime/proto/).

type Field = { n: number; wire: number; v: number | bigint | Uint8Array };

function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0;
  const varint = (): bigint => {
    let shift = 0n;
    let out = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error("truncated varint");
      const b = buf[i++]!;
      out |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return out;
      shift += 7n;
    }
  };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (i < buf.length) {
    const key = Number(varint());
    const n = key >>> 3;
    const wire = key & 7;
    if (wire === 0) yield { n, wire, v: varint() };
    else if (wire === 1) {
      yield { n, wire, v: view.getFloat64(i, true) };
      i += 8;
    } else if (wire === 2) {
      const len = Number(varint());
      yield { n, wire, v: buf.subarray(i, i + len) };
      i += len;
    } else if (wire === 5) {
      yield { n, wire, v: view.getFloat32(i, true) };
      i += 4;
    } else throw new Error(`wire type ${wire}`);
  }
}

const text = (v: Field["v"]) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : "");
const num = (v: Field["v"]) => (typeof v === "bigint" ? Number(BigInt.asIntN(64, v)) : typeof v === "number" ? v : 0);

export interface StopTimeUpdate {
  seq: number;
  stopId: string;
  /** Predicted times, UTC seconds (0 when absent). */
  arrival: number;
  departure: number;
  skipped: boolean;
}

export interface TripUpdate {
  tripId: string;
  routeId: string;
  vehicleId: string;
  timestamp: number;
  stops: StopTimeUpdate[];
}

export interface VehiclePosition {
  tripId: string;
  vehicleId: string;
  lat: number;
  lon: number;
  speed: number;
  timestamp: number;
}

export interface Feed {
  timestamp: number;
  trips: TripUpdate[];
  vehicles: VehiclePosition[];
}

function trip(buf: Uint8Array): { tripId: string; routeId: string } {
  let tripId = "";
  let routeId = "";
  for (const f of fields(buf)) {
    if (f.n === 1) tripId = text(f.v);
    else if (f.n === 5) routeId = text(f.v);
  }
  return { tripId, routeId };
}

function stopTimeEvent(buf: Uint8Array): number {
  let time = 0;
  for (const f of fields(buf)) if (f.n === 2) time = num(f.v);
  return time;
}

function vehicleId(buf: Uint8Array): string {
  for (const f of fields(buf)) if (f.n === 1) return text(f.v);
  return "";
}

function tripUpdate(buf: Uint8Array): TripUpdate {
  const out: TripUpdate = { tripId: "", routeId: "", vehicleId: "", timestamp: 0, stops: [] };
  for (const f of fields(buf)) {
    if (f.n === 1 && f.v instanceof Uint8Array) Object.assign(out, trip(f.v));
    else if (f.n === 3 && f.v instanceof Uint8Array) out.vehicleId = vehicleId(f.v);
    else if (f.n === 4) out.timestamp = num(f.v);
    else if (f.n === 2 && f.v instanceof Uint8Array) {
      const stu: StopTimeUpdate = { seq: 0, stopId: "", arrival: 0, departure: 0, skipped: false };
      for (const g of fields(f.v)) {
        if (g.n === 1) stu.seq = num(g.v);
        else if (g.n === 2 && g.v instanceof Uint8Array) stu.arrival = stopTimeEvent(g.v);
        else if (g.n === 3 && g.v instanceof Uint8Array) stu.departure = stopTimeEvent(g.v);
        else if (g.n === 4) stu.stopId = text(g.v);
        else if (g.n === 5) stu.skipped = num(g.v) === 1;
      }
      out.stops.push(stu);
    }
  }
  return out;
}

function vehiclePosition(buf: Uint8Array): VehiclePosition {
  const out: VehiclePosition = { tripId: "", vehicleId: "", lat: Number.NaN, lon: Number.NaN, speed: Number.NaN, timestamp: 0 };
  for (const f of fields(buf)) {
    if (f.n === 1 && f.v instanceof Uint8Array) out.tripId = trip(f.v).tripId;
    else if (f.n === 2 && f.v instanceof Uint8Array) {
      for (const g of fields(f.v)) {
        if (g.n === 1) out.lat = num(g.v);
        else if (g.n === 2) out.lon = num(g.v);
        else if (g.n === 5) out.speed = num(g.v);
      }
    } else if (f.n === 5) out.timestamp = num(f.v);
    else if (f.n === 8 && f.v instanceof Uint8Array) out.vehicleId = vehicleId(f.v);
  }
  return out;
}

/** Decode a FeedMessage: its timestamp, trip updates and vehicle positions. */
export function decodeFeed(buf: Uint8Array): Feed {
  const feed: Feed = { timestamp: 0, trips: [], vehicles: [] };
  for (const f of fields(buf)) {
    if (f.n === 1 && f.v instanceof Uint8Array) {
      for (const g of fields(f.v)) if (g.n === 3) feed.timestamp = num(g.v);
    } else if (f.n === 2 && f.v instanceof Uint8Array) {
      for (const g of fields(f.v)) {
        if (g.n === 3 && g.v instanceof Uint8Array) feed.trips.push(tripUpdate(g.v));
        else if (g.n === 4 && g.v instanceof Uint8Array) feed.vehicles.push(vehiclePosition(g.v));
      }
    }
  }
  return feed;
}
