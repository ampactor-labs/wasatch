//! A bar of music from a section and the valley.
//!
//! `compose` is the pure function at the heart of the piece: a section, a bar
//! index and the valley's data in, notes, harmony changes and captions out.
//! Every phone composes the same bar from the same inputs. The only state it
//! carries is the pad's last voicing, which resets at each section's first
//! bar, so a phone that joins mid-section replays from that bar.

use crate::music::{
    Chord, Color, Key, Mode, approach_degree, deceptive_degree, dominant_degree, pivot,
    progressions,
};
use crate::plan::{Daypart, OBS_LAG_MS, Section, SectionKind, Sky};
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
    /// One voice of a plane's swell (variant: its voice, 0–3, in bits 0–1;
    /// 4 a legato move of a voice already sounding; 8 landing; the plane's
    /// size less one in bits 4–6).
    Swell = 15,
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
    /// The air: haze and the inversion's lid (value PM2.5, stop the
    /// inversion in tenths of a degree).
    Air = 12,
    /// The Jordan River (value: its flow's percentile for the date, 0–1).
    River = 13,
    /// The buses (value: their stop events a minute).
    Buses = 14,
    /// The trains running late as a system (value: median seconds late).
    Late = 15,
    /// A weather alert (value: its strength, 0–1).
    Alert = 16,
    /// A plane taking off or landing at SLC (route 1 landing, stop its size,
    /// value its altitude in ft).
    Plane = 17,
    /// A new UTA service alert (route: 0 buses, 1 TRAX, 2 FrontRunner, 3 ski
    /// buses; stop 1 if it suspends service).
    ServiceAlert = 18,
    /// A storm on its way (value: the snow forecast at Alta, mm).
    Storm = 19,
    /// The grid's demand (value: against the usual for the hour).
    Grid = 20,
    /// FrontRunner due at Salt Lake Central (value: minutes; event_ms when).
    Due = 21,
    /// Something on the roads (route: 0 an incident, 1 cleared, 2 avalanche
    /// control; stop: 0 the valley, 1 Little Cottonwood, 2 Big Cottonwood).
    Road = 22,
    /// Traction law up a canyon (value: 1 Little Cottonwood, 2 Big, 3 both).
    Traction = 23,
    /// Snowplows out in the valley (value: how many).
    Plows = 24,
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
    /// Planes' swells.
    pub planes: f32,
    /// How dark the pad's color is with a storm on its way, 0–1.
    pub dark: f32,
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
    /// The hypocenter's depth, km (NaN unknown).
    pub depth_km: f32,
}

/// A plane taking off from or coming in to land at SLC.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct PlaneEvent {
    /// When it sounds, listening-time UTC ms.
    pub ms: f64,
    /// Where it was.
    pub lat: f32,
    /// Where it was.
    pub lon: f32,
    /// Altitude, ft above sea level.
    pub alt_ft: f32,
    /// Coming in to land (or else departing).
    pub arrival: bool,
    /// Size, 1 (light) to 5 (heavy).
    pub size: u8,
    /// An airline's flight: private aircraft go unnamed.
    pub airline: bool,
}

/// A new UTA service alert.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct AlertEvent {
    /// When it sounds, listening-time UTC ms.
    pub ms: f64,
    /// What it's about: 0 buses, 1 TRAX or the S-Line, 2 FrontRunner, 3 a
    /// ski bus.
    pub route_kind: u8,
    /// A suspension or closure, more than a detour.
    pub severe: bool,
}

/// Something on the roads, from UDOT.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct RoadEvent {
    /// When it sounds, listening-time UTC ms.
    pub ms: f64,
    /// 0 an incident on a valley highway, 1 one cleared, 2 avalanche control.
    pub kind: u8,
    /// 0 the valley, 1 Little Cottonwood, 2 Big Cottonwood.
    pub road: u8,
    /// Where.
    pub lat: f32,
    /// Where.
    pub lon: f32,
}

/// What stood on the roads when a conductor's window was sealed.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct RoadWindow {
    /// The window's start, listening-time UTC ms.
    pub from_ms: f64,
    /// Its end.
    pub to_ms: f64,
    /// Traction law up Little and Big Cottonwood.
    pub traction: [bool; 2],
    /// Snowplows out in the valley.
    pub plows: u16,
    /// Crashes and full closures standing on the valley's highways.
    pub closures: u16,
}

/// The service alerts in effect when a conductor's window was sealed.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct AlertWindow {
    /// The window's start, listening-time UTC ms.
    pub from_ms: f64,
    /// Its end.
    pub to_ms: f64,
    /// How many: buses, TRAX and the S-Line, FrontRunner, ski buses.
    pub active: [u8; 4],
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
    /// Electricity demand on PacifiCorp East's grid against the usual for
    /// the hour; 0 unknown.
    pub energy: f32,
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
            energy: 0.0,
        }
    }
}

impl Slow {
    /// These values with an hour's frozen ones laid over them, where the
    /// hour has them.
    pub fn overlaid(&self, h: &crate::plan::SkyHour) -> Slow {
        let or = |frozen: f32, posted: f32| if frozen.is_finite() { frozen } else { posted };
        Slow {
            lake_ft: or(h.lake_ft, self.lake_ft),
            lake_dev_ft: or(h.lake_dev_ft, self.lake_dev_ft),
            river: or(h.river, self.river),
            snowpack: or(h.snowpack, self.snowpack),
            new_snow_in: or(h.new_snow_in, self.new_snow_in),
            powder: or(h.powder, self.powder),
            season: or(h.season, self.season),
            ground: self.ground,
            energy: or(h.energy, self.energy),
        }
    }

    /// Whether the grid's demand is known.
    pub fn knows_energy(&self) -> bool {
        self.energy.is_finite() && self.energy > 0.0
    }

    /// The grid's demand against the usual for the hour, 1 unknown.
    pub fn energy_or_usual(&self) -> f32 {
        if self.knows_energy() {
            self.energy.clamp(0.5, 1.5)
        } else {
            1.0
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
    /// Planes taking off and landing, by time.
    pub planes: &'a [PlaneEvent],
    /// New service alerts, by time.
    pub alerts: &'a [AlertEvent],
    /// The service alerts in effect, window by window.
    pub alert_windows: &'a [AlertWindow],
    /// Things on the roads, by time.
    pub roads: &'a [RoadEvent],
    /// What stood on the roads, window by window.
    pub road_windows: &'a [RoadWindow],
}

impl<'a> Valley<'a> {
    /// A valley with no events in it: the schedule and the weather alone.
    pub fn quiet(
        schedule: &'a Schedule,
        network: &'a Network,
        sky: &'a Sky,
        slow: &'a Slow,
    ) -> Self {
        Valley {
            schedule,
            network,
            sky,
            slow,
            bikes: &[],
            quakes: &[],
            planes: &[],
            alerts: &[],
            alert_windows: &[],
            roads: &[],
            road_windows: &[],
        }
    }

    /// The slow values for the moment `ms`: its hour's frozen ones over
    /// the latest posted.
    pub fn slow_at(&self, ms: f64) -> Slow {
        self.sky
            .at(ms)
            .map_or(*self.slow, |h| self.slow.overlaid(&h))
    }

    /// What stood on the roads at `ms`, from the window covering it.
    pub fn roads_at(&self, ms: f64) -> RoadWindow {
        let i = self.road_windows.partition_point(|w| w.from_ms <= ms);
        match i.checked_sub(1).map(|i| self.road_windows[i]) {
            Some(w) if ms < w.to_ms => w,
            _ => RoadWindow::default(),
        }
    }

    /// The service alerts in effect at `ms`, from the window covering it.
    pub fn alerts_in_effect(&self, ms: f64) -> [u8; 4] {
        let i = self.alert_windows.partition_point(|w| w.from_ms <= ms);
        match i.checked_sub(1).map(|i| self.alert_windows[i]) {
            Some(w) if ms < w.to_ms => w.active,
            _ => [0; 4],
        }
    }
}

/// A fill's crash, owed to the next downbeat.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Fill {
    /// None owed.
    #[default]
    None,
    /// The kit's fill: a crash with the kit.
    Kit,
    /// A soft one: a quiet crash even when the kit is out.
    Soft,
}

/// The composer's carried state: the pad's last voicing and a few flags.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct ComposeState {
    pub(crate) voicing: Voicing,
    pub(crate) phrase_featured: bool,
    /// Trains captioned this phrase (two at most, so the feed has room for
    /// the rest of the valley and a card stays up long enough to read).
    pub(crate) phrase_trains: u8,
    /// A bike captioned this phrase.
    pub(crate) phrase_bike: bool,
    /// The crash a fill owes the next downbeat: carried across a section's
    /// end, which is where most fills fall.
    pub(crate) fill: Fill,
    /// A plane captioned this phrase.
    pub(crate) phrase_plane: bool,
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
            planes: 0.55,
            dark: 0.0,
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
            planes: 0.6,
            dark: 0.0,
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
            planes: 1.0,
            dark: 0.0,
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
            planes: 0.8,
            dark: 0.0,
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
            planes: 0.9,
            dark: 0.0,
        },
    };
    if night {
        m.kit *= 0.5;
        m.ground = (m.ground + 0.2).min(1.0);
        // At night a plane is most of what's moving.
        m.planes = (m.planes * 1.2).min(1.0);
    }
    m
}

/// What colors a bar beyond its section: the valley's events and its
/// outlook, worked out once a bar.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) struct BarCtx {
    /// Tension now: the section's, held up while a service alert stands on
    /// the trains.
    pub tension: f32,
    /// A storm on its way, 0–1, from the snow forecast at Alta; 0 once it's
    /// snowing (the release).
    pub storm: f32,
    /// When FrontRunner leaves Salt Lake Central around this phrase's
    /// cadence, the cadence bar's start: its approach is the dominant, its
    /// cadence lands home, and the horn lands with it.
    pub arrival: Option<f64>,
    /// An incident on the valley's highways opening in this bar (0: the
    /// chord hangs suspended) or clearing (1: it comes home).
    pub road: Option<u8>,
}

impl BarCtx {
    /// A bar colored by its section alone.
    pub(crate) fn plain(sec: &Section) -> Self {
        BarCtx {
            tension: sec.tension,
            storm: 0.0,
            arrival: None,
            road: None,
        }
    }
}

/// The phrase's length in bars (the day's last section may end on a short one).
fn phrase_len(sec: &Section, phrase: u32) -> u32 {
    (sec.bars() - phrase * 8).min(8)
}

/// How near a storm is, 0–1, from the snow forecast at Alta: from 2 in (50
/// mm) to a foot (300 mm), eased. The forecast is read from its frozen,
/// lagged slot, so every phone has the same; once snow is falling the storm
/// has arrived and its color lets go.
pub(crate) fn storm_at(valley: &Valley<'_>, ms: f64) -> f32 {
    let now = valley.sky.at_or_default(ms);
    if now.snow_cm > 0.1 || now.mtn_snow_cm > 0.3 {
        return 0.0;
    }
    let mm = valley.sky.at_or_default(ms - OBS_LAG_MS).storm_or_none();
    let x = ((mm - 50.0) / 250.0).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// The bar's color.
pub(crate) fn bar_ctx(sec: &Section, bar: u32, valley: &Valley<'_>) -> BarCtx {
    let bar_ms = sec.bar_ms();
    let start = sec.start_ms + f64::from(bar) * bar_ms;
    let active = valley.alerts_in_effect(start);
    let rail_alert = active[1] > 0 || active[2] > 0;
    // A crash or a closure standing on the highways holds it up too, until
    // the road clears.
    let closed = valley.roads_at(start).closures > 0;
    let mut tension = sec.tension;
    if rail_alert {
        tension = tension.max(0.5);
    }
    if closed {
        tension = tension.max(0.45);
    }
    let lo = valley.roads.partition_point(|r| r.ms < start);
    let road = valley.roads[lo..]
        .iter()
        .take_while(|r| r.ms < start + bar_ms)
        .find(|r| r.kind < 2 && r.road == 0)
        .map(|r| r.kind);
    BarCtx {
        tension,
        storm: storm_at(valley, start),
        arrival: cadence_arrival(sec, bar, valley),
        road,
    }
}

/// On a phrase's approach or cadence bar: the cadence bar's start, if
/// FrontRunner leaves Central from two beats before it to its end (and the
/// cadence isn't the section's pivot into a new key).
fn cadence_arrival(sec: &Section, bar: u32, valley: &Valley<'_>) -> Option<f64> {
    let phrase = bar / 8;
    let len = phrase_len(sec, phrase);
    let cadence = phrase * 8 + len - 1;
    if len < 4 || !(bar == cadence || bar + 1 == cadence) {
        return None;
    }
    if cadence + 1 == sec.bars() && sec.next_key != sec.key {
        return None;
    }
    let central = valley.network.slc_central?;
    let bar_ms = sec.bar_ms();
    let at = sec.start_ms + f64::from(cadence) * bar_ms;
    valley
        .schedule
        .performed_between(at - bar_ms / 2.0, at + bar_ms)
        .iter()
        .any(|e| e.stop == central && valley.network.kind(e.route) == RouteKind::FrontRunner)
        .then_some(at)
}

/// Lowest MIDI note of pitch class `pc` at or above `floor`.
pub(crate) fn at_or_above(pc: u8, floor: i32) -> i32 {
    floor + (i32::from(pc) - floor).rem_euclid(12)
}

/// The chord on a bar (and the chord's color).
pub(crate) fn chord_for(sec: &Section, bar: u32, valley: &Valley<'_>, ctx: &BarCtx) -> Chord {
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
    // A deep year (over 125% of median): the ninth spreads from home to the
    // IV and the vi, so the whole pad sounds fuller.
    let deep = valley.slow.snowpack > 1.25;

    if theme_bar {
        return Chord::new(key, theme::HARMONY[bip as usize], Color::Triad);
    }
    if phrase_len >= 4 && bip + 2 == phrase_len {
        // FrontRunner coming in: the dominant, to take it home.
        if ctx.arrival.is_some()
            && let Some(deg) = dominant_degree(mode)
        {
            return Chord::new(key, deg, Color::Seventh);
        }
        let color = if ctx.tension > 0.4 {
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
        // The train arrives home: outside the lake's own sections, the one
        // cadence the lake doesn't get to leave open.
        if ctx.arrival.is_some() && sec.kind != SectionKind::Lake {
            let color = if snowy { Color::Add9 } else { Color::Triad };
            return Chord::new(key, 0, color);
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
    let color = if snowy && (deg == 0 || (deep && matches!(deg, 3 | 5))) {
        Color::Add9
    } else if sec.rng.stream(0xC0).chance(u64::from(bar), 0.18) && !matches!(mode, Mode::Lydian) {
        Color::Seventh
    } else {
        Color::Triad
    };
    let chord = Chord::new(key, deg, color);
    // A road clearing comes home; one closing hangs.
    match ctx.road {
        Some(1) => return Chord::new(key, 0, color),
        Some(_) => return chord.suspended(),
        None => {}
    }
    // A storm on its way holds the harmony in suspense.
    if ctx.storm > 0.3 && sec.rng.stream(0x57).chance(u64::from(bar), 0.6 * ctx.storm) {
        return chord.suspended();
    }
    chord
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
    let ctx = bar_ctx(sec, bar, valley);
    out.mix = mix_for(sec, phrase);
    if ctx.storm > 0.0 {
        // A storm on its way: the pad darkens and the lake's drone swells.
        out.mix.dark = ctx.storm;
        out.mix.lake = out.mix.lake.max(0.35 + 0.45 * ctx.storm);
    }
    let mix = out.mix;
    let phrase_len = phrase_len(sec, phrase);
    let cadence_bars = phrase_len >= 4 && bip + 2 >= phrase_len;

    if bar == 0 {
        // A new section starts clean, but for the crash the last one's fill
        // owes it (none at a day's first section: nothing came before).
        *state = ComposeState {
            fill: if sec.index == 0 {
                Fill::None
            } else {
                state.fill
            },
            ..ComposeState::default()
        };
    }
    if bip == 0 {
        state.phrase_featured = false;
        state.phrase_trains = 0;
        state.phrase_bike = false;
        state.phrase_plane = false;
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
    let chord = chord_for(sec, bar, valley, &ctx);
    let pad = voicing::voice(chord, &state.voicing);
    state.voicing = pad;
    let (tones, n_tones) = chord.pitch_classes();
    let root = chord.root_pc();
    // With a storm close, the bass holds home under the harmony (a pedal),
    // letting go for the cadence.
    let pedal_bass = ctx.storm > 0.5 && !cadence_bars;
    let bass = at_or_above(if pedal_bass { key.tonic_pc() } else { root }, 33);
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

    // Bass: the rivers, graded. Low water holds long notes; usual water
    // plays the root and, when it's busy, the fifth; high water walks; a
    // flood walks in eighths.
    if mix.bass > 0.0 {
        let river = valley.slow.river;
        let walking = river > 0.6 && activity > 0.3 && !pedal_bass;
        let low = river <= 0.25;
        let degree = |off: usize| key.scale()[(usize::from(chord.degree) + off) % 7];
        if walking && river > 0.85 {
            // (beat, eighth, scale step): quarters on 1 and 3, eighths
            // climbing through 2 and 4 into the next bar.
            for (beat, half, off, vel) in [
                (0u32, 0u32, 0usize, 0.64f32),
                (1, 0, 2, 0.58),
                (1, 1, 3, 0.46),
                (2, 0, 4, 0.6),
                (3, 0, 5, 0.58),
                (3, 1, 6, 0.48),
            ] {
                let len = if half == 0 && (beat == 0 || beat == 2) {
                    0.92
                } else {
                    0.46
                };
                out.notes.push(note(
                    start + f64::from(beat) * beat_ms + f64::from(half) * beat_ms * 0.5,
                    Inst::Bass,
                    at_or_above(degree(off), 33),
                    vel,
                    beat_ms * len,
                ));
            }
        } else if walking {
            for beat in 0..4u32 {
                let deg_off = [0, 2, 4, 5][beat as usize];
                out.notes.push(note(
                    start + f64::from(beat) * beat_ms,
                    Inst::Bass,
                    at_or_above(degree(deg_off), 33),
                    0.62,
                    beat_ms * 0.92,
                ));
            }
        } else if low {
            // Low water: the root, held the whole bar, however busy.
            out.notes
                .push(note(start, Inst::Bass, bass, 0.66, bar_ms * 0.97));
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
    }

    // Fills, on a phrase's last bar: into the next section; into the next
    // phrase while a storm warning is up or a storm is near (every other
    // phrase, every one when it's close); and when UTA puts out a new
    // service alert. One a phrase; its crash lands on the next downbeat.
    if bip + 1 == phrase_len {
        let phrase_start = start - f64::from(bip) * bar_ms;
        let alert = valley
            .alerts
            .iter()
            .find(|a| a.ms >= phrase_start && a.ms < start + 12.0 * step_ms)
            .copied();
        let warned = valley.sky.at_or_default(start).alert > 0.3
            || (ctx.storm > 0.5 && (phrase % 2 == 1 || ctx.storm > 0.8));
        let full = matches!(sec.kind, SectionKind::Groove | SectionKind::Journey);
        let mut first = None;
        if kit_on && full && (bar + 1 == sec.bars() || warned || alert.is_some()) {
            // A suspension or a closure gets a longer run, harder.
            let severe = alert.is_some_and(|a| a.severe);
            let run: &[(u32, i32)] = if severe {
                &[(11, 52), (12, 50), (13, 47), (14, 45), (15, 43)]
            } else {
                &[(12, 50), (13, 47), (14, 45), (15, 43)]
            };
            for &(s, m) in run {
                out.notes.push(note(
                    start + f64::from(s) * step_ms,
                    Inst::Tom,
                    m,
                    if severe { 0.58 } else { 0.5 },
                    260.0,
                ));
            }
            state.fill = Fill::Kit;
            first = Some(start + f64::from(run[0].0) * step_ms);
        } else if alert.is_some() {
            // No drums to fill with: a cymbal swell rising into the downbeat.
            let at = start + 8.0 * step_ms;
            out.notes.push(Note {
                variant: 2,
                ..note(at, Inst::Crash, 49, 0.3, 8.0 * step_ms)
            });
            state.fill = Fill::Soft;
            first = Some(at);
        }
        if let (Some(a), Some(at)) = (alert, first) {
            out.features.push(Feature {
                at_ms: at,
                kind: FeatureKind::ServiceAlert,
                route: a.route_kind,
                stop: u16::from(a.severe),
                event_ms: a.ms,
                late_s: 0,
                observed: true,
                value: 0.0,
            });
            state.phrase_featured = true;
        }
    }
    // The crash a fill owed this downbeat: with the kit if it's playing, a
    // soft one if the section that follows has no drums.
    if bip == 0 {
        match state.fill {
            Fill::None => {}
            Fill::Kit if kit_on => out.notes.push(note(start, Inst::Crash, 49, 0.42, 2400.0)),
            Fill::Kit | Fill::Soft => out.notes.push(Note {
                variant: 3,
                ..note(start, Inst::Crash, 49, 0.28, 2400.0)
            }),
        }
        state.fill = Fill::None;
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
            // Overnight new snow sizes the theme: up to 15% harder at six
            // inches, and on a powder day the high statement is doubled an
            // octave down.
            let fresh = (valley.slow.new_snow_in / 6.0).clamp(0.0, 1.0);
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
                let vel = (n.velocity * (1.0 + 0.15 * fresh)).min(1.0);
                out.notes.push(Note {
                    variant: n.summit as u8,
                    feature,
                    ..note(
                        at,
                        Inst::Piano,
                        midi,
                        vel,
                        f64::from(n.beats) * beat_ms * 1.4,
                    )
                });
                if fresh >= 1.0 && phrase == 2 && statement {
                    out.notes.push(Note {
                        variant: n.summit as u8,
                        ..note(
                            at,
                            Inst::Piano,
                            n.midi,
                            vel * 0.7,
                            f64::from(n.beats) * beat_ms * 1.4,
                        )
                    });
                }
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
                    // The phrase's first train, and one more in its second
                    // half: the first bell of its bar.
                    let feature = if bells == 0
                        && (state.phrase_trains == 0 || (state.phrase_trains == 1 && bip >= 4))
                    {
                        state.phrase_trains += 1;
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
                    // Leaving around the cadence, the horn lands on it, over
                    // home.
                    let cadence = ctx.arrival.filter(|&c| (ev.ms - c).abs() <= 2.0 * beat_ms);
                    let at = cadence.unwrap_or(at);
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
                        if cadence.is_some() {
                            Chord::new(key, 0, Color::Triad)
                        } else {
                            chord
                        },
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
                // Up the canyon it climbs.
                let (lat, lon) = valley.network.kind(ev.route).canyon_point();
                for (i, m) in [52, 50, 47, 45].iter().enumerate() {
                    out.notes.push(Note {
                        variant: 1,
                        lat,
                        lon,
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

    // Planes.
    if mix.planes > 0.0 {
        planes(sec, bar, valley, state, out);
    }

    // The roads.
    roads(sec, bar, valley, kit_on, state, out);

    // Bikes: marimba plucks on scale degrees picked by latitude; a bike
    // leaving its dock rings an octave above one coming back.
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
            let tonic = key.tonic_at_or_above(if b.delta < 0 { 79 } else { 67 });
            let feature = if n == 0 && !state.phrase_bike {
                state.phrase_bike = true;
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

    // Quakes: a chord bell for the first quake in each half minute, so a
    // swarm rings twice a minute at most. It needs no memory of earlier
    // bars, so every phone (and one that just joined) agrees.
    let lo = valley.quakes.partition_point(|q| q.ms < start);
    if let Some(q) = valley.quakes[lo..]
        .iter()
        .take_while(|q| q.ms < start + bar_ms)
        .find(|q| {
            let half = (q.ms / 30_000.0).floor() * 30_000.0;
            let first = valley.quakes.partition_point(|x| x.ms < half);
            valley.quakes.get(first).is_some_and(|x| x.ms == q.ms)
        })
    {
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
        // Its depth: a shallow quake (under 5 km) rings an octave higher and
        // shorter, a deep one (over 12 km) an octave lower and longer.
        let (octave, ring_ms) = match q.depth_km {
            d if d < 5.0 => (12, 6500.0),
            d if d > 12.0 => (-12, 10_000.0),
            _ => (0, 8000.0),
        };
        out.notes.push(Note {
            lat: q.lat,
            lon: q.lon,
            feature: f,
            variant: if chord.is_minor() { 0 } else { 1 },
            ..note(
                at,
                Inst::QuakeBell,
                at_or_above(root, 48) + octave,
                vel,
                ring_ms,
            )
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

    // Every phrase carries a card about the valley at large, on its fourth
    // bar: what's notable now every third phrase (snow falling, an alert, a
    // gale on the ridges, a lid of bad air, the trains running late, taking
    // turns when there are several), and a turn through the rest in
    // between, so the feed gets to all of it.
    if bip == 3 {
        let late_s = valley.schedule.system_late_s(start);
        let bus_rate = valley.schedule.bus_rate(start);
        let storm_mm = valley.sky.at_or_default(start - OBS_LAG_MS).storm_or_none();
        let road_now = valley.roads_at(start);
        let mut notables = [FeatureKind::Snow; 8];
        let mut n_notable = 0;
        for (on, kind) in [
            (snowing > 0.0, FeatureKind::Snow),
            (ctx.storm > 0.3, FeatureKind::Storm),
            (hour.alert > 0.3, FeatureKind::Alert),
            (hour.ridge_gust_ms > 9.0, FeatureKind::Wind),
            (
                hour.inversion_c >= 4.0 || hour.pm25 >= 12.0,
                FeatureKind::Air,
            ),
            (late_s >= 120.0, FeatureKind::Late),
            (
                road_now.traction[0] || road_now.traction[1],
                FeatureKind::Traction,
            ),
        ] {
            if on {
                notables[n_notable] = kind;
                n_notable += 1;
            }
        }
        let slot = sec.index * 4 + phrase;
        const TURNS: [FeatureKind; 7] = [
            FeatureKind::Lake,
            FeatureKind::Buses,
            FeatureKind::Sky,
            FeatureKind::Ground,
            FeatureKind::River,
            FeatureKind::Air,
            FeatureKind::Grid,
        ];
        let turn = |k: u32| {
            // No buses to speak of at night, and no grid without its
            // reading: the next turn instead.
            let i = (k % 7) as usize;
            let skip = (TURNS[i] == FeatureKind::Buses && bus_rate < 1.0)
                || (TURNS[i] == FeatureKind::Grid && !valley.slow.knows_energy());
            if skip { TURNS[(i + 1) % 7] } else { TURNS[i] }
        };
        // FrontRunner due at Central in the next few minutes: said once a
        // train, in place of the phrase's card.
        let due_in = |at: f64| {
            valley
                .schedule
                .due_at(at)
                .filter(|&d| (90_000.0..240_000.0).contains(&(d - at)))
        };
        let due = due_in(start).filter(|&d| {
            let before = start - 8.0 * bar_ms;
            !due_in(before).is_some_and(|p| (p - d).abs() < 120_000.0)
        });
        let kind = if due.is_some() {
            FeatureKind::Due
        } else if n_notable > 0 && slot.is_multiple_of(3) {
            notables[(slot / 3) as usize % n_notable]
        } else {
            turn(slot)
        };
        // Snow falling with the plows out: the plows' card says both.
        let kind = if kind == FeatureKind::Snow && road_now.plows >= 5 {
            FeatureKind::Plows
        } else {
            kind
        };
        let (value, stop) = match kind {
            FeatureKind::Due => (
                ((due.unwrap_or(start) - start) / 60_000.0).round() as f32,
                valley.network.slc_central.unwrap_or(0),
            ),
            FeatureKind::Storm => (storm_mm, 0),
            FeatureKind::Traction => (
                f32::from(u8::from(road_now.traction[0]) | (u8::from(road_now.traction[1]) << 1)),
                0,
            ),
            FeatureKind::Plows => (f32::from(road_now.plows), 0),
            FeatureKind::Grid => (valley.slow.energy_or_usual(), 0),
            FeatureKind::Snow => (snowing, 0),
            FeatureKind::Wind => (hour.ridge_gust_ms, 0),
            FeatureKind::Lake => (valley.slow.lake_ft, 0),
            FeatureKind::Alert => (hour.alert, 0),
            FeatureKind::Air => (
                hour.pm25,
                (hour.inversion_c.max(0.0) * 10.0)
                    .round()
                    .min(f32::from(u16::MAX)) as u16,
            ),
            FeatureKind::Late => (late_s, 0),
            FeatureKind::River => (valley.slow.river, 0),
            FeatureKind::Buses => (bus_rate, 0),
            _ => (sec.brightness, 0),
        };
        out.features.push(Feature {
            at_ms: start,
            kind,
            route: 0,
            stop,
            event_ms: due.unwrap_or(start),
            late_s: 0,
            observed: due.is_some(),
            value,
        });
        state.phrase_featured = true;
    }

    out.notes.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
}

/// The canyon roads' places: partway up Little and Big Cottonwood.
fn canyon_road(road: u8) -> (f32, f32) {
    match road {
        1 => RouteKind::Ski(5).canyon_point(),
        _ => RouteKind::Ski(6).canyon_point(),
    }
}

/// A bar's roads: an incident's card (its sound is the harmony's, in
/// `chord_for`); avalanche control, a distant boom in the canyon's echo;
/// traction law up a canyon, a low brass pedal there, a phrase at a time;
/// snowplows out in a storm, brushes in the drums.
fn roads(
    sec: &Section,
    bar: u32,
    valley: &Valley<'_>,
    kit_on: bool,
    state: &mut ComposeState,
    out: &mut Bar,
) {
    let bar_ms = sec.bar_ms();
    let start = sec.start_ms + f64::from(bar) * bar_ms;
    let step_ms = bar_ms / 16.0;
    let key = sec.key;
    let lo = valley.roads.partition_point(|r| r.ms < start);
    for r in valley.roads[lo..]
        .iter()
        .take_while(|r| r.ms < start + bar_ms)
    {
        let step = (((r.ms - start) / step_ms).round() as u32).min(15);
        let at = start + f64::from(step) * step_ms;
        out.features.push(Feature {
            at_ms: at,
            kind: FeatureKind::Road,
            route: r.kind,
            stop: u16::from(r.road),
            event_ms: r.ms,
            late_s: 0,
            observed: true,
            value: 0.0,
        });
        state.phrase_featured = true;
        if r.kind == 2 {
            let (lat, lon) = canyon_road(r.road);
            let f = (out.features.len() - 1) as u16;
            for (i, m) in [28, 26].iter().enumerate() {
                out.notes.push(Note {
                    at_ms: at + f64::from(i as u32) * 3.0 * step_ms,
                    inst: Inst::Tom,
                    midi: *m as f32,
                    vel: if i == 0 { 0.7 } else { 0.45 },
                    dur_ms: 1800.0,
                    variant: 4,
                    lat,
                    lon,
                    feature: if i == 0 { f } else { NO_FEATURE },
                });
            }
        }
    }
    let now = valley.roads_at(start);
    let bip = bar % 8;
    // Traction law: a pedal on home, low, breathing a phrase at a time, from
    // the canyon that has it.
    if bip == 0 && (now.traction[0] || now.traction[1]) {
        let road = if now.traction[0] { 1 } else { 2 };
        let (lat, lon) = canyon_road(road);
        let len = (f64::from(phrase_len(sec, bar / 8)) * bar_ms).min(sec.end_ms() - start);
        out.notes.push(Note {
            at_ms: start,
            inst: Inst::Swell,
            midi: at_or_above(key.tonic_pc(), 38) as f32,
            vel: 0.4,
            dur_ms: len as f32,
            variant: 128 | ((3 - 1) << 4),
            lat,
            lon,
            feature: NO_FEATURE,
        });
    }
    // Plows out while it snows: brushes, more of them the more plows.
    let hour = valley.sky.at_or_default(start);
    let snowing = hour.snow_cm > 0.1 || hour.mtn_snow_cm > 0.3;
    if kit_on && snowing && now.plows >= 5 {
        let steps: &[u32] = if now.plows >= 30 {
            &[2, 6, 10, 14]
        } else {
            &[6, 14]
        };
        for &s in steps {
            out.notes.push(Note {
                at_ms: start + f64::from(s) * step_ms,
                inst: Inst::Snare,
                midi: 38.0,
                vel: 0.16,
                dur_ms: 250.0,
                variant: 0,
                lat: f32::NAN,
                lon: f32::NAN,
                feature: NO_FEATURE,
            });
        }
    }
}

/// Planes heard at most this often.
const PLANE_GAP_MS: f64 = 20_000.0;
/// A swell's register, MIDI: E2 to E4.
const SWELL_LO: i32 = 40;
const SWELL_HI: i32 = 64;

/// Whether a plane sounds: it's the first in its twenty seconds, and the
/// first in the twenty before came at least twenty seconds earlier. Heard
/// planes are never closer than that, and it takes no memory of earlier
/// bars, only the forty seconds of planes before (the conductor spaces them
/// so already; this holds whatever it sent).
fn plane_heard(valley: &Valley<'_>, p: &PlaneEvent) -> bool {
    let first_from = |t: f64| {
        valley
            .planes
            .get(valley.planes.partition_point(|q| q.ms < t))
    };
    let bucket = (p.ms / PLANE_GAP_MS).floor() * PLANE_GAP_MS;
    first_from(bucket).is_some_and(|q| q.ms == p.ms)
        && first_from(bucket - PLANE_GAP_MS)
            .is_none_or(|q| q.ms >= bucket || p.ms - q.ms >= PLANE_GAP_MS)
}

/// A plane's swell in a section: the bar it starts in, when (the beat at or
/// after the plane), and how long it lasts (four bars, or to the section's
/// end).
fn swell_onset(sec: &Section, p: &PlaneEvent) -> Option<(u32, f64, f64)> {
    let bar_ms = sec.bar_ms();
    let beat = bar_ms / 4.0;
    // A swell is its plane's section's: it never crosses into the next.
    if p.ms < sec.start_ms {
        return None;
    }
    let at = sec.start_ms + ((p.ms - sec.start_ms) / beat).ceil() * beat;
    if at >= sec.end_ms() - beat {
        return None;
    }
    let bar = ((at - sec.start_ms) / bar_ms).floor() as u32;
    Some((bar, at, (4.0 * bar_ms).min(sec.end_ms() - at)))
}

/// The chord tone nearest `m` (down first on a tie), in the swell's register.
fn nearest_tone(chord: Chord, m: i32) -> i32 {
    let (pcs, n) = chord.pitch_classes();
    let tone = |x: i32| pcs[..n].contains(&(x.rem_euclid(12) as u8));
    for d in 0..12 {
        for x in [m - d, m + d] {
            if (SWELL_LO..=SWELL_HI).contains(&x) && tone(x) {
                return x;
            }
        }
    }
    m.clamp(SWELL_LO, SWELL_HI)
}

/// The next chord tone above (`dir` 1) or below (−1) `m`, if the register
/// has one.
fn next_tone(chord: Chord, m: i32, dir: i32) -> Option<i32> {
    let (pcs, n) = chord.pitch_classes();
    (1..=12)
        .map(|k| m + dir * k)
        .find(|x| pcs[..n].contains(&(x.rem_euclid(12) as u8)))
        .filter(|x| (SWELL_LO..=SWELL_HI).contains(x))
}

/// How far apart a swell's two voices stay: nothing closer than a fifth
/// below C3, where thirds turn to mud.
fn swell_gap(lower: i32) -> i32 {
    if lower < 48 { 7 } else { 3 }
}

/// A swell's two voices at bar `upto`: set on its first chord by the
/// plane's height and size (a low plane low, a heavy one lower), then led
/// bar by bar to the nearest tones of each chord, the upper voice stepping
/// up a chord tone at a departure's crest and down at an arrival's.
fn swell_voices(
    sec: &Section,
    valley: &Valley<'_>,
    p: &PlaneEvent,
    onset_bar: u32,
    upto: u32,
) -> [i32; 2] {
    let chord_at = |b: u32| chord_for(sec, b, valley, &bar_ctx(sec, b, valley));
    let first = chord_at(onset_bar);
    // Room above for the upper voice: the lower one no higher than A3.
    let center = (43.0 + 16.0 * (p.alt_ft / 12_000.0).clamp(0.0, 1.0)
        - 2.5 * (f32::from(p.size) - 3.0))
        .clamp(41.0, 57.0);
    let lower = nearest_tone(first, center.round() as i32);
    let gap = swell_gap(lower);
    // An arrival starts wider, to fall.
    let above = nearest_tone(first, lower + gap);
    let above = if above < lower + gap {
        next_tone(first, above, 1).unwrap_or(above)
    } else {
        above
    };
    let upper = if p.arrival {
        next_tone(first, above, 1).unwrap_or(above)
    } else {
        above
    };
    let mut v = [lower, upper];
    let span = ((sec.end_ms() - (sec.start_ms + f64::from(onset_bar) * sec.bar_ms()))
        / sec.bar_ms())
    .ceil()
    .min(4.0) as u32;
    let crest = onset_bar + 2.min(span.saturating_sub(1));
    for b in onset_bar + 1..=upto {
        let c = chord_at(b);
        v = [nearest_tone(c, v[0]), nearest_tone(c, v[1])];
        if b == crest
            && let Some(x) = next_tone(c, v[1], if p.arrival { -1 } else { 1 })
            && x >= v[0] + swell_gap(v[0])
        {
            v[1] = x;
        }
        if v[1] < v[0] + swell_gap(v[0]) {
            v[1] = next_tone(c, v[0] + swell_gap(v[0]) - 1, 1).unwrap_or(v[1]);
        }
    }
    v
}

/// A bar's planes: each one climbing out of SLC or coming down to it is a
/// swell of brass and strings over a few bars, placed where it is, its two
/// voices moving with the harmony; an airline's is named, once a phrase.
fn planes(sec: &Section, bar: u32, valley: &Valley<'_>, state: &mut ComposeState, out: &mut Bar) {
    let bar_ms = sec.bar_ms();
    let start = sec.start_ms + f64::from(bar) * bar_ms;
    // Planes whose swell could be sounding in this bar: begun up to four
    // bars back.
    let lo = valley
        .planes
        .partition_point(|q| q.ms < start - 4.0 * bar_ms - bar_ms);
    for p in valley.planes[lo..]
        .iter()
        .take_while(|q| q.ms < start + bar_ms)
    {
        let Some((onset_bar, at, dur)) = swell_onset(sec, p) else {
            continue;
        };
        if onset_bar > bar || at + dur <= start || !plane_heard(valley, p) {
            continue;
        }
        let pair = 2 * ((p.ms / PLANE_GAP_MS).floor() as i64).rem_euclid(2) as u8;
        let flags = (u8::from(p.arrival) << 3) | ((p.size.clamp(1, 5) - 1) << 4);
        let vel = 0.35 + 0.1 * f32::from(p.size.clamp(1, 5));
        let voices = swell_voices(sec, valley, p, onset_bar, bar);
        if onset_bar == bar {
            let feature = if p.airline && !state.phrase_plane {
                state.phrase_plane = true;
                state.phrase_featured = true;
                // Named as it becomes audible: halfway up its rise.
                let u = if p.arrival { 0.125 } else { 0.35 };
                out.features.push(Feature {
                    at_ms: at + u * dur,
                    kind: FeatureKind::Plane,
                    route: u8::from(p.arrival),
                    stop: u16::from(p.size),
                    event_ms: p.ms,
                    late_s: 0,
                    observed: true,
                    value: p.alt_ft,
                });
                (out.features.len() - 1) as u16
            } else {
                NO_FEATURE
            };
            for (i, &m) in voices.iter().enumerate() {
                out.notes.push(Note {
                    at_ms: at,
                    inst: Inst::Swell,
                    midi: m as f32,
                    vel: if i == 0 { vel } else { 0.8 * vel },
                    dur_ms: dur as f32,
                    variant: (pair + i as u8) | flags,
                    lat: p.lat,
                    lon: p.lon,
                    feature: if i == 0 { feature } else { NO_FEATURE },
                });
            }
        } else {
            // Legato: the voices that move on this downbeat.
            let before = swell_voices(sec, valley, p, onset_bar, bar - 1);
            for i in 0..2 {
                if voices[i] != before[i] {
                    out.notes.push(Note {
                        at_ms: start,
                        inst: Inst::Swell,
                        midi: voices[i] as f32,
                        vel,
                        dur_ms: (at + dur - start) as f32,
                        variant: (pair + i as u8) | 4 | flags,
                        lat: p.lat,
                        lon: p.lon,
                        feature: NO_FEATURE,
                    });
                }
            }
        }
    }
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
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
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
    fn the_feed_has_room_for_the_whole_valley() {
        let (schedule, network) = valley_fixture();
        let t0 = schedule.days[0].t0_ms;
        let sky = Sky::default();
        let chain = plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &schedule, &sky);
        let slow = Slow::default();
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
        let mut bar = Bar::default();
        let mut kinds = std::collections::BTreeSet::new();
        let mut phrases = 0;
        for sec in chain.sections.iter().take(60) {
            let mut state = ComposeState::default();
            let (mut trains, mut valley_cards) = (0, 0);
            for b in 0..sec.bars() {
                compose(sec, b, &valley, &mut state, &mut bar);
                for f in &bar.features {
                    match f.kind {
                        FeatureKind::Trax => trains += 1,
                        FeatureKind::Lake
                        | FeatureKind::Sky
                        | FeatureKind::Ground
                        | FeatureKind::Buses
                        | FeatureKind::River
                        | FeatureKind::Air
                        | FeatureKind::Late
                        | FeatureKind::Alert
                        | FeatureKind::Wind
                        | FeatureKind::Snow
                        | FeatureKind::Storm
                        | FeatureKind::Grid
                        | FeatureKind::Due => {
                            assert_eq!(b % 8, 3, "a valley card on a phrase's fourth bar");
                            kinds.insert(f.kind as u8);
                            valley_cards += 1;
                        }
                        _ => {}
                    }
                }
                if b % 8 == 7 || b + 1 == sec.bars() {
                    // Two trains a phrase at most, however busy the lines.
                    assert!(trains <= 2, "{trains} train cards in a phrase");
                    if b % 8 >= 3 {
                        assert_eq!(valley_cards, 1, "one valley card a phrase");
                    }
                    phrases += 1;
                    (trains, valley_cards) = (0, 0);
                }
            }
        }
        assert!(phrases > 100);
        // Over a few hours the turn reaches every kind it has.
        assert!(kinds.len() >= 5, "{kinds:?}");
    }

    /// The fixture's chain and a quiet valley over it.
    fn fixture_chain(schedule: &Schedule) -> crate::plan::Chain {
        let t0 = schedule.days[0].t0_ms;
        plan_chain(
            20261023,
            t0,
            t0 + 29.0 * 3_600_000.0,
            schedule,
            &Sky::default(),
        )
    }

    #[test]
    fn a_fill_that_ends_a_section_crashes_on_the_next_downbeat() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
        let mut bar = Bar::default();
        let (mut with_kit, mut soft) = (0, 0);
        for pair in chain.sections.windows(2).take(150) {
            let (a, b) = (&pair[0], &pair[1]);
            let mut state = ComposeState::default();
            for i in 0..a.bars() {
                compose(a, i, &valley, &mut state, &mut bar);
            }
            let filled = bar
                .notes
                .iter()
                .any(|n| n.inst == Inst::Tom && n.variant == 0);
            compose(b, 0, &valley, &mut state, &mut bar);
            let crash = bar
                .notes
                .iter()
                .find(|n| n.inst == Inst::Crash && (n.at_ms - b.start_ms).abs() < 1e-6);
            assert_eq!(
                filled,
                crash.is_some(),
                "section {} into {}",
                a.index,
                b.index
            );
            match crash.map(|n| n.variant) {
                Some(0) => with_kit += 1,
                // The kit is out in the section that follows: a soft one.
                Some(3) => soft += 1,
                Some(v) => panic!("crash variant {v}"),
                None => {}
            }
            assert_eq!(state.fill, Fill::None, "the crash is paid on the downbeat");
        }
        assert!(
            with_kit > 0 && soft > 0,
            "{with_kit} with the kit, {soft} soft"
        );
    }

    #[test]
    fn a_phone_that_joins_at_a_boundary_hears_the_same_downbeat() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
        let notes = |bar: &Bar| {
            bar.notes
                .iter()
                .map(|n| (n.at_ms.to_bits(), n.midi.to_bits(), n.inst as u8, n.variant))
                .collect::<Vec<_>>()
        };
        let mut checked = 0;
        for pair in chain.sections.windows(2).take(150) {
            let (a, b) = (&pair[0], &pair[1]);
            let mut bar = Bar::default();
            // Listening all along.
            let mut along = ComposeState::default();
            for i in 0..a.bars() {
                compose(a, i, &valley, &mut along, &mut bar);
            }
            compose(b, 0, &valley, &mut along, &mut bar);
            let heard = notes(&bar);
            // Joining now: the engine warms up on the last section's last bar.
            let mut joined = ComposeState::default();
            compose(a, a.bars() - 1, &valley, &mut joined, &mut bar);
            compose(b, 0, &valley, &mut joined, &mut bar);
            assert_eq!(notes(&bar), heard, "section {}", b.index);
            checked += 1;
        }
        assert!(checked > 100);
    }

    #[test]
    fn a_swarm_rings_twice_a_minute_at_most() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let sec = &chain.sections[30];
        // A quake every 10 s for the whole section.
        let quakes: Vec<QuakeEvent> = (0..)
            .map(|i| sec.start_ms + 2_000.0 + f64::from(i) * 10_000.0)
            .take_while(|&ms| ms < sec.end_ms())
            .map(|ms| QuakeEvent {
                ms,
                origin_ms: ms,
                mag: 2.0,
                lat: 40.7,
                lon: -111.9,
                depth_km: 8.0,
            })
            .collect();
        let valley = Valley {
            quakes: &quakes,
            ..Valley::quiet(&schedule, &network, &sky, &slow)
        };
        let mut bar = Bar::default();
        let mut state = ComposeState::default();
        let mut rung = Vec::new();
        for b in 0..sec.bars() {
            compose(sec, b, &valley, &mut state, &mut bar);
            rung.extend(
                bar.notes
                    .iter()
                    .filter(|n| n.inst == Inst::QuakeBell)
                    .map(|n| n.at_ms),
            );
        }
        let minutes = (sec.end_ms() - sec.start_ms) / 60_000.0;
        assert!(
            rung.len() as f64 <= 2.0 * minutes + 1.0,
            "{} in {minutes:.1} min",
            rung.len()
        );
        assert!(
            rung.len() as f64 >= 2.0 * minutes - 2.0,
            "{} in {minutes:.1} min",
            rung.len()
        );
    }

    /// A sky with the same `edit` in every hour of the fixture's day.
    fn sky_with(schedule: &Schedule, edit: impl Fn(&mut crate::plan::SkyHour)) -> Sky {
        let t0 = schedule.days[0].t0_ms;
        let mut sky = Sky::default();
        for h in 0..32 {
            let mut hour = crate::plan::SkyHour::default();
            edit(&mut hour);
            sky.set(t0 + f64::from(h) * 3_600_000.0, hour);
        }
        sky
    }

    #[test]
    fn a_storm_on_its_way_holds_the_music_in_suspense_until_the_snow() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let slow = Slow::default();
        let run = |sky: &Sky| {
            let valley = Valley::quiet(&schedule, &network, sky, &slow);
            let (mut sus, mut dark, mut pedal, mut bars, mut cards) = (0, 0, 0, 0, 0);
            let mut bar = Bar::default();
            for sec in chain.sections.iter().skip(20).take(30) {
                let mut state = ComposeState::default();
                for b in 0..sec.bars() {
                    compose(sec, b, &valley, &mut state, &mut bar);
                    let h = bar.harmony[0];
                    let cadence = b % 8 + 2 >= phrase_len(sec, b / 8);
                    bars += 1;
                    sus +=
                        usize::from(matches!(h.chord.color, Color::Sus2 | Color::Sus4) && !cadence);
                    dark += usize::from(bar.mix.dark > 0.5);
                    let bass = bar.notes.iter().find(|n| n.inst == Inst::Bass);
                    if !cadence
                        && bass.is_some_and(|n| {
                            (n.midi as i32).rem_euclid(12) == i32::from(sec.key.tonic_pc())
                        })
                    {
                        pedal += 1;
                    }
                    cards += bar
                        .features
                        .iter()
                        .filter(|f| f.kind == FeatureKind::Storm)
                        .count();
                    // Still the notes in play.
                    for n in &bar.notes {
                        if !matches!(
                            n.inst,
                            Inst::Kick
                                | Inst::Snare
                                | Inst::Rim
                                | Inst::Hat
                                | Inst::Shaker
                                | Inst::Tom
                                | Inst::Crash
                        ) {
                            let pc = (n.midi as i32).rem_euclid(12) as u8;
                            assert!(sec.key.contains(pc) || sec.next_key.contains(pc));
                        }
                    }
                }
            }
            (sus, dark, pedal, bars, cards)
        };
        let calm = run(&Sky::default());
        let coming = run(&sky_with(&schedule, |h| h.storm_mm = 280.0));
        let falling = run(&sky_with(&schedule, |h| {
            h.storm_mm = 280.0;
            h.snow_cm = 1.0;
        }));
        let (sus, dark, pedal, bars, cards) = coming;
        assert!(
            sus > bars / 5 && sus > 4 * calm.0,
            "suspensions {sus} of {bars} (calm {})",
            calm.0
        );
        assert!(dark > bars / 2, "dark {dark} of {bars}");
        assert!(
            pedal > bars / 3 && pedal > 2 * calm.2,
            "pedal {pedal} of {bars} (calm {})",
            calm.2
        );
        assert!(cards > 0);
        // Once it snows, the storm has come: its color lets go.
        assert_eq!((falling.1, falling.4), (0, 0));
        assert!(falling.0 <= calm.0 + bars / 20);
    }

    #[test]
    fn frontrunner_at_the_cadence_gets_its_dominant_and_lands_home_with_the_horn() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
        let mut bar = Bar::default();
        let (mut arrivals, mut dominants) = (0, 0);
        for sec in &chain.sections {
            let mut state = ComposeState::default();
            for b in 0..sec.bars() {
                compose(sec, b, &valley, &mut state, &mut bar);
                let ctx = bar_ctx(sec, b, &valley);
                let Some(cadence) = ctx.arrival else { continue };
                let len = phrase_len(sec, b / 8);
                let chord = bar.harmony[0].chord;
                if b % 8 + 2 == len {
                    // The approach: the mode's dominant seventh, where it has one.
                    if let Some(deg) = dominant_degree(sec.key.mode()) {
                        assert_eq!(
                            (chord.degree, chord.color),
                            (deg, Color::Seventh),
                            "{}",
                            sec.key.name()
                        );
                        let (pcs, n) = chord.pitch_classes();
                        let r = pcs[0];
                        let shape: Vec<u8> = pcs[..n].iter().map(|p| (p + 12 - r) % 12).collect();
                        assert_eq!(shape, [0, 4, 7, 10]);
                        dominants += 1;
                    }
                } else if sec.kind != SectionKind::Lake {
                    assert_eq!(chord.degree, 0, "the cadence lands home");
                    arrivals += 1;
                }
                // Any horn near the cadence starts on it.
                for n in bar
                    .notes
                    .iter()
                    .filter(|n| n.inst == Inst::Horn && n.feature != NO_FEATURE)
                {
                    if (n.at_ms - cadence).abs() <= sec.bar_ms() / 2.0 {
                        assert_eq!(n.at_ms, cadence);
                    }
                }
            }
        }
        assert!(
            arrivals >= 5 && dominants >= 5,
            "{arrivals} arrivals, {dominants} dominants"
        );
    }

    #[test]
    fn a_new_service_alert_fills_the_end_of_its_phrase() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let groove = chain
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Groove && s.activity > 0.3 && s.bars() >= 24)
            .unwrap();
        let lake = chain
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Lake && s.bars() >= 16)
            .unwrap();
        for sec in [groove, lake] {
            // Two alerts early in the second phrase: one fill.
            let at = sec.start_ms + 9.5 * sec.bar_ms();
            let alerts = [
                AlertEvent {
                    ms: at,
                    route_kind: 1,
                    severe: true,
                },
                AlertEvent {
                    ms: at + 500.0,
                    route_kind: 0,
                    severe: false,
                },
            ];
            let valley = Valley {
                alerts: &alerts,
                ..Valley::quiet(&schedule, &network, &sky, &slow)
            };
            let mut state = ComposeState::default();
            let mut bar = Bar::default();
            let mut captions = 0;
            for b in 0..17 {
                compose(sec, b, &valley, &mut state, &mut bar);
                captions += bar
                    .features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::ServiceAlert)
                    .count();
                let toms = bar
                    .notes
                    .iter()
                    .filter(|n| n.inst == Inst::Tom && n.variant == 0)
                    .count();
                let swell = bar
                    .notes
                    .iter()
                    .any(|n| n.inst == Inst::Crash && n.variant == 2);
                let crash = bar
                    .notes
                    .iter()
                    .find(|n| n.inst == Inst::Crash && n.at_ms == bar.start_ms);
                match (sec.kind, b) {
                    (SectionKind::Groove, 15) => assert_eq!(toms, 5, "a severe alert's longer run"),
                    (SectionKind::Lake, 15) => assert!(swell && toms == 0),
                    (_, 16) => assert!(crash.is_some(), "the crash after it"),
                    (SectionKind::Groove, _) if b % 8 != 7 => assert_eq!(toms, 0),
                    _ => assert!(!swell),
                }
            }
            assert_eq!(captions, 1, "one alert caption for the phrase");
        }
    }

    #[test]
    fn rail_alerts_in_effect_hold_the_tension_up() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let sec = chain.sections.iter().find(|s| s.tension < 0.4).unwrap();
        let windows = [AlertWindow {
            from_ms: sec.start_ms,
            to_ms: sec.end_ms(),
            active: [60, 1, 0, 0],
        }];
        let valley = Valley {
            alert_windows: &windows,
            ..Valley::quiet(&schedule, &network, &sky, &slow)
        };
        assert!(bar_ctx(sec, 0, &valley).tension >= 0.5);
        let quiet = Valley::quiet(&schedule, &network, &sky, &slow);
        assert_eq!(bar_ctx(sec, 0, &quiet).tension, sec.tension);
        let buses_only = [AlertWindow {
            active: [60, 0, 0, 2],
            ..windows[0]
        }];
        let valley = Valley {
            alert_windows: &buses_only,
            ..Valley::quiet(&schedule, &network, &sky, &slow)
        };
        assert_eq!(bar_ctx(sec, 0, &valley).tension, sec.tension);
    }

    #[test]
    fn frontrunner_due_at_central_is_said_once_a_train() {
        let (mut schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let sec = chain.sections[60];
        let due = sec.start_ms + 8.0 * sec.bar_ms() + 200_000.0;
        // Windows from the section's start, all saying the same train is due.
        let mut w = sec.start_ms;
        while w < sec.start_ms + 600_000.0 {
            schedule.perform(w, w + 30_000.0, &[], due);
            w += 30_000.0;
        }
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
        let mut state = ComposeState::default();
        let mut bar = Bar::default();
        let mut said = Vec::new();
        for b in 0..sec.bars() {
            compose(&sec, b, &valley, &mut state, &mut bar);
            said.extend(
                bar.features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Due)
                    .map(|f| (f.value, f.event_ms)),
            );
        }
        assert_eq!(said.len(), 1, "{said:?}");
        let (minutes, ev) = said[0];
        assert_eq!(ev, due);
        assert!((2.0..=4.0).contains(&minutes), "{minutes}");
    }

    #[test]
    fn planes_swell_in_chord_tones_one_at_a_time_and_move_with_the_harmony() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let first = &chain.sections[40];
        // A plane every ten seconds for an hour: departures and arrivals,
        // airlines and private.
        let planes: Vec<PlaneEvent> = (0..360)
            .map(|i| PlaneEvent {
                ms: first.start_ms + 3_000.0 + f64::from(i) * 10_000.0,
                lat: 40.79 + 0.01 * (i % 5) as f32,
                lon: -111.98,
                alt_ft: 5_000.0 + 1_000.0 * (i % 8) as f32,
                arrival: i % 3 == 0,
                size: 1 + (i % 5) as u8,
                airline: i % 4 != 0,
            })
            .collect();
        let valley = Valley {
            planes: &planes,
            ..Valley::quiet(&schedule, &network, &sky, &slow)
        };
        let mut onsets: Vec<(f64, f64)> = Vec::new();
        let (mut ups, mut downs, mut captions) = (0, 0, 0);
        let mut bar = Bar::default();
        let mut swells: Vec<(u8, f64, f32, bool)> = Vec::new();
        for sec in chain.sections.iter().skip(40).take(25) {
            let mut state = ComposeState::default();
            for b in 0..sec.bars() {
                compose(sec, b, &valley, &mut state, &mut bar);
                let chord = bar.harmony[0].chord;
                let (pcs, n) = chord.pitch_classes();
                let mut phrase_named = 0;
                for f in bar.features.iter().filter(|f| f.kind == FeatureKind::Plane) {
                    let p = planes.iter().find(|p| p.ms == f.event_ms).unwrap();
                    assert!(p.airline, "a private aircraft named");
                    phrase_named += 1;
                    captions += 1;
                }
                assert!(phrase_named <= 1);
                for note in bar.notes.iter().filter(|n| n.inst == Inst::Swell) {
                    let m = note.midi as i32;
                    assert!((SWELL_LO..=SWELL_HI).contains(&m), "{m}");
                    assert!(
                        pcs[..n].contains(&(m.rem_euclid(12) as u8)),
                        "{m} isn't in {} (bar {b} of {}, at +{:.0} ms, variant {})",
                        chord.symbol(),
                        sec.bars(),
                        note.at_ms - bar.start_ms,
                        note.variant
                    );
                    assert!(
                        note.at_ms + f64::from(note.dur_ms) <= sec.end_ms() + 1.0,
                        "past the section's end"
                    );
                    let voice = note.variant & 3;
                    if note.variant & 4 != 0 {
                        assert_eq!(note.at_ms, bar.start_ms, "a voice moves on the downbeat");
                        if voice & 1 == 1
                            && let Some(s) = swells.iter_mut().find(|s| s.0 == voice)
                        {
                            if note.midi > s.2 && !s.3 {
                                ups += 1;
                            } else if note.midi < s.2 && s.3 {
                                downs += 1;
                            }
                            s.2 = note.midi;
                        }
                    } else {
                        if voice & 1 == 0 {
                            onsets.push((note.at_ms, f64::from(note.dur_ms)));
                        }
                        swells.retain(|s| s.0 != voice);
                        swells.push((voice, note.at_ms, note.midi, note.variant & 8 != 0));
                    }
                }
                if b % 8 == 7 {
                    state.phrase_plane = false;
                }
            }
        }
        assert!(onsets.len() > 30, "{} swells", onsets.len());
        for w in onsets.windows(2) {
            assert!(
                w[1].0 - w[0].0 >= PLANE_GAP_MS - 1.0,
                "two swells {} ms apart",
                w[1].0 - w[0].0
            );
        }
        assert!(
            ups > 3 && downs > 3,
            "{ups} departures rose, {downs} arrivals fell"
        );
        assert!(captions > 3);
    }

    #[test]
    fn the_roads_hang_the_harmony_and_bring_it_home_boom_in_the_canyon_and_brush_the_drums() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let slow = Slow::default();
        let snowing = sky_with(&schedule, |h| h.mtn_snow_cm = 1.0);
        let sec = *chain
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Groove && s.activity > 0.3 && s.bars() >= 16)
            .unwrap();
        let bar_at = |b: u32| sec.start_ms + f64::from(b) * sec.bar_ms();
        let roads = [
            RoadEvent {
                ms: bar_at(2) + 100.0,
                kind: 0,
                road: 0,
                lat: 40.75,
                lon: -111.9,
            },
            RoadEvent {
                ms: bar_at(4) + 100.0,
                kind: 1,
                road: 0,
                lat: 40.75,
                lon: -111.9,
            },
            RoadEvent {
                ms: bar_at(9) + 100.0,
                kind: 2,
                road: 1,
                lat: 40.57,
                lon: -111.7,
            },
        ];
        let windows = [RoadWindow {
            from_ms: sec.start_ms,
            to_ms: sec.end_ms(),
            traction: [true, false],
            plows: 41,
            closures: 1,
        }];
        let valley = Valley {
            roads: &roads,
            road_windows: &windows,
            ..Valley::quiet(&schedule, &network, &snowing, &slow)
        };
        let mut state = ComposeState::default();
        let mut bar = Bar::default();
        let (mut pedals, mut brushes, mut booms, mut cards) = (0, 0, 0, 0);
        for b in 0..16 {
            compose(&sec, b, &valley, &mut state, &mut bar);
            let ctx = bar_ctx(&sec, b, &valley);
            assert!(ctx.tension >= 0.45, "a closure standing holds tension");
            let chord = bar.harmony[0].chord;
            match b {
                2 => assert!(
                    matches!(chord.color, Color::Sus2 | Color::Sus4) || chord.suspended() == chord,
                    "{}",
                    chord.symbol()
                ),
                4 => assert_eq!(chord.degree, 0, "it clears, and comes home"),
                _ => {}
            }
            for n in &bar.notes {
                match n.inst {
                    Inst::Swell if n.variant & 128 != 0 => {
                        assert_eq!(
                            (n.midi as i32).rem_euclid(12),
                            i32::from(sec.key.tonic_pc())
                        );
                        assert!(n.midi >= 38.0 && n.midi < 50.0);
                        assert_eq!(n.at_ms, bar.start_ms);
                        pedals += 1;
                    }
                    Inst::Snare if n.vel < 0.2 => brushes += 1,
                    Inst::Tom if n.variant == 4 => {
                        assert!(n.lat > 40.5 && n.lat < 40.6, "up Little Cottonwood");
                        booms += 1;
                    }
                    _ => {}
                }
            }
            cards += bar
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Road)
                .count();
        }
        assert_eq!(pedals, 2, "a pedal a phrase");
        assert!(brushes >= 16 * 4, "{brushes} brushes");
        assert_eq!(booms, 2);
        assert_eq!(cards, 3);
        // No snow, no brushes; no roads, no tension.
        let dry = Sky::default();
        let valley = Valley {
            road_windows: &windows,
            ..Valley::quiet(&schedule, &network, &dry, &slow)
        };
        compose(&sec, 5, &valley, &mut state, &mut bar);
        assert!(
            !bar.notes
                .iter()
                .any(|n| n.inst == Inst::Snare && n.vel < 0.2)
        );
        let quiet = Valley::quiet(&schedule, &network, &dry, &slow);
        assert_eq!(bar_ctx(&sec, 5, &quiet).tension, sec.tension);
    }

    #[test]
    fn composing_is_deterministic() {
        let (schedule, network) = valley_fixture();
        let t0 = schedule.days[0].t0_ms;
        let sky = Sky::default();
        let chain = plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &schedule, &sky);
        let slow = Slow::default();
        let valley = Valley::quiet(&schedule, &network, &sky, &slow);
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

    /// Every bar of `sec` composed with `slow`.
    fn bars_with(
        schedule: &Schedule,
        network: &Network,
        sec: &Section,
        slow: Slow,
        bikes: &[BikeEvent],
    ) -> Vec<Bar> {
        let sky = Sky::default();
        let valley = Valley {
            bikes,
            ..Valley::quiet(schedule, network, &sky, &slow)
        };
        let mut st = ComposeState::default();
        (0..sec.bars())
            .map(|b| {
                let mut bar = Bar::default();
                compose(sec, b, &valley, &mut st, &mut bar);
                bar
            })
            .collect()
    }

    #[test]
    fn the_rivers_grade_the_bass() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let sec = chain
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Groove && s.activity > 0.5)
            .expect("a busy groove");
        // The most bass notes in any bar, at a river's place against usual.
        let most = |river: f32| {
            bars_with(
                &schedule,
                &network,
                sec,
                Slow {
                    river,
                    ..Slow::default()
                },
                &[],
            )
            .iter()
            .map(|b| b.notes.iter().filter(|n| n.inst == Inst::Bass).count())
            .max()
            .unwrap_or(0)
        };
        assert_eq!(most(0.1), 1, "low water holds one long note");
        assert_eq!(most(0.45), 2, "usual water: the root and the fifth");
        assert_eq!(most(0.7), 4, "high water walks");
        assert_eq!(most(0.95), 6, "a flood walks in eighths");
    }

    #[test]
    fn a_deep_snowpack_spreads_the_ninth() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let add9s = |snowpack: f32| {
            chain
                .sections
                .iter()
                .filter(|s| s.kind == SectionKind::Groove)
                .take(6)
                .flat_map(|sec| {
                    bars_with(
                        &schedule,
                        &network,
                        sec,
                        Slow {
                            snowpack,
                            ..Slow::default()
                        },
                        &[],
                    )
                })
                .flat_map(|b| b.harmony)
                .filter(|h| h.chord.color == crate::music::Color::Add9)
                .count()
        };
        let (thin, full, deep) = (add9s(0.7), add9s(1.1), add9s(1.4));
        assert_eq!(thin, 0, "a thin year: no ninths outside the Atmosphere");
        assert!(
            full > 0 && deep > full,
            "ninths: {thin} thin, {full} full, {deep} deep"
        );
    }

    #[test]
    fn a_powder_morning_plays_the_theme_fuller() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let sec = chain
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Theme)
            .expect("first light");
        let piano = |new_snow_in: f32| {
            bars_with(
                &schedule,
                &network,
                sec,
                Slow {
                    new_snow_in,
                    ..Slow::default()
                },
                &[],
            )
            .iter()
            .flat_map(|b| {
                b.notes
                    .iter()
                    .filter(|n| n.inst == Inst::Piano)
                    .map(|n| n.vel)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
        };
        let (dry, pow) = (piano(0.0), piano(8.0));
        assert!(
            pow.len() > dry.len(),
            "a powder day doubles the high statement"
        );
        let sum = |v: &[f32]| v.iter().sum::<f32>() / v.len() as f32;
        assert!(
            pow.iter().take(dry.len()).sum::<f32>() > dry.iter().sum::<f32>(),
            "and plays harder"
        );
        assert!(sum(&pow) <= 1.0);
    }

    #[test]
    fn a_bike_leaving_rings_above_one_coming_back() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let sec = chain
            .sections
            .iter()
            .find(|s| mix_for(s, 1).bikes > 0.0 && s.bars() >= 2)
            .expect("a section with bikes in it");
        let bar_ms = sec.bar_ms();
        let at = sec.start_ms + bar_ms * 1.25;
        let pluck = |delta: i8| {
            let bike = [BikeEvent {
                ms: at,
                lat: 40.75,
                lon: -111.89,
                delta,
                station: 0,
            }];
            bars_with(&schedule, &network, sec, Slow::default(), &bike)
                .iter()
                .flat_map(|b| b.notes.clone())
                .find(|n| n.inst == Inst::Marimba)
                .map(|n| n.midi)
                .expect("a pluck")
        };
        assert_eq!(pluck(-1) - pluck(1), 12.0);
    }

    #[test]
    fn a_quake_rings_by_its_depth() {
        let (schedule, network) = valley_fixture();
        let chain = fixture_chain(&schedule);
        let (sky, slow) = (Sky::default(), Slow::default());
        let sec = &chain.sections[30];
        let ring = |depth_km: f32| {
            let quakes = [QuakeEvent {
                ms: sec.start_ms + 1_000.0,
                origin_ms: sec.start_ms,
                mag: 2.5,
                lat: 40.7,
                lon: -111.9,
                depth_km,
            }];
            let valley = Valley {
                quakes: &quakes,
                ..Valley::quiet(&schedule, &network, &sky, &slow)
            };
            let mut bar = Bar::default();
            compose(sec, 0, &valley, &mut ComposeState::default(), &mut bar);
            let n = bar
                .notes
                .iter()
                .find(|n| n.inst == Inst::QuakeBell)
                .copied()
                .expect("a bell");
            (n.midi, n.dur_ms)
        };
        let (shallow, mid, deep, unknown) = (ring(2.0), ring(8.0), ring(18.0), ring(f32::NAN));
        assert!(
            shallow.0 > mid.0 && mid.0 > deep.0,
            "{shallow:?} {mid:?} {deep:?}"
        );
        assert!(deep.1 > mid.1 && mid.1 > shallow.1);
        assert_eq!(unknown, mid, "an unknown depth rings as before");
    }
}
