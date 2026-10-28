//! The WebAssembly interface: plain `extern "C"` functions, no imports, no
//! wasm-bindgen (an AudioWorklet has no `fetch` or `TextDecoder`, and
//! wasm-bindgen's worklet path needs atomics and cross-origin isolation).
//!
//! The host writes a message into the inbox (`wasatch_inbox` returns where),
//! then calls `wasatch_post` with its kind. Audio comes back from
//! `wasatch_render` as a pointer to planar floats; events come back as JSON
//! lines through `wasatch_outbox_len` and `wasatch_outbox_ptr`. All numbers
//! are little-endian.

// The exports' fixed names (`no_mangle`) are this module's only unsafe: they
// are the crate's whole C ABI, each named once.
#![allow(unsafe_code)]

use crate::audio::voices::PianoSample;
use crate::compose::{AlertEvent, BikeEvent, PlaneEvent, QuakeEvent, RoadEvent, RoadWindow, Slow};
use crate::engine::Engine;
use crate::plan::SkyHour;
use crate::schedule::{Network, RouteKind, ServiceDay, Stop};
use std::cell::RefCell;

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
    static INBOX: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTBOX: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PCM: RefCell<(f32, Vec<i16>)> = const { RefCell::new((0.0, Vec::new())) };
    static DELAY_CONFIDENCE: core::cell::Cell<f32> = const { core::cell::Cell::new(0.0) };
}

/// Message kinds.
pub mod kind {
    /// A service day of the schedule.
    pub const DAY: u32 = 1;
    /// Routes and stops.
    pub const NETWORK: u32 = 2;
    /// Hours of sky.
    pub const SKY: u32 = 3;
    /// Slow values.
    pub const SLOW: u32 = 4;
    /// Tie the audio clock to UTC.
    pub const CLOCK: u32 = 5;
    /// The vantage.
    pub const VANTAGE: u32 = 6;
    /// GREENbike dock changes.
    pub const BIKES: u32 = 7;
    /// Earthquakes.
    pub const QUAKES: u32 = 8;
    /// A piano sample, as PCM.
    pub const SAMPLE: u32 = 9;
    /// The skyline profile.
    pub const SKYLINE: u32 = 10;
    /// Start: the welcome, then the stream.
    pub const START: u32 = 11;
    /// Fade out.
    pub const STOP: u32 = 12;
    /// Baseband samples for a ground band.
    pub const GROUND: u32 = 13;
    /// Play along: a ski's edge picks a note.
    pub const PLAY: u32 = 14;
    /// A run's solo.
    pub const SOLO: u32 = 15;
    /// A Day in Twelve Minutes (a date), or back to live (0).
    pub const TWELVE: u32 = 16;
    /// A conductor's window of rail departures.
    pub const RAIL: u32 = 17;
    /// A conductor's window of planes: `f64 from, f64 to, u32 n`, then rows
    /// of `f64 ms, f32 lat, f32 lon, f32 alt_ft, u8 kind (0 departing, 1
    /// landing), u8 size 1–5, u8 flags (1 an airline's), u8 0`.
    pub const PLANES: u32 = 18;
    /// A conductor's window of service alerts: `f64 from, f64 to, u8
    /// active[4]` (in effect as it was sealed: buses, TRAX, FrontRunner, ski
    /// buses), `u32 n`, then rows of `f64 ms, u8 kind 0–3, u8 flags (1
    /// severe), u16 0`.
    pub const ALERTS: u32 = 19;
    /// A conductor's window of the roads: `f64 from, f64 to, u8 traction[2]`
    /// (up Little and Big Cottonwood), `u16 plows, u16 closures, u16 0, u32
    /// n`, then rows of `f64 ms, u8 kind (0 an incident, 1 cleared, 2
    /// avalanche control), u8 road (0 the valley, 1 Little Cottonwood, 2
    /// Big), u16 0, f32 lat, f32 lon`.
    pub const ROADS: u32 = 20;
}

/// A little-endian reader that never panics: short reads return zeros.
struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, p: 0 }
    }

    fn take<const N: usize>(&mut self) -> [u8; N] {
        let mut out = [0u8; N];
        if let Some(s) = self.b.get(self.p..self.p + N) {
            out.copy_from_slice(s);
        }
        self.p += N;
        out
    }

    fn u8(&mut self) -> u8 {
        self.take::<1>()[0]
    }
    fn u16(&mut self) -> u16 {
        u16::from_le_bytes(self.take())
    }
    fn i16(&mut self) -> i16 {
        i16::from_le_bytes(self.take())
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take())
    }
    fn i32(&mut self) -> i32 {
        i32::from_le_bytes(self.take())
    }
    fn f32(&mut self) -> f32 {
        f32::from_le_bytes(self.take())
    }
    fn f64(&mut self) -> f64 {
        f64::from_le_bytes(self.take())
    }
    /// Bytes left.
    fn remaining(&self) -> usize {
        self.b.len().saturating_sub(self.p)
    }
    /// A count, capped by what could possibly fit in the rest of the buffer.
    fn count(&mut self, item_bytes: usize) -> usize {
        let n = self.u32() as usize;
        let room = self.b.len().saturating_sub(self.p) / item_bytes.max(1);
        n.min(room)
    }
}

fn with_engine<R>(f: impl FnOnce(&mut Engine) -> R) -> Option<R> {
    ENGINE.with(|e| e.borrow_mut().as_mut().map(f))
}

/// Create the engine at `sample_rate`.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_init(sample_rate: f32) {
    ENGINE.with(|e| *e.borrow_mut() = Some(Engine::new(sample_rate)));
}

/// Make room for a message of `len` bytes; returns where to write it.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_inbox(len: u32) -> *mut u8 {
    INBOX.with(|b| {
        let mut b = b.borrow_mut();
        b.resize(len as usize, 0);
        b.as_mut_ptr()
    })
}

/// Handle the message in the inbox. Returns 0 on success, −1 without an
/// engine, −2 for an unknown kind.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_post(kind: u32, len: u32) -> i32 {
    INBOX.with(|b| {
        let b = b.borrow();
        let bytes = &b[..(len as usize).min(b.len())];
        handle(kind, bytes)
    })
}

fn handle(kind: u32, bytes: &[u8]) -> i32 {
    let mut r = Reader::new(bytes);
    let ok = match kind {
        kind::DAY => {
            let date = r.u32();
            let t0_ms = r.f64();
            let n = r.count(8);
            let rail = (0..n).map(|_| (r.u32(), r.u32())).collect();
            let n = r.count(8);
            let ski = (0..n).map(|_| (r.u32(), r.u32())).collect();
            let n = r.count(4);
            let bus: Vec<u16> = (0..n).map(|_| r.u16()).collect();
            let bus_west: Vec<u16> = (0..n).map(|_| r.u16()).collect();
            with_engine(|e| {
                e.set_day(ServiceDay {
                    date,
                    t0_ms,
                    rail,
                    ski,
                    bus,
                    bus_west,
                })
            })
        }
        kind::NETWORK => {
            let n = r.count(1);
            let routes = (0..n)
                .map(|_| RouteKind::from_code(u32::from(r.u8())))
                .collect();
            let n = r.count(8);
            let stops = (0..n)
                .map(|_| Stop {
                    lat: r.f32(),
                    lon: r.f32(),
                })
                .collect();
            let central = r.i32();
            let slc_central = u16::try_from(central).ok();
            with_engine(|e| {
                e.set_network(Network {
                    routes,
                    stops,
                    slc_central,
                })
            })
        }
        kind::SKY => {
            let n = r.count(56);
            let mut hours: Vec<(f64, SkyHour)> = (0..n)
                .map(|_| {
                    let at = r.f64();
                    let h = SkyHour {
                        cloud: r.f32(),
                        precip_mm: r.f32(),
                        snow_cm: r.f32(),
                        temp_c: r.f32(),
                        wind_ms: r.f32(),
                        gust_ms: r.f32(),
                        pm25: r.f32(),
                        inversion_c: r.f32(),
                        alert: r.f32(),
                        ridge_ms: r.f32(),
                        ridge_gust_ms: r.f32(),
                        mtn_snow_cm: r.f32(),
                        ..SkyHour::default()
                    };
                    (at, h)
                })
                .collect();
            // Fields added since: `u32 k`, then k floats an hour, hour by
            // hour. An older page sends none (they stay unknown); a newer one
            // may send more than this engine reads.
            let k = r.u32() as usize;
            if (1..=64).contains(&k) && r.remaining() >= n * k * 4 {
                for (_, h) in &mut hours {
                    let mut more = [f32::NAN; 5];
                    for i in 0..k {
                        let v = r.f32();
                        if let Some(m) = more.get_mut(i) {
                            *m = v;
                        }
                    }
                    [
                        h.flow,
                        h.pressure_tend,
                        h.storm_mm,
                        h.pm25_downtown,
                        h.pm25_lake,
                    ] = more;
                }
            }
            with_engine(|e| {
                for (at, h) in hours {
                    e.set_sky_hour(at, h);
                }
            })
        }
        kind::SLOW => {
            let slow = Slow {
                lake_ft: r.f32(),
                lake_dev_ft: r.f32(),
                river: r.f32(),
                snowpack: r.f32(),
                new_snow_in: r.f32(),
                powder: r.f32(),
                season: r.f32(),
                ground: [r.f32(), r.f32(), r.f32(), r.f32()],
                energy: r.f32(),
            };
            with_engine(|e| e.set_slow(slow))
        }
        kind::CLOCK => {
            let frame = r.f64();
            let utc = r.f64();
            with_engine(|e| e.set_clock(frame, utc))
        }
        kind::VANTAGE => {
            let v = r.u32();
            with_engine(|e| e.set_vantage(v))
        }
        kind::BIKES => {
            let n = r.count(24);
            let bikes = (0..n)
                .map(|_| BikeEvent {
                    ms: r.f64(),
                    lat: r.f32(),
                    lon: r.f32(),
                    delta: r.i32().clamp(-127, 127) as i8,
                    station: r.u32() as u16,
                })
                .collect();
            with_engine(|e| e.set_bikes(bikes))
        }
        kind::QUAKES => {
            let n = r.count(28);
            let quakes = (0..n)
                .map(|_| QuakeEvent {
                    ms: r.f64(),
                    origin_ms: r.f64(),
                    mag: r.f32(),
                    lat: r.f32(),
                    lon: r.f32(),
                })
                .collect();
            with_engine(|e| e.set_quakes(quakes))
        }
        kind::SAMPLE => {
            let midi = r.u32() as u8;
            let rate = r.f32();
            let n = r.count(2);
            let data = (0..n).map(|_| r.i16()).collect();
            with_engine(|e| e.add_sample(PianoSample { midi, rate, data }))
        }
        kind::SKYLINE => {
            let n = r.count(4);
            let elev: Vec<f32> = (0..n).map(|_| r.f32()).collect();
            with_engine(|e| e.set_skyline(&elev))
        }
        kind::START => with_engine(Engine::start),
        kind::STOP => with_engine(Engine::stop),
        kind::GROUND => {
            let band = r.u32() as usize;
            let (lat, lon) = (r.f32(), r.f32());
            let n = r.count(8);
            let iq: Vec<(f32, f32)> = (0..n).map(|_| (r.f32(), r.f32())).collect();
            with_engine(|e| e.push_ground(band, lat, lon, &iq))
        }
        kind::PLAY => {
            let edge = r.f32();
            let vel = r.f32();
            let flags = r.u32();
            with_engine(|e| e.play(edge, vel, flags & 1 == 1))
        }
        kind::SOLO => {
            let n = r.count(16);
            let notes = (0..n)
                .map(|_| crate::listener::SoloNote {
                    beat: r.f32(),
                    degree: r.i32(),
                    vel: r.f32(),
                    beats: r.f32(),
                })
                .collect();
            with_engine(|e| e.set_solo(notes))
        }
        kind::RAIL => {
            let from = r.f64();
            let to = r.f64();
            let n = r.count(21);
            let events: Vec<crate::schedule::RailEvent> = (0..n)
                .map(|_| {
                    let ms = r.f64();
                    let sched = r.f64();
                    let route = r.u8();
                    let dir = r.u8();
                    let stop = r.u16();
                    let observed = r.u8() == 1;
                    crate::schedule::RailEvent {
                        ms,
                        route,
                        dir,
                        stop,
                        late_s: ((ms - sched) / 1000.0).round().clamp(-3600.0, 3600.0) as i16,
                        observed,
                    }
                })
                .collect();
            // Added since: when the next FrontRunner was due at Central.
            let due = r.f64();
            with_engine(|e| e.perform(from, to, &events, due))
        }
        kind::PLANES => {
            let from = r.f64();
            let to = r.f64();
            let n = r.count(24);
            let planes = (0..n)
                .map(|_| {
                    let ms = r.f64();
                    let lat = r.f32();
                    let lon = r.f32();
                    let alt_ft = r.f32();
                    let arrival = r.u8() == 1;
                    let size = r.u8();
                    let flags = r.u8();
                    let _ = r.u8();
                    PlaneEvent {
                        ms,
                        lat,
                        lon,
                        alt_ft,
                        arrival,
                        size: if size == 0 { 3 } else { size.min(5) },
                        airline: flags & 1 == 1,
                    }
                })
                .collect();
            with_engine(|e| e.set_planes(from, to, planes))
        }
        kind::ALERTS => {
            let from = r.f64();
            let to = r.f64();
            let active = [r.u8(), r.u8(), r.u8(), r.u8()];
            let n = r.count(12);
            let alerts = (0..n)
                .map(|_| {
                    let ms = r.f64();
                    let route_kind = r.u8().min(3);
                    let flags = r.u8();
                    let _ = r.u16();
                    AlertEvent {
                        ms,
                        route_kind,
                        severe: flags & 1 == 1,
                    }
                })
                .collect();
            with_engine(|e| e.set_alerts(from, to, active, alerts))
        }
        kind::ROADS => {
            let from_ms = r.f64();
            let to_ms = r.f64();
            let traction = [r.u8() == 1, r.u8() == 1];
            let plows = r.u16();
            let closures = r.u16();
            let _ = r.u16();
            let n = r.count(20);
            let roads = (0..n)
                .map(|_| {
                    let ms = r.f64();
                    let kind = r.u8().min(2);
                    let road = r.u8().min(2);
                    let _ = r.u16();
                    RoadEvent {
                        ms,
                        kind,
                        road,
                        lat: r.f32(),
                        lon: r.f32(),
                    }
                })
                .collect();
            let window = RoadWindow {
                from_ms,
                to_ms,
                traction,
                plows,
                closures,
            };
            with_engine(|e| e.set_roads(window, roads))
        }
        kind::TWELVE => {
            let date = r.u32();
            with_engine(|e| e.twelve(date))
        }
        _ => return -2,
    };
    if ok.is_some() { 0 } else { -1 }
}

/// Render `frames` of audio; returns a pointer to `2 × frames` floats, left
/// then right (null without an engine).
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_render(frames: u32) -> *const f32 {
    // The engine's output buffer never reallocates after construction, so
    // its pointer stays valid: no copy, no allocation on the audio thread.
    with_engine(|e| e.render(frames as usize).as_ptr()).unwrap_or(core::ptr::null())
}

/// Move the engine's events into the outbox; returns their length in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_outbox_len() -> u32 {
    OUTBOX.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        with_engine(|e| {
            o.extend_from_slice(e.outbox().as_bytes());
            e.clear_outbox();
        });
        o.len() as u32
    })
}

/// Where the outbox's bytes are.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_outbox_ptr() -> *const u8 {
    OUTBOX.with(|o| o.borrow().as_ptr())
}

/// Decode the MP3 in the inbox (`len` bytes) to mono 16-bit PCM, trimmed to
/// `max_seconds`; returns the frame count (0 on failure).
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_decode(len: u32, max_seconds: f32) -> u32 {
    let decoded = INBOX.with(|b| {
        let b = b.borrow();
        crate::decode::decode_mp3(&b[..(len as usize).min(b.len())], max_seconds)
    });
    PCM.with(|p| {
        let mut p = p.borrow_mut();
        match decoded {
            Ok((rate, data)) => {
                *p = (rate, data);
                p.1.len() as u32
            }
            Err(_) => {
                *p = (0.0, Vec::new());
                0
            }
        }
    })
}

/// Where the decoded PCM is.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_pcm_ptr() -> *const i16 {
    PCM.with(|p| p.borrow().1.as_ptr())
}

/// The decoded PCM's sample rate.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_pcm_rate() -> f32 {
    PCM.with(|p| p.borrow().0)
}

/// Tune to the room: how many samples the second of two signals in the
/// inbox lags the first (`n_x` then `n_y` little-endian floats), searched
/// within ±`max_lag`, by GCC-PHAT with weighting `beta` (sonido-analysis).
/// [`wasatch_delay_confidence`] then says how far the peak stands out.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_delay(n_x: u32, n_y: u32, max_lag: u32, beta: f32) -> i32 {
    let (x, y) = INBOX.with(|b| {
        let b = b.borrow();
        let floats = |from: usize, n: usize| -> Vec<f32> {
            (0..n)
                .map(|i| {
                    let at = from + 4 * i;
                    b.get(at..at + 4)
                        .map_or(0.0, |w| f32::from_le_bytes([w[0], w[1], w[2], w[3]]))
                })
                .collect()
        };
        (
            floats(0, n_x as usize),
            floats(4 * n_x as usize, n_y as usize),
        )
    });
    let max_lag = max_lag as usize;
    if x.is_empty() || y.is_empty() {
        DELAY_CONFIDENCE.with(|c| c.set(0.0));
        return 0;
    }
    let r = sonido_analysis::xcorr::gcc_phat(&x, &y, max_lag, beta.clamp(0.0, 1.0));
    let (lag, peak) = sonido_analysis::xcorr::peak_lag(&r, max_lag);
    DELAY_CONFIDENCE.with(|c| c.set(prominence(&r, lag + max_lag as i32, peak)));
    lag
}

/// How far a correlation's peak stands above the rest of it: the peak over
/// the RMS of every lag more than 8 samples away. Noise alone across
/// `n` lags tops out near √(2 ln n), about 5 for a second at 48 kHz.
fn prominence(r: &[f32], at: i32, peak: f32) -> f32 {
    let (mut sum, mut n) = (0.0f64, 0usize);
    for (i, v) in r.iter().enumerate() {
        if (i as i32 - at).abs() > 8 {
            sum += f64::from(*v) * f64::from(*v);
            n += 1;
        }
    }
    let rms = (sum / n.max(1) as f64).sqrt() as f32;
    if rms > 0.0 { peak.abs() / rms } else { 0.0 }
}

/// The last [`wasatch_delay`]'s prominence: its peak over the RMS of the
/// rest of the correlation.
#[unsafe(no_mangle)]
pub extern "C" fn wasatch_delay_confidence() -> f32 {
    DELAY_CONFIDENCE.with(|c| c.get())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delay_finds_a_known_lag() {
        // A noise burst and the same burst 37 samples later, in some hiss.
        let mut seed = 0x1234_5678u32;
        let mut noise = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as i32) as f32 / 2_147_483_648.0
        };
        let n = 8192;
        let x: Vec<f32> = (0..n).map(|_| noise()).collect();
        let y: Vec<f32> = (0..n)
            .map(|i| if i >= 37 { x[i - 37] } else { 0.0 } + 0.3 * noise())
            .collect();
        let mut bytes = Vec::new();
        for v in x.iter().chain(&y) {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let ptr = wasatch_inbox(bytes.len() as u32);
        INBOX.with(|b| b.borrow_mut().copy_from_slice(&bytes));
        let _ = ptr;
        assert_eq!(wasatch_delay(n as u32, n as u32, 400, 0.5), 37);
        assert!(
            wasatch_delay_confidence() > 10.0,
            "{}",
            wasatch_delay_confidence()
        );
    }

    fn delay_of(x: &[f32], y: &[f32], max_lag: u32, beta: f32) -> (i32, f32) {
        let mut bytes = Vec::new();
        for v in x.iter().chain(y) {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let _ = wasatch_inbox(bytes.len() as u32);
        INBOX.with(|b| b.borrow_mut().copy_from_slice(&bytes));
        let lag = wasatch_delay(x.len() as u32, y.len() as u32, max_lag, beta);
        (lag, wasatch_delay_confidence())
    }

    /// The thresholds the page uses (web/src/app/tune.ts): music heard
    /// through a reverberant room at a distance stands well clear; a
    /// microphone that hears something unrelated never does.
    #[test]
    fn delay_confidence_separates_a_room_from_nothing() {
        let sr = 48_000usize;
        let mut seed = 0x9E37_79B9u32;
        let mut noise = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as i32) as f32 / 2_147_483_648.0
        };
        // Four seconds of "music": plucked partials every 300 ms plus hats.
        let n = 4 * sr;
        let mut music = vec![0.0f32; n];
        for k in 0..(n / 14_400) {
            let f = [196.0, 247.0, 294.0, 392.0][k % 4];
            for i in 0..12_000.min(n - k * 14_400) {
                let t = i as f32 / sr as f32;
                music[k * 14_400 + i] +=
                    0.3 * (core::f32::consts::TAU * f * t).sin() * (-t * 4.0).exp();
            }
        }
        for v in &mut music {
            *v += 0.05 * noise();
        }
        // The other phone, 180 ms late, through a room: an exponential tail.
        let delay = (0.18 * sr as f32) as usize;
        let mut room = vec![0.0f32; n];
        for (i, v) in room.iter_mut().enumerate() {
            if i >= delay {
                *v = 0.4 * music[i - delay];
            }
        }
        let mut tail = 0.0f32;
        for v in &mut room {
            tail = 0.97 * tail + 0.02 * *v;
            *v += 3.0 * tail + 0.05 * noise();
        }
        let (lag, conf) = delay_of(&music, &room, sr as u32, 0.5);
        assert!((lag - delay as i32).abs() <= 2, "lag {lag}");
        assert!(conf > 12.0, "a room: {conf}");
        // A beep that has nothing to do with it.
        let beep: Vec<f32> = (0..n)
            .map(|i| 0.5 * (core::f32::consts::TAU * 1000.0 * i as f32 / sr as f32).sin())
            .collect();
        let (_, conf) = delay_of(&music, &beep, sr as u32, 0.5);
        assert!(conf < 7.0, "a beep: {conf}");
        let hiss: Vec<f32> = (0..n).map(|_| 0.1 * noise()).collect();
        let (_, conf) = delay_of(&music, &hiss, sr as u32, 0.5);
        assert!(conf < 7.0, "hiss: {conf}");
    }

    fn post(kind: u32, bytes: &[u8]) -> i32 {
        let ptr = wasatch_inbox(bytes.len() as u32);
        INBOX.with(|b| b.borrow_mut().copy_from_slice(bytes));
        let _ = ptr;
        wasatch_post(kind, bytes.len() as u32)
    }

    #[test]
    fn messages_round_trip_and_short_messages_are_safe() {
        wasatch_init(48_000.0);
        let mut m = Vec::new();
        m.extend_from_slice(&20261023u32.to_le_bytes());
        m.extend_from_slice(&1_761_199_200_000f64.to_le_bytes());
        m.extend_from_slice(&1u32.to_le_bytes());
        m.extend_from_slice(&21_600u32.to_le_bytes());
        m.extend_from_slice(&(1u32 | (5 << 16)).to_le_bytes());
        m.extend_from_slice(&0u32.to_le_bytes());
        m.extend_from_slice(&0u32.to_le_bytes());
        // Messages cut short must not panic.
        assert_eq!(post(kind::DAY, &m[..7]), 0);
        assert_eq!(post(kind::SKY, &[1, 2, 3]), 0);
        assert_eq!(post(kind::DAY, &m), 0);
        assert_eq!(post(999, &[]), -2);
        let mut clock = Vec::new();
        clock.extend_from_slice(&0f64.to_le_bytes());
        clock.extend_from_slice(&1_761_240_000_000f64.to_le_bytes());
        assert_eq!(post(kind::CLOCK, &clock), 0);
        assert_eq!(post(kind::START, &[]), 0);
        let p = wasatch_render(128);
        assert!(!p.is_null());
        let n = wasatch_outbox_len();
        assert!(n > 0, "start should report a bar and the theme");

        // Play along: one note, reported at once.
        let mut play = Vec::new();
        play.extend_from_slice(&0.3f32.to_le_bytes());
        play.extend_from_slice(&0.8f32.to_le_bytes());
        play.extend_from_slice(&1u32.to_le_bytes());
        assert_eq!(post(kind::PLAY, &play), 0);
        let events = |_: ()| {
            let n = wasatch_outbox_len() as usize;
            let p = wasatch_outbox_ptr();
            String::from_utf8_lossy(unsafe { core::slice::from_raw_parts(p, n) }).into_owned()
        };
        assert!(events(()).contains(r#""t":"play""#));

        // A run's solo starts at the next bar line.
        let mut solo = Vec::new();
        solo.extend_from_slice(&3u32.to_le_bytes());
        for (beat, degree) in [(0.0f32, 4i32), (1.0, 2), (2.0, 0)] {
            solo.extend_from_slice(&beat.to_le_bytes());
            solo.extend_from_slice(&degree.to_le_bytes());
            solo.extend_from_slice(&0.7f32.to_le_bytes());
            solo.extend_from_slice(&1.0f32.to_le_bytes());
        }
        assert_eq!(post(kind::SOLO, &solo), 0);
        let mut heard = String::new();
        for _ in 0..(48_000 * 10 / 512) {
            wasatch_render(512);
            heard.push_str(&events(()));
        }
        assert_eq!(heard.matches(r#""t":"solo""#).count(), 3, "{heard}");
    }

    fn f32s(m: &mut Vec<u8>, vs: &[f32]) {
        for v in vs {
            m.extend_from_slice(&v.to_le_bytes());
        }
    }

    #[test]
    fn older_and_newer_pages_both_read_right() {
        wasatch_init(48_000.0);
        let at = 1_761_199_200_000f64;
        let sky = |e: &mut Engine| e.inputs.sky.at(at).expect("the hour");
        // An older page's sky: no fields after the rows.
        let mut old = 1u32.to_le_bytes().to_vec();
        old.extend_from_slice(&at.to_le_bytes());
        f32s(
            &mut old,
            &[0.5, 0.0, 0.0, 12.0, 3.0, 5.0, 5.0, 0.0, 0.0, 4.0, 6.0, 0.0],
        );
        assert_eq!(post(kind::SKY, &old), 0);
        let h = with_engine(sky).unwrap();
        assert_eq!(h.temp_c, 12.0);
        assert!(h.flow.is_nan() && h.pressure_tend.is_nan() && h.storm_mm.is_nan());
        // A newer page's: three more an hour.
        let mut new = old.clone();
        new.extend_from_slice(&3u32.to_le_bytes());
        f32s(&mut new, &[0.4, -2.5, 120.0]);
        assert_eq!(post(kind::SKY, &new), 0);
        let h = with_engine(sky).unwrap();
        assert_eq!((h.flow, h.pressure_tend, h.storm_mm), (0.4, -2.5, 120.0));
        // Cut short: unknown, never zero.
        assert_eq!(post(kind::SKY, &new[..new.len() - 2]), 0);
        assert!(with_engine(sky).unwrap().flow.is_nan());
        // Five: the air measured downtown and at the lake.
        let mut five = old.clone();
        five.extend_from_slice(&5u32.to_le_bytes());
        f32s(&mut five, &[0.4, -2.5, 120.0, 11.1, 2.7]);
        assert_eq!(post(kind::SKY, &five), 0);
        let h = with_engine(sky).unwrap();
        assert_eq!(
            (h.storm_mm, h.pm25_downtown, h.pm25_lake),
            (120.0, 11.1, 2.7)
        );
        // A page newer than this engine: the fields it knows.
        let mut newer = old.clone();
        newer.extend_from_slice(&7u32.to_le_bytes());
        f32s(&mut newer, &[0.4, -2.5, 120.0, 9.0, 9.0, 1.0, 2.0]);
        assert_eq!(post(kind::SKY, &newer), 0);
        let h = with_engine(sky).unwrap();
        assert_eq!(
            (h.storm_mm, h.pm25_downtown, h.pm25_lake),
            (120.0, 9.0, 9.0)
        );

        // Slow values without the grid: as usual.
        let mut slow = Vec::new();
        f32s(
            &mut slow,
            &[4190.0, 0.0, 0.5, 1.0, 0.0, 0.5, 0.2, 0.0, 0.0, 0.0, 0.0],
        );
        assert_eq!(post(kind::SLOW, &slow), 0);
        assert_eq!(with_engine(|e| e.inputs.slow.energy_or_usual()), Some(1.0));
        f32s(&mut slow, &[1.1]);
        assert_eq!(post(kind::SLOW, &slow), 0);
        assert_eq!(with_engine(|e| e.inputs.slow.energy_or_usual()), Some(1.1));

        // A rail window without the FrontRunner due, and with it.
        let (from, to) = (at, at + 30_000.0);
        let mut rail = Vec::new();
        rail.extend_from_slice(&from.to_le_bytes());
        rail.extend_from_slice(&to.to_le_bytes());
        rail.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(post(kind::RAIL, &rail), 0);
        assert_eq!(
            with_engine(|e| e.inputs.schedule.due_at(at + 1.0)),
            Some(None)
        );
        rail.extend_from_slice(&(at + 200_000.0).to_le_bytes());
        assert_eq!(post(kind::RAIL, &rail), 0);
        assert_eq!(
            with_engine(|e| e.inputs.schedule.due_at(at + 1.0)),
            Some(Some(at + 200_000.0))
        );

        // Planes: a window posted again replaces itself.
        let planes = |rows: &[(f64, u8, u8)]| {
            let mut m = Vec::new();
            m.extend_from_slice(&from.to_le_bytes());
            m.extend_from_slice(&to.to_le_bytes());
            m.extend_from_slice(&(rows.len() as u32).to_le_bytes());
            for &(ms, size, flags) in rows {
                m.extend_from_slice(&ms.to_le_bytes());
                f32s(&mut m, &[40.8, -111.97, 6300.0]);
                m.extend_from_slice(&[0, size, flags, 0]);
            }
            m
        };
        let two = planes(&[(at + 1_000.0, 0, 1), (at + 21_000.0, 5, 0)]);
        assert_eq!(post(kind::PLANES, &two), 0);
        let got = with_engine(|e| e.inputs.planes.clone()).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(
            (got[0].size, got[0].airline),
            (3, true),
            "size unknown: medium"
        );
        assert_eq!((got[1].size, got[1].airline), (5, false));
        assert_eq!(post(kind::PLANES, &planes(&[(at + 5_000.0, 2, 1)])), 0);
        assert_eq!(with_engine(|e| e.inputs.planes.len()), Some(1));
        assert_eq!(post(kind::PLANES, &two[..30]), 0);

        // Alerts, and what's in effect.
        let mut alerts = Vec::new();
        alerts.extend_from_slice(&from.to_le_bytes());
        alerts.extend_from_slice(&to.to_le_bytes());
        alerts.extend_from_slice(&[126, 1, 0, 0]);
        alerts.extend_from_slice(&1u32.to_le_bytes());
        alerts.extend_from_slice(&(at + 4_000.0).to_le_bytes());
        alerts.extend_from_slice(&[1, 1, 0, 0]);
        assert_eq!(post(kind::ALERTS, &alerts), 0);
        let (events, windows) =
            with_engine(|e| (e.inputs.alerts.clone(), e.inputs.alert_windows.clone())).unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].severe && events[0].route_kind == 1);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].active, [126, 1, 0, 0]);
        assert_eq!(post(kind::ALERTS, &alerts[..19]), 0);

        // The roads.
        let mut roads = Vec::new();
        roads.extend_from_slice(&from.to_le_bytes());
        roads.extend_from_slice(&to.to_le_bytes());
        roads.extend_from_slice(&[1, 0]);
        roads.extend_from_slice(&41u16.to_le_bytes());
        roads.extend_from_slice(&2u16.to_le_bytes());
        roads.extend_from_slice(&0u16.to_le_bytes());
        roads.extend_from_slice(&1u32.to_le_bytes());
        roads.extend_from_slice(&(at + 9_000.0).to_le_bytes());
        roads.extend_from_slice(&[2, 1, 0, 0]);
        f32s(&mut roads, &[40.57, -111.7]);
        assert_eq!(post(kind::ROADS, &roads), 0);
        let (events, windows) =
            with_engine(|e| (e.inputs.roads.clone(), e.inputs.road_windows.clone())).unwrap();
        assert_eq!((events.len(), events[0].kind, events[0].road), (1, 2, 1));
        assert_eq!(
            (windows[0].traction, windows[0].plows, windows[0].closures),
            ([true, false], 41, 2)
        );
        assert_eq!(post(kind::ROADS, &roads[..23]), 0);
    }
}
