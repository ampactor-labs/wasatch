"""Minimal stdlib-only GTFS-realtime protobuf decoder for inspection.

Usage: python3 -I gtfsrt_decode.py <TripUpdate.pb> <Vehicle.pb>
Field numbers follow https://gtfs.org/realtime/proto/ (gtfs-realtime.proto).
"""
import struct
import sys
from collections import Counter


def read_varint(buf, i):
    shift = 0
    result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, i
        shift += 7


def fields(buf):
    """Yield (field_number, wire_type, value) for a message buffer."""
    i = 0
    n = len(buf)
    while i < n:
        key, i = read_varint(buf, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = read_varint(buf, i)
        elif wt == 1:
            v = buf[i:i + 8]
            i += 8
        elif wt == 2:
            ln, i = read_varint(buf, i)
            v = buf[i:i + ln]
            i += ln
        elif wt == 5:
            v = buf[i:i + 4]
            i += 4
        else:
            raise ValueError("unsupported wire type %d" % wt)
        yield fn, wt, v


def to_int64(v):
    return v - (1 << 64) if v >= (1 << 63) else v


def parse_trip(buf):
    d = {}
    for fn, wt, v in fields(buf):
        if fn == 1:
            d["trip_id"] = v.decode()
        elif fn == 2:
            d["start_time"] = v.decode()
        elif fn == 3:
            d["start_date"] = v.decode()
        elif fn == 4:
            d["schedule_relationship"] = v
        elif fn == 5:
            d["route_id"] = v.decode()
        elif fn == 6:
            d["direction_id"] = v
    return d


def parse_ste(buf):
    d = {}
    for fn, wt, v in fields(buf):
        if fn == 1:
            d["delay"] = to_int64(v)
        elif fn == 2:
            d["time"] = to_int64(v)
        elif fn == 3:
            d["uncertainty"] = to_int64(v)
    return d


def parse_stu(buf):
    d = {}
    for fn, wt, v in fields(buf):
        if fn == 1:
            d["stop_sequence"] = v
        elif fn == 2:
            d["arrival"] = parse_ste(v)
        elif fn == 3:
            d["departure"] = parse_ste(v)
        elif fn == 4:
            d["stop_id"] = v.decode()
        elif fn == 5:
            d["schedule_relationship"] = v
    return d


def parse_vehdesc(buf):
    d = {}
    for fn, wt, v in fields(buf):
        if fn == 1:
            d["id"] = v.decode()
        elif fn == 2:
            d["label"] = v.decode()
    return d


def parse_tripupdate(buf):
    d = {"stu": [], "present": set()}
    for fn, wt, v in fields(buf):
        d["present"].add(fn)
        if fn == 1:
            d["trip"] = parse_trip(v)
        elif fn == 2:
            d["stu"].append(parse_stu(v))
        elif fn == 3:
            d["vehicle"] = parse_vehdesc(v)
        elif fn == 4:
            d["timestamp"] = v
        elif fn == 5:
            d["delay"] = to_int64(v)
    return d


def parse_position(buf):
    d = {}
    names = {1: "lat", 2: "lon", 3: "bearing", 5: "speed"}
    for fn, wt, v in fields(buf):
        if fn in names and wt == 5:
            d[names[fn]] = struct.unpack("<f", v)[0]
        elif fn == 4 and wt == 1:
            d["odometer"] = struct.unpack("<d", v)[0]
    return d


def parse_vehicle(buf):
    d = {"present": set()}
    for fn, wt, v in fields(buf):
        d["present"].add(fn)
        if fn == 1:
            d["trip"] = parse_trip(v)
        elif fn == 2:
            d["position"] = parse_position(v)
        elif fn == 3:
            d["current_stop_sequence"] = v
        elif fn == 4:
            d["current_status"] = v
        elif fn == 5:
            d["timestamp"] = v
        elif fn == 6:
            d["congestion_level"] = v
        elif fn == 7:
            d["stop_id"] = v.decode()
        elif fn == 8:
            d["vehicle"] = parse_vehdesc(v)
        elif fn == 9:
            d["occupancy_status"] = v
    return d


def parse_feed(path):
    buf = open(path, "rb").read()
    header = {}
    entities = []
    for fn, wt, v in fields(buf):
        if fn == 1:
            for hf, hw, hv in fields(v):
                if hf == 1:
                    header["version"] = hv.decode()
                elif hf == 2:
                    header["incrementality"] = hv
                elif hf == 3:
                    header["timestamp"] = hv
        elif fn == 2:
            ent = {"present": set()}
            for ef, ew, ev in fields(v):
                ent["present"].add(ef)
                if ef == 1:
                    ent["id"] = ev.decode()
                elif ef == 3:
                    ent["trip_update"] = parse_tripupdate(ev)
                elif ef == 4:
                    ent["vehicle"] = parse_vehicle(ev)
            entities.append(ent)
    return header, entities


def stu_time(s):
    for k in ("departure", "arrival"):
        if k in s and "time" in s[k]:
            return s[k]["time"]
    return None


def main():
    tu_path, vp_path = sys.argv[1], sys.argv[2]
    th, tents = parse_feed(tu_path)
    vh, vents = parse_feed(vp_path)
    print("TripUpdate header:", th, "entities:", len(tents))
    tus = [e["trip_update"] for e in tents if "trip_update" in e]
    now = th.get("timestamp", 0)
    n_stu = sum(len(t["stu"]) for t in tus)
    print("trip_updates:", len(tus), "total stop_time_updates:", n_stu)
    print("TripUpdate fields present (counts):",
          Counter(f for t in tus for f in t["present"]))
    print("STU field presence:",
          Counter(k for t in tus for s in t["stu"] for k in s))
    print("STU arrival subfields:",
          Counter(k for t in tus for s in t["stu"] for k in s.get("arrival", {})))
    print("STU departure subfields:",
          Counter(k for t in tus for s in t["stu"] for k in s.get("departure", {})))
    print("STU schedule_relationship:",
          Counter(s.get("schedule_relationship", "absent(=SCHEDULED)") for t in tus for s in t["stu"]))
    past_120 = 0
    trips_with_past = 0
    first_seq = Counter()
    for t in tus:
        times = [stu_time(s) for s in t["stu"]]
        p = sum(1 for x in times if x is not None and x < now - 120)
        past_120 += p
        if p:
            trips_with_past += 1
        if t["stu"]:
            first_seq[t["stu"][0].get("stop_sequence", "absent")] += 1
    print("STUs with time > 120 s before header timestamp:", past_120,
          "in", trips_with_past, "trips")
    print("first STU stop_sequence distribution (top 10):", first_seq.most_common(10))

    print()
    print("Vehicle header:", vh, "entities:", len(vents))
    vps = [e["vehicle"] for e in vents if "vehicle" in e]
    print("vehicle positions:", len(vps))
    print("VehiclePosition fields present (counts):",
          Counter(f for v in vps for f in v["present"]))
    print("current_status values (0=INCOMING_AT,1=STOPPED_AT,2=IN_TRANSIT_TO):",
          Counter(v.get("current_status", "absent") for v in vps))
    ages = sorted(vh.get("timestamp", 0) - v["timestamp"] for v in vps if "timestamp" in v)
    if ages:
        print("vehicle timestamp age vs header (s): min %d median %d max %d" % (
            ages[0], ages[len(ages) // 2], ages[-1]))
    print("position subfields:", Counter(k for v in vps for k in v.get("position", {})))

    # Cross-check: for vehicles with current_stop_sequence, does the matching
    # TripUpdate still contain STUs with smaller stop_sequence?
    by_trip = {t["trip"].get("trip_id"): t for t in tus if "trip" in t}
    checked = 0
    behind = 0
    examples = []
    for v in vps:
        tid = v.get("trip", {}).get("trip_id")
        cs = v.get("current_stop_sequence")
        if tid in by_trip and cs is not None:
            seqs = [s.get("stop_sequence") for s in by_trip[tid]["stu"] if "stop_sequence" in s]
            if not seqs:
                continue
            checked += 1
            older = [q for q in seqs if q < cs]
            if older:
                behind += 1
                if len(examples) < 3:
                    examples.append((tid, cs, seqs[:6], len(seqs)))
    print("trips cross-checked:", checked,
          "| TripUpdates still listing stop_sequence < vehicle current_stop_sequence:", behind)
    for ex in examples:
        print("   example trip", ex[0], "vehicle at seq", ex[1], "TU seqs start", ex[2], "n", ex[3])
    # Print one sample trip update compactly
    if tus:
        t = max(tus, key=lambda x: len(x["stu"]))
        print()
        print("sample trip:", t.get("trip"), "vehicle:", t.get("vehicle"), "ts:", t.get("timestamp"))
        for s in t["stu"][:5]:
            print("   ", {k: s[k] for k in s})
    if vps:
        print("sample vehicle:", {k: v for k, v in vps[0].items() if k != "present"})


if __name__ == "__main__":
    main()
