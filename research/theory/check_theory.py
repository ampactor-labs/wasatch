"""Checks the harmony-space, cadence and timing claims made in DESIGN.md rev 2."""
import math
from datetime import datetime, timedelta, timezone

NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MODES = {"Lydian": 3, "Ionian": 0, "Mixolydian": 4, "Dorian": 1, "Aeolian": 5}  # degree of the major scale that is home


def pc_of_fifths(pos):  # circle position (C=0, G=1, F=-1) -> pitch class
    return (7 * pos) % 12


def collection(c):  # notes in play: the major scale on circle position c
    root = pc_of_fifths(c)
    return {(root + i) % 12 for i in MAJOR}


def mode_scale(tonic_pc, mode):
    deg = MODES[mode]
    rot = MAJOR[deg:] + [x + 12 for x in MAJOR[:deg]]
    return [(tonic_pc + x - MAJOR[deg]) % 12 for x in rot]


# 1. The brightness ladder on a fixed tonic is the circle of fifths.
print("1. ladder on C as collections:")
for mode in ["Lydian", "Ionian", "Mixolydian", "Dorian", "Aeolian"]:
    s = set(mode_scale(0, mode))
    c = next(c for c in range(-6, 7) if collection(c) == s)
    print(f"   C {mode:<10} = notes of {NAMES[pc_of_fifths(c)]} major (circle {c:+d})")

# 2. Home position within a collection: t in [c-1, c+3] gives the five modes.
print("2. homes inside C major's notes (c=0):")
for t in range(-1, 4):
    rung = t - 0 + 1
    mode = ["Lydian", "Ionian", "Mixolydian", "Dorian", "Aeolian"][rung]
    s = set(mode_scale(pc_of_fifths(t), mode))
    assert s == collection(0), (t, mode)
    print(f"   t={t:+d}: {NAMES[pc_of_fifths(t)]} {mode}")


def triads(scale):
    out = []
    for i in range(7):
        r, th, f = scale[i], scale[(i + 2) % 7], scale[(i + 4) % 7]
        q = ((th - r) % 12, (f - r) % 12)
        kind = {(4, 7): "", (3, 7): "m", (3, 6): "dim", (4, 8): "aug"}[q]
        out.append((frozenset((r, th, f)), NAMES[r] + kind))
    return out


# 3. Progression bank is diatonic (roman numerals resolved per mode on C).
BANK = {
    "Ionian": ["I V vi IV", "vi IV I V", "I IV vi V", "ii V I"],
    "Lydian": ["I II I vii", "I II V I"],
    "Mixolydian": ["I bVII IV I"],
    "Dorian": ["i IV", "i bIII bVII IV"],
    "Aeolian": ["i bVI bIII bVII", "i iv bVII bIII"],
}
ROMAN = {"I": 0, "II": 2, "III": 4, "IV": 5, "V": 7, "VI": 9, "VII": 11}
print("3. bank check:")
for mode, progs in BANK.items():
    sc = mode_scale(0, mode)
    tri = {name: notes for notes, name in triads(sc)}
    notes_by_root = {min(n, key=lambda x: 0): None for n in []}
    for prog in progs:
        for sym in prog.split():
            flat = sym.startswith("b")
            core = sym[1:] if flat else sym
            minor = core.islower()
            root = (ROMAN[core.upper()] - (1 if flat else 0)) % 12
            want = frozenset((root, (root + (3 if minor else 4)) % 12, (root + 7) % 12))
            ok = want <= set(sc)
            if not ok:
                print(f"   NOT DIATONIC: {mode} {sym}")
    print(f"   {mode}: ok")

# 4. Lake substitutes: vi (Ionian/Lydian/Mixolydian), bIII (Dorian), bVI (Aeolian).
print("4. lake substitutes on C:")
for mode, (sym, root, minor) in {"Ionian": ("vi", 9, True), "Lydian": ("vi", 9, True),
                                  "Mixolydian": ("vi", 9, True), "Dorian": ("bIII", 3, False),
                                  "Aeolian": ("bVI", 8, False)}.items():
    want = {root, (root + (3 if minor else 4)) % 12, (root + 7) % 12}
    print(f"   {mode:<10} {sym:<4} diatonic={want <= set(mode_scale(0, mode))}")

# 5. Appendix C example: E Dorian (notes of D major) -> B Dorian (notes of A major).
a, b = collection(2), collection(3)
print("5. D major notes -> A major notes: changed", sorted(NAMES[x] for x in a - b), "->", sorted(NAMES[x] for x in b - a))
ta = {n: s for s, n in triads(mode_scale(4, "Dorian"))}
tb = {n: s for s, n in triads(mode_scale(11, "Dorian"))}
print("   shared triads:", sorted(set(ta) & set(tb)))
print("   E Dorian triads:", list(ta))
sc = mode_scale(4, "Dorian")
print("   E Dorian bVII->i =", NAMES[(4 + 10) % 12], "-> Em; bIII =", NAMES[(4 + 3) % 12], "; IV =", NAMES[(4 + 5) % 12])

# 6. Section cycle lengths.
print("6. cycle lengths (phrases min-max):")
SECTIONS_DAY = [(5, 7), (6, 8), (4, 6), (6, 6), (3, 4)]
SECTIONS_NIGHT = [(5, 7), (3, 4), (4, 6), (6, 6), (3, 4)]
for name, bpm, secs in [("Nocturne", 72, SECTIONS_NIGHT), ("First light", 84, SECTIONS_DAY),
                        ("Work", 96, SECTIONS_DAY), ("Rush", 100, SECTIONS_DAY), ("Last trains", 88, SECTIONS_DAY)]:
    phrase = 8 * 4 * 60 / bpm
    lo, hi = sum(s[0] for s in secs), sum(s[1] for s in secs)
    avg_sec = (lo + hi) / 2 / 5 * phrase
    print(f"   {name:<12} {bpm} BPM phrase {phrase:5.1f}s cycle {lo}-{hi} phrases = {lo*phrase/60:4.1f}-{hi*phrase/60:4.1f} min;"
          f" boundaries per 15 min ~{900/avg_sec:4.1f}; section {lo/5*phrase/60:.1f}-{hi/5*phrase/60:.1f} min avg")
print("   groove phrase 3 of 8 at 100 BPM: after it ends", 5 * 19.2, "s remain")

# 7. Never a loop: ambient layers on prime numbers of beats; Eno's loops.
from itertools import combinations
beat = 60 / 96
primes = [61, 67, 71, 73]
pair_min = min(math.lcm(a, b) for a, b in combinations(primes, 2))
print(f"7. layer cycles {primes} beats = {primes[0]*beat:.1f}-{primes[-1]*beat:.1f} s at 96 BPM;"
      f" closest pair realigns after {pair_min*beat/60:.1f} min; all four after"
      f" {math.lcm(*primes)*beat/86400:.0f} days")
eno = [376, 414, 479]  # 23.5, 25.875, 29.9375 s in sixteenths of a second
pairs = [math.lcm(a, b) / 16 / 3600 for a, b in combinations(eno, 2)]
print(f"   Eno's loops: pairs realign after {min(pairs):.2f}-{max(pairs):.2f} h;"
      f" all three after {math.lcm(*eno) / 16 / 86400:.1f} days")

# 7b. A Day in Twelve Minutes and the distance law.
bars = 12 * 60 / (4 * 60 / 100)
print(f"   A Day in Twelve Minutes: {bars:.0f} bars at 100 BPM, {24*60/bars:.1f} min of day per bar,"
      f" {int(bars // 8)} phrases ({8*24*60/bars:.0f} min of day each)")
for d_km in (30,):
    g1 = -20 * math.log10(1 + d_km / 3)
    g2 = -10 * math.log10(1 + d_km / 3)
    print(f"   distance law at {d_km} km: {g1:.1f} dB, under an inversion {g2:.1f} dB ({g2 - g1:+.1f} dB)")


# 8. Sunset at Salt Lake City on 2026-10-23 (NOAA approximation).
def sun_elev(dt_utc, lat, lon):
    jd = dt_utc.timestamp() / 86400 + 2440587.5
    n = jd - 2451545.0
    L = (280.460 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    dec = math.asin(math.sin(eps) * math.sin(lam))
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    ha = math.radians((gmst * 15 + lon) - math.degrees(ra))
    la = math.radians(lat)
    return math.degrees(math.asin(math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha)))


MDT = timezone(timedelta(hours=-6))
t = datetime(2026, 10, 23, 17, 0, tzinfo=MDT)
while sun_elev(t.astimezone(timezone.utc), 40.7608, -111.8910) > -0.833:
    t += timedelta(minutes=1)
e542 = sun_elev(datetime(2026, 10, 23, 17, 42, tzinfo=MDT).astimezone(timezone.utc), 40.7608, -111.8910)
print(f"8. SLC sunset 2026-10-23 ~ {t:%H:%M} MDT; sun elevation at 17:42 = {e542:.1f} deg")
