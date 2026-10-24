//! The master bus, mixed like a radio station.
//!
//! A slow loudness rider (a weighted mean square over about three seconds)
//! moves the gain within ±8 dB, so 3am and rush hour sit at one level without
//! anyone riding a fader. Its weighting is ITU-R BS.1770's high shelf with
//! the high-pass moved from 38 Hz up to 150 Hz: it rides what a phone's
//! speaker plays (little under about 500 Hz), so a lake-heavy night or the
//! view from Saltair isn't turned down for bass a phone never sounds. Then
//! sonido's multiband compressor, gently, and its true-peak limiter at −1 dBTP.
//!
//! Two slow colors ride on it. The temperature's, before the meter (so the
//! rider takes up any change in level): in the heat a little warmth, a
//! gentle and slightly asymmetric saturation with a softer top; in the cold
//! a glassier top; between 5 °C and 20 °C nothing at all. And the grid's,
//! after the compressor (so it isn't squeezed out): when the valley draws
//! more power than usual for the hour, the whole mix swells a decibel or so,
//! and eases off when it draws less.

use sonido_core::{DcBlocker, DspKernel, TruePeakLimiter, fast_tanh};
use sonido_effects::kernels::{MultibandCompKernel, MultibandCompParams};

/// The loudness the rider aims for, on its own meter. Leaving out the lows,
/// it reads about a decibel under BS.1770 for this music, so this lands the
/// stream at about −16 LUFS integrated (tools/render/check.ts holds it there).
pub const TARGET_LUFS: f32 = -17.5;
/// The true-peak ceiling.
pub const CEILING_DBTP: f32 = -1.0;

/// The temperature's warmth, −1 (bitter cold) to 1 (a scorching day): 0
/// from 5 °C to 20 °C, all the way by −10 °C and 35 °C.
pub fn warmth_for(temp_c: f32) -> f32 {
    if !temp_c.is_finite() {
        0.0
    } else if temp_c > 20.0 {
        ((temp_c - 20.0) / 15.0).min(1.0)
    } else if temp_c < 5.0 {
        -((5.0 - temp_c) / 15.0).min(1.0)
    } else {
        0.0
    }
}

/// The grid's swell, dB: about a decibel for each 10% over or under the
/// usual demand, from −2 to +1.5.
pub fn energy_db(energy: f32) -> f32 {
    if energy.is_finite() && energy > 0.0 {
        (10.0 * (energy - 1.0)).clamp(-2.0, 1.5)
    } else {
        0.0
    }
}

/// The warmth's top: a shelf at 6.5 kHz, −1.5 dB in the heat, +1.5 in the cold.
const WARM_SHELF_HZ: f32 = 6500.0;
const WARM_SHELF_DB: f32 = -1.5;
/// How long the colors take to settle: the warmth half a minute, the grid
/// three.
const WARMTH_S: f32 = 30.0;
const ENERGY_S: f32 = 180.0;

/// A transposed direct form II biquad.
#[derive(Clone, Copy, Debug, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    /// RBJ high shelf.
    fn high_shelf(sr: f32, f: f32, gain_db: f32, q: f32) -> Biquad {
        let a = libm::powf(10.0, gain_db / 40.0);
        let w = 2.0 * core::f32::consts::PI * f / sr;
        let (s, c) = (libm::sinf(w), libm::cosf(w));
        let alpha = s / (2.0 * q);
        let sq = 2.0 * libm::sqrtf(a) * alpha;
        let a0 = (a + 1.0) - (a - 1.0) * c + sq;
        Biquad {
            b0: a * ((a + 1.0) + (a - 1.0) * c + sq) / a0,
            b1: -2.0 * a * ((a - 1.0) + (a + 1.0) * c) / a0,
            b2: a * ((a + 1.0) + (a - 1.0) * c - sq) / a0,
            a1: 2.0 * ((a - 1.0) - (a + 1.0) * c) / a0,
            a2: ((a + 1.0) - (a - 1.0) * c - sq) / a0,
            ..Biquad::default()
        }
    }

    /// New shelf coefficients, keeping the filter's state.
    fn retune(&mut self, other: Biquad) {
        self.b0 = other.b0;
        self.b1 = other.b1;
        self.b2 = other.b2;
        self.a1 = other.a1;
        self.a2 = other.a2;
    }

    /// RBJ high-pass.
    fn high_pass(sr: f32, f: f32, q: f32) -> Biquad {
        let w = 2.0 * core::f32::consts::PI * f / sr;
        let (s, c) = (libm::sinf(w), libm::cosf(w));
        let alpha = s / (2.0 * q);
        let a0 = 1.0 + alpha;
        Biquad {
            b0: (1.0 + c) / 2.0 / a0,
            b1: -(1.0 + c) / a0,
            b2: (1.0 + c) / 2.0 / a0,
            a1: -2.0 * c / a0,
            a2: (1.0 - alpha) / a0,
            ..Biquad::default()
        }
    }
}

/// The master bus.
pub struct Master {
    kw: [[Biquad; 2]; 2],
    ms: f32,
    ms_coeff: f32,
    gain_db: f32,
    gain_coeff: f32,
    gain: f32,
    counter: u32,
    mb: MultibandCompKernel,
    mb_params: MultibandCompParams,
    limiter: TruePeakLimiter<256>,
    fade: f32,
    fade_target: f32,
    fade_step: f32,
    sr: f32,
    /// The temperature's warmth (see [`warmth_for`]): now, its target, and
    /// whether it's been set (the first setting is taken at once).
    warmth: f32,
    warmth_target: f32,
    warmth_set: bool,
    warm_shelf: [Biquad; 2],
    warm_shelf_db: f32,
    warm_dc: [DcBlocker; 2],
    /// The grid's swell, dB: now and its target.
    energy_db: f32,
    energy_target: f32,
    energy_set: bool,
    energy_gain: f32,
}

impl Master {
    /// A master bus at `sr`, faded out.
    pub fn new(sr: f32) -> Self {
        let shelf = Biquad::high_shelf(sr, 1681.97, 4.0, core::f32::consts::FRAC_1_SQRT_2);
        // BS.1770's shelf; its high-pass, moved up to where a phone starts.
        let hp = Biquad::high_pass(sr, 150.0, 0.5);
        Master {
            kw: [[shelf, hp], [shelf, hp]],
            ms: 0.0,
            ms_coeff: libm::expf(-1.0 / (3.0 * sr)),
            gain_db: 0.0,
            // Updated every 32 samples.
            gain_coeff: 1.0 - libm::expf(-32.0 / (10.0 * sr)),
            gain: 1.0,
            counter: 0,
            mb: MultibandCompKernel::new(sr),
            mb_params: MultibandCompParams {
                low_thresh_db: -20.0,
                low_ratio: 1.8,
                mid_thresh_db: -22.0,
                mid_ratio: 1.6,
                high_thresh_db: -24.0,
                ..MultibandCompParams::default()
            },
            limiter: TruePeakLimiter::new(sr, CEILING_DBTP, 150.0),
            fade: 0.0,
            fade_target: 0.0,
            fade_step: 1.0 / (2.0 * sr),
            sr,
            warmth: 0.0,
            warmth_target: 0.0,
            warmth_set: false,
            warm_shelf: [Biquad::high_shelf(sr, WARM_SHELF_HZ, 0.0, 0.7); 2],
            warm_shelf_db: 0.0,
            warm_dc: [DcBlocker::new(sr), DcBlocker::new(sr)],
            energy_db: 0.0,
            energy_target: 0.0,
            energy_set: false,
            energy_gain: 1.0,
        }
    }

    /// The temperature's warmth to glide to, −1…1 (see [`warmth_for`]).
    pub fn set_warmth(&mut self, w: f32) {
        self.warmth_target = if w.is_finite() {
            w.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        if !self.warmth_set {
            self.warmth_set = true;
            self.warmth = self.warmth_target;
        }
    }

    /// The grid's swell to glide to, dB (see [`energy_db`]).
    pub fn set_energy(&mut self, db: f32) {
        self.energy_target = if db.is_finite() {
            db.clamp(-2.0, 1.5)
        } else {
            0.0
        };
        if !self.energy_set {
            self.energy_set = true;
            self.energy_db = self.energy_target;
        }
        self.energy_gain = libm::powf(10.0, self.energy_db / 20.0);
    }

    /// The warmth now.
    pub fn warmth(&self) -> f32 {
        self.warmth
    }

    /// The grid's swell now, dB.
    pub fn energy(&self) -> f32 {
        self.energy_db
    }

    /// Glide the colors toward their targets: every 32 samples.
    fn glide(&mut self) {
        let k = |s: f32| 1.0 - libm::expf(-32.0 / (s * self.sr));
        self.warmth += (self.warmth_target - self.warmth) * k(WARMTH_S);
        if (self.warmth - self.warmth_target).abs() < 1e-4 {
            self.warmth = self.warmth_target;
        }
        let db = WARM_SHELF_DB * self.warmth;
        if (db - self.warm_shelf_db).abs() > 0.05 || (db == 0.0 && self.warm_shelf_db != 0.0) {
            self.warm_shelf_db = db;
            let shelf = Biquad::high_shelf(self.sr, WARM_SHELF_HZ, db, 0.7);
            for b in &mut self.warm_shelf {
                b.retune(shelf);
            }
        }
        self.energy_db += (self.energy_target - self.energy_db) * k(ENERGY_S);
        self.energy_gain = libm::powf(10.0, self.energy_db / 20.0);
    }

    /// The warmth on one channel: in the heat, a saturation at the level
    /// it'll play at (after the rider's gain), slightly asymmetric for an
    /// even harmonic, its offset taken out; then the shelf, either way.
    #[inline]
    fn warm(&mut self, ch: usize, x: f32) -> f32 {
        let w = self.warmth;
        let mut y = x;
        if w > 0.0 {
            let g = self.gain.max(1e-3);
            let (k, b, d) = (0.5 * w, 0.25 * w, 1.8);
            let u = x * g;
            let sat = (fast_tanh(d * u + b) - fast_tanh(b)) / d;
            y = self.warm_dc[ch].process(((1.0 - k) * u + k * sat) / g);
        }
        self.warm_shelf[ch].process(y)
    }

    /// Fade the stream in (or out) over two seconds.
    pub fn set_fade(&mut self, on: bool) {
        self.fade_target = if on { 1.0 } else { 0.0 };
    }

    /// The stream's fade, 0–1.
    pub fn fade(&self) -> f32 {
        self.fade
    }

    /// Advance the fade one sample; returns its level.
    #[inline]
    pub fn fade_tick(&mut self) -> f32 {
        if self.fade < self.fade_target {
            self.fade = (self.fade + self.fade_step).min(self.fade_target);
        } else if self.fade > self.fade_target {
            self.fade = (self.fade - self.fade_step).max(self.fade_target);
        }
        self.fade
    }

    /// The rider's current gain, dB.
    pub fn rider_db(&self) -> f32 {
        self.gain_db
    }

    /// Short-term loudness on the rider's phone-weighted meter, in LUFS-like
    /// units.
    pub fn loudness(&self) -> f32 {
        -0.691 + 10.0 * libm::log10f(self.ms + 1e-12)
    }

    /// Process one stereo frame.
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        // The temperature's color, before it's measured; exactly nothing
        // when it's neutral.
        let (l, r) = if self.warmth == 0.0 && self.warm_shelf_db == 0.0 {
            (l, r)
        } else {
            (self.warm(0, l), self.warm(1, r))
        };
        // Measure the weighted loudness of what comes in.
        let sl = self.kw[0][0].process(l);
        let kl = self.kw[0][1].process(sl);
        let sr = self.kw[1][0].process(r);
        let kr = self.kw[1][1].process(sr);
        self.ms = self.ms * self.ms_coeff + (kl * kl + kr * kr) * (1.0 - self.ms_coeff);
        self.counter += 1;
        if self.counter >= 32 {
            self.counter = 0;
            // Ride toward the target; hold through near-silence.
            let loudness = self.loudness();
            if loudness > -55.0 {
                let want = (TARGET_LUFS - loudness).clamp(-8.0, 10.0);
                self.gain_db += (want - self.gain_db) * self.gain_coeff;
            }
            self.gain = libm::powf(10.0, self.gain_db / 20.0);
            self.glide();
        }
        let (ml, mr) = self
            .mb
            .process_stereo(l * self.gain, r * self.gain, &self.mb_params);
        // The grid's swell, past the compressor so it isn't squeezed out.
        self.limiter
            .process(ml * self.energy_gain, mr * self.energy_gain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rider_brings_a_quiet_signal_up_and_the_limiter_holds() {
        let sr = 48_000.0;
        let mut m = Master::new(sr);
        let mut peak = 0.0f32;
        let mut late = Vec::new();
        for n in 0..(sr as usize * 60) {
            let s = 0.05 * libm::sinf(2.0 * core::f32::consts::PI * 220.0 * n as f32 / sr);
            let (l, r) = m.process(s, s);
            peak = peak.max(l.abs()).max(r.abs());
            if n > sr as usize * 50 {
                late.push(l);
            }
        }
        assert!(m.rider_db() > 3.0, "rider {}", m.rider_db());
        assert!(
            20.0 * libm::log10f(peak) <= CEILING_DBTP + 0.3,
            "peak {}",
            20.0 * libm::log10f(peak)
        );
        assert!(late.iter().all(|v| v.is_finite()));
    }

    /// A minute of `signal` through a master set to `setup`, the last 10 s.
    fn run(setup: impl Fn(&mut Master), signal: impl Fn(usize) -> f32) -> (Vec<f32>, Master) {
        let sr = 48_000.0;
        let mut m = Master::new(sr);
        setup(&mut m);
        let mut out = Vec::new();
        for n in 0..(sr as usize * 60) {
            let x = signal(n);
            let (l, _) = m.process(x, x);
            if n >= sr as usize * 50 {
                out.push(l);
            }
        }
        (out, m)
    }

    /// The level of `f` Hz in `x`, dB (a Goertzel).
    fn tone_db(x: &[f32], f: f32) -> f32 {
        let w = 2.0 * core::f32::consts::PI * f / 48_000.0;
        let (mut s1, mut s2) = (0.0f64, 0.0f64);
        for &v in x {
            let s = f64::from(v) + 2.0 * f64::from(libm::cosf(w)) * s1 - s2;
            s2 = s1;
            s1 = s;
        }
        let p = s1 * s1 + s2 * s2 - 2.0 * f64::from(libm::cosf(w)) * s1 * s2;
        10.0 * libm::log10(p.max(1e-30)) as f32
    }

    fn sine(f: f32, amp: f32) -> impl Fn(usize) -> f32 {
        move |n| amp * libm::sinf(2.0 * core::f32::consts::PI * f * n as f32 / 48_000.0)
    }

    #[test]
    fn neutral_weather_leaves_the_stream_exactly_as_it_was() {
        let (plain, _) = run(|_| {}, sine(220.0, 0.25));
        let (neutral, _) = run(|m| m.set_warmth(warmth_for(12.0)), sine(220.0, 0.25));
        assert_eq!(plain, neutral);
        assert_eq!(warmth_for(5.0), 0.0);
        assert_eq!(warmth_for(20.0), 0.0);
        assert_eq!(warmth_for(35.0), 1.0);
        assert_eq!(warmth_for(-10.0), -1.0);
    }

    #[test]
    fn the_heat_adds_a_little_warmth_and_the_cold_a_glassier_top() {
        let (plain, _) = run(|_| {}, sine(220.0, 0.25));
        let (hot, _) = run(|m| m.set_warmth(1.0), sine(220.0, 0.25));
        let fundamental = tone_db(&hot, 220.0);
        let (h2, h3) = (
            tone_db(&hot, 440.0) - fundamental,
            tone_db(&hot, 660.0) - fundamental,
        );
        assert!((-50.0..-20.0).contains(&h2), "second harmonic {h2:.1} dBc");
        assert!((-50.0..-20.0).contains(&h3), "third harmonic {h3:.1} dBc");
        let p2 = tone_db(&plain, 440.0) - tone_db(&plain, 220.0);
        assert!(h2 > p2 + 10.0, "warmer than plain ({p2:.1} dBc)");
        // A tone up top: the cold lifts it, the heat softens it, against the rest.
        let mix = |n: usize| sine(220.0, 0.2)(n) + sine(9000.0, 0.05)(n);
        let top = |x: &[f32]| tone_db(x, 9000.0) - tone_db(x, 220.0);
        let (neutral, _) = run(|_| {}, mix);
        let (cold, _) = run(|m| m.set_warmth(-1.0), mix);
        let lift = top(&cold) - top(&neutral);
        assert!((1.0..2.0).contains(&lift), "the cold's top {lift:.2} dB");
    }

    #[test]
    fn the_grid_swells_the_mix_past_the_rider_slowly_and_within_the_ceiling() {
        let (plain, base) = run(|_| {}, sine(220.0, 0.25));
        let (busy, m) = run(|m| m.set_energy(energy_db(1.15)), sine(220.0, 0.25));
        let swell = tone_db(&busy, 220.0) - tone_db(&plain, 220.0);
        assert!((1.2..1.8).contains(&swell), "+{swell:.2} dB");
        assert!(
            (m.rider_db() - base.rider_db()).abs() < 0.1,
            "the rider doesn't fight it"
        );
        assert_eq!(energy_db(0.0), 0.0);
        assert_eq!(energy_db(0.5), -2.0);
        // Changed later, it takes minutes to get there.
        let mut g = Master::new(48_000.0);
        g.set_energy(0.0);
        g.set_energy(1.5);
        for _ in 0..(48_000 * 60) {
            g.process(0.1, 0.1);
        }
        assert!(g.energy() < 0.75, "{} dB after a minute", g.energy());
        // Heat and a busy grid together stay under the ceiling.
        let (loud, _) = run(
            |m| {
                m.set_warmth(1.0);
                m.set_energy(1.5);
            },
            |n| sine(110.0, 0.6)(n) + sine(1500.0, 0.3)(n),
        );
        let peak = loud.iter().fold(0.0f32, |a, v| a.max(v.abs()));
        assert!(20.0 * libm::log10f(peak) <= CEILING_DBTP + 0.3);
    }
}
