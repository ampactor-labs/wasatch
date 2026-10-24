//! A bar of music from a section and the valley.
//!
//! `compose` is the pure function at the heart of the piece: a section, a bar
//! index and the valley's data in, notes, harmony changes and captions out.
//! Every phone composes the same bar from the same inputs. The only state it
//! carries is the pad's last voicing, which resets at each section's first
//! bar, so a phone that joins mid-section replays from that bar.

use crate::music::{
    Chord, Color, Key, Mode, approach_degree, deceptive_degree, pivot, progressions,
};
use crate::plan::{Daypart, Section, SectionKind, Sky};
use crate::schedule::{Network, RouteKind, Schedule};
use crate::theme;
use crate::voicing::{self, Voicing};

/// The lake's ceiling: the share of cadences left unresolved below the
/// Strike Team's transitional range.
pub const LAKE_CEILING: f32 = 2.0 / 3.0;

/// Share of cadences the lake leaves unresolved at `lake_ft`: none in the
/// optimal range (4,198 ft and up), the ceiling below the transitional range
/// (4,195 ft), and a straight line between.
pub fn lake_share(lake_ft: f32) -> f32 {
    if !lake_ft.is_finite() {
        return LAKE_CEILING;
    }
    if lake_ft >= 4198.0 {
        0.0
    } else if lake_ft <= 4195.0 {
        LAKE_CEILING
    } else {
        LAKE_CEILING * (4198.0 - lake_ft) / 3.0
    }
}

/// Instruments the engine plays.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum Inst {
    /// The sampled grand: the theme.
    Piano = 0,
    /// A TRAX bell (variant = line).
    Bell = 1,
    /// One note of FrontRunner's horn chord.
    Horn = 2,
    /// Marimba: a bike.
    Marimba = 3,
    /// A snow grain (variant 1 = light powder).
    Grain = 4,
    /// A quake's chord bell.
    QuakeBell = 5,
    /// Kick.
    Kick = 6,
    /// Brushed snare.
    Snare = 7,
    /// Rim click.
    Rim = 8,
    /// Hi-hat.
    Hat = 9,
    /// Shaker.
    Shaker = 10,
    /// Tom (variant 1 = in the canyon's echo).
    Tom = 11,
    /// Soft crash.
    Crash = 12,
    /// A harp string, excited by a gust.
    Harp = 13,
    /// Bass.
    Bass = 14,
}

/// Families, for the mix and the vantage.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum Family {
    /// The kit.
    Kit = 0,
    /// Rail: bells and the horn.
    Rail = 1,
    /// Piano and pad.
    Harmony = 2,
    /// Bass and the lake.
    Low = 3,
    /// Bikes.
    Bikes = 4,
    /// Wind and snow.
    Weather = 5,
    /// The ground and quakes.
    Ground = 6,
}

/// No feature.
pub const NO_FEATURE: u16 = u16::MAX;

/// A note to play.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Note {
    /// Onset, listening-time UTC ms.
    pub at_ms: f64,
    /// Instrument.
    pub inst: Inst,
    /// Pitch.
    pub midi: f32,
    /// Velocity, 0–1.
    pub vel: f32,
    /// Length, ms.
    pub dur_ms: f32,
    /// Instrument variant.
    pub variant: u8,
    /// Where it happens (NaN for nowhere in particular).
    pub lat: f32,
    /// Where it happens.
    pub lon: f32,
    /// Index into the bar's features, or [`NO_FEATURE`].
    pub feature: u16,
}

/// A harmony change.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Harmony {
    /// When, listening-time UTC ms.
    pub at_ms: f64,
    /// The chord.
    pub chord: Chord,
    /// Pad voicing.
    pub pad: Voicing,
    /// Bass root.
    pub bass: i32,
    /// The lake's pedal: the key's tonic, low.
    pub pedal: i32,
    /// Chord tones as pitch classes.
    pub tones: [u8; 4],
    /// How many tones.
    pub n_tones: u8,
}

/// What a caption is about.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum FeatureKind {
    /// A TRAX or S-Line train leaving a station.
    Trax = 0,
    /// FrontRunner at Salt Lake Central.
    FrontRunner = 1,
    /// A ski bus heading up the canyon.
    SkiBus = 2,
    /// A GREENbike dock change.
    Bike = 3,
    /// An earthquake.
    Quake = 4,
    /// The theme.
    Theme = 5,
    /// The lake.
    Lake = 6,
    /// The ground.
    Ground = 7,
    /// The wind.
    Wind = 8,
    /// Snow.
    Snow = 9,
    /// The sky.
    Sky = 10,
    /// A section boundary: the harmony moved.
    Boundary = 11,
}

/// A captioned moment.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Feature {
    /// When it sounds, listening-time UTC ms.
    pub at_ms: f64,
    /// What.
    pub kind: FeatureKind,
    /// Route index (rail), or 0.
    pub route: u8,
    /// Stop or station index, or 0.
    pub stop: u16,
    /// When the real event happened, UTC ms.
    pub event_ms: f64,
    /// Lateness in seconds (0 on the schedule).
    pub late_s: i16,
    /// `true` when realtime saw it happen.
    pub observed: bool,
    /// A value for the caption (magnitude, inches, mph…).
    pub value: f32,
}

/// Levels per family this bar, 0–1.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct Mix {
    /// Kit.
    pub kit: f32,
    /// Rail.
    pub rail: f32,
    /// Pad.
    pub pad: f32,
    /// Piano.
    pub piano: f32,
    /// Bass.
    pub bass: f32,
    /// The lake's pedal.
    pub lake: f32,
    /// Harp and wind.
    pub harp: f32,
    /// The ground voice.
    pub ground: f32,
    /// Snow grains.
    pub grains: f32,
    /// Bikes.
    pub bikes: f32,
}

/// A GREENbike dock change.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct BikeEvent {
    /// When it sounds, listening-time UTC ms.
    pub ms: f64,
    /// Station latitude.
    pub lat: f32,
    /// Station longitude.
    pub lon: f32,
    /// +1 a bike back, −1 a bike out.
    pub delta: i8,
    /// Station index.
    pub station: u16,
}

/// An earthquake from the catalog.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct QuakeEvent {
    /// When it sounds, listening-time UTC ms.
    pub ms: f64,
    /// Origin time, UTC ms.
    pub origin_ms: f64,
    /// Magnitude.
    pub mag: f32,
    /// Epicenter.
    pub lat: f32,
    /// Epicenter.
    pub lon: f32,
}

/// Slow values: the valley state that changes over hours.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Slow {
    /// Great Salt Lake elevation, ft.
    pub lake_ft: f32,
    /// The lake's level against its daily mean, ft (the seiche).
    pub lake_dev_ft: f32,
    /// River flow against the usual for the date, 0–1.
    pub river: f32,
    /// Snowpack against median (1 = median).
    pub snowpack: f32,
    /// Overnight new snow, inches.
    pub new_snow_in: f32,
    /// New-snow lightness, 0 heavy – 1 light powder.
    pub powder: f32,
    /// Winter, 0–1.
    pub season: f32,
    /// The ground's four band levels, 0–1.
    pub ground: [f32; 4],
}

impl Default for Slow {
    fn default() -> Self {
        Slow {
            lake_ft: 4189.8,
            lake_dev_ft: 0.0,
            river: 0.5,
            snowpack: 1.0,
            new_snow_in: 0.0,
            powder: 0.5,
            season: 0.0,
            ground: [0.0; 4],
        }
    }
}

/// Everything a bar reads besides its section.
pub struct Valley<'a> {
    /// The schedule.
    pub schedule: &'a Schedule,
    /// Routes and stops.
    pub network: &'a Network,
    /// The sky.
    pub sky: &'a Sky,
    /// Slow values.
    pub slow: &'a Slow,
    /// Bike events, by time.
    pub bikes: &'a [BikeEvent],
    /// Quakes, by time.
    pub quakes: &'a [QuakeEvent],
}

/// The composer's carried state: the pad's last voicing and a few flags.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct ComposeState {
    pub(crate) voicing: Voicing,
    pub(crate) phrase_featured: bool,
    pub(crate) fill_pending: bool,
    pub(crate) last_quake_ms: f64,
}

/// One composed bar.
#[derive(Clone, Debug, Default)]
pub struct Bar {
    /// Bar index in the section.
    pub bar: u32,
    /// Start, listening-time UTC ms.
    pub start_ms: f64,
    /// Length, ms.
    pub bar_ms: f64,
    /// Notes, by onset.
    pub notes: Vec<Note>,
    /// Harmony changes, by time.
    pub harmony: Vec<Harmony>,
    /// Captioned moments.
    pub features: Vec<Feature>,
    /// Family levels.
    pub mix: Mix,
}

/// k onsets spread as evenly as possible over n steps (a Euclidean rhythm,
/// Toussaint 2005), rotated by `rot`.
pub fn euclid(k: u32, n: u32, rot: u32) -> u32 {
    let mut bits = 0u32;
    if k == 0 || n == 0 {
        return 0;
    }
    for i in 0..n {
        if (i * k) % n < k {
            bits |= 1 << ((i + rot) % n);
        }
    }
    bits
}

/// The family levels for a bar.
pub(crate) fn mix_for(sec: &Section, phrase: u32) -> Mix {
    let night = sec.daypart == Daypart::Nocturne;
    let mut m = match sec.kind {
        SectionKind::Theme => Mix {
            kit: if phrase >= 2 { 0.45 } else { 0.0 },
            rail: if phrase >= 1 { 0.55 } else { 0.0 },
            pad: 0.8,
            piano: 1.0,
            bass: if phrase >= 1 { 0.6 } else { 0.0 },
            lake: 0.6,
            harp: 0.6,
            ground: 0.6,
            grains: 0.7,
            bikes: 0.6,
        },
        SectionKind::Groove => Mix {
            kit: 1.0,
            rail: 0.9,
            pad: 0.6,
            piano: 0.0,
            bass: 1.0,
            lake: 0.4,
            harp: 0.3,
            ground: 0.4,
            grains: 0.5,
            bikes: 0.9,
        },
        SectionKind::Atmosphere => Mix {
            kit: 0.25,
            rail: 0.45,
            pad: 1.0,
            piano: 0.0,
            bass: 0.5,
            lake: 0.6,
            harp: 1.0,
            ground: 0.9,
            grains: 1.0,
            bikes: 0.5,
        },
        SectionKind::Journey => Mix {
            kit: 0.85,
            rail: 0.85,
            pad: 0.85,
            piano: 0.5,
            bass: 0.9,
            lake: 0.6,
            harp: 0.7,
            ground: 0.7,
            grains: 0.8,
            bikes: 0.8,
        },
        SectionKind::Lake => Mix {
            kit: 0.0,
            rail: 0.25,
            pad: 0.6,
            piano: 0.0,
            bass: 0.3,
            lake: 1.0,
            harp: 0.7,
            ground: 0.9,
            grains: 0.6,
            bikes: 0.3,
        },
    };
    if night {
        m.kit *= 0.5;
        m.ground = (m.ground + 0.2).min(1.0);
    }
    m
}

/// Lowest MIDI note of pitch class `pc` at or above `floor`.
pub(crate) fn at_or_above(pc: u8, floor: i32) -> i32 {
    floor + (i32::from(pc) - floor).rem_euclid(12)
}

/// The chord on a bar (and the chord's color).
pub(crate) fn chord_for(sec: &Section, bar: u32, valley: &Valley<'_>) -> Chord {
    let key = sec.key;
    let mode = key.mode();
    let phrase = bar / 8;
    let bip = bar % 8;
    let bars = sec.bars();
    let phrase_len = (bars - phrase * 8).min(8);
    let last_bar = bar + 1 == bars;
    let bank = progressions(mode);
    let prog = bank[usize::from(sec.progression) % bank.len()];

    let theme_bar = sec.kind == SectionKind::Theme && (1..=2).contains(&phrase) && bip < 4;
    let snowy = valley.slow.snowpack > 1.05 || sec.kind == SectionKind::Atmosphere;

    if theme_bar {
        return Chord::new(key, theme::HARMONY[bip as usize], Color::Triad);
    }
    if phrase_len >= 4 && bip + 2 == phrase_len {
        let color = if sec.tension > 0.4 {
            Color::Seventh
        } else {
            Color::Triad
        };
        return Chord::new(key, approach_degree(mode), color);
    }
    if phrase_len >= 4 && bip + 1 == phrase_len {
        if last_bar && sec.next_key != key {
            let deg = pivot(key, sec.next_key).unwrap_or(0);
            return Chord::new(key, deg, Color::Triad);
        }
        let share = lake_share(valley.slow.lake_ft);
        let unresolved = sec.rng.stream(0x1A4E).chance(u64::from(phrase), share)
            || (sec.kind == SectionKind::Lake && share > 0.0);
        if unresolved {
            let dec = deceptive_degree(mode);
            if prog.contains(&dec) {
                return Chord::new(key, 0, Color::Sus2);
            }
            return Chord::new(key, dec, Color::Triad);
        }
        let color = if snowy { Color::Add9 } else { Color::Triad };
        return Chord::new(key, 0, color);
    }
    let idx = (bip / u32::from(sec.bars_per_chord.max(1))) as usize % prog.len();
    let deg = prog[idx];
    let color = if snowy && deg == 0 {
        Color::Add9
    } else if sec.rng.stream(0xC0).chance(u64::from(bar), 0.18) && !matches!(mode, Mode::Lydian) {
        Color::Seventh
    } else {
        Color::Triad
    };
    Chord::new(key, deg, color)
}

/// Compose bar `bar` of `sec` into `out`.
pub fn compose(
    sec: &Section,
    bar: u32,
    valley: &Valley<'_>,
    state: &mut ComposeState,
    out: &mut Bar,
) {
    let bar_ms = sec.bar_ms();
    let start = sec.start_ms + f64::from(bar) * bar_ms;
    let step_ms = bar_ms / 16.0;
    let beat_ms = bar_ms / 4.0;
    let phrase = bar / 8;
    let bip = bar % 8;
    let rng = sec.rng.stream(u64::from(bar) + 1);
    let key = sec.key;

    out.bar = bar;
    out.start_ms = start;
    out.bar_ms = bar_ms;
    out.notes.clear();
    out.harmony.clear();
    out.features.clear();
    out.mix = mix_for(sec, phrase);
    let mix = out.mix;

    if bar == 0 {
        *state = ComposeState {
            last_quake_ms: state.last_quake_ms,
            ..ComposeState::default()
        };
    }
    if bip == 0 {
        state.phrase_featured = false;
    }

    // A section's first bar is a boundary: caption the harmony's move.
    if bar == 0 {
        out.features.push(Feature {
            at_ms: start,
            kind: FeatureKind::Boundary,
            route: 0,
            stop: 0,
            event_ms: start,
            late_s: 0,
            observed: false,
            value: 0.0,
        });
    }

    // Harmony.
    let chord = chord_for(sec, bar, valley);
    let pad = voicing::voice(chord, &state.voicing);
    state.voicing = pad;
    let (tones, n_tones) = chord.pitch_classes();
    let root = chord.root_pc();
    let bass = at_or_above(root, 33);
    let pedal = at_or_above(key.tonic_pc(), 28);
    out.harmony.push(Harmony {
        at_ms: start,
        chord,
        pad,
        bass,
        pedal,
        tones,
        n_tones: n_tones as u8,
    });
    let tone = |i: usize| tones[i % n_tones.max(1)];

    let activity = sec.activity;
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

    // Bass.
    if mix.bass > 0.0 {
        let walking = valley.slow.river > 0.6 && activity > 0.3;
        if walking {
            for beat in 0..4u32 {
                let deg_off = [0, 2, 4, 5][beat as usize];
                let pc = key.scale()[(usize::from(chord.degree) + deg_off) % 7];
                out.notes.push(note(
                    start + f64::from(beat) * beat_ms,
                    Inst::Bass,
                    at_or_above(pc, 33),
                    0.62,
                    beat_ms * 0.92,
                ));
            }
        } else {
            out.notes.push(note(
                start,
                Inst::Bass,
                bass,
                0.7,
                bar_ms * if activity > 0.5 { 0.48 } else { 0.95 },
            ));
            if activity > 0.5 {
                let fifth = at_or_above(tone(2), bass);
                out.notes.push(note(
                    start + 2.0 * beat_ms,
                    Inst::Bass,
                    fifth,
                    0.55,
                    bar_ms * 0.46,
                ));
            }
        }
    }

    // The kit: a composed backbone, transit's density on top.
    let kit_on = mix.kit > 0.0 && activity > 0.06;
    if kit_on {
        let full = matches!(sec.kind, SectionKind::Groove | SectionKind::Journey);
        let (kicks, snares, rims): (&[u32], &[u32], &[u32]) = if !full {
            (&[], &[], &[12])
        } else if activity < 0.15 {
            (&[0], &[], &[12])
        } else if activity < 0.4 {
            (&[0, 8], &[], &[12])
        } else if activity < 0.75 {
            (&[0, 8, 10], &[4, 12], &[])
        } else {
            (&[0, 3, 8, 10], &[4, 12], &[14])
        };
        for &s in kicks {
            out.notes.push(note(
                start + f64::from(s) * step_ms,
                Inst::Kick,
                36,
                if s == 0 { 0.8 } else { 0.62 },
                300.0,
            ));
        }
        for &s in snares {
            out.notes.push(note(
                start + f64::from(s) * step_ms,
                Inst::Snare,
                38,
                0.6,
                250.0,
            ));
        }
        for &s in rims {
            out.notes.push(note(
                start + f64::from(s) * step_ms,
                Inst::Rim,
                37,
                0.45,
                120.0,
            ));
        }
        if sec.kind != SectionKind::Atmosphere {
            // Hats from the bus rate.
            let rate = valley.schedule.bus_rate(start + bar_ms * 0.5);
            let a = (rate / 240.0).min(1.2);
            let ks = [0u32, 3, 5, 7, 9, 11, 13];
            let k = ks[((a * 6.0).round() as usize).min(6)];
            let pattern = euclid(k, 16, phrase % 4);
            let swing = if activity > 0.75 { 0.12 } else { 0.05 } * step_ms;
            for s in 0..16u32 {
                if pattern & (1 << s) != 0 {
                    let off = if s % 2 == 1 { swing } else { 0.0 };
                    let vel = if s % 4 == 0 { 0.5 } else { 0.32 };
                    out.notes.push(note(
                        start + f64::from(s) * step_ms + off,
                        Inst::Hat,
                        42,
                        vel,
                        60.0,
                    ));
                }
            }
        } else {
            let pattern = euclid(5, 16, bar % 3);
            for s in 0..16u32 {
                if pattern & (1 << s) != 0 {
                    out.notes.push(note(
                        start + f64::from(s) * step_ms,
                        Inst::Shaker,
                        70,
                        0.3,
                        80.0,
                    ));
                }
            }
        }
        // A fill into the next phrase when a section ends or a storm warning
        // is up; a crash on the downbeat after it.
        if state.fill_pending && bip == 0 {
            out.notes.push(note(start, Inst::Crash, 49, 0.42, 2400.0));
            state.fill_pending = false;
        }
        let storm = valley.sky.at_or_default(start).alert > 0.3;
        if bip == 7 && (bar + 1 == sec.bars() || storm) && full {
            for (i, s) in [12u32, 13, 14, 15].iter().enumerate() {
                out.notes.push(note(
                    start + f64::from(*s) * step_ms,
                    Inst::Tom,
                    [50, 47, 45, 43][i],
                    0.5,
                    260.0,
                ));
            }
            state.fill_pending = true;
        }
    }

    // When the trains run late, the kit lays back with them: 1 ms behind the
    // beat for every 6 s of the system's median lateness, up to 30 ms.
    let kit_lay = f64::from((valley.schedule.system_late_s(start) / 6.0).clamp(0.0, 30.0));
    if kit_lay > 0.0 {
        for n in &mut out.notes {
            if matches!(
                n.inst,
                Inst::Kick | Inst::Snare | Inst::Rim | Inst::Hat | Inst::Shaker | Inst::Tom
            ) {
                n.at_ms += kit_lay;
            }
        }
    }

    // The theme, in Theme sections.
    if sec.kind == SectionKind::Theme && mix.piano > 0.0 {
        let statement = (1..=2).contains(&phrase) && bip == 0;
        let fragment = phrase >= 3 && bip == 4;
        if statement || fragment {
            let notes = theme::notes(key);
            let first = if fragment { 9 } else { 0 };
            for (i, n) in notes.iter().enumerate().skip(first) {
                let beat = if fragment {
                    n.beat - notes[first].beat
                } else {
                    n.beat
                };
                let at = start + f64::from(beat) * beat_ms;
                let midi = if phrase == 2 { n.midi + 12 } else { n.midi };
                let feature = if i == first && statement && phrase == 1 {
                    out.features.push(Feature {
                        at_ms: at,
                        kind: FeatureKind::Theme,
                        route: 0,
                        stop: 0,
                        event_ms: at,
                        late_s: 0,
                        observed: false,
                        value: 0.0,
                    });
                    state.phrase_featured = true;
                    (out.features.len() - 1) as u16
                } else {
                    NO_FEATURE
                };
                out.notes.push(Note {
                    variant: n.summit as u8,
                    feature,
                    ..note(
                        at,
                        Inst::Piano,
                        midi,
                        n.velocity,
                        f64::from(n.beats) * beat_ms * 1.4,
                    )
                });
            }
        }
    }

    // Rail: TRAX bells, FrontRunner's horn at Central.
    if mix.rail > 0.0 {
        let cap = if sec.kind == SectionKind::Atmosphere || sec.kind == SectionKind::Lake {
            1
        } else {
            3
        };
        let mut bells = 0;
        for ev in valley.schedule.performed_between(start, start + bar_ms) {
            let kind = valley.network.kind(ev.route);
            let stop = valley
                .network
                .stops
                .get(usize::from(ev.stop))
                .copied()
                .unwrap_or_default();
            let step = (((ev.ms - start) / step_ms).round() as u32).min(15);
            // A late train lays back: 1 ms behind the grid for every 3 s late,
            // up to 60 ms.
            let lay = f64::from(ev.late_s.clamp(0, 180)) / 3.0;
            let at = start + f64::from(step) * step_ms + lay;
            match kind {
                RouteKind::Trax(_) | RouteKind::SLine if bells < cap => {
                    let idx = match kind {
                        RouteKind::Trax(0) => 0, // Blue: the root
                        RouteKind::Trax(1) => 2, // Red: the fifth
                        RouteKind::Trax(_) => 1, // Green: the third
                        _ => 3,                  // S-Line: the color tone
                    };
                    let pc = if idx < n_tones {
                        tones[idx]
                    } else {
                        key.scale()[(usize::from(chord.degree) + 1) % 7]
                    };
                    let feature = if !state.phrase_featured || bells == 0 {
                        out.features.push(Feature {
                            at_ms: at,
                            kind: FeatureKind::Trax,
                            route: ev.route,
                            stop: ev.stop,
                            event_ms: ev.ms,
                            late_s: ev.late_s,
                            observed: ev.observed,
                            value: 0.0,
                        });
                        state.phrase_featured = true;
                        (out.features.len() - 1) as u16
                    } else {
                        NO_FEATURE
                    };
                    out.notes.push(Note {
                        variant: match kind {
                            RouteKind::Trax(l) => l,
                            _ => 3,
                        },
                        lat: stop.lat,
                        lon: stop.lon,
                        feature,
                        ..note(
                            at,
                            Inst::Bell,
                            at_or_above(pc, 72),
                            0.55 + 0.1 * rng.unit(u64::from(ev.stop)),
                            2200.0,
                        )
                    });
                    bells += 1;
                }
                RouteKind::FrontRunner if Some(ev.stop) == valley.network.slc_central => {
                    out.features.push(Feature {
                        at_ms: at,
                        kind: FeatureKind::FrontRunner,
                        route: ev.route,
                        stop: ev.stop,
                        event_ms: ev.ms,
                        late_s: ev.late_s,
                        observed: ev.observed,
                        value: 0.0,
                    });
                    state.phrase_featured = true;
                    let f = (out.features.len() - 1) as u16;
                    horn(
                        key,
                        chord,
                        at,
                        beat_ms,
                        stop.lat,
                        stop.lon,
                        f,
                        &mut out.notes,
                    );
                }
                _ => {}
            }
        }
        // Ski buses: canyon toms, in winter.
        if valley.slow.season > 0.3 {
            for ev in valley.schedule.ski_between(start, start + bar_ms) {
                let step = (((ev.ms - start) / step_ms).round() as u32).min(12);
                out.features.push(Feature {
                    at_ms: start + f64::from(step) * step_ms,
                    kind: FeatureKind::SkiBus,
                    route: ev.route,
                    stop: 0,
                    event_ms: ev.ms,
                    late_s: 0,
                    observed: false,
                    value: 0.0,
                });
                let f = (out.features.len() - 1) as u16;
                for (i, m) in [52, 50, 47, 45].iter().enumerate() {
                    out.notes.push(Note {
                        variant: 1,
                        lat: 40.57,
                        lon: -111.75,
                        feature: if i == 0 { f } else { NO_FEATURE },
                        ..note(
                            start + f64::from(step + i as u32) * step_ms,
                            Inst::Tom,
                            *m,
                            0.55,
                            600.0,
                        )
                    });
                }
            }
        }
    }

    // Bikes: marimba plucks on scale degrees picked by latitude.
    if mix.bikes > 0.0 {
        let lo = valley.bikes.partition_point(|b| b.ms < start);
        for (n, b) in valley.bikes[lo..]
            .iter()
            .take_while(|b| b.ms < start + bar_ms)
            .take(2)
            .enumerate()
        {
            let step = (((b.ms - start) / step_ms).round() as u32).min(15);
            let at = start + f64::from(step) * step_ms;
            let deg = (((b.lat - 40.70) / 0.10 * 7.0).round() as i32).clamp(0, 7);
            let tonic = key.tonic_at_or_above(72);
            let feature = if n == 0 && !state.phrase_featured {
                out.features.push(Feature {
                    at_ms: at,
                    kind: FeatureKind::Bike,
                    route: 0,
                    stop: b.station,
                    event_ms: b.ms,
                    late_s: 0,
                    observed: false,
                    value: f32::from(b.delta),
                });
                state.phrase_featured = true;
                (out.features.len() - 1) as u16
            } else {
                NO_FEATURE
            };
            out.notes.push(Note {
                lat: b.lat,
                lon: b.lon,
                feature,
                ..note(
                    at,
                    Inst::Marimba,
                    key.degree_to_midi(deg, tonic),
                    0.5,
                    900.0,
                )
            });
        }
    }

    // Quakes: a chord bell, at most one per 30 s.
    let lo = valley.quakes.partition_point(|q| q.ms < start);
    if let Some(q) = valley.quakes[lo..].iter().find(|q| q.ms < start + bar_ms)
        && q.ms - state.last_quake_ms > 30_000.0
    {
        state.last_quake_ms = q.ms;
        let step = (((q.ms - start) / step_ms).round() as u32).min(15);
        let at = start + f64::from(step) * step_ms;
        out.features.push(Feature {
            at_ms: at,
            kind: FeatureKind::Quake,
            route: 0,
            stop: 0,
            event_ms: q.origin_ms,
            late_s: 0,
            observed: false,
            value: q.mag,
        });
        state.phrase_featured = true;
        let f = (out.features.len() - 1) as u16;
        let vel = (0.25 + 0.18 * q.mag).clamp(0.2, 0.9);
        out.notes.push(Note {
            lat: q.lat,
            lon: q.lon,
            feature: f,
            variant: if chord.is_minor() { 0 } else { 1 },
            ..note(at, Inst::QuakeBell, at_or_above(root, 48), vel, 8000.0)
        });
    }

    // Snow grains while it snows in the mountains (or the valley).
    let hour = valley.sky.at_or_default(start);
    let snowing = hour.mtn_snow_cm.max(hour.snow_cm);
    if mix.grains > 0.0 && snowing > 0.0 {
        let count = ((snowing * 4.0).ceil() as u32).min(6);
        for g in 0..count {
            let step = rng.below(100 + u64::from(g), 16);
            let pc = tone(rng.below(200 + u64::from(g), 4) as usize);
            let midi = at_or_above(pc, 84 + 12 * rng.below(300 + u64::from(g), 2) as i32);
            out.notes.push(Note {
                variant: u8::from(valley.slow.powder > 0.5),
                ..note(
                    start + f64::from(step) * step_ms,
                    Inst::Grain,
                    midi,
                    0.3 + 0.2 * rng.unit(400 + u64::from(g)),
                    1200.0,
                )
            });
        }
    }

    // The harp: gusts pick a string by its shedding frequency.
    if mix.harp > 0.0 {
        let wind = hour.ridge_ms.max(0.0);
        let gust = hour.ridge_gust_ms.max(wind);
        let gusts: u32 = if gust < 2.0 {
            0
        } else if gust < 8.0 {
            1
        } else {
            2
        };
        for g in 0..gusts {
            if !rng.chance(500 + u64::from(g), 0.35 + 0.04 * gust.min(15.0)) {
                continue;
            }
            // f = St·U/d with St 0.2 and a 1 mm string: 200 Hz per m/s.
            let shed = 200.0 * (wind + 0.5 * g as f32 * (gust - wind)).max(0.5);
            let target = (69.0 + 12.0 * libm::log2f(shed / 440.0)).clamp(55.0, 88.0) as i32;
            let mut best = target;
            let mut best_d = i32::MAX;
            for &tone in &tones[..n_tones] {
                let m = at_or_above(tone, target - 6);
                let d = (m - target).abs();
                if d < best_d {
                    best_d = d;
                    best = m;
                }
            }
            let step = rng.below(600 + u64::from(g), 16);
            out.notes.push(note(
                start + f64::from(step) * step_ms,
                Inst::Harp,
                best,
                (0.25 + gust / 30.0).min(0.8),
                3000.0,
            ));
        }
    }

    // Every phrase carries a caption: if nothing legible happened by the
    // phrase's fourth bar, the slow world gets one.
    if bip == 3 && !state.phrase_featured {
        let kind = if snowing > 0.0 {
            FeatureKind::Snow
        } else if hour.ridge_gust_ms > 9.0 {
            FeatureKind::Wind
        } else {
            [FeatureKind::Lake, FeatureKind::Sky, FeatureKind::Ground][(phrase % 3) as usize]
        };
        let value = match kind {
            FeatureKind::Snow => snowing,
            FeatureKind::Wind => hour.ridge_gust_ms,
            FeatureKind::Lake => valley.slow.lake_ft,
            _ => sec.brightness,
        };
        out.features.push(Feature {
            at_ms: start,
            kind,
            route: 0,
            stop: 0,
            event_ms: start,
            late_s: 0,
            observed: false,
            value,
        });
        state.phrase_featured = true;
    }

    out.notes.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
}

/// FrontRunner's horn: a major-sixth chord voiced like a five-chime K5LA,
/// built on whichever major triad of the notes in play shares the most with
/// the current chord, blown in the grade-crossing rhythm (long, long, short,
/// long).
#[allow(clippy::too_many_arguments)]
pub(crate) fn horn(
    key: Key,
    chord: Chord,
    at: f64,
    beat_ms: f64,
    lat: f32,
    lon: f32,
    feature: u16,
    out: &mut Vec<Note>,
) {
    let c = i32::from(key.collection);
    let (cpcs, cn) = chord.pitch_classes();
    let mut best_root = crate::music::pc_of(c);
    let mut best_shared = -1;
    for pos in [c, c - 1, c + 1] {
        let r = crate::music::pc_of(pos);
        let six = [r, (r + 4) % 12, (r + 7) % 12, (r + 9) % 12];
        let shared = six.iter().filter(|p| cpcs[..cn].contains(p)).count() as i32;
        if shared > best_shared {
            best_shared = shared;
            best_root = r;
        }
    }
    // The third lands between D4 and G♯4, as the K5LA's lowest chime does.
    let third = at_or_above((best_root + 4) % 12, 62);
    let root = third - 4;
    let voicing = [root + 4, root + 7, root + 9, root + 12, root + 16];
    let blasts = [(0.0, 1.5), (2.0, 1.5), (4.0, 0.75), (5.0, 2.5)];
    for (b, &(beat, len)) in blasts.iter().enumerate() {
        for (i, &m) in voicing.iter().enumerate() {
            out.push(Note {
                at_ms: at + beat * beat_ms,
                inst: Inst::Horn,
                midi: m as f32,
                vel: 0.5,
                dur_ms: (len * beat_ms) as f32,
                variant: i as u8,
                lat,
                lon,
                feature: if b == 0 && i == 0 {
                    feature
                } else {
                    NO_FEATURE
                },
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::{Sky, plan_chain};
    use crate::schedule::{ServiceDay, Stop};

    fn valley_fixture() -> (Schedule, Network) {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0;
        let mut bus = vec![0u16; 1800];
        for (m, slot) in bus.iter_mut().enumerate() {
            if (360..1080).contains(&m) {
                *slot = 236;
            }
        }
        let mut rail = Vec::new();
        // A Blue Line departure every 37 s all day, and FrontRunner at
        // Central every 30 minutes.
        for i in 0..2000u32 {
            rail.push((5 * 3600 + i * 37, (i % 20) << 16));
        }
        for i in 0..40u32 {
            rail.push((5 * 3600 + i * 1800, 4 | (1 << 8) | (21 << 16)));
        }
        let mut s = Schedule::default();
        s.insert(ServiceDay {
            date: 20261023,
            t0_ms: t0,
            rail,
            ski: vec![],
            bus_west: bus.iter().map(|&b| b / 2).collect(),
            bus,
        });
        let network = Network {
            routes: vec![
                RouteKind::Trax(0),
                RouteKind::Trax(1),
                RouteKind::Trax(2),
                RouteKind::SLine,
                RouteKind::FrontRunner,
            ],
            stops: (0..30)
                .map(|i| Stop {
                    lat: 40.7 + i as f32 * 0.005,
                    lon: -111.9,
                })
                .collect(),
            slc_central: Some(21),
        };
        (s, network)
    }

    #[test]
    fn euclidean_rhythms() {
        assert_eq!(euclid(4, 16, 0).count_ones(), 4);
        assert_eq!(euclid(4, 16, 0), 0b0001_0001_0001_0001);
        // E(3,8) is the tresillo: x . . x . . x .
        let tresillo = euclid(3, 8, 0);
        assert_eq!(tresillo.count_ones(), 3);
        assert_eq!(euclid(0, 16, 0), 0);
        assert_eq!(euclid(16, 16, 0), 0xFFFF);
    }

    #[test]
    fn lake_share_follows_the_strike_team() {
        assert_eq!(lake_share(4200.0), 0.0);
        assert_eq!(lake_share(4198.0), 0.0);
        assert!((lake_share(4196.5) - LAKE_CEILING / 2.0).abs() < 1e-6);
        assert_eq!(lake_share(4189.8), LAKE_CEILING);
    }

    #[test]
    fn a_day_of_bars_is_in_key_in_range_and_captioned() {
        let (schedule, network) = valley_fixture();
        let t0 = schedule.days[0].t0_ms;
        let sky = Sky::default();
        let chain = plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &schedule, &sky);
        let slow = Slow::default();
        let valley = Valley {
            schedule: &schedule,
            network: &network,
            sky: &sky,
            slow: &slow,
            bikes: &[],
            quakes: &[],
        };
        let mut bar = Bar::default();
        let mut bells = 0;
        let mut horns = 0;
        for sec in chain.sections.iter().take(120) {
            let mut state = ComposeState::default();
            let mut featured_phrases = 0;
            for b in 0..sec.bars() {
                compose(sec, b, &valley, &mut state, &mut bar);
                for n in &bar.notes {
                    // Notes may start in later bars: the theme is composed whole on its
                    // first bar and spans four; the horn's blasts span three.
                    assert!(
                        n.at_ms >= bar.start_ms - 1e-6 && n.at_ms < bar.start_ms + bar.bar_ms * 4.0,
                        "{:?} at {} in a bar at {}",
                        n.inst,
                        n.at_ms,
                        bar.start_ms
                    );
                    match n.inst {
                        Inst::Kick
                        | Inst::Snare
                        | Inst::Rim
                        | Inst::Hat
                        | Inst::Shaker
                        | Inst::Tom
                        | Inst::Crash => {}
                        _ => {
                            let pc = (n.midi as i32).rem_euclid(12) as u8;
                            assert!(
                                sec.key.contains(pc) || sec.next_key.contains(pc),
                                "{:?} {} out of {}",
                                n.inst,
                                n.midi,
                                sec.key.name()
                            );
                        }
                    }
                    if n.inst == Inst::Bell {
                        bells += 1;
                    }
                    if n.inst == Inst::Horn {
                        horns += 1;
                    }
                }
                for h in &bar.harmony {
                    for &m in &h.pad {
                        assert!((voicing::PAD_LO..=voicing::PAD_HI).contains(&m));
                    }
                }
                if (b % 8 == 7 || b + 1 == sec.bars()) && state.phrase_featured {
                    featured_phrases += 1;
                }
            }
            assert_eq!(
                featured_phrases,
                u32::from(sec.phrases),
                "section {} has an uncaptioned phrase",
                sec.index
            );
        }
        assert!(bells > 100, "{bells}");
        assert!(horns > 0, "{horns}");
    }

    #[test]
    fn composing_is_deterministic() {
        let (schedule, network) = valley_fixture();
        let t0 = schedule.days[0].t0_ms;
        let sky = Sky::default();
        let chain = plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &schedule, &sky);
        let slow = Slow::default();
        let valley = Valley {
            schedule: &schedule,
            network: &network,
            sky: &sky,
            slow: &slow,
            bikes: &[],
            quakes: &[],
        };
        let sec = &chain.sections[40];
        let run = || {
            let mut st = ComposeState::default();
            let mut out = Vec::new();
            for b in 0..sec.bars() {
                let mut bar = Bar::default();
                compose(sec, b, &valley, &mut st, &mut bar);
                out.push(
                    bar.notes
                        .iter()
                        .map(|n| (n.at_ms.to_bits(), n.midi.to_bits(), n.inst as u8))
                        .collect::<Vec<_>>(),
                );
            }
            out
        };
        assert_eq!(run(), run());
    }
}
