"""Crest profile, summits, spectrum and wavetable from fetch_crest.py output.

argv[1] is the data directory holding coarse.json and fine.json. Writes
crest_profile.json there; name_summits.py names the summits from GNIS.
"""
import cmath
import json
import math
import sys

D = sys.argv[1]
coarse = json.load(open(f"{D}/coarse.json"))
fine = json.load(open(f"{D}/fine.json"))

LAT_N, DLAT = 41.363, 0.01
rows = {}
for x, y, v in coarse + fine:
    if v != v or v < -100:
        continue
    k = int(round((LAT_N - y) / DLAT))
    if k not in rows or v > rows[k][2]:
        rows[k] = (x, y, v)
ks = sorted(rows)
prof = [rows[k][2] for k in ks]
N = len(prof)
FT = 3.28084
print(f"profile samples {N}, {rows[ks[0]][1]:.3f}N to {rows[ks[-1]][1]:.3f}N")
print(f"min {min(prof)*FT:,.0f} ft  max {max(prof)*FT:,.0f} ft  mean {sum(prof)/N*FT:,.0f} ft")


def prominence(i):
    """Height above the higher of the two lowest points between i and the
    nearest higher sample on each side (or the end of the profile)."""
    h = prof[i]
    lo_l, j = h, i
    while j > 0:
        j -= 1
        lo_l = min(lo_l, prof[j])
        if prof[j] > h:
            break
    lo_r, j = h, i
    while j < N - 1:
        j += 1
        lo_r = min(lo_r, prof[j])
        if prof[j] > h:
            break
    return h - max(lo_l, lo_r)


summits = []
for i in range(1, N - 1):
    if prof[i] >= prof[i - 1] and prof[i] >= prof[i + 1]:
        p = prominence(i)
        if p >= 250:
            x, y, v = rows[ks[i]]
            summits.append((i, y, x, v, p))
print("\ninterior summits (prominence on this profile >= 250 m), north to south:")
for i, y, x, v, p in summits:
    print(f"  {y:.3f}N {x:.3f}W  {v*FT:7,.0f} ft  prom {p*FT:5,.0f} ft")

# Spectrum. Detrend between endpoints, then even (mirror) extension so the
# cycle is continuous: Ben Lomond -> Nebo -> back.
a, b = prof[0], prof[-1]
det = [prof[i] - (a + (b - a) * i / (N - 1)) for i in range(N)]
mir = det + det[-2:0:-1]
M = len(mir)
mean = sum(mir) / M
mir = [v - mean for v in mir]


def dft_amp(sig, kmax):
    n = len(sig)
    out = []
    for k in range(1, kmax + 1):
        s = sum(sig[t] * cmath.exp(-2j * math.pi * k * t / n) for t in range(n))
        out.append(abs(s) * 2 / n)
    return out


amps = dft_amp(mir, 64)


def fit(lo, hi):
    xs = [math.log(k) for k in range(lo, hi + 1)]
    ys = [math.log(max(amps[k - 1], 1e-9)) for k in range(lo, hi + 1)]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / sxx


print(f"\nmirrored cycle: {M} samples")
for lo, hi in [(1, 16), (1, 40), (4, 64)]:
    print(f"  amplitude ~ k^{fit(lo, hi):+.2f} over harmonics {lo}-{hi}  (saw -1.00, triangle -2.00)")

print("  octave-band mean amplitude (dB re harmonic 1):")
ref = amps[0]
for lo, hi in [(1, 1), (2, 3), (4, 7), (8, 15), (16, 31), (32, 63)]:
    m = sum(amps[k - 1] for k in range(lo, hi + 1)) / (hi - lo + 1)
    saw = sum(1 / k for k in range(lo, hi + 1)) / (hi - lo + 1)
    print(f"    k {lo:2d}-{hi:2d}: crest {20*math.log10(m/ref):6.1f} dB   saw {20*math.log10(saw):6.1f} dB")

# 256-sample single-cycle wavetable from the mirrored cycle
W = 256
wt = []
for t in range(W):
    pos = t * M / W
    i0 = int(pos) % M
    i1 = (i0 + 1) % M
    fr = pos - int(pos)
    wt.append(mir[i0] * (1 - fr) + mir[i1] * fr)
pk = max(abs(v) for v in wt)
wt = [v / pk for v in wt]
wamps = dft_amp(wt, 40)
print("\n256-sample wavetable, first 12 harmonics (dB re fundamental):")
print("  " + "  ".join(f"{20*math.log10(max(x,1e-9)/wamps[0]):5.1f}" for x in wamps[:12]))
c = sum(k * wamps[k - 1] ** 2 for k in range(1, 13)) / sum(x ** 2 for x in wamps[:12])
print(f"  power-weighted centroid over harmonics 1-12: {c:.2f}")
tilted = [wamps[k - 1] * k ** -0.5 for k in range(1, 41)]
xs = [math.log(k) for k in range(1, 41)]
ys = [math.log(v) for v in tilted]
mx, my = sum(xs) / 40, sum(ys) / 40
slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
print(f"  after a k^-0.5 tilt, harmonics 1-40 fit k^{slope:+.2f}")
json.dump({"profile_m": prof, "lat": [rows[k][1] for k in ks], "lon": [rows[k][0] for k in ks],
           "wavetable": wt, "summits": summits}, open(f"{D}/crest_profile.json", "w"))
