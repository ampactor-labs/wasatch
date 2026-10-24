//! The skyline as a waveform: the pad's oscillator.
//!
//! The crest profile from Ben Lomond to Mount Nebo is detrended between its
//! endpoints and mirrored into one continuous cycle (there and back), so the
//! wave has no jump at its seam. Its Fourier series is tilted by k^−0.5,
//! which turns the raw skyline (brighter than a sawtooth, DESIGN.md Appendix
//! D) into a slightly darkened saw while keeping the range's own phases and
//! irregular partials. Eight haze frames keep fewer harmonics each, down to
//! the range's outline; the haze picks the frame. Each frame is rendered at
//! six band limits so a note never carries harmonics past Nyquist.

use core::f32::consts::PI;
use rustfft::num_complex::Complex;
use sonido_analysis::fft::Fft;

/// Samples per table.
pub const SIZE: usize = 256;
/// Haze frames.
pub const FRAMES: usize = 8;
/// Band limits per frame.
pub const LEVELS: usize = 6;
/// Harmonics kept in each haze frame, clear to hazed out.
const FRAME_HARMONICS: [usize; FRAMES] = [127, 72, 44, 28, 18, 12, 8, 5];
/// Harmonic cap of each band-limited level.
const LEVEL_CAPS: [usize; LEVELS] = [127, 64, 32, 16, 8, 4];
/// The tilt applied to the skyline's spectrum.
const TILT: f32 = 0.5;

/// Every table, `[frame][level][sample]`, each normalized to the same RMS.
pub struct SkylineTables {
    tables: Vec<[f32; SIZE + 1]>,
}

impl SkylineTables {
    /// Build the tables from the crest's elevations (any units), north to
    /// south.
    pub fn from_profile(elev: &[f32]) -> SkylineTables {
        let spectrum = tilted_spectrum(elev);
        let fft = Fft::new(SIZE);
        let mut tables = Vec::with_capacity(FRAMES * LEVELS);
        for &keep in &FRAME_HARMONICS {
            for &cap in &LEVEL_CAPS {
                let limit = keep.min(cap).min(SIZE / 2 - 1);
                let mut buf = vec![Complex::new(0.0f32, 0.0); SIZE];
                for k in 1..=limit {
                    // Taper the top 30% of the kept harmonics so a cutoff
                    // never rings.
                    let start = (limit as f32 * 0.7).max(1.0);
                    let taper = if (k as f32) <= start {
                        1.0
                    } else {
                        let t = (k as f32 - start) / (limit as f32 - start + 1.0);
                        0.5 * (1.0 + libm::cosf(PI * t))
                    };
                    let c = spectrum.get(k - 1).copied().unwrap_or_default() * taper;
                    buf[k] = c;
                    buf[SIZE - k] = c.conj();
                }
                fft.inverse_complex(&mut buf);
                let mut table = [0.0f32; SIZE + 1];
                for (t, b) in table.iter_mut().zip(buf.iter()) {
                    *t = b.re;
                }
                let rms = (table[..SIZE].iter().map(|v| v * v).sum::<f32>() / SIZE as f32).sqrt();
                if rms > 0.0 {
                    for t in &mut table {
                        // A sine's RMS: the pad's level doesn't move with haze.
                        *t *= core::f32::consts::FRAC_1_SQRT_2 / rms;
                    }
                }
                table[SIZE] = table[0];
                tables.push(table);
            }
        }
        SkylineTables { tables }
    }

    /// A flat fallback (a sawtooth's spectrum) before the profile arrives.
    pub fn fallback() -> SkylineTables {
        let saw: Vec<f32> = (0..155).map(|i| i as f32).collect();
        Self::from_profile(&saw)
    }

    fn table(&self, frame: usize, level: usize) -> &[f32; SIZE + 1] {
        &self.tables[frame.min(FRAMES - 1) * LEVELS + level.min(LEVELS - 1)]
    }

    /// The band-limit level for a fundamental at `freq` and `sample_rate`.
    pub fn level_for(freq: f32, sample_rate: f32) -> usize {
        let max_h = (0.45 * sample_rate / freq.max(1.0)) as usize;
        LEVEL_CAPS
            .iter()
            .position(|&cap| cap <= max_h)
            .unwrap_or(LEVELS - 1)
    }

    /// Read at `phase` (0–1) from haze position `haze` (0 clear … 1 hazed
    /// out), crossfading between neighboring frames.
    #[inline]
    pub fn read(&self, phase: f32, haze: f32, level: usize) -> f32 {
        let pos = haze.clamp(0.0, 1.0) * (FRAMES - 1) as f32;
        let f0 = pos as usize;
        let f1 = (f0 + 1).min(FRAMES - 1);
        let mix = pos - f0 as f32;
        let x = phase * SIZE as f32;
        let i = x as usize % SIZE;
        let frac = x - x.floor();
        let a = self.table(f0, level);
        let b = self.table(f1, level);
        let va = a[i] + (a[i + 1] - a[i]) * frac;
        if mix <= 0.0 {
            return va;
        }
        let vb = b[i] + (b[i + 1] - b[i]) * frac;
        va + (vb - va) * mix
    }
}

/// The detrended, mirrored profile's Fourier coefficients for harmonics
/// 1…127, tilted by k^−0.5.
fn tilted_spectrum(elev: &[f32]) -> Vec<Complex<f32>> {
    let n = elev.len().max(2);
    let (a, b) = (elev[0], elev[n - 1]);
    let det: Vec<f32> = elev
        .iter()
        .enumerate()
        .map(|(i, &e)| e - (a + (b - a) * i as f32 / (n - 1) as f32))
        .collect();
    let mut cycle = det.clone();
    cycle.extend(det[1..n - 1].iter().rev());
    let m = cycle.len();
    let mean = cycle.iter().sum::<f32>() / m as f32;
    let harmonics = (SIZE / 2 - 1).min(m / 2);
    (1..=harmonics)
        .map(|k| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (t, &v) in cycle.iter().enumerate() {
                let ang = 2.0 * core::f64::consts::PI * (k * t) as f64 / m as f64;
                re += f64::from(v - mean) * libm::cos(ang);
                im -= f64::from(v - mean) * libm::sin(ang);
            }
            let tilt = libm::powf(k as f32, -TILT);
            Complex::new(re as f32 * tilt, im as f32 * tilt)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real crest, from the research pass (DESIGN.md Appendix D).
    fn crest() -> Vec<f32> {
        let json = include_str!("../../../research/skyline/crest_profile.json");
        let start = json.find("\"profile_m\": [").expect("profile_m") + 14;
        let end = start + json[start..].find(']').expect("end of profile");
        json[start..end]
            .split(',')
            .map(|v| v.trim().parse::<f32>().expect("number"))
            .collect()
    }

    #[test]
    fn the_real_crest_loads() {
        let c = crest();
        assert_eq!(c.len(), 155);
        assert!(c.iter().all(|&m| (2000.0..3700.0).contains(&m)), "meters");
    }

    #[test]
    fn tables_are_continuous_and_level() {
        let t = SkylineTables::from_profile(&crest());
        for frame in 0..FRAMES {
            for level in 0..LEVELS {
                let tab = t.table(frame, level);
                assert_eq!(tab[SIZE], tab[0]);
                let rms = (tab[..SIZE].iter().map(|v| v * v).sum::<f32>() / SIZE as f32).sqrt();
                assert!(
                    (rms - core::f32::consts::FRAC_1_SQRT_2).abs() < 0.01,
                    "frame {frame} level {level}: {rms}"
                );
                assert!(tab.iter().all(|v| v.is_finite()));
            }
        }
    }

    #[test]
    fn haze_darkens() {
        let t = SkylineTables::from_profile(&crest());
        // Mean absolute slope is a brightness proxy.
        let slope = |frame: usize| {
            let tab = t.table(frame, 0);
            (0..SIZE).map(|i| (tab[i + 1] - tab[i]).abs()).sum::<f32>()
        };
        assert!(slope(0) > 1.8 * slope(7), "{} vs {}", slope(0), slope(7));
    }

    #[test]
    fn levels_respect_nyquist() {
        assert_eq!(SkylineTables::level_for(60.0, 48_000.0), 0);
        assert!(SkylineTables::level_for(1500.0, 48_000.0) >= 3);
        assert_eq!(SkylineTables::level_for(20_000.0, 48_000.0), LEVELS - 1);
    }
}
