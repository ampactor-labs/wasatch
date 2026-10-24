//! Where each family lives, and how it's heard from a vantage.
//!
//! Trains, bikes, quakes and the seismometers are points, placed one event at
//! a time (space.rs). The rest live somewhere bigger: the skyline pad in the
//! mountains, the kit in the city, the pedal in the lake, the bass in the
//! rivers, the harp on the ridges and up the canyons, the snow grains over
//! the Cottonwoods. Each home is sampled as points, on a grid for an area and
//! along a line for a river or a ridge, and every point is heard by the same
//! law as an event: (1 + d/3 km)^−1, flatter under an inversion, softer
//! behind you, and over the walls when you're up Little Cottonwood. Their
//! power adds up, so the physics comes for free: a long line falls off
//! about 3 dB a doubling instead of 6, and an area you're inside of
//! surrounds you.
//!
//! What comes out is a stage per family. Heard from its home (the vantage
//! that hears it best) a family is as played; from anywhere else, it's as
//! much quieter, darker and wetter as its points are together: its level,
//! its highs (the one cut that leaves the same share of them as all its
//! points' cuts) and its distance (a share of reverb). Its width is the
//! power-weighted spread of its points' pans, so a range you stand in is
//! wide and a lake 20 km off is narrow, and its direction fades as it
//! surrounds you. The bus glides to a new stage in about a second, so
//! changing vantage sounds like walking, not a cut.

use super::pan_gains;
use super::space::{Vantage, WALLS, cut_hz, distance_gain, in_canyons, relative, shade};
use super::voices::Out;

/// A family with a home.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Home {
    /// The skyline pad: the Wasatch, from the bench to the crest.
    Mountains = 0,
    /// The kit: the city's buses.
    City = 1,
    /// The pedal: the Great Salt Lake.
    Lake = 2,
    /// The bass: the Jordan River, Little Cottonwood Creek, City Creek.
    Rivers = 3,
    /// The harp: wind on the ridges and down the canyons.
    Ridges = 4,
    /// The snow grains: snowfall over the Cottonwoods.
    Snow = 5,
    /// The air: whatever wind is where you stand.
    Air = 6,
}

/// How many homes.
pub const HOMES: usize = 7;

/// Every home, in order.
pub const ALL: [Home; HOMES] = [
    Home::Mountains,
    Home::City,
    Home::Lake,
    Home::Rivers,
    Home::Ridges,
    Home::Snow,
    Home::Air,
];

/// Latitude, longitude.
type Ll = (f32, f32);

/// The Wasatch: north to south along the bench where the slope starts, then
/// back north along the crest.
const MOUNTAINS: &[Ll] = &[
    (41.000, -111.890),
    (40.840, -111.905),
    (40.800, -111.895),
    (40.778, -111.880), // Capitol Hill
    (40.765, -111.835), // the University's bench
    (40.700, -111.805),
    (40.620, -111.790), // Big Cottonwood's mouth
    (40.575, -111.790), // Little Cottonwood's mouth
    (40.500, -111.780),
    (40.440, -111.800),
    (40.440, -111.650), // Lone Peak
    (40.560, -111.640),
    (40.600, -111.580), // over Brighton
    (40.680, -111.600),
    (40.760, -111.700),
    (40.850, -111.780),
    (41.000, -111.800),
];

/// The valley floor the buses run on.
const CITY: &[Ll] = &[
    (40.880, -111.960), // North Salt Lake
    (40.810, -111.900),
    (40.778, -111.870),
    (40.760, -111.830),
    (40.700, -111.810),
    (40.620, -111.800),
    (40.560, -111.810),
    (40.500, -111.830), // Draper
    (40.480, -111.920),
    (40.500, -112.000), // Herriman
    (40.590, -112.040),
    (40.680, -112.080), // Magna
    (40.750, -112.030),
    (40.790, -111.990),
];

/// The lake's south arm and Farmington Bay, at about today's low level.
const LAKE: &[Ll] = &[
    (40.770, -112.300),
    (40.758, -112.170), // the shore at Saltair
    (40.790, -112.100),
    (40.880, -112.080),
    (40.950, -112.030), // Farmington Bay
    (41.050, -112.100),
    (41.200, -112.250),
    (41.250, -112.450),
    (41.100, -112.600),
    (40.900, -112.550),
    (40.800, -112.420),
];

const JORDAN: &[Ll] = &[
    (40.440, -111.930), // the Jordan Narrows
    (40.520, -111.915),
    (40.600, -111.925),
    (40.680, -111.930),
    (40.740, -111.935),
    (40.775, -111.940),
    (40.820, -111.950),
    (40.870, -111.975),
];
const LITTLE_COTTONWOOD_CREEK: &[Ll] = &[
    (40.590, -111.640), // Alta
    (40.574, -111.680),
    (40.571, -111.703), // Tanners Flat
    (40.573, -111.750),
    (40.577, -111.790), // the mouth
    (40.600, -111.830),
    (40.630, -111.880),
    (40.645, -111.925), // into the Jordan
];
const CITY_CREEK: &[Ll] = &[
    (40.850, -111.860),
    (40.810, -111.875),
    (40.780, -111.887),
    (40.771, -111.893), // under North Temple
    (40.771, -111.920),
];
const RIVERS: &[&[Ll]] = &[JORDAN, LITTLE_COTTONWOOD_CREEK, CITY_CREEK];

const CREST: &[Ll] = &[
    (40.440, -111.650),
    (40.560, -111.640),
    (40.600, -111.580),
    (40.680, -111.600),
    (40.760, -111.700),
    (40.850, -111.780),
    (40.950, -111.820),
];
const LITTLE_COTTONWOOD: &[Ll] = &[
    (40.577, -111.790),
    (40.571, -111.703),
    (40.580, -111.640),
    (40.565, -111.600),
];
const BIG_COTTONWOOD: &[Ll] = &[
    (40.620, -111.790),
    (40.640, -111.700),
    (40.620, -111.620),
    (40.600, -111.585),
];
const RIDGES: &[&[Ll]] = &[CREST, LITTLE_COTTONWOOD, BIG_COTTONWOOD];

/// Alta, Snowbird, Brighton and Solitude.
const SNOW: (Ll, f32) = ((40.585, -111.640), 7.0);

/// A home's shape, and how finely it's sampled (km).
#[derive(Clone, Copy, Debug)]
enum Shape {
    Area(&'static [Ll], f32),
    Lines(&'static [&'static [Ll]], f32),
    Disc(Ll, f32, f32),
}

fn shape(h: Home) -> Option<Shape> {
    match h {
        Home::Mountains => Some(Shape::Area(MOUNTAINS, 1.5)),
        Home::City => Some(Shape::Area(CITY, 1.5)),
        Home::Lake => Some(Shape::Area(LAKE, 2.5)),
        Home::Rivers => Some(Shape::Lines(RIVERS, 0.5)),
        Home::Ridges => Some(Shape::Lines(RIDGES, 0.5)),
        Home::Snow => Some(Shape::Disc(SNOW.0, SNOW.1, 1.0)),
        Home::Air => None,
    }
}

const KM_LAT: f32 = 110.57;

fn km_lon(lat: f32) -> f32 {
    libm::cosf(lat.to_radians()) * 111.32
}

/// Ray casting.
fn inside(poly: &[Ll], lat: f32, lon: f32) -> bool {
    let mut c = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (yi, xi) = poly[i];
        let (yj, xj) = poly[j];
        if (yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi {
            c = !c;
        }
        j = i;
    }
    c
}

/// Every sample point of a shape, with its weight (the length or area it
/// stands for, in steps).
fn each_point(s: Shape, mut f: impl FnMut(f32, f32, f32)) {
    let grid = |s: f32, n: f32, w: f32, e: f32, step: f32, f: &mut dyn FnMut(f32, f32)| {
        let dlat = step / KM_LAT;
        let dlon = step / km_lon(0.5 * (s + n));
        let mut lat = s + 0.5 * dlat;
        while lat < n {
            let mut lon = w + 0.5 * dlon;
            while lon < e {
                f(lat, lon);
                lon += dlon;
            }
            lat += dlat;
        }
    };
    match s {
        Shape::Area(poly, step) => {
            let (mut s, mut n, mut w, mut e) = (90.0f32, -90.0f32, 180.0f32, -180.0f32);
            for &(lat, lon) in poly {
                s = s.min(lat);
                n = n.max(lat);
                w = w.min(lon);
                e = e.max(lon);
            }
            grid(s, n, w, e, step, &mut |lat, lon| {
                if inside(poly, lat, lon) {
                    f(lat, lon, 1.0);
                }
            });
        }
        Shape::Disc((lat0, lon0), r, step) => {
            let (dlat, dlon) = (r / KM_LAT, r / km_lon(lat0));
            grid(
                lat0 - dlat,
                lat0 + dlat,
                lon0 - dlon,
                lon0 + dlon,
                step,
                &mut |lat, lon| {
                    let dy = (lat - lat0) * KM_LAT;
                    let dx = (lon - lon0) * km_lon(lat0);
                    if dx * dx + dy * dy <= r * r {
                        f(lat, lon, 1.0);
                    }
                },
            );
        }
        Shape::Lines(lines, step) => {
            for line in lines {
                for seg in line.windows(2) {
                    let (a, b) = (seg[0], seg[1]);
                    let dy = (b.0 - a.0) * KM_LAT;
                    let dx = (b.1 - a.1) * km_lon(0.5 * (a.0 + b.0));
                    let len = libm::sqrtf(dx * dx + dy * dy);
                    let n = libm::ceilf(len / step).max(1.0);
                    let w = len / n / step;
                    for k in 0..n as usize {
                        let t = (k as f32 + 0.5) / n;
                        f(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, w);
                    }
                }
            }
        }
    }
}

/// A family's stage from where you are.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stage {
    /// Level, against the vantage that hears it best (0–1).
    pub gain: f32,
    /// Direction, −1 left … 1 right.
    pub pan: f32,
    /// Stereo width: 1 as played, less for a far, narrow source, more for
    /// one that surrounds you.
    pub width: f32,
    /// The distance cut's corner (Hz), 0 for none.
    pub cut_hz: f32,
    /// Extra reverb send for distance.
    pub send: f32,
}

impl Stage {
    /// As played: the map view.
    pub const AS_PLAYED: Stage = Stage {
        gain: 1.0,
        pan: 0.0,
        width: 1.0,
        cut_hz: 0.0,
        send: 0.0,
    };
}

/// The least of a family's level from anywhere: far families recede, but
/// the music keeps its parts.
const FLOOR: f32 = 0.25;

/// What a home sounds like from a point: the summed power of its points and
/// its power-weighted pan, pan spread and distance, and the one distance cut
/// that leaves as much of its highs as all its points' cuts together.
#[derive(Clone, Copy, Debug, Default)]
struct Heard {
    power: f32,
    pan: f32,
    spread: f32,
    d: f32,
    /// The share of its highs left, 0–1.
    highs: f32,
}

/// The corner (Hz) of the bus's two-pole cut that leaves `share` of the
/// highs; 0 for all. Two poles (12 dB an octave), as air takes the top
/// more steeply than the middle.
fn corner_for(share: f32) -> f32 {
    if share > 0.999 {
        0.0
    } else {
        HIGHS_HZ / libm::sqrtf(1.0 / libm::sqrtf(share.max(1e-6)) - 1.0)
    }
}

/// Where the highs are weighed: a hat's edge, a bell's shimmer, and still
/// inside what a phone's speaker plays (about 500 Hz to 6 kHz).
const HIGHS_HZ: f32 = 4000.0;

/// What a point's distance leaves of its power at [`HIGHS_HZ`]: the same
/// one-pole cut an event at that distance gets.
fn highs_left(fc: f32) -> f32 {
    let x = HIGHS_HZ / fc;
    1.0 / (1.0 + x * x)
}

/// Each of a home's points as heard from `at`: its power, its pan, its
/// distance, and its distance cut (Hz).
fn each_heard(
    s: Shape,
    vantage: Vantage,
    at: (f32, f32, f32),
    inversion: f32,
    f: &mut dyn FnMut(f32, f32, f32, f32),
) {
    each_point(s, |lat, lon, w| {
        let (dist, side, ahead) = relative(at, lat, lon);
        let mut g = distance_gain(dist, inversion) * shade(ahead);
        let mut fc = cut_hz(dist);
        if vantage.walled() && !in_canyons(lat, lon) {
            g *= WALLS.0;
            fc *= WALLS.1;
        }
        f(w * g * g, side * 0.9, dist, fc);
    });
}

fn hear(s: Shape, vantage: Vantage, inversion: f32) -> Heard {
    let Some(at) = vantage.point() else {
        return Heard::default();
    };
    let (mut power, mut pan, mut d, mut highs) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    each_heard(s, vantage, at, inversion, &mut |p, side, dist, fc| {
        power += p;
        pan += p * side;
        d += p * dist;
        highs += p * if fc >= 15_000.0 { 1.0 } else { highs_left(fc) };
    });
    if power <= 0.0 {
        return Heard::default();
    }
    let mean = pan / power;
    let mut var = 0.0f32;
    each_heard(s, vantage, at, inversion, &mut |p, side, _, _| {
        var += p * (side - mean) * (side - mean);
    });
    Heard {
        power,
        pan: mean,
        spread: libm::sqrtf(var / power),
        d: d / power,
        highs: (highs / power).min(1.0),
    }
}

/// The mean longitude of a home's points: where it sits on the map.
fn mean_lon(s: Shape) -> f32 {
    let (mut sum, mut n) = (0.0f32, 0.0f32);
    each_point(s, |_, lon, w| {
        sum += lon * w;
        n += w;
    });
    if n > 0.0 { sum / n } else { -111.89 }
}

/// Where the wind finds you: sheltered between towers, open on the shore.
fn exposure(v: Vantage) -> f32 {
    match v {
        Vantage::Everywhere | Vantage::Canyons => 1.0,
        Vantage::Downtown => 0.6,
        Vantage::Lake => 1.3,
    }
}

const POSITIONED: [Vantage; 3] = [Vantage::Downtown, Vantage::Canyons, Vantage::Lake];

/// The homes, with what's needed to stage them.
#[derive(Clone, Debug)]
pub struct Homes {
    /// Each home as heard from the vantage that hears it best: its power,
    /// its share of highs, its distance.
    best: [(f32, f32, f32); HOMES],
    /// Each home's pan on the map.
    map_pan: [f32; HOMES],
}

impl Default for Homes {
    fn default() -> Self {
        Self::new()
    }
}

impl Homes {
    /// Survey the valley once.
    pub fn new() -> Self {
        let mut best = [(1.0f32, 1.0f32, 0.0f32); HOMES];
        let mut map_pan = [0.0f32; HOMES];
        for h in ALL {
            let Some(s) = shape(h) else { continue };
            let home = POSITIONED
                .iter()
                .map(|&v| hear(s, v, 0.0))
                .max_by(|a, b| a.power.total_cmp(&b.power))
                .unwrap_or_default();
            best[h as usize] = (home.power.max(1e-9), home.highs.max(1e-4), home.d);
            // West left, east right, as for events on the map, but half as
            // far: a range or a lake is too big to sit in one ear.
            map_pan[h as usize] = ((mean_lon(s) + 111.89) / 0.16).clamp(-1.0, 1.0) * 0.35;
        }
        Homes { best, map_pan }
    }

    /// A home's stage from `vantage` under an `inversion` (0–1).
    pub fn stage(&self, h: Home, vantage: Vantage, inversion: f32) -> Stage {
        let i = h as usize;
        let Some(s) = shape(h) else {
            return Stage {
                gain: exposure(vantage),
                ..Stage::AS_PLAYED
            };
        };
        if vantage.point().is_none() {
            return Stage {
                pan: self.map_pan[i],
                ..Stage::AS_PLAYED
            };
        }
        let heard = hear(s, vantage, inversion);
        let (power, highs, d) = self.best[i];
        let fc = corner_for(heard.highs / highs);
        Stage {
            gain: libm::sqrtf(heard.power / power).clamp(FLOOR, 1.0),
            // A source all around you has no one direction.
            pan: heard.pan * (1.0 - (heard.spread / 0.6).min(1.0)),
            width: (0.35 + 1.6 * heard.spread).clamp(0.35, 1.5),
            cut_hz: if fc == 0.0 || fc >= 15_000.0 {
                0.0
            } else {
                fc.max(1000.0)
            },
            send: 0.35 * ((heard.d - d) / 25.0).clamp(0.0, 1.0),
        }
    }
}

/// How near a set of points (the rail stations) is from `vantage`, against
/// the vantage that has them nearest (0–1); 1 on the map.
pub fn nearness<I: Iterator<Item = (f32, f32)> + Clone>(points: I, vantage: Vantage) -> f32 {
    let power = |v: Vantage| -> f32 {
        let Some(at) = v.point() else { return 0.0 };
        points
            .clone()
            .map(|(lat, lon)| {
                let (d, _, ahead) = relative(at, lat, lon);
                let mut g = distance_gain(d, 0.0) * shade(ahead);
                if v.walled() && !in_canyons(lat, lon) {
                    g *= WALLS.0;
                }
                g * g
            })
            .sum()
    };
    if vantage.point().is_none() || points.clone().next().is_none() {
        return 1.0;
    }
    let best = POSITIONED.iter().map(|&v| power(v)).fold(0.0, f32::max);
    if best > 0.0 {
        libm::sqrtf(power(vantage) / best)
    } else {
        1.0
    }
}

/// A family's bus: its stage, gliding, applied to what the family played.
#[derive(Clone, Debug)]
pub struct Bus {
    /// Gain, left and right pan gains (1 at center), width, cut coefficient,
    /// distance send.
    target: [f32; 6],
    now: [f32; 6],
    /// The two-pole cut's state, left and right, and the send's one pole.
    z: [f32; 4],
    zs: f32,
    k: f32,
    sr: f32,
}

impl Bus {
    /// A bus at `sr`, as played.
    pub fn new(sr: f32) -> Self {
        let unity = [1.0, 1.0, 1.0, 1.0, 0.0, 0.0];
        Bus {
            target: unity,
            now: unity,
            z: [0.0; 4],
            zs: 0.0,
            // About a second to arrive: a walk, not a cut.
            k: 1.0 - libm::expf(-1.0 / (0.35 * sr)),
            sr,
        }
    }

    /// Glide to `s`.
    pub fn set(&mut self, s: Stage) {
        let (pl, pr) = pan_gains(s.pan);
        let c = if s.cut_hz > 0.0 {
            libm::expf(-2.0 * core::f32::consts::PI * s.cut_hz / self.sr)
        } else {
            0.0
        };
        self.target = [
            s.gain,
            pl * core::f32::consts::SQRT_2,
            pr * core::f32::consts::SQRT_2,
            s.width,
            c,
            s.send,
        ];
    }

    /// Arrive at once.
    pub fn snap(&mut self) {
        self.now = self.target;
    }

    /// One sample of the family in, staged into `out`.
    #[inline]
    pub fn process(&mut self, x: &Out, out: &mut Out) {
        for (n, t) in self.now.iter_mut().zip(self.target) {
            *n += (t - *n) * self.k;
        }
        let [g, pl, pr, width, c, send] = self.now;
        let mid = 0.5 * (x.l + x.r);
        let side = 0.5 * (x.l - x.r) * width;
        let mut l = g * (mid * pl + side);
        let mut r = g * (mid * pr - side);
        // The reverberant field falls off more slowly than the direct
        // sound, so a far family is wetter, and its reverb is darkened too.
        let mut wet = libm::sqrtf(g) * x.send + send * 0.5 * (l + r);
        if c > 1e-4 {
            let a = 1.0 - c;
            self.z[0] += (l - self.z[0]) * a;
            self.z[1] += (self.z[0] - self.z[1]) * a;
            self.z[2] += (r - self.z[2]) * a;
            self.z[3] += (self.z[2] - self.z[3]) * a;
            self.zs += (wet - self.zs) * a;
            l = self.z[1];
            r = self.z[3];
            wet = self.zs;
        } else {
            self.z = [l, l, r, r];
            self.zs = wet;
        }
        out.l += l;
        out.r += r;
        out.send += wet;
        out.canyon += g * x.canyon;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gains(homes: &Homes, v: Vantage) -> [f32; HOMES] {
        ALL.map(|h| homes.stage(h, v, 0.0).gain)
    }

    #[test]
    fn every_place_has_its_own_mix() {
        let homes = Homes::new();
        let down = gains(&homes, Vantage::Downtown);
        let canyon = gains(&homes, Vantage::Canyons);
        let lake = gains(&homes, Vantage::Lake);
        let [m, c, l, r, w, s] = [0usize, 1, 2, 3, 4, 5];
        // Downtown: the city all around, the lake far off.
        assert!(down[c] > 0.95, "downtown's city {}", down[c]);
        assert!(down[l] < 0.5 * down[c]);
        // Up the canyon: the mountains, the wind and the snow; the city
        // far below, over the walls.
        assert!(
            canyon[m] > 0.95 && canyon[w] > 0.95 && canyon[s] > 0.95,
            "{canyon:?}"
        );
        assert!(canyon[c] < 0.4, "the city from the canyon {}", canyon[c]);
        // At Saltair: the lake; the city and the mountains across the flats.
        assert!(lake[l] > 0.95, "the lake from its shore {}", lake[l]);
        assert!(lake[c] < 0.6 && lake[m] < 0.5, "{lake:?}");
        // The bass stays with you near any river.
        assert!(down[r] > 0.8 && canyon[r] > 0.8);
        // On the map, everything is as played.
        assert!(
            gains(&homes, Vantage::Everywhere)[..6]
                .iter()
                .all(|&g| g == 1.0)
        );
    }

    #[test]
    fn near_is_wide_and_bright_far_is_narrow_and_dark() {
        let homes = Homes::new();
        let inside = homes.stage(Home::Mountains, Vantage::Canyons, 0.0);
        let across = homes.stage(Home::Mountains, Vantage::Lake, 0.0);
        assert!(inside.width > 1.0, "the range around you {inside:?}");
        // The Wasatch is still a wide wall from Saltair, but narrower.
        assert!(
            across.width < inside.width - 0.3,
            "the range across the valley {across:?}"
        );
        // A lake 20 km off is a narrow thing.
        assert!(homes.stage(Home::Lake, Vantage::Downtown, 0.0).width < 0.8);
        // Heard from its home, a family is as played.
        assert_eq!(inside.cut_hz, 0.0);
        assert_eq!(inside.send, 0.0);
        assert!(
            across.cut_hz > 1000.0 && across.cut_hz < 5000.0,
            "{across:?}"
        );
        assert!(across.send > 0.15);
        // From Saltair facing the city, the Wasatch is ahead.
        assert!(across.pan.abs() < 0.3, "{across:?}");
    }

    #[test]
    fn the_map_puts_the_lake_left_and_the_mountains_right() {
        let homes = Homes::new();
        let map = |h| homes.stage(h, Vantage::Everywhere, 0.0).pan;
        assert!(map(Home::Lake) < -0.2);
        assert!(map(Home::Mountains) > 0.1 && map(Home::Ridges) > 0.1);
        assert!(map(Home::City).abs() < 0.15);
    }

    #[test]
    fn the_lid_brings_far_homes_closer() {
        let homes = Homes::new();
        let clear = homes.stage(Home::Lake, Vantage::Downtown, 0.0).gain;
        let lid = homes.stage(Home::Lake, Vantage::Downtown, 1.0).gain;
        assert!(lid > 1.3 * clear, "{clear} → {lid}");
    }

    #[test]
    fn trains_are_near_downtown() {
        let stations = [
            (40.7685, -111.8907),
            (40.7612, -111.8907),
            (40.7536, -111.8975),
            (40.7273, -111.8981),
        ];
        let near = |v| nearness(stations.iter().copied(), v);
        assert!(near(Vantage::Downtown) > 0.99);
        assert!(near(Vantage::Lake) < 0.3);
        assert!(near(Vantage::Canyons) < 0.3);
        assert_eq!(near(Vantage::Everywhere), 1.0);
    }

    #[test]
    fn a_bus_glides_and_keeps_a_centered_mono_source_at_unity() {
        let mut bus = Bus::new(48_000.0);
        let x = Out {
            l: 0.5,
            r: 0.5,
            send: 0.1,
            canyon: 0.0,
        };
        let mut out = Out::default();
        bus.process(&x, &mut out);
        assert!((out.l - 0.5).abs() < 1e-6 && (out.r - 0.5).abs() < 1e-6);
        bus.set(Stage {
            gain: 0.25,
            pan: -1.0,
            width: 0.5,
            cut_hz: 2000.0,
            send: 0.3,
        });
        let mut last = Out::default();
        for _ in 0..48_000 * 3 {
            last = Out::default();
            bus.process(&x, &mut last);
        }
        assert!(last.r.abs() < 1e-3, "hard left {last:?}");
        assert!(
            (last.l - 0.25 * core::f32::consts::SQRT_2 * 0.5).abs() < 1e-3,
            "{last:?}"
        );
        // Wetter than dry: the send fell half as far (in dB) as the level.
        assert!(last.send > 0.1 * 0.5 * 0.9, "{last:?}");
    }
}

#[cfg(test)]
mod survey {
    use super::*;

    #[test]
    #[ignore = "prints the table"]
    fn print_stages() {
        let homes = Homes::new();
        for v in [
            Vantage::Everywhere,
            Vantage::Downtown,
            Vantage::Canyons,
            Vantage::Lake,
        ] {
            for h in ALL {
                let s = homes.stage(h, v, 0.0);
                println!(
                    "{v:?}\t{h:?}\tgain {:.2} ({:+.1} dB)\tpan {:+.2}\twidth {:.2}\tcut {:.0}\tsend {:.2}",
                    s.gain,
                    20.0 * libm::log10f(s.gain),
                    s.pan,
                    s.width,
                    s.cut_hz,
                    s.send
                );
            }
        }
    }
}
