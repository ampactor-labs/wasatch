//! The plan: a day of sections, decided from what every phone shares.
//!
//! A *chain* runs from 05:00 local (first light, in the home key) to the
//! next 05:00. Each section's decisions (its kind, length, tempo, and the
//! harmony's move into it) read only the schedule, the computed sun and
//! moon, and hourly sky observations at least twenty minutes old, so two
//! phones that loaded the same data plan the same day. This is the
//! conductor's job in DESIGN.md; with no conductor running, every phone is
//! its own, identically.

use crate::music::{Key, progressions};
use crate::schedule::Schedule;
use crate::sky;
use sonido_core::rng::CounterRng;

/// Hours the anchor sits after the service day's start: 05:00.
pub const ANCHOR_HOURS: f64 = 5.0;
/// Observations younger than this don't steer a boundary (they may not be
/// published everywhere yet).
pub(crate) const OBS_LAG_MS: f64 = 20.0 * 60_000.0;

/// The five section types.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum SectionKind {
    /// The skyline melody over the current harmony.
    Theme = 0,
    /// Transit percussion, bass, bikes.
    Groove = 1,
    /// Weather, wind, snow, air; drums recede.
    Atmosphere = 2,
    /// Everything at once; the move into it is staged.
    Journey = 3,
    /// The lake's pedal and its cadence rule; quiet.
    Lake = 4,
}

impl SectionKind {
    /// Every kind.
    pub const ALL: [SectionKind; 5] = [
        SectionKind::Theme,
        SectionKind::Groove,
        SectionKind::Atmosphere,
        SectionKind::Journey,
        SectionKind::Lake,
    ];
}

/// Parts of the day, each with a base tempo.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum Daypart {
    /// 0:00–5:00.
    Nocturne = 0,
    /// 5:00–8:00.
    FirstLight = 1,
    /// 8:00–16:00.
    Work = 2,
    /// 16:00–19:00.
    Rush = 3,
    /// 19:00–24:00.
    LastTrains = 4,
}

impl Daypart {
    /// The daypart at `local_s` seconds after a service day's start.
    pub fn at(local_s: f64) -> Daypart {
        let h = (local_s / 3600.0).rem_euclid(24.0);
        if h < 5.0 {
            Daypart::Nocturne
        } else if h < 8.0 {
            Daypart::FirstLight
        } else if h < 16.0 {
            Daypart::Work
        } else if h < 19.0 {
            Daypart::Rush
        } else {
            Daypart::LastTrains
        }
    }

    /// Base tempo.
    pub fn base_bpm(self) -> f32 {
        match self {
            Daypart::Nocturne => 72.0,
            Daypart::FirstLight => 84.0,
            Daypart::Work => 96.0,
            Daypart::Rush => 100.0,
            Daypart::LastTrains => 88.0,
        }
    }
}

/// One hour of sky.
///
/// The first group steers the day's plan, so it must come from sources that
/// never revise the past (observations and issued alerts): every phone has to
/// plan the same day. The rest only colors bars and may come from models.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct SkyHour {
    /// Cloud cover over the valley, 0–1 (NaN unknown). Observed.
    pub cloud: f32,
    /// Rain in the valley, mm in the hour. Observed.
    pub precip_mm: f32,
    /// Snow in the valley, cm in the hour. Observed.
    pub snow_cm: f32,
    /// Temperature, °C. Observed.
    pub temp_c: f32,
    /// Wind in the valley, m/s. Observed.
    pub wind_ms: f32,
    /// Gusts in the valley, m/s. Observed.
    pub gust_ms: f32,
    /// PM2.5, µg/m³.
    pub pm25: f32,
    /// The most warming from the valley floor up to 700 hPa, °C.
    pub inversion_c: f32,
    /// A storm watch or warning in effect, 0–1. Issued alerts.
    pub alert: f32,
    /// Wind at the ridges, m/s.
    pub ridge_ms: f32,
    /// Gusts at the ridges, m/s.
    pub ridge_gust_ms: f32,
    /// Snowfall in the mountains, cm in the hour.
    pub mtn_snow_cm: f32,
    /// How the buses and trains are moving against the usual for the hour,
    /// −1 (crawling) to 1 (quick); NaN unknown. Observed, by the conductor.
    pub flow: f32,
    /// The change in pressure over the three hours to this one, hPa; NaN
    /// unknown. Observed.
    pub pressure_tend: f32,
    /// Snow forecast at Alta over the next day, mm; NaN unknown. A forecast,
    /// frozen for the hour by the conductor: it only colors bars.
    pub storm_mm: f32,
    /// PM2.5 measured downtown (Hawthorne), µg/m³; NaN unknown, and then
    /// `pm25` stands for it. Frozen for the hour by the conductor from
    /// AirNow's monitors: the haze the downtown vantage hears.
    pub pm25_downtown: f32,
    /// PM2.5 measured at the lake (the station by Saltair), µg/m³; NaN
    /// unknown, and then `pm25` stands for it. The haze the lake vantage hears.
    pub pm25_lake: f32,
    /// The slow values as the conductor froze them for the hour (NaN
    /// unknown, and then the latest posted `Slow` stands in): every phone
    /// composes the hour from the same lake, rivers, snow and grid,
    /// whenever it last fetched them. See `Slow::overlaid`.
    pub lake_ft: f32,
    /// The lake against its daily mean, ft, frozen for the hour.
    pub lake_dev_ft: f32,
    /// The rivers against the usual for the date, 0–1, frozen for the hour.
    pub river: f32,
    /// Snowpack against median, frozen for the hour.
    pub snowpack: f32,
    /// Overnight new snow, inches, frozen for the hour.
    pub new_snow_in: f32,
    /// New-snow lightness, 0–1, frozen for the hour.
    pub powder: f32,
    /// The grid's demand against the usual, frozen for the hour.
    pub energy: f32,
    /// Winter, 0–1, for the hour (the page works it out from the hour
    /// itself, so it's the same everywhere).
    pub season: f32,
}

impl Default for SkyHour {
    fn default() -> Self {
        SkyHour {
            cloud: f32::NAN,
            precip_mm: 0.0,
            snow_cm: 0.0,
            temp_c: 10.0,
            wind_ms: 3.0,
            gust_ms: 5.0,
            pm25: 5.0,
            inversion_c: 0.0,
            alert: 0.0,
            ridge_ms: 4.0,
            ridge_gust_ms: 6.0,
            mtn_snow_cm: 0.0,
            flow: f32::NAN,
            pressure_tend: f32::NAN,
            storm_mm: f32::NAN,
            pm25_downtown: f32::NAN,
            pm25_lake: f32::NAN,
            lake_ft: f32::NAN,
            lake_dev_ft: f32::NAN,
            river: f32::NAN,
            snowpack: f32::NAN,
            new_snow_in: f32::NAN,
            powder: f32::NAN,
            energy: f32::NAN,
            season: f32::NAN,
        }
    }
}

impl SkyHour {
    /// `true` while rain or snow is falling.
    pub fn wet(&self) -> bool {
        self.precip_mm > 0.2 || self.snow_cm > 0.1
    }

    /// The flow, or 0 (as usual) unknown.
    pub fn flow_or_usual(&self) -> f32 {
        if self.flow.is_finite() {
            self.flow.clamp(-1.0, 1.0)
        } else {
            0.0
        }
    }

    /// How fast the pressure is falling, 0 (steady, or rising) to 1 (3.5 hPa
    /// or more in three hours: a storm on its way).
    pub fn falling(&self) -> f32 {
        if self.pressure_tend.is_finite() {
            ((-self.pressure_tend - 0.5) / 3.0).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// The snow forecast at Alta, mm (0 unknown).
    pub fn storm_or_none(&self) -> f32 {
        if self.storm_mm.is_finite() {
            self.storm_mm.max(0.0)
        } else {
            0.0
        }
    }
}

/// Hourly sky records, by UTC hour.
#[derive(Clone, Debug, Default)]
pub struct Sky {
    hours: Vec<(i64, SkyHour)>,
}

impl Sky {
    /// Record the hour starting at `utc_hour_ms`.
    pub fn set(&mut self, utc_hour_ms: f64, hour: SkyHour) {
        let h = (utc_hour_ms / 3_600_000.0).floor() as i64;
        match self.hours.binary_search_by_key(&h, |e| e.0) {
            Ok(i) => self.hours[i].1 = hour,
            Err(i) => self.hours.insert(i, (h, hour)),
        }
        // Keep three days.
        if let Some(&(last, _)) = self.hours.last() {
            self.hours.retain(|e| e.0 > last - 72);
        }
    }

    /// The latest record at or before `ms`, if one is within three hours.
    pub fn at(&self, ms: f64) -> Option<SkyHour> {
        let h = (ms / 3_600_000.0).floor() as i64;
        let i = self.hours.partition_point(|e| e.0 <= h);
        let (found, hour) = *self.hours.get(i.checked_sub(1)?)?;
        (h - found <= 3).then_some(hour)
    }

    /// `at`, or the defaults when nothing is known.
    pub fn at_or_default(&self, ms: f64) -> SkyHour {
        self.at(ms).unwrap_or_default()
    }

    /// Number of hours on record.
    pub fn len(&self) -> usize {
        self.hours.len()
    }

    /// `true` with nothing on record.
    pub fn is_empty(&self) -> bool {
        self.hours.is_empty()
    }
}

/// Why the harmony moved into a section.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum Reason {
    /// The day's first section, in the home key.
    DayStart = 0,
    /// The valley is busier than a moment ago: one step sharpward.
    ValleyUp = 1,
    /// The valley is quieter: one step flatward.
    ValleyDown = 2,
    /// The sky brightened: home moved to a brighter mode.
    Brighter = 3,
    /// The sky darkened.
    Darker = 4,
    /// Nothing pushed: a step toward the home key.
    WalkHome = 5,
    /// Nothing pushed, at home: a visit next door.
    Visit = 6,
    /// The small hours: heading home for first light.
    NightHome = 7,
    /// The small hours, already home: home sways by a rung.
    NightDrift = 8,
    /// The buses and trains are moving quicker than usual: the tempo lifts.
    FlowFaster = 9,
    /// They're crawling, or running late: the tempo holds back.
    FlowSlower = 10,
}

/// One section of the day.
#[derive(Clone, Copy, Debug)]
pub struct Section {
    /// The chain's date (yyyymmdd).
    pub chain: u32,
    /// Index within the chain.
    pub index: u32,
    /// Start, in listening-time UTC ms.
    pub start_ms: f64,
    /// Tempo.
    pub bpm: f32,
    /// Length in 8-bar phrases (the day's last section may end on a partial
    /// one).
    pub phrases: u8,
    /// Length in bars.
    pub bars: u16,
    /// Kind.
    pub kind: SectionKind,
    /// The harmony.
    pub key: Key,
    /// The previous section's harmony.
    pub prev_key: Key,
    /// The next section's harmony (for the last bar's pivot).
    pub next_key: Key,
    /// Why the notes in play moved, if they did.
    pub notes_reason: Option<Reason>,
    /// Why home moved without the notes, if it did.
    pub home_reason: Option<Reason>,
    /// Why the tempo isn't the daypart's, if the valley's flow moved it.
    pub tempo_reason: Option<Reason>,
    /// The fleet's flow it was planned from, −1…1 (0 as usual).
    pub flow: f32,
    /// Index into the mode's progression bank.
    pub progression: u8,
    /// Bars per chord (1 or 2).
    pub bars_per_chord: u8,
    /// Transit activity at the start, 0–1.
    pub activity: f32,
    /// Tension, 0–1.
    pub tension: f32,
    /// Sky brightness, 0–1.
    pub brightness: f32,
    /// Daypart at the start.
    pub daypart: Daypart,
    /// This section's random stream.
    pub rng: CounterRng,
}

impl Section {
    /// Milliseconds per 4/4 bar.
    pub fn bar_ms(&self) -> f64 {
        240_000.0 / f64::from(self.bpm)
    }

    /// Bars in the section.
    pub fn bars(&self) -> u32 {
        u32::from(self.bars)
    }

    /// End, in listening-time UTC ms.
    pub fn end_ms(&self) -> f64 {
        self.start_ms + f64::from(self.bars()) * self.bar_ms()
    }
}

/// A planned day.
#[derive(Clone, Debug)]
pub struct Chain {
    /// Date (yyyymmdd).
    pub date: u32,
    /// 05:00 local, in UTC ms.
    pub anchor_ms: f64,
    /// The next chain's anchor.
    pub end_ms: f64,
    /// The sections, in order.
    pub sections: Vec<Section>,
}

impl Chain {
    /// The section playing at `ms`, if the chain covers it.
    pub fn section_at(&self, ms: f64) -> Option<&Section> {
        let i = self.sections.partition_point(|s| s.start_ms <= ms);
        let s = self.sections.get(i.checked_sub(1)?)?;
        (ms < s.end_ms()).then_some(s)
    }
}

/// The brightness the sky shows at `ms`, from the computed sun and moon and
/// the last observation old enough to count.
pub fn brightness_at(sky_data: &Sky, ms: f64) -> f32 {
    let hour = sky_data.at_or_default(ms - OBS_LAG_MS);
    sky::brightness(
        sky::sun_elevation(ms),
        hour.cloud,
        hour.wet(),
        sky::moon_illumination(ms),
    )
}

/// Tension at `ms`: storm alerts, building cloud and strong gusts.
pub fn tension_at(sky_data: &Sky, ms: f64) -> f32 {
    let now = sky_data.at_or_default(ms - OBS_LAG_MS);
    let before = sky_data.at_or_default(ms - OBS_LAG_MS - 3.0 * 3_600_000.0);
    let building = if now.cloud.is_finite() && before.cloud.is_finite() {
        (now.cloud - before.cloud).max(0.0)
    } else {
        0.0
    };
    (now.alert + 0.6 * building + 0.25 * (now.gust_ms / 20.0).min(1.0) + 0.35 * now.falling())
        .clamp(0.0, 1.0)
}

/// The fleet's flow at `ms`, from its lagged slot: 0 inside a dead band, so
/// an ordinary hour leaves the tempo to the daypart.
pub fn flow_at(sky_data: &Sky, ms: f64) -> f32 {
    let f = sky_data.at_or_default(ms - OBS_LAG_MS).flow_or_usual();
    if f.abs() < 0.15 {
        0.0
    } else {
        (f - 0.15 * f.signum()) / 0.85
    }
}

/// The most the valley's flow moves the tempo from the daypart's, BPM.
pub const FLOW_BPM: f32 = 4.0;

/// One step on the circle toward the home collection.
fn toward_home(collection: i8) -> i32 {
    let c = i32::from(collection);
    let home = i32::from(Key::HOME_COLLECTION);
    let d = c - home;
    if d > 0 {
        c - 1
    } else if d < 0 {
        c + 1
    } else {
        c
    }
}

/// Plan the chain for service date `date`: from its anchor to `end_ms`.
///
/// `t0_ms` is the service day's start (local midnight by GTFS's "noon minus
/// 12 h").
pub fn plan_chain(
    date: u32,
    t0_ms: f64,
    end_ms: f64,
    schedule: &Schedule,
    sky_data: &Sky,
) -> Chain {
    let anchor_ms = t0_ms + ANCHOR_HOURS * 3_600_000.0;
    let root = CounterRng::new(u64::from(date)).stream(0x5EC7);
    let mut sections = Vec::with_capacity(640);

    let first_b = brightness_at(sky_data, anchor_ms);
    let mut key = Key::new(i32::from(Key::HOME_COLLECTION), sky::rung_for(first_b));
    let mut bpm = Daypart::at(ANCHOR_HOURS * 3600.0).base_bpm();
    let mut t = anchor_ms;
    let mut index = 0u32;
    let mut queue: Vec<SectionKind> = Vec::new();
    let mut cycle = 0u64;
    let mut last_kind: Option<SectionKind> = None;

    while t < end_ms && sections.len() < 2000 {
        let local_s = (t - t0_ms) / 1000.0;
        let daypart = Daypart::at(local_s);
        let rng = root.stream(u64::from(index));

        // Kind: each cycle plays all five, Theme first at dawn.
        if queue.is_empty() {
            let mut order = SectionKind::ALL;
            if cycle == 0 {
                root.stream(0xC1C1E).shuffle(cycle, &mut order[1..]);
            } else {
                root.stream(0xC1C1E).shuffle(cycle, &mut order);
                if Some(order[0]) == last_kind {
                    order.swap(0, 1);
                }
            }
            queue.extend(order.iter().rev());
            cycle += 1;
        }
        let kind = queue.pop().unwrap_or(SectionKind::Groove);

        // Tempo: toward the daypart's base, nudged by how the valley's
        // buses and trains are moving, at most 4 BPM per boundary.
        let flow = flow_at(sky_data, t);
        let mut tempo_reason = None;
        if index > 0 {
            let base = daypart.base_bpm();
            let target = (base + FLOW_BPM * flow).clamp(60.0, 112.0);
            let step = (target - bpm).clamp(-4.0, 4.0);
            let plain = (base - bpm).clamp(-4.0, 4.0);
            bpm += step;
            // Say so when the flow made a beat's difference or more.
            if step - plain >= 1.0 {
                tempo_reason = Some(Reason::FlowFaster);
            } else if plain - step >= 1.0 {
                tempo_reason = Some(Reason::FlowSlower);
            }
        }

        let activity = schedule.mean_activity(t, t + 120_000.0);
        let tension = tension_at(sky_data, t);
        let b = brightness_at(sky_data, t);
        let wet = sky_data.at_or_default(t - OBS_LAG_MS).wet();

        // The harmony's move into this section.
        let prev_key = key;
        let mut notes_reason = None;
        let mut home_reason = None;
        if index == 0 {
            notes_reason = Some(Reason::DayStart);
        } else {
            // Home: follow the sky with hysteresis, at most two rungs.
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

            // Notes in play: the night heads home; otherwise the valley's
            // trend, or a walk when nothing pushes.
            let night = local_s >= (ANCHOR_HOURS + 22.0) * 3600.0;
            let mut c = i32::from(key.collection);
            if night {
                let home = toward_home(key.collection);
                if home != c {
                    c = home;
                    notes_reason = Some(Reason::NightHome);
                } else if home_reason.is_none() {
                    // Already home with a steady sky: sway home by a rung so
                    // the boundary still moves, keeping the notes at home.
                    rung = if rung < 4 { rung + 1 } else { rung - 1 };
                    home_reason = Some(Reason::NightDrift);
                }
            } else {
                let recent = schedule.mean_activity(t - 900_000.0, t);
                let earlier = schedule.mean_activity(t - 1_800_000.0, t - 900_000.0);
                let trend = recent - earlier;
                if trend > 0.02 {
                    c += 1;
                    notes_reason = Some(Reason::ValleyUp);
                } else if trend < -0.02 {
                    c -= 1;
                    notes_reason = Some(Reason::ValleyDown);
                } else if home_reason.is_none() {
                    let home = toward_home(key.collection);
                    if home != c {
                        c = home;
                        notes_reason = Some(Reason::WalkHome);
                    } else {
                        c += if rng.chance(1, 0.5) { 1 } else { -1 };
                        notes_reason = Some(Reason::Visit);
                    }
                }
            }
            key = Key::new(c, rung);
            if notes_reason.is_some() {
                // The notes moved; a rung change rides along with them.
                home_reason = home_reason.filter(|_| rung != prev_key.rung);
            }
        }

        // Length in phrases, inside the design's ranges.
        let night_groove = activity < 0.12;
        let phrases = match kind {
            SectionKind::Theme => 5 + rng.below(2, 3) as u8,
            SectionKind::Groove if night_groove => 3 + rng.below(3, 2) as u8,
            SectionKind::Groove => (6.0 + (2.0 * activity).round()).min(8.0) as u8,
            SectionKind::Atmosphere => {
                let weather = tension.max(if wet { 1.0 } else { 0.0 });
                4 + (2.0 * weather).round().min(2.0) as u8
            }
            SectionKind::Journey => 6,
            SectionKind::Lake => 3 + rng.below(4, 2) as u8,
        };

        // If the next chain's anchor is near, make this the last section and
        // size it in bars to land on the anchor exactly: bar granularity keeps
        // the tempo step within a couple of BPM.
        let mut bars = u16::from(phrases) * 8;
        let remaining = end_ms - t;
        let bar_ms = 240_000.0 / f64::from(bpm);
        let is_final = remaining < 1.6 * f64::from(bars) * bar_ms;
        if is_final {
            let mut best = (bars, bpm, f32::INFINITY);
            for n in 8u16..=256 {
                let fit = (f64::from(n) * 240_000.0 / remaining) as f32;
                let err = (fit - bpm).abs();
                if (60.0..=112.0).contains(&fit) && err < best.2 {
                    best = (n, fit, err);
                }
            }
            if best.2.is_finite() {
                bars = best.0;
                bpm = best.1;
                // The fit sets the tempo now, not the flow.
                tempo_reason = None;
            }
        }
        let phrases = bars.div_ceil(8) as u8;

        let bank = progressions(key.mode());
        let progression = rng.below(5, bank.len() as u32) as u8;
        let bars_per_chord = if activity < 0.35 { 2 } else { 1 };

        let section = Section {
            chain: date,
            index,
            start_ms: t,
            bpm,
            phrases,
            bars,
            kind,
            key,
            prev_key,
            next_key: key,
            notes_reason,
            home_reason,
            tempo_reason,
            flow,
            progression,
            bars_per_chord,
            activity,
            tension,
            brightness: b,
            daypart,
            rng,
        };
        t = section.end_ms();
        last_kind = Some(kind);
        sections.push(section);
        index += 1;
        if is_final {
            break;
        }
    }

    // Link each section to the next one's key for its closing pivot. The
    // last section leads into the next day's home key.
    let end_rung = sky::rung_for(brightness_at(sky_data, end_ms));
    let next_day = Key::new(i32::from(Key::HOME_COLLECTION), end_rung);
    for i in 0..sections.len() {
        sections[i].next_key = sections.get(i + 1).map_or(next_day, |s| s.key);
    }

    Chain {
        date,
        anchor_ms,
        end_ms,
        sections,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule::ServiceDay;

    /// A weekday-shaped schedule: buses ramp from 4 AM, plateau, fade.
    fn weekday(t0_ms: f64) -> Schedule {
        let mut bus = vec![0u16; 1800];
        for (m, slot) in bus.iter_mut().enumerate() {
            let h = m as f32 / 60.0;
            let v = if h < 4.0 {
                0.0
            } else if h < 7.0 {
                236.0 * (h - 4.0) / 3.0
            } else if h < 18.0 {
                236.0
            } else if h < 25.0 {
                236.0 * (25.0 - h) / 7.0
            } else {
                0.0
            };
            *slot = v as u16;
        }
        let mut s = Schedule::default();
        s.insert(ServiceDay {
            date: 20261023,
            t0_ms,
            bus_west: bus.iter().map(|&b| b / 2).collect(),
            bus,
            ..ServiceDay::default()
        });
        s
    }

    fn chain() -> Chain {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0; // Oct 23 00:00 MDT
        let s = weekday(t0);
        let sky_data = Sky::default();
        plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &s, &sky_data)
    }

    /// A sky with the same `edit` in every hour of the day.
    fn sky_with(t0: f64, edit: impl Fn(&mut SkyHour)) -> Sky {
        let mut sky = Sky::default();
        for h in 0..32 {
            let mut hour = SkyHour::default();
            edit(&mut hour);
            sky.set(t0 + f64::from(h) * 3_600_000.0, hour);
        }
        sky
    }

    #[test]
    fn the_valley_s_flow_nudges_the_tempo_a_few_bpm_and_says_so() {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0;
        let s = weekday(t0);
        let end = t0 + 29.0 * 3_600_000.0;
        let plan = |flow: f32| plan_chain(20261023, t0, end, &s, &sky_with(t0, |h| h.flow = flow));
        let usual = plan_chain(20261023, t0, end, &s, &Sky::default());
        let noon = |c: &Chain| {
            c.sections
                .iter()
                .find(|x| x.start_ms >= t0 + 12.0 * 3_600_000.0)
                .unwrap()
                .bpm
        };
        assert_eq!(noon(&usual), 96.0);
        assert_eq!(noon(&plan(1.0)), 100.0, "a quick valley lifts it");
        assert_eq!(noon(&plan(-1.0)), 92.0, "a stuck one holds it back");
        // An ordinary hour changes nothing: the chain is the usual one.
        let quiet = plan(0.1);
        assert!(
            quiet
                .sections
                .iter()
                .zip(&usual.sections)
                .all(|(a, b)| a.bpm == b.bpm && a.start_ms == b.start_ms)
        );
        for c in [plan(1.0), plan(-1.0)] {
            for w in c.sections.windows(2) {
                assert!(
                    (w[1].bpm - w[0].bpm).abs() <= 4.0 + 1e-3,
                    "{} to {}",
                    w[0].bpm,
                    w[1].bpm
                );
            }
            assert!(c.sections.iter().any(|x| x.tempo_reason.is_some()));
        }
        assert!(
            plan(-1.0)
                .sections
                .iter()
                .all(|x| x.tempo_reason != Some(Reason::FlowFaster))
        );
        assert!(usual.sections.iter().all(|x| x.tempo_reason.is_none()));
    }

    #[test]
    fn a_slot_s_flow_steers_nothing_before_the_observation_lag() {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0;
        let s = weekday(t0);
        let end = t0 + 29.0 * 3_600_000.0;
        let usual = plan_chain(20261023, t0, end, &s, &Sky::default());
        let slot = t0 + 13.0 * 3_600_000.0;
        let mut sky = Sky::default();
        sky.set(
            slot,
            SkyHour {
                flow: -1.0,
                ..SkyHour::default()
            },
        );
        let nudged = plan_chain(20261023, t0, end, &s, &sky);
        for (a, b) in usual.sections.iter().zip(&nudged.sections) {
            if a.start_ms < slot + OBS_LAG_MS {
                assert_eq!((a.bpm, a.start_ms), (b.bpm, b.start_ms));
            }
        }
        assert!(
            usual
                .sections
                .iter()
                .zip(&nudged.sections)
                .any(|(a, b)| a.bpm != b.bpm)
        );
    }

    #[test]
    fn falling_pressure_is_a_storm_coming() {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0;
        let at = t0 + 15.0 * 3_600_000.0;
        let steady = tension_at(&sky_with(t0, |h| h.pressure_tend = 0.5), at);
        let falling = tension_at(&sky_with(t0, |h| h.pressure_tend = -4.0), at);
        assert!(falling - steady >= 0.3, "{steady} to {falling}");
        assert_eq!(
            tension_at(&sky_with(t0, |h| h.pressure_tend = f32::NAN), at),
            tension_at(&Sky::default(), at)
        );
    }

    #[test]
    fn the_day_covers_the_chain_without_gaps() {
        let c = chain();
        assert!(c.sections.len() > 400, "{}", c.sections.len());
        assert_eq!(c.sections[0].start_ms, c.anchor_ms);
        for w in c.sections.windows(2) {
            assert!((w[0].end_ms() - w[1].start_ms).abs() < 1e-6);
        }
        let end = c.sections.last().unwrap().end_ms();
        assert!(
            (end - c.end_ms).abs() < 5.0,
            "the day ends {} ms off its anchor",
            end - c.end_ms
        );
    }

    #[test]
    fn every_boundary_moves_at_most_one_note_and_something_moves() {
        let c = chain();
        for s in &c.sections[1..] {
            assert!(s.key.notes_changed(s.prev_key) <= 1, "section {}", s.index);
            assert!(
                s.key != s.prev_key,
                "nothing moved into section {} ({:?})",
                s.index,
                s.notes_reason
            );
        }
    }

    #[test]
    fn the_day_starts_and_ends_at_home() {
        let c = chain();
        assert_eq!(c.sections[0].key.collection, Key::HOME_COLLECTION);
        assert_eq!(c.sections[0].kind, SectionKind::Theme);
        let last = c.sections.last().unwrap();
        assert_eq!(
            last.key.collection,
            Key::HOME_COLLECTION,
            "arrives home by first light"
        );
    }

    #[test]
    fn tempo_moves_in_small_steps_toward_the_daypart() {
        let c = chain();
        let n = c.sections.len();
        for (i, w) in c.sections.windows(2).enumerate() {
            // The last section is fitted to land on the next day's anchor.
            let limit = if i + 2 == n { 3.0 } else { 4.0 + 1e-4 };
            assert!(
                (w[1].bpm - w[0].bpm).abs() <= limit,
                "{} -> {}",
                w[0].bpm,
                w[1].bpm
            );
        }
        let noon = c.section_at(c.anchor_ms + 7.0 * 3_600_000.0).unwrap();
        assert_eq!(noon.daypart, Daypart::Work);
        assert_eq!(noon.bpm, 96.0);
    }

    #[test]
    fn mornings_climb_sharpward_and_evenings_drift_flatward() {
        let c = chain();
        let ups = c
            .sections
            .iter()
            .filter(|s| s.notes_reason == Some(Reason::ValleyUp))
            .filter(|s| {
                Daypart::at((s.start_ms - (c.anchor_ms - 5.0 * 3_600_000.0)) / 1000.0)
                    == Daypart::FirstLight
            })
            .count();
        assert!(ups >= 3, "the dawn ramp should push sharpward: {ups}");
        let downs = c
            .sections
            .iter()
            .filter(|s| s.notes_reason == Some(Reason::ValleyDown))
            .count();
        assert!(downs >= 3, "{downs}");
    }

    #[test]
    fn kinds_cycle_through_all_five() {
        let c = chain();
        for w in c.sections.chunks(5).take(20) {
            if w.len() < 5 {
                continue;
            }
            let mut kinds: Vec<u8> = w.iter().map(|s| s.kind as u8).collect();
            kinds.sort_unstable();
            kinds.dedup();
            assert_eq!(kinds.len(), 5);
        }
    }

    #[test]
    fn the_cycle_fits_twelve_minutes() {
        let c = chain();
        for w in c.sections.chunks(5) {
            if w.len() < 5 {
                continue;
            }
            let minutes = (w[4].end_ms() - w[0].start_ms) / 60_000.0;
            assert!(minutes <= 12.5, "a cycle took {minutes:.1} min");
        }
    }

    #[test]
    fn plans_are_deterministic() {
        let a = chain();
        let b = chain();
        assert_eq!(a.sections.len(), b.sections.len());
        for (x, y) in a.sections.iter().zip(b.sections.iter()) {
            assert_eq!(x.key, y.key);
            assert_eq!(x.start_ms, y.start_ms);
            assert_eq!(x.kind, y.kind);
        }
    }

    #[test]
    fn a_cloudy_afternoon_is_darker_than_a_clear_one() {
        let t0 = (20_749.0 * 86_400.0 + 6.0 * 3600.0) * 1000.0;
        let s = weekday(t0);
        let mut cloudy = Sky::default();
        for h in 0..30 {
            cloudy.set(
                t0 + f64::from(h) * 3_600_000.0,
                SkyHour {
                    cloud: 1.0,
                    ..SkyHour::default()
                },
            );
        }
        let mut clear = Sky::default();
        for h in 0..30 {
            clear.set(
                t0 + f64::from(h) * 3_600_000.0,
                SkyHour {
                    cloud: 0.0,
                    ..SkyHour::default()
                },
            );
        }
        let at = t0 + 13.0 * 3_600_000.0;
        let a = plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &s, &cloudy);
        let b = plan_chain(20261023, t0, t0 + 29.0 * 3_600_000.0, &s, &clear);
        assert!(a.section_at(at).unwrap().key.rung > b.section_at(at).unwrap().key.rung);
    }
}
