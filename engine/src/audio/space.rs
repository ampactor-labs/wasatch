//! Where you're listening from, and the room around you.
//!
//! A vantage is a real place with a facing. Each located event is placed
//! from it: bearing sets the pan, distance sets the level by a compressed law
//! (gain = (1 + d/3 km)^−1, floored at −24 dB, the exponent halving under an
//! inversion), a high cut and the reverb share. A sound behind you is a
//! little quieter (the ear's own shadow), and from inside Little Cottonwood
//! anything outside the canyon comes over its walls, quieter and darker.
//! "Everywhere" is the map view: west left, east right, no distance. The
//! families that live somewhere bigger than a point (the mountains, the
//! city, the lake) are heard by the same law in homes.rs.
//!
//! Until the rooms are recorded with sine sweeps (DESIGN.md "Vantage"), each
//! vantage's early reflections are modeled from its geometry: flutter between
//! downtown's towers, sparse echoes off a canyon's granite walls, one faint
//! return from the Oquirrhs at the lake. The lid adds a low ceiling of dense
//! reflections. One shared FDN (sonido's reverb) is the tail.

use super::pan_gains;
use super::voices::Placement;
use sonido_core::DspKernel;
use sonido_effects::kernels::{ReverbKernel, ReverbParams};

/// The four listening positions.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum Vantage {
    /// The valley as a map.
    Everywhere = 0,
    /// The Gallivan Center, facing the mountains.
    Downtown = 1,
    /// Tanners Flat in Little Cottonwood, facing up-canyon.
    Canyons = 2,
    /// Saltair, facing the city.
    Lake = 3,
}

impl Vantage {
    /// From the host's code.
    pub fn from_code(code: u32) -> Vantage {
        match code {
            1 => Vantage::Downtown,
            2 => Vantage::Canyons,
            3 => Vantage::Lake,
            _ => Vantage::Everywhere,
        }
    }

    /// Latitude, longitude and facing (degrees clockwise from north).
    pub fn point(self) -> Option<(f32, f32, f32)> {
        match self {
            Vantage::Everywhere => None,
            Vantage::Downtown => Some((40.7647, -111.891, 90.0)),
            // Eight kilometers up the canyon, where SR-210 and the creek
            // run between granite walls, facing up toward Snowbird.
            Vantage::Canyons => Some((40.5714, -111.7027, 75.0)),
            Vantage::Lake => Some((40.7651, -112.1745, 90.0)),
        }
    }

    /// `true` where the canyon's walls stand between you and the valley.
    pub fn walled(self) -> bool {
        self == Vantage::Canyons
    }
}

/// `true` for a point inside the Cottonwood canyons.
pub fn in_canyons(lat: f32, lon: f32) -> bool {
    lon > -111.80 && (40.54..40.66).contains(&lat)
}

/// A point as seen from a vantage's point: its distance (km), and the sine
/// and cosine of its bearing against the facing (right is +sine, ahead is
/// +cosine).
pub fn relative(from: (f32, f32, f32), lat: f32, lon: f32) -> (f32, f32, f32) {
    let (lat0, lon0, facing) = from;
    let dx = (lon - lon0) * libm::cosf(lat0.to_radians()) * 111.32;
    let dy = (lat - lat0) * 110.57;
    let d = libm::sqrtf(dx * dx + dy * dy);
    if d < 1e-3 {
        return (0.0, 0.0, 1.0);
    }
    let (sf, cf) = (
        libm::sinf(facing.to_radians()),
        libm::cosf(facing.to_radians()),
    );
    let (e, n) = (dx / d, dy / d);
    (d, e * cf - n * sf, n * cf + e * sf)
}

/// The distance law's amplitude at `d` km: (1 + d/3)^−1, its exponent
/// halving under a full inversion.
pub fn distance_gain(d: f32, inversion: f32) -> f32 {
    let exponent = 1.0 - 0.5 * inversion.clamp(0.0, 1.0);
    if exponent >= 0.999 {
        1.0 / (1.0 + d / 3.0)
    } else {
        libm::powf(1.0 + d / 3.0, -exponent)
    }
}

/// The ear's shadow: ahead is as it is, behind is 3 dB down.
pub fn shade(cos_rel: f32) -> f32 {
    0.85 + 0.15 * cos_rel
}

/// What a canyon's walls leave of a sound from outside it: its level, and
/// what's left of its highs.
pub const WALLS: (f32, f32) = (0.6, 0.6);

/// The distance cut's corner at `d` km, Hz.
pub fn cut_hz(d: f32) -> f32 {
    (16_000.0 / (1.0 + d / 4.0)).clamp(1800.0, 20_000.0)
}

/// Place a sound at `lat`/`lon` (NaN for nowhere in particular) as heard
/// from `vantage`, with `inversion` 0–1 and a base reverb send.
pub fn place(
    vantage: Vantage,
    lat: f32,
    lon: f32,
    inversion: f32,
    base_send: f32,
    sr: f32,
) -> Placement {
    if !lat.is_finite() || !lon.is_finite() {
        return Placement {
            send: base_send,
            ..Placement::default()
        };
    }
    let canyon = if in_canyons(lat, lon) { 0.35 } else { 0.0 };
    let Some(at) = vantage.point() else {
        let (gl, gr) = pan_gains(((lon + 111.89) / 0.16).clamp(-1.0, 1.0));
        return Placement {
            gl,
            gr,
            send: base_send,
            cut: 0.0,
            canyon,
        };
    };
    let (d, side, ahead) = relative(at, lat, lon);
    let (gl, gr) = pan_gains(side * 0.9);
    let mut gain = distance_gain(d, inversion) * shade(ahead);
    let mut fc = cut_hz(d);
    if vantage.walled() && !in_canyons(lat, lon) {
        gain *= WALLS.0;
        fc *= WALLS.1;
    }
    let gain = gain.max(0.063);
    let cut = if fc >= 15_000.0 {
        0.0
    } else {
        libm::expf(-2.0 * core::f32::consts::PI * fc / sr)
    };
    Placement {
        gl: gl * gain,
        gr: gr * gain,
        send: base_send + 0.35 * (d / 25.0).min(1.0),
        cut,
        canyon,
    }
}

/// A tapped delay: early reflections.
#[derive(Clone, Debug)]
pub struct Reflections {
    buf: Vec<f32>,
    pos: usize,
    taps: Vec<(usize, f32, f32)>,
    lp: f32,
    lp_coeff: f32,
}

impl Reflections {
    /// Room for `max_s` seconds of reflections.
    pub fn new(sr: f32, max_s: f32) -> Self {
        Reflections {
            buf: vec![0.0; (sr * max_s) as usize + 1],
            pos: 0,
            taps: Vec::with_capacity(16),
            lp: 0.0,
            lp_coeff: 0.0,
        }
    }

    /// Set taps as `(seconds, gain left, gain right)`, darkened by a
    /// one-pole at `cutoff` Hz.
    pub fn set(&mut self, taps: &[(f32, f32, f32)], cutoff: f32, sr: f32) {
        self.taps.clear();
        let max = self.buf.len() - 1;
        for &(s, l, r) in taps {
            self.taps.push((((s * sr) as usize).clamp(1, max), l, r));
        }
        self.lp_coeff = libm::expf(-2.0 * core::f32::consts::PI * cutoff / sr);
    }

    /// One sample in, a stereo pair of reflections out.
    #[inline]
    pub fn process(&mut self, x: f32) -> (f32, f32) {
        self.lp = x + (self.lp - x) * self.lp_coeff;
        let n = self.buf.len();
        self.buf[self.pos] = self.lp;
        let (mut l, mut r) = (0.0, 0.0);
        for &(d, gl, gr) in &self.taps {
            let i = if self.pos >= d {
                self.pos - d
            } else {
                self.pos + n - d
            };
            let v = self.buf[i];
            l += v * gl;
            r += v * gr;
        }
        self.pos += 1;
        if self.pos == n {
            self.pos = 0;
        }
        (l, r)
    }
}

/// The vantage's early reflections, as taps.
fn vantage_taps(v: Vantage) -> (&'static [(f32, f32, f32)], f32) {
    match v {
        Vantage::Everywhere => (
            &[
                (0.019, 0.32, 0.16),
                (0.027, 0.15, 0.3),
                (0.041, 0.22, 0.18),
                (0.053, 0.16, 0.22),
            ],
            9000.0,
        ),
        // Flutter between towers about 35 m apart.
        Vantage::Downtown => (
            &[
                (0.051, 0.42, 0.14),
                (0.102, 0.14, 0.38),
                (0.153, 0.28, 0.11),
                (0.204, 0.09, 0.24),
                (0.255, 0.15, 0.06),
                (0.306, 0.05, 0.11),
            ],
            7000.0,
        ),
        Vantage::Canyons => (&CANYON_TAPS, 3500.0),
        // Open water; one faint return from the Oquirrhs.
        Vantage::Lake => (&[(1.15, 0.07, 0.1)], 2500.0),
    }
}

/// Sparse echoes off a canyon's granite walls.
const CANYON_TAPS: [(f32, f32, f32); 4] = [
    (0.33, 0.33, 0.18),
    (0.61, 0.16, 0.28),
    (0.94, 0.13, 0.09),
    (1.38, 0.06, 0.08),
];

/// How loudly a place echoes the music itself: each echo is this times its
/// tap's gain. The map has no walls; downtown's towers flutter (the first
/// return about −14 dB); the canyon's granite slaps back at about −12 dB;
/// the Oquirrhs send one faint return across the lake.
fn echo_level(v: Vantage) -> f32 {
    match v {
        Vantage::Everywhere => 0.0,
        Vantage::Downtown => 0.45,
        Vantage::Canyons => 0.8,
        Vantage::Lake => 1.0,
    }
}

/// Echoes longer than a slap land on the nearest sixteenth note, so the
/// walls answer in time instead of smearing the groove: the geometry picks
/// among musical delays, as data picks among musical notes.
const SLAP_S: f32 = 0.12;

/// `taps` with every echo past a slap moved to the sixteenth-note grid.
fn on_the_grid(
    taps: &[(f32, f32, f32)],
    sixteenth_s: f32,
    out: &mut [(f32, f32, f32); 8],
) -> usize {
    let n = taps.len().min(out.len());
    for (o, &(t, l, r)) in out.iter_mut().zip(&taps[..n]) {
        let t = if t > SLAP_S && sixteenth_s > 0.0 {
            libm::roundf(t / sixteenth_s).max(1.0) * sixteenth_s
        } else {
            t
        };
        *o = (t, l, r);
    }
    n
}

/// A low ceiling: what the lid adds.
const LID_TAPS: [(f32, f32, f32); 5] = [
    (0.012, 0.3, 0.26),
    (0.021, 0.24, 0.3),
    (0.033, 0.22, 0.18),
    (0.047, 0.16, 0.2),
    (0.064, 0.12, 0.1),
];

/// The room: the vantage's reflections, the lid's, the canyon's own echo
/// for canyon events, the place's echo of the music itself, and the shared
/// tail.
pub struct Room {
    er: Reflections,
    /// The place's echo of the direct sound.
    echo: Reflections,
    echo_level: f32,
    /// The taps fade out, change, and fade back in, so a new place or tempo
    /// never clicks.
    fade: f32,
    fade_target: f32,
    retap: bool,
    vantage: Vantage,
    sixteenth_s: f32,
    lid: Reflections,
    canyon: Reflections,
    reverb: ReverbKernel,
    params: ReverbParams,
    lid_level: f32,
    sr: f32,
    // The tail runs at half the sample rate: a reverb's tail is dark, and
    // the FDN is most of the engine's cost. Two inputs are averaged into one,
    // and outputs are interpolated back.
    odd: bool,
    acc: (f32, f32),
    prev: (f32, f32),
    cur: (f32, f32),
}

impl Room {
    /// A room at `sr`.
    pub fn new(sr: f32) -> Self {
        let mut room = Room {
            er: Reflections::new(sr, 1.3),
            echo: Reflections::new(sr, 1.6),
            echo_level: 0.0,
            fade: 1.0,
            fade_target: 1.0,
            retap: false,
            vantage: Vantage::Everywhere,
            sixteenth_s: 0.15,
            lid: Reflections::new(sr, 0.08),
            canyon: Reflections::new(sr, 1.5),
            reverb: ReverbKernel::new(sr * 0.5),
            params: ReverbParams::default(),
            lid_level: 0.0,
            sr,
            odd: false,
            acc: (0.0, 0.0),
            prev: (0.0, 0.0),
            cur: (0.0, 0.0),
        };
        room.canyon.set(&CANYON_TAPS, 3500.0, sr);
        room.lid.set(&LID_TAPS, 2800.0, sr);
        room.set(Vantage::Everywhere, 0.0);
        room.tap();
        room
    }

    /// Lay the vantage's taps down: its reflections and its echo on the grid.
    fn tap(&mut self) {
        let (taps, cutoff) = vantage_taps(self.vantage);
        self.er.set(taps, cutoff, self.sr);
        let mut grid = [(0.0f32, 0.0f32, 0.0f32); 8];
        let n = on_the_grid(taps, self.sixteenth_s, &mut grid);
        // Each echo a little darker than the reflections it comes from.
        self.echo.set(&grid[..n], cutoff * 0.8, self.sr);
        self.echo_level = echo_level(self.vantage);
    }

    /// The tempo, for the echoes' grid.
    pub fn set_tempo(&mut self, bpm: f32) {
        let sixteenth = 15.0 / bpm.max(20.0);
        if (sixteenth - self.sixteenth_s).abs() > 0.001 {
            self.sixteenth_s = sixteenth;
            if self.echo_level > 0.0 {
                self.retap = true;
                self.fade_target = 0.0;
            }
        }
    }

    /// Tune the room for a vantage and an inversion strength (0–1).
    pub fn set(&mut self, vantage: Vantage, inversion: f32) {
        if vantage != self.vantage {
            self.vantage = vantage;
            self.retap = true;
            self.fade_target = 0.0;
        }
        let inv = inversion.clamp(0.0, 1.0);
        let (room, decay, damping) = match vantage {
            Vantage::Everywhere => (60.0, 55.0, 42.0),
            Vantage::Downtown => (45.0, 45.0, 50.0),
            Vantage::Canyons => (85.0, 68.0, 55.0),
            Vantage::Lake => (70.0, 34.0, 60.0),
        };
        self.params = ReverbParams {
            room_size_pct: room,
            decay_pct: (decay + 15.0 * inv).min(90.0),
            damping_pct: (damping + 18.0 * inv).min(90.0),
            predelay_ms: 18.0,
            mix_pct: 100.0,
            ..ReverbParams::default()
        };
        self.lid_level = inv;
    }

    /// Sends and the direct sound in, the room's stereo return out.
    #[inline]
    pub fn process(&mut self, send_l: f32, send_r: f32, canyon_send: f32, dry: f32) -> (f32, f32) {
        // Out in about 20 ms, back in about 150 ms.
        let k = if self.fade_target < self.fade {
            0.001
        } else {
            0.000_14
        };
        self.fade += (self.fade_target - self.fade) * k;
        if self.retap && self.fade < 1e-3 {
            self.tap();
            self.retap = false;
            self.fade_target = 1.0;
        }
        let mono = 0.5 * (send_l + send_r);
        let (el, er) = self.er.process(mono);
        let (el, er) = (el * self.fade, er * self.fade);
        let (xl, xr) = self.echo.process(dry);
        let echo = self.echo_level * self.fade;
        let (ll, lr) = self.lid.process(mono * self.lid_level);
        let (cl, cr) = self.canyon.process(canyon_send);
        self.acc.0 += send_l + 0.5 * el;
        self.acc.1 += send_r + 0.5 * er;
        let (rl, rr) = if self.odd {
            let out = self
                .reverb
                .process_stereo(0.5 * self.acc.0, 0.5 * self.acc.1, &self.params);
            self.acc = (0.0, 0.0);
            self.prev = self.cur;
            self.cur = out;
            self.prev
        } else {
            (
                0.5 * (self.prev.0 + self.cur.0),
                0.5 * (self.prev.1 + self.cur.1),
            )
        };
        self.odd = !self.odd;
        (
            0.5 * (rl + el + ll + cl) + echo * xl,
            0.5 * (rr + er + lr + cr) + echo * xr,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn far_things_are_quieter_and_closer_under_the_lid() {
        let near = place(Vantage::Downtown, 40.765, -111.89, 0.0, 0.2, 48_000.0);
        let far = place(Vantage::Downtown, 40.39, -111.64, 0.0, 0.2, 48_000.0);
        let far_lid = place(Vantage::Downtown, 40.39, -111.64, 1.0, 0.2, 48_000.0);
        let power = |p: &Placement| p.gl * p.gl + p.gr * p.gr;
        assert!(power(&near) > 4.0 * power(&far));
        let gain_db = 10.0 * libm::log10f(power(&far_lid) / power(&far));
        assert!(
            gain_db > 6.0,
            "the lid brings far events {gain_db} dB closer"
        );
        assert!(far.send > near.send);
        assert!(far.cut > 0.0);
    }

    #[test]
    fn panning_follows_the_facing() {
        // From downtown facing east, a point due south is on the right.
        let south = place(Vantage::Downtown, 40.6, -111.891, 0.0, 0.2, 48_000.0);
        assert!(south.gr > south.gl);
        // On the map view, the airport (west) is left.
        let airport = place(Vantage::Everywhere, 40.79, -111.98, 0.0, 0.2, 48_000.0);
        assert!(airport.gl > airport.gr);
    }

    #[test]
    fn the_canyon_walls_and_the_ears_shadow() {
        let power = |p: &Placement| p.gl * p.gl + p.gr * p.gr;
        // From Tanners Flat, a sound just inside the canyon's mouth is in
        // the canyon with you; one just outside it comes over the walls.
        let inside = place(Vantage::Canyons, 40.576, -111.795, 0.0, 0.2, 48_000.0);
        let outside = place(Vantage::Canyons, 40.576, -111.805, 0.0, 0.2, 48_000.0);
        assert!(power(&inside) > 2.0 * power(&outside));
        assert!(outside.cut > inside.cut);
        // Downtown, facing east: the same distance ahead is louder than behind.
        let ahead = place(Vantage::Downtown, 40.7647, -111.85, 0.0, 0.2, 48_000.0);
        let behind = place(Vantage::Downtown, 40.7647, -111.932, 0.0, 0.2, 48_000.0);
        assert!(power(&ahead) > 1.5 * power(&behind));
    }

    #[test]
    fn the_canyon_answers_on_the_beat() {
        // At 100 BPM a sixteenth is 150 ms: the walls' 330 ms echo lands on
        // the eighth note, a tower's 51 ms flutter stays a flutter.
        let mut grid = [(0.0, 0.0, 0.0); 8];
        let n = on_the_grid(&CANYON_TAPS, 0.15, &mut grid);
        assert_eq!(n, 4);
        assert!((grid[0].0 - 0.30).abs() < 1e-6);
        assert!((grid[1].0 - 0.60).abs() < 1e-6);
        let (downtown, _) = vantage_taps(Vantage::Downtown);
        let n = on_the_grid(downtown, 0.15, &mut grid);
        assert!((grid[0].0 - 0.051).abs() < 1e-6);
        assert!(
            grid[..n]
                .iter()
                .all(|t| t.0 < 0.13 || (t.0 / 0.15 - libm::roundf(t.0 / 0.15)).abs() < 1e-4)
        );
    }

    #[test]
    fn a_place_echoes_the_music_and_the_map_does_not() {
        let sr = 48_000.0;
        let echo_energy = |v: Vantage| {
            let mut room = Room::new(sr);
            room.set(v, 0.0);
            // Let the taps change over.
            for _ in 0..(sr as usize / 2) {
                room.process(0.0, 0.0, 0.0, 0.0);
            }
            let mut e = 0.0f32;
            for n in 0..(sr as usize * 2) {
                let x = if n == 0 { 1.0 } else { 0.0 };
                let (l, r) = room.process(0.0, 0.0, 0.0, x);
                e += l * l + r * r;
            }
            e
        };
        assert_eq!(echo_energy(Vantage::Everywhere), 0.0);
        assert!(echo_energy(Vantage::Canyons) > echo_energy(Vantage::Lake));
        assert!(echo_energy(Vantage::Downtown) > 0.0);
    }

    #[test]
    fn the_room_rings_and_settles() {
        let mut room = Room::new(48_000.0);
        room.set(Vantage::Canyons, 0.5);
        let mut energy = 0.0f32;
        for n in 0..48_000 {
            let x = if n == 0 { 1.0 } else { 0.0 };
            let (l, r) = room.process(x, x, x, x);
            assert!(l.is_finite() && r.is_finite());
            energy += l * l + r * r;
        }
        assert!(energy > 0.01);
        let mut tail = 0.0f32;
        for _ in 0..(48_000 * 12) {
            let (l, r) = room.process(0.0, 0.0, 0.0, 0.0);
            tail += l * l + r * r;
        }
        assert!(tail < energy, "the room should settle");
    }
}
