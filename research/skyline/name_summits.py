"""Name the crest's summits from GNIS and print the theme's steps.

argv[1] is the directory holding crest_profile.json (from analyze_crest.py).
Each summit, plus the profile's two ends, is matched to the nearest GNIS
summit within 4 km (USGS geographic names map service, layer 5, landforms),
then mapped onto ten steps between the lowest and highest of them.
"""
import json
import math
import sys
import urllib.parse
import urllib.request

d = json.load(open(sys.argv[1] + "/crest_profile.json"))
pts = ([(d["lat"][0], d["lon"][0], d["profile_m"][0])]
       + [(s[1], s[2], s[3]) for s in d["summits"]]
       + [(d["lat"][-1], d["lon"][-1], d["profile_m"][-1])])
BASE = "https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/5/query?"
FT = 3.28084

named = []
for la, lo, h in pts:
    q = urllib.parse.urlencode({
        "geometry": f"{lo},{la}", "geometryType": "esriGeometryPoint", "inSR": "4326",
        "distance": "4000", "units": "esriSRUnit_Meter", "outFields": "gaz_name,gaz_featureclass",
        "returnGeometry": "true", "outSR": "4326", "f": "json"})
    with urllib.request.urlopen(BASE + q, timeout=30) as r:
        js = json.load(r)
    best = ("(no GNIS summit within 4 km)", float("inf"))
    for f in js.get("features", []):
        a = f["attributes"]
        if a.get("gaz_featureclass") != "Summit":
            continue
        # geometry comes back as a multipoint
        for x, y in f.get("geometry", {}).get("points", []):
            dist = math.hypot((y - la) * 111.0, (x - lo) * 84.5)
            if dist < best[1]:
                best = (a["gaz_name"], dist)
    named.append((la, lo, h * FT, best[0], best[1]))

lo_ft, hi_ft = min(p[2] for p in named), max(p[2] for p in named)
print("north to south:")
for la, lo, ft, name, dist in named:
    step = round(9 * (ft - lo_ft) / (hi_ft - lo_ft))
    print(f"  {la:.3f}N {lo:.3f}W {ft:7,.0f} ft  step {step}  {name} ({dist:.2f} km)")
