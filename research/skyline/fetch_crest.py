"""Sample the Wasatch crest from USGS 3DEP (ImageServer getSamples).

Coarse pass: one east-west transect every 0.01 deg of latitude from Ben Lomond
to Mount Nebo, 0.005 deg apart, in a band around a hand-placed center line.
Fine pass: a 5x5 grid at 0.001 deg around each transect's maximum.
Writes raw sample values (meters) to the data directory given as argv[1].
"""
import json
import sys
import time
import urllib.parse
import urllib.request

URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
OUT = sys.argv[1]

# (lat, lon) anchors along the crest, north to south; approximate on purpose,
# the band is wide enough to absorb a few km of error.
ANCHORS = [
    (41.40, -111.97), (41.363, -111.961), (41.20, -111.88), (41.03, -111.84),
    (40.87, -111.76), (40.655, -111.771), (40.595, -111.72), (40.527, -111.756),
    (40.391, -111.646), (40.247, -111.56), (40.10, -111.60), (39.822, -111.760),
    (39.80, -111.76),
]
HALF_BAND = 0.16
LAT_N, LAT_S, DLAT = 41.363, 39.822, 0.01
DLON = 0.005


def center_lon(lat):
    for (la1, lo1), (la2, lo2) in zip(ANCHORS, ANCHORS[1:]):
        if la2 <= lat <= la1:
            t = (la1 - lat) / (la1 - la2)
            return lo1 + t * (lo2 - lo1)
    raise ValueError(lat)


def query(points):
    geom = {"points": points, "spatialReference": {"wkid": 4326}}
    body = urllib.parse.urlencode({
        "geometry": json.dumps(geom),
        "geometryType": "esriGeometryMultipoint",
        "returnFirstValueOnly": "true",
        "f": "json",
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={"User-Agent": "wasatch-design-research"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    out = []
    for s in data.get("samples", []):
        try:
            v = float(s["value"])
        except (KeyError, ValueError):
            v = float("nan")
        out.append((s["location"]["x"], s["location"]["y"], v))
    return out


def run(points, chunk=400):
    results = []
    for i in range(0, len(points), chunk):
        part = points[i:i + chunk]
        for attempt in range(4):
            try:
                results.extend(query(part))
                break
            except Exception as e:  # noqa: BLE001
                print("retry", i, e, file=sys.stderr)
                time.sleep(2 + attempt * 3)
        time.sleep(0.4)
    return results


n_rows = int(round((LAT_N - LAT_S) / DLAT)) + 1
rows = [round(LAT_N - k * DLAT, 4) for k in range(n_rows)]
coarse_pts = []
for lat in rows:
    c = center_lon(lat)
    n = int(round(2 * HALF_BAND / DLON))
    for j in range(n + 1):
        coarse_pts.append([round(c - HALF_BAND + j * DLON, 5), lat])
print("coarse points", len(coarse_pts), file=sys.stderr)
coarse = run(coarse_pts)
with open(f"{OUT}/coarse.json", "w") as f:
    json.dump(coarse, f)

# best per row
best = {}
for x, y, v in coarse:
    key = round(y, 4)
    if v == v and (key not in best or v > best[key][2]):
        best[key] = (x, y, v)
fine_pts = []
for lat in rows:
    if lat not in best:
        continue
    x0, y0, _ = best[lat]
    for di in range(-2, 3):
        for dj in range(-2, 3):
            fine_pts.append([round(x0 + dj * 0.001, 5), round(y0 + di * 0.001, 5)])
print("fine points", len(fine_pts), file=sys.stderr)
fine = run(fine_pts)
with open(f"{OUT}/fine.json", "w") as f:
    json.dump(fine, f)
print("done", len(coarse), len(fine), file=sys.stderr)
