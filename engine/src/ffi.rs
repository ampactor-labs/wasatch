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
use crate::compose::{BikeEvent, QuakeEvent, Slow};
use crate::engine::Engine;
use crate::plan::SkyHour;
use crate::schedule::{Network, RouteKind, ServiceDay, Stop};
use std::cell::RefCell;

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
    static INBOX: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTBOX: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PCM: RefCell<(f32, Vec<i16>)> = const { RefCell::new((0.0, Vec::new())) };
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
            let hours: Vec<(f64, SkyHour)> = (0..n)
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
                    };
                    (at, h)
                })
                .collect();
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
