//! The sky over Salt Lake City: sun, moon and how bright the valley is.
//!
//! Everything here is computed from the clock, so every phone agrees on it
//! without fetching anything. Cloud and precipitation come from observations
//! (see [`crate::plan::SkyHour`]) and darken what the sun allows.

use core::f64::consts::PI;

/// Salt Lake City, at the State Capitol.
pub const SLC_LAT: f64 = 40.7608;
/// West longitude is negative.
pub const SLC_LON: f64 = -111.8910;

/// Julian date of a UTC time in milliseconds since the Unix epoch.
pub fn julian_date(utc_ms: f64) -> f64 {
    utc_ms / 86_400_000.0 + 2_440_587.5
}

/// Sun elevation in degrees above the horizon at SLC (NOAA's simplified
/// solar position: good to a few tenths of a degree, plenty for dawn and
/// dusk).
pub fn sun_elevation(utc_ms: f64) -> f32 {
    let n = julian_date(utc_ms) - 2_451_545.0;
    let mean_long = (280.460 + 0.985_647_4 * n).rem_euclid(360.0);
    let anomaly = ((357.528 + 0.985_600_3 * n).rem_euclid(360.0)).to_radians();
    let ecl_long =
        (mean_long + 1.915 * libm::sin(anomaly) + 0.020 * libm::sin(2.0 * anomaly)).to_radians();
    let obliquity = (23.439 - 0.000_000_4 * n).to_radians();
    let decl = libm::asin(libm::sin(obliquity) * libm::sin(ecl_long));
    let ra = libm::atan2(
        libm::cos(obliquity) * libm::sin(ecl_long),
        libm::cos(ecl_long),
    );
    let gmst_hours = (18.697_374_558 + 24.065_709_824_419_08 * n).rem_euclid(24.0);
    let hour_angle = (gmst_hours * 15.0 + SLC_LON).to_radians() - ra;
    let lat = SLC_LAT.to_radians();
    let elev = libm::asin(
        libm::sin(lat) * libm::sin(decl) + libm::cos(lat) * libm::cos(decl) * libm::cos(hour_angle),
    );
    elev.to_degrees() as f32
}

/// Fraction of the moon's disc lit, 0 (new) to 1 (full), from the mean
/// synodic month and the new moon of 2000-01-06 18:14 UTC.
pub fn moon_illumination(utc_ms: f64) -> f32 {
    const SYNODIC_DAYS: f64 = 29.530_588_853;
    const NEW_MOON_JD: f64 = 2_451_550.26;
    let age = (julian_date(utc_ms) - NEW_MOON_JD).rem_euclid(SYNODIC_DAYS);
    (0.5 * (1.0 - libm::cos(2.0 * PI * age / SYNODIC_DAYS))) as f32
}

/// Smooth step from 0 below `lo` to 1 above `hi`.
pub fn smoothstep(lo: f32, hi: f32, x: f32) -> f32 {
    let t = ((x - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How bright the valley is, 0 (night or storm) to 1 (bluebird).
///
/// The sun sets the ceiling, cloud cover takes up to two-thirds of it away,
/// and falling rain or snow halves what's left. At night a clear sky under a
/// full moon keeps a little light, so a bright nocturne sits a rung above a
/// dark one.
pub fn brightness(sun_elev_deg: f32, cloud: f32, wet: bool, moon: f32) -> f32 {
    let cloud = if cloud.is_finite() {
        cloud.clamp(0.0, 1.0)
    } else {
        0.3
    };
    let day = smoothstep(-6.0, 18.0, sun_elev_deg);
    let clouds = 1.0 - 0.65 * cloud;
    let weather = if wet { 0.5 } else { 1.0 };
    let night_glow = 0.22 * moon * (1.0 - cloud) * (1.0 - day);
    (day * clouds * weather + night_glow).clamp(0.0, 1.0)
}

/// The brightness rung (0 Lydian … 4 Aeolian) a brightness asks for.
pub fn rung_for(brightness: f32) -> u8 {
    (4.0 * (1.0 - brightness.clamp(0.0, 1.0))).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-23 at a given MDT (UTC−6) hour and minute, as UTC ms.
    fn oct23_mdt(hour: f64, minute: f64) -> f64 {
        // 2026-10-23T00:00Z is 20,749 days after the epoch.
        (20_749.0 * 86_400.0 + (hour + 6.0) * 3600.0 + minute * 60.0) * 1000.0
    }

    #[test]
    fn sun_matches_the_worked_example() {
        // DESIGN.md Appendix C: 8.7° at 5:42 PM, sunset about 6:36 PM.
        let e = sun_elevation(oct23_mdt(17.0, 42.0));
        assert!((e - 8.7).abs() < 0.4, "{e}");
        let at_sunset = sun_elevation(oct23_mdt(18.0, 36.0));
        assert!((at_sunset + 0.8).abs() < 0.6, "{at_sunset}");
        assert!(sun_elevation(oct23_mdt(13.0, 0.0)) > 35.0);
        assert!(sun_elevation(oct23_mdt(2.0, 0.0)) < -30.0);
    }

    #[test]
    fn moon_cycles() {
        // The full moon of 2025-01-13 at 22:27 UTC. The mean synodic month
        // drifts from the true phases by up to about half a day, hence the
        // tolerances.
        let full = (20_101.0 * 86_400.0 + 22.45 * 3600.0) * 1000.0;
        assert!(
            moon_illumination(full) > 0.93,
            "{}",
            moon_illumination(full)
        );
        let new = full + 14.77 * 86_400_000.0;
        assert!(moon_illumination(new) < 0.07, "{}", moon_illumination(new));
    }

    #[test]
    fn brightness_orders_the_sky() {
        let bluebird = brightness(40.0, 0.0, false, 0.0);
        let overcast = brightness(40.0, 1.0, false, 0.0);
        let storm = brightness(40.0, 1.0, true, 0.0);
        let night = brightness(-30.0, 0.0, false, 0.0);
        let moonlit = brightness(-30.0, 0.0, false, 1.0);
        assert!(bluebird > overcast && overcast > storm && storm > night);
        assert!(moonlit > night);
        assert_eq!(rung_for(bluebird), 0);
        assert_eq!(rung_for(night), 4);
        assert_eq!(rung_for(moonlit), 3);
    }
}
