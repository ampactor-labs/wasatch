//! Each component's cost, alone, as a share of one core in real time.
use std::time::Instant;
use wasatch_engine::audio::master::Master;
use wasatch_engine::audio::skyline::SkylineTables;
use wasatch_engine::audio::space::{Room, Vantage};
use wasatch_engine::audio::voices::*;

const SR: f32 = 48_000.0;
const SECS: f32 = 10.0;

fn time(name: &str, mut f: impl FnMut()) {
    let n = (SR * SECS) as usize;
    let t = Instant::now();
    for _ in 0..n {
        f();
    }
    let share = t.elapsed().as_secs_f64() / f64::from(SECS) * 100.0;
    println!("{name:<28} {share:6.2}% of a core");
}

fn main() {
    let mut room = Room::new(SR);
    room.set(Vantage::Canyons, 0.5);
    let mut x = 0.1f32;
    time("room (ER + lid + canyon + FDN)", || {
        let (l, r) = room.process(x, x, x * 0.2);
        x = -x * 0.999 + (l + r) * 1e-6;
    });
    let mut master = Master::new(SR);
    time("master (rider, multiband, TP)", || {
        let (l, _) = master.process(x, -x);
        x = 0.1 * (1.0 - x) + l * 1e-6;
    });
    let crest: Vec<f32> = (0..155)
        .map(|i| 9000.0 + (i as f32 * 0.37).sin() * 900.0 + i as f32 * 10.0)
        .collect();
    let tables = SkylineTables::from_profile(&crest);
    let mut pads: Vec<PadVoice> = (0..4).map(|_| PadVoice::new(SR)).collect();
    for (i, p) in pads.iter_mut().enumerate() {
        p.start(55 + 4 * i as i32, SR, 2400.0, 0.2, Placement::default());
    }
    time("4 pad voices", || {
        let mut o = Out::default();
        for p in &mut pads {
            p.tick(&tables, 0.3, &mut o);
        }
    });
    let mut lake = LakePedal::new(SR);
    time("lake pedal", || {
        let mut o = Out::default();
        lake.tick(0.8, 0.3, &mut o);
    });
    let mut bells: Vec<ModalVoice<2>> = (0..6).map(|_| ModalVoice::new(SR)).collect();
    for (i, b) in bells.iter_mut().enumerate() {
        b.strike(
            &bell_partials(600.0 + 100.0 * i as f32),
            Hit {
                vel: 0.8,
                hardness: 0.7,
                gain: 0.2,
            },
            Placement::default(),
        );
    }
    time("6 bells ringing", || {
        let mut o = Out::default();
        for b in &mut bells {
            b.tick(&mut o);
        }
    });
    let mut drums: Vec<DrumVoice> = (0..4).map(|i| DrumVoice::new(SR, i + 1)).collect();
    let mut k = 0u32;
    time("4 drums retriggered", || {
        k += 1;
        if k % 12_000 == 1 {
            for (i, d) in drums.iter_mut().enumerate() {
                let kind = [
                    DrumKind::Kick,
                    DrumKind::Snare,
                    DrumKind::Hat,
                    DrumKind::Crash,
                ][i];
                d.start(kind, 45.0, 0.8, Placement::default(), k);
            }
        }
        let mut o = Out::default();
        for d in &mut drums {
            d.tick(&mut o);
        }
    });
    let mut bass = Bass::new(SR);
    let mut j = 0u32;
    time("bass", || {
        j += 1;
        if j % 24_000 == 1 {
            bass.start(36.0, 0.8, 0.4, SR);
        }
        let mut o = Out::default();
        bass.tick(&mut o);
    });
    let mut air = Air::new(SR);
    time("air", || {
        let mut o = Out::default();
        air.tick(8.0, 14.0, 0.8, &mut o);
    });
}
