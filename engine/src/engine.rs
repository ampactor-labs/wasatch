//! The engine: inputs in, a planned day, bars composed a moment ahead, voices
//! triggered on the sample, the room and the master, and an outbox of events
//! for the page.
//!
//! Time has two clocks. The audio clock counts frames. The listening clock is
//! wall-clock UTC minus the broadcast delay; the score lives on it. The host
//! keeps them tied with [`Engine::set_clock`].

use crate::audio::Noise;
use crate::audio::homes::{self, Bus, HOMES, Home, Homes};
use crate::audio::master::{Master, energy_db, warmth_for};
use crate::audio::skyline::SkylineTables;
use crate::audio::space::{Room, Vantage, place};
use crate::audio::voices::{
    Air, Bass, DrumKind, DrumVoice, HarpString, Hit, HornVoice, LakePedal, ModalVoice, Out,
    PadVoice, PianoSample, PianoVoice, Placement, SwellVoice, bell_partials,
};
use crate::compose::{
    AlertEvent, AlertWindow, Bar, BikeEvent, ComposeState, Feature, Harmony, Inst, Mix, Note,
    PlaneEvent, QuakeEvent, Slow, Valley, compose,
};
use crate::listener::{self, SoloNote};
use crate::music::midi_hz;
use crate::plan::{ANCHOR_HOURS, Chain, Section, Sky, SkyHour, plan_chain};
use crate::schedule::{Network, Schedule, ServiceDay};
use crate::twelve::{self, DayRun};
use sonido_core::Upconverter;
use sonido_synth::modal::presets;
use std::fmt::Write as _;

/// The broadcast delay: the stream plays this far behind live.
pub const DELAY_MS: f64 = 90_000.0;
/// Bars are composed this far ahead of when they sound.
const LOOKAHEAD_MS: f64 = 1000.0;
/// Largest render quantum.
pub const MAX_FRAMES: usize = 4096;

/// Everything the composer reads.
#[derive(Default)]
pub struct Inputs {
    /// The schedule.
    pub schedule: Schedule,
    /// Routes and stops.
    pub network: Network,
    /// Hourly sky.
    pub sky: Sky,
    /// Slow values.
    pub slow: Slow,
    /// GREENbike dock changes, by time.
    pub bikes: Vec<BikeEvent>,
    /// Quakes, by time.
    pub quakes: Vec<QuakeEvent>,
    /// Planes taking off and landing, by time.
    pub planes: Vec<PlaneEvent>,
    /// New service alerts, by time.
    pub alerts: Vec<AlertEvent>,
    /// The service alerts in effect, window by window.
    pub alert_windows: Vec<AlertWindow>,
    version: u64,
}

impl Inputs {
    fn valley(&self) -> Valley<'_> {
        Valley {
            schedule: &self.schedule,
            network: &self.network,
            sky: &self.sky,
            slow: &self.slow,
            bikes: &self.bikes,
            quakes: &self.quakes,
            planes: &self.planes,
            alerts: &self.alerts,
            alert_windows: &self.alert_windows,
        }
    }
}

/// A conductor's window of events into a list: the window's rows replace
/// whatever it had before (a window posted again replaces itself), and an
/// hour is kept.
fn merge_window<T>(
    list: &mut Vec<T>,
    from_ms: f64,
    to_ms: f64,
    rows: Vec<T>,
    ms: impl Fn(&T) -> f64,
) {
    if to_ms <= from_ms {
        return;
    }
    list.retain(|e| ms(e) < from_ms || ms(e) >= to_ms);
    list.extend(
        rows.into_iter()
            .filter(|e| ms(e) >= from_ms && ms(e) < to_ms),
    );
    list.sort_by(|a, b| ms(a).total_cmp(&ms(b)));
    let horizon = to_ms - 3_600_000.0;
    list.retain(|e| ms(e) > horizon);
}

/// Where composition stands.
#[derive(Clone, Copy, Debug)]
struct Cursor {
    section: Section,
    bar: u32,
}

/// The engine.
pub struct Engine {
    sr: f32,
    /// What the music reads.
    pub inputs: Inputs,
    chain: Option<Chain>,
    chain_version: u64,
    clock: Option<(f64, f64)>,
    frame: f64,
    cursor: Option<Cursor>,
    compose_state: ComposeState,
    scratch: Bar,
    pending: Vec<Note>,
    /// Harmony changes to apply, with the section, the bar and (in A Day in
    /// Twelve Minutes) the moment of the day the bar stands for.
    harmonies: Vec<(Harmony, Mix, Section, u32, f64)>,
    features: Vec<Feature>,
    mix: Mix,
    mix_target: Mix,
    started: bool,
    fade_in_at: Option<f64>,
    samples: Vec<PianoSample>,
    tables: SkylineTables,
    piano: Vec<PianoVoice>,
    pad: Vec<PadVoice>,
    bass: Bass,
    lake: LakePedal,
    drums: Vec<DrumVoice>,
    bells: Vec<ModalVoice<2>>,
    marimbas: Vec<ModalVoice<1>>,
    /// The listener's own voice, for playing along.
    vibes: Vec<ModalVoice<2>>,
    /// The chord sounding now.
    now_chord: Option<Harmony>,
    /// A run, played as a solo; `solo_at` is its first beat (listening ms)
    /// and the length of a beat.
    solo: Vec<SoloNote>,
    solo_at: Option<(f64, f64)>,
    solo_next: usize,
    /// A Day in Twelve Minutes, playing or asked for.
    day: Option<DayRun>,
    day_request: Option<u32>,
    grains: Vec<ModalVoice<2>>,
    quake_bells: Vec<ModalVoice<2>>,
    horns: Vec<HornVoice>,
    /// Planes' swells: two voices a plane, two planes' worth.
    swells: [SwellVoice; 4],
    harp: Vec<HarpString>,
    air: Air,
    ground: [Upconverter<64>; 4],
    /// Where each ground band's station is.
    ground_at: [(f32, f32); 4],
    noise: Noise,
    rr: [usize; 9],
    vantage: Vantage,
    /// Where each family lives, and its bus staged from the vantage.
    homes: Homes,
    buses: [Bus; HOMES],
    /// Which drum voices are sounding something with a place of its own (a
    /// ski bus's toms), rather than the city's kit.
    kit_located: [bool; 12],
    room: Room,
    master: Master,
    inversion: f32,
    haze: f32,
    pad_cutoff: f32,
    wind: (f32, f32),
    out: Vec<f32>,
    outbox: String,
}

impl Engine {
    /// An engine at `sr`.
    pub fn new(sr: f32) -> Self {
        let mut engine = Engine {
            sr,
            inputs: Inputs::default(),
            chain: None,
            chain_version: u64::MAX,
            clock: None,
            frame: 0.0,
            cursor: None,
            compose_state: ComposeState::default(),
            scratch: Bar::default(),
            pending: Vec::with_capacity(512),
            harmonies: Vec::with_capacity(16),
            features: Vec::with_capacity(64),
            mix: Mix::default(),
            mix_target: Mix::default(),
            started: false,
            fade_in_at: None,
            samples: Vec::new(),
            tables: SkylineTables::fallback(),
            piano: (0..16).map(|_| PianoVoice::default()).collect(),
            pad: (0..8).map(|_| PadVoice::new(sr)).collect(),
            bass: Bass::new(sr),
            lake: LakePedal::new(sr),
            drums: (0..12).map(|i| DrumVoice::new(sr, i + 1)).collect(),
            bells: (0..6).map(|_| ModalVoice::new(sr)).collect(),
            marimbas: (0..6).map(|_| ModalVoice::new(sr)).collect(),
            vibes: (0..6).map(|_| ModalVoice::new(sr)).collect(),
            now_chord: None,
            solo: Vec::new(),
            solo_at: None,
            solo_next: 0,
            day: None,
            day_request: None,
            grains: (0..10).map(|_| ModalVoice::new(sr)).collect(),
            quake_bells: (0..2).map(|_| ModalVoice::new(sr)).collect(),
            horns: (0..10).map(|_| HornVoice::new(sr)).collect(),
            swells: core::array::from_fn(|i| SwellVoice::new(sr, 0x5E11 + i as u32)),
            harp: (0..6).map(|_| HarpString::new()).collect(),
            air: Air::new(sr),
            ground: core::array::from_fn(|_| Upconverter::new(sr, 10.0)),
            ground_at: [(40.7711, -111.8872); 4],
            noise: Noise::new(0x5A17),
            rr: [0; 9],
            vantage: Vantage::Everywhere,
            homes: Homes::new(),
            buses: core::array::from_fn(|_| Bus::new(sr)),
            kit_located: [false; 12],
            room: Room::new(sr),
            master: Master::new(sr),
            inversion: 0.0,
            haze: 0.0,
            pad_cutoff: 2400.0,
            wind: (3.0, 5.0),
            out: vec![0.0; 2 * MAX_FRAMES],
            outbox: String::with_capacity(16_384),
        };
        engine.restage(true);
        engine
    }

    /// The sample rate.
    pub fn sample_rate(&self) -> f32 {
        self.sr
    }

    fn touched(&mut self) {
        self.inputs.version = self.inputs.version.wrapping_add(1);
    }

    /// Add or replace a service day.
    pub fn set_day(&mut self, day: ServiceDay) {
        self.inputs.schedule.insert(day);
        self.touched();
    }

    /// Set the routes and stops.
    pub fn set_network(&mut self, network: Network) {
        self.inputs.network = network;
    }

    /// Record an hour of sky.
    pub fn set_sky_hour(&mut self, utc_hour_ms: f64, hour: SkyHour) {
        self.inputs.sky.set(utc_hour_ms, hour);
        self.touched();
    }

    /// Set the slow values.
    pub fn set_slow(&mut self, slow: Slow) {
        self.inputs.slow = slow;
    }

    /// Replace the bike events.
    pub fn set_bikes(&mut self, mut bikes: Vec<BikeEvent>) {
        bikes.sort_by(|a, b| a.ms.total_cmp(&b.ms));
        self.inputs.bikes = bikes;
    }

    /// Replace the quakes.
    pub fn set_quakes(&mut self, mut quakes: Vec<QuakeEvent>) {
        quakes.sort_by(|a, b| a.ms.total_cmp(&b.ms));
        self.inputs.quakes = quakes;
    }

    /// A conductor's window of planes taking off and landing.
    pub fn set_planes(&mut self, from_ms: f64, to_ms: f64, planes: Vec<PlaneEvent>) {
        merge_window(&mut self.inputs.planes, from_ms, to_ms, planes, |p| p.ms);
    }

    /// A conductor's window of new service alerts, and the alerts in effect
    /// as it was sealed.
    pub fn set_alerts(
        &mut self,
        from_ms: f64,
        to_ms: f64,
        active: [u8; 4],
        alerts: Vec<AlertEvent>,
    ) {
        merge_window(&mut self.inputs.alerts, from_ms, to_ms, alerts, |a| a.ms);
        if to_ms <= from_ms {
            return;
        }
        let windows = &mut self.inputs.alert_windows;
        windows.retain(|w| w.to_ms <= from_ms || w.from_ms >= to_ms);
        windows.push(AlertWindow {
            from_ms,
            to_ms,
            active,
        });
        windows.sort_by(|a, b| a.from_ms.total_cmp(&b.from_ms));
        let horizon = to_ms - 6.0 * 3_600_000.0;
        windows.retain(|w| w.to_ms > horizon);
    }

    /// Move the listener, and say what's near and far from there.
    pub fn set_vantage(&mut self, code: u32) {
        self.vantage = Vantage::from_code(code);
        self.room.set(self.vantage, self.inversion);
        self.restage(false);
        let near = homes::ALL.map(|h| self.homes.stage(h, self.vantage, self.inversion).gain);
        let rail = homes::nearness(
            self.inputs.network.stops.iter().map(|s| (s.lat, s.lon)),
            self.vantage,
        );
        let at = self.vantage.point().map_or_else(
            || "null,\"lon\":null,\"face\":null".to_owned(),
            |(lat, lon, face)| format!("{lat:.4},\"lon\":{lon:.4},\"face\":{face:.0}"),
        );
        let _ = writeln!(
            self.outbox,
            r#"{{"t":"vantage","f":{:.0},"v":{},"lat":{at},"near":[{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2}],"rail":{rail:.2}}}"#,
            self.frame,
            self.vantage as u8,
            near[0],
            near[1],
            near[2],
            near[3],
            near[4],
            near[5],
            near[6],
        );
    }

    /// Stage every family's bus from the vantage, gliding there (or at once).
    fn restage(&mut self, snap: bool) {
        for h in homes::ALL {
            let bus = &mut self.buses[h as usize];
            bus.set(self.homes.stage(h, self.vantage, self.inversion));
            if snap {
                bus.snap();
            }
        }
    }

    /// The skyline profile (elevations, north to south) the pad is made of.
    pub fn set_skyline(&mut self, elev: &[f32]) {
        if elev.len() >= 8 {
            self.tables = SkylineTables::from_profile(elev);
        }
    }

    /// Add a decoded piano sample.
    pub fn add_sample(&mut self, sample: PianoSample) {
        self.samples.retain(|s| s.midi != sample.midi);
        self.samples.push(sample);
        self.samples.sort_by_key(|s| s.midi);
    }

    /// A conductor's window of rail departures, `from_ms` to `to_ms`, and
    /// when the next FrontRunner was due at Salt Lake Central (0 unknown).
    pub fn perform(
        &mut self,
        from_ms: f64,
        to_ms: f64,
        events: &[crate::schedule::RailEvent],
        due_ms: f64,
    ) {
        self.inputs.schedule.perform(from_ms, to_ms, events, due_ms);
    }

    /// Push baseband samples for a ground band, from a station at `lat`, `lon`.
    pub fn push_ground(&mut self, band: usize, lat: f32, lon: f32, iq: &[(f32, f32)]) {
        if let Some(at) = self.ground_at.get_mut(band)
            && lat.is_finite()
            && lon.is_finite()
        {
            *at = (lat, lon);
        }
        if let Some(up) = self.ground.get_mut(band) {
            for &(i, q) in iq {
                up.push(i, q);
            }
        }
    }

    /// Tie the audio clock to wall-clock UTC: `frame` sounded at `utc_ms`.
    /// Small errors slew; a jump of more than half a second re-locates.
    pub fn set_clock(&mut self, frame: f64, utc_ms: f64) {
        match self.clock {
            None => self.clock = Some((frame, utc_ms)),
            Some((f0, u0)) => {
                let predicted = u0 + (frame - f0) * 1000.0 / f64::from(self.sr);
                let err = utc_ms - predicted;
                if err.abs() > 500.0 {
                    self.clock = Some((frame, utc_ms));
                    self.relocate();
                } else {
                    // Take a tenth of the error each time: a slew.
                    self.clock = Some((frame, predicted + 0.1 * err));
                }
            }
        }
    }

    fn relocate(&mut self) {
        self.cursor = None;
        self.pending.clear();
        self.harmonies.clear();
        self.features.clear();
    }

    /// The listening time at an audio frame.
    pub fn listening_ms(&self, frame: f64) -> Option<f64> {
        let (f0, u0) = self.clock?;
        Some(u0 + (frame - f0) * 1000.0 / f64::from(self.sr) - DELAY_MS)
    }

    /// Begin: play the welcome (the theme, now, local) and fade the stream
    /// in at the next bar.
    pub fn start(&mut self) {
        self.started = true;
        let Some(l) = self.listening_ms(self.frame) else {
            return;
        };
        self.ensure_chain(l);
        if self.cursor.is_none() {
            self.locate(l);
        }
        let (key, bpm) = self
            .cursor
            .map(|c| (c.section.key, c.section.bpm))
            .unwrap_or((crate::music::Key::new(0, 1), 84.0));
        let beat_ms = 60_000.0 / f64::from(bpm.max(60.0));
        for n in crate::theme::notes(key) {
            self.pending.push(Note {
                at_ms: l + 120.0 + f64::from(n.beat) * beat_ms,
                inst: Inst::Piano,
                midi: n.midi as f32,
                vel: n.velocity,
                dur_ms: (f64::from(n.beats) * beat_ms * 1.4) as f32,
                variant: 100 + n.summit as u8,
                lat: f32::NAN,
                lon: f32::NAN,
                feature: crate::compose::NO_FEATURE,
            });
        }
        self.sort_pending();
        let next_bar = self
            .cursor
            .map(|c| c.section.start_ms + f64::from(c.bar) * c.section.bar_ms())
            .unwrap_or(l);
        self.fade_in_at = Some(next_bar);
    }

    /// Fade out.
    pub fn stop(&mut self) {
        self.master.set_fade(false);
        self.fade_in_at = None;
    }

    /// The key sounding now (the home key before anything is planned).
    fn key_now(&self) -> crate::music::Key {
        self.cursor
            .map_or(crate::music::Key::new(0, 1), |c| c.section.key)
    }

    /// Play along: a note on the listener's own vibraphone, picked by a ski's
    /// edge (−1…1) from the notes in play; a steady edge plays chord tones.
    pub fn play(&mut self, edge: f32, vel: f32, steady: bool) {
        let tones = self
            .now_chord
            .map_or(([0u8; 4], 0), |h| (h.tones, usize::from(h.n_tones)));
        let midi = listener::edge_note(self.key_now(), &tones.0[..tones.1], edge, steady);
        let f = midi_hz(midi as f32);
        let pan = edge.clamp(-1.0, 1.0) * 0.45;
        let (gl, gr) = crate::audio::pan_gains(pan);
        let place = Placement {
            gl,
            gr,
            send: 0.3,
            cut: 0.0,
            canyon: 0.0,
        };
        let i = pick(&mut self.rr[8], self.vibes.iter().map(|v| v.is_active()));
        let decay = if steady { 1.3 } else { 0.55 };
        self.vibes[i].strike_modes(
            f,
            presets::VIBRAPHONE,
            decay,
            Hit {
                vel: vel.clamp(0.05, 1.0),
                hardness: if steady { 0.35 } else { 0.6 },
                gain: 0.32,
            },
            place,
        );
        let _ = writeln!(
            self.outbox,
            r#"{{"t":"play","f":{:.0},"m":{midi}}}"#,
            self.frame
        );
    }

    /// A Day in Twelve Minutes: play service date `date` (yyyymmdd) as its
    /// own piece from the next bar line; 0 returns to the live valley.
    pub fn twelve(&mut self, date: u32) {
        self.day_request = None;
        if date != 0 {
            self.day_request = Some(date);
            return;
        }
        if self.day.take().is_some() {
            if let Some(l) = self.listening_ms(self.frame) {
                self.pending.retain(|n| n.at_ms < l);
                self.harmonies.retain(|h| h.0.at_ms < l);
                self.features.retain(|f| f.at_ms < l);
            }
            self.cursor = None;
        }
    }

    /// Switch to the day at the bar the cursor would compose next.
    fn begin_day(&mut self, date: u32, l: f64) {
        let Some(t0) = self
            .inputs
            .schedule
            .days
            .iter()
            .find(|d| d.date == date)
            .map(|d| d.t0_ms)
        else {
            let _ = writeln!(
                self.outbox,
                r#"{{"t":"day","f":{:.0},"date":{date},"ok":false}}"#,
                self.frame
            );
            return;
        };
        let piece0 = self
            .cursor
            .map_or(l + 300.0, |c| {
                c.section.start_ms + f64::from(c.bar) * c.section.bar_ms()
            })
            .max(l + 50.0);
        let run = twelve::plan_day(date, t0, piece0, &self.inputs.schedule, &self.inputs.sky);
        self.pending.retain(|n| n.at_ms < piece0);
        self.harmonies.retain(|h| h.0.at_ms < piece0);
        self.features.retain(|f| f.at_ms < piece0);
        self.compose_state = ComposeState::default();
        self.cursor = run
            .chain
            .sections
            .first()
            .map(|&section| Cursor { section, bar: 0 });
        let _ = writeln!(
            self.outbox,
            r#"{{"t":"day","f":{:.0},"date":{date},"ok":true,"anchor":{:.0},"speed":{:.4}}}"#,
            self.frame,
            run.anchor,
            run.speed()
        );
        self.day = Some(run);
    }

    /// A run's solo, starting at the next bar line; empty stops it.
    pub fn set_solo(&mut self, mut notes: Vec<SoloNote>) {
        notes.retain(|n| n.beat.is_finite() && n.beats.is_finite() && n.vel.is_finite());
        notes.sort_by(|a, b| a.beat.total_cmp(&b.beat));
        self.solo = notes;
        self.solo_next = 0;
        self.solo_at = None;
        if self.solo.is_empty() {
            return;
        }
        let Some(l) = self.listening_ms(self.frame) else {
            return;
        };
        let (start, beat_ms) = self.cursor.map_or((l + 500.0, 600.0), |c| {
            let bar_ms = c.section.bar_ms();
            let since = l - c.section.start_ms;
            let next = c.section.start_ms + ((since + 300.0) / bar_ms).ceil() * bar_ms;
            (next, bar_ms / 4.0)
        });
        self.solo_at = Some((start, beat_ms));
    }

    /// Queue the solo's notes that fall inside the lookahead.
    fn solo_ahead(&mut self, l: f64) {
        let Some((start, beat_ms)) = self.solo_at else {
            return;
        };
        let key = self.key_now();
        while let Some(n) = self.solo.get(self.solo_next) {
            let at = start + f64::from(n.beat) * beat_ms;
            if at > l + LOOKAHEAD_MS {
                break;
            }
            if at >= l - 50.0 {
                self.pending.push(Note {
                    at_ms: at,
                    inst: Inst::Piano,
                    midi: listener::solo_midi(key, n.degree) as f32,
                    vel: n.vel.clamp(0.1, 1.0),
                    dur_ms: (f64::from(n.beats.max(0.25)) * beat_ms * 1.2) as f32,
                    variant: 200,
                    lat: f32::NAN,
                    lon: f32::NAN,
                    feature: crate::compose::NO_FEATURE,
                });
            }
            self.solo_next += 1;
        }
        self.sort_pending();
        if self.solo_next >= self.solo.len() {
            self.solo_at = None;
        }
    }

    fn sort_pending(&mut self) {
        self.pending.sort_unstable_by(|a, b| {
            a.at_ms
                .total_cmp(&b.at_ms)
                .then((a.inst as u8).cmp(&(b.inst as u8)))
        });
    }

    /// Plan (or re-plan) the chain covering `l`.
    fn ensure_chain(&mut self, l: f64) {
        let days = &self.inputs.schedule.days;
        // The chain day: the latest service day whose 05:00 anchor has passed.
        let anchor = |t0: f64| t0 + ANCHOR_HOURS * 3_600_000.0;
        // Only a day whose chain actually covers `l` will do; a stale schedule
        // falls back to a day on Mountain time from the clock alone, so the
        // piece keeps playing (as written for the sky, with no transit).
        let covering = days.iter().enumerate().rev().find_map(|(i, d)| {
            let start = anchor(d.t0_ms);
            let end = days
                .get(i + 1)
                .map_or(start + 86_400_000.0, |n| anchor(n.t0_ms));
            (start <= l && l < end).then_some((d.date, d.t0_ms, end))
        });
        let (date, t0, end) = covering.unwrap_or_else(|| {
            // Local midnight's offset from UTC, from the nearest day we know
            // (6 h in summer, 7 in winter); MDT with nothing to go on.
            let offset = days
                .iter()
                .min_by(|a, b| (a.t0_ms - l).abs().total_cmp(&(b.t0_ms - l).abs()))
                .map_or(6.0 * 3_600_000.0, |d| d.t0_ms.rem_euclid(86_400_000.0));
            let t0 = ((l - offset - ANCHOR_HOURS * 3_600_000.0) / 86_400_000.0).floor()
                * 86_400_000.0
                + offset;
            (0, t0, anchor(t0) + 86_400_000.0)
        });
        let stale = self.chain_version != self.inputs.version;
        let wrong_day = self
            .chain
            .as_ref()
            .is_none_or(|c| c.date != date || !(c.anchor_ms <= l && l < c.end_ms));
        if stale || wrong_day {
            self.chain = Some(plan_chain(
                date,
                t0,
                end,
                &self.inputs.schedule,
                &self.inputs.sky,
            ));
            self.chain_version = self.inputs.version;
        }
    }

    /// Start composing at listening time `l`, mid-section if need be,
    /// replaying the section's earlier bars silently to rebuild the voicing.
    fn locate(&mut self, l: f64) {
        // A jump out of A Day in Twelve Minutes ends it.
        if self
            .day
            .as_ref()
            .is_some_and(|r| l < r.piece0 || l >= r.end())
        {
            self.day = None;
        }
        let sec = match &self.day {
            Some(run) => run.chain.section_at(l).copied(),
            None => self.chain.as_ref().and_then(|c| c.section_at(l)).copied(),
        };
        let Some(sec) = sec else {
            return;
        };
        let bar = (((l - sec.start_ms) / sec.bar_ms()).floor().max(0.0) as u32).min(sec.bars() - 1);
        self.compose_state = ComposeState::default();
        let valley = self.inputs.valley();
        // The section before's last bar, silently, for the crash its fill
        // owes this one's downbeat: a phone that joins now hears it too.
        if self.day.is_none()
            && let Some(prev) = self
                .chain
                .as_ref()
                .and_then(|c| c.section_at(sec.start_ms - 1.0))
                .copied()
            && (prev.end_ms() - sec.start_ms).abs() < 5.0
        {
            compose(
                &prev,
                prev.bars() - 1,
                &valley,
                &mut self.compose_state,
                &mut self.scratch,
            );
        }
        for b in 0..bar {
            match &self.day {
                Some(run) => twelve::compose_day(
                    &sec,
                    b,
                    run,
                    &valley,
                    &mut self.compose_state,
                    &mut self.scratch,
                ),
                None => compose(&sec, b, &valley, &mut self.compose_state, &mut self.scratch),
            }
        }
        self.cursor = Some(Cursor { section: sec, bar });
        self.compose_next(l - 50.0);
    }

    /// Compose the cursor's bar, queue it, and advance.
    fn compose_next(&mut self, not_before: f64) {
        let Some(cur) = self.cursor else {
            return;
        };
        let valley = self.inputs.valley();
        match &self.day {
            Some(run) => twelve::compose_day(
                &cur.section,
                cur.bar,
                run,
                &valley,
                &mut self.compose_state,
                &mut self.scratch,
            ),
            None => compose(
                &cur.section,
                cur.bar,
                &valley,
                &mut self.compose_state,
                &mut self.scratch,
            ),
        }
        let day_ms = self
            .day
            .as_ref()
            .map_or(0.0, |r| r.day_at(self.scratch.start_ms));
        for n in &self.scratch.notes {
            if n.at_ms >= not_before {
                self.pending.push(*n);
            }
        }
        for h in &self.scratch.harmony {
            self.harmonies
                .push((*h, self.scratch.mix, cur.section, cur.bar, day_ms));
        }
        for f in &self.scratch.features {
            if f.at_ms >= not_before {
                self.features.push(*f);
            }
        }
        self.sort_pending();
        self.features.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));

        // Advance.
        let next_bar = cur.bar + 1;
        if next_bar < cur.section.bars() {
            self.cursor = Some(Cursor {
                section: cur.section,
                bar: next_bar,
            });
            return;
        }
        let end = cur.section.end_ms();
        if let Some(run) = &self.day {
            match run.chain.section_at(end + 1.0).copied() {
                Some(section) => {
                    self.cursor = Some(Cursor { section, bar: 0 });
                }
                None => {
                    // The day is over: back to the valley as it is now.
                    self.day = None;
                    self.ensure_chain(end + 1.0);
                    self.locate(end + 1.0);
                }
            }
            return;
        }
        self.ensure_chain(end + 1.0);
        let next = self
            .chain
            .as_ref()
            .and_then(|c| c.section_at(end + 1.0))
            .copied();
        match next {
            Some(sec) if (sec.start_ms - end).abs() < 5.0 => {
                // The state carries on: a section's first bar resets all of
                // it but the crash the last section's fill owes it.
                self.cursor = Some(Cursor {
                    section: sec,
                    bar: 0,
                });
            }
            Some(_) => self.locate(end + 1.0),
            None => self.cursor = None,
        }
    }

    /// Compose bars whose start is within the lookahead of `l`.
    fn compose_ahead(&mut self, l: f64) {
        if let Some(date) = self.day_request.take() {
            self.begin_day(date, l);
        }
        self.ensure_chain(l);
        if self.cursor.is_none() {
            self.locate(l);
        }
        self.solo_ahead(l);
        let mut guard = 0;
        while let Some(c) = self.cursor {
            let start = c.section.start_ms + f64::from(c.bar) * c.section.bar_ms();
            if start > l + LOOKAHEAD_MS || guard > 8 {
                break;
            }
            self.compose_next(l - 50.0);
            guard += 1;
        }
    }

    fn placement(&self, lat: f32, lon: f32, send: f32) -> Placement {
        place(self.vantage, lat, lon, self.inversion, send, self.sr)
    }

    fn trigger(&mut self, n: Note, frame: f64) {
        let sr = self.sr;
        let f = midi_hz(n.midi);
        let dur_s = n.dur_ms / 1000.0;
        let seed = (n.at_ms.to_bits() as u32) ^ (n.midi.to_bits() << 7) ^ u32::from(n.inst as u8);
        let mix = self.mix_target;
        match n.inst {
            Inst::Piano => {
                // Variants: 100 + summit for the welcome, 200 for a run's solo.
                let welcome = (100..200).contains(&n.variant);
                let solo = n.variant >= 200;
                let pan = ((n.midi - 66.0) / 30.0).clamp(-0.5, 0.5);
                let (gl, gr) = crate::audio::pan_gains(pan);
                let place = Placement {
                    gl,
                    gr,
                    send: 0.24,
                    cut: 0.0,
                    canyon: 0.0,
                };
                let gain = if welcome {
                    0.62
                } else if solo {
                    0.58
                } else {
                    0.55 * mix.piano.max(0.6)
                };
                let i = pick(
                    &mut self.rr[0],
                    self.piano.iter().map(PianoVoice::is_active),
                );
                self.piano[i].start(
                    &self.samples,
                    n.midi,
                    n.vel * gain,
                    dur_s,
                    sr,
                    place,
                    welcome,
                );
                let summit = if welcome { n.variant - 100 } else { n.variant };
                if solo {
                    let _ = writeln!(
                        self.outbox,
                        r#"{{"t":"solo","f":{frame:.0},"m":{}}}"#,
                        n.midi
                    );
                } else if welcome
                    || n.feature != crate::compose::NO_FEATURE
                    || self
                        .cursor
                        .is_some_and(|c| c.section.kind == crate::plan::SectionKind::Theme)
                {
                    let _ = writeln!(
                        self.outbox,
                        r#"{{"t":"theme","f":{frame:.0},"s":{summit},"m":{}}}"#,
                        n.midi
                    );
                }
            }
            Inst::Bell => {
                let place = self.placement(n.lat, n.lon, 0.3);
                let i = pick(&mut self.rr[1], self.bells.iter().map(|v| v.is_active()));
                self.bells[i].strike(
                    &bell_partials(f),
                    Hit {
                        vel: n.vel,
                        hardness: 0.75,
                        gain: 0.16 * mix.rail,
                    },
                    place,
                );
                self.pulse(frame, &n, &place);
            }
            Inst::Horn => {
                let place = self.placement(n.lat, n.lon, 0.35);
                let i = pick(&mut self.rr[2], self.horns.iter().map(|v| v.is_active()));
                self.horns[i].start(n.midi, n.vel * mix.rail.max(0.5), dur_s, place);
                if n.variant == 0 {
                    self.pulse(frame, &n, &place);
                }
            }
            Inst::Swell => {
                let i = usize::from(n.variant & 3);
                if n.variant & 4 != 0 {
                    // A voice moving: only one already sounding (a phone
                    // that joined mid-swell missed its start).
                    if self.swells[i].is_active() {
                        self.swells[i].glide_to(n.midi);
                    }
                    return;
                }
                let place = self.placement(n.lat, n.lon, 0.45);
                let size = ((n.variant >> 4) & 7) + 1;
                self.swells[i].start(
                    n.midi,
                    n.vel * mix.planes.max(0.4),
                    dur_s,
                    n.variant & 8 != 0,
                    size,
                    place,
                );
                if n.variant & 1 == 0 {
                    self.pulse(frame, &n, &place);
                }
            }
            Inst::Marimba => {
                let place = self.placement(n.lat, n.lon, 0.2);
                let i = pick(&mut self.rr[3], self.marimbas.iter().map(|v| v.is_active()));
                let decay = libm::sqrtf(440.0 / f).clamp(0.5, 1.6);
                self.marimbas[i].strike_modes(
                    f,
                    presets::MARIMBA,
                    decay,
                    Hit {
                        vel: n.vel,
                        hardness: 0.45,
                        gain: 0.35 * mix.bikes,
                    },
                    place,
                );
                self.pulse(frame, &n, &place);
            }
            Inst::Grain => {
                let pan = self.noise.sample() * 0.7;
                let (gl, gr) = crate::audio::pan_gains(pan);
                let place = Placement {
                    gl,
                    gr,
                    send: 0.45,
                    cut: 0.0,
                    canyon: 0.0,
                };
                let i = pick(&mut self.rr[4], self.grains.iter().map(|v| v.is_active()));
                let (modes, hardness) = if n.variant == 1 {
                    (presets::GLOCKENSPIEL, 0.95)
                } else {
                    (presets::CELESTA, 0.35)
                };
                self.grains[i].strike_modes(
                    f,
                    modes,
                    0.6,
                    Hit {
                        vel: n.vel,
                        hardness,
                        gain: 0.07 * mix.grains,
                    },
                    place,
                );
            }
            Inst::QuakeBell => {
                let place = self.placement(n.lat, n.lon, 0.5);
                let mut partials = [(0.0f32, 0.0f32, 0.0f32); 8];
                let third = if n.variant == 0 { 1.189_207 } else { 1.259_921 };
                let k = presets::chord_bell(f, third, &mut partials);
                let i = pick(
                    &mut self.rr[5],
                    self.quake_bells.iter().map(|v| v.is_active()),
                );
                self.quake_bells[i].strike(
                    &partials[..k],
                    Hit {
                        vel: n.vel,
                        hardness: 0.6,
                        gain: 0.3,
                    },
                    place,
                );
                self.pulse(frame, &n, &place);
            }
            Inst::Harp => {
                let pan = ((n.midi - 72.0) / 14.0).clamp(-0.6, 0.6);
                let (gl, gr) = crate::audio::pan_gains(pan);
                let place = Placement {
                    gl,
                    gr,
                    send: 0.5,
                    cut: 0.0,
                    canyon: 0.0,
                };
                let i = pick(&mut self.rr[6], self.harp.iter().map(|v| v.is_active()));
                let mut noise = Noise::new(seed | 1);
                self.harp[i].excite(n.midi, n.vel * mix.harp, sr, &mut noise, place);
            }
            Inst::Bass => self.bass.start(n.midi, n.vel * mix.bass, dur_s, sr),
            _ => {
                let (kind, pan) = match n.inst {
                    Inst::Kick => (DrumKind::Kick, 0.0),
                    Inst::Snare => (DrumKind::Snare, 0.08),
                    Inst::Rim => (DrumKind::Rim, -0.2),
                    Inst::Hat => (DrumKind::Hat, 0.25),
                    Inst::Shaker => (DrumKind::Shaker, -0.3),
                    Inst::Tom => (DrumKind::Tom, -0.1),
                    // Variant 2: a cymbal swell, rising for the note's length.
                    _ if n.variant == 2 => (DrumKind::Swell, 0.1),
                    _ => (DrumKind::Crash, 0.15),
                };
                let mut place = if n.lat.is_finite() {
                    self.placement(n.lat, n.lon, 0.3)
                } else {
                    let (gl, gr) = crate::audio::pan_gains(pan);
                    Placement {
                        gl,
                        gr,
                        send: 0.12,
                        cut: 0.0,
                        canyon: 0.0,
                    }
                };
                if n.variant == 1 {
                    place.canyon = 0.45;
                    self.pulse(frame, &n, &place);
                }
                let i = pick(&mut self.rr[7], self.drums.iter().map(|v| v.is_active()));
                // Variants 2 and 3, the soft gestures, sound when the kit is
                // out too.
                let level = if n.variant >= 2 {
                    mix.kit.max(0.7)
                } else {
                    mix.kit
                };
                if kind == DrumKind::Swell {
                    self.drums[i].swell(dur_s, n.vel * level, place, seed | 1);
                } else {
                    self.drums[i].start(kind, n.midi, n.vel * level, place, seed | 1);
                }
                self.kit_located[i] = n.lat.is_finite();
            }
        }
    }

    /// A sounding event for the map, with how loud it is from here (1 on
    /// the map view).
    fn pulse(&mut self, frame: f64, n: &Note, place: &Placement) {
        if n.lat.is_finite() {
            let g = libm::sqrtf(place.gl * place.gl + place.gr * place.gr).min(1.0);
            let _ = writeln!(
                self.outbox,
                r#"{{"t":"pulse","f":{frame:.0},"i":{},"lat":{:.5},"lon":{:.5},"m":{},"g":{g:.2}}}"#,
                n.inst as u8, n.lat, n.lon, n.midi
            );
        }
    }

    fn apply_harmony(
        &mut self,
        h: Harmony,
        mix: Mix,
        sec: Section,
        bar: u32,
        day_ms: f64,
        frame: f64,
    ) {
        self.mix_target = mix;
        self.now_chord = Some(h);
        // Pad: keep voices whose note stays, release the rest, start the new.
        let keep: Vec<i32> = h.pad.iter().copied().filter(|&m| m > 0).collect();
        for v in &mut self.pad {
            if v.is_active() && !keep.contains(&v.midi) {
                v.release();
            }
        }
        let gain = 0.2;
        for &m in &keep {
            let held = self.pad.iter().any(|v| v.is_active() && v.midi == m);
            if !held {
                let i = (0..self.pad.len())
                    .find(|&i| !self.pad[i].is_active())
                    .unwrap_or(m as usize % self.pad.len());
                let pan = ((m - 61) as f32 / 16.0).clamp(-0.7, 0.7);
                let (gl, gr) = crate::audio::pan_gains(pan);
                let place = Placement {
                    gl,
                    gr,
                    send: 0.38,
                    cut: 0.0,
                    canyon: 0.0,
                };
                self.pad[i].start(m, self.sr, self.pad_cutoff, gain, place);
            }
        }
        self.lake.set_note(h.pedal as f32);
        // The ground's carriers: low bands on low chord tones.
        let n = usize::from(h.n_tones.max(1));
        let carriers = [
            midi_hz(at_or_above(h.tones[0], 48) as f32),
            midi_hz(at_or_above(h.tones[2 % n], 52) as f32),
            midi_hz(at_or_above(h.tones[1 % n], 60) as f32),
            midi_hz(at_or_above(h.tones[(3 % n).min(n - 1)], 69) as f32),
        ];
        for (up, c) in self.ground.iter_mut().zip(carriers) {
            up.set_carrier(c, 1500.0);
        }
        // Sky-driven tone, once per bar: the sky of the bar's own hour (of
        // the day being played, in A Day in Twelve Minutes).
        let hour = self
            .inputs
            .sky
            .at_or_default(if day_ms > 0.0 { day_ms } else { h.at_ms });
        self.master.set_warmth(warmth_for(hour.temp_c));
        // The grid's now has nothing to say about a day gone by.
        self.master.set_energy(if day_ms > 0.0 {
            0.0
        } else {
            energy_db(self.inputs.slow.energy_or_usual())
        });
        self.haze = ((hour.pm25 - 6.0) / 40.0).clamp(0.0, 1.0);
        let inv = (hour.inversion_c / 8.0).clamp(0.0, 1.0);
        if (inv - self.inversion).abs() > 0.05 {
            self.inversion = inv;
            self.room.set(self.vantage, inv);
            self.restage(false);
        }
        self.wind = (hour.ridge_ms, hour.ridge_gust_ms);
        self.room.set_tempo(sec.bpm);
        self.pad_cutoff = (900.0
            + 3000.0 * sec.brightness
            + if sec.kind == crate::plan::SectionKind::Journey {
                500.0
            } else {
                0.0
            })
            // A storm on its way darkens it.
            * (1.0 - 0.35 * mix.dark);
        for v in &mut self.pad {
            v.set_cutoff(self.pad_cutoff);
        }
        let _ = writeln!(
            self.outbox,
            r#"{{"t":"bar","f":{frame:.0},"chain":{},"sec":{},"kind":{},"bar":{bar},"bars":{},"bpm":{:.2},"start":{:.0},"c":{},"r":{},"pc":{},"pr":{},"nc":{},"nr":{},"why":{},"home":{},"tempo":{},"flow":{:.2},"chord":"{}","act":{:.3},"bright":{:.3},"tension":{:.3},"haze":{:.3},"inv":{:.3},"dark":{:.2},"warm":{:.2},"grid":{:.2},"day":{day_ms:.0}}}"#,
            sec.chain,
            sec.index,
            sec.kind as u8,
            sec.bars(),
            sec.bpm,
            sec.start_ms,
            sec.key.collection,
            sec.key.rung,
            sec.prev_key.collection,
            sec.prev_key.rung,
            sec.next_key.collection,
            sec.next_key.rung,
            sec.notes_reason.map_or(-1, |r| r as i32),
            sec.home_reason.map_or(-1, |r| r as i32),
            sec.tempo_reason.map_or(-1, |r| r as i32),
            sec.flow,
            h.chord.symbol(),
            sec.activity,
            sec.brightness,
            sec.tension,
            self.haze,
            self.inversion,
            mix.dark,
            self.master.warmth(),
            self.master.energy(),
        );
        if self.fade_in_at.is_some_and(|t| h.at_ms >= t - 1.0) {
            self.master.set_fade(true);
            self.fade_in_at = None;
        }
    }

    fn emit_feature(&mut self, f: Feature, frame: f64) {
        let _ = writeln!(
            self.outbox,
            r#"{{"t":"feat","f":{frame:.0},"k":{},"route":{},"stop":{},"ev":{:.0},"late":{},"obs":{},"v":{:.3}}}"#,
            f.kind as u8,
            f.route,
            f.stop,
            f.event_ms,
            f.late_s,
            u8::from(f.observed),
            f.value
        );
    }

    /// Render `frames` (at most [`MAX_FRAMES`]) and return them, left then
    /// right.
    pub fn render(&mut self, frames: usize) -> &[f32] {
        let frames = frames.min(MAX_FRAMES);
        let Some(l0) = self.listening_ms(self.frame) else {
            self.frame += frames as f64;
            self.out[..2 * frames].fill(0.0);
            return &self.out[..2 * frames];
        };
        let ms_per = 1000.0 / f64::from(self.sr);
        if self.started {
            self.compose_ahead(l0);
        }
        // The ground's bands, placed by their stations for this block.
        let ground_place: [Placement; 4] =
            core::array::from_fn(|b| self.placement(self.ground_at[b].0, self.ground_at[b].1, 0.4));
        for i in 0..frames {
            let l = l0 + i as f64 * ms_per;
            let frame = self.frame + i as f64;
            if self.started && i % 128 == 0 && i > 0 {
                self.compose_ahead(l);
            }
            while let Some(&h) = self.harmonies.first().filter(|h| h.0.at_ms <= l) {
                self.harmonies.remove(0);
                self.apply_harmony(h.0, h.1, h.2, h.3, h.4, frame);
            }
            while let Some(&n) = self.pending.first().filter(|n| n.at_ms <= l) {
                self.pending.remove(0);
                self.trigger(n, frame);
            }
            while let Some(&f) = self.features.first().filter(|f| f.at_ms <= l) {
                self.features.remove(0);
                self.emit_feature(f, frame);
            }

            // Mix levels glide toward the bar's targets.
            let k = 0.00002;
            self.mix.pad += (self.mix_target.pad - self.mix.pad) * k;
            self.mix.lake += (self.mix_target.lake - self.mix.lake) * k;
            self.mix.ground += (self.mix_target.ground - self.mix.ground) * k;
            self.mix.harp += (self.mix_target.harp - self.mix.harp) * k;

            let mut stream = Out::default();
            let mut welcome = Out::default();
            for v in &mut self.piano {
                if v.welcome {
                    v.tick(&self.samples, &mut welcome);
                } else {
                    v.tick(&self.samples, &mut stream);
                }
            }
            // The families that live somewhere bigger than a point play
            // into their own buses, staged from the vantage below.
            let mut fam = [Out::default(); HOMES];
            let mut pad = Out::default();
            for v in &mut self.pad {
                v.tick(&self.tables, self.haze, &mut pad);
            }
            let m = &mut fam[Home::Mountains as usize];
            m.l += pad.l * self.mix.pad;
            m.r += pad.r * self.mix.pad;
            m.send += pad.send * self.mix.pad;
            self.bass.tick(&mut fam[Home::Rivers as usize]);
            let slosh = (self.inputs.slow.lake_dev_ft.abs() / 0.5).min(1.0);
            self.lake
                .tick(self.mix.lake, slosh, &mut fam[Home::Lake as usize]);
            for (v, &located) in self.drums.iter_mut().zip(&self.kit_located) {
                if located {
                    v.tick(&mut stream);
                } else {
                    v.tick(&mut fam[Home::City as usize]);
                }
            }
            for v in &mut self.bells {
                v.tick(&mut stream);
            }
            for v in &mut self.marimbas {
                v.tick(&mut stream);
            }
            for v in &mut self.vibes {
                v.tick(&mut stream);
            }
            for v in &mut self.grains {
                v.tick(&mut fam[Home::Snow as usize]);
            }
            for v in &mut self.quake_bells {
                v.tick(&mut stream);
            }
            for v in &mut self.horns {
                v.tick(&mut stream);
            }
            for v in &mut self.swells {
                v.tick(&mut stream);
            }
            for v in &mut self.harp {
                v.tick(&mut fam[Home::Ridges as usize]);
            }
            self.air.tick(
                self.wind.0,
                self.wind.1,
                self.mix.harp,
                &mut fam[Home::Air as usize],
            );
            for (bus, x) in self.buses.iter_mut().zip(&fam) {
                bus.process(x, &mut stream);
            }
            for (b, up) in self.ground.iter_mut().enumerate() {
                let level = self.inputs.slow.ground[b] * self.mix.ground * 0.07;
                if level > 0.0 || up.buffered() > 0 {
                    let y = up.process() * level;
                    let p = &ground_place[b];
                    stream.l += y * p.gl;
                    stream.r += y * p.gr;
                    stream.send += y * p.send;
                }
            }

            let fade = self.master.fade_tick();
            let dry_l = stream.l * fade + welcome.l;
            let dry_r = stream.r * fade + welcome.r;
            let send = stream.send * fade + welcome.send;
            let (rl, rr) =
                self.room
                    .process(send, send, stream.canyon * fade, 0.5 * (dry_l + dry_r));
            let (ol, or) = self.master.process(dry_l + rl, dry_r + rr);
            self.out[i] = ol;
            self.out[frames + i] = or;
        }
        self.frame += frames as f64;
        &self.out[..2 * frames]
    }

    /// Events since the last call, as JSON lines; clears them.
    pub fn take_outbox(&mut self) -> String {
        core::mem::take(&mut self.outbox)
    }

    /// The outbox, without clearing it.
    pub fn outbox(&self) -> &str {
        &self.outbox
    }

    /// Clear the outbox.
    pub fn clear_outbox(&mut self) {
        self.outbox.clear();
    }

    /// The current loudness estimate and rider gain, for the mappings view.
    pub fn meters(&self) -> (f32, f32) {
        (self.master.loudness(), self.master.rider_db())
    }

    /// The planned day, for tests and the mappings view.
    pub fn chain(&self) -> Option<&Chain> {
        self.chain.as_ref()
    }
}

/// The first free voice, or the next one round-robin (the oldest-ish) to
/// steal.
fn pick(rr: &mut usize, active: impl ExactSizeIterator<Item = bool>) -> usize {
    let len = active.len().max(1);
    let mut free = None;
    for (i, a) in active.enumerate() {
        if !a {
            free = Some(i);
            break;
        }
    }
    free.unwrap_or_else(|| {
        let i = *rr % len;
        *rr = rr.wrapping_add(1);
        i
    })
}

fn at_or_above(pc: u8, floor: i32) -> i32 {
    floor + (i32::from(pc) - floor).rem_euclid(12)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A day of the schedule whose local midnight is `offset_h` hours after
    /// UTC midnight (6 in summer, 7 in winter).
    fn day(date: u32, utc_day: f64, offset_h: f64) -> ServiceDay {
        ServiceDay {
            date,
            t0_ms: (utc_day * 24.0 + offset_h) * 3_600_000.0,
            rail: vec![(6 * 3600, 0)],
            ski: vec![],
            bus: vec![10; 1800],
            bus_west: vec![5; 1800],
        }
    }

    #[test]
    fn without_a_covering_day_the_fallback_keeps_the_season_s_clock() {
        // Winter: the schedule knows Nov 2 (MST, UTC−7), and the listener is
        // three days later than anything compiled.
        let mut e = Engine::new(48_000.0);
        e.set_day(day(20261102, 20_759.0, 7.0));
        let l = (20_762.0 * 24.0 + 7.0 + 12.0) * 3_600_000.0; // Nov 5, noon MST
        e.set_clock(0.0, l + DELAY_MS);
        e.start();
        let chain = e.chain().expect("a fallback chain");
        // Its anchor is 05:00 MST that day: 12:00 UTC, not 11:00.
        assert_eq!(chain.anchor_ms.rem_euclid(86_400_000.0), 12.0 * 3_600_000.0);
        assert!(chain.anchor_ms <= l && l < chain.end_ms);
    }
}
