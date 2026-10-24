//! UTA's schedule as the score: rail departures, ski buses and bus rates.
//!
//! The browser compiles nothing; `tools/gtfs/compile.ts` turns the GTFS feed
//! into per-service-day files at build time and the host copies them in here.
//! Times arrive as seconds since each service day's start (GTFS "noon minus
//! 12 h", past 86,400 for trips after midnight), and are merged into one
//! absolute-time list, since between midnight and 5 AM yesterday's late trips
//! and today's early ones both run.

/// What a route is, musically.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RouteKind {
    /// A TRAX line: 0 Blue, 1 Red, 2 Green.
    Trax(u8),
    /// The S-Line streetcar.
    SLine,
    /// FrontRunner commuter rail.
    FrontRunner,
    /// A canyon ski bus: 0 up Little Cottonwood, 1 up Big Cottonwood.
    Ski(u8),
    /// Anything else (ignored).
    Other,
}

impl RouteKind {
    /// Decode the host's route-kind code: 0–2 TRAX lines, 3 S-Line,
    /// 4 FrontRunner, 5 ski bus up Little Cottonwood, 6 up Big Cottonwood.
    pub fn from_code(code: u32) -> RouteKind {
        match code {
            0..=2 => RouteKind::Trax(code as u8),
            3 => RouteKind::SLine,
            4 => RouteKind::FrontRunner,
            5 => RouteKind::Ski(0),
            6 => RouteKind::Ski(1),
            _ => RouteKind::Other,
        }
    }

    /// Where a ski bus's drums sound: on the road partway up its canyon.
    pub fn canyon_point(self) -> (f32, f32) {
        match self {
            RouteKind::Ski(1) => (40.628, -111.75),
            _ => (40.573, -111.75),
        }
    }
}

/// One rail departure from a stop, in absolute time.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct RailEvent {
    /// UTC milliseconds: when it left (observed) or is due to (scheduled).
    pub ms: f64,
    /// Index into the network's routes.
    pub route: u8,
    /// GTFS direction (0 or 1).
    pub dir: u8,
    /// Index into the network's stops.
    pub stop: u16,
    /// Seconds behind the schedule (observed departures only).
    pub late_s: i16,
    /// `true` when realtime saw it leave; `false` when it's the schedule.
    pub observed: bool,
}

/// A ski bus leaving its first stop.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct SkiEvent {
    /// UTC milliseconds.
    pub ms: f64,
    /// Index into the network's routes.
    pub route: u8,
}

/// One service day as the host loaded it.
#[derive(Clone, Debug, Default)]
pub struct ServiceDay {
    /// The calendar date, as yyyymmdd.
    pub date: u32,
    /// UTC milliseconds of the service day's start.
    pub t0_ms: f64,
    /// Departures: `(seconds, packed route | dir << 8 | stop << 16)`.
    pub rail: Vec<(u32, u32)>,
    /// Ski bus first departures: `(seconds, route)`.
    pub ski: Vec<(u32, u32)>,
    /// Bus stop events per minute since the service day's start.
    pub bus: Vec<u16>,
    /// The western half of `bus` (the rest is east of −111.89°).
    pub bus_west: Vec<u16>,
}

/// A stop's position.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct Stop {
    /// Latitude.
    pub lat: f32,
    /// Longitude.
    pub lon: f32,
}

/// Routes and stops, from `network.json`.
#[derive(Clone, Debug, Default)]
pub struct Network {
    /// Route kinds, by route index.
    pub routes: Vec<RouteKind>,
    /// Stop positions, by stop index.
    pub stops: Vec<Stop>,
    /// The stop index of Salt Lake Central, where FrontRunner's arrivals
    /// sound the horn.
    pub slc_central: Option<u16>,
}

impl Network {
    /// The kind of a route index.
    pub fn kind(&self, route: u8) -> RouteKind {
        self.routes
            .get(usize::from(route))
            .copied()
            .unwrap_or(RouteKind::Other)
    }
}

/// Every loaded service day merged into one timeline.
#[derive(Clone, Debug, Default)]
pub struct Schedule {
    /// The days, in date order.
    pub days: Vec<ServiceDay>,
    rail: Vec<RailEvent>,
    ski: Vec<SkiEvent>,
    /// Spans the conductor has reported in full: inside them, the observed
    /// departures (and the schedule for trains realtime doesn't track) stand
    /// in for the schedule.
    covered: Vec<(f64, f64)>,
    observed: Vec<RailEvent>,
}

impl Schedule {
    /// Add or replace a service day, then rebuild the merged timeline.
    pub fn insert(&mut self, day: ServiceDay) {
        self.days.retain(|d| d.date != day.date);
        self.days.push(day);
        self.days.sort_by_key(|d| d.date);
        // The host loads the days around now; keep at most sixteen (about
        // 200 KB each) in case it keeps adding.
        while self.days.len() > 16 {
            self.days.remove(0);
        }
        self.rebuild();
    }

    fn rebuild(&mut self) {
        self.rail.clear();
        self.ski.clear();
        for day in &self.days {
            for &(t, packed) in &day.rail {
                // UTA's times are whole minutes, so departures would pile up
                // on hh:mm:00. The true second within the minute isn't in the
                // schedule; spread each one across its minute by a hash of
                // the trip's stop, the same on every phone.
                let spread = if t % 60 == 0 {
                    let h = sonido_core::rng::mix64(u64::from(packed) ^ (u64::from(t) << 32));
                    (h % 60_000) as f64
                } else {
                    0.0
                };
                self.rail.push(RailEvent {
                    ms: day.t0_ms + f64::from(t) * 1000.0 + spread,
                    route: (packed & 0xff) as u8,
                    dir: ((packed >> 8) & 0xff) as u8,
                    stop: (packed >> 16) as u16,
                    late_s: 0,
                    observed: false,
                });
            }
            for &(t, route) in &day.ski {
                self.ski.push(SkiEvent {
                    ms: day.t0_ms + f64::from(t) * 1000.0,
                    route: route as u8,
                });
            }
        }
        self.rail.sort_by(|a, b| a.ms.total_cmp(&b.ms));
        self.ski.sort_by(|a, b| a.ms.total_cmp(&b.ms));
    }

    /// Rail departures in `[from_ms, to_ms)`.
    pub fn rail_between(&self, from_ms: f64, to_ms: f64) -> &[RailEvent] {
        let lo = self.rail.partition_point(|e| e.ms < from_ms);
        let hi = self.rail.partition_point(|e| e.ms < to_ms);
        &self.rail[lo..hi.max(lo)]
    }

    /// Ski bus departures in `[from_ms, to_ms)`.
    pub fn ski_between(&self, from_ms: f64, to_ms: f64) -> &[SkiEvent] {
        let lo = self.ski.partition_point(|e| e.ms < from_ms);
        let hi = self.ski.partition_point(|e| e.ms < to_ms);
        &self.ski[lo..hi.max(lo)]
    }

    /// Bus stop events per minute at `ms`, summed over the days whose
    /// service covers it, linearly interpolated between minutes.
    pub fn bus_rate(&self, ms: f64) -> f32 {
        self.days
            .iter()
            .map(|d| per_minute(&d.bus, (ms - d.t0_ms) / 60_000.0))
            .sum()
    }

    /// The western share of the bus rate at `ms` (0.5 when unknown).
    pub fn bus_west_share(&self, ms: f64) -> f32 {
        let total = self.bus_rate(ms);
        if total <= 0.0 {
            return 0.5;
        }
        let west: f32 = self
            .days
            .iter()
            .map(|d| per_minute(&d.bus_west, (ms - d.t0_ms) / 60_000.0))
            .sum();
        (west / total).clamp(0.0, 1.0)
    }

    /// Record a conductor's window: every departure from `from_ms` to
    /// `to_ms`, observed or (for untracked trains) scheduled. A window posted
    /// again replaces itself.
    pub fn perform(&mut self, from_ms: f64, to_ms: f64, events: &[RailEvent]) {
        if to_ms <= from_ms {
            return;
        }
        self.observed.retain(|e| e.ms < from_ms || e.ms >= to_ms);
        self.observed
            .extend(events.iter().filter(|e| e.ms >= from_ms && e.ms < to_ms));
        self.observed.sort_by(|a, b| a.ms.total_cmp(&b.ms));
        self.covered.retain(|&(a, b)| b <= from_ms || a >= to_ms);
        self.covered.push((from_ms, to_ms));
        self.covered.sort_by(|a, b| a.0.total_cmp(&b.0));
        // Keep six hours.
        let horizon = to_ms - 6.0 * 3_600_000.0;
        self.covered.retain(|&(_, b)| b > horizon);
        self.observed.retain(|e| e.ms > horizon);
    }

    fn is_covered(&self, ms: f64) -> bool {
        let i = self.covered.partition_point(|&(a, _)| a <= ms);
        i > 0 && ms < self.covered[i - 1].1
    }

    /// The departures to play from `from_ms` to `to_ms`: what the conductor
    /// reported where it did, the schedule elsewhere.
    pub fn performed_between(&self, from_ms: f64, to_ms: f64) -> Vec<RailEvent> {
        let mut out: Vec<RailEvent> = self
            .rail_between(from_ms, to_ms)
            .iter()
            .filter(|e| !self.is_covered(e.ms))
            .copied()
            .collect();
        let lo = self.observed.partition_point(|e| e.ms < from_ms);
        let hi = self.observed.partition_point(|e| e.ms < to_ms);
        out.extend_from_slice(&self.observed[lo..hi.max(lo)]);
        out.sort_by(|a, b| a.ms.total_cmp(&b.ms));
        out
    }

    /// How far behind the system runs, from the observed departures in the
    /// ten minutes before `ms`: their median lateness in seconds, 0 without.
    pub fn system_late_s(&self, ms: f64) -> f32 {
        let lo = self.observed.partition_point(|e| e.ms < ms - 600_000.0);
        let hi = self.observed.partition_point(|e| e.ms < ms);
        let mut late: Vec<i16> = self.observed[lo..hi.max(lo)]
            .iter()
            .filter(|e| e.observed)
            .map(|e| e.late_s)
            .collect();
        if late.len() < 3 {
            return 0.0;
        }
        late.sort_unstable();
        f32::from(late[late.len() / 2])
    }

    /// Rail departures per minute around `ms`, over a five-minute window.
    pub fn rail_rate(&self, ms: f64) -> f32 {
        self.rail_between(ms - 150_000.0, ms + 150_000.0).len() as f32 / 5.0
    }

    /// How busy the valley's transit is, 0 (asleep) to 1 (rush), from the
    /// bus rate and the rail rate: a weekday's rush runs about 236 bus stop
    /// events and 11 rail departures a minute.
    pub fn activity(&self, ms: f64) -> f32 {
        ((self.bus_rate(ms) + 10.0 * self.rail_rate(ms)) / 330.0).clamp(0.0, 1.0)
    }

    /// Mean activity over `[from_ms, to_ms)`, sampled each minute.
    pub fn mean_activity(&self, from_ms: f64, to_ms: f64) -> f32 {
        let minutes = ((to_ms - from_ms) / 60_000.0).ceil().max(1.0) as usize;
        let sum: f32 = (0..minutes)
            .map(|m| self.activity(from_ms + m as f64 * 60_000.0))
            .sum();
        sum / minutes as f32
    }

    /// `true` once any day is loaded.
    pub fn is_loaded(&self) -> bool {
        !self.days.is_empty()
    }

    /// The service day whose `t0` is the latest at or before `ms`.
    pub fn day_at(&self, ms: f64) -> Option<&ServiceDay> {
        self.days.iter().rev().find(|d| d.t0_ms <= ms)
    }
}

fn per_minute(series: &[u16], minute: f64) -> f32 {
    if minute < 0.0 || series.is_empty() {
        return 0.0;
    }
    let i = minute.floor() as usize;
    let frac = (minute - minute.floor()) as f32;
    let a = series.get(i).copied().map_or(0.0, f32::from);
    let b = series.get(i + 1).copied().map_or(0.0, f32::from);
    a + (b - a) * frac
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(date: u32, t0_ms: f64) -> ServiceDay {
        let mut bus = vec![0u16; 1800];
        for (m, slot) in bus.iter_mut().enumerate() {
            // A plateau from 06:00 to 18:00.
            if (360..1080).contains(&m) {
                *slot = 236;
            }
        }
        ServiceDay {
            date,
            t0_ms,
            rail: vec![
                (6 * 3600, 1 | (1 << 8) | (7 << 16)),
                (25 * 3600, 2 | (3 << 16)),
            ],
            ski: vec![(7 * 3600 + 60, 5)],
            bus_west: bus.iter().map(|&b| b / 2).collect(),
            bus,
        }
    }

    #[test]
    fn merges_days_into_absolute_time() {
        let mut s = Schedule::default();
        let t0 = 1_700_000_000_000.0;
        s.insert(day(20261023, t0));
        s.insert(day(20261024, t0 + 86_400_000.0));
        // The 25:00 departure of the 23rd lands after the 24th's 00:00.
        let late = s.rail_between(t0 + 86_400_000.0, t0 + 86_400_000.0 + 2.0 * 3_600_000.0);
        assert_eq!(late.len(), 1);
        assert_eq!(late[0].route, 2);
        let morning = s.rail_between(t0 + 6.0 * 3_600_000.0, t0 + 6.1 * 3_600_000.0);
        assert_eq!(morning[0].dir, 1);
        assert_eq!(morning[0].stop, 7);
        assert_eq!(s.ski_between(t0, t0 + 8.0 * 3_600_000.0).len(), 1);
    }

    #[test]
    fn rates_and_activity() {
        let mut s = Schedule::default();
        let t0 = 1_700_000_000_000.0;
        s.insert(day(20261023, t0));
        let noon = t0 + 12.0 * 3_600_000.0;
        assert!((s.bus_rate(noon) - 236.0).abs() < 1e-3);
        assert!((s.bus_west_share(noon) - 0.5).abs() < 0.01);
        assert!(s.activity(noon) > 0.6);
        assert_eq!(s.activity(t0 + 3.0 * 3_600_000.0), 0.0);
        assert!(s.mean_activity(t0 + 5.0 * 3_600_000.0, t0 + 7.0 * 3_600_000.0) > 0.2);
    }

    #[test]
    fn replacing_a_day_keeps_one_copy() {
        let mut s = Schedule::default();
        s.insert(day(20261023, 0.0));
        s.insert(day(20261023, 0.0));
        assert_eq!(s.days.len(), 1);
        assert_eq!(s.rail_between(0.0, 1e12).len(), 2);
    }

    #[test]
    fn a_reported_window_replaces_the_schedule_inside_it() {
        let mut s = Schedule::default();
        let t0 = 1_000_000.0;
        s.insert(ServiceDay {
            date: 20261023,
            t0_ms: t0,
            rail: vec![(100, 1), (200, 1 | (2 << 16)), (400, 1)],
            ski: vec![],
            bus: vec![],
            bus_west: vec![],
        });
        // The conductor saw the 200 s train leave 30 s late; the window
        // covers 150–250 s.
        let late = RailEvent {
            ms: t0 + 230_000.0,
            route: 1,
            dir: 0,
            stop: 2,
            late_s: 30,
            observed: true,
        };
        s.perform(t0 + 150_000.0, t0 + 250_000.0, &[late]);
        let played = s.performed_between(t0, t0 + 500_000.0);
        let times: Vec<f64> = played.iter().map(|e| (e.ms - t0) / 1000.0).collect();
        assert_eq!(times.len(), 3, "{times:?}");
        assert!((times[0] - 100.0).abs() < 60.0);
        assert!((times[1] - 230.0).abs() < 1e-9);
        assert!(played[1].observed && played[1].late_s == 30);
        assert!((times[2] - 400.0).abs() < 60.0);
        // Posting the window again replaces it rather than doubling it.
        s.perform(t0 + 150_000.0, t0 + 250_000.0, &[late]);
        assert_eq!(s.performed_between(t0, t0 + 500_000.0).len(), 3);
        // Too few observations for a system lateness yet.
        assert_eq!(s.system_late_s(t0 + 260_000.0), 0.0);
    }
}
