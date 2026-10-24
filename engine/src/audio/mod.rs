//! The sound: voices, the room and the master bus.

pub mod homes;
pub mod master;
pub mod skyline;
pub mod space;
pub mod voices;

/// Deterministic white noise (xorshift32), so a drum hit or a gust sounds the
/// same on every phone and in every render.
#[derive(Clone, Copy, Debug)]
pub struct Noise(u32);

impl Noise {
    /// Noise from a seed (0 is replaced, xorshift can't leave it).
    pub fn new(seed: u32) -> Self {
        Noise(if seed == 0 { 0x9E37_79B9 } else { seed })
    }

    /// The next sample, in [−1, 1).
    #[inline]
    pub fn sample(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x as i32) as f32 * (1.0 / 2_147_483_648.0)
    }
}

/// Equal-power pan, −1 left … 1 right.
pub fn pan_gains(pan: f32) -> (f32, f32) {
    let a = (pan.clamp(-1.0, 1.0) + 1.0) * core::f32::consts::FRAC_PI_4;
    (libm::cosf(a), libm::sinf(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_is_deterministic_and_centered() {
        let mut a = Noise::new(5);
        let mut b = Noise::new(5);
        let mut sum = 0.0f64;
        for _ in 0..100_000 {
            let x = a.sample();
            assert_eq!(x, b.sample());
            assert!((-1.0..1.0).contains(&x));
            sum += f64::from(x);
        }
        assert!((sum / 100_000.0).abs() < 0.01);
    }

    #[test]
    fn panning_keeps_power() {
        for p in [-1.0, -0.3, 0.0, 0.5, 1.0] {
            let (l, r) = pan_gains(p);
            assert!((l * l + r * r - 1.0).abs() < 1e-5);
        }
        assert!(pan_gains(-1.0).1.abs() < 1e-6);
    }
}
