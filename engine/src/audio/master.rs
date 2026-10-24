//! The master bus, mixed like a radio station.
//!
//! A slow loudness rider (K-weighted mean square over about three seconds,
//! ITU-R BS.1770's weighting) moves the gain toward −16 LUFS within ±8 dB,
//! so 3am and rush hour sit at one level without anyone riding a fader. Then
//! sonido's multiband compressor, gently, and its true-peak limiter at −1 dBTP.

use sonido_core::{DspKernel, TruePeakLimiter};
use sonido_effects::kernels::{MultibandCompKernel, MultibandCompParams};

/// The loudness the rider aims for.
pub const TARGET_LUFS: f32 = -16.0;
/// The true-peak ceiling.
pub const CEILING_DBTP: f32 = -1.0;

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
}

impl Master {
    /// A master bus at `sr`, faded out.
    pub fn new(sr: f32) -> Self {
        let shelf = Biquad::high_shelf(sr, 1681.97, 4.0, core::f32::consts::FRAC_1_SQRT_2);
        let hp = Biquad::high_pass(sr, 38.13, 0.5);
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
        }
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

    /// Short-term loudness estimate, LUFS.
    pub fn loudness(&self) -> f32 {
        -0.691 + 10.0 * libm::log10f(self.ms + 1e-12)
    }

    /// Process one stereo frame.
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        // Measure the K-weighted loudness of what comes in.
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
        }
        let (ml, mr) = self
            .mb
            .process_stereo(l * self.gain, r * self.gain, &self.mb_params);
        self.limiter.process(ml, mr)
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
}
