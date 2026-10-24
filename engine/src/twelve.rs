//! A Day in Twelve Minutes: a whole service day as its own form (DESIGN.md).
//!
//! A day at 120× can't be the live piece played faster: bars would fly past
//! and every train would be a drum roll. So it is composed for the speed:
//! 100 BPM, 300 bars, each bar standing for 4.8 minutes of the day from
//! 05:00 to 05:00. Every eight-bar phrase (38.4 minutes of the day) moves
//! the harmony under the live piece's one-note rule; each bar sums its slice
//! of the day into densities and features the slice's most salient moment.
//! Five movements follow the dayparts, and the theme opens first light.

use crate::compose::{
    Bar, BarCtx, ComposeState, Feature, FeatureKind, Harmony, Inst, NO_FEATURE, Note, Valley,
    at_or_above, chord_for, euclid, horn, mix_for,
};
use crate::music::Key;
use crate::plan::{
    ANCHOR_HOURS, Chain, Daypart, Reason, Section, SectionKind, Sky, brightness_at, tension_at,
};
use crate::schedule::{RouteKind, Schedule};
use crate::sky;
use crate::theme;
use crate::voicing;
use sonido_core::CounterRng;

/// Tempo.
pub const BPM: f32 = 100.0;
/// Bars in the piece.
pub const BARS: u32 = 300;
/// One bar, ms of listening.
pub const BAR_MS: f64 = 2400.0;
/// One bar, ms of the day, on a 24-hour day: 4.8 minutes. The night the
/// clocks fall back is 25 hours and spring forward's 23, so a run keeps its
/// own ([`DayRun::per_bar_ms`]).
pub const DAY_PER_BAR_MS: f64 = 288_000.0;
/// How much faster than a 24-hour day the piece runs.
pub const SPEED: f64 = DAY_PER_BAR_MS / BAR_MS;

/// Feature values that say which moment of the day a caption is.
pub mod moment {
    /// The next morning's first train, after the night's pause.
    pub const FIRST_TRAIN: f32 = 1.0;
    /// The night's last train, before it.
    pub const LAST_TRAIN: f32 = 2.0;
    /// Sunrise.
    pub const SUNRISE: f32 = 3.0;
    /// Sunset.
    pub const SUNSET: f32 = 4.0;
    /// The first ski bus.
    pub const FIRST_SKI: f32 = 5.0;
    /// The clock: a phrase's time of day.
    pub const CLOCK: f32 = 6.0;
}

/// A day planned as twelve minutes, placed in listening time.
#[derive(Clone, Debug)]
pub struct DayRun {
    /// The service date (yyyymmdd).
    pub date: u32,
    /// The service day's start, UTC ms.
    pub t0: f64,
    /// 05:00 of that day, UTC ms: bar 0.
    pub anchor: f64,
    /// Listening time of bar 0.
    pub piece0: f64,
    /// The sections: one per phrase.
    pub chain: Chain,
    /// How much of the day a bar stands for, ms: the day from 05:00 to the
    /// next 05:00, in 300 bars.
    pub per_bar_ms: f64,
    first_train: f64,
    last_train: f64,
    first_ski: f64,
    sunrise: f64,
    sunset: f64,
}

impl DayRun {
    /// The moment of the day a listening time stands for.
    pub fn day_at(&self, l: f64) -> f64 {
        self.anchor + (l - self.piece0) * self.speed()
    }

    /// How much faster than the day the piece runs: 120 on a 24-hour day.
    pub fn speed(&self) -> f64 {
        self.per_bar_ms / BAR_MS
    }

    /// Listening time when the piece is over.
    pub fn end(&self) -> f64 {
        self.piece0 + f64::from(BARS) * BAR_MS
    }
}

/// Which movement a bar of the day is in, by the local hour it stands for.
fn kind_for(index: u32, local_h: f64, rng: CounterRng) -> SectionKind {
    let h = local_h.rem_euclid(24.0);
    if index == 0 {
        return SectionKind::Theme;
    }
    let pick = |a: SectionKind, b: SectionKind| if rng.chance(9, 0.5) { a } else { b };
    match Daypart::at(h * 3600.0) {
        Daypart::FirstLight => pick(SectionKind::Groove, SectionKind::Atmosphere),
        Daypart::Work => pick(SectionKind::Groove, SectionKind::Journey),
        Daypart::Rush => SectionKind::Journey,
        Daypart::LastTrains => pick(SectionKind::Groove, SectionKind::Atmosphere),
        Daypart::Nocturne => pick(SectionKind::Lake, SectionKind::Atmosphere),
    }
}

/// When the sun crosses the horizon (−0.833°, refraction and the disc)
/// within `[from, to)`, rising or setting, to the minute.
fn sun_crossing(from: f64, to: f64, rising: bool) -> f64 {
    let mut prev = sky::sun_elevation(from);
    let mut t = from + 60_000.0;
    while t < to {
        let e = sky::sun_elevation(t);
        if rising && prev < -0.833 && e >= -0.833 || !rising && prev >= -0.833 && e < -0.833 {
            return t;
        }
        prev = e;
        t += 60_000.0;
    }
    f64::NAN
}

/// Plan service day `date` (starting `t0`, UTC ms) as twelve minutes whose
/// first bar sounds at listening time `piece0`.
pub fn plan_day(date: u32, t0: f64, piece0: f64, schedule: &Schedule, sky_data: &Sky) -> DayRun {
    let anchor = t0 + ANCHOR_HOURS * 3_600_000.0;
    let root = CounterRng::new(u64::from(date)).stream(0xD12);
    // The day runs from 05:00 to the next day's 05:00: 25 hours the night
    // the clocks fall back, 23 the night they spring forward, by the next
    // service day's start (24 when it isn't loaded).
    let next_t0 = schedule
        .days
        .iter()
        .map(|d| d.t0_ms)
        .filter(|&t| t > t0 + 12.0 * 3_600_000.0)
        .fold(f64::INFINITY, f64::min);
    let day_ms = if (next_t0 - t0 - 86_400_000.0).abs() <= 3_600_000.0 {
        next_t0 - t0
    } else {
        86_400_000.0
    };
    let per_bar_ms = day_ms / f64::from(BARS);
    // The local hour, which the next day's start resets once it's past.
    let local_h = |ms: f64| {
        if ms >= next_t0 {
            24.0 + (ms - next_t0) / 3_600_000.0
        } else {
            (ms - t0) / 3_600_000.0
        }
    };
    let phrases = BARS.div_ceil(8);
    let phrase_day = 8.0 * per_bar_ms;
    let mut sections = Vec::with_capacity(phrases as usize);
    let mut key = Key::new(
        i32::from(Key::HOME_COLLECTION),
        sky::rung_for(brightness_at(sky_data, anchor)),
    );
    let mut prev_activity = schedule.mean_activity(anchor - phrase_day, anchor);
    for index in 0..phrases {
        let d0 = anchor + f64::from(index) * phrase_day;
        let d1 = d0 + phrase_day;
        let local_h = local_h(d0);
        let rng = root.stream(u64::from(index));
        let activity = schedule.mean_activity(d0, d1);
        let b = brightness_at(sky_data, d0 + phrase_day * 0.5);
        let tension = tension_at(sky_data, d0);
        let prev_key = key;
        let mut notes_reason = None;
        let mut home_reason = None;
        if index == 0 {
            notes_reason = Some(Reason::DayStart);
        } else {
            let want = 4.0 * (1.0 - b);
            let r = f32::from(key.rung);
            let mut rung = key.rung;
            if (want - r).abs() > 0.65 {
                let step = (want.round() - r).clamp(-2.0, 2.0) as i32;
                rung = (i32::from(key.rung) + step).clamp(0, 4) as u8;
            }
            if rung != key.rung {
                home_reason = Some(if rung < key.rung {
                    Reason::Brighter
                } else {
                    Reason::Darker
                });
            }
            let mut c = i32::from(key.collection);
            let home = i32::from(Key::HOME_COLLECTION);
            let toward = c - (c - home).signum();
            let trend = activity - prev_activity;
            if local_h >= ANCHOR_HOURS + 22.0 {
                if toward != c {
                    c = toward;
                    notes_reason = Some(Reason::NightHome);
                } else if home_reason.is_none() {
                    rung = if rung < 4 { rung + 1 } else { rung - 1 };
                    home_reason = Some(Reason::NightDrift);
                }
            } else if trend > 0.02 {
                c += 1;
                notes_reason = Some(Reason::ValleyUp);
            } else if trend < -0.02 {
                c -= 1;
                notes_reason = Some(Reason::ValleyDown);
            } else if home_reason.is_none() {
                if toward != c {
                    c = toward;
                    notes_reason = Some(Reason::WalkHome);
                } else {
                    c += if rng.chance(1, 0.5) { 1 } else { -1 };
                    notes_reason = Some(Reason::Visit);
                }
            }
            key = Key::new(c, rung);
            if notes_reason.is_some() {
                home_reason = home_reason.filter(|_| rung != prev_key.rung);
            }
        }
        prev_activity = activity;
        let bars = (BARS - index * 8).min(8) as u16;
        let bank = crate::music::progressions(key.mode());
        sections.push(Section {
            chain: date,
            index,
            start_ms: piece0 + f64::from(index) * 8.0 * BAR_MS,
            bpm: BPM,
            phrases: 1,
            bars,
            kind: kind_for(index, local_h, rng),
            key,
            prev_key,
            next_key: key,
            notes_reason,
            home_reason,
            tempo_reason: None,
            flow: 0.0,
            progression: rng.below(5, bank.len() as u32) as u8,
            bars_per_chord: if activity < 0.35 { 2 } else { 1 },
            activity,
            tension,
            brightness: b,
            daypart: Daypart::at(local_h * 3600.0),
            rng,
        });
    }
    let home = Key::new(i32::from(Key::HOME_COLLECTION), key.rung);
    for i in 0..sections.len() {
        sections[i].next_key = sections.get(i + 1).map_or(home, |s| s.key);
    }
    let end = anchor + day_ms;
    // The night: the longest pause in rail service. The last train runs
    // just before it, the next morning's first just after, which on a
    // weekend can be after the day's 5 AM end: look a few hours past it.
    let rail = schedule.rail_between(anchor, end + 4.0 * 3_600_000.0);
    let (mut last_train, mut first_train, mut gap) = (f64::NAN, f64::NAN, 0.0);
    for w in rail.windows(2) {
        if w[1].ms - w[0].ms > gap {
            gap = w[1].ms - w[0].ms;
            last_train = w[0].ms;
            first_train = w[1].ms;
        }
    }
    if gap < 90.0 * 60_000.0 {
        (last_train, first_train) = (f64::NAN, f64::NAN);
    }
    DayRun {
        date,
        t0,
        anchor,
        piece0,
        chain: Chain {
            date,
            anchor_ms: piece0,
            end_ms: piece0 + f64::from(BARS) * BAR_MS,
            sections,
        },
        per_bar_ms,
        first_train,
        last_train,
        first_ski: schedule
            .ski_between(anchor, end)
            .first()
            .map_or(f64::NAN, |e| e.ms),
        sunrise: sun_crossing(anchor, anchor + 12.0 * 3_600_000.0, true),
        sunset: sun_crossing(anchor + 6.0 * 3_600_000.0, end, false),
    }
}

/// Compose bar `bar` of a day section: its slice of the day summed into
/// densities.
pub fn compose_day(
    sec: &Section,
    bar: u32,
    run: &DayRun,
    valley: &Valley<'_>,
    state: &mut ComposeState,
    out: &mut Bar,
) {
    let start = sec.start_ms + f64::from(bar) * BAR_MS;
    let step_ms = BAR_MS / 16.0;
    let beat_ms = BAR_MS / 4.0;
    let d0 = run.day_at(start);
    let d1 = d0 + run.per_bar_ms;
    let key = sec.key;
    let rng = sec.rng.stream(u64::from(bar) + 1);
    let piece_bar = sec.index * 8 + bar;

    out.bar = bar;
    out.start_ms = start;
    out.bar_ms = BAR_MS;
    out.notes.clear();
    out.harmony.clear();
    out.features.clear();
    out.mix = mix_for(sec, 0);
    let mix = out.mix;
    if bar == 0 {
        *state = ComposeState::default();
        // The phrase's time of day carries the harmony's move.
        out.features.push(Feature {
            at_ms: start,
            kind: FeatureKind::Boundary,
            route: 0,
            stop: 0,
            event_ms: d0,
            late_s: 0,
            observed: false,
            value: moment::CLOCK,
        });
    }

    // Harmony, as the live piece makes it.
    let chord = chord_for(sec, bar, valley, &BarCtx::plain(sec));
    let pad = voicing::voice(chord, &state.voicing);
    state.voicing = pad;
    let (tones, n_tones) = chord.pitch_classes();
    let root = chord.root_pc();
    let bass = at_or_above(root, 33);
    out.harmony.push(Harmony {
        at_ms: start,
        chord,
        pad,
        bass,
        pedal: at_or_above(key.tonic_pc(), 28),
        tones,
        n_tones: n_tones as u8,
    });
    let tone = |i: usize| tones[i % n_tones.max(1)];
    let note = |at_ms: f64, inst: Inst, midi: i32, vel: f32, dur_ms: f64| Note {
        at_ms,
        inst,
        midi: midi as f32,
        vel,
        dur_ms: dur_ms as f32,
        variant: 0,
        lat: f32::NAN,
        lon: f32::NAN,
        feature: NO_FEATURE,
    };

    // The theme opens first light.
    if sec.index == 0 && bar == 0 {
        out.features.push(Feature {
            at_ms: start,
            kind: FeatureKind::Theme,
            route: 0,
            stop: 0,
            event_ms: d0,
            late_s: 0,
            observed: false,
            value: 0.0,
        });
        let f = (out.features.len() - 1) as u16;
        for (i, n) in theme::notes(key).iter().enumerate() {
            out.notes.push(Note {
                variant: n.summit as u8,
                feature: if i == 0 { f } else { NO_FEATURE },
                ..note(
                    start + f64::from(n.beat) * beat_ms,
                    Inst::Piano,
                    n.midi,
                    n.velocity,
                    f64::from(n.beats) * beat_ms * 1.3,
                )
            });
        }
    }

    let activity = valley.schedule.mean_activity(d0, d1);
    // Bass.
    if mix.bass > 0.0 && activity > 0.02 {
        out.notes.push(note(
            start,
            Inst::Bass,
            bass,
            0.68,
            BAR_MS * if activity > 0.5 { 0.48 } else { 0.95 },
        ));
        if activity > 0.5 {
            out.notes.push(note(
                start + 2.0 * beat_ms,
                Inst::Bass,
                at_or_above(tone(2), bass),
                0.55,
                BAR_MS * 0.46,
            ));
        }
    }

    // The kit: the slice's activity sets the backbone, its buses the hats.
    if mix.kit > 0.0 && activity > 0.05 {
        let full = matches!(sec.kind, SectionKind::Groove | SectionKind::Journey);
        let (kicks, snares): (&[u32], &[u32]) = if !full || activity < 0.15 {
            (&[0], &[])
        } else if activity < 0.4 {
            (&[0, 8], &[12])
        } else {
            (&[0, 8, 10], &[4, 12])
        };
        for &s in kicks {
            out.notes.push(note(
                start + f64::from(s) * step_ms,
                Inst::Kick,
                36,
                if s == 0 { 0.78 } else { 0.6 },
                300.0,
            ));
        }
        for &s in snares {
            out.notes.push(note(
                start + f64::from(s) * step_ms,
                Inst::Snare,
                38,
                0.55,
                250.0,
            ));
        }
        let rate = valley.schedule.bus_rate((d0 + d1) * 0.5);
        let k = ((rate / 240.0).min(1.2) * 11.0).round() as u32;
        let pattern = euclid(k.min(13), 16, piece_bar % 4);
        let hat = if sec.kind == SectionKind::Atmosphere {
            Inst::Shaker
        } else {
            Inst::Hat
        };
        for s in 0..16u32 {
            if pattern & (1 << s) != 0 {
                out.notes.push(note(
                    start + f64::from(s) * step_ms,
                    hat,
                    42,
                    if s % 4 == 0 { 0.48 } else { 0.3 },
                    60.0,
                ));
            }
        }
    }

    // Rail: each line's departures in the slice ring as a Euclidean figure
    // on its chord tone; FrontRunner at Central blows the horn.
    let rail = valley.schedule.rail_between(d0, d1);
    if mix.rail > 0.0 && !rail.is_empty() {
        let mut lines: [Vec<usize>; 4] = Default::default();
        let mut horn_at = None;
        for (i, ev) in rail.iter().enumerate() {
            match valley.network.kind(ev.route) {
                RouteKind::Trax(l) => lines[usize::from(l.min(2))].push(i),
                RouteKind::SLine => lines[3].push(i),
                RouteKind::FrontRunner
                    if Some(ev.stop) == valley.network.slc_central && horn_at.is_none() =>
                {
                    horn_at = Some(i)
                }
                _ => {}
            }
        }
        let mut bells = 0;
        for (line, deps) in lines.iter().enumerate() {
            if deps.is_empty() {
                continue;
            }
            let k = ((deps.len() as f32).sqrt().round() as u32).clamp(1, 4);
            let pattern = euclid(k, 16, (line as u32 * 3 + piece_bar) % 16);
            let idx = [0, 2, 1, 3][line];
            let pc = if idx < n_tones {
                tones[idx]
            } else {
                key.scale()[(usize::from(chord.degree) + 1) % 7]
            };
            let mut j = 0;
            for s in 0..16u32 {
                if pattern & (1 << s) == 0 || bells >= 8 {
                    continue;
                }
                let ev = rail[deps[j * deps.len() / k as usize]];
                let stop = valley
                    .network
                    .stops
                    .get(usize::from(ev.stop))
                    .copied()
                    .unwrap_or_default();
                out.notes.push(Note {
                    variant: line.min(3) as u8,
                    lat: stop.lat,
                    lon: stop.lon,
                    ..note(
                        start + f64::from(s) * step_ms,
                        Inst::Bell,
                        at_or_above(pc, 72),
                        0.42 + 0.1 * rng.unit(u64::from(s)),
                        1600.0,
                    )
                });
                j += 1;
                bells += 1;
            }
        }
        if let Some(i) = horn_at.filter(|_| piece_bar.is_multiple_of(2)) {
            let ev = rail[i];
            let stop = valley
                .network
                .stops
                .get(usize::from(ev.stop))
                .copied()
                .unwrap_or_default();
            horn(
                key,
                chord,
                start,
                beat_ms,
                stop.lat,
                stop.lon,
                NO_FEATURE,
                &mut out.notes,
            );
        }
    }

    // Ski buses: a tom in the canyon's echo, up the canyon the slice's first
    // one climbs.
    if let Some(ev) = valley.schedule.ski_between(d0, d1).first() {
        let (lat, lon) = valley.network.kind(ev.route).canyon_point();
        out.notes.push(Note {
            variant: 1,
            lat,
            lon,
            ..note(start + 8.0 * step_ms, Inst::Tom, 45, 0.5, 400.0)
        });
    }

    // Quakes whose origin falls in the slice.
    let lo = valley.quakes.partition_point(|q| q.origin_ms < d0);
    if let Some(q) = valley.quakes[lo..].iter().find(|q| q.origin_ms < d1) {
        out.features.push(Feature {
            at_ms: start,
            kind: FeatureKind::Quake,
            route: 0,
            stop: 0,
            event_ms: q.origin_ms,
            late_s: 0,
            observed: false,
            value: q.mag,
        });
        let f = (out.features.len() - 1) as u16;
        out.notes.push(Note {
            lat: q.lat,
            lon: q.lon,
            feature: f,
            variant: if chord.is_minor() { 0 } else { 1 },
            ..note(
                start,
                Inst::QuakeBell,
                at_or_above(root, 48),
                (0.25 + 0.18 * q.mag).clamp(0.2, 0.9),
                6000.0,
            )
        });
    }

    // Snow on the hour this slice stands for.
    let hour = valley.sky.at_or_default(d0);
    let snowing = hour.mtn_snow_cm.max(hour.snow_cm);
    if mix.grains > 0.0 && snowing > 0.0 {
        for g in 0..((snowing * 3.0).ceil() as u32).min(4) {
            let pc = tone(rng.below(200 + u64::from(g), 4) as usize);
            out.notes.push(Note {
                variant: u8::from(valley.slow.powder > 0.5),
                ..note(
                    start + f64::from(rng.below(100 + u64::from(g), 16)) * step_ms,
                    Inst::Grain,
                    at_or_above(pc, 84),
                    0.35,
                    1000.0,
                )
            });
        }
    }

    // The slice's moment, if it has one.
    let mut moment_at = |ms: f64, kind: FeatureKind, value: f32, route: u8, stop: u16| {
        if ms.is_finite() && ms >= d0 && ms < d1 {
            out.features.push(Feature {
                at_ms: start + beat_ms,
                kind,
                route,
                stop,
                event_ms: ms,
                late_s: 0,
                observed: false,
                value,
            });
        }
    };
    if let Some(e) = rail.iter().find(|e| e.ms == run.last_train) {
        moment_at(e.ms, FeatureKind::Trax, moment::LAST_TRAIN, e.route, e.stop);
    }
    if let Some(e) = rail.iter().find(|e| e.ms == run.first_train) {
        moment_at(
            e.ms,
            FeatureKind::Trax,
            moment::FIRST_TRAIN,
            e.route,
            e.stop,
        );
    }
    moment_at(run.sunrise, FeatureKind::Sky, moment::SUNRISE, 0, 0);
    moment_at(run.sunset, FeatureKind::Sky, moment::SUNSET, 0, 0);
    if let Some(e) = valley
        .schedule
        .ski_between(d0, d1)
        .first()
        .filter(|e| e.ms == run.first_ski)
    {
        moment_at(e.ms, FeatureKind::SkiBus, moment::FIRST_SKI, e.route, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compose::{Slow, Valley};
    use crate::plan::Sky;
    use crate::schedule::{Network, Schedule, ServiceDay, Stop};

    fn valley_parts() -> (Schedule, Network) {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0;
        // Rail every 5 minutes on two lines from 05:00 to 24:00; buses ramp.
        let mut rail = Vec::new();
        // Trains from 05:00 to midnight, then the next morning from 04:40.
        for m in (300..1440).step_by(5).chain((1720..1780).step_by(5)) {
            rail.push((m * 60, (m % 2) | (3 << 16)));
        }
        let bus: Vec<u16> = (0..1800)
            .map(|m| match m / 60 {
                0..=4 => 10,
                5..=6 => 120,
                7..=18 => 230,
                19..=22 => 140,
                _ => 30,
            })
            .collect();
        let day = ServiceDay {
            date: 20261023,
            t0_ms: t0,
            rail,
            ski: vec![(7 * 3600, 5)],
            bus_west: bus.iter().map(|b| b / 2).collect(),
            bus,
        };
        let mut s = Schedule::default();
        s.insert(day);
        let network = Network {
            routes: vec![
                RouteKind::Trax(0),
                RouteKind::Trax(1),
                RouteKind::Trax(2),
                RouteKind::SLine,
                RouteKind::FrontRunner,
                RouteKind::Ski(0),
            ],
            stops: (0..8)
                .map(|i| Stop {
                    lat: 40.7 + i as f32 * 0.01,
                    lon: -111.9,
                })
                .collect(),
            slc_central: Some(2),
        };
        (s, network)
    }

    fn t0() -> f64 {
        (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0
    }

    #[test]
    fn twelve_minutes_three_hundred_bars_one_move_per_phrase() {
        let (s, _) = valley_parts();
        let run = plan_day(20261023, t0(), 1.0e12, &s, &Sky::default());
        let secs = &run.chain.sections;
        assert_eq!(secs.len(), 38);
        assert_eq!(secs.iter().map(|x| u32::from(x.bars)).sum::<u32>(), BARS);
        assert!((run.end() - run.piece0 - 720_000.0).abs() < 1e-6);
        for w in secs.windows(2) {
            assert!((w[1].start_ms - w[0].end_ms()).abs() < 1e-6);
            assert!(
                w[1].key.notes_changed(w[0].key) <= 1,
                "{:?} → {:?}",
                w[0].key,
                w[1].key
            );
            assert!(
                w[1].key != w[0].key || w[1].home_reason.is_some() || w[1].notes_reason.is_some()
            );
        }
        assert_eq!(secs[0].kind, SectionKind::Theme);
        // The 120× clock: bar 0 is 05:00, the last bar 04:55 the next morning.
        assert!((run.day_at(run.piece0) - run.anchor).abs() < 1e-6);
        assert!((run.day_at(run.end()) - run.anchor - 86_400_000.0).abs() < 1e-3);
    }

    #[test]
    fn the_night_the_clocks_fall_back_is_twenty_five_hours_in_twelve_minutes() {
        let day = |date, t0_ms| ServiceDay {
            date,
            t0_ms,
            rail: vec![],
            ski: vec![],
            bus: vec![50; 1800],
            bus_west: vec![25; 1800],
        };
        let mut s = Schedule::default();
        s.insert(day(20261031, t0()));
        s.insert(day(20261101, t0() + 25.0 * 3_600_000.0));
        let run = plan_day(20261031, t0(), 1.0e12, &s, &Sky::default());
        // 05:00 MDT to 05:00 MST, still 300 bars.
        assert!((run.day_at(run.end()) - run.anchor - 25.0 * 3_600_000.0).abs() < 1e-3);
        assert!((run.per_bar_ms - 300_000.0).abs() < 1e-6);
        assert!((run.speed() - 125.0).abs() < 1e-9);
        // Without the next day, it's taken as 24 hours.
        let mut alone = Schedule::default();
        alone.insert(day(20261031, t0()));
        let run = plan_day(20261031, t0(), 1.0e12, &alone, &Sky::default());
        assert!((run.speed() - SPEED).abs() < 1e-9);
    }

    #[test]
    fn a_weekend_night_ends_with_the_next_days_first_train() {
        // Saturday: trains to 01:00, and Sunday's first after 06:30, past the
        // day's 05:00 end, in Sunday's own service day.
        let sat: Vec<(u32, u32)> = (300..1500).step_by(5).map(|m| (m * 60, m % 2)).collect();
        let sun: Vec<(u32, u32)> = (390..600).step_by(5).map(|m| (m * 60, m % 2)).collect();
        let day = |date, t0_ms, rail| ServiceDay {
            date,
            t0_ms,
            rail,
            ski: vec![],
            bus: vec![50; 1800],
            bus_west: vec![25; 1800],
        };
        let mut s = Schedule::default();
        s.insert(day(20261024, t0(), sat));
        s.insert(day(20261025, t0() + 86_400_000.0, sun));
        let run = plan_day(20261024, t0(), 1.0e12, &s, &Sky::default());
        let one_am = t0() + 25.0 * 3_600_000.0 - 5.0 * 60_000.0;
        assert!(
            (run.last_train - one_am).abs() < 120_000.0,
            "last train {}",
            (run.last_train - t0()) / 3.6e6
        );
        assert!(run.first_train > run.anchor + 86_400_000.0);
    }

    #[test]
    fn bars_sum_the_day_and_feature_its_moments() {
        let (s, n) = valley_parts();
        let sky = Sky::default();
        let slow = Slow {
            season: 1.0,
            ..Slow::default()
        };
        let valley = Valley::quiet(&s, &n, &sky, &slow);
        let run = plan_day(20261023, t0(), 1.0e12, &s, &sky);
        let mut state = ComposeState::default();
        let mut out = Bar::default();
        let mut moments = Vec::new();
        let mut bells = 0;
        for sec in &run.chain.sections {
            for bar in 0..sec.bars() {
                compose_day(sec, bar, &run, &valley, &mut state, &mut out);
                for nt in &out.notes {
                    assert!(nt.at_ms >= out.start_ms - 1e-6);
                    assert!(nt.midi.is_finite());
                    let pc = (nt.midi as i32).rem_euclid(12) as u8;
                    if matches!(nt.inst, Inst::Bell | Inst::Bass) {
                        assert!(
                            sec.key.scale().contains(&pc),
                            "{:?} {} outside {:?}",
                            nt.inst,
                            nt.midi,
                            sec.key
                        );
                    }
                }
                bells += out.notes.iter().filter(|x| x.inst == Inst::Bell).count();
                moments.extend(
                    out.features
                        .iter()
                        .filter(|f| f.value != moment::CLOCK)
                        .map(|f| f.value),
                );
            }
        }
        // A train every five minutes is about one per 4.8-minute bar, from
        // 05:00 to midnight: 237 bars of bells.
        assert!(bells >= 200, "{bells} bells all day");
        assert!(moments.contains(&moment::FIRST_TRAIN));
        assert!(moments.contains(&moment::LAST_TRAIN));
        assert!(moments.contains(&moment::SUNRISE));
        assert!(moments.contains(&moment::SUNSET));
        assert!(moments.contains(&moment::FIRST_SKI));
    }
}
